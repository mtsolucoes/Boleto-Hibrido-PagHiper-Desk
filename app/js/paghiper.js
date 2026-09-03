async function tratarCliqueGerarBoleto() {
  const button = document.getElementById("btn-gerar-boleto");
  if (button) button.disabled = true;
  exibirStatus("info", "Gerando boleto via PagHiper...");
  try {
    const payload = await montarPayloadBoleto();
    const resultado = await dispararGeracaoBoletoViaProxy(payload);
    await tratarRespostaSucesso(resultado);
  } catch (erro) {
    console.error("[PagHiper] Falha na geração:", erro);
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Erro na emissão do boleto.");
  } finally {
    if (button) button.disabled = false;
    recalcularValorEEstado();
  }
}

async function montarPayloadBoleto() {
  const produtos = Array.from(document.querySelectorAll(".checkbox-produto:checked")).map(cb => ({
    id: cb.dataset.id,
    nome: cb.dataset.nome,
    preco: parseFloat(cb.dataset.preco)
  }));
  const timeEntries = typeof obterTimeEntriesSelecionados === "function"
    ? obterTimeEntriesSelecionados()
    : [];
  const produtosTotal = produtos.reduce((total, produto) => total + produto.preco, 0);
  const horasTotal = timeEntries.reduce((total, entry) => total + entry.cost, 0);
  const valorTotal = produtosTotal + horasTotal;
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  if (valorTotal < 3) throw new Error("O valor mínimo para emissão é R$ 3,00.");
  return {
    valor_total: Number(valorTotal.toFixed(2)),
    cpf_cnpj: cpfCnpj,
    produtos,
    time_entries: timeEntries,
    pagador: await buscarDadosPagador(),
    dias_vencimento: parseInt(CONFIG_EXTENSAO?.diasVencimento || CONFIG_EXTENSAO?.diasVencimentoPadrao || 5, 10),
    multa: Number(CONFIG_EXTENSAO?.multa || 0),
    juros: Boolean(CONFIG_EXTENSAO?.juros === true || CONFIG_EXTENSAO?.juros === "true")
  };
}

async function buscarDadosPagador() {
  const contatoId = await ZOHODESK.get("ticket.contactId");
  const accountId = await ZOHODESK.get("ticket.accountId");
  if (!contatoId && !accountId) throw new Error("O ticket não possui contato ou conta pagadora.");
  const resposta = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/${contatoId ? "contacts" : "accounts"}/${contatoId || accountId}`,
    type: "GET",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  const contato = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  return {
    nome: contato.firstName || contato.lastName
      ? `${contato.firstName || ""} ${contato.lastName || ""}`.trim()
      : contato.accountName || contato.name || "",
    email: contato.email,
    telefone: contato.phone || contato.mobile || "",
    cpf_cnpj: cpfCnpj,
    endereco: {
      rua: contato.street || contato.cf?.cf_endereco_rua || "",
      numero: contato.cf?.cf_numero_endereco || "",
      bairro: contato.cf?.cf_bairro_endereco || "",
      cidade: contato.city || "",
      cep: contato.zipCode || ""
    }
  };
}

async function dispararGeracaoBoletoViaProxy(payload) {
  const resposta = await ZOHODESK.request({
    url: "customfunction:gerarBoletoPagHiper",
    type: "POST",
    postBody: JSON.stringify(payload),
    contentType: "application/json",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  if (dados?.erro) {
    const erro = new Error(dados.erro);
    erro.mensagemAmigavel = dados.mensagemAmigavel;
    throw erro;
  }
  return dados;
}

async function tratarRespostaSucesso(resultado) {
  const ticketId = await ZOHODESK.get("ticket.id");
  await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/tickets/${ticketId}`,
    type: "PATCH",
    postBody: JSON.stringify({
      cf: {
        cf_boleto_id: resultado.transaction_id || "",
        cf_status_boleto: resultado.status || "pending",
        cf_link_boleto: resultado.url_slip || "",
        cf_linha_digitavel: resultado.digitable_line || "",
        cf_valor_boleto: resultado.valor_total
      }
    }),
    contentType: "application/json",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  await registrarReferenciasTimeEntries(resultado.transaction_id || "");
  await adicionarComentarioInterno(
    ticketId,
    `Boleto PagHiper emitido: ${resultado.transaction_id || "sem ID"} | ` +
    `Valor: R$ ${Number(resultado.valor_total || 0).toFixed(2)} | Status: ${resultado.status || "pending"}`
  );
  exibirStatus("sucesso", "Boleto emitido e ticket atualizado.");
}

function obterTimeEntriesSelecionados() {
  return Array.from(selectedTimeEntryIds || []).map(id => {
    const entry = ticketTimeEntries.find(item => String(item.id) === String(id));
    if (!entry) return null;
    const seconds = Number(entry.secondsSpent || 0);
    const nativeCost = Number(entry.totalCost || 0);
    const customRate = Number(document.getElementById("input-tarifa-custom")?.value || 0);
    const useCustomRate = Boolean(CONFIG_EXTENSAO?.modeloCTarifaPropria);
    return {
      id: entry.id,
      seconds,
      cost: Number((useCustomRate ? seconds / 3600 * customRate : nativeCost).toFixed(2))
    };
  }).filter(Boolean);
}

async function registrarReferenciasTimeEntries(reference) {
  if (!reference || typeof obterTimeEntriesSelecionados !== "function") return;
  const selected = obterTimeEntriesSelecionados();
  await Promise.all(selected.map(entry => ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/timeEntry/${entry.id}`,
    type: "PATCH",
    postBody: JSON.stringify({ cf: { cf_referencia_cobranca: reference } }),
    contentType: "application/json",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  })));
}

async function adicionarComentarioInterno(ticketId, content) {
  await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/tickets/${ticketId}/comments`,
    type: "POST",
    postBody: JSON.stringify({ content, isPublic: false }),
    contentType: "application/json",
    headers: { orgId: portalOrgId }
  });
}

async function obterBoletoId() {
  const ticketId = await ZOHODESK.get("ticket.id");
  const resposta = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/tickets/${ticketId}`,
    type: "GET",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  const ticket = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  const boletoId = ticket.cf?.cf_boleto_id || ticket.cf_boleto_id;
  if (!boletoId) throw new Error("Este ticket não possui Boleto ID.");
  return { ticketId, boletoId };
}

async function consultarBoleto() {
  const button = document.getElementById("btn-consultar-boleto");
  if (button) button.disabled = true;
  try {
    const { ticketId, boletoId } = await obterBoletoId();
    exibirStatus("info", "Consultando status na PagHiper...");
    const resultado = await dispararOperacaoBoleto("consultarBoletoPagHiper", { transaction_id: boletoId });
    await atualizarStatusTicket(ticketId, resultado.status || "unknown");
    exibirStatus("sucesso", `Status atualizado: ${resultado.status || "desconhecido"}.`);
  } catch (erro) {
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Não foi possível consultar o boleto.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function cancelarBoleto() {
  const motivo = window.prompt("Informe o motivo do cancelamento:");
  if (!motivo || !motivo.trim()) return;
  const button = document.getElementById("btn-cancelar-boleto");
  if (button) button.disabled = true;
  try {
    const { ticketId, boletoId } = await obterBoletoId();
    exibirStatus("info", "Cancelando boleto na PagHiper...");
    const resultado = await dispararOperacaoBoleto("cancelarBoletoPagHiper", {
      transaction_id: boletoId,
      motivo: motivo.trim()
    });
    await atualizarStatusTicket(ticketId, resultado.status || "canceled");
    await limparReferenciasTimeEntries();
    await adicionarComentarioInterno(ticketId, `Boleto ${boletoId} cancelado. Motivo: ${motivo.trim()}`);
    exibirStatus("sucesso", "Boleto cancelado.");
  } catch (erro) {
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Não foi possível cancelar o boleto.");
  } finally {
    if (button) button.disabled = false;
  }

  async function limparReferenciasTimeEntries() {
    if (typeof ticketTimeEntries === "undefined") return;
    const entries = ticketTimeEntries.filter(entry =>
      entry.cf?.cf_referencia_cobranca || entry.cf_referencia_cobranca
    );
    await Promise.all(entries.map(entry => ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/timeEntry/${entry.id}`,
      type: "PATCH",
      postBody: JSON.stringify({ cf: { cf_referencia_cobranca: "" } }),
      contentType: "application/json",
      headers: { orgId: portalOrgId },
      connectionLinkName: "zohodesk_conn"
    })));
  }
}

async function dispararOperacaoBoleto(funcao, payload) {
  const resposta = await ZOHODESK.request({
    url: `customfunction:${funcao}`,
    type: "POST",
    postBody: JSON.stringify(payload),
    contentType: "application/json",
    headers: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  if (dados?.erro) {
    const erro = new Error(dados.erro);
    erro.mensagemAmigavel = dados.mensagemAmigavel;
    throw erro;
  }
  return dados;
}

async function atualizarStatusTicket(ticketId, status) {
  await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/tickets/${ticketId}`,
    type: "PATCH",
    postBody: JSON.stringify({ cf: { cf_status_boleto: status } }),
    contentType: "application/json",
    headers: { orgId: portalOrgId }
  });
}
