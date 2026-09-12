/**
 * ============================================================================
 * RECC — rodar.js · a suíte da Etapa 1 (Fundação)
 * ============================================================================
 *   node RECC/Testes/rodar.js
 *
 * Carrega os arquivos .gs num ambiente que converte valores igual ao Google
 * Planilhas (ver sandbox.js) e prova, uma a uma, as regras que sustentam a
 * integridade do dado.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarAmbiente } = require('./sandbox');

const PASTA_BACK = path.join(__dirname, '..', 'Back');
const ARQUIVOS = ['Esquema.gs', 'Planilha.gs', 'Sequencia.gs', 'Instalador.gs'];

function carregar(email) {
  const ambiente = criarAmbiente(email);
  const contexto = vm.createContext(ambiente.globais);
  // Ordem alfabética: é a ordem em que o Apps Script avalia os arquivos.
  ARQUIVOS.slice().sort().forEach((nome) => {
    const codigo = fs.readFileSync(path.join(PASTA_BACK, nome), 'utf8');
    vm.runInContext(codigo, contexto, { filename: nome });
  });
  return { ambiente, contexto, chamar: (expr) => vm.runInContext(expr, contexto) };
}

// ---------------------------------------------------------------- framework
let passaram = 0;
const falhas = [];

function teste(nome, corpo) {
  try {
    corpo();
    passaram++;
    console.log('  ok   ' + nome);
  } catch (erro) {
    falhas.push({ nome, erro });
    console.log('  FALHA ' + nome + '\n        ' + erro.message);
  }
}

function igual(obtido, esperado, oQue) {
  if (obtido !== esperado) {
    throw new Error((oQue || 'valor') + ': esperado ' + JSON.stringify(esperado) +
      ', obtido ' + JSON.stringify(obtido) + ' (' + typeof obtido + ')');
  }
}

/**
 * Date criado dentro do vm tem outro prototype que o Date daqui, então
 * `instanceof Date` mente. A pergunta que atravessa contextos é esta.
 */
function ehData(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function verdadeiro(condicao, oQue) {
  if (!condicao) throw new Error(oQue || 'condição falsa');
}

function lanca(fn, trecho, oQue) {
  try {
    fn();
  } catch (e) {
    if (trecho && e.message.indexOf(trecho) < 0) {
      throw new Error((oQue || '') + ': erro veio com outra mensagem — ' + e.message);
    }
    return;
  }
  throw new Error((oQue || 'esperava erro') + ', mas nada foi lançado');
}

/** Lê a célula crua do simulador, sem passar pelo produto. */
function celula(planilha, aba, linha, cabecalho) {
  const folha = planilha.getSheetByName(aba);
  const cabecalhos = folha.getRange(1, 1, 1, folha.getMaxColumns()).getValues()[0];
  const c = cabecalhos.indexOf(cabecalho);
  if (c < 0) throw new Error('Cabeçalho "' + cabecalho + '" não existe em ' + aba);
  return folha.getRange(linha, c + 1).getValue();
}

function formatoDaCelula(planilha, aba, linha, cabecalho) {
  const folha = planilha.getSheetByName(aba);
  const cabecalhos = folha.getRange(1, 1, 1, folha.getMaxColumns()).getValues()[0];
  const c = cabecalhos.indexOf(cabecalho);
  return folha.getRange(linha, c + 1).getNumberFormats()[0][0];
}

// ================================================================== a suíte
console.log('\nRECC — Etapa 1 · Fundação\n');

const { ambiente, chamar } = carregar('primeiro.adm@exemplo.com');
const planilha = ambiente.planilha;

console.log('Instalação');

teste('instalarRECC cria as 12 abas do contrato', () => {
  chamar('instalarRECC()');
  const nomes = planilha.getSheets().map((a) => a.getName()).sort();
  const esperadas = chamar('reccNomesDasAbas_()').slice().sort();
  igual(nomes.join(','), esperadas.join(','), 'abas criadas');
});

teste('cada aba é cortada ao tamanho do contrato', () => {
  const base = planilha.getSheetByName('BASE_RET');
  igual(base.getMaxColumns(), 39, 'colunas de BASE_RET (35 + 4 de controle)');
  igual(base.getMaxRows(), 2001, 'linhas de BASE_RET (reserva 2000 + cabeçalho)');
  const mesa = planilha.getSheetByName('BASE_MESA');
  igual(mesa.getMaxColumns(), 24, 'colunas de BASE_MESA (20 + 4 de controle)');
});

teste('os cabeçalhos saem na ordem e na grafia do contrato', () => {
  const mesa = planilha.getSheetByName('BASE_MESA');
  const cabecalhos = mesa.getRange(1, 1, 1, 24).getValues()[0];
  igual(cabecalhos[0], 'ID');
  igual(cabecalhos[7], 'Abertura indevida');
  igual(cabecalhos[15], 'Área responsável');
  igual(cabecalhos[19], 'horário da finalização');
  igual(cabecalhos[20], '_Visivel');
});

teste('quem instalou vira o primeiro Administrador', () => {
  const usuarios = chamar('plLer_("USUARIOS")');
  igual(usuarios.length, 1, 'usuários cadastrados');
  igual(usuarios[0].Email, 'primeiro.adm@exemplo.com');
  igual(usuarios[0].Ativo, 'SIM');
  verdadeiro(usuarios[0].NivelAcessoId !== '', 'usuário tem nível de acesso');
});

teste('o formulário nasce mapeado coluna a coluna', () => {
  const campos = chamar('plLer_("CAMPOS")');
  igual(campos.length, 55, 'campos semeados (35 de RET + 20 da Mesa)');
  const cpf = campos.find((c) => c.Cabecalho === 'Documento (CPF)');
  igual(cpf.Mascara, '000.000.000-00', 'máscara do CPF');
  igual(cpf.TipoCampo, 'identificador');
  const id = campos.find((c) => c.Cabecalho === 'ID');
  igual(id.Ativo, 'NAO', 'a coluna Id existe no mapa mas não é campo de tela');
});

teste('instalar de novo sobre base com dado é recusado', () => {
  lanca(() => chamar('instalarRECC()'), 'já tem dado',
    'reinstalação deveria ser recusada');
});

console.log('\nIdentificador — a regra que o sistema anterior quebrou');

teste('o primeiro Id é 0000000000 e é gravado como TEXTO', () => {
  chamar('plInserir_("BASE_MESA", { Analista: "Ana Martins", Status: "Pendente" })');
  const valor = celula(planilha, 'BASE_MESA', 2, 'ID');
  igual(valor, '0000000000', 'primeiro Id');
  igual(typeof valor, 'string', 'tipo do Id na célula');
  igual(formatoDaCelula(planilha, 'BASE_MESA', 2, 'ID'), '@', 'formato da célula');
});

teste('0000000010 continua 0000000010 — não vira o número 10', () => {
  for (let i = 0; i < 10; i++) {
    chamar('plInserir_("BASE_MESA", { Analista: "Carga" })');
  }
  const valor = celula(planilha, 'BASE_MESA', 12, 'ID');
  igual(valor, '0000000010', 'décimo primeiro Id');
  igual(typeof valor, 'string', 'tipo do Id');
});

teste('o simulador realmente corrompe quando o formato é Geral', () => {
  // Prova de que o teste acima tem valor: sem o formato '@' o Sheets converte.
  const aba = planilha.getSheetByName('BASE_MESA');
  aba.getRange(1, 24).setNumberFormat('');
  aba.getRange(1, 24).setValue('000000E1');
  igual(aba.getRange(1, 24).getValue(), 0,
    'notação científica deveria virar 0 numa célula Geral');
  aba.getRange(1, 24).setNumberFormat('@');
  aba.getRange(1, 24).setValue('_Origem');
});

teste('a sequência nunca anda para trás', () => {
  ambiente.propriedades.delete('RECC_SEQ_BASE_MESA');
  const registro = chamar('plInserir_("BASE_MESA", { Analista: "Depois do reset" })');
  igual(registro.ID, '0000000011',
    'após perder o contador, o piso vem do maior Id da aba');
});

teste('Id repetido interrompe em vez de sobrescrever o registro errado', () => {
  const aba = planilha.getSheetByName('BASE_MESA');
  aba.getRange(3, 1).setValue('0000000000');   // duplica o Id da linha 2
  chamar('plLimparCache_()');
  lanca(() => chamar('plAtualizar_("BASE_MESA", "0000000000", { Analista: "X" })'),
    'aparece em 2 linhas', 'deveria recusar a gravação');
  aba.getRange(3, 1).setValue('0000000001');   // desfaz
  chamar('plLimparCache_()');
});

console.log('\nTipos — o que chega na célula');

teste('CPF com máscara é gravado só com dígitos, como texto', () => {
  chamar('plInserir_("BASE_MESA", { Analista: "Ana", "Documento (CPF)": "000.123.456-78" })');
  const linha = planilha.getSheetByName('BASE_MESA').getLastRow();
  const valor = celula(planilha, 'BASE_MESA', linha, 'Documento (CPF)');
  igual(valor, '00012345678', 'CPF sem pontuação e com o zero à esquerda');
  igual(typeof valor, 'string');
});

teste('dinheiro vira número, e o R$ fica no formato da célula', () => {
  chamar('plInserir_("BASE_RET", { analista: "Ana", "valor do prêmio": "R$ 1.234,56" })');
  const valor = celula(planilha, 'BASE_RET', 2, 'valor do prêmio');
  igual(valor, 1234.56, 'valor gravado');
  igual(typeof valor, 'number', 'dinheiro precisa ser número para o Power BI somar');
  igual(formatoDaCelula(planilha, 'BASE_RET', 2, 'valor do prêmio'),
    '"R$ "#,##0.00', 'formato de moeda');
});

teste('data vira Date de verdade', () => {
  chamar('plInserir_("BASE_MESA", { Analista: "Ana", "Data de entrada": "01/10/2026" })');
  const linha = planilha.getSheetByName('BASE_MESA').getLastRow();
  const valor = celula(planilha, 'BASE_MESA', linha, 'Data de entrada');
  verdadeiro(ehData(valor), 'deveria ser Date, veio ' + typeof valor);
  igual(valor.getFullYear(), 2026);
  igual(valor.getMonth(), 9, 'mês (0 = janeiro)');
  igual(valor.getDate(), 1);
});

teste('hora vira hora, ancorada em 1970 e não na época do Sheets', () => {
  chamar('plInserir_("BASE_MESA", { Analista: "Ana", "Horário": "14:30" })');
  const linha = planilha.getSheetByName('BASE_MESA').getLastRow();
  const valor = celula(planilha, 'BASE_MESA', linha, 'Horário');
  verdadeiro(ehData(valor), 'deveria ser Date');
  igual(valor.getHours(), 14);
  igual(valor.getMinutes(), 30);
  igual(valor.getFullYear(), 1970, 'a âncora evita o fuso -03:06:28 de 1899');
});

teste('sim/não é gravado como SIM ou NAO', () => {
  chamar('plInserir_("BASE_MESA", { Analista: "Ana", "Abertura indevida": true })');
  const linha = planilha.getSheetByName('BASE_MESA').getLastRow();
  igual(celula(planilha, 'BASE_MESA', linha, 'Abertura indevida'), 'SIM');
});

teste('vários telefones não viram um número só', () => {
  igual(chamar('plCoagirId_("(11) 99999-1234; (11) 3333-4444")'),
    '11999991234;1133334444');
});

console.log('\nVínculo por cabeçalho — o pedido central');

teste('inserir coluna no meio da planilha não quebra a leitura', () => {
  const aba = planilha.getSheetByName('BASE_MESA');
  const antes = chamar('plLer_("BASE_MESA")');
  const primeiroAnalista = antes[0].Analista;

  aba.insertColumnsBefore(3, 1);                  // coluna nova entre ID e Status
  aba.getRange(1, 3).setNumberFormat('@');
  aba.getRange(1, 3).setValue('Observação da mesa');
  chamar('plLimparCache_()');

  const depois = chamar('plLer_("BASE_MESA")');
  igual(depois.length, antes.length, 'quantidade de registros');
  igual(depois[0].Analista, primeiroAnalista, 'Analista continua sendo Analista');
  igual(depois[0].ID, antes[0].ID, 'o Id continua no lugar certo');
});

teste('coluna acrescentada à mão é respeitada, não ignorada', () => {
  chamar('plAtualizar_("BASE_MESA", "0000000000", { "Observação da mesa": "veio da planilha" })');
  const registro = chamar('plBuscar_("BASE_MESA", "ID", "0000000000")')[0];
  igual(registro['Observação da mesa'], 'veio da planilha');
});

teste('cabeçalho repetido interrompe em vez de escolher um', () => {
  const aba = planilha.getSheetByName('BASE_MESA');
  aba.getRange(1, 3).setValue('Status');
  chamar('plLimparCache_()');
  lanca(() => chamar('plLer_("BASE_MESA")'), 'cabeçalho repetido',
    'coluna ambígua deveria parar a operação');
  aba.getRange(1, 3).setValue('Observação da mesa');
  chamar('plLimparCache_()');
});

teste('adicionar coluna pelo sistema recusa duplicata equivalente', () => {
  lanca(() => chamar('plAdicionarColuna_("BASE_MESA", "OBSERVACAO DA MESA", "texto")'),
    'já tem uma coluna equivalente', 'acento e caixa não criam coluna nova');
});

teste('adicionar coluna nova grava com o formato do tipo', () => {
  chamar('plAdicionarColuna_("BASE_MESA", "Valor negociado", "dinheiro")');
  chamar('plAtualizar_("BASE_MESA", "0000000000", { "Valor negociado": "R$ 2.500,00" })');
  const registro = chamar('plBuscar_("BASE_MESA", "ID", "0000000000")')[0];
  igual(registro['Valor negociado'], 2500, 'valor coagido para número');
});

console.log('\nBusca e exclusão');

teste('busca por identificador ignora a máscara dos dois lados', () => {
  chamar('plInserir_("BASE_RET", { analista: "Ana", protocolo: "1-2345678901" })');
  const comMascara = chamar('plBuscar_("BASE_RET", "protocolo", "1-2345678901")');
  const semMascara = chamar('plBuscar_("BASE_RET", "protocolo", "12345678901")');
  igual(comMascara.length, 1, 'busca com máscara');
  igual(semMascara.length, 1, 'busca sem máscara');
  igual(comMascara[0].id, semMascara[0].id, 'é o mesmo registro');
});

teste('excluir some da leitura mas permanece na planilha', () => {
  const antes = chamar('plLer_("BASE_MESA")').length;
  chamar('plOcultar_("BASE_MESA", "0000000000", "0000000000")');

  igual(chamar('plLer_("BASE_MESA")').length, antes - 1, 'sumiu da leitura');
  igual(chamar('plLer_("BASE_MESA", { incluirOcultos: true })').length, antes,
    'continua na planilha');
  igual(celula(planilha, 'BASE_MESA', 2, '_Visivel'), 'NAO');
  igual(celula(planilha, 'BASE_MESA', 2, 'Analista'), 'Ana Martins',
    'o dado da linha não foi apagado');
});

teste('reexibir traz a linha de volta', () => {
  chamar('plReexibir_("BASE_MESA", "0000000000")');
  igual(celula(planilha, 'BASE_MESA', 2, '_Visivel'), 'SIM');
  igual(celula(planilha, 'BASE_MESA', 2, '_ExcluidoEm'), '');
});

teste('_Visivel editado na mão, direto na planilha, é obedecido', () => {
  const aba = planilha.getSheetByName('BASE_MESA');
  const cabecalhos = aba.getRange(1, 1, 1, aba.getMaxColumns()).getValues()[0];
  const col = cabecalhos.indexOf('_Visivel') + 1;
  const antes = chamar('plLer_("BASE_MESA")').length;
  aba.getRange(3, col).setValue('NAO');
  chamar('plLimparCache_()');
  igual(chamar('plLer_("BASE_MESA")').length, antes - 1);
  aba.getRange(3, col).setValue('SIM');
});

console.log('\nJanela recente e conferência');

teste('a fila lê só as últimas linhas', () => {
  const todas = chamar('plLer_("BASE_MESA")');
  const janela = chamar('plLer_("BASE_MESA", { ultimas: 3 })');
  verdadeiro(janela.length <= 3, 'no máximo 3 registros');
  igual(janela[janela.length - 1].ID, todas[todas.length - 1].ID,
    'a janela termina no registro mais recente');
});

teste('linha digitada na planilha sem Id é carimbada por Normalizar base', () => {
  const aba = planilha.getSheetByName('BASE_MESA');
  const linha = aba.getLastRow() + 1;
  const cabecalhos = aba.getRange(1, 1, 1, aba.getMaxColumns()).getValues()[0];
  aba.getRange(linha, cabecalhos.indexOf('Analista') + 1).setValue('Digitado à mão');
  chamar('plLimparCache_()');

  const laudo = chamar('seqNormalizarBase_("BASE_MESA")');
  igual(laudo.carimbados, 1, 'uma linha carimbada');
  igual(laudo.repetidos.length, 0, 'nenhum Id repetido');
  verdadeiro(celula(planilha, 'BASE_MESA', linha, 'ID') !== '', 'a linha ganhou Id');
});

teste('a conferência de estrutura aponta coluna que sumiu, sem consertar', () => {
  const aba = planilha.getSheetByName('PRODUTOS');
  aba.getRange(1, 3).setValue('');            // apaga o cabeçalho CodigoProduto
  chamar('plLimparCache_()');

  const laudo = chamar('plConferirEstrutura_()');
  igual(laudo.ok, false, 'o laudo deveria reprovar');
  const produtos = laudo.abas.find((a) => a.aba === 'PRODUTOS');
  igual(produtos.faltando.join(','), 'CodigoProduto');
  igual(celula(planilha, 'PRODUTOS', 1, 'Produto'), 'Produto',
    'a conferência não pode ter mexido em nada');

  aba.getRange(1, 3).setNumberFormat('@');
  aba.getRange(1, 3).setValue('CodigoProduto');
  chamar('plLimparCache_()');
});

teste('a conferência reconhece coluna fora do contrato sem reprovar por isso', () => {
  const laudo = chamar('plConferirEstrutura_()');
  const mesa = laudo.abas.find((a) => a.aba === 'BASE_MESA');
  verdadeiro(mesa.aMais.indexOf('Observação da mesa') >= 0,
    'coluna criada à mão deveria aparecer como respeitada');
  igual(mesa.faltando.length, 0, 'nenhuma coluna do contrato falta');
});

teste('o orçamento de células fica bem abaixo do teto', () => {
  const orcamento = chamar('instOrcamentoDeCelulas_(plPlanilha_())');
  verdadeiro(orcamento.percentual < 2,
    'a instalação vazia deveria ocupar menos de 2% — ocupou ' +
    orcamento.percentual + '%');
});

// ==================================================================== saída
console.log('\n' + '-'.repeat(58));
if (falhas.length) {
  console.log(passaram + ' passaram, ' + falhas.length + ' FALHARAM');
  process.exitCode = 1;
} else {
  console.log(passaram + ' testes, todos passaram');
}
console.log('-'.repeat(58) + '\n');
