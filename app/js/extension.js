/**
 * ARQUIVO: app/js/extension.js
 * FUNÇÃO: Inicializar a extensão nativa, gerenciar o Módulo de Configurações 
 * e verificar/provisionar campos customizados de forma idempotente.
 */

const CONFIG_MODULE_API_NAME = "configuracaoExtensaoPagHiper";
const CONFIG_MODULE_LABEL = "Configuração da Extensão";

// SCHEMA EXPANDIDO COM SUPORTE À FASE 2
const SCHEMA_GERAL_PROVISIONAMENTO = {
  tickets: [
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
  timeEntry: [
    // Campo crítico para controle de rastreabilidade (Fase 2)
    { displayLabel: "Referência de Cobrança", type: "Text", apiName: "cf_referencia_cobranca", maxLength: 100 }
  ]
};

let portalOrgId = null;
let activeTicketId = null;
let CONFIG_EXTENSAO = null;

// PONTO DE ENTRADA DO WIDGET
ZOHODESK.extension.onload().then(async function (App) {
  activeTicketId = App.model.id;
  portalOrgId = App.model.orgId;

  console.log(`[PagHiper] Widget iniciado para o ticket ${activeTicketId}`);
  await inicializarTudo();
});

async function inicializarTudo() {
  try {
    updateUIStatus("status-loader", "Validando Módulo de Configuração...");
    CONFIG_EXTENSAO = await inicializarModuloConfiguracao();

    updateUIStatus("status-loader", "Checando metadados de campos...");
    const missingTickets = await findMissingFields("tickets");
    const missingContacts = await findMissingFields("contacts");
    const missingTimeEntry = await findMissingFields("timeEntry");

    const totalMissing = {
      tickets: missingTickets,
      contacts: missingContacts,
      timeEntry: missingTimeEntry
    };

    const countMissing = totalMissing.tickets.length + totalMissing.contacts.length + totalMissing.timeEntry.length;

    if (countMissing > 0) {
      console.warn(`[PagHiper] Provisionando ${countMissing} metadados faltantes.`);
      await handleFieldsProvisioning(totalMissing);
    } else {
      console.log("[PagHiper] Metadados 100% validados.");
      loadWidgetMainScreen();
    }
  } catch (error) {
    console.error("[PagHiper] Falha crítica de inicialização:", error);
    updateUIStatus("status-loader", "Falha de inicialização. Contate o administrador.");
  }
}

// BUSCA AS CONFIGURAÇÕES DO MÓDULO DE CONFIGURAÇÃO DA EXTENSÃO (Criado no Setup)
async function inicializarModuloConfiguracao() {
  try {
    const resposta = await ZOHODESK.request({
      url: "https://desk.zoho.com/api/v1/organizationModules",
      type: "GET",
      headers: { orgId: portalOrgId }
    });
    const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
    const modulos = dados?.data || [];
    const modulo = modulos.find(m => m.apiName === CONFIG_MODULE_API_NAME);

    if (modulo) {
      // Busca o registro de configuração gravado dentro dele
      const records = await ZOHODESK.request({
        url: `https://desk.zoho.com/api/v1/${CONFIG_MODULE_API_NAME}`,
        type: "GET",
        headers: { orgId: portalOrgId }
      });
      const parsedRecords = typeof records === "string" ? JSON.parse(records) : records;
      return parsedRecords?.data?.?.cf || null;
    }
    return null;
  } catch (err) {
    console.error("[PagHiper] Erro ao buscar configurações:", err);
    return null;
  }
}

// DETECÇÃO RESILIENTE DE CAMPOS CUSTOMIZADOS (GET /api/v1/fields)
async function findMissingFields(moduleName) {
  return new Promise((resolve, reject) => {
    ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/fields?module=${moduleName}`,
      method: "GET",
      headers: { orgId: portalOrgId }
    }).then(response => {
      const apiResponse = JSON.parse(response);
      const existingFields = apiResponse.data || [];
      
      const missing = SCHEMA_GERAL_PROVISIONAMENTO[moduleName].filter(requiredField => {
        const match = existingFields.find(f => 
          f.apiName === requiredField.apiName || 
          f.displayLabel.toLowerCase() === requiredField.displayLabel.toLowerCase()
        );
        return !match;
      });
      resolve(missing);
    }).catch(err => reject(err));
  });
}

// PROVISIONAMENTO SEQUENCIAL (POST /api/v1/fields)
async function handleFieldsProvisioning(missingMap) {
  const modulesToProcess = ["contacts", "tickets", "timeEntry"];
  for (const mod of modulesToProcess) {
    if (missingMap[mod] && missingMap[mod].length > 0) {
      for (const field of missingMap[mod]) {
        updateUIStatus("status-loader", `Provisionando campo: ${field.displayLabel}...`);
        await createFieldInZoho(mod, field);
      }
    }
  }
  updateUIStatus("status-loader", "Todos os campos configurados!");
  setTimeout(() => loadWidgetMainScreen(), 1500);
}

async function createFieldInZoho(moduleName, fieldConfig) {
  return new Promise((resolve, reject) => {
    const payload = {
      displayLabel: fieldConfig.displayLabel,
      type: fieldConfig.type,
      isEncryptedField: false,
      isPHI: false,
      isTrackLastActivityTime: false,
      isMandatory: false,
      department: null
    };

    if (fieldConfig.maxLength && fieldConfig.type === "Text") {
      payload.maxLength = String(fieldConfig.maxLength);
    }

    ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/fields?module=${moduleName}`,
      method: "POST",
      headers: {
        orgId: portalOrgId,
        "Content-Type": "application/json;charset=UTF-8"
      },
      postBody: JSON.stringify(payload)
    }).then(res => resolve(JSON.parse(res)))
      .catch(err => reject(err));
  });
}

function loadWidgetMainScreen() {
  const loader = document.getElementById("loader-screen");
  const mainApp = document.getElementById("main-app-container");
  if (loader) loader.style.display = "none";
  if (mainApp) mainApp.style.display = "block";

  // Inicializa o Modelo B
  inicializarTelaProdutos();
}

function updateUIStatus(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) element.innerText = text;
}
