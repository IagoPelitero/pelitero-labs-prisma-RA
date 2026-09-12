/**
 * ============================================================================
 * RECC — Sequencia.gs · o gerador de Id
 * ============================================================================
 * O Id do RECC é DECIMAL, PROGRESSIVO, de 10 CASAS, começando em 0000000000.
 * Dez casas dão dez bilhões de combinações.
 *
 * Três regras, e cada uma existe por causa de um estrago real no sistema
 * anterior:
 *
 *   1. A sequência mora em Script Properties, NUNCA na planilha.
 *      A planilha é editável à mão; um contador dentro dela seria zerado sem
 *      querer numa tarde qualquer.
 *
 *   2. A sequência NUNCA anda para trás.
 *      Quando o Sheets deformava um Id, o gerador não o reconhecia, rebaixava
 *      o piso da aba e voltava a emitir Id já em uso. Aqui o piso é sempre
 *      max(último guardado, maior Id encontrado na aba).
 *
 *   3. Toda emissão acontece dentro de uma trava.
 *      Sem isso, dois usuários salvando no mesmo segundo recebem o mesmo Id.
 *      Quem chama (Planilha.gs) já segura a trava.
 * ============================================================================
 */

const RECC_PREFIXO_SEQUENCIA = 'RECC_SEQ_';

/** 42 vira "0000000042". */
function seqFormatar_(numero) {
  var texto = String(Math.floor(numero));
  while (texto.length < 10) texto = '0' + texto;
  return texto;
}

/**
 * O maior Id já presente na aba, como número. -1 quando a aba está vazia.
 * Ids deformados (texto que não é dígito) são ignorados de propósito: eles
 * não podem rebaixar nem levantar o piso.
 */
function seqMaiorIdDaAba_(nomeAba) {
  var info = plInfo_(nomeAba);
  var iId = plIndice_(info, 'Id');
  if (iId < 0) return -1;

  var totalDados = plTotalDeDados_(info);
  if (totalDados <= 0) return -1;

  var coluna = info.aba.getRange(2, iId + 1, totalDados, 1).getValues();
  var maior = -1;
  for (var i = 0; i < coluna.length; i++) {
    var digitos = plCoagirId_(coluna[i][0]);
    if (!digitos) continue;
    var n = Number(digitos);
    if (isFinite(n) && n > maior) maior = n;
  }
  return maior;
}

/**
 * O próximo Id da aba.
 * DEVE ser chamada dentro de uma trava — plInserirVarios_ já segura a dela.
 */
function seqProximoId_(nomeAba) {
  var props = PropertiesService.getScriptProperties();
  var chave = RECC_PREFIXO_SEQUENCIA + nomeAba;
  var guardado = props.getProperty(chave);

  var ultimo;
  if (guardado === null) {
    // Primeira emissão desta aba nesta instalação: alinha com o que já existe
    // na planilha, para nunca reemitir um Id que já está gravado.
    ultimo = seqMaiorIdDaAba_(nomeAba);
  } else {
    ultimo = Number(guardado);
    if (!isFinite(ultimo)) ultimo = seqMaiorIdDaAba_(nomeAba);
  }

  var proximo = ultimo + 1;
  if (proximo > RECC_ID_MAXIMO) {
    throw new Error('A sequência da aba "' + nomeAba + '" chegou ao teto de 10 ' +
      'casas decimais (' + RECC_ID_MAXIMO + ').');
  }

  props.setProperty(chave, String(proximo));
  return seqFormatar_(proximo);
}

/**
 * Realinha a sequência com a planilha, sem nunca baixá-la.
 * Chamada depois de uma carga feita direto na planilha.
 */
function seqRealinhar_(nomeAba) {
  var props = PropertiesService.getScriptProperties();
  var chave = RECC_PREFIXO_SEQUENCIA + nomeAba;
  var guardado = Number(props.getProperty(chave));
  if (!isFinite(guardado)) guardado = -1;

  var naAba = seqMaiorIdDaAba_(nomeAba);
  var piso = Math.max(guardado, naAba);
  props.setProperty(chave, String(piso));
  return { aba: nomeAba, guardado: guardado, naAba: naAba, piso: piso };
}

/**
 * NORMALIZAR BASE — carimba Id em linha que entrou direto na planilha.
 *
 * Quem digita uma linha à mão não gera Id. Sem Id não há relacionamento, e
 * a atualização por Id não acha o registro. Esta rotina percorre a aba, dá
 * Id a quem está sem, e realinha a sequência.
 *
 * Só lê e escreve a coluna de Id: não toca em mais nada da linha.
 */
function seqNormalizarBase_(nomeAba) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(30000)) {
    throw new Error('A planilha está ocupada. Tente de novo.');
  }
  try {
    plLimparCache_(nomeAba);
    var info = plInfo_(nomeAba, true);
    var iId = plIndice_(info, 'Id');
    if (iId < 0) {
      throw new Error('A aba "' + nomeAba + '" não tem coluna Id.');
    }

    var totalDados = plTotalDeDados_(info);
    if (totalDados <= 0) {
      return { aba: nomeAba, carimbados: 0, repetidos: [], total: 0 };
    }

    seqRealinhar_(nomeAba);

    // Lê a aba inteira, e não só a coluna de Id: uma linha sem Id só se
    // distingue de uma linha em branco olhando as outras colunas.
    var bloco = info.aba
      .getRange(2, 1, totalDados, info.cabecalhos.length)
      .getValues();

    var faixa = info.aba.getRange(2, iId + 1, totalDados, 1);
    var coluna = faixa.getValues();
    var vistos = {};
    var repetidos = [];
    var carimbados = 0;

    for (var i = 0; i < coluna.length; i++) {
      var atual = plCoagirId_(coluna[i][0]);
      if (!atual) {
        if (plLinhaVazia_(bloco[i])) continue;   // linha em branco não ganha Id
        coluna[i][0] = seqProximoId_(nomeAba);
        carimbados++;
        continue;
      }
      var normalizado = seqFormatar_(Number(atual));
      if (vistos[normalizado]) {
        repetidos.push({ linha: i + 2, id: normalizado });
      } else {
        vistos[normalizado] = true;
      }
      coluna[i][0] = normalizado;
    }

    // Texto ANTES do valor: é o que impede 0000000010 de virar 10.
    faixa.setNumberFormat('@');
    faixa.setValues(coluna);

    return {
      aba: nomeAba,
      total: totalDados,
      carimbados: carimbados,
      repetidos: repetidos
    };
  } finally {
    trava.releaseLock();
  }
}
