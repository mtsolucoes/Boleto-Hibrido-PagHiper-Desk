const CONFIG_MODULE_API_NAME = "configuracaoExtensaoPagHiper";
const CONFIG_MODULE_LABEL = "Configuração da Extensão";

const SCHEMA_GERAL_PROVISIONAMENTO = {
  configuracaoExtensaoPagHiper: [
    { displayLabel: "PagHiper API Key", type: "Text", apiName: "cf_apiKey", maxLength: 255, isEncryptedField: true },
    { displayLabel: "PagHiper Token", type: "Text", apiName: "cf_token", maxLength: 255, isEncryptedField: true },
    { displayLabel: "Dias para vencimento", type: "Number", apiName: "cf_diasVencimento" },
    { displayLabel: "Percentual de multa", type: "Decimal", apiName: "cf_multa" },
    { displayLabel: "Aplicar juros", type: "Checkbox", apiName: "cf_juros" },
    { displayLabel: "Ambiente PagHiper", type: "Text", apiName: "cf_ambientePagHiper", maxLength: 30 },
    { displayLabel: "Usar tarifa própria no Modelo C", type: "Checkbox", apiName: "cf_modeloCTarifaPropria" },
    { displayLabel: "Selecionar produtos automaticamente", type: "Checkbox", apiName: "cf_modeloBAutoSelecionar" }
  ],
  tickets: [
    { displayLabel: "Boleto ID", type: "Text", apiName: "cf_boleto_id", maxLength: 100 },
    { displayLabel: "Status do Boleto", type: "Text", apiName: "cf_status_boleto", maxLength: 100 },
    { displayLabel: "Link do Boleto", type: "Website", apiName: "cf_link_boleto", maxLength: 250 },
    { displayLabel: "Linha Digitável", type: "Text", apiName: "cf_linha_digitavel", maxLength: 100 },
    { displayLabel: "Valor do Boleto", type: "Currency", apiName: "cf_valor_boleto" }
  ],
  contacts: [
    { displayLabel: "CPF/CNPJ", type: "Text", apiName: "cf_cpf_cnpj", maxLength: 18 },
    { displayLabel: "Número", type: "Text", apiName: "cf_numero_endereco", maxLength: 20 },
    { displayLabel: "Bairro", type: "Text", apiName: "cf_bairro_endereco", maxLength: 100 }
  ],
  accounts: [
    { displayLabel: "CPF/CNPJ", type: "Text", apiName: "cf_cpf_cnpj", maxLength: 18 },
    { displayLabel: "Número", type: "Text", apiName: "cf_numero_endereco", maxLength: 20 },
    { displayLabel: "Bairro", type: "Text", apiName: "cf_bairro_endereco", maxLength: 100 }
  ],
  timeEntry: [
    { displayLabel: "Referência da Cobrança", type: "Text", apiName: "cf_referencia_cobranca", maxLength: 150 }
  ]
};

let portalOrgId = null;
let activeTicketId = null;
let CONFIG_EXTENSAO = null;

ZOHODESK.extension.onload().then(async function (App) {
  try {
    await resolverContextoDesk(App);
    await inicializarTudoBasico();
  } catch (error) {
    console.error("[PagHiper] Falha ao obter contexto do Desk:", error);
    updateUIStatus("status-loader", "Falha ao obter contexto do ticket/portal.");
  }
});

async function resolverContextoDesk(App) {
  activeTicketId = App?.model?.id || await getSdkValue("ticket.id");

  const portal = await getSdkValue("portal").catch(() => null);
  portalOrgId = App?.model?.orgId ||
    portal?.orgId ||
    portal?.id ||
    portal?.zid ||
    new URLSearchParams(window.location.search).get("_iam_zid");

  if (!activeTicketId) {
    throw new Error("ticket.id indisponivel no SDK.");
  }

  if (!portalOrgId) {
    throw new Error("orgId indisponivel no SDK.");
  }
}

async function getSdkValue(key) {
  const response = await ZOHODESK.get(key);
  if (response && typeof response === "object" && key in response) {
    return response[key];
  }
  return response;
}

async function inicializarTudoBasico() {
  updateUIStatus("status-loader", "Carregando widget...");
  CONFIG_EXTENSAO = {
    diasVencimento: 5,
    multa: 0,
    juros: false,
    ambientePagHiper: "Sandbox",
    modeloCTarifaPropria: false,
    modeloBAutoSelecionar: false
  };
  loadWidgetMainScreen();
}

async function inicializarTudo() {
  try {
    updateUIStatus("status-loader", "Validando configuração...");
    CONFIG_EXTENSAO = await inicializarModuloConfiguracao();
    updateUIStatus("status-loader", "Checando campos customizados...");
    const totalMissing = {};
    for (const moduleName of Object.keys(SCHEMA_GERAL_PROVISIONAMENTO)) {
      totalMissing[moduleName] = await findMissingFields(moduleName);
    }
    const missingCount = Object.values(totalMissing).reduce((sum, fields) => sum + fields.length, 0);
    if (missingCount) {
      await handleFieldsProvisioning(totalMissing);
    } else {
      loadWidgetMainScreen();
    }
  } catch (error) {
    console.error("[PagHiper] Falha crítica de inicialização:", error);
    updateUIStatus("status-loader", "Falha de inicialização. Contate o administrador.");
  }
}

async function inicializarModuloConfiguracao() {
  const resposta = await ZOHODESK.request({
    url: "https://desk.zoho.com/api/v1/organizationModules",
    type: "GET",
    headers: { orgId: portalOrgId }
  });
  const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
  let modulo = (dados?.data || []).find(item => item.apiName === CONFIG_MODULE_API_NAME);

  if (!modulo) {
    const criado = await ZOHODESK.request({
      url: "https://desk.zoho.com/api/v1/organizationModules",
      type: "POST",
      headers: { orgId: portalOrgId, "Content-Type": "application/json" },
      postBody: JSON.stringify({
        apiName: CONFIG_MODULE_API_NAME,
        displayLabel: CONFIG_MODULE_LABEL,
        singularLabel: CONFIG_MODULE_LABEL,
        pluralLabel: "Configurações da Extensão"
      })
    });
    const criadoJson = typeof criado === "string" ? JSON.parse(criado) : criado;
    modulo = criadoJson?.data || criadoJson;
  }

  const records = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/${CONFIG_MODULE_API_NAME}?limit=1`,
    type: "GET",
    headers: { orgId: portalOrgId }
  });
  const parsedRecords = typeof records === "string" ? JSON.parse(records) : records;
  const record = parsedRecords?.data?.[0] || {};
  const config = { ...record, ...(record.cf || {}) };
  return {
    ...config,
    diasVencimento: config.diasVencimento ?? config.cf_diasVencimento,
    multa: config.multa ?? config.cf_multa,
    juros: config.juros ?? config.cf_juros,
    ambientePagHiper: config.ambientePagHiper ?? config.cf_ambientePagHiper,
    modeloCTarifaPropria: config.modeloCTarifaPropria ?? config.cf_modeloCTarifaPropria,
    modeloBAutoSelecionar: config.modeloBAutoSelecionar ?? config.cf_modeloBAutoSelecionar
  };
}

async function findMissingFields(moduleName) {
  const response = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/fields?module=${moduleName}`,
    type: "GET",
    headers: { orgId: portalOrgId }
  });
  const data = typeof response === "string" ? JSON.parse(response) : response;
  const existingFields = data?.data || [];
  return SCHEMA_GERAL_PROVISIONAMENTO[moduleName].filter(requiredField =>
    !existingFields.some(field =>
      field.apiName === requiredField.apiName ||
      field.displayLabel?.toLowerCase() === requiredField.displayLabel.toLowerCase()
    )
  );
}

async function handleFieldsProvisioning(missingMap) {
  for (const [moduleName, fields] of Object.entries(missingMap)) {
    for (const field of fields) {
      updateUIStatus("status-loader", `Provisionando campo: ${field.displayLabel}...`);
      await createFieldInZoho(moduleName, field);
    }
  }
  loadWidgetMainScreen();
}

async function createFieldInZoho(moduleName, fieldConfig) {
  const payload = {
    displayLabel: fieldConfig.displayLabel,
    apiName: fieldConfig.apiName,
    type: fieldConfig.type,
    isEncryptedField: fieldConfig.isEncryptedField === true,
    isPHI: false,
    isTrackLastActivityTime: false,
    isMandatory: false
  };
  if (fieldConfig.maxLength) payload.maxLength = String(fieldConfig.maxLength);
  const response = await ZOHODESK.request({
    url: `https://desk.zoho.com/api/v1/fields?module=${moduleName}`,
    type: "POST",
    headers: { orgId: portalOrgId, "Content-Type": "application/json" },
    postBody: JSON.stringify(payload)
  });
  return typeof response === "string" ? JSON.parse(response) : response;
}

function loadWidgetMainScreen() {
  document.getElementById("loader-screen").style.display = "none";
  document.getElementById("main-app-container").style.display = "block";
  inicializarTelaProdutos();
}

function updateUIStatus(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) element.innerText = text;
}
