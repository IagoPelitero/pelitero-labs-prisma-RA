/**
 * ============================================================================
 * PortoBank Reclame Aqui - Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Database.gs
 * Descrição: Camada de acesso a dados (Data Access Layer).
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

/**
 * Obtém a planilha principal do sistema.
 * Se CONFIG.SPREADSHEET_ID estiver vazio, usa a planilha ativa.
 * @returns {Spreadsheet} Planilha do Google Sheets
 */
function getSpreadsheet() {
  try {
    if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim() !== '') {
      return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    }

    const properties = PropertiesService.getScriptProperties();
    const storedId = properties.getProperty('PORTO_RA_SPREADSHEET_ID');
    if (storedId) {
      return SpreadsheetApp.openById(storedId);
    }

    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      properties.setProperty('PORTO_RA_SPREADSHEET_ID', active.getId());
      return active;
    }

    // Permite que o projeto também funcione como Apps Script independente.
    const created = SpreadsheetApp.create('PortoBank Reclame Aqui - Banco de Dados');
    properties.setProperty('PORTO_RA_SPREADSHEET_ID', created.getId());
    return created;
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
  if (properties.getProperty('PORTO_RA_SCHEMA_VERSION') !== CONFIG.SCHEMA_VERSION) {
    initializeSheets();
    properties.setProperty('PORTO_RA_SCHEMA_VERSION', CONFIG.SCHEMA_VERSION);
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
    
    // Mapeamento de planilha -> colunas -> dados padrão
    const sheetsConfig = [
      { name: CONFIG.SHEET_NAMES.ATENDIMENTOS,     columns: COLUMNS.ATENDIMENTOS,     defaults: [] },
      { name: CONFIG.SHEET_NAMES.TIMELINE,          columns: COLUMNS.TIMELINE,          defaults: [] },
      { name: CONFIG.SHEET_NAMES.HISTORICO,         columns: COLUMNS.HISTORICO,         defaults: [] },
      { name: CONFIG.SHEET_NAMES.USUARIOS,          columns: COLUMNS.USUARIOS,          defaults: [] },
      { name: CONFIG.SHEET_NAMES.PRODUTOS,          columns: COLUMNS.PRODUTOS,          defaults: DEFAULT_PRODUTOS },
      { name: CONFIG.SHEET_NAMES.CATEGORIAS,        columns: COLUMNS.CATEGORIAS,        defaults: DEFAULT_CATEGORIAS },
      { name: CONFIG.SHEET_NAMES.STATUS_CONFIG,     columns: COLUMNS.STATUS_CONFIG,     defaults: DEFAULT_STATUS },
      { name: CONFIG.SHEET_NAMES.PRIORIDADES,       columns: COLUMNS.PRIORIDADES,       defaults: DEFAULT_PRIORIDADES },
      { name: CONFIG.SHEET_NAMES.CANAIS,            columns: COLUMNS.CANAIS,            defaults: DEFAULT_CANAIS },
      { name: CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO, columns: COLUMNS.TIPOS_ATENDIMENTO, defaults: DEFAULT_TIPOS_ATENDIMENTO },
      { name: CONFIG.SHEET_NAMES.SLAS,              columns: COLUMNS.SLAS,              defaults: [] },
      { name: CONFIG.SHEET_NAMES.MOTIVOS_PENDENCIA, columns: COLUMNS.MOTIVOS_PENDENCIA, defaults: DEFAULT_MOTIVOS_PENDENCIA },
      { name: CONFIG.SHEET_NAMES.DASHBOARD,         columns: COLUMNS.DASHBOARD,         defaults: [] },
      { name: CONFIG.SHEET_NAMES.RELATORIOS,        columns: COLUMNS.RELATORIOS,        defaults: [] },
      { name: CONFIG.SHEET_NAMES.CONFIGURACOES,     columns: COLUMNS.CONFIGURACOES,     defaults: DEFAULT_CONFIGURACOES }
    ];
    
    sheetsConfig.forEach(function(cfg) {
      let sheet = ss.getSheetByName(cfg.name);
      if (!sheet) {
        const legacyNames = {
          'Histórico': ['Historico'],
          'Usuários': ['Usuarios'],
          'Status': ['StatusConfig'],
          'Relatórios': ['Relatorios'],
          'Configurações': ['Configuracoes']
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

    bootstrapSupervisor_();
    removeDefaultBlankSheet_(ss);
    invalidateAllCache();
    PropertiesService.getScriptProperties().setProperty('PORTO_RA_SCHEMA_VERSION', CONFIG.SCHEMA_VERSION);
    
    Logger.log('Inicialização das planilhas concluída com sucesso.');
  } catch (e) {
    Logger.log('Erro na inicialização das planilhas: ' + e.message);
    throw new Error('Erro ao inicializar planilhas: ' + e.message);
  }
}

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
 * Cadastra o primeiro usuário como supervisor para viabilizar a configuração inicial.
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

  const nome = email ? email.split('@')[0] : 'Supervisor inicial';
  const user = {
    Id: generateId('USR'),
    Nome: nome,
    Email: email,
    Perfil: 'Supervisor',
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
 * @param {string} sheetName - Nome da planilha
 * @returns {string} Chave de cache
 */
function getCacheKey(sheetName) {
  return 'PORTO_RA_' + sheetName;
}

/**
 * Invalida (remove) o cache de uma planilha específica.
 * Deve ser chamada após qualquer operação de escrita.
 * @param {string} sheetName - Nome da planilha
 */
function invalidateCache(sheetName) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(getCacheKey(sheetName));
    Logger.log('Cache invalidado para: ' + sheetName);
  } catch (e) {
    Logger.log('Erro ao invalidar cache: ' + e.message);
  }
}

/**
 * Invalida o cache de todas as planilhas.
 */
function invalidateAllCache() {
  try {
    const cache = CacheService.getScriptCache();
    const keys = Object.values(CONFIG.SHEET_NAMES).map(function(name) {
      return getCacheKey(name);
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
 * Lê todos os dados de uma planilha, utilizando cache quando disponível.
 * Os dados são armazenados em cache por CONFIG.CACHE_TTL segundos.
 * @param {string} sheetName - Nome da planilha
 * @returns {Array[]} Array bidimensional com os dados (incluindo cabeçalho)
 */
function getSheetData(sheetName) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = getCacheKey(sheetName);
    const cached = cache.get(cacheKey);
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (parseError) {
        Logger.log('Erro ao parsear cache, lendo da planilha: ' + parseError.message);
      }
    }
    
    // Lê da planilha
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      Logger.log('Planilha não encontrada: ' + sheetName);
      return [];
    }
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    if (lastRow === 0 || lastCol === 0) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    
    // Tenta cachear (limite de 100KB por chave do CacheService)
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
    Logger.log('Erro ao ler dados de ' + sheetName + ': ' + e.message);
    return [];
  }
}

/**
 * Obtém todos os registros de uma planilha como array de objetos.
 * Exclui a linha de cabeçalho e converte cada linha para objeto.
 * @param {string} sheetName - Nome da planilha
 * @returns {Object[]} Array de objetos com os dados
 */
function getAll(sheetName) {
  try {
    const data = getSheetData(sheetName);
    
    if (data.length <= 1) return []; // Sem dados (só cabeçalho ou vazio)
    
    // Obtém as colunas definidas para esta planilha
    const columns = getColumnsForSheet(sheetName);
    
    // Converte cada linha (exceto cabeçalho) para objeto
    const records = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Ignora linhas completamente vazias
      if (row.every(function(cell) { return cell === '' || cell === null || cell === undefined; })) continue;
      records.push(toObject(row, columns));
    }
    
    return records;
  } catch (e) {
    Logger.log('Erro em getAll(' + sheetName + '): ' + e.message);
    return [];
  }
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
    
    // Encontra a linha do registro pelo ID
    const rowIndex = findRowById(sheet, id);
    
    if (rowIndex === -1) {
      throw new Error('Registro não encontrado: ' + id);
    }
    
    const columns = getColumnsForSheet(sheetName);
    
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
  mapping[CONFIG.SHEET_NAMES.ATENDIMENTOS]     = COLUMNS.ATENDIMENTOS;
  mapping[CONFIG.SHEET_NAMES.TIMELINE]          = COLUMNS.TIMELINE;
  mapping[CONFIG.SHEET_NAMES.HISTORICO]         = COLUMNS.HISTORICO;
  mapping[CONFIG.SHEET_NAMES.USUARIOS]          = COLUMNS.USUARIOS;
  mapping[CONFIG.SHEET_NAMES.PRODUTOS]          = COLUMNS.PRODUTOS;
  mapping[CONFIG.SHEET_NAMES.CATEGORIAS]        = COLUMNS.CATEGORIAS;
  mapping[CONFIG.SHEET_NAMES.STATUS_CONFIG]     = COLUMNS.STATUS_CONFIG;
  mapping[CONFIG.SHEET_NAMES.PRIORIDADES]       = COLUMNS.PRIORIDADES;
  mapping[CONFIG.SHEET_NAMES.CANAIS]            = COLUMNS.CANAIS;
  mapping[CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO] = COLUMNS.TIPOS_ATENDIMENTO;
  mapping[CONFIG.SHEET_NAMES.SLAS]              = COLUMNS.SLAS;
  mapping[CONFIG.SHEET_NAMES.MOTIVOS_PENDENCIA] = COLUMNS.MOTIVOS_PENDENCIA;
  mapping[CONFIG.SHEET_NAMES.DASHBOARD]         = COLUMNS.DASHBOARD;
  mapping[CONFIG.SHEET_NAMES.RELATORIOS]        = COLUMNS.RELATORIOS;
  mapping[CONFIG.SHEET_NAMES.CONFIGURACOES]     = COLUMNS.CONFIGURACOES;
  
  return mapping[sheetName] || [];
}
