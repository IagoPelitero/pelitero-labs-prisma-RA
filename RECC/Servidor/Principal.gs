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

  // A identidade PRECISA ser entregue ao template: o Index a usa no título e
  // na marca de abertura. Sem isso a página nem chega a ser montada.
  var pagina = HtmlService.createTemplateFromFile('Index');
  pagina.identidade = identidade;
  return pagina.evaluate()
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
    tema: temaDoUsuario_(),
    senhaDeAdministradorDefinida: existeSenhaDeAdministrador_()
  };
}

// ============================================================================
// TEMA
// ============================================================================

const RECC_TEMAS = ['padrao', 'rosa', 'dark', 'brasil'];
const RECC_CHAVE_DO_TEMA = 'RECC_TEMA_ESCOLHIDO';

/**
 * O tema escolhido pela pessoa, ou o padrão da operação.
 *
 * Fica em UserProperties, e não no navegador: assim a escolha acompanha a
 * pessoa em qualquer computador que ela abrir o sistema.
 */
function temaDoUsuario_() {
  var escolhido = PropertiesService.getUserProperties()
    .getProperty(RECC_CHAVE_DO_TEMA);
  if (escolhido && RECC_TEMAS.indexOf(escolhido) >= 0) return escolhido;

  var daOperacao = valorDaConfiguracao_('OPERACAO.TEMA_PADRAO', 'padrao');
  return RECC_TEMAS.indexOf(daOperacao) >= 0 ? daOperacao : 'padrao';
}

/**
 * Guarda o tema escolhido. Chamada pelo navegador.
 *
 * Não exige permissão nenhuma de propósito: escolher a cor da própria tela
 * não é uma decisão sobre dado. Exige apenas estar cadastrado — senão
 * qualquer visitante encheria as propriedades da instalação.
 */
function salvarTemaDoUsuario(tema) {
  var quem = usuarioAtual_();
  if (!quem.cadastrado) {
    throw new Error('Acesso negado: ' + quem.motivo);
  }
  if (RECC_TEMAS.indexOf(tema) < 0) {
    throw new Error('Tema desconhecido: "' + tema + '". Os temas são ' +
      RECC_TEMAS.join(', ') + '.');
  }
  PropertiesService.getUserProperties().setProperty(RECC_CHAVE_DO_TEMA, tema);
  return tema;
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
 * Guarda a logo da operação. Chamada pelo navegador.
 *
 * Aceita duas formas, e as duas evitam hospedar arquivo:
 *
 *   1. um endereço https de uma imagem que a empresa já publica;
 *   2. a própria imagem embutida em texto (data:image/...;base64,...),
 *      que é o caminho sem dependência nenhuma — a imagem passa a morar
 *      dentro da célula de CONFIG.
 *
 * A imagem NUNCA vai para o código. É assim que a mesma plataforma serve
 * outra operação trocando só uma linha da planilha.
 */
function definirLogo(enderecoOuImagem) {
  exigirPermissao_(RECC_ACOES.CONFIGURAR);

  var valor = String(enderecoOuImagem || '').trim();
  var ehEndereco = valor.indexOf('https://') === 0;
  var ehImagemEmbutida = valor.indexOf('data:image/') === 0;

  if (valor && !ehEndereco && !ehImagemEmbutida) {
    throw new Error('A logo precisa ser um endereço https:// de imagem ou a ' +
      'própria imagem em texto, começando com data:image/. Recebi: ' +
      valor.substring(0, 40));
  }

  var linhas = lerRegistros_('CONFIG');
  for (var i = 0; i < linhas.length; i++) {
    if (normalizarParaComparar_(linhas[i].Chave) === normalizarParaComparar_('IDENTIDADE.LOGO_URL')) {
      atualizarRegistro_('CONFIG', linhas[i].Id, {
        Valor: valor,
        AtualizadoPor: (usuarioAtual_().usuario || {}).Id || '',
        Data: new Date()
      });
      registrarAuditoria_('identidade.logo', 'CONFIG', linhas[i].Id, '');
      return true;
    }
  }
  throw new Error('A chave IDENTIDADE.LOGO_URL não existe na aba CONFIG.');
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
    corPrimaria: valorDaConfiguracao_('IDENTIDADE.COR_PRIMARIA', '#0B77CE')
  };
}
