/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Usuarios.gs
 * ============================================================================
 *
 * RESPONSABILIDADE
 * Cadastro de pessoas e a HIERARQUIA entre elas.
 *
 * ⚠️ EQUIPE ≠ HIERARQUIA — a diferença mais importante deste arquivo
 *
 *   Equipe       → texto livre, apenas organizacional ("Digital", "Voz").
 *                  NUNCA concede acesso a nada.
 *   SupervisorId → a hierarquia de verdade. É o que define quem está
 *                  "abaixo" de quem e, portanto, o que um gestor enxerga.
 *
 * Duas pessoas podem estar na mesma Equipe sem nenhuma relação de
 * hierarquia. Quem decide escopo é sempre o SupervisorId.
 *
 * A hierarquia é uma ÁRVORE e pode ter vários andares:
 *
 *   Coordenador → Supervisor → Analista
 *
 * Quem tem "verEquipe" enxerga toda a árvore abaixo de si, não só o
 * primeiro nível.
 *
 * RELAÇÃO COM OS OUTROS MÓDULOS
 *   Pgo5Permissoes.gs   → decide o que a pessoa pode fazer (nível de acesso)
 *   Pgo5Atendimentos.gs → usa a hierarquia daqui para filtrar atendimentos
 * ============================================================================
 */

// ============================================================================
// LEITURA
// ============================================================================

/**
 * Lê a aba Usuários uma vez e devolve um mapa Id → registro.
 *
 * Existe para evitar percorrer a lista inteira a cada consulta de
 * hierarquia, que é feita várias vezes por requisição.
 *
 * @returns {Object} { '00000001': { Id, Nome, ... }, ... }.
 */
function obterMapaUsuarios_() {
  const mapa = {};
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(usuario) {
    const id = String(usuario.Id || '').trim().toUpperCase();
    if (id) mapa[id] = usuario;
  });
  return mapa;
}

/**
 * Busca um usuário pelo Id.
 * @param {string} usuarioId Id hexadecimal.
 * @param {Object} [mapa] Resultado de obterMapaUsuarios_ (evita reler).
 * @returns {Object|null} Registro do usuário, ou null.
 */
function obterUsuarioPorId_(usuarioId, mapa) {
  const chave = String(usuarioId || '').trim().toUpperCase();
  if (!chave) return null;
  return (mapa || obterMapaUsuarios_())[chave] || null;
}

// ============================================================================
// HIERARQUIA
// ============================================================================

/**
 * Quem responde DIRETAMENTE a um usuário (apenas um andar abaixo).
 *
 * @param {string} supervisorId Id de quem supervisiona.
 * @param {Object} [mapa] Resultado de obterMapaUsuarios_.
 * @returns {Object[]} Registros dos subordinados diretos.
 */
function obterSubordinadosDiretos_(supervisorId, mapa) {
  const alvo = String(supervisorId || '').trim().toUpperCase();
  if (!alvo) return [];
  const usuarios = mapa || obterMapaUsuarios_();

  return Object.keys(usuarios).map(function(id) { return usuarios[id]; })
    .filter(function(usuario) {
      return String(usuario.SupervisorId || '').trim().toUpperCase() === alvo;
    });
}

/**
 * TODA a árvore abaixo de um usuário — subordinados diretos, os
 * subordinados deles, e assim por diante.
 *
 * COMO FUNCIONA (para quem for dar manutenção):
 * A busca é em largura. Começamos com o usuário informado, pegamos quem
 * responde a ele, colocamos essas pessoas numa fila e repetimos até a fila
 * acabar. A lista "jaVisitados" garante que ninguém seja processado duas
 * vezes — é o que impede laço infinito caso a planilha tenha sido editada à
 * mão e contenha um ciclo (A supervisiona B, que supervisiona A).
 *
 * O próprio usuário NÃO entra no resultado.
 *
 * @param {string} usuarioId Id do topo da árvore.
 * @param {Object} [mapa] Resultado de obterMapaUsuarios_.
 * @returns {string[]} Ids de todos os subordinados, em qualquer profundidade.
 */
function obterSubordinadosDaHierarquia_(usuarioId, mapa) {
  const usuarios = mapa || obterMapaUsuarios_();
  const raiz = String(usuarioId || '').trim().toUpperCase();
  if (!raiz) return [];

  const jaVisitados = {};
  jaVisitados[raiz] = true;

  const encontrados = [];
  let fila = [raiz];

  while (fila.length > 0) {
    const atual = fila.shift();
    obterSubordinadosDiretos_(atual, usuarios).forEach(function(subordinado) {
      const id = String(subordinado.Id || '').trim().toUpperCase();
      if (!id || jaVisitados[id]) return;   // já passamos por aqui: ignora
      jaVisitados[id] = true;
      encontrados.push(id);
      fila.push(id);
    });
  }
  return encontrados;
}

/**
 * Diz se um usuário está na árvore subordinada a outro.
 *
 * Usado para responder perguntas como "este gestor pode mexer neste
 * atendimento?" — a resposta é sim quando o responsável está abaixo dele.
 *
 * @param {string} supervisorId Id de quem está acima.
 * @param {string} usuarioId Id de quem se quer verificar.
 * @param {Object} [mapa] Resultado de obterMapaUsuarios_.
 * @returns {boolean} true quando usuarioId está abaixo de supervisorId.
 */
function usuarioEstaNaHierarquia_(supervisorId, usuarioId, mapa) {
  const alvo = String(usuarioId || '').trim().toUpperCase();
  if (!alvo) return false;
  return obterSubordinadosDaHierarquia_(supervisorId, mapa).indexOf(alvo) !== -1;
}

/**
 * Impede que a hierarquia vire um círculo.
 *
 * Um ciclo (A → B → A) travaria qualquer percurso da árvore e não faz
 * sentido no mundo real: ninguém é chefe do próprio chefe.
 *
 * COMO A VERIFICAÇÃO FUNCIONA:
 * Subimos a partir do supervisor escolhido, seguindo o SupervisorId de cada
 * um, como quem sobe uma escada. Se em algum degrau encontrarmos o próprio
 * usuário, então colocá-lo abaixo desse supervisor fecharia um círculo.
 *
 * Também bloqueia o caso mais simples: alguém ser supervisor de si mesmo.
 *
 * @param {string} usuarioId Id de quem está sendo editado.
 * @param {string} novoSupervisorId Id do supervisor pretendido.
 * @param {Object} [mapa] Resultado de obterMapaUsuarios_.
 * @throws {Error} Quando a escolha criaria um ciclo.
 */
function validarCicloHierarquia_(usuarioId, novoSupervisorId, mapa) {
  const eu = String(usuarioId || '').trim().toUpperCase();
  const supervisor = String(novoSupervisorId || '').trim().toUpperCase();
  if (!supervisor) return;                       // sem supervisor: nada a checar

  if (eu && supervisor === eu) {
    throw new Error('Um usuário não pode ser supervisor de si mesmo.');
  }

  const usuarios = mapa || obterMapaUsuarios_();
  const jaVisitados = {};
  let atual = supervisor;

  while (atual) {
    if (jaVisitados[atual]) break;               // ciclo pré-existente na planilha
    jaVisitados[atual] = true;

    if (eu && atual === eu) {
      throw new Error('Esta escolha criaria um ciclo na hierarquia: ' +
        'o supervisor escolhido já está abaixo deste usuário.');
    }
    const registro = usuarios[atual];
    atual = registro ? String(registro.SupervisorId || '').trim().toUpperCase() : '';
  }
}

// ============================================================================
// ADMINISTRAÇÃO DE USUÁRIOS (chamada pelo front)
// ============================================================================

/**
 * Quais usuários o ator pode administrar.
 *
 *   gerenciarUsuariosTodos → todos
 *   gerenciarEquipe        → apenas a própria árvore subordinada
 *   nenhuma das duas       → nenhum
 *
 * @param {Object} ator Ator autenticado (requireAuth_).
 * @returns {Object} { escopo: 'TODOS'|'EQUIPE'|'NENHUM', ids: string[] }.
 *   Em 'TODOS' a lista de ids vem vazia — não há filtro a aplicar.
 */
function obterEscopoGestaoUsuarios_(ator) {
  const usuario = atorComoUsuario_(ator);
  if (usuarioTemPermissao_(usuario, 'gerenciarUsuariosTodos')) {
    return { escopo: 'TODOS', ids: [] };
  }
  if (usuarioTemPermissao_(usuario, 'gerenciarEquipe')) {
    return { escopo: 'EQUIPE', ids: obterSubordinadosDaHierarquia_(ator.id) };
  }
  return { escopo: 'NENHUM', ids: [] };
}

/**
 * (Permissão: gerenciarEquipe ou gerenciarUsuariosTodos)
 * Lista os usuários que o ator pode administrar, já com Cargo, Nível e
 * Supervisor resolvidos em nomes.
 *
 * Não devolve permissões de cada usuário: a tela mostra o NÍVEL, e é o
 * nível que carrega as permissões.
 *
 * @returns {Object} { usuarios, cargos, niveis, escopo, podeConcederAdministrador }.
 */
function listarUsuariosPGO5() {
  const ator = requireAuth_();
  const escopo = obterEscopoGestaoUsuarios_(ator);
  if (escopo.escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para executar esta ação.');
  }

  const dadosAcesso = lerCargosENiveis_();
  const cargos = listarCargos_(dadosAcesso);
  const niveis = listarNiveisAcesso_(dadosAcesso);
  const mapa = obterMapaUsuarios_();

  const nomePorId = {};
  cargos.concat(niveis).forEach(function(item) { nomePorId[item.id] = item.nome; });

  const permitidos = {};
  escopo.ids.forEach(function(id) { permitidos[id] = true; });

  const usuarios = Object.keys(mapa).map(function(id) { return mapa[id]; })
    .filter(function(usuario) {
      if (escopo.escopo === 'TODOS') return true;
      const id = String(usuario.Id || '').trim().toUpperCase();
      // O gestor também se vê na lista, além da própria árvore.
      return permitidos[id] || id === String(ator.id).toUpperCase();
    })
    .map(function(usuario) {
      const supervisorId = String(usuario.SupervisorId || '').trim();
      const supervisor = supervisorId ? obterUsuarioPorId_(supervisorId, mapa) : null;
      return {
        id: String(usuario.Id || ''),
        matricula: pgo5TextoDeIdentificador_(usuario['Matrícula']),
        nome: String(usuario.Nome || ''),
        email: String(usuario.Email || ''),
        cargoId: String(usuario.CargoId || ''),
        cargo: nomePorId[String(usuario.CargoId || '')] || '-',
        nivelAcessoId: String(usuario.NivelAcessoId || ''),
        nivelAcesso: nomePorId[String(usuario.NivelAcessoId || '')] || 'Sem dados',
        supervisorId: supervisorId,
        supervisor: supervisor ? String(supervisor.Nome || '') : '-',
        equipe: String(usuario.Equipe || ''),
        ativo: isTrue_(usuario.Ativo),
        ultimoAcesso: usuario.UltimoAcesso || ''
      };
    })
    .sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });

  const podeConcederAdministrador =
    usuarioTemPermissao_(atorComoUsuario_(ator), 'concederAdministrador');

  // A tela de Usuários só precisa do id e do nome para montar os seletores.
  // Mandar a lista de permissões de cada nível entregaria o mapa inteiro de
  // acesso do sistema a quem só administra a própria equipe — quem edita
  // permissões usa a tela de Níveis (getCargosENiveisPGO5).
  const paraSeletor = function(item) {
    return { id: item.id, nome: item.nome };
  };

  // Níveis administrativos só aparecem para quem pode concedê-los. Sem isso a
  // tela ofereceria uma opção que salvarUsuarioPGO5 recusaria depois.
  const niveisOferecidos = niveis
    .filter(function(nivel) {
      if (!nivel.ativo) return false;
      return podeConcederAdministrador || !nivelEhAdministrativo_(nivel);
    })
    .map(paraSeletor);

  return {
    usuarios: usuarios,
    cargos: cargos.filter(function(c) { return c.ativo; }).map(paraSeletor),
    niveis: niveisOferecidos,
    escopo: escopo.escopo,
    podeConcederAdministrador: podeConcederAdministrador
  };
}

/**
 * Confere os campos obrigatórios de um usuário e a unicidade do e-mail.
 *
 * O e-mail é a identidade da pessoa no sistema (a conta Google), então dois
 * usuários ATIVOS não podem compartilhar o mesmo.
 *
 * @param {Object} dados Dados vindos do formulário.
 * @param {string} [idAtual] Id do usuário em edição (ignora ele mesmo).
 * @throws {Error} Quando algum dado obrigatório falta ou o e-mail repete.
 */
function validarDadosUsuario_(dados, idAtual) {
  if (!dados.nome) throw new Error('Informe o nome do usuário.');
  if (!dados.email) throw new Error('Informe o e-mail do usuário.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email)) {
    throw new Error('Informe um e-mail válido.');
  }
  if (!dados.nivelAcessoId) throw new Error('Selecione o nível de acesso.');

  const repetido = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).some(function(usuario) {
    return String(usuario.Id || '').trim().toUpperCase() !== String(idAtual || '').toUpperCase() &&
      isTrue_(usuario.Ativo) &&
      normalizeText_(usuario.Email) === normalizeText_(dados.email);
  });
  if (repetido) throw new Error('Já existe um usuário ativo com este e-mail.');
}

/**
 * Confere se o ator pode atribuir o nível de acesso escolhido.
 *
 * Conceder um nível ADMINISTRATIVO exige a permissão específica
 * "concederAdministrador" — não basta poder gerenciar usuários. É o que
 * impede um gestor de se promover a administrador.
 *
 * @param {Object} ator Ator autenticado.
 * @param {string} nivelAcessoId Nível pretendido.
 * @throws {Error} Quando o ator não pode conceder aquele nível.
 */
function validarConcessaoDeNivel_(ator, nivelAcessoId) {
  const nivel = listarNiveisAcesso_().find(function(n) {
    return n.id.toUpperCase() === String(nivelAcessoId || '').trim().toUpperCase();
  });
  if (!nivel) throw new Error('Selecione um nível de acesso válido.');
  if (!nivel.ativo) throw new Error('O nível de acesso escolhido está desativado.');

  // Conceder poder administrativo exige DUAS chaves: a permissão e o PIN.
  // A checagem olha o que o nível PODE FAZER, nunca como ele se chama — o
  // nome é livre e alguém pode criar "Coordenação" com poder total.
  // Ver nivelConcedePoderAdministrativo_ em Pgo5Seguranca.gs.
  if (nivelConcedePoderAdministrativo_(nivel)) {
    if (!usuarioTemPermissao_(atorComoUsuario_(ator), 'concederAdministrador')) {
      throw new Error('Você não tem permissão para conceder acesso de Administrador.');
    }
    if (!sessaoProtegidaEstaValida_(String(ator.id))) {
      if (!existePinDefinido_()) {
        throw new Error('PIN_NAO_DEFINIDO: defina o PIN administrativo em ' +
          'Configurações › Segurança antes de conceder acesso administrativo.');
      }
      throw new Error('PIN_NECESSARIO: informe o PIN administrativo para conceder ' +
        'um nível com poderes administrativos.');
    }
  }
}

/**
 * Confere o supervisor escolhido: precisa existir, estar ativo e não criar
 * ciclo na hierarquia.
 *
 * @param {string} usuarioId Id de quem está sendo salvo ('' na criação).
 * @param {string} supervisorId Supervisor pretendido (pode ser vazio).
 * @throws {Error} Quando o supervisor é inválido ou criaria ciclo.
 */
function validarSupervisorUsuario_(usuarioId, supervisorId) {
  const alvo = String(supervisorId || '').trim();
  if (!alvo) return;                       // sem supervisor é permitido

  const mapa = obterMapaUsuarios_();
  const supervisor = obterUsuarioPorId_(alvo, mapa);
  if (!supervisor) throw new Error('O supervisor escolhido não existe.');
  if (!isTrue_(supervisor.Ativo)) throw new Error('O supervisor escolhido está desativado.');

  validarCicloHierarquia_(usuarioId, alvo, mapa);
}

/**
 * Confere se o ator pode administrar o usuário informado.
 *
 * Com gerenciarUsuariosTodos, pode qualquer um. Com gerenciarEquipe, só
 * quem está na própria árvore subordinada — nunca alguém de fora dela.
 *
 * @param {Object} ator Ator autenticado.
 * @param {string} usuarioId Id do usuário alvo.
 * @throws {Error} Quando o alvo está fora do alcance do ator.
 */
function validarAlcanceDoAtor_(ator, usuarioId) {
  const escopo = obterEscopoGestaoUsuarios_(ator);
  if (escopo.escopo === 'TODOS') return;
  if (escopo.escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para executar esta ação.');
  }
  const alvo = String(usuarioId || '').trim().toUpperCase();
  if (alvo && alvo === String(ator.id).toUpperCase()) return;   // pode editar a si mesmo
  if (escopo.ids.indexOf(alvo) === -1) {
    throw new Error('Você só pode gerenciar usuários da sua equipe.');
  }
}

/**
 * Normaliza a matrícula: TEXTO, com zeros à esquerda preservados.
 *
 * Não é número. "000123" é uma matrícula diferente de "123" para o RH, e
 * converter para número apagaria os zeros silenciosamente. Vazio é
 * permitido — nem todo cadastro tem matrícula no momento em que é criado.
 *
 * @param {*} valor Valor recebido do formulário.
 * @returns {string} Matrícula sanitizada ('' quando não informada).
 * @throws {Error} Quando passa de 50 caracteres.
 */
function pgo5NormalizarMatricula_(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor).trim();
  if (texto === '') return '';
  if (texto.length > 50) {
    throw new Error('A matrícula deve ter no máximo 50 caracteres.');
  }
  return sanitizeInput(texto);
}

/**
 * (Permissão: gerenciarEquipe ou gerenciarUsuariosTodos)
 * Cria ou edita um usuário.
 *
 * A função coordena as validações e só então grava:
 *   validarDadosUsuario_        → campos e e-mail único
 *   validarConcessaoDeNivel_    → pode dar esse nível?
 *   validarSupervisorUsuario_   → supervisor existe e não cria ciclo
 *   garantirAdministradorRestante_ → não deixa o sistema sem admin
 *
 * CriadoPorId e DataCadastro são definidos apenas na criação e nunca mudam.
 *
 * @param {Object} dados { nome, email, cargoId, nivelAcessoId, supervisorId, equipe, ativo }.
 * @param {string} [id] Id para editar; ausente cria um novo.
 * @returns {Object} { success, id }.
 */
function salvarUsuarioPGO5(dados, id) {
  const ator = requireAuth_();
  const escopo = obterEscopoGestaoUsuarios_(ator);
  if (escopo.escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para executar esta ação.');
  }

  const entrada = dados || {};
  const registroId = String(id || '').trim();

  const limpos = {
    matricula: pgo5NormalizarMatricula_(entrada.matricula),
    nome: sanitizeInput(entrada.nome),
    email: sanitizeInput(entrada.email),
    cargoId: String(entrada.cargoId || '').trim(),
    nivelAcessoId: String(entrada.nivelAcessoId || '').trim(),
    supervisorId: String(entrada.supervisorId || '').trim(),
    equipe: sanitizeInput(entrada.equipe || ''),
    ativo: entrada.ativo === undefined ? true : isTrue_(entrada.ativo)
  };

  if (registroId) validarAlcanceDoAtor_(ator, registroId);
  validarDadosUsuario_(limpos, registroId);

  // Registro anterior, para saber o que mudou (auditoria) e para não pedir
  // PIN quando o nível de acesso sequer está sendo alterado.
  const anterior = registroId
    ? pgo5ObterPorId(PGO5.SHEET_NAMES.USUARIOS, registroId)
    : null;
  const nivelAnterior = anterior ? String(anterior.NivelAcessoId || '').trim() : '';
  const nivelMudou = limpos.nivelAcessoId.toUpperCase() !== nivelAnterior.toUpperCase();

  if (nivelMudou) validarConcessaoDeNivel_(ator, limpos.nivelAcessoId);
  else validarNivelContinuaUtilizavel_(limpos.nivelAcessoId);

  validarSupervisorUsuario_(registroId, limpos.supervisorId);

  // Um gestor sem gerenciarUsuariosTodos não pode criar gente solta na
  // organização: o novo usuário nasce dentro da árvore dele.
  if (!registroId && escopo.escopo === 'EQUIPE' && !limpos.supervisorId) {
    limpos.supervisorId = String(ator.id);
  }

  if (registroId) {
    garantirAdministradorRestante_({
      usuarioId: registroId,
      ativo: limpos.ativo,
      nivelAcessoId: limpos.nivelAcessoId
    });
  }

  return withScriptLock_(function() {
    const linha = {
      // ⚠️ A CHAVE É "Matrícula", COM ACENTO — é o nome da coluna na aba.
      // Aqui estava "Matricula": a gravação montava uma chave que não existe
      // no cabeçalho, o CRUD a descartava e a matrícula digitada sumia sem
      // nenhum erro. Tudo o mais salvava normalmente, então o sintoma era
      // "o campo não guarda".
      'Matrícula': limpos.matricula,
      Nome: limpos.nome,
      Email: limpos.email,
      CargoId: limpos.cargoId,
      NivelAcessoId: limpos.nivelAcessoId,
      SupervisorId: limpos.supervisorId,
      Equipe: limpos.equipe,
      Ativo: limpos.ativo,
      DataAtualizacao: toIso_(new Date())
    };

    if (registroId) {
      const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.USUARIOS, registroId);
      if (!atual) throw new Error('Usuário não encontrado.');
      pgo5AtualizarPorId(PGO5.SHEET_NAMES.USUARIOS, registroId, linha);
      auditarSalvamentoDeUsuario_(ator, registroId, nivelMudou, limpos.nivelAcessoId, false);
      return { success: true, id: registroId };
    }

    linha.CriadoPorId = String(ator.id);
    linha.DataCadastro = toIso_(new Date());
    const novo = pgo5Inserir(PGO5.SHEET_NAMES.USUARIOS, linha);
    auditarSalvamentoDeUsuario_(ator, String(novo.Id || ''), true, limpos.nivelAcessoId, true);
    return { success: true, id: String(novo.Id || '') };
  });
}

/**
 * Confere que um nível já atribuído continua existindo e ativo.
 *
 * Usada quando o nível NÃO está mudando: nesse caso não faz sentido pedir
 * PIN nem a permissão de conceder Administrador, mas o registro ainda
 * precisa apontar para um nível utilizável.
 *
 * @param {string} nivelAcessoId Id do nível atualmente atribuído.
 * @returns {void}
 * @throws {Error} Quando o nível não existe ou está desativado.
 */
function validarNivelContinuaUtilizavel_(nivelAcessoId) {
  const nivel = listarNiveisAcesso_().find(function(n) {
    return n.id.toUpperCase() === String(nivelAcessoId || '').trim().toUpperCase();
  });
  if (!nivel) throw new Error('Selecione um nível de acesso válido.');
  if (!nivel.ativo) throw new Error('O nível de acesso escolhido está desativado.');
}

/**
 * Registra na auditoria a criação ou edição de um usuário.
 *
 * Guarda apenas IDs técnicos e o nome do nível — nunca e-mail, CPF ou o
 * payload do formulário (ver limparDadoSensivel_ em Pgo5Auditoria.gs).
 *
 * @param {Object} ator Quem executou.
 * @param {string} usuarioId Id do usuário afetado.
 * @param {boolean} nivelMudou Se o nível de acesso foi alterado.
 * @param {string} nivelAcessoId Nível resultante.
 * @param {boolean} ehCriacao true na criação, false na edição.
 * @returns {void}
 */
function auditarSalvamentoDeUsuario_(ator, usuarioId, nivelMudou, nivelAcessoId, ehCriacao) {
  const nivel = listarNiveisAcesso_().find(function(n) {
    return n.id.toUpperCase() === String(nivelAcessoId || '').toUpperCase();
  });
  const nomeDoNivel = nivel ? nivel.nome : 'Sem dados';

  registrarAuditoria_(
    ehCriacao ? PGO5_ACOES_AUDITORIA.CREATE : PGO5_ACOES_AUDITORIA.EDIT,
    PGO5_ENTIDADES_AUDITORIA.USUARIO, usuarioId,
    ehCriacao ? 'Usuário criado.' : 'Usuário editado.',
    { nivelAcessoId: nivelAcessoId, nivelAcesso: nomeDoNivel, nivelAlterado: nivelMudou },
    String(ator.id));

  // Conceder poder administrativo é a mudança mais sensível do sistema e
  // ganha um registro próprio, fácil de encontrar na auditoria.
  if (nivelMudou && nivel && nivelConcedePoderAdministrativo_(nivel)) {
    registrarAuditoria_(PGO5_ACOES_AUDITORIA.GRANT_ADMIN, PGO5_ENTIDADES_AUDITORIA.USUARIO,
      usuarioId, 'Nível com poderes administrativos concedido.',
      { nivelAcessoId: nivelAcessoId, nivelAcesso: nomeDoNivel }, String(ator.id));
  }
}

/**
 * (Permissão: gerenciarEquipe ou gerenciarUsuariosTodos)
 * Ativa ou desativa um usuário.
 *
 * O PGO não exclui pessoas: desativar preserva o histórico dos atendimentos
 * que elas criaram. Um usuário desativado é bloqueado no servidor na
 * próxima requisição — não apenas escondido na tela.
 *
 * @param {string} id Id do usuário.
 * @param {boolean} ativo Novo estado.
 * @returns {Object} { success, id, ativo }.
 */
function alterarSituacaoUsuarioPGO5(id, ativo) {
  const ator = requireAuth_();
  const registroId = String(id || '').trim();
  validarAlcanceDoAtor_(ator, registroId);

  const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.USUARIOS, registroId);
  if (!atual) throw new Error('Usuário não encontrado.');

  const novoEstado = isTrue_(ativo);
  garantirAdministradorRestante_({ usuarioId: registroId, ativo: novoEstado });

  pgo5AtualizarPorId(PGO5.SHEET_NAMES.USUARIOS, registroId, {
    Ativo: novoEstado,
    DataAtualizacao: toIso_(new Date())
  });

  registrarAuditoria_(
    novoEstado ? PGO5_ACOES_AUDITORIA.ACTIVATE : PGO5_ACOES_AUDITORIA.DEACTIVATE,
    PGO5_ENTIDADES_AUDITORIA.USUARIO, registroId,
    novoEstado ? 'Usuário reativado.' : 'Usuário desativado.',
    {}, String(ator.id));

  return { success: true, id: registroId, ativo: novoEstado };
}
