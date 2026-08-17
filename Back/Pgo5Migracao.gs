/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Migracao.gs
 *
 * RESPONSABILIDADE
 * Trazer os dados da planilha ANTIGA (modelo 4.x, com 11 abas) para o banco
 * novo do PGO 5.0 (5 abas). É o "tombamento".
 *
 * Se você está procurando "onde está a regra de tombamento?", é aqui —
 * nenhum outro arquivo migra dados.
 *
 * ============================================================================
 * COMO ISTO FUNCIONA, EM 5 PASSOS
 * ============================================================================
 *
 *   1. LER      → lerFonteLegada_ abre a cópia antiga e lê todas as abas
 *                 necessárias de uma vez.
 *   2. MAPEAR   → migrarCatalogo_ e migrarUsuarios_ criam os registros novos
 *                 e vão anotando "Id antigo → Id novo" nos MAPAS.
 *   3. MONTAR   → migrarAtendimentos_ usa os mapas para reconstruir cada
 *                 atendimento já com os IDs do banco novo.
 *   4. VALIDAR  → validarResultadoMigracao_ confere o que foi gravado.
 *   5. MARCAR   → só depois de tudo dar certo a migração é marcada como
 *                 concluída, e uma segunda execução passa a ser recusada.
 *
 * ============================================================================
 * ⚠️ A FONTE É SOMENTE LEITURA
 * ============================================================================
 * Nenhuma função deste arquivo escreve na planilha antiga. Não existe aqui
 * setValue, setValues, appendRow, deleteRow nem clear apontando para a fonte.
 * A planilha de origem sai desta operação exatamente como entrou — e há
 * teste automatizado provando isso.
 *
 * ⚠️ NÃO EXISTE TRANSAÇÃO
 * O Google Sheets não sabe desfazer meia gravação. Por isso a estratégia é:
 * validar tudo antes, montar as linhas em memória, gravar em LOTES sob trava
 * e só então marcar como concluída. Se algo falhar no meio, o marcador NÃO é
 * gravado e o relatório aponta onde parou — a correção é apagar as abas do
 * destino e rodar de novo, nunca "continuar de onde parou".
 *
 * ⚠️ O ID REAL DA PLANILHA ANTIGA NUNCA ENTRA NO CÓDIGO
 * Ele é lido de uma Script Property, configurada só no ambiente autorizado.
 * Os testes usam uma planilha sintética.
 * ============================================================================
 */

/** Script Property com o Id da CÓPIA da planilha antiga. Nunca versionado. */
const PGO5_CHAVE_FONTE_LEGADA = 'PGO5_MIGRACAO_FONTE_ID';

/** Script Property que marca a migração como concluída. */
const PGO5_CHAVE_MIGRACAO_CONCLUIDA = 'PGO5_MIGRACAO_CONCLUIDA';

/**
 * Abas da planilha antiga que o tombamento lê.
 *
 * Timeline e Histórico ficam de fora de propósito: são o histórico
 * operacional do 4.x e não têm equivalente no PGO 5.0. Trazê-los encheria a
 * aba Configurações de milhares de linhas sem ninguém consultá-las.
 */
const PGO5_ABAS_LEGADAS = {
  RECLAME_AQUI: 'ReclameAqui',
  SAC_PREVENTIVO: 'SACPreventivo',
  USUARIOS: 'Usuários',
  CANAIS: 'Canais',
  PRODUTOS: 'Produtos',
  CATEGORIAS: 'Categorias',
  SUBCATEGORIAS: 'Subcategorias',
  CONFIG_CAMPOS: 'ConfigCampos',
  INDICADORES_SLA: 'IndicadoresSLA'
};

// ============================================================================
// LEITURA DA FONTE (somente leitura)
// ============================================================================

/**
 * Abre a planilha de origem do tombamento.
 *
 * O Id vem de Script Properties porque é dado do ambiente, não do código:
 * versioná-lo exporia a planilha real de produção no GitHub.
 *
 * @returns {Spreadsheet} A planilha antiga, aberta para LEITURA.
 * @throws {Error} Quando a Script Property não está configurada.
 */
function abrirFonteLegada_() {
  const id = String(PropertiesService.getScriptProperties()
    .getProperty(PGO5_CHAVE_FONTE_LEGADA) || '').trim();

  if (!id) {
    throw new Error('Fonte da migração não configurada. Defina a Script Property ' +
      PGO5_CHAVE_FONTE_LEGADA + ' com o Id da CÓPIA da planilha antiga.');
  }
  return SpreadsheetApp.openById(id);
}

/**
 * Lê uma aba da planilha antiga e devolve as linhas como objetos.
 *
 * Aba inexistente devolve lista vazia em vez de erro: uma instalação antiga
 * pode não ter todas as abas, e isso não é motivo para abortar o tombamento
 * inteiro — o relatório registra o que faltou.
 *
 * @param {Spreadsheet} planilha Planilha de origem.
 * @param {string} nomeDaAba Nome da aba a ler.
 * @returns {Object[]} Linhas no formato { Coluna: valor }.
 */
function lerAbaLegada_(planilha, nomeDaAba) {
  const aba = planilha.getSheetByName(nomeDaAba);
  if (!aba) return [];

  const ultimaLinha = aba.getLastRow();
  const ultimaColuna = aba.getLastColumn();
  if (ultimaLinha < 2 || ultimaColuna < 1) return [];

  // Uma leitura em lote da aba inteira. Ler célula a célula num tombamento
  // de milhares de linhas estouraria o tempo de execução do Apps Script.
  const valores = aba.getRange(1, 1, ultimaLinha, ultimaColuna).getValues();
  const cabecalho = valores[0].map(function(c) { return String(c || '').trim(); });

  return valores.slice(1)
    .filter(function(linha) {
      return linha.some(function(celula) { return celula !== '' && celula !== null; });
    })
    .map(function(linha) {
      const registro = {};
      cabecalho.forEach(function(coluna, i) {
        if (coluna) registro[coluna] = linha[i];
      });
      return registro;
    });
}

/**
 * Lê de uma vez tudo o que o tombamento precisa da planilha antiga.
 *
 * ⚠️ SOMENTE LEITURA: nada aqui escreve na origem.
 *
 * @returns {Object} { reclameAqui, sacPreventivo, usuarios, canais, ... }.
 */
function lerFonteLegada_() {
  const planilha = abrirFonteLegada_();
  return {
    nomeDaPlanilha: planilha.getName(),
    reclameAqui: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.RECLAME_AQUI),
    sacPreventivo: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.SAC_PREVENTIVO),
    usuarios: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.USUARIOS),
    canais: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.CANAIS),
    produtos: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.PRODUTOS),
    categorias: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.CATEGORIAS),
    subcategorias: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.SUBCATEGORIAS),
    configCampos: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.CONFIG_CAMPOS),
    indicadoresSla: lerAbaLegada_(planilha, PGO5_ABAS_LEGADAS.INDICADORES_SLA)
  };
}

// ============================================================================
// MAPAS DE IDs
// ============================================================================

/**
 * Cria a estrutura que guarda "Id antigo → Id novo" de cada entidade.
 *
 * POR QUE MAPAS E NÃO NOMES
 * Dois produtos podem se chamar "Cartão" em momentos diferentes, e um nome
 * pode ter sido corrigido depois que o atendimento foi criado. O Id antigo é
 * a única ligação confiável — o nome só entra como último recurso, quando o
 * registro legado não tem Id.
 *
 * @returns {Object} Mapas vazios, um por entidade.
 */
function criarMapasMigracao_() {
  return {
    usuarios: {},
    canais: {},
    produtos: {},
    categorias: {},
    subcategorias: {},
    campos: {},
    status: {},
    aguardando: {},

    // Definição de cada CAMPO do destino, indexada pelo Id novo:
    //   { '0000000A': { rotulo: 'Resumo do caso', tipo: 'textarea' } }
    //
    // Preenchida por migrarCatalogo_ e consumida por migrarCamposDinamicos_,
    // que precisa do rótulo e do tipo para gravar o snapshot de cada valor.
    // Sem ela, cada valor dinâmico releria a aba Formulário inteira só para
    // descobrir o rótulo de um campo — e valores dinâmicos são a coisa MAIS
    // numerosa de um tombamento (um por campo extra de cada atendimento).
    definicoesDeCampo: {}
  };
}

/**
 * Guarda a correspondência de um registro no mapa.
 *
 * Grava pelo Id antigo E pelo nome (em caixa alta, sem acento). O nome é o
 * plano B para atendimentos legados que guardavam o texto em vez do Id.
 *
 * @param {Object} mapa Mapa da entidade.
 * @param {*} idAntigo Id do registro na planilha antiga.
 * @param {*} nomeAntigo Nome do registro na planilha antiga.
 * @param {string} idNovo Id gerado no PGO 5.0.
 * @returns {void}
 */
function registrarNoMapa_(mapa, idAntigo, nomeAntigo, idNovo) {
  const id = String(idAntigo || '').trim().toUpperCase();
  if (id) mapa['ID:' + id] = idNovo;

  const nome = normalizeText_(nomeAntigo);
  if (nome) mapa['NOME:' + nome] = idNovo;
}

/**
 * Procura o Id novo a partir do que o registro legado tinha.
 *
 * Tenta primeiro pelo Id (confiável) e depois pelo nome (aproximado).
 *
 * @param {Object} mapa Mapa da entidade.
 * @param {*} valorAntigo Id ou nome que estava no registro antigo.
 * @returns {string} Id novo, ou '' quando não foi possível resolver.
 */
function buscarNoMapa_(mapa, valorAntigo) {
  const bruto = String(valorAntigo === undefined || valorAntigo === null ? '' : valorAntigo).trim();
  if (!bruto) return '';

  const porId = mapa['ID:' + bruto.toUpperCase()];
  if (porId) return porId;

  return mapa['NOME:' + normalizeText_(bruto)] || '';
}

// ============================================================================
// MIGRAÇÃO DO CATÁLOGO
// ============================================================================

/**
 * Traz canais, produtos, categorias, subcategorias e campos para a aba
 * Formulário, preenchendo os mapas de Id.
 *
 * ⚠️ ESCREVE NO DESTINO (aba Formulário do PGO 5.0).
 *
 * A ordem importa: produto antes de categoria, categoria antes de
 * subcategoria — o filho precisa do Id do pai já mapeado.
 *
 * Item cujo pai não foi encontrado é migrado assim mesmo, sem o vínculo, e
 * entra em "referenciasNaoResolvidas". Descartar o registro perderia dado;
 * inventar um pai criaria uma informação que nunca existiu.
 *
 * @param {Object} fonte Resultado de lerFonteLegada_.
 * @param {Object} mapas Mapas de criarMapasMigracao_ (preenchidos aqui).
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @returns {void}
 */
function migrarCatalogo_(fonte, mapas, relatorio) {
  // ── ÍNDICES EM MEMÓRIA (uma leitura só, no começo) ──
  //
  // POR QUE ISTO EXISTE
  // As buscas abaixo são as MESMAS de antes — mudou só de onde vem a lista.
  // Antes, cada item consultado relia a aba Formulário inteira; um catálogo
  // de algumas centenas de linhas fazia centenas de varreduras completas de
  // planilha, e o tombamento chegava ao limite de tempo do Apps Script sem
  // ter saído do catálogo. Agora a aba é lida UMA vez e os índices são
  // atualizados a cada criação — o que mantém o comportamento anterior, em
  // que um item criado no meio do laço já era encontrado pelos seguintes.
  const catalogoInicial = pgo5CatalogoBruto_();

  // "TIPO|nome normalizado" → Id. A chave de busca é a mesma de antes:
  // Rotulo quando existe, Nome como alternativa, sempre normalizado.
  const idPorNome = {};
  const chaveDeNome = function(tipo, nome) { return tipo + '|' + normalizeText_(nome); };
  Object.keys(catalogoInicial).forEach(function(tipo) {
    catalogoInicial[tipo].forEach(function(registro) {
      const chave = chaveDeNome(tipo, registro.Rotulo || registro.Nome);
      // O primeiro vence, como no find() original.
      if (idPorNome[chave] === undefined) idPorNome[chave] = String(registro.Id);
    });
  });

  // Campos são procurados pela CHAVE TÉCNICA exata (sem normalizar): é ela
  // que liga o valor dinâmico à coluna de destino, e "CPF" e "cpf" são
  // chaves diferentes.
  const campoPorChaveTecnica = {};
  catalogoInicial[PGO5_TIPOS.CAMPO].forEach(function(registro) {
    const chave = String(registro.Nome || '').trim();
    if (chave && campoPorChaveTecnica[chave] === undefined) campoPorChaveTecnica[chave] = registro;
  });

  /** Guarda a definição de um CAMPO para migrarCamposDinamicos_ usar depois. */
  const anotarDefinicaoDeCampo = function(registro) {
    mapas.definicoesDeCampo[String(registro.Id)] = {
      rotulo: String(registro.Rotulo || registro.Nome || ''),
      tipo: String(registro.TipoCampo || 'text')
    };
  };
  catalogoInicial[PGO5_TIPOS.CAMPO].forEach(anotarDefinicaoDeCampo);

  /** Reaproveita um item já existente no destino, ou cria um novo. */
  const garantirItem = function(tipo, nome, paiId) {
    const chave = chaveDeNome(tipo, nome);
    if (idPorNome[chave] !== undefined) return idPorNome[chave];

    const criado = pgo5Inserir(PGO5.SHEET_NAMES.FORMULARIO, {
      Tipo: tipo,
      Nome: String(nome),
      Rotulo: String(nome),
      PaiId: paiId || '',
      Ativo: true,
      Ordem: 0
    });
    // O índice acompanha a criação: o próximo item com o mesmo nome
    // reaproveita este, exatamente como acontecia relendo a planilha.
    idPorNome[chave] = String(criado.Id);
    return idPorNome[chave];
  };

  // ── Canais ──
  relatorio.canais.encontrados = fonte.canais.length;
  fonte.canais.forEach(function(canal) {
    const nome = String(canal.Nome || canal.Canal || '').trim();
    if (!nome) { relatorio.avisos.push('Canal sem nome ignorado.'); return; }
    registrarNoMapa_(mapas.canais, canal.Id, nome, garantirItem(PGO5_TIPOS.CANAL, nome, ''));
    relatorio.canais.migrados++;
  });

  // ── Produtos ──
  relatorio.produtos.encontrados = fonte.produtos.length;
  fonte.produtos.forEach(function(produto) {
    const nome = String(produto.Nome || '').trim();
    if (!nome) { relatorio.avisos.push('Produto sem nome ignorado.'); return; }
    registrarNoMapa_(mapas.produtos, produto.Id, nome, garantirItem(PGO5_TIPOS.PRODUTO, nome, ''));
    relatorio.produtos.migrados++;
  });

  // ── Categorias (dependem do Produto) ──
  relatorio.categorias.encontrados = fonte.categorias.length;
  fonte.categorias.forEach(function(categoria) {
    const nome = String(categoria.Nome || '').trim();
    if (!nome) { relatorio.avisos.push('Categoria sem nome ignorada.'); return; }

    const produtoNovo = buscarNoMapa_(mapas.produtos, categoria.ProdutoId);
    if (!produtoNovo) {
      relatorio.referenciasNaoResolvidas.push('Categoria sem Produto correspondente.');
    }
    registrarNoMapa_(mapas.categorias, categoria.Id, nome,
      garantirItem(PGO5_TIPOS.CATEGORIA, nome, produtoNovo));
    relatorio.categorias.migrados++;
  });

  // ── Subcategorias (dependem da Categoria) ──
  relatorio.subcategorias.encontrados = fonte.subcategorias.length;
  fonte.subcategorias.forEach(function(subcategoria) {
    const nome = String(subcategoria.Nome || '').trim();
    if (!nome) { relatorio.avisos.push('Subcategoria sem nome ignorada.'); return; }

    const categoriaNova = buscarNoMapa_(mapas.categorias, subcategoria.CategoriaId);
    if (!categoriaNova) {
      relatorio.referenciasNaoResolvidas.push('Subcategoria sem Categoria correspondente.');
    }
    registrarNoMapa_(mapas.subcategorias, subcategoria.Id, nome,
      garantirItem(PGO5_TIPOS.SUBCATEGORIA, nome, categoriaNova));
    relatorio.subcategorias.migrados++;
  });

  // ── Status e "Aguardando Retorno" já existem no seed do PGO 5.0 ──
  // O tombamento só precisa saber a qual deles cada texto antigo aponta.
  pgo5Status_().forEach(function(status) {
    registrarNoMapa_(mapas.status, '', status.rotulo, status.id);
  });
  pgo5Aguardando_().forEach(function(item) {
    registrarNoMapa_(mapas.aguardando, '', item.rotulo, item.id);
  });

  // ── Campos do formulário antigo ──
  relatorio.campos.encontrados = fonte.configCampos.length;
  fonte.configCampos.forEach(function(campo) {
    const chave = String(campo.Campo || campo.Nome || '').trim();
    if (!chave) { relatorio.avisos.push('Campo sem chave técnica ignorado.'); return; }

    // Campo estrutural já existe no PGO 5.0 — só precisa entrar no mapa
    // para os valores dinâmicos saberem que NÃO devem ser criados de novo.
    const estrutural = pgo5CampoEhEstrutural_(chave);
    const existente = campoPorChaveTecnica[chave];

    let idNovo = existente ? String(existente.Id) : '';
    if (!idNovo && !estrutural) {
      const criado = pgo5Inserir(PGO5.SHEET_NAMES.FORMULARIO, {
        Tipo: PGO5_TIPOS.CAMPO,
        Nome: chave,
        Rotulo: String(campo.Rotulo || chave),
        TipoCampo: pgo5NormalizarTipoCampo_(campo.Tipo),
        Obrigatorio: isTrue_(campo.Obrigatorio),
        Ativo: campo.Ativo === undefined ? true : isTrue_(campo.Ativo),
        Ordem: Number(campo.Ordem) || 0
      });
      idNovo = String(criado.Id);
      // Dois registros legados com a MESMA chave técnica: o segundo
      // reaproveita o campo criado pelo primeiro, como antes.
      campoPorChaveTecnica[chave] = criado;
      anotarDefinicaoDeCampo(criado);
    }

    if (idNovo) {
      registrarNoMapa_(mapas.campos, campo.Id, chave, idNovo);
      relatorio.campos.migrados++;
    }
  });
}

// ============================================================================
// MIGRAÇÃO DE USUÁRIOS
// ============================================================================

/**
 * De qual CARGO e NÍVEL DE ACESSO cada perfil antigo vira.
 *
 * ⚠️ CARGO ≠ NÍVEL, e a diferença importa aqui:
 *   Cargo → a função organizacional (só um rótulo)
 *   Nível → o que a pessoa PODE fazer (é daqui que sai a permissão)
 *
 * O 4.x tinha um campo só, "Perfil", que misturava as duas coisas. O
 * tombamento desdobra esse campo nos dois conceitos, e a correspondência
 * abaixo é a decisão registrada — não uma adivinhação por texto solto.
 */
const PGO5_PERFIL_LEGADO_PARA_ACESSO = {
  adm: { cargo: 'ADM', nivel: 'ADMINISTRADOR' },
  admin: { cargo: 'ADM', nivel: 'ADMINISTRADOR' },
  administrador: { cargo: 'ADM', nivel: 'ADMINISTRADOR' },
  supervisor: { cargo: 'SUPERVISOR', nivel: 'GESTAO' },
  gestor: { cargo: 'SUPERVISOR', nivel: 'GESTAO' },
  analista: { cargo: 'ANALISTA', nivel: 'OPERACIONAL' }
};

/**
 * Traz os usuários do 4.x, desdobrando o "Perfil" em Cargo + Nível.
 *
 * ⚠️ ESCREVE NO DESTINO (aba Usuários do PGO 5.0).
 *
 * SOBRE A HIERARQUIA: o 4.x não tem um campo equivalente ao SupervisorId, e
 * inventar uma árvore a partir da Equipe produziria relações que nunca
 * existiram. Todo mundo é migrado com SupervisorId VAZIO e o relatório diz
 * quantos ficaram assim — o ADM monta a hierarquia depois, na tela de
 * Usuários. É proposital: hierarquia errada silenciosamente daria a um
 * gestor acesso a atendimentos que não são dele.
 *
 * Perfil desconhecido cai no nível mais restrito (Operacional). Errar para
 * menos acesso é seguro; errar para mais, não.
 *
 * @param {Object} fonte Resultado de lerFonteLegada_.
 * @param {Object} mapas Mapas (o mapa de usuários é preenchido aqui).
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @returns {void}
 */
function migrarUsuarios_(fonte, mapas, relatorio) {
  const acessos = lerCargosENiveis_();
  const porChave = function(lista, chave) {
    const item = lista.find(function(x) { return x.chave === chave; });
    return item ? item.id : '';
  };
  const cargos = listarCargos_(acessos);
  const niveis = listarNiveisAcesso_(acessos);

  relatorio.usuarios.encontrados = fonte.usuarios.length;

  // Quem já está no destino, indexado pelo e-mail normalizado — a MESMA
  // comparação de antes, feita sobre uma única leitura da aba em vez de uma
  // leitura por usuário da origem.
  const usuarioPorEmail = {};
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(registro) {
    const chave = normalizeText_(registro.Email);
    if (chave && usuarioPorEmail[chave] === undefined) usuarioPorEmail[chave] = registro;
  });

  fonte.usuarios.forEach(function(usuario) {
    const nome = String(usuario.Nome || '').trim();
    const email = String(usuario.Email || '').trim();
    if (!nome || !email) {
      relatorio.avisos.push('Usuário sem nome ou e-mail ignorado.');
      return;
    }

    // Já existe alguém com este e-mail? Então o destino já foi semeado com
    // esta pessoa (o administrador inicial, por exemplo) e não se duplica.
    // ⚠️ É esta regra que faz o administrador criado por
    // prepararInstalacaoPGO5 ser REAPROVEITADO, e não duplicado.
    const jaExiste = usuarioPorEmail[normalizeText_(email)];
    if (jaExiste) {
      registrarNoMapa_(mapas.usuarios, usuario.Id, nome, String(jaExiste.Id));
      relatorio.usuarios.jaExistentes++;
      return;
    }

    const perfil = normalizeText_(usuario.Perfil);
    const acesso = PGO5_PERFIL_LEGADO_PARA_ACESSO[perfil];
    if (!acesso) {
      relatorio.avisos.push('Perfil legado não reconhecido: migrado como Operacional.');
    }
    const chaves = acesso || { cargo: 'ANALISTA', nivel: 'OPERACIONAL' };

    const criado = pgo5Inserir(PGO5.SHEET_NAMES.USUARIOS, {
      Nome: nome,
      Email: email,
      CargoId: porChave(cargos, chaves.cargo),
      NivelAcessoId: porChave(niveis, chaves.nivel),
      SupervisorId: '',                    // hierarquia é configurada depois
      Equipe: String(usuario.Equipe || ''),
      Ativo: usuario.Ativo === undefined ? true : isTrue_(usuario.Ativo),
      DataCadastro: toIso_(new Date())
    });

    // Dois registros legados com o mesmo e-mail: o segundo reaproveita o
    // usuário criado pelo primeiro, como acontecia relendo a aba.
    usuarioPorEmail[normalizeText_(email)] = criado;

    registrarNoMapa_(mapas.usuarios, usuario.Id, nome, String(criado.Id));
    relatorio.usuarios.migrados++;
    relatorio.usuarios.semSupervisor++;
  });
}

// ============================================================================
// MIGRAÇÃO DOS ATENDIMENTOS
// ============================================================================

/**
 * Traz os atendimentos de uma aba legada para a aba Atendimentos.
 *
 * ⚠️ ESCREVE NO DESTINO (abas Atendimentos e ValoresAtendimento).
 *
 * CLIENTE E CPF SÃO ESTRUTURAIS: vão para as colunas próprias, nunca para
 * ValoresAtendimento. Qualquer outro campo que não caiba nas 17 colunas vira
 * um valor dinâmico, com o rótulo e o tipo guardados em snapshot — assim o
 * atendimento antigo continua legível mesmo que o campo seja excluído da
 * configuração depois.
 *
 * @param {Object[]} registros Linhas da aba legada.
 * @param {string} canalPadrao Id do canal quando o registro não informa um.
 * @param {Object} mapas Mapas de Id já preenchidos.
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @param {Object} contador Bloco do relatório desta origem.
 * @returns {void}
 */
function migrarAtendimentosDaAba_(registros, canalPadrao, mapas, relatorio, contador) {
  contador.encontrados = registros.length;

  registros.forEach(function(antigo) {
    const canalId = buscarNoMapa_(mapas.canais, antigo.Canal) || canalPadrao;
    if (!canalId) {
      relatorio.referenciasNaoResolvidas.push('Atendimento sem canal correspondente.');
    }

    const statusId = buscarNoMapa_(mapas.status, antigo.Status);
    if (!statusId && antigo.Status) {
      relatorio.referenciasNaoResolvidas.push('Status legado sem correspondente no PGO 5.0.');
    }

    const responsavelId = buscarNoMapa_(mapas.usuarios, antigo.Responsavel);
    if (!responsavelId && antigo.Responsavel) {
      relatorio.referenciasNaoResolvidas.push('Responsável legado não encontrado entre os usuários.');
    }

    const criado = pgo5Inserir(PGO5.SHEET_NAMES.ATENDIMENTOS, {
      DataAbertura: antigo.DataAbertura || '',
      // Identificadores continuam TEXTO: "00123" não pode virar 123.
      Protocolo: pgo5TextoDeIdentificador_(antigo.NumeroRA || antigo.Protocolo),
      Cliente: String(antigo.Cliente || ''),
      CPF: pgo5TextoDeIdentificador_(antigo.CPF),
      CanalId: canalId,
      ProdutoId: buscarNoMapa_(mapas.produtos, antigo.Produto),
      CategoriaId: buscarNoMapa_(mapas.categorias, antigo.Categoria),
      SubcategoriaId: buscarNoMapa_(mapas.subcategorias, antigo.Subcategoria),
      StatusId: statusId,
      AguardandoRetornoId: buscarNoMapa_(mapas.aguardando, antigo.MotivoPendencia),
      ResponsavelId: responsavelId,
      Observacoes: String(antigo.Observacoes || ''),
      CriadoPorId: responsavelId,
      DataCriacao: antigo.DataCriacao || antigo.DataAbertura || '',
      AtualizadoPorId: '',
      DataAtualizacao: ''
    });

    contador.migrados++;
    migrarCamposDinamicos_(antigo, String(criado.Id), mapas, relatorio);
  });
}

/**
 * Guarda em ValoresAtendimento os campos que não têm coluna própria.
 *
 * ⚠️ ESCREVE NO DESTINO (aba ValoresAtendimento).
 *
 * O 4.x guardava esses campos num JSON na coluna CamposExtras. Chaves que
 * começam com "_" são metadados internos e ficam de fora.
 *
 * @param {Object} antigo Registro legado completo.
 * @param {string} atendimentoId Id do atendimento já criado no destino.
 * @param {Object} mapas Mapas de Id.
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @returns {void}
 */
function migrarCamposDinamicos_(antigo, atendimentoId, mapas, relatorio) {
  let extras = {};
  try {
    extras = antigo.CamposExtras ? JSON.parse(antigo.CamposExtras) : {};
  } catch (erro) {
    relatorio.avisos.push('CamposExtras em formato inválido: valores dinâmicos ignorados.');
    return;
  }
  if (!extras || typeof extras !== 'object') return;

  Object.keys(extras).forEach(function(chave) {
    if (chave.indexOf('_') === 0) return;              // metadado interno
    const valor = extras[chave];
    if (valor === '' || valor === null || valor === undefined) return;

    const campoId = buscarNoMapa_(mapas.campos, chave);
    if (!campoId) {
      relatorio.referenciasNaoResolvidas.push('Campo dinâmico sem correspondente na configuração.');
      return;
    }

    // A definição do campo vem do índice montado por migrarCatalogo_. Nenhum
    // CAMPO é criado depois dele, então o índice é equivalente a reler a aba
    // — e reler aqui seria o pior lugar possível: esta função roda uma vez
    // por campo extra de CADA atendimento.
    const definicao = mapas.definicoesDeCampo[campoId];

    pgo5Inserir(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, {
      AtendimentoId: atendimentoId,
      CampoId: campoId,
      Valor: String(valor),
      // Snapshot: o atendimento antigo continua legível mesmo que o campo
      // seja renomeado ou excluído da configuração no futuro.
      RotuloSnapshot: definicao ? definicao.rotulo : chave,
      TipoSnapshot: definicao ? definicao.tipo : 'text'
    });
    relatorio.valoresDinamicos.migrados++;
  });
}

/**
 * Traz o "Fora da SLA" da aba IndicadoresSLA para Configurações (Tipo='SLA').
 *
 * ⚠️ ESCREVE NO DESTINO (aba Configurações).
 *
 * Não existe cálculo automático de SLA aqui — o valor é o mesmo que estava
 * gravado, informado manualmente. Ver a nota sobre SLA no README.
 *
 * @param {Object} fonte Resultado de lerFonteLegada_.
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @returns {void}
 */
function migrarConfiguracaoSla_(fonte, relatorio) {
  relatorio.sla.encontrados = fonte.indicadoresSla.length;

  fonte.indicadoresSla.forEach(function(registro) {
    const data = String(registro.Data || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      relatorio.avisos.push('Registro de SLA com data fora do padrão ignorado.');
      return;
    }
    pgo5Inserir(PGO5.SHEET_NAMES.CONFIGURACOES, {
      Tipo: PGO5_TIPO_SLA,
      Chave: data,
      Nome: 'Fora da SLA',
      Valor: Number(registro.ForaSLA) || 0,
      Ativo: true,
      Data: toIso_(new Date())
    });
    relatorio.sla.migrados++;
  });
}

// ============================================================================
// VALIDAÇÃO E RELATÓRIO
// ============================================================================

/**
 * Monta o relatório zerado, com um bloco por entidade.
 *
 * ⚠️ O relatório NÃO guarda CPF, cliente, protocolo, e-mail nem qualquer
 * dado pessoal — só contagens e avisos genéricos. Ele é lido por pessoas e
 * pode ser copiado para um chamado.
 *
 * @returns {Object} Relatório inicial.
 */
function criarRelatorioMigracao_() {
  const bloco = function() { return { encontrados: 0, migrados: 0 }; };
  return {
    iniciadoEm: toIso_(new Date()),
    concluidoEm: '',
    sucesso: false,
    reclameAqui: bloco(),
    sacPreventivo: bloco(),
    usuarios: { encontrados: 0, migrados: 0, jaExistentes: 0, semSupervisor: 0 },
    canais: bloco(),
    produtos: bloco(),
    categorias: bloco(),
    subcategorias: bloco(),
    campos: bloco(),
    valoresDinamicos: { migrados: 0 },
    sla: bloco(),
    referenciasNaoResolvidas: [],
    avisos: [],
    erros: []
  };
}

/**
 * Confere o que foi gravado no destino depois do tombamento.
 *
 * Não corrige nada: só aponta problemas, para quem executou decidir se
 * aceita o resultado ou refaz.
 *
 * @param {Object} relatorio Relatório acumulado (alterado aqui).
 * @returns {Object} { ok: boolean, problemas: string[] }.
 */
function validarResultadoMigracao_(relatorio) {
  const problemas = [];
  const atendimentos = pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS);

  // Todo atendimento precisa de Id, e nenhum Id pode se repetir.
  const vistos = {};
  atendimentos.forEach(function(registro) {
    const id = String(registro.Id || '').trim();
    if (!id) { problemas.push('Atendimento gravado sem Id.'); return; }
    if (vistos[id]) problemas.push('Id de atendimento duplicado.');
    vistos[id] = true;
  });

  // As contagens do relatório precisam bater com o que está na planilha.
  const esperado = relatorio.reclameAqui.migrados + relatorio.sacPreventivo.migrados;
  if (atendimentos.length < esperado) {
    problemas.push('Foram gravados menos atendimentos do que o relatório indica.');
  }

  // O banco continua com exatamente 5 abas.
  const abas = getSpreadsheet().getSheets().map(function(aba) { return aba.getName(); });
  pgo5TodasAsAbas_().forEach(function(nome) {
    if (abas.indexOf(nome) === -1) problemas.push('Aba do PGO 5.0 ausente: ' + nome + '.');
  });

  // Referências apontando para itens que não existem.
  const idsValidos = {};
  [PGO5.SHEET_NAMES.FORMULARIO, PGO5.SHEET_NAMES.USUARIOS].forEach(function(aba) {
    pgo5Ler(aba).forEach(function(registro) { idsValidos[String(registro.Id)] = true; });
  });
  atendimentos.forEach(function(registro) {
    ['CanalId', 'ProdutoId', 'CategoriaId', 'SubcategoriaId', 'ResponsavelId']
      .forEach(function(coluna) {
        const valor = String(registro[coluna] || '').trim();
        if (valor && !idsValidos[valor]) {
          problemas.push('Referência inexistente em ' + coluna + '.');
        }
      });
  });

  return { ok: problemas.length === 0, problemas: problemas };
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

/**
 * Diz se o tombamento já foi executado com sucesso nesta instalação.
 * @returns {boolean} true quando existe o marcador de conclusão.
 */
function migracaoJaFoiConcluida_() {
  return !!PropertiesService.getScriptProperties()
    .getProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA);
}

/**
 * Executa o tombamento completo.
 *
 * ⚠️ ESCREVE NO DESTINO. ⚠️ NÃO ESCREVE NA ORIGEM.
 *
 * PROTEÇÃO CONTRA EXECUÇÃO DUPLICADA
 * Rodar duas vezes duplicaria todos os atendimentos. Por isso a primeira
 * conclusão bem-sucedida grava um marcador em Script Properties e qualquer
 * tentativa seguinte é recusada. O marcador só é gravado NO FIM: se algo
 * falhar no meio, ele não existe e o relatório mostra onde parou.
 *
 * @returns {Object} Relatório do tombamento (sem dado pessoal).
 * @throws {Error} Sem permissão, sem fonte configurada ou já executado.
 */
function executarMigracaoPGO5() {
  const ator = exigirPermissao_('configurarSistema');

  if (migracaoJaFoiConcluida_()) {
    throw new Error('A migração já foi concluída nesta instalação. ' +
      'Executá-la de novo duplicaria todos os registros.');
  }

  const relatorio = criarRelatorioMigracao_();

  return withScriptLock_(function() {
    try {
      const fonte = lerFonteLegada_();
      const mapas = criarMapasMigracao_();

      // A ordem é obrigatória: catálogo e usuários primeiro, porque os
      // atendimentos precisam dos mapas de Id já prontos.
      migrarCatalogo_(fonte, mapas, relatorio);
      migrarUsuarios_(fonte, mapas, relatorio);

      const canalRa = buscarNoMapa_(mapas.canais, 'Reclame Aqui');
      const canalSac = buscarNoMapa_(mapas.canais, 'SAC Preventivo');
      migrarAtendimentosDaAba_(fonte.reclameAqui, canalRa, mapas, relatorio, relatorio.reclameAqui);
      migrarAtendimentosDaAba_(fonte.sacPreventivo, canalSac, mapas, relatorio, relatorio.sacPreventivo);

      migrarConfiguracaoSla_(fonte, relatorio);

      const validacao = validarResultadoMigracao_(relatorio);
      if (!validacao.ok) {
        relatorio.erros = validacao.problemas;
        relatorio.sucesso = false;
        // Marcador NÃO é gravado: a migração não terminou bem.
        return relatorio;
      }

      relatorio.sucesso = true;
      relatorio.concluidoEm = toIso_(new Date());
      PropertiesService.getScriptProperties()
        .setProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA, relatorio.concluidoEm);

      registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY,
        PGO5_ENTIDADES_AUDITORIA.SEGURANCA, '', 'Tombamento do banco 4.x concluído.',
        {
          atendimentos: relatorio.reclameAqui.migrados + relatorio.sacPreventivo.migrados,
          usuarios: relatorio.usuarios.migrados
        }, String(ator.id));

      return relatorio;
    } catch (erro) {
      // Falha no meio: o marcador continua ausente e o erro vai no relatório.
      relatorio.sucesso = false;
      relatorio.erros.push(erro.message);
      return relatorio;
    }
  });
}

/**
 * (SOMENTE TESTE/DEV) Limpa o marcador para permitir rodar de novo.
 *
 * ⚠️ PERIGOSO EM PRODUÇÃO: sem o marcador, uma nova execução duplicaria
 * todos os atendimentos. Existe para o ambiente de homologação, onde a base
 * é descartável.
 *
 * Exige 'configurarSistema' e fica registrada na auditoria — não é uma
 * função escondida, é uma função vigiada.
 *
 * @returns {Object} { success: true }.
 * @throws {Error} Quando o usuário não tem permissão.
 */
function limparMarcadorMigracaoPGO5() {
  const ator = exigirPermissao_('configurarSistema');
  PropertiesService.getScriptProperties().deleteProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA);

  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY,
    PGO5_ENTIDADES_AUDITORIA.SEGURANCA, '',
    'Marcador de migração limpo (ambiente de teste).', {}, String(ator.id));

  return { success: true };
}

/**
 * Estado do tombamento, para a tela de Configurações mostrar.
 *
 * Não devolve o Id da planilha de origem — só se ele está configurado.
 *
 * @returns {Object} { concluida, concluidaEm, fonteConfigurada }.
 * @throws {Error} Quando o usuário não tem permissão.
 */
function obterEstadoMigracaoPGO5() {
  exigirPermissao_('configurarSistema');
  const props = PropertiesService.getScriptProperties();
  return {
    concluida: migracaoJaFoiConcluida_(),
    concluidaEm: String(props.getProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA) || ''),
    fonteConfigurada: !!String(props.getProperty(PGO5_CHAVE_FONTE_LEGADA) || '').trim()
  };
}
