# PGO 5.0 — Como retomar este trabalho em outra conversa

Este arquivo existe para que **qualquer conversa nova** consiga continuar o
projeto sem precisar redescobrir nada. Leia-o inteiro antes de tocar em código.

---

## 1. O essencial em cinco linhas

- O banco PGO 5.0 **já está em produção**, e é o sistema **único e final**.
- **`main` é a branch oficial** desde a versão 5.3. Trabalhe a partir dela.
- Trabalho novo: **crie uma branch** a partir de `main`, nunca commite direto.
- **Não fazer deploy** — a publicação no Apps Script é manual, feita pelo PO.
- Rode a suíte **5 vezes** antes de commitar, e o teste de estresse antes de
  qualquer entrega.
- Nada de dado real no Git: sem CPF, cliente, protocolo real, e-mail
  corporativo, Spreadsheet ID, PIN, token, URL privada ou caminho local.

### Branches

| Branch | O que é |
|---|---|
| `main` | **Oficial e final.** É o que vai para produção |
| `resguardo/main-antes-da-5.3` | Ponto de retorno do estado anterior à consolidação |
| `fix/pgo5-operacao-final` | Branch de trabalho da 5.1 → 5.3, já incorporada ao `main` |
| `fix/pgo5-tombamento-seguro` | Histórica. Não usar |

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
| `Back/Pgo5Importacao.gs` | Importar Base Legada (acrescenta histórico à base em uso) |
| `Back/Pgo5Diagnostico.gs` | `verificarIntegridadeBuildPGO5` — roda dentro do Apps Script |
| `Front/AtendimentoPGO5.html` | Tela Novo Atendimento / edição |
| `Front/AcessoPGO5.html` | **Fonte única** de permissões por tela |

### Ambientes fora do repositório (nunca commitar)

- **Simulador de homologação:** `C:\Users\iago2\OneDrive\Desktop\pgo5-homologacao-local\`
  Roda com `node servidor.js` na porta **8140** e lê o `Front/` do repositório
  direto, então reflete as alterações sem cópia. PIN da homologação: `135790`.
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

---

## 4b. Como o sistema trata a planilha (perguntas frequentes)

### As abas não existem → ele cria

`inicializarPGO5_()` roda na abertura e cria as cinco abas com o cabeçalho
correto. Em seguida `pgo5AplicarSeedEstrutural_()` semeia o catálogo inicial
(3 canais, 27 campos, 3 status, produtos e "aguardando"). Uma planilha em
branco vira uma instalação utilizável sem nenhuma intervenção.

### As abas já existem → ele lê e reflete, sem recriar

Reabrir o sistema sobre uma base em uso **não apaga, não recria e não
sobrescreve**: as abas existentes são reconhecidas e os dados seguem intactos.
O seed também não ressuscita item que o ADM excluiu de propósito — ele guarda
em Script Property (por planilha) o que já semeou alguma vez.

### Ele lê dados que já estavam lá?

Sim, inclusive linhas escritas direto na planilha, sem passar pelo sistema.
Basta que estejam nas colunas certas: Dashboard, Relatórios e Produtividade
passam a exibi-las na leitura seguinte. É por isso que a Importar Base Legada
apenas ACRESCENTA linhas — não precisa de mais nada para o dado aparecer.

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
- **Registro legado incompleto.** A base veio de tombamento e tem atendimentos
  sem `StatusId`/`DataAbertura`. Editar um desses precisa funcionar — o padrão
  entra só quando o campo está vazio.
- **Stub de teste que finge.** O sandbox já teve `computeDigest: () => [1]` e um
  `formatDate` fixo. Testes sobre eles passavam sem testar nada. Hoje usam
  SHA-256 e `Intl` reais, e o relógio pode ser congelado (`congelarRelogio`).
- **Grade fixa em formulário variável.** Cada canal pergunta campos diferentes;
  spans fixos deixavam a linha pela metade. O formulário usa **flex** com base
  por campo, então a linha fecha com qualquer combinação.

---

## 6. Onde parou

Concluídos e validados: acesso ao Novo Atendimento, data/status/aguardando,
formulário compacto, teclado + `Ctrl+Enter`, salvamento único, cache do
catálogo, cards e tabela do Dashboard, e **Importar Base Legada**.

Na 5.3 o sistema foi consolidado: saiu o caminho 4.x, saíram os motores de
conversão de base (8 arquivos, ~5.500 linhas) e entrou o
`Back/Pgo5Diagnostico.gs`. Existe **uma implementação por responsabilidade**.

⚠️ **Ao publicar, APAGUE do editor do Apps Script** os arquivos removidos, se
ainda estiverem lá: `Pgo5Tombamento.gs`, `Pgo5Migracao.gs` e
`TombamentoPGO5.html`. Deixá-los não quebra nada, mas ressuscita a tela de
tombamento — que não existe mais no produto.

### Ainda em aberto

- **Separar o código 4.x de `Services.gs` (3.440 linhas) e `Database.gs`
  (1.663).** Esses arquivos misturam a ponte de dados que o 5.0 usa com
  caminhos do modelo antigo. Não foi feito por ser refatoração ampla, de
  risco alto — trate como trabalho próprio, com validação própria, e nunca
  junto de uma entrega com prazo.
- `listarAtendimentosPGO5_` não é chamada por ninguém no backend.

---

## 7. Publicação (o PO faz manualmente)

O Apps Script está num ambiente sem acesso a partir daqui. Para publicar, o
próprio PO copia o conteúdo dos arquivos para o editor do Apps Script.

**Ordem que evita erro de referência** — o Apps Script carrega os `.gs` em
ordem alfabética, mas as constantes de topo são avaliadas na carga:

1. `Config.gs`, `Utils.gs`, `Database.gs`
2. `Pgo5.gs`, `Pgo5Auditoria.gs`, `Pgo5Permissoes.gs`, `Pgo5Seguranca.gs`
3. `Pgo5Usuarios.gs`, `Pgo5Catalogo.gs`, `Pgo5Atendimentos.gs`
4. `Pgo5Importacao.gs`, `Pgo5Analitico.gs`, `Pgo5Diagnostico.gs`
5. `Services.gs`, `Code.gs`
6. Todos os `.html` do `Front/`

São **27 arquivos** ao todo (14 `.gs` e 13 `.html`).

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
