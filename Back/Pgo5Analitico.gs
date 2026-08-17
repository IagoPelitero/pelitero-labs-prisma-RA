/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Analitico.gs
 *
 * RESPONSABILIDADE
 * As telas que LEEM e RESUMEM os atendimentos:
 *
 *   Relatórios           → a lista filtrável, com exportação
 *   Produtividade Equipe → KPIs, agrupamentos e evolução no tempo
 *
 * A Análise de SAC não mora aqui: ela lê uma planilha EXTERNA e continua em
 * Services.gs. O que este arquivo oferece a ela é apenas a persistência do
 * "Fora da SLA" no banco novo (ver o bloco SLA no fim).
 *
 * ⚠️ CADA TELA TEM O SEU PRÓPRIO ESCOPO
 * Enxergar um atendimento na tela de trabalho e enxergá-lo num relatório
 * são coisas diferentes. Por isso existem permissões separadas:
 *
 *   verProprios / verEquipe / verTodos              → telas operacionais
 *   relatoriosProprios / relatoriosEquipe / …Todos  → Relatórios
 *   produtividadeEquipe / produtividadeTodos        → Produtividade
 *
 * Um analista pode editar os próprios atendimentos e mesmo assim não ter
 * relatório nenhum. O contrário também vale.
 *
 * ⚠️ O RECORTE É FEITO NO SERVIDOR
 * Nada de mandar tudo para o navegador e filtrar lá. O que o usuário não
 * pode ver não sai daqui — e isso vale também para a exportação, que
 * reaproveita exatamente a mesma lista.
 * ============================================================================
 */

// ============================================================================
// ESCOPO DE CADA TELA
// ============================================================================

/**
 * Até onde o usuário enxerga na tela de RELATÓRIOS.
 *
 *   'TODOS'    → toda a operação
 *   'EQUIPE'   → ele mesmo + toda a árvore abaixo dele
 *   'PROPRIOS' → só os atendimentos dele
 *   'NENHUM'   → sem acesso à tela
 *
 * @param {Object} usuario Registro do usuário (linha da aba Usuários).
 * @returns {string} O escopo resolvido.
 */
function obterEscopoRelatorios_(usuario) {
  const permissoes = obterPermissoesUsuario_(usuario);
  if (permissoes.indexOf('relatoriosTodos') !== -1) return 'TODOS';
  if (permissoes.indexOf('relatoriosEquipe') !== -1) return 'EQUIPE';
  if (permissoes.indexOf('relatoriosProprios') !== -1) return 'PROPRIOS';
  return 'NENHUM';
}

/**
 * Até onde o usuário enxerga na tela de PRODUTIVIDADE EQUIPE.
 *
 * Não existe "produtividade própria": a tela é sobre comparar pessoas, e
 * um analista sozinho não tem equipe para comparar. Por isso são só dois
 * níveis — quem não tem nenhum dos dois simplesmente não entra.
 *
 * @param {Object} usuario Registro do usuário.
 * @returns {string} 'TODOS' | 'EQUIPE' | 'NENHUM'.
 */
function obterEscopoProdutividade_(usuario) {
  const permissoes = obterPermissoesUsuario_(usuario);
  if (permissoes.indexOf('produtividadeTodos') !== -1) return 'TODOS';
  if (permissoes.indexOf('produtividadeEquipe') !== -1) return 'EQUIPE';
  return 'NENHUM';
}

/**
 * Ids dos usuários que entram num escopo analítico.
 *
 * Devolver os IDS (em vez de já filtrar) permite reaproveitar a mesma lista
 * em dois lugares: no recorte dos atendimentos e na montagem do filtro de
 * Responsável — que precisa oferecer exatamente as mesmas pessoas.
 *
 * @param {Object} ator Ator autenticado (requireAuth_).
 * @param {string} escopo 'TODOS' | 'EQUIPE' | 'PROPRIOS' | 'NENHUM'.
 * @returns {string[]|null} Ids permitidos, ou null quando o escopo é TODOS
 *   (null significa "sem filtro", diferente de [] que significa "ninguém").
 */
function idsDoEscopoAnalitico_(ator, escopo) {
  if (escopo === 'TODOS') return null;
  if (escopo === 'NENHUM') return [];

  const meuId = String(ator.id || '').toUpperCase();
  if (escopo === 'PROPRIOS') return [meuId];

  // EQUIPE: eu + toda a árvore abaixo, em qualquer profundidade.
  return [meuId].concat(obterSubordinadosDaHierarquia_(ator.id));
}

/**
 * Recorta a lista de atendimentos pelos ids permitidos.
 *
 * Um atendimento entra quando o usuário é o RESPONSÁVEL atual ou quem o
 * CRIOU. O criador conta porque um atendimento delegado para outra pessoa
 * continua fazendo parte do trabalho de quem o abriu — é assim que o
 * sistema já se comporta nas demais telas.
 *
 * @param {Object[]} registros Linhas cruas da aba Atendimentos.
 * @param {string[]|null} idsPermitidos Resultado de idsDoEscopoAnalitico_.
 * @returns {Object[]} Apenas os registros permitidos.
 */
function filtrarAtendimentosPorIds_(registros, idsPermitidos) {
  if (idsPermitidos === null) return registros;      // escopo TODOS
  if (!idsPermitidos.length) return [];

  const permitidos = {};
  idsPermitidos.forEach(function(id) { permitidos[String(id).toUpperCase()] = true; });

  return registros.filter(function(registro) {
    const responsavel = String(registro.ResponsavelId || '').trim().toUpperCase();
    const criador = String(registro.CriadoPorId || '').trim().toUpperCase();
    return permitidos[responsavel] || permitidos[criador];
  });
}

/**
 * Usuários que podem aparecer no filtro "Responsável" de uma tela analítica.
 *
 * A lista sai do MESMO escopo usado no recorte dos dados. Mandar gente de
 * fora e escondê-la na interface seria vazar o organograma da operação para
 * quem não tem acesso a ele.
 *
 * @param {Object} ator Ator autenticado.
 * @param {string} escopo Escopo já resolvido.
 * @returns {Object[]} Lista de { id, nome }, ordenada por nome.
 */
function listarResponsaveisDoEscopo_(ator, escopo) {
  const idsPermitidos = idsDoEscopoAnalitico_(ator, escopo);
  const permitidos = {};
  if (idsPermitidos !== null) {
    idsPermitidos.forEach(function(id) { permitidos[String(id).toUpperCase()] = true; });
  }

  return pgo5Ler(PGO5.SHEET_NAMES.USUARIOS)
    .filter(function(usuario) {
      if (!isTrue_(usuario.Ativo)) return false;
      if (idsPermitidos === null) return true;
      return !!permitidos[String(usuario.Id || '').trim().toUpperCase()];
    })
    .map(function(usuario) {
      return { id: String(usuario.Id || ''), nome: String(usuario.Nome || '') };
    })
    .sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}

// ============================================================================
// RELATÓRIOS
// ============================================================================

/**
 * (Público) Dados da tela Relatórios, já recortados pelo escopo do usuário.
 *
 * Devolve os atendimentos no MESMO formato que a tela do 4.x consome
 * (pgo5AtendimentosComoLegado_ → decorateAtendimentos_), então a interface
 * existente continua funcionando sem ser reescrita.
 *
 * A exportação usa esta mesma função: o arquivo gerado nunca contém uma
 * linha que a tela não mostraria.
 *
 * @param {Object} filtros Filtros escolhidos na tela.
 * @returns {Object[]} Atendimentos permitidos e já filtrados.
 * @throws {Error} Quando o usuário não tem nenhuma permissão de relatório.
 */
function getRelatorioPGO5(filtros) {
  const ator = requireAuth_();
  const escopo = obterEscopoRelatorios_(atorComoUsuario_(ator));
  if (escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para acessar os relatórios.');
  }

  const permitidos = filtrarAtendimentosPorIds_(
    pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS),
    idsDoEscopoAnalitico_(ator, escopo));

  const comoLegado = pgo5ConverterParaLegado_(permitidos);
  return decorateAtendimentos_(applyAtendimentoFilters_(comoLegado, filtros || {}));
}

/**
 * (Público) Listas que alimentam os filtros das telas analíticas.
 *
 * Vem tudo numa chamada só: o navegador não precisa perguntar de novo a
 * cada troca de filtro. A lista de responsáveis já respeita o escopo.
 *
 * @param {string} [tela] 'relatorios' (padrão) ou 'produtividade'.
 * @returns {Object} Catálogo de filtros + escopo aplicado.
 */
function getFiltrosAnaliticosPGO5(tela) {
  const ator = requireAuth_();
  const usuario = atorComoUsuario_(ator);
  const ehProdutividade = String(tela || '') === 'produtividade';
  const escopo = ehProdutividade
    ? obterEscopoProdutividade_(usuario)
    : obterEscopoRelatorios_(usuario);

  if (escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para acessar esta tela.');
  }

  const catalogo = pgo5CatalogoBruto_();
  const hierarquia = pgo5Hierarquia_(catalogo);
  const rotulos = function(lista) {
    return (lista || []).map(function(item) { return item.rotulo; });
  };

  // A cascata do catálogo vem indexada por Id do pai; os filtros comparam
  // por NOME (o usuário escolhe "Produto Alfa", não um Id hexadecimal).
  const categoriasPorProduto = {};
  const todasCategorias = [];
  hierarquia.produtos.forEach(function(produto) {
    const filhas = hierarquia.categoriasPorProduto[produto.id] || [];
    categoriasPorProduto[produto.rotulo] = rotulos(filhas);
    filhas.forEach(function(categoria) { todasCategorias.push(categoria); });
  });

  const subcategoriasPorCategoria = {};
  const todasSubcategorias = [];
  todasCategorias.forEach(function(categoria) {
    const filhas = hierarquia.subcategoriasPorCategoria[categoria.id] || [];
    subcategoriasPorCategoria[categoria.rotulo] = rotulos(filhas);
    filhas.forEach(function(sub) { todasSubcategorias.push(sub); });
  });

  /** Remove nomes repetidos das listas "planas" dos filtros. */
  const semRepetir = function(lista) {
    return lista.filter(function(nome, i, todos) { return nome && todos.indexOf(nome) === i; });
  };

  return {
    escopo: escopo,
    canais: rotulos(pgo5Canais_(catalogo)),
    status: rotulos(pgo5Status_(catalogo)),
    aguardandoRetorno: rotulos(pgo5Aguardando_(catalogo)),
    produtos: rotulos(hierarquia.produtos),
    categorias: semRepetir(rotulos(todasCategorias)),
    subcategorias: semRepetir(rotulos(todasSubcategorias)),
    categoriasPorProduto: categoriasPorProduto,
    subcategoriasPorCategoria: subcategoriasPorCategoria,
    responsaveis: listarResponsaveisDoEscopo_(ator, escopo)
  };
}

// ============================================================================
// PRODUTIVIDADE EQUIPE
// ============================================================================

/**
 * (Público) Tudo o que a tela Produtividade Equipe precisa, numa ÚNICA
 * chamada: KPIs, agrupamentos e a evolução diária.
 *
 * POR QUE UMA CHAMADA SÓ
 * Cada ida ao servidor no Apps Script custa segundos. Fazer uma chamada por
 * gráfico deixaria a tela lenta e leria a planilha várias vezes para
 * responder a mesma pergunta. Aqui a planilha é lida UMA vez e todos os
 * resumos saem da mesma lista em memória.
 *
 * @param {Object} filtros Filtros da tela (período, canal, status…).
 * @returns {Object} KPIs, agrupamentos, série diária e o escopo aplicado.
 * @throws {Error} Quando o usuário não tem permissão de produtividade.
 */
function obterProdutividadeEquipePGO5(filtros) {
  const ator = requireAuth_();
  const escopo = obterEscopoProdutividade_(atorComoUsuario_(ator));
  if (escopo === 'NENHUM') {
    throw new Error('Você não tem permissão para ver a produtividade da equipe.');
  }

  const permitidos = filtrarAtendimentosPorIds_(
    pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS),
    idsDoEscopoAnalitico_(ator, escopo));

  const atendimentos = applyAtendimentoFilters_(
    pgo5ConverterParaLegado_(permitidos), filtros || {});

  return {
    escopo: escopo,
    total: atendimentos.length,
    kpis: montarKpisProdutividade_(atendimentos),
    porResponsavel: agruparProdutividadePor_(atendimentos, 'Responsavel'),
    porCanal: agruparProdutividadePor_(atendimentos, 'Canal'),
    porProduto: agruparProdutividadePor_(atendimentos, 'Produto'),
    porCategoria: agruparProdutividadePor_(atendimentos, 'Categoria'),
    porStatus: agruparProdutividadePor_(atendimentos, 'Status'),
    evolucaoDiaria: montarEvolucaoDiaria_(atendimentos),
    atualizadoEm: toIso_(new Date())
  };
}

/**
 * Os quatro números do topo da tela.
 *
 * A classificação usa o NOME do status, que é configurável pelo ADM. Um
 * status renomeado ou criado depois cai em "outros" em vez de sumir da
 * contagem — o total continua batendo com a soma das partes.
 *
 * @param {Object[]} atendimentos Atendimentos já filtrados.
 * @returns {Object} { total, pendentes, emAnalise, concluidos, outros }.
 */
function montarKpisProdutividade_(atendimentos) {
  const kpis = { total: atendimentos.length, pendentes: 0, emAnalise: 0, concluidos: 0, outros: 0 };

  atendimentos.forEach(function(atendimento) {
    const status = normalizeText_(atendimento.Status);
    if (status.indexOf('pendente') !== -1) kpis.pendentes++;
    else if (status.indexOf('analise') !== -1) kpis.emAnalise++;
    else if (status.indexOf('conclu') !== -1) kpis.concluidos++;
    else kpis.outros++;
  });
  return kpis;
}

/**
 * Conta quantos atendimentos há em cada valor de uma coluna.
 *
 * Devolve ordenado do maior para o menor, que é como os gráficos de barra
 * e as listas "Top" precisam receber.
 *
 * ⚠️ VAZIO ≠ REFERÊNCIA QUEBRADA — são dois fatos diferentes e a tela
 * precisa distingui-los:
 *
 *   '(não informado)' → o atendimento não tem esse campo preenchido. É o
 *                       normal numa operação que não usa Produto, e numa
 *                       base onde o catálogo ainda não foi cadastrado.
 *   'Sem dados'       → o campo APONTA para um registro que não existe
 *                       mais (o ADM excluiu o produto, por exemplo). Isso
 *                       é anomalia e merece atenção.
 *
 * Antes os dois caíam em 'Sem dados', e um Indicadores inteiro de base
 * recém-instalada parecia quebrado quando estava apenas vazio. O rótulo de
 * vazio segue a convenção que o sistema já usa na Análise de SAC. Quem
 * produz o 'Sem dados' é pgo5Rotulo_, no conversor — não esta função.
 *
 * @param {Object[]} atendimentos Atendimentos já filtrados.
 * @param {string} coluna Nome da coluna no formato legado (ex.: 'Canal').
 * @returns {Object[]} [{ rotulo, quantidade, percentual }] em ordem decrescente.
 */
function agruparProdutividadePor_(atendimentos, coluna) {
  const contagem = {};
  atendimentos.forEach(function(atendimento) {
    const valor = String(atendimento[coluna] || '').trim() || '(não informado)';
    contagem[valor] = (contagem[valor] || 0) + 1;
  });

  const total = atendimentos.length;
  return Object.keys(contagem)
    .map(function(rotulo) {
      return {
        rotulo: rotulo,
        quantidade: contagem[rotulo],
        // Sem registros, o percentual seria 0/0 = NaN e o gráfico quebraria.
        percentual: total > 0 ? Math.round((contagem[rotulo] / total) * 1000) / 10 : 0
      };
    })
    .sort(function(a, b) { return b.quantidade - a.quantidade; });
}

/**
 * Quantos atendimentos foram abertos em cada dia.
 *
 * Só aparecem os dias que realmente têm registro: preencher o calendário
 * inteiro com zeros deixaria o gráfico ilegível num filtro de vários meses.
 *
 * @param {Object[]} atendimentos Atendimentos já filtrados.
 * @returns {Object[]} [{ data: 'AAAA-MM-DD', quantidade }] em ordem crescente.
 */
function montarEvolucaoDiaria_(atendimentos) {
  const porDia = {};
  atendimentos.forEach(function(atendimento) {
    // chaveDoDia_ aplica a MESMA regra do filtro de período (Services.gs).
    // Se cada um decidisse o dia por conta própria, um atendimento poderia
    // entrar no período filtrado e aparecer em outro dia do gráfico.
    const chave = chaveDoDia_(asDate_(atendimento.DataAbertura));
    if (!chave) return;                           // sem data não entra na série
    porDia[chave] = (porDia[chave] || 0) + 1;
  });

  return Object.keys(porDia).sort().map(function(chave) {
    return { data: chave, quantidade: porDia[chave] };
  });
}

// ============================================================================
// FORA DA SLA — persistência no banco PGO 5.0
// ============================================================================
/*
 * A aba "IndicadoresSLA" do 4.x NÃO existe no PGO 5.0, e criar uma sexta aba
 * está proibido. O valor manual "Fora da SLA" passa a ser uma linha da aba
 * Configurações, usando as colunas que já existem:
 *
 *   Tipo   = 'SLA'
 *   Chave  = a data em AAAA-MM-DD  (é a identidade do registro)
 *   Valor  = a quantidade informada
 *
 * Uma linha por data, exatamente como era antes. O comportamento visível
 * não muda: o número sobrevive à releitura da planilha externa.
 */

/** Valor da coluna Tipo usado pelos registros de SLA. */
const PGO5_TIPO_SLA = 'SLA';

/**
 * Lê todos os valores manuais de "Fora da SLA".
 *
 * @returns {Object} { 'AAAA-MM-DD': quantidade }.
 */
function lerForaSlaPGO5_() {
  const valores = {};
  pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES).forEach(function(linha) {
    if (String(linha.Tipo || '').toUpperCase() !== PGO5_TIPO_SLA) return;
    const data = String(linha.Chave || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    valores[data] = Number(linha.Valor) || 0;
  });
  return valores;
}

/**
 * Grava (ou atualiza) o "Fora da SLA" de uma data.
 *
 * É um upsert pela data: informar a mesma data duas vezes substitui o
 * valor em vez de criar uma segunda linha.
 *
 * @param {string} dataChave Data em AAAA-MM-DD.
 * @param {number} quantidade Valor informado (negativo ou inválido vira 0).
 * @returns {Object} { success: true }.
 */
function salvarForaSlaPGO5_(dataChave, quantidade) {
  const data = String(dataChave || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida.');

  let numero = Number(quantidade);
  if (!isFinite(numero) || numero < 0) numero = 0;

  return withScriptLock_(function() {
    const existente = pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES).find(function(linha) {
      return String(linha.Tipo || '').toUpperCase() === PGO5_TIPO_SLA &&
        String(linha.Chave || '').trim() === data;
    });

    if (existente) {
      pgo5AtualizarPorId(PGO5.SHEET_NAMES.CONFIGURACOES, String(existente.Id), {
        Valor: numero, Data: toIso_(new Date())
      });
    } else {
      pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, {
        Tipo: PGO5_TIPO_SLA, Chave: data, Nome: 'Fora da SLA',
        Valor: numero, Ativo: true, Data: toIso_(new Date())
      });
    }
    return { success: true };
  });
}
