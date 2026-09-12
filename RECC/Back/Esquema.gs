/**
 * ============================================================================
 * RECC — Esquema.gs · o contrato das abas
 * ============================================================================
 * Plataforma PGO (Pelitero Labs) · operação RECC (Porto Seguro)
 *
 * Este arquivo é só declaração: nomes de aba, cabeçalhos e tipos. Não chama
 * nada e não depende de nenhum outro arquivo — pode ser lido primeiro sem
 * risco.
 *
 * COMO LER
 * --------
 *   c = o Cabeçalho, exatamente como aparece na linha 1 da planilha
 *   t = o Tipo do dado, que decide o formato da célula
 *   p = Protegido: a interface não renomeia nem exclui (no máximo esconde)
 *
 * O cabeçalho é o contrato — não a posição da coluna. Reordenar colunas na
 * planilha não quebra nada. Ver Planilha.gs.
 * ============================================================================
 */

/**
 * Os tipos de dado. Cada um decide, e isso é o ponto do arquivo inteiro,
 * COMO a célula é formatada antes de receber o valor.
 *
 *   ID       0000000010 precisa continuar 0000000010, e não virar o número 10
 *   DINHEIRO a célula guarda 1234.56 e MOSTRA R$ 1.234,56 — formato, não texto
 *   DATA     data de verdade, para o Power BI filtrar sem conversão
 */
const RECC_TIPO = {
  ID: 'id',
  TEXTO: 'texto',
  TEXTO_LONGO: 'textoLongo',
  DATA: 'data',
  HORA: 'hora',
  DATA_HORA: 'dataHora',
  DINHEIRO: 'dinheiro',
  NUMERO: 'numero',
  BOOLEANO: 'booleano'
};

/** O formato de célula de cada tipo. Aplicado na linha ANTES de gravar. */
const RECC_FORMATO = {
  id: '@',
  texto: '@',
  textoLongo: '@',
  data: 'dd/MM/yyyy',
  hora: 'HH:mm',
  dataHora: 'dd/MM/yyyy HH:mm',
  dinheiro: '"R$ "#,##0.00',
  numero: '#,##0.##',
  booleano: '@'
};

/** Fuso da operação. O Apps Script roda em UTC e viraria o dia às 21 h. */
const RECC_FUSO = 'America/Sao_Paulo';

/** Maior Id possível: 10 casas decimais. */
const RECC_ID_MAXIMO = 9999999999;

/**
 * Colunas de controle, acrescentadas ao FIM das abas de dado.
 *
 * O prefixo "_" marca coluna de sistema e sinaliza ao Power BI o que ignorar.
 * `_Visivel` é editável na mão, direto na planilha: é assim que uma linha
 * ocultada volta a aparecer.
 */
const RECC_CONTROLE = [
  { c: '_Visivel',     t: 'texto',    p: true },
  { c: '_ExcluidoEm',  t: 'dataHora', p: true },
  { c: '_ExcluidoPor', t: 'id',       p: true },
  { c: '_Origem',      t: 'texto',    p: true }
];

const RECC_VISIVEL_SIM = 'SIM';
const RECC_VISIVEL_NAO = 'NAO';
const RECC_ORIGEM_SISTEMA = 'SISTEMA';
const RECC_ORIGEM_PLANILHA = 'PLANILHA';

/**
 * As 12 abas.
 *
 * `controle: true`  → recebe as colunas _Visivel / _ExcluidoEm / _ExcluidoPor /
 *                     _Origem, e exclusão vira ocultação.
 * `reserva`         → quantas linhas a aba nasce tendo. Célula vazia também
 *                     consome o teto de 10 milhões da planilha, então o
 *                     instalador corta o que sobra. Ver Instalador.gs.
 */
const RECC_ESQUEMA = {

  // ------------------------------------------------------------------ bases
  BASE_RET: {
    aba: 'BASE_RET',
    titulo: 'Retenção Vida',
    controle: true,
    reserva: 2000,
    colunas: [
      { c: 'id',                            t: 'id',         p: true },
      { c: 'data de recepção do protocolo', t: 'data',       p: true },
      { c: 'analista',                      t: 'texto',      p: true },
      { c: 'SUSEP',                         t: 'id',         p: true },
      { c: 'segmento',                      t: 'texto',      p: true },
      { c: 'Código origem da proposta',     t: 'id',         p: true },
      { c: 'número da proposta',            t: 'id',         p: true },
      { c: 'nome do cliente',               t: 'texto',      p: true },
      { c: 'cod produto',                   t: 'id',         p: true },
      { c: 'produto',                       t: 'texto',      p: true },
      { c: 'grupo',                         t: 'texto',      p: true },
      { c: 'sistema',                       t: 'texto',      p: true },
      { c: 'valor do prêmio',               t: 'dinheiro',   p: true },
      { c: 'valor do prêmio retido',        t: 'dinheiro',   p: true },
      { c: 'prêmio mensal retido',          t: 'dinheiro',   p: true },
      { c: 'agente da central',             t: 'texto',      p: true },
      { c: 'canal',                         t: 'texto',      p: true },
      { c: 'relacionamento',                t: 'texto',      p: true },
      { c: 'contato',                       t: 'texto',      p: true },
      { c: 'protocolo',                     t: 'id',         p: true },
      { c: 'cod_sucursal',                  t: 'id',         p: true },
      { c: 'cod_ramo',                      t: 'id',         p: true },
      { c: 'Num_apolice',                   t: 'id',         p: true },
      { c: 'CPF',                           t: 'id',         p: true },
      { c: 'status',                        t: 'texto',      p: true },
      { c: 'Forma de pagamento',            t: 'texto',      p: true },
      { c: 'dados do pagamento',            t: 'texto',      p: true },
      { c: 'descrição',                     t: 'textoLongo', p: true },
      { c: 'telefones de contato',          t: 'id',         p: true },
      { c: 'e-mail',                        t: 'texto',      p: true },
      { c: 'Novo cod origem proposta',      t: 'id',         p: true },
      { c: 'novo numero da proposta',       t: 'id',         p: true },
      { c: 'motivo do cancelamento',        t: 'texto',      p: true },
      { c: 'data da transmissão',           t: 'data',       p: true },
      { c: 'tentativas de contato',         t: 'numero',     p: true }
    ]
  },

  BASE_MESA: {
    aba: 'BASE_MESA',
    titulo: 'Mesa Diamante',
    controle: true,
    reserva: 2000,
    colunas: [
      { c: 'ID',                     t: 'id',        p: true },
      { c: 'Analista',               t: 'texto',     p: true },
      { c: 'Status',                 t: 'texto',     p: true },
      { c: 'Canal',                  t: 'texto',     p: true },
      { c: 'Data de entrada',        t: 'data',      p: true },
      { c: 'Horário',                t: 'hora',      p: true },
      { c: 'Tipo',                   t: 'texto',     p: true },
      { c: 'Abertura indevida',      t: 'booleano',  p: true },
      { c: 'Título do e-mail',       t: 'texto',     p: true },
      { c: 'Nome do segurado',       t: 'texto',     p: true },
      { c: 'Documento (CPF)',        t: 'id',        p: true },
      { c: 'Corretora',              t: 'texto',     p: true },
      { c: 'SUSEP',                  t: 'id',        p: true },
      { c: 'Ramo',                   t: 'texto',     p: true },
      { c: 'Assunto',                t: 'texto',     p: true },
      { c: 'Área responsável',       t: 'texto',     p: true },
      { c: 'Data resposta',          t: 'data',      p: true },
      { c: 'Hora resposta',          t: 'hora',      p: true },
      { c: 'Data da finalização',    t: 'data',      p: true },
      { c: 'horário da finalização', t: 'hora',      p: true }
    ]
  },

  // -------------------------------------------------------------- cadastros
  USUARIOS: {
    aba: 'USUARIOS',
    titulo: 'Usuários',
    controle: true,
    reserva: 300,
    colunas: [
      { c: 'Id',               t: 'id',       p: true },
      { c: 'Nome',             t: 'texto',    p: true },
      { c: 'Email',            t: 'texto',    p: true },
      { c: 'Canal que atende', t: 'texto',    p: false },
      { c: 'CargoId',          t: 'id',       p: true },
      { c: 'NivelAcessoId',    t: 'id',       p: true },
      { c: 'Matricula',        t: 'id',       p: false },
      { c: 'Ativo',            t: 'booleano', p: true },
      { c: 'DataCadastro',     t: 'dataHora', p: true },
      { c: 'UltimoAcesso',     t: 'dataHora', p: true }
    ]
  },

  CANAIS: {
    aba: 'CANAIS',
    titulo: 'Canais, corretores e agentes',
    controle: true,
    reserva: 1000,
    colunas: [
      { c: 'Id',        t: 'id',    p: true },
      { c: 'Nome',      t: 'texto', p: true },
      { c: 'Canal',     t: 'texto', p: true },
      { c: 'SUSEP',     t: 'id',    p: true },
      { c: 'Corretora', t: 'texto', p: true },
      { c: 'Segmento',  t: 'texto', p: true }
    ]
  },

  // Código e descrição NUNCA dividem a mesma célula. Vale aqui e vale para
  // proposta, sucursal, ramo e apólice nas bases.
  PRODUTOS: {
    aba: 'PRODUTOS',
    titulo: 'Produtos',
    controle: true,
    reserva: 500,
    colunas: [
      { c: 'Id',            t: 'id',    p: true },
      { c: 'Produto',       t: 'texto', p: true },
      { c: 'CodigoProduto', t: 'id',    p: true }
    ]
  },

  SUSEP_BLOQUEADAS: {
    aba: 'SUSEP_BLOQUEADAS',
    titulo: 'SUSEPs bloqueadas',
    controle: true,
    reserva: 500,
    colunas: [
      { c: 'Id',             t: 'id',    p: true },
      { c: 'SUSEP',          t: 'id',    p: true },
      { c: 'NomeCorretora',  t: 'texto', p: true },
      { c: 'CpfReincidente', t: 'id',    p: true },
      { c: 'Motivo',         t: 'texto', p: false },
      { c: 'BloqueadaEm',    t: 'data',  p: false }
    ]
  },

  // ---------------------------------------------------------------- sistema
  MESAS: {
    aba: 'MESAS',
    titulo: 'Mesas de trabalho',
    controle: false,
    reserva: 50,
    colunas: [
      { c: 'Id',        t: 'id',       p: true },
      { c: 'Nome',      t: 'texto',    p: true },
      { c: 'Descricao', t: 'texto',    p: false },
      { c: 'Aba',       t: 'texto',    p: true },
      { c: 'Icone',     t: 'texto',    p: false },
      { c: 'Ordem',     t: 'numero',   p: false },
      { c: 'Ativo',     t: 'booleano', p: true }
    ]
  },

  CAMPOS: {
    aba: 'CAMPOS',
    titulo: 'Campos do formulário',
    controle: false,
    reserva: 500,
    colunas: [
      { c: 'Id',           t: 'id',       p: true },
      { c: 'MesaId',       t: 'id',       p: true },
      { c: 'Aba',          t: 'texto',    p: true },
      { c: 'ChaveTecnica', t: 'texto',    p: true },
      { c: 'Cabecalho',    t: 'texto',    p: true },
      { c: 'Rotulo',       t: 'texto',    p: false },
      { c: 'Descricao',    t: 'texto',    p: false },
      { c: 'TipoCampo',    t: 'texto',    p: true },
      { c: 'Secao',        t: 'texto',    p: false },
      { c: 'Mascara',      t: 'texto',    p: false },
      { c: 'Obrigatorio',  t: 'booleano', p: false },
      { c: 'Protegido',    t: 'booleano', p: true },
      { c: 'Ativo',        t: 'booleano', p: false },
      { c: 'Ordem',        t: 'numero',   p: false },
      { c: 'VisivelPara',  t: 'texto',    p: false },
      { c: 'ValorPadrao',  t: 'texto',    p: false },
      { c: 'Configuracao', t: 'textoLongo', p: false }
    ]
  },

  CATALOGO: {
    aba: 'CATALOGO',
    titulo: 'Catálogo',
    controle: false,
    reserva: 1000,
    colunas: [
      { c: 'Id',           t: 'id',         p: true },
      { c: 'MesaId',       t: 'id',         p: false },
      { c: 'Tipo',         t: 'texto',      p: true },
      { c: 'Codigo',       t: 'id',         p: false },
      { c: 'Nome',         t: 'texto',      p: true },
      { c: 'Rotulo',       t: 'texto',      p: false },
      { c: 'PaiId',        t: 'id',         p: false },
      { c: 'Cor',          t: 'texto',      p: false },
      { c: 'Ordem',        t: 'numero',     p: false },
      { c: 'Ativo',        t: 'booleano',   p: false },
      { c: 'Configuracao', t: 'textoLongo', p: false }
    ]
  },

  PAINEIS: {
    aba: 'PAINEIS',
    titulo: 'Painéis',
    controle: false,
    reserva: 300,
    colunas: [
      { c: 'Id',             t: 'id',         p: true },
      { c: 'Tela',           t: 'texto',      p: true },
      { c: 'MesaId',         t: 'id',         p: false },
      { c: 'Titulo',         t: 'texto',      p: false },
      { c: 'TipoWidget',     t: 'texto',      p: true },
      { c: 'CampoDimensao',  t: 'texto',      p: false },
      { c: 'CampoMedida',    t: 'texto',      p: false },
      { c: 'Agregacao',      t: 'texto',      p: false },
      { c: 'Limite',         t: 'numero',     p: false },
      { c: 'Filtro',         t: 'textoLongo', p: false },
      { c: 'Ordem',          t: 'numero',     p: false },
      { c: 'Largura',        t: 'numero',     p: false },
      { c: 'VisivelPara',    t: 'texto',      p: false },
      { c: 'Ativo',          t: 'booleano',   p: false }
    ]
  },

  CONFIG: {
    aba: 'CONFIG',
    titulo: 'Configurações',
    controle: false,
    reserva: 200,
    colunas: [
      { c: 'Id',           t: 'id',         p: true },
      { c: 'Chave',        t: 'texto',      p: true },
      { c: 'Valor',        t: 'textoLongo', p: false },
      { c: 'Descricao',    t: 'texto',      p: false },
      { c: 'AtualizadoPor', t: 'id',        p: false },
      { c: 'Data',         t: 'dataHora',   p: false }
    ]
  },

  AUDITORIA: {
    aba: 'AUDITORIA',
    titulo: 'Auditoria',
    controle: false,
    reserva: 2000,
    colunas: [
      { c: 'Id',         t: 'id',         p: true },
      { c: 'DataHora',   t: 'dataHora',   p: true },
      { c: 'UsuarioId',  t: 'id',         p: true },
      { c: 'Acao',       t: 'texto',      p: true },
      { c: 'Entidade',   t: 'texto',      p: false },
      { c: 'RegistroId', t: 'id',         p: false },
      { c: 'Detalhe',    t: 'textoLongo', p: false }
    ]
  }
};

/**
 * A ponte entre o tipo de DADO da coluna e o tipo de CAMPO do formulário.
 *
 * Existem os dois porque respondem a perguntas diferentes: o tipo de dado
 * decide o formato da célula; o tipo de campo decide o controle que aparece
 * na tela. "moeda" e "dinheiro" são a mesma coisa vista de dois lados.
 */
const RECC_TIPO_CAMPO = {
  id: 'identificador',
  texto: 'texto',
  textoLongo: 'textoLongo',
  data: 'data',
  hora: 'hora',
  dataHora: 'dataHora',
  dinheiro: 'moeda',
  numero: 'numero',
  booleano: 'simNao'
};

/** O caminho de volta, com os apelidos que a configuração aceita. */
const RECC_CAMPO_TIPO = {
  identificador: 'id',
  documento: 'id',
  telefone: 'id',
  texto: 'texto',
  textoLongo: 'textoLongo',
  email: 'texto',
  seletor: 'texto',
  seletorMultiplo: 'texto',
  data: 'data',
  hora: 'hora',
  dataHora: 'dataHora',
  moeda: 'dinheiro',
  numero: 'numero',
  percentual: 'numero',
  simNao: 'booleano'
};

/** Prefixo reservado das abas geradas pelo gerador de análise. */
const RECC_PREFIXO_ANALISE = 'ANALISE_';

/**
 * A definição de uma aba, com as colunas de controle já anexadas.
 * É esta lista, e não `RECC_ESQUEMA[x].colunas`, que representa a aba inteira.
 */
function reccEsquemaDaAba_(nomeAba) {
  var def = RECC_ESQUEMA[nomeAba];
  if (!def) {
    throw new Error('Aba "' + nomeAba + '" não faz parte do esquema do RECC.');
  }
  var colunas = def.colunas.slice();
  if (def.controle) {
    for (var i = 0; i < RECC_CONTROLE.length; i++) colunas.push(RECC_CONTROLE[i]);
  }
  return {
    aba: def.aba,
    titulo: def.titulo,
    controle: def.controle,
    reserva: def.reserva,
    colunas: colunas
  };
}

/** Os nomes das abas do contrato, na ordem em que o instalador as cria. */
function reccNomesDasAbas_() {
  return Object.keys(RECC_ESQUEMA);
}
