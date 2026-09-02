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
    const ticketId = await ZOHODESK.get("ticket.id");
    const ticketRes = await ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/tickets/${ticketId}?include=contacts`,
      type: "GET",
      headers: { orgId: portalOrgId }
    });
    const ticketData = typeof ticketRes === "string" ? JSON.parse(ticketRes) : ticketRes;
    const accountId = ticketData.accountId;

    // 2. Dispara buscas em paralelo para otimizar tempo de carga (Connections)
    const [contracts, timeEntries] = await Promise.all([
      accountId ? fetchAccountContracts(accountId) : Promise.resolve([]),
      fetchTicketTimeEntries(ticketId)
    ]);

    activeAccountContracts = contracts;
    ticketTimeEntries = filterUnbilledTimeEntries(timeEntries);

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

// GET /api/v1/accounts/{accountId}/contracts (Busca contratos do cliente) [10, 11]
async function fetchAccountContracts(accountId) {
  try {
    const res = await ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/accounts/${accountId}/contracts?contractStatus=ACTIVE`,
      type: "GET",
      headers: { orgId: portalOrgId }
    });
    const parsed = typeof res === "string" ? JSON.parse(res) : res;
    return parsed.data || [];
  } catch (err) {
    console.warn("[PagHiper] Falha ao consultar contratos ativos:", err);
    return [];
  }
}

// GET /api/v1/tickets/{ticketId}/timeEntry?billStatus=billable [12, 13]
async function fetchTicketTimeEntries(ticketId) {
  try {
    const res = await ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/tickets/${ticketId}/timeEntry?billStatus=billable`,
      type: "GET",
      headers: { orgId: portalOrgId }
    });
    const parsed = typeof res === "string" ? JSON.parse(res) : res;
    return parsed.data || [];
  } catch (err) {
    console.error("[PagHiper] Falha ao buscar lançamentos de tempo:", err);
    return [];
  }
}

// Mantém entradas já referenciadas: o agente deve ser avisado, não bloqueado.
function filterUnbilledTimeEntries(entries) {
  return entries;
}

// RENDERIZADOR DE STATUS DE CONTRATO (Trata ausência de contrato) [14]
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
      <p class="status-contrato-title" style="color:#b71c1c;">Sem Contrato Ativo</p>
      <p class="status-contrato-desc">Sem vigência contratual ativa. Todo tempo de atendimento billable será cobrado integralmente [14].</p>
    `;
  }
}

// LISTA DE LANÇAMENTOS DE TEMPO [9]
function renderTimeEntriesList(entries) {
  const container = document.getElementById("lista-time-entries");
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = '<p class="status-text" style="padding:10px;">Nenhum lançamento de tempo pendente de cobrança.</p>';
    return;
  }

  let html = "";
  entries.forEach(entry => {
    // Converte segundosspent para formato HH:MM:SS
    const seconds = parseInt(entry.secondsSpent || 0, 10);
    const timeFormatted = new Date(seconds * 1000).toISOString().substr(11, 8);
    const ownerName = entry.owner?.name || "Agente";
    
    // Custo nativo calculado pelo Desk
    const nativeCost = parseFloat(entry.totalCost || 0);
    const reference = entry.cf?.cf_referencia_cobranca || entry.cf_referencia_cobranca || "";

    html += `
      <div class="hora-item">
        <label class="checkbox-container">
          <input type="checkbox" class="chk-time-entry" value="${entry.id}" data-seconds="${seconds}" data-native-cost="${nativeCost}" onchange="toggleTimeEntrySelection('${entry.id}')">
          <span class="checkmark"></span>
          <div class="hora-info">
            <span class="hora-owner">${ownerName}</span>
            <span class="hora-spent">Tempo: ${timeFormatted}</span>
          </div>
        </label>
        <span class="hora-cost">${nativeCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          ${reference ? `<small class="aviso-referencia">Já cobrado: ${reference}</small>` : ""}
        </span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleTimeEntrySelection(entryId) {
  if (selectedTimeEntryIds.has(entryId)) {
    selectedTimeEntryIds.delete(entryId);
  } else {
    selectedTimeEntryIds.add(entryId);
  }

  function recalcularValorEEstado() {
    if (typeof recalcularValorEEstadoProdutos === "function") {
      recalcularValorEEstadoProdutos();
    }
  }
  recalcularValorEEstado();
}

// PREFERÊNCIA DE TARIFA CUSTOMIZADA [2]
function setupTarifaCustomUI() {
  const customRateContainer = document.getElementById("form-tarifa-custom");
  const inputRate = document.getElementById("input-tarifa-custom");

  // Verifica preferência de cálculo salva no Módulo (Seção 3.1)
  if (CONFIG_EXTENSAO?.modeloCTarifaPropria === true ||
      CONFIG_EXTENSAO?.modeloCTarifaPropria === "true") {
    if (customRateContainer) customRateContainer.style.display = "block";
    if (inputRate) {
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