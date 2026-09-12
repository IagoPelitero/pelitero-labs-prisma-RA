/**
 * ============================================================================
 * RECC — Principal.gs · a porta de entrada
 * ============================================================================
 * doGet é a função que o Google chama quando alguém abre o endereço do
 * sistema. Ela decide entre duas coisas, e só duas:
 *
 *   e-mail cadastrado     → serve o sistema
 *   e-mail não cadastrado → serve a tela institucional, sem carregar dado
 *                           nenhum da planilha
 *
 * Aqui também mora o PACOTE DE PARTIDA: tudo que a tela precisa para se
 * montar chega numa ÚNICA ida ao servidor. Sete chamadas separadas custariam
 * sete viagens de rede e a tela piscaria montando aos pedaços.
 * ============================================================================
 */

/** Chamada pelo Google quando alguém abre o endereço do sistema. */
function doGet() {
  var quem = usuarioAtual_();
  var identidade = lerIdentidadeVisual_();

  if (!quem.cadastrado) {
    var bloqueio = HtmlService.createTemplateFromFile('SemAcesso');
    bloqueio.email = quem.email;
    bloqueio.motivo = quem.motivo;
    bloqueio.identidade = identidade;
    return bloqueio.evaluate()
      .setTitle(identidade.nome + ' — acesso não liberado')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  registrarUltimoAcesso_(quem.usuario);
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(identidade.nome)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Cola um arquivo .html dentro de outro.
 * É assim que o Apps Script faz "incluir": não existe import de HTML.
 */
function incluir_(nomeDoArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeDoArquivo).getContent();
}

/** Atalho para os templates escreverem <?!= incluir('Estilos') ?> */
function incluir(nomeDoArquivo) {
  return incluir_(nomeDoArquivo);
}

// ============================================================================
// O PACOTE DE PARTIDA
// ============================================================================

/**
 * Tudo que a tela precisa para se montar, numa chamada só.
 *
 * Quando algo dá errado aqui, a resposta diz O QUE deu errado. Devolver uma
 * lista de permissões vazia seria pior do que devolver erro: o menu apareceria
 * vazio e todo mundo leria isso como "não tenho acesso", quando o problema é
 * outro. Já aconteceu no sistema anterior e custou uma tarde.
 */
function pacoteDePartida() {
  var quem = usuarioAtual_();

  if (!quem.cadastrado) {
    return {
      disponivel: false,
      cadastrado: false,
      motivo: quem.motivo,
      email: quem.email,
      identidade: lerIdentidadeVisual_()
    };
  }
  if (quem.permissoes.defeito) {
    return {
      disponivel: false,
      cadastrado: true,
      motivo: quem.permissoes.defeito,
      email: quem.email,
      identidade: lerIdentidadeVisual_()
    };
  }

  return {
    disponivel: true,
    cadastrado: true,
    identidade: lerIdentidadeVisual_(),
    usuario: {
      id: quem.usuario.Id,
      nome: quem.usuario.Nome,
      email: quem.email,
      cargo: quem.cargo,
      nivelAcesso: quem.nivel,
      canalQueAtende: quem.usuario['Canal que atende']
    },
    permissoes: {
      telas: quem.permissoes.telas,
      acoes: quem.permissoes.acoes,
      escopo: quem.permissoes.escopo
    },
    menu: montarMenu_(quem.permissoes),
    mesas: mesasVisiveis_(),
    temaPadrao: valorDaConfiguracao_('OPERACAO.TEMA_PADRAO', 'padrao'),
    senhaDeAdministradorDefinida: existeSenhaDeAdministrador_()
  };
}

/** O menu lateral, já filtrado pelo nível e com os nomes que o ADM escolheu. */
function montarMenu_(permissoes) {
  var titulos = {};
  try {
    titulos = JSON.parse(valorDaConfiguracao_('MENU.TITULOS', '{}'));
  } catch (erro) {
    titulos = {};
  }

  var ordem = ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
    'tabelaCorretoras', 'painelAnalitico', 'configuracoes'];

  return ordem
    .filter(function (tela) { return podeVerTela_(permissoes, tela); })
    .map(function (tela) {
      return { tela: tela, titulo: titulos[tela] || tela };
    });
}

/** As mesas ativas, na ordem definida na aba MESAS. */
function mesasVisiveis_() {
  return lerRegistros_('MESAS')
    .filter(function (mesa) {
      return normalizarParaComparar_(mesa.Ativo) === 'sim';
    })
    .sort(function (uma, outra) {
      return (Number(uma.Ordem) || 0) - (Number(outra.Ordem) || 0);
    })
    .map(function (mesa) {
      return {
        id: mesa.Id,
        nome: mesa.Nome,
        descricao: mesa.Descricao,
        aba: mesa.Aba,
        icone: mesa.Icone
      };
    });
}

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Um valor da aba CONFIG, com um padrão para quando a chave não existir. */
function valorDaConfiguracao_(chave, valorPadrao) {
  var alvo = normalizarParaComparar_(chave);
  var linhas = lerRegistros_('CONFIG');
  for (var i = 0; i < linhas.length; i++) {
    if (normalizarParaComparar_(linhas[i].Chave) === alvo) {
      var valor = String(linhas[i].Valor === undefined ? '' : linhas[i].Valor);
      return valor === '' ? valorPadrao : valor;
    }
  }
  return valorPadrao;
}

/**
 * Nome, subtítulo, operação, logo e cor.
 *
 * Mora em CONFIG e não em código de propósito: a plataforma é o PGO, e o RECC
 * é uma operação dela. Servir outra operação é trocar estas linhas.
 */
function lerIdentidadeVisual_() {
  return {
    nome: valorDaConfiguracao_('IDENTIDADE.NOME', 'RECC'),
    nomeLongo: valorDaConfiguracao_('IDENTIDADE.NOME_LONGO', ''),
    operacao: valorDaConfiguracao_('IDENTIDADE.OPERACAO', ''),
    logo: valorDaConfiguracao_('IDENTIDADE.LOGO_URL', ''),
    corPrimaria: valorDaConfiguracao_('IDENTIDADE.COR_PRIMARIA', '#0F56D6')
  };
}
