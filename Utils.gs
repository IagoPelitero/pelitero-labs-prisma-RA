/**
 * ============================================================================
 * Pelitero Labs Prisma RA — Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Utils.gs
 * Descrição: Funções utilitárias compartilhadas por todo o sistema.
 *            Geração de IDs, validação/formatação de CPF, sanitização,
 *            conversão objeto <-> linha da planilha e diferença de horas.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Pense neste arquivo como a "caixa de ferramentas" do sistema: funções
 * pequenas, sem regra de negócio, que qualquer outro arquivo pode usar.
 * Cada função aqui deveria fazer só UMA coisa simples. Se perceber que uma
 * função está dependendo de outras partes do sistema, ela provavelmente
 * deveria estar em Services.gs, não aqui.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// GERAÇÃO DE IDs
// ============================================================================

/**
 * Gera um ID único com prefixo, timestamp e sufixo aleatório.
 * @param {string} prefix - Prefixo do ID (ex: 'ATD', 'TL', 'HIS')
 * @returns {string} ID gerado
 */
function generateId(prefix) {
  const timestamp = new Date().getTime();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${timestamp}${random}`;
}

// ============================================================================
// FORMATAÇÃO E VALIDAÇÃO DE CPF
// ============================================================================

/**
 * Formata um CPF no padrão XXX.XXX.XXX-XX.
 * Remove caracteres não numéricos antes de formatar.
 * @param {string} cpf - CPF a ser formatado
 * @returns {string} CPF formatado ou string original se inválido
 */
function formatCPF(cpf) {
  try {
    if (!cpf) return '';
    const nums = String(cpf).replace(/\D/g, '');
    if (nums.length !== 11) return String(cpf);
    return `${nums.substr(0, 3)}.${nums.substr(3, 3)}.${nums.substr(6, 3)}-${nums.substr(9, 2)}`;
  } catch (e) {
    Logger.log('Erro ao formatar CPF: ' + e.message);
    return String(cpf);
  }
}

/**
 * Valida um CPF verificando os dígitos verificadores.
 * @param {string} cpf - CPF a ser validado (com ou sem formatação)
 * @returns {boolean} true se o CPF é válido
 */
function validateCPF(cpf) {
  try {
    if (!cpf) return false;
    const nums = String(cpf).replace(/\D/g, '');

    // Verifica se tem 11 dígitos
    if (nums.length !== 11) return false;

    // Verifica se todos os dígitos são iguais (ex: 111.111.111-11)
    if (/^(\d)\1{10}$/.test(nums)) return false;

    // Valida primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
      soma += parseInt(nums.charAt(i), 10) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(nums.charAt(9), 10)) return false;

    // Valida segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
      soma += parseInt(nums.charAt(i), 10) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(nums.charAt(10), 10)) return false;

    return true;
  } catch (e) {
    Logger.log('Erro ao validar CPF: ' + e.message);
    return false;
  }
}

// ============================================================================
// SANITIZAÇÃO
// ============================================================================

/**
 * Sanitiza uma string removendo tags HTML e caracteres perigosos.
 * @param {string} str - String a ser sanitizada
 * @returns {string} String sanitizada
 */
function sanitizeInput(str) {
  try {
    if (str === null || str === undefined) return '';
    let s = String(str);
    // Remove tags HTML
    s = s.replace(/<[^>]*>/g, '');
    // Neutraliza delimitadores que poderiam romper atributos HTML legados.
    s = s.replace(/[<>]/g, '').replace(/"/g, '”');
    // Remove caracteres de controle, mantendo quebras de linha
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Trim espaços extras
    s = s.trim();
    return s;
  } catch (e) {
    Logger.log('Erro ao sanitizar input: ' + e.message);
    return '';
  }
}

// ============================================================================
// CONVERSÃO DE DADOS (OBJETO <-> ARRAY)
// ============================================================================

/**
 * Converte um objeto para um array de valores, na ordem das colunas definidas.
 * Utilizado para gravar dados na planilha.
 * @param {Object} obj - Objeto com os dados
 * @param {string[]} columns - Array de nomes das colunas na ordem correta
 * @returns {Array} Array de valores na ordem das colunas
 */
function toRowArray(obj, columns) {
  try {
    if (!obj || !columns) return [];
    return columns.map(function(col) {
      const val = obj[col];
      if (val === undefined || val === null) return '';
      return val;
    });
  } catch (e) {
    Logger.log('Erro ao converter objeto para array: ' + e.message);
    return [];
  }
}

/**
 * Converte um array de valores (linha da planilha) para um objeto,
 * usando os nomes das colunas como chaves.
 * @param {Array} row - Array de valores da linha
 * @param {string[]} columns - Array de nomes das colunas na ordem correta
 * @returns {Object} Objeto com os dados
 */
function toObject(row, columns) {
  try {
    if (!row || !columns) return {};
    const obj = {};
    columns.forEach(function(col, index) {
      obj[col] = (index < row.length) ? row[index] : '';
    });
    return obj;
  } catch (e) {
    Logger.log('Erro ao converter array para objeto: ' + e.message);
    return {};
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

/**
 * Calcula a diferença em horas entre duas datas.
 * @param {Date} startDate - Data inicial
 * @param {Date} endDate - Data final
 * @returns {number} Diferença em horas (com decimais)
 */
function diffInHours(startDate, endDate) {
  try {
    if (!startDate || !endDate) return 0;
    const start = (startDate instanceof Date) ? startDate : new Date(startDate);
    const end = (endDate instanceof Date) ? endDate : new Date(endDate);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  } catch (e) {
    return 0;
  }
}
