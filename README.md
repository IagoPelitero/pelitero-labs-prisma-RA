# PRISMA — Gestão Operacional (PGO)

**Sistema de gestão de atendimentos multicanal** sobre Google Apps Script e Google
Sheets: sem servidor, sem banco de dados externo e sem custo de infraestrutura.

Desenvolvido por **Pelitero Labs**.

---

## O que o sistema faz

O PGO registra e acompanha atendimentos que chegam por vários canais (SAC Preventivo,
Chat do RA e outros que o administrador criar), controlando quem vê o quê, quem
pode alterar o quê, e entregando os números da operação prontos para leitura.

| Tela | Para que serve |
|---|---|
| **Dashboard** | Visão do dia: indicadores, filtros e a lista de atendimentos |
| **Novo Atendimento** | Registro e edição, com formulário montado pelo canal |
| **Relatórios** | Consulta com filtros combináveis e exportação |
| **Produtividade Equipe** | Quanto a equipe produziu, por pessoa e por período |
| **Análise de SAC** | Indicadores consolidados a partir de planilha externa |
| **Configurações** | Catálogo, usuários, níveis de acesso, segurança e fonte da Análise de SAC |

---

## Como está montado

```
Navegador (SPA)                Google Apps Script            Google Sheets
├── Index.html  ── casca       ├── Services.gs   ── ponte    ├── Atendimentos
├── Scripts.html ── rotas      ├── Pgo5*.gs      ── domínio  ├── Usuários
├── Components.html ── peças   └── Database.gs   ── acesso   ├── Formulário
└── *PGO5.html   ── telas                                    ├── ValoresAtendimento
                                                             └── Configurações
```

**Cinco abas, e apenas cinco.** Criar um campo novo não cria coluna nem aba: campos
fora do conjunto estrutural são gravados como linhas em `ValoresAtendimento`. É o que
permite o administrador redesenhar o formulário sem tocar em código.

### Formulário dinâmico

Cada canal define quais campos pergunta. O motor lê a aba `Formulário` e monta a tela;
o servidor revalida tudo o que chega. Um canal novo já nasce com o formulário padrão da
operação, e o administrador desativa ou exclui o que não usar.

### Permissões

Duas coisas diferentes, deliberadamente separadas:

- **Cargo** — a função organizacional da pessoa (o que ela *é*).
- **Nível de acesso** — o que ela *pode fazer*. É daqui que sai toda permissão.

O alcance de cada pessoa sobre os dados é o **escopo**: `PRÓPRIOS`, `EQUIPE` (a partir
da hierarquia de supervisão), `TODOS` ou `NENHUM`. Nenhuma decisão do sistema é tomada
pelo nome do cargo ou pelo texto exibido na tela.

### Segurança

- Acesso pelo e-mail autenticado do Google — sem senha própria.
- Operações sensíveis exigem **permissão + PIN** (SHA-256 com *salt*, fora da planilha).
- Três tentativas erradas bloqueiam o PIN por 24 h; sessão liberada por 5 minutos.
- Auditoria das ações relevantes, sem gravar dado pessoal.
- Esconder um botão nunca é a proteção: toda função sensível revalida no servidor.

---

## Instalação

1. Crie uma planilha **nova e vazia** no Google Sheets e um projeto do Apps Script
   vinculado a ela.
2. Copie os **26 arquivos**: os 14 `.gs` da pasta `Back/` e os 12 `.html` da pasta
   `Front/`. Nenhum arquivo tem código de topo que dependa de outro, então a ordem
   da cópia não importa — o Apps Script os avalia em ordem alfabética.
3. Publique como **Web App** (executar como você; acesso conforme a política da empresa).
4. No editor, execute **`inicializarPGO5Dev()`** uma única vez. É a única ação do
   sistema que cria aba, e ela **recusa** rodar se a planilha já tiver dados.
5. Cadastre-se na aba `Usuários` com nível Administrador e defina o PIN.

> **Instalação sobre uma planilha que já está em uso não existe.** Abrir o sistema
> apenas VALIDA a estrutura encontrada: se ela não bate com o contrato, a operação
> é interrompida com uma mensagem dizendo o que está fora — nada é criado,
> renomeado, apagado ou reordenado automaticamente.

### Conferência pós-publicação

No editor do Apps Script, execute **`verificarIntegridadeBuildPGO5`**. Ela só lê, e
confere em segundos se todos os arquivos foram publicados e se as regras críticas
continuam de pé. Nenhum teste fora do Apps Script pega um arquivo que ficou para trás
na cópia manual — este pega.

Depois, na interface: o menu aparece → Novo Atendimento lista os canais → a data vem
preenchida com hoje e recusa amanhã → o status abre em Pendente → salvar e ver o
registro no Dashboard.

---

## Análise de SAC

Consolida indicadores a partir de uma planilha externa, aberta **somente para
leitura** — o PGO nunca escreve nela e não usa `IMPORTRANGE`.

O administrador aponta a fonte, mapeia as colunas e agrupa os status em
Em Aberto / Em Análise / Fechado. Pode também escolher **duas colunas** para
detalhar os casos do grupo **Em Análise** (por exemplo Data + Número do Caso):
o card "Em Análise" passa a abrir e recolher uma lista com esses casos, linha a
linha, respeitando o período do filtro. Sem as duas colunas configuradas, o card
continua mostrando o indicador e não abre lista nenhuma.

A classificação do detalhamento é a mesma regra dos indicadores — o grupo técnico,
nunca o texto do status —, então renomear "Em Análise" na origem não quebra a lista.

---

## Regras que sustentam o produto

Estas não são preferências de estilo — são o que mantém o dado íntegro.

| Regra | Por quê |
|---|---|
| Permissão vem do **nível**, nunca do cargo | O nome do cargo é livre e muda |
| Status decide pelo **nome técnico**, não pelo rótulo | O rótulo é renomeável a qualquer momento |
| CPF e Protocolo são **texto**, aceitam `0` e `00123` | São identificadores digitados, não números |
| Data de abertura em **America/Sao_Paulo**, decidida pelo servidor | O Apps Script roda em UTC e viraria o dia às 21 h |
| Data de abertura aceita o passado, **recusa o futuro** | Descreve algo que já aconteceu |
| Editar **nunca** reescreve a data de um registro antigo | Histórico não muda sozinho |
| "Aguardando Retorno" só existe em **Pendente** | Sair do status limpa o campo; voltar reabre vazio |
| Exclusão no catálogo é **física e sem cascata** | Quem referencia passa a exibir "Sem dados" |
| `(não informado)` ≠ `Sem dados` | Campo vazio e referência quebrada são coisas diferentes |
| A **estrutura da planilha nunca muda sozinha** | Estrutura incompatível interrompe a operação; ninguém "conserta" automaticamente |
| Matrícula é **texto** e usa a chave exata `Matrícula` | `000123` é uma matrícula, não o número 123 |
| Um recurso, **uma implementação** | Duas telas para a mesma coisa divergem e confundem quem opera |

---

## Manutenção

- **`CONTINUIDADE-PGO.md`** — guia para quem for dar manutenção: armadilhas já
  encontradas, como rodar os testes e o roteiro de publicação.
- **`verificarIntegridadeBuildPGO5`** — diagnóstico dentro do Apps Script.
- Identificadores técnicos antigos (`PRISMA_RA_*`, `prisma-ra-*`) foram **mantidos de
  propósito**: renomeá-los invalidaria caches e preferências de instalações existentes
  sem nenhum ganho.

---

## Linha do tempo

| Versão | Quando | O que mudou |
|---|---|---|
| **1.0** | jul/2026 | Primeira versão: registro de atendimentos do Reclame Aqui sobre Apps Script + Sheets |
| **2.0** | jul/2026 | Perfis (ADM / Supervisor / Analista), abas por canal e formulário configurável |
| **3.0** | jul/2026 | Identidade Pelitero Labs Prisma; temas, gráficos, tabela dinâmica e edição em modal |
| **4.0–4.2** | jul/2026 | Auditoria de código morto, paginação, filtros recolhíveis e correção de vazamento de memória nos registries |
| **4.3** | jul/2026 | Alerta de CPF duplicado e política de não sobrescrita do Sheets |
| **4.5** | jul/2026 | Autenticação pelo e-mail do Google, com bloqueio de acesso não cadastrado |
| **4.6** | jul/2026 | Hierarquia Produto → Categoria → Subcategoria e seletores em cascata |
| **4.7** | ago/2026 | Módulo de indicadores operacionais a partir de planilha externa |
| **5.0** | ago/2026 | **Reescrita do modelo de dados.** Cinco abas relacionais, formulário dinâmico por canal, cargos e níveis de acesso com escopo, PIN e auditoria, relatórios e produtividade com escopo próprio |
| **5.1** | ago/2026 | Estabilização do acesso: fonte única de permissões por tela, guarda de rota, e falha de acesso que se anuncia em vez de esvaziar o menu |
| **5.2** | ago/2026 | Operação rápida: data e status automáticos, `Ctrl+Enter`, foco no Protocolo, formulário compacto e catálogo em memória |
| **5.3** | ago/2026 | Importar Base Legada, diagnóstico de build, consolidação dos arquivos e remoção do caminho 4.x |
| **5.4** | set/2026 | **Versão atual.** Estrutura da planilha imutável, Matrícula e detalhamento de Em Análise nativos, canais padrão revisados |

> A **versão do produto** (5.4) e a **versão do esquema** das abas são coisas
> diferentes e mudam em ritmos diferentes: o esquema é o contrato das cinco abas
> e das suas colunas, e continua onde estava — a 5.4 não alterou nenhuma coluna.

### O que a 5.4 mudou

**A estrutura da planilha virou território imutável.** Saíram do produto o
inicializador do modelo 4.x (que criava 11 abas antigas e apagava abas ditas
obsoletas — entre elas `Configurações`, que no PGO 5.0 é oficial), as migrações
que moviam atendimentos entre abas, a reconstrução de cabeçalho disparada por uma
gravação comum, o menu "Reinicializar Planilhas" e a criação silenciosa de
planilha quando nenhuma estava apontada. Abrir o sistema agora só **valida**.

Criar estrutura continua possível, mas apenas como ação explícita no editor,
sobre uma planilha vazia — e ela recusa rodar se encontrar dados.

**A Importar Base Legada saiu**, junto com o tombamento e as conversões
retroativas: migração foi cancelada como caminho de produto.

**Matrícula e o detalhamento de "Em Análise" ficaram nativos.** Cada um tinha
duas implementações concorrentes; agora há uma só. A matrícula é gravada pela
chave correta (`Matrícula`, com acento — antes ia para uma chave sem acento e
sumia em silêncio) e o card "Em Análise" abre e recolhe a única lista existente.

---

<sub>Pelitero Labs · PRISMA Gestão Operacional</sub>
