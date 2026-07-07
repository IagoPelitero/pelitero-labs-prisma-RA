/**
 * ============================================================================
 * PortoBank Reclame Aqui - Camada de serviços
 * ============================================================================
 * Regras de negócio, validação, SLA, timeline, indicadores, relatórios e
 * administração das configurações. Todas as funções públicas deste arquivo
 * podem ser chamadas pelo frontend com google.script.run.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO (leia antes de mexer neste arquivo)
 * ------------------------------------------------------------------------
 * Este é o arquivo mais "cheio de regras" do sistema — é aqui que ficam as
 * decisões de negócio (ex: "como calcular o SLA", "o que pode ou não ser
 * editado", "quem pode excluir um usuário"). Se Database.gs é a ponte com
 * a planilha, este arquivo é o "cérebro" que decide o que fazer com os
 * dados antes de salvar ou depois de ler.
 *
 * Como o frontend (os arquivos .html) conversa com este arquivo:
 *   No navegador, o JavaScript chama algo como:
 *     google.script.run.withSuccessHandler(...).salvarAtendimento(dados)
 *   O Google Apps Script então executa a função salvarAtendimento(dados)
 *   definida aqui no servidor e devolve o resultado para o navegador.
 *   Ou seja: toda função "pública" (sem "_" no final do nome) deste
 *   arquivo é uma porta de entrada que o frontend pode chamar.
 *
 * Convenção de nomes usada neste arquivo:
 *   - Funções SEM "_" no final (ex: getAtendimentos) → podem ser chamadas
 *     pelo frontend.
 *   - Funções COM "_" no final (ex: validateAtendimentoInput_) → são
 *     "internas", só usadas por outras funções deste mesmo arquivo,
 *     nunca chamadas diretamente pela tela.
 *
 * Tarefas comuns de manutenção:
 *   - Nova regra de validação de um atendimento → função
 *     validateAtendimentoInput_().
 *   - Mudar como o SLA é calculado → funções calcularSLA(),
 *     calcularVencimentoSLA() e resolveSLA_().
 *   - Nova métrica no dashboard/indicadores → getDashboardData() e
 *     getIndicadores().
 *   - Sempre que uma função "pública" nova for criada aqui, ela pode ser
 *     chamada direto do HTML com google.script.run.nomeDaFuncao(...).
 * ------------------------------------------------------------------------
 */

var SERVICE_CONTEXT_ = {};

// ============================================================================
// INICIALIZAÇÃO E DADOS DE APOIO
// ============================================================================

function getBootstrapData() {
  ensureDatabaseReady();

  const produtos = activeSorted_(CONFIG.SHEET_NAMES.PRODUTOS);
  const categorias = activeSorted_(CONFIG.SHEET_NAMES.CATEGORIAS);
  const status = activeSorted_(CONFIG.SHEET_NAMES.STATUS_CONFIG);
  const prioridades = activeSorted_(CONFIG.SHEET_NAMES.PRIORIDADES);
  const canais = activeSorted_(CONFIG.SHEET_NAMES.CANAIS);
  const tipos = activeSorted_(CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO);
  const motivos = activeSorted_(CONFIG.SHEET_NAMES.MOTIVOS_PENDENCIA);
  const usuarios = activeSorted_(CONFIG.SHEET_NAMES.USUARIOS);

  const produtoPorId = indexBy_(produtos, 'Id');
  const categoriasPorProduto = {};
  categorias.forEach(function(categoria) {
    const produto = produtoPorId[String(categoria.ProdutoId || '')];
    const nomeProduto = produto ? produto.Nome : 'Geral';
    if (!categoriasPorProduto[nomeProduto]) categoriasPorProduto[nomeProduto] = [];
    categoriasPorProduto[nomeProduto].push(String(categoria.Nome || ''));
  });

  return {
    user: getActor_(),
    dropdownData: {
      produtos: pluck_(produtos, 'Nome'),
      categorias: pluck_(categorias, 'Nome'),
      categoriasPorProduto: categoriasPorProduto,
      status: pluck_(status, 'Nome'),
      prioridades: pluck_(prioridades, 'Nome'),
      canais: pluck_(canais, 'Nome'),
      tiposAtendimento: pluck_(tipos, 'Nome'),
      motivosPendencia: pluck_(motivos, 'Nome'),
      responsaveis: pluck_(usuarios, 'Nome'),
      statusCores: keyValue_(status, 'Nome', 'Cor'),
      prioridadeCores: keyValue_(prioridades, 'Nome', 'Cor')
    }
  };
}

function activeSorted_(sheetName) {
  return getAll(sheetName)
    .filter(function(item) {
      return item.Ativo === '' || item.Ativo === null || item.Ativo === undefined || isTrue_(item.Ativo);
    })
    .sort(function(a, b) {
      return Number(a.Ordem || 9999) - Number(b.Ordem || 9999) ||
        String(a.Nome || '').localeCompare(String(b.Nome || ''), 'pt-BR');
    });
}

// ============================================================================
// ATENDIMENTOS - CONSULTAS
// ============================================================================

function getAtendimentos(filtros, pagina, ordenacao) {
  ensureDatabaseReady();
  const actor = getActor_();
  const records = applyAtendimentoFilters_(restrictToOwnerIfNeeded_(getActiveAtendimentos_(), actor), filtros || {});
  const clientRecords = decorateAtendimentos_(records);
  sortClientRecords_(clientRecords, ordenacao || {});

  return {
    dados: clientRecords,
    total: clientRecords.length,
    totalPaginas: Math.max(1, Math.ceil(clientRecords.length / CONFIG.PAGE_SIZE)),
    pagina: Math.max(1, Number(pagina || 1))
  };
}

function getAtendimento(id) {
  ensureDatabaseReady();
  const record = getById(CONFIG.SHEET_NAMES.ATENDIMENTOS, sanitizeInput(id));
  if (!record || isTrue_(record.Excluido)) return null;
  if (!canAccessAtendimento_(record, getActor_())) return null;

  return {
    atendimento: toClientAtendimento_(record, getStatusColorMap_()),
    timeline: getTimeline(id)
  };
}

function pesquisarAtendimentos(termo) {
  ensureDatabaseReady();
  let records = restrictToOwnerIfNeeded_(getActiveAtendimentos_(), getActor_());

  if (typeof termo === 'string' || typeof termo === 'number') {
    const query = normalizeText_(termo);
    if (!query) return [];
    records = records.filter(function(record) {
      return [
        record.Id, record.NumeroRA, record.CPF, record.Cliente, record.Produto,
        record.Categoria, record.Status, record.Responsavel, record.Canal
      ].some(function(value) {
        return normalizeText_(value).indexOf(query) !== -1;
      });
    });
  } else {
    records = applyAtendimentoFilters_(records, termo || {});
  }

  return decorateAtendimentos_(records);
}

function getActiveAtendimentos_() {
  return getAll(CONFIG.SHEET_NAMES.ATENDIMENTOS).filter(function(record) {
    return !isTrue_(record.Excluido);
  });
}

function applyAtendimentoFilters_(records, filtros) {
  const filters = filtros || {};
  const start = parseInputDate_(filters.dataInicio || filters.periodoInicio, false);
  const end = parseInputDate_(filters.dataFim || filters.periodoFim, true);
  const exactFields = {
    produto: 'Produto',
    categoria: 'Categoria',
    status: 'Status',
    prioridade: 'Prioridade',
    canal: 'Canal',
    analista: 'Responsavel',
    responsavel: 'Responsavel',
    tipoAtendimento: 'TipoAtendimento'
  };
  const containsFields = {
    numeroRA: 'NumeroRA',
    cliente: 'Cliente',
    cpf: 'CPF'
  };

  return records.filter(function(record) {
    const opened = asDate_(record.DataAbertura);
    if (start && (!opened || opened < start)) return false;
    if (end && (!opened || opened > end)) return false;

    const exactOk = Object.keys(exactFields).every(function(key) {
      const expected = filters[key];
      return !expected || normalizeText_(record[exactFields[key]]) === normalizeText_(expected);
    });
    if (!exactOk) return false;

    return Object.keys(containsFields).every(function(key) {
      const expected = filters[key];
      return !expected || normalizeText_(record[containsFields[key]]).indexOf(normalizeText_(expected)) !== -1;
    });
  });
}

function sortClientRecords_(records, order) {
  const field = sanitizeInput(order.campo || 'dataAbertura');
  const direction = String(order.direcao || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  records.sort(function(a, b) {
    const av = a[field] === undefined || a[field] === null ? '' : a[field];
    const bv = b[field] === undefined || b[field] === null ? '' : b[field];
    const ad = field.toLowerCase().indexOf('data') !== -1 ? asDate_(av) : null;
    const bd = field.toLowerCase().indexOf('data') !== -1 ? asDate_(bv) : null;
    if (ad && bd) return (ad.getTime() - bd.getTime()) * direction;
    return String(av).localeCompare(String(bv), 'pt-BR', { numeric: true }) * direction;
  });
}

// ============================================================================
// ATENDIMENTOS - ESCRITA E REGRAS
// ============================================================================

function salvarAtendimento(dados) {
  ensureDatabaseReady();
  const input = validateAtendimentoInput_(dados || {});
  assertUniqueNumeroRA_(input.numeroRA, '');

  const actor = getActor_();
  // Analista não escolhe responsável: o sistema identifica automaticamente
  // quem está criando o atendimento. Apenas o Supervisor pode escolher outro.
  if (!isSupervisorProfile_(actor.perfil) || !input.responsavel) {
    input.responsavel = actor.nome;
  }
  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || now;
  const sla = resolveSLA_(
    input.produto,
    input.categoria,
    input.canal,
    input.tipoAtendimento,
    input.prioridade,
    opening
  );
  const slaHours = input.slaHoras ? Number(input.slaHoras) : sla.slaHoras;
  const dueDate = parseInputDate_(input.dataPrevista, true) || addBusinessHours(opening, slaHours);
  const waiting = isWaitingStatus_(input.status);
  const finalStatus = isFinalStatus_(input.status);
  const resolutionDate = finalStatus ? now : '';

  const record = {
    Id: generateId('ATD'),
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    DataRecebimento: now,
    Canal: input.canal,
    TipoAtendimento: input.tipoAtendimento,
    Cliente: input.cliente,
    CPF: input.cpf,
    Telefone: input.telefone,
    Email: input.email,
    Produto: input.produto,
    Categoria: input.categoria,
    Subcategoria: input.subcategoria,
    Assunto: input.assunto,
    Descricao: input.descricao,
    Status: input.status,
    Prioridade: input.prioridade,
    Responsavel: input.responsavel,
    SLAHoras: slaHours,
    DataVencimentoSLA: dueDate,
    StatusSLA: calculateSLAStatus_(dueDate, resolutionDate || now),
    DataInicioEspera: waiting ? now : '',
    TempoEsperaAcumulado: 0,
    MotivoPendencia: input.motivoPendencia,
    DataResolucao: resolutionDate,
    TempoResolucaoHoras: finalStatus ? calculateBusinessHours(opening, now) : '',
    Resolucao: input.resolucao,
    NotaConsumidor: input.notaConsumidor,
    Avaliacao: input.avaliacao,
    Observacoes: input.observacoes,
    CriadoPor: actor.nome,
    DataCriacao: now,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now,
    Excluido: false,
    ExcluidoPor: '',
    DataExclusao: ''
  };

  insertAtendimentoUnique_(record);
  insertTimeline_(record.Id, 'Criação', 'Atendimento criado.', '', input.status, actor.nome, '');

  if (waiting) {
    insertWaitTimeline_(record, 'Espera iniciada', now, 0, actor.nome);
  }

  return { success: true, id: record.Id };
}

function atualizarAtendimento(id, dados, justificativa) {
  ensureDatabaseReady();
  const safeId = sanitizeInput(id);
  const oldRecord = getById(CONFIG.SHEET_NAMES.ATENDIMENTOS, safeId);
  if (!oldRecord || isTrue_(oldRecord.Excluido)) throw new Error('Atendimento não encontrado.');

  const actor = getActor_();
  if (!canAccessAtendimento_(oldRecord, actor)) {
    throw new Error('Você não tem permissão para editar este atendimento.');
  }

  const input = validateAtendimentoInput_(dados || {});
  assertUniqueNumeroRA_(input.numeroRA, safeId);

  // Analista não escolhe responsável: mantém o responsável atual. Apenas o
  // Supervisor pode reatribuir o atendimento a outro analista.
  if (!isSupervisorProfile_(actor.perfil) || !input.responsavel) {
    input.responsavel = oldRecord.Responsavel || actor.nome;
  }
  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || asDate_(oldRecord.DataAbertura) || now;
  const previousSla = Number(oldRecord.SLAHoras || 0);
  const slaHours = input.slaHoras ? Number(input.slaHoras) : previousSla;
  const slaChanged = previousSla !== slaHours;
  const safeJustification = sanitizeInput(justificativa);

  if (slaChanged && !safeJustification) {
    throw new Error('A justificativa é obrigatória para alteração do SLA.');
  }

  let dueDate = parseInputDate_(input.dataPrevista, true);
  if (!dueDate) {
    dueDate = slaChanged
      ? addBusinessHours(opening, slaHours)
      : (asDate_(oldRecord.DataVencimentoSLA) || addBusinessHours(opening, slaHours));
  }

  const oldWaiting = isWaitingStatus_(oldRecord.Status);
  const newWaiting = isWaitingStatus_(input.status);
  const statusChanged = normalizeText_(oldRecord.Status) !== normalizeText_(input.status);
  let waitStart = oldRecord.DataInicioEspera;
  let accumulatedWait = Number(oldRecord.TempoEsperaAcumulado || 0);
  let finishedWait = null;

  if (oldWaiting && (!newWaiting || statusChanged)) {
    const start = asDate_(oldRecord.DataInicioEspera);
    const elapsed = start ? Math.max(0, diffInHours(start, now)) : 0;
    accumulatedWait += elapsed;
    finishedWait = { record: oldRecord, elapsed: elapsed };
    waitStart = '';
  }
  if (newWaiting && (!oldWaiting || statusChanged)) {
    waitStart = now;
  }

  const wasFinal = isFinalStatus_(oldRecord.Status);
  const isFinal = isFinalStatus_(input.status);
  let resolutionDate = oldRecord.DataResolucao;
  let resolutionHours = oldRecord.TempoResolucaoHoras;
  if (isFinal && !wasFinal) {
    resolutionDate = now;
    resolutionHours = calculateBusinessHours(opening, now);
  } else if (!isFinal && wasFinal) {
    resolutionDate = '';
    resolutionHours = '';
  }

  const updates = {
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    Canal: input.canal,
    TipoAtendimento: input.tipoAtendimento,
    Cliente: input.cliente,
    CPF: input.cpf,
    Telefone: input.telefone,
    Email: input.email,
    Produto: input.produto,
    Categoria: input.categoria,
    Subcategoria: input.subcategoria,
    Assunto: input.assunto,
    Descricao: input.descricao,
    Status: input.status,
    Prioridade: input.prioridade,
    Responsavel: input.responsavel,
    SLAHoras: slaHours,
    DataVencimentoSLA: dueDate,
    StatusSLA: calculateSLAStatus_(dueDate, resolutionDate || now),
    DataInicioEspera: waitStart,
    TempoEsperaAcumulado: Math.round(accumulatedWait * 100) / 100,
    MotivoPendencia: input.motivoPendencia,
    DataResolucao: resolutionDate,
    TempoResolucaoHoras: resolutionHours,
    Resolucao: input.resolucao,
    NotaConsumidor: input.notaConsumidor,
    Avaliacao: input.avaliacao,
    Observacoes: input.observacoes,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now
  };

  const history = buildChangeHistory_(safeId, oldRecord, updates, actor.nome, safeJustification);
  updateAtendimentoUnique_(safeId, updates);

  if (history.length > 0) {
    batchInsert(CONFIG.SHEET_NAMES.HISTORICO, history);
    insertTimeline_(
      safeId,
      'Atualização',
      history.length + ' campo(s) alterado(s). ' + (safeJustification || ''),
      '',
      '',
      actor.nome,
      ''
    );
  }

  if (finishedWait) {
    insertWaitTimeline_(finishedWait.record, 'Espera finalizada', now, finishedWait.elapsed, actor.nome);
  }

  if (statusChanged) {
    insertTimeline_(safeId, isFinal ? 'Encerramento' : 'Mudança de status',
      'Status alterado.', oldRecord.Status, input.status, actor.nome, safeJustification);
  }
  if (slaChanged) {
    insertTimeline_(safeId, 'Alteração de SLA', 'SLA alterado com justificativa.',
      String(previousSla) + 'h', String(slaHours) + 'h', actor.nome, safeJustification);
  }
  if (String(oldRecord.Responsavel || '') !== String(input.responsavel || '')) {
    insertTimeline_(safeId, 'Alteração de responsável', 'Responsável alterado.',
      oldRecord.Responsavel, input.responsavel, actor.nome, safeJustification);
  }
  if (newWaiting && (!oldWaiting || statusChanged)) {
    const waitRecord = Object.assign({}, oldRecord, updates);
    insertWaitTimeline_(waitRecord, 'Espera iniciada', now, 0, actor.nome);
  }

  return { success: true, id: safeId };
}

function excluirAtendimento(id) {
  ensureDatabaseReady();
  const safeId = sanitizeInput(id);
  const record = getById(CONFIG.SHEET_NAMES.ATENDIMENTOS, safeId);
  if (!record || isTrue_(record.Excluido)) return { success: false, message: 'Atendimento não encontrado.' };

  const actor = getActor_();
  if (!canAccessAtendimento_(record, actor)) {
    throw new Error('Você não tem permissão para excluir este atendimento.');
  }
  const now = new Date();
  insertTimeline_(safeId, 'Exclusão', 'Atendimento excluído. A timeline foi preservada.',
    '', '', actor.nome, '');
  insert(CONFIG.SHEET_NAMES.HISTORICO, {
    Id: generateId('HIS'),
    AtendimentoId: safeId,
    Data: now,
    Acao: 'Exclusão',
    Campo: '',
    ValorAnterior: '',
    ValorNovo: '',
    Usuario: actor.nome,
    Justificativa: 'Exclusão solicitada pela interface.'
  });

  // Exclusão lógica mantém rastreabilidade e permite auditoria futura.
  update(CONFIG.SHEET_NAMES.ATENDIMENTOS, safeId, {
    Excluido: true,
    ExcluidoPor: actor.nome,
    DataExclusao: now,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now
  });

  return { success: true };
}

function adicionarObservacao(atendimentoId, texto) {
  ensureDatabaseReady();
  const id = sanitizeInput(atendimentoId);
  const observation = sanitizeInput(texto);
  if (!observation) throw new Error('A observação não pode ficar vazia.');
  const record = getById(CONFIG.SHEET_NAMES.ATENDIMENTOS, id);
  if (!record || isTrue_(record.Excluido)) throw new Error('Atendimento não encontrado.');

  const actor = getActor_();
  insertTimeline_(id, 'Observação', observation, '', '', actor.nome, '');
  update(CONFIG.SHEET_NAMES.ATENDIMENTOS, id, {
    AtualizadoPor: actor.nome,
    DataAtualizacao: new Date()
  });
  return { success: true };
}

function validateAtendimentoInput_(dados) {
  const input = {
    numeroRA: sanitizeInput(dados.numeroRA),
    cliente: sanitizeInput(dados.cliente),
    cpf: sanitizeInput(dados.cpf),
    telefone: sanitizeInput(dados.telefone),
    email: sanitizeInput(dados.email),
    produto: sanitizeInput(dados.produto),
    categoria: sanitizeInput(dados.categoria),
    canal: sanitizeInput(dados.canal),
    tipoAtendimento: sanitizeInput(dados.tipoAtendimento) || 'Reclamação',
    responsavel: sanitizeInput(dados.responsavel),
    prioridade: sanitizeInput(dados.prioridade),
    status: sanitizeInput(dados.status),
    descricao: sanitizeInput(dados.descricao),
    observacoes: sanitizeInput(dados.observacoes),
    dataAbertura: sanitizeInput(dados.dataAbertura),
    dataPrevista: sanitizeInput(dados.dataPrevista),
    slaHoras: sanitizeInput(dados.slaHoras),
    motivoPendencia: sanitizeInput(dados.motivoPendencia),
    subcategoria: sanitizeInput(dados.subcategoria),
    assunto: sanitizeInput(dados.assunto),
    resolucao: sanitizeInput(dados.resolucao),
    notaConsumidor: sanitizeInput(dados.notaConsumidor),
    avaliacao: sanitizeInput(dados.avaliacao)
  };

  const required = {
    numeroRA: 'Protocolo',
    cliente: 'Nome',
    produto: 'Produto',
    canal: 'Canal',
    status: 'Status'
  };
  Object.keys(required).forEach(function(key) {
    if (!input[key]) throw new Error(required[key] + ' é obrigatório.');
  });

  if (input.cpf && !validateCPF(input.cpf)) throw new Error('CPF inválido.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error('E-mail inválido.');
  if (input.slaHoras && (!isFinite(Number(input.slaHoras)) || Number(input.slaHoras) <= 0 || Number(input.slaHoras) > 8760)) {
    throw new Error('O SLA deve ser um número entre 1 e 8760 horas.');
  }
  if (isWaitingStatus_(input.status) && !input.motivoPendencia) {
    throw new Error('"Aguardando Retorno de" é obrigatório quando o Status é "Pendente".');
  }

  // Todos os atendimentos da célula de Reclame Aqui são tratados como
  // Urgentes automaticamente — o usuário nunca escolhe nem vê a prioridade.
  input.prioridade = 'Urgente';

  input.cpf = input.cpf ? formatCPF(input.cpf) : '';
  return input;
}

function assertUniqueNumeroRA_(numeroRA, ignoredId) {
  const normalized = normalizeText_(numeroRA);
  const duplicate = getActiveAtendimentos_().some(function(record) {
    return String(record.Id) !== String(ignoredId || '') &&
      normalizeText_(record.NumeroRA) === normalized;
  });
  if (duplicate) throw new Error('Já existe um atendimento com este Número RA.');
}

/**
 * Escritas atômicas do atendimento: a verificação de Número RA e a gravação
 * acontecem sob o mesmo lock para impedir duplicidades em requisições paralelas.
 */
function insertAtendimentoUnique_(record) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_NAMES.ATENDIMENTOS);
    assertUniqueNumeroRAInSheet_(sheet, record.NumeroRA, '');
    const row = toRowArray(record, COLUMNS.ATENDIMENTOS);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    invalidateCache(CONFIG.SHEET_NAMES.ATENDIMENTOS);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* lock não adquirido */ }
  }
}

function updateAtendimentoUnique_(id, updates) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_NAMES.ATENDIMENTOS);
    assertUniqueNumeroRAInSheet_(sheet, updates.NumeroRA, id);
    const rowIndex = findRowById(sheet, id);
    if (rowIndex === -1) throw new Error('Atendimento não encontrado.');
    const currentRow = sheet.getRange(rowIndex, 1, 1, COLUMNS.ATENDIMENTOS.length).getValues()[0];
    const current = toObject(currentRow, COLUMNS.ATENDIMENTOS);
    Object.keys(updates).forEach(function(key) { current[key] = updates[key]; });
    sheet.getRange(rowIndex, 1, 1, COLUMNS.ATENDIMENTOS.length)
      .setValues([toRowArray(current, COLUMNS.ATENDIMENTOS)]);
    invalidateCache(CONFIG.SHEET_NAMES.ATENDIMENTOS);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* lock não adquirido */ }
  }
}

function assertUniqueNumeroRAInSheet_(sheet, numeroRA, ignoredId) {
  if (!sheet || sheet.getLastRow() <= 1) return;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.ATENDIMENTOS.length).getValues();
  const idIndex = COLUMNS.ATENDIMENTOS.indexOf('Id');
  const raIndex = COLUMNS.ATENDIMENTOS.indexOf('NumeroRA');
  const deletedIndex = COLUMNS.ATENDIMENTOS.indexOf('Excluido');
  const normalized = normalizeText_(numeroRA);
  const duplicate = data.some(function(row) {
    return String(row[idIndex]) !== String(ignoredId || '') &&
      !isTrue_(row[deletedIndex]) &&
      normalizeText_(row[raIndex]) === normalized;
  });
  if (duplicate) throw new Error('Já existe um atendimento com este Número RA.');
}

// ============================================================================
// SLA E CONTROLE DE ESPERA
// ============================================================================

function calcularSLA(produto, categoria, canal, tipoAtendimento, prioridade) {
  ensureDatabaseReady();
  return resolveSLA_(
    sanitizeInput(produto),
    sanitizeInput(categoria),
    sanitizeInput(canal),
    sanitizeInput(tipoAtendimento),
    sanitizeInput(prioridade),
    new Date()
  );
}

function calcularVencimentoSLA(dataAbertura, horas) {
  const start = parseInputDate_(dataAbertura, false) || new Date();
  const slaHours = Number(horas);
  if (!isFinite(slaHours) || slaHours <= 0 || slaHours > 8760) {
    throw new Error('Quantidade de horas de SLA inválida.');
  }
  return { dataVencimento: toIso_(addBusinessHours(start, slaHours)) };
}

function resolveSLA_(produto, categoria, canal, tipoAtendimento, prioridade, startDate) {
  const produtos = getAll(CONFIG.SHEET_NAMES.PRODUTOS);
  const categorias = getAll(CONFIG.SHEET_NAMES.CATEGORIAS);
  const canais = getAll(CONFIG.SHEET_NAMES.CANAIS);
  const tipos = getAll(CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO);
  const prioridades = getAll(CONFIG.SHEET_NAMES.PRIORIDADES);
  const produtoId = findIdByName_(produtos, produto);
  const categoriaId = findIdByName_(categorias, categoria);
  const canalId = findIdByName_(canais, canal);
  const tipoId = findIdByName_(tipos, tipoAtendimento);
  const settings = getRuntimeSettings_();

  let bestRule = null;
  let bestScore = -1;
  getAll(CONFIG.SHEET_NAMES.SLAS).forEach(function(rule) {
    if (!isTrue_(rule.Ativo)) return;
    const criteria = [
      ['ProdutoId', produtoId],
      ['CategoriaId', categoriaId],
      ['TipoAtendimentoId', tipoId],
      ['CanalId', canalId]
    ];
    let score = 0;
    let matches = true;
    criteria.forEach(function(pair) {
      const ruleValue = String(rule[pair[0]] || '');
      if (!ruleValue) return;
      if (ruleValue !== String(pair[1] || '')) matches = false;
      else score++;
    });
    if (matches && score > bestScore) {
      bestRule = rule;
      bestScore = score;
    }
  });

  let hours = Number(bestRule && bestRule.Horas ? bestRule.Horas : settings.defaultSlaHours);
  const priority = prioridades.find(function(item) {
    return normalizeText_(item.Nome) === normalizeText_(prioridade);
  });
  if (priority && Number(priority.SLAMultiplicador) > 0) {
    hours = hours * Number(priority.SLAMultiplicador);
  }
  hours = Math.max(1, Math.round(hours * 100) / 100);
  const due = addBusinessHours(startDate || new Date(), hours);

  return {
    slaHoras: hours,
    dataVencimento: toIso_(due),
    regraId: bestRule ? bestRule.Id : '',
    origem: bestRule ? 'Configurado' : 'Padrão'
  };
}

function calculateSLAStatus_(dueValue, comparisonValue, alertHours) {
  const due = asDate_(dueValue);
  const comparison = asDate_(comparisonValue) || new Date();
  if (!due) return 'Não definido';
  if (comparison > due) return 'SLA vencido';
  if (isSameDay(due, comparison)) return 'Vence hoje';

  const remaining = calculateBusinessHours(comparison, due);
  const threshold = Number(alertHours || getRuntimeSettings_().slaAlertHours);
  return remaining <= threshold
    ? 'Próximo do vencimento'
    : 'Dentro do prazo';
}

function isWaitingStatus_(statusName) {
  const status = normalizeText_(statusName);
  if (!status) return false;
  const configured = getStatusConfigMap_()[status];
  return configured ? normalizeText_(configured.Tipo) === 'espera' : status.indexOf('pendente') !== -1;
}

function isFinalStatus_(statusName) {
  const normalized = normalizeText_(statusName);
  const configured = getStatusConfigMap_()[normalized];
  if (configured) return normalizeText_(configured.Tipo) === 'final';
  return ['resolvido', 'finalizado', 'cancelado', 'improcedente', 'concluido'].indexOf(normalized) !== -1;
}

function insertWaitTimeline_(record, type, date, elapsedHours, userName) {
  const status = String(record.Status || '');
  const group = normalizeText_(status).indexOf('cliente') !== -1 ? 'Cliente' : 'Área';
  const details = JSON.stringify({
    grupo: group,
    status: status,
    motivo: String(record.MotivoPendencia || ''),
    responsavel: String(record.Responsavel || ''),
    horas: Math.round(Number(elapsedHours || 0) * 100) / 100
  });
  const description = type === 'Espera iniciada'
    ? 'Espera iniciada: ' + status + '. Motivo: ' + (record.MotivoPendencia || 'não informado') + '.'
    : 'Espera finalizada após ' + Number(elapsedHours || 0).toFixed(1) + ' hora(s).';
  insertTimeline_(record.Id, type, description, '', '', userName, details, date);
}

// ============================================================================
// TIMELINE E HISTÓRICO
// ============================================================================

function getTimeline(atendimentoId) {
  ensureDatabaseReady();
  const id = sanitizeInput(atendimentoId);
  return getByField(CONFIG.SHEET_NAMES.TIMELINE, 'AtendimentoId', id)
    .sort(function(a, b) {
      return (asDate_(b.Data) || new Date(0)) - (asDate_(a.Data) || new Date(0));
    })
    .map(function(item) {
      return {
        id: String(item.Id || ''),
        atendimentoId: String(item.AtendimentoId || ''),
        dataHora: toIso_(item.Data),
        tipo: String(item.Tipo || ''),
        descricao: String(item.Descricao || ''),
        valorAntigo: String(item.De || ''),
        valorNovo: String(item.Para || ''),
        usuario: String(item.Usuario || ''),
        detalhes: String(item.Detalhes || '')
      };
    });
}

function insertTimeline_(atendimentoId, tipo, descricao, de, para, usuario, detalhes, eventDate) {
  return insert(CONFIG.SHEET_NAMES.TIMELINE, {
    Id: generateId('TL'),
    AtendimentoId: atendimentoId,
    Data: eventDate || new Date(),
    Tipo: sanitizeInput(tipo),
    Descricao: sanitizeInput(descricao),
    De: sanitizeInput(de),
    Para: sanitizeInput(para),
    Usuario: sanitizeInput(usuario),
    Detalhes: detalhes || ''
  });
}

function buildChangeHistory_(atendimentoId, oldRecord, updates, userName, justification) {
  const ignored = ['AtualizadoPor', 'DataAtualizacao', 'StatusSLA', 'DataInicioEspera',
    'TempoEsperaAcumulado', 'DataResolucao', 'TempoResolucaoHoras'];
  const entries = [];
  Object.keys(updates).forEach(function(field) {
    if (ignored.indexOf(field) !== -1) return;
    const oldValue = comparableValue_(oldRecord[field]);
    const newValue = comparableValue_(updates[field]);
    if (oldValue === newValue) return;
    entries.push({
      Id: generateId('HIS'),
      AtendimentoId: atendimentoId,
      Data: new Date(),
      Acao: 'Alteração',
      Campo: field,
      ValorAnterior: oldValue,
      ValorNovo: newValue,
      Usuario: userName,
      Justificativa: justification
    });
  });
  return entries;
}

// ============================================================================
// DASHBOARD, ALERTAS E INDICADORES
// ============================================================================

function getDashboardData(filtros) {
  ensureDatabaseReady();
  const raw = applyAtendimentoFilters_(getActiveAtendimentos_(), filtros || {});
  const records = decorateAtendimentos_(raw);
  const today = new Date();
  const settings = getRuntimeSettings_();

  let pendentes = 0;
  let emAnalise = 0;
  let concluidos = 0;
  let pendentesAguardandoArea = 0;
  let pendentesAguardandoCliente = 0;
  const alerts = [];

  raw.forEach(function(record, index) {
    const client = records[index];
    const waiting = isWaitingStatus_(record.Status);
    const finalStatus = isFinalStatus_(record.Status);
    const waitingClient = normalizeText_(record.MotivoPendencia).indexOf('cliente') !== -1;

    if (waiting) {
      pendentes++;
      if (waitingClient) pendentesAguardandoCliente++;
      else pendentesAguardandoArea++;
    } else if (finalStatus) {
      concluidos++;
    } else {
      emAnalise++;
    }

    if (!finalStatus && normalizeText_(client.slaStatus) === 'sla vencido') {
      alerts.push({
        tipo: 'SLA Vencido',
        mensagem: 'RA ' + record.NumeroRA + ' está com o SLA vencido.',
        atendimentoId: record.Id,
        prioridade: record.Prioridade
      });
    } else if (!finalStatus && normalizeText_(client.slaStatus) === 'vence hoje') {
      alerts.push({
        tipo: 'SLA Próximo',
        mensagem: 'RA ' + record.NumeroRA + ' vence hoje.',
        atendimentoId: record.Id,
        prioridade: record.Prioridade
      });
    }

    if (waiting && record.DataInicioEspera) {
      const hours = Math.max(0, diffInHours(record.DataInicioEspera, today));
      const exceeded = waitingClient
        ? hours >= settings.waitClientDays * 24
        : hours >= settings.waitAreaHours;
      if (exceeded) {
        alerts.push({
          tipo: 'Aguardando',
          mensagem: 'RA ' + record.NumeroRA + ' aguarda ' +
            (waitingClient ? 'o cliente' : 'uma área') + ' há ' + Math.floor(hours) + 'h.',
          atendimentoId: record.Id,
          prioridade: record.Prioridade
        });
      }
    }
  });

  const cards = {
    totalAtendimentos: records.length,
    pendentes: pendentes,
    emAnalise: emAnalise,
    concluidos: concluidos,
    pendentesAguardandoArea: pendentesAguardandoArea,
    pendentesAguardandoCliente: pendentesAguardandoCliente
  };

  writeDashboardSnapshot_(cards);
  return { cards: cards, alertas: alerts.slice(0, 100) };
}

function getIndicadores(filtros) {
  ensureDatabaseReady();
  const raw = applyAtendimentoFilters_(getActiveAtendimentos_(), filtros || {});
  const records = decorateAtendimentos_(raw);
  const waitMetrics = getWaitMetrics_(raw.map(function(item) { return String(item.Id); }));

  const byDay = groupCount_(records, function(item) {
    const date = asDate_(item.dataAbertura);
    return date ? Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
  }, function(key) {
    const parts = key.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }, 30);

  const byWeek = groupCount_(records, function(item) {
    const date = asDate_(item.dataAbertura);
    return date ? date.getFullYear() + '-W' + String(getWeekNumber(date)).padStart(2, '0') : '';
  }, function(key) {
    const parts = key.split('-W');
    return 'S' + parts[1] + '/' + parts[0];
  }, 20);

  const byMonth = groupCount_(records, function(item) {
    const date = asDate_(item.dataAbertura);
    return date ? Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM') : '';
  }, monthLabel_, 24);

  const finalRecords = records.filter(function(item) { return isFinalStatus_(item.status); });
  const resolutionByAnalyst = groupAverage_(finalRecords, 'responsavel', 'tempoResolucao');
  const evolution = buildMonthlyEvolution_(records);

  return {
    atendimentosPorDia: byDay,
    atendimentosPorSemana: byWeek,
    atendimentosPorMes: byMonth,
    atendimentosPorAnalista: groupCountByField_(records, 'responsavel'),
    atendimentosPorProduto: groupCountByField_(records, 'produto'),
    atendimentosPorCategoria: groupCountByField_(records, 'categoria'),
    statusAtendimentos: groupCountByField_(records, 'status'),
    slaDentroFora: {
      labels: ['Dentro do prazo', 'Fora do prazo'],
      values: [
        records.filter(function(item) { return normalizeText_(item.slaStatus) !== 'sla vencido'; }).length,
        records.filter(function(item) { return normalizeText_(item.slaStatus) === 'sla vencido'; }).length
      ]
    },
    tempoMedioResolucao: resolutionByAnalyst,
    volumePorCanal: groupCountByField_(records, 'canal'),
    evolucaoMensal: evolution,
    rankingAnalistas: groupCountByField_(finalRecords, 'responsavel'),
    tempoMedioAguardandoArea: waitMetrics.area,
    tempoMedioAguardandoCliente: waitMetrics.cliente
  };
}

function getWaitMetrics_(allowedIds) {
  const allowed = {};
  allowedIds.forEach(function(id) { allowed[id] = true; });
  const sums = { area: 0, cliente: 0 };
  const counts = { area: 0, cliente: 0 };

  getAll(CONFIG.SHEET_NAMES.TIMELINE).forEach(function(item) {
    if (!allowed[String(item.AtendimentoId)] || item.Tipo !== 'Espera finalizada' || !item.Detalhes) return;
    try {
      const details = JSON.parse(item.Detalhes);
      const key = normalizeText_(details.grupo) === 'cliente' ? 'cliente' : 'area';
      sums[key] += Number(details.horas || 0);
      counts[key]++;
    } catch (e) {
      // Registros antigos sem JSON permanecem válidos, apenas não entram na média.
    }
  });

  return {
    area: counts.area ? Math.round((sums.area / counts.area) * 10) / 10 : 0,
    cliente: counts.cliente ? Math.round((sums.cliente / counts.cliente) * 10) / 10 : 0
  };
}

// ============================================================================
// RELATÓRIOS
// ============================================================================

function getRelatorio(filtros) {
  ensureDatabaseReady();
  const records = decorateAtendimentos_(
    applyAtendimentoFilters_(getActiveAtendimentos_(), filtros || {})
  );

  try {
    insert(CONFIG.SHEET_NAMES.RELATORIOS, {
      Id: generateId('REL'),
      Tipo: 'Atendimentos',
      Filtros: JSON.stringify(filtros || {}),
      GeradoPor: getActor_().nome,
      DataGeracao: new Date(),
      Quantidade: records.length
    });
  } catch (e) {
    Logger.log('Não foi possível registrar a geração do relatório: ' + e.message);
  }
  return records;
}

// ============================================================================
// CONFIGURAÇÕES ADMINISTRÁVEIS
// ============================================================================

function getConfiguracoes() {
  ensureDatabaseReady();
  requireSupervisor_();
  const entities = getConfigurationEntities_();
  const result = {};
  Object.keys(entities).forEach(function(key) {
    result[key] = getAll(entities[key].sheet).map(serializeRecord_);
  });
  return { entities: result, user: getActor_() };
}

function salvarConfiguracao(entidade, dados, id) {
  ensureDatabaseReady();
  requireSupervisor_();
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');

  const input = dados || {};
  const record = {};
  meta.columns.forEach(function(column) {
    if (column === 'Id') return;
    if (input[column] === undefined) return;
    if (column === 'Ativo') record[column] = isTrue_(input[column]);
    else if (column === 'Ordem' || column === 'Horas' || column === 'SLAMultiplicador') {
      record[column] = input[column] === '' ? '' : Number(input[column]);
    } else {
      record[column] = sanitizeInput(input[column]);
    }
  });

  if (meta.columns.indexOf('Nome') !== -1 && !record.Nome) throw new Error('Nome é obrigatório.');
  if (meta.key === 'configuracoes' && !record.Chave) throw new Error('Chave é obrigatória.');
  if (meta.key === 'slas' && (!record.Horas || Number(record.Horas) <= 0)) {
    throw new Error('Informe uma quantidade válida de horas.');
  }
  if (meta.key === 'usuarios' && record.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.Email)) {
    throw new Error('E-mail inválido.');
  }
  if (record.Cor && !/^#[0-9a-f]{6}$/i.test(record.Cor)) {
    throw new Error('Cor inválida. Utilize o formato hexadecimal #RRGGBB.');
  }
  if (meta.key === 'status' && ['Inicial', 'Espera', 'Intermediario', 'Final'].indexOf(record.Tipo) === -1) {
    throw new Error('Tipo de status inválido.');
  }
  if (meta.key === 'usuarios' && ['Analista', 'Supervisor'].indexOf(record.Perfil) === -1) {
    throw new Error('Perfil de usuário inválido.');
  }
  if (meta.key === 'configuracoes' && !/^[A-Z0-9_]+$/.test(record.Chave)) {
    throw new Error('A chave deve conter apenas letras maiúsculas, números e sublinhado.');
  }
  validateConfigurationReferences_(meta.key, record);

  let recordId = sanitizeInput(id);
  const exists = recordId ? findConfigRecord_(meta, recordId) : null;
  if (meta.key === 'usuarios' && exists && isTrue_(exists.Ativo) &&
      normalizeText_(exists.Perfil) === 'supervisor' &&
      (!isTrue_(record.Ativo) || normalizeText_(record.Perfil) !== 'supervisor')) {
    assertAnotherSupervisor_(recordId);
  }
  if (exists) {
    update(meta.sheet, recordId, record);
  } else {
    if (meta.columns.indexOf('Id') !== -1) {
      record.Id = recordId || generateId(meta.prefix);
      recordId = record.Id;
    } else {
      recordId = record.Chave;
    }
    if (meta.key === 'usuarios') {
      record.DataCadastro = record.DataCadastro || new Date();
    }
    insert(meta.sheet, record);
  }

  auditConfiguration_(exists ? 'Alteração' : 'Criação', meta.label, recordId, record);
  invalidateAllCache();
  SERVICE_CONTEXT_ = {};
  return { success: true, id: recordId };
}

function excluirConfiguracao(entidade, id) {
  ensureDatabaseReady();
  requireSupervisor_();
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');
  const safeId = sanitizeInput(id);
  const existing = findConfigRecord_(meta, safeId);
  if (!existing) throw new Error('Registro não encontrado.');
  if (meta.key === 'usuarios' && isTrue_(existing.Ativo) && normalizeText_(existing.Perfil) === 'supervisor') {
    assertAnotherSupervisor_(safeId);
  }

  if (meta.columns.indexOf('Ativo') !== -1) {
    update(meta.sheet, safeId, { Ativo: false });
  } else {
    remove(meta.sheet, safeId);
  }
  auditConfiguration_('Desativação', meta.label, safeId, existing);
  invalidateAllCache();
  SERVICE_CONTEXT_ = {};
  return { success: true };
}

function getConfigurationEntities_() {
  return {
    produtos: {
      key: 'produtos', label: 'Produtos', sheet: CONFIG.SHEET_NAMES.PRODUTOS,
      columns: COLUMNS.PRODUTOS, prefix: 'PD'
    },
    categorias: {
      key: 'categorias', label: 'Categorias', sheet: CONFIG.SHEET_NAMES.CATEGORIAS,
      columns: COLUMNS.CATEGORIAS, prefix: 'CT'
    },
    status: {
      key: 'status', label: 'Status', sheet: CONFIG.SHEET_NAMES.STATUS_CONFIG,
      columns: COLUMNS.STATUS_CONFIG, prefix: 'ST'
    },
    prioridades: {
      key: 'prioridades', label: 'Prioridades', sheet: CONFIG.SHEET_NAMES.PRIORIDADES,
      columns: COLUMNS.PRIORIDADES, prefix: 'PR'
    },
    canais: {
      key: 'canais', label: 'Canais', sheet: CONFIG.SHEET_NAMES.CANAIS,
      columns: COLUMNS.CANAIS, prefix: 'CN'
    },
    tiposAtendimento: {
      key: 'tiposAtendimento', label: 'Tipos de atendimento', sheet: CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO,
      columns: COLUMNS.TIPOS_ATENDIMENTO, prefix: 'TA'
    },
    slas: {
      key: 'slas', label: 'SLAs', sheet: CONFIG.SHEET_NAMES.SLAS,
      columns: COLUMNS.SLAS, prefix: 'SLA'
    },
    motivosPendencia: {
      key: 'motivosPendencia', label: 'Motivos de pendência', sheet: CONFIG.SHEET_NAMES.MOTIVOS_PENDENCIA,
      columns: COLUMNS.MOTIVOS_PENDENCIA, prefix: 'MP'
    },
    usuarios: {
      key: 'usuarios', label: 'Usuários e responsáveis', sheet: CONFIG.SHEET_NAMES.USUARIOS,
      columns: COLUMNS.USUARIOS, prefix: 'USR'
    },
    configuracoes: {
      key: 'configuracoes', label: 'Parâmetros gerais', sheet: CONFIG.SHEET_NAMES.CONFIGURACOES,
      columns: COLUMNS.CONFIGURACOES, prefix: 'CFG'
    }
  };
}

function findConfigRecord_(meta, id) {
  if (meta.columns.indexOf('Id') !== -1) return getById(meta.sheet, id);
  return getByField(meta.sheet, meta.columns[0], id)[0] || null;
}

function auditConfiguration_(action, label, id, value) {
  insert(CONFIG.SHEET_NAMES.HISTORICO, {
    Id: generateId('HIS'),
    AtendimentoId: '',
    Data: new Date(),
    Acao: action + ' de configuração',
    Campo: label,
    ValorAnterior: '',
    ValorNovo: id + ': ' + JSON.stringify(value || {}),
    Usuario: getActor_().nome,
    Justificativa: 'Alteração realizada pela tela de Configurações.'
  });
}

function validateConfigurationReferences_(entity, record) {
  const references = {
    ProdutoId: CONFIG.SHEET_NAMES.PRODUTOS,
    CategoriaId: CONFIG.SHEET_NAMES.CATEGORIAS,
    TipoAtendimentoId: CONFIG.SHEET_NAMES.TIPOS_ATENDIMENTO,
    CanalId: CONFIG.SHEET_NAMES.CANAIS
  };
  Object.keys(references).forEach(function(field) {
    if (!record[field]) return;
    if (!getById(references[field], record[field])) {
      throw new Error('Referência inválida em ' + field + '.');
    }
  });
}

function assertAnotherSupervisor_(ignoredId) {
  const activeSupervisors = getAll(CONFIG.SHEET_NAMES.USUARIOS).filter(function(user) {
    return String(user.Id) !== String(ignoredId) &&
      isTrue_(user.Ativo) &&
      normalizeText_(user.Perfil) === 'supervisor';
  });
  if (!activeSupervisors.length) {
    throw new Error('Cadastre outro supervisor ativo antes de remover este acesso.');
  }
}

// ============================================================================
// CONVERSÃO, AGRUPAMENTO E SEGURANÇA
// ============================================================================

function decorateAtendimentos_(records) {
  const colorMap = getStatusColorMap_();
  const alertHours = getRuntimeSettings_().slaAlertHours;
  return records.map(function(record) {
    return toClientAtendimento_(record, colorMap, alertHours);
  });
}

function toClientAtendimento_(record, colorMap, alertHours) {
  const deadline = asDate_(record.DataVencimentoSLA);
  const comparison = record.DataResolucao || new Date();
  const slaStatus = calculateSLAStatus_(deadline, comparison, alertHours);
  const remaining = deadline ? diffInHours(new Date(), deadline) : 0;
  return {
    id: String(record.Id || ''),
    numeroRA: String(record.NumeroRA || ''),
    dataAbertura: toIso_(record.DataAbertura),
    dataRecebimento: toIso_(record.DataRecebimento),
    dataPrevista: toIso_(record.DataVencimentoSLA),
    dataConclusao: toIso_(record.DataResolucao),
    canal: String(record.Canal || ''),
    tipoAtendimento: String(record.TipoAtendimento || ''),
    cliente: String(record.Cliente || ''),
    cpf: String(record.CPF || ''),
    cpfCnpj: String(record.CPF || ''),
    telefone: String(record.Telefone || ''),
    email: String(record.Email || ''),
    produto: String(record.Produto || ''),
    categoria: String(record.Categoria || ''),
    subcategoria: String(record.Subcategoria || ''),
    assunto: String(record.Assunto || ''),
    descricao: String(record.Descricao || ''),
    status: String(record.Status || ''),
    statusCor: colorMap[String(record.Status || '')] || '',
    prioridade: String(record.Prioridade || ''),
    responsavel: String(record.Responsavel || ''),
    slaHoras: Number(record.SLAHoras || 0),
    slaStatus: slaStatus,
    sla: slaStatus,
    horasRestantes: Math.round(remaining * 10) / 10,
    diasRestantes: Math.round((remaining / 24) * 10) / 10,
    dataInicioEspera: toIso_(record.DataInicioEspera),
    tempoEspera: Number(record.TempoEsperaAcumulado || 0),
    motivoPendencia: String(record.MotivoPendencia || ''),
    tempoResolucao: record.TempoResolucaoHoras === '' ? '' : Number(record.TempoResolucaoHoras || 0),
    resolucao: String(record.Resolucao || ''),
    notaConsumidor: record.NotaConsumidor === '' ? '' : Number(record.NotaConsumidor),
    avaliacao: String(record.Avaliacao || ''),
    observacoes: String(record.Observacoes || ''),
    criadoPor: String(record.CriadoPor || ''),
    dataCriacao: toIso_(record.DataCriacao),
    atualizadoPor: String(record.AtualizadoPor || ''),
    dataAtualizacao: toIso_(record.DataAtualizacao)
  };
}

function getStatusColorMap_() {
  return keyValue_(getAll(CONFIG.SHEET_NAMES.STATUS_CONFIG), 'Nome', 'Cor');
}

function getStatusConfigMap_() {
  if (SERVICE_CONTEXT_.statusConfig) return SERVICE_CONTEXT_.statusConfig;
  const map = {};
  getAll(CONFIG.SHEET_NAMES.STATUS_CONFIG).forEach(function(item) {
    map[normalizeText_(item.Nome)] = item;
  });
  SERVICE_CONTEXT_.statusConfig = map;
  return map;
}

function groupCountByField_(records, field) {
  const counts = {};
  records.forEach(function(item) {
    const key = String(item[field] || 'Não informado');
    counts[key] = (counts[key] || 0) + 1;
  });
  const keys = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || a.localeCompare(b, 'pt-BR');
  });
  return { labels: keys, values: keys.map(function(key) { return counts[key]; }) };
}

function groupCount_(records, keyFn, labelFn, limit) {
  const counts = {};
  records.forEach(function(item) {
    const key = keyFn(item);
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  let keys = Object.keys(counts).sort();
  if (limit && keys.length > limit) keys = keys.slice(keys.length - limit);
  return {
    labels: keys.map(labelFn || function(key) { return key; }),
    values: keys.map(function(key) { return counts[key]; })
  };
}

function groupAverage_(records, labelField, valueField) {
  const groups = {};
  records.forEach(function(item) {
    const label = String(item[labelField] || 'Não informado');
    const value = Number(item[valueField]);
    if (!isFinite(value)) return;
    if (!groups[label]) groups[label] = { sum: 0, count: 0 };
    groups[label].sum += value;
    groups[label].count++;
  });
  const labels = Object.keys(groups).sort();
  return {
    labels: labels,
    values: labels.map(function(label) {
      return Math.round((groups[label].sum / groups[label].count) * 10) / 10;
    })
  };
}

function buildMonthlyEvolution_(records) {
  const opened = {};
  const closed = {};
  records.forEach(function(item) {
    const start = asDate_(item.dataAbertura);
    const end = asDate_(item.dataConclusao);
    if (start) {
      const key = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM');
      opened[key] = (opened[key] || 0) + 1;
    }
    if (end) {
      const key = Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM');
      closed[key] = (closed[key] || 0) + 1;
    }
  });
  const keys = Object.keys(Object.assign({}, opened, closed)).sort().slice(-24);
  return {
    labels: keys.map(monthLabel_),
    novos: keys.map(function(key) { return opened[key] || 0; }),
    finalizados: keys.map(function(key) { return closed[key] || 0; })
  };
}

function writeDashboardSnapshot_(cards) {
  try {
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEET_NAMES.DASHBOARD);
    if (!sheet) return;
    const now = new Date();
    const rows = Object.keys(cards).map(function(key) {
      return [key, cards[key], now];
    });
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.DASHBOARD.length).clearContent();
    }
    if (rows.length) sheet.getRange(2, 1, rows.length, COLUMNS.DASHBOARD.length).setValues(rows);
    invalidateCache(CONFIG.SHEET_NAMES.DASHBOARD);
  } catch (e) {
    Logger.log('Não foi possível atualizar o snapshot do dashboard: ' + e.message);
  }
}

function getRuntimeSettings_() {
  if (SERVICE_CONTEXT_.runtimeSettings) return SERVICE_CONTEXT_.runtimeSettings;
  const values = {};
  getAll(CONFIG.SHEET_NAMES.CONFIGURACOES).forEach(function(item) {
    values[String(item.Chave || '')] = item.Valor;
  });
  SERVICE_CONTEXT_.runtimeSettings = {
    defaultSlaHours: positiveNumber_(values.SLA_PADRAO_HORAS, CONFIG.DEFAULT_SLA_HOURS),
    slaAlertHours: positiveNumber_(values.ALERTA_SLA_HORAS, CONFIG.SLA_ALERT_HOURS),
    waitAreaHours: positiveNumber_(values.ALERTA_ESPERA_AREA_HORAS, CONFIG.ESPERA_AREA_ALERT_HOURS),
    waitClientDays: positiveNumber_(values.ALERTA_ESPERA_CLIENTE_DIAS, CONFIG.ESPERA_CLIENTE_ALERT_DAYS)
  };
  return SERVICE_CONTEXT_.runtimeSettings;
}

function getActor_() {
  let email = '';
  try {
    email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }
  const users = getAll(CONFIG.SHEET_NAMES.USUARIOS);
  let user = users.find(function(item) {
    return normalizeText_(item.Email) === normalizeText_(email) && isTrue_(item.Ativo);
  });
  if (!user && !email) {
    user = users.find(function(item) { return isTrue_(item.Ativo); });
  }
  return {
    id: user ? String(user.Id || '') : '',
    email: email,
    nome: user ? String(user.Nome || '') : (email ? email.split('@')[0] : 'Usuário'),
    perfil: user ? String(user.Perfil || 'Analista') : 'Analista',
    equipe: user ? String(user.Equipe || '') : ''
  };
}

function requireSupervisor_() {
  const actor = getActor_();
  if (!isSupervisorProfile_(actor.perfil)) {
    throw new Error('Apenas supervisores podem alterar as configurações.');
  }
}

/**
 * Verifica se um perfil corresponde a um nível de supervisão/gestão.
 * Usado para controlar quem vê/edita todos os atendimentos (Supervisor) e
 * quem vê/edita apenas os próprios (Analista).
 */
function isSupervisorProfile_(perfil) {
  return ['supervisor', 'gestor', 'administrador', 'admin'].indexOf(normalizeText_(perfil)) !== -1;
}

/**
 * Regra de permissão central: Supervisor acessa qualquer atendimento;
 * Analista só acessa os atendimentos dos quais é responsável ou criador.
 * Aplicada no backend (não apenas na interface) em todas as consultas e
 * gravações de atendimentos.
 */
function canAccessAtendimento_(record, actor) {
  if (isSupervisorProfile_(actor.perfil)) return true;
  const name = normalizeText_(actor.nome);
  if (!name) return false;
  return normalizeText_(record.Responsavel) === name || normalizeText_(record.CriadoPor) === name;
}

/**
 * Filtra uma lista de atendimentos para o perfil Analista (apenas os seus).
 * Supervisor recebe a lista completa, sem alteração.
 */
function restrictToOwnerIfNeeded_(records, actor) {
  if (isSupervisorProfile_(actor.perfil)) return records;
  return records.filter(function(record) {
    return canAccessAtendimento_(record, actor);
  });
}

function parseInputDate_(value, endOfDay) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());
  const str = String(value).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      endOfDay ? 23 : CONFIG.BUSINESS_HOUR_START,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    );
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

function asDate_(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function toIso_(value) {
  const date = asDate_(value);
  return date ? date.toISOString() : '';
}

function comparableValue_(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function serializeRecord_(record) {
  const result = {};
  Object.keys(record || {}).forEach(function(key) {
    result[key] = record[key] instanceof Date ? record[key].toISOString() : record[key];
  });
  return result;
}

function normalizeText_(value) {
  let text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  try {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    // normalize pode não existir em runtimes legados.
  }
  return text;
}

function isTrue_(value) {
  return value === true || value === 1 ||
    ['true', 'sim', '1', 'ativo'].indexOf(normalizeText_(value)) !== -1;
}

function positiveNumber_(value, fallback) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? number : fallback;
}

function findIdByName_(items, name) {
  const normalized = normalizeText_(name);
  const found = items.find(function(item) {
    return normalizeText_(item.Nome) === normalized;
  });
  return found ? String(found.Id || '') : '';
}

function indexBy_(items, field) {
  const index = {};
  items.forEach(function(item) { index[String(item[field] || '')] = item; });
  return index;
}

function pluck_(items, field) {
  return items.map(function(item) { return String(item[field] || ''); }).filter(function(value) { return value; });
}

function keyValue_(items, keyField, valueField) {
  const result = {};
  items.forEach(function(item) {
    result[String(item[keyField] || '')] = String(item[valueField] || '');
  });
  return result;
}

function monthLabel_(key) {
  const parts = String(key).split('-');
  return parts.length === 2 ? parts[1] + '/' + parts[0] : key;
}
