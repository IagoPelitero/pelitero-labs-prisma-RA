/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Config.gs
 * Descrição: Constantes de configuração, definições de colunas das planilhas
 *            e listas fixas do fluxo (status, aguardando retorno, canais).
 *
 * Este arquivo centraliza toda a configuração do sistema para facilitar
 * a manutenção e personalização.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Grupos de conteúdo, nesta ordem:
 *   1) CONFIG        → números e nomes gerais (cache, paginação, lock).
 *   2) COLUMNS       → a ordem exata das colunas de cada aba da planilha.
 *                      ⚠️ Nunca apague uma coluna que já tem dados sem antes
 *                      migrar os dados antigos.
 *   3) Listas fixas  → STATUS_LIST e SITUACOES_PENDENCIA são regras de
 *                      negócio fixas da célula de Reclame Aqui. Os CANAIS
 *                      (v4.2) passaram a ser administráveis pela tela de
 *                      Configurações (aba "Canais").
 *   4) DEFAULT_*     → produtos e categorias iniciais, inseridos apenas na
 *                      primeira criação da planilha. Depois disso, edite
 *                      pela tela de Configurações do sistema.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURAÇÕES GERAIS DO SISTEMA
// ============================================================================
const CONFIG = {
  // ⚠️ SUBIR ESTA VERSÃO NÃO MEXE MAIS NA PLANILHA.
  // Ela chegou a disparar migração automática de esquema na abertura do
  // sistema; esse caminho foi removido. Hoje a estrutura existente é apenas
  // VALIDADA, e o sistema para com mensagem clara se ela não servir.
  //
  // ATENÇÃO (v4.6.1): esta versão também compõe a CHAVE DE CACHE
  // (getCacheKey em Database.gs → "PRISMA_RA_<versão>_<Aba>"). Isso é
  // proteção contra regressão: ao mudar COLUMNS, sempre suba a
  // SCHEMA_VERSION — assim o cache gravado pelo esquema anterior fica
  // automaticamente inacessível e nenhuma leitura mistura ordens de
  // colunas diferentes (era a causa do "Dashboard vazio" intermitente).
  //
  // v4.7: módulo Indicadores Operacionais — nova aba IndicadoresSLA (campo
  // manual "Fora da SLA"). Abas novas são criadas vazias, sem tocar nas
  // demais; o bump também invalida os caches do esquema anterior.
  SCHEMA_VERSION: '4.7.0',
  SPREADSHEET_ID: '', // Opcional. Quando vazio, usa Script Properties/planilha vinculada.

  // ── IDENTIDADE VISUAL ─────────────────────────────────────────────────────
  // APENAS apresentação: títulos de página, menu, cabeçalho e rodapé de PDF.
  // Nada aqui participa de chave de cache, Script Property, nome de aba ou
  // coluna — trocar estes textos não altera dados nem quebra IMPORTRANGE.
  // Os identificadores técnicos legados (PRISMA_RA_*, prisma-ra-*) continuam
  // como estão de propósito: mudá-los invalidaria caches e preferências.
  APP: {
    NOME: 'PRISMA Gestão Operacional',
    NOME_CURTO: 'PRISMA',
    FABRICANTE: 'Pelitero Labs',
    TITULO: 'PRISMA Gestão Operacional — Pelitero Labs'
  },

  SHEET_NAMES: {
    // Abas de atendimento do modelo 4.x, separadas por canal. Mantidas
    // apenas para LEITURA de instalações antigas: nenhuma rotina do produto
    // cria, renomeia ou move dados entre elas.
    RECLAME_AQUI: 'ReclameAqui',
    SAC_PREVENTIVO: 'SACPreventivo',
    // v4.2: canais administráveis pela tela de Configurações (ADM).
    CANAIS: 'Canais',
    CONFIG_CAMPOS: 'ConfigCampos',
    TIMELINE: 'Timeline',
    HISTORICO: 'Histórico',
    USUARIOS: 'Usuários',
    PRODUTOS: 'Produtos',
    CATEGORIAS: 'Categorias',
    // v4.6: subcategorias vinculadas às categorias (Produto → Categoria →
    // Subcategoria), administráveis pela tela de Configurações.
    SUBCATEGORIAS: 'Subcategorias',
    // v4.7: valores manuais "Fora da SLA" do módulo Indicadores
    // Operacionais, por data (Data | ForaSLA). Persistidos aqui para
    // sobreviverem à releitura da planilha externa.
    INDICADORES_SLA: 'IndicadoresSLA'
  },
  // Nome da aba de atendimentos pré-v4. Só é consultado na leitura de
  // instalações antigas — não existe mais rotina que a mova ou a renomeie.
  LEGACY_ATENDIMENTOS_SHEET: 'Atendimentos',
  CACHE_TTL: 300,        // Tempo de cache em segundos (5 minutos)
  PAGE_SIZE: 50,         // Registros por página na listagem
  LOCK_TIMEOUT_MS: 30000 // Timeout para LockService (30 segundos)
};

// ============================================================================
// CHAVES DE SCRIPT PROPERTIES
// Centralizadas para evitar strings repetidas pelo código. Caso uma
// instalação anterior perca o vínculo com a planilha, basta executar
// configurarPlanilha('<ID>') uma única vez no editor (Code.gs).
// ============================================================================
const PROPERTY_KEYS = {
  SPREADSHEET_ID: 'PRISMA_RA_SPREADSHEET_ID',
  SCHEMA_VERSION: 'PRISMA_RA_SCHEMA_VERSION',
  // v4.3: CATALOG_VERSION removida — o "reseed" do catálogo foi extinto
  // (política de não sobrescrita: dados padrão só em abas vazias).
  CANAL_MIGRATION: 'PRISMA_RA_CANAL_MIGRATION',
  // v4.2: migração única que move a aba ChatPrivadoRA para ReclameAqui.
  CHAT_PRIVADO_MIGRATION: 'PRISMA_RA_CHAT_PRIVADO_MIGRATION',
  // v4.7: configuração da fonte de dados do módulo Indicadores Operacionais
  // (JSON com nome da aba/menu, URL da planilha externa, aba de origem,
  // linha inicial e nomes das colunas de Data e Status).
  INDIC_OP_CONFIG: 'PRISMA_RA_INDIC_OP_CONFIG',
  // Nomes VISÍVEIS das telas, definidos pelo ADM (JSON {pagina: nome}).
  // Chave NOVA — nenhuma chave existente foi renomeada ou removida.
  // Puramente cosmético: não participa de aba, coluna, rota ou data-page.
  NOMES_TELAS: 'PRISMA_RA_NOMES_TELAS'
};

// ============================================================================
// NOMES PADRÃO DAS TELAS
// Rótulos exibidos quando o ADM não personalizou nada (ou apagou o campo).
// A CHAVE é o identificador técnico da página (data-page no Index.html) e
// NUNCA muda — só o texto à direita é editável.
// ============================================================================
const TELAS_RENOMEAVEIS = [
  { pagina: 'dashboard', padrao: 'Dashboard' },
  { pagina: 'novoAtendimento', padrao: 'Novo Atendimento' },
  { pagina: 'relatorios', padrao: 'Relatórios' },
  // O nome VISÍVEL passou a ser "Produtividade Equipe" na Etapa 4. O
  // identificador técnico continua 'indicadores' de propósito: renomear a
  // rota quebraria links salvos, o hash da URL e o data-page do menu, sem
  // nenhum ganho para quem usa o sistema.
  { pagina: 'indicadores', padrao: 'Produtividade Equipe' },
  // O nome desta tela já era configurável pelo ADM em "Análise de SAC"
  // (campo abaNome). Ela entra aqui pela MESMA origem, para não existirem
  // dois lugares gravando o mesmo rótulo.
  { pagina: 'indicadoresOperacionais', padrao: 'Análise de SAC', fonte: 'indicOp' }
];

// ============================================================================
// DEFINIÇÕES DE COLUNAS POR PLANILHA
// Cada array define a ordem exata das colunas (headers) na planilha.
// ============================================================================
const COLUMNS = {
  ATENDIMENTOS: [
    'Id',
    'NumeroRA',          // Protocolo do atendimento
    'DataAbertura',
    'Canal',
    'Cliente',
    'CPF',
    'Produto',
    'Categoria',
    'Subcategoria',      // v4.6: novo nível de classificação (vazio nos registros antigos)
    'Status',            // Pendente | Concluído
    'MotivoPendencia',   // Situação da pendência (apenas quando Pendente)
    'Responsavel',
    'DataResolucao',
    'TempoResolucaoHoras',
    'Observacoes',
    'CriadoPor',
    'DataCriacao',
    'AtualizadoPor',
    'DataAtualizacao',
    'Excluido',
    'ExcluidoPor',
    'DataExclusao',
    'CamposExtras'      // JSON com os campos personalizados do formulário (ConfigCampos)
  ],
  CONFIG_CAMPOS: [
    'Id',
    'Campo',        // Chave interna do campo (ex: numeroRA, cliente, agencia)
    'Rotulo',       // Rótulo exibido no formulário
    'Tipo',         // text | date | textarea | number | select | cpf
    'Exibir',       // Sim/Não
    'Obrigatorio',  // Sim/Não
    'Ordem',
    'Base',         // true = mapeia coluna fixa; false = gravado em CamposExtras
    'Bloqueado',    // true = não pode ser ocultado nem tornado opcional (ex: Canal)
    'Opcoes'        // v4.6: opções dos seletores personalizados (separadas por ";")
  ],
  TIMELINE: [
    'Id',
    'AtendimentoId',
    'Data',
    'Tipo',
    'Descricao',
    'De',
    'Para',
    'Usuario',
    'Detalhes'
  ],
  HISTORICO: [
    'Id',
    'AtendimentoId',
    'Data',
    'Acao',
    'Campo',
    'ValorAnterior',
    'ValorNovo',
    'Usuario',
    'Justificativa'
  ],
  USUARIOS: [
    'Id',
    'Nome',
    'Email',
    'Perfil',
    'Equipe',
    'Ativo',
    'DataCadastro',
    'UltimoAcesso'
  ],
  PRODUTOS: [
    'Id',
    'Nome',
    'Descricao',
    'Ativo',
    'Ordem'
  ],
  // v4.2: canais de entrada administráveis (tela de Configurações — ADM).
  CANAIS: [
    'Id',
    'Nome',
    'Ativo',
    'Ordem'
  ],
  CATEGORIAS: [
    'Id',
    'ProdutoId',
    'Nome',
    'Descricao',
    'Ativo',
    'Ordem'
  ],
  // v4.6: subcategorias vinculadas a uma categoria (CategoriaId), fechando a
  // hierarquia Produto → Categoria → Subcategoria. Mesmo padrão Id/Nome/
  // Ativo/Ordem das demais entidades administráveis.
  SUBCATEGORIAS: [
    'Id',
    'CategoriaId',
    'Nome',
    'Ativo',
    'Ordem'
  ],
  // v4.7: valores manuais "Fora da SLA" do módulo Indicadores Operacionais.
  // Chave = data no formato ISO curto (AAAA-MM-DD, estável e ordenável);
  // ForaSLA = número informado pelo usuário para aquela data.
  INDICADORES_SLA: [
    'Data',
    'ForaSLA'
  ]
};

// ============================================================================
// LISTAS FIXAS DO FLUXO (não administráveis pela interface)
// ============================================================================

/**
 * Status do atendimento. Fluxo da célula RA:
 * Pendente → Em análise → Concluído.
 */
const STATUS_LIST = [
  { Nome: 'Pendente',   Tipo: 'Espera',    Cor: '#FF9800' },
  { Nome: 'Em análise', Tipo: 'Andamento', Cor: '#2196F3' },
  { Nome: 'Concluído',  Tipo: 'Final',     Cor: '#4CAF50' }
];

/**
 * "Aguardando Retorno de" (armazenado na coluna MotivoPendencia).
 * Obrigatório sempre que o Status é "Pendente"; oculto nos demais status.
 */
const SITUACOES_PENDENCIA = [
  'Área',
  'Cliente'
];

/**
 * Canais de entrada PADRÃO do atendimento (v4.2).
 * A lista efetiva de canais agora é administrável pela tela de
 * Configurações (aba "Canais" do Google Sheets).
 * Esta constante permanece apenas como fallback de segurança, usado
 * quando a aba Canais estiver vazia ou indisponível.
 */
const CANAIS_LIST = [
  'Reclame Aqui',
  'SAC Preventivo'
];

/**
 * Mapeamento Canal → aba do Google Sheets onde o atendimento é gravado.
 * As chaves são comparadas com normalizeText_ (sem acentos/caixa).
 */
const CANAL_SHEETS = [
  { canal: 'Reclame Aqui',   sheetKey: 'RECLAME_AQUI' },
  { canal: 'SAC Preventivo', sheetKey: 'SAC_PREVENTIVO' }
];
