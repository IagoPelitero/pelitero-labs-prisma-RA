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

const RECC_TETO_CELULAS = 10000000;

/** Ponto de entrada da instalação. */
function instalarRECC() {
  var ss = plPlanilha_();
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Não foi possível identificar o e-mail de quem está ' +
      'executando. Rode instalarRECC() pelo editor do Apps Script, ' +
      'autorizando o script.');
  }

  instAbortarSeTiverDado_(ss);

  ss.setSpreadsheetTimeZone(RECC_FUSO);
  plLimparCache_();

  var criadas = [];
  reccNomesDasAbas_().forEach(function (nomeAba) {
    criadas.push(instPrepararAba_(ss, reccEsquemaDaAba_(nomeAba)));
  });
  plLimparCache_();

  var semente = instSemear_(email);
  var orcamento = instOrcamentoDeCelulas_(ss);

  var laudo = [
    'RECC instalado.',
    '',
    'Abas criadas: ' + criadas.length,
    'Primeiro administrador: ' + email,
    'Fuso da planilha: ' + ss.getSpreadsheetTimeZone(),
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
      ' de ' + RECC_TETO_CELULAS.toLocaleString('pt-BR') +
      ' (' + orcamento.percentual + '%)',
    '',
    'Próximo passo: abrir Configurações › Segurança e definir a senha de ADM.'
  ].join('\n');

  Logger.log(laudo);
  return laudo;
}

/** Instalação sobre planilha em uso não existe. */
function instAbortarSeTiverDado_(ss) {
  var comDado = [];
  reccNomesDasAbas_().forEach(function (nomeAba) {
    var aba = ss.getSheetByName(nomeAba);
    if (!aba) return;
    var preenchidas = instLinhasPreenchidas_(aba);
    if (preenchidas > 0) comDado.push(nomeAba + ' (' + preenchidas + ' linhas)');
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
function instLinhasPreenchidas_(aba) {
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
function instPrepararAba_(ss, def) {
  var aba = ss.getSheetByName(def.aba);
  if (!aba) aba = ss.insertSheet(def.aba);

  var largura = def.colunas.length;
  var altura = def.reserva + 1;

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

  var cabecalhos = def.colunas.map(function (c) { return c.c; });
  var linha1 = aba.getRange(1, 1, 1, largura);
  linha1.setNumberFormat('@');
  linha1.setValues([cabecalhos]);
  linha1.setFontWeight('bold');
  aba.setFrozenRows(1);

  // Pré-formata a área de dados coluna a coluna. Assim até uma linha digitada
  // à mão, sem passar pelo sistema, já cai na célula com o formato certo.
  for (var i = 0; i < def.colunas.length; i++) {
    var formato = RECC_FORMATO[def.colunas[i].t] || '@';
    aba.getRange(2, i + 1, def.reserva, 1).setNumberFormat(formato);
  }

  return def.aba;
}

// ============================================================================
// SEMENTE — padrão, nunca fixado. Tudo editável e excluível depois.
// ============================================================================

function instSemear_(emailDoInstalador) {
  var contagem = { niveis: 0, cargos: 0, catalogo: 0, mesas: 0, campos: 0, config: 0 };

  // --- níveis de acesso -----------------------------------------------------
  // O nível é a unidade de permissão: telas, campos, widgets, ações e escopo
  // saem DAQUI. O cargo é só o rótulo organizacional.
  var niveis = plInserirVarios_('CATALOGO', [
    instNivel_('Administrador', 1, 'TODOS', true,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras', 'painelAnalitico', 'configuracoes']),
    instNivel_('Coordenação', 2, 'TODOS', false,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras', 'painelAnalitico']),
    instNivel_('Operação', 3, 'PROPRIOS', false,
      ['dashboard', 'cadastrarCaso', 'minhaPerformance', 'buscarCaso',
       'tabelaCorretoras']),
    instNivel_('Consulta', 4, 'TODOS', false,
      ['dashboard', 'buscarCaso', 'painelAnalitico'])
  ]);
  contagem.niveis = niveis.length;
  var idAdministrador = niveis[0]['Id'];

  // --- cargos ---------------------------------------------------------------
  var cargos = plInserirVarios_('CATALOGO', [
    instItem_('CARGO', '', 'Analista RET', 1),
    instItem_('CARGO', '', 'Analista Mesa Diamante', 2),
    instItem_('CARGO', '', 'ADM', 3),
    instItem_('CARGO', '', 'Coordenação', 4),
    instItem_('CARGO', '', 'Analista Sênior', 5)
  ]);
  contagem.cargos = cargos.length;
  var idCargoAdm = cargos[2]['Id'];

  // --- mesas ----------------------------------------------------------------
  var mesas = plInserirVarios_('MESAS', [
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
    itens.push(instItem_('STATUS', idRet, nome, i + 1));
  });
  ['Transmissão pendente', 'Pendente', '1º contato realizado',
   '2º contato realizado', 'Não trabalhado', 'Concluído'].forEach(function (nome, i) {
    itens.push(instItem_('STATUS', idMesa, nome, i + 1));
  });
  ['Diamante', 'Demais corretoras', 'Não encontrado'].forEach(function (nome, i) {
    itens.push(instItem_('SEGMENTO', '', nome, i + 1));
  });
  contagem.catalogo = plInserirVarios_('CATALOGO', itens).length +
    contagem.niveis + contagem.cargos;

  // --- campos do formulário -------------------------------------------------
  // Gerados a partir do contrato: é isto que faz CAMPOS ser o mapa
  // campo ↔ coluna, e não uma segunda verdade que diverge da planilha.
  var campos = []
    .concat(instCamposDaBase_('BASE_RET', idRet))
    .concat(instCamposDaBase_('BASE_MESA', idMesa));
  contagem.campos = plInserirVarios_('CAMPOS', campos).length;

  // --- configuração ---------------------------------------------------------
  var config = plInserirVarios_('CONFIG', [
    instConfig_('IDENTIDADE.NOME', 'RECC',
      'Nome exibido na barra superior. Editável.'),
    instConfig_('IDENTIDADE.NOME_LONGO',
      'Relacionamento Estratégico de Clientes e Corretores',
      'Subtítulo da barra superior.'),
    instConfig_('IDENTIDADE.OPERACAO', 'Porto Seguro',
      'Operação atendida por esta instalação.'),
    instConfig_('IDENTIDADE.LOGO_URL', '',
      'URL da logo exibida na tela de usuário não cadastrado.'),
    instConfig_('IDENTIDADE.COR_PRIMARIA', '#0F56D6',
      'Cor do tema Padrão.'),
    instConfig_('OPERACAO.JANELA_DIAS', '30',
      'Quantos dias a fila de trabalho carrega. Acima disso, use Buscar Caso.'),
    instConfig_('OPERACAO.TEMA_PADRAO', 'padrao',
      'padrao | rosa | dark | brasil'),
    instConfig_('MENU.TITULOS', JSON.stringify({
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
  plInserirVarios_('USUARIOS', [{
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

function instNivel_(nome, ordem, escopo, tudoLiberado, telas) {
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

function instItem_(tipo, mesaId, nome, ordem) {
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

function instConfig_(chave, valor, descricao) {
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
function instCamposDaBase_(nomeAba, mesaId) {
  var def = reccEsquemaDaAba_(nomeAba);
  var campos = [];
  var ordem = 0;

  def.colunas.forEach(function (col) {
    if (col.c.charAt(0) === '_') return;

    var chave = plNormalizar_(col.c);
    var ehId = (chave === 'id');
    var ehCpf = chave.indexOf('cpf') >= 0 || chave.indexOf('documento') >= 0;
    ordem++;

    campos.push({
      MesaId: mesaId,
      Aba: nomeAba,
      ChaveTecnica: chave,
      Cabecalho: col.c,
      Rotulo: col.c,
      Descricao: '',
      TipoCampo: RECC_TIPO_CAMPO[col.t] || 'texto',
      Secao: 'Geral',
      Mascara: ehCpf ? '000.000.000-00' : '',
      Obrigatorio: false,
      Protegido: col.p === true,
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
  var laudo = plConferirEstrutura_();
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

  var orcamento = instOrcamentoDeCelulas_(plPlanilha_());
  linhas.push('');
  linhas.push('Células: ' + orcamento.usadas.toLocaleString('pt-BR') + ' de ' +
    RECC_TETO_CELULAS.toLocaleString('pt-BR') + ' (' + orcamento.percentual + '%)');

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Quanto do teto de 10 milhões de células a planilha já ocupa.
 * Conta a GRADE, não o preenchimento: célula vazia também pesa.
 */
function instOrcamentoDeCelulas_(ss) {
  var usadas = 0;
  ss.getSheets().forEach(function (aba) {
    usadas += aba.getMaxRows() * aba.getMaxColumns();
  });
  return {
    usadas: usadas,
    percentual: Math.round((usadas / RECC_TETO_CELULAS) * 1000) / 10
  };
}
