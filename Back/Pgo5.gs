/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Fundação do banco PGO 5.0
 * ============================================================================
 * Arquivo: Pgo5.gs
 * Descrição: Schema 5.0.0 — as 5 abas do novo banco relacional leve, a
 *            inicialização segura, os IDs hexadecimais sequenciais e o
 *            CRUD básico sobre as novas tabelas.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * O PGO 5.0 troca as 11 abas do modelo 4.x por 5 tabelas relacionadas por
 * ID, como num banco de dados:
 *
 *   Atendimentos ──┬─ ValoresAtendimento   (campos dinâmicos do atendimento)
 *                  ├─ Usuários             (quem criou / quem é responsável)
 *                  └─ Formulário           (canal, produto, categoria, status…)
 *   Configurações                          (cargos, níveis, parâmetros)
 *
 * ESTA ETAPA CRIA APENAS A FUNDAÇÃO. Nenhum dado é migrado, nenhuma aba
 * antiga é apagada e nenhuma tela foi reescrita — isso pertence às etapas
 * seguintes. O sistema 4.x continua funcionando exatamente como está.
 *
 * ⚠️ DUAS ABAS TÊM NOME EM COMUM COM O MODELO ANTIGO:
 *   - "Usuários"     existe nos dois schemas, com COLUNAS DIFERENTES;
 *   - "Atendimentos" é o nome da aba legada pré-v4 (CONFIG.LEGACY_...).
 * Por isso a inicialização VALIDA antes de criar e ABORTA sem tocar em nada
 * quando encontra uma aba com estrutura divergente. Ver inicializarPGO5().
 * ------------------------------------------------------------------------
 */

// ============================================================================
// SCHEMA 5.0.0
// ============================================================================

const PGO5 = {
  SCHEMA_VERSION: '5.0.0',

  // As 5 (e somente 5) abas físicas do novo banco.
  SHEET_NAMES: {
    ATENDIMENTOS: 'Atendimentos',
    USUARIOS: 'Usuários',
    FORMULARIO: 'Formulário',
    VALORES_ATENDIMENTO: 'ValoresAtendimento',
    CONFIGURACOES: 'Configurações'
  },

  // Prefixo das Script Properties que guardam a sequência de cada tabela.
  // Chaves NOVAS — nenhuma chave existente (PRISMA_RA_*) é alterada.
  PREFIXO_SEQUENCIA: 'PGO5_SEQ_',

  // Maior ID possível com 8 dígitos hexadecimais.
  ID_MAXIMO: 0xFFFFFFFF
};

/**
 * Cabeçalhos oficiais de cada aba, na ORDEM EXATA.
 * A ordem faz parte do contrato: a validação compara posição a posição.
 */
const COLUMNS_PGO5 = {
  ATENDIMENTOS: [
    'Id',
    'DataAbertura',
    'Protocolo',
    // Cliente e CPF são ESTRUTURAIS: identificam o atendimento e são usados
    // por busca, checagem de duplicidade e relatórios. Ficar em
    // ValoresAtendimento obrigaria a percorrer a tabela de valores para
    // qualquer consulta por cliente.
    'Cliente',
    'CPF',
    'CanalId',
    'ProdutoId',
    'CategoriaId',
    'SubcategoriaId',
    'StatusId',
    'AguardandoRetornoId',
    'ResponsavelId',      // quem responde HOJE pelo atendimento (pode mudar)
    'Observacoes',
    'CriadoPorId',        // quem criou; NUNCA muda depois da criação
    'DataCriacao',
    'AtualizadoPorId',
    'DataAtualizacao'
  ],
  USUARIOS: [
  'Id',
  'Nome',
  'Email',
  'CargoId',
  'NivelAcessoId',
  'SupervisorId',
  'Equipe',
  'Ativo',
  'DataCadastro',
  'UltimoAcesso',
  'CriadoPorId',
  'DataAtualizacao',
  'Matrícula'
],
  FORMULARIO: [
    'Id',
    'Tipo',               // CANAL | CAMPO | PRODUTO | CATEGORIA | SUBCATEGORIA | STATUS | AGUARDANDO | OPCAO
    'Nome',
    'Rotulo',
    'TipoCampo',
    'PaiId',              // Produto → Categoria → Subcategoria
    'CanalId',
    'Obrigatorio',
    'Ativo',
    'Ordem',
    'Placeholder',
    'ValorPadrao',
    'Configuracao'
  ],
  VALORES_ATENDIMENTO: [
    'Id',
    'AtendimentoId',
    'CampoId',
    'Valor',
    // Os dois snapshots existem para o atendimento antigo continuar
    // compreensível mesmo que o campo seja excluído da configuração.
    'RotuloSnapshot',
    'TipoSnapshot'
  ],
  CONFIGURACOES: [
    'Id',
    'Tipo',               // CONFIG | CARGO | NIVEL_ACESSO | AUDITORIA | SLA | SEGURANCA
    'Chave',
    'Nome',
    'Valor',
    'ReferenciaId',
    'Configuracao',
    'Ativo',
    'UsuarioId',
    'Data'
  ]
};

/**
 * Devolve os cabeçalhos oficiais de uma aba do PGO 5.0.
 * @param {string} nomeAba - Nome da aba (PGO5.SHEET_NAMES).
 * @returns {string[]} Colunas na ordem oficial, ou [] se não for aba do 5.0.
 */
function pgo5Colunas_(nomeAba) {
  const mapa = {};
  mapa[PGO5.SHEET_NAMES.ATENDIMENTOS] = COLUMNS_PGO5.ATENDIMENTOS;
  mapa[PGO5.SHEET_NAMES.USUARIOS] = COLUMNS_PGO5.USUARIOS;
  mapa[PGO5.SHEET_NAMES.FORMULARIO] = COLUMNS_PGO5.FORMULARIO;
  mapa[PGO5.SHEET_NAMES.VALORES_ATENDIMENTO] = COLUMNS_PGO5.VALORES_ATENDIMENTO;
  mapa[PGO5.SHEET_NAMES.CONFIGURACOES] = COLUMNS_PGO5.CONFIGURACOES;
  return mapa[nomeAba] || [];
}

/** Lista das 5 abas na ordem em que devem ser criadas. */
function pgo5TodasAsAbas_() {
  return [
    PGO5.SHEET_NAMES.ATENDIMENTOS,
    PGO5.SHEET_NAMES.USUARIOS,
    PGO5.SHEET_NAMES.FORMULARIO,
    PGO5.SHEET_NAMES.VALORES_ATENDIMENTO,
    PGO5.SHEET_NAMES.CONFIGURACOES
  ];
}

// ============================================================================
// IDS HEXADECIMAIS SEQUENCIAIS
// ============================================================================
/*
 * Todo registro do PGO 5.0 recebe um ID de EXATAMENTE 8 caracteres
 * hexadecimais em CAIXA ALTA, com zeros à esquerda:
 *
 *   00000001 → 00000002 → … → 00000009 → 0000000A → … → 0000000F → 00000010
 *
 * Cada tabela tem a SUA sequência (equivale à chave primária de cada tabela
 * relacional). Nada de UUID, timestamp ou aleatório.
 *
 * POR QUE UMA MARCA D'ÁGUA EM SCRIPT PROPERTIES:
 * olhar só o maior ID da aba não basta — ao excluir a última linha, o maior
 * ID cairia e o próximo registro REAPROVEITARIA um ID já usado, criando
 * ambiguidade em qualquer referência antiga. A sequência guarda o maior ID
 * já emitido e nunca retrocede. O maior ID presente na aba ainda é
 * consultado como piso de segurança (cobre uma planilha populada por outro
 * meio, ou a propriedade perdida numa reinstalação).
 */

/**
 * Formata um número inteiro como ID hexadecimal do PGO (8 chars, uppercase).
 * @param {number} numero - Inteiro positivo.
 * @returns {string} Ex.: 16 → "00000010".
 */
function formatarIdHex_(numero) {
  return Number(numero).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Valida se um valor é um ID hexadecimal do PGO (8 dígitos hex).
 * Aceita minúsculas na LEITURA (planilha editada à mão), mas a geração
 * sempre produz caixa alta.
 * @param {*} valor - Valor lido da planilha.
 * @returns {boolean} true se for um ID válido.
 */
function ehIdHexValido_(valor) {
  return /^[0-9A-Fa-f]{8}$/.test(String(valor === null || valor === undefined ? '' : valor).trim());
}

/**
 * Converte um ID hexadecimal em número. Valores inválidos viram 0.
 * @param {*} valor - ID lido da planilha.
 * @returns {number} Valor numérico do ID.
 */
function idHexParaNumero_(valor) {
  if (!ehIdHexValido_(valor)) return 0;
  return parseInt(String(valor).trim(), 16);
}

/**
 * Maior ID hexadecimal presente na coluna Id de uma aba.
 * Lê a coluna inteira numa ÚNICA chamada (getValues em lote) e ignora o
 * cabeçalho e qualquer valor que não seja hexadecimal de 8 dígitos.
 * @param {Sheet} aba - Aba já obtida.
 * @returns {number} Maior ID como número, ou 0 se a aba estiver vazia.
 */
function maiorIdHexDaAba_(aba) {
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return 0; // só cabeçalho (ou vazia)

  const valores = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  let maior = 0;
  for (let i = 0; i < valores.length; i++) {
    const n = idHexParaNumero_(valores[i][0]);
    if (n > maior) maior = n;
  }
  return maior;
}

/**
 * Gera o PRÓXIMO ID hexadecimal da tabela informada.
 *
 * ⚠️ Deve ser chamada JÁ DENTRO da trava de escrita (withScriptLock_) quando
 * a geração e a gravação precisarem ser atômicas — é o que impede duas
 * gravações simultâneas de receberem o mesmo ID. pgo5Inserir faz isso.
 *
 * @param {string} nomeAba - Aba do PGO 5.0 (PGO5.SHEET_NAMES).
 * @returns {string} Próximo ID livre, ex.: "0000000A".
 * @throws {Error} Se a aba não for do schema 5.0 ou a sequência estourar.
 */
function gerarProximoIdHex_(nomeAba) {
  const colunas = pgo5Colunas_(nomeAba);
  if (colunas.length === 0) {
    throw new Error('PGO5: "' + nomeAba + '" não é uma aba do schema ' +
      PGO5.SCHEMA_VERSION + '. Sequência de ID não disponível.');
  }

  const props = PropertiesService.getScriptProperties();
  const chaveSeq = PGO5.PREFIXO_SEQUENCIA + nomeAba;

  const ultimoEmitido = idHexParaNumero_(props.getProperty(chaveSeq));
  const maiorNaAba = maiorIdHexDaAba_(pgo5Aba_(nomeAba));

  // O maior dos dois: a marca d'água não retrocede após uma exclusão, e o
  // piso da aba cobre linhas inseridas fora do sistema.
  const proximo = Math.max(ultimoEmitido, maiorNaAba) + 1;

  if (proximo > PGO5.ID_MAXIMO) {
    throw new Error('PGO5: a sequência de IDs da aba "' + nomeAba +
      '" chegou ao limite (FFFFFFFF).');
  }

  const id = formatarIdHex_(proximo);
  props.setProperty(chaveSeq, id);
  return id;
}

// ============================================================================
// ACESSO ÀS ABAS DO PGO 5.0
// ============================================================================

/**
 * Obtém uma aba do PGO 5.0, exigindo que ela exista.
 * @param {string} nomeAba - Nome da aba.
 * @returns {Sheet} A aba.
 * @throws {Error} 'PGO5: ...' quando a aba não existe.
 */
function pgo5Aba_(nomeAba) {
  const aba = getSpreadsheet().getSheetByName(nomeAba);
  if (!aba) {
    throw new Error('PGO5: a aba "' + nomeAba + '" não existe. ' +
      'Execute inicializarPGO5() para criar a estrutura do schema ' +
      PGO5.SCHEMA_VERSION + '.');
  }
  return aba;
}

/**
 * Compara o cabeçalho real de uma aba com o cabeçalho oficial do schema.
 * A comparação é POSICIONAL e exata — ordem faz parte do contrato.
 * @param {Sheet} aba - Aba a conferir.
 * @param {string[]} esperado - Colunas oficiais.
 * @returns {Object} { valido, encontrado, divergencia }.
 */
function pgo5ValidarCabecalho_(aba, esperado) {
  const ultimaColuna = aba.getLastColumn();
  const encontrado = ultimaColuna > 0
    ? aba.getRange(1, 1, 1, ultimaColuna).getValues()[0]
        .map(function(v) { return String(v === null || v === undefined ? '' : v).trim(); })
    : [];

  // Ignora colunas extras VAZIAS à direita (a planilha nasce com 26 colunas).
  while (encontrado.length > 0 && encontrado[encontrado.length - 1] === '') {
    encontrado.pop();
  }

  if (encontrado.length !== esperado.length) {
    return {
      valido: false, encontrado: encontrado,
      divergencia: 'esperava ' + esperado.length + ' colunas e encontrou ' + encontrado.length +
        ' — esperado: [' + esperado.join(', ') + '] / encontrado: [' + encontrado.join(', ') + ']'
    };
  }
  for (let i = 0; i < esperado.length; i++) {
    if (encontrado[i] !== esperado[i]) {
      return {
        valido: false, encontrado: encontrado,
        divergencia: 'coluna ' + (i + 1) + ' deveria ser "' + esperado[i] +
          '" e está como "' + encontrado[i] + '"'
      };
    }
  }
  return { valido: true, encontrado: encontrado, divergencia: '' };
}

// ============================================================================
// INICIALIZAÇÃO DO BANCO PGO 5.0
// ============================================================================

/**
 * Cria a estrutura do banco PGO 5.0 na planilha configurada.
 *
 * SEGURANÇA — o que esta função NUNCA faz:
 *   - não apaga dados, não limpa abas e não exclui abas;
 *   - não substitui cabeçalho existente;
 *   - não converte dados de outros sistemas (isso é da Importação);
 *   - não cria dados de exemplo (produto/categoria/status nascem vazios).
 *
 * FUNCIONAMENTO EM DOIS PASSOS:
 *   1. VALIDA todas as 5 abas que já existem. Se QUALQUER uma divergir do
 *      schema, aborta sem criar nada — evita deixar o banco meio criado.
 *      É o caso esperado numa instalação 4.x, onde "Usuários" já existe com
 *      outras colunas: a função avisa exatamente qual é a divergência.
 *   2. CRIA apenas as abas ausentes, com o cabeçalho oficial.
 *
 * É idempotente: rodar duas vezes seguidas não duplica nem altera nada.
 *
 * ⚠️ FUNÇÃO INTERNA (sufixo "_"): não é invocável pelo front-end.
 * O Apps Script só expõe a google.script.run funções SEM "_" no fim, então
 * este é o próprio mecanismo que impede a chamada a partir do navegador.
 *
 * Como usar:
 *   - base NOVA de desenvolvimento → executar inicializarPGO5Dev() no editor
 *     do Apps Script (não exige ADM: numa base vazia ainda não há usuários);
 *   - base JÁ EM USO → executar inicializarPGO5Admin(), que exige perfil ADM.
 *
 * @returns {Object} Relatório SEM dados pessoais:
 *   { schemaVersion, estruturaDetectada, abasCriadas, abasJaExistentes,
 *     abasValidas, erros, sucesso }.
 */
function inicializarPGO5_() {
  const relatorio = {
    schemaVersion: PGO5.SCHEMA_VERSION,
    estruturaDetectada: '',
    abasCriadas: [],
    abasJaExistentes: [],
    abasValidas: [],
    erros: [],
    sucesso: false
  };

  const ss = getSpreadsheet();
  const abas = pgo5TodasAsAbas_();

  // ── Passo 1: validação (não escreve nada) ──
  const ausentes = [];
  abas.forEach(function(nome) {
    const aba = ss.getSheetByName(nome);
    if (!aba) {
      ausentes.push(nome);
      return;
    }
    relatorio.abasJaExistentes.push(nome);
    const conferencia = pgo5ValidarCabecalho_(aba, pgo5Colunas_(nome));
    if (conferencia.valido) {
      relatorio.abasValidas.push(nome);
    } else {
      relatorio.erros.push('Aba "' + nome + '" já existe com estrutura incompatível: ' +
        conferencia.divergencia);
    }
  });

  if (relatorio.erros.length > 0) {
    relatorio.erros.push('Nenhuma aba foi criada ou alterada. ' +
      'Resolva as divergências acima (ou use uma planilha nova) antes de inicializar o PGO ' +
      PGO5.SCHEMA_VERSION + '.');
    relatorio.estruturaDetectada = detectarEstruturaBanco_(true);
    return relatorio;
  }

  // ── Passo 2: criação das ausentes, sob trava ──
  withScriptLock_(function() {
    ausentes.forEach(function(nome) {
      // Reconfere dentro da trava: outra execução pode ter criado a aba.
      if (ss.getSheetByName(nome)) {
        relatorio.abasJaExistentes.push(nome);
        relatorio.abasValidas.push(nome);
        return;
      }
      const colunas = pgo5Colunas_(nome);
      const aba = ss.insertSheet(nome);
      aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
      aplicarFormatoCabecalho_(aba, colunas.length);
      aplicarFormatoTextoEmIdentificadores_(aba, colunas);
      relatorio.abasCriadas.push(nome);
      relatorio.abasValidas.push(nome);
    });
  });

  relatorio.estruturaDetectada = detectarEstruturaBanco_(true);
  relatorio.sucesso = relatorio.erros.length === 0;
  Logger.log('[PGO5] Inicialização: ' + relatorio.abasCriadas.length + ' aba(s) criada(s), ' +
    relatorio.abasJaExistentes.length + ' já existente(s).');
  return relatorio;
}

/**
 * (EDITOR) Inicializa uma base de DESENVOLVIMENTO nova.
 *
 * Sem exigência de perfil de propósito: numa planilha recém-criada ainda não
 * existe nenhum usuário cadastrado, então pedir ADM tornaria a primeira
 * instalação impossível. A proteção real é o contexto — esta função só
 * roda a partir do editor do Apps Script, nunca pelo Web App, porque
 * chama a implementação interna e recusa executar sobre uma base que já
 * tenha usuários cadastrados.
 *
 * Aponte a planilha sintética pela Script Property do projeto
 * (configurarPlanilha('<id>')). NUNCA versione esse id.
 *
 * @returns {Object} Relatório da inicialização + do seed estrutural.
 */
function inicializarPGO5Dev() {
  // GUARDA TÉCNICA (não é só convenção): o Web App é publicado como
  // "executar como eu", então para um visitante o usuário ATIVO (quem
  // acessa) é diferente do EFETIVO (o dono do script). No editor os dois
  // são a mesma conta. Chamadas vindas do navegador de terceiros param aqui.
  let ativo = '';
  let efetivo = '';
  try { ativo = Session.getActiveUser().getEmail() || ''; } catch (e) { ativo = ''; }
  try { efetivo = Session.getEffectiveUser().getEmail() || ''; } catch (e) { efetivo = ''; }
  if (!ativo || !efetivo || normalizeText_(ativo) !== normalizeText_(efetivo)) {
    throw new Error('PGO5: a inicialização de desenvolvimento só pode ser executada pelo ' +
      'dono do projeto, no editor do Apps Script.');
  }

  if (pgo5PossuiUsuarios_()) {
    throw new Error('PGO5: esta base já possui usuários cadastrados. ' +
      'Use inicializarPGO5Admin() (exige perfil ADM) em vez da inicialização de desenvolvimento.');
  }
  const relatorio = inicializarPGO5_();
  if (relatorio.sucesso) {
    relatorio.ajusteSchema = ajustarSchemaClienteCpfPGO5_();
    relatorio.seed = pgo5AplicarSeedEstrutural_();
    relatorio.seedAcesso = aplicarSeedPermissoesPGO5_();
  }
  return relatorio;
}

/**
 * (ADM) Reexecuta a inicialização sobre uma base já em uso — por exemplo
 * para recriar uma aba do schema 5.0 removida por engano.
 * Continua sendo não-destrutiva e idempotente.
 * @returns {Object} Relatório da inicialização + do seed estrutural.
 */
function inicializarPGO5Admin() {
  exigirPermissao_('configurarSistema');
  const relatorio = inicializarPGO5_();
  if (relatorio.sucesso) {
    relatorio.ajusteSchema = ajustarSchemaClienteCpfPGO5_();
    relatorio.seed = pgo5AplicarSeedEstrutural_();
    relatorio.seedAcesso = aplicarSeedPermissoesPGO5_();
    relatorio.conversaoClienteCpf = converterClienteCpfDinamicosPGO5_();
  }
  return relatorio;
}

/**
 * true quando a aba Usuários do PGO 5.0 já tem pelo menos uma linha.
 * Usado para impedir que a inicialização "de desenvolvimento" seja aplicada
 * a uma base que já está em uso.
 * @returns {boolean}
 */
function pgo5PossuiUsuarios_() {
  try {
    const ss = getSpreadsheet();
    const aba = ss.getSheetByName(PGO5.SHEET_NAMES.USUARIOS);
    if (!aba) return false;
    if (!pgo5ValidarCabecalho_(aba, pgo5Colunas_(PGO5.SHEET_NAMES.USUARIOS)).valido) return false;
    return aba.getLastRow() > 1;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// AJUSTE DE DESENVOLVIMENTO — Cliente/CPF estruturais
// ============================================================================
/*
 * Durante as Etapas 1 e 2 a aba Atendimentos nasceu com 15 colunas, sem
 * Cliente e CPF. O schema aprovado passou a ter 17. Como o 5.0 ainda não foi
 * publicado, não há versão nova: só é preciso levar as bases SINTÉTICAS de
 * desenvolvimento do formato antigo para o atual.
 *
 * Só reconhece duas formas
 * exatas — a de 15 colunas e a de 17. Qualquer outra estrutura falha e é
 * reportada, nunca "consertada" às cegas.
 */

/** Cabeçalho de Atendimentos usado nas Etapas 1 e 2 (antes de Cliente/CPF). */
function pgo5AtendimentosSchemaAntigo_() {
  return ['Id', 'DataAbertura', 'Protocolo', 'CanalId', 'ProdutoId', 'CategoriaId',
    'SubcategoriaId', 'StatusId', 'AguardandoRetornoId', 'ResponsavelId', 'Observacoes',
    'CriadoPorId', 'DataCriacao', 'AtualizadoPorId', 'DataAtualizacao'];
}

/**
 * (ADM) Acrescenta Cliente e CPF à aba Atendimentos de uma base PGO 5.0 de
 * desenvolvimento criada antes da correção de schema.
 *
 * Preserva todas as linhas: cada registro é remapeado pelo NOME da coluna,
 * então nenhum valor troca de lugar. A aba não é apagada nem recriada.
 *
 * @returns {Object} { estado, linhasPreservadas, erro }.
 *   estado: 'JA_ATUALIZADO' | 'CONVERTIDO' | 'ESTRUTURA_DESCONHECIDA'.
 */
function ajustarSchemaClienteCpfPGO5() {
  exigirPermissao_('configurarSistema');
  return ajustarSchemaClienteCpfPGO5_();
}

/** Implementação interna (também usada pelos wrappers de inicialização). */
function ajustarSchemaClienteCpfPGO5_() {
  const nome = PGO5.SHEET_NAMES.ATENDIMENTOS;
  const atual = pgo5Colunas_(nome);
  const antigo = pgo5AtendimentosSchemaAntigo_();

  const aba = getSpreadsheet().getSheetByName(nome);
  if (!aba) return { estado: 'ESTRUTURA_DESCONHECIDA', linhasPreservadas: 0, erro: 'Aba "' + nome + '" não existe.' };

  if (pgo5ValidarCabecalho_(aba, atual).valido) {
    return { estado: 'JA_ATUALIZADO', linhasPreservadas: Math.max(0, aba.getLastRow() - 1), erro: '' };
  }
  const conferenciaAntiga = pgo5ValidarCabecalho_(aba, antigo);
  if (!conferenciaAntiga.valido) {
    return {
      estado: 'ESTRUTURA_DESCONHECIDA', linhasPreservadas: 0,
      erro: 'A aba "' + nome + '" não está nem no formato de 15 colunas nem no de 17. ' +
        'Nada foi alterado. Divergência: ' + conferenciaAntiga.divergencia
    };
  }

  return withScriptLock_(function() {
    const ultimaLinha = aba.getLastRow();
    const dados = ultimaLinha > 1 ? aba.getRange(2, 1, ultimaLinha - 1, antigo.length).getValues() : [];

    // Remapeia pelo NOME da coluna: as colunas novas nascem vazias e nenhum
    // valor existente muda de posição.
    const linhas = dados.map(function(linha) {
      const registro = {};
      antigo.forEach(function(col, i) { registro[col] = linha[i]; });
      return atual.map(function(col) {
        return registro[col] === undefined ? '' : registro[col];
      });
    });

    aba.getRange(1, 1, 1, atual.length).setValues([atual]);
    if (linhas.length > 0) aba.getRange(2, 1, linhas.length, atual.length).setValues(linhas);
    aplicarFormatoCabecalho_(aba, atual.length);
    limparMemoEstrutura_();
    limparMemoExecucao_(nome);

    Logger.log('[PGO5] Aba Atendimentos ajustada para 17 colunas. ' +
      linhas.length + ' linha(s) preservada(s).');
    return { estado: 'CONVERTIDO', linhasPreservadas: linhas.length, erro: '' };
  });
}

/**
 * (ADM) Move Cliente/CPF que ficaram em ValoresAtendimento para as colunas
 * estruturais do atendimento, e remove SOMENTE essas linhas dinâmicas.
 *
 * Idempotente: rodar de novo não encontra nada para converter. Nenhum outro
 * valor dinâmico é tocado.
 *
 * @returns {Object} { atendimentosAtualizados, valoresRemovidos }.
 */
function converterClienteCpfDinamicosPGO5() {
  exigirPermissao_('configurarSistema');
  return converterClienteCpfDinamicosPGO5_();
}

/** Implementação interna da conversão de Cliente/CPF dinâmicos. */
function converterClienteCpfDinamicosPGO5_() {
  return withScriptLock_(function() {
    const catalogo = pgo5CatalogoBruto_();

    // Só campos cujo Nome técnico é reconhecidamente cliente/cpf.
    const alvo = {};
    catalogo.CAMPO.forEach(function(c) {
      const n = String(c.Nome || '').trim();
      if (n === 'cliente' || n === 'cpf') {
        alvo[String(c.Id || '').toUpperCase()] = n === 'cliente' ? 'Cliente' : 'CPF';
      }
    });

    const relatorio = { atendimentosAtualizados: 0, valoresRemovidos: 0 };
    if (Object.keys(alvo).length === 0) return relatorio;

    const porAtendimento = {};
    const aRemover = [];
    pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).forEach(function(v) {
      const coluna = alvo[String(v.CampoId || '').toUpperCase()];
      if (!coluna) return;
      const at = String(v.AtendimentoId || '').trim();
      if (!at) return;
      if (!porAtendimento[at]) porAtendimento[at] = {};
      porAtendimento[at][coluna] = v.Valor;
      aRemover.push(v.Id);
    });

    Object.keys(porAtendimento).forEach(function(id) {
      const ok = pgo5AtualizarPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, id, porAtendimento[id]);
      if (ok) relatorio.atendimentosAtualizados++;
    });
    aRemover.forEach(function(id) {
      if (pgo5ExcluirPorId(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, id)) relatorio.valoresRemovidos++;
    });

    // Nenhum valor é registrado em log: Cliente e CPF são dado pessoal.
    Logger.log('[PGO5] Conversão Cliente/CPF: ' + relatorio.atendimentosAtualizados +
      ' atendimento(s) atualizado(s), ' + relatorio.valoresRemovidos + ' linha(s) dinâmica(s) removida(s).');
    return relatorio;
  });
}

// ============================================================================
// DETECÇÃO DE ESTRUTURA (4.x LEGADO × PGO 5.0)
// ============================================================================

/** Memo da detecção — a estrutura não muda no meio de uma execução. */
var PGO5_ESTRUTURA_MEMO_ = null;

/**
 * Identifica sobre qual estrutura o sistema está rodando.
 *
 * Regra: "PGO5" só quando as 5 abas existem COM o cabeçalho oficial —
 * conferir apenas o nome não bastaria, porque "Usuários" e "Atendimentos"
 * também existem no modelo antigo.
 *
 * @param {boolean} [recalcular] - true ignora o memo desta execução.
 * @returns {string} 'PGO5' | 'LEGADO' | 'DESCONHECIDO'.
 */
function detectarEstruturaBanco_(recalcular) {
  if (!recalcular && PGO5_ESTRUTURA_MEMO_ !== null) return PGO5_ESTRUTURA_MEMO_;

  let resultado = 'DESCONHECIDO';
  try {
    const ss = getSpreadsheet();

    const todasPgo5 = pgo5TodasAsAbas_().every(function(nome) {
      const aba = ss.getSheetByName(nome);
      return !!aba && pgo5ValidarCabecalho_(aba, pgo5Colunas_(nome)).valido;
    });

    if (todasPgo5) {
      resultado = 'PGO5';
    } else {
      // Abas que só existem no modelo 4.x — se alguma está lá, é legado.
      const marcasLegado = [
        CONFIG.SHEET_NAMES.RECLAME_AQUI,
        CONFIG.SHEET_NAMES.SAC_PREVENTIVO,
        CONFIG.SHEET_NAMES.CONFIG_CAMPOS,
        CONFIG.SHEET_NAMES.TIMELINE,
        CONFIG.SHEET_NAMES.HISTORICO
      ];
      const ehLegado = marcasLegado.some(function(nome) { return !!ss.getSheetByName(nome); });
      resultado = ehLegado ? 'LEGADO' : 'DESCONHECIDO';
    }
  } catch (e) {
    Logger.log('[PGO5] Não foi possível detectar a estrutura: ' + e.message);
    resultado = 'DESCONHECIDO';
  }

  PGO5_ESTRUTURA_MEMO_ = resultado;
  return resultado;
}

/** true quando o sistema está rodando sobre um banco PGO 5.0. */
function emBasePGO5_() {
  return detectarEstruturaBanco_() === 'PGO5';
}

/** Limpa o memo da detecção (usado após inicializar/alterar a estrutura). */
function limparMemoEstrutura_() {
  PGO5_ESTRUTURA_MEMO_ = null;
}

// ============================================================================
// CRUD DAS TABELAS DO PGO 5.0
// ============================================================================
/*
 * Todas as funções abaixo trabalham em LOTE (getValues/setValues) e nunca
 * célula a célula. As gravações passam por withScriptLock_, a mesma trava
 * reentrante usada pelo restante do sistema.
 */

/**
 * Lê todos os registros de uma tabela do PGO 5.0 como objetos.
 * O mapeamento é feito pelo NOME do cabeçalho real (não pela posição), então
 * uma coluna extra na planilha não desloca os campos.
 * @param {string} nomeAba - Aba do PGO 5.0.
 * @returns {Object[]} Lista de registros (vazia se só houver cabeçalho).
 */
function pgo5Ler(nomeAba) {
  const colunas = pgo5Colunas_(nomeAba);
  if (colunas.length === 0) {
    throw new Error('PGO5: "' + nomeAba + '" não é uma aba do schema ' + PGO5.SCHEMA_VERSION + '.');
  }

  const aba = pgo5Aba_(nomeAba);
  const ultimaLinha = aba.getLastRow();
  const ultimaColuna = aba.getLastColumn();
  if (ultimaLinha < 2 || ultimaColuna === 0) return [];

  const dados = aba.getRange(1, 1, ultimaLinha, ultimaColuna).getValues();
  const cabecalho = dados[0].map(function(v) { return String(v === null || v === undefined ? '' : v).trim(); });

  const indice = {};
  colunas.forEach(function(col) { indice[col] = cabecalho.indexOf(col); });

  const registros = [];
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const vazia = linha.every(function(c) { return c === '' || c === null || c === undefined; });
    if (vazia) continue;

    const obj = {};
    colunas.forEach(function(col) {
      const idx = indice[col];
      obj[col] = (idx !== -1 && idx < linha.length) ? linha[idx] : '';
    });
    registros.push(obj);
  }
  return registros;
}

/**
 * Busca um registro pelo Id.
 * @param {string} nomeAba - Aba do PGO 5.0.
 * @param {string} id - ID hexadecimal.
 * @returns {Object|null} Registro ou null quando não existe.
 */
function pgo5ObterPorId(nomeAba, id) {
  if (!id) return null;
  const alvo = String(id).trim().toUpperCase();
  return pgo5Ler(nomeAba).find(function(r) {
    return String(r.Id || '').trim().toUpperCase() === alvo;
  }) || null;
}

/**
 * Insere um registro, gerando o Id hexadecimal sequencial da tabela.
 *
 * A geração do ID e a gravação acontecem DENTRO da mesma trava — é isso que
 * garante que duas execuções simultâneas nunca recebam o mesmo ID.
 * Um Id enviado em `dados` é ignorado: a sequência é a única fonte de IDs.
 *
 * @param {string} nomeAba - Aba do PGO 5.0.
 * @param {Object} dados - Campos do registro (chaves = nomes de coluna).
 * @returns {Object} O registro gravado, incluindo o Id gerado.
 */
function pgo5Inserir(nomeAba, dados) {
  const colunas = pgo5Colunas_(nomeAba);
  if (colunas.length === 0) {
    throw new Error('PGO5: "' + nomeAba + '" não é uma aba do schema ' + PGO5.SCHEMA_VERSION + '.');
  }
  const entrada = dados || {};

  return withScriptLock_(function() {
    const aba = pgo5Aba_(nomeAba);
    const conferencia = pgo5ValidarCabecalho_(aba, colunas);
    if (!conferencia.valido) {
      throw new Error('PGO5: não é seguro gravar na aba "' + nomeAba +
        '" — ' + conferencia.divergencia);
    }

    const id = gerarProximoIdHex_(nomeAba);
    const registro = {};
    colunas.forEach(function(col) {
      registro[col] = entrada[col] === undefined || entrada[col] === null ? '' : entrada[col];
    });
    registro.Id = id;

    const linha = colunas.map(function(col) { return registro[col]; });
    aba.getRange(aba.getLastRow() + 1, 1, 1, colunas.length).setValues([linha]);
    return registro;
  });
}

/**
 * Atualiza um registro pelo Id, mesclando apenas os campos informados.
 * O Id NUNCA é alterado.
 * @param {string} nomeAba - Aba do PGO 5.0.
 * @param {string} id - ID hexadecimal do registro.
 * @param {Object} dados - Campos a alterar.
 * @returns {Object|null} Registro atualizado, ou null se o Id não existir.
 */
function pgo5AtualizarPorId(nomeAba, id, dados) {
  const colunas = pgo5Colunas_(nomeAba);
  if (colunas.length === 0) {
    throw new Error('PGO5: "' + nomeAba + '" não é uma aba do schema ' + PGO5.SCHEMA_VERSION + '.');
  }
  if (!id) return null;
  const entrada = dados || {};

  return withScriptLock_(function() {
    const aba = pgo5Aba_(nomeAba);
    const conferencia = pgo5ValidarCabecalho_(aba, colunas);
    if (!conferencia.valido) {
      throw new Error('PGO5: não é seguro gravar na aba "' + nomeAba +
        '" — ' + conferencia.divergencia);
    }

    const linhaAlvo = pgo5LinhaPorId_(aba, id);
    if (linhaAlvo === -1) return null;

    const atual = aba.getRange(linhaAlvo, 1, 1, colunas.length).getValues()[0];
    const registro = {};
    colunas.forEach(function(col, i) { registro[col] = atual[i]; });

    colunas.forEach(function(col) {
      if (col === 'Id') return; // chave primária é imutável
      if (entrada[col] !== undefined) registro[col] = entrada[col];
    });

    aba.getRange(linhaAlvo, 1, 1, colunas.length)
      .setValues([colunas.map(function(col) { return registro[col]; })]);
    return registro;
  });
}

/**
 * Exclui FISICAMENTE a linha de um registro (o PGO 5.0 não usa exclusão
 * lógica — não há colunas Excluido/ExcluidoPor/DataExclusao).
 *
 * NÃO há exclusão em cascata: apagar um registro nunca apaga linhas
 * relacionadas em outra tabela. As regras funcionais de integridade serão
 * tratadas nas etapas seguintes.
 *
 * O ID excluído NÃO volta a ser usado — a sequência da tabela não retrocede.
 *
 * @param {string} nomeAba - Aba do PGO 5.0.
 * @param {string} id - ID hexadecimal do registro.
 * @returns {boolean} true se excluiu, false se o Id não existia.
 */
function pgo5ExcluirPorId(nomeAba, id) {
  const colunas = pgo5Colunas_(nomeAba);
  if (colunas.length === 0) {
    throw new Error('PGO5: "' + nomeAba + '" não é uma aba do schema ' + PGO5.SCHEMA_VERSION + '.');
  }
  if (!id) return false;

  return withScriptLock_(function() {
    const aba = pgo5Aba_(nomeAba);
    const linhaAlvo = pgo5LinhaPorId_(aba, id);
    if (linhaAlvo === -1) return false;
    aba.deleteRow(linhaAlvo);
    return true;
  });
}

/**
 * Localiza o número da linha de um Id (1-based, considerando o cabeçalho).
 * Lê apenas a coluna Id, em lote.
 * @param {Sheet} aba - Aba já obtida.
 * @param {string} id - ID procurado.
 * @returns {number} Número da linha, ou -1 se não encontrado.
 */
function pgo5LinhaPorId_(aba, id) {
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return -1;

  const alvo = String(id).trim().toUpperCase();
  const ids = aba.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim().toUpperCase() === alvo) return i + 2;
  }
  return -1;
}

/**
 * Colunas que guardam IDENTIFICADORES digitados, e não números.
 *
 * "00123" precisa continuar "00123". Se a coluna ficar no formato
 * automático, o Google Sheets lê a string como número, mostra 123 e os
 * zeros à esquerda somem — o identificador deixa de servir para consulta.
 */
const PGO5_COLUNAS_DE_IDENTIFICADOR = ['CPF', 'Protocolo'];

/**
 * Formata como TEXTO as colunas de identificador da aba.
 *
 * Aplicado na criação da aba, uma única vez por coluna. Sem isto, gravar
 * "0" resultaria no número 0 e "01234567890" viraria 1234567890.
 *
 * A formatação é opcional do ponto de vista do código: se a API não estiver
 * disponível (como no ambiente de teste), a função simplesmente não faz
 * nada e a gravação continua funcionando.
 *
 * @param {Sheet} aba Aba recém-criada.
 * @param {string[]} colunas Cabeçalhos na ordem oficial.
 * @returns {void}
 */
function aplicarFormatoTextoEmIdentificadores_(aba, colunas) {
  try {
    const totalLinhas = aba.getMaxRows ? aba.getMaxRows() : 1000;
    PGO5_COLUNAS_DE_IDENTIFICADOR.forEach(function(nomeColuna) {
      const posicao = colunas.indexOf(nomeColuna);
      if (posicao === -1) return;
      const intervalo = aba.getRange(2, posicao + 1, Math.max(1, totalLinhas - 1), 1);
      if (typeof intervalo.setNumberFormat === 'function') intervalo.setNumberFormat('@');
    });
  } catch (erro) {
    Logger.log('[PGO5] Formato de texto não aplicado: ' + erro.message);
  }
}
