/**
 * ============================================================================
 * RECC — Planilha.gs · a porta única para o Google Planilhas
 * ============================================================================
 * NENHUM outro arquivo chama SpreadsheetApp. Toda leitura e toda gravação
 * passam por aqui — é o que garante, num lugar só, as duas regras que
 * sustentam a integridade do dado:
 *
 *   1. A coluna é encontrada pelo NOME do cabeçalho, nunca pela posição.
 *      Reordenar coluna na planilha não quebra o sistema.
 *
 *   2. A linha é FORMATADA antes de receber o valor.
 *      Identificador vai para célula de texto (@), dinheiro para célula de
 *      moeda, data para célula de data. Formatar depois não desfaz nada:
 *      quando o Sheets converteu 0000000010 em 10, o zero já se foi.
 *
 * Nenhum código de topo depende de outro arquivo: as referências a
 * RECC_ESQUEMA e a Sequencia.gs acontecem dentro de função.
 * ============================================================================
 */

/** Cache da estrutura das abas, válido só durante uma execução. */
var PL_CACHE_ = {};

/** Tipos das colunas que NÃO estão no contrato, declarados na aba CAMPOS. */
var PL_TIPOS_DECLARADOS_ = null;
var PL_CARREGANDO_TIPOS_ = false;

function plLimparCache_(nomeAba) {
  if (nomeAba) {
    delete PL_CACHE_[nomeAba];
    if (nomeAba === 'CAMPOS') PL_TIPOS_DECLARADOS_ = null;
  } else {
    PL_CACHE_ = {};
    PL_TIPOS_DECLARADOS_ = null;
  }
}

/**
 * O tipo das colunas criadas pelo administrador.
 *
 * Coluna do contrato tem tipo no Esquema. Coluna criada depois tem o tipo
 * declarado em CAMPOS — sem isso, uma coluna de moeda criada na tela receberia
 * "R$ 2.500,00" como texto, e o Power BI não somaria nada.
 *
 * A trava de reentrância existe porque ler CAMPOS passa por plInfo_, que é
 * justamente quem pergunta pelos tipos.
 */
function plTiposDeclarados_() {
  if (PL_TIPOS_DECLARADOS_) return PL_TIPOS_DECLARADOS_;
  if (PL_CARREGANDO_TIPOS_) return {};

  PL_CARREGANDO_TIPOS_ = true;
  try {
    var mapa = {};
    if (plPlanilha_().getSheetByName('CAMPOS')) {
      plLer_('CAMPOS', { incluirOcultos: true }).forEach(function (campo) {
        var aba = String(campo.Aba || '').trim();
        var cabecalho = String(campo.Cabecalho || '').trim();
        if (!aba || !cabecalho) return;
        if (!mapa[aba]) mapa[aba] = {};
        mapa[aba][plNormalizar_(cabecalho)] =
          RECC_CAMPO_TIPO[campo.TipoCampo] || RECC_TIPO.TEXTO;
      });
    }
    PL_TIPOS_DECLARADOS_ = mapa;
    return mapa;
  } finally {
    PL_CARREGANDO_TIPOS_ = false;
  }
}

// ============================================================================
// NORMALIZAÇÃO — como dois cabeçalhos são considerados o mesmo
// ============================================================================

/**
 * "Código origem da proposta" e "codigo origem da proposta" e
 * "CODIGO_ORIGEM_DA_PROPOSTA" viram a mesma chave.
 *
 * Tolerância deliberada: acento, caixa, espaço, sublinhado e pontuação não
 * distinguem colunas. O que distingue são as letras e os números.
 */
function plNormalizar_(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Só os dígitos. É assim que identificador é comparado e gravado. */
function plSoDigitos_(texto) {
  return String(texto === null || texto === undefined ? '' : texto).replace(/\D/g, '');
}

// ============================================================================
// ESTRUTURA — ler a linha 1 e montar o mapa cabeçalho → coluna
// ============================================================================

function plPlanilha_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) {
    throw new Error('Nenhuma planilha vinculada a este projeto do Apps Script.');
  }
  return ss;
}

/**
 * A estrutura de uma aba: a folha, os cabeçalhos como estão escritos na
 * linha 1, o mapa normalizado e o tipo de cada coluna.
 *
 * Coluna que existe na planilha mas não está no contrato entra como TEXTO —
 * é o caso de uma coluna acrescentada à mão, que o sistema respeita em vez
 * de ignorar.
 */
function plInfo_(nomeAba, recarregar) {
  if (!recarregar && PL_CACHE_[nomeAba]) return PL_CACHE_[nomeAba];

  var aba = plPlanilha_().getSheetByName(nomeAba);
  if (!aba) {
    throw new Error('A aba "' + nomeAba + '" não existe nesta planilha. ' +
      'Rode instalarRECC() numa planilha vazia, ou confira o nome da aba.');
  }

  var largura = aba.getLastColumn();
  if (largura < 1) {
    throw new Error('A aba "' + nomeAba + '" está sem cabeçalho na linha 1.');
  }

  var cabecalhos = aba.getRange(1, 1, 1, largura).getValues()[0].map(function (v) {
    return String(v === null || v === undefined ? '' : v).trim();
  });

  var mapa = {};
  var repetidos = [];
  for (var i = 0; i < cabecalhos.length; i++) {
    if (!cabecalhos[i]) continue;
    var chave = plNormalizar_(cabecalhos[i]);
    if (!chave) continue;
    if (mapa[chave] !== undefined) {
      repetidos.push(cabecalhos[i]);
      continue;
    }
    mapa[chave] = i;
  }
  if (repetidos.length) {
    throw new Error('A aba "' + nomeAba + '" tem cabeçalho repetido: ' +
      repetidos.join(', ') + '. Dois cabeçalhos iguais tornam a coluna ' +
      'ambígua — renomeie um deles antes de continuar.');
  }

  var tiposDoContrato = {};
  if (RECC_ESQUEMA[nomeAba]) {
    var def = reccEsquemaDaAba_(nomeAba);
    for (var j = 0; j < def.colunas.length; j++) {
      tiposDoContrato[plNormalizar_(def.colunas[j].c)] = def.colunas[j].t;
    }
  }

  // Ordem da decisão: o contrato manda; depois o que o administrador declarou
  // em CAMPOS; e só então texto, que é o padrão seguro.
  var declarados = plTiposDeclarados_()[nomeAba] || {};
  var tipos = cabecalhos.map(function (cab) {
    var chave = plNormalizar_(cab);
    return tiposDoContrato[chave] || declarados[chave] || RECC_TIPO.TEXTO;
  });

  var info = {
    nomeAba: nomeAba,
    aba: aba,
    cabecalhos: cabecalhos,
    mapa: mapa,
    tipos: tipos
  };
  PL_CACHE_[nomeAba] = info;
  return info;
}

/** O índice (base 0) de uma coluna, ou -1 quando ela não existe. */
function plIndice_(info, cabecalho) {
  var i = info.mapa[plNormalizar_(cabecalho)];
  return i === undefined ? -1 : i;
}

function plExigirIndice_(info, cabecalho) {
  var i = plIndice_(info, cabecalho);
  if (i < 0) {
    throw new Error('A coluna "' + cabecalho + '" não existe na aba "' +
      info.nomeAba + '". Colunas encontradas: ' + info.cabecalhos.join(' | '));
  }
  return i;
}

// ============================================================================
// COERÇÃO — o valor que chega vira o tipo que a célula espera
// ============================================================================

/**
 * Identificador: só dígitos, sempre texto.
 *
 * Lista de valores (o caso de "telefones de contato") preserva o ";" como
 * separador e limpa cada parte — senão dois telefones virariam um número só.
 */
function plCoagirId_(valor) {
  var bruto = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!bruto) return '';
  if (bruto.indexOf(';') >= 0 || bruto.indexOf('/') >= 0) {
    return bruto.split(/[;/]/)
      .map(function (parte) { return plSoDigitos_(parte); })
      .filter(function (parte) { return parte !== ''; })
      .join(';');
  }
  return plSoDigitos_(bruto);
}

/** Aceita 1234.56, "1234,56", "1.234,56" e "R$ 1.234,56". */
function plCoagirNumero_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number') return isFinite(valor) ? valor : '';

  var texto = String(valor)
    .replace(/R\$/gi, '')
    .replace(/ /g, '')
    .replace(/\s/g, '')
    .trim();
  if (!texto) return '';

  var negativo = /^\(.*\)$/.test(texto) || texto.indexOf('-') === 0;
  texto = texto.replace(/[()\-]/g, '');

  if (texto.indexOf(',') >= 0) {
    // Formato brasileiro: ponto é milhar, vírgula é decimal.
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    // 1.234.567 — só milhar, sem decimal.
    texto = texto.replace(/\./g, '');
  }

  var n = Number(texto);
  if (!isFinite(n)) return '';
  return negativo ? -n : n;
}

/** Aceita Date, "dd/MM/yyyy" e "yyyy-MM-dd". */
function plCoagirData_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : valor;
  }
  var texto = String(valor).trim();
  var br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  var iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return '';
}

/**
 * Hora do dia.
 *
 * A hora é carregada numa data de apoio, porque no Sheets a hora é a parte
 * fracionária de uma data. A data usada é 01/01/1970 de propósito: a época do
 * Sheets (30/12/1899) cai antes da padronização de fuso do Brasil — São Paulo
 * usava -03:06:28 —, e uma hora ancorada ali chega deslocada em minutos.
 */
function plCoagirHora_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : valor;
  }
  var m = String(valor).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return '';
  var h = Number(m[1]);
  var min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return new Date(1970, 0, 1, h, min, Number(m[3] || 0));
}

function plCoagirDataHora_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? '' : valor;
  }
  var d = new Date(String(valor));
  return isNaN(d.getTime()) ? '' : d;
}

function plCoagirBooleano_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor === true) return 'SIM';
  if (valor === false) return 'NAO';
  var t = plNormalizar_(valor);
  if (t === 'sim' || t === 's' || t === 'true' || t === '1' || t === 'verdadeiro') return 'SIM';
  if (t === 'nao' || t === 'n' || t === 'false' || t === '0' || t === 'falso') return 'NAO';
  return '';
}

function plCoagir_(valor, tipo) {
  switch (tipo) {
    case RECC_TIPO.ID:         return plCoagirId_(valor);
    case RECC_TIPO.NUMERO:     return plCoagirNumero_(valor);
    case RECC_TIPO.DINHEIRO:   return plCoagirNumero_(valor);
    case RECC_TIPO.DATA:       return plCoagirData_(valor);
    case RECC_TIPO.HORA:       return plCoagirHora_(valor);
    case RECC_TIPO.DATA_HORA:  return plCoagirDataHora_(valor);
    case RECC_TIPO.BOOLEANO:   return plCoagirBooleano_(valor);
    default:
      if (valor === null || valor === undefined) return '';
      if (Object.prototype.toString.call(valor) === '[object Date]') return valor;
      return String(valor);
  }
}

/** O formato de cada célula da linha, na ordem das colunas da aba. */
function plFormatosDaLinha_(info) {
  return info.tipos.map(function (t) {
    return RECC_FORMATO[t] || '@';
  });
}

// ============================================================================
// LEITURA
// ============================================================================

/**
 * A última linha com CONTEÚDO na aba.
 *
 * getLastRow() olha conteúdo, não formatação — então a área de reserva que o
 * instalador pré-formata não infla esta conta.
 *
 * E é conteúdo de QUALQUER coluna, deliberadamente: usar a coluna de Id aqui
 * seria mais preciso e daria dois bugs. Uma linha digitada à mão nasce sem Id,
 * então ficaria invisível para o "Normalizar base" — que existe justamente
 * para carimbá-la —, e a próxima inserção do sistema gravaria POR CIMA dela.
 */
function plUltimaLinhaComDado_(info) {
  return Math.max(info.aba.getLastRow(), 1);
}

/** Quantas linhas de dado a aba tem (sem contar o cabeçalho). */
function plTotalDeDados_(info) {
  return Math.max(plUltimaLinhaComDado_(info) - 1, 0);
}

/** Buraco no meio da aba não é registro. */
function plLinhaVazia_(valores) {
  for (var i = 0; i < valores.length; i++) {
    var v = valores[i];
    if (v !== '' && v !== null && v !== undefined) return false;
  }
  return true;
}

/** Uma linha da planilha vira objeto, com as chaves iguais aos cabeçalhos. */
function plObjeto_(info, valores, numeroDaLinha) {
  var reg = {};
  for (var i = 0; i < info.cabecalhos.length; i++) {
    if (!info.cabecalhos[i]) continue;
    reg[info.cabecalhos[i]] = valores[i];
  }
  reg.__linha = numeroDaLinha;
  return reg;
}

/**
 * Lê registros de uma aba.
 *
 *   opcoes.ultimas         lê só as N últimas linhas. A base é append-only,
 *                          então o recente é sempre o fim — é o que permite
 *                          a fila de trabalho não ler 200 mil linhas para
 *                          mostrar 40.
 *   opcoes.incluirOcultos  traz também as linhas com _Visivel = NAO.
 */
function plLer_(nomeAba, opcoes) {
  opcoes = opcoes || {};
  var info = plInfo_(nomeAba);
  var totalDados = plTotalDeDados_(info);
  if (totalDados <= 0) return [];

  var primeira = 2;
  var quantas = totalDados;
  if (opcoes.ultimas > 0 && opcoes.ultimas < totalDados) {
    primeira = 2 + (totalDados - opcoes.ultimas);
    quantas = opcoes.ultimas;
  }

  var valores = info.aba
    .getRange(primeira, 1, quantas, info.cabecalhos.length)
    .getValues();

  var iVisivel = plIndice_(info, '_Visivel');
  var saida = [];
  for (var i = 0; i < valores.length; i++) {
    if (plLinhaVazia_(valores[i])) continue;
    if (!opcoes.incluirOcultos && iVisivel >= 0) {
      if (plNormalizar_(valores[i][iVisivel]) === 'nao') continue;
    }
    saida.push(plObjeto_(info, valores[i], primeira + i));
  }
  return saida;
}

/**
 * Lê UMA coluna inteira. É a primeira metade de toda busca: numa base de
 * 200 mil linhas por 39 colunas, ler tudo são 7,8 milhões de células; ler
 * uma coluna são 200 mil.
 */
function plLerColuna_(nomeAba, cabecalho) {
  var info = plInfo_(nomeAba);
  var i = plExigirIndice_(info, cabecalho);
  var totalDados = plTotalDeDados_(info);
  if (totalDados <= 0) return [];
  return info.aba.getRange(2, i + 1, totalDados, 1).getValues().map(function (l) {
    return l[0];
  });
}

/** Lê só as linhas indicadas (números de linha da planilha). */
function plLerLinhas_(nomeAba, numerosDeLinha) {
  var info = plInfo_(nomeAba);
  var saida = [];
  for (var i = 0; i < numerosDeLinha.length; i++) {
    var n = numerosDeLinha[i];
    var valores = info.aba.getRange(n, 1, 1, info.cabecalhos.length).getValues()[0];
    saida.push(plObjeto_(info, valores, n));
  }
  return saida;
}

/**
 * Busca por valor numa coluna e devolve as linhas inteiras.
 * Identificador é comparado só pelos dígitos, então "1-2345678901" e
 * "12345678901" acham a mesma linha.
 */
function plBuscar_(nomeAba, cabecalho, valor, limite) {
  var info = plInfo_(nomeAba);
  var i = plExigirIndice_(info, cabecalho);
  var tipo = info.tipos[i];
  var ehId = (tipo === RECC_TIPO.ID);

  var alvo = ehId ? plCoagirId_(valor) : plNormalizar_(valor);
  if (alvo === '') return [];

  var coluna = plLerColuna_(nomeAba, cabecalho);
  var linhas = [];
  for (var k = 0; k < coluna.length; k++) {
    var atual = ehId ? plCoagirId_(coluna[k]) : plNormalizar_(coluna[k]);
    if (atual === alvo) {
      linhas.push(k + 2);
      if (limite && linhas.length >= limite) break;
    }
  }
  return plLerLinhas_(nomeAba, linhas);
}

/** Encontra a linha de um Id. Id repetido é erro, nunca "usa a primeira". */
function plLinhaDoId_(info, id) {
  var iId = plExigirIndice_(info, 'Id');
  var totalDados = plTotalDeDados_(info);
  if (totalDados <= 0) return -1;

  var alvo = plCoagirId_(id);
  var coluna = info.aba.getRange(2, iId + 1, totalDados, 1).getValues();
  var achadas = [];
  for (var i = 0; i < coluna.length; i++) {
    if (plCoagirId_(coluna[i][0]) === alvo) achadas.push(i + 2);
  }
  if (achadas.length > 1) {
    throw new Error('O Id ' + alvo + ' aparece em ' + achadas.length +
      ' linhas da aba "' + info.nomeAba + '" (linhas ' + achadas.join(', ') +
      '). Gravar assim sobrescreveria o registro errado. ' +
      'Rode "Normalizar base" antes de continuar.');
  }
  return achadas.length ? achadas[0] : -1;
}

// ============================================================================
// GRAVAÇÃO — sempre em bloco, sempre com o formato aplicado antes
// ============================================================================

/**
 * Monta a linha inteira já coagida, na ordem real das colunas da aba.
 * `dados` pode vir com as chaves escritas de qualquer jeito: a busca é
 * normalizada.
 */
function plMontarLinha_(info, dados, valoresAtuais) {
  var porChave = {};
  Object.keys(dados).forEach(function (k) {
    if (k === '__linha') return;
    porChave[plNormalizar_(k)] = dados[k];
  });

  var linha = [];
  for (var i = 0; i < info.cabecalhos.length; i++) {
    var chave = plNormalizar_(info.cabecalhos[i]);
    if (!info.cabecalhos[i]) {
      linha.push(valoresAtuais ? valoresAtuais[i] : '');
    } else if (Object.prototype.hasOwnProperty.call(porChave, chave)) {
      linha.push(plCoagir_(porChave[chave], info.tipos[i]));
    } else {
      linha.push(valoresAtuais ? valoresAtuais[i] : '');
    }
  }
  return linha;
}

/** Formata a faixa e só então grava. A ordem é a regra inteira. */
function plGravarFaixa_(info, primeiraLinha, linhas) {
  var faixa = info.aba.getRange(
    primeiraLinha, 1, linhas.length, info.cabecalhos.length);
  var formatoDaLinha = plFormatosDaLinha_(info);
  var formatos = linhas.map(function () { return formatoDaLinha; });
  faixa.setNumberFormats(formatos);
  faixa.setValues(linhas);
}

/**
 * Insere um registro. Gera o Id se ele não vier pronto, marca a linha como
 * visível e registra que ela nasceu no sistema.
 */
function plInserir_(nomeAba, dados, contexto) {
  return plInserirVarios_(nomeAba, [dados], contexto)[0];
}

/** Insere vários registros numa gravação só. */
function plInserirVarios_(nomeAba, lista, contexto) {
  if (!lista || !lista.length) return [];
  contexto = contexto || {};

  var trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) {
    throw new Error('A planilha está ocupada com outra gravação. Tente de novo.');
  }
  try {
    plLimparCache_(nomeAba);
    var info = plInfo_(nomeAba, true);
    var temControle = plIndice_(info, '_Visivel') >= 0;
    var iId = plIndice_(info, 'Id');

    var linhas = [];
    var gravados = [];
    for (var i = 0; i < lista.length; i++) {
      var dados = {};
      Object.keys(lista[i]).forEach(function (k) { dados[k] = lista[i][k]; });

      if (iId >= 0) {
        var idInformado = plCoagirId_(dados[info.cabecalhos[iId]]);
        if (!idInformado) {
          dados[info.cabecalhos[iId]] = seqProximoId_(nomeAba);
        }
      }
      if (temControle) {
        if (dados._Visivel === undefined) dados._Visivel = RECC_VISIVEL_SIM;
        if (dados._Origem === undefined) {
          dados._Origem = contexto.origem || RECC_ORIGEM_SISTEMA;
        }
      }
      linhas.push(plMontarLinha_(info, dados, null));
      gravados.push(dados);
    }

    var primeira = plUltimaLinhaComDado_(info) + 1;
    if (primeira < 2) primeira = 2;
    plGarantirLinhas_(info.aba, primeira + linhas.length - 1);
    plGravarFaixa_(info, primeira, linhas);

    for (var j = 0; j < gravados.length; j++) gravados[j].__linha = primeira + j;
    return gravados;
  } finally {
    trava.releaseLock();
  }
}

/**
 * Atualiza um registro pelo Id.
 * Lê a linha, mescla as alterações e regrava a linha inteira já formatada —
 * assim uma coluna nunca fica com o formato de outro tipo.
 */
function plAtualizar_(nomeAba, id, alteracoes) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) {
    throw new Error('A planilha está ocupada com outra gravação. Tente de novo.');
  }
  try {
    plLimparCache_(nomeAba);
    var info = plInfo_(nomeAba, true);
    var linha = plLinhaDoId_(info, id);
    if (linha < 0) {
      throw new Error('Registro ' + plCoagirId_(id) + ' não encontrado na aba "' +
        nomeAba + '".');
    }
    var atuais = info.aba.getRange(linha, 1, 1, info.cabecalhos.length).getValues()[0];
    var nova = plMontarLinha_(info, alteracoes, atuais);
    plGravarFaixa_(info, linha, [nova]);
    return plObjeto_(info, nova, linha);
  } finally {
    trava.releaseLock();
  }
}

/**
 * Exclusão do RECC: some da tela, permanece na planilha.
 * Nenhuma linha de base operacional é apagada — nunca.
 */
function plOcultar_(nomeAba, id, usuarioId) {
  return plAtualizar_(nomeAba, id, {
    _Visivel: RECC_VISIVEL_NAO,
    _ExcluidoEm: new Date(),
    _ExcluidoPor: usuarioId || ''
  });
}

function plReexibir_(nomeAba, id) {
  return plAtualizar_(nomeAba, id, {
    _Visivel: RECC_VISIVEL_SIM,
    _ExcluidoEm: '',
    _ExcluidoPor: ''
  });
}

// ============================================================================
// ESTRUTURA — crescer a aba de propósito, nunca por acidente
// ============================================================================

/** A aba precisa ter linha suficiente na grade para receber a gravação. */
function plGarantirLinhas_(aba, ateLinha) {
  var faltam = ateLinha - aba.getMaxRows();
  if (faltam > 0) aba.insertRowsAfter(aba.getMaxRows(), faltam);
}

/**
 * Acrescenta uma coluna ao FIM da aba.
 *
 * Só é chamada por ação explícita do administrador — jamais durante um
 * salvamento comum. Recusa cabeçalho que já exista, mesmo escrito diferente.
 */
function plAdicionarColuna_(nomeAba, cabecalho, tipo) {
  var texto = String(cabecalho || '').trim();
  if (!texto) throw new Error('Cabeçalho vazio.');
  if (!RECC_FORMATO[tipo]) throw new Error('Tipo de coluna desconhecido: ' + tipo);

  var nova;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) {
    throw new Error('A planilha está ocupada. Tente de novo.');
  }
  try {
    plLimparCache_(nomeAba);
    var info = plInfo_(nomeAba, true);
    if (plIndice_(info, texto) >= 0) {
      throw new Error('A aba "' + nomeAba + '" já tem uma coluna equivalente a "' +
        texto + '".');
    }

    var aba = info.aba;
    nova = info.cabecalhos.length + 1;
    if (aba.getMaxColumns() < nova) {
      aba.insertColumnsAfter(aba.getMaxColumns(), nova - aba.getMaxColumns());
    }
    aba.getRange(1, nova).setNumberFormat('@');
    aba.getRange(1, nova).setValue(texto).setFontWeight('bold');
    var altura = Math.max(aba.getMaxRows() - 1, 1);
    aba.getRange(2, nova, altura, 1).setNumberFormat(RECC_FORMATO[tipo]);
    plLimparCache_(nomeAba);
  } finally {
    trava.releaseLock();
  }

  // Fora da trava, de propósito: plInserirVarios_ pega a dela, e trava dentro
  // de trava é como um deadlock nasce.
  plRegistrarCampo_(nomeAba, texto, tipo, nova);
  plLimparCache_();

  return { aba: nomeAba, cabecalho: texto, tipo: tipo, coluna: nova };
}

/**
 * Registra a coluna nova em CAMPOS.
 *
 * Não é burocracia: é onde o tipo da coluna passa a morar. Sem esta linha, na
 * próxima execução a coluna voltaria a ser lida como texto — e uma coluna de
 * moeda guardaria "R$ 2.500,00" em vez de 2500.
 */
function plRegistrarCampo_(nomeAba, cabecalho, tipo, ordem) {
  if (!plPlanilha_().getSheetByName('CAMPOS')) return null;

  var mesaId = '';
  if (plPlanilha_().getSheetByName('MESAS')) {
    var mesa = plLer_('MESAS').filter(function (m) {
      return plNormalizar_(m.Aba) === plNormalizar_(nomeAba);
    })[0];
    if (mesa) mesaId = mesa.Id;
  }

  return plInserir_('CAMPOS', {
    MesaId: mesaId,
    Aba: nomeAba,
    ChaveTecnica: plNormalizar_(cabecalho),
    Cabecalho: cabecalho,
    Rotulo: cabecalho,
    Descricao: '',
    TipoCampo: RECC_TIPO_CAMPO[tipo] || 'texto',
    Secao: 'Geral',
    Mascara: '',
    Obrigatorio: false,
    Protegido: false,
    Ativo: true,
    Ordem: ordem,
    VisivelPara: '',
    ValorPadrao: '',
    Configuracao: ''
  });
}

// ============================================================================
// CONFERÊNCIA — o sistema valida, nunca conserta sozinho
// ============================================================================

/**
 * Compara o que o contrato espera com o que a planilha tem.
 * Não cria, não renomeia, não apaga e não reordena nada: devolve o laudo
 * para a tela de reconciliação decidir com o administrador.
 */
function plConferirEstrutura_() {
  var ss = plPlanilha_();
  var laudo = { ok: true, abas: [] };

  reccNomesDasAbas_().forEach(function (nomeAba) {
    var def = reccEsquemaDaAba_(nomeAba);
    var item = {
      aba: nomeAba,
      existe: false,
      faltando: [],
      aMais: [],
      linhas: 0
    };

    var aba = ss.getSheetByName(nomeAba);
    if (!aba) {
      laudo.ok = false;
      laudo.abas.push(item);
      return;
    }
    item.existe = true;
    var info = plInfo_(nomeAba, true);
    item.linhas = plTotalDeDados_(info);
    var presentes = {};
    info.cabecalhos.forEach(function (c) {
      if (c) presentes[plNormalizar_(c)] = c;
    });

    var esperados = {};
    def.colunas.forEach(function (col) {
      esperados[plNormalizar_(col.c)] = col.c;
      if (presentes[plNormalizar_(col.c)] === undefined) item.faltando.push(col.c);
    });

    Object.keys(presentes).forEach(function (chave) {
      if (esperados[chave] === undefined) item.aMais.push(presentes[chave]);
    });

    if (item.faltando.length) laudo.ok = false;
    laudo.abas.push(item);
  });

  return laudo;
}
