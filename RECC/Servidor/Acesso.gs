/**
 * ============================================================================
 * RECC — Acesso.gs · quem entra, e o que cada um pode
 * ============================================================================
 * Duas coisas diferentes, e confundi-las é o erro mais caro que este sistema
 * pode cometer:
 *
 *   CARGO         é o que a pessoa É na organização. Texto livre, muda quando
 *                 o RH quiser. Aparece embaixo do nome na barra superior e
 *                 NÃO decide nada.
 *
 *   NÍVEL DE      é o que a pessoa PODE. Daqui saem as telas do menu, os
 *   ACESSO        campos que ela enxerga no formulário, os componentes de cada
 *                 painel, as ações permitidas e o alcance sobre os dados.
 *
 * Nunca escreva `if (cargo === 'ADM')`. O nome do cargo é editável pelo
 * próprio administrador; a permissão sumiria junto com o texto.
 *
 * A OUTRA REGRA: esconder botão não é segurança. A tela esconde por educação;
 * o servidor confere por obrigação. Toda função sensível chama
 * exigirPermissao_ antes de fazer qualquer coisa.
 * ============================================================================
 */

/** As ações que um nível de acesso pode conceder. */
const RECC_ACOES = {
  CRIAR: 'criar',
  EDITAR: 'editar',
  OCULTAR: 'ocultar',
  EXPORTAR: 'exportar',
  CONFIGURAR: 'configurar',
  ESTRUTURA: 'estrutura'
};

/** O alcance de cada pessoa sobre os dados. */
const RECC_ESCOPOS = {
  PROPRIOS: 'PROPRIOS',
  EQUIPE: 'EQUIPE',
  MESA: 'MESA',
  TODOS: 'TODOS'
};

/** Como um campo pode aparecer para um nível de acesso. */
const RECC_VISIBILIDADE = {
  OCULTO: 'oculto',
  LEITURA: 'leitura',
  EDICAO: 'edicao'
};

// ============================================================================
// QUEM ESTÁ ENTRANDO
// ============================================================================

/**
 * A pessoa autenticada no Google, conferida contra a aba USUARIOS.
 *
 * Devolve SEMPRE um objeto, nunca lança: não estar cadastrado é uma resposta
 * legítima do sistema, não um erro. Quem trata isso é a tela.
 *
 *   { cadastrado: false, email: '...', motivo: '...' }
 *   { cadastrado: true,  email, usuario, cargo, nivel, permissoes }
 */
function usuarioAtual_() {
  var email = String(Session.getActiveUser().getEmail() || '').trim();
  if (!email) {
    return {
      cadastrado: false,
      email: '',
      motivo: 'O Google não informou o e-mail de quem está acessando.'
    };
  }

  var encontrado = null;
  var usuarios = lerRegistros_('USUARIOS');
  for (var i = 0; i < usuarios.length; i++) {
    if (normalizarParaComparar_(usuarios[i].Email) === normalizarParaComparar_(email)) {
      encontrado = usuarios[i];
      break;
    }
  }

  if (!encontrado) {
    return {
      cadastrado: false,
      email: email,
      motivo: 'Este e-mail não está cadastrado no sistema.'
    };
  }
  if (normalizarParaComparar_(encontrado.Ativo) !== 'sim') {
    return {
      cadastrado: false,
      email: email,
      motivo: 'Este e-mail está cadastrado, mas o acesso está desativado.'
    };
  }

  var nivel = itemDoCatalogo_(encontrado.NivelAcessoId);
  if (!nivel) {
    return {
      cadastrado: false,
      email: email,
      motivo: 'O nível de acesso deste usuário não existe mais no catálogo. ' +
        'Peça a um administrador para reatribuir.'
    };
  }

  if (normalizarParaComparar_(nivel.Ativo) !== 'sim') {
    return {
      cadastrado: false,
      email: email,
      motivo: 'O nível de acesso "' + nivel.Nome + '" está desligado. ' +
        'Enquanto estiver assim, ninguém que dependa dele entra.'
    };
  }

  var cargo = itemDoCatalogo_(encontrado.CargoId);

  return {
    cadastrado: true,
    email: email,
    usuario: encontrado,
    cargo: cargo ? cargo.Nome : '',
    nivel: nivel.Nome,
    nivelId: nivel.Id,
    permissoes: lerPermissoesDoNivel_(nivel)
  };
}

/** Um item do catálogo pelo Id. Devolve null quando o item foi excluído. */
function itemDoCatalogo_(idDoItem) {
  var alvo = converterParaIdentificador_(idDoItem);
  if (!alvo) return null;
  var itens = lerRegistros_('CATALOGO');
  for (var i = 0; i < itens.length; i++) {
    if (converterParaIdentificador_(itens[i].Id) === alvo) return itens[i];
  }
  return null;
}

// ============================================================================
// O QUE O NÍVEL PERMITE
// ============================================================================

/**
 * Traduz a coluna Configuracao do nível — que é um texto em JSON — no objeto
 * de permissões que o resto do sistema consulta.
 *
 * Configuração quebrada NÃO vira permissão vazia em silêncio. Um menu vazio
 * seria lido como "não tenho acesso", quando na verdade é "a configuração
 * está com defeito" — e alguém passaria a tarde procurando no lugar errado.
 */
function lerPermissoesDoNivel_(nivel) {
  var permissoes = {
    escopo: RECC_ESCOPOS.PROPRIOS,
    telas: [],
    acoes: [],
    campos: {},
    componentes: {},
    defeito: ''
  };

  var texto = String(nivel.Configuracao || '').trim();
  if (!texto) {
    permissoes.defeito = 'O nível "' + nivel.Nome + '" está sem configuração.';
    return permissoes;
  }

  var lido;
  try {
    lido = JSON.parse(texto);
  } catch (erro) {
    permissoes.defeito = 'A configuração do nível "' + nivel.Nome +
      '" não é um JSON válido: ' + erro.message;
    return permissoes;
  }

  permissoes.escopo = RECC_ESCOPOS[lido.escopo] || RECC_ESCOPOS.PROPRIOS;
  permissoes.telas = Array.isArray(lido.telas) ? lido.telas : [];
  permissoes.acoes = Array.isArray(lido.acoes) ? lido.acoes : [];
  permissoes.campos = lido.campos && typeof lido.campos === 'object' ? lido.campos : {};
  permissoes.componentes =
    lido.componentes && typeof lido.componentes === 'object' ? lido.componentes : {};
  return permissoes;
}

function podeVerTela_(permissoes, nomeDaTela) {
  return permissoes.telas.indexOf(nomeDaTela) >= 0;
}

function podeFazer_(permissoes, acao) {
  return permissoes.acoes.indexOf(acao) >= 0;
}

/**
 * A guarda do servidor. Chame no começo de TODA função sensível.
 * Devolve o usuário para quem passou, para a função não precisar buscar de novo.
 */
function exigirPermissao_(acao) {
  var quem = usuarioAtual_();
  if (!quem.cadastrado) {
    throw new Error('Acesso negado: ' + quem.motivo);
  }
  if (quem.permissoes.defeito) {
    throw new Error('Acesso indisponível: ' + quem.permissoes.defeito);
  }
  if (!podeFazer_(quem.permissoes, acao)) {
    throw new Error('Seu nível de acesso ("' + quem.nivel + '") não permite ' +
      acao + '.');
  }
  return quem;
}

/**
 * Como cada campo aparece para este nível.
 *
 * O padrão é EDIÇÃO: um campo novo criado pelo administrador nasce visível
 * para todos, e ele restringe se quiser. O contrário — nascer oculto —
 * faria todo campo novo sumir e ninguém entenderia por quê.
 */
function visibilidadeDoCampo_(permissoes, chaveDoCampo) {
  var declarada = permissoes.campos[chaveDoCampo];
  if (declarada === RECC_VISIBILIDADE.OCULTO) return RECC_VISIBILIDADE.OCULTO;
  if (declarada === RECC_VISIBILIDADE.LEITURA) return RECC_VISIBILIDADE.LEITURA;
  return RECC_VISIBILIDADE.EDICAO;
}

// ============================================================================
// ALCANCE SOBRE OS DADOS
// ============================================================================

/**
 * A coluna que diz de quem é o registro.
 *
 * Nas duas bases é o analista, e ela guarda o NOME, não o Id — foi pedido
 * assim. Por isso a comparação é por nome normalizado.
 */
function colunaDoResponsavel_(estrutura) {
  var candidatas = ['analista', 'responsavel'];
  for (var i = 0; i < estrutura.cabecalhos.length; i++) {
    if (candidatas.indexOf(normalizarParaComparar_(estrutura.cabecalhos[i])) >= 0) {
      return estrutura.cabecalhos[i];
    }
  }
  return '';
}

/**
 * Filtra os registros pelo alcance do nível.
 *
 * EQUIPE é definida pelo "Canal que atende" do cadastro do usuário — é a
 * única noção de equipe que existe na estrutura hoje. Se a operação passar a
 * ter hierarquia de supervisão, isso vira uma coluna nova em USUARIOS e só
 * esta função muda.
 */
function filtrarPeloAlcance_(registros, nomeDaAba, quem) {
  if (quem.permissoes.escopo === RECC_ESCOPOS.TODOS) return registros;
  if (quem.permissoes.escopo === RECC_ESCOPOS.MESA) return registros;

  var estrutura = estruturaDaAba_(nomeDaAba);
  var coluna = colunaDoResponsavel_(estrutura);
  if (!coluna) return registros;

  if (quem.permissoes.escopo === RECC_ESCOPOS.PROPRIOS) {
    var meuNome = normalizarParaComparar_(quem.usuario.Nome);
    return registros.filter(function (registro) {
      return normalizarParaComparar_(registro[coluna]) === meuNome;
    });
  }

  // EQUIPE
  var meuCanal = normalizarParaComparar_(quem.usuario['Canal que atende']);
  if (!meuCanal) return [];

  var nomesDaEquipe = {};
  lerRegistros_('USUARIOS').forEach(function (usuario) {
    if (normalizarParaComparar_(usuario['Canal que atende']) === meuCanal) {
      nomesDaEquipe[normalizarParaComparar_(usuario.Nome)] = true;
    }
  });
  return registros.filter(function (registro) {
    return nomesDaEquipe[normalizarParaComparar_(registro[coluna])] === true;
  });
}

// ============================================================================
// SENHA DE ADMINISTRADOR — para o que não tem volta
// ============================================================================

const RECC_CHAVE_DA_SENHA = 'RECC_SENHA_DO_ADMINISTRADOR';
const RECC_CHAVE_DAS_TENTATIVAS = 'RECC_TENTATIVAS_DE_SENHA';
const RECC_CHAVE_DA_LIBERACAO = 'RECC_SENHA_LIBERADA_ATE';
const RECC_MINUTOS_LIBERADOS = 5;
const RECC_TENTATIVAS_ATE_BLOQUEAR = 3;
const RECC_HORAS_DE_BLOQUEIO = 24;

/**
 * A senha NUNCA é guardada. Guarda-se a impressão digital dela.
 *
 * SHA-256 sobre "tempero + senha", e o tempero é sorteado uma vez por
 * instalação. Sem tempero, duas instalações com a mesma senha teriam a mesma
 * impressão digital, e uma tabela pronta de senhas comuns quebraria as duas.
 *
 * Tudo isso mora em Script Properties, FORA da planilha: quem abre a planilha
 * não pode ver nem trocar a senha.
 */
function impressaoDigitalDaSenha_(tempero, senha) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, tempero + '|' + senha, Utilities.Charset.UTF_8);
  var hexadecimal = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hexadecimal += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hexadecimal;
}

function existeSenhaDeAdministrador_() {
  return !!PropertiesService.getScriptProperties().getProperty(RECC_CHAVE_DA_SENHA);
}

/**
 * Define ou troca a senha. Trocar exige a senha atual — senão qualquer pessoa
 * com a permissão de configurar poderia se promover sozinha.
 */
function definirSenhaDeAdministrador_(senhaNova, senhaAtual) {
  if (String(senhaNova || '').length < 6) {
    throw new Error('A senha precisa ter ao menos 6 caracteres.');
  }
  var propriedades = PropertiesService.getScriptProperties();
  if (existeSenhaDeAdministrador_()) {
    conferirSenhaDeAdministrador_(senhaAtual);
  }
  var tempero = Utilities.getUuid();
  propriedades.setProperty(RECC_CHAVE_DA_SENHA,
    tempero + ':' + impressaoDigitalDaSenha_(tempero, senhaNova));
  propriedades.deleteProperty(RECC_CHAVE_DAS_TENTATIVAS);
  return true;
}

/**
 * Confere a senha e libera a sessão por alguns minutos.
 * Três erros seguidos bloqueiam por 24 horas.
 */
function conferirSenhaDeAdministrador_(senha) {
  var propriedades = PropertiesService.getScriptProperties();
  var guardado = propriedades.getProperty(RECC_CHAVE_DA_SENHA);
  if (!guardado) {
    throw new Error('Nenhuma senha de administrador foi definida ainda. ' +
      'Defina em Configurações › Segurança.');
  }

  var tentativas = lerTentativasDeSenha_();
  if (tentativas.bloqueadoAte && new Date().getTime() < tentativas.bloqueadoAte) {
    var faltam = Math.ceil(
      (tentativas.bloqueadoAte - new Date().getTime()) / (1000 * 60 * 60));
    throw new Error('Senha bloqueada por ' + faltam + ' hora(s) após ' +
      RECC_TENTATIVAS_ATE_BLOQUEAR + ' tentativas erradas.');
  }

  var partes = guardado.split(':');
  var confere = impressaoDigitalDaSenha_(partes[0], String(senha || '')) === partes[1];

  if (!confere) {
    tentativas.quantidade++;
    if (tentativas.quantidade >= RECC_TENTATIVAS_ATE_BLOQUEAR) {
      tentativas.bloqueadoAte =
        new Date().getTime() + RECC_HORAS_DE_BLOQUEIO * 60 * 60 * 1000;
    }
    gravarTentativasDeSenha_(tentativas);
    var restam = RECC_TENTATIVAS_ATE_BLOQUEAR - tentativas.quantidade;
    throw new Error('Senha incorreta.' +
      (restam > 0 ? ' Restam ' + restam + ' tentativa(s).' : ' Acesso bloqueado.'));
  }

  propriedades.deleteProperty(RECC_CHAVE_DAS_TENTATIVAS);
  PropertiesService.getUserProperties().setProperty(RECC_CHAVE_DA_LIBERACAO,
    String(new Date().getTime() + RECC_MINUTOS_LIBERADOS * 60 * 1000));
  return true;
}

function lerTentativasDeSenha_() {
  var texto = PropertiesService.getScriptProperties()
    .getProperty(RECC_CHAVE_DAS_TENTATIVAS);
  if (!texto) return { quantidade: 0, bloqueadoAte: 0 };
  try {
    var lido = JSON.parse(texto);
    return {
      quantidade: Number(lido.quantidade) || 0,
      bloqueadoAte: Number(lido.bloqueadoAte) || 0
    };
  } catch (erro) {
    return { quantidade: 0, bloqueadoAte: 0 };
  }
}

function gravarTentativasDeSenha_(tentativas) {
  PropertiesService.getScriptProperties()
    .setProperty(RECC_CHAVE_DAS_TENTATIVAS, JSON.stringify(tentativas));
}

/**
 * A guarda das ações sem volta: criar ou remover coluna, apagar mesa, mexer
 * em nível de acesso, gerar aba de análise sobre uma existente, normalizar
 * base, ocultar em massa.
 */
function exigirSenhaDeAdministrador_() {
  var ate = Number(PropertiesService.getUserProperties()
    .getProperty(RECC_CHAVE_DA_LIBERACAO) || 0);
  if (new Date().getTime() > ate) {
    throw new Error('Esta ação exige a senha de administrador. ' +
      'A liberação anterior expirou — informe a senha novamente.');
  }
  return true;
}

// ============================================================================
// AUDITORIA
// ============================================================================

/**
 * Deixa rastro do que foi feito, sem gravar dado pessoal.
 * Nunca derruba a operação: falhar ao auditar não pode desfazer o que já
 * aconteceu — só registra o problema no log do Apps Script.
 */
function registrarAuditoria_(acao, entidade, idDoRegistro, detalhe) {
  try {
    inserirRegistro_('AUDITORIA', {
      DataHora: new Date(),
      UsuarioId: (usuarioAtual_().usuario || {}).Id || '',
      Acao: acao,
      Entidade: entidade || '',
      RegistroId: idDoRegistro || '',
      Detalhe: detalhe || ''
    });
  } catch (erro) {
    Logger.log('Falha ao registrar auditoria: ' + erro.message);
  }
}
