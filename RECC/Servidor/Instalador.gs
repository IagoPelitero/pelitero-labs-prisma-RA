/**
 * ============================================================================
 * RECC — Instalador.gs · a única rotina que cria estrutura
 * ============================================================================
 * Rode `instalarRECC()` UMA vez, no editor do Apps Script, sobre uma planilha
 * VAZIA. Ela recusa rodar se qualquer aba do contrato já tiver dado.
 *
 * Depois da instalação, nenhum caminho do produto cria, renomeia, apaga ou
 * reordena aba e coluna por conta própria. Abrir o sistema apenas VALIDA.
 *
 * O que a instalação faz:
 *   1. acerta o fuso da planilha para America/Sao_Paulo;
 *   2. cria as 12 abas, com cabeçalho, formato de coluna e linha 1 congelada;
 *   3. CORTA cada aba para o tamanho do contrato — célula vazia também consome
 *      o teto de 10 milhões da planilha;
 *   4. semeia catálogo, mesas, campos e configuração — tudo editável depois;
 *   5. cadastra QUEM EXECUTOU como o primeiro Administrador.
 *
 * O passo 5 não é conveniência. O acesso é pelo e-mail autenticado conferido
 * contra a aba USUARIOS: base recém-criada tem essa aba vazia, e sem ninguém
 * dentro ninguém entra — nem para cadastrar o primeiro usuário.
 *
 * NENHUM dado operacional é semeado. As bases, os canais, os produtos e as
 * SUSEPs bloqueadas nascem vazios.
 * ============================================================================
 */

const RECC_TETO_DE_CELULAS = 10000000;

/** Ponto de entrada da instalação. */
function instalarRECC() {
  var planilha = planilhaAtiva_();
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Não foi possível identificar o e-mail de quem está ' +
      'executando. Rode instalarRECC() pelo editor do Apps Script, ' +
      'autorizando o script.');
  }

  abortarSeAPlanilhaTiverDado_(planilha);

  planilha.setSpreadsheetTimeZone(RECC_FUSO_HORARIO);
  esquecerEstruturaLida_();

  var criadas = [];
  nomesDasAbasDoContrato_().forEach(function (nomeDaAba) {
    criadas.push(criarAbaDoContrato_(planilha, esquemaDaAba_(nomeDaAba)));
  });
  esquecerEstruturaLida_();

  var semente = semearDadosIniciais_(email);
  var orcamento = orcamentoDeCelulas_(planilha);

  var laudo = [
    'RECC instalado.',
    '',
    'Abas criadas: ' + criadas.length,
    'Primeiro administrador: ' + email,
    'Fuso da planilha: ' + planilha.getSpreadsheetTimeZone(),
    '',
    'Semente:',
    '  níveis de acesso ..... ' + semente.niveis,
    '  cargos ............... ' + semente.cargos,
    '  itens de catálogo .... ' + semente.catalogo,
    '  mesas ................ ' + semente.mesas,
    '  campos do formulário . ' + semente.campos,
    '  chaves de configuração ' + semente.config,
    '',
    'Orçamento de células: ' + orcamento.usadas.toLocaleString('pt-BR') +
      ' de ' + RECC_TETO_DE_CELULAS.toLocaleString('pt-BR') +
      ' (' + orcamento.percentual + '%)',
    '',
    'Próximo passo: abrir Configurações › Segurança e definir a senha de ADM.'
  ].join('\n');

  Logger.log(laudo);
  return laudo;
}

/** Instalação sobre planilha em uso não existe. */
function abortarSeAPlanilhaTiverDado_(planilha) {
  var comDado = [];
  nomesDasAbasDoContrato_().forEach(function (nomeDaAba) {
    var aba = planilha.getSheetByName(nomeDaAba);
    if (!aba) return;
    var preenchidas = quantasLinhasPreenchidas_(aba);
    if (preenchidas > 0) comDado.push(nomeDaAba + ' (' + preenchidas + ' linhas)');
  });
  if (comDado.length) {
    throw new Error('Esta planilha já tem dado nas abas: ' + comDado.join(', ') +
      '. A instalação só roda sobre planilha vazia, e não vai apagar nada. ' +
      'Use uma planilha nova.');
  }
}

/**
 * Quantas linhas de DADO a aba tem, de verdade.
 *
 * Conferir só getLastRow() não bastaria numa reinstalação: uma tentativa
 * anterior pode ter deixado a aba criada e formatada, e formato não é dado.
 * Aqui a pergunta é se existe algum valor abaixo do cabeçalho.
 */
function quantasLinhasPreenchidas_(aba) {
  var ultima = aba.getLastRow();
  var largura = aba.getLastColumn();
  if (ultima < 2 || largura < 1) return 0;

  var valores = aba.getRange(2, 1, ultima - 1, largura).getValues();
  var preenchidas = 0;
  for (var i = 0; i < valores.length; i++) {
    for (var j = 0; j < valores[i].length; j++) {
      var v = valores[i][j];
      if (v !== '' && v !== null && v !== undefined) { preenchidas++; break; }
    }
  }
  return preenchidas;
}

/**
 * Cria (ou reaproveita, se estiver vazia) a aba e a deixa no tamanho exato do
 * contrato.
 *
 * O corte importa: uma aba nova nasce com 1.000 linhas × 26 colunas, ou seja
 * 26.000 células do orçamento, todas em branco. Multiplicado por 12 abas isso
 * já seria 312 mil células guardando nada.
 */
function criarAbaDoContrato_(planilha, esquema) {
  var aba = planilha.getSheetByName(esquema.aba);
  if (!aba) aba = planilha.insertSheet(esquema.aba);

  var largura = esquema.colunas.length;
  var altura = esquema.reserva + 1;

  if (aba.getMaxColumns() < largura) {
    aba.insertColumnsAfter(aba.getMaxColumns(), largura - aba.getMaxColumns());
  } else if (aba.getMaxColumns() > largura) {
    aba.deleteColumns(largura + 1, aba.getMaxColumns() - largura);
  }
  if (aba.getMaxRows() < altura) {
    aba.insertRowsAfter(aba.getMaxRows(), altura - aba.getMaxRows());
  } else if (aba.getMaxRows() > altura) {
    aba.deleteRows(altura + 1, aba.getMaxRows() - altura);
  }

  var cabecalhos = esquema.colunas.map(function (coluna) { return coluna.cabecalho; });
  var linha1 = aba.getRange(1, 1, 1, largura);
  linha1.setNumberFormat('@');
  linha1.setValues([cabecalhos]);
  linha1.setFontWeight('bold');
  aba.setFrozenRows(1);

  // Pré-formata a área de dados coluna a coluna. Assim até uma linha digitada
  // à mão, sem passar pelo sistema, já cai na célula com o formato certo.
  for (var i = 0; i < esquema.colunas.length; i++) {
    var formato = RECC_FORMATO_DA_CELULA[esquema.colunas[i].tipo] || '@';
    aba.getRange(2, i + 1, esquema.reserva, 1).setNumberFormat(formato);
  }

  return esquema.aba;
}

// ============================================================================
// SEMENTE — padrão, nunca fixado. Tudo editável e excluível depois.
// ============================================================================

function semearDadosIniciais_(emailDoInstalador) {
  var contagem = { niveis: 0, cargos: 0, catalogo: 0, mesas: 0, campos: 0, config: 0 };

  // --- níveis de acesso -----------------------------------------------------
  // O nível é a unidade de permissão: telas, campos, widgets, ações e escopo
  // saem DAQUI. O cargo é só o rótulo organizacional.
  var niveis = inserirVariosRegistros_('CATALOGO', [
    novoNivelDeAcesso_('Administrador', 1, 'TODOS', true,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras', 'painelAnalitico', 'configuracoes']),
    novoNivelDeAcesso_('Coordenação', 2, 'TODOS', false,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras', 'painelAnalitico']),
    novoNivelDeAcesso_('Operação', 3, 'PROPRIOS', false,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras']),
    novoNivelDeAcesso_('Consulta', 4, 'TODOS', false,
      ['dashboard', 'buscarCaso', 'painelAnalitico'])
  ]);
  contagem.niveis = niveis.length;
  var idAdministrador = niveis[0]['Id'];

  // --- cargos ---------------------------------------------------------------
  var cargos = inserirVariosRegistros_('CATALOGO', [
    novoItemDeCatalogo_('CARGO', '', 'Analista RET', 1),
    novoItemDeCatalogo_('CARGO', '', 'Analista Mesa Diamante', 2),
    novoItemDeCatalogo_('CARGO', '', 'ADM', 3),
    novoItemDeCatalogo_('CARGO', '', 'Coordenação', 4),
    novoItemDeCatalogo_('CARGO', '', 'Analista Sênior', 5)
  ]);
  contagem.cargos = cargos.length;
  var idCargoAdm = cargos[2]['Id'];

  // --- mesas ----------------------------------------------------------------
  var mesas = inserirVariosRegistros_('MESAS', [
    {
      Nome: 'RET Vida',
      Descricao: 'Relacionamento estratégico de clientes',
      Aba: 'BASE_RET',
      Icone: 'escudo',
      Ordem: 1,
      Ativo: true
    },
    {
      Nome: 'Mesa Diamante',
      Descricao: 'Atendimento a casos prioritários',
      Aba: 'BASE_MESA',
      Icone: 'diamante',
      Ordem: 2,
      Ativo: true
    }
  ]);
  contagem.mesas = mesas.length;
  var idRet = mesas[0]['Id'];
  var idMesa = mesas[1]['Id'];

  // --- catálogo por mesa ----------------------------------------------------
  var itens = [];
  ['Em tratativa', 'Aguardando segurado', 'Não tratado', 'Retorno agendado',
   'Concluído'].forEach(function (nome, i) {
    itens.push(novoItemDeCatalogo_('STATUS', idRet, nome, i + 1));
  });
  ['Transmissão pendente', 'Pendente', '1º contato realizado',
   '2º contato realizado', 'Não trabalhado', 'Concluído'].forEach(function (nome, i) {
    itens.push(novoItemDeCatalogo_('STATUS', idMesa, nome, i + 1));
  });
  ['Diamante', 'Demais corretoras', 'Não encontrado'].forEach(function (nome, i) {
    itens.push(novoItemDeCatalogo_('SEGMENTO', '', nome, i + 1));
  });
  contagem.catalogo = inserirVariosRegistros_('CATALOGO', itens).length +
    contagem.niveis + contagem.cargos;

  // --- campos do formulário -------------------------------------------------
  // Gerados a partir do contrato: é isto que faz CAMPOS ser o mapa
  // campo ↔ coluna, e não uma segunda verdade que diverge da planilha.
  var campos = []
    .concat(camposDoFormularioDaBase_('BASE_RET', idRet))
    .concat(camposDoFormularioDaBase_('BASE_MESA', idMesa));
  contagem.campos = inserirVariosRegistros_('CAMPOS', campos).length;

  // --- configuração ---------------------------------------------------------
  var config = inserirVariosRegistros_('CONFIG', [
    novaConfiguracao_('IDENTIDADE.NOME', 'RECC',
      'Nome exibido na barra superior. Editável.'),
    novaConfiguracao_('IDENTIDADE.NOME_LONGO',
      'Relacionamento Estratégico de Clientes e Corretores',
      'Subtítulo da barra superior.'),
    novaConfiguracao_('IDENTIDADE.OPERACAO', 'Porto Seguro',
      'Operação atendida por esta instalação.'),
    novaConfiguracao_('IDENTIDADE.LOGO_URL', '',
      'URL da logo exibida na tela de usuário não cadastrado.'),
    novaConfiguracao_('IDENTIDADE.COR_PRIMARIA', '#0B77CE',
      'Cor do tema Padrão.'),
    novaConfiguracao_('OPERACAO.JANELA_DIAS', '30',
      'Quantos dias a fila de trabalho carrega. Acima disso, use Buscar Caso.'),
    novaConfiguracao_('OPERACAO.TEMA_PADRAO', 'padrao',
      'padrao | rosa | dark | brasil'),
    novaConfiguracao_('MENU.TITULOS', JSON.stringify({
      dashboard: 'Dashboard',
      cadastrarCaso: 'Cadastrar Caso',
      minhaPerformance: 'Minha Performance',
      buscarCaso: 'Buscar Caso',
      tabelaCorretoras: 'Tabela de Corretoras',
      painelAnalitico: 'Painel Analítico',
      configuracoes: 'Configurações'
    }), 'Nome de cada tela no menu lateral. Editável.')
  ]);
  contagem.config = config.length;

  // --- primeiro administrador ----------------------------------------------
  inserirVariosRegistros_('USUARIOS', [{
    Nome: emailDoInstalador.split('@')[0],
    Email: emailDoInstalador,
    'Canal que atende': '',
    CargoId: idCargoAdm,
    NivelAcessoId: idAdministrador,
    Matricula: '',
    Ativo: true,
    DataCadastro: new Date(),
    UltimoAcesso: ''
  }]);

  return contagem;
}

function novoNivelDeAcesso_(nome, ordem, escopo, tudoLiberado, telas) {
  return {
    MesaId: '',
    Tipo: 'NIVEL_ACESSO',
    Codigo: '',
    Nome: nome,
    Rotulo: nome,
    PaiId: '',
    Cor: '',
    Ordem: ordem,
    Ativo: true,
    Configuracao: JSON.stringify({
      escopo: escopo,
      telas: telas,
      acoes: tudoLiberado
        ? ['criar', 'editar', 'ocultar', 'exportar', 'configurar', 'estrutura']
        : ['criar', 'editar', 'exportar'],
      campos: {},
      widgets: {}
    })
  };
}

function novoItemDeCatalogo_(tipo, mesaId, nome, ordem) {
  return {
    MesaId: mesaId,
    Tipo: tipo,
    Codigo: '',
    Nome: nome,
    Rotulo: nome,
    PaiId: '',
    Cor: '',
    Ordem: ordem,
    Ativo: true,
    Configuracao: ''
  };
}

function novaConfiguracao_(chave, valor, descricao) {
  return {
    Chave: chave,
    Valor: valor,
    Descricao: descricao,
    AtualizadoPor: '',
    Data: new Date()
  };
}

/**
 * Um campo de formulário para cada coluna da base.
 *
 * As colunas de controle (_Visivel e companhia) ficam de fora: elas são do
 * sistema, não do formulário. A coluna Id entra desativada — precisa estar no
 * mapa, mas ninguém digita um Id.
 */
function camposDoFormularioDaBase_(nomeDaAba, mesaId) {
  var esquema = esquemaDaAba_(nomeDaAba);
  var campos = [];
  var ordem = 0;

  esquema.colunas.forEach(function (coluna) {
    if (coluna.cabecalho.charAt(0) === '_') return;

    var chave = normalizarParaComparar_(coluna.cabecalho);
    var ehId = (chave === 'id');
    var ehCpf = chave.indexOf('cpf') >= 0 || chave.indexOf('documento') >= 0;
    ordem++;

    campos.push({
      MesaId: mesaId,
      Aba: nomeDaAba,
      ChaveTecnica: chave,
      Cabecalho: coluna.cabecalho,
      Rotulo: coluna.cabecalho,
      Descricao: '',
      TipoCampo: RECC_DO_DADO_PARA_O_CAMPO[coluna.tipo] || 'texto',
      Secao: 'Geral',
      Mascara: ehCpf ? '000.000.000-00' : '',
      Obrigatorio: false,
      Protegido: coluna.protegido === true,
      Ativo: !ehId,
      Ordem: ordem,
      VisivelPara: '',
      ValorPadrao: '',
      Configuracao: ''
    });
  });

  return campos;
}

// ============================================================================
// CONFERÊNCIA — para rodar no editor depois de publicar
// ============================================================================

/**
 * Confere a estrutura encontrada contra o contrato. Só LÊ.
 * Nenhum teste rodado fora do Apps Script pega uma aba que ficou para trás.
 */
function verificarEstruturaRECC() {
  var laudo = conferirEstrutura_();
  var linhas = [laudo.ok ? 'ESTRUTURA OK' : 'ESTRUTURA INCOMPLETA', ''];

  laudo.abas.forEach(function (item) {
    if (!item.existe) {
      linhas.push('FALTA A ABA  ' + item.aba);
      return;
    }
    var estado = item.faltando.length ? 'FALTA COLUNA' : 'ok          ';
    linhas.push(estado + ' ' + item.aba + '  (' + item.linhas + ' linhas)');
    if (item.faltando.length) {
      linhas.push('             faltando: ' + item.faltando.join(' | '));
    }
    if (item.aMais.length) {
      linhas.push('             fora do contrato (respeitadas): ' +
        item.aMais.join(' | '));
    }
  });

  var orcamento = orcamentoDeCelulas_(planilhaAtiva_());
  linhas.push('');
  linhas.push('Células: ' + orcamento.usadas.toLocaleString('pt-BR') + ' de ' +
    RECC_TETO_DE_CELULAS.toLocaleString('pt-BR') + ' (' + orcamento.percentual + '%)');

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Quanto do teto de 10 milhões de células a planilha já ocupa.
 * Conta a GRADE, não o preenchimento: célula vazia também pesa.
 */
function orcamentoDeCelulas_(planilha) {
  var usadas = 0;
  planilha.getSheets().forEach(function (aba) {
    usadas += aba.getMaxRows() * aba.getMaxColumns();
  });
  return {
    usadas: usadas,
    percentual: Math.round((usadas / RECC_TETO_DE_CELULAS) * 1000) / 10
  };
}
