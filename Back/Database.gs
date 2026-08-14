/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Database.gs
 * Descrição: Camada de acesso a dados (Data Access Layer).
 *
 * Desenvolvido por Pelitero Labs.
 *            Gerencia leitura/escrita na planilha Google Sheets com:
 *            - Cache usando CacheService para performance
 *            - Lock usando LockService para concorrência
 *            - Conversão automática entre objetos e linhas da planilha
 *            - Inicialização automática das planilhas com dados padrão
 * ============================================================================
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO (leia antes de mexer neste arquivo)
 * ------------------------------------------------------------------------
 * Pense neste arquivo como a "ponte" entre o código e a planilha do Google
 * Sheets. Nenhuma outra parte do sistema deveria ler ou escrever direto na
 * planilha — todo mundo passa por aqui (principalmente pelas funções
 * getAll, getById, insert, update e remove).
 *
 * Por que existe cache e lock aqui?
 *   - Cache (CacheService): ler a planilha toda hora é lento, então o
 *     sistema guarda uma cópia temporária dos dados na memória por alguns
 *     minutos (veja CONFIG.CACHE_TTL em Config.gs). Sempre que os dados
 *     mudam, o cache daquela aba é invalidado (apagado) para não mostrar
 *     informação desatualizada — por isso toda função insert/update/remove
 *     chama invalidateCache() no final.
 *   - Lock (LockService): se duas pessoas salvarem um atendimento ao mesmo
 *     tempo, pode dar problema (ex: duplicar o número de RA). O lock
 *     garante que só uma gravação acontece por vez.
 *
 * Tarefas comuns de manutenção:
 *   - Se os dados aparecerem "atrasados" depois de uma mudança, o
 *     problema quase sempre está em algum lugar que esqueceu de chamar
 *     invalidateCache()/invalidateAllCache().
 *   - Para adicionar uma aba nova na planilha, comece por Config.gs
 *     (CONFIG.SHEET_NAMES e COLUMNS) e depois ligue a aba nova aqui,
 *     dentro de initializeSheets().
 *   - Erros de "planilha não encontrada" costumam ser resolvidos com a
 *     função configurarPlanilha() (em Code.gs) ou reexecutando setup().
 * ------------------------------------------------------------------------
 */

// ============================================================================
// ACESSO À PLANILHA
// ============================================================================

// PERFORMANCE/CONFIABILIDADE: referência à planilha memoizada por execução.
// Cada google.script.run é uma nova execução isolada, então esta variável
// vive apenas durante a requisição atual. Sem ela, um único getDashboardData
// abria a planilha (SpreadsheetApp.openById) ~10 vezes — cada abertura é uma
// chamada de rede sujeita a instabilidade transitória (a causa recorrente da
// mensagem "Falha ao carregar. Consultando o Google Sheets diretamente..."):
// reutilizar a mesma referência reduz a latência e a superfície de falha.
var SPREADSHEET_REF_ = null;

/**
 * Obtém a planilha principal do sistema, reaproveitando a referência já
 * aberta na mesma execução (memoização). Se CONFIG.SPREADSHEET_ID estiver
 * vazio, usa o id salvo em Script Properties ou a planilha ativa.
 * @returns {Spreadsheet} Planilha do Google Sheets
 */
function getSpreadsheet() {
  if (SPREADSHEET_REF_) return SPREADSHEET_REF_;
  try {
    if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim() !== '') {
      SPREADSHEET_REF_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      return SPREADSHEET_REF_;
    }

    const properties = PropertiesService.getScriptProperties();
    const storedId = properties.getProperty(PROPERTY_KEYS.SPREADSHEET_ID);
    if (storedId) {
      SPREADSHEET_REF_ = SpreadsheetApp.openById(storedId);
      return SPREADSHEET_REF_;
    }

    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      properties.setProperty(PROPERTY_KEYS.SPREADSHEET_ID, active.getId());
      SPREADSHEET_REF_ = active;
      return SPREADSHEET_REF_;
    }

    // Permite que o projeto também funcione como Apps Script independente.
    const created = SpreadsheetApp.create('Prisma RA - Banco de Dados');
    properties.setProperty(PROPERTY_KEYS.SPREADSHEET_ID, created.getId());
    SPREADSHEET_REF_ = created;
    return SPREADSHEET_REF_;
  } catch (e) {
    Logger.log('Erro ao abrir planilha: ' + e.message);
    throw new Error('Não foi possível acessar a planilha do sistema. Verifique o SPREADSHEET_ID em Config.gs.');
  }
}

// ============================================================================
// CONCORRÊNCIA (trava de escrita reentrante)
// ============================================================================

/*
 * POR QUE ESTE HELPER EXISTE
 * --------------------------
 * Todas as operações que ESCREVEM na planilha precisam da trava do
 * LockService, para que dois usuários não gravem ao mesmo tempo. O
 * problema é que algumas operações chamam outras: por exemplo,
 * ensureDatabaseReady() -> initializeSheets() -> promoteFirstAdmin_() ->
 * update(). Se cada uma tentasse adquirir a trava por conta própria, a
 * segunda tentativa ficaria esperando uma trava que a PRÓPRIA execução já
 * possui — um impasse (deadlock) que só terminaria no timeout.
 *
 * A solução é uma trava REENTRANTE: a primeira chamada adquire de fato a
 * trava e marca uma bandeira; as chamadas aninhadas percebem a bandeira e
 * executam direto, sem readquirir. A bandeira é uma variável global do
 * script — e como cada google.script.run roda em uma execução isolada,
 * ela sempre nasce zerada e não vaza entre requisições.
 */

// true enquanto ESTA execução já detém a trava de escrita.
var LOCK_HELD_ = false;

/**
 * Executa uma função com a trava de escrita do script garantida.
 * Reentrante: chamadas aninhadas reutilizam a trava já adquirida.
 * A trava é SEMPRE liberada no finally, mesmo em caso de erro.
 * @param {Function} fn - Trecho a executar sob trava.
 * @returns {*} O que a função retornar.
 * @throws {Error} Se a trava não for obtida dentro do timeout.
 */
function withScriptLock_(fn) {
  // Já estamos dentro da trava nesta execução: executa direto.
  if (LOCK_HELD_) return fn();

  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  LOCK_HELD_ = true;
  try {
    return fn();
  } finally {
    LOCK_HELD_ = false;
    try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
  }
}

// ============================================================================
// INICIALIZAÇÃO DAS PLANILHAS
// ============================================================================

/**
 * Executa a migração de estrutura somente quando a versão do esquema muda.
 */
function ensureDatabaseReady() {
  const properties = PropertiesService.getScriptProperties();

  // Caminho rápido: esquema já atualizado (99,9% das requisições).
  // Nenhuma trava é adquirida aqui — leitura de propriedade é barata.
  if (properties.getProperty(PROPERTY_KEYS.SCHEMA_VERSION) === CONFIG.SCHEMA_VERSION) return;

  // BANCO PGO 5.0: a estrutura nova é criada por inicializarPGO5(), nunca
  // automaticamente. Sem esta guarda, abrir o sistema sobre uma base 5.0
  // dispararia initializeSheets() e recriaria as 11 abas do modelo 4.x ao
  // lado das 5 novas — exatamente o que a fundação não pode fazer.
  if (estruturaEhPGO5_()) {
    Logger.log('[PGO5] Base 5.0 detectada — inicialização do esquema 4.x ignorada.');
    return;
  }

  // PROTEÇÃO CONTRA MIGRAÇÃO CONCORRENTE:
  // sem trava, dois usuários abrindo o sistema ao mesmo tempo logo após
  // uma atualização executariam initializeSheets() em paralelo sobre as
  // MESMAS abas — o cenário de maior risco de perda de dados. Agora a
  // migração é serializada: o segundo espera o primeiro terminar.
  withScriptLock_(function() {
    // Dupla verificação: enquanto esperávamos a trava, outra execução
    // pode ter concluído a migração. Nesse caso não há nada a fazer.
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROPERTY_KEYS.SCHEMA_VERSION) === CONFIG.SCHEMA_VERSION) return;

    initializeSheets();
    // A versão só é marcada APÓS a migração concluir sem erro. Se
    // initializeSheets lançar, a propriedade permanece antiga e a
    // migração será tentada de novo na próxima requisição.
    props.setProperty(PROPERTY_KEYS.SCHEMA_VERSION, CONFIG.SCHEMA_VERSION);
  });
}

/**
 * Inicializa todas as planilhas do sistema.
 * Cria abas que não existem, define cabeçalhos e insere dados padrão.
 * Deve ser chamada na primeira execução ou quando uma aba estiver faltando.
 */
function initializeSheets() {
  try {
    const ss = getSpreadsheet();
    Logger.log('Iniciando inicialização das planilhas...');

    // Limpa o cache ANTES de migrar: se uma execução anterior deixou dados
    // em cache com o esquema antigo, as leituras feitas durante a migração
    // (getAll) usariam a ordem de colunas anterior. Como o cache também é
    // limpo ao final, esta chamada é apenas uma proteção — não altera o
    // resultado da migração, que lê as abas diretamente da planilha.
    invalidateAllCache();


    // Mapeamento de planilha -> colunas -> dados padrão
    const sheetsConfig = [
      { name: CONFIG.SHEET_NAMES.RECLAME_AQUI,   columns: COLUMNS.ATENDIMENTOS,  defaults: [] },
      { name: CONFIG.SHEET_NAMES.SAC_PREVENTIVO, columns: COLUMNS.ATENDIMENTOS,  defaults: [] },
      // v4.2: canais administráveis pela tela de Configurações (ADM).
      { name: CONFIG.SHEET_NAMES.CANAIS,         columns: COLUMNS.CANAIS,        defaults: DEFAULT_CANAIS },
      { name: CONFIG.SHEET_NAMES.CONFIG_CAMPOS,  columns: COLUMNS.CONFIG_CAMPOS, defaults: DEFAULT_CONFIG_CAMPOS },
      { name: CONFIG.SHEET_NAMES.TIMELINE,       columns: COLUMNS.TIMELINE,      defaults: [] },
      { name: CONFIG.SHEET_NAMES.HISTORICO,      columns: COLUMNS.HISTORICO,     defaults: [] },
      { name: CONFIG.SHEET_NAMES.USUARIOS,       columns: COLUMNS.USUARIOS,      defaults: [] },
      { name: CONFIG.SHEET_NAMES.PRODUTOS,       columns: COLUMNS.PRODUTOS,      defaults: DEFAULT_PRODUTOS },
      { name: CONFIG.SHEET_NAMES.CATEGORIAS,     columns: COLUMNS.CATEGORIAS,    defaults: DEFAULT_CATEGORIAS },
      // v4.6: subcategorias (Produto → Categoria → Subcategoria). Sem dados
      // padrão: o cadastro é feito manualmente pela tela de Configurações.
      { name: CONFIG.SHEET_NAMES.SUBCATEGORIAS,  columns: COLUMNS.SUBCATEGORIAS, defaults: [] },
      // v4.7: valores manuais "Fora da SLA" do módulo Indicadores
      // Operacionais. Nasce vazia; é preenchida conforme o usuário informa.
      { name: CONFIG.SHEET_NAMES.INDICADORES_SLA, columns: COLUMNS.INDICADORES_SLA, defaults: [] }
    ];
    
    sheetsConfig.forEach(function(cfg) {
      let sheet = ss.getSheetByName(cfg.name);
      if (!sheet) {
        const legacyNames = {
          'Histórico': ['Historico'],
          'Usuários': ['Usuarios']
        };
        const aliases = legacyNames[cfg.name] || [];
        for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
          const legacySheet = ss.getSheetByName(aliases[aliasIndex]);
          if (legacySheet) {
            legacySheet.setName(cfg.name);
            sheet = legacySheet;
            Logger.log('Aba migrada: ' + aliases[aliasIndex] + ' -> ' + cfg.name);
            break;
          }
        }
      }
      
      if (!sheet) {
        sheet = ss.insertSheet(cfg.name);
        Logger.log('Aba criada: ' + cfg.name);
      }

      ensureSheetSchema_(sheet, cfg.columns);

      // Dados padrão são incluídos somente quando a aba ainda não possui registros.
      if (sheet.getLastRow() <= 1 && cfg.defaults && cfg.defaults.length > 0) {
        const rows = cfg.defaults.map(function(item) {
          return toRowArray(item, cfg.columns);
        });
        sheet.getRange(2, 1, rows.length, cfg.columns.length).setValues(rows);
        Logger.log('Dados padrão inseridos em ' + cfg.name + ': ' + rows.length + ' registros');
      }
    });

    migrateLegacyData_(ss);
    bootstrapSupervisor_();
    removeDefaultBlankSheet_(ss);
    invalidateAllCache();
    PropertiesService.getScriptProperties().setProperty(PROPERTY_KEYS.SCHEMA_VERSION, CONFIG.SCHEMA_VERSION);
    
    Logger.log('Inicialização das planilhas concluída com sucesso.');
  } catch (e) {
    Logger.log('Erro na inicialização das planilhas: ' + e.message);
    throw new Error('Erro ao inicializar planilhas: ' + e.message);
  }
}

/**
 * Migração v4: remove abas descontinuadas, ressemeia o catálogo, move os
 * atendimentos da aba legada "Atendimentos" para as abas por canal
 * (uma por canal), normaliza o fluxo de status
 * (Pendente / Em análise / Concluído + "Aguardando Retorno de") e garante
 * que exista um usuário ADM.
 */
function migrateLegacyData_(ss) {
  // 1) Remove abas que deixaram de existir no fluxo simplificado.
  // v4.2: 'Canais' foi REMOVIDA desta lista — a aba voltou a existir como
  // cadastro administrável dos canais de entrada (não pode ser apagada).
  const obsoleteSheets = [
    'Status', 'StatusConfig', 'Prioridades', 'TiposAtendimento',
    'SLAs', 'MotivosPendencia', 'Dashboard', 'Relatórios', 'Relatorios',
    'Configurações', 'Configuracoes'
  ];
  obsoleteSheets.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
      Logger.log('Aba descontinuada removida: ' + name);
    }
  });

  // 2) POLÍTICA DE NÃO SOBRESCRITA (v4.3): o antigo "reseed" do catálogo
  //    (que limpava as abas Produtos/Categorias e regravava os padrões a
  //    cada versão) foi REMOVIDO. O sistema nunca sobrescreve dados já
  //    existentes na planilha: os dados padrão (DEFAULT_*) são inseridos
  //    por initializeSheets SOMENTE quando a aba está vazia. O que o
  //    usuário escreveu ou editou manualmente no Google Sheets é sempre
  //    preservado.

  // 3) Move os atendimentos legados para as abas por canal e normaliza status.
  migrateAtendimentosPorCanal_(ss);

  // 4) v4.2: descontinua o canal "Chat Privado" — move os atendimentos da
  //    aba ChatPrivadoRA para ReclameAqui e remove a aba antiga.
  migrateChatPrivadoParaReclameAqui_(ss);

  // 5) Garante um usuário ADM (instalações antigas só tinham Supervisor).
  promoteFirstAdmin_();

  // 6) v4.6: garante o campo "Subcategoria" no formulário (ConfigCampos)
  //    de instalações existentes, sem tocar nos demais campos.
  ensureSubcategoriaFormField_();
}

/**
 * Migração v4.6 — campo Subcategoria no formulário dinâmico.
 * Em instalações existentes a aba ConfigCampos já está populada e a
 * política de não sobrescrita impede regravar os padrões; esta função
 * apenas ACRESCENTA o registro do campo "subcategoria" quando ele ainda
 * não existe (idempotente — nada é alterado nas demais linhas).
 * Instalações novas já o recebem via DEFAULT_CONFIG_CAMPOS.
 * Ordem 6.5: posiciona o campo logo após Categoria (6) e antes do
 * Canal (7) sem renumerar os campos já configurados pelo ADM.
 */
function ensureSubcategoriaFormField_() {
  const existentes = getAll(CONFIG.SHEET_NAMES.CONFIG_CAMPOS);
  if (existentes.length === 0) return; // aba vazia: DEFAULT_CONFIG_CAMPOS cobre
  const jaExiste = existentes.some(function(item) {
    return normalizeText_(item.Campo) === 'subcategoria';
  });
  if (jaExiste) return;

  insert(CONFIG.SHEET_NAMES.CONFIG_CAMPOS, {
    Id: generateId('FC'),
    Campo: 'subcategoria',
    Rotulo: 'Subcategoria',
    Tipo: 'select',
    Exibir: true,
    Obrigatorio: false,
    Ordem: 6.5,
    Base: true,
    Bloqueado: false,
    Opcoes: ''
  });
  Logger.log('Migração v4.6: campo "subcategoria" adicionado à ConfigCampos.');
}

/**
 * Migração v4.2 — remoção do canal "Chat Privado".
 * Executada uma única vez (flag em Script Properties):
 *   1) move todas as linhas da aba legada "ChatPrivadoRA" para a aba
 *      "ReclameAqui", trocando o valor da coluna Canal para "Reclame Aqui"
 *      (o Chat Privado sempre fez parte do Reclame Aqui);
 *   2) remove a aba "ChatPrivadoRA" da planilha;
 *   3) normaliza registros já gravados nas abas restantes que ainda
 *      tenham Canal = "Chat Privado".
 * Nenhum atendimento é perdido — apenas o canal registrado é unificado.
 * @param {Spreadsheet} ss - Planilha principal do sistema.
 */
function migrateChatPrivadoParaReclameAqui_(ss) {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(PROPERTY_KEYS.CHAT_PRIVADO_MIGRATION) === '4.2.0') return;

  // Nome fixo da aba descontinuada (a constante saiu de CONFIG.SHEET_NAMES).
  const LEGACY_CHAT_SHEET = 'ChatPrivadoRA';
  const canalIndex = COLUMNS.ATENDIMENTOS.indexOf('Canal');

  // 1) Move as linhas da aba ChatPrivadoRA para ReclameAqui.
  const legacySheet = ss.getSheetByName(LEGACY_CHAT_SHEET);
  if (legacySheet && legacySheet.getLastRow() > 1) {
    const lastCol = legacySheet.getLastColumn();
    const values = legacySheet.getRange(1, 1, legacySheet.getLastRow(), lastCol).getValues();
    const headers = values[0].map(function(value) { return String(value); });
    const rows = [];

    for (let i = 1; i < values.length; i++) {
      const record = {};
      headers.forEach(function(header, index) {
        if (header) record[header] = values[i][index];
      });
      if (!record.Id) continue;
      record.Canal = 'Reclame Aqui'; // canal unificado
      rows.push(toRowArray(record, COLUMNS.ATENDIMENTOS));
    }

    if (rows.length > 0) {
      const target = ss.getSheetByName(CONFIG.SHEET_NAMES.RECLAME_AQUI);
      if (target) {
        target.getRange(target.getLastRow() + 1, 1, rows.length, COLUMNS.ATENDIMENTOS.length)
          .setValues(rows);
        invalidateCache(CONFIG.SHEET_NAMES.RECLAME_AQUI);
        Logger.log('Atendimentos do Chat Privado migrados para ReclameAqui: ' + rows.length);
      }
    }
  }

  // 2) Remove a aba descontinuada.
  if (legacySheet && ss.getSheets().length > 1) {
    ss.deleteSheet(legacySheet);
    Logger.log('Aba descontinuada removida: ' + LEGACY_CHAT_SHEET);
  }

  // 3) Normaliza registros remanescentes com Canal = "Chat Privado"
  //    (ex.: planilhas editadas manualmente) nas abas por canal atuais.
  CANAL_SHEETS.forEach(function(item) {
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES[item.sheetKey]);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.ATENDIMENTOS.length);
    const rows = range.getValues();
    let changed = false;
    rows.forEach(function(row) {
      if (normalizeText_(row[canalIndex]) === 'chat privado') {
        row[canalIndex] = 'Reclame Aqui';
        changed = true;
      }
    });
    if (changed) {
      range.setValues(rows);
      invalidateCache(sheet.getName());
    }
  });

  properties.setProperty(PROPERTY_KEYS.CHAT_PRIVADO_MIGRATION, '4.2.0');
}

/**
 * Move cada linha da aba legada "Atendimentos" para a aba do seu canal e
 * normaliza status/situação para o fluxo v4:
 *   - Status finais → "Concluído" (sem situação);
 *   - "Em análise do analista" → status "Em análise";
 *   - "Em análise área" → Pendente / Aguardando Retorno de "Área";
 *   - "...retorno do cliente" → Pendente / Aguardando Retorno de "Cliente".
 * Executa uma única vez (flag em Script Properties) e remove a aba legada.
 */
function migrateAtendimentosPorCanal_(ss) {
  const properties = PropertiesService.getScriptProperties();
  const MIGRATION_FLAG = PROPERTY_KEYS.CANAL_MIGRATION;
  if (properties.getProperty(MIGRATION_FLAG) === '4.0.0') return;

  const legacySheet = ss.getSheetByName(CONFIG.LEGACY_ATENDIMENTOS_SHEET);
  if (legacySheet && legacySheet.getLastRow() > 1) {
    const lastCol = legacySheet.getLastColumn();
    const values = legacySheet.getRange(1, 1, legacySheet.getLastRow(), lastCol).getValues();
    const headers = values[0].map(function(value) { return String(value); });
    const buckets = {};

    for (let i = 1; i < values.length; i++) {
      const record = {};
      headers.forEach(function(header, index) {
        if (header) record[header] = values[i][index];
      });
      if (!record.Id) continue;

      normalizeStatusV4_(record);
      const sheetName = sheetNameForCanalConfig_(record.Canal);
      if (!buckets[sheetName]) buckets[sheetName] = [];
      buckets[sheetName].push(toRowArray(record, COLUMNS.ATENDIMENTOS));
    }

    Object.keys(buckets).forEach(function(sheetName) {
      const target = ss.getSheetByName(sheetName);
      if (!target || buckets[sheetName].length === 0) return;
      target.getRange(target.getLastRow() + 1, 1, buckets[sheetName].length, COLUMNS.ATENDIMENTOS.length)
        .setValues(buckets[sheetName]);
      invalidateCache(sheetName);
      Logger.log('Atendimentos migrados para ' + sheetName + ': ' + buckets[sheetName].length);
    });
  }

  if (legacySheet && ss.getSheets().length > 1) {
    ss.deleteSheet(legacySheet);
    Logger.log('Aba legada removida: ' + CONFIG.LEGACY_ATENDIMENTOS_SHEET);
  }

  // Normaliza também registros já existentes nas abas por canal
  // (caso a planilha tenha sido editada manualmente com valores antigos).
  CANAL_SHEETS.forEach(function(item) {
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES[item.sheetKey]);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.ATENDIMENTOS.length);
    const rows = range.getValues();
    let changed = false;
    rows.forEach(function(row) {
      const record = toObject(row, COLUMNS.ATENDIMENTOS);
      if (!record.Id) return;
      if (normalizeStatusV4_(record)) {
        const updated = toRowArray(record, COLUMNS.ATENDIMENTOS);
        for (let c = 0; c < updated.length; c++) row[c] = updated[c];
        changed = true;
      }
    });
    if (changed) {
      range.setValues(rows);
      invalidateCache(sheet.getName());
    }
  });

  properties.setProperty(MIGRATION_FLAG, '4.0.0');
}

/**
 * Normaliza Status/MotivoPendencia de um registro para o fluxo v4.
 * Altera o objeto recebido e retorna true quando algo mudou.
 */
function normalizeStatusV4_(record) {
  const finalNames = ['concluido', 'resolvido', 'finalizado', 'encerrado', 'cancelado', 'improcedente'];
  const status = normalizeText_(record.Status);
  const motivo = normalizeText_(record.MotivoPendencia);
  let newStatus = record.Status;
  let newMotivo = record.MotivoPendencia;

  if (finalNames.indexOf(status) !== -1) {
    newStatus = 'Concluído';
    newMotivo = '';
  } else if (status === 'em analise') {
    newMotivo = '';
  } else {
    // Pendente (ou status desconhecido): decide pela situação legada.
    if (motivo.indexOf('area') !== -1) {
      newStatus = 'Pendente';
      newMotivo = 'Área';
    } else if (motivo.indexOf('cliente') !== -1) {
      newStatus = 'Pendente';
      newMotivo = 'Cliente';
    } else if (motivo.indexOf('analista') !== -1 || !motivo) {
      newStatus = 'Em análise';
      newMotivo = '';
    } else {
      newStatus = 'Pendente';
      newMotivo = SITUACOES_PENDENCIA.indexOf(String(record.MotivoPendencia)) !== -1
        ? String(record.MotivoPendencia)
        : 'Área';
    }
  }

  const changed = String(record.Status) !== String(newStatus) ||
    String(record.MotivoPendencia || '') !== String(newMotivo || '');
  record.Status = newStatus;
  record.MotivoPendencia = newMotivo;
  return changed;
}

/**
 * Retorna o nome da aba correspondente a um canal (Config.gs/CANAL_SHEETS).
 * Canais desconhecidos ou vazios caem na aba ReclameAqui.
 */
function sheetNameForCanalConfig_(canal) {
  const normalized = normalizeText_(canal);
  for (let i = 0; i < CANAL_SHEETS.length; i++) {
    if (normalizeText_(CANAL_SHEETS[i].canal) === normalized) {
      return CONFIG.SHEET_NAMES[CANAL_SHEETS[i].sheetKey];
    }
  }
  return CONFIG.SHEET_NAMES.RECLAME_AQUI;
}

/**
 * Garante que exista pelo menos um usuário ativo com perfil ADM.
 * Em instalações antigas, promove o primeiro Supervisor ativo.
 */
function promoteFirstAdmin_() {
  const users = getAll(CONFIG.SHEET_NAMES.USUARIOS);
  const hasAdmin = users.some(function(user) {
    return isTrue_(user.Ativo) && normalizeText_(user.Perfil) === 'adm';
  });
  if (hasAdmin) return;

  const supervisor = users.find(function(user) {
    return isTrue_(user.Ativo) && ['supervisor', 'gestor', 'administrador', 'admin'].indexOf(normalizeText_(user.Perfil)) !== -1;
  });
  if (supervisor) {
    update(CONFIG.SHEET_NAMES.USUARIOS, supervisor.Id, { Perfil: 'ADM' });
    // LGPD: registra apenas o Id técnico — nunca o nome ou e-mail.
    Logger.log('Usuário promovido a ADM (Id): ' + supervisor.Id);
  }
}

/*
 * v4.3 — funções reseedCatalog_ e normalizeProdutosAtendimentos_ REMOVIDAS.
 * Elas limpavam as abas Produtos/Categorias (regravando os padrões a cada
 * versão de catálogo) e reescreviam o nome do produto de atendimentos já
 * gravados — ou seja, sobrescreviam dados que o usuário escreveu/editou
 * manualmente no Google Sheets. Pela política de não sobrescrita, os dados
 * padrão são gravados apenas em abas VAZIAS (initializeSheets) e nenhum
 * conteúdo existente é alterado por rotinas automáticas de catálogo.
 */

/**
 * Aplica a formatação padrão do cabeçalho (negrito, fundo azul, congelado).
 * Operação puramente visual — não altera dados.
 * @param {Sheet} sheet - Aba a formatar.
 * @param {number} totalColunas - Quantidade de colunas do cabeçalho.
 */
function aplicarFormatoCabecalho_(sheet, totalColunas) {
  const headerRange = sheet.getRange(1, 1, 1, totalColunas);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#0046C0');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
}

/**
 * Atualiza o esquema de uma aba preservando os dados pelas chaves do cabeçalho.
 * Isso permite evoluir o sistema sem deslocar dados de instalações anteriores.
 *
 * ============================================================================
 * 🔴 FUNÇÃO DE ALTO RISCO — LEIA ANTES DE ALTERAR
 * ============================================================================
 * CORREÇÃO DE RISCO CRÍTICO (Fase 1 de estabilização):
 * a versão anterior fazia, nesta ordem:
 *     clearContents()  →  escreve cabeçalho  →  regrava as linhas
 * Entre o clearContents() e a regravação a aba ficava VAZIA. Qualquer
 * falha nesse intervalo (timeout de 6 min, erro de rede, exceção) apagava
 * DEFINITIVAMENTE os dados — não havia como recuperar.
 *
 * A rotina agora é NÃO DESTRUTIVA e reversível:
 *   1. Lê tudo em memória e remapeia pelo NOME do cabeçalho;
 *   2. VALIDA a contagem antes de gravar (nenhuma linha pode sumir);
 *   3. Cria uma ABA DE BACKUP com o conteúdo original (rede de segurança
 *      que permanece na planilha para conferência/rollback manual);
 *   4. SOBRESCREVE o intervalo por cima, sem nunca esvaziar a aba antes
 *      (só limpa colunas remanescentes à direita, se o esquema encolheu);
 *   5. VALIDA de novo lendo a aba: contagem tem de bater;
 *   6. Em caso de erro em qualquer ponto, RESTAURA os valores originais
 *      a partir da memória (rollback) e interrompe com erro explícito.
 *
 * A trava de escrita é garantida por withScriptLock_ (reentrante), de modo
 * que duas migrações nunca rodam ao mesmo tempo sobre a mesma aba.
 * ============================================================================
 * @param {Sheet} sheet - Aba a ajustar.
 * @param {string[]} columns - Colunas esperadas (Config.gs).
 * @throws {Error} 'ESQUEMA: ...' quando a migração não pôde ser concluída
 *   com segurança (neste caso os dados originais são preservados).
 */
function ensureSheetSchema_(sheet, columns) {
  if (!columns || columns.length === 0) return;

  // Garantir colunas físicas suficientes é uma operação aditiva e segura.
  if (sheet.getMaxColumns() < columns.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
  }

  const sheetName = sheet.getName();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // ── CASO 1: aba vazia (sem cabeçalho) — nada a preservar ──
  if (lastRow === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    aplicarFormatoCabecalho_(sheet, columns.length);
    return;
  }

  const existing = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const oldHeaders = existing[0].map(function(value) { return String(value); });
  const sameSchema = oldHeaders.length === columns.length && oldHeaders.every(function(value, index) {
    return value === columns[index];
  });

  // ── CASO 2: esquema já correto — só reforça cabeçalho e formatação ──
  if (sameSchema) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    aplicarFormatoCabecalho_(sheet, columns.length);
    return;
  }

  // ── CASO 3: esquema diferente, mas SEM linhas de dados ──
  // Não há o que preservar: apenas troca o cabeçalho.
  if (existing.length <= 1) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    if (lastCol > columns.length) {
      sheet.getRange(1, columns.length + 1, 1, lastCol - columns.length).clearContent();
    }
    aplicarFormatoCabecalho_(sheet, columns.length);
    return;
  }

  // ── CASO 4: MIGRAÇÃO COM DADOS REAIS — caminho protegido ──
  withScriptLock_(function() {
    const totalOriginal = existing.length - 1; // linhas de dados (sem cabeçalho)

    // 4.1 Remapeia cada linha pelo NOME da coluna no cabeçalho antigo.
    const rows = existing.slice(1).map(function(row) {
      const record = {};
      oldHeaders.forEach(function(header, index) {
        if (header) record[header] = row[index];
      });
      return toRowArray(record, columns);
    });

    // 4.2 VALIDAÇÃO PRÉVIA: nenhuma linha pode ter se perdido no remapeamento.
    if (rows.length !== totalOriginal) {
      throw new Error('ESQUEMA: remapeamento de "' + sheetName + '" gerou ' + rows.length +
        ' linhas para ' + totalOriginal + ' originais. Migração abortada — nada foi alterado.');
    }

    // 4.3 BACKUP: cópia integral da aba ANTES de qualquer escrita.
    // Fica na própria planilha como rede de segurança (não é apagada
    // automaticamente — o administrador confere e remove quando quiser).
    let nomeBackup = '';
    try {
      const ss = sheet.getParent();
      const carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
      nomeBackup = ('_bkp_' + sheetName + '_' + carimbo).substring(0, 99);
      sheet.copyTo(ss).setName(nomeBackup);
      Logger.log('[Esquema] Backup criado antes da migração: ' + nomeBackup);
    } catch (e) {
      // Sem backup não migramos: preferimos manter o sistema como está.
      throw new Error('ESQUEMA: não foi possível criar a aba de backup de "' + sheetName +
        '" (' + e.message + '). Migração abortada — nenhum dado foi alterado.');
    }

    // 4.4 ESCRITA POR CIMA (a aba NUNCA fica vazia em nenhum instante).
    try {
      sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
      sheet.getRange(2, 1, rows.length, columns.length).setValues(rows);

      // Se o esquema novo tem MENOS colunas, limpa só o excedente à direita
      // (nunca o intervalo que acabou de receber os dados).
      if (lastCol > columns.length) {
        sheet.getRange(1, columns.length + 1, lastRow, lastCol - columns.length).clearContent();
      }

      // 4.5 VALIDAÇÃO POSTERIOR: relê a aba e confere a contagem.
      SpreadsheetApp.flush();
      const conferencia = sheet.getLastRow() - 1;
      if (conferencia !== totalOriginal) {
        throw new Error('contagem final (' + conferencia + ') diferente da original (' + totalOriginal + ')');
      }
    } catch (e) {
      // 4.6 ROLLBACK: devolve os valores originais a partir da memória.
      try {
        sheet.getRange(1, 1, existing.length, oldHeaders.length).setValues(existing);
        SpreadsheetApp.flush();
        Logger.log('[Esquema] ROLLBACK aplicado em "' + sheetName + '" — dados originais restaurados.');
      } catch (rollbackErro) {
        Logger.log('[Esquema] FALHA NO ROLLBACK de "' + sheetName + '": ' + rollbackErro.message +
          ' — utilize a aba de backup "' + nomeBackup + '".');
      }
      throw new Error('ESQUEMA: falha ao migrar "' + sheetName + '" (' + e.message +
        '). Os dados originais foram restaurados; a aba de backup "' + nomeBackup + '" também está disponível.');
    }

    aplicarFormatoCabecalho_(sheet, columns.length);
    invalidateCache(sheetName);
    Logger.log('[Esquema] Migração concluída em "' + sheetName + '": ' + totalOriginal +
      ' registros preservados. Backup: ' + nomeBackup);
  });
}

/**
 * Cadastra o primeiro usuário como ADM para viabilizar a configuração inicial
 * (gestão de usuários e dos campos do formulário são exclusivas do ADM).
 */
function bootstrapSupervisor_() {
  const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_NAMES.USUARIOS);
  if (!sheet || sheet.getLastRow() > 1) return;

  let email = '';
  try {
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }

  const nome = email ? email.split('@')[0] : 'Administrador inicial';
  const user = {
    Id: generateId('USR'),
    Nome: nome,
    Email: email,
    Perfil: 'ADM',
    Equipe: 'RA',
    Ativo: true,
    DataCadastro: new Date(),
    UltimoAcesso: new Date()
  };
  sheet.getRange(2, 1, 1, COLUMNS.USUARIOS.length).setValues([toRowArray(user, COLUMNS.USUARIOS)]);
}

/**
 * Remove apenas a aba vazia criada automaticamente em planilhas independentes.
 */
function removeDefaultBlankSheet_(ss) {
  const managedNames = Object.values(CONFIG.SHEET_NAMES);
  const defaultNames = ['Sheet1', 'Página1', 'Pagina1', 'Planilha1'];
  ss.getSheets().forEach(function(sheet) {
    if (managedNames.indexOf(sheet.getName()) === -1 &&
        defaultNames.indexOf(sheet.getName()) !== -1 &&
        sheet.getLastRow() === 0 &&
        ss.getSheets().length > 1) {
      ss.deleteSheet(sheet);
    }
  });
}

// ============================================================================
// CACHE
// ============================================================================

/**
 * Gera a chave de cache para uma planilha.
 *
 * CORREÇÃO DE BUG (causa raiz do "dashboard vazio" intermitente):
 * a chave agora inclui a SCHEMA_VERSION. Antes, um cache gravado por uma
 * versão anterior do código (ex.: sem a coluna Subcategoria) podia ser
 * lido pela versão nova durante a janela do TTL — as linhas cruas eram
 * então mapeadas com a lista de colunas nova, deslocando TODOS os campos
 * a partir do ponto de inserção (Status virava Subcategoria, Responsável
 * virava DataResolucao...). Para o perfil Analista, o filtro por
 * responsável deixava de casar e a tela ficava COMPLETAMENTE VAZIA,
 * mesmo com registros válidos na planilha. Com a versão na chave, caches
 * de esquemas diferentes nunca se cruzam.
 * @param {string} sheetName - Nome da planilha
 * @returns {string} Chave de cache
 */
function getCacheKey(sheetName) {
  return 'PRISMA_RA_' + CONFIG.SCHEMA_VERSION + '_' + sheetName;
}

/**
 * Pergunta ao Pgo5.gs se estamos sobre um banco 5.0, SEM criar dependência
 * dura entre os arquivos.
 *
 * Por que a checagem de tipo: no Apps Script todos os .gs compartilham o
 * mesmo escopo, mas um projeto publicado pela metade (Database.gs novo,
 * Pgo5.gs ainda não enviado) faria esta chamada estourar em TODA requisição
 * e o sistema 4.x não abriria mais. Na dúvida, responde "não é 5.0" e o
 * comportamento legado — que é o que existe hoje — segue intacto.
 * @returns {boolean} true somente com Pgo5.gs presente e base 5.0 detectada.
 */
function estruturaEhPGO5_() {
  if (typeof emBasePGO5_ !== 'function') return false;
  try {
    return emBasePGO5_();
  } catch (e) {
    Logger.log('[PGO5] Detecção de estrutura indisponível: ' + e.message);
    return false;
  }
}

/**
 * true quando a aba pedida pertence SOMENTE ao modelo 4.x e o sistema está
 * rodando sobre um banco PGO 5.0, onde ela não existe.
 *
 * "Usuários" e "Atendimentos" ficam de fora da lista de propósito: os dois
 * nomes existem nos dois schemas, então nunca podem ser tratados como
 * ausentes por esta regra.
 * @param {string} sheetName - Nome da aba pedida.
 * @returns {boolean} true se for leitura de aba legada numa base 5.0.
 */
function abaLegadaAusenteEmPGO5_(sheetName) {
  if (!estruturaEhPGO5_()) return false;
  const somenteLegado = [
    CONFIG.SHEET_NAMES.RECLAME_AQUI,
    CONFIG.SHEET_NAMES.SAC_PREVENTIVO,
    CONFIG.SHEET_NAMES.CANAIS,
    CONFIG.SHEET_NAMES.CONFIG_CAMPOS,
    CONFIG.SHEET_NAMES.TIMELINE,
    CONFIG.SHEET_NAMES.HISTORICO,
    CONFIG.SHEET_NAMES.PRODUTOS,
    CONFIG.SHEET_NAMES.CATEGORIAS,
    CONFIG.SHEET_NAMES.SUBCATEGORIAS,
    CONFIG.SHEET_NAMES.INDICADORES_SLA
  ];
  if (somenteLegado.indexOf(sheetName) === -1) return false;
  return !getSpreadsheet().getSheetByName(sheetName);
}

/**
 * MEMO POR EXECUÇÃO (otimização de leitura).
 *
 * Guarda, em memória, o resultado já lido de cada aba durante UMA única
 * execução do Apps Script. Motivo: numa mesma requisição a mesma aba é
 * lida várias vezes (ex.: getBootstrapData lê "Usuários" em activeSorted_
 * e de novo em getActor_). Sem o memo, cada repetição custa uma ida ao
 * CacheService (chamada de rede) mais um JSON.parse da aba INTEIRA.
 *
 * Por que é seguro: o tempo de vida deste memo é ESTRITAMENTE MENOR que o
 * do cache de 5 minutos que já existe — ele nasce e morre dentro de uma
 * execução, e é limpo exatamente pelas mesmas funções (invalidateCache /
 * invalidateAllCache) que toda gravação já chama. Ou seja, qualquer
 * leitura que hoje é correta com o CacheService continua correta.
 *
 * Não guarda cópia defensiva de propósito: o único consumidor é getAll(),
 * que apenas LÊ as linhas e constrói objetos novos, sem alterar o array.
 */
var SHEET_DATA_MEMO_ = {};

/**
 * Remove uma aba (ou todas) do memo de execução.
 * @param {string} [sheetName] - Aba a esquecer. Sem argumento, limpa tudo.
 */
function limparMemoExecucao_(sheetName) {
  if (sheetName === undefined) {
    SHEET_DATA_MEMO_ = {};
    return;
  }
  delete SHEET_DATA_MEMO_[sheetName];
}

/**
 * Chave de cache usada por versões anteriores (sem SCHEMA_VERSION).
 * Mantida apenas para LIMPEZA durante a atualização — nunca para leitura.
 * @param {string} sheetName - Nome da planilha
 * @returns {string} Chave de cache legada
 */
function getLegacyCacheKey_(sheetName) {
  return 'PRISMA_RA_' + sheetName;
}

/**
 * Invalida (remove) o cache de uma planilha específica.
 * Deve ser chamada após qualquer operação de escrita.
 * Remove também a chave legada (sem versão), para que instâncias ainda
 * não atualizadas não sirvam dados obsoletos durante o upgrade.
 * @param {string} sheetName - Nome da planilha
 */
function invalidateCache(sheetName) {
  try {
    limparMemoExecucao_(sheetName);
    const cache = CacheService.getScriptCache();
    cache.removeAll([getCacheKey(sheetName), getLegacyCacheKey_(sheetName)]);
    Logger.log('Cache invalidado para: ' + sheetName);
  } catch (e) {
    Logger.log('Erro ao invalidar cache: ' + e.message);
  }
}

/**
 * Invalida o cache de todas as planilhas (chaves atuais e legadas).
 */
function invalidateAllCache() {
  try {
    limparMemoExecucao_();
    const cache = CacheService.getScriptCache();
    const keys = [];
    Object.values(CONFIG.SHEET_NAMES).forEach(function(name) {
      keys.push(getCacheKey(name));
      keys.push(getLegacyCacheKey_(name));
    });
    cache.removeAll(keys);
    Logger.log('Todos os caches invalidados.');
  } catch (e) {
    Logger.log('Erro ao invalidar todos os caches: ' + e.message);
  }
}

// ============================================================================
// LEITURA DE DADOS
// ============================================================================

/**
 * Valida a estrutura de um cache de planilha antes de usá-lo.
 * O cache é APENAS otimização — nunca fonte única. Se estiver corrompido,
 * com estrutura inesperada ou com cabeçalho incompatível com o esquema
 * atual (ex.: gravado antes de uma migração de colunas), ele é descartado
 * e a leitura volta para o Google Sheets (fonte oficial).
 * @param {*} data - Valor desserializado do cache.
 * @param {string} sheetName - Nome da planilha (para conferir o esquema).
 * @returns {boolean} true somente se o cache é seguro para uso.
 */
function isCacheValido_(data, sheetName) {
  // Estrutura básica: array de arrays, com linha de cabeçalho.
  if (!Array.isArray(data) || data.length === 0) return false;
  if (!Array.isArray(data[0])) return false;

  // Cabeçalho do cache deve conter TODAS as colunas do esquema atual.
  // Se a lista de colunas mudou (ex.: Subcategoria adicionada) e o cache
  // é anterior à mudança, ele é rejeitado — evita o deslocamento de
  // campos que fazia registros "sumirem" do Dashboard/Indicadores.
  const columns = getColumnsForSheet(sheetName);
  if (columns.length > 0) {
    const headers = data[0].map(function(value) { return String(value); });
    const todasPresentes = columns.every(function(col) {
      return headers.indexOf(col) !== -1;
    });
    if (!todasPresentes) return false;
  }
  return true;
}

/**
 * Lê todos os dados de uma planilha, utilizando cache quando disponível.
 *
 * ESTRATÉGIA (confiabilidade + performance):
 *   1. Cache válido?  → usa (rápido, sem tocar no Sheets);
 *   2. Cache ausente/expirado/corrompido/incompatível → lê o Sheets
 *      (fonte oficial), valida e reabastece o cache;
 *   3. Falha transitória do Sheets → UMA nova tentativa;
 *   4. Falha definitiva → ERRO explícito (prefixo "DADOS:").
 *
 * CORREÇÃO DE BUG: antes, qualquer exceção era engolida e a função
 * devolvia [] — o frontend exibia "Nenhum atendimento encontrado" como
 * se a base estivesse vazia (confundia ERRO com AUSÊNCIA DE DADOS).
 * Agora erro é erro: propaga para o failure handler do frontend, que
 * aciona o fallback automático e nunca mostra tela vazia indevida.
 * @param {string} sheetName - Nome da planilha
 * @param {boolean} forceRefresh - true ignora o cache e lê o Sheets.
 * @returns {Array[]} Array bidimensional com os dados (incluindo cabeçalho)
 * @throws {Error} 'DADOS: ...' quando o Sheets não pôde ser lido.
 */
function getSheetData(sheetName, forceRefresh) {
  const cache = CacheService.getScriptCache();
  const cacheKey = getCacheKey(sheetName);

  // ── 0a. Aba exclusiva do modelo 4.x sobre uma base PGO 5.0 ──
  // Numa base 5.0 as abas antigas simplesmente não existem, porque os dados
  // ainda não foram tombados. Isso é AUSÊNCIA DE MIGRAÇÃO, não falha de
  // leitura: devolver [] faz as telas ainda não migradas mostrarem estado
  // vazio em vez de um erro fatal. Vale só para abas legadas e só em base
  // 5.0 — numa base 4.x uma aba faltando continua sendo erro.
  if (abaLegadaAusenteEmPGO5_(sheetName)) {
    Logger.log('[PGO5] Aba legada "' + sheetName + '" não existe na base 5.0 — ' +
      'devolvendo vazio (dados ainda não tombados).');
    return [];
  }

  // ── 0b. Memo desta execução (sem rede, sem JSON.parse) ──
  // Serve as releituras da MESMA aba dentro da MESMA requisição.
  // forceRefresh ignora o memo, exatamente como ignora o cache.
  if (!forceRefresh && Object.prototype.hasOwnProperty.call(SHEET_DATA_MEMO_, sheetName)) {
    return SHEET_DATA_MEMO_[sheetName];
  }

  // ── 1. Tenta o cache (somente se não for refresh forçado) ──
  if (!forceRefresh) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (isCacheValido_(parsed, sheetName)) {
          SHEET_DATA_MEMO_[sheetName] = parsed;
          return parsed;
        }
        // Cache inválido/incompatível: descarta e segue para o Sheets.
        cache.remove(cacheKey);
        Logger.log('[CacheGuard] Cache descartado (estrutura/esquema inválido): ' + sheetName);
      }
    } catch (cacheReadError) {
      // Falha no cache NUNCA impede a leitura da fonte oficial.
      Logger.log('[CacheGuard] Erro ao ler cache de ' + sheetName + ': ' + cacheReadError.message);
    }
  }

  // ── 2. Fonte oficial: Google Sheets (com uma retentativa) ──
  let lastError = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const ss = getSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        // Aba mapeada que não existe é problema estrutural, não "0 registros".
        throw new Error('Aba "' + sheetName + '" não encontrada na planilha.');
      }

      if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
        SHEET_DATA_MEMO_[sheetName] = [];
        return []; // aba realmente vazia (sem cabeçalho): não há o que ler
      }

      const data = sheet.getDataRange().getValues();
      SHEET_DATA_MEMO_[sheetName] = data;

      // ── 3. Reabastece o cache (limite de 100KB por chave) ──
      try {
        const jsonData = JSON.stringify(data);
        if (jsonData.length <= 100000) {
          cache.put(cacheKey, jsonData, CONFIG.CACHE_TTL);
        } else {
          Logger.log('Dados muito grandes para cache (' + sheetName + '): ' + jsonData.length + ' bytes');
        }
      } catch (cacheError) {
        Logger.log('Erro ao cachear dados de ' + sheetName + ': ' + cacheError.message);
      }

      return data;
    } catch (e) {
      lastError = e;
      Logger.log('[Dados] Tentativa ' + tentativa + ' falhou ao ler ' + sheetName + ': ' + e.message);
      if (tentativa === 1) Utilities.sleep(500); // pequena pausa antes de tentar de novo
    }
  }

  // ── 4. Falha definitiva: erro explícito (nunca [] silencioso) ──
  throw new Error('DADOS: Falha ao ler a aba "' + sheetName + '" no Google Sheets: ' +
    (lastError ? lastError.message : 'erro desconhecido'));
}

/**
 * Obtém todos os registros de uma planilha como array de objetos.
 * Exclui a linha de cabeçalho e converte cada linha para objeto.
 *
 * PROTEÇÃO CONTRA REGRESSÃO (mapeamento por CABEÇALHO, não por posição):
 * cada campo é localizado pelo NOME na linha de cabeçalho real da aba,
 * e não mais pela posição fixa na lista de colunas do Config. Assim:
 *   - adicionar uma coluna nova no Sheets (ex.: Subcategoria) não
 *     desloca os campos dos registros;
 *   - colunas em ordem diferente da configurada continuam corretas;
 *   - coluna configurada mas ausente na aba (registros antigos) vira ''
 *     — compatibilidade preservada;
 *   - colunas extras na aba são simplesmente ignoradas.
 * Fallback: se o cabeçalho da aba estiver ilegível (nenhuma coluna
 * reconhecida), usa o mapeamento posicional legado, para nunca perder
 * dados de bases antigas.
 *
 * Erros de leitura NÃO são engolidos: propagam para o chamador (e daí
 * para o failure handler do frontend), que distingue "erro" de
 * "0 registros" e aciona o fallback automático.
 * @param {string} sheetName - Nome da planilha
 * @param {boolean} forceRefresh - true ignora o cache (fallback).
 * @returns {Object[]} Array de objetos com os dados
 * @throws {Error} 'DADOS: ...' quando a leitura da fonte oficial falha.
 */
function getAll(sheetName, forceRefresh) {
  const data = getSheetData(sheetName, forceRefresh === true);

  if (data.length <= 1) return []; // Sem dados (só cabeçalho ou vazio)

  // Colunas definidas no Config para esta planilha
  const columns = getColumnsForSheet(sheetName);

  // Índice de cada coluna pelo NOME no cabeçalho real da aba.
  const headers = data[0].map(function(value) { return String(value); });
  const indicePorColuna = {};
  let reconhecidas = 0;
  columns.forEach(function(col) {
    const idx = headers.indexOf(col);
    indicePorColuna[col] = idx;
    if (idx !== -1) reconhecidas++;
  });
  const mapearPorCabecalho = reconhecidas > 0;
  if (!mapearPorCabecalho && columns.length > 0) {
    Logger.log('[Dados] Cabeçalho de ' + sheetName + ' não reconhecido — usando mapeamento posicional legado.');
  }

  // Converte cada linha (exceto cabeçalho) para objeto
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Ignora linhas completamente vazias
    if (row.every(function(cell) { return cell === '' || cell === null || cell === undefined; })) continue;

    if (mapearPorCabecalho) {
      const obj = {};
      columns.forEach(function(col) {
        const idx = indicePorColuna[col];
        obj[col] = (idx !== -1 && idx < row.length) ? row[idx] : '';
      });
      records.push(obj);
    } else {
      records.push(toObject(row, columns)); // fallback posicional legado
    }
  }

  return records;
}

/**
 * Obtém um único registro por ID.
 * @param {string} sheetName - Nome da planilha
 * @param {string} id - ID do registro
 * @returns {Object|null} Registro encontrado ou null
 */
function getById(sheetName, id) {
  // IMPORTANTE (correção de risco): esta função NÃO captura erros de
  // leitura. Antes, qualquer falha do Sheets virava "return null", e o
  // sistema exibia "Atendimento não encontrado" — transformando uma FALHA
  // TÉCNICA em AUSÊNCIA DE DADO. Agora o erro ('DADOS: ...') sobe até o
  // frontend, que aciona a nova tentativa e, se persistir, mostra o erro
  // real. "null" passou a significar exclusivamente: não existe registro
  // com este Id.
  if (!id) return null;

  const records = getAll(sheetName);
  const record = records.find(function(r) {
    return String(r.Id) === String(id);
  });

  return record || null;
}

/**
 * Obtém registros filtrados por um campo específico.
 * @param {string} sheetName - Nome da planilha
 * @param {string} field - Nome do campo a filtrar
 * @param {*} value - Valor a buscar
 * @returns {Object[]} Array de registros correspondentes
 */
function getByField(sheetName, field, value) {
  // Sem captura de erro (mesma correção de getById): uma falha de leitura
  // aqui fazia a TIMELINE aparecer vazia, como se o atendimento não
  // tivesse histórico. Agora o erro propaga e "[]" significa apenas:
  // nenhum registro corresponde ao filtro.
  const records = getAll(sheetName);
  return records.filter(function(r) {
    return String(r[field]) === String(value);
  });
}

/**
 * Obtém dados filtrados por múltiplos critérios.
 * @param {string} sheetName - Nome da planilha
 * @param {Object} filters - Objeto com pares {campo: valor}
 * @returns {Object[]} Array de registros correspondentes
 */
function getFilteredData(sheetName, filters) {
  // Sem captura de erro (mesma correção de getById/getByField): falha de
  // leitura nunca deve virar lista vazia.
  const records = getAll(sheetName);

  if (!filters || Object.keys(filters).length === 0) {
    return records;
  }

  return records.filter(function(record) {
    return Object.keys(filters).every(function(key) {
      const filterValue = filters[key];

      // Ignora filtros vazios
      if (filterValue === null || filterValue === undefined || filterValue === '') {
        return true;
      }

      const recordValue = record[key];

      // Comparação por array (OR): se o filtro é array, basta ter um match
      if (Array.isArray(filterValue)) {
        return filterValue.some(function(fv) {
          return String(recordValue) === String(fv);
        });
      }

      // Comparação simples
      return String(recordValue) === String(filterValue);
    });
  });
}

// ============================================================================
// ESCRITA DE DADOS
// ============================================================================

/**
 * Garante que o cabeçalho físico da aba está alinhado com o esquema do
 * Config ANTES de uma gravação posicional (insert/update escrevem a linha
 * inteira na ordem das colunas configuradas).
 * Se alguém adicionou/reordenou colunas manualmente no Sheets, realinha a
 * aba via ensureSheetSchema_ (que preserva os dados remapeando pelo NOME
 * do cabeçalho) e invalida o cache. Proteção contra regressão: uma
 * mudança estrutural na planilha não corrompe mais as gravações.
 * @param {Sheet} sheet - Aba de destino.
 * @param {string} sheetName - Nome da aba (para invalidar o cache).
 * @param {string[]} columns - Colunas esperadas (Config).
 */
function ensureAlignedHeaders_(sheet, sheetName, columns) {
  if (!columns || columns.length === 0) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v); });
    const alinhado = columns.every(function(col, index) { return headers[index] === col; });
    if (alinhado) return;
  }
  Logger.log('[SchemaGuard] Cabeçalho de ' + sheetName + ' desalinhado — realinhando antes da gravação.');
  ensureSheetSchema_(sheet, columns);
  invalidateCache(sheetName);
}

/**
 * 🔴 ALTO RISCO — PREPARA UMA ABA PARA GRAVAÇÃO POSICIONAL.
 *
 * PARA QUE SERVE:
 * O Prisma grava as linhas por POSIÇÃO (a 1ª célula é a 1ª coluna de
 * COLUMNS, a 2ª é a 2ª...). Se o cabeçalho físico da planilha estiver em
 * outra ordem, o valor de "Status" pode acabar gravado na coluna
 * "Subcategoria". Esta função é a barreira que impede isso.
 *
 * O QUE ELA FAZ, NESTA ORDEM:
 *   1. confere se a aba tem esquema mapeado no código;
 *   2. lê o cabeçalho real da planilha;
 *   3. ABORTA se a estrutura for insegura (cabeçalho irreconhecível com
 *      dados, ou coluna repetida) — nunca tenta adivinhar;
 *   4. se já estiver alinhado, libera a gravação;
 *   5. se estiver desalinhado mas for corrigível, corrige usando a rotina
 *      protegida da Fase 1 (backup + validação + rollback);
 *   6. CONFERE DE NOVO e só então libera a gravação.
 *
 * ⚠️ NÃO REMOVA ESTAS VALIDAÇÕES. É melhor recusar a gravação com um erro
 * claro do que gravar informação na coluna errada.
 *
 * Deve ser chamada com a trava de escrita já adquirida (withScriptLock_).
 * @param {Sheet} sheet - Aba de destino.
 * @param {string} sheetName - Nome da aba.
 * @param {string[]} columns - Colunas esperadas (Config.gs).
 * @throws {Error} 'ESTRUTURA: ...' quando não é seguro gravar.
 */
function prepararAbaParaGravacao_(sheet, sheetName, columns) {
  // 1. A aba precisa ter esquema conhecido pelo código.
  assertColumnsForSheet_(sheetName, columns);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // 2. Aba ainda sem cabeçalho e sem dados: apenas cria o cabeçalho.
  if (lastRow === 0 || lastCol === 0) {
    ensureAlignedHeaders_(sheet, sheetName, columns);
    return;
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v); });

  // 3a. FAIL CLOSED — cabeçalho irreconhecível COM dados na aba.
  // Sem nenhuma coluna conhecida não há como remapear: um "conserto"
  // automático aqui esvaziaria os registros existentes.
  const reconhecidas = columns.filter(function(col) { return headers.indexOf(col) !== -1; }).length;
  if (reconhecidas === 0 && lastRow > 1) {
    throw new Error('ESTRUTURA: o cabeçalho da aba "' + sheetName + '" não foi reconhecido e ela ' +
      'contém dados. A gravação foi cancelada para não corromper os registros. ' +
      'Restaure a primeira linha com os nomes de coluna originais.');
  }

  // 3b. FAIL CLOSED — coluna configurada aparece MAIS DE UMA VEZ.
  // Nesse caso é impossível saber qual delas guarda o dado verdadeiro.
  const duplicadas = columns.filter(function(col) {
    return headers.filter(function(h) { return h === col; }).length > 1;
  });
  if (duplicadas.length > 0) {
    throw new Error('ESTRUTURA: a aba "' + sheetName + '" tem a(s) coluna(s) ' +
      duplicadas.join(', ') + ' repetida(s) no cabeçalho. A gravação foi cancelada — ' +
      'remova a duplicidade na planilha antes de continuar.');
  }

  // 4. Já alinhado: nada a fazer (caminho normal, sem custo extra).
  const alinhado = columns.every(function(col, index) { return headers[index] === col; });
  if (alinhado) return;

  // 5. Desalinhado, porém corrigível: usa a rotina protegida da Fase 1.
  ensureAlignedHeaders_(sheet, sheetName, columns);

  // 6. VALIDA DE NOVO. Se ainda não estiver alinhado, não grava.
  const conferencia = sheet.getRange(1, 1, 1, Math.max(columns.length, sheet.getLastColumn()))
    .getValues()[0].map(function(v) { return String(v); });
  const alinhadoAgora = columns.every(function(col, index) { return conferencia[index] === col; });
  if (!alinhadoAgora) {
    throw new Error('ESTRUTURA: não foi possível alinhar o cabeçalho da aba "' + sheetName +
      '". A gravação foi cancelada e nenhum dado foi alterado.');
  }
}

/**
 * Insere um novo registro na planilha.
 * Utiliza LockService para garantir concorrência segura.
 * @param {string} sheetName - Nome da planilha
 * @param {Object} data - Objeto com os dados a inserir
 * @returns {string} ID do registro inserido
 */
function insert(sheetName, data) {
  const lock = LockService.getScriptLock();
  // Trava reentrante (ver withScriptLock_): se ESTA execução já detém a
  // trava — por exemplo, uma migração que chama insert internamente —
  // não tentamos readquiri-la, o que causaria impasse até o timeout.
  const jaTravado = LOCK_HELD_;

  try {
    if (!jaTravado) {
      lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
      LOCK_HELD_ = true;
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    // Gravação POSICIONAL: valida a estrutura antes (esquema mapeado,
    // cabeçalho legível, sem colunas duplicadas) e alinha com segurança.
    // Estrutura insegura ABORTA a gravação — ver prepararAbaParaGravacao_.
    prepararAbaParaGravacao_(sheet, sheetName, columns);
    const rowData = toRowArray(data, columns);

    sheet.appendRow(rowData);
    
    // Invalida cache após escrita
    invalidateCache(sheetName);
    
    Logger.log('Registro inserido em ' + sheetName + ': ' + (data.Id || 'sem ID'));
    return data.Id || '';
  } catch (e) {
    Logger.log('Erro ao inserir em ' + sheetName + ': ' + e.message);
    throw new Error('Erro ao inserir registro: ' + e.message);
  } finally {
    // Só libera quem realmente adquiriu (a trava pertence ao chamador externo).
    if (!jaTravado) {
      LOCK_HELD_ = false;
      try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
    }
  }
}

/**
 * Atualiza um registro existente por ID.
 * Utiliza LockService para garantir concorrência segura.
 * @param {string} sheetName - Nome da planilha
 * @param {string} id - ID do registro a atualizar
 * @param {Object} data - Objeto com os dados atualizados
 * @returns {boolean} true se atualizado com sucesso
 */
function update(sheetName, id, data) {
  const lock = LockService.getScriptLock();
  const jaTravado = LOCK_HELD_; // trava reentrante (ver withScriptLock_)

  try {
    if (!jaTravado) {
      lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
      LOCK_HELD_ = true;
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    // Leitura e regravação da linha são posicionais: valida e alinha o
    // cabeçalho ANTES de localizar a linha (o realinhamento reescreve a
    // aba e um índice obtido antes ficaria desatualizado).
    prepararAbaParaGravacao_(sheet, sheetName, columns);

    // Encontra a linha do registro pelo ID
    const rowIndex = findRowById(sheet, id);

    if (rowIndex === -1) {
      throw new Error('Registro não encontrado: ' + id);
    }

    // Mescla dados existentes com novos dados
    const existingData = sheet.getRange(rowIndex, 1, 1, columns.length).getValues()[0];
    const existingObj = toObject(existingData, columns);
    
    // Atualiza apenas os campos fornecidos
    Object.keys(data).forEach(function(key) {
      existingObj[key] = data[key];
    });
    
    const rowData = toRowArray(existingObj, columns);
    sheet.getRange(rowIndex, 1, 1, columns.length).setValues([rowData]);
    
    // Invalida cache após escrita
    invalidateCache(sheetName);
    
    Logger.log('Registro atualizado em ' + sheetName + ': ' + id);
    return true;
  } catch (e) {
    Logger.log('Erro ao atualizar em ' + sheetName + ': ' + e.message);
    throw new Error('Erro ao atualizar registro: ' + e.message);
  } finally {
    if (!jaTravado) {
      LOCK_HELD_ = false;
      try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
    }
  }
}

/**
 * Remove um registro por ID.
 * Utiliza LockService para garantir concorrência segura.
 * @param {string} sheetName - Nome da planilha
 * @param {string} id - ID do registro a remover
 * @returns {boolean} true se removido com sucesso
 */
function remove(sheetName, id) {
  const lock = LockService.getScriptLock();
  const jaTravado = LOCK_HELD_; // trava reentrante (ver withScriptLock_)

  try {
    if (!jaTravado) {
      lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
      LOCK_HELD_ = true;
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    // A exclusão também é POSICIONAL: findRowById procura o Id na coluna
    // A e deleteRow apaga a linha inteira. Com o cabeçalho desalinhado, a
    // busca poderia apontar a linha errada — e uma exclusão é
    // irreversível. Por isso a estrutura é validada antes.
    prepararAbaParaGravacao_(sheet, sheetName, getColumnsForSheet(sheetName));

    const rowIndex = findRowById(sheet, id);

    if (rowIndex === -1) {
      throw new Error('Registro não encontrado: ' + id);
    }

    sheet.deleteRow(rowIndex);
    
    // Invalida cache após escrita
    invalidateCache(sheetName);
    
    Logger.log('Registro removido de ' + sheetName + ': ' + id);
    return true;
  } catch (e) {
    Logger.log('Erro ao remover de ' + sheetName + ': ' + e.message);
    throw new Error('Erro ao remover registro: ' + e.message);
  } finally {
    if (!jaTravado) {
      LOCK_HELD_ = false;
      try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
    }
  }
}

/**
 * Insere múltiplos registros de uma vez (batch).
 * Mais eficiente que inserir um por um.
 * @param {string} sheetName - Nome da planilha
 * @param {Object[]} dataArray - Array de objetos a inserir
 * @returns {number} Número de registros inseridos
 */
function batchInsert(sheetName, dataArray) {
  const lock = LockService.getScriptLock();
  const jaTravado = LOCK_HELD_; // trava reentrante (ver withScriptLock_)

  try {
    if (!jaTravado) {
      lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
      LOCK_HELD_ = true;
    }

    if (!dataArray || dataArray.length === 0) return 0;
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    // A gravação em lote também é POSICIONAL (setValues na ordem de
    // COLUMNS). Sem esta validação, uma aba desalinhada (ex.: coluna
    // inserida manualmente) receberia as linhas do Histórico deslocadas,
    // silenciosamente.
    prepararAbaParaGravacao_(sheet, sheetName, columns);

    const rows = dataArray.map(function(data) {
      return toRowArray(data, columns);
    });
    
    // Insere todas as linhas de uma vez
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, columns.length).setValues(rows);
    
    // Invalida cache após escrita
    invalidateCache(sheetName);
    
    Logger.log('Batch insert em ' + sheetName + ': ' + rows.length + ' registros');
    return rows.length;
  } catch (e) {
    Logger.log('Erro em batchInsert(' + sheetName + '): ' + e.message);
    throw new Error('Erro ao inserir registros em lote: ' + e.message);
  } finally {
    if (!jaTravado) {
      LOCK_HELD_ = false;
      try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
    }
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES INTERNAS
// ============================================================================

/**
 * Encontra o número da linha (1-indexed) de um registro pelo ID.
 * O ID é sempre a primeira coluna.
 * @param {Sheet} sheet - Objeto Sheet do Google Sheets
 * @param {string} id - ID a procurar
 * @returns {number} Número da linha (1-indexed) ou -1 se não encontrado
 */
function findRowById(sheet, id) {
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return -1;
    
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        return i + 2; // +2 porque: +1 pelo cabeçalho, +1 porque array é 0-indexed
      }
    }
    
    return -1;
  } catch (e) {
    Logger.log('Erro ao buscar linha por ID: ' + e.message);
    return -1;
  }
}

/**
 * Retorna o array de colunas correspondente a uma planilha.
 * @param {string} sheetName - Nome da planilha
 * @returns {string[]} Array de nomes de colunas
 */
function getColumnsForSheet(sheetName) {
  const mapping = {};
  mapping[CONFIG.SHEET_NAMES.RECLAME_AQUI]   = COLUMNS.ATENDIMENTOS;
  mapping[CONFIG.SHEET_NAMES.SAC_PREVENTIVO] = COLUMNS.ATENDIMENTOS;
  mapping[CONFIG.SHEET_NAMES.CANAIS]         = COLUMNS.CANAIS; // v4.2
  mapping[CONFIG.SHEET_NAMES.CONFIG_CAMPOS]  = COLUMNS.CONFIG_CAMPOS;
  mapping[CONFIG.SHEET_NAMES.TIMELINE]       = COLUMNS.TIMELINE;
  mapping[CONFIG.SHEET_NAMES.HISTORICO]      = COLUMNS.HISTORICO;
  mapping[CONFIG.SHEET_NAMES.USUARIOS]       = COLUMNS.USUARIOS;
  mapping[CONFIG.SHEET_NAMES.PRODUTOS]       = COLUMNS.PRODUTOS;
  mapping[CONFIG.SHEET_NAMES.CATEGORIAS]     = COLUMNS.CATEGORIAS;
  mapping[CONFIG.SHEET_NAMES.SUBCATEGORIAS]  = COLUMNS.SUBCATEGORIAS; // v4.6
  mapping[CONFIG.SHEET_NAMES.INDICADORES_SLA] = COLUMNS.INDICADORES_SLA; // v4.7

  return mapping[sheetName] || [];
}

/**
 * Garante que a aba possui esquema de colunas definido ANTES de gravar.
 *
 * Por que existe: getColumnsForSheet devolve uma lista vazia quando a aba
 * não está mapeada. Sem esta verificação, a gravação seguia adiante e
 * falhava mais à frente com a mensagem genérica do appendRow ("a linha não
 * pode vir vazia"), que não indica a causa real. O cenário típico é o
 * projeto do Apps Script ficar dessincronizado — por exemplo, Config.gs
 * atualizado (SHEET_NAMES/COLUMNS) mas Database.gs ainda na versão
 * anterior (sem o mapeamento da aba nova).
 *
 * É apenas defensiva: quando o esquema está correto, não altera nada.
 * @param {string} sheetName - Nome da aba de destino.
 * @param {string[]} columns - Colunas devolvidas por getColumnsForSheet.
 * @throws {Error} Quando a aba não possui esquema mapeado.
 */
function assertColumnsForSheet_(sheetName, columns) {
  if (!columns || columns.length === 0) {
    throw new Error('Esquema não encontrado para a aba "' + sheetName +
      '". Verifique se Config.gs (SHEET_NAMES/COLUMNS) e Database.gs ' +
      '(getColumnsForSheet) estão atualizados no projeto do Apps Script.');
  }
}
