/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Auditoria.gs
 *
 * RESPONSABILIDADE
 * Guardar o registro das ações ADMINISTRATIVAS: quem fez, o que fez, em qual
 * registro e quando. Serve para responder "por que este usuário virou
 * administrador?" ou "quem desbloqueou o PIN de fulano?".
 *
 * ONDE FICA
 * Na aba Configurações, com Tipo = 'AUDITORIA'. Não existe aba nova — o
 * schema de 5 abas do PGO 5.0 continua igual.
 *
 *   Chave        → a ação (CREATE, GRANT_ADMIN, PIN_LOCK…)
 *   Nome         → a entidade afetada (USUARIO, NIVEL_ACESSO, SEGURANCA…)
 *   ReferenciaId → o Id do registro afetado
 *   Valor        → resumo curto e legível
 *   Configuracao → JSON com detalhes seguros (o que mudou, sem o conteúdo)
 *   UsuarioId    → quem executou
 *   Data         → quando
 *
 * ⚠️ O QUE NUNCA PODE ENTRAR AQUI
 * CPF, nome de cliente, protocolo, PIN, hash do PIN, salt, URL protegida,
 * token, senha ou o payload inteiro de um usuário/atendimento. A auditoria
 * registra IDs técnicos e o mínimo administrativo — ver limparDadoSensivel_.
 *
 * ⚠️ NÃO É LOG DE LEITURA
 * Abrir o Dashboard, consultar um relatório ou visualizar um atendimento NÃO
 * geram registro. Se gerassem, a planilha viraria um log infinito e o custo
 * de escrita apareceria em toda navegação.
 * ============================================================================
 */

/**
 * Ações administrativas que a auditoria reconhece.
 *
 * Usar sempre a constante, nunca a string solta: assim um erro de digitação
 * aparece como erro de execução e não como um registro perdido na planilha.
 */
const PGO5_ACOES_AUDITORIA = {
  CREATE: 'CREATE',                             // criou um registro administrativo
  EDIT: 'EDIT',                                 // editou um registro administrativo
  ACTIVATE: 'ACTIVATE',                         // reativou
  DEACTIVATE: 'DEACTIVATE',                     // desativou
  DELETE: 'DELETE',                             // excluiu de vez
  ALTER_PERMISSION: 'ALTER_PERMISSION',         // mudou as permissões de um nível
  GRANT_ADMIN: 'GRANT_ADMIN',                   // deu poder administrativo a alguém
  ALTER_SECURITY: 'ALTER_SECURITY',             // definiu ou alterou o PIN
  PIN_LOCK: 'PIN_LOCK',                         // bloqueio por excesso de tentativas
  ADMIN_UNLOCK: 'ADMIN_UNLOCK',                 // um administrador desbloqueou outro
  SOLE_ADMIN_RECOVERY: 'SOLE_ADMIN_RECOVERY'    // recuperação do administrador único
};

/** Entidades que aparecem na coluna Nome do registro de auditoria. */
const PGO5_ENTIDADES_AUDITORIA = {
  USUARIO: 'USUARIO',
  CARGO: 'CARGO',
  NIVEL_ACESSO: 'NIVEL_ACESSO',
  SEGURANCA: 'SEGURANCA',
  CATALOGO: 'CATALOGO'
};

/**
 * Chaves que jamais podem ser gravadas na auditoria.
 *
 * A lista existe como rede de segurança: mesmo que alguém, no futuro, passe
 * um objeto inteiro para registrarAuditoria_, estes campos são removidos
 * antes da gravação. É mais seguro do que confiar em cada chamador lembrar.
 */
const PGO5_CAMPOS_PROIBIDOS_AUDITORIA = [
  'cpf', 'cliente', 'protocolo', 'pin', 'novopin', 'pinatual', 'hash',
  'pinhash', 'salt', 'url', 'planilhaurl', 'link', 'token', 'senha',
  'password', 'secret', 'observacoes', 'email', 'valores'
];

/**
 * Remove de um objeto qualquer campo que possa conter dado pessoal ou
 * segredo, e encurta textos longos.
 *
 * A comparação ignora maiúsculas e acentos para pegar variações como
 * "CPF", "Cpf" e "cpf".
 *
 * @param {Object} detalhes Objeto livre montado por quem registra a ação.
 * @returns {Object} Cópia segura, pronta para virar JSON na planilha.
 */
function limparDadoSensivel_(detalhes) {
  const seguro = {};
  if (!detalhes || typeof detalhes !== 'object') return seguro;

  Object.keys(detalhes).forEach(function(chave) {
    const normalizada = String(chave).toLowerCase();
    const proibida = PGO5_CAMPOS_PROIBIDOS_AUDITORIA.some(function(termo) {
      return normalizada.indexOf(termo) !== -1;
    });
    if (proibida) return;

    const valor = detalhes[chave];
    if (valor === null || valor === undefined) return;

    if (Array.isArray(valor)) {
      // Listas de permissões são úteis e não contêm dado pessoal. Guarda só
      // a quantidade quando a lista é grande, para o registro não estourar.
      seguro[chave] = valor.length > 40 ? { quantidade: valor.length } : valor;
      return;
    }
    if (typeof valor === 'object') return;   // objetos aninhados ficam de fora

    const texto = String(valor);
    seguro[chave] = texto.length > 120 ? texto.slice(0, 120) + '…' : texto;
  });

  return seguro;
}

/**
 * Grava uma ação administrativa na auditoria.
 *
 * NUNCA interrompe a operação principal: se a gravação da auditoria falhar
 * (planilha travada, cota atingida), a ação do usuário já aconteceu e não
 * pode ser desfeita por causa do registro. O erro vai para o Logger.
 *
 * @param {string} acao Uma das chaves de PGO5_ACOES_AUDITORIA.
 * @param {string} entidade Uma das chaves de PGO5_ENTIDADES_AUDITORIA.
 * @param {string} referenciaId Id do registro afetado ('' quando não houver).
 * @param {string} resumo Frase curta e legível do que aconteceu.
 * @param {Object} [detalhes] Campos extras; passam por limparDadoSensivel_.
 * @param {string} [executorId] Id de quem executou. Sem isso, usa o ator atual.
 * @returns {void}
 */
function registrarAuditoria_(acao, entidade, referenciaId, resumo, detalhes, executorId) {
  try {
    if (!estruturaEhPGO5_()) return;    // o banco 4.x não tem esta aba

    let autor = String(executorId || '');
    if (!autor) {
      try { autor = String(getActor_().id || ''); } catch (e) { autor = ''; }
    }

    pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, {
      Tipo: 'AUDITORIA',
      Chave: String(acao || ''),
      Nome: String(entidade || ''),
      ReferenciaId: String(referenciaId || ''),
      Valor: String(resumo || '').slice(0, 200),
      Configuracao: JSON.stringify(limparDadoSensivel_(detalhes)),
      Ativo: true,
      UsuarioId: autor,
      Data: toIso_(new Date())
    });
  } catch (erro) {
    Logger.log('AUDITORIA: falha ao registrar ' + acao + ' — ' + erro.message);
  }
}

/**
 * Lê os registros de auditoria, do mais recente para o mais antigo.
 *
 * @param {number} [limite] Quantidade máxima a devolver (padrão 200).
 * @returns {Object[]} Registros já formatados para a tela.
 */
function lerAuditoria_(limite) {
  const maximo = Math.max(1, Number(limite) || 200);
  const linhas = pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES)
    .filter(function(linha) { return String(linha.Tipo).toUpperCase() === 'AUDITORIA'; });

  const nomePorId = {};
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(usuario) {
    nomePorId[String(usuario.Id || '').toUpperCase()] = String(usuario.Nome || '');
  });

  return linhas
    .map(function(linha) {
      let detalhes = {};
      try { detalhes = JSON.parse(linha.Configuracao || '{}'); } catch (e) { detalhes = {}; }
      const autorId = String(linha.UsuarioId || '');
      return {
        id: String(linha.Id || ''),
        acao: String(linha.Chave || ''),
        entidade: String(linha.Nome || ''),
        referenciaId: String(linha.ReferenciaId || ''),
        resumo: String(linha.Valor || ''),
        detalhes: detalhes,
        executorId: autorId,
        executor: nomePorId[autorId.toUpperCase()] || 'Sem dados',
        data: linha.Data || ''
      };
    })
    .sort(function(a, b) { return String(b.data).localeCompare(String(a.data)); })
    .slice(0, maximo);
}

// ============================================================================
// FUNÇÃO PÚBLICA (chamada pela interface)
// ============================================================================

/**
 * Devolve a auditoria para a tela de Segurança.
 *
 * Exige permissão administrativa de segurança — a auditoria mostra quem
 * mexeu em permissões, e essa informação não é para qualquer usuário.
 *
 * @param {number} [limite] Quantidade máxima de registros.
 * @returns {Object} { registros: Object[] }.
 * @throws {Error} Quando o usuário não tem a permissão exigida.
 */
function listarAuditoriaPGO5(limite) {
  exigirPermissao_('alterarPermissoes');
  return { registros: lerAuditoria_(limite) };
}
