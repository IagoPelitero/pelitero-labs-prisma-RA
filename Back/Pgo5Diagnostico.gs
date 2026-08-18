/**
 * ============================================================================
 * PRISMA Gestão Operacional (Pelitero Labs) — Diagnóstico do build
 * ============================================================================
 * Arquivo: Pgo5Diagnostico.gs
 * Descrição: Verificação de integridade que roda DENTRO do Apps Script, sobre
 *            a instalação real, sem gravar nada.
 *
 * Desenvolvido por Pelitero Labs.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 * ----------------------------------------------------------------------------
 * No Apps Script todos os arquivos .gs dividem o mesmo escopo global, e a
 * publicação é feita arquivo por arquivo, à mão. Enviar um arquivo e esquecer
 * outro produz um sistema que ABRE NORMALMENTE e só quebra quando alguém usa a
 * função que faltou — às vezes dias depois.
 *
 * Nenhum teste de fora do Apps Script pega isso, porque lá os arquivos são
 * carregados juntos por construção. Esta função confere o contrato entre os
 * arquivos na instalação de verdade, em segundos, e é a primeira coisa a rodar
 * depois de publicar.
 *
 * COMO USAR
 * No editor do Apps Script, selecione `verificarIntegridadeBuildPGO5` e
 * execute. O relatório aparece no log e é devolvido como texto.
 *
 * ⚠️ SÓ LÊ. Não grava, não altera e não apaga nada.
 * ----------------------------------------------------------------------------
 */

/** Acumulador de resultados. */
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
 * (SEGURO — SÓ LÊ) Diagnóstico de integridade do PGO 5.0.
 *
 * @returns {string} Relatório em texto (também gravado no Logger).
 */
function verificarIntegridadeBuildPGO5() {
  const r = pgo5NovoResultadoDeTeste_();
  r.linhas.push('PGO 5.0 — DIAGNÓSTICO DO BUILD');
  r.linhas.push('');

  // ── 1. Os arquivos foram todos publicados? ──
  // É a checagem mais valiosa: uma função ausente aqui significa um .gs que
  // ficou para trás na publicação manual.
  r.linhas.push('FUNÇÕES ESSENCIAIS EM ESCOPO');
  const presente = function(nome, referencia) {
    pgo5Afirmar_(r, nome, typeof referencia === 'function',
      'não encontrada — o arquivo .gs correspondente não foi publicado?');
  };
  presente('pgo5Ler (Pgo5.gs)', typeof pgo5Ler === 'undefined' ? null : pgo5Ler);
  presente('pgo5ObterPorId (Pgo5.gs)', typeof pgo5ObterPorId === 'undefined' ? null : pgo5ObterPorId);
  presente('pgo5Inserir (Pgo5.gs)', typeof pgo5Inserir === 'undefined' ? null : pgo5Inserir);
  presente('pgo5AtualizarPorId (Pgo5.gs)',
    typeof pgo5AtualizarPorId === 'undefined' ? null : pgo5AtualizarPorId);
  presente('pgo5ExcluirPorId (Pgo5.gs)',
    typeof pgo5ExcluirPorId === 'undefined' ? null : pgo5ExcluirPorId);
  presente('exigirPermissao_ (Pgo5Permissoes.gs)',
    typeof exigirPermissao_ === 'undefined' ? null : exigirPermissao_);
  presente('exigirPermissaoComPin_ (Pgo5Seguranca.gs)',
    typeof exigirPermissaoComPin_ === 'undefined' ? null : exigirPermissaoComPin_);
  presente('registrarAuditoria_ (Pgo5Auditoria.gs)',
    typeof registrarAuditoria_ === 'undefined' ? null : registrarAuditoria_);
  presente('getFormularioPGO5 (Pgo5Atendimentos.gs)',
    typeof getFormularioPGO5 === 'undefined' ? null : getFormularioPGO5);
  presente('criarAtendimentoPGO5 (Pgo5Atendimentos.gs)',
    typeof criarAtendimentoPGO5 === 'undefined' ? null : criarAtendimentoPGO5);
  presente('pgo5AplicarSeedEstrutural_ (Pgo5Catalogo.gs)',
    typeof pgo5AplicarSeedEstrutural_ === 'undefined' ? null : pgo5AplicarSeedEstrutural_);
  presente('getRelatorioPGO5 (Pgo5Analitico.gs)',
    typeof getRelatorioPGO5 === 'undefined' ? null : getRelatorioPGO5);
  presente('listarUsuariosPGO5 (Pgo5Usuarios.gs)',
    typeof listarUsuariosPGO5 === 'undefined' ? null : listarUsuariosPGO5);
  presente('importarBaseLegadaPGO5 (Pgo5Importacao.gs)',
    typeof importarBaseLegadaPGO5 === 'undefined' ? null : importarBaseLegadaPGO5);
  presente('getBootstrapData (Services.gs)',
    typeof getBootstrapData === 'undefined' ? null : getBootstrapData);

  // ── 2. Esquema ──
  r.linhas.push('');
  r.linhas.push('ESQUEMA ' + (typeof PGO5 === 'undefined' ? '(PGO5 ausente)' : PGO5.SCHEMA_VERSION));
  if (typeof PGO5 !== 'undefined') {
    const abas = PGO5.SHEET_NAMES;
    ['ATENDIMENTOS', 'USUARIOS', 'FORMULARIO', 'VALORES_ATENDIMENTO', 'CONFIGURACOES']
      .forEach(function(chave) {
        pgo5Afirmar_(r, 'aba ' + chave + ' declarada', !!abas[chave]);
      });
    // Cinco abas, nem mais nem menos: aba nova é mudança de contrato.
    pgo5Afirmar_(r, 'são exatamente 5 abas', Object.keys(abas).length === 5,
      'encontradas ' + Object.keys(abas).length);
  }

  // ── 3. Recorte por escopo com custo constante ──
  //
  // POR QUE ESTE TESTE EXISTE
  // O 5º parâmetro carrega o escopo JÁ RESOLVIDO. Se alguém removê-lo, a
  // função volta a resolver o escopo por registro — duas varreduras completas
  // de planilha para CADA atendimento. O Dashboard passa a estourar o tempo
  // de execução, e SÓ para quem não é administrador (quem tem escopo TODOS
  // sai antes do laço). É uma falha que se disfarça de "problema do usuário".
  r.linhas.push('');
  r.linhas.push('RECORTE POR ESCOPO (custo constante)');
  if (typeof pgo5AtendimentoEstaNoEscopo_ === 'function') {
    const ator = { id: '00000001' };
    const deOutro = { ResponsavelId: '000000FF', CriadoPorId: '000000FF' };
    const meu = { ResponsavelId: '00000001', CriadoPorId: '00000001' };

    pgo5Afirmar_(r, 'escopo pré-resolvido é honrado (TODOS libera)',
      pgo5AtendimentoEstaNoEscopo_(ator, deOutro, 'ver', [], 'TODOS') === true,
      'o 5º parâmetro foi ignorado — o escopo está sendo recalculado por registro');
    pgo5Afirmar_(r, 'escopo pré-resolvido é honrado (NENHUM bloqueia)',
      pgo5AtendimentoEstaNoEscopo_(ator, meu, 'ver', [], 'NENHUM') === false);
    pgo5Afirmar_(r, 'PROPRIOS libera o próprio registro',
      pgo5AtendimentoEstaNoEscopo_(ator, meu, 'ver', [], 'PROPRIOS') === true);
    pgo5Afirmar_(r, 'PROPRIOS bloqueia registro de terceiro',
      pgo5AtendimentoEstaNoEscopo_(ator, deOutro, 'ver', [], 'PROPRIOS') === false);
    pgo5Afirmar_(r, 'EQUIPE libera quem está na árvore recebida',
      pgo5AtendimentoEstaNoEscopo_(ator, deOutro, 'ver', ['000000FF'], 'EQUIPE') === true);
    pgo5Afirmar_(r, 'EQUIPE bloqueia quem está fora da árvore',
      pgo5AtendimentoEstaNoEscopo_(ator, deOutro, 'ver', ['000000AA'], 'EQUIPE') === false);
  }

  // ── 4. Memória do seed por planilha ──
  //
  // POR QUE ESTE TESTE EXISTE
  // Script Properties pertencem ao PROJETO, não à planilha. Se a memória do
  // seed voltar a ser uma chave única, apontar o projeto para outra base faz o
  // seed concluir que "já semeou tudo": a instalação nasce sem canal, sem
  // campo e sem status. O sintoma é Novo Atendimento sem canal para escolher e
  // todo atendimento exibindo "Sem dados" — sem nenhum erro no log.
  r.linhas.push('');
  r.linhas.push('MEMÓRIA DO SEED (por planilha)');
  if (typeof pgo5ChaveDaMemoriaDeSeed_ === 'function') {
    let idDaBase = '';
    try { idDaBase = String(getSpreadsheet().getId() || ''); } catch (e) { idDaBase = ''; }
    pgo5Afirmar_(r, 'a chave da memória carrega o Id da planilha',
      !!idDaBase && pgo5ChaveDaMemoriaDeSeed_().indexOf(idDaBase) !== -1,
      'a memória voltou a ser global ao projeto');
    pgo5Afirmar_(r, 'a chave é diferente da chave legada',
      pgo5ChaveDaMemoriaDeSeed_() !== PGO5_SEED_APLICADO_);

    // Compatibilidade com quem já está instalado, isolada num repositório
    // de propriedades onde só existe a chave antiga.
    const propsSoLegado = {
      _dados: (function() {
        const d = {};
        d[PGO5_SEED_APLICADO_] = JSON.stringify({ 'CANAL|exemplo|': true });
        return d;
      })(),
      getProperty: function(chave) {
        return this._dados[chave] === undefined ? null : this._dados[chave];
      }
    };
    pgo5Afirmar_(r, 'base COM catálogo adota a memória legada',
      Object.keys(pgo5LerMemoriaDeSeed_(propsSoLegado,
        { CANAL: [{ Id: '00000001' }], CAMPO: [], STATUS: [] })).length === 1,
      'uma instalação existente ressuscitaria itens que o ADM excluiu');
    pgo5Afirmar_(r, 'base SEM catálogo ignora a memória legada',
      Object.keys(pgo5LerMemoriaDeSeed_(propsSoLegado,
        { CANAL: [], CAMPO: [], STATUS: [] })).length === 0,
      'uma instalação nova herdaria a memória de outra base e nasceria vazia');
  }

  // ── 5. Data de abertura no fuso da operação ──
  r.linhas.push('');
  r.linhas.push('DATA DE ABERTURA');
  if (typeof pgo5HojeEmSaoPaulo_ === 'function') {
    const hoje = pgo5HojeEmSaoPaulo_();
    pgo5Afirmar_(r, 'hoje sai no formato AAAA-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(hoje), hoje);
    pgo5Afirmar_(r, 'o fuso oficial é America/Sao_Paulo',
      PGO5_FUSO_OFICIAL_ === 'America/Sao_Paulo', PGO5_FUSO_OFICIAL_);
    pgo5Afirmar_(r, '31/02 é reconhecida como data inexistente',
      pgo5DataDeCalendarioEhReal_('2026-02-31') === false);
    pgo5Afirmar_(r, '29/02 de ano bissexto é aceita',
      pgo5DataDeCalendarioEhReal_('2024-02-29') === true);
  }

  // ── 6. Identificadores ──
  r.linhas.push('');
  r.linhas.push('IDENTIFICADORES');
  if (typeof pgo5TextoDeIdentificador_ === 'function') {
    // "0" é um identificador VÁLIDO; String(0 || '') o apagaria.
    pgo5Afirmar_(r, 'o identificador "0" sobrevive',
      pgo5TextoDeIdentificador_(0) === '0', pgo5TextoDeIdentificador_(0));
    pgo5Afirmar_(r, 'zeros à esquerda são preservados',
      pgo5TextoDeIdentificador_('00123') === '00123');
    pgo5Afirmar_(r, 'ausente continua vazio', pgo5TextoDeIdentificador_(null) === '');
  }
  if (typeof pgo5NovoId === 'function') {
    const id = pgo5NovoId(PGO5.SHEET_NAMES.ATENDIMENTOS);
    pgo5Afirmar_(r, 'o Id tem 8 caracteres hexadecimais maiúsculos',
      /^[0-9A-F]{8}$/.test(String(id)), String(id));
  }

  // ── Fecho ──
  r.linhas.push('');
  r.linhas.push('VERIFICAÇÕES: ' + r.total + ' | APROVADAS: ' + r.ok +
    ' | FALHAS: ' + r.falhas.length);
  r.linhas.push(r.falhas.length === 0
    ? '✅ BUILD ÍNTEGRO'
    : '❌ REVISAR: ' + r.falhas.length + ' item(ns) acima');

  const relatorio = r.linhas.join('\n');
  Logger.log(relatorio);
  return relatorio;
}
