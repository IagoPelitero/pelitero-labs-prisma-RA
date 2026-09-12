# RECC

Sistema novo, construído do zero sobre a plataforma **PGO** (Pelitero Labs).
Não compartilha código com o PGO 5.x das pastas `Back/` e `Front/` da raiz (essas duas continuam com o nome antigo porque são o sistema antigo).

O desenho completo — modelo de dados, decisões e o porquê de cada uma — está em
[`../ARQUITETURA-RECC.md`](../ARQUITETURA-RECC.md). **Leia antes de mexer aqui.**

Como os nomes deste código são escolhidos está em
[`../PADRAO-DE-CODIGO.md`](../PADRAO-DE-CODIGO.md): tudo em português por
extenso, sem abreviação, salvo os nomes do próprio Google.

```
Servidor/   os arquivos .gs, que rodam no Apps Script
Telas/      os arquivos .html, que rodam no navegador (ainda não existem)
Testes/     a suíte, que roda no computador com node
```

---

## O que já existe

**Etapa 1 — Fundação.** Quatro arquivos, e é o alicerce de tudo:

| Arquivo | O que faz |
|---|---|
| `Servidor/Esquema.gs` | O contrato: as 12 abas, os cabeçalhos e o tipo de cada coluna |
| `Servidor/Planilha.gs` | A porta única para o Planilhas: vínculo por cabeçalho e formato antes da gravação |
| `Servidor/Sequencia.gs` | O Id decimal de 10 casas, que nunca anda para trás |
| `Servidor/Instalador.gs` | Cria as 12 abas numa planilha vazia e semeia o que é editável |

**Etapa 2 — Acesso.**

| Arquivo | O que faz |
|---|---|
| `Servidor/Acesso.gs` | Níveis, escopo, senha de administrador e auditoria |
| `Servidor/Usuarios.gs` | O cadastro de quem pode entrar |
| `Servidor/Principal.gs` | `doGet`, o pacote de partida e a identidade visual |
| `Telas/SemAcesso.html` | A tela de quem não está cadastrado |

**Etapa 3 — Casca.**

| Arquivo | O que faz |
|---|---|
| `Telas/Index.html` | O esqueleto da página, que cola os outros dentro de si |
| `Telas/Estilos.html` | Toda a aparência, e os quatro temas |
| `Telas/Moldura.html` | Monta o menu lateral e a barra superior |
| `Telas/Aplicacao.html` | A ponte com o servidor, o roteador e as telas |

## Instalar

1. Crie uma planilha **nova e vazia** e um projeto do Apps Script vinculado.
2. Copie os arquivos. **O projeto do Apps Script não tem pastas** — as pastas
   aqui são só organização do repositório. Um arquivo vira um arquivo lá,
   com o mesmo nome e sem a pasta:

   | Aqui no repositório | No editor do Apps Script |
   |---|---|
   | `RECC/Servidor/Acesso.gs` | `Acesso.gs` |
   | `RECC/Telas/Index.html` | `Index.html` |
   | `RECC/Testes/*` | **não vai** — roda só no seu computador |

   A ordem da cópia não importa: o Apps Script avalia os `.gs` em ordem
   alfabética e nenhum deles tem código de topo que dependa de outro.
3. Publique como aplicativo da web (executar como você).
4. No editor, execute **`instalarRECC()`** uma vez. Ela **recusa** rodar se
   qualquer aba do contrato já tiver dado.
5. Confira com **`verificarEstruturaRECC()`** — só lê, e diz o que falta.

`instalarRECC()` cadastra **quem a executou como o primeiro Administrador**.
Sem isso a base nasceria inacessível: o acesso é pelo e-mail autenticado
conferido contra a aba `USUARIOS`, e uma base recém-criada tem essa aba vazia.

Nenhum dado operacional é semeado: bases, canais, produtos e SUSEPs bloqueadas
nascem vazios.

## Testar

```bash
node RECC/Testes/rodar.js
```

32 testes. O critério é **5 execuções seguidas sem falha**.

Os testes rodam contra um Google Planilhas falso que **converte valores igual
ao de verdade** (`Testes/simulador.js`): numa célula de formato Geral,
`'00000010'` vira `10` e `'000000E1'` vira `0`. Simulador que não coage é
simulador que mente — foi assim que o sistema anterior deixou passar a
corrupção de 4.328 Ids.

## Ver as telas sem publicar

```bash
node RECC/Testes/gerar-previa.js
```

Escreve `previa/sistema.html` e `previa/sem-acesso.html`, que abrem em
qualquer navegador. As páginas são montadas pelo **mesmo código do servidor** —
o que muda é só a ponte: no lugar do `google.script.run`, entra um substituto
com o pacote de partida de verdade. Serve para conferir menu, temas e troca de
telas sem publicar no Apps Script a cada mudança.

## A logo da operação

A logo **não fica no código**, fica em `CONFIG`, na chave
`IDENTIDADE.LOGO_URL`. É o que permite a mesma plataforma servir outra
operação trocando uma linha da planilha.

Duas formas de definir, as duas sem precisar hospedar arquivo:

| Forma | Quando usar |
|---|---|
| `https://…/marca.png` | A empresa já publica a imagem em algum endereço |
| `data:image/png;base64,iVBORw0…` | A imagem inteira dentro da célula. Não depende de nada |

Pode colar direto na célula da aba `CONFIG`, ou chamar `definirLogo(valor)`.
Enquanto a chave estiver vazia, o nome do sistema faz as vezes da logo — nunca
aparece um ícone quebrado.

## Manutenção da planilha

| Situação | O que fazer |
|---|---|
| Alguém digitou linhas direto na planilha | `normalizarIdentificadoresDaAba_('BASE_MESA')` carimba os Ids que faltam |
| Uma coluna foi renomeada na planilha | `verificarEstruturaRECC()` mostra o que sumiu e o que apareceu |
| Precisa de uma coluna nova | `adicionarColuna_(aba, cabeçalho, tipo)` — cria no fim e registra o tipo em `CAMPOS` |

Excluir dado **nunca** apaga linha: `_Visivel = NAO` some do sistema e a linha
permanece na planilha, e voltar é editar essa célula na mão.
