/**
 * ============================================================================
 * RECC — simulador.js · um Google Planilhas falso que MENTE menos
 * ============================================================================
 * O simulador de testes do sistema anterior gravava string como string. Por
 * isso nenhum teste enxergou o bug que corrompeu 4.328 Ids em produção: no
 * Sheets de verdade, texto "que parece número" numa célula de formato Geral
 * VIRA número.
 *
 *     '00000010'  →  10          (zeros à esquerda perdidos)
 *     '000000E1'  →  0           (notação científica)
 *
 * Este simulador faz exatamente essa conversão, e respeita o formato '@'.
 * É o que permite um teste provar que a proteção funciona.
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PASTA_DAS_TELAS = path.join(__dirname, '..', 'Telas');
const PARECE_NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * O motor de template do Apps Script, em miniatura.
 *
 *   <?= expressao ?>   escreve o valor, escapando o HTML
 *   <?!= expressao ?>  escreve o valor cru
 *   <?  codigo     ?>  executa o código
 *
 * Existe para os testes conseguirem montar uma tela de verdade e conferir o
 * que saiu dela — e não só se a função foi chamada.
 */
function escaparHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function montarTemplate(fonte, variaveis, globaisDoServidor) {
  let corpo = "var __saida = '';\n";
  let posicao = 0;
  const pedacos = /<\?(!?=)?([\s\S]*?)\?>/g;
  let achado;
  while ((achado = pedacos.exec(fonte)) !== null) {
    corpo += '__saida += ' + JSON.stringify(fonte.slice(posicao, achado.index)) + ';\n';
    if (achado[1] === '=') corpo += '__saida += __escapar(' + achado[2] + ');\n';
    else if (achado[1] === '!=') corpo += '__saida += (' + achado[2] + ');\n';
    else corpo += achado[2] + '\n';
    posicao = pedacos.lastIndex;
  }
  corpo += '__saida += ' + JSON.stringify(fonte.slice(posicao)) + ';\nreturn __saida;';

  // No Apps Script, um template enxerga TODAS as funções do servidor — é
  // assim que <?!= incluir('Estilos') ?> funciona. O `with` reproduz esse
  // alcance: sem ele o simulador seria mais restrito que o Apps Script e
  // aprovaria uma página que quebraria em produção.
  const funcao = new Function('__servidor', '__pagina', '__escapar',
    'with (__servidor) { with (__pagina) {\n' + corpo + '\n} }');
  return funcao(globaisDoServidor || {}, variaveis, escaparHtml);
}

function saidaHtml(html) {
  const saida = {
    getContent: () => html,
    setTitle(titulo) { saida.titulo = titulo; return saida; },
    addMetaTag() { return saida; }
  };
  return saida;
}

/** A conversão que o Sheets faz ao receber um valor numa célula. */
function converterComoOPlanilhas(valor, formato) {
  if (valor === null || valor === undefined) return '';
  if (formato === '@') {
    if (valor instanceof Date) return valor;
    return String(valor);
  }
  if (typeof valor !== 'string') return valor;
  const limpo = valor.trim();
  if (limpo === '') return '';
  if (PARECE_NUMERO.test(limpo)) {
    const n = Number(limpo);
    if (Number.isFinite(n)) return n;
  }
  return valor;
}

class Faixa {
  constructor(aba, linha, coluna, nLinhas, nColunas) {
    this.aba = aba;
    this.linha = linha;
    this.coluna = coluna;
    this.nLinhas = nLinhas;
    this.nColunas = nColunas;
  }
  getRow() { return this.linha; }
  getColumn() { return this.coluna; }
  getValues() {
    const saida = [];
    for (let i = 0; i < this.nLinhas; i++) {
      const linha = [];
      for (let j = 0; j < this.nColunas; j++) {
        linha.push(this.aba.valores[this.linha - 1 + i][this.coluna - 1 + j]);
      }
      saida.push(linha);
    }
    return saida;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(matriz) {
    for (let i = 0; i < this.nLinhas; i++) {
      for (let j = 0; j < this.nColunas; j++) {
        const l = this.linha - 1 + i;
        const c = this.coluna - 1 + j;
        this.aba.valores[l][c] = converterComoOPlanilhas(matriz[i][j], this.aba.formatos[l][c]);
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(formato) {
    for (let i = 0; i < this.nLinhas; i++) {
      for (let j = 0; j < this.nColunas; j++) {
        this.aba.formatos[this.linha - 1 + i][this.coluna - 1 + j] = formato;
      }
    }
    return this;
  }
  setNumberFormats(matriz) {
    for (let i = 0; i < this.nLinhas; i++) {
      for (let j = 0; j < this.nColunas; j++) {
        this.aba.formatos[this.linha - 1 + i][this.coluna - 1 + j] = matriz[i][j];
      }
    }
    return this;
  }
  getNumberFormats() {
    const saida = [];
    for (let i = 0; i < this.nLinhas; i++) {
      const linha = [];
      for (let j = 0; j < this.nColunas; j++) {
        linha.push(this.aba.formatos[this.linha - 1 + i][this.coluna - 1 + j]);
      }
      saida.push(linha);
    }
    return saida;
  }
  setFontWeight() { return this; }
  /** Só o caso usado pelo produto: subir a partir do fundo de uma coluna. */
  getNextDataCell() {
    const c = this.coluna - 1;
    for (let l = this.linha - 1; l >= 0; l--) {
      const v = this.aba.valores[l][c];
      if (v !== '' && v !== null && v !== undefined) {
        return new Faixa(this.aba, l + 1, this.coluna, 1, 1);
      }
    }
    return new Faixa(this.aba, 1, this.coluna, 1, 1);
  }
}

class Aba {
  constructor(nome, linhas = 1000, colunas = 26) {
    this.nome = nome;
    this.valores = Array.from({ length: linhas }, () => new Array(colunas).fill(''));
    this.formatos = Array.from({ length: linhas }, () => new Array(colunas).fill(''));
    this.congeladas = 0;
  }
  getName() { return this.nome; }
  getMaxRows() { return this.valores.length; }
  getMaxColumns() { return this.valores[0] ? this.valores[0].length : 0; }
  getRange(l, c, nl = 1, nc = 1) {
    if (l + nl - 1 > this.getMaxRows() || c + nc - 1 > this.getMaxColumns()) {
      throw new Error('Fora da grade: ' + this.nome + ' (' + l + ',' + c +
        ' por ' + nl + 'x' + nc + ') — grade ' + this.getMaxRows() + 'x' +
        this.getMaxColumns());
    }
    return new Faixa(this, l, c, nl, nc);
  }
  getLastRow() {
    for (let l = this.valores.length - 1; l >= 0; l--) {
      if (this.valores[l].some((v) => v !== '' && v !== null && v !== undefined)) {
        return l + 1;
      }
    }
    return 0;
  }
  getLastColumn() {
    let ultima = 0;
    for (let l = 0; l < this.valores.length; l++) {
      for (let c = this.valores[l].length - 1; c >= ultima; c--) {
        const v = this.valores[l][c];
        if (v !== '' && v !== null && v !== undefined) { ultima = Math.max(ultima, c + 1); break; }
      }
    }
    return ultima;
  }
  setFrozenRows(n) { this.congeladas = n; return this; }
  insertRowsAfter(depois, quantas) {
    const largura = this.getMaxColumns();
    for (let i = 0; i < quantas; i++) {
      this.valores.splice(depois + i, 0, new Array(largura).fill(''));
      this.formatos.splice(depois + i, 0, new Array(largura).fill(''));
    }
    return this;
  }
  deleteRows(inicio, quantas) {
    this.valores.splice(inicio - 1, quantas);
    this.formatos.splice(inicio - 1, quantas);
    return this;
  }
  insertColumnsAfter(depois, quantas) {
    for (let l = 0; l < this.valores.length; l++) {
      for (let i = 0; i < quantas; i++) {
        this.valores[l].splice(depois + i, 0, '');
        this.formatos[l].splice(depois + i, 0, '');
      }
    }
    return this;
  }
  insertColumnsBefore(antes, quantas) { return this.insertColumnsAfter(antes - 1, quantas); }
  deleteColumns(inicio, quantas) {
    for (let l = 0; l < this.valores.length; l++) {
      this.valores[l].splice(inicio - 1, quantas);
      this.formatos[l].splice(inicio - 1, quantas);
    }
    return this;
  }
}

class Planilha {
  constructor() { this.abas = []; this.fuso = 'Etc/GMT'; }
  insertSheet(nome) { const a = new Aba(nome); this.abas.push(a); return a; }
  getSheetByName(nome) { return this.abas.find((a) => a.nome === nome) || null; }
  getSheets() { return this.abas.slice(); }
  setSpreadsheetTimeZone(f) { this.fuso = f; return this; }
  getSpreadsheetTimeZone() { return this.fuso; }
}

/** Monta o ambiente global falso que os arquivos .gs enxergam. */
function criarAmbienteFalso(email = 'analista@exemplo.com') {
  const planilha = new Planilha();
  const propriedades = new Map();
  const propriedadesDoUsuario = new Map();
  const registros = [];
  let emailAtual = email;

  const ambiente = {
    planilha,
    propriedades,
    propriedadesDoUsuario,
    registros,
    /** Troca quem está "logado", para testar cada perfil de acesso. */
    definirEmail(novo) { emailAtual = novo; },
    globais: {
      SpreadsheetApp: {
        getActive: () => planilha,
        Direction: { UP: 'UP', DOWN: 'DOWN' }
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (propriedades.has(k) ? propriedades.get(k) : null),
          setProperty: (k, v) => { propriedades.set(k, String(v)); },
          deleteProperty: (k) => { propriedades.delete(k); }
        }),
        getUserProperties: () => ({
          getProperty: (k) =>
            (propriedadesDoUsuario.has(k) ? propriedadesDoUsuario.get(k) : null),
          setProperty: (k, v) => { propriedadesDoUsuario.set(k, String(v)); },
          deleteProperty: (k) => { propriedadesDoUsuario.delete(k); }
        })
      },
      HtmlService: {
        createTemplateFromFile(nome) {
          const fonte = fs.readFileSync(
            path.join(PASTA_DAS_TELAS, nome + '.html'), 'utf8');
          const template = {
            evaluate() {
              const variaveis = {};
              Object.keys(template).forEach((chave) => {
                if (chave !== 'evaluate') variaveis[chave] = template[chave];
              });
              return saidaHtml(montarTemplate(fonte, variaveis, ambiente.globais));
            }
          };
          return template;
        },
        createHtmlOutputFromFile(nome) {
          return saidaHtml(
            fs.readFileSync(path.join(PASTA_DAS_TELAS, nome + '.html'), 'utf8'));
        }
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => true,
          waitLock: () => true,
          releaseLock: () => {}
        })
      },
      Session: { getActiveUser: () => ({ getEmail: () => emailAtual }) },
      Logger: { log: (m) => registros.push(String(m)) },
      Utilities: {
        formatDate: (data) => String(data),
        getUuid: () => crypto.randomUUID(),
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF_8' },
        /**
         * SHA-256 DE VERDADE, e não um atalho.
         *
         * O simulador do sistema anterior já teve `computeDigest: () => [1]`.
         * Os testes de senha passavam sem testar coisa alguma. Aqui usamos o
         * mesmo algoritmo do Google, e devolvemos bytes com sinal (-128 a 127)
         * como o Apps Script devolve — senão a conversão para hexadecimal
         * seria testada errada.
         */
        computeDigest: (algoritmo, texto) => {
          if (algoritmo !== 'SHA_256') {
            throw new Error('Algoritmo não simulado: ' + algoritmo);
          }
          const resumo = crypto.createHash('sha256').update(String(texto), 'utf8').digest();
          return Array.from(resumo).map((b) => (b > 127 ? b - 256 : b));
        }
      },
      console
    }
  };

  return ambiente;
}

module.exports = { criarAmbienteFalso, converterComoOPlanilhas };
