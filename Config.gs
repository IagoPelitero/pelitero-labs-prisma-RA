/**
 * ============================================================================
 * Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos
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
 *                      Configurações (aba "Canais" — DEFAULT_CANAIS).
 *   4) DEFAULT_*     → produtos e categorias iniciais, inseridos apenas na
 *                      primeira criação da planilha. Depois disso, edite
 *                      pela tela de Configurações do sistema.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURAÇÕES GERAIS DO SISTEMA
// ============================================================================
const CONFIG = {
  SCHEMA_VERSION: '4.4.0',
  SPREADSHEET_ID: '', // Opcional. Quando vazio, usa Script Properties/planilha vinculada.
  SHEET_NAMES: {
    // Abas de atendimento separadas por canal. A aba legada "Atendimentos"
    // é migrada automaticamente para estas abas (migrateLegacyData_).
    // v4.2: o canal "Chat Privado" foi descontinuado — os atendimentos da
    // antiga aba ChatPrivadoRA são migrados para ReclameAqui.
    RECLAME_AQUI: 'ReclameAqui',
    SAC_PREVENTIVO: 'SACPreventivo',
    // v4.2: canais administráveis pela tela de Configurações (ADM).
    CANAIS: 'Canais',
    CONFIG_CAMPOS: 'ConfigCampos',
    TIMELINE: 'Timeline',
    HISTORICO: 'Histórico',
    USUARIOS: 'Usuários',
    PRODUTOS: 'Produtos',
    CATEGORIAS: 'Categorias'
  },
  // Nome da aba legada (pré-v4), usada apenas pela migração.
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
  CHAT_PRIVADO_MIGRATION: 'PRISMA_RA_CHAT_PRIVADO_MIGRATION'
};

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
    'Bloqueado'     // true = não pode ser ocultado nem tornado opcional (ex: Canal)
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
 * Configurações (aba "Canais" do Google Sheets — ver DEFAULT_CANAIS).
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
// v4.2: canais criados pelo ADM que não possuem aba própria são gravados
// na aba ReclameAqui (fallback de sheetNameForCanalConfig_ em Database.gs);
// a coluna "Canal" de cada atendimento preserva o canal real selecionado.

// ============================================================================
// DADOS PADRÃO PARA INICIALIZAÇÃO (apenas primeira criação da planilha)
// ============================================================================

/**
 * Produtos atendidos pela célula de exemplo: Cartão de Crédito e
 * Conta Digital. v4.3 — política de não sobrescrita: estas listas são
 * gravadas APENAS quando a aba está vazia (primeira criação). O sistema
 * nunca substitui o que já foi escrito ou editado manualmente na
 * planilha; o catálogo é administrável pela tela de Configurações.
 */
const DEFAULT_PRODUTOS = [
  { Id: 'PD001', Nome: 'Cartão de Crédito', Descricao: 'Atendimentos do produto cartão de crédito', Ativo: true, Ordem: 1 },
  { Id: 'PD002', Nome: 'Conta Digital',     Descricao: 'Atendimentos do produto conta digital',     Ativo: true, Ordem: 2 }
];

/**
 * Canais padrão (v4.2), inseridos apenas na primeira criação da aba
 * "Canais". Depois disso, o ADM pode adicionar, editar e excluir canais
 * pela tela de Configurações, sem alteração de código — o formulário de
 * Novo Atendimento, o Dashboard, os Indicadores e os filtros refletem
 * automaticamente as mudanças.
 */
const DEFAULT_CANAIS = [
  { Id: 'CN001', Nome: 'Reclame Aqui',   Ativo: true, Ordem: 1 },
  { Id: 'CN002', Nome: 'SAC Preventivo', Ativo: true, Ordem: 2 }
];

/**
 * Campos padrão do formulário "Novo Atendimento" (aba ConfigCampos).
 * O ADM administra estes registros pela tela de Configurações: pode ocultar,
 * tornar opcional/obrigatório, reordenar e criar campos novos — sem alterar
 * código. Campos com Base=true mapeiam colunas fixas da planilha; campos
 * com Base=false são gravados na coluna CamposExtras (JSON).
 * "Bloqueado" impede ocultar/desobrigar o campo (o Canal define em qual aba
 * o atendimento é gravado, por isso é sempre obrigatório).
 */
const DEFAULT_CONFIG_CAMPOS = [
  { Id: 'FC001', Campo: 'dataAbertura', Rotulo: 'Data',            Tipo: 'date',     Exibir: true,  Obrigatorio: true,  Ordem: 1, Base: true,  Bloqueado: false },
  { Id: 'FC002', Campo: 'numeroRA',     Rotulo: 'Protocolo',       Tipo: 'text',     Exibir: true,  Obrigatorio: true,  Ordem: 2, Base: true,  Bloqueado: false },
  { Id: 'FC003', Campo: 'cliente',      Rotulo: 'Nome do cliente', Tipo: 'text',     Exibir: true,  Obrigatorio: true,  Ordem: 3, Base: true,  Bloqueado: false },
  { Id: 'FC004', Campo: 'cpf',          Rotulo: 'CPF',             Tipo: 'cpf',      Exibir: true,  Obrigatorio: true,  Ordem: 4, Base: true,  Bloqueado: false },
  { Id: 'FC005', Campo: 'produto',      Rotulo: 'Produto',         Tipo: 'select',   Exibir: true,  Obrigatorio: false, Ordem: 5, Base: true,  Bloqueado: false },
  { Id: 'FC006', Campo: 'categoria',    Rotulo: 'Categoria',       Tipo: 'select',   Exibir: true,  Obrigatorio: false, Ordem: 6, Base: true,  Bloqueado: false },
  { Id: 'FC007', Campo: 'canal',        Rotulo: 'Canal',           Tipo: 'select',   Exibir: true,  Obrigatorio: true,  Ordem: 7, Base: true,  Bloqueado: true },
  { Id: 'FC008', Campo: 'observacoes',  Rotulo: 'Observações',     Tipo: 'textarea', Exibir: true,  Obrigatorio: false, Ordem: 8, Base: true,  Bloqueado: false },
  { Id: 'FC009', Campo: 'agencia',      Rotulo: 'Agência',         Tipo: 'text',     Exibir: false, Obrigatorio: false, Ordem: 9, Base: false, Bloqueado: false }
];

/**
 * Categorias vinculadas aos dois produtos, através do campo "ProdutoId".
 */
const DEFAULT_CATEGORIAS = [
  // Cartão de Crédito
  { Id: 'CT001', ProdutoId: 'PD001', Nome: 'Contestação de compra',    Descricao: 'Contestações de compras no cartão',                Ativo: true, Ordem: 1 },
  { Id: 'CT002', ProdutoId: 'PD001', Nome: 'Cobrança indevida',        Descricao: 'Cobranças ou tarifas indevidas no cartão',         Ativo: true, Ordem: 2 },
  { Id: 'CT003', ProdutoId: 'PD001', Nome: 'Anuidade',                 Descricao: 'Questões de anuidade e benefícios',                Ativo: true, Ordem: 3 },
  { Id: 'CT004', ProdutoId: 'PD001', Nome: 'Limite de crédito',        Descricao: 'Revisão, aumento ou redução de limite',            Ativo: true, Ordem: 4 },
  { Id: 'CT005', ProdutoId: 'PD001', Nome: 'Bloqueio/Desbloqueio',     Descricao: 'Problemas com bloqueio ou desbloqueio do cartão',  Ativo: true, Ordem: 5 },
  { Id: 'CT006', ProdutoId: 'PD001', Nome: 'Fatura',                   Descricao: 'Divergências, fechamento e parcelamento de fatura', Ativo: true, Ordem: 6 },
  // Conta Digital
  { Id: 'CT007', ProdutoId: 'PD002', Nome: 'Assuntos gerais da conta', Descricao: 'Assuntos gerais da conta digital',                 Ativo: true, Ordem: 7 },
  { Id: 'CT008', ProdutoId: 'PD002', Nome: 'Abertura/Encerramento',    Descricao: 'Problemas na abertura ou encerramento da conta',   Ativo: true, Ordem: 8 },
  { Id: 'CT009', ProdutoId: 'PD002', Nome: 'Transferência/Pix',        Descricao: 'Problemas com transferências, TED ou Pix',         Ativo: true, Ordem: 9 },
  { Id: 'CT010', ProdutoId: 'PD002', Nome: 'Cobrança indevida',        Descricao: 'Tarifas ou cobranças indevidas na conta digital',  Ativo: true, Ordem: 10 },
  { Id: 'CT011', ProdutoId: 'PD002', Nome: 'Acesso ao aplicativo',     Descricao: 'Problemas de acesso, senha ou dispositivo',        Ativo: true, Ordem: 11 },
  { Id: 'CT012', ProdutoId: 'PD002', Nome: 'Cartão de débito',         Descricao: 'Emissão, entrega e uso do cartão de débito',       Ativo: true, Ordem: 12 },
  { Id: 'CT013', ProdutoId: 'PD002', Nome: 'Portabilidade de salário', Descricao: 'Solicitações de portabilidade de salário',         Ativo: true, Ordem: 13 },
  { Id: 'CT014', ProdutoId: 'PD002', Nome: 'Rendimento/Investimentos', Descricao: 'Rendimento da conta e produtos de investimento',   Ativo: true, Ordem: 14 }
];
