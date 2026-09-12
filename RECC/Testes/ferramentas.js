/**
 * ============================================================================
 * RECC — ferramentas.js · o mínimo para escrever um teste
 * ============================================================================
 * Sem biblioteca de fora: quem ler este arquivo entende a suíte inteira.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarAmbienteFalso } = require('./simulador');

const PASTA_DO_SERVIDOR = path.join(__dirname, '..', 'Servidor');

/**
 * Carrega os arquivos .gs num ambiente falso, na MESMA ordem em que o Apps
 * Script os avalia: alfabética. Se algum arquivo tiver código de topo que
 * dependa de outro, o erro aparece aqui — e não em produção.
 */
function carregar(email) {
  const ambiente = criarAmbienteFalso(email);
  const contexto = vm.createContext(ambiente.globais);
  fs.readdirSync(PASTA_DO_SERVIDOR)
    .filter((nome) => nome.endsWith('.gs'))
    .sort()
    .forEach((nome) => {
      const codigo = fs.readFileSync(path.join(PASTA_DO_SERVIDOR, nome), 'utf8');
      vm.runInContext(codigo, contexto, { filename: nome });
    });
  return {
    ambiente,
    contexto,
    chamar: (expressao) => vm.runInContext(expressao, contexto)
  };
}

let passaram = 0;
const falhas = [];

function secao(titulo) {
  console.log('\n' + titulo);
}

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

function verdadeiro(condicao, oQue) {
  if (!condicao) throw new Error(oQue || 'condição falsa');
}

function contem(texto, trecho, oQue) {
  if (String(texto).indexOf(trecho) < 0) {
    throw new Error((oQue || 'texto') + ': não encontrei "' + trecho + '"');
  }
}

function lanca(funcao, trecho, oQue) {
  try {
    funcao();
  } catch (erro) {
    if (trecho && erro.message.indexOf(trecho) < 0) {
      throw new Error((oQue || '') + ': o erro veio com outra mensagem — ' +
        erro.message);
    }
    return erro;
  }
  throw new Error((oQue || 'esperava um erro') + ', mas nada foi lançado');
}

/**
 * Date criado dentro do ambiente falso tem outro prototype que o Date daqui,
 * então `instanceof Date` mente. Esta é a pergunta que atravessa contextos.
 */
function ehData(valor) {
  return Object.prototype.toString.call(valor) === '[object Date]';
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

function resumo() {
  return { passaram, falhas };
}

module.exports = {
  carregar, secao, teste, igual, verdadeiro, contem, lanca, ehData,
  celula, formatoDaCelula, resumo
};
