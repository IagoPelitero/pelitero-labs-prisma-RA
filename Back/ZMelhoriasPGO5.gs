/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: ZMelhoriasPGO5.gs
 * Responsabilidade: melhorias operacionais adicionadas sem alterar os dados
 * existentes: Matrícula em Usuários e detalhamento configurável de casos
 * "Em Análise" na Análise de SAC.
 *
 * IMPORTANTE
 * - Este arquivo carrega DEPOIS dos demais .gs (prefixo Z) e amplia o schema
 *   oficial de Usuários para reconhecer a coluna "Matrícula" já existente.
 * - Não cria aba, não move coluna, não apaga dado e não faz deploy.
 * - A planilha externa da Análise de SAC continua somente leitura.
 * ============================================================================
 */

// ============================================================================
// USUÁRIOS — MATRÍCULA
// ============================================================================

/**
 * A coluna já existe fisicamente no fim da aba Usuários. Apenas a incorpora
 * ao contrato oficial para o CRUD deixar de bloquear a escrita por divergência
 * de cabeçalho. Mantemos a posição física para não mover nenhum dado existente.
 */
if (typeof COLUMNS_PGO5 !== 'undefined' && COLUMNS_PGO5.USUARIOS &&
    COLUMNS_PGO5.USUARIOS.indexOf('Matrícula') === -1) {
  COLUMNS_PGO5.USUARIOS.push('Matrícula');
}

/**
 * Matrícula é identificador de texto: preserva zeros à esquerda.
 * @param {*} valor Valor recebido do formulário.
 * @returns {string} Matrícula sanitizada.
 */
function pgo5NormalizarMatricula_(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor).trim();
  if (texto.length > 50) throw new Error('A matrícula deve ter no máximo 50 caracteres.');
  return sanitizeInput(texto);
}

/**
 * Lista usuários com Matrícula. Reutiliza toda a regra de escopo da função
 * oficial e apenas anexa o campo ao resultado já autorizado.
 *
 * @returns {Object} Mesmo retorno de listarUsuariosPGO5, com usuario.matricula.
 */
function listarUsuariosPGO5ComMatricula() {
  const resultado = listarUsuariosPGO5();
  const matriculaPorId = {};

  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(usuario) {
    const id = String(usuario.Id || '').trim().toUpperCase();
    if (!id) return;
    matriculaPorId[id] = String(usuario['Matrícula'] || '').trim();
  });

  (resultado.usuarios || []).forEach(function(usuario) {
    usuario.matricula = matriculaPorId[String(usuario.id || '').trim().toUpperCase()] || '';
  });
  return resultado;
}

/**
 * Cria/edita usuário preservando todas as validações atuais e grava Matrícula
 * no mesmo lock. O CRUD oficial continua sendo a fonte das regras de usuário.
 *
 * @param {Object} dados Dados do usuário + matricula.
 * @param {string} [id] Id do usuário em edição.
 * @returns {Object} { success, id }.
 */
function salvarUsuarioPGO5ComMatricula(dados, id) {
  const entrada = dados || {};
  const matricula = pgo5NormalizarMatricula_(entrada.matricula);

  return withScriptLock_(function() {
    // Primeiro passa pelo fluxo oficial: autenticação, escopo, nível,
    // hierarquia, último ADM e auditoria continuam exatamente iguais.
    const resultado = salvarUsuarioPGO5(entrada, id);

    // Se o CRUD oficial gravou, o cabeçalho já foi validado com Matrícula.
    // Atualizamos somente essa coluna, sem tocar nos demais dados do usuário.
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.USUARIOS, resultado.id, {
      'Matrícula': matricula,
      DataAtualizacao: toIso_(new Date())
    });

    return resultado;
  });
}

// ============================================================================
// ANÁLISE DE SAC — DETALHAMENTO DE "EM ANÁLISE"
// ============================================================================

/**
 * Converte uma célula externa em texto seguro para google.script.run.
 * @param {*} valor Valor vindo do Sheets externo.
 * @returns {string} Texto serializável.
 */
function pgo5ValorExternoComoTexto_(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  }
  return String(valor).trim();
}

/**
 * Colunas disponíveis para o detalhamento. Retorna somente nomes de cabeçalho,
 * nunca linhas da planilha externa.
 *
 * @returns {Object} { habilitado, colunas, colunaData }.
 */
function getColunasDetalhamentoAnaliseSac() {
  requireAuth_();
  exigirAcesso_('analiseSac', requireSupervisor_);

  const cfg = lerIndicOpConfig_();
  if (!cfg.habilitado) return { habilitado: false, colunas: [], colunaData: '' };

  const valores = lerAbaExterna_(cfg.planilhaUrl, cfg.abaOrigem).valores;
  if (!valores.length) return { habilitado: true, colunas: [], colunaData: cfg.colunaData };

  const linhaCab = Math.min(cfg.linhaInicial, valores.length) - 1;
  const vistos = {};
  const colunas = [];
  (valores[linhaCab] || []).forEach(function(valor) {
    const nome = String(valor === null || valor === undefined ? '' : valor).trim();
    if (!nome) return;
    const chave = normalizeText_(nome);
    if (vistos[chave]) return;
    vistos[chave] = true;
    colunas.push(nome);
  });

  return { habilitado: true, colunas: colunas, colunaData: cfg.colunaData };
}

/**
 * Retorna somente os casos classificados como "Em Análise" dentro do período,
 * trazendo EXATAMENTE as duas colunas escolhidas na interface.
 *
 * A classificação reutiliza mapaStatusOp_/classificarStatusOp_: não existe
 * uma segunda regra de status. A planilha externa permanece somente leitura.
 *
 * @param {Object} opcoes { inicio, fim, coluna1, coluna2 }.
 * @returns {Object} Resultado paginável/limitado para a tela.
 */
function getDetalhamentoEmAnaliseSac(opcoes) {
  requireAuth_();
  exigirAcesso_('analiseSac', requireSupervisor_);

  const cfg = lerIndicOpConfig_();
  if (!cfg.habilitado) {
    return { habilitado: false, total: 0, linhas: [], coluna1: '', coluna2: '', limitado: false };
  }

  const entrada = opcoes || {};
  const coluna1 = sanitizeInput(entrada.coluna1);
  const coluna2 = sanitizeInput(entrada.coluna2);
  if (!coluna1 || !coluna2) throw new Error('Escolha as duas colunas do detalhamento.');
  if (normalizeText_(coluna1) === normalizeText_(coluna2)) {
    throw new Error('Escolha duas colunas diferentes.');
  }

  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(entrada.inicio || ''))
    ? String(entrada.inicio) : '';
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(String(entrada.fim || ''))
    ? String(entrada.fim) : '';
  if (inicio && fim && inicio > fim) throw new Error('O período informado é inválido.');

  const valores = lerAbaExterna_(cfg.planilhaUrl, cfg.abaOrigem).valores;
  if (!valores.length) {
    return { habilitado: true, total: 0, linhas: [], coluna1: coluna1, coluna2: coluna2, limitado: false };
  }

  const linhaCab = Math.min(cfg.linhaInicial, valores.length) - 1;
  const cabecalho = valores[linhaCab] || [];
  const idxData = indiceColunaOp_(cabecalho, cfg.colunaData);
  const idxStatus = indiceColunaOp_(cabecalho, cfg.colunaStatus);
  const idx1 = indiceColunaOp_(cabecalho, coluna1);
  const idx2 = indiceColunaOp_(cabecalho, coluna2);

  if (idxData === -1 || idxStatus === -1) {
    throw new Error('A fonte da Análise de SAC não possui mais as colunas de Data e/ou Status configuradas.');
  }
  if (idx1 === -1 || idx2 === -1) {
    throw new Error('Uma das colunas escolhidas não existe mais na planilha de origem.');
  }

  const mapa = mapaStatusOp_(cfg);
  const linhas = [];
  const LIMITE = 1000;
  let total = 0;
  let ultimaData = null;

  for (let i = linhaCab + 1; i < valores.length; i++) {
    const linha = valores[i];
    if (linhaVaziaOp_(linha)) continue;

    const dataNova = normalizarDataOp_(linha[idxData]);
    if (dataNova) ultimaData = dataNova;
    const data = ultimaData;
    if (!data) continue;

    if (inicio && data.chave < inicio) continue;
    if (fim && data.chave > fim) continue;

    const statusTxt = String(linha[idxStatus] === undefined || linha[idxStatus] === null
      ? '' : linha[idxStatus]).trim();
    if (!statusTxt || classificarStatusOp_(statusTxt, mapa) !== 'emAnalise') continue;

    total++;
    if (linhas.length >= LIMITE) continue;

    const valorDaColuna = function(idx, nome) {
      // Se a coluna escolhida for a mesma Data usada pelo módulo, respeita o
      // forward-fill das células mescladas e devolve a data normalizada.
      if (normalizeText_(nome) === normalizeText_(cfg.colunaData)) return data.label;
      return pgo5ValorExternoComoTexto_(linha[idx]);
    };

    linhas.push({
      coluna1: valorDaColuna(idx1, coluna1),
      coluna2: valorDaColuna(idx2, coluna2)
    });
  }

  return {
    habilitado: true,
    total: total,
    linhas: linhas,
    coluna1: coluna1,
    coluna2: coluna2,
    limitado: total > LIMITE,
    limite: LIMITE,
    periodo: { inicio: inicio, fim: fim }
  };
}

/**
 * Diagnóstico somente leitura das duas melhorias.
 * @returns {string} Relatório simples para o log do Apps Script.
 */
function verificarMelhoriasPGO5() {
  const linhas = ['PGO 5.0 — MELHORIAS MATRÍCULA + ANÁLISE SAC'];
  const colunasUsuarios = pgo5Colunas_(PGO5.SHEET_NAMES.USUARIOS);
  const temMatricula = colunasUsuarios.indexOf('Matrícula') !== -1;
  linhas.push((temMatricula ? '✅' : '❌') + ' schema de Usuários reconhece Matrícula');

  let cabecalhoOk = false;
  try {
    const aba = getSpreadsheet().getSheetByName(PGO5.SHEET_NAMES.USUARIOS);
    cabecalhoOk = !!aba && pgo5ValidarCabecalho_(aba, colunasUsuarios).valido;
  } catch (e) { cabecalhoOk = false; }
  linhas.push((cabecalhoOk ? '✅' : '❌') + ' cabeçalho real de Usuários compatível');

  linhas.push((typeof listarUsuariosPGO5ComMatricula === 'function' ? '✅' : '❌') +
    ' leitura de Matrícula disponível');
  linhas.push((typeof salvarUsuarioPGO5ComMatricula === 'function' ? '✅' : '❌') +
    ' gravação de Matrícula disponível');
  linhas.push((typeof getColunasDetalhamentoAnaliseSac === 'function' ? '✅' : '❌') +
    ' seletor de duas colunas disponível');
  linhas.push((typeof getDetalhamentoEmAnaliseSac === 'function' ? '✅' : '❌') +
    ' detalhamento Em Análise disponível');

  const relatorio = linhas.join('\n');
  Logger.log(relatorio);
  return relatorio;
}
