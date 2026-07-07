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
  SCHEMA_VERSION: '3.1.0',
  SPREADSHEET_ID: '', // Opcional. Quando vazio, usa Script Properties/planilha vinculada.
  SHEET_NAMES: {
    ATENDIMENTOS: 'Atendimentos',
    TIMELINE: 'Timeline',
    HISTORICO: 'Histórico',
    USUARIOS: 'Usuários',
    PRODUTOS: 'Produtos',
    CATEGORIAS: 'Categorias'
  },
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
    'DataExclusao'
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
 * Status do atendimento. Fluxo da célula de Reclame Aqui:
 * apenas "Pendente" e "Concluído".
 */
const STATUS_LIST = [
  { Nome: 'Pendente',  Tipo: 'Espera', Cor: '#FF9800' },
  { Nome: 'Concluído', Tipo: 'Final',  Cor: '#4CAF50' }
];

/**
 * Situação da pendência (armazenada na coluna MotivoPendencia).
 * Obrigatória sempre que o Status é "Pendente".
 */
const SITUACOES_PENDENCIA = [
  'Em análise área',
  'Em análise do analista',
  'Em análise aguardando retorno do cliente'
];

/**
 * Canais de entrada do atendimento.
 */
const CANAIS_LIST = [
  'Reclame Aqui',
  'SAC Preventivo'
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
