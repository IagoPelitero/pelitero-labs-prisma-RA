/**
 * ============================================================================
 * Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos
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
// INICIALIZAÇÃO DAS PLANILHAS
// ============================================================================

/**
 * Executa a migração de estrutura somente quando a versão do esquema muda.
 */
function ensureDatabaseReady() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(PROPERTY_KEYS.SCHEMA_VERSION) !== CONFIG.SCHEMA_VERSION) {
    initializeSheets();
    properties.setProperty(PROPERTY_KEYS.SCHEMA_VERSION, CONFIG.SCHEMA_VERSION);
  }
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
    Logger.log('Usuário promovido a ADM: ' + supervisor.Nome);
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
 * Atualiza o esquema de uma aba preservando os dados pelas chaves do cabeçalho.
 * Isso permite evoluir o sistema sem deslocar dados de instalações anteriores.
 */
function ensureSheetSchema_(sheet, columns) {
  if (!columns || columns.length === 0) return;

  if (sheet.getMaxColumns() < columns.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let rows = [];

  if (lastRow > 0 && lastCol > 0) {
    const existing = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const oldHeaders = existing[0].map(function(value) { return String(value); });
    const sameSchema = oldHeaders.length === columns.length && oldHeaders.every(function(value, index) {
      return value === columns[index];
    });

    if (!sameSchema && existing.length > 1) {
      rows = existing.slice(1).map(function(row) {
        const record = {};
        oldHeaders.forEach(function(header, index) {
          if (header) record[header] = row[index];
        });
        return toRowArray(record, columns);
      });
      sheet.clearContents();
    }
  }

  sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, columns.length).setValues(rows);
  }

  const headerRange = sheet.getRange(1, 1, 1, columns.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#0046C0');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
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

  // ── 1. Tenta o cache (somente se não for refresh forçado) ──
  if (!forceRefresh) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (isCacheValido_(parsed, sheetName)) {
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
        return []; // aba realmente vazia (sem cabeçalho): não há o que ler
      }

      const data = sheet.getDataRange().getValues();

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
  try {
    if (!id) return null;
    
    const records = getAll(sheetName);
    const record = records.find(function(r) {
      return String(r.Id) === String(id);
    });
    
    return record || null;
  } catch (e) {
    Logger.log('Erro em getById(' + sheetName + ', ' + id + '): ' + e.message);
    return null;
  }
}

/**
 * Obtém registros filtrados por um campo específico.
 * @param {string} sheetName - Nome da planilha
 * @param {string} field - Nome do campo a filtrar
 * @param {*} value - Valor a buscar
 * @returns {Object[]} Array de registros correspondentes
 */
function getByField(sheetName, field, value) {
  try {
    const records = getAll(sheetName);
    return records.filter(function(r) {
      return String(r[field]) === String(value);
    });
  } catch (e) {
    Logger.log('Erro em getByField(' + sheetName + ', ' + field + '): ' + e.message);
    return [];
  }
}

/**
 * Obtém dados filtrados por múltiplos critérios.
 * @param {string} sheetName - Nome da planilha
 * @param {Object} filters - Objeto com pares {campo: valor}
 * @returns {Object[]} Array de registros correspondentes
 */
function getFilteredData(sheetName, filters) {
  try {
    let records = getAll(sheetName);
    
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
  } catch (e) {
    Logger.log('Erro em getFilteredData(' + sheetName + '): ' + e.message);
    return [];
  }
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
 * Insere um novo registro na planilha.
 * Utiliza LockService para garantir concorrência segura.
 * @param {string} sheetName - Nome da planilha
 * @param {Object} data - Objeto com os dados a inserir
 * @returns {string} ID do registro inserido
 */
function insert(sheetName, data) {
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    assertColumnsForSheet_(sheetName, columns);
    // Gravação é posicional: garante o alinhamento do cabeçalho antes.
    ensureAlignedHeaders_(sheet, sheetName, columns);
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
    try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
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
  
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    assertColumnsForSheet_(sheetName, columns);
    // Leitura e regravação da linha são posicionais: alinha o cabeçalho
    // ANTES de localizar a linha (o realinhamento pode mover linhas).
    ensureAlignedHeaders_(sheet, sheetName, columns);

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
    try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
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
  
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
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
    try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
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
  
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    
    if (!dataArray || dataArray.length === 0) return 0;
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error('Planilha não encontrada: ' + sheetName);
    }
    
    const columns = getColumnsForSheet(sheetName);
    assertColumnsForSheet_(sheetName, columns);

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
    try { lock.releaseLock(); } catch (unlockErr) { /* ignora */ }
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
