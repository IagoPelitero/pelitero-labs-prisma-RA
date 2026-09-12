/**
 * ============================================================================
 * RECC — rodar.js · roda a suíte inteira
 * ============================================================================
 *   node RECC/Testes/rodar.js
 *
 * Cada etapa tem o seu arquivo de testes. Este aqui só chama todos e conta o
 * resultado. O critério de aceite é CINCO execuções seguidas sem falha —
 * rodar uma vez não detecta teste instável.
 * ============================================================================
 */

const { resumo } = require('./ferramentas');
const { rodarTestesDaFundacao } = require('./testes-fundacao');
const { rodarTestesDeAcesso } = require('./testes-acesso');

rodarTestesDaFundacao();
rodarTestesDeAcesso();

const { passaram, falhas } = resumo();
console.log('\n' + '-'.repeat(60));
if (falhas.length) {
  console.log(passaram + ' passaram, ' + falhas.length + ' FALHARAM');
  process.exitCode = 1;
} else {
  console.log(passaram + ' testes, todos passaram');
}
console.log('-'.repeat(60) + '\n');
