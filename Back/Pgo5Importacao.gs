/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Importar Base Legada
 * ============================================================================
 * Arquivo: Pgo5Importacao.gs
 * Descrição: Traz atendimentos de uma planilha ANTIGA (4.x) para dentro do
 *            banco PGO 5.0 que já está em produção.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ----------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ----------------------------------------------------------------------------
 * ⚠️ ISTO NÃO É TOMBAMENTO.
 *
 *   Tombamento  → cria um banco NOVO e move tudo para lá. Roda uma vez, na
 *                 virada do sistema.
 *   Importação  → ACRESCENTA registros antigos ao banco que já está rodando.
 *                 Pode rodar quantas vezes quiser.
 *
 * O banco PGO atual é a produção oficial. Esta importação nunca recria,
 * apaga, limpa ou sobrescreve nada: ela só INSERE o que ainda não existe.
 *
 * COMO FUNCIONA (mesmo desenho do Prisma Performance)
 *   1. o ADM cola o link da planilha antiga e escolhe a aba;
 *   2. cada linha é validada ANTES de gravar — o que não passa é PULADO e
 *      contado por motivo, então nada entra pela metade;
 *   3. cada registro importado leva uma ETIQUETA em Observações
 *      ([import:<idDaPlanilha>:<linha>]). Reimportar a mesma planilha
 *      reconhece o que já entrou e não duplica;
 *   4. no fim devolve um relatório: importados, já existentes, pulados e o
 *      motivo de cada exclusão.
 *
 * O QUE ELA FAZ COM O CATÁLOGO
 * A planilha antiga guarda Produto, Categoria e Canal como TEXTO; o PGO 5.0
 * guarda Ids. A importação procura o item pelo nome e, se não existir, cria —
 * assim um produto que só existia no sistema antigo não vira "Sem dados".
 * Status segue a mesma ideia, mas casando pelo NOME TÉCNICO.
 * ----------------------------------------------------------------------------
 */

/**
 * Abas de origem conhecidas do banco 4.x.
 *
 * O 4.x separa os atendimentos por canal, uma aba para cada. O nome do canal
 * usado no PGO 5.0 sai daqui — a aba não tem coluna "Canal" confiável.
 * Acrescentar uma origem nova é acrescentar uma linha neste mapa.
 */
const PGO5_ORIGENS_LEGADAS_ = {
  ReclameAqui: { canal: 'Reclame Aqui' },
  SACPreventivo: { canal: 'SAC Preventivo' },
  // Aba pré-v4, anterior à separação por canal.
  Atendimentos: { canal: 'Reclame Aqui' }
};

/** Prefixo da etiqueta de importação gravada em Observações. */
const PGO5_ETIQUETA_IMPORT_ = '[import:';

/**
 * Extrai o Id do arquivo a partir da URL do Google Sheets (ou do Id puro).
 *
 * @param {string} url Link colado pelo ADM.
 * @returns {string} Id do arquivo.
 */
function pgo5IdDaPlanilhaLegada_(url) {
  const texto = String(url || '').trim();
  if (!texto) throw new Error('Informe o link (URL) da planilha antiga.');
  const casa = texto.match(/\/d\/([-\w]{25,})/) || texto.match(/^([-\w]{25,})$/);
  if (!casa) throw new Error('Link inválido: cole a URL completa da planilha antiga.');
  return casa[1];
}

/**
 * Converte a data legada para 'YYYY-MM-DD'.
 *
 * A planilha antiga tem os três formatos, dependendo de como a célula foi
 * preenchida: objeto Date, texto brasileiro e ISO. Devolver null quando não
 * reconhece é proposital — a linha é pulada e contada, em vez de entrar com
 * uma data inventada.
 *
 * @param {*} valor Conteúdo da célula.
 * @returns {string|null} Data no formato curto, ou null.
 */
function pgo5DataLegada_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, PGO5_FUSO_OFICIAL_, 'yyyy-MM-dd');
  }
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return br[3] + '-' + ('0' + br[2]).slice(-2) + '-' + ('0' + br[1]).slice(-2);
  return null;
}

/**
 * Índice { nomeNormalizado: Id } de um tipo do catálogo.
 *
 * @param {Object} catalogo Catálogo já lido.
 * @param {string} tipo Tipo do item (PGO5_TIPOS).
 * @param {string} [paiId] Filtra por pai, quando o tipo tem hierarquia.
 * @returns {Object} Mapa de nome para Id.
 */
function pgo5IndiceDoCatalogo_(catalogo, tipo, paiId) {
  const indice = {};
  (catalogo[tipo] || []).forEach(function(registro) {
    if (paiId !== undefined && String(registro.PaiId || '').trim() !== String(paiId)) return;
    const chave = normalizeText_(registro.Rotulo || registro.Nome);
    if (chave) indice[chave] = String(registro.Id || '').trim();
  });
  return indice;
}

/**
 * Devolve o Id de um item do catálogo, criando-o se ainda não existir.
 *
 * ⚠️ CRIAR É O COMPORTAMENTO CORRETO AQUI.
 * O sistema antigo tem produtos e categorias que o PGO 5.0 pode não ter
 * cadastrado. Sem criar, todo atendimento importado apontaria para um item
 * inexistente e apareceria como "Sem dados" — o histórico entraria ilegível.
 *
 * @param {Object} estado Estado da importação (índices e catálogo).
 * @param {string} tipo Tipo do item.
 * @param {string} rotulo Texto vindo da planilha antiga.
 * @param {string} [paiId] Pai, para Categoria e Subcategoria.
 * @returns {string} Id do item (existente ou recém-criado); '' se sem rótulo.
 */
function pgo5GarantirItemDoCatalogo_(estado, tipo, rotulo, paiId) {
  const texto = String(rotulo || '').trim();
  if (!texto) return '';

  const chaveIndice = tipo + '|' + (paiId || '');
  if (!estado.indices[chaveIndice]) {
    estado.indices[chaveIndice] = pgo5IndiceDoCatalogo_(
      estado.catalogo, tipo, paiId === undefined ? undefined : (paiId || ''));
  }
  const indice = estado.indices[chaveIndice];
  const chave = normalizeText_(texto);
  if (indice[chave]) return indice[chave];

  const linha = {
    Tipo: tipo,
    Nome: texto,
    Rotulo: texto,
    Ativo: true,
    Ordem: pgo5ProximaOrdem_(tipo, paiId || '')
  };
  if (paiId) linha.PaiId = paiId;

  const novo = pgo5Inserir(PGO5.SHEET_NAMES.FORMULARIO, linha);
  const id = String(novo.Id || '').trim();
  indice[chave] = id;
  estado.criadosNoCatalogo.push(tipo + ': ' + texto);
  return id;
}

/**
 * Converte UMA linha da planilha antiga em um atendimento do PGO 5.0.
 *
 * @param {Object} linha Linha lida (objeto por cabeçalho).
 * @param {Object} estado Estado da importação.
 * @param {Function} pular Registra o motivo de uma linha descartada.
 * @returns {Object|null} Registro pronto para a aba Atendimentos, ou null.
 */
function pgo5ConverterLinhaLegada_(linha, estado, pular) {
  if (isTrue_(linha.Excluido)) { pular('excluído no sistema antigo'); return null; }

  const data = pgo5DataLegada_(linha.DataAbertura);
  if (!data) { pular('data de abertura ausente ou ilegível'); return null; }
  if (data > estado.hoje) { pular('data de abertura no futuro'); return null; }

  const protocolo = pgo5TextoDeIdentificador_(linha.NumeroRA);
  if (!protocolo) { pular('sem protocolo'); return null; }

  // Produto → Categoria → Subcategoria: a hierarquia é preservada, então a
  // categoria nasce sob o produto certo em vez de virar um item solto.
  const produtoId = pgo5GarantirItemDoCatalogo_(estado, PGO5_TIPOS.PRODUTO, linha.Produto);
  const categoriaId = pgo5GarantirItemDoCatalogo_(
    estado, PGO5_TIPOS.CATEGORIA, linha.Categoria, produtoId);
  const subcategoriaId = pgo5GarantirItemDoCatalogo_(
    estado, PGO5_TIPOS.SUBCATEGORIA, linha.Subcategoria, categoriaId);

  // Status casa pelo NOME técnico; o que não existir entra como está.
  const statusId = pgo5GarantirItemDoCatalogo_(estado, PGO5_TIPOS.STATUS, linha.Status) ||
    pgo5IdDoStatusPendente_(estado.catalogo);

  // "Aguardando retorno de" só faz sentido em Pendente — a mesma regra do
  // formulário. Importar um aguardando preso a um caso concluído criaria no
  // banco um estado que a tela não sabe representar.
  let aguardandoId = '';
  if (pgo5StatusEhPendente_(statusId, estado.catalogo)) {
    aguardandoId = pgo5GarantirItemDoCatalogo_(
      estado, PGO5_TIPOS.AGUARDANDO, linha.MotivoPendencia);
  }

  const responsavelId = estado.usuariosPorNome[normalizeText_(linha.Responsavel)] || '';
  if (linha.Responsavel && !responsavelId) pular('responsável sem usuário correspondente (importado sem responsável)');

  return {
    DataAbertura: data,
    Protocolo: protocolo,
    Cliente: sanitizeInput(linha.Cliente || ''),
    CPF: pgo5TextoDeIdentificador_(linha.CPF),
    CanalId: estado.canalId,
    ProdutoId: produtoId,
    CategoriaId: categoriaId,
    SubcategoriaId: subcategoriaId,
    StatusId: statusId,
    AguardandoRetornoId: aguardandoId,
    ResponsavelId: responsavelId,
    Observacoes: String(linha.Observacoes || '')
  };
}

/**
 * (Permissão: configurarSistema + PIN) Importa atendimentos de uma planilha
 * antiga para o banco PGO 5.0 em produção.
 *
 * NUNCA apaga, limpa ou sobrescreve: só insere o que ainda não existe.
 *
 * @param {Object} payload { url, aba }.
 * @returns {Object} { importados, jaImportados, pulados, motivos, total,
 *   canal, criadosNoCatalogo }.
 */
function importarBaseLegadaPGO5(payload) {
  const ator = exigirPermissaoComPin_('configurarSistema');
  const entrada = payload || {};

  const idDaOrigem = pgo5IdDaPlanilhaLegada_(entrada.url);
  const abaNome = String(entrada.aba || '').trim();
  if (!abaNome) throw new Error('Informe a aba da planilha antiga.');

  const origem = PGO5_ORIGENS_LEGADAS_[abaNome];
  if (!origem) {
    throw new Error('Aba "' + abaNome + '" não é uma origem conhecida. Use: ' +
      Object.keys(PGO5_ORIGENS_LEGADAS_).join(', ') + '.');
  }

  // A planilha de origem é aberta SOMENTE PARA LEITURA. Nada é escrito nela.
  let planilha;
  try {
    planilha = SpreadsheetApp.openById(idDaOrigem);
  } catch (e) {
    throw new Error('Não foi possível abrir a planilha antiga. Confira o link e se você tem acesso a ela.');
  }
  if (planilha.getId() === getSpreadsheet().getId()) {
    throw new Error('A planilha de origem não pode ser a própria base do PGO.');
  }

  const aba = planilha.getSheetByName(abaNome);
  if (!aba) throw new Error('A aba "' + abaNome + '" não existe na planilha informada.');
  if (aba.getLastRow() < 2) {
    return {
      importados: 0, jaImportados: 0, pulados: 0, motivos: {}, total: 0,
      canal: origem.canal, criadosNoCatalogo: []
    };
  }

  const valores = aba.getDataRange().getValues();
  const cabecalho = valores[0].map(function(c) { return String(c || '').trim(); });

  const catalogo = pgo5CatalogoBruto_();
  const estado = {
    catalogo: catalogo,
    indices: {},
    criadosNoCatalogo: [],
    hoje: pgo5HojeEmSaoPaulo_(),
    usuariosPorNome: {},
    canalId: ''
  };
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(u) {
    estado.usuariosPorNome[normalizeText_(u.Nome)] = String(u.Id || '').trim();
  });
  estado.canalId = pgo5GarantirItemDoCatalogo_(estado, PGO5_TIPOS.CANAL, origem.canal);

  // ETIQUETAS JÁ IMPORTADAS — é o que torna a operação repetível.
  // Sem isto, rodar a importação duas vezes duplicaria a base inteira.
  const jaImportadas = {};
  pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS).forEach(function(a) {
    const casa = String(a.Observacoes || '').match(/\[import:[^\]]+\]/);
    if (casa) jaImportadas[casa[0]] = true;
  });

  const motivos = {};
  const pular = function(motivo) { motivos[motivo] = (motivos[motivo] || 0) + 1; };
  const prontos = [];
  let jaImportados = 0;

  for (let i = 1; i < valores.length; i++) {
    const etiqueta = PGO5_ETIQUETA_IMPORT_ + idDaOrigem + ':' + (i + 1) + ']';
    if (jaImportadas[etiqueta]) { jaImportados++; continue; }

    const linha = {};
    cabecalho.forEach(function(nome, coluna) { if (nome) linha[nome] = valores[i][coluna]; });

    const registro = pgo5ConverterLinhaLegada_(linha, estado, pular);
    if (!registro) continue;

    registro.Observacoes = (registro.Observacoes ? registro.Observacoes + ' ' : '') + etiqueta;
    prontos.push(registro);
  }

  // A gravação acontece dentro da trava, para não competir com quem estiver
  // registrando um atendimento pela tela no mesmo instante.
  const agora = toIso_(new Date());
  const gravados = withScriptLock_(function() {
    let total = 0;
    prontos.forEach(function(registro) {
      pgo5Inserir(PGO5.SHEET_NAMES.ATENDIMENTOS, Object.assign({}, registro, {
        CriadoPorId: String(ator.id),
        DataCriacao: agora,
        AtualizadoPorId: String(ator.id),
        DataAtualizacao: agora
      }));
      total++;
    });
    return total;
  });

  const pulados = Object.keys(motivos).reduce(function(soma, k) { return soma + motivos[k]; }, 0);

  registrarAuditoria_(ator, 'IMPORTAR_BASE_LEGADA', {
    aba: abaNome,
    importados: gravados,
    jaImportados: jaImportados,
    pulados: pulados
  });

  return {
    importados: gravados,
    jaImportados: jaImportados,
    pulados: pulados,
    motivos: motivos,
    total: valores.length - 1,
    canal: origem.canal,
    criadosNoCatalogo: estado.criadosNoCatalogo
  };
}

/**
 * (Permissão: configurarSistema) Lista as abas de origem que a importação
 * reconhece, para a tela não pedir que o ADM adivinhe o nome.
 *
 * @returns {Object} { origens: [{ aba, canal }] }.
 */
function listarOrigensLegadasPGO5() {
  exigirPermissao_('configurarSistema');
  return {
    origens: Object.keys(PGO5_ORIGENS_LEGADAS_).map(function(aba) {
      return { aba: aba, canal: PGO5_ORIGENS_LEGADAS_[aba].canal };
    })
  };
}
