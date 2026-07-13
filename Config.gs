/**
 * ============================================================================
 * Portobank RA - Sistema de Gestão de Atendimentos (Reclame Aqui)
 * ============================================================================
 * Arquivo: Config.gs
 * Descrição: Constantes de configuração, definições de colunas das planilhas
 *            e listas fixas do fluxo (status, situações de pendência, canais).
 *
 * Este arquivo centraliza toda a configuração do sistema para facilitar
 * a manutenção e personalização.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Grupos de conteúdo, nesta ordem:
 *   1) CONFIG        → números e nomes gerais (cache, paginação, lock).
 *   2) COLUMNS       → a ordem exata das colunas de cada aba da planilha.
 *                      ⚠️ Nunca apague uma coluna que já tem dados sem antes
 *                      migrar os dados antigos.
 *   3) Listas fixas  → STATUS_LIST, SITUACOES_PENDENCIA e CANAIS_LIST são
 *                      regras de negócio fixas da célula de Reclame Aqui e
 *                      não são administráveis pela tela de Configurações.
 *   4) DEFAULT_*     → produtos e categorias iniciais, inseridos apenas na
 *                      primeira criação da planilha. Depois disso, edite
 *                      pela tela de Configurações do sistema.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// CONFIGURAÇÕES GERAIS DO SISTEMA
// ============================================================================
const CONFIG = {
  SCHEMA_VERSION: '4.0.0',
  SPREADSHEET_ID: '', // Opcional. Quando vazio, usa Script Properties/planilha vinculada.
  SHEET_NAMES: {
    // Abas de atendimento separadas por canal. A aba legada "Atendimentos"
    // é migrada automaticamente para estas três (migrateLegacyData_).
    RECLAME_AQUI: 'ReclameAqui',
    CHAT_PRIVADO: 'ChatPrivadoRA',
    SAC_PREVENTIVO: 'SACPreventivo',
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
// DEFINIÇÕES DE COLUNAS POR PLANILHA
// Cada array define a ordem exata das colunas (headers) na planilha.
// ============================================================================
const COLUMNS = {
  ATENDIMENTOS: [
    'Id',
    'NumeroRA',          // Protocolo Odin
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
 * Canais de entrada do atendimento. O Chat Privado faz parte do Reclame
 * Aqui, mas possui aba própria para facilitar o controle operacional.
 */
const CANAIS_LIST = [
  'Reclame Aqui',
  'Chat Privado',
  'SAC Preventivo'
];

/**
 * Mapeamento Canal → aba do Google Sheets onde o atendimento é gravado.
 * As chaves são comparadas com normalizeText_ (sem acentos/caixa).
 */
const CANAL_SHEETS = [
  { canal: 'Reclame Aqui',   sheetKey: 'RECLAME_AQUI' },
  { canal: 'Chat Privado',   sheetKey: 'CHAT_PRIVADO' },
  { canal: 'SAC Preventivo', sheetKey: 'SAC_PREVENTIVO' }
];

// ============================================================================
// DADOS PADRÃO PARA INICIALIZAÇÃO (apenas primeira criação da planilha)
// ============================================================================

/**
 * Produtos atendidos pela célula: apenas Cartão de Crédito e
 * Conta Digital PortoBank. Estas listas também são usadas pela migração
 * (migrateLegacyData_ em Database.gs) para substituir os produtos e
 * categorias antigos de instalações existentes.
 */
const DEFAULT_PRODUTOS = [
  { Id: 'PD001', Nome: 'Cartão de Crédito',       Descricao: 'Cartão de crédito Portobank',  Ativo: true, Ordem: 1 },
  { Id: 'PD002', Nome: 'Conta Digital PortoBank', Descricao: 'Conta digital do PortoBank',   Ativo: true, Ordem: 2 }
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
  // Conta Digital PortoBank
  { Id: 'CT007', ProdutoId: 'PD002', Nome: 'Conta Digital PortoBank',  Descricao: 'Assuntos gerais da conta digital PortoBank',       Ativo: true, Ordem: 7 },
  { Id: 'CT008', ProdutoId: 'PD002', Nome: 'Abertura/Encerramento',    Descricao: 'Problemas na abertura ou encerramento da conta',   Ativo: true, Ordem: 8 },
  { Id: 'CT009', ProdutoId: 'PD002', Nome: 'Transferência/Pix',        Descricao: 'Problemas com transferências, TED ou Pix',         Ativo: true, Ordem: 9 },
  { Id: 'CT010', ProdutoId: 'PD002', Nome: 'Cobrança indevida',        Descricao: 'Tarifas ou cobranças indevidas na conta digital',  Ativo: true, Ordem: 10 },
  { Id: 'CT011', ProdutoId: 'PD002', Nome: 'Acesso ao aplicativo',     Descricao: 'Problemas de acesso, senha ou dispositivo',        Ativo: true, Ordem: 11 },
  { Id: 'CT012', ProdutoId: 'PD002', Nome: 'Cartão de débito',         Descricao: 'Emissão, entrega e uso do cartão de débito',       Ativo: true, Ordem: 12 },
  { Id: 'CT013', ProdutoId: 'PD002', Nome: 'Portabilidade de salário', Descricao: 'Solicitações de portabilidade de salário',         Ativo: true, Ordem: 13 },
  { Id: 'CT014', ProdutoId: 'PD002', Nome: 'Rendimento/Investimentos', Descricao: 'Rendimento da conta e produtos de investimento',   Ativo: true, Ordem: 14 }
];
