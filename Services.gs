/**
 * ============================================================================
 * Pelitero Labs Prisma RA — Camada de serviços
 * ============================================================================
 * Arquivo: Services.gs
 * Descrição: Regras de negócio, validação, timeline, dashboard, relatórios e
 * administração das configurações. Todas as funções públicas deste arquivo
 * podem ser chamadas pelo frontend com google.script.run.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Convenção de nomes:
 *   - Funções SEM "_" no final (ex: getDashboardData) → podem ser chamadas
 *     pelo frontend via google.script.run.
 *   - Funções COM "_" no final (ex: validateAtendimentoInput_) → internas.
 *
 * Regras centrais do fluxo:
 *   - Status possíveis: "Pendente", "Em análise" e "Concluído"
 *     (STATUS_LIST em Config.gs).
 *   - Quando Pendente, "Aguardando Retorno de" (Área/Cliente) é obrigatório
 *     (SITUACOES_PENDENCIA em Config.gs); oculto nos demais status.
 *   - Atendimentos são gravados em abas separadas por canal (ReclameAqui,
 *     ChatPrivadoRA, SACPreventivo); consultas consolidam as três abas.
 *   - Analista vê/edita apenas os próprios atendimentos; Supervisor e ADM
 *     veem todos e podem delegar/reatribuir (canAccessAtendimento_,
 *     restrictToOwnerIfNeeded_). Gestão de usuários e dos campos do
 *     formulário (ConfigCampos) são exclusivas do ADM (requireAdmin_).
 * ------------------------------------------------------------------------
 */

var SERVICE_CONTEXT_ = {};

// ============================================================================
// INICIALIZAÇÃO E DADOS DE APOIO
// ============================================================================

/**
 * Dados de apoio carregados uma única vez pelo frontend na inicialização:
 * usuário logado + listas dos formulários/filtros. Status, situações de
 * pendência e canais são fixos (Config.gs); produtos, categorias e usuários
 * vêm da planilha.
 */
function getBootstrapData() {
  ensureDatabaseReady();

  const produtos = activeSorted_(CONFIG.SHEET_NAMES.PRODUTOS);
  const categorias = activeSorted_(CONFIG.SHEET_NAMES.CATEGORIAS);
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
    formConfig: getFormConfig_(),
    dropdownData: {
      produtos: pluck_(produtos, 'Nome'),
      categorias: pluck_(categorias, 'Nome'),
      categoriasPorProduto: categoriasPorProduto,
      status: STATUS_LIST.map(function(item) { return item.Nome; }),
      situacoesPendencia: SITUACOES_PENDENCIA.slice(),
      canais: CANAIS_LIST.slice(),
      responsaveis: pluck_(usuarios, 'Nome'),
      statusCores: getStatusColorMap_()
    }
  };
}

/**
 * Configuração dinâmica do formulário "Novo Atendimento" (aba ConfigCampos).
 * Retorna os campos normalizados e ordenados; o frontend monta o formulário
 * a partir desta lista e o servidor valida com as mesmas regras.
 */
function getFormConfig_() {
  return getAll(CONFIG.SHEET_NAMES.CONFIG_CAMPOS)
    .filter(function(item) { return item.Campo; })
    .map(function(item) {
      return {
        id: String(item.Id || ''),
        campo: String(item.Campo || ''),
        rotulo: String(item.Rotulo || item.Campo || ''),
        tipo: String(item.Tipo || 'text'),
        exibir: isTrue_(item.Exibir),
        obrigatorio: isTrue_(item.Obrigatorio),
        ordem: Number(item.Ordem || 9999),
        base: isTrue_(item.Base),
        bloqueado: isTrue_(item.Bloqueado)
      };
    })
    .sort(function(a, b) { return a.ordem - b.ordem; });
}

/**
 * Retorna os registros ativos de uma aba, ordenados por Ordem e Nome.
 * @param {string} sheetName - Nome da aba.
 * @returns {Object[]} Registros ativos ordenados.
 */
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

/**
 * Carrega um atendimento e sua timeline, respeitando as permissões
 * do usuário logado.
 * @param {string} id - Id do atendimento.
 * @returns {Object|null} { atendimento, timeline } ou null.
 */
function getAtendimento(id) {
  ensureDatabaseReady();
  const found = findAtendimento_(sanitizeInput(id));
  if (!found || isTrue_(found.record.Excluido)) return null;
  if (!canAccessAtendimento_(found.record, getActor_())) return null;

  return {
    atendimento: toClientAtendimento_(found.record, getStatusColorMap_()),
    timeline: getTimeline(id)
  };
}

/**
 * Verificação rápida de duplicidade do protocolo (usada pelo formulário
 * enquanto o usuário digita, sem carregar a lista inteira). A busca cobre
 * as três abas por canal.
 * @param {string} protocolo - Protocolo digitado.
 * @param {string} ignorarId - Id do próprio atendimento (em edições).
 * @returns {Object} { duplicado: boolean }.
 */
function verificarProtocoloDuplicado(protocolo, ignorarId) {
  ensureDatabaseReady();
  const normalized = normalizeText_(protocolo);
  if (!normalized) return { duplicado: false };
  const safeId = sanitizeInput(ignorarId);
  const duplicado = getActiveAtendimentos_().some(function(record) {
    return String(record.Id) !== String(safeId || '') &&
      normalizeText_(record.NumeroRA) === normalized;
  });
  return { duplicado: duplicado };
}

/**
 * Nomes das abas de atendimento (uma por canal).
 */
function getAtendimentoSheetNames_() {
  return CANAL_SHEETS.map(function(item) {
    return CONFIG.SHEET_NAMES[item.sheetKey];
  });
}

/**
 * Todos os atendimentos ativos, consolidados das três abas por canal.
 * A pesquisa e os relatórios usam esta função — o usuário nunca precisa
 * saber em qual aba o registro está gravado.
 */
function getActiveAtendimentos_() {
  let records = [];
  getAtendimentoSheetNames_().forEach(function(sheetName) {
    records = records.concat(getAll(sheetName));
  });
  return records.filter(function(record) {
    return !isTrue_(record.Excluido);
  });
}

/**
 * Localiza um atendimento pelo Id em qualquer uma das abas por canal.
 * @returns {Object|null} { record, sheetName } ou null se não encontrado.
 */
function findAtendimento_(id) {
  if (!id) return null;
  const sheetNames = getAtendimentoSheetNames_();
  for (let i = 0; i < sheetNames.length; i++) {
    const record = getById(sheetNames[i], id);
    if (record) return { record: record, sheetName: sheetNames[i] };
  }
  return null;
}

/**
 * Aplica os filtros de consulta (período, campos exatos e campos de
 * busca parcial) sobre uma lista de atendimentos.
 * @param {Object[]} records - Atendimentos a filtrar.
 * @param {Object} filtros - Critérios enviados pelo frontend.
 * @returns {Object[]} Atendimentos que atendem a todos os critérios.
 */
function applyAtendimentoFilters_(records, filtros) {
  const filters = filtros || {};
  const start = parseInputDate_(filters.dataInicio || filters.periodoInicio, false);
  const end = parseInputDate_(filters.dataFim || filters.periodoFim, true);
  const exactFields = {
    produto: 'Produto',
    categoria: 'Categoria',
    status: 'Status',
    situacao: 'MotivoPendencia',
    canal: 'Canal',
    analista: 'Responsavel',
    responsavel: 'Responsavel'
  };
  const containsFields = {
    numeroRA: 'NumeroRA',
    protocolo: 'NumeroRA',
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

/**
 * Ordena registros já convertidos para o formato do frontend.
 * Campos com "data" no nome são comparados como datas.
 * @param {Object[]} records - Registros no formato do cliente.
 * @param {Object} order - { campo, direcao } ("asc" ou "desc").
 */
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

/**
 * Cria um novo atendimento na aba do canal selecionado.
 * Analista é definido automaticamente como responsável; Supervisor/ADM
 * podem delegar a outro analista.
 * @param {Object} dados - Dados preenchidos pelo usuário no formulário.
 * @returns {Object} { success, id } do atendimento criado.
 */
function salvarAtendimento(dados) {
  ensureDatabaseReady();
  const input = validateAtendimentoInput_(dados || {});

  const actor = getActor_();
  // Analista não escolhe responsável: o sistema identifica automaticamente
  // quem está criando o atendimento. Apenas o Supervisor pode delegar a
  // outro analista.
  if (!isSupervisorProfile_(actor.perfil) || !input.responsavel) {
    input.responsavel = actor.nome;
  }
  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || now;
  const finalStatus = isFinalStatus_(input.status);

  const record = {
    Id: generateId('ATD'),
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    Canal: input.canal,
    Cliente: input.cliente,
    CPF: input.cpf,
    Produto: input.produto,
    Categoria: input.categoria,
    Status: input.status,
    MotivoPendencia: input.motivoPendencia,
    Responsavel: input.responsavel,
    DataResolucao: finalStatus ? now : '',
    TempoResolucaoHoras: finalStatus ? roundHours_(diffInHours(opening, now)) : '',
    Observacoes: input.observacoes,
    CriadoPor: actor.nome,
    DataCriacao: now,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now,
    Excluido: false,
    ExcluidoPor: '',
    DataExclusao: '',
    CamposExtras: input.camposExtras
  };

  // O canal define a aba onde o atendimento é gravado.
  insertAtendimentoUnique_(record, sheetNameForCanalConfig_(input.canal));
  insertTimeline_(record.Id, 'Criação', 'Atendimento criado.', '', input.status, actor.nome, '');
  if (input.responsavel !== actor.nome) {
    insertTimeline_(record.Id, 'Delegação', 'Atendimento delegado pelo supervisor.',
      '', input.responsavel, actor.nome, '');
  }

  return { success: true, id: record.Id };
}

/**
 * Atualiza um atendimento existente, com justificativa obrigatória,
 * registro de histórico campo a campo e eventos de timeline. Se o canal
 * mudar, o registro é movido para a aba do novo canal.
 * @param {string} id - Id do atendimento.
 * @param {Object} dados - Novos valores do formulário.
 * @param {string} justificativa - Motivo da alteração (auditoria).
 * @returns {Object} { success, id }.
 */
function atualizarAtendimento(id, dados, justificativa) {
  ensureDatabaseReady();
  const safeId = sanitizeInput(id);
  const found = findAtendimento_(safeId);
  if (!found || isTrue_(found.record.Excluido)) throw new Error('Atendimento não encontrado.');
  const oldRecord = found.record;

  const actor = getActor_();
  if (!canAccessAtendimento_(oldRecord, actor)) {
    throw new Error('Você não tem permissão para editar este atendimento.');
  }

  const input = validateAtendimentoInput_(dados || {});
  // Campos ocultados na ConfigCampos não vêm do formulário: preserva os
  // valores já gravados para a edição não apagar dados existentes.
  preserveHiddenFields_(input, oldRecord);

  // Analista não escolhe responsável: mantém o responsável atual. Apenas o
  // Supervisor pode reatribuir o atendimento a outro analista.
  if (!isSupervisorProfile_(actor.perfil) || !input.responsavel) {
    input.responsavel = oldRecord.Responsavel || actor.nome;
  }
  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || asDate_(oldRecord.DataAbertura) || now;
  const safeJustification = sanitizeInput(justificativa);
  const statusChanged = normalizeText_(oldRecord.Status) !== normalizeText_(input.status);

  const resolution = resolveResolution_(oldRecord, input.status, opening, now);

  const updates = {
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    Canal: input.canal,
    Cliente: input.cliente,
    CPF: input.cpf,
    Produto: input.produto,
    Categoria: input.categoria,
    Status: input.status,
    MotivoPendencia: input.motivoPendencia,
    Responsavel: input.responsavel,
    DataResolucao: resolution.date,
    TempoResolucaoHoras: resolution.hours,
    Observacoes: input.observacoes,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now,
    CamposExtras: input.camposExtras
  };

  const history = buildChangeHistory_(safeId, oldRecord, updates, actor.nome, safeJustification);
  // Se o canal mudou, o registro é movido para a aba do novo canal.
  updateAtendimentoUnique_(safeId, updates, found.sheetName, sheetNameForCanalConfig_(input.canal));

  if (history.length > 0) {
    batchInsert(CONFIG.SHEET_NAMES.HISTORICO, history);
    insertTimeline_(
      safeId,
      'Atualização',
      history.length + ' campo(s) alterado(s). ' + (safeJustification || ''),
      '', '', actor.nome, ''
    );
  }

  if (statusChanged) {
    insertTimeline_(safeId, isFinalStatus_(input.status) ? 'Encerramento' : 'Mudança de status',
      'Status alterado.', oldRecord.Status, statusLabel_(input.status, input.motivoPendencia),
      actor.nome, safeJustification);
  }
  if (String(oldRecord.Responsavel || '') !== String(input.responsavel || '')) {
    insertTimeline_(safeId, 'Alteração de responsável', 'Responsável alterado.',
      oldRecord.Responsavel, input.responsavel, actor.nome, safeJustification);
  }

  return { success: true, id: safeId };
}

/**
 * Alteração rápida de status feita diretamente pelo Dashboard (Analista ou
 * Supervisor). Não exige justificativa e altera apenas Status + Situação.
 */
function alterarStatusAtendimento(id, status, situacao) {
  ensureDatabaseReady();
  const safeId = sanitizeInput(id);
  const found = findAtendimento_(safeId);
  if (!found || isTrue_(found.record.Excluido)) throw new Error('Atendimento não encontrado.');
  const record = found.record;

  const actor = getActor_();
  if (!canAccessAtendimento_(record, actor)) {
    throw new Error('Você não tem permissão para alterar este atendimento.');
  }

  const newStatus = sanitizeInput(status);
  const newSituacao = sanitizeInput(situacao);
  assertValidStatus_(newStatus, newSituacao);

  const now = new Date();
  const opening = asDate_(record.DataAbertura) || now;
  const resolution = resolveResolution_(record, newStatus, opening, now);
  const statusChanged = normalizeText_(record.Status) !== normalizeText_(newStatus);
  const situacaoChanged = normalizeText_(record.MotivoPendencia) !== normalizeText_(newSituacao);

  if (!statusChanged && !situacaoChanged) return { success: true, id: safeId };

  updateAtendimentoUnique_(safeId, {
    Status: newStatus,
    MotivoPendencia: isWaitingStatus_(newStatus) ? newSituacao : '',
    DataResolucao: resolution.date,
    TempoResolucaoHoras: resolution.hours,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now
  }, found.sheetName, found.sheetName);

  insertTimeline_(safeId, isFinalStatus_(newStatus) ? 'Encerramento' : 'Mudança de status',
    'Status alterado pelo dashboard.',
    statusLabel_(record.Status, record.MotivoPendencia),
    statusLabel_(newStatus, newSituacao),
    actor.nome, '');

  return { success: true, id: safeId };
}

/**
 * Exclui logicamente um atendimento (campo Excluido), preservando
 * timeline e histórico para auditoria.
 * @param {string} id - Id do atendimento.
 * @returns {Object} { success } ou { success: false, message }.
 */
function excluirAtendimento(id) {
  ensureDatabaseReady();
  const safeId = sanitizeInput(id);
  const found = findAtendimento_(safeId);
  if (!found || isTrue_(found.record.Excluido)) return { success: false, message: 'Atendimento não encontrado.' };
  const record = found.record;

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
  update(found.sheetName, safeId, {
    Excluido: true,
    ExcluidoPor: actor.nome,
    DataExclusao: now,
    AtualizadoPor: actor.nome,
    DataAtualizacao: now
  });

  return { success: true };
}

/**
 * Adiciona uma observação à timeline de um atendimento.
 * @param {string} atendimentoId - Id do atendimento.
 * @param {string} texto - Texto da observação.
 * @returns {Object} { success }.
 */
function adicionarObservacao(atendimentoId, texto) {
  ensureDatabaseReady();
  const id = sanitizeInput(atendimentoId);
  const observation = sanitizeInput(texto);
  if (!observation) throw new Error('A observação não pode ficar vazia.');
  const found = findAtendimento_(id);
  if (!found || isTrue_(found.record.Excluido)) throw new Error('Atendimento não encontrado.');

  const actor = getActor_();
  if (!canAccessAtendimento_(found.record, actor)) {
    throw new Error('Você não tem permissão para alterar este atendimento.');
  }
  insertTimeline_(id, 'Observação', observation, '', '', actor.nome, '');
  update(found.sheetName, id, {
    AtualizadoPor: actor.nome,
    DataAtualizacao: new Date()
  });
  return { success: true };
}

/**
 * Sanitiza e valida os dados do formulário de atendimento.
 * A obrigatoriedade dos campos vem da ConfigCampos (formulário dinâmico);
 * Canal e Status são regras fixas do fluxo. Campos personalizados são
 * serializados em JSON para a coluna CamposExtras.
 * @param {Object} dados - Dados brutos enviados pelo frontend.
 * @returns {Object} Dados sanitizados e validados.
 * @throws {Error} Quando algum campo obrigatório ou regra é violada.
 */
function validateAtendimentoInput_(dados) {
  const formConfig = getFormConfig_();
  const input = {
    numeroRA: sanitizeInput(dados.numeroRA),
    cliente: sanitizeInput(dados.cliente),
    cpf: sanitizeInput(dados.cpf),
    produto: sanitizeInput(dados.produto),
    categoria: sanitizeInput(dados.categoria),
    canal: sanitizeInput(dados.canal),
    responsavel: sanitizeInput(dados.responsavel),
    status: sanitizeInput(dados.status),
    observacoes: sanitizeInput(dados.observacoes),
    dataAbertura: sanitizeInput(dados.dataAbertura),
    motivoPendencia: sanitizeInput(dados.motivoPendencia)
  };

  // Campos personalizados (Base=false na ConfigCampos): sanitizados um a um
  // e gravados como JSON na coluna CamposExtras.
  const extrasInput = (dados.camposExtras && typeof dados.camposExtras === 'object') ? dados.camposExtras : {};
  const extras = {};
  formConfig.forEach(function(field) {
    if (field.base) return;
    const value = sanitizeInput(extrasInput[field.campo]);
    if (field.exibir && field.obrigatorio && !value) {
      throw new Error(field.rotulo + ' é obrigatório.');
    }
    if (value) extras[field.campo] = value;
  });
  input.camposExtras = Object.keys(extras).length > 0 ? JSON.stringify(extras) : '';

  // Obrigatoriedade dos campos base conforme a configuração do ADM.
  formConfig.forEach(function(field) {
    if (!field.base || !field.exibir || !field.obrigatorio) return;
    if (input[field.campo] === undefined) return;
    if (!input[field.campo]) throw new Error(field.rotulo + ' é obrigatório.');
  });

  // Regras fixas do fluxo (independem da ConfigCampos): o Canal define a aba
  // onde o atendimento é gravado e o Status controla o ciclo de vida.
  if (!input.canal) throw new Error('Canal é obrigatório.');
  const canalValido = CANAIS_LIST.some(function(canal) {
    return normalizeText_(canal) === normalizeText_(input.canal);
  });
  if (!canalValido) throw new Error('Canal inválido.');
  if (!input.status) throw new Error('Status é obrigatório.');

  if (input.cpf && !validateCPF(input.cpf)) throw new Error('CPF inválido.');
  assertValidStatus_(input.status, input.motivoPendencia);
  if (!isWaitingStatus_(input.status)) input.motivoPendencia = '';

  if (input.cpf) input.cpf = formatCPF(input.cpf);
  return input;
}

/**
 * Correção de bug: campos ocultados na ConfigCampos (Exibir = Não) não são
 * enviados pelo formulário; sem esta função, toda edição apagaria os
 * valores já gravados nesses campos. Campos base ocultos mantêm o valor
 * atual do registro e campos personalizados ocultos são reintegrados ao
 * JSON de CamposExtras.
 * @param {Object} input - Dados validados do formulário (alterado in place).
 * @param {Object} oldRecord - Registro atual da planilha.
 */
function preserveHiddenFields_(input, oldRecord) {
  // Mapa campo do formulário → coluna da planilha (apenas campos base).
  const columnByField = {
    numeroRA: 'NumeroRA', dataAbertura: 'DataAbertura', cliente: 'Cliente',
    cpf: 'CPF', produto: 'Produto', categoria: 'Categoria',
    canal: 'Canal', observacoes: 'Observacoes'
  };
  const hiddenExtras = {};
  const oldExtras = parseCamposExtras_(oldRecord.CamposExtras);

  getFormConfig_().forEach(function(field) {
    if (field.exibir) return;
    if (field.base) {
      const column = columnByField[field.campo];
      if (column && !input[field.campo]) input[field.campo] = oldRecord[column];
    } else if (oldExtras[field.campo] !== undefined) {
      hiddenExtras[field.campo] = oldExtras[field.campo];
    }
  });

  if (Object.keys(hiddenExtras).length > 0) {
    const extras = parseCamposExtras_(input.camposExtras);
    Object.keys(hiddenExtras).forEach(function(key) {
      if (extras[key] === undefined) extras[key] = hiddenExtras[key];
    });
    input.camposExtras = JSON.stringify(extras);
  }
}

/**
 * Garante que o status é um dos valores fixos e que "Aguardando Retorno de"
 * (Área/Cliente) foi informado quando o status é "Pendente".
 */
function assertValidStatus_(status, situacao) {
  const validStatus = STATUS_LIST.some(function(item) {
    return normalizeText_(item.Nome) === normalizeText_(status);
  });
  if (!validStatus) throw new Error('Status inválido. Utilize "Pendente", "Em análise" ou "Concluído".');

  if (isWaitingStatus_(status)) {
    const validSituacao = SITUACOES_PENDENCIA.some(function(item) {
      return normalizeText_(item) === normalizeText_(situacao);
    });
    if (!validSituacao) {
      throw new Error('Informe "Aguardando Retorno de" (Área ou Cliente) quando o status for "Pendente".');
    }
  }
}

/**
 * Calcula DataResolucao/TempoResolucaoHoras conforme a transição de status.
 */
function resolveResolution_(oldRecord, newStatus, opening, now) {
  const wasFinal = isFinalStatus_(oldRecord.Status);
  const isFinal = isFinalStatus_(newStatus);
  if (isFinal && !wasFinal) {
    return { date: now, hours: roundHours_(diffInHours(opening, now)) };
  }
  if (!isFinal && wasFinal) {
    return { date: '', hours: '' };
  }
  return { date: oldRecord.DataResolucao, hours: oldRecord.TempoResolucaoHoras };
}

/**
 * Monta o rótulo exibido do status, incluindo "Aguardando Retorno de"
 * quando o status é Pendente. Ex.: "Pendente (Área)".
 * @param {string} status - Nome do status.
 * @param {string} situacao - Aguardando retorno de (Área/Cliente).
 * @returns {string} Rótulo formatado.
 */
function statusLabel_(status, situacao) {
  return situacao && isWaitingStatus_(status)
    ? status + ' (' + situacao + ')'
    : String(status || '');
}

/**
 * Escritas atômicas do atendimento: a verificação de protocolo duplicado e
 * a gravação acontecem sob o mesmo lock para impedir duplicidades em
 * requisições paralelas. A unicidade é verificada nas três abas por canal.
 */
function insertAtendimentoUnique_(record, sheetName) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    const ss = getSpreadsheet();
    assertUniqueNumeroRAAllSheets_(ss, record.NumeroRA, '');
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Aba do canal não encontrada: ' + sheetName);
    const row = toRowArray(record, COLUMNS.ATENDIMENTOS);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    invalidateCache(sheetName);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* lock não adquirido */ }
  }
}

/**
 * Atualiza um atendimento em sua aba atual. Quando o canal muda
 * (fromSheetName !== toSheetName), o registro é movido para a aba do novo
 * canal — removido da origem e regravado no destino, sob o mesmo lock.
 */
function updateAtendimentoUnique_(id, updates, fromSheetName, toSheetName) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    const ss = getSpreadsheet();
    if (updates.NumeroRA !== undefined) {
      assertUniqueNumeroRAAllSheets_(ss, updates.NumeroRA, id);
    }
    const fromSheet = ss.getSheetByName(fromSheetName);
    if (!fromSheet) throw new Error('Aba do canal não encontrada: ' + fromSheetName);
    const rowIndex = findRowById(fromSheet, id);
    if (rowIndex === -1) throw new Error('Atendimento não encontrado.');
    const currentRow = fromSheet.getRange(rowIndex, 1, 1, COLUMNS.ATENDIMENTOS.length).getValues()[0];
    const current = toObject(currentRow, COLUMNS.ATENDIMENTOS);
    Object.keys(updates).forEach(function(key) { current[key] = updates[key]; });
    const newRow = toRowArray(current, COLUMNS.ATENDIMENTOS);

    if (toSheetName && toSheetName !== fromSheetName) {
      const toSheet = ss.getSheetByName(toSheetName);
      if (!toSheet) throw new Error('Aba do canal não encontrada: ' + toSheetName);
      toSheet.getRange(toSheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
      fromSheet.deleteRow(rowIndex);
      invalidateCache(toSheetName);
    } else {
      fromSheet.getRange(rowIndex, 1, 1, COLUMNS.ATENDIMENTOS.length).setValues([newRow]);
    }
    invalidateCache(fromSheetName);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* lock não adquirido */ }
  }
}

/**
 * Verifica a duplicidade do protocolo nas três abas por canal.
 * Protocolos vazios não são verificados (campo pode ser opcional na
 * ConfigCampos).
 */
function assertUniqueNumeroRAAllSheets_(ss, numeroRA, ignoredId) {
  const normalized = normalizeText_(numeroRA);
  if (!normalized) return;
  const idIndex = COLUMNS.ATENDIMENTOS.indexOf('Id');
  const raIndex = COLUMNS.ATENDIMENTOS.indexOf('NumeroRA');
  const deletedIndex = COLUMNS.ATENDIMENTOS.indexOf('Excluido');

  const duplicate = getAtendimentoSheetNames_().some(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return false;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.ATENDIMENTOS.length).getValues();
    return data.some(function(row) {
      return String(row[idIndex]) !== String(ignoredId || '') &&
        !isTrue_(row[deletedIndex]) &&
        normalizeText_(row[raIndex]) === normalized;
    });
  });
  if (duplicate) throw new Error('Já existe um atendimento com este protocolo.');
}

// ============================================================================
// STATUS (regras fixas do fluxo)
// ============================================================================

/**
 * Indica se o status é "Pendente" (exige "Aguardando Retorno de").
 * @param {string} statusName - Nome do status.
 * @returns {boolean}
 */
function isWaitingStatus_(statusName) {
  return normalizeText_(statusName) === 'pendente';
}

/**
 * Indica se o status é final ("Concluído").
 * @param {string} statusName - Nome do status.
 * @returns {boolean}
 */
function isFinalStatus_(statusName) {
  return normalizeText_(statusName) === 'concluido';
}

/**
 * Mapa Nome do status → cor (STATUS_LIST em Config.gs).
 * @returns {Object} Ex.: { "Pendente": "#FF9800", ... }.
 */
function getStatusColorMap_() {
  const map = {};
  STATUS_LIST.forEach(function(item) { map[item.Nome] = item.Cor; });
  return map;
}

// ============================================================================
// TIMELINE E HISTÓRICO
// ============================================================================

/**
 * Retorna a timeline de um atendimento, da mais recente para a mais
 * antiga, no formato consumido pelo frontend.
 * @param {string} atendimentoId - Id do atendimento.
 * @returns {Object[]} Eventos da timeline.
 */
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

/**
 * Insere um evento na aba Timeline.
 * @param {string} atendimentoId - Id do atendimento.
 * @param {string} tipo - Tipo do evento (Criação, Observação...).
 * @param {string} descricao - Descrição do evento.
 * @param {string} de - Valor anterior (quando aplicável).
 * @param {string} para - Valor novo (quando aplicável).
 * @param {string} usuario - Nome de quem executou a ação.
 * @param {string} detalhes - Informações complementares.
 * @param {Date} [eventDate] - Data do evento (padrão: agora).
 * @returns {string} Id do evento criado.
 */
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

/**
 * Compara o registro antigo com as atualizações e monta as linhas de
 * histórico (uma por campo alterado), ignorando campos de controle.
 * @param {string} atendimentoId - Id do atendimento.
 * @param {Object} oldRecord - Registro antes da alteração.
 * @param {Object} updates - Novos valores.
 * @param {string} userName - Autor da alteração.
 * @param {string} justification - Justificativa informada.
 * @returns {Object[]} Linhas prontas para a aba Histórico.
 */
function buildChangeHistory_(atendimentoId, oldRecord, updates, userName, justification) {
  const ignored = ['AtualizadoPor', 'DataAtualizacao', 'DataResolucao', 'TempoResolucaoHoras'];
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
// DASHBOARD
// ============================================================================

/**
 * Retorna, em UMA única chamada, tudo o que o Dashboard precisa:
 * cartões de resumo + lista de atendimentos do usuário (Analista vê só os
 * seus; Supervisor vê todos). Evita múltiplas idas ao servidor e telas de
 * carregamento em sequência.
 */
function getDashboardData() {
  ensureDatabaseReady();
  const actor = getActor_();
  const raw = restrictToOwnerIfNeeded_(getActiveAtendimentos_(), actor);
  const records = decorateAtendimentos_(raw);
  sortClientRecords_(records, { campo: 'dataAbertura', direcao: 'desc' });

  const cards = {
    totalAtendimentos: records.length,
    pendentes: 0,
    emAnalise: 0,
    concluidos: 0
  };
  const porSituacao = {};
  SITUACOES_PENDENCIA.forEach(function(situacao) { porSituacao[situacao] = 0; });

  // Indicadores por canal (ReclameAqui, ChatPrivadoRA e SACPreventivo).
  const porCanal = {};
  CANAIS_LIST.forEach(function(canal) {
    porCanal[canal] = { total: 0, pendentes: 0, emAnalise: 0, concluidos: 0 };
  });

  records.forEach(function(record) {
    let bucket = null;
    for (let i = 0; i < CANAIS_LIST.length; i++) {
      if (normalizeText_(CANAIS_LIST[i]) === normalizeText_(record.canal)) {
        bucket = porCanal[CANAIS_LIST[i]];
        break;
      }
    }
    if (bucket) bucket.total++;

    if (isFinalStatus_(record.status)) {
      cards.concluidos++;
      if (bucket) bucket.concluidos++;
    } else if (isWaitingStatus_(record.status)) {
      cards.pendentes++;
      if (bucket) bucket.pendentes++;
      if (porSituacao[record.situacaoPendencia] !== undefined) {
        porSituacao[record.situacaoPendencia]++;
      }
    } else {
      cards.emAnalise++;
      if (bucket) bucket.emAnalise++;
    }
  });

  return {
    cards: cards,
    porSituacao: porSituacao,
    porCanal: porCanal,
    atendimentos: records,
    user: actor
  };
}

// ============================================================================
// RELATÓRIOS
// ============================================================================

/**
 * Gera os dados do relatório com os filtros informados, respeitando as
 * permissões do usuário (Analista vê apenas os próprios atendimentos).
 * @param {Object} filtros - Filtros da tela de Relatórios.
 * @returns {Object[]} Atendimentos no formato do frontend.
 */
function getRelatorio(filtros) {
  ensureDatabaseReady();
  const actor = getActor_();
  return decorateAtendimentos_(
    applyAtendimentoFilters_(restrictToOwnerIfNeeded_(getActiveAtendimentos_(), actor), filtros || {})
  );
}

// ============================================================================
// CONFIGURAÇÕES ADMINISTRÁVEIS (Produtos, Categorias, Usuários)
// ============================================================================

/**
 * Retorna as entidades administráveis visíveis para o usuário logado.
 * Usuários e Campos do formulário aparecem apenas para o ADM.
 * @returns {Object} { entities, user }.
 */
function getConfiguracoes() {
  ensureDatabaseReady();
  requireSupervisor_();
  const isAdmin = isAdminProfile_(getActor_().perfil);
  const entities = getConfigurationEntities_();
  const result = {};
  Object.keys(entities).forEach(function(key) {
    // Gestão de usuários e dos campos do formulário são exclusivas do ADM.
    if (entities[key].adminOnly && !isAdmin) return;
    result[key] = getAll(entities[key].sheet).map(serializeRecord_);
  });
  return { entities: result, user: getActor_() };
}

/**
 * Cria ou atualiza um registro de configuração (produto, categoria,
 * usuário ou campo do formulário), com validações por entidade e
 * auditoria no Histórico. Entidades adminOnly exigem perfil ADM.
 * @param {string} entidade - Chave da entidade (ex.: "produtos").
 * @param {Object} dados - Valores do formulário de configuração.
 * @param {string} id - Id do registro (vazio para criação).
 * @returns {Object} { success, id }.
 */
function salvarConfiguracao(entidade, dados, id) {
  ensureDatabaseReady();
  requireSupervisor_();
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');
  if (meta.adminOnly) requireAdmin_();

  const input = dados || {};
  const record = {};
  meta.columns.forEach(function(column) {
    if (column === 'Id') return;
    if (input[column] === undefined) return;
    if (['Ativo', 'Exibir', 'Obrigatorio'].indexOf(column) !== -1) {
      record[column] = isTrue_(input[column]);
    } else if (column === 'Ordem') {
      record[column] = input[column] === '' ? '' : Number(input[column]);
    } else {
      record[column] = sanitizeInput(input[column]);
    }
  });

  if (meta.key === 'camposFormulario') {
    if (!record.Rotulo) throw new Error('Rótulo do campo é obrigatório.');
  } else if (!record.Nome) {
    throw new Error('Nome é obrigatório.');
  }
  if (meta.key === 'usuarios' && record.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.Email)) {
    throw new Error('E-mail inválido.');
  }
  if (meta.key === 'usuarios' && ['Analista', 'Supervisor', 'ADM'].indexOf(record.Perfil) === -1) {
    throw new Error('Perfil de usuário inválido.');
  }
  if (meta.key === 'categorias' && record.ProdutoId &&
      !getById(CONFIG.SHEET_NAMES.PRODUTOS, record.ProdutoId)) {
    throw new Error('Produto informado para a categoria não existe.');
  }

  let recordId = sanitizeInput(id);
  const exists = recordId ? getById(meta.sheet, recordId) : null;
  if (meta.key === 'usuarios' && exists && isTrue_(exists.Ativo) &&
      normalizeText_(exists.Perfil) === 'adm' &&
      (!isTrue_(record.Ativo) || normalizeText_(record.Perfil) !== 'adm')) {
    assertAnotherAdmin_(recordId);
  }
  if (meta.key === 'camposFormulario') {
    if (exists) {
      // Campos bloqueados (ex: Canal) não podem ser ocultados/desobrigados;
      // a chave interna e a origem (Base) nunca mudam pela interface.
      if (isTrue_(exists.Bloqueado)) {
        record.Exibir = true;
        record.Obrigatorio = true;
      }
      delete record.Campo;
      delete record.Base;
      delete record.Bloqueado;
    } else {
      // Campo novo criado pelo ADM: gera a chave interna a partir do rótulo
      // e grava os valores na coluna CamposExtras dos atendimentos.
      record.Campo = slugifyFieldKey_(record.Rotulo);
      if (!record.Campo) throw new Error('Rótulo do campo é inválido.');
      const clash = getFormConfig_().some(function(field) {
        return field.campo === record.Campo;
      });
      if (clash) throw new Error('Já existe um campo com este rótulo.');
      record.Base = false;
      record.Bloqueado = false;
      if (!record.Tipo) record.Tipo = 'text';
    }
  }
  if (exists) {
    update(meta.sheet, recordId, record);
  } else {
    record.Id = recordId || generateId(meta.prefix);
    recordId = record.Id;
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

/**
 * Desativa (produtos/categorias/usuários) ou remove (campos
 * personalizados do formulário) um registro de configuração.
 * @param {string} entidade - Chave da entidade.
 * @param {string} id - Id do registro.
 * @returns {Object} { success }.
 */
function excluirConfiguracao(entidade, id) {
  ensureDatabaseReady();
  requireSupervisor_();
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');
  if (meta.adminOnly) requireAdmin_();
  const safeId = sanitizeInput(id);
  const existing = getById(meta.sheet, safeId);
  if (!existing) throw new Error('Registro não encontrado.');
  if (meta.key === 'usuarios' && isTrue_(existing.Ativo) && normalizeText_(existing.Perfil) === 'adm') {
    assertAnotherAdmin_(safeId);
  }

  if (meta.key === 'camposFormulario') {
    // Campos base do sistema não podem ser removidos (apenas ocultados);
    // campos personalizados são excluídos de fato da ConfigCampos.
    if (isTrue_(existing.Bloqueado)) {
      throw new Error('Este campo é fixo do fluxo e não pode ser removido.');
    }
    if (isTrue_(existing.Base)) {
      throw new Error('Campos padrão não podem ser removidos. Desmarque "Exibir" para ocultá-los do formulário.');
    }
    remove(meta.sheet, safeId);
  } else {
    // Desativação lógica preserva o histórico dos atendimentos já vinculados.
    update(meta.sheet, safeId, { Ativo: false });
  }
  auditConfiguration_(meta.key === 'camposFormulario' ? 'Exclusão' : 'Desativação', meta.label, safeId, existing);
  invalidateAllCache();
  SERVICE_CONTEXT_ = {};
  return { success: true };
}

/**
 * Metadados das entidades administráveis pela tela de Configurações:
 * aba, colunas, prefixo de Id e restrição de acesso (adminOnly).
 * @returns {Object} Mapa chave → metadados da entidade.
 */
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
    usuarios: {
      key: 'usuarios', label: 'Usuários e responsáveis', sheet: CONFIG.SHEET_NAMES.USUARIOS,
      columns: COLUMNS.USUARIOS, prefix: 'USR', adminOnly: true
    },
    camposFormulario: {
      key: 'camposFormulario', label: 'Campos do formulário', sheet: CONFIG.SHEET_NAMES.CONFIG_CAMPOS,
      columns: COLUMNS.CONFIG_CAMPOS, prefix: 'FC', adminOnly: true
    }
  };
}

/**
 * Gera a chave interna de um campo personalizado a partir do rótulo
 * (ex: "Número da Agência" → "numeroDaAgencia").
 */
function slugifyFieldKey_(rotulo) {
  const words = normalizeText_(rotulo).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(w) { return w; });
  if (!words.length) return '';
  return words.map(function(word, index) {
    return index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
  }).join('');
}

/**
 * Registra no Histórico toda criação/alteração/desativação feita pela
 * tela de Configurações.
 * @param {string} action - Ação executada.
 * @param {string} label - Nome amigável da entidade.
 * @param {string} id - Id do registro afetado.
 * @param {Object} value - Valores gravados.
 */
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

/**
 * Garante que exista outro ADM ativo antes de remover/demover um ADM,
 * evitando que o sistema fique sem administrador.
 * @param {string} ignoredId - Id do usuário sendo alterado.
 * @throws {Error} Quando não há outro ADM ativo.
 */
function assertAnotherAdmin_(ignoredId) {
  const activeAdmins = getAll(CONFIG.SHEET_NAMES.USUARIOS).filter(function(user) {
    return String(user.Id) !== String(ignoredId) &&
      isTrue_(user.Ativo) &&
      normalizeText_(user.Perfil) === 'adm';
  });
  if (!activeAdmins.length) {
    throw new Error('Cadastre outro ADM ativo antes de remover este acesso.');
  }
}

// ============================================================================
// CONVERSÃO E SEGURANÇA
// ============================================================================

/**
 * Converte uma lista de registros da planilha para o formato do
 * frontend, incluindo a cor do status.
 * @param {Object[]} records - Registros crus da planilha.
 * @returns {Object[]} Registros no formato do cliente.
 */
function decorateAtendimentos_(records) {
  const colorMap = getStatusColorMap_();
  return records.map(function(record) {
    return toClientAtendimento_(record, colorMap);
  });
}

/**
 * Converte um registro da planilha para o objeto consumido pelo
 * frontend (datas em ISO, extras parseados, cor do status).
 * @param {Object} record - Registro cru da planilha.
 * @param {Object} colorMap - Mapa status → cor.
 * @returns {Object} Atendimento no formato do cliente.
 */
function toClientAtendimento_(record, colorMap) {
  return {
    id: String(record.Id || ''),
    numeroRA: String(record.NumeroRA || ''),
    dataAbertura: toIso_(record.DataAbertura),
    dataConclusao: toIso_(record.DataResolucao),
    canal: String(record.Canal || ''),
    cliente: String(record.Cliente || ''),
    cpf: String(record.CPF || ''),
    produto: String(record.Produto || ''),
    categoria: String(record.Categoria || ''),
    status: String(record.Status || ''),
    statusCor: colorMap[String(record.Status || '')] || '',
    situacaoPendencia: String(record.MotivoPendencia || ''),
    motivoPendencia: String(record.MotivoPendencia || ''),
    aguardandoRetorno: String(record.MotivoPendencia || ''),
    camposExtras: parseCamposExtras_(record.CamposExtras),
    responsavel: String(record.Responsavel || ''),
    tempoResolucao: record.TempoResolucaoHoras === '' ? '' : Number(record.TempoResolucaoHoras || 0),
    observacoes: String(record.Observacoes || ''),
    criadoPor: String(record.CriadoPor || ''),
    dataCriacao: toIso_(record.DataCriacao),
    atualizadoPor: String(record.AtualizadoPor || ''),
    dataAtualizacao: toIso_(record.DataAtualizacao)
  };
}

/**
 * Converte o JSON da coluna CamposExtras em objeto simples { campo: valor }.
 */
function parseCamposExtras_(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * Identifica o usuário logado: cruza o e-mail da sessão Google com a
 * aba Usuários para obter nome, perfil e equipe. O resultado é cacheado
 * por execução (SERVICE_CONTEXT_). Sem correspondência, assume o perfil
 * Analista (menor privilégio).
 * @returns {Object} { id, email, nome, perfil, equipe }.
 */
function getActor_() {
  if (SERVICE_CONTEXT_.actor) return SERVICE_CONTEXT_.actor;
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
  SERVICE_CONTEXT_.actor = {
    id: user ? String(user.Id || '') : '',
    email: email,
    nome: user ? String(user.Nome || '') : (email ? email.split('@')[0] : 'Usuário'),
    perfil: user ? String(user.Perfil || 'Analista') : 'Analista',
    equipe: user ? String(user.Equipe || '') : ''
  };
  return SERVICE_CONTEXT_.actor;
}

/**
 * Interrompe a execução se o usuário não for Supervisor nem ADM.
 * @throws {Error} Quando o perfil não tem permissão.
 */
function requireSupervisor_() {
  const actor = getActor_();
  if (!isSupervisorProfile_(actor.perfil)) {
    throw new Error('Apenas supervisores ou o ADM podem alterar as configurações.');
  }
}

/**
 * Interrompe a execução se o usuário não for ADM.
 * @throws {Error} Quando o perfil não tem permissão.
 */
function requireAdmin_() {
  const actor = getActor_();
  if (!isAdminProfile_(actor.perfil)) {
    throw new Error('Apenas o ADM pode executar esta ação.');
  }
}

/**
 * Verifica se um perfil corresponde ao ADM (acesso total: gestão de
 * usuários, campos do formulário e configurações críticas).
 */
function isAdminProfile_(perfil) {
  return ['adm', 'admin', 'administrador'].indexOf(normalizeText_(perfil)) !== -1;
}

/**
 * Verifica se um perfil corresponde a um nível de supervisão/gestão
 * (Supervisor ou ADM). Usado para controlar quem vê/edita todos os
 * atendimentos e quem vê/edita apenas os próprios (Analista).
 */
function isSupervisorProfile_(perfil) {
  return ['supervisor', 'gestor'].indexOf(normalizeText_(perfil)) !== -1 || isAdminProfile_(perfil);
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

// ============================================================================
// AUXILIARES DE DATA E VALORES
// ============================================================================

/**
 * Converte um valor vindo do formulário (AAAA-MM-DD ou Date) em Date.
 * @param {*} value - Valor a converter.
 * @param {boolean} endOfDay - true para 23:59:59.999 (fim de período).
 * @returns {Date|null} Data convertida ou null se inválida.
 */
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
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    );
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Converte um valor qualquer em Date, retornando null se inválido.
 * @param {*} value - Valor a converter.
 * @returns {Date|null}
 */
function asDate_(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Converte um valor de data para string ISO (ou "" se inválido).
 * @param {*} value - Valor a converter.
 * @returns {string}
 */
function toIso_(value) {
  const date = asDate_(value);
  return date ? date.toISOString() : '';
}

/**
 * Arredonda horas para duas casas decimais.
 * @param {number} hours - Valor em horas.
 * @returns {number}
 */
function roundHours_(hours) {
  return Math.round(Number(hours || 0) * 100) / 100;
}

/**
 * Normaliza um valor para comparação no histórico de alterações
 * (datas viram ISO; null/undefined viram "").
 * @param {*} value - Valor a normalizar.
 * @returns {string}
 */
function comparableValue_(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Serializa um registro para envio ao frontend (datas em ISO).
 * @param {Object} record - Registro da planilha.
 * @returns {Object}
 */
function serializeRecord_(record) {
  const result = {};
  Object.keys(record || {}).forEach(function(key) {
    result[key] = record[key] instanceof Date ? record[key].toISOString() : record[key];
  });
  return result;
}

/**
 * Normaliza texto para comparações: minúsculas, sem acentos e sem
 * espaços nas pontas.
 * @param {*} value - Valor a normalizar.
 * @returns {string}
 */
function normalizeText_(value) {
  let text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  try {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    // normalize pode não existir em runtimes legados.
  }
  return text;
}

/**
 * Interpreta valores "verdadeiros" vindos da planilha ou de formulários
 * (true, 1, "sim", "ativo", "true").
 * @param {*} value - Valor a interpretar.
 * @returns {boolean}
 */
function isTrue_(value) {
  return value === true || value === 1 ||
    ['true', 'sim', '1', 'ativo'].indexOf(normalizeText_(value)) !== -1;
}

/**
 * Indexa uma lista de objetos por um campo (ex.: Id → objeto).
 * @param {Object[]} items - Lista de objetos.
 * @param {string} field - Campo usado como chave.
 * @returns {Object}
 */
function indexBy_(items, field) {
  const index = {};
  items.forEach(function(item) { index[String(item[field] || '')] = item; });
  return index;
}

/**
 * Extrai os valores não vazios de um campo em uma lista de objetos.
 * @param {Object[]} items - Lista de objetos.
 * @param {string} field - Campo a extrair.
 * @returns {string[]}
 */
function pluck_(items, field) {
  return items.map(function(item) { return String(item[field] || ''); }).filter(function(value) { return value; });
}
