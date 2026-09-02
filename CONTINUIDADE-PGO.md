# PGO 5.0 — Como retomar este trabalho em outra conversa

Este arquivo existe para que **qualquer conversa nova** consiga continuar o
projeto sem precisar redescobrir nada. Leia-o inteiro antes de tocar em código.

---

## 1. O essencial em cinco linhas

- O banco PGO 5.0 **já está em produção**, e é o sistema **único e final**.
- **`main` é a branch oficial** desde a versão 5.3. Trabalhe a partir dela.
- Versão atual do produto: **5.4**. Ela não mexeu no esquema das abas — versão
  do produto e versão do schema são coisas diferentes.
- Trabalho novo: **crie uma branch** a partir de `main`, nunca commite direto.
- **Não fazer deploy** — a publicação no Apps Script é manual, feita pelo PO.
- Rode a suíte **5 vezes** antes de commitar, e o teste de estresse antes de
  qualquer entrega.
- Nada de dado real no Git: sem CPF, cliente, protocolo real, e-mail
  corporativo, Spreadsheet ID, PIN, token, URL privada ou caminho local.
- **A estrutura da planilha de produção é imutável.** O sistema valida o que
  encontra e para com mensagem clara quando algo não bate — nunca cria,
  renomeia, apaga ou reordena aba e coluna por conta própria.

### Branches

| Branch | O que é |
|---|---|
| `main` | **Oficial e final.** É o que vai para produção |
| `resguardo/main-antes-da-5.3` | Ponto de retorno do estado anterior à consolidação |
| `fix/pgo5-operacao-final` | Branch de trabalho da 5.1 → 5.3, já incorporada ao `main` |
| `fix/pgo5-tombamento-seguro` | Histórica. Não usar — tombamento foi cancelado |
| `fix/correcao-final-main` | Branch de trabalho da 5.4, já incorporada ao `main` |

Para desfazer a consolidação (só se algo grave aparecer em produção):
`git reset --hard resguardo/main-antes-da-5.3` — e avise o PO antes.

---

## 2. Onde está cada coisa

| Caminho | O que é |
|---|---|
| `Back/*.gs` | Backend (Google Apps Script) |
| `Front/*.html` | Frontend (SPA servida por `HtmlService`) |
| `Back/Pgo5Atendimentos.gs` | Motor do formulário, CRUD, regras de data e status |
| `Back/Pgo5Catalogo.gs` | Catálogo (canais, campos, produtos, status…) e seed |
| `Back/Pgo5Permissoes.gs` | Permissões, níveis de acesso e escopos |
| `Back/Pgo5Diagnostico.gs` | `verificarIntegridadeBuildPGO5` — roda dentro do Apps Script |
| `Front/AtendimentoPGO5.html` | Tela Novo Atendimento / edição |
| `Front/AcessoPGO5.html` | **Fonte única** de permissões por tela; Usuários com Matrícula |
| `Front/AnaliseSacConfigPGO5.html` | Fonte da Análise de SAC e as 2 colunas do detalhamento |
| `Front/IndicadoresOperacionais.html` | Painel da Análise de SAC e o detalhamento de Em Análise |

### Ambientes fora do repositório (nunca commitar)

- **Simulador de homologação:** fica numa pasta local, fora do repositório.
  Roda com `node servidor.js` e lê o `Front/` do repositório direto, então
  reflete as alterações sem cópia. O PIN de homologação e o caminho da pasta
  são de cada máquina — **nunca** escreva nenhum dos dois aqui.
- **Suítes de teste:** ficam no diretório temporário da conversa
  (`scratchpad`). Elas **não** são versionadas. Se o `%TEMP%` for limpo, as
  suítes se perdem — o código de produção não depende delas.

---

## 3. Como rodar os testes

Dentro do diretório das suítes:

```bash
node rodar-tudo.js
```

Roda todas as suítes, a homologação e a verificação de contrato das abas.
O critério aceito pelo PO é **5 execuções seguidas sem falha** — rodar uma vez
não detecta teste instável (já aconteceu: uma comparação de carimbo de tempo
falhava quando duas gravações caíam no mesmo milissegundo).

```bash
node checar-sintaxe.js
```

Confere a sintaxe de todo `.gs` e de todo `<script>` dos `.html`, e verifica se
algum CSS ficou **fora** do `<style>` (já houve 2945 bytes de CSS que nunca
foram aplicados por causa disso).

---

## 4. Regras do domínio que não podem ser quebradas

Estas não são preferências de estilo. Quebrar qualquer uma delas causa bug
silencioso em produção.

1. **Cargo ≠ Nível de acesso.** Permissão vem SEMPRE do nível, nunca do cargo.
   Nunca escreva `if (cargo === 'ADM')`.
2. **Status: `Nome` é contrato, `Rotulo` é aparência.** O ADM renomeia o rótulo
   quando quiser. Toda decisão de comportamento usa o Nome técnico
   (`pgo5StatusEhPendente_`, `App.semAcento`).
3. **CPF e Protocolo são identificadores de TEXTO.** Aceitam `0`, `00`,
   `00123`; preservam zeros à esquerda; recusam qualquer caractere que não seja
   dígito; **não** têm dígito verificador no PGO 5.0.
3b. **Toda coluna de identificador é gravada com formato de TEXTO (`@`)**, e
   isso é aplicado na linha, imediatamente antes do `setValues`. Vale para
   `Id`, para qualquer coluna terminada em `Id`, e para CPF, Protocolo e
   Matrícula — ver `pgo5ColunaEhIdentificador_`. Ver a armadilha na seção 5.
4. **Data de abertura**: obrigatória, padrão hoje em `America/Sao_Paulo`
   (decidido pelo **servidor** — o Apps Script roda em UTC e São Paulo está 3h
   atrás), aceita passado, recusa futuro. **Edição preserva a data gravada.**
5. **Aguardando Retorno** só existe em Pendente. Ao sair de Pendente, o campo
   some **e é apagado**; ao voltar, reaparece **vazio** — nunca ressuscita a
   escolha anterior.
6. **Exclusão de item do catálogo é física e sem cascata.** Quem referencia um
   item excluído passa a exibir "Sem dados". `(não informado)` é campo vazio;
   `Sem dados` é referência quebrada. São coisas diferentes.
7. **Cinco abas, e só cinco**: `Atendimentos`, `Usuários`, `Formulário`,
   `ValoresAtendimento`, `Configurações`. Nunca criar aba nova.
8. **Esconder botão não é segurança.** Toda função sensível revalida no servidor
   com `exigirPermissao_`.
9. **Estrutura da planilha é imutável em produção.** Nenhum caminho do produto
   cria, renomeia, apaga ou reordena aba e coluna. Estrutura incompatível
   interrompe a operação com mensagem clara; ninguém "conserta" sozinho.
10. **Matrícula é do contrato de Usuários**, gravada pela chave exata
    `Matrícula` (com acento) e tratada como TEXTO — `000123` ≠ `123`. Não
    existe wrapper: quem grava é `salvarUsuarioPGO5`.
11. **O detalhamento de "Em Análise" tem UMA implementação**, nativa: as duas
    colunas ficam na configuração da Análise de SAC e a lista vem junto de
    `getIndicadoresOperacionais`. A classificação usa `classificarStatusOp_`
    e o grupo técnico `emAnalise` — nunca o texto do status.

---

## 4b. Como o sistema trata a planilha (perguntas frequentes)

### Abrir o sistema NÃO cria e NÃO converte nada

Na abertura, `ensureDatabaseReady()` apenas **confere** se as cinco abas
existem com os cabeçalhos do contrato. Se estiver tudo certo, o sistema segue.
Se não estiver, ele **para** com uma mensagem dizendo o que encontrou e não
toca em nada — nenhuma aba é criada, renomeada, apagada ou reordenada.

Isso já foi diferente, e o estrago era grande: quando a versão do esquema
divergia, a abertura chamava o inicializador do modelo 4.x, que criava 11 abas
antigas e APAGAVA abas ditas obsoletas — uma delas chamada `Configurações`,
que no PGO 5.0 é uma das cinco abas oficiais.

### Então como nasce uma instalação nova?

Só de propósito, e só sobre planilha vazia: `inicializarPGO5Dev()`, executada
no editor do Apps Script pelo dono do projeto. Ela **recusa** rodar se
qualquer uma das cinco abas já tiver dados. Depois de criar as abas, o seed
(`pgo5AplicarSeedEstrutural_()`) semeia o catálogo inicial — 2 canais
(SAC Preventivo e Chat do RA), campos, status e "aguardando" — e cadastra
**quem executou como o primeiro Administrador**.

Esse último passo não é conveniência: o acesso é pelo e-mail autenticado
conferido contra a aba Usuários, e uma base recém-criada tem essa aba vazia.
Sem ninguém dentro, ninguém entra; e sem entrar, ninguém cadastra. A saída
anterior era digitar a primeira linha à mão — justamente onde o Sheets
transforma `00000001` no número 1.

Não existe variante "para base em uso". A que existia reajustava o esquema de
Atendimentos e reclassificava campos já gravados; foi removida.

### Gravar pode alterar a estrutura?

Não. Se o cabeçalho de uma aba estiver fora da ordem esperada, a gravação é
**cancelada** com erro explícito. A rotina que reescrevia o cabeçalho e
remanejava as colunas durante uma gravação comum foi removida.

### Ele lê dados que já estavam lá?

Sim, inclusive linhas escritas direto na planilha, sem passar pelo sistema.
Basta que estejam nas colunas certas: Dashboard, Relatórios e Produtividade
passam a exibi-las na leitura seguinte.

⚠️ **Abas de sistemas anteriores que sobrarem na planilha** (`ReclameAqui`,
`SACPreventivo`, `Produtos`, `Categorias`…) são **ignoradas**: o PGO não lê,
não escreve e não apaga nenhuma delas. Removê-las é decisão do PO, manual, e
só depois de conferir que nada mais as consome.

---

## 5. Armadilhas já encontradas (não repita)

- **Listas de permissão duplicadas.** A regra de quais permissões abrem cada
  tela vive em UM lugar: `AcessoPGO5.PERMISSOES_DA_TELA`. Já houve três cópias
  fora de sincronia e uma tela ficou inalcançável para quem tinha direito a ela.
- **Uma rota, duas ações.** `novoAtendimento` **com** id é EDIÇÃO. Cobrar
  `criarAtendimento` ali tira o botão Editar de quem só edita.
- **Menu vazio ≠ sem permissão.** Se o resumo de acesso falhar, o backend
  devolve `indisponivel: true` com motivo técnico e o front avisa. Nunca deixe
  a falha virar uma lista de permissões vazia e silenciosa.
- **Registro legado incompleto.** A base tem atendimentos herdados do sistema
  anterior, sem `StatusId`/`DataAbertura`. Editar um desses precisa funcionar — o padrão
  entra só quando o campo está vazio.
- **Stub de teste que finge.** O sandbox já teve `computeDigest: () => [1]` e um
  `formatDate` fixo. Testes sobre eles passavam sem testar nada. Hoje usam
  SHA-256 e `Intl` reais, e o relógio pode ser congelado (`congelarRelogio`).
- **O Sheets converte identificador em número, e isso corrompeu a base.**
  Texto "que parece número" gravado numa célula de formato Geral vira número:
  `00000010` → `10` (zeros perdidos) e `000000E1` → `0` (**notação
  científica**). Nos primeiros 200 mil Ids, 31 mil viravam decimal, 9 mil
  viravam científico e havia **4.328 colisões**. O estrago era em cascata:
  `pgo5ObterPorId` não achava o registro; `pgo5AtualizarPorId` gravava por
  cima da primeira linha com o valor repetido — dado de um registro em cima
  de outro; e o gerador de sequência, sem reconhecer o Id deformado, baixava
  o piso da aba e voltava a **emitir Ids já em uso**.
  A proteção é formatar a linha como texto ANTES de gravar. Formatar depois
  não desfaz nada, e formatar só na criação da aba não cobre linha nova.
- **Simulador que não coage é simulador que mente.** A planilha falsa das
  suítes gravava string como string, então nenhum teste via o problema acima.
  Hoje ela converte igual ao Sheets e respeita o formato `@` — foi o que fez
  as 13 falhas aparecerem de uma vez.
- **Guarda `typeof` não protege `const` de outro arquivo.** `typeof X !== 'undefined'`
  salva de nome inexistente, mas um `const` de outro `.gs` ainda não avaliado lança
  "Cannot access X before initialization" e derruba a carga do projeto inteiro. Não
  escreva código de topo que dependa de outro arquivo — leia dentro de uma função.
- **Diagnóstico que pula é diagnóstico que aprova errado.** Os blocos do
  `verificarIntegridadeBuildPGO5` eram embrulhados em `if (typeof f === 'function')`:
  quando o arquivo não era publicado — o que a ferramenta existe para achar — o bloco
  sumia e o build era declarado íntegro. Função ausente agora é FALHA.
- **Grade fixa em formulário variável.** Cada canal pergunta campos diferentes;
  spans fixos deixavam a linha pela metade. O formulário usa **flex** com base
  por campo, então a linha fecha com qualquer combinação.

---

## 6. Onde parou

Concluídos e validados: acesso ao Novo Atendimento, data/status/aguardando,
formulário compacto, teclado + `Ctrl+Enter`, salvamento único, cache do
catálogo, cards e tabela do Dashboard.

Na 5.4 o produto ficou **somente leitura quanto à estrutura**: saíram o
inicializador 4.x, as migrações entre abas, a reconstrução de cabeçalho, o
menu "Reinicializar Planilhas" e a Importar Base Legada. Matrícula e o
detalhamento de "Em Análise" passaram a ser **nativos**, com uma única
implementação cada.

⚠️ **Ao publicar, APAGUE do editor do Apps Script** os arquivos que saíram do
produto, se ainda estiverem lá: `Pgo5Importacao.gs`, `ZMelhoriasPGO5.gs`,
`ImportacaoPGO5.html`, `MelhoriasPGO5.html` e, de versões anteriores,
`Pgo5Tombamento.gs`, `Pgo5Migracao.gs` e `TombamentoPGO5.html`. Deixá-los
ressuscita caminhos que o produto não tem mais — e o
`verificarIntegridadeBuildPGO5` agora REPROVA o build quando encontra
qualquer um deles.

### Ainda em aberto

- **Separar o código 4.x de `Services.gs` e `Database.gs`.** Esses arquivos
  ainda misturam a ponte de dados que o 5.0 usa com leituras do modelo antigo.
  As rotinas que ESCREVIAM estrutura já saíram; o que resta é leitura. Trate
  como trabalho próprio, com validação própria, e nunca junto de uma entrega
  com prazo.
- `listarAtendimentosPGO5_` não é chamada por ninguém no backend.

---

## 7. Publicação (o PO faz manualmente)

O Apps Script está num ambiente sem acesso a partir daqui. Para publicar, o
próprio PO copia o conteúdo dos arquivos para o editor do Apps Script.

São **26 arquivos** ao todo: **14 `.gs`** e **12 `.html`**.

Os 14 `.gs`, na ordem alfabética em que o Apps Script os avalia:

1. `Code.gs`
2. `Config.gs`
3. `Database.gs`
4. `Pgo5.gs`
5. `Pgo5Analitico.gs`
6. `Pgo5Atendimentos.gs`
7. `Pgo5Auditoria.gs`
8. `Pgo5Catalogo.gs`
9. `Pgo5Diagnostico.gs`
10. `Pgo5Permissoes.gs`
11. `Pgo5Seguranca.gs`
12. `Pgo5Usuarios.gs`
13. `Services.gs`
14. `Utils.gs`

Os 12 `.html` — `Index.html` mais os 11 que ele inclui, nesta ordem:
`Styles`, `Scripts`, `Components`, `Dashboard`, `AtendimentoPGO5`,
`ConfiguracoesPGO5`, `AcessoPGO5`, `AnaliseSacConfigPGO5`, `Relatorios`,
`Indicadores`, `IndicadoresOperacionais`.

⚠️ **Nenhum arquivo pode ter código de topo que dependa de outro arquivo.**
O nome do arquivo define quando ele é avaliado, e uma constante de topo lida
antes da hora derruba a carga do projeto INTEIRO com `ReferenceError` — o
sintoma aparece longe da causa. Se precisar de um valor de outro arquivo,
leia-o dentro de uma função.

**Depois de publicar**, rode primeiro `verificarIntegridadeBuildPGO5` no
editor do Apps Script: ela só lê e diz, em segundos, se algum arquivo ficou
para trás na cópia manual. Nenhum teste rodado fora do Apps Script pega isso.

Depois, na interface — cada passo prova uma camada:

1. o sistema abre e o menu aparece;
2. Novo Atendimento abre e lista os canais;
3. a Data já vem preenchida com hoje e não aceita amanhã;
4. o Status já vem em Pendente;
5. salvar um atendimento de teste e vê-lo no Dashboard;
6. entrar com um perfil Operacional e repetir os passos 2 a 5.

Se o menu aparecer vazio, **não é falta de permissão**: é o resumo de acesso
falhando. A tela mostra o motivo técnico — leia a mensagem antes de mexer.

---

## 8. Como pedir trabalho numa conversa nova

Cole isto, ajustando a última linha:

> Projeto PGO 5.0, repositório `pelitero-labs-prisma-RA`, branch `main`
> (é a oficial e final). Leia `CONTINUIDADE-PGO.md` na raiz antes de
> qualquer coisa e siga as regras de lá.
> Crie uma branch a partir de `main` para o trabalho — não commite direto
> nela. Não faça deploy: a publicação no Apps Script é manual e é minha.
> Rode a suíte 5 vezes e o teste de estresse antes de commitar.
> O que eu preciso agora é: **_(descreva aqui)_**
