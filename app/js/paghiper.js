/**
 * ARQUIVO: paghiper-zoho-desk/app/js/paghiper.js
 * FUNÇÃO: Tratar a geração de boletos invocando o proxy serverless Deluge,
 * capturar os dados do pagador de forma resiliente e salvar o retorno no Ticket.
 */

async function tratarCliqueGerarBoleto() {
  const btn = document.getElementById("btn-gerar-boleto");
  if (btn) btn.disabled = true;
  
  exibirStatus("info", "Gerando boleto via proxy seguro...");

  try {
    // 1. Constrói o payload completo cruzando dados da UI e do Zoho Desk
    const payload = await montarPayloadBoleto();
    console.log("[PagHiper] Enviando payload ao Deluge Proxy:", payload);

    // 2. Dispara a geração através da Serverless Function registrada
    const resultado = await dispararGeracaoBoletoViaProxy(payload);
    console.log("[PagHiper] Boleto gerado com sucesso no gateway:", resultado);

    // 3. Grava as informações de retorno de volta no Ticket de forma alinhada
    await tratarRespostaSucesso(resultado);

  } catch (erro) {
    console.error("[PagHiper] Falha crítica na geração do boleto:", erro);
    exibirStatus("erro", erro.mensagemAmigavel || "Erro na emissão do boleto.");
  } finally {
    if (btn) btn.disabled = false;
    recalcularValorEEstado();
  }
}

async function montarPayloadBoleto() {
  const checkboxesMarcados = Array.from(document.querySelectorAll(".checkbox-produto:checked"));
  const produtosSelecionados = checkboxesMarcados.map(cb => ({
    id: cb.value,
    nome: cb.dataset.nome,
    preco: parseFloat(cb.dataset.preco)
  }));

  const valorTotal = produtosSelecionados.reduce((acc, p) => acc + p.preco, 0);
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  
  // Busca as informações do pagador de forma resiliente
  const dadosPagador = await buscarDadosPagador();

  return {
    valor_total: valorTotal,
    cpf_cnpj: cpfCnpj,
    produtos: produtosSelecionados,
    pagador: dadosPagador,
    dias_vencimento: parseInt(CONFIG_EXTENSAO?.diasVencimentoPadrao || 5, 10)
  };
}

async function buscarDadosPagador() {
  // Busca o ContactID amarrado nativamente ao Ticket ativo
  const contatoId = await ZOHODESK.get("ticket.contactId");
  
  const resposta = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/contacts/${contatoId}`,
    type: "GET",
    headers: {
      orgId: portalOrgId
    }
  });

  const contato = typeof resposta === "string" ? JSON.parse(resposta) : resposta;

  // Monta objeto unificando campos nativos e customizados criados na instalação
  return {
    nome: contato.lastName ? `${contato.firstName || ""} ${contato.lastName}`.trim() : contato.firstName,
    email: contato.email,
    telefone: contato.phone || contato.mobile || "",
    endereco: {
      rua: contato.street || contato.cf?.cf_endereco_rua || "",
      numero: contato.cf?.cf_numero_endereco || "", // Mapeado no nosso Schema Técnico
      bairro: contato.cf?.cf_bairro_endereco || "", // Mapeado no nosso Schema Técnico
      cidade: contato.city || "",
      cep: contato.zipCode || ""
    }
  };
}

async function dispararGeracaoBoletoViaProxy(payload) {
  try {
    // Invocação nativa e segura da Serverless Function via SDK do Zoho Desk
    const resposta = await ZOHODESK.request({
      url: "customfunction:gerarBoletoPagHiper",
      type: "POST",
      postBody: JSON.stringify(payload),
      contentType: "application/json",
      headers: {
        orgId: portalOrgId
      }
    });

    const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;

    if (dados?.erro) {
      const erroFormatado = new Error(dados.erro);
      erroFormatado.mensagemAmigavel = dados.mensagemAmigavel || "A PagHiper recusou a transação.";
      throw erroFormatado;
    }

    return dados;
  } catch (erro) {
    if (!erro.mensagemAmigavel) {
      erro.mensagemAmigavel = "Erro de conexão ao executar o proxy de boletos.";
    }
    throw erro;
  }
}

async function tratarRespostaSucesso(resultado) {
  exibirStatus("sucesso", `Boleto emitido! Código de barras gerado.`);

  try {
    const ticketId = await ZOHODESK.get("ticket.id");
    
    // ATUALIZA OS CAMPOS CUSTOMIZADOS NO TICKET (Rígida paridade com o SCHEMA_FASE_1)
    await ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/tickets/${ticketId}`,
      type: "PATCH",
      postBody: JSON.stringify({
        cf: {
          cf_status_boleto: resultado.status || "pending",
          cf_link_boleto: resultado.url_slip || "",
          cf_linha_digitavel: resultado.digitable_line || "",
          cf_valor_boleto: resultado.valor_total
        }
      }),
      contentType: "application/json",
      headers: {
        orgId: portalOrgId
      }
    });

    console.log("[PagHiper] Ticket atualizado com os metadados do boleto.");

  } catch (erro) {
    console.error("[PagHiper] Boleto gerado mas falhou ao gravar no Ticket:", erro);
    exibirStatus("erro", "Boleto gerado, mas ocorreu uma falha ao salvar as informações no ticket.");
  }
}
