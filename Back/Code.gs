/**
 * ============================================================================
 * Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Code.gs
 * Descrição: Ponto de entrada do aplicativo Google Apps Script.
 *
 * Desenvolvido por Pelitero Labs.
 *            - doGet(): Serve o frontend como Web App
 *            - include(): Inclui arquivos HTML parciais
 *            - getCurrentUser(): Retorna informações do usuário logado
 *            - onOpen(): Adiciona menu customizado na planilha
 *            - abrirSistema(): Abre o sistema como diálogo modal
 * ============================================================================
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO (leia antes de mexer neste arquivo)
 * ------------------------------------------------------------------------
 * Pense neste arquivo como a "porta de entrada" do sistema: é o primeiro
 * código que roda quando alguém abre o link do aplicativo (Web App) ou usa
 * o menu dentro da planilha do Google Sheets.
 *
 * Fluxo básico, em palavras simples:
 *   1) O usuário abre a URL do app (ou clica em "Abrir Sistema" no menu).
 *   2) O Google chama automaticamente a função doGet().
 *   3) doGet() garante que a planilha (nosso "banco de dados") já está
 *      pronta e manda montar a página inicial (o arquivo Index.html).
 *   4) O Index.html usa a função include() (definida logo abaixo) para
 *      "colar" os outros arquivos .html dentro dele, como se fossem
 *      pedaços de um quebra-cabeça.
 *
 * O que normalmente precisa mexer aqui:
 *   - Trocar o título que aparece na aba do navegador ou no diálogo modal.
 *   - Adicionar um novo item no menu que aparece dentro da planilha
 *     (função onOpen).
 *   - Criar uma nova opção de manutenção no menu, parecida com
 *     menuReinicializar() ou menuLimparCache().
 *
 * O que evitar mexer sem necessidade (risco de quebrar o app inteiro):
 *   - A lógica de doGet() e include() é praticamente padrão do Google
 *     Apps Script e raramente precisa mudar.
 *   - Se algo der errado aqui, o sistema inteiro pode parar de abrir —
 *     teste sempre em uma cópia/planilha de testes antes de publicar.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// PONTO DE ENTRADA WEB APP
// ============================================================================

/**
 * Função principal do Web App.
 * Chamada automaticamente quando o usuário acessa a URL do Web App.
 * Inicializa as planilhas se necessário e serve o frontend.
 * @param {Object} e - Parâmetros de evento do doGet
 * @returns {HtmlOutput} Página HTML do sistema
 */
function doGet(e) {
  try {
    // Inicializa planilhas se necessário (primeira execução)
    ensureDatabaseReady();
    
    // Cria e retorna a página HTML
    const template = HtmlService.createTemplateFromFile('Index');
    const output = template.evaluate();
    
    output.setTitle('Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos');
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    output.addMetaTag('viewport', 'width=device-width, initial-scale=1');

    return output;
  } catch (e) {
    Logger.log('Erro no doGet: ' + e.message);
    return HtmlService.createHtmlOutput(
      '<h1>Erro ao carregar o sistema</h1>' +
      '<p>Ocorreu um erro ao inicializar o Prisma RA. ' +
      'Tente novamente em alguns instantes ou procure o suporte responsável.</p>'
    );
  }
}

// ============================================================================
// INCLUSÃO DE ARQUIVOS HTML
// ============================================================================

/**
 * Inclui o conteúdo de um arquivo HTML no template.
 * Utilizado nos templates com <?!= include('NomeDoArquivo') ?>.
 * Permite modularizar o frontend em múltiplos arquivos.
 * @param {string} filename - Nome do arquivo HTML (sem extensão)
 * @returns {string} Conteúdo HTML do arquivo
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    Logger.log('Erro ao incluir arquivo ' + filename + ': ' + e.message);
    return '<!-- Erro ao incluir: ' + filename + ' -->';
  }
}

// ============================================================================
// INFORMAÇÕES DO USUÁRIO
// ============================================================================

/**
 * Retorna informações do usuário atualmente autenticado (nome, perfil,
 * equipe), resolvidas pelo e-mail da conta Google via getActor_.
 * Usada por diagnósticos (testSystem) e disponível ao frontend.
 * Erros de autorização ('AUTH: ...') são propagados — não há retorno de
 * identidade genérica para quem não está cadastrado (sem acesso parcial).
 * @returns {Object} { id, email, nome, perfil, equipe }
 * @throws {Error} 'AUTH: ...' quando o e-mail não está autorizado.
 */
function getCurrentUser() {
  ensureDatabaseReady();
  return getActor_();
}

// ============================================================================
// MENU DA PLANILHA
// ============================================================================

/**
 * Trigger onOpen - executada automaticamente ao abrir a planilha.
 * Adiciona um menu customizado "Prisma RA" com opção de abrir o sistema.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Prisma RA')
      .addItem('🚀 Abrir Sistema', 'abrirSistema')
      .addSeparator()
      .addItem('🔄 Reinicializar Planilhas', 'menuReinicializar')
      .addItem('🗑️ Limpar Cache', 'menuLimparCache')
      .addToUi();
  } catch (e) {
    Logger.log('Erro ao criar menu: ' + e.message);
  }
}

/**
 * Abre o sistema Prisma RA como diálogo modal dentro da planilha.
 * Alternativa ao acesso via URL do Web App.
 */
function abrirSistema() {
  try {
    // Inicializa planilhas se necessário
    ensureDatabaseReady();

    const template = HtmlService.createTemplateFromFile('Index');
    const html = template.evaluate()
      .setTitle('Prisma RA')
      .setWidth(1400)
      .setHeight(900);

    SpreadsheetApp.getUi().showModalDialog(html, 'Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos');
  } catch (e) {
    Logger.log('Erro ao abrir sistema: ' + e.message);
    SpreadsheetApp.getUi().alert('Erro ao abrir o sistema: ' + e.message);
  }
}

// ============================================================================
// FUNÇÕES DO MENU
// ============================================================================

/**
 * Reinicializa as planilhas (chamada pelo menu).
 * Cria abas faltantes e insere dados padrão.
 */
function menuReinicializar() {
  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert(
      'Reinicializar Planilhas',
      'Esta ação irá criar abas faltantes e inserir dados padrão. ' +
      'Dados existentes NÃO serão apagados.\n\nDeseja continuar?',
      ui.ButtonSet.YES_NO
    );
    
    if (response === ui.Button.YES) {
      initializeSheets();
      invalidateAllCache();
      ui.alert('Sucesso', 'Planilhas reinicializadas com sucesso!', ui.ButtonSet.OK);
    }
  } catch (e) {
    Logger.log('Erro ao reinicializar: ' + e.message);
    SpreadsheetApp.getUi().alert('Erro: ' + e.message);
  }
}

/**
 * Limpa todo o cache do sistema (chamada pelo menu).
 */
function menuLimparCache() {
  try {
    invalidateAllCache();
    SpreadsheetApp.getUi().alert('Sucesso', 'Cache limpo com sucesso!', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log('Erro ao limpar cache: ' + e.message);
    SpreadsheetApp.getUi().alert('Erro: ' + e.message);
  }
}

// ============================================================================
// FUNÇÕES DE SETUP / UTILIDADE
// ============================================================================

/**
 * Função de setup inicial. Pode ser executada manualmente no editor do Apps Script.
 * Cria todas as planilhas, cabeçalhos e dados padrão.
 */
function setup() {
  try {
    Logger.log('=== SETUP INICIAL DO PRISMA RA ===');
    initializeSheets();
    Logger.log('Setup concluído com sucesso!');
    Logger.log('Para acessar como Web App, publique o projeto:');
    Logger.log('  Publicar > Implantar como aplicativo da web');
  } catch (e) {
    Logger.log('Erro no setup: ' + e.message);
    throw e;
  }
}

/**
 * Vincula explicitamente uma planilha existente ao sistema.
 * Execute uma vez no editor caso não queira que o setup crie a base.
 * @param {string} spreadsheetId ID encontrado na URL do Google Sheets.
 */
function configurarPlanilha(spreadsheetId) {
  const id = sanitizeInput(spreadsheetId);
  if (!id) throw new Error('Informe o ID da planilha.');
  const spreadsheet = SpreadsheetApp.openById(id);
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(PROPERTY_KEYS.SPREADSHEET_ID, spreadsheet.getId());
  properties.deleteProperty(PROPERTY_KEYS.SCHEMA_VERSION);
  initializeSheets();
  return 'Planilha configurada: ' + spreadsheet.getName();
}

/**
 * Função de teste para verificar se o sistema está funcionando.
 * Pode ser executada manualmente para diagnóstico.
 */
function testSystem() {
  try {
    Logger.log('=== TESTE DO SISTEMA PRISMA RA ===');
    
    // Testa acesso à planilha
    const ss = getSpreadsheet();
    Logger.log('✓ Planilha acessível: ' + ss.getName());
    
    // Testa planilhas existentes
    const sheetNames = Object.values(CONFIG.SHEET_NAMES);
    sheetNames.forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (sheet) {
        Logger.log('✓ Aba encontrada: ' + name + ' (' + sheet.getLastRow() + ' linhas)');
      } else {
        Logger.log('✗ Aba NÃO encontrada: ' + name);
      }
    });
    
    // Testa leitura de dados
    const produtos = getAll(CONFIG.SHEET_NAMES.PRODUTOS);
    Logger.log('✓ Produtos carregados: ' + produtos.length);

    const categorias = getAll(CONFIG.SHEET_NAMES.CATEGORIAS);
    Logger.log('✓ Categorias carregadas: ' + categorias.length);

    // Testa usuário atual.
    // LGPD: não registra nome nem e-mail — apenas confirma que a
    // identificação funcionou e qual perfil foi resolvido.
    const user = getCurrentUser();
    Logger.log('✓ Usuário identificado (perfil): ' + (user && user.perfil ? user.perfil : 'não resolvido'));
    
    Logger.log('=== TESTE CONCLUÍDO ===');
  } catch (e) {
    Logger.log('✗ ERRO NO TESTE: ' + e.message);
  }
}

// ============================================================================
// DIAGNÓSTICO TÉCNICO (LGPD-SAFE)
// ============================================================================
/*
 * PARA QUE SERVE
 * --------------
 * Permite investigar a saúde do Prisma no ambiente REAL sem que nenhum
 * dado pessoal saia da planilha. Foi feita para ser executada diretamente
 * no editor do Apps Script (Executar > diagnosticarPrisma) e o resultado
 * pode ser copiado do log e enviado para análise com segurança.
 *
 * 🔒 REGRA ABSOLUTA — NADA DE DADO PESSOAL
 * A saída contém SOMENTE informação técnica e agregada: nomes de abas,
 * nomes de COLUNAS (rótulos do sistema), CONTAGENS, PASS/FAIL e tempos.
 * Nunca CPF, nome de cliente, nome de usuário, e-mail, protocolo,
 * observações, CamposExtras ou qualquer conteúdo de atendimento.
 *
 * 🟢 SEGURO: executar quantas vezes quiser — a função só LÊ.
 * ⚠️ Ela NÃO corrige nada. Apenas informa o que encontrou.
 */

/**
 * Executa o diagnóstico técnico completo do Prisma.
 *
 * 🔒 RESTRITO AO ADMINISTRADOR. Embora o relatório não contenha dado
 * pessoal, ele revela a estrutura interna do sistema (abas, colunas,
 * contagens) — informação de infraestrutura que não deve ficar acessível
 * a Analistas ou Supervisores, nem pelo console do navegador.
 * @returns {string} Relatório em texto (também gravado no Logger).
 * @throws {Error} Quando quem executa não é ADM (ou não está autorizado).
 */
function diagnosticarPrisma() {
  requireAdmin_(); // valida no SERVIDOR: só o ADM executa
  return executarDiagnostico_();
}

/**
 * Implementação do diagnóstico (privada — a checagem de perfil é feita
 * pela função pública diagnosticarPrisma).
 * @returns {string} Relatório em texto.
 */
function executarDiagnostico_() {
  const L = [];
  const add = function(linha) { L.push(linha); };
  const ms = function(inicio) { return (new Date().getTime() - inicio); };
  const fmt = function(v) { return (v / 1000).toFixed(1) + ' s (' + v + ' ms)'; };
  let problemas = 0;
  let alertas = 0;

  add('PRISMA — DIAGNÓSTICO TÉCNICO');
  add('Gerado em: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  add('(relatório sem dados pessoais — pode ser compartilhado)');
  add('');

  // ── BANCO ────────────────────────────────────────────────────────────
  add('BANCO');
  let ss = null;
  const tSheets = new Date().getTime();
  try {
    ss = getSpreadsheet();
    // Propositalmente NÃO exibimos nome, Id ou URL da planilha.
    add('✅ Planilha acessível');
  } catch (e) {
    add('❌ Planilha INACESSÍVEL: ' + e.message);
    add('');
    add('RESULTADO GERAL: ❌ REPROVADO (sem acesso ao banco)');
    const textoErro = L.join('\n');
    Logger.log(textoErro);
    return textoErro;
  }
  const tempoLeituraSheets = ms(tSheets);

  const versaoGravada = PropertiesService.getScriptProperties()
    .getProperty(PROPERTY_KEYS.SCHEMA_VERSION);
  if (versaoGravada === CONFIG.SCHEMA_VERSION) {
    add('✅ Schema ' + CONFIG.SCHEMA_VERSION);
  } else {
    add('⚠️ Schema divergente — código: ' + CONFIG.SCHEMA_VERSION +
      ' | planilha: ' + (versaoGravada || 'não registrado'));
    alertas++;
  }

  const abasEsperadas = Object.values(CONFIG.SHEET_NAMES);
  const ausentes = abasEsperadas.filter(function(n) { return !ss.getSheetByName(n); });
  add('Abas esperadas: ' + abasEsperadas.length + ' | encontradas: ' +
    (abasEsperadas.length - ausentes.length));
  if (ausentes.length > 0) {
    add('❌ Abas AUSENTES: ' + ausentes.join(', '));
    problemas++;
  }
  add('');

  // ── ESTRUTURA (por aba) ──────────────────────────────────────────────
  add('ESTRUTURA');
  abasEsperadas.forEach(function(nome) {
    const sheet = ss.getSheetByName(nome);
    if (!sheet) { add('❌ ' + nome + ' — aba não encontrada'); return; }

    const colunas = getColumnsForSheet(nome);
    if (!colunas || colunas.length === 0) {
      add('⚠️ ' + nome + ' — sem esquema mapeado no código');
      alertas++;
      return;
    }

    const lastCol = sheet.getLastColumn();
    const cabecalho = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v).trim(); })
      : [];

    const faltando = colunas.filter(function(c) { return cabecalho.indexOf(c) === -1; });
    const extras = cabecalho.filter(function(h) { return h !== '' && colunas.indexOf(h) === -1; });
    const duplicadas = colunas.filter(function(c) {
      return cabecalho.filter(function(h) { return h === c; }).length > 1;
    });
    const ordemOk = colunas.every(function(c, i) { return cabecalho[i] === c; });

    const detalhes = [];
    if (faltando.length) detalhes.push('ausentes: ' + faltando.join(', '));
    if (extras.length) detalhes.push('extras: ' + extras.join(', '));
    if (duplicadas.length) detalhes.push('DUPLICADAS: ' + duplicadas.join(', '));
    if (!ordemOk && !faltando.length && !duplicadas.length) detalhes.push('fora de ordem');

    if (detalhes.length === 0) {
      add('✅ ' + nome + ' (' + colunas.length + ' colunas)');
    } else if (duplicadas.length > 0 || (faltando.length > 0 && sheet.getLastRow() > 1)) {
      add('❌ ' + nome + ' — ' + detalhes.join(' | '));
      problemas++;
    } else {
      add('⚠️ ' + nome + ' — ' + detalhes.join(' | '));
      alertas++;
    }
  });
  add('');

  // ── INTEGRIDADE (somente contagens) ──────────────────────────────────
  add('INTEGRIDADE');
  let totalRegistros = 0;
  let idsAusentes = 0;
  let idsDuplicados = 0;
  let linhasInvalidas = 0;
  let semSubcategoria = 0;

  abasEsperadas.forEach(function(nome) {
    const sheet = ss.getSheetByName(nome);
    if (!sheet) return;
    const colunas = getColumnsForSheet(nome);
    if (!colunas || colunas.length === 0) return;

    let registros = [];
    try {
      registros = getAll(nome);
    } catch (e) {
      add('❌ ' + nome + ' — falha ao ler: ' + e.message);
      problemas++;
      return;
    }

    totalRegistros += registros.length;
    add('• ' + nome + ': ' + registros.length + ' registro(s)');

    // A aba IndicadoresSLA não usa Id por definição — não é irregularidade.
    const usaId = colunas.indexOf('Id') !== -1;
    if (usaId) {
      const vistos = {};
      registros.forEach(function(r) {
        const id = String(r.Id === undefined || r.Id === null ? '' : r.Id).trim();
        if (!id) { idsAusentes++; return; }
        if (vistos[id]) idsDuplicados++; else vistos[id] = true;
      });
    }

    // Linha estruturalmente inválida: sem NENHUM valor nas colunas do
    // esquema (resquício de edição manual).
    registros.forEach(function(r) {
      const temAlgo = colunas.some(function(c) {
        const v = r[c];
        return v !== '' && v !== null && v !== undefined;
      });
      if (!temAlgo) linhasInvalidas++;
    });
  });

  // Subcategoria vazia é INFORMATIVA: registros anteriores à v4.6 não têm.
  try {
    getAtendimentoSheetNames_().forEach(function(nome) {
      if (!ss.getSheetByName(nome)) return;
      getAll(nome).forEach(function(r) {
        if (isTrue_(r.Excluido)) return;
        const v = String(r.Subcategoria === undefined || r.Subcategoria === null ? '' : r.Subcategoria).trim();
        if (!v) semSubcategoria++;
      });
    });
  } catch (e) {
    add('⚠️ Não foi possível contar Subcategoria: ' + e.message);
    alertas++;
  }

  add('Total de registros: ' + totalRegistros);
  add('IDs ausentes: ' + idsAusentes + (idsAusentes > 0 ? ' ⚠️' : ''));
  add('IDs duplicados: ' + idsDuplicados + (idsDuplicados > 0 ? ' ❌' : ''));
  add('Linhas estruturalmente inválidas: ' + linhasInvalidas + (linhasInvalidas > 0 ? ' ⚠️' : ''));
  add('Atendimentos sem Subcategoria: ' + semSubcategoria + '  (informativo — registros antigos)');
  if (idsDuplicados > 0) problemas++;
  if (idsAusentes > 0 || linhasInvalidas > 0) alertas++;
  add('');

  // ── SERVIÇOS (PASS/FAIL — nenhum dado é devolvido) ───────────────────
  add('SERVIÇOS');
  const tempos = { sheets: tempoLeituraSheets };

  // Cache: gravação/leitura/remoção de uma chave descartável.
  try {
    const c = CacheService.getScriptCache();
    const chave = 'PRISMA_DIAG_' + new Date().getTime();
    c.put(chave, 'ok', 30);
    const lido = c.get(chave);
    c.remove(chave);
    if (lido === 'ok') add('✅ Cache'); else { add('❌ Cache — não retornou o valor gravado'); problemas++; }
  } catch (e) { add('❌ Cache — ' + e.message); problemas++; }

  // Lock: aquisição e liberação.
  try {
    const lk = LockService.getScriptLock();
    lk.waitLock(5000);
    lk.releaseLock();
    add('✅ Lock');
  } catch (e) { add('❌ Lock — ' + e.message); problemas++; }

  // Autenticação: apenas confirma que o e-mail foi resolvido e casa com um
  // cadastro ativo. NÃO exibe o e-mail nem o nome.
  try {
    requireAuth_();
    add('✅ Autenticação (usuário reconhecido)');
  } catch (e) {
    const tipo = /^AUTH:/.test(e.message) ? 'e-mail não cadastrado/inativo' : 'falha técnica';
    add('❌ Autenticação — ' + tipo);
    problemas++;
  }

  // Dashboard: mede o tempo e confere só o FORMATO da resposta.
  try {
    const t = new Date().getTime();
    const d = getDashboardData();
    tempos.dashboard = ms(t);
    if (d && d.atendimentos && d.atendimentos.length !== undefined) {
      add('✅ Dashboard' + (d.parcial ? ' (⚠️ leitura PARCIAL — abas indisponíveis: ' +
        (d.abasIndisponiveis || []).join(', ') + ')' : ''));
      if (d.parcial) alertas++;
    } else { add('❌ Dashboard — resposta em formato inesperado'); problemas++; }
  } catch (e) { add('❌ Dashboard — ' + e.message); problemas++; }

  // Indicadores: usa a mesma consulta dos Relatórios.
  try {
    const t = new Date().getTime();
    const r = getRelatorio({});
    tempos.indicadores = ms(t);
    if (r && r.length !== undefined) add('✅ Indicadores');
    else { add('❌ Indicadores — resposta em formato inesperado'); problemas++; }
  } catch (e) { add('❌ Indicadores — ' + e.message); problemas++; }

  // Configurações (exige Supervisor/ADM).
  try {
    const t = new Date().getTime();
    const cfg = getConfiguracoes();
    tempos.configuracoes = ms(t);
    if (cfg && cfg.entities) add('✅ Configurações');
    else { add('❌ Configurações — resposta em formato inesperado'); problemas++; }
  } catch (e) {
    add('⚠️ Configurações — ' + e.message + ' (esperado se quem executa não é Supervisor/ADM)');
    alertas++;
  }

  // Indicadores Operacionais: só reporta se está configurado.
  try {
    const cfgOp = lerIndicOpConfig_();
    add(cfgOp.habilitado ? '✅ Indicadores Operacionais (fonte configurada)'
                         : 'ℹ️ Indicadores Operacionais — fonte externa ainda não configurada');
  } catch (e) { add('⚠️ Indicadores Operacionais — ' + e.message); alertas++; }
  add('');

  // ── PERFORMANCE ──────────────────────────────────────────────────────
  add('PERFORMANCE');
  add('Leitura Sheets: ' + fmt(tempos.sheets));
  if (tempos.dashboard !== undefined) add('Dashboard: ' + fmt(tempos.dashboard));
  if (tempos.indicadores !== undefined) add('Indicadores: ' + fmt(tempos.indicadores));
  if (tempos.configuracoes !== undefined) add('Configurações: ' + fmt(tempos.configuracoes));
  add('');

  // ── RESULTADO ────────────────────────────────────────────────────────
  if (problemas > 0) {
    add('RESULTADO GERAL: ❌ REPROVADO — ' + problemas + ' problema(s) crítico(s)' +
      (alertas > 0 ? ' e ' + alertas + ' alerta(s)' : ''));
  } else if (alertas > 0) {
    add('RESULTADO GERAL: ⚠️ APROVADO COM ALERTAS — ' + alertas + ' ponto(s) de atenção');
  } else {
    add('RESULTADO GERAL: ✅ APROVADO');
  }

  const texto = L.join('\n');
  Logger.log(texto);
  return texto;
}
