function limparDiagnosticoEmissao() {
  const output = document.getElementById("diagnostico-emissao-json");
  if (output) output.textContent = "";
}

function registrarDiagnosticoEmissao(titulo, dados) {
  const output = document.getElementById("diagnostico-emissao-json");
  if (!output) return;

  const timestamp = new Date().toISOString();
  output.textContent += `[${timestamp}] ${titulo}\n${JSON.stringify(sanitizarDiagnosticoEmissao(dados), null, 2)}\n\n`;
}

function sanitizarDiagnosticoEmissao(value) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(item => sanitizarDiagnosticoEmissao(item));
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const keyNormalizada = key.toLowerCase();
      const metadataDeCredencial = /(_source|_tamanho|_preenchido|_preenchida|_comeca_com_apk)$/.test(keyNormalizada);
      const sensitive = !metadataDeCredencial && /^(api[_-]?key|token|authorization|senha|password|secret)$/i.test(key);
      acc[key] = sensitive ? mascararValorSensivel(item) : sanitizarDiagnosticoEmissao(item);
      return acc;
    }, {});
  }

  return value;
}

function mascararValorSensivel(value) {
  if (!value) return value;
  const text = String(value);
  if (text.startsWith("{{") && text.endsWith("}}")) return text;
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function serializarErroEmissao(error) {
  if (!error) return { message: "Erro desconhecido" };
  if (typeof error === "string") return { message: error };

  const result = {
    message: error.message,
    mensagemAmigavel: error.mensagemAmigavel,
    name: error.name,
    stack: error.stack
  };

  Object.getOwnPropertyNames(error).forEach(key => {
    if (!(key in result)) result[key] = error[key];
  });

  return result;
}

function parseRequestEnvelope(response) {
  const envelope = typeof response === "string" ? parseJsonSePossivel(response) : response;
  if (!envelope || typeof envelope !== "object") {
    return {
      envelope,
      body: envelope,
      statusCode: null,
      message: String(envelope || "")
    };
  }

  let body = envelope.response ?? envelope.statusMessage ?? envelope.message ?? envelope;
  body = typeof body === "string" ? parseJsonSePossivel(body) : body;

  return {
    envelope,
    body,
    statusCode: envelope.statusCode ? Number(envelope.statusCode) : null,
    message: typeof body === "string" ? body : body?.message
  };
}

function isSigmaInputParameterMismatch(envelope) {
  return envelope?.statusCode === 412 && String(envelope.message || "").includes("Input parameter");
}

function isSigmaMissingInputParameter(envelope) {
  return envelope?.statusCode === 412 && String(envelope.message || "").includes("Input parameter is missing");
}

function isSigmaRetryableInputEnvelope(envelope) {
  const message = String(envelope?.message || "");
  return envelope?.statusCode === 412 && (
    message.includes("Input parameter") ||
    message.includes("Function not found for given input")
  );
}

const GERAR_BOLETO_SIGMA_FUNCTION_UUID = "5297c382-4918-4fbf-9279-92aeb2d166cf";
const GERAR_BOLETO_SIGMA_FUNCTION_VERSION = "7";
const CONSULTAR_BOLETO_SIGMA_FUNCTION_UUID = "59846e17-1d27-41a1-b6d7-576f10b8b9de";
const CONSULTAR_BOLETO_SIGMA_FUNCTION_VERSION = "1";
const CANCELAR_BOLETO_SIGMA_FUNCTION_UUID = "640ade47-2006-4e66-9800-1b80a5857205";
const CANCELAR_BOLETO_SIGMA_FUNCTION_VERSION = "2";
const GERAR_BOLETO_SIGMA_DOMAIN_FALLBACK = "4180c9fa-bd12-48bd-b4bb-736116bc90ad.sigmaexecution.com";

function obterSigmaExecutionDomain() {
  const metaDomain = appMeta?.sigmaExecutionDomain || "";
  const normalizedMetaDomain = String(metaDomain)
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const metaDomainValido = normalizedMetaDomain && normalizedMetaDomain !== "00000000.sigmaexecution.com";
  return metaDomainValido ? normalizedMetaDomain : GERAR_BOLETO_SIGMA_DOMAIN_FALLBACK;
}

function obterSigmaAppUuid() {
  return obterSigmaExecutionDomain().split(".")[0];
}

function getGerarBoletoFunctionUrl() {
  return `https://${obterSigmaExecutionDomain()}/workspace/invokefunction` +
    `?sigma_function_uuid=${GERAR_BOLETO_SIGMA_FUNCTION_UUID}` +
    `&sigma_function_version=${GERAR_BOLETO_SIGMA_FUNCTION_VERSION}` +
    `&integ_scope_id=${portalOrgId || ""}` +
    "&app_install_id={{sigmaInstallId}}" +
    "&custom_response=true" +
    "&auth_type=apikey" +
    "&encapiKey={{enCapApiKey}}";
}

function getCancelarBoletoFunctionUrl() {
  return `https://${obterSigmaExecutionDomain()}/workspace/invokefunction` +
    `?sigma_function_uuid=${CANCELAR_BOLETO_SIGMA_FUNCTION_UUID}` +
    `&sigma_function_version=${CANCELAR_BOLETO_SIGMA_FUNCTION_VERSION}` +
    `&integ_scope_id=${portalOrgId || ""}` +
    "&app_install_id={{sigmaInstallId}}" +
    "&custom_response=true" +
    "&auth_type=apikey" +
    "&encapiKey={{enCapApiKey}}";
}

function getConsultarBoletoFunctionUrl() {
  if (!CONSULTAR_BOLETO_SIGMA_FUNCTION_UUID || !CONSULTAR_BOLETO_SIGMA_FUNCTION_VERSION) {
    return null;
  }

  return `https://${obterSigmaExecutionDomain()}/workspace/invokefunction` +
    `?sigma_function_uuid=${CONSULTAR_BOLETO_SIGMA_FUNCTION_UUID}` +
    `&sigma_function_version=${CONSULTAR_BOLETO_SIGMA_FUNCTION_VERSION}` +
    `&integ_scope_id=${portalOrgId || ""}` +
    "&app_install_id={{sigmaInstallId}}" +
    "&custom_response=true" +
    "&auth_type=apikey" +
    "&encapiKey={{enCapApiKey}}";
}

function getOperacaoBoletoFunctionUrl(funcao) {
  if (funcao === "cancelarBoletoPagHiper") return getCancelarBoletoFunctionUrl();
  if (funcao === "consultarBoletoPagHiper") return getConsultarBoletoFunctionUrl();
  return null;
}

function getOperacaoBoletoSigmaConfig(funcao) {
  if (funcao === "cancelarBoletoPagHiper") {
    return {
      sigmaFunctionUuid: CANCELAR_BOLETO_SIGMA_FUNCTION_UUID,
      sigmaFunctionVersion: CANCELAR_BOLETO_SIGMA_FUNCTION_VERSION
    };
  }
  if (funcao === "consultarBoletoPagHiper") {
    return {
      sigmaFunctionUuid: CONSULTAR_BOLETO_SIGMA_FUNCTION_UUID || null,
      sigmaFunctionVersion: CONSULTAR_BOLETO_SIGMA_FUNCTION_VERSION || null
    };
  }
  return {
    sigmaFunctionUuid: null,
    sigmaFunctionVersion: null
  };
}

async function tratarCliqueGerarBoleto() {
  const button = document.getElementById("btn-gerar-boleto");
  if (button) button.disabled = true;
  exibirStatus("info", "Gerando boleto via PagHiper...");
  limparDiagnosticoEmissao();
  try {
    registrarDiagnosticoEmissao("Inicio do fluxo de emissao", {
      activeTicketId,
      portalOrgId,
      deskDomainUrl,
      appMeta: appMeta || {},
      configCarregada: CONFIG_EXTENSAO || {},
      credenciaisConfig: typeof descreverCredenciaisPagHiper === "function"
        ? descreverCredenciaisPagHiper(CONFIG_EXTENSAO)
        : {}
    });
    validarConfiguracaoParaBoleto();
    const payload = await montarPayloadBoleto();
    registrarDiagnosticoEmissao("Payload enviado para gerarBoletoPagHiper", payload);
    const resultado = await dispararGeracaoBoletoViaProxy(payload);
    registrarDiagnosticoEmissao("Resposta final parseada", resultado);
    await tratarRespostaSucesso(resultado);
  } catch (erro) {
    console.error("[PagHiper] Falha na geracao:", erro);
    registrarDiagnosticoEmissao("Erro capturado no widget", serializarErroEmissao(erro));
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Erro na emissao do boleto.");
  } finally {
    if (button) button.disabled = false;
    recalcularValorEEstado();
  }
}

function validarConfiguracaoParaBoleto() {
  const pendentes = [];
  if (!CONFIG_EXTENSAO?.cnpjEmissor) pendentes.push("CNPJ Emissor");
  if (!CONFIG_EXTENSAO?.apiKey) pendentes.push("API Key");
  if (!CONFIG_EXTENSAO?.token) pendentes.push("Token");

  if (pendentes.length) {
    throw new Error(`Preencha nas configuracoes da extensao: ${pendentes.join(", ")}.`);
  }

  const apiKey = typeof extrairApiKeyPagHiper === "function"
    ? extrairApiKeyPagHiper(CONFIG_EXTENSAO.apiKey)
    : String(CONFIG_EXTENSAO.apiKey).trim();
  const token = typeof limparCredencialPagHiper === "function"
    ? limparCredencialPagHiper(CONFIG_EXTENSAO.token)
    : String(CONFIG_EXTENSAO.token).trim();

  CONFIG_EXTENSAO.apiKey = apiKey;
  CONFIG_EXTENSAO.token = token;

  if (/^\*+$/.test(apiKey) || /^\*+$/.test(token)) {
    registrarDiagnosticoEmissao("Credenciais mascaradas recebidas do Zoho", {
      credenciaisConfig: typeof descreverCredenciaisPagHiper === "function"
        ? descreverCredenciaisPagHiper(CONFIG_EXTENSAO)
        : {}
    });
    throw new Error("O Zoho entregou API Key/Token mascarados para o widget. Reinstale a extensao com API Key e Token sem secure no manifest e preencha os campos novamente.");
  }

  if (!apiKey.toLowerCase().startsWith("apk_")) {
    registrarDiagnosticoEmissao("Credenciais rejeitadas na validacao local", {
      credenciaisConfig: typeof descreverCredenciaisPagHiper === "function"
        ? descreverCredenciaisPagHiper(CONFIG_EXTENSAO)
        : {
            api_key_tamanho: apiKey.length,
            api_key_contem_apk: apiKey.toLowerCase().includes("apk_"),
            token_tamanho: token.length,
            token_contem_apk: token.toLowerCase().includes("apk_")
          }
    });
    throw new Error("A API Key da PagHiper precisa comecar com apk_. Se ela esta correta, verifique se o campo API Key da extensao nao recebeu outro valor.");
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
  const valorTeste = Number(document.getElementById("input-valor-teste")?.value || 0);
  const valorTotal = valorTeste > 0 ? valorTeste : produtosTotal + horasTotal;
  const cpfCnpj = document.getElementById("input-cpf-cnpj").value.replace(/\D/g, "");
  const ticketId = activeTicketId || await getSdkValue("ticket.id");
  if (valorTotal < 3) throw new Error("O valor minimo para emissao e R$ 3,00.");
  if (valorTeste > 0 && produtos.length === 0 && timeEntries.length === 0) {
    produtos.push({
      id: "teste-local",
      nome: "Valor de teste local",
      preco: valorTeste
    });
  }
  let pagador = {
    nome: "",
    email: "",
    telefone: "",
    cpf_cnpj: cpfCnpj,
    endereco: {}
  };
  try {
    pagador = await buscarDadosPagador();
  } catch (error) {
    registrarDiagnosticoEmissao("Nao foi possivel buscar pagador no widget; function tentara pelo Desk", serializarErroEmissao(error));
  }
  return {
    valor_total: Number(valorTotal.toFixed(2)),
    ticket_id: ticketId,
    cpf_cnpj: cpfCnpj,
    produtos,
    time_entries: timeEntries,
    pagador,
    cnpj_emissor: (CONFIG_EXTENSAO?.cnpjEmissor || "{{cnpj_emissor}}").replace(/\D/g, ""),
    api_key: CONFIG_EXTENSAO?.apiKey || "{{api_key}}",
    token: CONFIG_EXTENSAO?.token || "{{token}}",
    dias_vencimento: parseInt(CONFIG_EXTENSAO?.diasVencimento || CONFIG_EXTENSAO?.diasVencimentoPadrao || 5, 10),
    multa: Number(CONFIG_EXTENSAO?.multa || 0),
    juros: Boolean(CONFIG_EXTENSAO?.juros === true || CONFIG_EXTENSAO?.juros === "true"),
    dias_desconto_antecipado: Number(CONFIG_EXTENSAO?.diasDescontoAntecipado || 0),
    desconto_antecipado_percentual: Number(CONFIG_EXTENSAO?.descontoAntecipadoPercentual || 0),
    exibir_frase_fixa: Boolean(CONFIG_EXTENSAO?.exibirFraseFixa === true || CONFIG_EXTENSAO?.exibirFraseFixa === "true"),
    dias_limite_apos_vencimento: Number(CONFIG_EXTENSAO?.diasLimiteAposVencimento || 0)
  };
}

async function buscarDadosPagador() {
  const contatoId = await getSdkValue("ticket.contactId");
  const accountId = await getSdkValue("ticket.accountId");
  const modulo = contatoId ? "contacts" : "accounts";
  const recordId = contatoId || accountId;
  if (!contatoId && !accountId) throw new Error("O ticket nao possui contato ou conta pagadora.");
  const requestObj = {
    url: getDeskApiUrl(`/api/v1/${modulo}/${recordId}`),
    type: "GET",
    postBody: {},
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
    data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  };
  registrarDiagnosticoEmissao("Buscando pagador no Desk", {
    contatoId,
    accountId,
    modulo,
    recordId,
    request: requestObj
  });
  let resposta;
  try {
    resposta = await ZOHODESK.request(requestObj);
  } catch (error) {
    registrarDiagnosticoEmissao("Erro ao buscar pagador no Desk", {
      erro: serializarErroEmissao(error),
      request: requestObj
    });
    throw error;
  }
  registrarDiagnosticoEmissao("Resposta bruta do pagador no Desk", resposta);
  const contato = parseDeskApiResponse(resposta);
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
  let resposta;
  const functionUrl = getGerarBoletoFunctionUrl();
  const requestObj = {
    url: functionUrl,
    type: "POST",
    postBody: payload,
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    }
  };
  registrarDiagnosticoEmissao("URL da function gerar boleto", {
    url: functionUrl,
    sigmaExecutionDomainUsado: obterSigmaExecutionDomain(),
    sigmaExecutionDomainMeta: appMeta?.sigmaExecutionDomain || null,
    sigmaFunctionUuid: GERAR_BOLETO_SIGMA_FUNCTION_UUID,
    sigmaFunctionVersion: GERAR_BOLETO_SIGMA_FUNCTION_VERSION,
    temPlaceholders: functionUrl.includes("{{sigmaInstallId}}") && functionUrl.includes("{{enCapApiKey}}"),
    portalOrgId,
    appMeta: appMeta || {}
  });
  registrarDiagnosticoEmissao("Objeto enviado ao ZOHODESK.request", {
    ...requestObj,
    postBodyTipo: typeof requestObj.postBody,
    postBodyEhArray: Array.isArray(requestObj.postBody)
  });
  if (!portalOrgId) {
    throw new Error("orgId/portalOrgId vazio. A Execution URL do Sigma precisa do integ_scope_id.");
  }
  try {
    resposta = await ZOHODESK.request(requestObj);
  } catch (error) {
    registrarDiagnosticoEmissao("Erro bruto ao chamar Execution URL via ZOHODESK.request", {
      erro: serializarErroEmissao(error),
      hipotesePrincipal: "Se errMsg for Invalid Path, o helper recusou a URL antes da function executar.",
      proximosPontos: [
        "confirmar se App.meta.sigmaExecutionDomain bate com a function",
        "confirmar se a function esta associada/publicada na extensao Sigma",
        "confirmar se o Rest API pertence a esta mesma extensao Sigma"
      ]
    });
    if (error?.errMsg === "Invalid Path") {
      await diagnosticarFetchDiretoFunction(functionUrl, payload);
      await diagnosticarUrlSigmaSemPlaceholders();
      resposta = await tentarGerarBoletoViaCustomFunction(payload);
      if (resposta !== null) {
        registrarDiagnosticoEmissao("Resposta bruta via customfunction", resposta);
        const envelopeCustomFunction = parseRequestEnvelope(resposta);
        registrarDiagnosticoEmissao("Envelope parseado via customfunction", envelopeCustomFunction);
        if (envelopeCustomFunction.statusCode && Number(envelopeCustomFunction.statusCode) >= 400) {
          throw new Error(envelopeCustomFunction.message || `A function retornou HTTP ${envelopeCustomFunction.statusCode}.`);
        }
        const dadosCustomFunction = envelopeCustomFunction.body;
        registrarDiagnosticoEmissao("Resposta parseada via customfunction", dadosCustomFunction);
        if (dadosCustomFunction?.erro) {
          const erroCustomFunction = new Error(dadosCustomFunction.erro);
          erroCustomFunction.mensagemAmigavel = dadosCustomFunction.mensagemAmigavel;
          throw erroCustomFunction;
        }
        return dadosCustomFunction;
      }
    }
    throw new Error("A function gerarBoletoPagHiper nao esta disponivel no ambiente local. Para testar o botao, associe essa function no Sigma ou use uma URL de teste.");
  }
  registrarDiagnosticoEmissao("Resposta bruta da customfunction", resposta);
  let envelope = parseRequestEnvelope(resposta);
  registrarDiagnosticoEmissao("Envelope parseado da function", envelope);
  if (isSigmaMissingInputParameter(envelope)) {
    registrarDiagnosticoEmissao("Sigma recusou por parametro obrigatorio ausente na URL", {
      mensagemSigma: envelope.message,
      urlUsada: functionUrl,
      parametrosObrigatoriosConformeDoc: [
        "auth_type",
        "encapiKey",
        "sigma_function_uuid",
        "sigma_function_version",
        "integ_scope_id",
        "app_install_id"
      ],
      valoresAtuais: {
        sigma_function_uuid: GERAR_BOLETO_SIGMA_FUNCTION_UUID,
        sigma_function_version: GERAR_BOLETO_SIGMA_FUNCTION_VERSION,
        integ_scope_id: portalOrgId || "",
        app_install_id: "{{sigmaInstallId}}",
        encapiKey: "{{enCapApiKey}}"
      },
      acaoRecomendada: "Em widget de extensao instalada, mantenha app_install_id={{sigmaInstallId}} e encapiKey={{enCapApiKey}}. O Zoho substitui esses valores no request helper; se chegarem literais ou vazios, reinstale a extensao e reassocie a function."
    });
  } else if (isSigmaInputParameterMismatch(envelope)) {
    envelope = await tentarFormatosDeArgumentoSigma(functionUrl, payload, envelope);
  }
  if (envelope.statusCode && Number(envelope.statusCode) >= 400) {
    throw new Error(envelope.message || `A function retornou HTTP ${envelope.statusCode}.`);
  }
  const dados = envelope.body;
  registrarDiagnosticoEmissao("Resposta parseada da customfunction", dados);
  if (dados?.erro) {
    const erro = new Error(dados.erro);
    erro.mensagemAmigavel = dados.mensagemAmigavel;
    throw erro;
  }
  if (!dados?.transaction_id) {
    const erro = new Error("boleto_sem_transaction_id");
    erro.mensagemAmigavel = dados?.debug?.paghiper_response?.create_request?.response_message ||
      "A PagHiper nao retornou o ID da transacao.";
    throw erro;
  }
  return dados;
}

async function tentarFormatosDeArgumentoSigma(functionUrl, payload, envelopeOriginal) {
  const jsonPayload = JSON.stringify(payload);
  const variantes = [
    {
      nome: "postBody string JSON direto",
      postBody: jsonPayload,
      dicaSigma: "Use quando o argumento da function for string e o codigo fizer data.toMap()."
    },
    {
      nome: "argumento data como objeto",
      postBody: { data: payload },
      dicaSigma: "Use quando o argumento cadastrado no Sigma se chamar data e aceitar JSON/Map."
    },
    {
      nome: "argumento data como string JSON",
      postBody: { data: jsonPayload },
      dicaSigma: "Use quando o argumento cadastrado no Sigma se chamar data e aceitar String."
    },
    {
      nome: "argumento payload como objeto",
      postBody: { payload },
      dicaSigma: "Use quando o argumento cadastrado no Sigma se chamar payload."
    },
    {
      nome: "arguments.data como objeto",
      postBody: { arguments: { data: payload } },
      dicaSigma: "Formato alternativo de wrapper de argumentos."
    }
  ];

  for (const variante of variantes) {
    const resposta = await tentarExecutionUrlComFormato(functionUrl, variante);
    if (resposta === null) continue;

    const envelope = parseRequestEnvelope(resposta);
    registrarDiagnosticoEmissao(`Envelope parseado da function apos retry: ${variante.nome}`, {
      ...envelope,
      formatoTentado: variante.nome,
      dicaSigma: variante.dicaSigma
    });

    if (!isSigmaRetryableInputEnvelope(envelope)) {
      return envelope;
    }
  }

  registrarDiagnosticoEmissao("Todas as variantes de argumento foram recusadas pelo Sigma", {
    erroOriginal: envelopeOriginal,
    conclusaoProvavel: "A function esta associada, mas a configuracao de Arguments/Input no Sigma nao aceita os nomes ou tipos enviados pelo widget.",
    acaoRecomendada: "Na tela da function no Sigma, configure um argumento chamado data como String ou JSON/Map, ou remova validacoes/patterns do argumento. Depois publique/associe a versao usada pela URL."
  });
  return envelopeOriginal;
}

async function diagnosticarFetchDiretoFunction(functionUrl, payload) {
  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    registrarDiagnosticoEmissao("Teste fetch direto para Sigma", {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: text
    });
  } catch (fetchError) {
    registrarDiagnosticoEmissao("Erro no fetch direto para Sigma", serializarErroEmissao(fetchError));
  }
}

async function tentarGerarBoletoViaCustomFunction(payload) {
  const requestObj = {
    url: "customfunction:gerarBoletoPagHiper",
    type: "POST",
    postBody: payload,
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
    data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  };
  registrarDiagnosticoEmissao("Tentando fallback customfunction", requestObj);
  try {
    return await ZOHODESK.request(requestObj);
  } catch (customFunctionError) {
    registrarDiagnosticoEmissao("Erro no fallback customfunction", {
      erro: serializarErroEmissao(customFunctionError),
      request: requestObj
    });
    return null;
  }
}

async function tentarExecutionUrlComFormato(functionUrl, variante) {
  const requestObj = {
    url: functionUrl,
    type: "POST",
    postBody: variante.postBody,
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    }
  };
  registrarDiagnosticoEmissao(`Tentando Execution URL: ${variante.nome}`, {
    ...requestObj,
    postBody: sanitizarDiagnosticoEmissao(variante.postBody),
    postBodyTipo: typeof variante.postBody,
    dicaSigma: variante.dicaSigma
  });
  try {
    const resposta = await ZOHODESK.request(requestObj);
    registrarDiagnosticoEmissao(`Resposta bruta do retry: ${variante.nome}`, resposta);
    return resposta;
  } catch (retryError) {
    registrarDiagnosticoEmissao(`Erro no retry: ${variante.nome}`, {
      erro: serializarErroEmissao(retryError),
      request: {
        ...requestObj,
        postBody: sanitizarDiagnosticoEmissao(variante.postBody)
      }
    });
    return null;
  }
}

async function diagnosticarUrlSigmaSemPlaceholders() {
  registrarDiagnosticoEmissao("Diagnostico de parametros obrigatorios Sigma", {
    urlComPlaceholders: getGerarBoletoFunctionUrl(),
    urlSemAppInstallId: `https://${obterSigmaExecutionDomain()}/workspace/invokefunction` +
      `?sigma_function_uuid=${GERAR_BOLETO_SIGMA_FUNCTION_UUID}` +
      `&sigma_function_version=${GERAR_BOLETO_SIGMA_FUNCTION_VERSION}` +
      `&integ_scope_id=${portalOrgId || ""}` +
      "&app_install_id=" +
      "&custom_response=true" +
      "&auth_type=apikey" +
      "&encapiKey=",
    observacaoDoc: "No widget, a documentacao pede app_install_id={{sigmaInstallId}} e encapiKey={{enCapApiKey}}. Se esses placeholders nao forem resolvidos no dev mode, a function pode exigir a extensao publicada/associada no Sigma."
  });
}

async function tratarRespostaSucesso(resultado) {
  const ticketId = activeTicketId || await getSdkValue("ticket.id");
  try {
    await ZOHODESK.request({
      url: getDeskApiUrl(`/api/v1/tickets/${ticketId}`),
      type: "PATCH",
      postBody: {
        cf: {
          cf_id_do_boleto: resultado.transaction_id || "",
          cf_status_boleto: resultado.status || "pending",
          cf_link_do_boleto: resultado.url_slip || "",
          cf_linha_digitavel: resultado.digitable_line || "",
          cf_valor_do_servico: resultado.valor_total
        }
      },
      contentType: "application/json",
      headers: {
        "Content-Type": "application/json",
        orgId: portalOrgId
      },
      data: { orgId: portalOrgId },
      connectionLinkName: "zohodesk_conn"
    });
    await registrarReferenciasTimeEntries(resultado.transaction_id || "");
    preencherBoletoIdManual(resultado.transaction_id || "");
    await adicionarComentarioInterno(
      ticketId,
      `Boleto PagHiper emitido: ${resultado.transaction_id || "sem ID"} | ` +
      `Valor: R$ ${Number(resultado.valor_total || 0).toFixed(2)} | Status: ${resultado.status || "pending"}`
    );
    exibirStatus("sucesso", `Boleto emitido e ticket atualizado. ${resultado.url_slip || ""}`);
  } catch (error) {
    console.warn("[PagHiper] Boleto emitido, mas ticket nao foi atualizado:", error);
    exibirStatus("sucesso", `Boleto emitido. Nao foi possivel atualizar os campos do ticket. ${resultado.url_slip || ""}`);
  }
}

function obterTimeEntriesSelecionados() {
  return Array.from(selectedTimeEntryIds || []).map(id => {
    const entry = ticketTimeEntries.find(item => String(item.id) === String(id));
    if (!entry) return null;
    const seconds = typeof getTimeEntrySeconds === "function"
      ? getTimeEntrySeconds(entry)
      : Number(entry.secondsSpent || 0);
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
    url: getDeskApiUrl(`/api/v1/timeEntry/${entry.id}`),
    type: "PATCH",
    postBody: { cf: { cf_referencia_cobranca: reference } },
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
    data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  })));
}

async function adicionarComentarioInterno(ticketId, content) {
  await ZOHODESK.request({
    url: getDeskApiUrl(`/api/v1/tickets/${ticketId}/comments`),
    type: "POST",
    postBody: { content, isPublic: false },
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
    data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
}

async function obterBoletoId() {
  const ticketId = activeTicketId || await getSdkValue("ticket.id");
  const boletoIdManual = obterBoletoIdManual();
  if (boletoIdManual) {
    registrarDiagnosticoEmissao("Boleto ID informado manualmente", {
      ticketId,
      boletoId: boletoIdManual
    });
    validarTransactionIdPagHiper(boletoIdManual);
    return { ticketId, boletoId: boletoIdManual };
  }

  const resposta = await ZOHODESK.request({
    url: getDeskApiUrl(`/api/v1/tickets/${ticketId}`),
    type: "GET",
    postBody: {},
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
      data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
  registrarDiagnosticoEmissao("Resposta bruta ao buscar boleto ID no ticket", resposta);
  const ticket = parseDeskApiResponse(resposta);
  const boletoId = ticket.cf?.cf_id_do_boleto ||
    ticket.cf?.cf_boleto_id ||
    ticket.cf?.cf_id_boleto ||
    ticket.cf_id_do_boleto ||
    ticket.cf_boleto_id ||
    ticket.cf_id_boleto ||
    ticket.customFields?.["ID do Boleto"] ||
    ticket.customFields?.["Boleto ID"];

  if (boletoId) {
    preencherBoletoIdManual(boletoId);
    validarTransactionIdPagHiper(boletoId);
    return { ticketId, boletoId };
  }

  registrarDiagnosticoEmissao("Boleto ID nao encontrado no ticket", {
    ticketId,
    camposCf: ticket.cf || {},
    customFields: ticket.customFields || {},
    acao: "Informe o transaction_id no campo ID do boleto PagHiper e tente novamente."
  });
  throw new Error("Este ticket nao possui Boleto ID. Informe o ID do boleto PagHiper no campo manual e tente novamente.");
}

function obterBoletoIdManual() {
  return String(document.getElementById("input-boleto-id")?.value || "")
    .trim()
    .replace(/\s+/g, "");
}

function validarTransactionIdPagHiper(boletoId) {
  if (/^[A-Za-z0-9]{16}$/.test(String(boletoId || ""))) return;
  throw new Error("O ID do boleto PagHiper deve ser o transaction_id de 16 caracteres. Exemplo: 0996K2QO3B5C3T26. Nao use o numero do ticket, como #203435ZD.");
}

function preencherBoletoIdManual(boletoId) {
  const input = document.getElementById("input-boleto-id");
  if (input && boletoId) input.value = boletoId;
}

async function consultarBoleto() {
  const button = document.getElementById("btn-consultar-boleto");
  if (button) button.disabled = true;
  limparDiagnosticoEmissao();
  try {
    const { ticketId, boletoId } = await obterBoletoId();
    exibirStatus("info", "Consultando status na PagHiper...");
    const resultado = await dispararOperacaoBoleto("consultarBoletoPagHiper", {
      transaction_id: boletoId,
      ticket_id: ticketId
    });
    await atualizarDadosBoletoTicket(ticketId, resultado);
    preencherBoletoIdManual(resultado.transaction_id || boletoId);
    exibirStatus("sucesso", resultado.mensagemAmigavel || `Status atualizado: ${resultado.status || "desconhecido"}.`);
  } catch (erro) {
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Nao foi possivel consultar o boleto.");
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
      motivo: motivo.trim(),
      ticket_id: ticketId
    });
    await atualizarStatusTicket(ticketId, resultado.status || "canceled");
    await limparReferenciasTimeEntries();
    await adicionarComentarioInterno(ticketId, `Boleto ${boletoId} cancelado. Motivo: ${motivo.trim()}`);
    exibirStatus("sucesso", "Boleto cancelado.");
  } catch (erro) {
    exibirStatus("erro", erro.mensagemAmigavel || erro.message || "Nao foi possivel cancelar o boleto.");
  } finally {
    if (button) button.disabled = false;
  }

  async function limparReferenciasTimeEntries() {
    if (typeof ticketTimeEntries === "undefined") return;
    const entries = ticketTimeEntries.filter(entry =>
      entry.cf?.cf_referencia_cobranca || entry.cf_referencia_cobranca
    );
    await Promise.all(entries.map(entry => ZOHODESK.request({
      url: getDeskApiUrl(`/api/v1/timeEntry/${entry.id}`),
      type: "PATCH",
      postBody: { cf: { cf_referencia_cobranca: "" } },
      contentType: "application/json",
      headers: {
        "Content-Type": "application/json",
        orgId: portalOrgId
      },
      data: { orgId: portalOrgId },
      connectionLinkName: "zohodesk_conn"
    })));
  }
}

async function dispararOperacaoBoleto(funcao, payload) {
  const payloadComConfig = {
    ...payload,
    org_id: portalOrgId,
    api_key: CONFIG_EXTENSAO?.apiKey || "",
    token: CONFIG_EXTENSAO?.token || ""
  };
  const functionUrl = getOperacaoBoletoFunctionUrl(funcao);
  const sigmaConfig = getOperacaoBoletoSigmaConfig(funcao);
  const requestObj = functionUrl
    ? {
        url: functionUrl,
        type: "POST",
        postBody: payloadComConfig,
        contentType: "application/json",
        headers: {
          "Content-Type": "application/json",
          orgId: portalOrgId
        }
      }
    : {
        url: `customfunction:${funcao}`,
        type: "POST",
        postBody: payloadComConfig,
        contentType: "application/json",
        headers: {
          "Content-Type": "application/json",
          orgId: portalOrgId
        },
        data: { orgId: portalOrgId },
        connectionLinkName: "zohodesk_conn"
      };
  registrarDiagnosticoEmissao(`Objeto enviado para ${funcao}`, {
    ...requestObj,
    ...sigmaConfig,
    temPlaceholders: functionUrl ? functionUrl.includes("{{sigmaInstallId}}") && functionUrl.includes("{{enCapApiKey}}") : false
  });
  let resposta;
  try {
    resposta = await requestComTimeout(
      () => ZOHODESK.request(requestObj),
      `Timeout ao chamar ${funcao}`,
      30000
    );
  } catch (error) {
    registrarDiagnosticoEmissao(`Erro bruto ao chamar ${funcao}`, {
      erro: serializarErroEmissao(error),
      request: requestObj
    });
    throw new Error(`A function ${funcao} nao esta disponivel no ambiente local ou a REST API nao esta whitelistada/associada.`);
  }
  registrarDiagnosticoEmissao("Resposta bruta da customfunction", resposta);
  let envelope = parseRequestEnvelope(resposta);
  registrarDiagnosticoEmissao("Envelope parseado da customfunction", envelope);
  if (functionUrl && isSigmaRetryableInputEnvelope(envelope)) {
    registrarDiagnosticoEmissao("Sigma recusou a chamada inicial por input", {
      mensagemSigma: envelope.message,
      statusCode: envelope.statusCode,
      acao: "Tentando formatos alternativos de payload para esta function."
    });
    envelope = await tentarFormatosDeArgumentoSigma(functionUrl, payloadComConfig, envelope);
  }
  if (envelope.statusCode && Number(envelope.statusCode) >= 400) {
    throw new Error(envelope.message || `A function retornou HTTP ${envelope.statusCode}.`);
  }
  const dados = envelope.body;
  registrarDiagnosticoEmissao("Resposta parseada da customfunction", dados);
  if (dados?.erro) {
    const erro = new Error(dados.erro);
    erro.mensagemAmigavel = dados.mensagemAmigavel;
    throw erro;
  }
  return dados;
}

function requestComTimeout(factory, message, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(`${message}: a Function nao respondeu em ${Math.round(timeoutMs / 1000)} segundos.`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([factory(), timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function atualizarDadosBoletoTicket(ticketId, resultado) {
  const boletoId = resultado.transaction_id || "";
  const status = resultado.status || "unknown";
  const camposPrincipais = {
    cf_id_do_boleto: boletoId,
    cf_status_boleto: status,
    cf_link_do_boleto: resultado.url_slip || "",
    cf_linha_digitavel: resultado.digitable_line || "",
    cf_valor_do_servico: resultado.valor_total || 0
  };

  await atualizarCamposCustomizadosTicket(ticketId, camposPrincipais);

  const camposExtras = {};
  if (resultado.url_slip_pdf) camposExtras.cf_link_pdf_boleto = resultado.url_slip_pdf;
  if (resultado.due_date) camposExtras.cf_vencimento_boleto = resultado.due_date;
  if (resultado.status_date) camposExtras.cf_data_status_boleto = resultado.status_date;

  if (Object.keys(camposExtras).length > 0) {
    try {
      await atualizarCamposCustomizadosTicket(ticketId, camposExtras);
    } catch (error) {
      registrarDiagnosticoEmissao("Campos extras de consulta nao foram atualizados", {
        camposExtras,
        erro: serializarErroEmissao(error),
        observacao: "Crie os campos cf_link_pdf_boleto, cf_vencimento_boleto e cf_data_status_boleto no ticket se quiser armazenar esses dados."
      });
    }
  }
}

async function atualizarCamposCustomizadosTicket(ticketId, camposCf) {
  return ZOHODESK.request({
    url: getDeskApiUrl(`/api/v1/tickets/${ticketId}`),
    type: "PATCH",
    postBody: { cf: camposCf },
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      orgId: portalOrgId
    },
    data: { orgId: portalOrgId },
    connectionLinkName: "zohodesk_conn"
  });
}

async function atualizarStatusTicket(ticketId, status) {
  await atualizarCamposCustomizadosTicket(ticketId, { cf_status_boleto: status });
}
