/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Catálogo do PGO 5.0
 * ============================================================================
 * Arquivo: Pgo5Catalogo.gs
 * Descrição: A aba "Formulário" é a FONTE DE VERDADE do que o sistema
 *            oferece: canais, campos de cada canal, opções dos seletores,
 *            a hierarquia Produto → Categoria → Subcategoria, os status e
 *            as opções de "Aguardando Retorno".
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Tudo o que aparece nos seletores do sistema é uma LINHA desta aba. O que
 * diferencia um registro do outro é a coluna "Tipo":
 *
 *   CANAL         → um canal de atendimento (Reclame Aqui, SAC…)
 *   CAMPO         → um campo do formulário de um canal (CanalId aponta o canal)
 *   OPCAO         → uma opção de um campo select/radio/multiselect (PaiId = campo)
 *   PRODUTO       → produto
 *   CATEGORIA     → categoria de um produto      (PaiId = produto)
 *   SUBCATEGORIA  → subcategoria de uma categoria (PaiId = categoria)
 *   STATUS        → situação do atendimento
 *   AGUARDANDO    → "Aguardando Retorno de"
 *
 * Nada disso é fixo no HTML: mudar a planilha muda o sistema.
 * ------------------------------------------------------------------------
 */

/** Tipos de registro aceitos na aba Formulário. */
const PGO5_TIPOS = {
  CANAL: 'CANAL',
  CAMPO: 'CAMPO',
  OPCAO: 'OPCAO',
  PRODUTO: 'PRODUTO',
  CATEGORIA: 'CATEGORIA',
  SUBCATEGORIA: 'SUBCATEGORIA',
  STATUS: 'STATUS',
  AGUARDANDO: 'AGUARDANDO'
};

/**
 * Tipos de input que o motor de formulário sabe renderizar, coletar e
 * validar. Um TipoCampo fora desta lista é tratado como 'text'.
 */
const PGO5_TIPOS_CAMPO = [
  'text', 'textarea', 'number', 'integer', 'decimal',
  'date', 'datetime', 'time',
  'select', 'multiselect', 'radio', 'checkbox',
  'email', 'telefone', 'cpf', 'moeda', 'percentual'
];

/**
 * CAMPOS ESTRUTURAIS — os que têm coluna própria na aba Atendimentos.
 * A chave é o "Nome" do registro CAMPO; o valor é a coluna de destino.
 * Qualquer campo cujo Nome não esteja aqui é DINÂMICO e vai para
 * ValoresAtendimento.
 *
 * Um campo cujo Nome não esteja aqui é dinâmico e vai para
 * ValoresAtendimento — é o caso do "Resumo" do SAC Reclamação.
 */
const PGO5_CAMPOS_ESTRUTURAIS = {
  dataAbertura: 'DataAbertura',
  protocolo: 'Protocolo',
  cliente: 'Cliente',
  cpf: 'CPF',
  produto: 'ProdutoId',
  categoria: 'CategoriaId',
  subcategoria: 'SubcategoriaId',
  status: 'StatusId',
  aguardandoRetorno: 'AguardandoRetornoId',
  responsavel: 'ResponsavelId',
  observacoes: 'Observacoes'
};

/**
 * Coluna estrutural correspondente a um campo, ou '' se ele for dinâmico.
 * @param {string} nomeCampo - Coluna "Nome" do registro CAMPO.
 * @returns {string} Nome da coluna em Atendimentos, ou ''.
 */
function pgo5ColunaEstrutural_(nomeCampo) {
  const chave = String(nomeCampo || '').trim();
  return PGO5_CAMPOS_ESTRUTURAIS[chave] || '';
}

/** true quando o campo grava numa coluna própria de Atendimentos. */
function pgo5CampoEhEstrutural_(nomeCampo) {
  return pgo5ColunaEstrutural_(nomeCampo) !== '';
}

// ============================================================================
// LEITURA DO CATÁLOGO
// ============================================================================

/**
 * Lê a aba Formulário UMA vez e devolve os registros agrupados por Tipo.
 * Todo o resto do catálogo trabalha sobre este resultado — é o que evita
 * reler a planilha uma vez para cada seletor.
 * @returns {Object} { CANAL:[], CAMPO:[], OPCAO:[], ... }.
 */
function pgo5CatalogoBruto_() {
  const grupos = {};
  Object.keys(PGO5_TIPOS).forEach(function(t) { grupos[t] = []; });

  pgo5Ler(PGO5.SHEET_NAMES.FORMULARIO).forEach(function(reg) {
    const tipo = String(reg.Tipo || '').trim().toUpperCase();
    if (grupos[tipo]) grupos[tipo].push(reg);
  });
  return grupos;
}

/** Ordena por Ordem (numérica) e, em empate, por Rótulo/Nome. */
function pgo5OrdenarCatalogo_(lista) {
  return lista.slice().sort(function(a, b) {
    const oa = Number(a.Ordem);
    const ob = Number(b.Ordem);
    const na = isFinite(oa) ? oa : 9999;
    const nb = isFinite(ob) ? ob : 9999;
    if (na !== nb) return na - nb;
    return String(a.Rotulo || a.Nome || '').localeCompare(String(b.Rotulo || b.Nome || ''), 'pt-BR');
  });
}

/** Mantém apenas os registros ativos (vazio conta como ativo). */
function pgo5SomenteAtivos_(lista) {
  return lista.filter(function(r) {
    return r.Ativo === '' || r.Ativo === null || r.Ativo === undefined || isTrue_(r.Ativo);
  });
}

/**
 * Converte um registro do catálogo no formato enxuto que o front consome.
 * @param {Object} reg - Linha da aba Formulário.
 * @returns {Object} { id, nome, rotulo, ordem, ativo, paiId }.
 */
function pgo5ItemCatalogo_(reg) {
  return {
    id: String(reg.Id || ''),
    nome: String(reg.Nome || ''),
    rotulo: String(reg.Rotulo || reg.Nome || ''),
    ordem: Number(reg.Ordem) || 0,
    ativo: reg.Ativo === '' || isTrue_(reg.Ativo),
    paiId: String(reg.PaiId || '')
  };
}

/**
 * Canais ATIVOS, ordenados. É a lista que alimenta a seleção inicial de
 * "Novo Atendimento".
 * @param {Object} [catalogo] - Catálogo já lido (evita reler a aba).
 * @returns {Object[]} Canais no formato de item de catálogo.
 */
function pgo5Canais_(catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();
  return pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.CANAL)).map(pgo5ItemCatalogo_);
}

/**
 * Campos ATIVOS de um canal, ordenados, já com as opções de cada seletor.
 *
 * Cada campo devolvido carrega tudo o que o front precisa para renderizar
 * sem nova ida ao servidor: tipo, obrigatoriedade, placeholder, valor
 * padrão, se é estrutural e a lista de opções (quando for seletor).
 *
 * @param {string} canalId - Id do canal.
 * @param {Object} [catalogo] - Catálogo já lido.
 * @returns {Object[]} Campos prontos para renderização.
 */
function pgo5CamposDoCanal_(canalId, catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();
  const alvo = String(canalId || '').trim().toUpperCase();
  if (!alvo) return [];

  const campos = pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.CAMPO.filter(function(c) {
    return String(c.CanalId || '').trim().toUpperCase() === alvo;
  })));

  // Opções agrupadas por campo — uma passada, sem busca aninhada.
  const opcoesPorCampo = {};
  pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.OPCAO)).forEach(function(op) {
    const pai = String(op.PaiId || '').trim().toUpperCase();
    if (!pai) return;
    if (!opcoesPorCampo[pai]) opcoesPorCampo[pai] = [];
    opcoesPorCampo[pai].push({ id: String(op.Id || ''), rotulo: String(op.Rotulo || op.Nome || '') });
  });

  return campos.map(function(c) {
    const id = String(c.Id || '');
    const tipo = pgo5NormalizarTipoCampo_(c.TipoCampo);
    return {
      id: id,
      nome: String(c.Nome || ''),
      rotulo: String(c.Rotulo || c.Nome || ''),
      tipo: tipo,
      obrigatorio: isTrue_(c.Obrigatorio),
      ordem: Number(c.Ordem) || 0,
      placeholder: String(c.Placeholder || ''),
      valorPadrao: String(c.ValorPadrao || ''),
      estrutural: pgo5CampoEhEstrutural_(c.Nome),
      colunaEstrutural: pgo5ColunaEstrutural_(c.Nome),
      opcoes: opcoesPorCampo[id.toUpperCase()] || []
    };
  });
}

/** Normaliza o TipoCampo; desconhecido vira 'text' (degrada sem quebrar). */
function pgo5NormalizarTipoCampo_(tipo) {
  const t = String(tipo || '').trim().toLowerCase();
  return PGO5_TIPOS_CAMPO.indexOf(t) !== -1 ? t : 'text';
}

/**
 * Hierarquia Produto → Categoria → Subcategoria, pronta para a cascata do
 * formulário funcionar INTEIRAMENTE no navegador (sem uma chamada ao
 * servidor a cada troca de produto).
 *
 * Categorias e subcategorias podem estar vazias numa instalação limpa —
 * isso é esperado e o front deve mostrar seletor vazio, não erro.
 *
 * @param {Object} [catalogo] - Catálogo já lido.
 * @returns {Object} { produtos, categoriasPorProduto, subcategoriasPorCategoria }.
 */
function pgo5Hierarquia_(catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();

  const produtos = pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.PRODUTO)).map(pgo5ItemCatalogo_);

  const categoriasPorProduto = {};
  pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.CATEGORIA)).forEach(function(c) {
    const pai = String(c.PaiId || '').trim();
    if (!pai) return;
    if (!categoriasPorProduto[pai]) categoriasPorProduto[pai] = [];
    categoriasPorProduto[pai].push(pgo5ItemCatalogo_(c));
  });

  const subcategoriasPorCategoria = {};
  pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.SUBCATEGORIA)).forEach(function(s) {
    const pai = String(s.PaiId || '').trim();
    if (!pai) return;
    if (!subcategoriasPorCategoria[pai]) subcategoriasPorCategoria[pai] = [];
    subcategoriasPorCategoria[pai].push(pgo5ItemCatalogo_(s));
  });

  return {
    produtos: produtos,
    categoriasPorProduto: categoriasPorProduto,
    subcategoriasPorCategoria: subcategoriasPorCategoria
  };
}

/** Status ATIVOS, ordenados. */
function pgo5Status_(catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();
  return pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.STATUS)).map(pgo5ItemCatalogo_);
}

/** Opções ATIVAS de "Aguardando Retorno", ordenadas. */
function pgo5Aguardando_(catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();
  return pgo5OrdenarCatalogo_(pgo5SomenteAtivos_(cat.AGUARDANDO)).map(pgo5ItemCatalogo_);
}

/**
 * Mapa Id → rótulo de TODO o catálogo (inclusive itens inativos).
 *
 * Itens inativos entram de propósito: um atendimento antigo que aponta para
 * uma categoria desativada precisa continuar legível. Se o registro tiver
 * sido EXCLUÍDO fisicamente, o Id simplesmente não estará no mapa e quem
 * consulta mostra "-" — nunca quebra.
 *
 * @param {Object} [catalogo] - Catálogo já lido.
 * @returns {Object} { '00000001': 'Reclame Aqui', ... }.
 */
function pgo5MapaRotulos_(catalogo) {
  const cat = catalogo || pgo5CatalogoBruto_();
  const mapa = {};
  Object.keys(cat).forEach(function(tipo) {
    cat[tipo].forEach(function(reg) {
      const id = String(reg.Id || '').trim();
      if (id) mapa[id] = String(reg.Rotulo || reg.Nome || '');
    });
  });
  return mapa;
}

/**
 * Resolve um Id para o rótulo legível, degradando com segurança.
 * @param {Object} mapa - Mapa de pgo5MapaRotulos_.
 * @param {*} id - Id a resolver.
 * @param {string} [vazio] - Texto quando não há Id (padrão '-').
 * @returns {string} Rótulo, '-' ou 'Sem dados'.
 */
function pgo5Rotulo_(mapa, id, vazio) {
  const chave = String(id === null || id === undefined ? '' : id).trim();
  if (!chave) return vazio === undefined ? '-' : vazio;
  return mapa[chave] || 'Sem dados';
}

// ============================================================================
// SEED ESTRUTURAL
// ============================================================================
/*
 * Cria SOMENTE o que o sistema precisa para funcionar: os canais, os status,
 * as opções de "Aguardando Retorno" e os campos dos formulários iniciais.
 *
 * NÃO cria produto, categoria, subcategoria, cliente, CPF nem atendimento —
 * esses dados vêm da operação (ou do tombamento, na etapa própria).
 *
 * IDEMPOTENTE E NÃO INTRUSIVO: cada item é identificado por Tipo + Nome. Se
 * já existir, é deixado exatamente como está — inclusive se o ADM tiver
 * renomeado, reordenado ou desativado. O seed nunca sobrescreve edição do
 * administrador.
 *
 * ITEM EXCLUÍDO NÃO VOLTA: o seed grava em Script Property a lista de itens
 * que já semeou uma vez. Se o ADM excluir "SAC Reclamação", rodar o seed de
 * novo não o ressuscita.
 */

/** Script Property com os itens já semeados alguma vez (JSON de chaves). */
const PGO5_SEED_APLICADO_ = 'PGO5_SEED_APLICADO';

/**
 * Definição dos canais e dos campos iniciais de cada um.
 *
 * Reclame Aqui e SAC Preventivo reproduzem o formulário que a operação já
 * usa hoje. SAC Reclamação nasce com o conjunto reduzido aprovado.
 * "Resumo" é dinâmico de propósito: não existe coluna Resumo em Atendimentos.
 * @returns {Object[]} Canais com seus campos.
 */
function pgo5DefinicaoInicial_() {
  // Campos comuns aos dois canais que já existem na operação.
  const camposOperacionais = function() {
    return [
      { nome: 'dataAbertura', rotulo: 'Data', tipo: 'date', obrigatorio: true },
      { nome: 'protocolo', rotulo: 'Protocolo', tipo: 'text', obrigatorio: true, placeholder: 'Número do protocolo' },
      { nome: 'cliente', rotulo: 'Nome do Cliente', tipo: 'text', obrigatorio: true },
      { nome: 'cpf', rotulo: 'CPF', tipo: 'cpf', obrigatorio: true, placeholder: '000.000.000-00' },
      { nome: 'produto', rotulo: 'Produto', tipo: 'select', obrigatorio: false },
      { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', obrigatorio: false },
      { nome: 'subcategoria', rotulo: 'Subcategoria', tipo: 'select', obrigatorio: false },
      { nome: 'status', rotulo: 'Status', tipo: 'select', obrigatorio: true },
      { nome: 'aguardandoRetorno', rotulo: 'Aguardando Retorno de', tipo: 'select', obrigatorio: false },
      { nome: 'responsavel', rotulo: 'Responsável', tipo: 'select', obrigatorio: false },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', obrigatorio: false }
    ];
  };

  return [
    { nome: 'Reclame Aqui', campos: camposOperacionais() },
    { nome: 'SAC Preventivo', campos: camposOperacionais() },
    {
      nome: 'SAC Reclamação',
      campos: [
        { nome: 'dataAbertura', rotulo: 'Data', tipo: 'date', obrigatorio: true },
        { nome: 'protocolo', rotulo: 'Protocolo', tipo: 'text', obrigatorio: true },
        { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', obrigatorio: false },
        { nome: 'subcategoria', rotulo: 'Subcategoria', tipo: 'select', obrigatorio: false },
        // Dinâmico: vai para ValoresAtendimento, não para uma coluna nova.
        { nome: 'resumo', rotulo: 'Resumo', tipo: 'textarea', obrigatorio: false }
      ]
    }
  ];
}

/** Status iniciais (o ADM edita rótulo/ordem, mas não cria novos). */
function pgo5StatusIniciais_() {
  return ['Pendente', 'Em análise', 'Concluído'];
}

/** Opções iniciais de "Aguardando Retorno de" (o ADM pode criar outras). */
function pgo5AguardandoIniciais_() {
  return ['Área', 'Cliente'];
}

/**
 * Aplica o seed estrutural na aba Formulário.
 *
 * @returns {Object} Relatório sem PII:
 *   { criados:[], jaExistentes:[], naoRecriados:[], total }.
 */
function pgo5AplicarSeedEstrutural_() {
  const relatorio = { criados: [], jaExistentes: [], naoRecriados: [], total: 0 };

  return withScriptLock_(function() {
    const props = PropertiesService.getScriptProperties();
    let jaSemeados = {};
    try {
      jaSemeados = JSON.parse(props.getProperty(PGO5_SEED_APLICADO_) || '{}') || {};
    } catch (e) { jaSemeados = {}; }

    const catalogo = pgo5CatalogoBruto_();

    // Índice do que já existe: "TIPO|nome|pai" → registro.
    const existentes = {};
    Object.keys(catalogo).forEach(function(tipo) {
      catalogo[tipo].forEach(function(reg) {
        existentes[pgo5ChaveSeed_(tipo, reg.Nome, reg.CanalId || reg.PaiId)] = reg;
      });
    });

    /**
     * Cria um registro se ele nunca existiu E nunca foi semeado antes.
     * @returns {string} Id do registro (existente ou novo), ou '' se pulado.
     */
    const semear = function(tipo, dados, chavePai) {
      const chave = pgo5ChaveSeed_(tipo, dados.Nome, chavePai);
      if (existentes[chave]) {
        relatorio.jaExistentes.push(chave);
        return String(existentes[chave].Id || '');
      }
      if (jaSemeados[chave]) {
        // Já foi criado um dia e não está mais lá → excluído de propósito.
        relatorio.naoRecriados.push(chave);
        return '';
      }
      const novo = pgo5Inserir(PGO5.SHEET_NAMES.FORMULARIO, dados);
      existentes[chave] = novo;
      jaSemeados[chave] = true;
      relatorio.criados.push(chave);
      return String(novo.Id || '');
    };

    // ── Canais e seus campos ──
    pgo5DefinicaoInicial_().forEach(function(canal, iCanal) {
      const canalId = semear(PGO5_TIPOS.CANAL, {
        Tipo: PGO5_TIPOS.CANAL, Nome: canal.nome, Rotulo: canal.nome,
        Ativo: true, Ordem: iCanal + 1
      }, '');
      if (!canalId) return; // canal excluído deliberadamente: não recria nem os campos

      canal.campos.forEach(function(campo, iCampo) {
        semear(PGO5_TIPOS.CAMPO, {
          Tipo: PGO5_TIPOS.CAMPO,
          Nome: campo.nome,
          Rotulo: campo.rotulo,
          TipoCampo: campo.tipo,
          CanalId: canalId,
          Obrigatorio: !!campo.obrigatorio,
          Ativo: true,
          Ordem: iCampo + 1,
          Placeholder: campo.placeholder || '',
          ValorPadrao: ''
        }, canalId);
      });
    });

    // ── Status ──
    pgo5StatusIniciais_().forEach(function(nome, i) {
      semear(PGO5_TIPOS.STATUS, {
        Tipo: PGO5_TIPOS.STATUS, Nome: nome, Rotulo: nome, Ativo: true, Ordem: i + 1
      }, '');
    });

    // ── Aguardando Retorno ──
    pgo5AguardandoIniciais_().forEach(function(nome, i) {
      semear(PGO5_TIPOS.AGUARDANDO, {
        Tipo: PGO5_TIPOS.AGUARDANDO, Nome: nome, Rotulo: nome, Ativo: true, Ordem: i + 1
      }, '');
    });

    props.setProperty(PGO5_SEED_APLICADO_, JSON.stringify(jaSemeados));
    relatorio.total = relatorio.criados.length;
    Logger.log('[PGO5] Seed estrutural: ' + relatorio.criados.length + ' criado(s), ' +
      relatorio.jaExistentes.length + ' já existente(s), ' +
      relatorio.naoRecriados.length + ' não recriado(s).');
    return relatorio;
  });
}

/** Chave estável de um item do seed (Tipo + Nome + pai). */
function pgo5ChaveSeed_(tipo, nome, pai) {
  return String(tipo).toUpperCase() + '|' + normalizeText_(nome) + '|' +
    String(pai === null || pai === undefined ? '' : pai).trim();
}

// ============================================================================
// CONFIGURAÇÃO OPERACIONAL (ADM)
// ============================================================================
/*
 * O ADM mantém o catálogo pela tela de Configurações. Tudo grava na MESMA
 * aba Formulário — nenhuma aba nova é criada.
 *
 * Regras de segurança, validadas SEMPRE no servidor:
 *   - só ADM escreve;
 *   - STATUS não pode ser criado nem excluído (só editar/ordenar/ativar);
 *   - excluir é FÍSICO e NUNCA em cascata.
 */

/** Tipos que o ADM pode manter pela tela, e o que é permitido em cada um. */
function pgo5RegrasCatalogo_() {
  return {
    CANAL:        { podeCriar: true,  podeExcluir: true,  exigePai: false },
    CAMPO:        { podeCriar: true,  podeExcluir: true,  exigePai: false },
    OPCAO:        { podeCriar: true,  podeExcluir: true,  exigePai: true },
    PRODUTO:      { podeCriar: true,  podeExcluir: true,  exigePai: false },
    CATEGORIA:    { podeCriar: true,  podeExcluir: true,  exigePai: true },
    SUBCATEGORIA: { podeCriar: true,  podeExcluir: true,  exigePai: true },
    // Os três status são fixos nesta versão: editáveis, mas não criáveis.
    STATUS:       { podeCriar: false, podeExcluir: false, exigePai: false },
    AGUARDANDO:   { podeCriar: true,  podeExcluir: true,  exigePai: false }
  };
}

/**
 * (ADM) Devolve o catálogo COMPLETO (inclusive itens inativos) para a tela
 * de Configurações, com os vínculos já resolvidos em nomes.
 * @returns {Object} { itens: {TIPO: [...]}, canais, produtos, categorias, campos, regras }.
 */
function getCatalogoPGO5() {
  requireAuth_();
  requireAdmin_();
  const catalogo = pgo5CatalogoBruto_();
  const rotulos = pgo5MapaRotulos_(catalogo);

  const itens = {};
  Object.keys(PGO5_TIPOS).forEach(function(tipo) {
    itens[tipo] = pgo5OrdenarCatalogo_(catalogo[tipo]).map(function(r) {
      const item = pgo5ItemCatalogo_(r);
      item.tipoCampo = String(r.TipoCampo || '');
      item.obrigatorio = isTrue_(r.Obrigatorio);
      item.placeholder = String(r.Placeholder || '');
      item.valorPadrao = String(r.ValorPadrao || '');
      item.canalId = String(r.CanalId || '');
      item.paiRotulo = pgo5Rotulo_(rotulos, r.PaiId || r.CanalId);
      item.estrutural = pgo5CampoEhEstrutural_(r.Nome);
      return item;
    });
  });

  return {
    itens: itens,
    regras: pgo5RegrasCatalogo_(),
    tiposCampo: PGO5_TIPOS_CAMPO.slice()
  };
}

/**
 * (ADM) Cria ou edita um item do catálogo.
 *
 * @param {string} tipo - Um dos PGO5_TIPOS.
 * @param {Object} dados - Campos do item.
 * @param {string} [id] - Id para editar; ausente = criar.
 * @returns {Object} { success, id }.
 */
function salvarItemCatalogoPGO5(tipo, dados, id) {
  requireAuth_();
  requireAdmin_();

  const t = String(tipo || '').trim().toUpperCase();
  const regras = pgo5RegrasCatalogo_()[t];
  if (!regras) throw new Error('Tipo de item inválido: "' + tipo + '".');

  const entrada = dados || {};
  const registroId = String(id || '').trim();

  if (!registroId && !regras.podeCriar) {
    throw new Error('Não é possível criar novos itens do tipo ' + t + ' nesta versão.');
  }

  const rotulo = sanitizeInput(entrada.rotulo || entrada.nome);
  if (!rotulo) throw new Error('Informe o nome do item.');

  const pai = String(entrada.paiId || '').trim();
  if (regras.exigePai && !pai) {
    throw new Error('Selecione o item ao qual este registro pertence.');
  }

  const linha = {
    Tipo: t,
    Rotulo: rotulo,
    Ativo: entrada.ativo === undefined ? true : isTrue_(entrada.ativo),
    Ordem: Number(entrada.ordem) || 0
  };

  if (t === PGO5_TIPOS.CAMPO) {
    linha.TipoCampo = pgo5NormalizarTipoCampo_(entrada.tipoCampo);
    linha.Obrigatorio = isTrue_(entrada.obrigatorio);
    linha.Placeholder = sanitizeInput(entrada.placeholder || '');
    linha.ValorPadrao = sanitizeInput(entrada.valorPadrao || '');
    linha.CanalId = String(entrada.canalId || '').trim();
    if (!linha.CanalId) throw new Error('Selecione o canal do campo.');
  } else if (regras.exigePai) {
    linha.PaiId = pai;
  }

  if (registroId) {
    // Edição: o "Nome" (chave interna) não muda — é o que liga o campo à
    // coluna estrutural e o que o seed usa para reconhecer o item.
    const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.FORMULARIO, registroId);
    if (!atual) throw new Error('Item não encontrado.');
    if (String(atual.Tipo || '').toUpperCase() !== t) {
      throw new Error('O tipo de um item existente não pode ser alterado.');
    }
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.FORMULARIO, registroId, linha);
    return { success: true, id: registroId };
  }

  // Criação: o Nome é a CHAVE TÉCNICA e define para onde o dado vai.
  // Por padrão nasce do rótulo, mas o ADM pode informar a sua própria
  // (ex.: rótulo "Resumo do Caso" com chave "resumoCaso").
  //
  // Usar uma chave ESTRUTURAL aqui é legítimo e necessário: é assim que um
  // canal novo ganha Data, Protocolo, Status etc. O que não pode é haver
  // duas chaves iguais no mesmo canal — aí a gravação ficaria ambígua.
  // (Na EDIÇÃO a chave nunca muda, então um campo estrutural jamais deixa
  // de apontar para a sua coluna.)
  linha.Nome = sanitizeInput(entrada.nome) || rotulo;
  if (t === PGO5_TIPOS.CAMPO) {
    const irmao = pgo5CatalogoBruto_().CAMPO.find(function(c) {
      return String(c.CanalId || '').trim() === linha.CanalId &&
        normalizeText_(c.Nome) === normalizeText_(linha.Nome);
    });
    if (irmao) throw new Error('Já existe um campo com a chave "' + linha.Nome + '" neste canal.');
  }
  if (!linha.Ordem) linha.Ordem = pgo5ProximaOrdem_(t, pai || linha.CanalId);
  const novo = pgo5Inserir(PGO5.SHEET_NAMES.FORMULARIO, linha);
  return { success: true, id: String(novo.Id || '') };
}

/**
 * (ADM) Exclui FISICAMENTE um item do catálogo.
 *
 * SEM CASCATA: excluir uma Categoria remove SOMENTE a linha da categoria.
 * Subcategorias, atendimentos e valores continuam onde estão; quem consulta
 * passa a ver "Sem dados" no lugar do rótulo.
 *
 * @param {string} tipo - Tipo do item.
 * @param {string} id - Id do item.
 * @returns {Object} { success }.
 */
function excluirItemCatalogoPGO5(tipo, id) {
  requireAuth_();
  requireAdmin_();

  const t = String(tipo || '').trim().toUpperCase();
  const regras = pgo5RegrasCatalogo_()[t];
  if (!regras) throw new Error('Tipo de item inválido: "' + tipo + '".');
  if (!regras.podeExcluir) {
    throw new Error('Itens do tipo ' + t + ' não podem ser excluídos nesta versão.');
  }

  const registroId = String(id || '').trim();
  const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.FORMULARIO, registroId);
  if (!atual) throw new Error('Item não encontrado.');
  if (String(atual.Tipo || '').toUpperCase() !== t) {
    throw new Error('O item informado não é do tipo ' + t + '.');
  }

  const removido = pgo5ExcluirPorId(PGO5.SHEET_NAMES.FORMULARIO, registroId);
  return { success: removido };
}

/**
 * (ADM) Move um item uma posição para cima ou para baixo, trocando a Ordem
 * com o vizinho. É a alternativa simples ao arrastar-e-soltar.
 * @param {string} tipo - Tipo do item.
 * @param {string} id - Id do item.
 * @param {string} direcao - 'cima' ou 'baixo'.
 * @returns {Object} { success }.
 */
function moverItemCatalogoPGO5(tipo, id, direcao) {
  requireAuth_();
  requireAdmin_();

  const t = String(tipo || '').trim().toUpperCase();
  if (!pgo5RegrasCatalogo_()[t]) throw new Error('Tipo de item inválido: "' + tipo + '".');

  const registroId = String(id || '').trim();
  const catalogo = pgo5CatalogoBruto_();
  const atual = catalogo[t].find(function(r) {
    return String(r.Id || '').toUpperCase() === registroId.toUpperCase();
  });
  if (!atual) throw new Error('Item não encontrado.');

  // Só reordena entre irmãos (mesmo pai/canal).
  const paiAtual = String(atual.PaiId || atual.CanalId || '').trim();
  const irmaos = pgo5OrdenarCatalogo_(catalogo[t].filter(function(r) {
    return String(r.PaiId || r.CanalId || '').trim() === paiAtual;
  }));

  const pos = irmaos.findIndex(function(r) {
    return String(r.Id || '').toUpperCase() === registroId.toUpperCase();
  });
  const destino = String(direcao) === 'cima' ? pos - 1 : pos + 1;
  if (pos === -1 || destino < 0 || destino >= irmaos.length) return { success: false };

  const vizinho = irmaos[destino];
  return withScriptLock_(function() {
    // Reescreve a Ordem de toda a lista já na nova sequência: evita empates
    // e Ordem duplicada herdada de edições manuais na planilha.
    const nova = irmaos.slice();
    nova[pos] = vizinho;
    nova[destino] = atual;
    nova.forEach(function(r, i) {
      pgo5AtualizarPorId(PGO5.SHEET_NAMES.FORMULARIO, r.Id, { Ordem: i + 1 });
    });
    return { success: true };
  });
}

/** Próxima Ordem livre dentro de um grupo de irmãos. */
function pgo5ProximaOrdem_(tipo, pai) {
  const catalogo = pgo5CatalogoBruto_();
  const alvo = String(pai || '').trim();
  const irmaos = catalogo[tipo].filter(function(r) {
    return String(r.PaiId || r.CanalId || '').trim() === alvo;
  });
  let maior = 0;
  irmaos.forEach(function(r) {
    const n = Number(r.Ordem);
    if (isFinite(n) && n > maior) maior = n;
  });
  return maior + 1;
}
