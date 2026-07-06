/**
 * ============================================================================
 * PortoBank Reclame Aqui - Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Code.gs
 * Descrição: Ponto de entrada do aplicativo Google Apps Script.
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
    
    output.setTitle('PortoBank Reclame Aqui - Sistema de Gestão de Atendimentos');
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    output.setFaviconUrl('https://www.portoseguro.com.br/favicon.ico');
    
    return output;
  } catch (e) {
    Logger.log('Erro no doGet: ' + e.message);
    return HtmlService.createHtmlOutput(
      '<h1>Erro ao carregar o sistema</h1>' +
      '<p>Ocorreu um erro ao inicializar o PortoBank Reclame Aqui. ' +
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
 * Retorna informações do usuário atualmente logado.
 * Busca na planilha Usuarios para obter nome e perfil.
 * Chamada pelo frontend via google.script.run.getCurrentUser().
 * @returns {Object} { email, nome, perfil }
 */
function getCurrentUser() {
  try {
    ensureDatabaseReady();
    return getActor_();
  } catch (e) {
    Logger.log('Erro ao obter usuário atual: ' + e.message);
    return {
      email: '',
      nome: 'Usuário',
      perfil: 'Analista',
      equipe: '',
      id: ''
    };
  }
}

// ============================================================================
// MENU DA PLANILHA
// ============================================================================

/**
 * Trigger onOpen - executada automaticamente ao abrir a planilha.
 * Adiciona um menu customizado "PortoBank Reclame Aqui" com opção de abrir o sistema.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PortoBank Reclame Aqui')
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
 * Abre o sistema PortoBank Reclame Aqui como diálogo modal dentro da planilha.
 * Alternativa ao acesso via URL do Web App.
 */
function abrirSistema() {
  try {
    // Inicializa planilhas se necessário
    ensureDatabaseReady();
    
    const template = HtmlService.createTemplateFromFile('Index');
    const html = template.evaluate()
      .setTitle('PortoBank Reclame Aqui')
      .setWidth(1400)
      .setHeight(900);
    
    SpreadsheetApp.getUi().showModalDialog(html, 'PortoBank Reclame Aqui - Sistema de Gestão de Atendimentos');
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
    Logger.log('=== SETUP INICIAL DO PORTOBANK RECLAME AQUI ===');
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
  properties.setProperty('PORTO_RA_SPREADSHEET_ID', spreadsheet.getId());
  properties.deleteProperty('PORTO_RA_SCHEMA_VERSION');
  initializeSheets();
  return 'Planilha configurada: ' + spreadsheet.getName();
}

/**
 * Função de teste para verificar se o sistema está funcionando.
 * Pode ser executada manualmente para diagnóstico.
 */
function testSystem() {
  try {
    Logger.log('=== TESTE DO SISTEMA PORTOBANK RECLAME AQUI ===');
    
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
    const status = getAll(CONFIG.SHEET_NAMES.STATUS_CONFIG);
    Logger.log('✓ Status carregados: ' + status.length);
    
    const prioridades = getAll(CONFIG.SHEET_NAMES.PRIORIDADES);
    Logger.log('✓ Prioridades carregadas: ' + prioridades.length);
    
    // Testa usuário atual
    const user = getCurrentUser();
    Logger.log('✓ Usuário atual: ' + JSON.stringify(user));
    
    Logger.log('=== TESTE CONCLUÍDO ===');
  } catch (e) {
    Logger.log('✗ ERRO NO TESTE: ' + e.message);
  }
}
