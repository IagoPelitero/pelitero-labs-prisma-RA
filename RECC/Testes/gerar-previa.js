/**
 * ============================================================================
 * RECC — gerar-previa.js · o sistema rodando fora do Apps Script
 * ============================================================================
 *   node RECC/Testes/gerar-previa.js [pasta-de-saida]
 *
 * Monta as telas com o MESMO código do servidor e escreve arquivos .html que
 * abrem em qualquer navegador. Serve para ver e clicar sem precisar publicar
 * no Apps Script a cada mudança.
 *
 * A única coisa trocada é a ponte: no lugar do google.script.run, entra um
 * substituto que responde com o pacote de partida de verdade — o mesmo que a
 * função pacoteDePartida devolveria. Assim a prévia mostra o menu já filtrado
 * pelo nível de acesso, e não uma maquete desenhada à mão.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { carregar } = require('./ferramentas');

const PASTA_PADRAO = path.join(__dirname, '..', '..', 'previa');

/** Substitui google.script.run por respostas vindas do servidor de verdade. */
function pontePreparada(pacote) {
  return '<script>\n'
    + '/* Substituto do google.script.run, só para a prévia. No Apps Script\n'
    + '   de verdade este trecho não existe. */\n'
    + 'var google = { script: { run: (function () {\n'
    + '  var respostas = ' + JSON.stringify({ pacoteDePartida: pacote }, null, 2) + ';\n'
    + '  var aoDarCerto = null;\n'
    + '  var ponte = {\n'
    + '    withSuccessHandler: function (f) { aoDarCerto = f; return ponte; },\n'
    + '    withFailureHandler: function () { return ponte; },\n'
    + '    pacoteDePartida: function () {\n'
    + '      setTimeout(function () { aoDarCerto(respostas.pacoteDePartida); }, 120);\n'
    + '    },\n'
    + '    salvarTemaDoUsuario: function (tema) {\n'
    + '      setTimeout(function () { if (aoDarCerto) aoDarCerto(tema); }, 0);\n'
    + '    }\n'
    + '  };\n'
    + '  return ponte;\n'
    + '})() } };\n'
    + '</script>\n';
}

function gerar(pastaDeSaida) {
  const { ambiente, chamar } = carregar('ana.martins@exemplo.com');

  // Uma instalação inteira, do zero, igual à que o PO vai rodar no editor.
  chamar('instalarRECC()');
  const pacote = chamar('pacoteDePartida()');

  // E a mesma instalação vista por quem não está cadastrado.
  ambiente.definirEmail('nao.cadastrado@exemplo.com');
  const telaSemAcesso = chamar('doGet()').getContent();
  ambiente.definirEmail('ana.martins@exemplo.com');

  const paginaDoSistema = chamar('doGet()').getContent()
    .replace('</head>', pontePreparada(pacote) + '</head>');

  fs.mkdirSync(pastaDeSaida, { recursive: true });
  fs.writeFileSync(path.join(pastaDeSaida, 'sistema.html'), paginaDoSistema);
  fs.writeFileSync(path.join(pastaDeSaida, 'sem-acesso.html'), telaSemAcesso);

  console.log('Prévia gerada em ' + pastaDeSaida);
  console.log('  sistema.html    ' + paginaDoSistema.length + ' bytes  ('
    + pacote.menu.length + ' itens de menu, nível ' + pacote.usuario.nivelAcesso + ')');
  console.log('  sem-acesso.html ' + telaSemAcesso.length + ' bytes');
  return { paginaDoSistema, telaSemAcesso, pacote };
}

if (require.main === module) {
  gerar(process.argv[2] ? path.resolve(process.argv[2]) : PASTA_PADRAO);
}

module.exports = { gerar };
