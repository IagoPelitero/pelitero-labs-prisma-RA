/**
 * ============================================================================
 * RECC — testes-casca.js · a Etapa 3
 * ============================================================================
 * A casca é o que aparece em toda tela: menu lateral, barra superior, os
 * quatro temas e a troca de telas. Os testes aqui cobrem duas frentes:
 *
 *   o que o SERVIDOR entrega — a página montada, com a identidade dentro;
 *   o que o CSS promete      — que nenhum componente escreve cor à mão, que
 *                              é o que faz a troca de tema funcionar inteira.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { carregar, secao, teste, igual, verdadeiro, contem, lanca } =
  require('./ferramentas');
const { gerar } = require('./gerar-previa');

const PASTA_DAS_TELAS = path.join(__dirname, '..', 'Telas');

function lerTela(nome) {
  return fs.readFileSync(path.join(PASTA_DAS_TELAS, nome), 'utf8');
}

function rodarTestesDaCasca() {
  console.log('\nEtapa 3 — Casca');

  const { ambiente, chamar } = carregar('primeiro.adm@exemplo.com');
  chamar('instalarRECC()');

  secao('A página que o servidor entrega');

  teste('doGet monta o sistema para quem está cadastrado', () => {
    const html = chamar('doGet()').getContent();
    contem(html, 'id="aplicacao"', 'a casca precisa estar na página');
    contem(html, 'id="lateral"', 'o menu lateral');
    contem(html, 'id="superior"', 'a barra superior');
    verdadeiro(html.indexOf('Seu acesso ainda não foi liberado') < 0,
      'quem está cadastrado não pode receber a tela de bloqueio');
  });

  teste('a identidade chega ao template — o Index a usa no título', () => {
    const html = chamar('doGet()').getContent();
    contem(html, '<title>RECC</title>', 'o título vem de CONFIG');
    contem(html, 'class="carregando-marca">RECC', 'a marca de abertura');
  });

  teste('os estilos e os scripts foram colados na página', () => {
    // No Apps Script não existe importar HTML: o servidor cola um arquivo
    // dentro do outro. Se o incluir falhar, a página sai sem CSS e sem JS.
    const html = chamar('doGet()').getContent();
    contem(html, '<style>', 'os estilos');
    contem(html, 'var Moldura', 'o script da moldura');
    contem(html, 'var Aplicacao', 'o script da aplicação');
    verdadeiro(html.indexOf('incluir(') < 0,
      'nenhum scriptlet pode sobrar sem ser executado');
  });

  secao('Os quatro temas');

  teste('os quatro temas existem e definem as mesmas variáveis', () => {
    const estilos = lerTela('Estilos.html');
    const temas = ['padrao', 'rosa', 'dark', 'brasil'];
    const variaveisPorTema = {};

    temas.forEach((tema) => {
      const marca = tema === 'padrao'
        ? ':root, :root[data-tema="padrao"] {'
        : ':root[data-tema="' + tema + '"] {';
      const inicio = estilos.indexOf(marca);
      verdadeiro(inicio >= 0, 'falta o bloco do tema ' + tema);
      const bloco = estilos.substring(inicio, estilos.indexOf('}', inicio));
      variaveisPorTema[tema] = (bloco.match(/--[a-z-]+:/g) || [])
        .map((v) => v.replace(':', '')).sort();
      verdadeiro(variaveisPorTema[tema].length >= 15,
        'o tema ' + tema + ' define poucas variáveis: '
        + variaveisPorTema[tema].length);
    });

    // O padrão é a referência: todo tema precisa redefinir tudo o que ele
    // define, senão sobra cor do tema anterior ao trocar.
    variaveisPorTema.padrao.forEach((variavel) => {
      temas.slice(1).forEach((tema) => {
        verdadeiro(variaveisPorTema[tema].indexOf(variavel) >= 0,
          'o tema ' + tema + ' não redefine ' + variavel);
      });
    });
  });

  teste('nenhum componente escreve cor à mão — só variável', () => {
    // Esta é a trava da regra escrita no topo do Estilos.html. Uma cor solta
    // num componente sobrevive à troca de tema, e o rosa fica com um pedaço
    // azul. As bolinhas do seletor são a exceção declarada: elas SÃO as
    // amostras das cores, então precisam da cor literal.
    const estilos = lerTela('Estilos.html');
    const semTokens = estilos.replace(/:root[^{]*\{[\s\S]*?\}/g, '');
    const regras = semTokens.split('}');
    const infratores = [];

    regras.forEach((regra) => {
      const seletor = regra.split('{')[0].trim();
      if (!seletor || seletor.indexOf('.tema-') >= 0) return;
      const cores = (regra.match(/#[0-9A-Fa-f]{3,8}\b/g) || []);
      if (cores.length) infratores.push(seletor.replace(/\s+/g, ' ') + ' → ' + cores.join(' '));
    });

    igual(infratores.length, 0, 'cores fora das variáveis: ' + infratores.join(' | '));
  });

  teste('a marca do menu usa a logo quando ela existe', () => {
    const moldura = lerTela('Moldura.html');
    contem(moldura, 'if (identidade.logo)', 'a logo de CONFIG tem prioridade');
    contem(moldura, 'class="escrito"', 'sem logo, o nome faz as vezes dela');
  });

  secao('Guardar o tema escolhido');

  teste('pacoteDePartida devolve o tema, e o padrão é o azul', () => {
    igual(chamar('pacoteDePartida()').tema, 'padrao');
  });

  teste('o tema escolhido é guardado e volta na próxima abertura', () => {
    igual(chamar('salvarTemaDoUsuario')('brasil'), 'brasil');
    igual(chamar('pacoteDePartida()').tema, 'brasil');
    chamar('salvarTemaDoUsuario')('padrao');
  });

  teste('tema desconhecido é recusado, e diz quais existem', () => {
    lanca(() => chamar('salvarTemaDoUsuario')('roxo'),
      'Os temas são padrao, rosa, dark, brasil');
  });

  teste('tema estragado na propriedade cai no padrão em vez de quebrar', () => {
    ambiente.propriedadesDoUsuario.set('RECC_TEMA_ESCOLHIDO', 'lixo');
    igual(chamar('pacoteDePartida()').tema, 'padrao');
  });

  teste('quem não está cadastrado não guarda tema', () => {
    ambiente.definirEmail('estranho@exemplo.com');
    lanca(() => chamar('salvarTemaDoUsuario')('dark'), 'Acesso negado');
    ambiente.definirEmail('primeiro.adm@exemplo.com');
  });

  secao('O menu e a guarda de rota');

  teste('o menu do Administrador traz as sete telas', () => {
    const pacote = chamar('pacoteDePartida()');
    igual(pacote.menu.length, 7);
    igual(pacote.menu[0].tela, 'dashboard');
    igual(pacote.menu[6].titulo, 'Configurações');
  });

  teste('a guarda de rota vive no roteador, não no menu', () => {
    // Esconder o item não impede ninguém de digitar #configuracoes no
    // endereço. Quem barra é o irPara, conferindo contra o menu recebido.
    const aplicacao = lerTela('Aplicacao.html');
    contem(aplicacao, 'if (!Rotas.existe(tela) || !podeVer(tela))',
      'a troca de tela precisa conferir a permissão');
  });

  teste('toda tela do menu tem uma rota correspondente', () => {
    const aplicacao = lerTela('Aplicacao.html');
    chamar('pacoteDePartida()').menu.forEach((item) => {
      contem(aplicacao, item.tela + ': {', 'falta a rota de ' + item.tela);
    });
  });

  secao('A prévia navegável');

  teste('a prévia é gerada com o pacote de verdade dentro', () => {
    const pasta = fs.mkdtempSync(path.join(require('os').tmpdir(), 'recc-previa-'));
    const gerada = gerar(pasta);

    contem(gerada.paginaDoSistema, 'var google = { script:',
      'a ponte substituta precisa entrar na página');
    contem(gerada.paginaDoSistema, '"disponivel": true',
      'o pacote embutido é o que o servidor devolveu');
    igual(gerada.pacote.menu.length, 7, 'o menu da prévia é o menu de verdade');
    contem(gerada.telaSemAcesso, 'Seu acesso ainda não foi liberado');

    verdadeiro(fs.existsSync(path.join(pasta, 'sistema.html')));
    fs.rmSync(pasta, { recursive: true, force: true });
  });
}

module.exports = { rodarTestesDaCasca };
