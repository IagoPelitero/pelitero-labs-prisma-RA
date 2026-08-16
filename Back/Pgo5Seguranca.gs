/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Seguranca.gs
 *
 * RESPONSABILIDADE
 * O PIN administrativo e tudo que gira em torno dele: guardar com segurança,
 * validar, contar tentativas, bloquear, liberar por 5 minutos, desbloquear e
 * recuperar o acesso quando existe um único administrador. Também é aqui que
 * ficam as operações protegidas (links do banco e da fonte de SAC).
 *
 * ⚠️ O PIN NÃO É SENHA DE LOGIN
 * Quem faz o login continua sendo a Conta Google (ver requireAuth_). O PIN é
 * uma SEGUNDA CAMADA, pedida só em ações administrativas sensíveis.
 *
 * A REGRA DAS DUAS CHAVES
 *
 *     PERMISSÃO  +  PIN DESBLOQUEADO  =  AÇÃO
 *
 * Ter a permissão não basta e ter o PIN não basta. As duas coisas juntas é
 * que liberam. Ver exigirPermissaoComPin_.
 *
 * COMO O PIN É GUARDADO
 * Nunca em texto puro, nunca na planilha, nunca no front. O que existe é:
 *
 *     PGO5_PIN_SALT  → texto aleatório criado uma vez nesta instalação
 *     PGO5_PIN_HASH  → SHA-256 de (salt + PIN), em hexadecimal
 *
 * Ambos em Script Properties, que só o código do servidor lê. Para conferir
 * um PIN digitado, o servidor recalcula o hash e compara. Do hash não se
 * volta para o PIN, e o salt impede que dois sistemas com o mesmo PIN tenham
 * o mesmo hash. Não há criptografia própria aqui: SHA-256 vem do Apps Script.
 *
 * ESTADO POR USUÁRIO (também em Script Properties)
 *
 *     PGO5_PIN_ESTADO_<usuarioId>  → {"erros":n,"bloqueadoAte":"ISO"}
 *     PGO5_PIN_SESSAO_<usuarioId>  → data/hora ISO em que a liberação expira
 *
 * Cada usuário tem o seu: errar o PIN três vezes bloqueia APENAS quem errou.
 * Os demais administradores continuam trabalhando normalmente.
 * ============================================================================
 */

/** Quantidade exata de dígitos do PIN. Não é configurável de propósito. */
const PGO5_PIN_DIGITOS = 6;

/** Tentativas erradas seguidas que disparam o bloqueio. */
const PGO5_PIN_MAX_TENTATIVAS = 3;

/** Duração do bloqueio depois de esgotar as tentativas. */
const PGO5_PIN_BLOQUEIO_HORAS = 24;

/** Quanto tempo a liberação vale depois de acertar o PIN. */
const PGO5_PIN_SESSAO_MINUTOS = 5;

/** Prefixos das chaves em Script Properties. */
const PGO5_CHAVE_PIN_HASH = 'PGO5_PIN_HASH';
const PGO5_CHAVE_PIN_SALT = 'PGO5_PIN_SALT';
const PGO5_PREFIXO_ESTADO_PIN = 'PGO5_PIN_ESTADO_';
const PGO5_PREFIXO_SESSAO_PIN = 'PGO5_PIN_SESSAO_';

/**
 * Recursos cujo link só sai do servidor com permissão E PIN.
 *
 * O valor de cada item diz qual permissão o usuário precisa ter além do PIN.
 */
const PGO5_LINKS_PROTEGIDOS = {
  BANCO_PGO: 'visualizarBancoPgo',
  FONTE_SAC: 'visualizarFonteSac'
};

/**
 * Permissões que, sozinhas, já dão poder administrativo sobre o sistema.
 *
 * POR QUE ESTA LISTA EXISTE
 * O §42 exige PIN para conceder um nível "que resulte em poderes de
 * Administrador". Decidir isso pelo NOME do nível seria frágil: o nome é
 * livre e alguém pode criar "Coordenação" com poder total. Então a decisão
 * olha o que o nível PODE FAZER, não como ele se chama.
 *
 * É uma lista mais ampla do que a usada pela proteção do último
 * administrador (nivelEhAdministrativo_, em Pgo5Permissoes.gs), e de
 * propósito: para EXIGIR PIN vale pecar por excesso; para contar quem é o
 * último administrador do sistema vale o critério estrito de quem consegue
 * restaurar tudo (alterarPermissoes).
 */
const PGO5_PERMISSOES_DE_PODER = [
  'alterarPermissoes',
  'concederAdministrador',
  'gerenciarNiveis',
  'gerenciarCargos',
  'gerenciarUsuariosTodos',
  'configurarSistema',
  'visualizarBancoPgo',
  'visualizarFonteSac'
];

// ============================================================================
// ARMAZENAMENTO DO PIN
// ============================================================================

/**
 * Atalho para o repositório de propriedades do script.
 * @returns {Object} Script Properties.
 */
function propriedadesDoScript_() {
  return PropertiesService.getScriptProperties();
}

/**
 * Gera o salt desta instalação, se ainda não existir.
 *
 * O salt é criado UMA vez e nunca muda: se mudasse, o hash guardado deixaria
 * de conferir e o PIN atual pararia de funcionar sem ninguém entender por quê.
 *
 * @returns {string} Salt em uso.
 */
function obterOuCriarSaltDoPin_() {
  const props = propriedadesDoScript_();
  let salt = props.getProperty(PGO5_CHAVE_PIN_SALT);
  if (salt) return salt;

  // Dois UUIDs sem hífen dão material aleatório suficiente e usam só a API
  // padrão do Apps Script.
  salt = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty(PGO5_CHAVE_PIN_SALT, salt);
  return salt;
}

/**
 * Calcula o hash de um PIN com o salt da instalação.
 *
 * @param {string} pin PIN em texto puro (só existe dentro desta execução).
 * @returns {string} Hash SHA-256 em hexadecimal minúsculo.
 */
function calcularHashDoPin_(pin) {
  const salt = obterOuCriarSaltDoPin_();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + String(pin), Utilities.Charset.UTF_8);

  return bytes.map(function(b) {
    // computeDigest devolve bytes com sinal (-128..127); a conversão para
    // 0..255 é o que produz o hexadecimal correto.
    const semSinal = (b < 0 ? b + 256 : b).toString(16);
    return semSinal.length === 1 ? '0' + semSinal : semSinal;
  }).join('');
}

/**
 * Diz se a instalação já tem PIN definido.
 * @returns {boolean} true quando existe hash guardado.
 */
function existePinDefinido_() {
  return !!propriedadesDoScript_().getProperty(PGO5_CHAVE_PIN_HASH);
}

/**
 * Confere o formato do PIN antes de qualquer outra coisa.
 *
 * Exige exatamente 6 dígitos: nem 5, nem 7, nem letras. Um PIN mais curto
 * seria fácil demais de adivinhar e um mais longo confundiria a interface.
 *
 * @param {string} pin Valor digitado.
 * @returns {string} O PIN normalizado como texto.
 * @throws {Error} Quando o formato não bate.
 */
function validarFormatoDoPin_(pin) {
  const texto = String(pin === undefined || pin === null ? '' : pin).trim();
  if (!new RegExp('^[0-9]{' + PGO5_PIN_DIGITOS + '}$').test(texto)) {
    throw new Error('O PIN deve ter exatamente ' + PGO5_PIN_DIGITOS + ' dígitos numéricos.');
  }
  return texto;
}

// ============================================================================
// TENTATIVAS E BLOQUEIO
// ============================================================================

/**
 * Lê o estado de tentativas/bloqueio de um usuário.
 *
 * @param {string} usuarioId Id do usuário.
 * @returns {Object} { erros: number, bloqueadoAte: string }.
 */
function lerEstadoDoPin_(usuarioId) {
  const bruto = propriedadesDoScript_().getProperty(PGO5_PREFIXO_ESTADO_PIN + usuarioId);
  if (!bruto) return { erros: 0, bloqueadoAte: '' };
  try {
    const estado = JSON.parse(bruto);
    return {
      erros: Number(estado.erros) || 0,
      bloqueadoAte: String(estado.bloqueadoAte || '')
    };
  } catch (e) {
    // Propriedade corrompida: trata como "sem tentativas". Não pode virar
    // bloqueio eterno nem liberação indevida.
    return { erros: 0, bloqueadoAte: '' };
  }
}

/**
 * Grava o estado de tentativas/bloqueio de um usuário.
 * @param {string} usuarioId Id do usuário.
 * @param {Object} estado { erros, bloqueadoAte }.
 * @returns {void}
 */
function gravarEstadoDoPin_(usuarioId, estado) {
  propriedadesDoScript_().setProperty(
    PGO5_PREFIXO_ESTADO_PIN + usuarioId,
    JSON.stringify({ erros: Number(estado.erros) || 0, bloqueadoAte: String(estado.bloqueadoAte || '') }));
}

/**
 * Apaga tentativas e bloqueio de um usuário.
 * @param {string} usuarioId Id do usuário.
 * @returns {void}
 */
function limparEstadoDoPin_(usuarioId) {
  propriedadesDoScript_().deleteProperty(PGO5_PREFIXO_ESTADO_PIN + usuarioId);
}

/**
 * Diz se o usuário está bloqueado agora.
 *
 * O bloqueio expira sozinho: quando a data guardada já passou, a função
 * devolve false e limpa o registro, sem precisar de rotina agendada.
 *
 * @param {string} usuarioId Id do usuário.
 * @returns {boolean} true enquanto o bloqueio estiver valendo.
 */
function usuarioEstaBloqueadoNoPin_(usuarioId) {
  const estado = lerEstadoDoPin_(usuarioId);
  if (!estado.bloqueadoAte) return false;

  const fim = new Date(estado.bloqueadoAte);
  if (isNaN(fim.getTime())) return false;
  if (fim.getTime() > Date.now()) return true;

  limparEstadoDoPin_(usuarioId);
  return false;
}

// ============================================================================
// SESSÃO PROTEGIDA DE 5 MINUTOS
// ============================================================================

/**
 * Abre a janela de 5 minutos em que o usuário não precisa redigitar o PIN.
 * @param {string} usuarioId Id do usuário.
 * @returns {string} Data/hora ISO em que a liberação expira.
 */
function abrirSessaoProtegida_(usuarioId) {
  const expiraEm = new Date(Date.now() + PGO5_PIN_SESSAO_MINUTOS * 60 * 1000);
  propriedadesDoScript_().setProperty(
    PGO5_PREFIXO_SESSAO_PIN + usuarioId, expiraEm.toISOString());
  return expiraEm.toISOString();
}

/**
 * Fecha a liberação de um usuário (usado ao trocar o PIN).
 * @param {string} usuarioId Id do usuário.
 * @returns {void}
 */
function fecharSessaoProtegida_(usuarioId) {
  propriedadesDoScript_().deleteProperty(PGO5_PREFIXO_SESSAO_PIN + usuarioId);
}

/**
 * Diz se o usuário está com o PIN liberado neste momento.
 *
 * ⚠️ Esta é a ÚNICA fonte de verdade da liberação. O front pode guardar o
 * horário para mostrar um contador, mas nada no navegador serve como prova:
 * toda ação protegida chama esta função no servidor.
 *
 * @param {string} usuarioId Id do usuário.
 * @returns {boolean} true enquanto os 5 minutos não expiram.
 */
function sessaoProtegidaEstaValida_(usuarioId) {
  const bruto = propriedadesDoScript_().getProperty(PGO5_PREFIXO_SESSAO_PIN + usuarioId);
  if (!bruto) return false;

  const expira = new Date(bruto);
  if (isNaN(expira.getTime())) return false;
  if (expira.getTime() > Date.now()) return true;

  fecharSessaoProtegida_(usuarioId);
  return false;
}

/**
 * Barreira das ações protegidas: exige a permissão E o PIN liberado.
 *
 * A ordem importa. Primeiro a permissão: quem não pode fazer a ação nem
 * deve descobrir que existe um PIN protegendo aquilo.
 *
 * @param {string} permissao Permissão exigida (ex.: 'visualizarBancoPgo').
 * @returns {Object} O ator autenticado, para quem chamou aproveitar.
 * @throws {Error} Sem a permissão, sem PIN definido ou sem liberação válida.
 */
function exigirPermissaoComPin_(permissao) {
  const ator = exigirPermissao_(permissao);

  if (!existePinDefinido_()) {
    throw new Error('PIN_NAO_DEFINIDO: defina o PIN administrativo em Configurações › Segurança.');
  }
  if (!sessaoProtegidaEstaValida_(String(ator.id))) {
    throw new Error('PIN_NECESSARIO: informe o PIN administrativo para continuar.');
  }
  return ator;
}

// ============================================================================
// DEFINIR E ALTERAR O PIN
// ============================================================================

/**
 * Define o primeiro PIN ou troca o PIN existente.
 *
 * REGRAS
 *   - Só quem tem 'alterarPermissoes' mexe no PIN.
 *   - Já existindo PIN, é preciso informar o atual — senão qualquer sessão
 *     administrativa aberta poderia trocar o PIN de quem está bloqueado.
 *   - O novo PIN precisa ter 6 dígitos e bater com a confirmação.
 *   - Trocar o PIN fecha a liberação de todo mundo: quem estava com os 5
 *     minutos abertos precisa validar de novo, agora com o PIN novo.
 *
 * O valor do PIN (antigo ou novo) NUNCA é gravado, registrado ou devolvido.
 *
 * @param {Object} dados { pinAtual, novoPin, confirmacao }.
 * @returns {Object} { success: true, primeiroPin: boolean }.
 * @throws {Error} Formato inválido, confirmação diferente ou PIN atual errado.
 */
function definirPinPGO5(dados) {
  const ator = exigirPermissao_('alterarPermissoes');
  const entrada = dados || {};
  const jaExistia = existePinDefinido_();

  if (jaExistia) {
    // Quem já está bloqueado não escapa do bloqueio trocando o PIN.
    if (usuarioEstaBloqueadoNoPin_(String(ator.id))) {
      throw new Error('PIN temporariamente bloqueado por excesso de tentativas.');
    }
    const atual = String(entrada.pinAtual || '').trim();
    if (calcularHashDoPin_(atual) !== propriedadesDoScript_().getProperty(PGO5_CHAVE_PIN_HASH)) {
      registrarErroDePin_(String(ator.id));
      throw new Error('PIN atual incorreto.');
    }
  }

  const novo = validarFormatoDoPin_(entrada.novoPin);
  if (novo !== String(entrada.confirmacao || '').trim()) {
    throw new Error('A confirmação não confere com o novo PIN.');
  }
  if (jaExistia && calcularHashDoPin_(novo) === propriedadesDoScript_().getProperty(PGO5_CHAVE_PIN_HASH)) {
    throw new Error('O novo PIN precisa ser diferente do atual.');
  }

  propriedadesDoScript_().setProperty(PGO5_CHAVE_PIN_HASH, calcularHashDoPin_(novo));
  limparEstadoDoPin_(String(ator.id));
  encerrarTodasAsSessoesProtegidas_();

  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY, PGO5_ENTIDADES_AUDITORIA.SEGURANCA,
    String(ator.id), jaExistia ? 'PIN administrativo alterado.' : 'PIN administrativo definido.',
    { primeiraDefinicao: !jaExistia }, String(ator.id));

  return { success: true, primeiroPin: !jaExistia };
}

/**
 * Fecha a liberação de 5 minutos de todos os usuários.
 *
 * Chamado quando o PIN muda: uma liberação obtida com o PIN antigo não pode
 * continuar valendo depois da troca.
 *
 * @returns {void}
 */
function encerrarTodasAsSessoesProtegidas_() {
  const props = propriedadesDoScript_();
  // getKeys() não existe em todas as versões do stub de teste; quando não
  // houver, encerra ao menos a sessão de quem está executando.
  if (typeof props.getKeys !== 'function') return;
  props.getKeys()
    .filter(function(chave) { return chave.indexOf(PGO5_PREFIXO_SESSAO_PIN) === 0; })
    .forEach(function(chave) { props.deleteProperty(chave); });
}

// ============================================================================
// VALIDAR O PIN
// ============================================================================

/**
 * Contabiliza uma tentativa errada e bloqueia ao atingir o limite.
 *
 * @param {string} usuarioId Id de quem errou.
 * @returns {Object} { bloqueado: boolean, restantes: number }.
 */
function registrarErroDePin_(usuarioId) {
  const estado = lerEstadoDoPin_(usuarioId);
  estado.erros = estado.erros + 1;

  if (estado.erros >= PGO5_PIN_MAX_TENTATIVAS) {
    const ate = new Date(Date.now() + PGO5_PIN_BLOQUEIO_HORAS * 60 * 60 * 1000);
    estado.bloqueadoAte = ate.toISOString();
    gravarEstadoDoPin_(usuarioId, estado);

    registrarAuditoria_(PGO5_ACOES_AUDITORIA.PIN_LOCK, PGO5_ENTIDADES_AUDITORIA.SEGURANCA,
      usuarioId, 'PIN bloqueado por excesso de tentativas.',
      { tentativas: estado.erros, horasDeBloqueio: PGO5_PIN_BLOQUEIO_HORAS }, usuarioId);

    return { bloqueado: true, restantes: 0 };
  }

  gravarEstadoDoPin_(usuarioId, estado);
  return { bloqueado: false, restantes: PGO5_PIN_MAX_TENTATIVAS - estado.erros };
}

/**
 * Valida o PIN digitado e, acertando, abre a liberação de 5 minutos.
 *
 * Acertar antes de esgotar as tentativas zera o contador — dois erros
 * seguidos de um acerto não deixam ninguém "quase bloqueado" para sempre.
 *
 * @param {string} pin PIN digitado pelo usuário.
 * @returns {Object} { success, expiraEm } quando acerta.
 * @throws {Error} Bloqueado, sem PIN definido ou PIN incorreto.
 */
function validarPinPGO5(pin) {
  const ator = requireAuth_();
  const usuarioId = String(ator.id);

  if (usuarioEstaBloqueadoNoPin_(usuarioId)) {
    throw new Error('PIN temporariamente bloqueado por excesso de tentativas.');
  }
  if (!existePinDefinido_()) {
    throw new Error('PIN_NAO_DEFINIDO: nenhum PIN administrativo foi definido ainda.');
  }

  const digitado = String(pin === undefined || pin === null ? '' : pin).trim();
  const confere = new RegExp('^[0-9]{' + PGO5_PIN_DIGITOS + '}$').test(digitado) &&
    calcularHashDoPin_(digitado) === propriedadesDoScript_().getProperty(PGO5_CHAVE_PIN_HASH);

  if (!confere) {
    const resultado = registrarErroDePin_(usuarioId);
    if (resultado.bloqueado) {
      throw new Error('PIN temporariamente bloqueado por excesso de tentativas.');
    }
    throw new Error('PIN incorreto. Tentativas restantes: ' + resultado.restantes + '.');
  }

  limparEstadoDoPin_(usuarioId);
  return { success: true, expiraEm: abrirSessaoProtegida_(usuarioId) };
}

// ============================================================================
// DESBLOQUEIO E RECUPERAÇÃO
// ============================================================================

/**
 * Conta quantos administradores ATIVOS existem hoje.
 *
 * "Administrador" aqui é o mesmo critério da proteção do último
 * administrador (nivelEhAdministrativo_): quem pode alterar permissões.
 *
 * @returns {Object[]} Usuários administradores ativos.
 */
function listarAdministradoresAtivos_() {
  const dados = lerCargosENiveis_();
  const niveisAdministrativos = {};
  listarNiveisAcesso_(dados, true).forEach(function(nivel) {
    if (nivelEhAdministrativo_(nivel)) niveisAdministrativos[nivel.id.toUpperCase()] = true;
  });

  return pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).filter(function(usuario) {
    if (!isTrue_(usuario.Ativo)) return false;
    return !!niveisAdministrativos[String(usuario.NivelAcessoId || '').trim().toUpperCase()];
  });
}

/**
 * Um administrador desbloqueia o PIN de outro usuário.
 *
 * REGRAS
 *   - Quem desbloqueia precisa de 'alterarPermissoes'.
 *   - Ninguém desbloqueia a si mesmo enquanto houver outro administrador
 *     ativo: se pudesse, o bloqueio de 24 horas não protegeria nada.
 *   - Desbloquear NÃO revela nem altera o PIN. Só zera tentativas/bloqueio.
 *
 * @param {string} usuarioId Id de quem será desbloqueado.
 * @returns {Object} { success: true }.
 * @throws {Error} Sem permissão, usuário inexistente ou autodesbloqueio.
 */
function desbloquearPinDeUsuarioPGO5(usuarioId) {
  const ator = exigirPermissao_('alterarPermissoes');
  const alvoId = String(usuarioId || '').trim();
  if (!alvoId) throw new Error('Informe o usuário que deve ser desbloqueado.');

  const alvo = pgo5ObterPorId(PGO5.SHEET_NAMES.USUARIOS, alvoId);
  if (!alvo) throw new Error('Usuário não encontrado.');

  if (alvoId.toUpperCase() === String(ator.id).toUpperCase()) {
    const outros = listarAdministradoresAtivos_().filter(function(u) {
      return String(u.Id).toUpperCase() !== String(ator.id).toUpperCase();
    });
    if (outros.length > 0) {
      throw new Error('Você não pode desbloquear a si mesmo. Peça a outro administrador ' +
        'ou aguarde o fim do bloqueio.');
    }
  }

  limparEstadoDoPin_(alvoId);
  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ADMIN_UNLOCK, PGO5_ENTIDADES_AUDITORIA.SEGURANCA,
    alvoId, 'PIN desbloqueado por um administrador.', {}, String(ator.id));

  return { success: true };
}

/**
 * Recuperação para quando existe UM ÚNICO administrador e ele se bloqueou.
 *
 * POR QUE ISTO EXISTE
 * Com um só administrador não há quem desbloqueie, e esperar 24 horas
 * deixaria o sistema administrativamente parado. Sem uma saída, um erro de
 * digitação três vezes travaria a operação por um dia inteiro.
 *
 * POR QUE ISTO NÃO É UM BURACO
 * São exigidas DUAS condições, e nenhuma delas é digitável por terceiros:
 *
 *   1. o e-mail informado tem de ser exatamente o cadastrado na aba Usuários;
 *   2. Session.getActiveUser() — a conta Google realmente autenticada —
 *      tem de ser esse mesmo e-mail.
 *
 * A condição 2 é a que segura: só a própria pessoa, logada na conta dela,
 * consegue satisfazê-la. Digitar o e-mail de outro não adianta.
 *
 * Além disso, a recuperação só funciona quando existe UM administrador
 * ativo. Havendo dois ou mais, o caminho é o desbloqueio pelo outro.
 *
 * O PIN não é revelado nem alterado — apenas o bloqueio é levantado.
 *
 * @param {string} emailInformado E-mail digitado na tela.
 * @returns {Object} { success: true }.
 * @throws {Error} Quando alguma das condições falha.
 */
function recuperarAcessoUnicoAdministradorPGO5(emailInformado) {
  const administradores = listarAdministradoresAtivos_();
  if (administradores.length !== 1) {
    throw new Error('Esta recuperação só existe quando há um único administrador ativo. ' +
      'Peça o desbloqueio a outro administrador ou aguarde o fim do bloqueio.');
  }

  const administrador = administradores[0];
  const cadastrado = normalizeText_(administrador.Email);
  const digitado = normalizeText_(emailInformado);
  const autenticado = normalizeText_(Session.getActiveUser().getEmail());

  // As três precisam coincidir: a digitada, a cadastrada e a autenticada.
  if (!digitado || digitado !== cadastrado || autenticado !== cadastrado) {
    throw new Error('Não foi possível confirmar a identidade do administrador.');
  }

  limparEstadoDoPin_(String(administrador.Id));
  registrarAuditoria_(PGO5_ACOES_AUDITORIA.SOLE_ADMIN_RECOVERY, PGO5_ENTIDADES_AUDITORIA.SEGURANCA,
    String(administrador.Id), 'Bloqueio removido pela recuperação do administrador único.',
    {}, String(administrador.Id));

  return { success: true };
}

// ============================================================================
// LINKS PROTEGIDOS
// ============================================================================

/**
 * Devolve o link de um recurso protegido — e SÓ aqui ele sai do servidor.
 *
 * ⚠️ REGRA CRÍTICA
 * Nenhum destes links pode viajar no bootstrap, no HTML, em atributo data-*,
 * em variável de JavaScript ou embutido em outra resposta. O caminho é
 * sempre: o usuário pede → o servidor confere permissão → confere o PIN →
 * só então devolve. Sem as duas chaves, a URL não existe fora daqui.
 *
 * @param {string} recurso 'BANCO_PGO' ou 'FONTE_SAC'.
 * @returns {Object} { recurso, nome, url }.
 * @throws {Error} Recurso desconhecido, sem permissão, sem PIN ou não configurado.
 */
function obterLinkProtegidoPGO5(recurso) {
  const chave = String(recurso || '').trim().toUpperCase();
  const permissao = PGO5_LINKS_PROTEGIDOS[chave];
  if (!permissao) throw new Error('Recurso protegido desconhecido.');

  exigirPermissaoComPin_(permissao);

  if (chave === 'BANCO_PGO') {
    const planilha = getSpreadsheet();
    return { recurso: chave, nome: planilha.getName(), url: planilha.getUrl() };
  }

  const configuracao = lerIndicOpConfig_();
  const url = String(configuracao.planilhaUrl || '').trim();
  if (!url) throw new Error('A fonte da Análise de SAC ainda não foi configurada.');
  return { recurso: chave, nome: 'Fonte da Análise de SAC', url: url };
}

// ============================================================================
// ESTADO PARA A TELA DE SEGURANÇA
// ============================================================================

/**
 * Monta o que a tela de Segurança precisa mostrar.
 *
 * ⚠️ NUNCA devolve hash, salt, PIN ou qualquer Script Property. Só diz se
 * existe PIN, quem está bloqueado e até quando a liberação vale.
 *
 * @returns {Object} Estado da segurança para a interface.
 * @throws {Error} Quando o usuário não tem permissão administrativa.
 */
function obterEstadoSegurancaPGO5() {
  const ator = exigirPermissao_('alterarPermissoes');
  const usuarioId = String(ator.id);

  const bloqueados = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS)
    .filter(function(usuario) { return usuarioEstaBloqueadoNoPin_(String(usuario.Id)); })
    .map(function(usuario) {
      const estado = lerEstadoDoPin_(String(usuario.Id));
      return {
        id: String(usuario.Id || ''),
        nome: String(usuario.Nome || ''),
        bloqueadoAte: estado.bloqueadoAte
      };
    });

  const sessaoValida = sessaoProtegidaEstaValida_(usuarioId);
  return {
    pinDefinido: existePinDefinido_(),
    sessaoAtiva: sessaoValida,
    sessaoExpiraEm: sessaoValida
      ? String(propriedadesDoScript_().getProperty(PGO5_PREFIXO_SESSAO_PIN + usuarioId) || '')
      : '',
    minutosDeSessao: PGO5_PIN_SESSAO_MINUTOS,
    tentativasPermitidas: PGO5_PIN_MAX_TENTATIVAS,
    horasDeBloqueio: PGO5_PIN_BLOQUEIO_HORAS,
    digitosDoPin: PGO5_PIN_DIGITOS,
    bloqueados: bloqueados,
    souOUnicoAdministrador: listarAdministradoresAtivos_().length === 1,
    recursosProtegidos: Object.keys(PGO5_LINKS_PROTEGIDOS)
      .filter(function(chave) {
        return usuarioTemPermissao_(atorComoUsuario_(ator), PGO5_LINKS_PROTEGIDOS[chave]);
      })
  };
}

/**
 * Diz se um nível de acesso concede poder administrativo.
 *
 * Usada para decidir quando a concessão exige PIN. Ver a explicação de
 * PGO5_PERMISSOES_DE_PODER logo no começo deste arquivo.
 *
 * @param {Object} nivel Item de nível ({ permissoes: string[] }).
 * @returns {boolean} true quando o nível dá algum poder administrativo.
 */
function nivelConcedePoderAdministrativo_(nivel) {
  const permissoes = (nivel && nivel.permissoes) || [];
  return PGO5_PERMISSOES_DE_PODER.some(function(permissao) {
    return permissoes.indexOf(permissao) !== -1;
  });
}
