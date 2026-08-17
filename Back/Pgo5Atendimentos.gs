/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Atendimentos do PGO 5.0
 * ============================================================================
 * Arquivo: Pgo5Atendimentos.gs
 * Descrição: Motor de formulário no servidor — validação dos tipos de campo,
 *            gravação dos campos estruturais na aba Atendimentos e dos campos
 *            dinâmicos em ValoresAtendimento, além do CRUD completo.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ------------------------------------------------------------------------
 * GUIA PARA QUEM ESTÁ COMEÇANDO
 * ------------------------------------------------------------------------
 * Um atendimento tem duas metades:
 *
 *   1. CAMPOS ESTRUTURAIS → colunas próprias na aba Atendimentos
 *      (Data, Protocolo, Produto, Categoria, Status, Responsável…).
 *   2. CAMPOS DINÂMICOS   → linhas na aba ValoresAtendimento
 *      (Cliente, CPF, Resumo e qualquer campo criado depois pelo ADM).
 *
 * Quem decide em qual metade um campo cai é a tabela PGO5_CAMPOS_ESTRUTURAIS
 * (Pgo5Catalogo.gs), a partir do "Nome" do campo. Criar um campo novo nunca
 * cria uma coluna nova.
 *
 * O front NUNCA é fonte de verdade: tudo o que chega é revalidado aqui.
 * ------------------------------------------------------------------------
 */

// ============================================================================
// VALIDAÇÃO E NORMALIZAÇÃO POR TIPO DE CAMPO
// ============================================================================

/**
 * Valida e normaliza o valor de UM campo conforme o seu tipo.
 *
 * Devolve sempre o valor já no formato que vai para a planilha:
 *   - multiselect → JSON de array (ex.: ["00000001","00000002"]);
 *   - checkbox    → booleano;
 *   - number/decimal/moeda/percentual → número;
 *   - integer     → número inteiro;
 *   - demais      → texto sanitizado.
 *
 * @param {Object} campo - Campo do catálogo (pgo5CamposDoCanal_).
 * @param {*} valor - Valor cru vindo do formulário.
 * @returns {Object} { ok, valor, erro }.
 */
function pgo5NormalizarValorCampo_(campo, valor) {
  const rotulo = campo.rotulo || campo.nome;
  const tipo = campo.tipo;

  // Ausência: aplica o valor padrão antes de decidir se falta algo.
  let bruto = valor;
  const vazio = bruto === undefined || bruto === null ||
    (typeof bruto === 'string' && bruto.trim() === '') ||
    (Array.isArray(bruto) && bruto.length === 0);

  if (vazio && campo.valorPadrao !== '') bruto = campo.valorPadrao;

  const aindaVazio = bruto === undefined || bruto === null ||
    (typeof bruto === 'string' && String(bruto).trim() === '') ||
    (Array.isArray(bruto) && bruto.length === 0);

  if (aindaVazio) {
    if (campo.obrigatorio && tipo !== 'checkbox') {
      return { ok: false, valor: '', erro: 'Informe "' + rotulo + '".' };
    }
    // checkbox vazio = não marcado
    return { ok: true, valor: tipo === 'checkbox' ? false : '', erro: '' };
  }

  switch (tipo) {
    case 'number':
    case 'decimal':
    case 'moeda':
    case 'percentual': {
      const n = pgo5ParaNumero_(bruto);
      if (n === null) return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser um número.' };
      if (tipo === 'percentual' && (n < 0 || n > 100)) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve estar entre 0 e 100.' };
      }
      if (tipo === 'moeda' && n < 0) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" não pode ser negativo.' };
      }
      return { ok: true, valor: n, erro: '' };
    }
    case 'integer': {
      const n = pgo5ParaNumero_(bruto);
      if (n === null || Math.floor(n) !== n) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser um número inteiro.' };
      }
      return { ok: true, valor: n, erro: '' };
    }
    case 'date': {
      const t = String(bruto).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser uma data válida.' };
      }
      return { ok: true, valor: t, erro: '' };
    }
    case 'datetime': {
      const t = String(bruto).trim();
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(t)) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser uma data e hora válidas.' };
      }
      return { ok: true, valor: t.replace(' ', 'T'), erro: '' };
    }
    case 'time': {
      const t = String(bruto).trim();
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(t)) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser um horário válido (HH:MM).' };
      }
      return { ok: true, valor: t, erro: '' };
    }
    case 'checkbox': {
      return { ok: true, valor: isTrue_(bruto), erro: '' };
    }
    case 'multiselect': {
      const lista = Array.isArray(bruto) ? bruto : String(bruto).split(';');
      const ids = lista.map(function(v) { return String(v).trim(); })
        .filter(function(v) { return v !== ''; });
      if (campo.opcoes.length > 0) {
        const validos = {};
        campo.opcoes.forEach(function(o) { validos[o.id] = true; });
        const invalido = ids.find(function(v) { return !validos[v]; });
        if (invalido) {
          return { ok: false, valor: '', erro: 'Opção inválida em "' + rotulo + '".' };
        }
      }
      // Determinístico: JSON de array, sempre na ordem enviada.
      return { ok: true, valor: JSON.stringify(ids), erro: '' };
    }
    case 'select':
    case 'radio': {
      const v = String(bruto).trim();
      // Campos estruturais (produto, status…) validam contra o catálogo no
      // momento da montagem do atendimento, não aqui.
      if (!campo.estrutural && campo.opcoes.length > 0) {
        const existe = campo.opcoes.some(function(o) { return o.id === v; });
        if (!existe) return { ok: false, valor: '', erro: 'Opção inválida em "' + rotulo + '".' };
      }
      return { ok: true, valor: v, erro: '' };
    }
    case 'email': {
      const v = String(bruto).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ser um e-mail válido.' };
      }
      return { ok: true, valor: v, erro: '' };
    }
    case 'telefone': {
      const digitos = String(bruto).replace(/\D/g, '');
      if (digitos.length < 10 || digitos.length > 11) {
        return { ok: false, valor: '', erro: '"' + rotulo + '" deve ter DDD e 8 ou 9 dígitos.' };
      }
      return { ok: true, valor: digitos, erro: '' };
    }
    case 'cpf':
    case 'protocolo': {
      // REGRA DO PGO 5.0 (definida pelo PO): CPF e Protocolo são
      // IDENTIFICADORES DIGITADOS pelo operador, não números.
      //
      //   - aceitam qualquer sequência só de dígitos: "0", "00",
      //     "01234567890" são todos válidos;
      //   - NÃO passam por cálculo de dígito verificador. O operador copia o
      //     que veio do canal de atendimento e nem sempre é um CPF completo;
      //   - são guardados como TEXTO. Virar Number comeria os zeros à
      //     esquerda e "00123" viraria 123, perdendo o identificador;
      //   - qualquer caractere que não seja dígito é recusado — letras,
      //     ponto, hífen e barra inclusive.
      //
      // Atenção a "0": é um valor VÁLIDO. Nunca teste com `if (!valor)`,
      // porque "0" é falsy em JavaScript. Compare com '' explicitamente.
      const texto = String(bruto === undefined || bruto === null ? '' : bruto).trim();
      if (!/^[0-9]+$/.test(texto)) {
        return { ok: false, valor: '',
          erro: '"' + rotulo + '" deve conter apenas números.' };
      }
      return { ok: true, valor: texto, erro: '' };
    }
    default: {
      return { ok: true, valor: sanitizeInput(bruto), erro: '' };
    }
  }
}

/**
 * Converte texto em número aceitando os formatos que o usuário digita
 * ("1.234,56" e "1234.56").
 * @param {*} valor - Valor cru.
 * @returns {number|null} Número, ou null se não for numérico.
 */
function pgo5ParaNumero_(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : null;
  let t = String(valor).trim().replace(/[R$%\s]/g, '');
  if (t === '') return null;
  // "1.234,56" → "1234.56";  "1234.56" fica como está.
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return isFinite(n) ? n : null;
}

// ============================================================================
// RESPONSÁVEL × CRIADOR
// ============================================================================

/**
 * Decide qual usuário fica como RESPONSÁVEL.
 *
 * Quem pode delegar — e para quem — vem do ESCOPO DE DELEGAÇÃO do nível de
 * acesso, nunca do cargo (ver obterEscopoDelegacao_ em Pgo5Permissoes.gs):
 *
 *   NENHUM → sempre ele mesmo (não delega).
 *   EQUIPE → ele mesmo, ou alguém da sua hierarquia.
 *   TODOS  → ele mesmo, ou qualquer usuário ativo.
 *
 * CriadoPorId é sempre quem executa a criação e nunca muda depois — quem
 * chama esta função trata disso.
 *
 * @param {Object} ator - Ator autenticado (getActor_).
 * @param {string} responsavelSolicitado - Id pedido pelo formulário (opcional).
 * @returns {string} Id do responsável aprovado.
 * @throws {Error} Quando a delegação não é permitida.
 */
function pgo5ResolverResponsavel_(ator, responsavelSolicitado) {
  const pedido = String(responsavelSolicitado || '').trim();
  if (!pedido || pedido === String(ator.id)) return String(ator.id);

  // Quem pode delegar — e para quem — é decidido pelo NÍVEL DE ACESSO,
  // nunca pelo cargo. Ver Pgo5Permissoes.gs.
  const escopo = obterEscopoDelegacao_(atorComoUsuario_(ator));
  if (escopo === 'NENHUM') {
    throw new Error('Você não pode atribuir o atendimento a outro usuário.');
  }

  const alvo = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).find(function(u) {
    return String(u.Id || '').trim().toUpperCase() === pedido.toUpperCase() && isTrue_(u.Ativo);
  });
  if (!alvo) throw new Error('O usuário escolhido como responsável não está ativo.');

  if (escopo === 'TODOS') return String(alvo.Id);

  // delegarEquipe: apenas quem está abaixo do ator na HIERARQUIA. A coluna
  // Equipe é organizacional e de propósito não entra nesta decisão.
  if (!usuarioEstaNaHierarquia_(ator.id, alvo.Id)) {
    throw new Error('Você só pode atribuir atendimentos a usuários da sua equipe.');
  }
  return String(alvo.Id);
}

/**
 * Usuários que o ator pode escolher como responsável, já no formato do
 * seletor. Analista recebe apenas ele mesmo.
 * @param {Object} ator - Ator autenticado.
 * @returns {Object[]} [{ id, rotulo }].
 */
function pgo5ResponsaveisElegiveis_(ator) {
  const todos = pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).filter(function(u) { return isTrue_(u.Ativo); });
  const eu = todos.find(function(u) { return String(u.Id).toUpperCase() === String(ator.id).toUpperCase(); });
  const comoItem = function(u) { return { id: String(u.Id || ''), rotulo: String(u.Nome || '') }; };
  const porNome = function(a, b) { return a.rotulo.localeCompare(b.rotulo, 'pt-BR'); };

  const escopo = obterEscopoDelegacao_(atorComoUsuario_(ator));
  if (escopo === 'NENHUM') return eu ? [comoItem(eu)] : [];
  if (escopo === 'TODOS') return todos.map(comoItem).sort(porNome);

  // delegarEquipe: o próprio ator mais toda a árvore subordinada a ele.
  const subordinados = obterSubordinadosDaHierarquia_(ator.id);
  return todos.filter(function(u) {
    const id = String(u.Id).toUpperCase();
    return id === String(ator.id).toUpperCase() || subordinados.indexOf(id) !== -1;
  }).map(comoItem).sort(porNome);
}

// ============================================================================
// MONTAGEM DO ATENDIMENTO A PARTIR DO FORMULÁRIO
// ============================================================================

/**
 * Percorre os campos do canal, valida cada valor e separa o que vai para as
 * colunas de Atendimentos do que vai para ValoresAtendimento.
 *
 * @param {string} canalId - Canal escolhido.
 * @param {Object} valores - { <nomeDoCampo>: valor } vindo do formulário.
 * @param {Object} catalogo - Catálogo já lido.
 * @returns {Object} { estrutural, dinamicos, erros }.
 */
function pgo5MontarAtendimento_(canalId, valores, catalogo) {
  const campos = pgo5CamposDoCanal_(canalId, catalogo);
  const entrada = valores || {};
  const estrutural = {};
  const dinamicos = [];
  const erros = [];

  campos.forEach(function(campo) {
    // O canal já foi escolhido na tela anterior: se alguém configurar um
    // campo "canal", ele é ignorado para não pedir a mesma coisa duas vezes.
    if (campo.nome === 'canal') return;

    const r = pgo5NormalizarValorCampo_(campo, entrada[campo.nome]);
    if (!r.ok) { erros.push(r.erro); return; }

    if (campo.estrutural) {
      estrutural[campo.colunaEstrutural] = r.valor;
    } else {
      dinamicos.push({
        campoId: campo.id,
        valor: r.valor,
        // Snapshots: preservam a leitura do dado mesmo que o campo seja
        // excluído fisicamente da configuração mais tarde.
        rotuloSnapshot: campo.rotulo,
        tipoSnapshot: campo.tipo
      });
    }
  });

  return { estrutural: estrutural, dinamicos: dinamicos, erros: erros };
}

/**
 * Monta o mapa "Id do status" → "Nome técnico".
 *
 * O rótulo é o que aparece na tela e o administrador pode trocá-lo quando
 * quiser; o Nome é a chave estável que o sistema usa para decidir
 * comportamento. Este mapa existe para a interface receber essa chave junto
 * com o atendimento, em vez de tentar adivinhar pelo texto exibido.
 *
 * Sai do catálogo já lido — nenhuma lista de status é criada aqui.
 *
 * @param {Object} [catalogo] Catálogo já carregado (evita reler a aba).
 * @returns {Object} { '0000001F': 'Pendente', ... }.
 */
function pgo5MapaNomeTecnicoDeStatus_(catalogo) {
  const mapa = {};
  const cat = catalogo || pgo5CatalogoBruto_();
  (cat[PGO5_TIPOS.STATUS] || []).forEach(function(registro) {
    mapa[String(registro.Id || '').trim()] = String(registro.Nome || '');
  });
  return mapa;
}

/**
 * Diz se um Id de status corresponde ao status PENDENTE.
 *
 * COMO O PENDENTE É IDENTIFICADO
 * Pelo NOME TÉCNICO do registro no catálogo, não pelo rótulo que aparece
 * na tela. O administrador pode renomear "Pendente" para "Aguardando
 * Análise" — nesse caso o Rotulo muda, mas o Nome continua 'Pendente'
 * (ver pgo5StatusIniciais_ em Pgo5Catalogo.gs). Comparar o rótulo faria a
 * regra parar de valer no dia em que alguém renomeasse o status.
 *
 * Não existe segunda lista de status aqui: a fonte continua sendo o
 * catálogo do banco.
 *
 * @param {string} statusId Id do status a verificar.
 * @param {Object} [catalogo] Catálogo já lido (evita reler a aba).
 * @returns {boolean} true quando o status é o Pendente.
 */
function pgo5StatusEhPendente_(statusId, catalogo) {
  const id = String(statusId || '').trim();
  if (!id) return false;

  const status = pgo5Status_(catalogo).find(function(s) { return s.id === id; });
  if (!status) return false;

  return normalizeText_(status.nome) === 'pendente';
}

/**
 * Apaga o "Aguardando Retorno" quando o status não é mais Pendente.
 *
 * POR QUE LIMPAR NO BANCO, E NÃO SÓ ESCONDER NA TELA
 * Se o valor continuasse gravado, ele voltaria a aparecer no dia em que o
 * atendimento fosse reaberto como Pendente — mostrando "Aguardando: Área"
 * de um aguardo que terminou há semanas. Apagar na hora da mudança deixa o
 * dado coerente com o que a operação realmente está esperando.
 *
 * Altera apenas AguardandoRetornoId. Responsável, criador e os demais
 * campos não são tocados aqui.
 *
 * @param {Object} estrutural Colunas já montadas (alterado aqui).
 * @param {Object} [catalogo] Catálogo já lido.
 * @returns {void}
 */
function aplicarRegraDeAguardandoRetorno_(estrutural, atendimentoAtual, catalogo) {
  // STATUS EFETIVO: o que veio no formulário quando veio, senão o que já
  // está gravado. Cada canal decide quais campos pergunta, então o payload
  // pode chegar sem StatusId — e concluir "não é Pendente" a partir de um
  // campo ausente apagaria um aguardo perfeitamente válido.
  const statusEfetivo = String(estrutural.StatusId || '').trim() ||
    String((atendimentoAtual && atendimentoAtual.StatusId) || '').trim();

  if (pgo5StatusEhPendente_(statusEfetivo, catalogo)) return;

  // Fora do Pendente o campo tem de ficar vazio — inclusive quando o canal
  // não pergunta "Aguardando" e o valor antigo continuaria gravado.
  estrutural.AguardandoRetornoId = '';
}

// ============================================================================
// CRUD DE ATENDIMENTOS
// ============================================================================

/**
 * Cria um atendimento no PGO 5.0.
 *
 * ATOMICIDADE: o atendimento e todos os seus valores dinâmicos são gravados
 * dentro da MESMA trava. Se qualquer valor falhar, o que já foi gravado é
 * desfeito (o atendimento e os valores daquela operação) e o erro sobe —
 * nunca fica um registro pela metade em silêncio.
 *
 * @param {Object} dados - { canalId, valores:{...}, responsavelId }.
 * @returns {Object} { success, id }.
 */
function criarAtendimentoPGO5(dados) {
  const ator = exigirPermissao_('criarAtendimento');
  const entrada = dados || {};
  const canalId = String(entrada.canalId || '').trim();

  const catalogo = pgo5CatalogoBruto_();
  const canal = pgo5Canais_(catalogo).find(function(c) { return c.id === canalId; });
  if (!canal) throw new Error('Selecione um canal válido para registrar o atendimento.');

  const montado = pgo5MontarAtendimento_(canalId, entrada.valores, catalogo);
  if (montado.erros.length > 0) throw new Error(montado.erros.join(' '));

  // Atendimento novo não tem estado anterior: o status efetivo é o do
  // formulário. Ver aplicarRegraDeAguardandoRetorno_.
  aplicarRegraDeAguardandoRetorno_(montado.estrutural, null, catalogo);

  const responsavelId = pgo5ResolverResponsavel_(ator, entrada.responsavelId ||
    montado.estrutural.ResponsavelId);
  const agora = toIso_(new Date());

  return withScriptLock_(function() {
    const linha = Object.assign({}, montado.estrutural, {
      CanalId: canalId,
      ResponsavelId: responsavelId,
      CriadoPorId: String(ator.id),      // nunca muda depois
      DataCriacao: agora,
      AtualizadoPorId: String(ator.id),
      DataAtualizacao: agora
    });

    const atendimento = pgo5Inserir(PGO5.SHEET_NAMES.ATENDIMENTOS, linha);
    const criados = [];
    try {
      montado.dinamicos.forEach(function(d) {
        const v = pgo5Inserir(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, {
          AtendimentoId: atendimento.Id,
          CampoId: d.campoId,
          Valor: d.valor,
          RotuloSnapshot: d.rotuloSnapshot,
          TipoSnapshot: d.tipoSnapshot
        });
        criados.push(v.Id);
      });
    } catch (e) {
      // Rollback simples: desfaz esta operação inteira.
      criados.forEach(function(id) {
        try { pgo5ExcluirPorId(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, id); } catch (x) { /* segue */ }
      });
      try { pgo5ExcluirPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimento.Id); } catch (x) { /* segue */ }
      throw new Error('Não foi possível salvar os campos do atendimento. Nada foi gravado. (' + e.message + ')');
    }

    return { success: true, id: atendimento.Id };
  });
}

/**
 * Atualiza um atendimento existente.
 *
 * - CriadoPorId e DataCriacao NUNCA mudam;
 * - AtualizadoPorId e DataAtualizacao são sempre atualizados;
 * - não é pedida justificativa;
 * - valores dinâmicos de campos que saíram do formulário são PRESERVADOS
 *   (não somem só porque a tela foi aberta e salva).
 *
 * @param {string} id - Id do atendimento.
 * @param {Object} dados - { valores:{...}, responsavelId }.
 * @returns {Object} { success, id }.
 */
function atualizarAtendimentoPGO5(id, dados) {
  const ator = requireAuth_();
  const atendimentoId = String(id || '').trim();
  const entrada = dados || {};

  const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId);
  if (!atual) throw new Error('Atendimento não encontrado.');
  pgo5AssertPodeAcessar_(ator, atual, 'editar');

  const canalId = String(atual.CanalId || '').trim();
  const catalogo = pgo5CatalogoBruto_();
  const montado = pgo5MontarAtendimento_(canalId, entrada.valores, catalogo);
  if (montado.erros.length > 0) throw new Error(montado.erros.join(' '));

  // Na edição o registro atual entra na conta: se o formulário deste canal
  // não pergunta o status, vale o que já está gravado.
  aplicarRegraDeAguardandoRetorno_(montado.estrutural, atual, catalogo);

  // A regra de delegação só vale quando o responsável REALMENTE muda.
  // Sem isso, um Supervisor não conseguiria sequer salvar a observação de um
  // atendimento cujo responsável é o ADM — ele não estaria delegando nada,
  // apenas mantendo quem já estava lá.
  const atualResponsavel = String(atual.ResponsavelId || '').trim();
  const solicitado = String(entrada.responsavelId || montado.estrutural.ResponsavelId ||
    atualResponsavel).trim();
  const responsavelId = (solicitado.toUpperCase() === atualResponsavel.toUpperCase())
    ? atualResponsavel
    : pgo5ResolverResponsavel_(ator, solicitado);

  return withScriptLock_(function() {
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId,
      Object.assign({}, montado.estrutural, {
        ResponsavelId: responsavelId,
        AtualizadoPorId: String(ator.id),
        DataAtualizacao: toIso_(new Date())
        // CanalId, CriadoPorId e DataCriacao ficam de fora de propósito.
      }));

    // Valores dinâmicos: atualiza os que vieram, insere os que faltam e
    // NÃO remove os históricos que não pertencem mais ao formulário ativo.
    const existentes = pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).filter(function(v) {
      return String(v.AtendimentoId || '').trim().toUpperCase() === atendimentoId.toUpperCase();
    });
    const porCampo = {};
    existentes.forEach(function(v) { porCampo[String(v.CampoId || '').toUpperCase()] = v; });

    montado.dinamicos.forEach(function(d) {
      const anterior = porCampo[String(d.campoId).toUpperCase()];
      if (anterior) {
        pgo5AtualizarPorId(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, anterior.Id, {
          Valor: d.valor, RotuloSnapshot: d.rotuloSnapshot, TipoSnapshot: d.tipoSnapshot
        });
      } else {
        pgo5Inserir(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, {
          AtendimentoId: atendimentoId, CampoId: d.campoId, Valor: d.valor,
          RotuloSnapshot: d.rotuloSnapshot, TipoSnapshot: d.tipoSnapshot
        });
      }
    });

    return { success: true, id: atendimentoId };
  });
}

/**
 * Altera SOMENTE o Status (e o "Aguardando Retorno") de um atendimento.
 *
 * Existe separada de atualizarAtendimentoPGO5 porque a troca rápida pelo
 * Dashboard não passa pelo formulário: revalidar todos os campos
 * obrigatórios ali impediria mudar o status de um registro que ainda está
 * incompleto. Aqui só o que foi pedido é tocado.
 *
 * Grava o ID do status, nunca o texto. Não altera CriadoPorId,
 * ResponsavelId nem qualquer outro dado.
 *
 * @param {string} id - Id do atendimento.
 * @param {string} statusId - Id do STATUS escolhido (precisa estar ativo).
 * @param {string} [aguardandoId] - Id do AGUARDANDO, quando aplicável.
 * @returns {Object} { success, id }.
 */
function alterarStatusAtendimentoPGO5(id, statusId, aguardandoId) {
  const ator = requireAuth_();
  const atendimentoId = String(id || '').trim();

  const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId);
  if (!atual) throw new Error('Atendimento não encontrado.');
  pgo5AssertPodeAcessar_(ator, atual, 'editar');

  const catalogo = pgo5CatalogoBruto_();
  const novoStatus = String(statusId || '').trim();
  // Só status ATIVO pode ser escolhido — o histórico continua legível, mas
  // não se move um caso para uma situação que a operação desativou.
  const status = pgo5Status_(catalogo).find(function(s) { return s.id === novoStatus; });
  if (!status) throw new Error('Selecione um status válido.');

  let novoAguardando = String(aguardandoId || '').trim();
  if (novoAguardando) {
    const ag = pgo5Aguardando_(catalogo).find(function(a) { return a.id === novoAguardando; });
    if (!ag) throw new Error('Selecione uma opção válida de "Aguardando Retorno".');
  }

  // Saindo de Pendente, o "Aguardando Retorno" deixa de fazer sentido e é
  // apagado — mesma regra da edição normal (ver
  // aplicarRegraDeAguardandoRetorno_). Sem isso, o valor antigo
  // reapareceria se o caso voltasse a Pendente no futuro.
  if (!pgo5StatusEhPendente_(novoStatus, catalogo)) novoAguardando = '';

  return withScriptLock_(function() {
    pgo5AtualizarPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId, {
      StatusId: novoStatus,
      AguardandoRetornoId: novoAguardando,
      AtualizadoPorId: String(ator.id),
      DataAtualizacao: toIso_(new Date())
    });
    return { success: true, id: atendimentoId };
  });
}

/**
 * Exclui FISICAMENTE um atendimento e os seus ValoresAtendimento.
 *
 * Isto NÃO é cascade de configuração: os valores pertencem ao próprio
 * registro excluído e não fazem sentido sozinhos. Nenhuma outra entidade
 * (categoria, campo, canal…) é tocada.
 *
 * @param {string} id - Id do atendimento.
 * @returns {Object} { success, valoresRemovidos }.
 */
function excluirAtendimentoPGO5(id) {
  const ator = requireAuth_();
  const atendimentoId = String(id || '').trim();

  const atual = pgo5ObterPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId);
  if (!atual) throw new Error('Atendimento não encontrado.');
  pgo5AssertPodeAcessar_(ator, atual, 'excluir');

  return withScriptLock_(function() {
    const doAtendimento = pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).filter(function(v) {
      return String(v.AtendimentoId || '').trim().toUpperCase() === atendimentoId.toUpperCase();
    });
    doAtendimento.forEach(function(v) {
      pgo5ExcluirPorId(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO, v.Id);
    });
    pgo5ExcluirPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId);
    return { success: true, valoresRemovidos: doAtendimento.length };
  });
}

/**
 * Carrega um atendimento para EDIÇÃO: campos estruturais + valores dinâmicos.
 * @param {string} id - Id do atendimento.
 * @returns {Object} { atendimento, valores, canalId }.
 */
function obterAtendimentoPGO5(id) {
  const ator = requireAuth_();
  const atendimentoId = String(id || '').trim();
  const registro = pgo5ObterPorId(PGO5.SHEET_NAMES.ATENDIMENTOS, atendimentoId);
  if (!registro) return null;
  pgo5AssertPodeAcessar_(ator, registro);

  const catalogo = pgo5CatalogoBruto_();
  const campos = pgo5CamposDoCanal_(registro.CanalId, catalogo);
  const porId = {};
  campos.forEach(function(c) { porId[c.id.toUpperCase()] = c; });

  // valores[nomeDoCampo] alimenta o formulário; historicos guardam o que já
  // não pertence ao formulário ativo (campo excluído da configuração).
  const valores = {};
  const historicos = [];
  pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).forEach(function(v) {
    if (String(v.AtendimentoId || '').trim().toUpperCase() !== atendimentoId.toUpperCase()) return;
    const campo = porId[String(v.CampoId || '').toUpperCase()];
    if (campo) {
      valores[campo.nome] = v.Valor;
    } else {
      historicos.push({
        rotulo: String(v.RotuloSnapshot || 'Campo removido'),
        tipo: String(v.TipoSnapshot || 'text'),
        valor: v.Valor
      });
    }
  });

  // Campos estruturais entram no mesmo mapa, pela chave do campo.
  Object.keys(PGO5_CAMPOS_ESTRUTURAIS).forEach(function(nome) {
    const coluna = PGO5_CAMPOS_ESTRUTURAIS[nome];
    if (registro[coluna] !== undefined && registro[coluna] !== '') {
      valores[nome] = registro[coluna];
    }
  });

  return {
    id: atendimentoId,
    canalId: String(registro.CanalId || ''),
    valores: valores,
    historicos: historicos,
    criadoPorId: String(registro.CriadoPorId || ''),
    responsavelId: String(registro.ResponsavelId || ''),
    dataCriacao: registro.DataCriacao,
    dataAtualizacao: registro.DataAtualizacao
  };
}

/**
 * Lista os atendimentos do PGO 5.0 já com os IDs resolvidos em nomes,
 * prontos para a tabela do Dashboard.
 *
 * Referência apagada não quebra a tela: vira "-" (sem valor) ou
 * "Sem dados" (valor existe mas o registro sumiu).
 *
 * @returns {Object[]} Linhas prontas para exibição.
 */
function listarAtendimentosPGO5_() {
  const ator = getActor_();
  const catalogo = pgo5CatalogoBruto_();
  const rotulos = pgo5MapaRotulos_(catalogo);

  // Nomes de usuário num mapa — evita buscar dentro do laço.
  const nomeUsuario = {};
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(u) {
    nomeUsuario[String(u.Id || '').trim()] = String(u.Nome || '');
  });

  // O que cada um enxerga vem do NÍVEL DE ACESSO, nunca do cargo.
  // Nome técnico de cada status, para a tela decidir comportamento sem
  // depender do rótulo (que o ADM pode renomear a qualquer momento).
  const nomeTecnicoDeStatus = pgo5MapaNomeTecnicoDeStatus_(catalogo);

  return pgo5FiltrarAtendimentosPorEscopo_(
    ator, pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS), 'ver'
  ).map(function(a) {
    const respId = String(a.ResponsavelId || '').trim();
    return {
      id: String(a.Id || ''),
      dataAbertura: a.DataAbertura,
      protocolo: pgo5TextoDeIdentificador_(a.Protocolo) || '-',
      produto: pgo5Rotulo_(rotulos, a.ProdutoId),
      categoria: pgo5Rotulo_(rotulos, a.CategoriaId),
      subcategoria: pgo5Rotulo_(rotulos, a.SubcategoriaId),
      responsavel: respId ? (nomeUsuario[respId] || 'Sem dados') : '-',
      responsavelId: respId,
      aguardandoRetorno: pgo5Rotulo_(rotulos, a.AguardandoRetornoId),
      canal: pgo5Rotulo_(rotulos, a.CanalId),
      canalId: String(a.CanalId || ''),
      status: pgo5Rotulo_(rotulos, a.StatusId),
      statusId: String(a.StatusId || ''),
      // Chave ESTÁVEL do status. "status" acima é só o rótulo de exibição:
      // decisões de comportamento na tela usam este campo.
      statusNomeTecnico: nomeTecnicoDeStatus[String(a.StatusId || '').trim()] || '',
      observacoes: String(a.Observacoes || ''),
      criadoPorId: String(a.CriadoPorId || ''),
      dataCriacao: a.DataCriacao,
      dataAtualizacao: a.DataAtualizacao
    };
  });
}

/**
 * Converte os atendimentos do PGO 5.0 para o FORMATO DO MODELO 4.x, com os
 * IDs já resolvidos em nomes.
 *
 * Existe para o Dashboard, os Relatórios e os Indicadores continuarem
 * funcionando sem serem reescritos: eles recebem exatamente os campos que
 * já sabem consumir. A adaptação visual definitiva é de outra etapa.
 *
 * Cliente e CPF vêm das colunas estruturais de Atendimentos.
 *
 * @returns {Object[]} Registros no formato legado, já recortados por escopo.
 */
function pgo5AtendimentosComoLegado_() {
  // O Dashboard e as telas operacionais consomem esta ponte com o escopo de
  // LEITURA (verProprios/verEquipe/verTodos). As telas analíticas têm escopo
  // próprio e por isso chamam pgo5ConverterParaLegado_ diretamente, passando
  // a lista que já recortaram — ver Pgo5Analitico.gs.
  return pgo5ConverterParaLegado_(pgo5FiltrarAtendimentosPorEscopo_(
    getActor_(), pgo5Ler(PGO5.SHEET_NAMES.ATENDIMENTOS), 'ver'));
}

/**
 * Converte uma lista de atendimentos do PGO 5.0 para o formato do 4.x.
 *
 * ⚠️ NÃO APLICA NENHUM RECORTE DE PERMISSÃO.
 * Quem chama é responsável por entregar apenas os registros que o usuário
 * pode ver. Isso é proposital: cada tela tem o seu escopo (leitura,
 * relatórios, produtividade) e embutir um deles aqui obrigaria as outras a
 * contorná-lo.
 *
 * @param {Object[]} registros Linhas cruas da aba Atendimentos.
 * @returns {Object[]} Registros no formato legado, com IDs já em nomes.
 */
function pgo5ConverterParaLegado_(registros) {
  const catalogo = pgo5CatalogoBruto_();
  const rotulos = pgo5MapaRotulos_(catalogo);
  const nomeTecnicoDeStatus = pgo5MapaNomeTecnicoDeStatus_(catalogo);

  const nomeUsuario = {};
  pgo5Ler(PGO5.SHEET_NAMES.USUARIOS).forEach(function(u) {
    nomeUsuario[String(u.Id || '').trim()] = String(u.Nome || '');
  });

  // Campos dinâmicos agrupados por atendimento, numa passada só.
  const camposPorId = {};
  catalogo.CAMPO.forEach(function(c) { camposPorId[String(c.Id || '').toUpperCase()] = c; });

  const dinamicosPorAtendimento = {};
  pgo5Ler(PGO5.SHEET_NAMES.VALORES_ATENDIMENTO).forEach(function(v) {
    const chave = String(v.AtendimentoId || '').trim().toUpperCase();
    if (!chave) return;
    if (!dinamicosPorAtendimento[chave]) dinamicosPorAtendimento[chave] = {};
    const campo = camposPorId[String(v.CampoId || '').toUpperCase()];
    // Campo excluído da configuração: o snapshot mantém o dado legível.
    const nome = campo ? String(campo.Nome || '') : String(v.RotuloSnapshot || '');
    if (nome) dinamicosPorAtendimento[chave][nome] = v.Valor;
  });

  return (registros || []).map(function(a) {
    const id = String(a.Id || '');
    const din = dinamicosPorAtendimento[id.toUpperCase()] || {};
    const respId = String(a.ResponsavelId || '').trim();
    const criadorId = String(a.CriadoPorId || '').trim();

    // Todo campo dinâmico vira CamposExtras, como no 4.x.
    const extras = {};
    Object.keys(din).forEach(function(k) { extras[k] = din[k]; });
    extras._responsavelId = respId;
    extras._criadoPorId = criadorId;

    return {
      Id: id,
      NumeroRA: pgo5TextoDeIdentificador_(a.Protocolo),
      DataAbertura: a.DataAbertura,
      Canal: pgo5Rotulo_(rotulos, a.CanalId, ''),
      Cliente: String(a.Cliente || ''),
      CPF: pgo5TextoDeIdentificador_(a.CPF),
      Produto: pgo5Rotulo_(rotulos, a.ProdutoId, ''),
      Categoria: pgo5Rotulo_(rotulos, a.CategoriaId, ''),
      Subcategoria: pgo5Rotulo_(rotulos, a.SubcategoriaId, ''),
      Status: pgo5Rotulo_(rotulos, a.StatusId, ''),
      // Chave estável do status, ao lado do rótulo. No banco 4.x este campo
      // não existe e as telas caem no comportamento antigo.
      StatusNomeTecnico: nomeTecnicoDeStatus[String(a.StatusId || '').trim()] || '',
      MotivoPendencia: pgo5Rotulo_(rotulos, a.AguardandoRetornoId, ''),
      Responsavel: respId ? (nomeUsuario[respId] || '') : '',
      Observacoes: String(a.Observacoes || ''),
      CriadoPor: criadorId ? (nomeUsuario[criadorId] || '') : '',
      DataCriacao: a.DataCriacao,
      AtualizadoPor: String(a.AtualizadoPorId || ''),
      DataAtualizacao: a.DataAtualizacao,
      CamposExtras: JSON.stringify(extras),
      // O PGO 5.0 usa exclusão física: nada aqui está "excluído".
      Excluido: false
    };
  });
}

/**
 * Impede que um Analista abra/edite/exclua atendimento que não é dele.
 * Supervisor e ADM seguem com o alcance atual do sistema.
 * @param {Object} ator - Ator autenticado.
 * @param {Object} registro - Linha do atendimento.
 * @throws {Error} Quando o acesso não é permitido.
 */
function pgo5AssertPodeAcessar_(ator, registro, acao) {
  if (pgo5AtendimentoEstaNoEscopo_(ator, registro, acao || 'ver')) return;
  throw new Error('Você não tem acesso a este atendimento.');
}

/**
 * Diz se um atendimento cai dentro do escopo do usuário para uma ação.
 *
 * O escopo vem do motor de permissões (ver Pgo5Permissoes.gs) e nunca do
 * cargo:
 *
 *   TODOS    → qualquer atendimento
 *   EQUIPE   → os próprios + os de quem está abaixo na HIERARQUIA
 *   PROPRIOS → só onde ele é responsável ou criador
 *   NENHUM   → nenhum
 *
 * ⚠️ CUSTO: resolver o escopo NÃO é uma conta em memória — passa por
 * atorComoUsuario_ (lê a aba Usuários inteira) e por lerCargosENiveis_ (lê a
 * aba Configurações inteira). São duas varreduras completas de planilha por
 * chamada. Numa verificação avulsa isso é irrelevante; dentro de um laço,
 * não é. Por isso quem filtra uma LISTA deve resolver o escopo uma única vez
 * e passá-lo em `escopoResolvido` — ver pgo5FiltrarAtendimentosPorEscopo_.
 *
 * @param {Object} ator Ator autenticado.
 * @param {Object} registro Linha do atendimento.
 * @param {string} acao 'ver', 'editar' ou 'excluir'.
 * @param {string[]} [subordinados] Árvore do ator, quando já calculada.
 * @param {string} [escopoResolvido] Escopo já resolvido, quando já calculado.
 * @returns {boolean} true quando a ação é permitida sobre este registro.
 */
function pgo5AtendimentoEstaNoEscopo_(ator, registro, acao, subordinados, escopoResolvido) {
  const escopo = escopoResolvido || obterEscopoAtendimentos_(atorComoUsuario_(ator), acao);
  if (escopo === 'NENHUM') return false;
  if (escopo === 'TODOS') return true;

  const meu = String(ator.id).toUpperCase();
  const responsavel = String(registro.ResponsavelId || '').trim().toUpperCase();
  const criador = String(registro.CriadoPorId || '').trim().toUpperCase();
  if (responsavel === meu || criador === meu) return true;

  if (escopo !== 'EQUIPE') return false;
  const arvore = subordinados || obterSubordinadosDaHierarquia_(ator.id);
  return arvore.indexOf(responsavel) !== -1 || arvore.indexOf(criador) !== -1;
}

/**
 * Filtra uma lista de atendimentos pelo escopo do ator.
 *
 * TUDO O QUE CUSTA LEITURA DE PLANILHA É RESOLVIDO UMA ÚNICA VEZ, ANTES DO
 * LAÇO — o escopo e a árvore de subordinados. Os dois são então repassados
 * a cada verificação.
 *
 * POR QUE ISSO É CRÍTICO, E NÃO UM DETALHE DE PERFORMANCE
 * Quem tem escopo TODOS sai na linha de cima e nunca entra no laço. Quem tem
 * PROPRIOS ou EQUIPE — ou seja, os níveis Operacional e Gestão — entra. Se
 * cada volta recalculasse o escopo, cada atendimento custaria mais duas
 * varreduras completas de planilha (Usuários e Configurações), e uma base
 * com N atendimentos faria 2N leituras só para decidir o que a pessoa pode
 * ver. Com poucos registros ninguém percebe; com alguns milhares, a execução
 * estoura o limite de tempo do Apps Script e a tela simplesmente não carrega
 * — só para quem NÃO é administrador. A aba Configurações ainda guarda a
 * auditoria, então ela cresce todo dia e o problema piora sozinho.
 *
 * @param {Object} ator Ator autenticado.
 * @param {Object[]} registros Linhas da aba Atendimentos.
 * @param {string} acao 'ver', 'editar' ou 'excluir'.
 * @returns {Object[]} Apenas os registros permitidos.
 */
function pgo5FiltrarAtendimentosPorEscopo_(ator, registros, acao) {
  const escopo = obterEscopoAtendimentos_(atorComoUsuario_(ator), acao);
  if (escopo === 'NENHUM') return [];
  if (escopo === 'TODOS') return registros;

  const subordinados = escopo === 'EQUIPE' ? obterSubordinadosDaHierarquia_(ator.id) : [];
  return registros.filter(function(registro) {
    return pgo5AtendimentoEstaNoEscopo_(ator, registro, acao, subordinados, escopo);
  });
}

// ============================================================================
// DADOS DO FORMULÁRIO PARA O FRONT
// ============================================================================

/**
 * (Público) Tudo o que a tela "Novo Atendimento" precisa, numa ÚNICA
 * chamada: canais ativos, campos de cada canal, hierarquia
 * Produto→Categoria→Subcategoria, status, aguardando e responsáveis
 * elegíveis. Com isso a cascata roda no navegador, sem ida ao servidor a
 * cada troca de produto.
 *
 * @returns {Object} Estrutura do formulário.
 */
function getFormularioPGO5() {
  const ator = requireAuth_();
  const catalogo = pgo5CatalogoBruto_();
  const canais = pgo5Canais_(catalogo);

  const camposPorCanal = {};
  canais.forEach(function(c) { camposPorCanal[c.id] = pgo5CamposDoCanal_(c.id, catalogo); });

  return {
    canais: canais,
    camposPorCanal: camposPorCanal,
    hierarquia: pgo5Hierarquia_(catalogo),
    status: pgo5Status_(catalogo),
    aguardando: pgo5Aguardando_(catalogo),
    responsaveis: pgo5ResponsaveisElegiveis_(ator),
    podeDelegar: obterEscopoDelegacao_(atorComoUsuario_(ator)) !== 'NENHUM',
    usuarioId: String(ator.id)
  };
}

/**
 * Converte um identificador lido da planilha em texto, sem perder o zero.
 *
 * POR QUE ISTO EXISTE
 * `String(valor || '')` parece inofensivo, mas apaga o identificador "0":
 * em JavaScript o número 0 é *falsy*, então `0 || ''` resulta em string
 * vazia. Como CPF e Protocolo agora aceitam "0" e "00123", a conversão
 * precisa distinguir AUSENTE de ZERO.
 *
 * Uma célula pode voltar como número se tiver sido digitada direto na
 * planilha antes da coluna ser formatada como texto — por isso a conversão
 * trata o caso em vez de confiar que sempre virá string.
 *
 * @param {*} valor Conteúdo bruto da célula.
 * @returns {string} O identificador como texto ('' apenas quando ausente).
 */
function pgo5TextoDeIdentificador_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}
