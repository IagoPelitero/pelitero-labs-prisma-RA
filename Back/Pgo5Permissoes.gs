/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Permissoes.gs
 * ============================================================================
 *
 * RESPONSABILIDADE
 * Resolver Cargos, Níveis de Acesso e permissões. É aqui que o sistema
 * decide o que cada pessoa pode fazer.
 *
 * ⚠️ REGRA MAIS IMPORTANTE DESTE ARQUIVO
 * CARGO NÃO CONCEDE ACESSO. Quem concede é o NÍVEL DE ACESSO.
 *
 *   Usuário.CargoId        → função organizacional (o que a pessoa É)
 *   Usuário.NivelAcessoId  → permissões          (o que a pessoa PODE)
 *
 * Os dois são independentes: um "Analista" pode ter nível "Gestão", e um
 * "Supervisor" pode ter nível "Operacional". Por isso NUNCA escreva
 * `if (cargo === 'ADM')` — use usuarioTemPermissao_().
 *
 * ONDE FICAM OS DADOS
 * Cargos e Níveis são linhas da aba "Configurações":
 *
 *   Tipo = 'CARGO'         → Nome = rótulo, Valor = ordem de exibição
 *   Tipo = 'NIVEL_ACESSO'  → Nome = rótulo, Valor = ordem,
 *                            Configuracao = JSON { "permissoes": [...] }
 *
 * A aba Configurações não tem coluna "Ordem"; por isso a ordem de exibição
 * é guardada na coluna "Valor". Nenhuma coluna nova foi criada.
 *
 * RELAÇÃO COM OS OUTROS MÓDULOS
 *   Pgo5Usuarios.gs      → cadastro de pessoas e hierarquia (SupervisorId)
 *   Pgo5Atendimentos.gs  → usa o escopo daqui para filtrar atendimentos
 *   Pgo5Catalogo.gs      → protege a administração com exigirPermissao_()
 * ============================================================================
 */

// ============================================================================
// CATÁLOGO DE PERMISSÕES
// ============================================================================

/**
 * Todas as permissões que o sistema reconhece, agrupadas por domínio.
 *
 * Este objeto é a ÚNICA fonte de verdade da lista. O editor de permissões
 * do front monta os grupos a partir daqui, então acrescentar uma permissão
 * nova é só adicionar a chave e o rótulo — a tela se ajusta sozinha.
 *
 * Uma chave que não esteja aqui é ignorada na resolução: isso evita que um
 * JSON editado à mão na planilha invente um poder que o código não conhece.
 */
const PGO5_PERMISSOES = {
  Atendimentos: {
    criarAtendimento: 'Criar atendimento',
    verProprios: 'Ver os próprios atendimentos',
    editarProprios: 'Editar os próprios atendimentos',
    excluirProprios: 'Excluir os próprios atendimentos'
  },
  Equipe: {
    verEquipe: 'Ver atendimentos da equipe',
    editarEquipe: 'Editar atendimentos da equipe',
    excluirEquipe: 'Excluir atendimentos da equipe',
    delegarEquipe: 'Delegar atendimentos dentro da equipe'
  },
  Todos: {
    verTodos: 'Ver todos os atendimentos',
    editarTodos: 'Editar qualquer atendimento',
    excluirTodos: 'Excluir qualquer atendimento',
    delegarTodos: 'Delegar para qualquer usuário'
  },
  Relatorios: {
    relatoriosProprios: 'Relatórios dos próprios atendimentos',
    relatoriosEquipe: 'Relatórios da equipe',
    relatoriosTodos: 'Relatórios de toda a operação'
  },
  Produtividade: {
    produtividadeEquipe: 'Produtividade da equipe',
    produtividadeTodos: 'Produtividade de toda a operação'
  },
  SAC: {
    analiseSac: 'Acessar a Análise de SAC'
  },
  Usuarios: {
    gerenciarEquipe: 'Gerenciar os usuários da própria hierarquia',
    gerenciarUsuariosTodos: 'Gerenciar todos os usuários'
  },
  Configuracoes: {
    gerenciarFormulario: 'Gerenciar campos do formulário',
    gerenciarCanais: 'Gerenciar canais',
    gerenciarCatalogos: 'Gerenciar produtos, categorias e listas',
    configurarSistema: 'Configurações gerais do sistema',
    configurarAnaliseSac: 'Configurar a fonte da Análise de SAC'
  },
  Seguranca: {
    gerenciarCargos: 'Gerenciar cargos',
    gerenciarNiveis: 'Gerenciar níveis de acesso',
    alterarPermissoes: 'Alterar as permissões de um nível',
    visualizarBancoPgo: 'Ver o link da planilha do sistema',
    visualizarFonteSac: 'Ver o link da planilha da Análise de SAC',
    concederAdministrador: 'Conceder acesso de Administrador'
  }
};

/**
 * Lista plana com todas as chaves de permissão válidas.
 * @returns {string[]} Ex.: ['criarAtendimento', 'verProprios', ...].
 */
function listarChavesDePermissao_() {
  const chaves = [];
  Object.keys(PGO5_PERMISSOES).forEach(function(grupo) {
    Object.keys(PGO5_PERMISSOES[grupo]).forEach(function(chave) { chaves.push(chave); });
  });
  return chaves;
}

/**
 * true quando a chave informada é uma permissão que o sistema reconhece.
 * @param {string} permissao Chave a conferir.
 * @returns {boolean}
 */
function permissaoExiste_(permissao) {
  return listarChavesDePermissao_().indexOf(String(permissao || '')) !== -1;
}

// ============================================================================
// TIPOS DE REGISTRO NA ABA CONFIGURAÇÕES
// ============================================================================

/** Valores da coluna "Tipo" usados por este módulo. */
const PGO5_TIPOS_CONFIG = {
  CARGO: 'CARGO',
  NIVEL_ACESSO: 'NIVEL_ACESSO'
};

// ============================================================================
// DADOS INICIAIS
// ============================================================================

/**
 * Cargos que uma instalação nova recebe.
 *
 * São apenas rótulos organizacionais: nenhum deles concede acesso. O ADM
 * pode criar outros (Coordenador, Especialista…) sem alterar código.
 * @returns {Object[]} Lista de { chave, nome }.
 */
function cargosIniciais_() {
  return [
    { chave: 'ADM', nome: 'ADM' },
    { chave: 'SUPERVISOR', nome: 'Supervisor' },
    { chave: 'ANALISTA', nome: 'Analista' }
  ];
}

/**
 * Níveis de acesso iniciais, já com as permissões de cada um.
 *
 * "Administrador" recebe TODAS as permissões conhecidas — inclusive as
 * sensíveis, que só ganham proteção adicional numa etapa posterior.
 * @returns {Object[]} Lista de { chave, nome, permissoes }.
 */
function niveisAcessoIniciais_() {
  return [
    {
      chave: 'ADMINISTRADOR',
      nome: 'Administrador',
      permissoes: listarChavesDePermissao_()
    },
    {
      chave: 'GESTAO',
      nome: 'Gestão',
      permissoes: [
        'criarAtendimento',
        'verProprios', 'editarProprios',
        'verEquipe', 'editarEquipe',
        'delegarEquipe',
        'relatoriosProprios', 'relatoriosEquipe',
        'produtividadeEquipe',
        'analiseSac',
        'gerenciarEquipe'
      ]
    },
    {
      chave: 'OPERACIONAL',
      nome: 'Operacional',
      permissoes: [
        'criarAtendimento',
        'verProprios', 'editarProprios', 'excluirProprios',
        'relatoriosProprios'
      ]
    }
  ];
}

/**
 * Cria cargos e níveis iniciais na aba Configurações, sem duplicar.
 *
 * É idempotente: um item já existente (identificado pela Chave) é deixado
 * exatamente como está, inclusive se o ADM alterou o nome ou as permissões.
 * O seed nunca sobrescreve configuração feita pelo administrador.
 *
 * @returns {Object} Relatório sem dados pessoais: { criados, jaExistentes }.
 */
function aplicarSeedPermissoesPGO5_() {
  const relatorio = { criados: [], jaExistentes: [] };

  return withScriptLock_(function() {
    const existentes = pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES);
    const jaTem = function(tipo, chave) {
      return existentes.some(function(linha) {
        return String(linha.Tipo || '').toUpperCase() === tipo &&
          normalizeText_(linha.Chave) === normalizeText_(chave);
      });
    };

    cargosIniciais_().forEach(function(cargo, indice) {
      if (jaTem(PGO5_TIPOS_CONFIG.CARGO, cargo.chave)) {
        relatorio.jaExistentes.push('CARGO:' + cargo.chave);
        return;
      }
      pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, {
        Tipo: PGO5_TIPOS_CONFIG.CARGO,
        Chave: cargo.chave,
        Nome: cargo.nome,
        Valor: indice + 1,          // ordem de exibição
        Ativo: true,
        Data: toIso_(new Date())
      });
      relatorio.criados.push('CARGO:' + cargo.chave);
    });

    niveisAcessoIniciais_().forEach(function(nivel, indice) {
      if (jaTem(PGO5_TIPOS_CONFIG.NIVEL_ACESSO, nivel.chave)) {
        relatorio.jaExistentes.push('NIVEL:' + nivel.chave);
        return;
      }
      pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, {
        Tipo: PGO5_TIPOS_CONFIG.NIVEL_ACESSO,
        Chave: nivel.chave,
        Nome: nivel.nome,
        Valor: indice + 1,
        Configuracao: JSON.stringify({ permissoes: nivel.permissoes }),
        Ativo: true,
        Data: toIso_(new Date())
      });
      relatorio.criados.push('NIVEL:' + nivel.chave);
    });

    Logger.log('[PGO5] Seed de cargos/níveis: ' + relatorio.criados.length +
      ' criado(s), ' + relatorio.jaExistentes.length + ' já existente(s).');
    return relatorio;
  });
}

// ============================================================================
// LEITURA DE CARGOS E NÍVEIS
// ============================================================================

/**
 * Lê a aba Configurações uma vez e separa os registros por Tipo.
 *
 * Todo o resto deste módulo trabalha sobre o resultado desta função — é o
 * que evita reler a planilha para cada consulta de permissão.
 *
 * @returns {Object} { CARGO: [], NIVEL_ACESSO: [] }.
 */
function lerCargosENiveis_() {
  const grupos = { CARGO: [], NIVEL_ACESSO: [] };
  pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES).forEach(function(linha) {
    const tipo = String(linha.Tipo || '').trim().toUpperCase();
    if (grupos[tipo]) grupos[tipo].push(linha);
  });
  return grupos;
}

/**
 * Converte uma linha de Configurações no formato enxuto que a tela usa.
 * @param {Object} linha Registro cru da aba Configurações.
 * @returns {Object} { id, chave, nome, ordem, ativo, permissoes }.
 */
function montarItemDeAcesso_(linha) {
  return {
    id: String(linha.Id || ''),
    chave: String(linha.Chave || ''),
    nome: String(linha.Nome || ''),
    ordem: Number(linha.Valor) || 0,
    ativo: linha.Ativo === '' || isTrue_(linha.Ativo),
    permissoes: lerPermissoesDoRegistro_(linha)
  };
}

/**
 * Lê a lista de permissões guardada no JSON da coluna Configuracao.
 *
 * FAIL CLOSED: JSON inválido, ausente ou com formato inesperado devolve
 * lista VAZIA. Nunca assume permissões — um erro de digitação na planilha
 * não pode virar acesso de administrador.
 *
 * Chaves desconhecidas são descartadas (ver PGO5_PERMISSOES).
 *
 * @param {Object} linha Registro NIVEL_ACESSO da aba Configurações.
 * @returns {string[]} Permissões válidas do nível.
 */
function lerPermissoesDoRegistro_(linha) {
  const bruto = String(linha.Configuracao || '').trim();
  if (!bruto) return [];

  let objeto = null;
  try {
    objeto = JSON.parse(bruto);
  } catch (e) {
    Logger.log('[PGO5] Permissões ignoradas: JSON inválido no nível "' +
      String(linha.Chave || linha.Id || '') + '".');
    return [];
  }
  if (!objeto || !Array.isArray(objeto.permissoes)) return [];

  return objeto.permissoes
    .map(function(p) { return String(p || '').trim(); })
    .filter(function(p) { return permissaoExiste_(p); });
}

/** Ordena cargos/níveis por ordem e, em empate, pelo nome. */
function ordenarItensDeAcesso_(itens) {
  return itens.slice().sort(function(a, b) {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
}

/**
 * Cargos cadastrados, ordenados.
 * @param {Object} [dados] Resultado de lerCargosENiveis_ (evita reler).
 * @param {boolean} [somenteAtivos] true devolve apenas os ativos.
 * @returns {Object[]} Cargos no formato de item de acesso.
 */
function listarCargos_(dados, somenteAtivos) {
  const base = (dados || lerCargosENiveis_()).CARGO.map(montarItemDeAcesso_);
  const filtrados = somenteAtivos ? base.filter(function(c) { return c.ativo; }) : base;
  return ordenarItensDeAcesso_(filtrados);
}

/**
 * Níveis de acesso cadastrados, ordenados.
 * @param {Object} [dados] Resultado de lerCargosENiveis_.
 * @param {boolean} [somenteAtivos] true devolve apenas os ativos.
 * @returns {Object[]} Níveis no formato de item de acesso.
 */
function listarNiveisAcesso_(dados, somenteAtivos) {
  const base = (dados || lerCargosENiveis_()).NIVEL_ACESSO.map(montarItemDeAcesso_);
  const filtrados = somenteAtivos ? base.filter(function(n) { return n.ativo; }) : base;
  return ordenarItensDeAcesso_(filtrados);
}

// ============================================================================
// MOTOR CENTRAL DE AUTORIZAÇÃO
// ============================================================================

/**
 * Encontra o nível de acesso de um usuário.
 *
 * FAIL CLOSED: devolve null quando o usuário está inativo, quando o
 * NivelAcessoId não aponta para nada ou quando o nível está desativado.
 * Quem chama deve tratar null como "sem nenhuma permissão".
 *
 * @param {Object} usuario Registro da aba Usuários (ou ator autenticado).
 * @param {Object} [dados] Resultado de lerCargosENiveis_.
 * @returns {Object|null} Item do nível, ou null.
 */
function resolverNivelAcessoUsuario_(usuario, dados) {
  if (!usuario) return null;
  // Usuário desativado não tem acesso, qualquer que seja o nível dele.
  if (usuario.Ativo !== undefined && !isTrue_(usuario.Ativo)) return null;

  const nivelId = String(usuario.NivelAcessoId || usuario.nivelAcessoId || '').trim().toUpperCase();
  if (!nivelId) return null;

  const nivel = listarNiveisAcesso_(dados).find(function(n) {
    return n.id.toUpperCase() === nivelId;
  });
  if (!nivel || !nivel.ativo) return null;
  return nivel;
}

/**
 * Permissões efetivas de um usuário.
 *
 * A permissão vem SEMPRE do nível de acesso. O cargo é ignorado aqui de
 * propósito — ele descreve a função da pessoa, não o que ela pode fazer.
 *
 * @param {Object} usuario Registro do usuário.
 * @param {Object} [dados] Resultado de lerCargosENiveis_.
 * @returns {string[]} Permissões (lista vazia quando não há nível válido).
 */
function obterPermissoesUsuario_(usuario, dados) {
  const nivel = resolverNivelAcessoUsuario_(usuario, dados);
  return nivel ? nivel.permissoes : [];
}

/**
 * Verifica se um usuário possui determinada permissão.
 *
 * A permissão é resolvida pelo NivelAcessoId do usuário.
 * Cargo não concede permissão automaticamente.
 *
 * @param {Object} usuario Usuário autenticado.
 * @param {string} permissao Chave da permissão (ver PGO5_PERMISSOES).
 * @returns {boolean} true quando permitido.
 */
function usuarioTemPermissao_(usuario, permissao) {
  if (!permissaoExiste_(permissao)) return false;
  return obterPermissoesUsuario_(usuario).indexOf(permissao) !== -1;
}

/**
 * Interrompe a execução quando o usuário autenticado não tem a permissão.
 *
 * É a barreira que toda função pública sensível deve usar. Vale para
 * qualquer origem da chamada: esconder um botão no front NÃO substitui isto.
 *
 * @param {string} permissao Chave da permissão exigida.
 * @returns {Object} O ator autenticado, para reaproveitamento.
 * @throws {Error} Quando a permissão não foi concedida.
 */
function exigirPermissao_(permissao) {
  const ator = requireAuth_();
  if (!usuarioTemPermissao_(atorComoUsuario_(ator), permissao)) {
    throw new Error('Você não tem permissão para executar esta ação.');
  }
  return ator;
}

/**
 * Converte o ator autenticado (formato do SERVICE_CONTEXT_) no formato de
 * registro de usuário que o motor de permissões espera.
 *
 * Existe porque requireAuth_ devolve um objeto enxuto { id, email, nome,
 * perfil, equipe }, enquanto o motor precisa do NivelAcessoId.
 *
 * @param {Object} ator Resultado de requireAuth_/getActor_.
 * @returns {Object} Registro do usuário na aba Usuários, ou o próprio ator.
 */
function atorComoUsuario_(ator) {
  if (!ator) return null;
  if (ator.NivelAcessoId !== undefined) return ator;   // já é um registro
  const registro = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).find(function(u) {
    return String(u.Id || '').trim().toUpperCase() === String(ator.id || '').trim().toUpperCase();
  });
  return registro || null;
}

// ============================================================================
// ESCOPO DE DADOS
// ============================================================================

/**
 * Descobre até onde um usuário enxerga (ou altera) atendimentos.
 *
 * O escopo é sempre o MAIOR alcance que as permissões permitem:
 *
 *   'TODOS'    → toda a operação
 *   'EQUIPE'   → os próprios + os de quem está abaixo dele na hierarquia
 *   'PROPRIOS' → apenas os atendimentos em que ele é responsável ou criador
 *   'NENHUM'   → sem acesso (fail closed)
 *
 * @param {Object} usuario Registro do usuário.
 * @param {string} acao 'ver', 'editar' ou 'excluir'.
 * @returns {string} Um dos escopos acima.
 */
function obterEscopoAtendimentos_(usuario, acao) {
  const sufixo = { ver: 'Ver', editar: 'Editar', excluir: 'Excluir' }[String(acao || 'ver')];
  if (!sufixo) return 'NENHUM';

  const permissoes = obterPermissoesUsuario_(usuario);
  const tem = function(alcance) {
    // Monta a chave no formato "verTodos", "editarEquipe"…
    const chave = sufixo.charAt(0).toLowerCase() + sufixo.slice(1) + alcance;
    return permissoes.indexOf(chave) !== -1;
  };

  if (tem('Todos')) return 'TODOS';
  if (tem('Equipe')) return 'EQUIPE';
  if (tem('Proprios')) return 'PROPRIOS';
  return 'NENHUM';
}

/**
 * Escopo de DELEGAÇÃO: para quem o usuário pode atribuir um atendimento.
 *
 *   'TODOS'    → qualquer usuário ativo
 *   'EQUIPE'   → apenas a própria hierarquia
 *   'NENHUM'   → só para si mesmo
 *
 * @param {Object} usuario Registro do usuário.
 * @returns {string} 'TODOS' | 'EQUIPE' | 'NENHUM'.
 */
function obterEscopoDelegacao_(usuario) {
  const permissoes = obterPermissoesUsuario_(usuario);
  if (permissoes.indexOf('delegarTodos') !== -1) return 'TODOS';
  if (permissoes.indexOf('delegarEquipe') !== -1) return 'EQUIPE';
  return 'NENHUM';
}

// ============================================================================
// PROTEÇÃO DO ÚLTIMO ADMINISTRADOR
// ============================================================================

/**
 * Diz se um nível de acesso é "administrativo".
 *
 * O critério é funcional, não o nome: administrativo é o nível que pode
 * mexer nas permissões do sistema. Assim, renomear "Administrador" para
 * outra coisa não desliga a proteção.
 *
 * @param {Object} nivel Item de nível (montarItemDeAcesso_).
 * @returns {boolean} true quando o nível administra o sistema.
 */
function nivelEhAdministrativo_(nivel) {
  return !!nivel && nivel.ativo && nivel.permissoes.indexOf('alterarPermissoes') !== -1;
}

/**
 * Conta quantos usuários ATIVOS ainda conseguiriam administrar o sistema
 * caso uma alteração fosse aplicada.
 *
 * A simulação é feita em memória: nada é gravado. Serve para decidir, antes
 * de salvar, se a mudança deixaria o PGO sem nenhum administrador.
 *
 * @param {Object} [alteracao] O que está prestes a mudar. Aceita:
 *   { usuarioId, ativo, nivelAcessoId } → simula alteração num usuário;
 *   { nivelId, ativo, permissoes }      → simula alteração num nível.
 * @returns {number} Quantidade de administradores ativos após a mudança.
 */
function contarAdministradoresAtivos_(alteracao) {
  const mudanca = alteracao || {};
  const dados = lerCargosENiveis_();

  // Estado dos níveis, já aplicando a alteração simulada.
  const niveis = listarNiveisAcesso_(dados).map(function(nivel) {
    if (mudanca.nivelId && nivel.id.toUpperCase() === String(mudanca.nivelId).toUpperCase()) {
      return {
        id: nivel.id,
        ativo: mudanca.ativo === undefined ? nivel.ativo : isTrue_(mudanca.ativo),
        permissoes: mudanca.permissoes === undefined ? nivel.permissoes : mudanca.permissoes
      };
    }
    return nivel;
  });
  const niveisAdministrativos = {};
  niveis.forEach(function(nivel) {
    if (nivelEhAdministrativo_(nivel)) niveisAdministrativos[nivel.id.toUpperCase()] = true;
  });

  // Estado dos usuários, já aplicando a alteração simulada.
  return pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).filter(function(usuario) {
    let ativo = isTrue_(usuario.Ativo);
    let nivelId = String(usuario.NivelAcessoId || '').trim().toUpperCase();

    if (mudanca.usuarioId &&
        String(usuario.Id || '').trim().toUpperCase() === String(mudanca.usuarioId).toUpperCase()) {
      if (mudanca.ativo !== undefined) ativo = isTrue_(mudanca.ativo);
      if (mudanca.nivelAcessoId !== undefined) {
        nivelId = String(mudanca.nivelAcessoId || '').trim().toUpperCase();
      }
    }
    return ativo && !!niveisAdministrativos[nivelId];
  }).length;
}

/**
 * Impede que uma alteração deixe o sistema sem nenhum administrador ativo.
 *
 * Deve ser chamada ANTES de gravar qualquer mudança que possa remover o
 * último administrador: desativar usuário, trocar o nível de um usuário,
 * desativar um nível administrativo ou tirar a permissão que o define.
 *
 * @param {Object} alteracao Mesma forma aceita por contarAdministradoresAtivos_.
 * @throws {Error} Quando a mudança deixaria o PGO sem administrador.
 */
function garantirAdministradorRestante_(alteracao) {
  if (contarAdministradoresAtivos_(alteracao) === 0) {
    throw new Error('É necessário manter pelo menos um administrador ativo.');
  }
}

// ============================================================================
// RESUMO PARA O FRONT
// ============================================================================

/**
 * Monta o resumo de acesso que vai no bootstrap: cargo, nível e permissões
 * efetivas do usuário autenticado.
 *
 * ⚠️ Isto serve para a INTERFACE decidir o que mostrar. Não é controle de
 * acesso: quem protege de verdade é exigirPermissao_() no servidor.
 *
 * Numa instalação 4.x devolve um resumo vazio, e as telas antigas seguem
 * usando as regras de perfil de sempre.
 *
 * ⚠️ "SEM PERMISSÃO" E "NÃO CONSEGUI RESOLVER" SÃO COISAS DIFERENTES
 * Os dois casos produziam a mesma resposta: uma lista de permissões vazia.
 * Numa base PGO 5.0 o front usa essa lista para decidir o que mostrar, então
 * uma falha ao montar o resumo apagava o menu inteiro — sem erro, sem aviso,
 * sem nada no que o suporte pudesse se apoiar. A pessoa via um sistema vazio
 * e concluía que "perdeu o acesso".
 *
 * Agora a falha é declarada em `indisponivel`, com um motivo técnico. O
 * comportamento continua FECHADO (nenhuma permissão é concedida), mas passa a
 * ser diagnosticável. O motivo não carrega e-mail, nome nem conteúdo de
 * registro — só a natureza do problema, porque este texto chega ao navegador.
 *
 * @returns {Object} { schema, cargo, nivelAcesso, permissoes, escopos,
 *   indisponivel?, motivo? }.
 */
function montarResumoDeAcessoPGO5_() {
  const vazio = { schema: 'LEGADO', cargo: '', nivelAcesso: '', permissoes: [], escopos: {} };
  if (typeof estruturaEhPGO5_ !== 'function' || !estruturaEhPGO5_()) return vazio;

  // Falha numa base que É PGO 5.0: o front precisa saber que a lista vazia
  // não significa "esta pessoa não pode nada".
  const indisponivel = function(motivo) {
    Logger.log('[PGO5] Resumo de acesso indisponível: ' + motivo);
    return {
      schema: 'PGO5', cargo: '', nivelAcesso: '', permissoes: [], escopos: {},
      indisponivel: true, motivo: motivo
    };
  };

  try {
    const ator = getActor_();
    const usuario = atorComoUsuario_(ator);
    // Autenticou (logo existe na aba Usuários e está ativo), mas o registro
    // não foi reencontrado pelo Id — a aba mudou embaixo da sessão. Não é
    // "sem permissão": é inconsistência de cadastro.
    if (!usuario) return indisponivel('USUARIO_NAO_RESOLVIDO: registro não encontrado pelo Id da sessão.');

    const dados = lerCargosENiveis_();
    const nivel = resolverNivelAcessoUsuario_(usuario, dados);
    const cargo = listarCargos_(dados).find(function(c) {
      return c.id.toUpperCase() === String(usuario.CargoId || '').trim().toUpperCase();
    });

    return {
      schema: 'PGO5',
      cargo: cargo ? cargo.nome : '',
      nivelAcesso: nivel ? nivel.nome : '',
      permissoes: nivel ? nivel.permissoes : [],
      escopos: {
        ver: obterEscopoAtendimentos_(usuario, 'ver'),
        editar: obterEscopoAtendimentos_(usuario, 'editar'),
        excluir: obterEscopoAtendimentos_(usuario, 'excluir'),
        delegar: obterEscopoDelegacao_(usuario)
      }
    };
  } catch (e) {
    // Falhar aqui não pode derrubar o bootstrap inteiro — o sistema abre e a
    // pessoa consegue ler a explicação. Só a primeira linha da mensagem, e
    // curta: mensagens de erro do Sheets às vezes ecoam conteúdo de célula, e
    // isto vai para o navegador.
    const primeiraLinha = String((e && e.message) || e || 'erro desconhecido').split('\n')[0];
    return indisponivel('FALHA_AO_RESOLVER: ' + primeiraLinha.slice(0, 120));
  }
}

// ============================================================================
// ADMINISTRAÇÃO DE CARGOS E NÍVEIS (chamada pelo front)
// ============================================================================

/**
 * (Permissão: gerenciarCargos ou gerenciarNiveis)
 * Devolve tudo o que a tela de Cargos e Níveis precisa numa única chamada.
 *
 * @returns {Object} { cargos, niveis, catalogoPermissoes }.
 */
function getCargosENiveisPGO5() {
  const ator = requireAuth_();
  const usuario = atorComoUsuario_(ator);
  if (!usuarioTemPermissao_(usuario, 'gerenciarCargos') &&
      !usuarioTemPermissao_(usuario, 'gerenciarNiveis')) {
    throw new Error('Você não tem permissão para executar esta ação.');
  }

  const dados = lerCargosENiveis_();
  return {
    cargos: listarCargos_(dados),
    niveis: listarNiveisAcesso_(dados),
    catalogoPermissoes: PGO5_PERMISSOES,
    podeGerenciarCargos: usuarioTemPermissao_(usuario, 'gerenciarCargos'),
    podeGerenciarNiveis: usuarioTemPermissao_(usuario, 'gerenciarNiveis'),
    podeAlterarPermissoes: usuarioTemPermissao_(usuario, 'alterarPermissoes')
  };
}

/**
 * (Permissão: gerenciarCargos)
 * Cria ou edita um cargo.
 *
 * Cargo é só rótulo organizacional: nada aqui muda o acesso de ninguém.
 *
 * @param {Object} dados { nome, ordem, ativo }.
 * @param {string} [id] Id para editar; ausente cria um novo.
 * @returns {Object} { success, id }.
 */
/**
 * Recusa dois cargos (ou dois níveis) com o mesmo nome.
 *
 * POR QUE ISTO IMPORTA
 * As telas mostram o NOME: a lista de usuários exibe "Nível: Gestão" e o
 * seletor do formulário lista nomes. Dois registros chamados igual ficam
 * indistinguíveis para quem opera, e a pessoa pode conceder o nível errado
 * sem perceber. A identidade técnica continua sendo o Id.
 *
 * A comparação ignora acentos e maiúsculas (normalizeText_), então
 * "Gestão" e "gestao" contam como o mesmo nome.
 *
 * @param {string} tipo PGO5_TIPOS_CONFIG.CARGO ou .NIVEL_ACESSO.
 * @param {string} nome Nome pretendido.
 * @param {string} [idAtual] Id do registro em edição (ignora ele mesmo).
 * @throws {Error} Quando já existe outro registro do mesmo tipo com o nome.
 */
function garantirNomeDeAcessoUnico_(tipo, nome, idAtual) {
  const alvo = normalizeText_(nome);
  const meuId = String(idAtual || '').trim().toUpperCase();
  const existentes = (tipo === PGO5_TIPOS_CONFIG.CARGO)
    ? listarCargos_(null, false)
    : listarNiveisAcesso_(null, false);

  const repetido = existentes.some(function(item) {
    if (String(item.id || '').toUpperCase() === meuId) return false;
    return normalizeText_(item.nome) === alvo;
  });
  if (repetido) {
    throw new Error(tipo === PGO5_TIPOS_CONFIG.CARGO
      ? 'Já existe um cargo com este nome.'
      : 'Já existe um nível de acesso com este nome.');
  }
}

function salvarCargoPGO5(dados, id) {
  exigirPermissao_('gerenciarCargos');

  const entrada = dados || {};
  const nome = sanitizeInput(entrada.nome);
  if (!nome) throw new Error('Informe o nome do cargo.');
  garantirNomeDeAcessoUnico_(PGO5_TIPOS_CONFIG.CARGO, nome, id);

  const linha = {
    Tipo: PGO5_TIPOS_CONFIG.CARGO,
    Nome: nome,
    Valor: Number(entrada.ordem) || 0,
    Ativo: entrada.ativo === undefined ? true : isTrue_(entrada.ativo),
    Data: toIso_(new Date())
  };

  const registroId = String(id || '').trim();
  if (registroId) {
    const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.CONFIGURACOES, registroId);
    if (!atual || String(atual.Tipo).toUpperCase() !== PGO5_TIPOS_CONFIG.CARGO) {
      throw new Error('Cargo não encontrado.');
    }
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.CONFIGURACOES, registroId, linha);
    registrarAuditoria_(
      linha.Ativo ? PGO5_ACOES_AUDITORIA.EDIT : PGO5_ACOES_AUDITORIA.DEACTIVATE,
      PGO5_ENTIDADES_AUDITORIA.CARGO, registroId, 'Cargo atualizado.',
      { nome: nome, ativo: linha.Ativo });
    return { success: true, id: registroId };
  }

  // A Chave é a identidade estável do registro; só é definida na criação.
  linha.Chave = normalizeText_(nome).toUpperCase().replace(/\s+/g, '_');
  if (!linha.Valor) linha.Valor = listarCargos_().length + 1;
  const novo = pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, linha);
  registrarAuditoria_(PGO5_ACOES_AUDITORIA.CREATE, PGO5_ENTIDADES_AUDITORIA.CARGO,
    String(novo.Id || ''), 'Cargo criado.', { nome: nome });
  return { success: true, id: String(novo.Id || '') };
}

/**
 * (Permissão: gerenciarNiveis; alterarPermissoes para mexer na lista)
 * Cria ou edita um nível de acesso.
 *
 * PROTEÇÃO: se a alteração for capaz de remover o último administrador
 * (desativando o nível ou tirando a permissão que o torna administrativo),
 * a gravação é recusada.
 *
 * @param {Object} dados { nome, ordem, ativo, permissoes }.
 * @param {string} [id] Id para editar; ausente cria um novo.
 * @returns {Object} { success, id }.
 */
function salvarNivelAcessoPGO5(dados, id) {
  const ator = exigirPermissao_('gerenciarNiveis');
  const entrada = dados || {};
  const registroId = String(id || '').trim();

  const nome = sanitizeInput(entrada.nome);
  if (!nome) throw new Error('Informe o nome do nível de acesso.');
  garantirNomeDeAcessoUnico_(PGO5_TIPOS_CONFIG.NIVEL_ACESSO, nome, registroId);

  // Só quem tem alterarPermissoes muda a lista de permissões. Sem essa
  // permissão, um nível existente mantém exatamente a lista que já tinha.
  const podeAlterarPermissoes = usuarioTemPermissao_(atorComoUsuario_(ator), 'alterarPermissoes');
  let permissoes = null;
  if (entrada.permissoes !== undefined) {
    if (!podeAlterarPermissoes) {
      throw new Error('Você não tem permissão para alterar as permissões de um nível.');
    }
    permissoes = (entrada.permissoes || [])
      .map(function(p) { return String(p || '').trim(); })
      .filter(function(p) { return permissaoExiste_(p); });
  }

  const ativo = entrada.ativo === undefined ? true : isTrue_(entrada.ativo);

  // Guardado antes da gravação: a auditoria precisa saber o que havia antes.
  let atualParaAuditoria = null;
  if (registroId) {
    const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.CONFIGURACOES, registroId);
    if (!atual || String(atual.Tipo).toUpperCase() !== PGO5_TIPOS_CONFIG.NIVEL_ACESSO) {
      throw new Error('Nível de acesso não encontrado.');
    }
    atualParaAuditoria = atual;
    garantirAdministradorRestante_({
      nivelId: registroId,
      ativo: ativo,
      permissoes: permissoes === null ? undefined : permissoes
    });
  }

  const linha = {
    Tipo: PGO5_TIPOS_CONFIG.NIVEL_ACESSO,
    Nome: nome,
    Valor: Number(entrada.ordem) || 0,
    Ativo: ativo,
    Data: toIso_(new Date())
  };
  if (permissoes !== null) {
    linha.Configuracao = JSON.stringify({ permissoes: permissoes });
  }

  if (registroId) {
    const permissoesAntes = lerPermissoesDoRegistro_(atualParaAuditoria);
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.CONFIGURACOES, registroId, linha);
    auditarAlteracaoDeNivel_(ator, registroId, nome, ativo, permissoes, permissoesAntes);
    return { success: true, id: registroId };
  }

  linha.Chave = normalizeText_(nome).toUpperCase().replace(/\s+/g, '_');
  if (!linha.Valor) linha.Valor = listarNiveisAcesso_().length + 1;
  if (permissoes === null) linha.Configuracao = JSON.stringify({ permissoes: [] });
  const novo = pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, linha);
  auditarAlteracaoDeNivel_(ator, String(novo.Id || ''), nome, ativo, permissoes || [], null);
  return { success: true, id: String(novo.Id || '') };
}

/**
 * Registra na auditoria o que aconteceu com um nível de acesso.
 *
 * Guarda a QUANTIDADE de permissões e quais entraram ou saíram — nunca o
 * JSON inteiro, que cresceria demais na planilha. Alterar permissões é
 * registrado com ação própria (ALTER_PERMISSION) porque é a mudança que
 * afeta todos os usuários daquele nível de uma vez.
 *
 * @param {Object} ator Quem executou.
 * @param {string} nivelId Id do nível afetado.
 * @param {string} nome Nome do nível.
 * @param {boolean} ativo Situação resultante.
 * @param {string[]|null} permissoesDepois Permissões novas, ou null se não mudaram.
 * @param {string[]|null} permissoesAntes Permissões anteriores, ou null na criação.
 * @returns {void}
 */
function auditarAlteracaoDeNivel_(ator, nivelId, nome, ativo, permissoesDepois, permissoesAntes) {
  const ehCriacao = permissoesAntes === null;
  registrarAuditoria_(
    ehCriacao ? PGO5_ACOES_AUDITORIA.CREATE
      : (ativo ? PGO5_ACOES_AUDITORIA.EDIT : PGO5_ACOES_AUDITORIA.DEACTIVATE),
    PGO5_ENTIDADES_AUDITORIA.NIVEL_ACESSO, nivelId,
    ehCriacao ? 'Nível de acesso criado.' : 'Nível de acesso atualizado.',
    { nome: nome, ativo: ativo }, String(ator.id));

  if (permissoesDepois === null || permissoesDepois === undefined) return;

  const antes = permissoesAntes || [];
  const depois = permissoesDepois;
  const incluidas = depois.filter(function(p) { return antes.indexOf(p) === -1; });
  const removidas = antes.filter(function(p) { return depois.indexOf(p) === -1; });
  if (!ehCriacao && incluidas.length === 0 && removidas.length === 0) return;

  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_PERMISSION,
    PGO5_ENTIDADES_AUDITORIA.NIVEL_ACESSO, nivelId,
    'Permissões do nível "' + nome + '" alteradas.',
    { total: depois.length, incluidas: incluidas, removidas: removidas },
    String(ator.id));
}
