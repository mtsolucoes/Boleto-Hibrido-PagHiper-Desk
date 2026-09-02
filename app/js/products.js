/**
 * =====================================================================
 * TAREFA B - Lógica do Frontend (Modelo B)
 * Local: app/js/products.js
 * =====================================================================
 */

const VALOR_MINIMO_BOLETO = 3.00;
let PRODUTOS_CACHE = [];

function recalcularValorEEstado() {
  if (typeof recalcularValorEEstadoProdutos === "function") {
    recalcularValorEEstadoProdutos();
  }
}

async function inicializarTelaProdutos() {
  try {
    CONFIG_EXTENSAO = await inicializarModuloConfiguracao(); // vem do extension.js

    const produtos = await buscarProdutosDesk();
    PRODUTOS_CACHE = produtos;

    let produtoAutoSelecionadoId = null;
    if (CONFIG_EXTENSAO?.modeloBAutoSelecionar === true ||
        CONFIG_EXTENSAO?.modeloBAutoSelecionar === "true") {
      produtoAutoSelecionadoId = await buscarProdutoVinculadoAoTicket();
    }

    renderizarListaProdutos(produtos, produtoAutoSelecionadoId);
    configurarListenersFormulario();
    recalcularValorEEstado();

  } catch (erro) {
    console.error("[PagHiper] Erro ao inicializar tela de produtos:", erro);
    exibirStatus("erro", "Não foi possível carregar os produtos. Tente recarregar o ticket.");
  }
}

/**
 * GET /api/v1/products?limit=100
 */
async function buscarProdutosDesk() {
  try {
    const resposta = await ZOHODESK.request({
      url: "https://desk.zoho.com/api/v1/products?limit=100",
      type: "GET"
    });
    const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
    return dados?.data || [];
  } catch (erro) {
    console.error("[PagHiper] Falha ao buscar produtos:", erro);
    throw erro;
  }
}

/**
 * GET /api/v1/tickets/{ticketId}?include=products
 * Usado apenas quando modeloBAutoSelecionar === true
 */
async function buscarProdutoVinculadoAoTicket() {
  try {
    const ticketId = await ZOHODESK.get("ticket.id");
    const resposta = await ZOHODESK.request({
      url: `https://desk.zoho.com/api/v1/tickets/${ticketId}?include=products`,
      type: "GET"
    });
    const dados = typeof resposta === "string" ? JSON.parse(resposta) : resposta;
    // A API retorna produtos vinculados em um array; pegamos o primeiro.
    return dados?.products?.[0]?.id || null;
  } catch (erro) {
    console.warn("[PagHiper] Não foi possível buscar produto vinculado ao ticket:", erro);
    return null; // falha aqui não deve travar a tela, só cai para seleção manual
  }
}

function renderizarListaProdutos(produtos, produtoAutoSelecionadoId) {
  const container = document.getElementById("lista-produtos");
  container.innerHTML = "";

  if (!produtos.length) {
    container.innerHTML = '<p class="carregando">Nenhum produto cadastrado no catálogo do Desk.</p>';
    return;
  }

  produtos.forEach(produto => {
    const item = document.createElement("div");
    item.className = "item-produto";

    const marcado = produto.id === produtoAutoSelecionadoId ? "checked" : "";
    const preco = Number(produto.unitPrice || 0).toFixed(2).replace(".", ",");

    item.innerHTML = `
      <label>
        <input type="checkbox" class="checkbox-produto"
               data-id="${produto.id}"
               data-preco="${produto.unitPrice || 0}"
               data-nome="${produto.productName || produto.name || ""}"
               ${marcado} />
        ${produto.productName || produto.name}
      </label>
      <span class="preco-produto">R$ ${preco}</span>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll(".checkbox-produto").forEach(cb => {
    cb.addEventListener("change", recalcularValorEEstado);
  });
}

function configurarListenersFormulario() {
  const cpfCnpjInput = document.getElementById("input-cpf-cnpj");
  const gerarBoletoButton = document.getElementById("btn-gerar-boleto");

  cpfCnpjInput.removeEventListener("input", recalcularValorEEstado);
  cpfCnpjInput.addEventListener("input", recalcularValorEEstado);

  gerarBoletoButton.removeEventListener("click", tratarCliqueGerarBoleto);
  gerarBoletoButton.addEventListener("click", tratarCliqueGerarBoleto);
}

/**
 * Recalcula valor total, valida CPF/CNPJ e valor mínimo,
 * e habilita/desabilita o botão de emissão de acordo.
 */
function recalcularValorEEstadoProdutos() {
  const checkboxesMarcados = document.querySelectorAll(".checkbox-produto:checked");
  let total = 0;
  checkboxesMarcados.forEach(cb => total += parseFloat(cb.dataset.preco || 0));
  if (typeof obterTimeEntriesSelecionados === "function") {
    total += obterTimeEntriesSelecionados().reduce((sum, entry) => sum + entry.cost, 0);
  }

  document.getElementById("valor-total-selecionado").textContent =
    `R$ ${total.toFixed(2).replace(".", ",")}`;

  const alertaValorMinimo = document.getElementById("alerta-valor-minimo");
  const abaixoDoMinimo = total < VALOR_MINIMO_BOLETO;
  alertaValorMinimo.style.display = (total > 0 && abaixoDoMinimo) ? "block" : "none";

  const cpfCnpjValido = validarCpfCnpj(document.getElementById("input-cpf-cnpj").value);
  atualizarFeedbackCpfCnpj(cpfCnpjValido);

  const btn = document.getElementById("btn-gerar-boleto");
  const hasTimeEntries = typeof selectedTimeEntryIds !== "undefined" && selectedTimeEntryIds.size > 0;
  btn.disabled = abaixoDoMinimo || !cpfCnpjValido ||
    (checkboxesMarcados.length === 0 && !hasTimeEntries);
}

function atualizarFeedbackCpfCnpj(valido) {
  const input = document.getElementById("input-cpf-cnpj");
  const erroSpan = document.getElementById("erro-cpf-cnpj");
  const valor = input.value.replace(/\D/g, "");

  if (valor.length === 0) {
    input.classList.remove("campo-invalido");
    erroSpan.style.display = "none";
    return;
  }

  if (!valido) {
    input.classList.add("campo-invalido");
    erroSpan.textContent = "CPF/CNPJ inválido.";
    erroSpan.style.display = "block";
  } else {
    input.classList.remove("campo-invalido");
    erroSpan.style.display = "none";
  }
}

/**
 * Validação lógica de CPF e CNPJ (formato + dígitos verificadores).
 * Não consulta nenhuma API externa — só valida localmente.
 */
function validarCpfCnpj(valorBruto) {
  const valor = (valorBruto || "").replace(/\D/g, "");
  if (valor.length === 11) return validarCPF(valor);
  if (valor.length === 14) return validarCNPJ(valor);
  return false;
}

function validarCPF(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos dígitos iguais

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf[10]);
}

function validarCNPJ(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calcularDigito = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const digito1 = calcularDigito(cnpj, pesos1);
  if (digito1 !== parseInt(cnpj[12])) return false;

  const digito2 = calcularDigito(cnpj, pesos2);
  return digito2 === parseInt(cnpj[13]);
}

function exibirStatus(tipo, mensagem) {
  const el = document.getElementById("status-emissao");
  el.className = `status-emissao ${tipo}`;
  el.textContent = mensagem;
  el.style.display = "block";
}
