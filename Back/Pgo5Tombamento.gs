/**
 * ============================================================================
 * PRISMA Gestão Operacional — PGO 5.0
 * Arquivo: Pgo5Tombamento.gs
 *
 * RESPONSABILIDADE
 * Deixar o Administrador executar o tombamento pela PRÓPRIA INTERFACE, com
 * segurança, sem abrir o editor do Apps Script e sem que nenhum dado da
 * planilha antiga apareça na tela.
 *
 * ⚠️ ESTE ARQUIVO NÃO MIGRA NADA
 * Quem migra continua sendo Pgo5Migracao.gs — executarMigracaoPGO5(). Aqui
 * existe apenas a CAMADA SEGURA em volta dele:
 *
 *      informar a fonte → validar → conferir o destino → executar
 *                                                          ↓
 *                                            executarMigracaoPGO5()
 *
 * Nenhuma regra de mapeamento, nenhuma leitura de aba legada para gravação e
 * nenhuma contagem do relatório foi reimplementada. Se o tombamento mudar,
 * muda no motor; este arquivo continua igual.
 *
 * ============================================================================
 * AS QUATRO GARANTIAS DESTE ARQUIVO
 * ============================================================================
 *
 *   1. A FONTE É SOMENTE LEITURA
 *      Nenhuma função daqui chama setValue, setValues, appendRow, deleteRow,
 *      clear nem deleteSheet sobre a planilha de origem. Ela sai da operação
 *      exatamente como entrou, e há teste provando isso
 *      (pgo5TesteFonteImutavel_, em homologarTombamentoPGO5).
 *
 *   2. O ID DA PLANILHA ANTIGA NUNCA SAI DO SERVIDOR
 *      Ele entra uma vez pelo campo da tela, é gravado em Script Properties
 *      e a partir daí só o código do servidor o lê. Não volta para o
 *      navegador, não entra na auditoria, não vai para o Logger, não aparece
 *      em mensagem de erro e não é versionado.
 *
 *   3. A TELA VÊ SOMENTE CONTAGENS
 *      Nem CPF, nem cliente, nem protocolo, nem e-mail, nem observações, nem
 *      CamposExtras, nem nome de usuário. Só números e textos genéricos, e
 *      tudo passa por pgo5SanitizarRelatorioTombamento_ antes de sair.
 *
 *   4. NÃO EXISTE SEGUNDA EXECUÇÃO
 *      Concluído com sucesso, o marcador do motor recusa qualquer nova
 *      tentativa e o Id da fonte é apagado. Falhando no meio, o marcador NÃO
 *      é gravado — e a orientação é reconstruir o destino a partir de uma
 *      base limpa, nunca "continuar de onde parou".
 *
 * ============================================================================
 * A LACUNA DA PRIMEIRA INSTALAÇÃO (e por que prepararInstalacaoPGO5 existe)
 * ============================================================================
 * O banco 4.x tinha promoteFirstAdmin_ (Database.gs): a inicialização
 * promovia alguém a ADM automaticamente. O PGO 5.0 abandonou isso de
 * propósito — promoção automática de administrador é exatamente o tipo de
 * atalho que não se quer num sistema com níveis de acesso — mas nada foi
 * posto no lugar. O resultado é um impasse numa instalação nova:
 *
 *   inicializarPGO5Dev()      cria as 5 abas + seeds. NÃO cria usuário.
 *   executarMigracaoPGO5()    exige 'configurarSistema' → exigirPermissao_
 *                             → requireAuth_ → procura o e-mail na aba
 *                               Usuários → aba VAZIA → 'AUTH: ...'.
 *   salvarUsuarioPGO5()       para criar o primeiro usuário… também exige
 *                             permissão.
 *
 * Ou seja: numa base nova ninguém consegue ter permissão, porque ter
 * permissão depende de já existir um usuário. prepararInstalacaoPGO5 fecha
 * essa lacuna criando UM administrador inicial — e somente isso, somente uma
 * vez, somente numa base ainda vazia e somente pela conta dona do projeto.
 * ============================================================================
 */

// ============================================================================
// O QUE A FONTE PRECISA TER
// ============================================================================

/**
 * Abas que a planilha antiga é OBRIGADA a ter para o tombamento acontecer.
 *
 * São as mesmas que o motor lê (PGO5_ABAS_LEGADAS), menos IndicadoresSLA —
 * que é opcional porque só existe em instalações que chegaram à v4.7.
 *
 * Faltando qualquer uma destas, o tombamento é recusado ANTES de começar: um
 * tombamento parcial não tem volta, e descobrir no meio que a aba Produtos
 * não existe deixaria o destino com atendimentos sem classificação.
 *
 * @returns {string[]} Nomes das abas obrigatórias.
 */
function pgo5AbasObrigatoriasDaFonte_() {
  return [
    PGO5_ABAS_LEGADAS.RECLAME_AQUI,
    PGO5_ABAS_LEGADAS.SAC_PREVENTIVO,
    PGO5_ABAS_LEGADAS.USUARIOS,
    PGO5_ABAS_LEGADAS.CANAIS,
    PGO5_ABAS_LEGADAS.PRODUTOS,
    PGO5_ABAS_LEGADAS.CATEGORIAS,
    PGO5_ABAS_LEGADAS.SUBCATEGORIAS,
    PGO5_ABAS_LEGADAS.CONFIG_CAMPOS
  ];
}

/**
 * Abas do 4.x que o tombamento NÃO importa, de propósito.
 *
 * Timeline e Histórico são o log operacional do modelo antigo e não têm
 * equivalente no PGO 5.0. Trazê-los encheria a aba Configurações de milhares
 * de linhas que ninguém consulta. Eles continuam na cópia histórica, que é
 * preservada intacta — é lá que se consulta o passado, se algum dia precisar.
 *
 * @returns {string[]} Nomes das abas deliberadamente ignoradas.
 */
function pgo5AbasNaoImportadas_() {
  return [CONFIG.SHEET_NAMES.TIMELINE, CONFIG.SHEET_NAMES.HISTORICO];
}

// ============================================================================
// LINK OU ID DA FONTE
// ============================================================================

/**
 * Extrai o Id de uma planilha a partir do que o Administrador colou na tela.
 *
 * Aceita as duas formas, porque exigir uma delas seria uma pegadinha: quem
 * abre a planilha no navegador tem a URL na mão, e quem já conhece o sistema
 * tem o Id anotado.
 *
 *   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0   → <ID>
 *   https://docs.google.com/spreadsheets/d/<ID>              → <ID>
 *   <ID>                                                     → <ID>
 *
 * Um Id do Drive tem 25 caracteres ou mais entre letras, números, "-" e "_".
 * O piso de 25 existe para recusar de imediato coisas como "planilha antiga"
 * ou um nome de arquivo colado por engano, em vez de tentar abrir e devolver
 * um erro genérico do Drive.
 *
 * @param {string} linkOuId Texto digitado (URL completa ou Id puro).
 * @returns {string} O Id encontrado, ou '' quando não há Id reconhecível.
 */
function pgo5ExtrairIdDePlanilha_(linkOuId) {
  const texto = sanitizeInput(linkOuId);
  if (!texto) return '';

  // Forma 1: URL do Google Sheets — o Id vem depois de "/d/".
  const naUrl = texto.match(/\/d\/([a-zA-Z0-9_-]{25,})/);
  if (naUrl) return naUrl[1];

  // Forma 2: o Id puro, sozinho no campo.
  const puro = texto.match(/^([a-zA-Z0-9_-]{25,})$/);
  if (puro) return puro[1];

  return '';
}

/**
 * Id da fonte guardado em Script Properties.
 *
 * ⚠️ FUNÇÃO INTERNA (sufixo "_"): o Apps Script só expõe a google.script.run
 * funções sem "_" no fim, então o navegador não tem como chamar isto — é o
 * próprio mecanismo da plataforma impedindo o Id de sair do servidor.
 *
 * @returns {string} Id configurado, ou '' quando não há fonte.
 */
function pgo5IdDaFonteConfigurada_() {
  return String(PropertiesService.getScriptProperties()
    .getProperty(PGO5_CHAVE_FONTE_LEGADA) || '').trim();
}

// ============================================================================
// SANITIZAÇÃO DO QUE VOLTA PARA A TELA
// ============================================================================

/**
 * Apaga de um texto qualquer coisa que possa ser dado pessoal ou segredo.
 *
 * POR QUE ISTO É NECESSÁRIO MESMO COM O MOTOR SENDO CUIDADOSO
 * As mensagens que o motor escreve são genéricas por construção ("Categoria
 * sem Produto correspondente."), mas o relatório também carrega
 * `erro.message` de exceções — e uma exceção do Drive ou do SpreadsheetApp
 * pode citar o Id do arquivo que falhou. Sem esta passada, o Id da planilha
 * real chegaria ao navegador exatamente no caminho mais difícil de prever: o
 * do erro inesperado.
 *
 * A ordem das substituições importa. URL primeiro (senão o "@" de um e-mail
 * dentro de uma URL seria tratado antes), depois e-mail, depois CPF, depois
 * sequências longas de dígitos e por último tokens longos — que é o que pega
 * o Id do Drive.
 *
 * @param {string} texto Texto livre vindo do motor ou de uma exceção.
 * @returns {string} Texto com os trechos sensíveis trocados por marcador.
 */
function pgo5SanitizarTextoTombamento_(texto) {
  const marcador = '[removido]';
  let limpo = String(texto === undefined || texto === null ? '' : texto);

  limpo = limpo.replace(/https?:\/\/\S+/gi, marcador);                 // URL
  limpo = limpo.replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, marcador);   // e-mail
  limpo = limpo.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, marcador); // CPF
  limpo = limpo.replace(/\b\d{11,}\b/g, marcador);                     // dígitos longos
  limpo = limpo.replace(/[a-zA-Z0-9_-]{25,}/g, marcador);              // Id do Drive

  return limpo.slice(0, 200);
}

/**
 * Reduz uma lista de mensagens a algo que pode ser mostrado e copiado.
 *
 * Sanitiza cada item, remove repetições (o motor empilha uma mensagem por
 * registro: 4.000 atendimentos sem canal viram 4.000 linhas idênticas) e
 * limita a quantidade, para a tela não virar um paredão de texto.
 *
 * @param {string[]} mensagens Lista crua do relatório.
 * @param {number} [maximo] Quantos itens distintos manter (padrão 20).
 * @returns {Object} { total, distintos: string[] }.
 */
function pgo5ResumirMensagensTombamento_(mensagens, maximo) {
  const limite = Math.max(1, Number(maximo) || 20);
  const lista = Array.isArray(mensagens) ? mensagens : [];
  const vistos = {};
  const distintos = [];

  lista.forEach(function(mensagem) {
    const limpa = pgo5SanitizarTextoTombamento_(mensagem);
    if (!limpa || vistos[limpa]) return;
    vistos[limpa] = true;
    if (distintos.length < limite) distintos.push(limpa);
  });

  return { total: lista.length, distintos: distintos };
}

/**
 * Converte o relatório do motor no relatório AGREGADO que a tela recebe.
 *
 * ⚠️ É esta função que decide o que o navegador pode ver. Tudo o que não
 * estiver montado aqui simplesmente não sai do servidor — inclusive campos
 * que o motor venha a acrescentar no futuro, porque a cópia é explícita e
 * campo a campo, nunca um Object.assign do relatório inteiro.
 *
 * Referências não resolvidas saem SÓ como quantidade: cada uma delas
 * corresponde a um registro específico, e detalhá-las abriria uma porta para
 * inferir conteúdo da base.
 *
 * @param {Object} relatorio Resultado de executarMigracaoPGO5().
 * @returns {Object} Relatório agregado, sem nenhum dado operacional.
 */
function pgo5SanitizarRelatorioTombamento_(relatorio) {
  const bruto = relatorio || {};
  const bloco = function(origem) {
    const dados = origem || {};
    return {
      encontrados: Number(dados.encontrados) || 0,
      migrados: Number(dados.migrados) || 0
    };
  };

  return {
    sucesso: bruto.sucesso === true,
    iniciadoEm: String(bruto.iniciadoEm || ''),
    concluidoEm: String(bruto.concluidoEm || ''),
    reclameAqui: bloco(bruto.reclameAqui),
    sacPreventivo: bloco(bruto.sacPreventivo),
    usuarios: {
      encontrados: Number((bruto.usuarios || {}).encontrados) || 0,
      migrados: Number((bruto.usuarios || {}).migrados) || 0,
      jaExistentes: Number((bruto.usuarios || {}).jaExistentes) || 0,
      semSupervisor: Number((bruto.usuarios || {}).semSupervisor) || 0
    },
    canais: bloco(bruto.canais),
    produtos: bloco(bruto.produtos),
    categorias: bloco(bruto.categorias),
    subcategorias: bloco(bruto.subcategorias),
    campos: bloco(bruto.campos),
    valoresDinamicos: { migrados: Number((bruto.valoresDinamicos || {}).migrados) || 0 },
    sla: bloco(bruto.sla),
    // Somente a quantidade, conforme a regra de exposição do tombamento.
    referenciasNaoResolvidas: Array.isArray(bruto.referenciasNaoResolvidas)
      ? bruto.referenciasNaoResolvidas.length : 0,
    avisos: pgo5ResumirMensagensTombamento_(bruto.avisos),
    erros: pgo5ResumirMensagensTombamento_(bruto.erros)
  };
}

// ============================================================================
// VALIDAÇÃO DA FONTE (somente leitura)
// ============================================================================

/**
 * Conta as linhas úteis de cada aba da planilha antiga.
 *
 * Usa lerAbaLegada_ — a MESMA função que o motor usa para migrar. Isso é
 * deliberado: se a contagem viesse de getLastRow(), a tela mostraria um
 * número (contando linhas em branco no meio) e a migração processaria outro.
 * O Administrador confere o resumo justamente para decidir se executa; o
 * número tem de ser o mesmo que o motor vai processar.
 *
 * ⚠️ SOMENTE LEITURA. E somente o `length` de cada lista sai desta função —
 * o conteúdo lido é descartado junto com a execução.
 *
 * @param {Spreadsheet} planilha Planilha de origem, já aberta.
 * @returns {Object} Contagens por entidade.
 */
function pgo5ContagensDaFonte_(planilha) {
  const contar = function(nomeDaAba) {
    return lerAbaLegada_(planilha, nomeDaAba).length;
  };
  return {
    reclameAqui: contar(PGO5_ABAS_LEGADAS.RECLAME_AQUI),
    sacPreventivo: contar(PGO5_ABAS_LEGADAS.SAC_PREVENTIVO),
    usuarios: contar(PGO5_ABAS_LEGADAS.USUARIOS),
    canais: contar(PGO5_ABAS_LEGADAS.CANAIS),
    produtos: contar(PGO5_ABAS_LEGADAS.PRODUTOS),
    categorias: contar(PGO5_ABAS_LEGADAS.CATEGORIAS),
    subcategorias: contar(PGO5_ABAS_LEGADAS.SUBCATEGORIAS),
    campos: contar(PGO5_ABAS_LEGADAS.CONFIG_CAMPOS),
    sla: contar(PGO5_ABAS_LEGADAS.INDICADORES_SLA)
  };
}

/**
 * Abre a planilha informada em modo leitura e confere se ela serve de fonte.
 *
 * ⚠️ SOMENTE LEITURA: abre, lê, conta e fecha. Nada é gravado na origem.
 *
 * REGRAS APLICADAS, NESTA ORDEM
 *   1. o Id tem de ser reconhecível;
 *   2. não pode ser a própria planilha do PGO 5.0 (a de destino);
 *   3. a planilha tem de abrir (existe e a conta tem acesso);
 *   4. as 8 abas obrigatórias têm de estar lá.
 *
 * A ordem não é decorativa: comparar com o destino ANTES de abrir evita que
 * um erro de digitação faça o sistema ler a própria base como se fosse
 * legada, e a checagem de abas só faz sentido com a planilha aberta.
 *
 * ⚠️ Nenhuma mensagem de erro repete o Id nem a URL informada. Quem digitou
 * sabe o que digitou; ecoar o valor só o exporia no navegador e no console.
 *
 * @param {string} id Id da planilha de origem.
 * @returns {Object} { ok, motivo, abasAusentes, temSla, contagens }.
 */
function pgo5ValidarFonteLegada_(id) {
  const resultado = {
    ok: false,
    motivo: '',
    abasAusentes: [],
    temSla: false,
    contagens: null
  };

  const alvo = String(id || '').trim();
  if (!alvo) {
    resultado.motivo = 'Informe o link ou o Id da cópia da planilha antiga.';
    return resultado;
  }

  // A fonte não pode ser o destino. Sem esta checagem o tombamento leria a
  // própria base 5.0 procurando abas do 4.x, não as encontraria e devolveria
  // um erro confuso — quando o problema real é o link estar errado.
  let idDoDestino = '';
  try {
    idDoDestino = String(getSpreadsheet().getId() || '');
  } catch (erro) {
    resultado.motivo = 'Não foi possível abrir a planilha do sistema para comparar com a fonte.';
    return resultado;
  }
  if (alvo === idDoDestino) {
    resultado.motivo = 'A fonte informada é a própria planilha do PGO 5.0. ' +
      'Informe a CÓPIA da planilha antiga (modelo 4.x).';
    return resultado;
  }

  let planilha = null;
  try {
    planilha = SpreadsheetApp.openById(alvo);
  } catch (erro) {
    // A mensagem original do Drive costuma citar o Id — por isso ela não é
    // repassada, nem para o Logger.
    resultado.motivo = 'Não foi possível abrir a planilha informada. Confira se o link está ' +
      'correto e se esta conta tem acesso a ela.';
    return resultado;
  }

  resultado.abasAusentes = pgo5AbasObrigatoriasDaFonte_().filter(function(nome) {
    return !planilha.getSheetByName(nome);
  });
  if (resultado.abasAusentes.length > 0) {
    resultado.motivo = 'A planilha informada não tem a estrutura do modelo 4.x. ' +
      'Abas obrigatórias ausentes: ' + resultado.abasAusentes.join(', ') + '.';
    return resultado;
  }

  resultado.temSla = !!planilha.getSheetByName(PGO5_ABAS_LEGADAS.INDICADORES_SLA);
  resultado.contagens = pgo5ContagensDaFonte_(planilha);
  resultado.ok = true;
  return resultado;
}

// ============================================================================
// PRÉ-CHECK DO DESTINO
// ============================================================================

/**
 * Confere se o banco PGO 5.0 está limpo o bastante para receber o tombamento.
 *
 * POR QUE ESTE PRÉ-CHECK É A PARTE MAIS IMPORTANTE DO ARQUIVO
 * O tombamento não tem transação: o Google Sheets não desfaz meia gravação.
 * Rodá-lo sobre um destino que já tem dados produz uma base misturada, em que
 * ninguém sabe mais o que veio do 4.x e o que foi digitado depois — e a única
 * saída é reconstruir tudo. Então a barreira fica ANTES, não depois.
 *
 * O QUE É PERMITIDO EXISTIR NO DESTINO
 *   - as 5 abas do schema, com o cabeçalho oficial;
 *   - os seeds estruturais (canais, campos, status, "aguardando");
 *   - cargos e níveis de acesso;
 *   - o administrador inicial (um único usuário);
 *   - registros técnicos: auditoria e o que o PIN grava.
 *
 * O QUE BLOQUEIA
 *   - marcador de migração já gravado (o tombamento já rodou);
 *   - qualquer atendimento ou valor dinâmico;
 *   - linhas de SLA em Configurações (só a migração as cria);
 *   - produtos, categorias ou subcategorias já cadastrados;
 *   - mais de um usuário — a migração TRAZ os usuários da origem, então o
 *     destino tem de ter apenas o administrador inicial;
 *   - abas do modelo 4.x na mesma planilha (indício de que o destino é, na
 *     verdade, a base antiga).
 *
 * Abas extras que não são do 5.0 nem do 4.x (a "Página1" que toda planilha
 * nova traz, por exemplo) entram como AVISO e não bloqueiam: recusar por
 * causa delas impediria uma primeira instalação perfeitamente legítima, e
 * excluí-las está fora do que este arquivo pode fazer.
 *
 * @returns {Object} { ok, bloqueios: string[], avisos: string[], contagens }.
 */
function pgo5PreCheckDestinoTombamento_() {
  const resultado = { ok: false, bloqueios: [], avisos: [], contagens: null };
  const planilha = getSpreadsheet();

  // ── 1. As 5 abas oficiais, com o cabeçalho oficial ──
  const oficiais = pgo5TodasAsAbas_();
  const ausentes = [];
  const divergentes = [];
  oficiais.forEach(function(nome) {
    const aba = planilha.getSheetByName(nome);
    if (!aba) { ausentes.push(nome); return; }
    if (!pgo5ValidarCabecalho_(aba, pgo5Colunas_(nome)).valido) divergentes.push(nome);
  });

  if (ausentes.length > 0) {
    resultado.bloqueios.push('Abas do PGO 5.0 ausentes: ' + ausentes.join(', ') +
      '. Execute a preparação da instalação antes do tombamento.');
  }
  if (divergentes.length > 0) {
    resultado.bloqueios.push('Abas com estrutura divergente do schema ' + PGO5.SCHEMA_VERSION +
      ': ' + divergentes.join(', ') + '.');
  }
  // Sem as 5 abas válidas não há como ler o resto: as checagens seguintes
  // dependem de pgo5Ler, que exige a estrutura correta.
  if (resultado.bloqueios.length > 0) return resultado;

  // ── 2. Abas do 4.x na planilha de destino ──
  const marcasLegadas = [
    CONFIG.SHEET_NAMES.RECLAME_AQUI,
    CONFIG.SHEET_NAMES.SAC_PREVENTIVO,
    CONFIG.SHEET_NAMES.CONFIG_CAMPOS,
    CONFIG.SHEET_NAMES.TIMELINE,
    CONFIG.SHEET_NAMES.HISTORICO
  ].filter(function(nome) { return !!planilha.getSheetByName(nome); });

  if (marcasLegadas.length > 0) {
    resultado.bloqueios.push('A planilha de destino contém abas do modelo 4.x (' +
      marcasLegadas.join(', ') + '). O destino do tombamento tem de ser uma planilha ' +
      'exclusiva do PGO 5.0.');
  }

  // ── 3. Abas extras (aviso, não bloqueio) ──
  const conhecidas = oficiais.concat(marcasLegadas);
  const extras = planilha.getSheets()
    .map(function(aba) { return aba.getName(); })
    .filter(function(nome) { return conhecidas.indexOf(nome) === -1; });
  if (extras.length > 0) {
    resultado.avisos.push('A planilha tem ' + extras.length +
      ' aba(s) que não pertencem ao PGO 5.0. Elas não são lidas nem alteradas pelo tombamento.');
  }

  // ── 4. Marcador de conclusão ──
  if (migracaoJaFoiConcluida_()) {
    resultado.bloqueios.push('O tombamento já foi concluído nesta instalação. ' +
      'Executá-lo de novo duplicaria todos os registros.');
  }

  // ── 5. Nada operacional no destino ──
  const atendimentos = pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS).length;
  const valores = pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).length;
  const usuarios = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).length;

  if (atendimentos > 0) {
    resultado.bloqueios.push('A aba Atendimentos já tem ' + atendimentos +
      ' registro(s). O tombamento só roda sobre um destino vazio.');
  }
  if (valores > 0) {
    resultado.bloqueios.push('A aba ValoresAtendimento já tem ' + valores + ' registro(s).');
  }
  if (usuarios > 1) {
    resultado.bloqueios.push('A aba Usuários já tem ' + usuarios +
      ' registro(s). O tombamento traz os usuários da origem, então o destino deve conter ' +
      'apenas o administrador inicial.');
  }

  // ── 6. Catálogo operacional e SLA já preenchidos ──
  const catalogo = pgo5CatalogoBruto_();
  [
    { tipo: PGO5_TIPOS.PRODUTO, rotulo: 'produto(s)' },
    { tipo: PGO5_TIPOS.CATEGORIA, rotulo: 'categoria(s)' },
    { tipo: PGO5_TIPOS.SUBCATEGORIA, rotulo: 'subcategoria(s)' }
  ].forEach(function(item) {
    const quantidade = (catalogo[item.tipo] || []).length;
    if (quantidade > 0) {
      resultado.bloqueios.push('O catálogo já tem ' + quantidade + ' ' + item.rotulo +
        ' cadastrado(s). Eles são trazidos pelo tombamento.');
    }
  });

  const linhasSla = pgo5Ler(PGO5.SHEET_NAMES.CONFIGURACOES).filter(function(linha) {
    return String(linha.Tipo || '').trim().toUpperCase() === PGO5_TIPO_SLA;
  }).length;
  if (linhasSla > 0) {
    resultado.bloqueios.push('Já existem ' + linhasSla +
      ' registro(s) de SLA em Configurações. Eles são trazidos pelo tombamento.');
  }

  resultado.contagens = {
    atendimentos: atendimentos,
    valoresDinamicos: valores,
    usuarios: usuarios,
    produtos: (catalogo[PGO5_TIPOS.PRODUTO] || []).length,
    categorias: (catalogo[PGO5_TIPOS.CATEGORIA] || []).length,
    subcategorias: (catalogo[PGO5_TIPOS.SUBCATEGORIA] || []).length,
    sla: linhasSla
  };
  resultado.ok = resultado.bloqueios.length === 0;
  return resultado;
}

// ============================================================================
// PREPARAÇÃO DA PRIMEIRA INSTALAÇÃO
// ============================================================================

/**
 * Dados do administrador inicial criado pela preparação.
 *
 * O nome é fixo e genérico de propósito: o e-mail já identifica a pessoa, e
 * gravar o nome real exigiria pedi-lo — mais um campo para errar numa função
 * que precisa ser à prova de erro. O ADM renomeia depois, na tela de
 * Usuários, com um clique.
 */
const PGO5_NOME_ADMINISTRADOR_INICIAL = 'Administrador Inicial';

/** Chave do Cargo do administrador inicial (cargosIniciais_). */
const PGO5_CHAVE_CARGO_INICIAL = 'ADM';

/** Chave do Nível de Acesso do administrador inicial (niveisAcessoIniciais_). */
const PGO5_CHAVE_NIVEL_INICIAL = 'ADMINISTRADOR';

/**
 * Confere que quem chama é a conta DONA do projeto, no editor do Apps Script.
 *
 * COMO ESTA GUARDA FUNCIONA DE VERDADE
 * O Web App do PRISMA é publicado como "executar como eu". Então, para
 * qualquer visitante:
 *
 *   Session.getActiveUser()    → a conta que ACESSA (o visitante)
 *   Session.getEffectiveUser() → a conta que EXECUTA (o dono do script)
 *
 * As duas só coincidem quando quem executa é o próprio dono — e é isso que
 * torna a chamada pelo navegador de um terceiro impossível, sem depender de
 * nenhuma convenção. No editor do Apps Script as duas são a mesma conta.
 *
 * getActiveUser() também devolve string vazia quando o Apps Script não
 * consegue identificar a conta (contas de fora do domínio, alguns gatilhos):
 * nesse caso a função recusa, porque sem identidade não há como saber de quem
 * é o e-mail que viraria administrador.
 *
 * É a mesma guarda de inicializarPGO5Dev — repetida aqui de propósito, para
 * que esta função não dependa da ordem de carregamento dos arquivos .gs.
 *
 * @returns {string} E-mail da conta autenticada (usado, nunca registrado).
 * @throws {Error} Quando a chamada não vem do dono do projeto.
 */
function pgo5ExigirDonoDoProjeto_() {
  let ativo = '';
  let efetivo = '';
  try { ativo = Session.getActiveUser().getEmail() || ''; } catch (erro) { ativo = ''; }
  try { efetivo = Session.getEffectiveUser().getEmail() || ''; } catch (erro) { efetivo = ''; }

  if (!ativo || !efetivo || normalizeText_(ativo) !== normalizeText_(efetivo)) {
    throw new Error('PGO5: esta função só pode ser executada pelo dono do projeto, ' +
      'no editor do Apps Script. Ela não é acessível pelo Web App.');
  }
  return ativo;
}

/**
 * (EDITOR — PRIMEIRA INSTALAÇÃO) Prepara uma instalação nova do PGO 5.0 e
 * cria o administrador inicial.
 *
 * ⚠️ EXECUTE NO EDITOR DO APPS SCRIPT, uma única vez, numa base AINDA VAZIA.
 * Ver a explicação da lacuna no cabeçalho deste arquivo.
 *
 * O QUE ELA FAZ, EM ORDEM
 *   1. confere que quem executa é o dono do projeto (pgo5ExigirDonoDoProjeto_);
 *   2. recusa se a base já tiver qualquer usuário;
 *   3. cria as 5 abas e aplica os seeds, usando a fundação existente
 *      (inicializarPGO5_, pgo5AplicarSeedEstrutural_, aplicarSeedPermissoesPGO5_);
 *   4. confere que as 5 abas oficiais existem e estão válidas;
 *   5. localiza o Cargo pela chave ADM e o Nível pela chave ADMINISTRADOR;
 *   6. cria UM usuário, com o e-mail da conta autenticada.
 *
 * O QUE ELA NUNCA FAZ
 *   - não tem e-mail nenhum escrito no código;
 *   - não grava o e-mail no Logger nem na auditoria;
 *   - não devolve o e-mail no relatório;
 *   - não apaga, não limpa e não sobrescreve nada;
 *   - não roda duas vezes: com um usuário já cadastrado, recusa.
 *
 * SOBRE A SEGUNDA EXECUÇÃO
 * É recusada com erro explícito, e não silenciosamente ignorada. Um retorno
 * "tudo certo" faria quem executou acreditar que um segundo administrador foi
 * criado — e ele iria procurá-lo na tela de Usuários sem encontrar.
 *
 * @returns {Object} Relatório SEM dado pessoal:
 *   { sucesso, abasCriadas, abasJaExistentes, seed, seedAcesso,
 *     administradorInicialId, cargoId, nivelAcessoId, erros }.
 * @throws {Error} Fora do editor, base já com usuário, ou seed incompleto.
 */
function prepararInstalacaoPGO5() {
  // O e-mail fica só nesta variável, dentro desta execução. Ele é usado na
  // gravação do usuário e em nenhum outro lugar.
  const emailDoDono = pgo5ExigirDonoDoProjeto_();

  if (pgo5PossuiUsuarios_()) {
    throw new Error('PGO5: esta instalação já tem usuário cadastrado. A preparação inicial ' +
      'roda uma única vez, numa base vazia. Para gerenciar usuários use Configurações › Usuários.');
  }

  const relatorio = {
    sucesso: false,
    abasCriadas: [],
    abasJaExistentes: [],
    seed: null,
    seedAcesso: null,
    administradorInicialId: '',
    cargoId: '',
    nivelAcessoId: '',
    erros: []
  };

  // ── Estrutura: reaproveita a fundação, sem reimplementar nada ──
  const estrutura = inicializarPGO5_();
  relatorio.abasCriadas = estrutura.abasCriadas || [];
  relatorio.abasJaExistentes = estrutura.abasJaExistentes || [];
  if (!estrutura.sucesso) {
    relatorio.erros = (estrutura.erros || []).slice();
    return relatorio;
  }
  limparMemoEstrutura_();

  // ── As 5 abas oficiais têm de estar todas lá e válidas ──
  const planilha = getSpreadsheet();
  const invalidas = pgo5TodasAsAbas_().filter(function(nome) {
    const aba = planilha.getSheetByName(nome);
    return !aba || !pgo5ValidarCabecalho_(aba, pgo5Colunas_(nome)).valido;
  });
  if (invalidas.length > 0) {
    relatorio.erros.push('Abas do PGO 5.0 ausentes ou divergentes: ' + invalidas.join(', ') +
      '. Nenhum usuário foi criado.');
    return relatorio;
  }

  // ── Seeds existentes: catálogo estrutural + cargos/níveis ──
  relatorio.seed = pgo5AplicarSeedEstrutural_();
  relatorio.seedAcesso = aplicarSeedPermissoesPGO5_();

  // ── Cargo e Nível vêm da CHAVE, nunca do nome ──
  // O nome é livre e pode ser traduzido ou renomeado pelo ADM; a Chave é a
  // identidade estável do registro (ver aplicarSeedPermissoesPGO5_).
  const acessos = lerCargosENiveis_();
  const porChave = function(lista, chave) {
    const item = lista.find(function(registro) { return registro.chave === chave; });
    return item ? String(item.id) : '';
  };
  relatorio.cargoId = porChave(listarCargos_(acessos), PGO5_CHAVE_CARGO_INICIAL);
  relatorio.nivelAcessoId = porChave(listarNiveisAcesso_(acessos), PGO5_CHAVE_NIVEL_INICIAL);

  if (!relatorio.cargoId || !relatorio.nivelAcessoId) {
    relatorio.erros.push('O seed de cargos e níveis não produziu as chaves ' +
      PGO5_CHAVE_CARGO_INICIAL + ' e ' + PGO5_CHAVE_NIVEL_INICIAL +
      '. Nenhum usuário foi criado.');
    return relatorio;
  }

  // ── O administrador inicial, sob trava ──
  // A trava cobre a reconferência + a inserção: sem ela, duas execuções
  // simultâneas passariam as duas pelo teste de "base vazia" e criariam dois
  // administradores.
  const criado = withScriptLock_(function() {
    if (pgo5PossuiUsuarios_()) return null;
    return pgo5Inserir(PGO5.SHEET_NAMES.USUARIOS, {
      Nome: PGO5_NOME_ADMINISTRADOR_INICIAL,
      Email: emailDoDono,
      CargoId: relatorio.cargoId,
      NivelAcessoId: relatorio.nivelAcessoId,
      SupervisorId: '',            // hierarquia é montada depois, na tela
      Equipe: '',
      Ativo: true,
      DataCadastro: toIso_(new Date())
    });
  });

  if (!criado) {
    throw new Error('PGO5: outro processo criou o primeiro usuário durante esta preparação. ' +
      'Nada foi alterado — confira Configurações › Usuários.');
  }

  relatorio.administradorInicialId = String(criado.Id || '');
  relatorio.sucesso = true;

  // LGPD: só o Id técnico. O e-mail do administrador NÃO entra no log, na
  // auditoria nem no retorno — a mesma regra de promoteFirstAdmin_ no 4.x.
  Logger.log('[PGO5] Preparação da instalação concluída. Administrador inicial (Id): ' +
    relatorio.administradorInicialId);

  return relatorio;
}

// ============================================================================
// FUNÇÕES PÚBLICAS DA TELA (Configurações › Tombamento)
// ============================================================================

/**
 * (Permissão: configurarSistema) Estado do tombamento para a tela montar.
 *
 * ⚠️ NÃO devolve o Id nem a URL da fonte — apenas se existe fonte
 * configurada. É a mesma regra de obterEstadoMigracaoPGO5, ampliada com o
 * que a tela precisa para decidir qual etapa mostrar.
 *
 * O pré-check do destino só é executado quando o tombamento AINDA não foi
 * concluído: depois da conclusão o destino está legitimamente cheio, e
 * mostrar "destino não está limpo" assustaria sem motivo.
 *
 * @returns {Object} Estado completo da tela, sem dado operacional.
 * @throws {Error} Quando o usuário não tem permissão.
 */
function obterEstadoTombamentoPGO5() {
  const ator = exigirPermissao_('configurarSistema');
  const props = PropertiesService.getScriptProperties();
  const concluida = migracaoJaFoiConcluida_();

  const estado = {
    concluida: concluida,
    concluidaEm: String(props.getProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA) || ''),
    fonteConfigurada: !!pgo5IdDaFonteConfigurada_(),
    abasObrigatorias: pgo5AbasObrigatoriasDaFonte_(),
    abaOpcional: PGO5_ABAS_LEGADAS.INDICADORES_SLA,
    abasNaoImportadas: pgo5AbasNaoImportadas_(),
    // Estado do PIN: a tela precisa saber se deve orientar a definir o PIN
    // (Configurações › Segurança) ou apenas pedi-lo.
    pinDefinido: existePinDefinido_(),
    pinLiberado: sessaoProtegidaEstaValida_(String(ator.id)),
    digitosDoPin: PGO5_PIN_DIGITOS,
    destino: null
  };

  if (!concluida) {
    try {
      const destino = pgo5PreCheckDestinoTombamento_();
      estado.destino = {
        ok: destino.ok,
        bloqueios: destino.bloqueios,
        avisos: destino.avisos,
        contagens: destino.contagens
      };
    } catch (erro) {
      // Um destino sem estrutura faz pgo5Ler lançar. Isso é informação útil
      // para a tela, não um motivo para a página inteira falhar.
      estado.destino = {
        ok: false,
        bloqueios: [pgo5SanitizarTextoTombamento_(erro.message)],
        avisos: [],
        contagens: null
      };
    }
  }

  return estado;
}

/**
 * (Permissão: configurarSistema + PIN) Valida a planilha informada e, dando
 * certo, guarda o Id dela como fonte do tombamento.
 *
 * VALIDAR E GRAVAR SÃO O MESMO PASSO, de propósito: gravar primeiro e validar
 * depois deixaria uma fonte inválida configurada, e a tela seguinte mostraria
 * "fonte configurada" para algo que não serve.
 *
 * ⚠️ O QUE ENTRA E O QUE SAI
 *   entra → o link ou o Id, uma única vez, digitado pelo Administrador;
 *   sai   → apenas contagens agregadas e a lista de abas encontradas.
 * O Id vai para Script Properties e não volta ao navegador em nenhuma
 * resposta, nem aparece em mensagem de erro, Logger ou auditoria.
 *
 * @param {string} linkOuId URL do Google Sheets ou Id puro da CÓPIA antiga.
 * @returns {Object} { success, temSla, contagens, abasNaoImportadas }.
 * @throws {Error} Sem permissão, sem PIN liberado ou fonte inválida.
 */
function configurarFonteTombamentoPGO5(linkOuId) {
  const ator = exigirPermissaoComPin_('configurarSistema');

  if (migracaoJaFoiConcluida_()) {
    throw new Error('O tombamento já foi concluído nesta instalação. ' +
      'Não é possível configurar uma nova fonte.');
  }

  const id = pgo5ExtrairIdDePlanilha_(linkOuId);
  if (!id) {
    throw new Error('Não reconheci um link ou Id de planilha. Cole a URL completa da cópia ' +
      'da planilha antiga, ou apenas o Id que aparece nela.');
  }

  const validacao = pgo5ValidarFonteLegada_(id);
  if (!validacao.ok) throw new Error(validacao.motivo);

  PropertiesService.getScriptProperties().setProperty(PGO5_CHAVE_FONTE_LEGADA, id);

  // Auditoria: registra QUE a fonte foi configurada, com as contagens que a
  // validação apurou. Nunca o Id, nunca a URL, nunca o nome da planilha —
  // limparDadoSensivel_ ainda removeria as chaves proibidas, mas a decisão
  // de não montá-las é aqui.
  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY,
    PGO5_ENTIDADES_AUDITORIA.SEGURANCA, '',
    'Fonte do tombamento configurada e validada.',
    {
      atendimentosNaOrigem: validacao.contagens.reclameAqui + validacao.contagens.sacPreventivo,
      usuariosNaOrigem: validacao.contagens.usuarios,
      temIndicadoresSla: validacao.temSla
    }, String(ator.id));

  return {
    success: true,
    temSla: validacao.temSla,
    contagens: validacao.contagens,
    abasNaoImportadas: pgo5AbasNaoImportadas_()
  };
}

/**
 * (Permissão: configurarSistema) Relê a fonte JÁ configurada e devolve as
 * contagens atualizadas.
 *
 * Serve para o Administrador reabrir a tela e conferir o resumo sem redigitar
 * o link — e para revalidar depois de mexer na cópia antiga. Não exige PIN
 * porque não configura nada: só lê o que já está configurado e devolve
 * números. Trocar a fonte, isso sim, exige PIN.
 *
 * @returns {Object} { success, temSla, contagens, abasNaoImportadas }.
 * @throws {Error} Sem permissão, sem fonte configurada ou fonte inválida.
 */
function revalidarFonteTombamentoPGO5() {
  exigirPermissao_('configurarSistema');

  const id = pgo5IdDaFonteConfigurada_();
  if (!id) {
    throw new Error('Nenhuma fonte configurada. Informe o link da cópia da planilha antiga ' +
      'na etapa 1.');
  }

  const validacao = pgo5ValidarFonteLegada_(id);
  if (!validacao.ok) throw new Error(validacao.motivo);

  return {
    success: true,
    temSla: validacao.temSla,
    contagens: validacao.contagens,
    abasNaoImportadas: pgo5AbasNaoImportadas_()
  };
}

/**
 * (Permissão: configurarSistema + PIN) Executa o tombamento.
 *
 * ⚠️ ESTA É A OPERAÇÃO IRREVERSÍVEL. Tudo antes dela é conferência.
 *
 * O QUE ESTA FUNÇÃO FAZ — e o que ela DELEGA
 * Ela é um invólucro. As cinco conferências abaixo são dela; a migração em si
 * é inteiramente de executarMigracaoPGO5():
 *
 *   1. permissão 'configurarSistema' e PIN administrativo liberado;
 *   2. fonte configurada;
 *   3. fonte revalidada AGORA (a cópia pode ter mudado desde a etapa 2);
 *   4. pré-check do destino;
 *   5. executarMigracaoPGO5()  ← o motor, sem nenhuma duplicação de regra.
 *
 * DEPOIS DO SUCESSO
 * O marcador de conclusão é do motor e permanece. O Id da fonte é APAGADO:
 * terminado o tombamento ele não serve para mais nada, e um Id de planilha
 * guardado sem necessidade é só superfície de exposição.
 *
 * DEPOIS DE UMA FALHA
 * Nada é limpo automaticamente e nada é tentado de novo. O marcador continua
 * ausente, o Id da fonte continua guardado (para não obrigar a redigitar) e o
 * relatório diz onde parou. A correção é reconstruir o destino a partir de
 * uma base limpa — "continuar de onde parou" duplicaria o que já entrou.
 *
 * @returns {Object} Relatório agregado e sanitizado + orientação.
 * @throws {Error} Sem permissão, sem PIN, sem fonte ou destino não limpo.
 */
function executarTombamentoSeguroPGO5() {
  const ator = exigirPermissaoComPin_('configurarSistema');

  // ── 2. Fonte configurada ──
  const id = pgo5IdDaFonteConfigurada_();
  if (!id) {
    throw new Error('Nenhuma fonte configurada. Informe o link da cópia da planilha antiga ' +
      'antes de executar o tombamento.');
  }

  // ── 3. Revalidação da fonte ──
  const validacao = pgo5ValidarFonteLegada_(id);
  if (!validacao.ok) throw new Error(validacao.motivo);

  // ── 4. Pré-check do destino ──
  const destino = pgo5PreCheckDestinoTombamento_();
  if (!destino.ok) {
    throw new Error('O destino não está limpo para um novo tombamento. Não execute novamente ' +
      'sobre uma migração parcial. ' + destino.bloqueios.join(' '));
  }

  // ── 5. O motor. Nenhuma regra de migração é reimplementada aqui. ──
  const bruto = executarMigracaoPGO5();
  const relatorio = pgo5SanitizarRelatorioTombamento_(bruto);

  if (relatorio.sucesso) {
    // Terminado o tombamento, o Id da fonte não tem mais função.
    PropertiesService.getScriptProperties().deleteProperty(PGO5_CHAVE_FONTE_LEGADA);

    registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY,
      PGO5_ENTIDADES_AUDITORIA.SEGURANCA, '',
      'Tombamento executado pela interface e concluído.',
      {
        atendimentos: relatorio.reclameAqui.migrados + relatorio.sacPreventivo.migrados,
        usuarios: relatorio.usuarios.migrados,
        valoresDinamicos: relatorio.valoresDinamicos.migrados,
        referenciasNaoResolvidas: relatorio.referenciasNaoResolvidas
      }, String(ator.id));

    relatorio.orientacao = 'Tombamento concluído. Monte a hierarquia dos usuários em ' +
      'Configurações › Usuários: todos foram migrados sem supervisor, de propósito.';
    return relatorio;
  }

  // Falha ou resultado parcial: o marcador de conclusão NÃO foi gravado pelo
  // motor, então o sistema continua sabendo que o tombamento não terminou.
  registrarAuditoria_(PGO5_ACOES_AUDITORIA.ALTER_SECURITY,
    PGO5_ENTIDADES_AUDITORIA.SEGURANCA, '',
    'Tombamento executado pela interface e NÃO concluído.',
    {
      atendimentosGravados: relatorio.reclameAqui.migrados + relatorio.sacPreventivo.migrados,
      errosDistintos: relatorio.erros.distintos.length
    }, String(ator.id));

  relatorio.orientacao = 'O tombamento NÃO foi concluído e o destino pode ter ficado ' +
    'parcialmente preenchido. Não execute de novo sobre esta base: reconstrua o destino a ' +
    'partir de uma planilha limpa (nova instalação do PGO 5.0) antes de qualquer nova ' +
    'tentativa. A cópia da planilha antiga não foi alterada.';
  return relatorio;
}

// ============================================================================
// ============================================================================
// TESTES
// ============================================================================
// ============================================================================
/*
 * DOIS PONTOS DE ENTRADA, COM RISCOS BEM DIFERENTES
 *
 *   verificarIntegridadeBuildPGO5()  🟢 SÓ LÊ. Pode rodar em produção, a
 *                                       qualquer momento, quantas vezes
 *                                       quiser. É o teste de integridade do
 *                                       build: confere que as funções e as
 *                                       constantes esperadas existem e que
 *                                       as regras puras se comportam.
 *
 *   homologarTombamentoPGO5()        ⚠️ ESCREVE. Faz um tombamento sintético
 *                                       de ponta a ponta e por isso SÓ roda
 *                                       numa base de homologação vazia, pelo
 *                                       dono do projeto. Recusa qualquer base
 *                                       que já tenha dados.
 *
 * ⚠️ TODOS OS DADOS DOS TESTES SÃO SINTÉTICOS. Nenhum nome, e-mail, CPF,
 * protocolo, cliente ou Id de planilha real aparece aqui — e nada nestes
 * testes lê a planilha de produção.
 */

/** Acumulador de asserções dos testes. */
function pgo5NovoResultadoDeTeste_() {
  return { total: 0, ok: 0, falhas: [], linhas: [] };
}

/**
 * Registra uma asserção.
 * @param {Object} r Acumulador de pgo5NovoResultadoDeTeste_.
 * @param {string} nome O que estava sendo verificado.
 * @param {boolean} passou Resultado.
 * @param {string} [detalhe] Explicação da falha (sem dado pessoal).
 * @returns {boolean} O próprio `passou`, para encadear.
 */
function pgo5Afirmar_(r, nome, passou, detalhe) {
  r.total++;
  if (passou) {
    r.ok++;
    r.linhas.push('✅ ' + nome);
  } else {
    const texto = nome + (detalhe ? ' — ' + detalhe : '');
    r.falhas.push(texto);
    r.linhas.push('❌ ' + texto);
  }
  return passou;
}

/**
 * Registra uma asserção que espera um erro.
 *
 * Muitos requisitos do tombamento são do tipo "isto tem de ser RECUSADO".
 * Testar recusa exige capturar a exceção — e conferir que ela aconteceu.
 *
 * @param {Object} r Acumulador.
 * @param {string} nome O que deveria ser recusado.
 * @param {Function} acao Trecho que deve lançar.
 * @returns {void}
 */
function pgo5AfirmarRecusa_(r, nome, acao) {
  let lancou = false;
  try {
    acao();
  } catch (erro) {
    lancou = true;
  }
  pgo5Afirmar_(r, nome, lancou, 'a operação foi aceita quando deveria ter sido recusada');
}

/**
 * (SEGURO — SÓ LÊ) Teste de integridade do build do PGO 5.0.
 *
 * O QUE ISTO PEGA QUE UM TESTE FUNCIONAL NÃO PEGA
 * No Apps Script todos os .gs compartilham o mesmo escopo global, e o deploy
 * é arquivo por arquivo. Enviar Pgo5Tombamento.gs sem enviar Pgo5.gs, ou
 * renomear uma função em um arquivo e esquecer o outro, produz um sistema que
 * abre normalmente e só quebra na hora do tombamento — o pior momento
 * possível. Esta função confere o contrato entre os arquivos ANTES disso.
 *
 * @returns {string} Relatório em texto (também gravado no Logger).
 */
function verificarIntegridadeBuildPGO5() {
  const r = pgo5NovoResultadoDeTeste_();
  r.linhas.push('PGO 5.0 — INTEGRIDADE DO BUILD (tombamento)');
  r.linhas.push('(relatório técnico, sem dados pessoais)');
  r.linhas.push('');

  // ── CRUD da fundação: o contrato exigido pelo checkpoint ──
  //
  // A conferência é escrita função por função, sem eval nem lookup dinâmico:
  // referenciar o identificador de verdade é o que faz o teste falhar quando
  // o nome muda. Um `global['pgo5Ler']` continuaria "passando" com a função
  // renomeada, porque a busca por string não é verificada pelo motor JS.
  r.linhas.push('CRUD DA FUNDAÇÃO (Pgo5.gs)');
  const presente = function(nome, referencia) {
    pgo5Afirmar_(r, 'função ' + nome + ' presente', typeof referencia === 'function',
      'não encontrada no escopo global — o arquivo .gs correspondente não foi enviado?');
  };
  presente('pgo5Ler', typeof pgo5Ler === 'undefined' ? null : pgo5Ler);
  presente('pgo5ObterPorId', typeof pgo5ObterPorId === 'undefined' ? null : pgo5ObterPorId);
  presente('pgo5Inserir', typeof pgo5Inserir === 'undefined' ? null : pgo5Inserir);
  presente('pgo5AtualizarPorId',
    typeof pgo5AtualizarPorId === 'undefined' ? null : pgo5AtualizarPorId);
  presente('pgo5ExcluirPorId', typeof pgo5ExcluirPorId === 'undefined' ? null : pgo5ExcluirPorId);

  // ── Motor de migração: este arquivo depende dele e não o substitui ──
  r.linhas.push('');
  r.linhas.push('MOTOR DE MIGRAÇÃO (Pgo5Migracao.gs)');
  presente('executarMigracaoPGO5',
    typeof executarMigracaoPGO5 === 'undefined' ? null : executarMigracaoPGO5);
  presente('lerFonteLegada_', typeof lerFonteLegada_ === 'undefined' ? null : lerFonteLegada_);
  presente('lerAbaLegada_', typeof lerAbaLegada_ === 'undefined' ? null : lerAbaLegada_);
  presente('migracaoJaFoiConcluida_',
    typeof migracaoJaFoiConcluida_ === 'undefined' ? null : migracaoJaFoiConcluida_);
  presente('migrarUsuarios_', typeof migrarUsuarios_ === 'undefined' ? null : migrarUsuarios_);
  presente('migrarCatalogo_', typeof migrarCatalogo_ === 'undefined' ? null : migrarCatalogo_);
  pgo5Afirmar_(r, 'chave da fonte é a mesma do motor',
    PGO5_CHAVE_FONTE_LEGADA === 'PGO5_MIGRACAO_FONTE_ID',
    'este arquivo e o motor têm de ler a MESMA Script Property');
  pgo5Afirmar_(r, 'chave de conclusão é a mesma do motor',
    PGO5_CHAVE_MIGRACAO_CONCLUIDA === 'PGO5_MIGRACAO_CONCLUIDA');

  // ── Permissões e PIN: as duas chaves da execução ──
  r.linhas.push('');
  r.linhas.push('PERMISSÃO E PIN');
  presente('exigirPermissao_', typeof exigirPermissao_ === 'undefined' ? null : exigirPermissao_);
  presente('exigirPermissaoComPin_',
    typeof exigirPermissaoComPin_ === 'undefined' ? null : exigirPermissaoComPin_);
  presente('existePinDefinido_',
    typeof existePinDefinido_ === 'undefined' ? null : existePinDefinido_);
  presente('sessaoProtegidaEstaValida_',
    typeof sessaoProtegidaEstaValida_ === 'undefined' ? null : sessaoProtegidaEstaValida_);
  presente('validarPinPGO5', typeof validarPinPGO5 === 'undefined' ? null : validarPinPGO5);
  pgo5Afirmar_(r, "'configurarSistema' é uma permissão reconhecida",
    permissaoExiste_('configurarSistema'),
    'sem ela exigirPermissao_ recusaria todo mundo (fail closed)');
  pgo5Afirmar_(r, 'o nível ADMINISTRADOR inicial tem configurarSistema',
    niveisAcessoIniciais_().some(function(nivel) {
      return nivel.chave === PGO5_CHAVE_NIVEL_INICIAL &&
        nivel.permissoes.indexOf('configurarSistema') !== -1;
    }),
    'o administrador inicial não conseguiria executar o tombamento');
  pgo5Afirmar_(r, 'o cargo ' + PGO5_CHAVE_CARGO_INICIAL + ' existe no seed',
    cargosIniciais_().some(function(cargo) { return cargo.chave === PGO5_CHAVE_CARGO_INICIAL; }));

  // ── Schema: 5 abas, nem mais nem menos ──
  r.linhas.push('');
  r.linhas.push('SCHEMA ' + PGO5.SCHEMA_VERSION);
  pgo5Afirmar_(r, 'o schema tem exatamente 5 abas', pgo5TodasAsAbas_().length === 5,
    'encontrado: ' + pgo5TodasAsAbas_().length);
  pgo5Afirmar_(r, 'toda aba oficial tem cabeçalho mapeado',
    pgo5TodasAsAbas_().every(function(nome) { return pgo5Colunas_(nome).length > 0; }));
  pgo5Afirmar_(r, 'Atendimentos mantém Cliente e CPF estruturais',
    pgo5Colunas_(PGO5.SHEET_NAMES.ATENDIMENTOS).indexOf('Cliente') !== -1 &&
    pgo5Colunas_(PGO5.SHEET_NAMES.ATENDIMENTOS).indexOf('CPF') !== -1);

  // ── Abas exigidas da fonte ──
  r.linhas.push('');
  r.linhas.push('ABAS DA FONTE');
  pgo5Afirmar_(r, 'são 8 abas obrigatórias', pgo5AbasObrigatoriasDaFonte_().length === 8,
    'encontrado: ' + pgo5AbasObrigatoriasDaFonte_().length);
  pgo5Afirmar_(r, 'IndicadoresSLA não é obrigatória',
    pgo5AbasObrigatoriasDaFonte_().indexOf(PGO5_ABAS_LEGADAS.INDICADORES_SLA) === -1);
  pgo5Afirmar_(r, 'toda aba obrigatória é lida pelo motor',
    pgo5AbasObrigatoriasDaFonte_().every(function(nome) {
      return Object.keys(PGO5_ABAS_LEGADAS).some(function(chave) {
        return PGO5_ABAS_LEGADAS[chave] === nome;
      });
    }),
    'há aba exigida que o motor não lê');
  pgo5Afirmar_(r, 'Timeline e Histórico não são importados',
    pgo5AbasNaoImportadas_().length === 2 &&
    pgo5AbasObrigatoriasDaFonte_().indexOf(CONFIG.SHEET_NAMES.TIMELINE) === -1 &&
    pgo5AbasObrigatoriasDaFonte_().indexOf(CONFIG.SHEET_NAMES.HISTORICO) === -1);

  // ── Extração de link/Id (dados sintéticos) ──
  r.linhas.push('');
  r.linhas.push('LINK OU ID DA FONTE');
  const idFalso = 'aBcDeF1234567890_-abcdefghijKLMNOPqrst';
  pgo5Afirmar_(r, 'extrai o Id de uma URL com /edit',
    pgo5ExtrairIdDePlanilha_('https://docs.google.com/spreadsheets/d/' + idFalso +
      '/edit#gid=0') === idFalso);
  pgo5Afirmar_(r, 'extrai o Id de uma URL sem sufixo',
    pgo5ExtrairIdDePlanilha_('https://docs.google.com/spreadsheets/d/' + idFalso) === idFalso);
  pgo5Afirmar_(r, 'aceita o Id puro', pgo5ExtrairIdDePlanilha_(idFalso) === idFalso);
  pgo5Afirmar_(r, 'ignora espaços em volta',
    pgo5ExtrairIdDePlanilha_('   ' + idFalso + '   ') === idFalso);
  pgo5Afirmar_(r, 'recusa texto que não é Id',
    pgo5ExtrairIdDePlanilha_('planilha antiga do RA') === '');
  pgo5Afirmar_(r, 'recusa campo vazio', pgo5ExtrairIdDePlanilha_('') === '');
  pgo5Afirmar_(r, 'recusa Id curto demais', pgo5ExtrairIdDePlanilha_('abc123') === '');

  // ── Recusa da fonte inválida e de fonte = destino ──
  r.linhas.push('');
  r.linhas.push('RECUSAS DA VALIDAÇÃO DE FONTE');
  pgo5Afirmar_(r, 'fonte vazia é recusada', pgo5ValidarFonteLegada_('').ok === false);
  let idDoDestino = '';
  try { idDoDestino = String(getSpreadsheet().getId() || ''); } catch (e) { idDoDestino = ''; }
  if (idDoDestino) {
    const mesma = pgo5ValidarFonteLegada_(idDoDestino);
    pgo5Afirmar_(r, 'fonte igual ao destino é recusada', mesma.ok === false);
    pgo5Afirmar_(r, 'a recusa de fonte=destino não repete o Id',
      mesma.motivo.indexOf(idDoDestino) === -1,
      'a mensagem devolveu o Id da planilha');
  } else {
    r.linhas.push('⚠️ destino inacessível: checagem fonte=destino não executada');
  }

  // ── Sanitização: a barreira do que chega ao navegador ──
  r.linhas.push('');
  r.linhas.push('SANITIZAÇÃO DO RELATÓRIO');
  const comUrl = pgo5SanitizarTextoTombamento_(
    'Falha ao abrir https://docs.google.com/spreadsheets/d/' + idFalso + '/edit');
  pgo5Afirmar_(r, 'URL é removida', comUrl.indexOf('docs.google.com') === -1);
  pgo5Afirmar_(r, 'Id dentro da URL é removido', comUrl.indexOf(idFalso) === -1);
  pgo5Afirmar_(r, 'Id solto é removido',
    pgo5SanitizarTextoTombamento_('arquivo ' + idFalso + ' inacessível').indexOf(idFalso) === -1);
  pgo5Afirmar_(r, 'e-mail é removido',
    pgo5SanitizarTextoTombamento_('usuario.teste@exemplo.invalido não encontrado')
      .indexOf('@exemplo.invalido') === -1);
  pgo5Afirmar_(r, 'CPF formatado é removido',
    pgo5SanitizarTextoTombamento_('CPF 000.000.000-00 inválido').indexOf('000.000.000-00') === -1);
  pgo5Afirmar_(r, 'sequência longa de dígitos é removida',
    pgo5SanitizarTextoTombamento_('protocolo 00000000000000 duplicado')
      .indexOf('00000000000000') === -1);
  pgo5Afirmar_(r, 'texto genérico é preservado',
    pgo5SanitizarTextoTombamento_('Categoria sem Produto correspondente.')
      === 'Categoria sem Produto correspondente.');
  pgo5Afirmar_(r, 'texto é limitado a 200 caracteres',
    pgo5SanitizarTextoTombamento_(new Array(400).join('a b ')).length <= 200);

  const resumo = pgo5ResumirMensagensTombamento_([
    'Atendimento sem canal correspondente.',
    'Atendimento sem canal correspondente.',
    'Atendimento sem canal correspondente.'
  ]);
  pgo5Afirmar_(r, 'mensagens repetidas viram um item', resumo.distintos.length === 1);
  pgo5Afirmar_(r, 'o total de mensagens é preservado', resumo.total === 3);

  // ── O relatório agregado não deixa passar nada além do previsto ──
  const agregado = pgo5SanitizarRelatorioTombamento_({
    sucesso: true,
    reclameAqui: { encontrados: 2, migrados: 2 },
    referenciasNaoResolvidas: ['a', 'b', 'c'],
    avisos: [], erros: [],
    // Campos que NÃO devem vazar, simulando um motor que passou a devolvê-los:
    cpfDoCliente: '000.000.000-00',
    nomeDaPlanilha: 'Base real',
    fonteId: idFalso
  });
  pgo5Afirmar_(r, 'referências não resolvidas saem só como quantidade',
    agregado.referenciasNaoResolvidas === 3);
  pgo5Afirmar_(r, 'campo desconhecido do motor não é repassado',
    agregado.cpfDoCliente === undefined && agregado.nomeDaPlanilha === undefined &&
    agregado.fonteId === undefined,
    'a cópia do relatório precisa ser campo a campo, nunca em bloco');
  pgo5Afirmar_(r, 'as contagens conhecidas são repassadas',
    agregado.reclameAqui.migrados === 2 && agregado.sucesso === true);

  // ── O que a tela recebe do estado ──
  r.linhas.push('');
  r.linhas.push('EXPOSIÇÃO PARA A INTERFACE');
  pgo5Afirmar_(r, 'obterEstadoTombamentoPGO5 existe',
    typeof obterEstadoTombamentoPGO5 === 'function');
  pgo5Afirmar_(r, 'configurarFonteTombamentoPGO5 existe',
    typeof configurarFonteTombamentoPGO5 === 'function');
  pgo5Afirmar_(r, 'revalidarFonteTombamentoPGO5 existe',
    typeof revalidarFonteTombamentoPGO5 === 'function');
  pgo5Afirmar_(r, 'executarTombamentoSeguroPGO5 existe',
    typeof executarTombamentoSeguroPGO5 === 'function');
  pgo5Afirmar_(r, 'prepararInstalacaoPGO5 existe',
    typeof prepararInstalacaoPGO5 === 'function');
  pgo5Afirmar_(r, 'pgo5IdDaFonteConfigurada_ é interna (não chamável pelo front)',
    'pgo5IdDaFonteConfigurada_'.slice(-1) === '_');

  // ── Recorte por escopo: o custo não pode voltar a crescer com a base ──
  //
  // POR QUE ESTE TESTE EXISTE
  // Resolver o escopo custa DUAS varreduras completas de planilha (Usuários e
  // Configurações). Enquanto pgo5FiltrarAtendimentosPorEscopo_ resolver o
  // escopo uma única vez e repassá-lo, o custo é constante. Se alguém remover
  // esse repasse, cada atendimento volta a custar duas leituras e o Dashboard
  // deixa de carregar — só para quem NÃO é administrador, porque o escopo
  // TODOS sai antes do laço. É uma regressão que passa despercebida numa base
  // pequena e derruba a produção numa base grande.
  //
  // As chamadas abaixo são PURAS: com o escopo já resolvido, a função não
  // pode precisar da planilha para responder.
  r.linhas.push('');
  r.linhas.push('RECORTE POR ESCOPO (custo constante)');
  const atorFalso = { id: '00000001' };
  const deOutro = { ResponsavelId: '000000FF', CriadoPorId: '000000FF' };
  const meuRegistro = { ResponsavelId: '00000001', CriadoPorId: '00000001' };

  pgo5Afirmar_(r, 'o escopo pré-resolvido é honrado (TODOS libera)',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, deOutro, 'ver', [], 'TODOS') === true,
    'o 5º parâmetro foi ignorado — o escopo está sendo recalculado por registro');
  pgo5Afirmar_(r, 'o escopo pré-resolvido é honrado (NENHUM bloqueia)',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, meuRegistro, 'ver', [], 'NENHUM') === false);
  pgo5Afirmar_(r, 'PROPRIOS libera o próprio registro',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, meuRegistro, 'ver', [], 'PROPRIOS') === true);
  pgo5Afirmar_(r, 'PROPRIOS bloqueia o registro de terceiro',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, deOutro, 'ver', [], 'PROPRIOS') === false);
  pgo5Afirmar_(r, 'EQUIPE libera quem está na árvore recebida',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, deOutro, 'ver', ['000000FF'], 'EQUIPE') === true);
  pgo5Afirmar_(r, 'EQUIPE bloqueia quem está fora da árvore recebida',
    pgo5AtendimentoEstaNoEscopo_(atorFalso, deOutro, 'ver', ['000000AA'], 'EQUIPE') === false);

  // ── IDs hexadecimais: o tombamento não pode mudar o formato ──
  r.linhas.push('');
  r.linhas.push('IDs DO PGO 5.0');
  pgo5Afirmar_(r, 'Id é hexadecimal de 8 caracteres em caixa alta',
    formatarIdHex_(1) === '00000001' && formatarIdHex_(255) === '000000FF' &&
    formatarIdHex_(16) === '00000010');
  pgo5Afirmar_(r, 'Id de 8 caracteres é aceito na leitura', ehIdHexValido_('0000000A') === true);
  pgo5Afirmar_(r, 'Id de tamanho errado é recusado', ehIdHexValido_('000000A') === false);

  // ── Fechamento ──
  r.linhas.push('');
  r.linhas.push('VERIFICAÇÕES: ' + r.total + ' | APROVADAS: ' + r.ok +
    ' | FALHAS: ' + r.falhas.length);
  r.linhas.push(r.falhas.length === 0
    ? 'RESULTADO GERAL: ✅ APROVADO'
    : 'RESULTADO GERAL: ❌ REPROVADO');

  const texto = r.linhas.join('\n');
  Logger.log(texto);
  return texto;
}

// ============================================================================
// HOMOLOGAÇÃO COM FONTE SINTÉTICA
// ============================================================================

/**
 * Cabeçalhos e linhas 100% SINTÉTICOS da planilha de origem de teste.
 *
 * ⚠️ Nada aqui é dado real: os nomes são "Cliente Teste N", os e-mails usam o
 * domínio reservado ".invalido" (RFC 6761 — nunca resolve), os CPFs são
 * sequências óbvias e os protocolos são numerados. Nenhuma informação da
 * operação, de cliente ou da Porto aparece neste arquivo.
 *
 * @returns {Object} { abas: [{ nome, cabecalho, linhas }] }.
 */
function pgo5FonteSinteticaDeTeste_() {
  const atendimento = function(n, protocolo) {
    return [
      '2024-01-' + ('0' + ((n % 28) + 1)).slice(-2),   // DataAbertura
      protocolo,                                       // NumeroRA
      'Cliente Teste ' + n,                            // Cliente
      '000.000.000-0' + (n % 10),                      // CPF
      'Reclame Aqui',                                  // Canal
      'Produto Teste A',                               // Produto
      'Categoria Teste A1',                            // Categoria
      'Subcategoria Teste A1a',                        // Subcategoria
      'Pendente',                                      // Status
      'Área',                                          // MotivoPendencia
      'Analista Teste',                                // Responsavel
      'Observação sintética ' + n,                     // Observacoes
      JSON.stringify({ resumoCaso: 'Resumo sintético ' + n })  // CamposExtras
    ];
  };

  const colunasAtendimento = ['DataAbertura', 'NumeroRA', 'Cliente', 'CPF', 'Canal',
    'Produto', 'Categoria', 'Subcategoria', 'Status', 'MotivoPendencia', 'Responsavel',
    'Observacoes', 'CamposExtras'];

  return {
    abas: [
      {
        nome: PGO5_ABAS_LEGADAS.RECLAME_AQUI,
        cabecalho: colunasAtendimento,
        linhas: [atendimento(1, '000101'), atendimento(2, '000102'), atendimento(3, '000103')]
      },
      {
        nome: PGO5_ABAS_LEGADAS.SAC_PREVENTIVO,
        cabecalho: colunasAtendimento,
        linhas: [atendimento(4, '000204'), atendimento(5, '000205')]
      },
      {
        nome: PGO5_ABAS_LEGADAS.USUARIOS,
        cabecalho: ['Id', 'Nome', 'Email', 'Perfil', 'Equipe', 'Ativo'],
        linhas: [
          ['U1', 'Analista Teste', 'analista.teste@exemplo.invalido', 'Analista', 'Equipe A', true],
          ['U2', 'Supervisor Teste', 'supervisor.teste@exemplo.invalido', 'Supervisor', 'Equipe A', true],
          ['U3', 'Perfil Desconhecido Teste', 'outro.teste@exemplo.invalido', 'Coordenador', '', true]
        ]
      },
      {
        nome: PGO5_ABAS_LEGADAS.CANAIS,
        cabecalho: ['Id', 'Nome', 'Ativo'],
        linhas: [['C1', 'Reclame Aqui', true], ['C2', 'SAC Preventivo', true]]
      },
      {
        nome: PGO5_ABAS_LEGADAS.PRODUTOS,
        cabecalho: ['Id', 'Nome', 'Ativo'],
        linhas: [['P1', 'Produto Teste A', true], ['P2', 'Produto Teste B', true]]
      },
      {
        nome: PGO5_ABAS_LEGADAS.CATEGORIAS,
        cabecalho: ['Id', 'Nome', 'ProdutoId', 'Ativo'],
        linhas: [['G1', 'Categoria Teste A1', 'P1', true], ['G2', 'Categoria Teste B1', 'P2', true]]
      },
      {
        nome: PGO5_ABAS_LEGADAS.SUBCATEGORIAS,
        cabecalho: ['Id', 'Nome', 'CategoriaId', 'Ativo'],
        linhas: [['S1', 'Subcategoria Teste A1a', 'G1', true]]
      },
      {
        nome: PGO5_ABAS_LEGADAS.CONFIG_CAMPOS,
        cabecalho: ['Id', 'Campo', 'Rotulo', 'Tipo', 'Obrigatorio', 'Ativo', 'Ordem'],
        linhas: [
          ['F1', 'cliente', 'Cliente', 'text', true, true, 1],
          ['F2', 'cpf', 'CPF', 'cpf', true, true, 2],
          ['F3', 'resumoCaso', 'Resumo do caso', 'textarea', false, true, 3]
        ]
      },
      {
        nome: PGO5_ABAS_LEGADAS.INDICADORES_SLA,
        cabecalho: ['Data', 'ForaSLA'],
        linhas: [['2024-01-01', 2], ['2024-01-02', 5]]
      }
    ]
  };
}

/**
 * Cria a planilha SINTÉTICA de origem para a homologação.
 *
 * ⚠️ Cria um arquivo novo no Drive de quem executa. É descartável: o nome traz
 * a data/hora e a orientação é excluí-lo depois da homologação. Não toca em
 * nenhuma planilha existente.
 *
 * @returns {Spreadsheet} A planilha sintética recém-criada.
 */
function pgo5CriarFonteSinteticaDeTeste_() {
  const marca = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const planilha = SpreadsheetApp.create('PGO5 HOMOLOGACAO SINTETICA ' + marca);

  pgo5FonteSinteticaDeTeste_().abas.forEach(function(aba) {
    const folha = planilha.insertSheet(aba.nome);
    folha.getRange(1, 1, 1, aba.cabecalho.length).setValues([aba.cabecalho]);
    if (aba.linhas.length > 0) {
      folha.getRange(2, 1, aba.linhas.length, aba.cabecalho.length).setValues(aba.linhas);
    }
  });

  // A primeira aba padrão ("Sheet1"/"Página1") não faz parte do modelo 4.x.
  const padrao = planilha.getSheets()[0];
  if (pgo5AbasObrigatoriasDaFonte_().indexOf(padrao.getName()) === -1 &&
      padrao.getName() !== PGO5_ABAS_LEGADAS.INDICADORES_SLA) {
    planilha.deleteSheet(padrao);   // planilha DE TESTE, criada agora por nós
  }
  return planilha;
}

/**
 * Impressão digital de uma planilha: tudo o que uma escrita mudaria.
 *
 * É assim que se prova que a fonte é somente leitura sem confiar em inspeção
 * de código: tira a impressão antes, roda o tombamento, tira de novo e
 * compara. Qualquer setValue, appendRow ou deleteRow que tenha escapado
 * aparece como diferença.
 *
 * @param {Spreadsheet} planilha Planilha a fotografar.
 * @returns {string} Assinatura textual do conteúdo.
 */
function pgo5ImpressaoDigitalDaPlanilha_(planilha) {
  return planilha.getSheets().map(function(aba) {
    const linhas = aba.getLastRow();
    const colunas = aba.getLastColumn();
    const valores = (linhas > 0 && colunas > 0)
      ? JSON.stringify(aba.getRange(1, 1, linhas, colunas).getValues())
      : '[]';
    return aba.getName() + '|' + linhas + 'x' + colunas + '|' + valores;
  }).join('\n');
}

/**
 * (⚠️ ESCREVE — SOMENTE BASE DE HOMOLOGAÇÃO) Regressão completa do
 * tombamento com fonte sintética.
 *
 * COMO ELA SE PROTEGE
 *   - só o dono do projeto, no editor (pgo5ExigirDonoDoProjeto_);
 *   - recusa se o marcador de migração existir;
 *   - recusa se Atendimentos ou ValoresAtendimento tiverem qualquer linha;
 *   - recusa se houver mais de um usuário cadastrado.
 * Ou seja: ela não roda numa base de produção. Se a base tiver dados, a
 * função sai sem escrever nada.
 *
 * O QUE ELA COBRE
 *   preparação inicial · segunda preparação recusada · permissão do primeiro
 *   ADM · fonte inválida · fonte = destino · aba obrigatória ausente ·
 *   ausência de PII na validação · PIN obrigatório · destino não limpo ·
 *   tombamento sintético completo · fonte inalterada · usuário bootstrap não
 *   duplicado · segunda migração bloqueada · Id da fonte removido no sucesso ·
 *   formato dos IDs · continuidade da sequência.
 *
 * ⚠️ A planilha sintética criada no Drive NÃO é excluída automaticamente: se
 * a homologação falhar, ela é a evidência. Exclua-a manualmente depois.
 *
 * @returns {string} Relatório em texto (também gravado no Logger).
 */
function homologarTombamentoPGO5() {
  pgo5ExigirDonoDoProjeto_();

  const r = pgo5NovoResultadoDeTeste_();
  r.linhas.push('PGO 5.0 — HOMOLOGAÇÃO DO TOMBAMENTO (fonte sintética)');
  r.linhas.push('(relatório técnico, sem dados pessoais)');
  r.linhas.push('');

  // ── Porta de entrada: a base tem de ser descartável ──
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PGO5_CHAVE_MIGRACAO_CONCLUIDA)) {
    const recusa = 'RECUSADO: esta instalação já concluiu um tombamento. ' +
      'A homologação só roda numa base de homologação limpa.';
    Logger.log(recusa);
    return recusa;
  }
  try {
    if (pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS).length > 0 ||
        pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).length > 0 ||
        pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).length > 1) {
      const recusa = 'RECUSADO: esta base já tem dados. A homologação escreve no destino e ' +
        'só roda numa base de homologação vazia.';
      Logger.log(recusa);
      return recusa;
    }
  } catch (erro) {
    // Abas ainda não criadas: é exatamente o cenário de base vazia que a
    // homologação quer exercitar. Segue.
    r.linhas.push('ℹ️ estrutura ainda não criada — a preparação será exercitada do zero');
  }

  let fonte = null;
  try {
    // ── 1. Preparação da primeira instalação ──
    r.linhas.push('PREPARAÇÃO DA INSTALAÇÃO');
    const jaTinhaUsuario = pgo5PossuiUsuarios_();
    if (!jaTinhaUsuario) {
      const preparo = prepararInstalacaoPGO5();
      pgo5Afirmar_(r, 'base vazia inicializa e cria o administrador inicial',
        preparo.sucesso === true && !!preparo.administradorInicialId,
        (preparo.erros || []).join(' '));
      pgo5Afirmar_(r, 'o relatório da preparação não devolve e-mail',
        JSON.stringify(preparo).indexOf('@') === -1,
        'há um "@" no relatório — o e-mail do administrador vazou');
      pgo5Afirmar_(r, 'Cargo e Nível do administrador inicial foram resolvidos',
        !!preparo.cargoId && !!preparo.nivelAcessoId);
    } else {
      r.linhas.push('ℹ️ administrador inicial já existia — criação não reexercitada');
    }

    pgo5Afirmar_(r, 'a planilha tem as 5 abas oficiais válidas',
      pgo5TodasAsAbas_().every(function(nome) {
        const aba = getSpreadsheet().getSheetByName(nome);
        return !!aba && pgo5ValidarCabecalho_(aba, pgo5Colunas_(nome)).valido;
      }));
    pgo5Afirmar_(r, 'existe exatamente um usuário no destino',
      pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).length === 1,
      'encontrado: ' + pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).length);

    pgo5AfirmarRecusa_(r, 'segunda preparação é recusada', function() {
      prepararInstalacaoPGO5();
    });

    // ── 2. O primeiro ADM realmente pode administrar ──
    const primeiro = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS)[0];
    pgo5Afirmar_(r, 'o administrador inicial tem configurarSistema',
      usuarioTemPermissao_(primeiro, 'configurarSistema'));
    pgo5Afirmar_(r, 'o administrador inicial tem alterarPermissoes (define o PIN)',
      usuarioTemPermissao_(primeiro, 'alterarPermissoes'));
    pgo5Afirmar_(r, 'o administrador inicial nasce sem supervisor',
      String(primeiro.SupervisorId || '') === '');

    // ── 3. Recusas da validação de fonte ──
    r.linhas.push('');
    r.linhas.push('VALIDAÇÃO DA FONTE');
    pgo5Afirmar_(r, 'fonte inexistente é recusada',
      pgo5ValidarFonteLegada_('naoExisteEsteIdDePlanilhaSinteticoZZZZZ').ok === false);
    pgo5Afirmar_(r, 'fonte igual ao destino é recusada',
      pgo5ValidarFonteLegada_(getSpreadsheet().getId()).ok === false);

    // Planilha sem as abas do 4.x: recusa por estrutura.
    const semEstrutura = SpreadsheetApp.create('PGO5 HOMOLOGACAO VAZIA ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'));
    const semAbas = pgo5ValidarFonteLegada_(semEstrutura.getId());
    pgo5Afirmar_(r, 'aba obrigatória ausente é recusada', semAbas.ok === false);
    pgo5Afirmar_(r, 'a recusa diz quais abas faltam', semAbas.abasAusentes.length === 8,
      'ausentes reportadas: ' + semAbas.abasAusentes.length);

    // ── 4. Fonte sintética válida ──
    fonte = pgo5CriarFonteSinteticaDeTeste_();
    const validacao = pgo5ValidarFonteLegada_(fonte.getId());
    pgo5Afirmar_(r, 'fonte sintética completa é aceita', validacao.ok === true, validacao.motivo);
    pgo5Afirmar_(r, 'contagem de Reclame Aqui está correta',
      validacao.contagens.reclameAqui === 3, 'lido: ' + validacao.contagens.reclameAqui);
    pgo5Afirmar_(r, 'contagem de SAC Preventivo está correta',
      validacao.contagens.sacPreventivo === 2);
    pgo5Afirmar_(r, 'contagem de usuários está correta', validacao.contagens.usuarios === 3);
    pgo5Afirmar_(r, 'IndicadoresSLA é detectada quando existe', validacao.temSla === true);
    pgo5Afirmar_(r, 'contagem de SLA está correta', validacao.contagens.sla === 2);

    // A validação não pode devolver NADA além de números e nomes de aba.
    const serializada = JSON.stringify(validacao);
    ['Cliente Teste', '000.000.000', '@exemplo.invalido', 'Observação sintética',
      'Resumo sintético', fonte.getId()].forEach(function(proibido) {
      pgo5Afirmar_(r, 'a validação não devolve "' + proibido.slice(0, 18) + '…"',
        serializada.indexOf(proibido) === -1,
        'dado operacional ou Id vazou no retorno da validação');
    });

    // ── 5. O PIN é obrigatório para configurar a fonte e para executar ──
    r.linhas.push('');
    r.linhas.push('PIN OBRIGATÓRIO');
    if (!existePinDefinido_()) {
      pgo5AfirmarRecusa_(r, 'sem PIN definido, configurar a fonte é recusado', function() {
        configurarFonteTombamentoPGO5(fonte.getId());
      });
      pgo5AfirmarRecusa_(r, 'sem PIN definido, executar o tombamento é recusado', function() {
        executarTombamentoSeguroPGO5();
      });
      definirPinPGO5({ pinAtual: '', novoPin: '424242', confirmacao: '424242' });
      r.linhas.push('ℹ️ PIN sintético definido para a homologação (troque-o depois)');
    } else {
      r.linhas.push('ℹ️ já havia PIN definido — a recusa "sem PIN" não foi reexercitada');
    }

    // Definir o PIN encerra todas as liberações: aqui a sessão está fechada.
    const meuId = String(getActor_().id);
    fecharSessaoProtegida_(meuId);
    pgo5AfirmarRecusa_(r, 'sem PIN liberado, configurar a fonte é recusado', function() {
      configurarFonteTombamentoPGO5(fonte.getId());
    });
    pgo5AfirmarRecusa_(r, 'sem PIN liberado, executar o tombamento é recusado', function() {
      executarTombamentoSeguroPGO5();
    });

    // ── 6. Fonte configurada com o PIN liberado ──
    abrirSessaoProtegida_(meuId);
    const configurada = configurarFonteTombamentoPGO5(
      'https://docs.google.com/spreadsheets/d/' + fonte.getId() + '/edit');
    pgo5Afirmar_(r, 'a fonte é configurada a partir da URL completa',
      configurada.success === true && configurada.contagens.reclameAqui === 3);
    pgo5Afirmar_(r, 'o Id da fonte não volta ao navegador',
      JSON.stringify(configurada).indexOf(fonte.getId()) === -1,
      'o Id da planilha apareceu no retorno');
    pgo5Afirmar_(r, 'o Id ficou guardado em Script Properties',
      pgo5IdDaFonteConfigurada_() === fonte.getId());

    const estado = obterEstadoTombamentoPGO5();
    pgo5Afirmar_(r, 'o estado informa que existe fonte configurada',
      estado.fonteConfigurada === true);
    pgo5Afirmar_(r, 'o estado NÃO devolve o Id da fonte',
      JSON.stringify(estado).indexOf(fonte.getId()) === -1);
    pgo5Afirmar_(r, 'o pré-check aprova o destino limpo', estado.destino.ok === true,
      (estado.destino.bloqueios || []).join(' '));

    // ── 7. Destino não limpo é bloqueado ──
    r.linhas.push('');
    r.linhas.push('PRÉ-CHECK DO DESTINO');
    const intruso = pgo5Inserir(PGO5.SHEET_NAMES.ATENDIMENTOS, {
      DataAbertura: '2024-02-01', Protocolo: '999999', Cliente: 'Cliente Teste Intruso',
      CPF: '000.000.000-99', Observacoes: 'Registro sintético de pré-check'
    });
    pgo5Afirmar_(r, 'destino com atendimento é reprovado no pré-check',
      pgo5PreCheckDestinoTombamento_().ok === false);
    pgo5AfirmarRecusa_(r, 'destino não limpo bloqueia a execução', function() {
      executarTombamentoSeguroPGO5();
    });
    pgo5ExcluirPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, intruso.Id);
    pgo5Afirmar_(r, 'removido o intruso, o pré-check aprova de novo',
      pgo5PreCheckDestinoTombamento_().ok === true);

    // ── 8. O tombamento sintético completo ──
    r.linhas.push('');
    r.linhas.push('TOMBAMENTO SINTÉTICO');
    const antes = pgo5ImpressaoDigitalDaPlanilha_(fonte);
    abrirSessaoProtegida_(meuId);
    const relatorio = executarTombamentoSeguroPGO5();

    pgo5Afirmar_(r, 'o tombamento conclui com sucesso', relatorio.sucesso === true,
      (relatorio.erros && relatorio.erros.distintos.join(' ')) || '');
    pgo5Afirmar_(r, '3 atendimentos de Reclame Aqui migrados',
      relatorio.reclameAqui.migrados === 3, 'migrados: ' + relatorio.reclameAqui.migrados);
    pgo5Afirmar_(r, '2 atendimentos de SAC Preventivo migrados',
      relatorio.sacPreventivo.migrados === 2);
    pgo5Afirmar_(r, '2 produtos migrados', relatorio.produtos.migrados === 2);
    pgo5Afirmar_(r, '2 categorias migradas', relatorio.categorias.migrados === 2);
    pgo5Afirmar_(r, '1 subcategoria migrada', relatorio.subcategorias.migrados === 1);
    pgo5Afirmar_(r, 'os valores dinâmicos foram migrados',
      relatorio.valoresDinamicos.migrados >= 5,
      'migrados: ' + relatorio.valoresDinamicos.migrados);
    pgo5Afirmar_(r, 'os registros de SLA foram migrados', relatorio.sla.migrados === 2);
    pgo5Afirmar_(r, 'referências não resolvidas vêm como número',
      typeof relatorio.referenciasNaoResolvidas === 'number');
    pgo5Afirmar_(r, 'o relatório não traz nenhum dado operacional',
      ['Cliente Teste', '000.000.000', '@exemplo.invalido', 'Resumo sintético']
        .every(function(proibido) {
          return JSON.stringify(relatorio).indexOf(proibido) === -1;
        }));
    pgo5Afirmar_(r, 'o relatório não traz o Id da fonte',
      JSON.stringify(relatorio).indexOf(fonte.getId()) === -1);

    // ── 9. A FONTE NÃO FOI ESCRITA ──
    pgo5Afirmar_(r, 'a planilha de origem saiu exatamente como entrou',
      pgo5ImpressaoDigitalDaPlanilha_(fonte) === antes,
      'a impressão digital da fonte mudou — houve escrita na origem');

    // ── 10. Conteúdo gravado no destino ──
    const atendimentos = pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS);
    pgo5Afirmar_(r, '5 atendimentos gravados no destino', atendimentos.length === 5,
      'gravados: ' + atendimentos.length);
    pgo5Afirmar_(r, 'todo atendimento recebeu Id hexadecimal de 8 caracteres',
      atendimentos.every(function(registro) { return ehIdHexValido_(registro.Id); }));
    pgo5Afirmar_(r, 'os Ids gravados estão em caixa alta',
      atendimentos.every(function(registro) {
        return String(registro.Id) === String(registro.Id).toUpperCase();
      }));
    pgo5Afirmar_(r, 'nenhum Id de atendimento se repete',
      Object.keys(atendimentos.reduce(function(mapa, registro) {
        mapa[String(registro.Id)] = true; return mapa;
      }, {})).length === atendimentos.length);
    pgo5Afirmar_(r, 'Cliente e CPF foram para as colunas estruturais',
      atendimentos.every(function(registro) {
        return String(registro.Cliente || '') !== '' && String(registro.CPF || '') !== '';
      }));
    pgo5Afirmar_(r, 'o protocolo preservou os zeros à esquerda',
      atendimentos.some(function(registro) {
        return String(registro.Protocolo || '').indexOf('000') === 0;
      }));

    // ── 11. O usuário bootstrap não foi duplicado ──
    const usuarios = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS);
    const emails = {};
    let duplicados = 0;
    usuarios.forEach(function(usuario) {
      const chave = normalizeText_(usuario.Email);
      if (emails[chave]) duplicados++;
      emails[chave] = true;
    });
    pgo5Afirmar_(r, 'nenhum e-mail de usuário ficou duplicado', duplicados === 0);
    pgo5Afirmar_(r, 'o administrador inicial continua único no destino',
      usuarios.length === 1 + relatorio.usuarios.migrados,
      'usuários: ' + usuarios.length + ' | migrados: ' + relatorio.usuarios.migrados);
    pgo5Afirmar_(r, 'todos os migrados vieram sem supervisor',
      relatorio.usuarios.semSupervisor === relatorio.usuarios.migrados);

    // ── 12. Sequência de Ids continua andando ──
    const novo = pgo5Inserir(PGO5.SHEET_NAMES.ATENDIMENTOS, {
      DataAbertura: '2024-03-01', Protocolo: '000999', Cliente: 'Cliente Teste Pós',
      CPF: '000.000.000-77'
    });
    const maiorAntesDoNovo = atendimentos.reduce(function(maior, registro) {
      return Math.max(maior, idHexParaNumero_(registro.Id));
    }, 0);
    pgo5Afirmar_(r, 'a sequência de Ids continua após o tombamento',
      idHexParaNumero_(novo.Id) === maiorAntesDoNovo + 1,
      'esperado ' + formatarIdHex_(maiorAntesDoNovo + 1) + ', obtido ' + novo.Id);
    pgo5ExcluirPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, novo.Id);

    // ── 13. Não existe segunda execução ──
    r.linhas.push('');
    r.linhas.push('PROTEÇÃO CONTRA SEGUNDA EXECUÇÃO');
    pgo5Afirmar_(r, 'o marcador de conclusão foi gravado', migracaoJaFoiConcluida_() === true);
    pgo5Afirmar_(r, 'o Id da fonte foi removido depois do sucesso',
      pgo5IdDaFonteConfigurada_() === '');
    abrirSessaoProtegida_(meuId);
    pgo5AfirmarRecusa_(r, 'segunda execução do tombamento é recusada', function() {
      executarTombamentoSeguroPGO5();
    });
    pgo5AfirmarRecusa_(r, 'configurar nova fonte após a conclusão é recusado', function() {
      configurarFonteTombamentoPGO5(fonte.getId());
    });
    const estadoFinal = obterEstadoTombamentoPGO5();
    pgo5Afirmar_(r, 'o estado passa a informar tombamento concluído',
      estadoFinal.concluida === true && !!estadoFinal.concluidaEm);

    // ── 14. Depois de uma falha, não existe "tentar de novo" ──
    // O mecanismo é o próprio pré-check: uma falha parcial deixa dados no
    // destino, e destino com dados bloqueia a execução (testado no item 7).
    // Aqui fica registrado o outro lado — o relatório de falha diz o que fazer.
    r.linhas.push('');
    r.linhas.push('CAMINHO DE FALHA');
    const relatorioDeFalha = pgo5SanitizarRelatorioTombamento_({
      sucesso: false,
      reclameAqui: { encontrados: 10, migrados: 4 },
      erros: ['Foram gravados menos atendimentos do que o relatório indica.']
    });
    pgo5Afirmar_(r, 'um resultado parcial é reportado como NÃO concluído',
      relatorioDeFalha.sucesso === false);
    pgo5Afirmar_(r, 'o relatório de falha preserva o que já foi gravado',
      relatorioDeFalha.reclameAqui.migrados === 4 &&
      relatorioDeFalha.reclameAqui.encontrados === 10);
    pgo5Afirmar_(r, 'o erro do motor chega sanitizado à tela',
      relatorioDeFalha.erros.distintos.length === 1);

    // ── 15. O 4.x e as telas do 5.0 continuam de pé ──
    r.linhas.push('');
    r.linhas.push('REGRESSÃO DAS TELAS');
    [
      { nome: 'Dashboard', acao: function() { return getDashboardData({}); } },
      { nome: 'Relatórios', acao: function() { return getRelatorio({}, {}); } },
      { nome: 'Produtividade Equipe', acao: function() { return obterProdutividadeEquipePGO5({}); } },
      { nome: 'dados de apoio (bootstrap)', acao: function() { return getBootstrapData(); } },
      { nome: 'catálogo do formulário', acao: function() { return getCatalogoPGO5(); } },
      { nome: 'lista de usuários', acao: function() { return listarUsuariosPGO5(); } },
      { nome: 'cargos e níveis', acao: function() { return getCargosENiveisPGO5(); } },
      { nome: 'estado de segurança', acao: function() { return obterEstadoSegurancaPGO5(); } },
      { nome: 'auditoria', acao: function() { return listarAuditoriaPGO5(50); } },
      { nome: 'estado da migração (motor)', acao: function() { return obterEstadoMigracaoPGO5(); } }
    ].forEach(function(tela) {
      let ok = false;
      let detalhe = '';
      try { ok = !!tela.acao(); } catch (erro) { detalhe = pgo5SanitizarTextoTombamento_(erro.message); }
      pgo5Afirmar_(r, 'a tela "' + tela.nome + '" continua respondendo', ok, detalhe);
    });

    // A Análise de SAC lê uma planilha EXTERNA. Numa base de homologação ela
    // normalmente não está configurada, e isso não é regressão: o esperado é
    // que a tela responda OU recuse por falta de configuração — nunca que
    // quebre por causa do tombamento.
    let sacOk = false;
    let sacDetalhe = '';
    try {
      sacOk = !!getIndicadoresOperacionais({});
    } catch (erro) {
      const mensagem = String(erro.message || '');
      sacOk = mensagem.indexOf('configurad') !== -1 || mensagem.indexOf('CONFIG') !== -1;
      sacDetalhe = pgo5SanitizarTextoTombamento_(mensagem);
    }
    pgo5Afirmar_(r, 'a tela "Análise de SAC" responde ou recusa por falta de configuração',
      sacOk, sacDetalhe);
    pgo5Afirmar_(r, 'o banco continua sendo detectado como PGO 5.0',
      detectarEstruturaBanco_(true) === 'PGO5');
    pgo5Afirmar_(r, 'o schema continua em ' + PGO5.SCHEMA_VERSION,
      PGO5.SCHEMA_VERSION === '5.0.0' && pgo5TodasAsAbas_().length === 5);

  } catch (erro) {
    pgo5Afirmar_(r, 'a homologação rodou sem exceção inesperada', false,
      pgo5SanitizarTextoTombamento_(erro.message));
  }

  // ── Fechamento ──
  r.linhas.push('');
  if (fonte) {
    r.linhas.push('⚠️ Exclua manualmente as planilhas "PGO5 HOMOLOGACAO ..." criadas no Drive.');
  }
  r.linhas.push('⚠️ Esta base de homologação ficou com dados sintéticos e com o marcador de ' +
    'migração gravado. Não a promova a produção.');
  r.linhas.push('');
  r.linhas.push('VERIFICAÇÕES: ' + r.total + ' | APROVADAS: ' + r.ok +
    ' | FALHAS: ' + r.falhas.length);
  r.linhas.push(r.falhas.length === 0
    ? 'RESULTADO GERAL: ✅ APROVADO'
    : 'RESULTADO GERAL: ❌ REPROVADO');

  const texto = r.linhas.join('\n');
  Logger.log(texto);
  return texto;
}
