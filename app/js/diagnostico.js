function parseDiagnosticResponse(response) {
  let parsed = response;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return parsed;
    }
  }
  if (typeof parsed?.response === "string") {
    try {
      parsed.response = JSON.parse(parsed.response);
    } catch (_) {
      // Mantem o texto original quando o proxy nao retorna JSON.
    }
  }
  return parsed;
}

function diagnosticTicketId() {
  return document.getElementById("diagnostico-ticket-id")?.value.trim();
}

function formatDiagnosticError(error) {
  if (!error) return { error: "Erro desconhecido" };
  if (typeof error === "string") return { error };
  return {
    error: error.message || error.errMsg || "Erro retornado pelo SDK",
    code: error.code || error.statusCode || error.status,
    details: error,
    ownProperties: Object.getOwnPropertyNames(error).reduce((values, key) => {
      values[key] = error[key];
      return values;
    }, {})
  };
}

function renderDiagnosticResult(label, url, response, error) {
  const output = document.getElementById("diagnostico-resultado");
  if (!output) return;
  const result = error ? formatDiagnosticError(error) : parseDiagnosticResponse(response);
  output.textContent += `${label}\nGET ${url}\nAutenticacao: ${label === "Ticket via SDK nativo" ? "SDK nativo do Zoho Desk" : "zohodesk_conn"}\n${JSON.stringify(result, null, 2)}\n\n`;
}

async function executarDiagnosticoDesk() {
  const ticketId = diagnosticTicketId();
  const output = document.getElementById("diagnostico-resultado");
  if (!ticketId) {
    if (output) output.textContent = "Informe um ID de ticket.";
    return;
  }

  const button = document.getElementById("btn-executar-diagnostico");
  if (button) button.disabled = true;
  if (output) output.textContent = `Testando ticket ${ticketId}...\n\n`;

  try {
    const nativeTicket = await ZOHODESK.get("ticket");
    renderDiagnosticResult("Ticket via SDK nativo", "ZOHODESK.get(\"ticket\")", nativeTicket);
  } catch (error) {
    renderDiagnosticResult("Ticket via SDK nativo", "ZOHODESK.get(\"ticket\")", null, error);
  }

  const requests = [
    ["Time Entries", `${deskDomainUrl}/api/v1/tickets/${ticketId}/timeEntry?billStatus=billable`]
  ];

  for (const [label, url] of requests) {
    try {
      const request = {
        url,
        type: "GET",
        postBody: {},
        headers: { orgId: portalOrgId },
        connectionLinkName: "zohodesk_conn"
      };
      const response = await ZOHODESK.request(request);
      renderDiagnosticResult(label, url, response);
    } catch (error) {
      renderDiagnosticResult(label, url, null, error);
    }
  }

  if (button) button.disabled = false;
}

function preencherTicketAtualNoDiagnostico() {
  const input = document.getElementById("diagnostico-ticket-id");
  if (input && activeTicketId) input.value = activeTicketId;
}
