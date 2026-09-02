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
  const valorTotal = produtos.reduce((total, produto) => total + produto.preco, 0);
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  if (valorTotal < 3) throw new Error("O valor mínimo para emissão é R$ 3,00.");
  return {
    valor_total: Number(valorTotal.toFixed(2)),
    cpf_cnpj: cpfCnpj,
    produtos,
    pagador: await buscarDadosPagador(),
    dias_vencimento: parseInt(CONFIG_EXTENSAO?.diasVencimento || CONFIG_EXTENSAO?.diasVencimentoPadrao || 5, 10)
  };
}

async function buscarDadosPagador() {
  const contatoId = await ZOHODESK.get("ticket.contactId");
  if (!contatoId) throw new Error("O ticket não possui um contato pagador.");
  const resposta = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/contacts/${contatoId}`,
    type: "GET",
    headers: { orgId: portalOrgId }
  });
  const contato = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  return {
    nome: `${contato.firstName || ""} ${contato.lastName || ""}`.trim(),
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
    headers: { orgId: portalOrgId }
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
    headers: { orgId: portalOrgId }
  });
  exibirStatus("sucesso", "Boleto emitido e ticket atualizado.");
}

async function obterBoletoId() {
  const ticketId = await ZOHODESK.get("ticket.id");
  const resposta = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/tickets/${ticketId}`,
    type: "GET",
    headers: { orgId: portalOrgId }
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
    exibirStatus("sucesso", "Boleto cancelado.");
  } catch (erro) {
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Não foi possível cancelar o boleto.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function dispararOperacaoBoleto(funcao, payload) {
  const resposta = await ZOHODESK.request({
    url: `customfunction:${funcao}`,
    type: "POST",
    postBody: JSON.stringify(payload),
    contentType: "application/json",
    headers: { orgId: portalOrgId }
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
