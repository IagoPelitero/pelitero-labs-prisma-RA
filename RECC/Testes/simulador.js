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

const PARECE_NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

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
  const registros = [];

  return {
    planilha,
    propriedades,
    registros,
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
        })
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => true,
          waitLock: () => true,
          releaseLock: () => {}
        })
      },
      Session: { getActiveUser: () => ({ getEmail: () => email }) },
      Logger: { log: (m) => registros.push(String(m)) },
      Utilities: {
        formatDate: (data, fuso, formato) => String(data)
      },
      console
    }
  };
}

module.exports = { criarAmbienteFalso, converterComoOPlanilhas };
