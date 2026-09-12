/**
 * ============================================================================
 * RECC — Usuarios.gs · o cadastro de quem pode entrar
 * ============================================================================
 * Não existe senha própria: a pessoa entra com a conta Google dela, e o
 * sistema confere o e-mail autenticado contra esta aba. Cadastrar alguém é,
 * literalmente, dar acesso.
 *
 * As funções SEM sublinhado no fim são chamadas pelo navegador. Todas elas
 * começam conferindo permissão — a tela esconde o botão por educação, o
 * servidor confere por obrigação.
 * ============================================================================
 */

/** A lista de usuários, com cargo e nível já traduzidos para nome. */
function listarUsuarios() {
  exigirPermissao_(RECC_ACOES.CONFIGURAR);

  var catalogo = {};
  lerRegistros_('CATALOGO').forEach(function (item) {
    catalogo[converterParaIdentificador_(item.Id)] = item.Nome;
  });

  return lerRegistros_('USUARIOS').map(function (usuario) {
    return {
      id: usuario.Id,
      nome: usuario.Nome,
      email: usuario.Email,
      canalQueAtende: usuario['Canal que atende'],
      cargoId: usuario.CargoId,
      cargo: catalogo[converterParaIdentificador_(usuario.CargoId)] || 'Sem dados',
      nivelAcessoId: usuario.NivelAcessoId,
      nivelAcesso:
        catalogo[converterParaIdentificador_(usuario.NivelAcessoId)] || 'Sem dados',
      matricula: usuario.Matricula,
      ativo: normalizarParaComparar_(usuario.Ativo) === 'sim',
      dataCadastro: usuario.DataCadastro,
      ultimoAcesso: usuario.UltimoAcesso
    };
  });
}

/**
 * Cria ou atualiza um usuário.
 *
 * "Sem dados" no cargo ou no nível não é aceitável na hora de gravar: nível
 * inexistente deixaria a pessoa cadastrada e sem conseguir entrar, e ela não
 * teria como descobrir o motivo sozinha.
 */
function salvarUsuario(dados) {
  exigirPermissao_(RECC_ACOES.CONFIGURAR);

  var email = String(dados.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) {
    throw new Error('Informe um e-mail válido — é por ele que a pessoa entra.');
  }
  if (!String(dados.nome || '').trim()) {
    throw new Error('Informe o nome da pessoa.');
  }
  if (!itemDoCatalogo_(dados.nivelAcessoId)) {
    throw new Error('Escolha um nível de acesso que exista. ' +
      'Sem nível válido a pessoa fica cadastrada e não consegue entrar.');
  }

  var idInformado = converterParaIdentificador_(dados.id);
  var jaCadastrados = lerRegistros_('USUARIOS');
  for (var i = 0; i < jaCadastrados.length; i++) {
    var mesmoEmail =
      normalizarParaComparar_(jaCadastrados[i].Email) === normalizarParaComparar_(email);
    var outraPessoa =
      converterParaIdentificador_(jaCadastrados[i].Id) !== idInformado;
    if (mesmoEmail && outraPessoa) {
      throw new Error('O e-mail ' + email + ' já está cadastrado para ' +
        jaCadastrados[i].Nome + '.');
    }
  }

  var campos = {
    Nome: String(dados.nome).trim(),
    Email: email,
    'Canal que atende': String(dados.canalQueAtende || '').trim(),
    CargoId: converterParaIdentificador_(dados.cargoId),
    NivelAcessoId: converterParaIdentificador_(dados.nivelAcessoId),
    Matricula: converterParaIdentificador_(dados.matricula),
    Ativo: dados.ativo === false ? 'NAO' : 'SIM'
  };

  var gravado;
  if (idInformado) {
    gravado = atualizarRegistro_('USUARIOS', idInformado, campos);
    registrarAuditoria_('usuario.editar', 'USUARIOS', idInformado, '');
  } else {
    campos.DataCadastro = new Date();
    campos.UltimoAcesso = '';
    gravado = inserirRegistro_('USUARIOS', campos);
    registrarAuditoria_('usuario.criar', 'USUARIOS', gravado.Id, '');
  }
  return gravado.Id;
}

/**
 * Tira o acesso da pessoa sem apagar o histórico dela.
 *
 * Desativar e ocultar são coisas diferentes: desativado continua na tela de
 * usuários, com o acesso fechado; ocultado sai da tela. O que nunca acontece
 * é apagar a linha — os registros que ela criou apontam para este Id.
 */
function desativarUsuario(idDoUsuario) {
  var quem = exigirPermissao_(RECC_ACOES.CONFIGURAR);
  var alvo = converterParaIdentificador_(idDoUsuario);

  if (alvo === converterParaIdentificador_(quem.usuario.Id)) {
    throw new Error('Você não pode desativar o próprio acesso. ' +
      'Peça a outro administrador.');
  }
  if (contarAdministradoresAtivos_() <= 1 && ehAdministrador_(alvo)) {
    throw new Error('Este é o último administrador ativo. ' +
      'Cadastre outro antes de desativar este — senão ninguém mais consegue ' +
      'configurar o sistema.');
  }

  atualizarRegistro_('USUARIOS', alvo, { Ativo: 'NAO' });
  registrarAuditoria_('usuario.desativar', 'USUARIOS', alvo, '');
  return true;
}

/** O nível de acesso que pode mexer na estrutura é o de administrador. */
function ehAdministrador_(idDoUsuario) {
  var alvo = converterParaIdentificador_(idDoUsuario);
  var usuarios = lerRegistros_('USUARIOS');
  for (var i = 0; i < usuarios.length; i++) {
    if (converterParaIdentificador_(usuarios[i].Id) !== alvo) continue;
    var nivel = itemDoCatalogo_(usuarios[i].NivelAcessoId);
    if (!nivel) return false;
    return podeFazer_(lerPermissoesDoNivel_(nivel), RECC_ACOES.ESTRUTURA);
  }
  return false;
}

function contarAdministradoresAtivos_() {
  var quantidade = 0;
  lerRegistros_('USUARIOS').forEach(function (usuario) {
    if (normalizarParaComparar_(usuario.Ativo) !== 'sim') return;
    if (ehAdministrador_(usuario.Id)) quantidade++;
  });
  return quantidade;
}

/**
 * Carimba o último acesso.
 *
 * Falhar aqui não pode impedir alguém de entrar: é informação de apoio, não
 * de controle. Por isso o erro é engolido e só vai para o log.
 */
function registrarUltimoAcesso_(usuario) {
  try {
    atualizarRegistro_('USUARIOS', usuario.Id, { UltimoAcesso: new Date() });
  } catch (erro) {
    Logger.log('Não consegui carimbar o último acesso: ' + erro.message);
  }
}
