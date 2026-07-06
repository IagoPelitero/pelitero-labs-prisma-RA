/**
 * ============================================================================
 * PortoBank Reclame Aqui - Sistema de Gestão de Atendimentos
 * ============================================================================
 * Arquivo: Utils.gs
 * Descrição: Funções utilitárias compartilhadas por todo o sistema.
 *            Inclui geração de IDs, formatação de datas, validação de CPF,
 *            cálculo de horas úteis, conversão de dados e sanitização.
 * ============================================================================
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO (leia antes de mexer neste arquivo)
 * ------------------------------------------------------------------------
 * Pense neste arquivo como a "caixa de ferramentas" do sistema: funções
 * pequenas, sem regra de negócio, que qualquer outro arquivo pode usar
 * (Database.gs e Services.gs usam bastante coisa daqui).
 *
 * Não é preciso entender o sistema inteiro para editar este arquivo — cada
 * função aqui deveria fazer só UMA coisa simples (ex: "formatar uma data",
 * "validar um CPF"). Se perceber que uma função daqui está fazendo mais de
 * uma coisa ou dependendo de outras partes do sistema, ela provavelmente
 * deveria estar em Services.gs, não aqui.
 *
 * Tarefas comuns de manutenção:
 *   - Mudar o formato de exibição de data/hora → formatDate,
 *     formatDateTime.
 *   - Mudar a regra de validação de CPF → validateCPF.
 *   - Mudar o horário comercial considerado no cálculo de SLA →
 *     isBusinessDay, calculateBusinessHours, addBusinessHours (o
 *     horário em si vem de CONFIG.BUSINESS_HOUR_START/END em Config.gs).
 * ------------------------------------------------------------------------
 */

// ============================================================================
// GERAÇÃO DE IDs
// ============================================================================

/**
 * Gera um ID único com prefixo e número sequencial.
 * Formato: PREFIX-00001, PREFIX-00002, etc.
 * @param {string} prefix - Prefixo do ID (ex: 'RA', 'TL', 'HI')
 * @returns {string} ID gerado
 */
function generateId(prefix) {
  const timestamp = new Date().getTime();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${timestamp}${random}`;
}

/**
 * Obtém o próximo ID sequencial para uma planilha específica.
 * Lê o último ID existente e incrementa.
 * @param {string} sheetName - Nome da planilha
 * @param {string} prefix - Prefixo do ID
 * @returns {string} Próximo ID sequencial (ex: 'RA-00042')
 */
function getNextId(sheetName, prefix) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return `${prefix}-00001`;
    }
    
    // Lê todos os IDs da coluna A (exceto cabeçalho)
    const lastRow = sheet.getLastRow();
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    
    // Encontra o maior número sequencial
    let maxNum = 0;
    ids.forEach(function(row) {
      const id = String(row[0]);
      if (id.startsWith(prefix + '-')) {
        const num = parseInt(id.replace(prefix + '-', ''), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    
    return `${prefix}-${String(maxNum + 1).padStart(5, '0')}`;
  } catch (e) {
    // Fallback: usa timestamp se não conseguir ler a planilha
    Logger.log('Erro ao gerar próximo ID: ' + e.message);
    return generateId(prefix);
  }
}

// ============================================================================
// FORMATAÇÃO DE DATAS
// ============================================================================

/**
 * Formata uma data no padrão brasileiro DD/MM/YYYY.
 * @param {Date|string} date - Data a ser formatada
 * @returns {string} Data formatada ou string vazia se inválida
 */
function formatDate(date) {
  try {
    if (!date) return '';
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    
    return `${dia}/${mes}/${ano}`;
  } catch (e) {
    Logger.log('Erro ao formatar data: ' + e.message);
    return '';
  }
}

/**
 * Formata uma data e hora no padrão brasileiro DD/MM/YYYY HH:mm.
 * @param {Date|string} date - Data/hora a ser formatada
 * @returns {string} Data/hora formatada ou string vazia se inválida
 */
function formatDateTime(date) {
  try {
    if (!date) return '';
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    
    return `${dia}/${mes}/${ano} ${hora}:${min}`;
  } catch (e) {
    Logger.log('Erro ao formatar data/hora: ' + e.message);
    return '';
  }
}

/**
 * Converte uma string de data no formato DD/MM/YYYY ou DD/MM/YYYY HH:mm para Date.
 * @param {string} dateStr - String de data
 * @returns {Date|null} Objeto Date ou null se inválida
 */
function parseDate(dateStr) {
  try {
    if (!dateStr) return null;
    
    // Se já for Date, retorna diretamente
    if (dateStr instanceof Date) return dateStr;
    
    const str = String(dateStr).trim();
    
    // Formato DD/MM/YYYY ou DD/MM/YYYY HH:mm
    const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (match) {
      const dia = parseInt(match[1], 10);
      const mes = parseInt(match[2], 10) - 1;
      const ano = parseInt(match[3], 10);
      const hora = match[4] ? parseInt(match[4], 10) : 0;
      const min = match[5] ? parseInt(match[5], 10) : 0;
      return new Date(ano, mes, dia, hora, min);
    }
    
    // Tenta parse nativo como fallback
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    Logger.log('Erro ao parsear data: ' + e.message);
    return null;
  }
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
// CÁLCULO DE HORAS ÚTEIS (BUSINESS HOURS)
// ============================================================================

/**
 * Verifica se um dia é dia útil (segunda a sexta, exceto feriados).
 * Nota: não considera feriados nacionais/regionais nesta versão.
 * @param {Date} date - Data a verificar
 * @returns {boolean} true se é dia útil
 */
function isBusinessDay(date) {
  const dayOfWeek = date.getDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5; // Segunda (1) a Sexta (5)
}

/**
 * Calcula horas úteis entre duas datas.
 * Considera apenas dias úteis (seg-sex) e horário comercial
 * definido em CONFIG.BUSINESS_HOUR_START e CONFIG.BUSINESS_HOUR_END.
 * @param {Date} startDate - Data/hora de início
 * @param {Date} endDate - Data/hora de fim
 * @returns {number} Total de horas úteis (com decimais)
 */
function calculateBusinessHours(startDate, endDate) {
  try {
    if (!startDate || !endDate) return 0;
    
    const start = (startDate instanceof Date) ? new Date(startDate) : new Date(startDate);
    const end = (endDate instanceof Date) ? new Date(endDate) : new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    if (end <= start) return 0;
    
    const horaInicio = CONFIG.BUSINESS_HOUR_START;
    const horaFim = CONFIG.BUSINESS_HOUR_END;
    const horasPorDia = horaFim - horaInicio;
    
    let totalMinutos = 0;
    const current = new Date(start);
    
    while (current < end) {
      if (isBusinessDay(current)) {
        // Determina início efetivo no dia
        let diaInicio = new Date(current);
        diaInicio.setHours(horaInicio, 0, 0, 0);
        
        let diaFim = new Date(current);
        diaFim.setHours(horaFim, 0, 0, 0);
        
        // Ajusta para o período de trabalho
        const efInicio = new Date(Math.max(current.getTime(), diaInicio.getTime()));
        const efFim = new Date(Math.min(end.getTime(), diaFim.getTime()));
        
        if (efFim > efInicio && efInicio < diaFim && efFim > diaInicio) {
          totalMinutos += (efFim.getTime() - efInicio.getTime()) / (1000 * 60);
        }
      }
      
      // Avança para o próximo dia
      current.setDate(current.getDate() + 1);
      current.setHours(horaInicio, 0, 0, 0);
    }
    
    return Math.round((totalMinutos / 60) * 100) / 100;
  } catch (e) {
    Logger.log('Erro ao calcular horas úteis: ' + e.message);
    return 0;
  }
}

/**
 * Adiciona horas úteis a uma data, retornando a data/hora resultante.
 * @param {Date} startDate - Data/hora de início
 * @param {number} hours - Número de horas úteis a adicionar
 * @returns {Date} Data/hora resultante
 */
function addBusinessHours(startDate, hours) {
  try {
    if (!startDate || !hours || hours <= 0) return startDate;
    
    const start = (startDate instanceof Date) ? new Date(startDate) : new Date(startDate);
    if (isNaN(start.getTime())) return startDate;
    
    const horaInicio = CONFIG.BUSINESS_HOUR_START;
    const horaFim = CONFIG.BUSINESS_HOUR_END;
    const horasPorDia = horaFim - horaInicio;
    
    let minutosRestantes = hours * 60;
    const current = new Date(start);
    
    // Ajusta se o início estiver fora do horário comercial
    if (current.getHours() < horaInicio) {
      current.setHours(horaInicio, 0, 0, 0);
    } else if (current.getHours() >= horaFim) {
      // Move para o próximo dia útil
      current.setDate(current.getDate() + 1);
      current.setHours(horaInicio, 0, 0, 0);
      while (!isBusinessDay(current)) {
        current.setDate(current.getDate() + 1);
      }
    }
    
    // Avança até encontrar dia útil
    while (!isBusinessDay(current)) {
      current.setDate(current.getDate() + 1);
      current.setHours(horaInicio, 0, 0, 0);
    }
    
    while (minutosRestantes > 0) {
      if (isBusinessDay(current)) {
        const fimDoDia = new Date(current);
        fimDoDia.setHours(horaFim, 0, 0, 0);
        
        const minutosDisponiveisHoje = (fimDoDia.getTime() - current.getTime()) / (1000 * 60);
        
        if (minutosRestantes <= minutosDisponiveisHoje) {
          current.setTime(current.getTime() + minutosRestantes * 60 * 1000);
          minutosRestantes = 0;
        } else {
          minutosRestantes -= minutosDisponiveisHoje;
          current.setDate(current.getDate() + 1);
          current.setHours(horaInicio, 0, 0, 0);
        }
      } else {
        current.setDate(current.getDate() + 1);
        current.setHours(horaInicio, 0, 0, 0);
      }
    }
    
    return current;
  } catch (e) {
    Logger.log('Erro ao adicionar horas úteis: ' + e.message);
    return startDate;
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
      if (val instanceof Date) return val;
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
// INFORMAÇÕES DO USUÁRIO
// ============================================================================

/**
 * Obtém o e-mail do usuário atual logado.
 * @returns {string} E-mail do usuário ou string vazia
 */
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    Logger.log('Erro ao obter e-mail do usuário: ' + e.message);
    return '';
  }
}

/**
 * Obtém o nome de exibição do usuário atual.
 * Primeiro tenta buscar na planilha Usuarios, depois usa o e-mail.
 * @returns {string} Nome do usuário
 */
function getCurrentUserName() {
  try {
    const email = getCurrentUserEmail();
    if (!email) return 'Sistema';
    
    // Tenta buscar na planilha de Usuarios
    const usuarios = getAll(CONFIG.SHEET_NAMES.USUARIOS);
    const usuario = usuarios.find(function(u) {
      return u.Email === email;
    });
    
    if (usuario && usuario.Nome) {
      return usuario.Nome;
    }
    
    // Fallback: usa a parte antes do @ do e-mail
    return email.split('@')[0];
  } catch (e) {
    Logger.log('Erro ao obter nome do usuário: ' + e.message);
    return 'Sistema';
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

/**
 * Verifica se uma string está vazia ou contém apenas espaços.
 * @param {*} val - Valor a verificar
 * @returns {boolean} true se vazio
 */
function isEmpty(val) {
  return val === null || val === undefined || String(val).trim() === '';
}

/**
 * Compara duas datas ignorando horário.
 * @param {Date} date1 - Primeira data
 * @param {Date} date2 - Segunda data
 * @returns {boolean} true se são o mesmo dia
 */
function isSameDay(date1, date2) {
  try {
    if (!date1 || !date2) return false;
    const d1 = (date1 instanceof Date) ? date1 : new Date(date1);
    const d2 = (date2 instanceof Date) ? date2 : new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  } catch (e) {
    return false;
  }
}

/**
 * Retorna a data de hoje (sem horário) no timezone do script.
 * @returns {Date} Data de hoje às 00:00:00
 */
function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

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

/**
 * Calcula a diferença em dias entre duas datas.
 * @param {Date} startDate - Data inicial
 * @param {Date} endDate - Data final
 * @returns {number} Diferença em dias
 */
function diffInDays(startDate, endDate) {
  try {
    if (!startDate || !endDate) return 0;
    const start = (startDate instanceof Date) ? startDate : new Date(startDate);
    const end = (endDate instanceof Date) ? endDate : new Date(endDate);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  } catch (e) {
    return 0;
  }
}

/**
 * Retorna o número da semana ISO do ano para uma data.
 * @param {Date} date - Data
 * @returns {number} Número da semana (1-53)
 */
function getWeekNumber(date) {
  try {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  } catch (e) {
    return 0;
  }
}
