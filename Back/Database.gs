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

    // Sem planilha apontada o sistema PARA. Antes ele criava uma planilha
    // nova aqui e gravava o id nas propriedades — silenciosamente, no meio de
    // uma requisição qualquer. Quem visse o sistema "vazio" estaria olhando
    // uma base recém-criada, não a de produção.
    throw new Error('ESTRUTURA: nenhuma planilha está apontada para este projeto e ' +
      'não há planilha ativa. Aponte a base com configurarPlanilha(\'<id>\') no editor ' +
      'do Apps Script. Nenhuma planilha foi criada.');
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
 * Confere se a planilha apontada tem uma estrutura que o sistema sabe operar.
 *
 * ⚠️ ESTA FUNÇÃO NÃO ESCREVE NADA. NUNCA.
 * Ela rodava na abertura do sistema e, quando a versão do esquema divergia,
 * chamava o inicializador do modelo 4.x: criava 11 abas antigas, renomeava
 * abas por apelido, reconstruía cabeçalhos e apagava abas ditas obsoletas —
 * uma delas chamada "Configurações", que no PGO 5.0 é uma das cinco abas
 * oficiais. Bastava a Script Property da versão se perder para a planilha de
 * produção ser reestruturada na primeira visita.
 *
 * A regra do produto é a oposta: estrutura existente é validada, jamais
 * alterada automaticamente. Se o que está lá não serve, o sistema para e
 * diz o que encontrou, em vez de tentar "consertar".
 *
 * Criar estrutura continua existindo, mas só como ação explícita, isolada e
 * protegida, executada de propósito no editor do Apps Script sobre uma
 * planilha nova (ver inicializarPGO5Dev em Pgo5.gs).
 *
 * @throws {Error} 'ESTRUTURA: ...' quando a planilha não é operável.
 */
function ensureDatabaseReady() {
  // Base PGO 5.0 completa e com os cabeçalhos no contrato: é o caso normal.
  if (estruturaEhPGO5_()) return;

  // Qualquer outra coisa: o sistema não opera e não mexe. A mensagem precisa
  // dizer o que fazer, porque quem lê está com o sistema parado.
  const estrutura = (typeof detectarEstruturaBanco_ === 'function')
    ? detectarEstruturaBanco_(true) : 'DESCONHECIDO';
  throw new Error('ESTRUTURA: esta planilha não tem as cinco abas do PGO ' +
    (typeof PGO5 !== 'undefined' ? PGO5.SCHEMA_VERSION : '5.0') +
    ' com os cabeçalhos esperados (estrutura detectada: ' + estrutura + '). ' +
    'O sistema não altera a planilha por conta própria: nenhuma aba foi criada, ' +
    'renomeada ou apagada. Se esta é uma instalação NOVA, execute ' +
    'inicializarPGO5Dev() no editor do Apps Script sobre uma planilha vazia. ' +
    'Se esta é a base de produção, confira se alguma aba foi renomeada ou se o ' +
    'cabeçalho da primeira linha foi alterado — e restaure-o antes de reabrir.');
}

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

  // 2. Aba sem cabeçalho: o sistema não escreve cabeçalho em aba de produção.
  if (lastRow === 0 || lastCol === 0) {
    throw new Error('ESTRUTURA: a aba "' + sheetName + '" está sem cabeçalho. ' +
      'A gravação foi cancelada — o sistema não cria nem reconstrói cabeçalho ' +
      'automaticamente. Escreva a primeira linha com os nomes de coluna esperados.');
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

  // 5. FAIL CLOSED — desalinhado.
  // Aqui a rotina reescrevia o cabeçalho e remanejava as colunas da aba,
  // criando de quebra uma aba de backup. Era uma alteração estrutural
  // disparada por uma gravação comum. Agora a gravação para e a decisão
  // volta para quem cuida da planilha.
  const fora = [];
  columns.forEach(function(col, index) {
    if (headers[index] !== col) {
      fora.push('posição ' + (index + 1) + ': esperado "' + col +
        '", encontrado "' + (headers[index] === undefined ? '(vazio)' : headers[index]) + '"');
    }
  });
  throw new Error('ESTRUTURA: o cabeçalho da aba "' + sheetName + '" está fora da ordem ' +
    'esperada. A gravação foi cancelada e nada foi alterado — o sistema não reordena ' +
    'colunas de uma planilha em uso. Divergência(s): ' + fora.slice(0, 5).join('; ') + '.');
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
