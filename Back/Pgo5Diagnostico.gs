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
 * Registra uma asserção que depende de uma função existir.
 *
 * ⚠️ FUNÇÃO AUSENTE É FALHA, NÃO É "PULAR".
 * Os blocos deste arquivo eram embrulhados em `if (typeof X === 'function')`.
 * Quando o arquivo que define X não era publicado — justamente o que este
 * diagnóstico existe para detectar — o bloco inteiro sumia do relatório e o
 * build era declarado ÍNTEGRO sem nunca ter sido verificado. Havia um caso
 * real: pgo5NovoId não existe em lugar nenhum e o teste de Id nunca rodou.
 *
 * @param {Object} r Acumulador.
 * @param {string} nome O que seria verificado.
 * @param {string} nomeFuncao Função exigida.
 * @param {*} referencia A própria função (ou null).
 * @returns {boolean} true quando existe e o bloco pode seguir.
 */
function pgo5ExigirFuncao_(r, nome, nomeFuncao, referencia) {
  return pgo5Afirmar_(r, nome, typeof referencia === 'function',
    nomeFuncao + ' não está em escopo — o arquivo .gs que a define não foi publicado');
}

/**
 * Registra uma asserção de AUSÊNCIA: algo que precisa ter saído do projeto.
 *
 * Numa publicação manual, remover um arquivo do repositório não o remove do
 * editor do Apps Script. Sem esta checagem, um wrapper ou uma rota removida
 * continua viva na instalação e volta a competir com a implementação nativa.
 *
 * @param {Object} r Acumulador.
 * @param {string} nome O que não pode existir.
 * @param {boolean} existe Resultado da checagem.
 * @returns {boolean} true quando realmente não existe.
 */
function pgo5AfirmarAusencia_(r, nome, existe) {
  return pgo5Afirmar_(r, nome + ' não está mais no projeto', !existe,
    'ainda está publicado no editor do Apps Script — apague-o de lá');
}

/**
 * true quando um arquivo .html existe no projeto do Apps Script.
 * @param {string} nome Nome do arquivo, sem extensão.
 * @returns {boolean}
 */
function pgo5ArquivoHtmlExiste_(nome) {
  try {
    HtmlService.createHtmlOutputFromFile(nome);
    return true;
  } catch (e) {
    return false;
  }
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
  presente('getBootstrapData (Services.gs)',
    typeof getBootstrapData === 'undefined' ? null : getBootstrapData);

  // ── 2. Esquema ──
  r.linhas.push('');
  r.linhas.push('ESQUEMA ' + (typeof PGO5 === 'undefined' ? '(PGO5 ausente)' : PGO5.SCHEMA_VERSION));
  if (pgo5Afirmar_(r, 'contrato PGO5 em escopo', typeof PGO5 !== 'undefined',
      'Pgo5.gs não foi publicado')) {
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
  if (pgo5ExigirFuncao_(r, 'recorte por escopo disponível', 'pgo5AtendimentoEstaNoEscopo_',
      typeof pgo5AtendimentoEstaNoEscopo_ === 'undefined' ? null : pgo5AtendimentoEstaNoEscopo_)) {
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
  if (pgo5ExigirFuncao_(r, 'memória do seed disponível', 'pgo5ChaveDaMemoriaDeSeed_',
      typeof pgo5ChaveDaMemoriaDeSeed_ === 'undefined' ? null : pgo5ChaveDaMemoriaDeSeed_)) {
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
  if (pgo5ExigirFuncao_(r, 'data de abertura disponível', 'pgo5HojeEmSaoPaulo_',
      typeof pgo5HojeEmSaoPaulo_ === 'undefined' ? null : pgo5HojeEmSaoPaulo_)) {
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
  if (pgo5ExigirFuncao_(r, 'identificadores de texto disponíveis', 'pgo5TextoDeIdentificador_',
      typeof pgo5TextoDeIdentificador_ === 'undefined' ? null : pgo5TextoDeIdentificador_)) {
    // "0" é um identificador VÁLIDO; String(0 || '') o apagaria.
    pgo5Afirmar_(r, 'o identificador "0" sobrevive',
      pgo5TextoDeIdentificador_(0) === '0', pgo5TextoDeIdentificador_(0));
    pgo5Afirmar_(r, 'zeros à esquerda são preservados',
      pgo5TextoDeIdentificador_('00123') === '00123');
    pgo5Afirmar_(r, 'ausente continua vazio', pgo5TextoDeIdentificador_(null) === '');
  }
  // ⚠️ AQUI NÃO SE PEDE UM ID NOVO.
  // A versão anterior chamava pgo5NovoId(...), que AVANÇA a sequência gravada
  // em Script Properties: um diagnóstico anunciado como "só lê" queimava um
  // identificador a cada execução. formatarIdHex_ é pura — mesma regra,
  // nenhuma gravação.
  if (pgo5ExigirFuncao_(r, 'formatação do Id disponível', 'formatarIdHex_',
      typeof formatarIdHex_ === 'undefined' ? null : formatarIdHex_)) {
    pgo5Afirmar_(r, 'o Id tem 8 caracteres hexadecimais maiúsculos',
      /^[0-9A-F]{8}$/.test(formatarIdHex_(26)), formatarIdHex_(26));
    pgo5Afirmar_(r, 'o Id preserva os zeros à esquerda',
      formatarIdHex_(1) === '00000001', formatarIdHex_(1));
  }

  // ── 7. Matrícula é nativa em Usuários ──
  r.linhas.push('');
  r.linhas.push('MATRÍCULA (nativa)');
  if (typeof COLUMNS_PGO5 !== 'undefined' && COLUMNS_PGO5.USUARIOS) {
    pgo5Afirmar_(r, 'a coluna "Matrícula" está no contrato de Usuários',
      COLUMNS_PGO5.USUARIOS.indexOf('Matrícula') !== -1,
      'sem ela o CRUD descarta a matrícula na gravação');
  } else {
    pgo5Afirmar_(r, 'contrato de Usuários em escopo', false, 'COLUMNS_PGO5 não foi publicado');
  }
  pgo5Afirmar_(r, 'Matrícula é tratada como identificador de texto',
    typeof PGO5_COLUNAS_DE_IDENTIFICADOR !== 'undefined' &&
    PGO5_COLUNAS_DE_IDENTIFICADOR.indexOf('Matrícula') !== -1,
    'sem isso "000123" vira o número 123 na planilha');
  if (pgo5ExigirFuncao_(r, 'normalização de matrícula disponível', 'pgo5NormalizarMatricula_',
      typeof pgo5NormalizarMatricula_ === 'undefined' ? null : pgo5NormalizarMatricula_)) {
    pgo5Afirmar_(r, 'a matrícula preserva zeros à esquerda',
      pgo5NormalizarMatricula_('000123') === '000123');
    pgo5Afirmar_(r, 'a matrícula é aparada nas pontas',
      pgo5NormalizarMatricula_('  4210  ') === '4210');
    pgo5Afirmar_(r, 'matrícula vazia continua permitida',
      pgo5NormalizarMatricula_('') === '' && pgo5NormalizarMatricula_(null) === '');
    let recusou = false;
    try { pgo5NormalizarMatricula_(new Array(60).join('9')); } catch (e) { recusou = true; }
    pgo5Afirmar_(r, 'matrícula acima de 50 caracteres é recusada', recusou);
  }
  pgo5ExigirFuncao_(r, 'gravação nativa de usuário disponível', 'salvarUsuarioPGO5',
    typeof salvarUsuarioPGO5 === 'undefined' ? null : salvarUsuarioPGO5);
  pgo5ExigirFuncao_(r, 'leitura nativa de usuários disponível', 'listarUsuariosPGO5',
    typeof listarUsuariosPGO5 === 'undefined' ? null : listarUsuariosPGO5);

  // ── 8. Detalhamento de "Em Análise" é nativo e único ──
  r.linhas.push('');
  r.linhas.push('DETALHAMENTO DE EM ANÁLISE (nativo)');
  if (pgo5ExigirFuncao_(r, 'configuração da Análise de SAC disponível', 'lerIndicOpConfig_',
      typeof lerIndicOpConfig_ === 'undefined' ? null : lerIndicOpConfig_)) {
    const cfgSac = lerIndicOpConfig_();
    pgo5Afirmar_(r, 'a configuração declara as duas colunas do detalhamento',
      cfgSac.colunaDetalheEmAnalise1 !== undefined &&
      cfgSac.colunaDetalheEmAnalise2 !== undefined,
      'a versão publicada de Services.gs é anterior ao detalhamento nativo');
    pgo5Afirmar_(r, 'as duas colunas estão configuradas juntas ou nenhuma',
      (!!cfgSac.colunaDetalheEmAnalise1) === (!!cfgSac.colunaDetalheEmAnalise2),
      'só uma coluna configurada — a tabela sairia com uma coluna vazia');
  }
  pgo5ExigirFuncao_(r, 'painel da Análise de SAC disponível', 'getIndicadoresOperacionais',
    typeof getIndicadoresOperacionais === 'undefined' ? null : getIndicadoresOperacionais);

  // ── 9. Identificadores gravados na planilha ──
  //
  // Confere o que ESTÁ na planilha, não o que o código faria: um Id
  // corrompido antes desta versão continua corrompido, e nenhuma proteção
  // futura o conserta. Colisão é o caso grave — duas linhas com o mesmo
  // valor fazem a atualização gravar por cima do registro errado.
  r.linhas.push('');
  r.linhas.push('IDENTIFICADORES NA PLANILHA');
  if (pgo5ExigirFuncao_(r, 'leitura das abas disponível', 'pgo5Ler',
      typeof pgo5Ler === 'undefined' ? null : pgo5Ler)) {
    pgo5TodasAsAbas_().forEach(function(nomeAba) {
      let registros = [];
      try { registros = pgo5Ler(nomeAba); }
      catch (e) { pgo5Afirmar_(r, 'aba ' + nomeAba + ' legível', false, e.message); return; }
      if (registros.length === 0) return;   // aba vazia não tem o que conferir

      const deformados = [];
      const contagem = {};
      registros.forEach(function(reg) {
        const bruto = reg.Id;
        const texto = String(bruto === null || bruto === undefined ? '' : bruto).trim();
        if (!/^[0-9A-Fa-f]{8}$/.test(texto)) deformados.push(texto || '(vazio)');
        contagem[texto] = (contagem[texto] || 0) + 1;
      });
      const repetidos = Object.keys(contagem).filter(function(k) { return contagem[k] > 1; });

      pgo5Afirmar_(r, nomeAba + ': todo Id tem 8 caracteres hexadecimais',
        deformados.length === 0,
        deformados.length + ' de ' + registros.length + ' fora do formato (ex.: ' +
        deformados.slice(0, 5).join(', ') + ') — a coluna Id foi lida como número ' +
        'pela planilha; formate-a como Texto e recadastre esses registros');
      pgo5Afirmar_(r, nomeAba + ': nenhum Id repetido',
        repetidos.length === 0,
        repetidos.length + ' valor(es) em mais de uma linha (ex.: ' +
        repetidos.slice(0, 5).join(', ') + ') — atualizar um deles grava sobre o outro');
    });
  }
  pgo5ExigirFuncao_(r, 'regra de coluna identificadora disponível', 'pgo5ColunaEhIdentificador_',
    typeof pgo5ColunaEhIdentificador_ === 'undefined' ? null : pgo5ColunaEhIdentificador_);
  if (typeof pgo5ColunaEhIdentificador_ === 'function') {
    pgo5Afirmar_(r, 'a coluna Id é reconhecida como identificador',
      pgo5ColunaEhIdentificador_('Id') === true);
    pgo5Afirmar_(r, 'colunas terminadas em Id também são',
      pgo5ColunaEhIdentificador_('CanalId') && pgo5ColunaEhIdentificador_('AtendimentoId'));
    pgo5Afirmar_(r, 'CPF, Protocolo e Matrícula também são',
      pgo5ColunaEhIdentificador_('CPF') && pgo5ColunaEhIdentificador_('Protocolo') &&
      pgo5ColunaEhIdentificador_('Matrícula'));
    pgo5Afirmar_(r, 'uma coluna comum não é marcada como texto',
      pgo5ColunaEhIdentificador_('DataAbertura') === false);
  }
  pgo5ExigirFuncao_(r, 'proteção de texto na gravação disponível',
    'pgo5MarcarIdentificadoresComoTexto_',
    typeof pgo5MarcarIdentificadoresComoTexto_ === 'undefined' ? null : pgo5MarcarIdentificadoresComoTexto_);

  // ── 10. O que precisa ter SAÍDO do projeto ──
  //
  // Publicação é cópia manual: apagar um arquivo do repositório não o apaga
  // do editor. Um wrapper esquecido volta a disputar com a implementação
  // nativa, e uma rota de migração esquecida volta a ser alcançável.
  r.linhas.push('');
  r.linhas.push('CAMINHOS QUE PRECISAM ESTAR AUSENTES');
  [
    ['o wrapper salvarUsuarioPGO5ComMatricula', typeof salvarUsuarioPGO5ComMatricula !== 'undefined'],
    ['o wrapper listarUsuariosPGO5ComMatricula', typeof listarUsuariosPGO5ComMatricula !== 'undefined'],
    ['o endpoint getColunasDetalhamentoAnaliseSac', typeof getColunasDetalhamentoAnaliseSac !== 'undefined'],
    ['o endpoint getDetalhamentoEmAnaliseSac', typeof getDetalhamentoEmAnaliseSac !== 'undefined'],
    ['a rota importarBaseLegadaPGO5', typeof importarBaseLegadaPGO5 !== 'undefined'],
    ['a rota listarOrigensLegadasPGO5', typeof listarOrigensLegadasPGO5 !== 'undefined'],
    ['o inicializador 4.x initializeSheets', typeof initializeSheets !== 'undefined'],
    ['a migração migrateLegacyData_', typeof migrateLegacyData_ !== 'undefined'],
    ['a reconstrução de cabeçalho ensureSheetSchema_', typeof ensureSheetSchema_ !== 'undefined'],
    ['o menu menuReinicializar', typeof menuReinicializar !== 'undefined'],
    ['a inicialização sobre base em uso inicializarPGO5Admin', typeof inicializarPGO5Admin !== 'undefined'],
    ['a verificação avulsa verificarMelhoriasPGO5', typeof verificarMelhoriasPGO5 !== 'undefined']
  ].forEach(function(par) { pgo5AfirmarAusencia_(r, par[0], par[1]); });

  ['MelhoriasPGO5', 'ImportacaoPGO5'].forEach(function(arquivo) {
    pgo5AfirmarAusencia_(r, 'o arquivo ' + arquivo + '.html', pgo5ArquivoHtmlExiste_(arquivo));
  });

  // O Index não pode continuar incluindo um arquivo que saiu do produto:
  // o include falha em tempo de renderização e a tela inteira não abre.
  try {
    const indice = HtmlService.createHtmlOutputFromFile('Index').getContent();
    pgo5Afirmar_(r, 'o Index não inclui MelhoriasPGO5',
      indice.indexOf("include('MelhoriasPGO5')") === -1);
    pgo5Afirmar_(r, 'o Index não inclui ImportacaoPGO5',
      indice.indexOf("include('ImportacaoPGO5')") === -1);
  } catch (e) {
    pgo5Afirmar_(r, 'o Index.html foi publicado', false, e.message);
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
