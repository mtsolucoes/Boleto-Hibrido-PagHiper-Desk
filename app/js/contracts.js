/**
 * ARQUIVO: app/js/contracts.js
 * FUNÇÃO: Controlar o fluxo do Modelo C. Buscar contrato do Account vinculado
 * ao Ticket, Time Entries válidos (pendentes) e calcular tarifas [1].
 */

let activeAccountContracts = [];
let ticketTimeEntries = [];
let selectedTimeEntryIds = new Set();
let hasActiveContract = false;

// INICIALIZADOR DA TELA DO MODELO C (Invocado pelo clique na Aba)
async function initModeloCScreen() {
  try {
    showLoaderInElement("status-contrato-container", "Verificando contratos do cliente...");
    showLoaderInElement("lista-time-entries", "Processando lançamentos de tempo...");

    // 1. Busca os dados de AccountId do Ticket para herdar contratos
    const ticketId = typeof getSdkValue === "function"
      ? await getSdkValue("ticket.id")
      : await ZOHODESK.get("ticket.id");
    const ticketRes = await ZOHODESK.request({
      url: getDeskApiUrl(`/api/v1/tickets/${ticketId}?include=contacts`),
      type: "GET",
      postBody: {},
      headers: { orgId: portalOrgId },
      data: { orgId: portalOrgId },
      connectionLinkName: DESK_CONNECTION_NAME
    });
    const ticketData = parseDeskApiResponse(ticketRes);
    const accountId = ticketData.accountId || await fetchContactAccountId(ticketData.contactId);

    // 2. Dispara buscas em paralelo para otimizar tempo de carga (Connections)
    const [contracts, timeEntries] = await Promise.all([
      accountId ? fetchAccountContracts(accountId) : Promise.resolve([]),
      fetchTicketTimeEntries(ticketId)
    ]);

    activeAccountContracts = contracts;
    ticketTimeEntries = filterUnbilledTimeEntries(timeEntries);
    selectedTimeEntryIds = new Set();

    // 3. Renderiza os componentes de faturamento
    renderContractStatus(contracts);
    renderTimeEntriesList(ticketTimeEntries);

    // 4. Configura preferências do Módulo de Configuração (Tarifa Própria) [2]
    setupTarifaCustomUI();

  } catch (error) {
    console.error("[PagHiper] Erro no carregamento de Contratos/Horas:", error);
    showConfigError("Erro ao carregar faturamento por tempo do Zoho Desk.");
  }
}

async function fetchContactAccountId(contactId) {
  if (!contactId) return null;
  try {
    const response = await ZOHODESK.request({
      url: getDeskApiUrl(`/api/v1/contacts/${contactId}`),
      type: "GET",
      postBody: {},
      headers: { orgId: portalOrgId },
      connectionLinkName: DESK_CONNECTION_NAME
    });
    const contact = parseDeskApiResponse(response);
    return contact?.accountId || contact?.account?.id || null;
  } catch (error) {
    console.warn("[PagHiper] Falha ao buscar Account do contato:", error);
    return null;
  }
}

// GET /api/v1/accounts/{accountId}/contracts (Busca contratos do cliente) [10, 11]
async function fetchAccountContracts(accountId) {
  try {
    const res = await ZOHODESK.request({
      url: getDeskApiUrl(`/api/v1/accounts/${accountId}/contracts?contractStatus=ACTIVE`),
      type: "GET",
      postBody: {},
      headers: { orgId: portalOrgId },
      data: { orgId: portalOrgId },
      connectionLinkName: DESK_CONNECTION_NAME
    });
    const parsed = parseDeskApiResponse(res);
    const entries = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(entries)) {
      console.warn("[PagHiper] Resposta de contratos sem data:", parsed);
      return [];
    }
    return entries;
  } catch (err) {
    console.warn("[PagHiper] Falha ao consultar contratos ativos:", err);
    return [];
  }
}

// GET /api/v1/tickets/{ticketId}/timeEntry
async function fetchTicketTimeEntries(ticketId) {
  const tentativas = [
    {
      nome: "entradas faturaveis",
      path: `/api/v1/tickets/${ticketId}/timeEntry?module=tickets&from=0&limit=100&include=owner&billStatus=billable`
    },
    {
      nome: "todas as entradas",
      path: `/api/v1/tickets/${ticketId}/timeEntry?module=tickets&from=0&limit=100&include=owner`
    },
    {
      nome: "compatibilidade sem module",
      path: `/api/v1/tickets/${ticketId}/timeEntry?from=0&limit=100&include=owner`
    }
  ];

  const diagnostico = [];
  for (const tentativa of tentativas) {
    try {
      const res = await requestDeskGet(tentativa.path);
      const parsed = parseDeskApiResponse(res);
      const entries = extrairListaTimeEntries(parsed).map(normalizarTimeEntry);
      diagnostico.push({
        tentativa: tentativa.nome,
        quantidade: entries.length
      });

      if (entries.length > 0 || tentativa.nome === "compatibilidade sem module") {
        registrarDiagnosticoModeloC("Busca de entradas de hora", {
          ticketId,
          tentativaUsada: tentativa.nome,
          diagnostico
        });
        return entries;
      }
    } catch (err) {
      diagnostico.push({
        tentativa: tentativa.nome,
        erro: err?.message || String(err)
      });
      console.warn(`[PagHiper] Falha ao buscar Time Entries (${tentativa.nome}):`, err);
    }
  }

  registrarDiagnosticoModeloC("Falha ao buscar entradas de hora", {
    ticketId,
    diagnostico
  });
  return [];
}

async function requestDeskGet(path) {
  return ZOHODESK.request({
    url: getDeskApiUrl(path),
    type: "GET",
    postBody: {},
    headers: { orgId: portalOrgId },
    data: { orgId: portalOrgId },
    connectionLinkName: DESK_CONNECTION_NAME
  });
}

function registrarDiagnosticoModeloC(titulo, dados) {
  if (typeof registrarDiagnosticoEmissao !== "function") return;
  if (CONFIG_EXTENSAO?.exibirDebugCliente !== true && CONFIG_EXTENSAO?.exibirDebugCliente !== "true") return;
  registrarDiagnosticoEmissao(titulo, dados);
}

function extrairListaTimeEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.timeEntries)) return parsed.timeEntries;
  if (Array.isArray(parsed?.timeEntry)) return parsed.timeEntry;
  return [];
}

function normalizarTimeEntry(entry) {
  const normalized = { ...entry };
  normalized.billStatusNormalizado = normalizarBillStatus(entry);
  normalized.secondsSpent = getTimeEntrySeconds(entry);
  normalized.totalCost = Number(entry.totalCost ?? entry.cost ?? entry.totalCosts ?? entry.charge ?? 0);
  return normalized;
}

function normalizarBillStatus(entry) {
  const rawStatus = String(
    entry.billStatus ||
    entry.billingStatus ||
    entry.billableStatus ||
    entry.bill_status ||
    ""
  ).trim();
  if (rawStatus) return rawStatus;
  if (entry.isBillable === false || entry.billable === false) return "nonBillable";
  if (entry.isBillable === true || entry.billable === true) return "billable";
  return "unknown";
}

function usarTarifaPropriaModeloC() {
  return CONFIG_EXTENSAO?.modeloCTarifaPropria === true ||
    CONFIG_EXTENSAO?.modeloCTarifaPropria === "true" ||
    CONFIG_EXTENSAO?.modeloCTarifaPropria === "on" ||
    CONFIG_EXTENSAO?.modeloCTarifaPropria === "1" ||
    CONFIG_EXTENSAO?.modeloCTarifaPropria === 1;
}

function obterTarifaHoraModeloC() {
  const inputValue = Number(document.getElementById("input-tarifa-custom")?.value || 0);
  if (inputValue > 0) return inputValue;
  return Number(CONFIG_EXTENSAO?.modeloCValorHora || 0);
}

function calcularCustoTimeEntry(entry) {
  const nativeCost = Number(entry.totalCost || 0);
  if (!usarTarifaPropriaModeloC()) return nativeCost;

  const tarifaHora = obterTarifaHoraModeloC();
  if (tarifaHora <= 0) return nativeCost;

  return Number(((getTimeEntrySeconds(entry) / 3600) * tarifaHora).toFixed(2));
}

function filterUnbilledTimeEntries(entries) {
  return entries.filter(entry => String(entry.billStatusNormalizado || "").toLowerCase() !== "billed");
}

function getTimeEntrySeconds(entry) {
  const secondsSpent = Number(entry.secondsSpent || 0);
  if (secondsSpent > 0) return secondsSpent;

  const hoursSpent = Number(entry.hoursSpent || 0);
  const minutesSpent = Number(entry.minutesSpent || 0);
  return (hoursSpent * 3600) + (minutesSpent * 60);
}

function formatarDuracao(seconds) {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatarDataHora(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escaparHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// RENDERIZADOR DE STATUS DE CONTRATO
function renderContractStatus(contracts) {
  const container = document.getElementById("status-contrato-container");
  if (!container) return;

  const activeContract = contracts.find(c => c.contractStatus === "ACTIVE");

  if (activeContract) {
    hasActiveContract = true;
    const planName = activeContract.supportPlan?.name || "Acordo Padrão";
    const type = activeContract.supportPlan?.supportType || "UNLIMITED_SUPPORT"; // Unlimited, Hours [15]
    
    let typeDesc = "Suporte Ilimitado (Faturar excedentes)";
    if (type === "HOURS") {
      typeDesc = "Suporte baseado em franquia de horas";
    }

    container.className = "status-contrato-box active-contract";
    container.innerHTML = `
      <p class="status-contrato-title" style="color:#1b5e20;">Contrato Ativo Conectado</p>
      <p class="status-contrato-desc"><strong>${activeContract.contractName}</strong> (${planName})</p>
      <p class="status-contrato-desc" style="color:#555;">SLA: ${typeDesc}</p>
    `;
  } else {
    hasActiveContract = false;
    container.className = "status-contrato-box";
    container.innerHTML = `
      <p class="status-contrato-title" style="color:#b71c1c;">Sem contrato ativo</p>
      <p class="status-contrato-desc">As horas faturaveis selecionadas serao cobradas conforme a regra de tarifa configurada.</p>
    `;
  }
}

// LISTA DE LANÇAMENTOS DE TEMPO [9]
function renderTimeEntriesList(entries) {
  const container = document.getElementById("lista-time-entries");
  if (!container) return;

  if (entries.length === 0) {
    renderTimeEntriesSummary(entries);
    container.innerHTML = '<p class="status-text" style="padding:10px;">Nenhum lançamento de tempo pendente de cobrança.</p>';
    return;
  }

  let html = "";
  entries.forEach(entry => {
    const seconds = getTimeEntrySeconds(entry);
    const timeFormatted = formatarDuracao(seconds);
    const ownerName = entry.owner?.name || "Agente";
    const cost = calcularCustoTimeEntry(entry);
    const reference = entry.cf?.cf_referencia_cobranca || entry.cf_referencia_cobranca || "";
    const description = entry.description ||
      entry.customFields?.timeEntryName ||
      entry.subject ||
      "Entrada de hora";
    const executedTime = formatarDataHora(entry.executedTime || entry.createdTime);
    const billStatus = String(entry.billStatusNormalizado || "unknown");
    const billStatusLabel = billStatus === "billable"
      ? "Faturavel"
      : billStatus === "nonBillable"
        ? "Nao faturavel"
        : billStatus;
    const billStatusClass = billStatus === "billable" ? "is-billable" : "is-not-billable";

    html += `
      <div class="hora-item">
        <label class="checkbox-container">
          <input type="checkbox" class="chk-time-entry" value="${entry.id}" data-seconds="${seconds}" data-native-cost="${cost}" onchange="toggleTimeEntrySelection('${entry.id}')">
          <span class="checkmark"></span>
          <div class="hora-info">
            <span class="hora-owner">${escaparHtml(description)}</span>
            <span class="hora-spent">${escaparHtml(ownerName)}${executedTime ? ` - ${executedTime}` : ""}</span>
            <span class="hora-meta">Tempo ${timeFormatted} <span class="status-billing ${billStatusClass}">${escaparHtml(billStatusLabel)}</span></span>
          </div>
        </label>
        <span class="hora-cost">${cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          ${reference ? `<small class="aviso-referencia">Ja cobrado: ${escaparHtml(reference)}</small>` : ""}
        </span>
      </div>
    `;
  });

  container.innerHTML = html;
  renderTimeEntriesSummary(entries);
}

function renderTimeEntriesSummary(entries) {
  const summary = document.getElementById("resumo-time-entries");
  if (!summary) return;

  const totalSeconds = entries.reduce((total, entry) => total + getTimeEntrySeconds(entry), 0);
  const totalCost = entries.reduce((total, entry) => total + calcularCustoTimeEntry(entry), 0);

  summary.textContent = `${entries.length} entrada(s) | Tempo ${formatarDuracao(totalSeconds)} | ${totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
}

function toggleTimeEntrySelection(entryId) {
  if (selectedTimeEntryIds.has(entryId)) {
    selectedTimeEntryIds.delete(entryId);
  } else {
    selectedTimeEntryIds.add(entryId);
  }
  recalcularValorEEstado();
}

// PREFERÊNCIA DE TARIFA CUSTOMIZADA [2]
function setupTarifaCustomUI() {
  const customRateContainer = document.getElementById("form-tarifa-custom");
  const inputRate = document.getElementById("input-tarifa-custom");

  // Verifica preferência de cálculo salva no Módulo (Seção 3.1)
  if (usarTarifaPropriaModeloC()) {
    if (customRateContainer) customRateContainer.style.display = "block";
    if (inputRate) {
      const configuredRate = Number(CONFIG_EXTENSAO?.modeloCValorHora || 0);
      if (configuredRate > 0) inputRate.value = configuredRate.toFixed(2);
      inputRate.removeEventListener("input", recalcularValorEEstado);
      inputRate.addEventListener("input", recalcularValorEEstado);
    }
  } else {
    if (customRateContainer) customRateContainer.style.display = "none";
  }
}

// AUXILIARES
function showLoaderInElement(elementId, text) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<p class="carregando">${text}</p>`;
}

function renderNoAccountWarning() {
  const sc = document.getElementById("status-contrato-container");
  const lte = document.getElementById("lista-time-entries");
  if (sc) sc.innerHTML = '<p class="status-contrato-desc" style="color:#b71c1c;">O ticket não possui Conta (Account) vinculada.</p>';
  if (lte) lte.innerHTML = '<p class="status-text">Faturamento por tempo impossibilitado.</p>';
}
