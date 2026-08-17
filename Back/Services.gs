/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Camada de serviços
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
 *     SACPreventivo); consultas consolidam todas as abas. Canais criados
 *     pelo ADM sem aba própria são gravados na aba ReclameAqui (a coluna
 *     Canal preserva o canal real). Os canais são administráveis pela
 *     tela de Configurações (aba Canais — v4.2).
 *   - Analista vê/edita apenas os próprios atendimentos; Supervisor e ADM
 *     veem todos e podem delegar/reatribuir (canAccessAtendimento_,
 *     restrictToOwnerIfNeeded_). Gestão de usuários e dos campos do
 *     formulário (ConfigCampos) são exclusivas do ADM (requireAdmin_).
 * ------------------------------------------------------------------------
 */

var SERVICE_CONTEXT_ = {};

// ============================================================================
// AUTENTICAÇÃO POR E-MAIL (v4.5 — sem login/senha)
// ============================================================================
/*
 * Por que existe: o Web App é implantado como "Executar como: eu" para a
 * planilha permanecer privada do dono. Nesse modo o Google normalmente não
 * revela a identidade dos visitantes — mas, para este sistema, a implantação
 * exige que o próprio usuário conceda acesso (executar como usuário
 * acessando), então Session.getActiveUser() sempre traz o e-mail de quem
 * está usando o app. requireAuth_ cruza esse e-mail com a aba Usuários:
 * se existir um cadastro ATIVO, o acesso é liberado e nome/perfil/equipe
 * são carregados automaticamente; caso contrário, o acesso é bloqueado.
 * Não há login, senha, hash ou token de sessão — a identidade é sempre a
 * da conta Google autenticada.
 */

/**
 * Barreira de autenticação de TODAS as funções públicas: resolve o usuário
 * pelo e-mail da conta Google autenticada, consultando a aba Usuários.
 * Sem e-mail cadastrado e ativo, a execução é interrompida. O ator
 * resolvido fica em SERVICE_CONTEXT_ e passa a ser retornado por
 * getActor_ no restante da execução.
 * @returns {Object} Ator autenticado { id, email, nome, perfil, equipe }.
 * @throws {Error} 'AUTH: ...' quando o e-mail não está cadastrado/ativo.
 */
/**
 * Localiza o usuário ativo pelo e-mail na aba "Usuários" do modelo 4.x.
 * @param {string} email - E-mail da conta Google autenticada.
 * @returns {Object|null} Registro do usuário, ou null.
 */
function resolverUsuarioLegado_(email) {
  return getAll(CONFIG.SHEET_NAMES.USUARIOS).find(function(item) {
    return normalizeText_(item.Email) === normalizeText_(email) && isTrue_(item.Ativo);
  }) || null;
}

/**
 * Localiza o usuário ativo pelo e-mail na aba "Usuários" do PGO 5.0 e
 * resolve o PERFIL a partir de NivelAcessoId → Configurações
 * (Tipo = 'NIVEL_ACESSO'), devolvendo o registro no mesmo formato que o
 * restante do sistema já espera (campo "Perfil").
 *
 * ESCOPO DESTA ETAPA: é apenas a leitura mínima que mantém o login
 * funcionando sobre a base nova. A matriz completa de cargos e níveis de
 * acesso é assunto de uma etapa posterior — por isso, quando o nível não
 * puder ser resolvido, o perfil cai em "Analista" (menor privilégio), nunca
 * em algo mais permissivo.
 *
 * @param {string} email - E-mail da conta Google autenticada.
 * @returns {Object|null} Registro compatível { Id, Nome, Email, Perfil, Equipe }.
 */
function resolverUsuarioPGO5_(email) {
  const usuario = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).find(function(item) {
    return normalizeText_(item.Email) === normalizeText_(email) && isTrue_(item.Ativo);
  });
  if (!usuario) return null;

  let perfil = '';
  const nivelId = String(usuario.NivelAcessoId || '').trim();
  if (nivelId) {
    const nivel = pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES).find(function(cfg) {
      // normalizeText_ preserva o "_", então o Tipo gravado é 'NIVEL_ACESSO'.
      return String(cfg.Id || '').trim().toUpperCase() === nivelId.toUpperCase() &&
        normalizeText_(cfg.Tipo) === 'nivel_acesso';
    });
    if (nivel) perfil = String(nivel.Nome || '').trim();
  }

  return {
    Id: usuario.Id,
    Nome: usuario.Nome,
    Email: usuario.Email,
    Perfil: perfil || 'Analista',   // sem nível resolvido → menor privilégio
    Equipe: usuario.Equipe
  };
}

function requireAuth_() {
  ensureDatabaseReady();
  if (SERVICE_CONTEXT_.actor && SERVICE_CONTEXT_.authenticated) return SERVICE_CONTEXT_.actor;

  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }

  // A aba "Usuários" existe nos DOIS schemas, com colunas diferentes. Numa
  // base PGO 5.0 o perfil não vem de uma coluna "Perfil" e sim de
  // NivelAcessoId → Configurações, então a leitura precisa ser específica.
  const user = email
    ? (estruturaEhPGO5_() ? resolverUsuarioPGO5_(email) : resolverUsuarioLegado_(email))
    : null;

  if (!user) {
    throw new Error('AUTH: Seu e-mail não está cadastrado para utilizar o ' + CONFIG.APP.NOME_CURTO + '. Entre em contato com o Administrador para solicitar seu acesso.');
  }

  SERVICE_CONTEXT_.actor = {
    id: String(user.Id || ''),
    email: String(user.Email || email || ''),
    nome: String(user.Nome || ''),
    perfil: String(user.Perfil || 'Analista'),
    equipe: String(user.Equipe || '')
  };
  SERVICE_CONTEXT_.authenticated = true;
  return SERVICE_CONTEXT_.actor;
}

// ============================================================================
// INICIALIZAÇÃO E DADOS DE APOIO
// ============================================================================

/**
 * Dados de apoio carregados uma única vez pelo frontend na inicialização:
 * usuário logado + listas dos formulários/filtros. Status e situações de
 * pendência são fixos (Config.gs); produtos, categorias, usuários e
 * CANAIS (v4.2 — administráveis pelo ADM) vêm da planilha.
 */
function getBootstrapData() {
  requireAuth_();

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

  // v4.6: subcategorias agrupadas por Produto → Categoria (nomes), para a
  // cascata do formulário. O agrupamento inclui o produto porque categorias
  // de produtos diferentes podem ter o MESMO nome (ex.: "Cobrança indevida")
  // — a chave composta evita misturar as subcategorias delas. Categorias sem
  // produto entram no grupo 'Geral' (mesma convenção de categoriasPorProduto).
  // Subcategorias de categorias inativas/excluídas não aparecem (a lista
  // "categorias" acima já vem filtrada por Ativo).
  const categoriaPorId = indexBy_(categorias, 'Id');
  const subcategorias = activeSorted_(CONFIG.SHEET_NAMES.SUBCATEGORIAS);
  const subcategoriasPorProdutoCategoria = {};
  subcategorias.forEach(function(sub) {
    const categoria = categoriaPorId[String(sub.CategoriaId || '')];
    if (!categoria) return; // vínculo órfão: não oferece no formulário
    const produto = produtoPorId[String(categoria.ProdutoId || '')];
    const nomeProduto = produto ? produto.Nome : 'Geral';
    const nomeCategoria = String(categoria.Nome || '');
    if (!subcategoriasPorProdutoCategoria[nomeProduto]) {
      subcategoriasPorProdutoCategoria[nomeProduto] = {};
    }
    if (!subcategoriasPorProdutoCategoria[nomeProduto][nomeCategoria]) {
      subcategoriasPorProdutoCategoria[nomeProduto][nomeCategoria] = [];
    }
    subcategoriasPorProdutoCategoria[nomeProduto][nomeCategoria].push(String(sub.Nome || ''));
  });

  // v4.7: resumo do módulo Indicadores Operacionais para o menu (rótulo
  // dinâmico definido pelo ADM). Lê apenas Script Properties — sem leitura
  // extra de planilha. O item de menu aparece para Supervisor/ADM.
  const indicOpCfg = lerIndicOpConfig_();

  return {
    user: getActor_(),
    formConfig: getFormConfig_(),
    // Qual banco está por trás desta instalação: 'LEGADO' (4.x) ou 'PGO5'.
    // O front precisa saber para escolher entre o formulário do modelo
    // antigo e o motor dinâmico do 5.0 — sem isso ele teria de descobrir
    // por tentativa e erro a cada abertura de tela.
    schemaBanco: (typeof detectarEstruturaBanco_ === 'function') ? detectarEstruturaBanco_() : 'LEGADO',
    // Permissões efetivas do usuário no PGO 5.0. Servem para a interface
    // esconder o que ele não pode fazer — NUNCA como controle de acesso:
    // toda função sensível revalida no servidor (ver exigirPermissao_).
    // Numa base 4.x isto vem vazio e as telas seguem a regra antiga.
    // A checagem de tipo evita que um projeto publicado pela metade
    // (Services.gs novo, Pgo5Permissoes.gs ainda não enviado) derrube o
    // bootstrap inteiro. Sem o módulo, a interface só perde os atalhos
    // administrativos — o sistema continua abrindo.
    acessoPGO5: (typeof montarResumoDeAcessoPGO5_ === 'function')
      ? montarResumoDeAcessoPGO5_()
      : { schema: 'LEGADO', cargo: '', nivelAcesso: '', permissoes: [], escopos: {} },
    // Rótulos visíveis das telas (personalizáveis pelo ADM). Vão para
    // TODOS os perfis — quem só visualiza precisa ver o mesmo nome. As
    // permissões de cada tela seguem inalteradas.
    nomesTelas: lerNomesTelas_(),
    moduloIndicadoresOp: {
      abaNome: indicOpCfg.abaNome,
      habilitado: indicOpCfg.habilitado
    },
    dropdownData: montarDropdownData_({
      produtos: pluck_(produtos, 'Nome'),
      categorias: pluck_(categorias, 'Nome'),
      categoriasPorProduto: categoriasPorProduto,
      subcategoriasPorProdutoCategoria: subcategoriasPorProdutoCategoria, // v4.6
      // v4.6: lista plana e sem repetições das subcategorias ativas, usada
      // pelos FILTROS (Dashboard e Relatórios), onde não há produto/categoria
      // escolhidos para restringir a cascata.
      subcategorias: pluck_(subcategorias, 'Nome').filter(function(nome, i, lista) {
        return nome && lista.indexOf(nome) === i;
      }),
      status: STATUS_LIST.map(function(item) { return item.Nome; }),
      situacoesPendencia: SITUACOES_PENDENCIA.slice(),
      canais: getCanaisAtivos_(), // v4.2: lista dinâmica (aba Canais)
      // Nomes puros — usados pelos FILTROS (Dashboard, Relatórios,
      // Indicadores), que continuam filtrando pela coluna Responsavel.
      responsaveis: pluck_(usuarios, 'Nome'),
      // v4.7 (Fase 2D): opções do SELETOR de responsável, com Id. O
      // formulário passa a enviar o Id — dois homônimos deixam de ser
      // indistinguíveis. Quando há nomes repetidos, o rótulo recebe a
      // Equipe (ou o Perfil) para o supervisor saber quem está escolhendo.
      // E-mail não é exposto aqui, por não ser necessário.
      responsaveisOpcoes: montarOpcoesResponsavel_(usuarios),
      statusCores: getStatusColorMap_()
    })
  };
}

/**
 * Ajusta as listas dos filtros conforme o banco da instalação.
 *
 * POR QUE ISTO EXISTE
 * As listas do 4.x saem das abas Produtos, Categorias e Subcategorias, que
 * NÃO existem no PGO 5.0 — lá tudo isso mora na aba Formulário. Sem esta
 * ponte, os filtros de Dashboard e Relatórios apareceriam vazios numa
 * instalação nova, e o usuário não conseguiria filtrar por produto.
 *
 * O formato devolvido é exatamente o mesmo nos dois bancos, então nenhuma
 * tela precisa saber onde está rodando.
 *
 * @param {Object} listasLegado Listas já montadas a partir das abas 4.x.
 * @returns {Object} As listas que o front deve usar.
 */
function montarDropdownData_(listasLegado) {
  if (!estruturaEhPGO5_() || typeof pgo5Hierarquia_ !== 'function') return listasLegado;

  const catalogo = pgo5CatalogoBruto_();
  const hierarquia = pgo5Hierarquia_(catalogo);
  const rotulos = function(lista) {
    return (lista || []).map(function(item) { return item.rotulo; });
  };

  // Cascatas indexadas por NOME: é assim que os filtros comparam, já que o
  // atendimento é exibido com o rótulo e não com o Id.
  const categoriasPorProduto = {};
  const subcategoriasPorProdutoCategoria = {};
  const todasCategorias = [];
  const todasSubcategorias = [];

  hierarquia.produtos.forEach(function(produto) {
    const categorias = hierarquia.categoriasPorProduto[produto.id] || [];
    categoriasPorProduto[produto.rotulo] = rotulos(categorias);
    subcategoriasPorProdutoCategoria[produto.rotulo] = {};

    categorias.forEach(function(categoria) {
      todasCategorias.push(categoria.rotulo);
      const subs = hierarquia.subcategoriasPorCategoria[categoria.id] || [];
      subcategoriasPorProdutoCategoria[produto.rotulo][categoria.rotulo] = rotulos(subs);
      subs.forEach(function(sub) { todasSubcategorias.push(sub.rotulo); });
    });
  });

  const semRepetir = function(lista) {
    return lista.filter(function(nome, i, todos) { return nome && todos.indexOf(nome) === i; });
  };

  const atualizado = {};
  Object.keys(listasLegado).forEach(function(chave) { atualizado[chave] = listasLegado[chave]; });
  atualizado.produtos = rotulos(hierarquia.produtos);
  atualizado.categorias = semRepetir(todasCategorias);
  atualizado.subcategorias = semRepetir(todasSubcategorias);
  atualizado.categoriasPorProduto = categoriasPorProduto;
  atualizado.subcategoriasPorProdutoCategoria = subcategoriasPorProdutoCategoria;
  atualizado.status = rotulos(pgo5Status_(catalogo));
  atualizado.situacoesPendencia = rotulos(pgo5Aguardando_(catalogo));
  atualizado.canais = rotulos(pgo5Canais_(catalogo));

  // O filtro de Responsável só pode oferecer quem o usuário realmente
  // enxerga. Antes vinha a lista inteira de usuários ativos: um analista
  // via o nome de todos os colegas no seletor, mesmo sem acesso a nenhum
  // atendimento deles. Isso é o organograma da operação vazando por um
  // filtro. O recorte usa o escopo de LEITURA, que é o mesmo aplicado aos
  // dados do Dashboard — as telas analíticas têm o próprio escopo e pedem
  // a lista delas em getFiltrosAnaliticosPGO5.
  const visiveis = listarResponsaveisDoEscopo_(
    getActor_(), obterEscopoAtendimentos_(atorComoUsuario_(getActor_()), 'ver'));
  atualizado.responsaveis = visiveis.map(function(pessoa) { return pessoa.nome; });
  atualizado.responsaveisOpcoes = visiveis.map(function(pessoa) {
    return { id: pessoa.id, nome: pessoa.nome, rotulo: pessoa.nome };
  });
  return atualizado;
}

/**
 * Monta as opções do seletor de responsável: { id, nome, rotulo }.
 * O rótulo só ganha o complemento (Equipe ou Perfil) quando existe mais
 * de um usuário ativo com o MESMO nome — evita poluir a lista no caso
 * comum e resolve a ambiguidade quando ela realmente existe.
 * @param {Object[]} usuarios - Usuários ativos ordenados.
 * @returns {Object[]} Opções para o <select>.
 */
function montarOpcoesResponsavel_(usuarios) {
  const ocorrencias = {};
  usuarios.forEach(function(u) {
    const chave = normalizeText_(u.Nome);
    ocorrencias[chave] = (ocorrencias[chave] || 0) + 1;
  });
  return usuarios.map(function(u) {
    const nome = String(u.Nome || '');
    const repetido = ocorrencias[normalizeText_(nome)] > 1;
    const complemento = repetido ? String(u.Equipe || u.Perfil || '').trim() : '';
    return {
      id: String(u.Id || ''),
      nome: nome,
      rotulo: complemento ? (nome + ' — ' + complemento) : nome
    };
  });
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
        bloqueado: isTrue_(item.Bloqueado),
        // v4.6: opções dos seletores personalizados (coluna Opcoes,
        // separadas por ";"). Campos base ignoram esta lista — produto,
        // categoria, subcategoria e canal têm fontes próprias.
        opcoes: String(item.Opcoes || '').split(';').map(function(opcao) {
          return opcao.trim();
        }).filter(function(opcao) { return opcao !== ''; })
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

/**
 * Nomes dos canais ATIVOS, na ordem definida pelo ADM (v4.2).
 * Fonte: aba "Canais" (administrável pela tela de Configurações).
 * Fallback de segurança: se a aba estiver vazia/indisponível, usa os
 * canais padrão CANAIS_LIST (Config.gs) para o sistema nunca ficar sem
 * canal no formulário de Novo Atendimento.
 * @returns {string[]} Ex.: ['Reclame Aqui', 'SAC Preventivo'].
 */
function getCanaisAtivos_() {
  try {
    const canais = pluck_(activeSorted_(CONFIG.SHEET_NAMES.CANAIS), 'Nome');
    return canais.length > 0 ? canais : CANAIS_LIST.slice();
  } catch (e) {
    // Falha transitória ao ler a aba Canais não pode derrubar o Dashboard
    // inteiro: recorre à lista padrão (mesmo fallback já previsto para a
    // aba vazia). A falha fica registrada no log para diagnóstico.
    Logger.log('[Dados] Falha ao ler a aba Canais — usando a lista padrão: ' + e.message);
    return CANAIS_LIST.slice();
  }
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
  requireAuth_();
  const found = findAtendimento_(sanitizeInput(id));
  if (!found || isTrue_(found.record.Excluido)) return null;
  if (!canAccessAtendimento_(found.record, getActor_())) return null;

  return {
    atendimento: toClientAtendimento_(found.record, getStatusColorMap_()),
    timeline: getTimelineInterna_(id)
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
  requireAuth_();
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
 * Verifica se o CPF informado já possui atendimento registrado.
 * Usada pelo alerta informativo do formulário: assim que o usuário
 * termina de digitar/colar o CPF, o frontend consulta esta função e, se
 * houver registro anterior, mostra um popup com o analista do PRIMEIRO
 * cadastro e a data. A consulta usa getActiveAtendimentos_ (dados já em
 * cache — nenhuma leitura extra da planilha) e NUNCA bloqueia o cadastro:
 * o mesmo cliente pode ter vários atendimentos.
 * @param {string} cpf - CPF digitado (com ou sem máscara).
 * @param {string} ignorarId - Id do próprio atendimento (em edições).
 * @returns {Object} { duplicado } ou { duplicado: true, cpf, analista,
 *   dataRegistro (ISO), status, categoria, subcategoria }.
 */
function verificarCpfDuplicado(cpf, ignorarId) {
  requireAuth_();
  const digitos = String(cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11) return { duplicado: false };
  const safeId = sanitizeInput(ignorarId);
  const actor = getActor_();

  // Percorre os atendimentos do CPF guardando dois candidatos:
  //  - o mais ANTIGO de todos (prova a existência do cadastro);
  //  - o mais ANTIGO que este usuário PODE ver (para exibir detalhes).
  let primeiro = null, primeiraData = null;
  let primeiroVisivel = null, primeiraDataVisivel = null;

  getActiveAtendimentos_().forEach(function(record) {
    if (String(record.Id) === String(safeId || '')) return;
    if (String(record.CPF || '').replace(/\D/g, '') !== digitos) return;
    const data = asDate_(record.DataCriacao) || asDate_(record.DataAbertura);

    if (!primeiro || (data && (!primeiraData || data < primeiraData))) {
      primeiro = record;
      primeiraData = data;
    }
    if (canAccessAtendimento_(record, actor)) {
      if (!primeiroVisivel || (data && (!primeiraDataVisivel || data < primeiraDataVisivel))) {
        primeiroVisivel = record;
        primeiraDataVisivel = data;
      }
    }
  });

  if (!primeiro) return { duplicado: false };

  // ── PRIVACIDADE (Fase 2D) ──
  // A decisão é do SERVIDOR: quando o usuário não tem autorização sobre
  // nenhum dos atendimentos do CPF, a resposta NÃO CARREGA os detalhes.
  // Não existe "campo oculto" — o dado simplesmente não sai daqui, então
  // nem pelo console do navegador ele é acessível.
  // ADM e Supervisor enxergam todos os atendimentos (canAccessAtendimento_
  // já devolve true para esses perfis), então recebem o detalhamento.
  if (!primeiroVisivel) {
    return {
      duplicado: true,
      restrito: true,
      cpf: formatCPF(digitos),
      // A data já fazia parte da regra operacional do aviso e é o mínimo
      // necessário para o analista entender que existe histórico.
      dataRegistro: toIso_(primeiraData)
    };
  }

  return {
    duplicado: true,
    restrito: false,
    cpf: formatCPF(digitos),
    analista: String(primeiroVisivel.CriadoPor || primeiroVisivel.Responsavel || ''),
    dataRegistro: toIso_(primeiraDataVisivel),
    status: statusLabel_(primeiroVisivel.Status, primeiroVisivel.MotivoPendencia),
    categoria: String(primeiroVisivel.Categoria || ''),
    subcategoria: String(primeiroVisivel.Subcategoria || '') // '' se não houver
  };
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
 * Todos os atendimentos ativos, consolidados das abas por canal.
 * FONTE ÚNICA de atendimentos do sistema: Dashboard, Indicadores,
 * Relatórios, pesquisas e validações usam esta função — o usuário nunca
 * precisa saber em qual aba o registro está gravado.
 * @param {boolean} forceRefresh - true ignora o cache e lê o Sheets
 *        diretamente (usado pelo fallback automático do frontend).
 */
function getActiveAtendimentos_(forceRefresh, tolerante) {
  // PONTE PGO 5.0: numa base nova os atendimentos vivem na aba única
  // "Atendimentos", com IDs no lugar de nomes. Convertê-los aqui, no
  // formato que o restante do sistema já consome, faz Dashboard, Relatórios
  // e Indicadores funcionarem sem reescrever nenhum deles — a adaptação
  // visual definitiva é assunto de uma etapa posterior.
  if (estruturaEhPGO5_()) return pgo5AtendimentosComoLegado_();

  const sheetNames = getAtendimentoSheetNames_();
  let records = [];
  const falhas = [];

  sheetNames.forEach(function(sheetName) {
    try {
      records = records.concat(getAll(sheetName, forceRefresh === true));
    } catch (e) {
      // MODO ESTRITO (padrão): qualquer falha de leitura interrompe a
      // operação. É o comportamento obrigatório para VALIDAÇÕES e
      // GRAVAÇÕES (ex.: checagem de protocolo duplicado) — um resultado
      // parcial poderia aprovar um duplicado ou apagar informação.
      if (!tolerante) throw e;

      // MODO TOLERANTE: usado apenas por telas de EXIBIÇÃO. Uma falha
      // transitória em uma aba não pode zerar o Dashboard inteiro; o que
      // foi lido é aproveitado e a falha é sinalizada ao frontend.
      falhas.push(sheetName);
      Logger.log('[Dados] Leitura tolerante — falha em "' + sheetName + '": ' + e.message);
    }
  });

  // Se NENHUMA aba pôde ser lida, isso não é "base vazia": é falha real.
  if (tolerante && falhas.length === sheetNames.length) {
    throw new Error('DADOS: não foi possível ler nenhuma das abas de atendimento no Google Sheets.');
  }

  // Registra os avisos no contexto da execução para getDashboardData
  // informar o usuário de que a visão está incompleta.
  if (tolerante) SERVICE_CONTEXT_.avisosLeitura = falhas;

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
    subcategoria: 'Subcategoria', // v4.6: suportado pelo servidor
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
    const opened = normalizarDataParaFiltro_(asDate_(record.DataAbertura));
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
  requireAuth_();
  const input = validateAtendimentoInput_(dados || {});

  const actor = getActor_();
  // Responsável definido no SERVIDOR: Analista não delega; Supervisor/ADM
  // delegam por Id validado (o nome vem do cadastro, não do navegador).
  const responsavel = resolverResponsavel_(input, actor);
  input.responsavel = responsavel.nome;

  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || now;
  const finalStatus = isFinalStatus_(input.status);

  // v4.7 — vínculo por ID estável (ver metadadosAtendimento_).
  input.camposExtras = mesclarMetadadosAtendimento_(input.camposExtras, {
    _responsavelId: responsavel.id,
    _criadoPorId: String(actor.id || '')
  });

  const record = {
    Id: generateId('ATD'),
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    Canal: input.canal,
    Cliente: input.cliente,
    CPF: input.cpf,
    Produto: input.produto,
    Categoria: input.categoria,
    Subcategoria: input.subcategoria, // v4.6
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
  requireAuth_();
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

  // Responsável resolvido no SERVIDOR (mesma regra da criação). Analista
  // mantém o caso consigo; Supervisor/ADM reatribuem por Id validado.
  const responsavel = resolverResponsavel_(input, actor, oldRecord.Responsavel);
  input.responsavel = responsavel.nome;

  const now = new Date();
  const opening = parseInputDate_(input.dataAbertura, false) || asDate_(oldRecord.DataAbertura) || now;
  const safeJustification = sanitizeInput(justificativa);
  const statusChanged = normalizeText_(oldRecord.Status) !== normalizeText_(input.status);

  // ── v4.7 — metadados de vínculo (Ids estáveis) ──
  // Regras, nesta ordem:
  //  1. os metadados que já existem são PRESERVADOS (validateAtendimentoInput_
  //     descarta chaves não declaradas, então precisam ser remesclados);
  //  2. houve REATRIBUIÇÃO (o nome do responsável mudou)? o Id é resolvido
  //     de novo; se o nome for ambíguo, a chave é removida e o registro
  //     volta ao comportamento legado por nome — nunca "chutamos" um Id;
  //  3. registro ANTIGO sendo editado legitimamente e ainda sem vínculo?
  //     recebe o Id agora, de forma natural (sem varredura da base).
  const metaAtual = metadadosAtendimento_(oldRecord);
  const novosMetadados = {
    _responsavelId: metaAtual._responsavelId || '',
    _criadoPorId: metaAtual._criadoPorId || ''
  };
  const trocouResponsavel =
    normalizeText_(oldRecord.Responsavel || '') !== normalizeText_(input.responsavel || '');
  if (responsavel.explicito) {
    // Seleção explícita por Id sempre manda. É o caso crítico da troca
    // entre HOMÔNIMOS: o nome continua idêntico, mas o Id muda — sem
    // esta regra o vínculo antigo permaneceria, apontando a pessoa errada.
    novosMetadados._responsavelId = responsavel.id;
  } else if (trocouResponsavel || !novosMetadados._responsavelId) {
    novosMetadados._responsavelId = responsavel.id;
  }
  if (!novosMetadados._criadoPorId) {
    novosMetadados._criadoPorId = resolverUsuarioIdPorNome_(oldRecord.CriadoPor);
  }
  input.camposExtras = mesclarMetadadosAtendimento_(input.camposExtras, novosMetadados);

  const resolution = resolveResolution_(oldRecord, input.status, opening, now);

  const updates = {
    NumeroRA: input.numeroRA,
    DataAbertura: opening,
    Canal: input.canal,
    Cliente: input.cliente,
    CPF: input.cpf,
    Produto: input.produto,
    Categoria: input.categoria,
    Subcategoria: input.subcategoria, // v4.6
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
  requireAuth_();
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
  requireAuth_();
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
  requireAuth_();
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
    subcategoria: sanitizeInput(dados.subcategoria), // v4.6: sempre opcional
    canal: sanitizeInput(dados.canal),
    responsavel: sanitizeInput(dados.responsavel),
    // v4.7 (Fase 2D): Id do responsável escolhido no seletor. É a fonte
    // confiável da delegação — o nome acima é apenas informativo e o
    // servidor o substitui pelo nome oficial do cadastro.
    responsavelId: sanitizeInput(dados.responsavelId),
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
  // v4.2: valida contra os canais ATIVOS cadastrados pelo ADM (aba Canais).
  const canalValido = getCanaisAtivos_().some(function(canal) {
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
    subcategoria: 'Subcategoria', // v4.6
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
 * Garante que TODAS as abas de atendimento estão com o cabeçalho alinhado
 * antes de qualquer gravação ou verificação de duplicidade.
 *
 * POR QUE TODAS (e não só a aba de destino):
 * a checagem de protocolo único percorre todas as abas por canal lendo as
 * colunas por POSIÇÃO. Se uma delas estivesse desalinhada, a verificação
 * leria a coluna errada e poderia deixar passar um protocolo duplicado.
 * Alinhando todas antes, a checagem e a gravação operam sobre a mesma
 * estrutura confiável. Abas já alinhadas não têm custo (só a leitura do
 * cabeçalho).
 * @param {Spreadsheet} ss - Planilha do sistema.
 * @throws {Error} 'ESTRUTURA: ...' quando alguma aba não é segura para gravar.
 */
function prepararAbasAtendimento_(ss) {
  getAtendimentoSheetNames_().forEach(function(nome) {
    const aba = ss.getSheetByName(nome);
    if (!aba) return; // aba ausente é tratada por quem for gravar nela
    prepararAbaParaGravacao_(aba, nome, COLUMNS.ATENDIMENTOS);
  });
}

/**
 * 🔴 ALTO RISCO — GRAVA UM ATENDIMENTO NOVO NA PLANILHA.
 *
 * Antes de salvar, nesta ordem:
 *   1. trava a operação (impede gravações simultâneas);
 *   2. confere e alinha o cabeçalho de todas as abas de atendimento;
 *   3. verifica se o protocolo já existe (dentro da mesma trava);
 *   4. somente depois grava a linha.
 *
 * ⚠️ Não remova essas validações. Elas evitam que informações sejam
 * gravadas em colunas incorretas e que dois atendimentos recebam o mesmo
 * protocolo em requisições paralelas.
 * @param {Object} record - Registro completo do atendimento.
 * @param {string} sheetName - Aba de destino (definida pelo canal).
 */
function insertAtendimentoUnique_(record, sheetName) {
  // withScriptLock_ é reentrante: se esta execução já detém a trava,
  // reutiliza em vez de travar a si mesma (ver Database.gs).
  withScriptLock_(function() {
    const ss = getSpreadsheet();

    // Estrutura primeiro: sem cabeçalho confiável, nada é gravado.
    prepararAbasAtendimento_(ss);

    // Protocolo único — mesma regra de antes, agora sobre dados alinhados.
    assertUniqueNumeroRAAllSheets_(ss, record.NumeroRA, '');

    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Aba do canal não encontrada: ' + sheetName);

    const row = toRowArray(record, COLUMNS.ATENDIMENTOS);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    invalidateCache(sheetName);
  });
}

/**
 * 🔴 ALTO RISCO — ATUALIZA UM ATENDIMENTO EXISTENTE.
 *
 * A linha é LIDA e REGRAVADA por posição, então o cabeçalho precisa estar
 * alinhado antes de tudo. Ordem obrigatória:
 *   1. trava a operação;
 *   2. confere e alinha o cabeçalho das abas de atendimento;
 *   3. verifica protocolo único (dentro da mesma trava);
 *   4. só então localiza a linha e regrava.
 *
 * O alinhamento vem ANTES de localizar a linha de propósito: corrigir a
 * estrutura pode reescrever a aba, e um índice obtido antes disso ficaria
 * desatualizado — o sistema poderia sobrescrever o registro vizinho.
 *
 * Quando o canal muda (fromSheetName !== toSheetName), o registro é movido:
 * gravado no destino e removido da origem, tudo sob a mesma trava.
 *
 * ⚠️ Não remova essas validações.
 * @param {string} id - Id do atendimento.
 * @param {Object} updates - Campos a alterar.
 * @param {string} fromSheetName - Aba atual do registro.
 * @param {string} toSheetName - Aba de destino (pode ser a mesma).
 */
function updateAtendimentoUnique_(id, updates, fromSheetName, toSheetName) {
  withScriptLock_(function() {
    const ss = getSpreadsheet();

    // 1) Estrutura de TODAS as abas de atendimento (origem, destino e as
    //    demais, que a checagem de duplicidade percorre).
    prepararAbasAtendimento_(ss);

    // 2) Protocolo único — regra inalterada, agora sobre dados alinhados.
    if (updates.NumeroRA !== undefined) {
      assertUniqueNumeroRAAllSheets_(ss, updates.NumeroRA, id);
    }

    const fromSheet = ss.getSheetByName(fromSheetName);
    if (!fromSheet) throw new Error('Aba do canal não encontrada: ' + fromSheetName);

    // 3) Só agora localiza a linha (a estrutura já está estável).
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
  });
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
  requireAuth_();
  // CORREÇÃO DE SEGURANÇA (Fase 1): esta função é pública — pode ser
  // chamada diretamente pelo navegador com QUALQUER Id. Antes ela só
  // exigia autenticação, então um Analista autenticado conseguia ler a
  // timeline de atendimentos de outros analistas (observações, mudanças
  // de status, nomes) apenas informando o Id. Agora a autorização é
  // verificada no SERVIDOR, com a mesma regra de getAtendimento.
  const id = sanitizeInput(atendimentoId);
  const found = findAtendimento_(id);

  // Id inexistente ou excluído: nada a devolver (não é erro de permissão).
  if (!found || isTrue_(found.record.Excluido)) return [];

  if (!canAccessAtendimento_(found.record, getActor_())) {
    throw new Error('Você não tem permissão para consultar o histórico deste atendimento.');
  }

  return getTimelineInterna_(id);
}

/**
 * Implementação da consulta de timeline, compartilhada entre a função
 * pública getTimeline (com autenticação) e chamadas internas do servidor
 * (ex.: getAtendimento, que já autenticou o usuário).
 * @param {string} atendimentoId - Id do atendimento.
 * @returns {Object[]} Eventos da timeline.
 */
function getTimelineInterna_(atendimentoId) {
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
    // v4.7: em CamposExtras, compara SÓ os campos visíveis. Os metadados
    // internos ("_responsavelId"/"_criadoPorId") não são alteração de
    // negócio e não devem gerar linha no Histórico.
    const oldValue = field === 'CamposExtras'
      ? comparableValue_(JSON.stringify(camposExtrasPublicos_(oldRecord[field])))
      : comparableValue_(oldRecord[field]);
    const newValue = field === 'CamposExtras'
      ? comparableValue_(JSON.stringify(camposExtrasPublicos_(updates[field])))
      : comparableValue_(updates[field]);
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
function getDashboardData(options) {
  requireAuth_();
  const actor = getActor_();
  // Fallback automático: quando o frontend detecta uma falha ou resposta
  // inválida, repete a chamada com { forceRefresh: true } — o cache é
  // descartado e os dados vêm DIRETO do Google Sheets (fonte oficial).
  const force = !!(options && options.forceRefresh);
  if (force) invalidateAllCache();
  // Leitura TOLERANTE (só aqui): o Dashboard é a porta de entrada e não
  // pode ficar vazio por uma falha transitória em uma das abas. O que for
  // lido é exibido e o campo "parcial" avisa o usuário. Relatórios e
  // Indicadores permanecem em modo ESTRITO — números de relatório não
  // podem ser parciais sem que isso seja evidente.
  SERVICE_CONTEXT_.avisosLeitura = [];
  const raw = restrictToOwnerIfNeeded_(getActiveAtendimentos_(force, true), actor);
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

  // Indicadores por canal (v4.2: lista dinâmica da aba Canais).
  // Canais presentes nos registros mas já excluídos/desativados também
  // ganham um cartão, para nenhum atendimento sumir dos indicadores.
  const canaisAtivos = getCanaisAtivos_();
  const porCanal = {};
  canaisAtivos.forEach(function(canal) {
    porCanal[canal] = { total: 0, pendentes: 0, emAnalise: 0, concluidos: 0 };
  });
  const canalIndexNormalizado = {};
  canaisAtivos.forEach(function(canal) {
    canalIndexNormalizado[normalizeText_(canal)] = canal;
  });

  records.forEach(function(record) {
    let nomeCanal = canalIndexNormalizado[normalizeText_(record.canal)];
    if (!nomeCanal && record.canal) {
      // Canal legado/excluído: cria o cartão sob demanda.
      nomeCanal = String(record.canal);
      canalIndexNormalizado[normalizeText_(nomeCanal)] = nomeCanal;
      porCanal[nomeCanal] = { total: 0, pendentes: 0, emAnalise: 0, concluidos: 0 };
    }
    const bucket = nomeCanal ? porCanal[nomeCanal] : null;
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

  // Avisos de leitura parcial (abas que falharam nesta requisição).
  const avisos = SERVICE_CONTEXT_.avisosLeitura || [];

  return {
    cards: cards,
    porSituacao: porSituacao,
    porCanal: porCanal,
    atendimentos: records,
    user: actor,
    // true = a visão está INCOMPLETA (alguma aba não pôde ser lida).
    // O frontend avisa o usuário em vez de apresentar números parciais
    // como se fossem completos.
    parcial: avisos.length > 0,
    abasIndisponiveis: avisos
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
function getRelatorio(filtros, options) {
  requireAuth_();

  // BANCO PGO 5.0: a tela tem escopo PRÓPRIO (relatoriosProprios /
  // relatoriosEquipe / relatoriosTodos), diferente do escopo de leitura das
  // telas operacionais. Quem responde é o motor analítico.
  if (estruturaEhPGO5_() && typeof getRelatorioPGO5 === 'function') {
    return getRelatorioPGO5(filtros);
  }

  const actor = getActor_();
  // Mesmo fallback do Dashboard: { forceRefresh: true } ignora o cache e
  // consulta o Google Sheets diretamente (Indicadores/Relatórios).
  const force = !!(options && options.forceRefresh);
  if (force) invalidateAllCache();
  return decorateAtendimentos_(
    applyAtendimentoFilters_(restrictToOwnerIfNeeded_(getActiveAtendimentos_(force), actor), filtros || {})
  );
}

// ============================================================================
// NOMES VISÍVEIS DAS TELAS (personalização do ADM)
// ============================================================================
/*
 * Permite ao ADM trocar o RÓTULO das telas (ex.: "Dashboard" →
 * "Resultado do Analista"). É estritamente cosmético:
 *   - a página continua sendo identificada por data-page="dashboard";
 *   - nenhuma rota, função, coluna, aba ou constante muda;
 *   - nada é gravado no Google Sheets — só em Script Properties.
 *
 * A tela de Análise de SAC não é duplicada aqui: seu nome continua saindo
 * do campo abaNome da própria configuração do módulo, para não haver dois
 * lugares gravando o mesmo rótulo.
 */

/**
 * Diz se a Análise de SAC deve ignorar os registros sem status mapeado.
 *
 * Decisão do PO válida para o PGO 5.0: esses registros não trazem análise
 * útil e poluíam a tela com uma categoria que ninguém acompanha. No banco
 * 4.x o comportamento fica como sempre foi — lá o "Não Classificado" serve
 * de alerta para o administrador terminar o mapeamento dos status.
 *
 * @returns {boolean} true quando os registros devem ser descartados.
 */
function descartarNaoClassificadoNaAnalise_() {
  return estruturaEhPGO5_();
}

/**
 * Nomes visíveis resolvidos de todas as telas renomeáveis.
 * Campo vazio ou ausente cai automaticamente no padrão.
 * @returns {Object} { <pagina>: <nome visível> }.
 */
function lerNomesTelas_() {
  let salvo = {};
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEYS.NOMES_TELAS);
    if (raw) salvo = JSON.parse(raw) || {};
  } catch (e) {
    Logger.log('[Telas] Nomes inválidos em Script Properties: ' + e.message);
  }

  const nomes = {};
  TELAS_RENOMEAVEIS.forEach(function(tela) {
    if (tela.fonte === 'indicOp') {
      // Fonte única: a configuração do próprio módulo.
      nomes[tela.pagina] = lerIndicOpConfig_().abaNome || tela.padrao;
      return;
    }
    const personalizado = String(salvo[tela.pagina] || '').trim();
    nomes[tela.pagina] = personalizado || tela.padrao;
  });
  return nomes;
}

/**
 * (ADM) Nomes atuais + padrões, para a tela de Configurações montar o
 * formulário e mostrar qual é o padrão de cada campo.
 * @returns {Object[]} [{ pagina, nome, padrao, personalizado }].
 */
function getNomesTelas() {
  requireAuth_();
  exigirAcesso_('configurarSistema', requireAdmin_);
  const nomes = lerNomesTelas_();
  return TELAS_RENOMEAVEIS.map(function(tela) {
    return {
      pagina: tela.pagina,
      padrao: tela.padrao,
      nome: nomes[tela.pagina],
      personalizado: nomes[tela.pagina] !== tela.padrao
    };
  });
}

/**
 * (ADM) Salva os nomes visíveis. Só grava as páginas conhecidas — um nome
 * enviado para uma página inexistente é ignorado, e campo vazio significa
 * "voltar ao padrão" (a chave simplesmente não é gravada).
 * @param {Object} dados - { <pagina>: <nome> }.
 * @returns {Object} { success, nomes }.
 */
function salvarNomesTelas(dados) {
  requireAuth_();
  exigirAcesso_('configurarSistema', requireAdmin_);
  const entrada = dados || {};
  const paraGravar = {};

  TELAS_RENOMEAVEIS.forEach(function(tela) {
    const valor = sanitizeInput(entrada[tela.pagina]);
    if (tela.fonte === 'indicOp') {
      // Espelha no campo que já existe, mantendo uma fonte única.
      const cfg = lerIndicOpConfig_();
      const novo = valor || tela.padrao;
      if (novo !== cfg.abaNome) {
        cfg.abaNome = novo;
        delete cfg.habilitado;               // campo derivado, não persistido
        PropertiesService.getScriptProperties().setProperty(
          PROPERTY_KEYS.INDIC_OP_CONFIG, JSON.stringify(cfg));
      }
      return;
    }
    // Vazio ou igual ao padrão → não grava (volta ao padrão sozinho).
    if (valor && valor !== tela.padrao) paraGravar[tela.pagina] = valor;
  });

  const props = PropertiesService.getScriptProperties();
  if (Object.keys(paraGravar).length === 0) {
    props.deleteProperty(PROPERTY_KEYS.NOMES_TELAS);
  } else {
    props.setProperty(PROPERTY_KEYS.NOMES_TELAS, JSON.stringify(paraGravar));
  }
  return { success: true, nomes: lerNomesTelas_() };
}

// ============================================================================
// MÓDULO INDICADORES OPERACIONAIS (v4.7)
// ============================================================================
/*
 * Acompanha indicadores operacionais a partir de uma planilha Google Sheets
 * EXTERNA, configurada pelo Administrador (fora do banco do PRISMA).
 *
 * Resiliência (não depender de posições fixas):
 *  - as colunas de Data e Status são localizadas pelo NOME do cabeçalho, na
 *    "linha inicial" configurada — se a planilha de origem mudar a ordem das
 *    colunas ou ganhar colunas novas, a leitura continua funcionando;
 *  - datas com horário são reduzidas à data ("02/08/2026 14:35" → 02/08/2026);
 *  - linhas totalmente vazias são ignoradas;
 *  - células mescladas: o valor só existe na primeira célula do bloco, então
 *    a Data é "arrastada" para baixo (forward-fill) enquanto não muda;
 *  - espaços extras são removidos.
 *
 * Consolidação por data: Casos (total), Em Aberto, Em Análise e
 * Fechado+Rejeitado (classificados por palavra-chave), mais "Fora da SLA",
 * um valor MANUAL informado pelo usuário (aba IndicadoresSLA) e preservado
 * entre releituras da planilha externa.
 *
 * Performance: o resultado consolidado é cacheado (CacheService, TTL padrão);
 * o botão "Atualizar Dados" força a releitura.
 */

// Chave de cache do resultado consolidado da planilha externa.
const INDIC_OP_CACHE_KEY_ = 'PRISMA_RA_INDIC_OP_CACHE';

/** Configuração padrão do módulo (antes de o ADM configurar a fonte). */
function indicOpConfigPadrao_() {
  return {
    abaNome: 'Análise de SAC',
    planilhaUrl: '',
    abaOrigem: '',
    linhaInicial: 1,
    colunaData: 'Data',
    colunaStatus: 'Status',
    // Colunas analíticas (opcionais). Vazio = dimensão simplesmente não
    // aparece no painel; o módulo continua funcionando só com Data+Status.
    colunaAssunto: '',
    colunaSubassunto: '',
    colunaAnalista: '',
    // Outras colunas categóricas que o ADM libera para o seletor
    // "Analisar por" — evita ter um gráfico codificado para cada coluna.
    colunasExtras: [],
    // Valores BRUTOS da planilha que representam cada grupo. Enquanto os
    // três estiverem vazios, vale a heurística por palavra-chave (mantém o
    // comportamento de quem já usa o módulo hoje).
    statusEmAberto: [],
    statusEmAnalise: [],
    statusFechado: []
  };
}

/** Normaliza uma lista vinda da configuração (array ou texto separado por ";"). */
function listaConfigOp_(valor) {
  let bruta = [];
  if (Array.isArray(valor)) {
    bruta = valor;
  } else if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
    bruta = String(valor).split(';');
  }
  const vistos = {};
  const saida = [];
  bruta.forEach(function(item) {
    const txt = String(item === undefined || item === null ? '' : item).trim();
    if (!txt) return;
    const chave = normalizeText_(txt);
    if (vistos[chave]) return;
    vistos[chave] = true;
    saida.push(txt);
  });
  return saida;
}

/**
 * Lê a configuração do módulo (Script Properties) e devolve sempre um objeto
 * completo (mesclado com os padrões). "habilitado" indica se há URL e aba de
 * origem definidas — condição mínima para o módulo operar.
 * @returns {Object} configuração + { habilitado }.
 */
function lerIndicOpConfig_() {
  const padrao = indicOpConfigPadrao_();
  let salvo = {};
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEYS.INDIC_OP_CONFIG);
    if (raw) salvo = JSON.parse(raw) || {};
  } catch (e) {
    Logger.log('[IndicOp] Config inválida em Script Properties: ' + e.message);
  }
  const cfg = {
    abaNome: String(salvo.abaNome || '').trim() || padrao.abaNome,
    planilhaUrl: String(salvo.planilhaUrl || '').trim(),
    abaOrigem: String(salvo.abaOrigem || '').trim(),
    linhaInicial: Math.max(1, parseInt(salvo.linhaInicial, 10) || padrao.linhaInicial),
    colunaData: String(salvo.colunaData || '').trim() || padrao.colunaData,
    colunaStatus: String(salvo.colunaStatus || '').trim() || padrao.colunaStatus,
    // Campos novos: ausentes nas configurações já gravadas → viram vazio,
    // e o painel simplesmente não mostra a dimensão correspondente.
    colunaAssunto: String(salvo.colunaAssunto || '').trim(),
    colunaSubassunto: String(salvo.colunaSubassunto || '').trim(),
    colunaAnalista: String(salvo.colunaAnalista || '').trim(),
    colunasExtras: listaConfigOp_(salvo.colunasExtras),
    statusEmAberto: listaConfigOp_(salvo.statusEmAberto),
    statusEmAnalise: listaConfigOp_(salvo.statusEmAnalise),
    statusFechado: listaConfigOp_(salvo.statusFechado)
  };
  cfg.habilitado = !!(cfg.planilhaUrl && cfg.abaOrigem);
  return cfg;
}

/** (ADM) Retorna a configuração do módulo para a tela de Configurações. */
function getIndicadoresOperacionaisConfig() {
  requireAuth_();
  exigirAcesso_('configurarAnaliseSac', requireAdmin_);
  const configuracao = lerIndicOpConfig_();

  // No PGO 5.0 o link da planilha externa é RECURSO PROTEGIDO: ele só sai do
  // servidor por obterLinkProtegidoPGO5(), que exige permissão E PIN. Aqui
  // ele é removido da resposta e substituído por um simples "está
  // configurado?" — assim a tela de configuração continua funcionando sem
  // que a URL trafegue para o navegador.
  //
  // No banco 4.x nada muda: lá não existe PIN e a tela sempre mostrou o link.
  if (estruturaEhPGO5_()) {
    const semUrl = {};
    Object.keys(configuracao).forEach(function(chave) {
      if (chave !== 'planilhaUrl') semUrl[chave] = configuracao[chave];
    });
    semUrl.planilhaConfigurada = String(configuracao.planilhaUrl || '').trim() !== '';
    return semUrl;
  }
  return configuracao;
}

/**
 * (ADM) Salva a configuração da fonte de dados e limpa o cache do resultado
 * consolidado (a próxima leitura já usa a nova fonte).
 * @param {Object} dados - Campos do formulário de configuração.
 * @returns {Object} { success, config }.
 */
function salvarIndicadoresOperacionaisConfig(dados) {
  requireAuth_();
  exigirAcesso_('configurarAnaliseSac', requireAdmin_);
  const entrada = dados || {};

  // Como no PGO 5.0 a tela não recebe mais a URL, ela também não a devolve
  // ao salvar. Campo vazio significa "mantenha o link que já está lá" — sem
  // isto, qualquer edição de outro campo apagaria a fonte da Análise de SAC.
  if (estruturaEhPGO5_() && String(entrada.planilhaUrl || '').trim() === '') {
    entrada.planilhaUrl = lerIndicOpConfig_().planilhaUrl;
  }
  const limparLista = function(v) {
    return listaConfigOp_(v).map(function(item) { return sanitizeInput(item); })
      .filter(function(item) { return item !== ''; });
  };
  const cfg = {
    abaNome: sanitizeInput(entrada.abaNome) || indicOpConfigPadrao_().abaNome,
    planilhaUrl: sanitizeInput(entrada.planilhaUrl),
    abaOrigem: sanitizeInput(entrada.abaOrigem),
    linhaInicial: Math.max(1, parseInt(entrada.linhaInicial, 10) || 1),
    colunaData: sanitizeInput(entrada.colunaData) || 'Data',
    colunaStatus: sanitizeInput(entrada.colunaStatus) || 'Status',
    colunaAssunto: sanitizeInput(entrada.colunaAssunto),
    colunaSubassunto: sanitizeInput(entrada.colunaSubassunto),
    colunaAnalista: sanitizeInput(entrada.colunaAnalista),
    colunasExtras: limparLista(entrada.colunasExtras),
    statusEmAberto: limparLista(entrada.statusEmAberto),
    statusEmAnalise: limparLista(entrada.statusEmAnalise),
    statusFechado: limparLista(entrada.statusFechado)
  };
  if (cfg.planilhaUrl && !/docs\.google\.com\/spreadsheets/i.test(cfg.planilhaUrl)) {
    throw new Error('A URL informada não parece ser de uma planilha Google Sheets.');
  }
  // Um mesmo status em dois grupos tornaria a contagem ambígua.
  const grupos = [
    ['Em Aberto', cfg.statusEmAberto], ['Em Análise', cfg.statusEmAnalise], ['Fechado', cfg.statusFechado]
  ];
  const donoDoStatus = {};
  for (let g = 0; g < grupos.length; g++) {
    const nomeGrupo = grupos[g][0];
    for (let i = 0; i < grupos[g][1].length; i++) {
      const chave = normalizeText_(grupos[g][1][i]);
      if (donoDoStatus[chave] && donoDoStatus[chave] !== nomeGrupo) {
        throw new Error('O status "' + grupos[g][1][i] + '" está em dois grupos ao mesmo tempo (' +
          donoDoStatus[chave] + ' e ' + nomeGrupo + '). Deixe-o em apenas um.');
      }
      donoDoStatus[chave] = nomeGrupo;
    }
  }
  PropertiesService.getScriptProperties().setProperty(
    PROPERTY_KEYS.INDIC_OP_CONFIG, JSON.stringify(cfg));
  limparCacheIndicOp_();
  cfg.habilitado = !!(cfg.planilhaUrl && cfg.abaOrigem);
  return { success: true, config: cfg };
}

/**
 * Remove todos os resultados consolidados em cache do módulo.
 * O cache é fatiado por período (uma chave por faixa de datas consultada),
 * por isso a limpeza percorre o índice de chaves em uso.
 */
function limparCacheIndicOp_() {
  try {
    const cache = CacheService.getScriptCache();
    const indice = cache.get(INDIC_OP_CACHE_KEY_ + '_INDICE');
    const chaves = [INDIC_OP_CACHE_KEY_, INDIC_OP_CACHE_KEY_ + '_INDICE'];
    if (indice) {
      try { JSON.parse(indice).forEach(function(k) { chaves.push(k); }); } catch (e) { /* índice ruim */ }
    }
    cache.removeAll(chaves);
  } catch (e) {
    Logger.log('[IndicOp] Falha ao limpar cache: ' + e.message);
  }
}

/**
 * (ADM) Lê a planilha externa apenas para DESCOBRIR seu formato: quais
 * colunas existem no cabeçalho e quais valores distintos aparecem na coluna
 * de status. Serve para o ADM mapear as colunas e agrupar os status
 * escolhendo em listas, em vez de digitar nomes exatos.
 *
 * Aceita os parâmetros do formulário ainda NÃO salvos, para o ADM conseguir
 * testar a fonte antes de gravar a configuração.
 * @param {Object} dados - { planilhaUrl, abaOrigem, linhaInicial, colunaStatus }.
 * @returns {Object} { cabecalhos:[], statusEncontrados:[], totalLinhas }.
 */
function getIndicadoresOperacionaisFonte(dados) {
  requireAuth_();
  exigirAcesso_('visualizarFonteSac', requireAdmin_);
  const entrada = dados || {};
  const salvo = lerIndicOpConfig_();
  const url = sanitizeInput(entrada.planilhaUrl) || salvo.planilhaUrl;
  const abaOrigem = sanitizeInput(entrada.abaOrigem) || salvo.abaOrigem;
  const linhaInicial = Math.max(1, parseInt(entrada.linhaInicial, 10) || salvo.linhaInicial);
  const colunaStatus = sanitizeInput(entrada.colunaStatus) || salvo.colunaStatus;

  if (!url || !abaOrigem) {
    throw new Error('INDICOP: informe o link da planilha e o nome da aba antes de ler os cabeçalhos.');
  }

  const leitura = lerAbaExterna_(url, abaOrigem);
  const valores = leitura.valores;
  if (valores.length === 0) {
    return { cabecalhos: [], statusEncontrados: [], totalLinhas: 0 };
  }

  const linhaCab = Math.min(linhaInicial, valores.length) - 1;
  const cabecalhos = (valores[linhaCab] || []).map(function(v) {
    return String(v === undefined || v === null ? '' : v).trim();
  }).filter(function(v) { return v !== ''; });

  // Valores distintos da coluna de status (o que o ADM precisa agrupar).
  const idxStatus = indiceColunaOp_(valores[linhaCab] || [], colunaStatus);
  const vistos = {};
  const statusEncontrados = [];
  let totalLinhas = 0;
  if (idxStatus !== -1) {
    for (let i = linhaCab + 1; i < valores.length; i++) {
      const linha = valores[i];
      if (linhaVaziaOp_(linha)) continue;
      totalLinhas++;
      const txt = String(linha[idxStatus] === undefined || linha[idxStatus] === null ? '' : linha[idxStatus]).trim();
      if (!txt) continue;
      const chave = normalizeText_(txt);
      if (vistos[chave]) continue;
      vistos[chave] = true;
      statusEncontrados.push(txt);
      // Trava de segurança: uma coluna que não é de status teria centenas
      // de valores distintos e não faz sentido listar.
      if (statusEncontrados.length >= 100) break;
    }
  }
  statusEncontrados.sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });
  return { cabecalhos: cabecalhos, statusEncontrados: statusEncontrados, totalLinhas: totalLinhas };
}

/**
 * Normaliza uma data (Date ou texto, possivelmente com horário) numa CHAVE
 * ordenável AAAA-MM-DD e num RÓTULO DD/MM/AAAA. Considera apenas a parte da
 * data ("02/08/2026 14:35" → 2026-08-02).
 * @param {*} valor - Célula de data da planilha externa.
 * @returns {Object|null} { chave, label } ou null se não for data válida.
 */
function normalizarDataOp_(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  let d = null;
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    d = valor;
  } else {
    // Texto: descarta o horário (após o 1º espaço ou "T") e interpreta
    // dd/mm/aaaa ou aaaa-mm-dd.
    const txt = String(valor).trim().split(' ')[0].split('T')[0];
    let m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let ano = parseInt(m[3], 10);
      if (ano < 100) ano += 2000;
      d = new Date(ano, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    } else {
      m = txt.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
  }
  if (!d || isNaN(d.getTime())) return null;
  const ano = d.getFullYear();
  const mes = ('0' + (d.getMonth() + 1)).slice(-2);
  const dia = ('0' + d.getDate()).slice(-2);
  return { chave: ano + '-' + mes + '-' + dia, label: dia + '/' + mes + '/' + ano };
}

/** true quando a linha da planilha externa não tem nenhum valor. */
function linhaVaziaOp_(linha) {
  return !linha || linha.every(function(c) {
    return c === '' || c === null || c === undefined;
  });
}

/**
 * Localiza uma coluna pelo NOME do cabeçalho, ignorando acento, caixa e
 * espaços extras. É o que permite a planilha de origem mudar a ordem das
 * colunas sem quebrar a leitura.
 * @param {Array} linhaCabecalho - Linha de cabeçalho crua.
 * @param {string} nome - Nome procurado (vazio = coluna não configurada).
 * @returns {number} Índice 0-based, ou -1.
 */
function indiceColunaOp_(linhaCabecalho, nome) {
  const alvo = normalizeText_(nome);
  if (!alvo) return -1;
  const cabecalhos = (linhaCabecalho || []).map(function(v) { return normalizeText_(v); });
  return cabecalhos.indexOf(alvo);
}

/**
 * Abre a planilha externa e devolve a aba inteira numa ÚNICA chamada
 * getValues(). Concentrar a leitura aqui garante que o resto do módulo
 * trabalhe sobre a matriz já em memória, sem novas idas ao Sheets.
 * @param {string} url - Link da planilha externa.
 * @param {string} abaOrigem - Nome da aba.
 * @returns {Object} { valores: Array[][] }.
 * @throws {Error} 'INDICOP: ...' quando não dá para ler.
 */
function lerAbaExterna_(url, abaOrigem) {
  let planilha;
  try {
    planilha = SpreadsheetApp.openByUrl(url);
  } catch (e) {
    throw new Error('INDICOP: não foi possível abrir a planilha configurada. ' +
      'Verifique o link e se você tem acesso a ela. (' + e.message + ')');
  }
  const aba = planilha.getSheetByName(abaOrigem);
  if (!aba) {
    throw new Error('INDICOP: a aba "' + abaOrigem + '" não existe na planilha de origem.');
  }
  if (aba.getLastRow() === 0 || aba.getLastColumn() === 0) return { valores: [] };
  return { valores: aba.getDataRange().getValues() };
}

/**
 * Classifica um status BRUTO num dos grupos do painel.
 *
 * REGRA: um status que o sistema não reconhece NUNCA vira "Em Aberto" por
 * omissão — ele cai em 'naoClassificado', para o ADM/Supervisor perceberem
 * que existe valor na origem ainda não mapeado.
 *
 * Duas fontes de verdade, nesta ordem:
 *   1. o AGRUPAMENTO CONFIGURADO pelo ADM (lista de valores por grupo);
 *   2. se nenhum grupo foi configurado ainda, uma heurística por
 *      palavra-chave — é o comportamento histórico do módulo, mantido para
 *      quem já usa o painel não ver os números zerarem depois da atualização.
 * @param {string} statusBruto - Texto do status na origem.
 * @param {Object} mapa - Índice normalizado {statusNormalizado: grupo}.
 * @returns {string} 'emAberto' | 'emAnalise' | 'fechado' | 'naoClassificado'.
 */
function classificarStatusOp_(statusBruto, mapa) {
  const s = normalizeText_(statusBruto);
  if (!s) return 'naoClassificado';

  if (mapa && mapa.__configurado) {
    return mapa[s] || 'naoClassificado';
  }

  // Heurística legada (só vale enquanto o ADM não agrupa os status).
  if (s.indexOf('analise') !== -1 || s.indexOf('andamento') !== -1) return 'emAnalise';
  if (s.indexOf('fechad') !== -1 || s.indexOf('rejeitad') !== -1 ||
      s.indexOf('conclu') !== -1 || s.indexOf('encerrad') !== -1 ||
      s.indexOf('resolvid') !== -1 || s.indexOf('finaliz') !== -1) return 'fechado';
  if (s.indexOf('abert') !== -1 || s.indexOf('novo') !== -1 ||
      s.indexOf('pendente') !== -1 || s.indexOf('aguardando') !== -1) return 'emAberto';
  return 'naoClassificado';
}

/**
 * Monta o índice {statusNormalizado: grupo} a partir da configuração.
 * A marca __configurado distingue "ADM ainda não agrupou nada" de
 * "ADM agrupou, e o que ficou de fora é não classificado".
 * @param {Object} cfg - Configuração resolvida.
 * @returns {Object} Índice de classificação.
 */
function mapaStatusOp_(cfg) {
  const mapa = {};
  const grupos = [
    ['emAberto', cfg.statusEmAberto], ['emAnalise', cfg.statusEmAnalise], ['fechado', cfg.statusFechado]
  ];
  let total = 0;
  grupos.forEach(function(par) {
    (par[1] || []).forEach(function(valor) {
      const chave = normalizeText_(valor);
      if (!chave) return;
      mapa[chave] = par[0];
      total++;
    });
  });
  mapa.__configurado = total > 0;
  return mapa;
}

/** Estrutura vazia dos indicadores automáticos (sem nenhuma data). */
function emptyIndicadoresOp_() {
  return { casos: {}, emAberto: {}, emAnalise: {}, fechado: {}, naoClassificado: {} };
}

/**
 * Lê e consolida a planilha externa configurada. Localiza as colunas de Data
 * e Status pelo NOME do cabeçalho (na linha inicial), limpa os dados e agrega
 * por data. Resultado cacheado; forceRefresh ignora o cache.
 * @param {Object} cfg - Configuração resolvida (lerIndicOpConfig_).
 * @param {boolean} forceRefresh - true relê a planilha externa.
 * @returns {Object} { datas:[{chave,label}], indicadores, atualizadoEm }.
 * @throws {Error} 'INDICOP: ...' quando a planilha não pôde ser lida.
 */
function consolidarIndicadoresOp_(cfg, forceRefresh, periodo) {
  const cache = CacheService.getScriptCache();
  periodo = periodo || {};
  // O cache é por CONFIGURAÇÃO + PERÍODO: mudar o mapeamento ou a faixa de
  // datas nunca pode servir um resultado consolidado com outros critérios.
  const assinatura = [
    cfg.planilhaUrl, cfg.abaOrigem, cfg.linhaInicial, cfg.colunaData, cfg.colunaStatus,
    cfg.colunaAssunto, cfg.colunaSubassunto, cfg.colunaAnalista,
    (cfg.colunasExtras || []).join('|'),
    (cfg.statusEmAberto || []).join('|'), (cfg.statusEmAnalise || []).join('|'),
    (cfg.statusFechado || []).join('|'),
    periodo.inicio || '', periodo.fim || ''
  ].join('§');
  const cacheKey = INDIC_OP_CACHE_KEY_ + '_' + hashCurto_(assinatura);

  if (!forceRefresh) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) { /* cache ruim nunca impede a leitura */ }
  }

  // ── UMA leitura em lote da planilha externa ──
  const valores = lerAbaExterna_(cfg.planilhaUrl, cfg.abaOrigem).valores;
  if (valores.length === 0) return resultadoVazioOp_(cfg);

  const linhaCabecalho = Math.min(cfg.linhaInicial, valores.length) - 1; // 0-indexed
  const cabecalhoBruto = valores[linhaCabecalho] || [];
  const idxData = indiceColunaOp_(cabecalhoBruto, cfg.colunaData);
  const idxStatus = indiceColunaOp_(cabecalhoBruto, cfg.colunaStatus);
  if (idxData === -1 || idxStatus === -1) {
    throw new Error('INDICOP: não encontrei as colunas "' + cfg.colunaData + '" e/ou "' +
      cfg.colunaStatus + '" na linha ' + cfg.linhaInicial + ' da planilha de origem.');
  }

  // ── Dimensões categóricas disponíveis para análise ──
  // Cada uma vira um gráfico sob demanda no seletor "Analisar por", sem
  // precisar de código específico por coluna.
  const dimensoes = [];
  // Colunas que o ADM mapeou mas que NÃO existem mais no cabeçalho da
  // origem. A leitura continua (Data e Status bastam para o painel), mas o
  // nome é reportado para a tela avisar — antes a dimensão sumia calada.
  const colunasAusentes = [];
  const registrarDimensao = function(rotulo, nomeColuna, fixa) {
    if (!nomeColuna) return;
    const idx = indiceColunaOp_(cabecalhoBruto, nomeColuna);
    if (idx === -1) {
      if (colunasAusentes.indexOf(nomeColuna) === -1) colunasAusentes.push(nomeColuna);
      return;
    }
    if (dimensoes.some(function(d) { return d.idx === idx; })) return;
    dimensoes.push({ chave: nomeColuna, rotulo: rotulo, idx: idx, fixa: !!fixa, contagem: {} });
  };
  registrarDimensao('Assunto', cfg.colunaAssunto, true);
  registrarDimensao('Subassunto', cfg.colunaSubassunto, true);
  registrarDimensao('Quem analisou', cfg.colunaAnalista, true);
  registrarDimensao('Status', cfg.colunaStatus, true);
  (cfg.colunasExtras || []).forEach(function(nome) { registrarDimensao(nome, nome, false); });

  const mapa = mapaStatusOp_(cfg);
  const inicio = String(periodo.inicio || '');
  const fim = String(periodo.fim || '');

  const porData = {};
  const labelPorChave = {};
  const distribuicaoStatus = {};
  const naoMapeados = {};
  let totalCasos = 0;
  let ultimaData = null;    // forward-fill de células mescladas na coluna Data

  for (let i = linhaCabecalho + 1; i < valores.length; i++) {
    const linha = valores[i];
    if (linhaVaziaOp_(linha)) continue;

    const dataNorm = normalizarDataOp_(linha[idxData]);
    if (dataNorm) ultimaData = dataNorm;     // atualiza a data corrente
    const data = ultimaData;                 // usa a última válida (célula mesclada)
    const statusTxt = String(linha[idxStatus] === undefined || linha[idxStatus] === null ? '' : linha[idxStatus]).trim();
    if (!data || !statusTxt) continue;       // linha sem conteúdo útil

    // Filtro de período (chave AAAA-MM-DD é comparável como texto).
    if (inicio && data.chave < inicio) continue;
    if (fim && data.chave > fim) continue;

    if (!porData[data.chave]) {
      porData[data.chave] = { casos: 0, emAberto: 0, emAnalise: 0, fechado: 0, naoClassificado: 0 };
      labelPorChave[data.chave] = data.label;
    }
    const grupo = classificarStatusOp_(statusTxt, mapa);

    // PGO 5.0: o PO decidiu que registro sem status mapeado não tem análise
    // útil e sai da tela. O descarte acontece AQUI, antes de qualquer
    // agregação — assim ele some de uma vez dos KPIs, dos gráficos, do
    // Top 5, das dimensões e da exportação, sem precisar de um ajuste em
    // cada lugar.
    //
    // ⚠️ Isto NÃO altera a planilha de origem: ela continua somente
    // leitura e mantém todas as linhas. O que muda é só o que entra na
    // análise.
    //
    // No banco 4.x nada muda: lá o "Não Classificado" continua sendo
    // exibido como aviso para o ADM completar o mapeamento.
    if (grupo === 'naoClassificado' && descartarNaoClassificadoNaAnalise_()) continue;

    porData[data.chave].casos++;
    porData[data.chave][grupo]++;
    totalCasos++;

    distribuicaoStatus[statusTxt] = (distribuicaoStatus[statusTxt] || 0) + 1;
    if (grupo === 'naoClassificado') {
      naoMapeados[statusTxt] = (naoMapeados[statusTxt] || 0) + 1;
    }

    // Uma passada só alimenta TODAS as dimensões.
    for (let d = 0; d < dimensoes.length; d++) {
      const dim = dimensoes[d];
      let v = linha[dim.idx];
      v = String(v === undefined || v === null ? '' : v).trim();
      if (!v) v = '(não informado)';
      dim.contagem[v] = (dim.contagem[v] || 0) + 1;
    }
  }

  // ── Séries ordenadas cronologicamente (chave AAAA-MM-DD é ordenável) ──
  const chaves = Object.keys(porData).sort();
  const datas = chaves.map(function(chave) {
    return { chave: chave, label: labelPorChave[chave] };
  });
  const indicadores = emptyIndicadoresOp_();
  const totais = { casos: 0, emAberto: 0, emAnalise: 0, fechado: 0, naoClassificado: 0 };
  chaves.forEach(function(chave) {
    ['casos', 'emAberto', 'emAnalise', 'fechado', 'naoClassificado'].forEach(function(campo) {
      indicadores[campo][chave] = porData[chave][campo];
      totais[campo] += porData[chave][campo];
    });
  });

  const categorias = {};
  dimensoes.forEach(function(dim) {
    categorias[dim.chave] = rankearOp_(dim.contagem, totalCasos);
  });

  const resultado = {
    datas: datas,
    indicadores: indicadores,
    totais: totais,
    totalCasos: totalCasos,
    volumePorDia: chaves.map(function(chave) {
      return { rotulo: labelPorChave[chave], valor: porData[chave].casos };
    }),
    distribuicaoStatus: rankearOp_(distribuicaoStatus, totalCasos),
    statusNaoMapeados: rankearOp_(naoMapeados, totalCasos).slice(0, 20),
    categorias: categorias,
    colunasAnalise: dimensoes.map(function(d) { return { chave: d.chave, rotulo: d.rotulo }; }),
    colunasAusentes: colunasAusentes,
    periodo: { inicio: inicio, fim: fim },
    atualizadoEm: toIso_(new Date())
  };

  guardarCacheIndicOp_(cacheKey, resultado);
  return resultado;
}

/** Resultado consolidado vazio (aba de origem sem nenhuma linha). */
function resultadoVazioOp_(cfg) {
  return {
    datas: [], indicadores: emptyIndicadoresOp_(),
    totais: { casos: 0, emAberto: 0, emAnalise: 0, fechado: 0, naoClassificado: 0 },
    totalCasos: 0, volumePorDia: [], distribuicaoStatus: [], statusNaoMapeados: [],
    categorias: {}, colunasAnalise: [], colunasAusentes: [], periodo: { inicio: '', fim: '' },
    atualizadoEm: toIso_(new Date())
  };
}

/**
 * Converte {valor: quantidade} numa lista ordenada por quantidade, já com o
 * percentual sobre o total filtrado — é o formato que o Top 5 e os gráficos
 * consomem direto, sem recálculo no frontend.
 *
 * Limita a 100 fatias e agrupa a cauda em "(outros)": uma coluna categórica
 * com milhares de valores distintos não pode inflar o payload.
 * @param {Object} contagem - Mapa valor → quantidade.
 * @param {number} base - Total de casos do período (base do percentual).
 * @returns {Object[]} [{ rotulo, valor, pct }] em ordem decrescente.
 */
function rankearOp_(contagem, base) {
  const itens = Object.keys(contagem).map(function(rotulo) {
    return { rotulo: rotulo, valor: contagem[rotulo] };
  }).sort(function(a, b) {
    return b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR');
  });

  const LIMITE = 100;
  let lista = itens;
  if (itens.length > LIMITE) {
    const cabeca = itens.slice(0, LIMITE);
    const resto = itens.slice(LIMITE).reduce(function(soma, i) { return soma + i.valor; }, 0);
    cabeca.push({ rotulo: '(outros)', valor: resto });
    lista = cabeca;
  }

  const divisor = Number(base) > 0 ? Number(base) : 0;
  return lista.map(function(i) {
    return {
      rotulo: i.rotulo,
      valor: i.valor,
      pct: divisor ? Math.round((i.valor / divisor) * 1000) / 10 : 0
    };
  });
}

/** Hash curto e estável, só para compor chave de cache (não é segurança). */
function hashCurto_(texto) {
  let h = 5381;
  const s = String(texto);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h.toString(36);
}

/**
 * Grava o consolidado no cache e mantém um ÍNDICE das chaves em uso, para
 * que salvar a configuração consiga limpar todas as variações de período.
 */
function guardarCacheIndicOp_(cacheKey, resultado) {
  try {
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(resultado);
    if (json.length > 100000) {
      Logger.log('[IndicOp] Consolidado grande demais para cache: ' + json.length + ' bytes');
      return;
    }
    cache.put(cacheKey, json, CONFIG.CACHE_TTL);

    const indiceKey = INDIC_OP_CACHE_KEY_ + '_INDICE';
    let chaves = [];
    try {
      const bruto = cache.get(indiceKey);
      if (bruto) chaves = JSON.parse(bruto) || [];
    } catch (e) { chaves = []; }
    if (chaves.indexOf(cacheKey) === -1) {
      chaves.push(cacheKey);
      if (chaves.length > 40) chaves = chaves.slice(-40);
      cache.put(indiceKey, JSON.stringify(chaves), CONFIG.CACHE_TTL);
    }
  } catch (e) {
    Logger.log('[IndicOp] Falha ao cachear: ' + e.message);
  }
}

/**
 * (Supervisor/ADM) Indicadores operacionais prontos para a tela: datas, os 4
 * indicadores automáticos (planilha externa, consolidados) e a linha manual
 * "Fora da SLA" (aba IndicadoresSLA). Sem configuração → { habilitado:false }.
 * @param {Object} options - { forceRefresh } para o botão "Atualizar Dados".
 * @returns {Object} dados do painel.
 */
function getIndicadoresOperacionais(options) {
  requireAuth_();
  exigirAcesso_('analiseSac', requireSupervisor_);
  const cfg = lerIndicOpConfig_();
  if (!cfg.habilitado) {
    return { habilitado: false, abaNome: cfg.abaNome };
  }
  const opts = options || {};
  const force = !!opts.forceRefresh;
  const periodo = {
    inicio: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.inicio || '')) ? String(opts.inicio) : '',
    fim: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.fim || '')) ? String(opts.fim) : ''
  };
  const consolidado = consolidarIndicadoresOp_(cfg, force, periodo);

  // Linha manual "Fora da SLA" (persistida por data na aba IndicadoresSLA).
  // Comportamento preservado: o valor sobrevive à releitura da origem.
  // No PGO 5.0 não existe a aba IndicadoresSLA: o valor manual vira uma
  // linha de Configurações com Tipo='SLA' (ver Pgo5Analitico.gs). Nenhuma
  // aba nova foi criada, e o comportamento visível é o mesmo.
  const foraSLA = lerValoresForaSla_();
  let totalForaSLA = 0;
  Object.keys(foraSLA).forEach(function(chave) {
    // O total só soma as datas que estão no período exibido.
    if (periodo.inicio && chave < periodo.inicio) return;
    if (periodo.fim && chave > periodo.fim) return;
    totalForaSLA += foraSLA[chave];
  });

  return {
    habilitado: true,
    abaNome: cfg.abaNome,
    // Quem pode MEXER na fonte é decidido pela permissão configurarAnaliseSac
    // no PGO 5.0 — o nome do nível é livre e não serve como critério. No 4.x
    // continua sendo o perfil ADM, que é o único conceito que existe lá.
    podeConfigurar: podeConfigurarAnaliseSac_(),
    datas: consolidado.datas,
    indicadores: consolidado.indicadores,
    foraSLA: foraSLA,
    totais: consolidado.totais,
    totalCasos: consolidado.totalCasos,
    totalForaSLA: totalForaSLA,
    volumePorDia: consolidado.volumePorDia,
    distribuicaoStatus: consolidado.distribuicaoStatus,
    statusNaoMapeados: consolidado.statusNaoMapeados,
    categorias: consolidado.categorias,
    colunasAnalise: consolidado.colunasAnalise,
    colunasAusentes: consolidado.colunasAusentes || [],
    mapeamento: {
      assunto: cfg.colunaAssunto,
      subassunto: cfg.colunaSubassunto,
      analista: cfg.colunaAnalista,
      status: cfg.colunaStatus
    },
    periodo: consolidado.periodo,
    atualizadoEm: consolidado.atualizadoEm
  };
}

/**
 * (Supervisor/ADM) Salva/atualiza o valor manual "Fora da SLA" de uma data
 * (upsert na aba IndicadoresSLA). A chave é a data em AAAA-MM-DD, a mesma da
 * consolidação — o valor sobrevive à releitura da planilha externa.
 * @param {string} dataChave - Data no formato AAAA-MM-DD.
 * @param {*} valor - Número informado (vazio/negativo vira 0).
 * @returns {Object} { success }.
 */
function salvarForaSLA(dataChave, valor) {
  requireAuth_();
  exigirAcesso_('analiseSac', requireSupervisor_);
  const chave = sanitizeInput(dataChave);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chave)) throw new Error('Data inválida.');
  let numero = Number(valor);
  if (!isFinite(numero) || numero < 0) numero = 0;

  // PGO 5.0: grava em Configurações (Tipo='SLA'), pois a aba IndicadoresSLA
  // não existe no banco novo e criar uma sexta aba está proibido.
  if (estruturaEhPGO5_() && typeof salvarForaSlaPGO5_ === 'function') {
    return salvarForaSlaPGO5_(chave, numero);
  }

  const existente = getAll(CONFIG.SHEET_NAMES.INDICADORES_SLA).some(function(reg) {
    return String(reg.Data || '').trim() === chave;
  });
  if (existente) {
    updateForaSLAPorData_(chave, numero);      // a aba não tem Id: grava pela data
  } else {
    insert(CONFIG.SHEET_NAMES.INDICADORES_SLA, { Data: chave, ForaSLA: numero });
  }
  return { success: true };
}

/**
 * Atualiza a linha da aba IndicadoresSLA cuja coluna Data corresponde à
 * chave (a aba não usa Id). Sob lock, como as demais escritas.
 */
function updateForaSLAPorData_(dataChave, numero) {
  // Trava reentrante (padronizada na Fase 2B): mesmo mecanismo das demais
  // gravações. Evita impasse caso um dia esta função passe a ser chamada
  // de dentro de outra operação que já detenha a trava.
  withScriptLock_(function() {
    const sheetName = CONFIG.SHEET_NAMES.INDICADORES_SLA;
    const sheet = getSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return;

    // A leitura/regravação é POSICIONAL (índices de COLUMNS). A estrutura
    // é validada antes — a aba IndicadoresSLA mantém seu formato próprio
    // (Data | ForaSLA, sem Id); aqui só garantimos que o cabeçalho está
    // íntegro e na ordem esperada antes de escrever.
    prepararAbaParaGravacao_(sheet, sheetName, COLUMNS.INDICADORES_SLA);

    if (sheet.getLastRow() <= 1) return;
    const colData = COLUMNS.INDICADORES_SLA.indexOf('Data');
    const colSLA = COLUMNS.INDICADORES_SLA.indexOf('ForaSLA');
    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.INDICADORES_SLA.length);
    const linhas = range.getValues();
    for (let i = 0; i < linhas.length; i++) {
      if (String(linhas[i][colData]).trim() === dataChave) {
        linhas[i][colSLA] = numero;
        range.setValues(linhas);
        break;
      }
    }
    invalidateCache(sheetName);
  });
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
  requireAuth_();
  exigirAcesso_('gerenciarCatalogos', requireSupervisor_);
  const isAdmin = isAdminProfile_(getActor_().perfil);
  const entities = getConfigurationEntities_();
  const result = {};
  Object.keys(entities).forEach(function(key) {
    // Gestão de usuários e dos campos do formulário são exclusivas do ADM.
    if (entities[key].adminOnly && !isAdmin) return;
    result[key] = getAll(entities[key].sheet).map(function(row) {
      return serializeRecord_(row);
    });
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
  requireAuth_();
  exigirAcesso_('gerenciarCatalogos', requireSupervisor_);
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');
  if (meta.adminOnly) exigirAcesso_('gerenciarCatalogos', requireAdmin_);

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
  // v4.5: o e-mail é a única credencial de acesso (requireAuth_ cruza a
  // conta Google autenticada com este campo) — precisa existir, ter
  // formato válido e ser único entre os usuários ativos.
  if (meta.key === 'usuarios') {
    if (!record.Email) throw new Error('E-mail é obrigatório.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.Email)) {
      throw new Error('E-mail inválido.');
    }
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

  // v4.6: regras das subcategorias (Produto → Categoria → Subcategoria).
  if (meta.key === 'subcategorias') {
    // O vínculo com uma categoria existente é obrigatório — é ele que fecha
    // a hierarquia (a categoria, por sua vez, aponta o produto).
    if (!record.CategoriaId || !getById(CONFIG.SHEET_NAMES.CATEGORIAS, record.CategoriaId)) {
      throw new Error('Selecione a categoria à qual a subcategoria pertence.');
    }
    // Nome único DENTRO da mesma categoria (comparação sem acentos/caixa).
    const nomeSubNormalizado = normalizeText_(record.Nome);
    const subDuplicada = getAll(CONFIG.SHEET_NAMES.SUBCATEGORIAS).some(function(sub) {
      return String(sub.Id) !== String(recordId || '') &&
        String(sub.CategoriaId) === String(record.CategoriaId) &&
        normalizeText_(sub.Nome) === nomeSubNormalizado;
    });
    if (subDuplicada) throw new Error('Já existe uma subcategoria com este nome nesta categoria.');
  }

  // v4.2: regras dos canais administráveis.
  if (meta.key === 'canais') {
    // Nome único (comparação sem acentos/caixa).
    if (record.Nome) {
      const nomeNormalizado = normalizeText_(record.Nome);
      const duplicado = getAll(CONFIG.SHEET_NAMES.CANAIS).some(function(canal) {
        return String(canal.Id) !== String(recordId || '') &&
          normalizeText_(canal.Nome) === nomeNormalizado;
      });
      if (duplicado) throw new Error('Já existe um canal com este nome.');
    }
    // O sistema nunca pode ficar sem canal ativo (o Canal é obrigatório
    // no formulário de Novo Atendimento).
    if (exists && isTrue_(exists.Ativo) && record.Ativo === false) {
      assertOutroCanalAtivo_(recordId);
    }
  }
  if (meta.key === 'usuarios' && exists && isTrue_(exists.Ativo) &&
      normalizeText_(exists.Perfil) === 'adm' &&
      (!isTrue_(record.Ativo) || normalizeText_(record.Perfil) !== 'adm')) {
    assertAnotherAdmin_(recordId);
  }
  // v4.5: e-mail único entre os usuários ATIVOS — evita ambiguidade na
  // autenticação (requireAuth_ resolve o ator pelo e-mail da conta Google).
  if (meta.key === 'usuarios' && record.Email && isTrue_(record.Ativo)) {
    const emailNormalizado = normalizeText_(record.Email);
    const emailDuplicado = getAll(CONFIG.SHEET_NAMES.USUARIOS).some(function(user) {
      return String(user.Id) !== String(recordId || '') &&
        isTrue_(user.Ativo) &&
        normalizeText_(user.Email) === emailNormalizado;
    });
    if (emailDuplicado) throw new Error('Já existe um usuário ativo com este e-mail.');
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
    // v4.6 (Seletores Dinâmicos): campos personalizados do tipo "select"
    // precisam da lista de opções (coluna Opcoes, separadas por ";").
    // Campos base não usam Opcoes — Produto, Categoria, Subcategoria e
    // Canal têm fontes próprias, administradas nas demais seções.
    const ehCampoBase = exists ? isTrue_(exists.Base) : false;
    if (!ehCampoBase && normalizeText_(record.Tipo) === 'select' && !record.Opcoes) {
      throw new Error('Informe as opções do seletor, separadas por ponto e vírgula (;).');
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
  requireAuth_();
  exigirAcesso_('gerenciarCatalogos', requireSupervisor_);
  const entities = getConfigurationEntities_();
  const meta = entities[sanitizeInput(entidade)];
  if (!meta) throw new Error('Tipo de configuração inválido.');
  if (meta.adminOnly) exigirAcesso_('gerenciarCatalogos', requireAdmin_);
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
  } else if (meta.key === 'categorias') {
    // v4.2: exclusão DEFINITIVA de categorias — a linha é removida da aba
    // Categorias do Google Sheets (não é mais desativação lógica). O
    // Histórico registra a exclusão e todas as listas suspensas, filtros
    // e indicadores são atualizados via invalidateAllCache + reload do
    // bootstrap no frontend.
    remove(meta.sheet, safeId);
  } else if (meta.key === 'subcategorias') {
    // v4.6: exclusão DEFINITIVA de subcategorias (mesma regra das
    // categorias). Atendimentos antigos que usaram o nome permanecem
    // válidos — a coluna Subcategoria guarda o texto, não o Id.
    remove(meta.sheet, safeId);
  } else if (meta.key === 'canais') {
    // v4.2: exclusão DEFINITIVA de canais, com guarda para o sistema
    // nunca ficar sem canal ativo.
    if (isTrue_(existing.Ativo)) assertOutroCanalAtivo_(safeId);
    remove(meta.sheet, safeId);
  } else {
    // Desativação lógica preserva o histórico dos atendimentos já vinculados.
    update(meta.sheet, safeId, { Ativo: false });
  }
  const acoesDefinitivas = ['camposFormulario', 'categorias', 'subcategorias', 'canais'];
  auditConfiguration_(acoesDefinitivas.indexOf(meta.key) !== -1 ? 'Exclusão' : 'Desativação', meta.label, safeId, existing);
  invalidateAllCache();
  SERVICE_CONTEXT_ = {};
  return { success: true };
}

/**
 * Informações da base de dados (planilha Google Sheets) para a seção
 * "Banco de Dados" da tela de Configurações — EXCLUSIVA do ADM
 * (requireAdmin_ revalida o perfil no servidor; esconder no frontend
 * nunca é a única barreira). Permite ao administrador abrir a planilha
 * diretamente para manutenção manual quando necessário.
 * @returns {Object} { nome, url } da planilha vinculada ao sistema.
 */
function getDatabaseInfo() {
  requireAuth_();
  exigirAcesso_('visualizarBancoPgo', requireAdmin_);
  const ss = getSpreadsheet();
  return { nome: ss.getName(), url: ss.getUrl() };
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
    // v4.6: subcategorias (Produto → Categoria → Subcategoria). Administráveis
    // por Supervisor e ADM (mesmo nível de acesso de produtos/categorias).
    subcategorias: {
      key: 'subcategorias', label: 'Subcategorias', sheet: CONFIG.SHEET_NAMES.SUBCATEGORIAS,
      columns: COLUMNS.SUBCATEGORIAS, prefix: 'SC'
    },
    // v4.2: canais de entrada administráveis (exclusivo do ADM).
    canais: {
      key: 'canais', label: 'Canais', sheet: CONFIG.SHEET_NAMES.CANAIS,
      columns: COLUMNS.CANAIS, prefix: 'CN', adminOnly: true
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
 * Garante que exista OUTRO canal ativo antes de excluir/desativar um
 * canal (v4.2) — o Canal é obrigatório no formulário de Novo Atendimento
 * e o sistema não pode ficar sem opções.
 * @param {string} ignoredId - Id do canal sendo alterado.
 * @throws {Error} Quando não há outro canal ativo.
 */
function assertOutroCanalAtivo_(ignoredId) {
  const outrosAtivos = getAll(CONFIG.SHEET_NAMES.CANAIS).filter(function(canal) {
    return String(canal.Id) !== String(ignoredId) && isTrue_(canal.Ativo);
  });
  if (!outrosAtivos.length) {
    throw new Error('Cadastre outro canal ativo antes de excluir/desativar este.');
  }
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
    subcategoria: String(record.Subcategoria || ''), // v4.6: '' nos registros antigos
    status: String(record.Status || ''),
    statusCor: colorMap[String(record.Status || '')] || '',
    situacaoPendencia: String(record.MotivoPendencia || ''),
    motivoPendencia: String(record.MotivoPendencia || ''),
    aguardandoRetorno: String(record.MotivoPendencia || ''),
    // v4.7: metadados internos (chaves "_") NÃO vão para o navegador.
    // Assim eles não aparecem no formulário, no Dashboard, nos filtros,
    // na busca rápida, nos relatórios nem nas exportações.
    camposExtras: camposExtrasPublicos_(record.CamposExtras),
    responsavel: String(record.Responsavel || ''),
    // v4.7 (Fase 2D): Id do responsável — usado apenas para o seletor do
    // formulário pré-selecionar a pessoa certa (essencial com homônimos).
    // É um identificador técnico de USUÁRIO, não dado do cliente; o nome,
    // que é mais identificador, já é enviado acima.
    responsavelId: String(metadadosAtendimento_(record)._responsavelId || ''),
    tempoResolucao: record.TempoResolucaoHoras === '' ? '' : Number(record.TempoResolucaoHoras || 0),
    observacoes: String(record.Observacoes || ''),
    criadoPor: String(record.CriadoPor || ''),
    dataCriacao: toIso_(record.DataCriacao),
    atualizadoPor: String(record.AtualizadoPor || ''),
    dataAtualizacao: toIso_(record.DataAtualizacao)
  };
}

/**
 * Campos personalizados VISÍVEIS ao usuário: o conteúdo de CamposExtras
 * sem os metadados internos (chaves iniciadas por "_").
 * @param {string} value - JSON da coluna CamposExtras.
 * @returns {Object} Apenas os campos criados pelo ADM na ConfigCampos.
 */
function camposExtrasPublicos_(value) {
  const extras = parseCamposExtras_(value);
  const publicos = {};
  Object.keys(extras).forEach(function(chave) {
    if (chave.charAt(0) !== '_') publicos[chave] = extras[chave];
  });
  return publicos;
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
 * Retorna o ator autenticado da requisição atual. É preenchido por
 * requireAuth_ (a barreira de e-mail) no início de cada função pública;
 * se ainda não houver ator no contexto, delega a requireAuth_ — que
 * resolve pelo e-mail da conta Google e BLOQUEIA quem não estiver
 * cadastrado/ativo na aba Usuários. Não existe mais usuário "Visitante"
 * nem acesso parcial: sem cadastro, não há acesso.
 * @returns {Object} { id, email, nome, perfil, equipe }.
 * @throws {Error} 'AUTH: ...' quando o e-mail não está autorizado.
 */
function getActor_() {
  if (SERVICE_CONTEXT_.actor) return SERVICE_CONTEXT_.actor;
  return requireAuth_();
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
 * Barreira de acesso que serve aos dois bancos.
 *
 * POR QUE ISTO EXISTE
 * As telas herdadas do 4.x (Indicadores, Análise de SAC, nomes de telas)
 * decidiam o acesso pelo NOME do perfil — 'Supervisor', 'ADM'. No PGO 5.0 o
 * nome do nível é livre: o Administrador pode criar um nível chamado
 * "Coordenação". Comparar nomes barraria quem tem a permissão e liberaria
 * quem só tem o rótulo. Então:
 *
 *   - Banco PGO 5.0 → decide pela PERMISSÃO (exigirPermissao_).
 *   - Banco 4.x     → mantém exatamente o comportamento antigo, porque lá
 *                     não existe nível de acesso para consultar.
 *
 * @param {string} permissao Permissão exigida no PGO 5.0 (ex.: 'analiseSac').
 * @param {Function} barreiraLegado requireSupervisor_ ou requireAdmin_.
 * @returns {void}
 * @throws {Error} Quando o usuário não pode executar a ação.
 */
function exigirAcesso_(permissao, barreiraLegado) {
  if (estruturaEhPGO5_() && typeof exigirPermissao_ === 'function') {
    exigirPermissao_(permissao);
    return;
  }
  barreiraLegado();
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

  // ── 1) Preferência: vínculo por ID ESTÁVEL (metadados internos) ──
  // Registros criados/editados a partir da v4.7 carregam _responsavelId e
  // _criadoPorId em CamposExtras. O Id não muda quando o nome é corrigido
  // e não se confunde entre homônimos.
  const meta = metadadosAtendimento_(record);
  const respId = String(meta._responsavelId || '');
  const criadorId = String(meta._criadoPorId || '');
  if (respId || criadorId) {
    const actorId = String(actor.id || '');
    if (!actorId) return false;
    return respId === actorId || criadorId === actorId;
  }

  // ── 2) LEGADO: registros anteriores não têm os metadados ──
  // Mantém exatamente a regra antiga (comparação por nome), garantindo
  // que nenhum atendimento histórico deixe de ser acessível.
  const name = normalizeText_(actor.nome);
  if (!name) return false;
  return normalizeText_(record.Responsavel) === name || normalizeText_(record.CriadoPor) === name;
}

// ============================================================================
// METADADOS INTERNOS DO ATENDIMENTO (v4.7 — sem alterar o banco)
// ============================================================================
/*
 * POR QUE ISSO EXISTE
 * -------------------
 * A propriedade do atendimento era determinada pelo NOME do analista —
 * frágil: dois homônimos enxergavam os casos um do outro, e corrigir o
 * nome de alguém fazia a pessoa perder acesso aos próprios registros.
 *
 * COMO RESOLVEMOS SEM MEXER NO BANCO
 * Guardamos o Id do usuário dentro do JSON que já existe na coluna
 * CamposExtras, com chaves prefixadas por "_" (metadados internos):
 *     { "agencia": "0001", "_responsavelId": "USR-1", "_criadoPorId": "USR-2" }
 * Nenhuma coluna nova, nenhuma migração, nenhum SCHEMA_VERSION alterado.
 *
 * POR QUE O PREFIXO "_" É SEGURO
 *  - Campos personalizados têm a chave gerada por slugifyFieldKey_, que
 *    remove tudo que não seja a-z/0-9 — NUNCA começam com "_";
 *  - validateAtendimentoInput_ só aceita chaves declaradas na aba
 *    ConfigCampos, então o navegador NÃO consegue forjar um _responsavelId;
 *  - toClientAtendimento_ remove as chaves "_" antes de enviar ao
 *    frontend: os metadados não aparecem em tela, filtros, relatórios,
 *    Dashboard nem exportações;
 *  - buildChangeHistory_ ignora as chaves "_" ao comparar, para não poluir
 *    o Histórico com informação interna.
 */

/**
 * Lê os metadados internos de um atendimento (chaves iniciadas por "_").
 * @param {Object} record - Registro cru da planilha.
 * @returns {Object} Apenas os metadados (pode vir vazio).
 */
function metadadosAtendimento_(record) {
  const extras = parseCamposExtras_(record && record.CamposExtras);
  const meta = {};
  Object.keys(extras).forEach(function(chave) {
    if (chave.charAt(0) === '_') meta[chave] = extras[chave];
  });
  return meta;
}

/**
 * Mescla metadados internos no JSON de CamposExtras, PRESERVANDO os
 * campos personalizados já existentes.
 * Valor vazio remove a chave (usado quando o vínculo fica ambíguo).
 * @param {string} camposExtrasJson - JSON atual (pode ser '').
 * @param {Object} metadados - Ex.: { _responsavelId: 'USR-1' }.
 * @returns {string} JSON resultante ('' quando não sobra nada).
 */
function mesclarMetadadosAtendimento_(camposExtrasJson, metadados) {
  const obj = parseCamposExtras_(camposExtrasJson);
  Object.keys(metadados || {}).forEach(function(chave) {
    const valor = metadados[chave];
    if (valor === '' || valor === null || valor === undefined) delete obj[chave];
    else obj[chave] = String(valor);
  });
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
}

/**
 * Resolve o Id do usuário a partir do NOME exibido, apenas quando não há
 * ambiguidade. Devolve '' se ninguém casar OU se houver mais de um
 * usuário ativo com o mesmo nome — nesses casos o sistema mantém o
 * comportamento legado por nome, em vez de "chutar" um Id.
 * @param {string} nome - Nome do usuário.
 * @returns {string} Id do usuário ou ''.
 */
/**
 * 🔴 Resolve QUEM é o responsável do atendimento — sempre no servidor.
 *
 * Ordem de decisão:
 *   1. Analista NUNCA delega: o responsável é ele mesmo;
 *   2. Supervisor/ADM enviou um Id? valida (existe, ativo, perfil válido)
 *      e usa o NOME OFICIAL do cadastro — o nome que veio do navegador é
 *      ignorado. Isso impede combinações forjadas do tipo
 *      { responsavelId: 'USR-A', responsavel: 'Outro Usuário' };
 *   3. Sem Id (compatibilidade com telas antigas): usa o nome, e só grava
 *      o vínculo por Id quando o nome não for ambíguo.
 * @param {Object} input - Dados validados do formulário.
 * @param {Object} actor - Usuário autenticado.
 * @param {string} nomeFallback - Responsável atual (em edições).
 * @returns {Object} { nome, id, explicito }.
 * @throws {Error} Quando o Id enviado é inválido.
 */
function resolverResponsavel_(input, actor, nomeFallback) {
  // Em EDIÇÕES recebemos o responsável atual: ele é preservado, salvo
  // reatribuição explícita por um Supervisor/ADM.
  const ehEdicao = nomeFallback !== undefined && nomeFallback !== null && String(nomeFallback) !== '';

  // 1) Analista não escolhe responsável nem assume o caso de outra pessoa.
  if (!isSupervisorProfile_(actor.perfil)) {
    if (!ehEdicao) {
      // Criação: o responsável é o próprio autor — identidade conhecida.
      return { nome: String(actor.nome || ''), id: String(actor.id || ''), explicito: false };
    }
    // Edição: MANTÉM o responsável atual (comportamento histórico — um
    // analista que criou o caso para outra pessoa não pode tomá-lo para
    // si ao editar). O Id vem da resolução por NOME e só quando não há
    // ambiguidade: assim um homônimo que edite um registro legado não
    // "reivindica" o caso.
    const nomeAtual = String(nomeFallback);
    return { nome: nomeAtual, id: resolverUsuarioIdPorNome_(nomeAtual), explicito: false };
  }

  // 2) Delegação por Id (caminho preferencial, imune a homônimos).
  const id = sanitizeInput(input.responsavelId);
  if (id) {
    const usuario = getById(CONFIG.SHEET_NAMES.USUARIOS, id);
    if (!usuario) throw new Error('O responsável selecionado não existe.');
    if (!isTrue_(usuario.Ativo)) throw new Error('O responsável selecionado está inativo.');
    const perfil = normalizeText_(usuario.Perfil);
    const perfisValidos = ['analista', 'supervisor', 'gestor', 'adm', 'admin', 'administrador'];
    if (perfisValidos.indexOf(perfil) === -1) {
      throw new Error('O responsável selecionado não possui perfil válido para receber atendimentos.');
    }
    // O NOME vem do cadastro — nunca do que o navegador enviou.
    return { nome: String(usuario.Nome || ''), id: String(usuario.Id || ''), explicito: true };
  }

  // 3) Compatibilidade: apenas o nome (telas antigas ou "Automático").
  const nome = String(input.responsavel || nomeFallback || actor.nome || '');
  // Em edição, o Id vem SEMPRE da resolução por nome (sem ambiguidade).
  // Em criação com "Automático", o responsável é o próprio ator.
  const idPorNome = (!ehEdicao && normalizeText_(nome) === normalizeText_(actor.nome))
    ? String(actor.id || '')
    : resolverUsuarioIdPorNome_(nome);
  return { nome: nome, id: idPorNome, explicito: false };
}

function resolverUsuarioIdPorNome_(nome) {
  const alvo = normalizeText_(nome);
  if (!alvo) return '';
  const encontrados = getAll(CONFIG.SHEET_NAMES.USUARIOS).filter(function(u) {
    return isTrue_(u.Ativo) && normalizeText_(u.Nome) === alvo;
  });
  return encontrados.length === 1 ? String(encontrados[0].Id || '') : '';
}

/**
 * Filtra uma lista de atendimentos para o perfil Analista (apenas os seus).
 * Supervisor recebe a lista completa, sem alteração.
 */
function restrictToOwnerIfNeeded_(records, actor) {
  // BANCO PGO 5.0: o recorte já foi aplicado na origem, pelo motor de
  // permissões (ver pgo5FiltrarAtendimentosPorEscopo_). Reaplicar aqui a
  // regra do 4.x — que compara o NOME do responsável com o do usuário —
  // apagaria da tela justamente o que um gestor pode ver da equipe.
  if (estruturaEhPGO5_()) return records;

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


// ============================================================================
// PONTES DA ETAPA 4 — o mesmo endpoint servindo os dois bancos
// ============================================================================

/**
 * Valores manuais de "Fora da SLA", venham eles de onde vierem.
 *
 * No PGO 5.0 ficam em Configurações (Tipo='SLA'); no 4.x continuam na aba
 * IndicadoresSLA. Quem chama não precisa saber em qual banco está.
 *
 * @returns {Object} { 'AAAA-MM-DD': quantidade }.
 */
function lerValoresForaSla_() {
  if (estruturaEhPGO5_() && typeof lerForaSlaPGO5_ === 'function') {
    return lerForaSlaPGO5_();
  }

  const valores = {};
  getAll(CONFIG.SHEET_NAMES.INDICADORES_SLA).forEach(function(registro) {
    const chave = String(registro.Data || '').trim();
    if (!chave) return;
    valores[chave] = Number(registro.ForaSLA) || 0;
  });
  return valores;
}

/**
 * Diz se o usuário pode alterar a configuração da Análise de SAC.
 *
 * ⚠️ NÃO CONFUNDIR COM VER O LINK DA FONTE
 * São duas permissões diferentes e de propósito:
 *
 *   configurarAnaliseSac → mexer no mapeamento de colunas, status e período
 *   visualizarFonteSac   → ver o ENDEREÇO da planilha externa (e ainda
 *                          exige PIN, ver Pgo5Seguranca.gs)
 *
 * Quem ajusta a análise não precisa, necessariamente, ter o link da
 * planilha de origem em mãos.
 *
 * @returns {boolean} true quando o usuário pode configurar.
 */
function podeConfigurarAnaliseSac_() {
  if (estruturaEhPGO5_() && typeof usuarioTemPermissao_ === 'function') {
    return usuarioTemPermissao_(atorComoUsuario_(getActor_()), 'configurarAnaliseSac');
  }
  return isAdminProfile_(getActor_().perfil);
}

/**
 * Ajusta uma data lida do banco para comparar com o filtro de período.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * O PGO 5.0 grava a data de abertura como meia-noite UTC
 * ("2026-08-12T00:00:00.000Z"), porque é uma data SEM hora — o operador
 * escolheu um dia, não um instante. Já parseInputDate_ monta o começo do
 * período como meia-noite no fuso do servidor. Em América/São_Paulo (UTC-3)
 * a meia-noite local acontece 3 horas DEPOIS da meia-noite UTC, então
 * "2026-08-12T00:00:00Z" ficava ANTES do início do dia 12 e o atendimento
 * sumia do próprio dia dele.
 *
 * A solução é a mesma que o front já usa: quando o valor é exatamente
 * meia-noite UTC, ele representa um DIA, não um instante — e é remontado
 * como meia-noite local daquele mesmo dia do calendário.
 *
 * Datas com hora de verdade (ex.: DataCriacao) não são tocadas.
 *
 * @param {Date|null} data Data lida do registro.
 * @returns {Date|null} A data pronta para comparação, ou null.
 */
function normalizarDataParaFiltro_(data) {
  if (!data) return null;

  const ehMeiaNoiteUtc = data.getUTCHours() === 0 && data.getUTCMinutes() === 0 &&
    data.getUTCSeconds() === 0 && data.getUTCMilliseconds() === 0;
  if (!ehMeiaNoiteUtc) return data;

  return new Date(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), 0, 0, 0, 0);
}

/**
 * Converte uma data em chave de dia ("AAAA-MM-DD") para agrupar por data.
 *
 * Usa as mesmas regras de normalizarDataParaFiltro_, para o agrupamento e o
 * filtro concordarem sobre a qual dia cada atendimento pertence — sem isso,
 * um registro poderia entrar no período filtrado e aparecer em outro dia
 * do gráfico.
 *
 * @param {Date|null} data Data lida do registro.
 * @returns {string} Chave no formato AAAA-MM-DD, ou '' se não houver data.
 */
function chaveDoDia_(data) {
  const normalizada = normalizarDataParaFiltro_(data);
  if (!normalizada) return '';
  const doisDigitos = function(numero) { return (numero < 10 ? '0' : '') + numero; };
  return normalizada.getFullYear() + '-' +
    doisDigitos(normalizada.getMonth() + 1) + '-' +
    doisDigitos(normalizada.getDate());
}
