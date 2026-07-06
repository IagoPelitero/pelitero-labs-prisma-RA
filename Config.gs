/**
 * ============================================================================
 * PORTO RA - Sistema de Gestão Reclame Aqui
 * ============================================================================
 * Arquivo: Config.gs
 * Descrição: Constantes de configuração, definições de colunas das planilhas,
 *            dados padrão para inicialização do sistema (status, prioridades,
 *            canais, motivos de pendência).
 * 
 * Este arquivo centraliza toda a configuração do sistema para facilitar
 * a manutenção e personalização.
 * ============================================================================
 */

// ============================================================================
// CONFIGURAÇÕES GERAIS DO SISTEMA
// ============================================================================
const CONFIG = {
  SCHEMA_VERSION: '2.0.0',
  SPREADSHEET_ID: '', // Opcional. Quando vazio, usa Script Properties/planilha vinculada.
  SHEET_NAMES: {
    ATENDIMENTOS: 'Atendimentos',
    TIMELINE: 'Timeline',
    HISTORICO: 'Histórico',
    USUARIOS: 'Usuários',
    PRODUTOS: 'Produtos',
    CATEGORIAS: 'Categorias',
    STATUS_CONFIG: 'Status',
    PRIORIDADES: 'Prioridades',
    CANAIS: 'Canais',
    TIPOS_ATENDIMENTO: 'TiposAtendimento',
    SLAS: 'SLAs',
    MOTIVOS_PENDENCIA: 'MotivosPendencia',
    DASHBOARD: 'Dashboard',
    RELATORIOS: 'Relatórios',
    CONFIGURACOES: 'Configurações'
  },
  CACHE_TTL: 300,                    // Tempo de cache em segundos (5 minutos)
  PAGE_SIZE: 50,                      // Registros por página na listagem
  SLA_ALERT_HOURS: 4,                 // Alerta quando faltam X horas para vencer SLA
  ESPERA_AREA_ALERT_HOURS: 24,        // Alerta quando aguardando área > 24h
  ESPERA_CLIENTE_ALERT_DAYS: 3,       // Alerta quando aguardando cliente > 3 dias
  DEFAULT_SLA_HOURS: 48,              // SLA padrão em horas quando não configurado
  BUSINESS_HOUR_START: 8,             // Início do horário comercial
  BUSINESS_HOUR_END: 18,             // Fim do horário comercial
  LOCK_TIMEOUT_MS: 30000              // Timeout para LockService (30 segundos)
};

// ============================================================================
// DEFINIÇÕES DE COLUNAS POR PLANILHA
// Cada array define a ordem exata das colunas (headers) na planilha.
// A posição no array corresponde à coluna na planilha.
// ============================================================================
const COLUMNS = {
  ATENDIMENTOS: [
    'Id',
    'NumeroRA',
    'DataAbertura',
    'DataRecebimento',
    'Canal',
    'TipoAtendimento',
    'Cliente',
    'CPF',
    'Telefone',
    'Email',
    'Produto',
    'Categoria',
    'Subcategoria',
    'Assunto',
    'Descricao',
    'Status',
    'Prioridade',
    'Responsavel',
    'SLAHoras',
    'DataVencimentoSLA',
    'StatusSLA',
    'DataInicioEspera',
    'TempoEsperaAcumulado',
    'MotivoPendencia',
    'DataResolucao',
    'TempoResolucaoHoras',
    'Resolucao',
    'NotaConsumidor',
    'Avaliacao',
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
  ],
  STATUS_CONFIG: [
    'Id',
    'Nome',
    'Tipo',
    'Cor',
    'Ativo',
    'Ordem'
  ],
  PRIORIDADES: [
    'Id',
    'Nome',
    'Cor',
    'SLAMultiplicador',
    'Ativo',
    'Ordem'
  ],
  CANAIS: [
    'Id',
    'Nome',
    'Icone',
    'Ativo',
    'Ordem'
  ],
  TIPOS_ATENDIMENTO: [
    'Id',
    'Nome',
    'Descricao',
    'Ativo',
    'Ordem'
  ],
  SLAS: [
    'Id',
    'ProdutoId',
    'CategoriaId',
    'TipoAtendimentoId',
    'CanalId',
    'Horas',
    'Ativo'
  ],
  MOTIVOS_PENDENCIA: [
    'Id',
    'Nome',
    'Descricao',
    'Ativo',
    'Ordem'
  ],
  DASHBOARD: [
    'Indicador',
    'Valor',
    'AtualizadoEm'
  ],
  RELATORIOS: [
    'Id',
    'Tipo',
    'Filtros',
    'GeradoPor',
    'DataGeracao',
    'Quantidade'
  ],
  CONFIGURACOES: [
    'Chave',
    'Valor',
    'Descricao'
  ]
};

// ============================================================================
// DADOS PADRÃO PARA INICIALIZAÇÃO
// Estes dados são inseridos automaticamente ao criar as planilhas pela
// primeira vez. O campo 'id' segue o padrão de prefixo + número sequencial.
// ============================================================================

/**
 * Status padrão do sistema.
 * Tipos:
 *   - Inicial: status de abertura/início de tratativa
 *   - Espera: status de aguardo (pausa o SLA)
 *   - Intermediario: status de tratativa ativa
 *   - Final: status de encerramento
 */
const DEFAULT_STATUS = [
  { Id: 'ST001', Nome: 'Novo',                             Tipo: 'Inicial',       Cor: '#2196F3', Ativo: true, Ordem: 1 },
  { Id: 'ST002', Nome: 'Em análise',                       Tipo: 'Inicial',       Cor: '#03A9F4', Ativo: true, Ordem: 2 },
  { Id: 'ST003', Nome: 'Em atendimento',                   Tipo: 'Inicial',       Cor: '#00BCD4', Ativo: true, Ordem: 3 },
  { Id: 'ST004', Nome: 'Aguardando retorno da área',       Tipo: 'Espera',        Cor: '#FF9800', Ativo: true, Ordem: 4 },
  { Id: 'ST005', Nome: 'Aguardando retorno do cliente',    Tipo: 'Espera',        Cor: '#FFC107', Ativo: true, Ordem: 5 },
  { Id: 'ST006', Nome: 'Aguardando documentação',          Tipo: 'Espera',        Cor: '#FFD54F', Ativo: true, Ordem: 6 },
  { Id: 'ST007', Nome: 'Aguardando validação',             Tipo: 'Espera',        Cor: '#FFE082', Ativo: true, Ordem: 7 },
  { Id: 'ST008', Nome: 'Aguardando solução técnica',       Tipo: 'Espera',        Cor: '#FFAB40', Ativo: true, Ordem: 8 },
  { Id: 'ST009', Nome: 'Em tratativa',                     Tipo: 'Intermediario', Cor: '#9C27B0', Ativo: true, Ordem: 9 },
  { Id: 'ST010', Nome: 'Em escalação',                     Tipo: 'Intermediario', Cor: '#E91E63', Ativo: true, Ordem: 10 },
  { Id: 'ST011', Nome: 'Em monitoramento',                 Tipo: 'Intermediario', Cor: '#795548', Ativo: true, Ordem: 11 },
  { Id: 'ST012', Nome: 'Resolvido',                        Tipo: 'Final',         Cor: '#4CAF50', Ativo: true, Ordem: 12 },
  { Id: 'ST013', Nome: 'Finalizado',                       Tipo: 'Final',         Cor: '#8BC34A', Ativo: true, Ordem: 13 },
  { Id: 'ST014', Nome: 'Cancelado',                        Tipo: 'Final',         Cor: '#F44336', Ativo: true, Ordem: 14 },
  { Id: 'ST015', Nome: 'Improcedente',                     Tipo: 'Final',         Cor: '#9E9E9E', Ativo: true, Ordem: 15 }
];

/**
 * Prioridades padrão.
 * O multiplicador de SLA ajusta o tempo de SLA base:
 *   - Crítica (0.25x): SLA 4x mais curto
 *   - Urgente (0.5x): SLA 2x mais curto
 *   - Alta (0.75x): SLA 25% mais curto
 *   - Média (1.0x): SLA padrão
 *   - Baixa (1.5x): SLA 50% mais longo
 */
const DEFAULT_PRIORIDADES = [
  { Id: 'PR001', Nome: 'Crítica',  Cor: '#D32F2F', SLAMultiplicador: 0.25, Ativo: true, Ordem: 1 },
  { Id: 'PR002', Nome: 'Urgente',  Cor: '#F44336', SLAMultiplicador: 0.5,  Ativo: true, Ordem: 2 },
  { Id: 'PR003', Nome: 'Alta',     Cor: '#FF9800', SLAMultiplicador: 0.75, Ativo: true, Ordem: 3 },
  { Id: 'PR004', Nome: 'Média',    Cor: '#2196F3', SLAMultiplicador: 1.0,  Ativo: true, Ordem: 4 },
  { Id: 'PR005', Nome: 'Baixa',    Cor: '#4CAF50', SLAMultiplicador: 1.5,  Ativo: true, Ordem: 5 }
];

/**
 * Canais de entrada padrão do Reclame Aqui.
 */
const DEFAULT_CANAIS = [
  { Id: 'CN001', Nome: 'Reclame Aqui',   Icone: '📢', Ativo: true, Ordem: 1 },
  { Id: 'CN002', Nome: 'Consumidor.gov', Icone: '🏛️', Ativo: true, Ordem: 2 },
  { Id: 'CN003', Nome: 'Procon',         Icone: '⚖️', Ativo: true, Ordem: 3 },
  { Id: 'CN004', Nome: 'Bacen',          Icone: '🏦', Ativo: true, Ordem: 4 },
  { Id: 'CN005', Nome: 'Susep',          Icone: '📋', Ativo: true, Ordem: 5 },
  { Id: 'CN006', Nome: 'ANS',            Icone: '🏥', Ativo: true, Ordem: 6 },
  { Id: 'CN007', Nome: 'Judicial',       Icone: '⚖️', Ativo: true, Ordem: 7 },
  { Id: 'CN008', Nome: 'Ouvidoria',      Icone: '📞', Ativo: true, Ordem: 8 }
];

/**
 * Tipos de atendimento padrão. Podem ser administrados pela supervisão.
 */
const DEFAULT_TIPOS_ATENDIMENTO = [
  { Id: 'TA001', Nome: 'Reclamação', Descricao: 'Manifestação de insatisfação do cliente', Ativo: true, Ordem: 1 },
  { Id: 'TA002', Nome: 'Solicitação', Descricao: 'Pedido de providência ou informação', Ativo: true, Ordem: 2 },
  { Id: 'TA003', Nome: 'Contestação', Descricao: 'Contestação de cobrança, decisão ou procedimento', Ativo: true, Ordem: 3 },
  { Id: 'TA004', Nome: 'Elogio', Descricao: 'Reconhecimento positivo do atendimento', Ativo: true, Ordem: 4 }
];

/**
 * Motivos de pendência padrão.
 * Utilizados quando o status muda para "Aguardando...".
 */
const DEFAULT_MOTIVOS_PENDENCIA = [
  { Id: 'MP001', Nome: 'Aguardando resposta da área técnica',       Descricao: 'Pendência com área técnica interna',         Ativo: true, Ordem: 1 },
  { Id: 'MP002', Nome: 'Aguardando documentação do cliente',        Descricao: 'Cliente precisa enviar documentos',           Ativo: true, Ordem: 2 },
  { Id: 'MP003', Nome: 'Aguardando aprovação da gestão',            Descricao: 'Pendente aprovação gerencial',                Ativo: true, Ordem: 3 },
  { Id: 'MP004', Nome: 'Aguardando retorno do cliente',             Descricao: 'Aguardando manifestação do consumidor',       Ativo: true, Ordem: 4 },
  { Id: 'MP005', Nome: 'Aguardando posição do jurídico',            Descricao: 'Pendência com departamento jurídico',         Ativo: true, Ordem: 5 },
  { Id: 'MP006', Nome: 'Aguardando correção sistêmica',             Descricao: 'Dependência de correção em sistema interno',  Ativo: true, Ordem: 6 },
  { Id: 'MP007', Nome: 'Aguardando análise de sinistro',            Descricao: 'Pendência na análise do sinistro',            Ativo: true, Ordem: 7 },
  { Id: 'MP008', Nome: 'Aguardando regulação',                      Descricao: 'Pendência no processo de regulação',          Ativo: true, Ordem: 8 }
];

/**
 * Parâmetros operacionais editáveis sem alteração de código.
 */
const DEFAULT_CONFIGURACOES = [
  { Chave: 'SLA_PADRAO_HORAS', Valor: '48', Descricao: 'SLA padrão quando nenhuma regra específica for encontrada.' },
  { Chave: 'ALERTA_SLA_HORAS', Valor: '4', Descricao: 'Antecedência, em horas úteis, para alerta de vencimento.' },
  { Chave: 'ALERTA_ESPERA_AREA_HORAS', Valor: '24', Descricao: 'Limite de espera por área antes de gerar alerta.' },
  { Chave: 'ALERTA_ESPERA_CLIENTE_DIAS', Valor: '3', Descricao: 'Limite de espera pelo cliente antes de gerar alerta.' },
  { Chave: 'HORA_UTIL_INICIO', Valor: '8', Descricao: 'Início do horário útil.' },
  { Chave: 'HORA_UTIL_FIM', Valor: '18', Descricao: 'Fim do horário útil.' }
];

/**
 * Produtos padrão da Porto Seguro.
 */
const DEFAULT_PRODUTOS = [
  { Id: 'PD001', Nome: 'Auto',             Descricao: 'Seguro Automóvel',           Ativo: true, Ordem: 1 },
  { Id: 'PD002', Nome: 'Residencial',      Descricao: 'Seguro Residencial',         Ativo: true, Ordem: 2 },
  { Id: 'PD003', Nome: 'Vida',             Descricao: 'Seguro de Vida',             Ativo: true, Ordem: 3 },
  { Id: 'PD004', Nome: 'Saúde',            Descricao: 'Plano de Saúde',             Ativo: true, Ordem: 4 },
  { Id: 'PD005', Nome: 'Odontológico',     Descricao: 'Plano Odontológico',         Ativo: true, Ordem: 5 },
  { Id: 'PD006', Nome: 'Consórcio',        Descricao: 'Consórcio',                  Ativo: true, Ordem: 6 },
  { Id: 'PD007', Nome: 'Cartão',           Descricao: 'Cartão Porto Bank',          Ativo: true, Ordem: 7 },
  { Id: 'PD008', Nome: 'Financiamento',    Descricao: 'Financiamento e Crédito',    Ativo: true, Ordem: 8 },
  { Id: 'PD009', Nome: 'Capitalização',    Descricao: 'Título de Capitalização',    Ativo: true, Ordem: 9 },
  { Id: 'PD010', Nome: 'Previdência',      Descricao: 'Previdência Privada',        Ativo: true, Ordem: 10 }
];

/**
 * Categorias padrão, vinculadas a produtos.
 */
const DEFAULT_CATEGORIAS = [
  // Auto
  { Id: 'CT001', ProdutoId: 'PD001', Nome: 'Sinistro',               Descricao: 'Reclamações sobre sinistros de auto',          Ativo: true, Ordem: 1 },
  { Id: 'CT002', ProdutoId: 'PD001', Nome: 'Cobrança',               Descricao: 'Problemas de cobrança de auto',                Ativo: true, Ordem: 2 },
  { Id: 'CT003', ProdutoId: 'PD001', Nome: 'Assistência 24h',        Descricao: 'Reclamações sobre assistência 24h',            Ativo: true, Ordem: 3 },
  { Id: 'CT004', ProdutoId: 'PD001', Nome: 'Cancelamento',           Descricao: 'Solicitações de cancelamento de auto',         Ativo: true, Ordem: 4 },
  // Residencial
  { Id: 'CT005', ProdutoId: 'PD002', Nome: 'Sinistro',               Descricao: 'Reclamações sobre sinistros residenciais',     Ativo: true, Ordem: 5 },
  { Id: 'CT006', ProdutoId: 'PD002', Nome: 'Cobrança',               Descricao: 'Problemas de cobrança residencial',           Ativo: true, Ordem: 6 },
  { Id: 'CT007', ProdutoId: 'PD002', Nome: 'Assistência',            Descricao: 'Reclamações sobre assistência residencial',    Ativo: true, Ordem: 7 },
  // Vida
  { Id: 'CT008', ProdutoId: 'PD003', Nome: 'Sinistro',               Descricao: 'Reclamações sobre sinistros de vida',          Ativo: true, Ordem: 8 },
  { Id: 'CT009', ProdutoId: 'PD003', Nome: 'Cobrança',               Descricao: 'Problemas de cobrança de vida',               Ativo: true, Ordem: 9 },
  // Saúde
  { Id: 'CT010', ProdutoId: 'PD004', Nome: 'Autorização',            Descricao: 'Problemas com autorizações de procedimentos', Ativo: true, Ordem: 10 },
  { Id: 'CT011', ProdutoId: 'PD004', Nome: 'Rede Credenciada',       Descricao: 'Reclamações sobre rede credenciada',          Ativo: true, Ordem: 11 },
  { Id: 'CT012', ProdutoId: 'PD004', Nome: 'Reembolso',              Descricao: 'Problemas com reembolsos',                    Ativo: true, Ordem: 12 },
  // Cartão
  { Id: 'CT013', ProdutoId: 'PD007', Nome: 'Contestação de compra',  Descricao: 'Contestações de compras no cartão',           Ativo: true, Ordem: 13 },
  { Id: 'CT014', ProdutoId: 'PD007', Nome: 'Cobrança indevida',      Descricao: 'Cobranças indevidas no cartão',               Ativo: true, Ordem: 14 },
  { Id: 'CT015', ProdutoId: 'PD007', Nome: 'Bloqueio/Desbloqueio',   Descricao: 'Problemas com bloqueio ou desbloqueio',       Ativo: true, Ordem: 15 },
  // Genérica
  { Id: 'CT016', ProdutoId: '',       Nome: 'Atendimento',            Descricao: 'Reclamações sobre qualidade do atendimento',  Ativo: true, Ordem: 16 },
  { Id: 'CT017', ProdutoId: '',       Nome: 'Outros',                 Descricao: 'Outras reclamações não categorizadas',        Ativo: true, Ordem: 17 }
];
