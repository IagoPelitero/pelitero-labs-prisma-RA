# PRISMA Gestão Operacional

**Sistema de gestão de atendimentos multicanal** construído sobre Google Apps Script e
Google Sheets — sem servidores, sem banco de dados externo e sem custo de infraestrutura.

Desenvolvido por **Pelitero Labs**.

> Este documento é a referência completa do produto: destina-se tanto ao administrador
> que vai operá-lo quanto ao desenvolvedor que dará manutenção ou evoluções. Ao final
> de sua leitura, é possível instalar, configurar, personalizar, manter e entender toda
> a arquitetura do PRISMA.
>
> **Nota sobre nomes legados**: identificadores técnicos criados quando o produto se
> chamava "Prisma RA" — chaves de Script Properties (`PRISMA_RA_*`), chaves de cache e
> de `localStorage` (`prisma-ra-*`) — foram **mantidos de propósito**. Renomeá-los
> invalidaria caches e preferências de instalações existentes sem nenhum ganho. A
> mudança de marca é estritamente visual.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Tecnologias utilizadas](#3-tecnologias-utilizadas)
4. [Estrutura do projeto](#4-estrutura-do-projeto)
5. [Autenticação por e-mail](#5-autenticação-por-e-mail)
6. [Permissões](#6-permissões)
7. [Integração com o Google Sheets (banco de dados)](#7-integração-com-o-google-sheets-banco-de-dados)
8. [Configuração inicial e instalação](#8-configuração-inicial-e-instalação)
9. [Gerenciamento de usuários](#9-gerenciamento-de-usuários)
10. [Classificação: Produto → Categoria → Subcategoria](#10-classificação-produto--categoria--subcategoria)
10.1 [Seletores dinâmicos (criar campos sem código)](#101-seletores-dinâmicos-criar-campos-sem-código)
11. [Dashboards](#11-dashboards)
12. [Indicadores](#12-indicadores)
12.1 [Análise de SAC (planilha externa)](#121-análise-de-sac-planilha-externa)
13. [Personalização](#13-personalização)
13.1 [Nomes das telas](#131-nomes-das-telas)
14. [Performance](#14-performance)
15. [Segurança](#15-segurança)
16. [Manutenção](#16-manutenção)
17. [Limitações conhecidas](#17-limitações-conhecidas)
18. [Roadmap futuro](#18-roadmap-futuro)
19. [Histórico de versões](#19-histórico-de-versões)

---

## 1. Visão geral

O **PRISMA Gestão Operacional** é um produto da Pelitero Labs para equipes que tratam
manifestações de clientes recebidas por múltiplos canais — no cenário de referência, uma célula de
**Reclame Aqui**, com os canais *Reclame Aqui* e *SAC Preventivo*. O sistema registra,
distribui e acompanha cada atendimento até a conclusão, com trilha de auditoria completa.

Roda 100% dentro do Google Workspace: o front-end é servido como **Web App** pelo Google
Apps Script e o **Google Sheets** funciona como banco de dados. Não há servidores para
manter, nem custo de hospedagem.

### O que o sistema entrega

- **Registro e acompanhamento** de atendimentos multicanal, com fluxo de status
  (Pendente → Em análise → Concluído) e "Aguardando Retorno de" (Área/Cliente);
- **Classificação em três níveis** — Produto → Categoria → Subcategoria — com cascata
  automática no formulário e administração pela própria interface;
- **Controle de acesso por perfil** (Administrador, Supervisor, Analista), aplicado
  no servidor — não apenas na interface;
- **Formulário de cadastro configurável** sem alteração de código (aba `ConfigCampos`);
- **Catálogo administrável** de produtos, categorias e canais pela própria interface;
- **Histórico auditável** de toda alteração (quem, quando, o quê e por quê);
- **Dashboards e indicadores analíticos** com gráficos que respondem a filtros;
- **Autenticação por e-mail** transparente, sem login nem senha;
- **Quatro temas visuais** (Azul, Rosa, Brasil e Dark), com persistência local.

---

## 2. Arquitetura

O PRISMA segue uma arquitetura em camadas, com separação clara entre back-end
(Apps Script `.gs`) e front-end (`.html` servidos via `HtmlService`).

```
Navegador (SPA)                    Google Apps Script (servidor)         Google Sheets
─────────────────                  ─────────────────────────────         ─────────────
Index.html (shell)                 Code.gs   (doGet, include, menu)      Aba ReclameAqui
 ├─ Styles.html   (CSS/temas)      Config.gs (constantes, colunas)       Aba SACPreventivo
 ├─ Scripts.html  (App/rotas)      Services.gs (regras de negócio) ───▶  Aba Canais
 ├─ Components.html (UI)           Database.gs (CRUD + cache + lock)     Aba ConfigCampos
 └─ Páginas:                       Utils.gs  (helpers puros)             Aba Timeline
     Dashboard / NovoAtendimento                                        Aba Histórico
     Relatorios / Indicadores      google.script.run  ◀──── chamadas     Aba Usuários
     IndicadoresOperacionais       assíncronas do front-end              Aba Produtos
     Configuracoes                                                       Aba Categorias
                                                                         Aba Subcategorias
                                                                         Aba IndicadoresSLA
```

**Princípios de arquitetura:**

- **SPA (Single Page Application)**: a navegação troca apenas o conteúdo de
  `<main id="app">`, sem recarregar a página. Cada página registra-se no objeto global
  `Pages` e é desenhada por `App.navigateTo(nome)`.
- **Camada de dados isolada** (`Database.gs`): todo acesso ao Sheets passa por ela,
  com **cache de leitura** (`CacheService`) e **lock de escrita** (`LockService`).
- **Regras de negócio centralizadas** (`Services.gs`): validação, permissões, timeline,
  dashboard, relatórios e administração. Funções sem `_` no final são públicas
  (chamáveis via `google.script.run`); funções com `_` são internas.
- **Barreira de autenticação** (`requireAuth_`): toda função pública valida o e-mail
  do usuário antes de executar.
- **Configuração dinâmica**: canais, produtos, categorias, responsáveis e campos do
  formulário vêm da planilha e são administráveis pela interface. Apenas o fluxo de
  **status** é fixo (acoplado à semântica de resolução).

---

## 3. Tecnologias utilizadas

| Camada | Tecnologia |
| --- | --- |
| Back-end / runtime | Google Apps Script (V8), servido como Web App |
| Banco de dados | Google Sheets |
| Front-end | HTML + CSS + JavaScript (ES5-compatível, sem framework) |
| Comunicação | `google.script.run` (RPC assíncrono do Apps Script) |
| Gráficos | Chart.js 4.4.1 (via CDN) |
| Exportações | SheetJS (xlsx) e jsPDF + AutoTable (via CDN) |
| Ícones / tipografia | Material Icons (via CDN) |
| Cache | `CacheService` (script cache) |
| Concorrência | `LockService` (script lock) |
| Fuso horário | `America/Sao_Paulo` (definido em `appsscript.json`) |

Escopos OAuth mínimos (`appsscript.json`): `spreadsheets`, `script.container.ui`,
`userinfo.email`.

---

## 4. Estrutura do projeto

Os arquivos ficam organizados em duas pastas principais (`Back/` e `Front/`), além dos
metadados de projeto em `.claude/`.

```
Back/                        Camada de servidor (Apps Script)
 ├─ Code.gs                  Ponto de entrada: doGet, include, menu da planilha, setup
 ├─ Config.gs               Constantes: nomes de abas, colunas, status, dados padrão
 ├─ Database.gs             CRUD genérico, cache de leitura, lock de escrita, migrações
 ├─ Services.gs             Regras de negócio, autenticação, permissões, dashboard
 ├─ Utils.gs                Funções utilitárias puras (IDs, CPF, sanitização, datas)
 │
 │  ── PGO 5.0 (banco relacional; convivem com o 4.x na mesma instalação) ──
 ├─ Pgo5.gs                 Criação e detecção do schema de 5 abas, IDs hexadecimais
 ├─ Pgo5Catalogo.gs         Catálogo dinâmico: canais, campos, produtos, status
 ├─ Pgo5Atendimentos.gs     Atendimentos do 5.0 e os valores dos campos dinâmicos
 ├─ Pgo5Permissoes.gs       Cargos, níveis de acesso e o motor de permissões
 ├─ Pgo5Usuarios.gs         Cadastro de usuários e a hierarquia (SupervisorId)
 ├─ Pgo5Seguranca.gs        PIN administrativo, bloqueios e recursos protegidos
 ├─ Pgo5Auditoria.gs        Registro das ações administrativas
 ├─ Pgo5Analitico.gs        Relatórios, Produtividade Equipe e o "Fora da SLA"
 └─ Pgo5Migracao.gs         Tombamento do banco 4.x para o PGO 5.0

Front/                       Camada de interface (HtmlService)
 ├─ Index.html              Shell: layout (sidebar + header) e include dos demais
 ├─ Styles.html             CSS completo, variáveis de tema e os 4 temas
 ├─ Scripts.html            Objeto App: rotas, sessão, temas, helpers compartilhados
 ├─ Components.html         Peças de UI reutilizáveis (cards, modais, tabelas, toasts)
 ├─ Dashboard.html          Página inicial: KPIs, canais e tabela de atendimentos
 ├─ NovoAtendimento.html    Formulário dinâmico de cadastro/edição + timeline
 ├─ Relatorios.html         Relatórios filtráveis com exportação
 ├─ Indicadores.html        Painel analítico (Chart.js), restrito à supervisão
 ├─ IndicadoresOperacionais.html
 │                          Análise de SAC: analisa uma 2ª planilha Google (supervisão)
 ├─ Configuracoes.html      Administração (produtos, categorias, subcategorias, canais,
 │                          usuários, Campos e Seletores dinâmicos, Análise de SAC
 │                          e Nomes das telas)
 │
 │  ── PGO 5.0 ──
 ├─ AtendimentoPGO5.html    Formulário dinâmico montado a partir do catálogo
 ├─ ConfiguracoesPGO5.html  Administração do catálogo do 5.0
 └─ AcessoPGO5.html         Usuários, Cargos, Níveis e Segurança (PIN e auditoria)

.claude/                     Metadados LOCAIS (não versionados — ver .gitignore)
 ├─ appsscript.json         Manifesto do Apps Script (timezone, escopos, runtime)
 ├─ .clasp.json.example     Modelo para publicação via clasp (CLI)
 └─ .claspignore

README.md                    Este documento
```

> **Publicação via `clasp`**: como o Apps Script mantém os arquivos "planos" (sem
> subpastas), ao subir o projeto com `clasp` os arquivos de `Back/` e `Front/` convivem
> no mesmo projeto. As pastas são uma organização **do repositório**; no editor do Apps
> Script os arquivos aparecem lado a lado.

---

## 5. Autenticação por e-mail

O PRISMA **não usa login nem senha**. A identidade é sempre a da conta Google que
abriu o Web App.

**Fluxo:**

1. O usuário abre o link do sistema (autenticado no Google).
2. O servidor obtém o e-mail com `Session.getActiveUser().getEmail()`.
3. `requireAuth_` (em `Services.gs`) procura esse e-mail na aba **Usuários**.
4. **Se existir e estiver `Ativo`** → o acesso é liberado e **nome, perfil e equipe**
   são carregados automaticamente.
5. **Se não existir (ou estiver inativo)** → o acesso é **bloqueado por completo** e o
   sistema exibe:

   > **Acesso não autorizado**
   > Seu e-mail não está cadastrado para utilizar o PRISMA. Entre em contato com o
   > Administrador para solicitar seu acesso.

Não há acesso parcial, tela de login, token de sessão nem senha armazenada. `requireAuth_`
é a **primeira instrução de toda função pública** do servidor — inclusive as chamadas
diretas via `google.script.run` são barradas para e-mails não cadastrados.

**Pré-requisito de implantação:** o Web App deve ser publicado com **"Executar como:
usuário que acessa"** para que `Session.getActiveUser()` traga o e-mail real de quem usa
o sistema (ver [Configuração inicial](#8-configuração-inicial-e-instalação)).

---

## 6. Permissões

O sistema tem **dois modelos de acesso**, e vale o do banco que a instalação usa.
Em ambos as regras são aplicadas **no servidor** — esconder um item na interface
nunca é a proteção.

### 6.1 Banco 4.x — três perfis fixos

Definidos na coluna `Perfil` da aba Usuários.

| Recurso | Analista | Supervisor | Administrador (ADM) |
| --- | :---: | :---: | :---: |
| Ver/editar os **próprios** atendimentos | ✅ | ✅ | ✅ |
| Ver/editar atendimentos de **toda a equipe** | — | ✅ | ✅ |
| Delegar/reatribuir responsável | — | ✅ | ✅ |
| Aba **Indicadores** | — | ✅ | ✅ |
| Aba **Configurações** (produtos, categorias, **subcategorias**) | — | ✅ | ✅ |
| **Usuários**, **Canais** e **Campos e Seletores** | — | — | ✅ |
| Seção **Banco de Dados** (link da planilha) | — | — | ✅ |

Funções-chave: `isAdminProfile_`, `isSupervisorProfile_`, `canAccessAtendimento_`,
`restrictToOwnerIfNeeded_`, `requireSupervisor_`, `requireAdmin_` (em `Services.gs`).

### 6.2 Banco PGO 5.0 — cargo e nível são coisas diferentes

Aqui **não existe perfil fixo**. Cada usuário tem dois campos independentes:

| Campo | O que significa | Concede acesso? |
| --- | --- | :---: |
| `CargoId` | A função organizacional da pessoa (ADM, Supervisor, Analista…) | **Não** |
| `NivelAcessoId` | O conjunto de permissões que ela tem | **Sim** |

O acesso é resolvido assim:

```
Usuário.NivelAcessoId → aba Configurações (Tipo = NIVEL_ACESSO)
                      → coluna Configuracao (JSON) → lista de permissões
```

Nunca decida acesso pelo nome. `if (cargo === 'ADM')` está errado por dois
motivos: o cargo não concede nada, e o nome do nível é livre — o administrador
pode criar um nível chamado "Coordenação". Use sempre a permissão:

```js
const ator = exigirPermissao_('gerenciarEquipe');   // barra e devolve o ator
if (usuarioTemPermissao_(usuario, 'analiseSac')) { /* ... */ }
```

**Escopos de atendimento.** Três permissões definem até onde a pessoa enxerga:
`verProprios` → só os dela; `verEquipe` → ela e toda a árvore abaixo dela;
`verTodos` → a operação inteira. O mesmo vale para editar, excluir e delegar.

**Equipe ≠ hierarquia.** A coluna `Equipe` é só um rótulo organizacional e
**não concede acesso a nada**. Quem monta a árvore é `SupervisorId`.

**Falha fechada.** Nível inexistente, inativo, JSON inválido ou usuário inativo
resultam em *zero* permissões — nunca em acesso ampliado.

**Sempre resta um administrador.** Não é possível desativar nem rebaixar o
último nível com `alterarPermissoes` ativo.

Funções-chave: `obterPermissoesUsuario_`, `usuarioTemPermissao_`,
`exigirPermissao_`, `obterEscopoAtendimentos_` (em `Pgo5Permissoes.gs`) e
`obterSubordinadosDaHierarquia_`, `validarCicloHierarquia_`
(em `Pgo5Usuarios.gs`). As telas herdadas do 4.x passam por `exigirAcesso_`
(`Services.gs`), que escolhe a regra certa conforme o banco.

### 6.3 PIN administrativo — a segunda camada

Algumas ações não se contentam com a permissão. Para elas vale:

```
PERMISSÃO  +  PIN DESBLOQUEADO  =  AÇÃO
```

São três: ver o link da planilha do sistema, ver o link da planilha da
Análise de SAC e conceder um nível com poderes administrativos.

O PIN **não é senha de login** — quem autentica continua sendo a Conta
Google. Ele tem 6 dígitos e é guardado como `SHA-256(salt + PIN)` em Script
Properties; o valor em si nunca é gravado, nunca vai para a planilha e nunca
chega ao navegador. Não existe PIN padrão: uma instalação nova começa sem
PIN, e as ações protegidas ficam indisponíveis até um administrador definir
o primeiro.

| Situação | O que acontece |
| --- | --- |
| PIN correto | Libera as ações protegidas por 5 minutos |
| 3 erros seguidos | Bloqueia **aquele usuário** por 24 horas |
| Bloqueado | Outro administrador desbloqueia, ou espera o prazo |
| Único administrador bloqueado | Recuperação por e-mail + conta Google autenticada |

**Os links protegidos nunca saem do servidor sem as duas chaves.** Eles não
estão no bootstrap, no HTML, em `data-*` nem em variável de JavaScript: a
tela pede, o servidor confere permissão e PIN, e só então devolve a URL.

**O contador de 5 minutos do navegador é decorativo.** A validade é
conferida no servidor a cada chamada — `localStorage`, `sessionStorage` ou
variável de JavaScript não servem como prova.

Funções-chave: `exigirPermissaoComPin_`, `validarPinPGO5`,
`obterLinkProtegidoPGO5`, `recuperarAcessoUnicoAdministradorPGO5`
(em `Pgo5Seguranca.gs`).

### 6.4 Auditoria administrativa

As ações administrativas ficam registradas na aba `Configurações` com
`Tipo = AUDITORIA` — nenhuma aba nova. São gravadas criação, edição,
ativação, desativação, exclusão, mudança de permissões, concessão de
administrador, alteração do PIN, bloqueio, desbloqueio e recuperação.

**Leitura não gera registro**: abrir o Dashboard ou consultar um relatório
não entra na auditoria, para a planilha não virar um log infinito.

**Nada de dado pessoal**: CPF, cliente, protocolo, PIN, hash, salt e URLs
protegidas são removidos antes da gravação por `limparDadoSensivel_`
(`Pgo5Auditoria.gs`) — uma rede de segurança que age mesmo se quem registra
a ação passar um objeto inteiro por engano.

---

## 6.5 As telas analíticas e seus escopos

Cada tela analítica tem o **próprio** escopo. Enxergar um atendimento na
tela de trabalho e enxergá-lo num relatório são coisas diferentes:

| Tela | Permissões | Alcance |
| --- | --- | --- |
| Relatórios | `relatoriosProprios` / `relatoriosEquipe` / `relatoriosTodos` | próprios · própria árvore · toda a operação |
| Produtividade Equipe | `produtividadeEquipe` / `produtividadeTodos` | própria árvore · toda a operação |
| Análise de SAC | `analiseSac` | a planilha externa configurada |

O recorte acontece **no servidor**: o que o usuário não pode ver não sai de
lá. Isso vale também para a **exportação** (Excel, CSV e PDF), que
reaproveita exatamente a mesma lista da tela — nunca "busca tudo e filtra
depois".

O filtro **Responsável** só oferece pessoas dentro do escopo. Mandar a lista
inteira e escondê-la na interface exporia o organograma da operação.

**Produtividade Equipe** é o nome VISÍVEL da tela cuja rota técnica continua
sendo `indicadores`. Renomear a rota quebraria links salvos e o `data-page`
do menu sem nenhum ganho para quem usa. O ADM pode personalizar o rótulo,
como nas demais telas.

A tela pede **um único** resumo agregado ao servidor (KPIs, agrupamentos e
evolução diária). Antes ela baixava todos os atendimentos e contava no
navegador — lento e desnecessário, já que nenhum gráfico precisa da linha
individual.

### Análise de SAC

Lê uma **segunda planilha**, externa. Os registros brutos NUNCA são
importados nem copiados para o PGO: o servidor lê, agrega e devolve só o
resumo. CPF, cliente, protocolo e a URL da fonte não entram no que chega ao
navegador.

Status que não estiver mapeado vira **"Não Classificado"** — nunca é
contado como "Em Aberto", o que inflaria o indicador de pendência.

O valor manual **"Fora da SLA"** ficava na aba `IndicadoresSLA` do 4.x. No
PGO 5.0 ele é uma linha de `Configurações` com `Tipo = 'SLA'`,
`Chave` = a data e `Valor` = a quantidade. Nenhuma aba nova foi criada.

---

## 6.6 O Dashboard

A tabela do Dashboard reúne as informações em **cinco grupos**, mais a
coluna de ações:

| Grupo | O que mostra |
| --- | --- |
| Atendimento | Protocolo (em destaque), data, há quanto tempo está aberto, canal e o badge de status |
| Cliente | Nome e CPF |
| Classificação | Produto → Categoria → Subcategoria, em cascata |
| Responsável | Quem responde e de quem se aguarda retorno |
| Observações | Resumo em duas linhas; o texto completo abre em modal |
| Ações | Editar, Alterar status e Excluir |

Antes eram dez colunas soltas e a tabela ficava mais larga que a tela.
**Nada disso mudou o banco** — é composição visual sobre os mesmos campos.

Abaixo de 900px cada atendimento vira um **cartão empilhado**: o cabeçalho
some e cada bloco recebe o nome do grupo como rótulo.

O badge de status escolhe a cor do texto pela luminância do fundo, então
qualquer cor que o administrador configurar continua legível.

---

## 6.7 Tombamento: trazer os dados do 4.x

Toda a regra está em `Pgo5Migracao.gs` — nenhum outro arquivo migra dados.

**Como funciona, em cinco passos**

1. **Ler** — abre a *cópia* da planilha antiga e lê as abas necessárias.
2. **Mapear** — cria catálogo e usuários no banco novo, anotando
   "Id antigo → Id novo".
3. **Montar** — reconstrói cada atendimento usando esses mapas.
4. **Validar** — confere contagens, IDs e referências.
5. **Marcar** — só então grava o marcador de conclusão.

**A origem é somente leitura.** Nenhuma função escreve na planilha antiga —
não existe ali `setValue`, `appendRow` nem `deleteRow`. Há teste
automatizado que instrumenta a fonte e falha se qualquer escrita for
tentada.

**Não roda duas vezes.** Uma segunda execução duplicaria todos os
atendimentos, então a primeira conclusão bem-sucedida grava a Script
Property `PGO5_MIGRACAO_CONCLUIDA` e as tentativas seguintes são
recusadas. Se a migração falhar no meio, o marcador **não** é gravado.

**O Id real da planilha antiga nunca entra no código.** Ele vem da Script
Property `PGO5_MIGRACAO_FONTE_ID`, configurada só no ambiente autorizado.

**O que é transformado**

| Origem (4.x) | Destino (PGO 5.0) |
| --- | --- |
| `Perfil` (um campo só) | `CargoId` + `NivelAcessoId` (dois conceitos) |
| `IndicadoresSLA` (aba) | `Configurações` com `Tipo = 'SLA'` |
| `CamposExtras` (JSON) | `ValoresAtendimento`, com snapshot de rótulo e tipo |
| Cliente e CPF | colunas estruturais de `Atendimentos` |

**A hierarquia não é inventada.** O 4.x não tem equivalente ao
`SupervisorId`, e deduzi-la pela Equipe criaria relações que nunca
existiram — o que daria a um gestor acesso a atendimentos que não são dele.
Todos são migrados sem supervisor, e o relatório informa quantos ficaram
assim. O administrador monta a árvore depois, na tela de Usuários.

**Perfil desconhecido cai no nível mais restrito.** Errar para menos acesso
é seguro; errar para mais, não.

**Dado inconsistente não derruba a migração.** Uma categoria sem produto
válido é migrada sem o vínculo e entra em "referências não resolvidas" no
relatório. Descartar perderia dado; inventar o vínculo criaria informação
falsa.

**O relatório não guarda dado pessoal**: só contagens e avisos genéricos.

---

## 7. Integração com o Google Sheets (banco de dados)

Cada aba da planilha é uma "tabela". As colunas e os dados padrão são definidos em
`Config.gs` (`COLUMNS`, `DEFAULT_*`).

### CPF e Protocolo são identificadores, não números

No **PGO 5.0** os dois campos guardam o que o operador digitou:

- aceitam **somente dígitos** — `0`, `00`, `01234567890` são todos válidos;
- **não** passam por cálculo de dígito verificador;
- são gravados como **texto**, e as colunas nascem formatadas como texto na
  planilha (`aplicarFormatoTextoEmIdentificadores_` em `Pgo5.gs`).

O motivo é simples: virar número comeria os zeros à esquerda e `00123` se
tornaria `123`, perdendo o identificador.

⚠️ **`"0"` é um valor válido.** Nunca teste com `if (!valor)`, porque `"0"`
é *falsy* em JavaScript e o teste confundiria "zero" com "vazio". Compare
com `''` explicitamente — é o que `pgo5TextoDeIdentificador_` faz.

No banco **4.x** nada mudou: lá o CPF continua validado por dígito
verificador e gravado com máscara, porque as abas legadas são consumidas por
outras planilhas via `IMPORTRANGE`. Registros históricos não são convertidos:
a regra vale para novos registros e edições futuras.

| Aba | Função |
| --- | --- |
| `ReclameAqui`, `SACPreventivo` | Atendimentos, separados por canal. Consultas consolidam todas as abas de canal. |
| `Canais` | Canais administráveis (ADM). Canais sem aba própria gravam em `ReclameAqui`, preservando o canal real na coluna `Canal`. |
| `ConfigCampos` | Configuração dinâmica do formulário de Novo Atendimento. |
| `Timeline` | Linha do tempo de cada atendimento (criação, mudanças, observações). |
| `Histórico` | Trilha de auditoria campo a campo (quem, quando, valor anterior/novo, justificativa). |
| `Usuários` | Cadastro de acesso: `Nome`, `Email`, `Perfil`, `Equipe`, `Ativo`, datas. |
| `Produtos`, `Categorias` | Catálogo administrável (categorias podem se vincular a um produto). |
| `Subcategorias` *(v4.6)* | Terceiro nível da classificação: `Id`, `CategoriaId`, `Nome`, `Ativo`, `Ordem`. Criada vazia — o cadastro é manual, feito por ADM/Supervisor. |
| `IndicadoresSLA` *(v4.7)* | Valores manuais "Fora da SLA" do módulo Indicadores Operacionais: `Data` (AAAA-MM-DD) e `ForaSLA` (número). Criada vazia. |

**Coluna `Subcategoria` nos atendimentos (v4.6):** foi acrescentada às abas de
atendimento logo após `Categoria`. A migração de esquema (`ensureSheetSchema_`)
remapeia cada valor pelo **nome do cabeçalho** e regrava as linhas na nova ordem, de
modo que nenhum dado existente é perdido ou deslocado; a coluna nova nasce **vazia**
em todos os registros anteriores. A migração roda uma única vez, disparada pelo bump
de `SCHEMA_VERSION` em `Config.gs`.

**Política de não sobrescrita (v4.3):** o sistema **nunca sobrescreve dados existentes**.
Os dados padrão só são gravados em **abas vazias** (primeira criação). O que o usuário
edita manualmente no Sheets é sempre preservado.

**Camada de acesso (`Database.gs`):**

- Leituras passam por `getSheetData` / `getAll`, com **cache** (`CacheService`, TTL de
  5 min). Escritas invalidam o cache da aba afetada.
- Escritas (`insert`, `update`, `remove`, `batchInsert`) usam **lock** (`LockService`,
  30 s) para concorrência segura. A verificação de protocolo único roda dentro do lock.
- A estrutura é criada/migrada sob demanda por `ensureDatabaseReady` /
  `initializeSheets` (executadas na primeira abertura).

### 7.1 Estratégia de carregamento de dados (confiabilidade)

O Google Sheets é a **fonte oficial** dos dados. O cache existe apenas para
performance e **nunca** é fonte única. O fluxo de qualquer leitura é:

```
Solicitação
   ↓
Cache existe E é válido? ──Sim──► usa o cache (rápido)
   │Não
   ▼
Lê o Google Sheets (fonte oficial)
   │  falhou? → 1 retentativa (pausa de 500 ms)
   ▼
Valida → devolve os dados → reabastece o cache
   │  falhou de novo?
   ▼
Lança erro "DADOS: ..." (nunca uma lista vazia silenciosa)
```

**Validação do cache (`isCacheValido_`):** antes de ser usado, o conteúdo do cache é
verificado — precisa ser uma matriz com linha de cabeçalho e conter **todas** as
colunas do esquema atual. Cache corrompido, com estrutura inesperada ou gravado por
um esquema anterior é descartado e a leitura vai ao Sheets.

**Chave de cache versionada:** a chave inclui `CONFIG.SCHEMA_VERSION`
(`PRISMA_RA_<versão>_<Aba>`). Caches de versões diferentes do esquema nunca se
cruzam. `invalidateCache` remove também a chave legada (sem versão), usada por
versões anteriores do código.

**Mapeamento por cabeçalho, não por posição:** `getAll` localiza cada campo pelo
**nome** na linha de cabeçalho real da aba. Assim, acrescentar, remover ou reordenar
colunas no Sheets não desloca os valores dos registros; uma coluna configurada e
ausente na aba vira string vazia (retrocompatibilidade) e colunas extras são
ignoradas. Se o cabeçalho estiver ilegível, há fallback para o mapeamento posicional
legado, para nunca perder dados de bases antigas.

**Alinhamento antes de gravar (`ensureAlignedHeaders_`):** `insert` e `update`
escrevem a linha inteira na ordem das colunas configuradas. Se alguém alterou a
estrutura da aba manualmente, o cabeçalho é realinhado por `ensureSheetSchema_`
(que preserva os dados remapeando pelo nome) antes da gravação.

### 7.2 Invalidação do cache

O cache da aba afetada é invalidado automaticamente em **toda escrita** —
`insert`, `update`, `remove` e `batchInsert` em `Database.gs`. Como todas as
operações de negócio passam por essas funções, ficam cobertas: novo atendimento,
edição, exclusão, alteração de status, de responsável, de produto, de categoria, de
subcategoria e de canal, além das configurações administráveis. Por isso Dashboard e
Indicadores refletem as alterações imediatamente, sem recarregar o navegador.
`invalidateAllCache` limpa tudo (usado pelo menu da planilha, pelas migrações e pelo
fallback com `forceRefresh`).

### 7.3 Fallback automático e tratamento de erros

Erro de leitura e "não há registros" são situações **diferentes** e tratadas como tais:

| Situação | Comportamento |
| --- | --- |
| Não existem registros | Mensagem neutra "Nenhum atendimento encontrado." |
| Falha ao carregar | Fallback automático → se persistir, estado de **erro** com ícone `cloud_off`, aviso de que os dados seguem seguros no Sheets e botão "Tentar novamente" |

No frontend, `Pages.dashboard.carregarDados` e `Pages.indicadores.atualizar`:

1. Tratam resposta ausente ou fora do formato esperado como **falha** (não como
   base vazia);
2. Na primeira falha, repetem a chamada **uma única vez** com
   `{ forceRefresh: true }` — o servidor descarta o cache e lê o Sheets diretamente
   (`getDashboardData` / `getRelatorio` aceitam esse parâmetro). Não há loop de
   tentativas;
3. Registram o contexto técnico no console (`[Dashboard]` / `[Indicadores]`, número
   da tentativa e mensagem do servidor);
4. **Preservam a interface**: dados já exibidos não são apagados por uma falha
   posterior. O estado de erro só aparece quando não há nada para preservar.

**Indisponibilidade temporária do Google:** durante uma instabilidade do Sheets, a
retentativa do servidor e o fallback do frontend costumam resolver de forma
transparente. Se não resolverem, o usuário vê o estado de erro (nunca uma tela vazia
enganosa) e pode tentar novamente sem recarregar a página — nenhum dado é perdido,
pois todas as gravações já estão na planilha.

### 7.4 Fonte única de atendimentos

`getActiveAtendimentos_` (`Services.gs`) é a **única** função que lê atendimentos:
consolida as abas de canal, descarta os excluídos e alimenta Dashboard, Indicadores,
Relatórios, pesquisas e validações. `decorateAtendimentos_` normaliza o formato
entregue ao frontend e `applyAtendimentoFilters_` centraliza os filtros do servidor.
Nenhuma tela tem lógica própria de leitura — o que garante que Dashboard e
Indicadores mostrem sempre a mesma base para o mesmo perfil e filtros.

---

## 8. Configuração inicial e instalação

### Opção A — vincular a uma planilha existente

1. Crie (ou escolha) uma planilha do Google Sheets que será o banco de dados.
2. No editor do Apps Script, execute a função `configurarPlanilha('<ID_DA_PLANILHA>')`
   uma única vez (o ID está na URL do Sheets). Isso cria todas as abas e cabeçalhos.

### Opção B — projeto vinculado (container-bound)

1. Em uma planilha nova, abra **Extensões → Apps Script**.
2. Suba os arquivos de `Back/` e `Front/` (manualmente ou via `clasp push`).
3. Execute a função `setup()` uma vez para criar as abas e dados padrão.

### Publicar como Web App

1. No editor do Apps Script: **Implantar → Nova implantação → Aplicativo da Web**.
2. **Executar como:** *Usuário que acessa o app* (essencial para a autenticação por
   e-mail funcionar).
3. **Quem pode acessar:** conforme a política da empresa (ex.: usuários do domínio).
4. Copie a URL do Web App e distribua **apenas às pessoas cadastradas** na aba Usuários.

### Primeiro administrador

Na primeira execução, `bootstrapSupervisor_` cadastra automaticamente o e-mail de quem
rodou o setup como **ADM**, viabilizando a configuração inicial. A partir daí, o ADM
cadastra os demais usuários pela tela de Configurações.

---

## 9. Gerenciamento de usuários

Exclusivo do **ADM**, em **Configurações → Usuários e responsáveis**.

- **Cadastrar**: informe Nome, E-mail (a credencial de acesso), Perfil
  (Analista/Supervisor/ADM), Equipe e marque **Ativo**.
- **Editar/Desativar**: desativar remove o acesso imediatamente (o e-mail deixa de
  autenticar), preservando o histórico dos atendimentos vinculados.
- **Proteção**: o sistema impede remover/rebaixar o **último ADM ativo**
  (`assertAnotherAdmin_`), evitando que a operação fique sem administrador.

O e-mail cadastrado deve ser **exatamente** o da conta Google que a pessoa usará para
abrir o sistema.

---

## 10. Classificação: Produto → Categoria → Subcategoria

A classificação dos atendimentos tem **três níveis encadeados**:

```
Produto            (ex.: Cartão de Crédito)
   └─ Categoria    (ex.: Fatura)
        └─ Subcategoria  (ex.: Parcelamento, Segunda Via)
```

Tudo é administrado em **Configurações**. Produtos, Categorias e Subcategorias são
acessíveis a Supervisor/ADM; **Canais** e **Campos e Seletores** são exclusivos do ADM.

- **Produtos**: catálogo de produtos. Desativar preserva o histórico (desativação lógica).
- **Categorias**: motivos do atendimento, opcionalmente vinculados a um produto.
  Exclusão **definitiva** (remove a linha do Sheets, com confirmação).
- **Subcategorias** *(v4.6)*: terceiro nível, sempre vinculado a **uma categoria**
  (que por sua vez aponta o produto). Permite criar, editar, ativar/desativar e
  excluir. O nome deve ser único **dentro da mesma categoria** — categorias de
  produtos diferentes podem ter subcategorias homônimas sem conflito.
- **Canais**: canais de entrada. Exclusão **definitiva**, com guarda para o sistema
  **nunca ficar sem canal ativo** (`assertOutroCanalAtivo_`). Canais sem aba própria
  gravam os atendimentos na aba `ReclameAqui`, preservando o canal real.

### Como a cascata funciona no Novo Atendimento

Ao escolher o **Produto**, o campo Categoria passa a listar apenas as categorias
daquele produto. Ao escolher a **Categoria**, o campo Subcategoria lista apenas as
subcategorias dela. Trocar o produto redefine os dois níveis abaixo.

O agrupamento usado pela cascata (`subcategoriasPorProdutoCategoria`, montado em
`getBootstrapData`) é indexado por **produto + categoria**, justamente porque
categorias de produtos diferentes podem ter o mesmo nome (ex.: "Cobrança indevida"
existe em Cartão de Crédito e em Conta Digital) — cada uma mantém suas próprias
subcategorias.

### Comportamento com registros antigos (retrocompatibilidade)

- A **Subcategoria é sempre opcional**. Se a categoria escolhida ainda não tiver
  subcategorias cadastradas, o campo aparece vazio e o atendimento é salvo
  normalmente, sem erro.
- Todos os atendimentos **anteriores à v4.6 permanecem com a Subcategoria vazia**.
  Nada é preenchido, migrado ou inferido automaticamente.
- Dashboard, Indicadores, Relatórios, filtros e exportações continuam operando
  normalmente com o campo vazio. Um atendimento sem subcategoria só é excluído de
  um resultado quando o **filtro de Subcategoria** é utilizado explicitamente.

### 10.1 Seletores dinâmicos (criar campos sem código)

A seção **Configurações → Campos e Seletores** (ADM) é a central de campos do
formulário. Além de exibir/ocultar, tornar obrigatório/opcional e reordenar os campos
existentes, o administrador pode **criar novos campos do tipo seleção sem alterar o
código-fonte**:

1. Clique em **+ Novo registro** na seção *Campos e Seletores*.
2. Informe o **Rótulo** (ex.: "Prioridade").
3. Escolha o **Tipo** = `select`.
4. Preencha **Opções do seletor** separadas por ponto e vírgula — ex.:
   `Alta; Média; Baixa`.
5. Defina Exibir, Obrigatório e Ordem, e salve.

O campo passa a aparecer no formulário de Novo Atendimento (e como coluna na tabela
do Dashboard) imediatamente, sem republicar o projeto. Os valores são gravados na
coluna `CamposExtras` (JSON) do atendimento, preservando o esquema da planilha.

> **Seletores relacionais** — Produto, Categoria, Subcategoria e Canal — têm fonte de
> dados própria e são administrados em suas seções específicas, não pela lista de
> opções. **Status** e **"Aguardando Retorno de"** permanecem fixos: a lógica de
> resolução do atendimento (data de conclusão, tempo de resolução) depende da
> semântica desses valores.

Toda alteração — em produtos, categorias, subcategorias, canais ou qualquer seletor —
recarrega automaticamente as listas do formulário, do Dashboard, dos Indicadores, dos
Relatórios e de todos os filtros (via `App.reloadBootstrap`), sem recarregar a
aplicação nem alterar código.

---

## 11. Dashboards

A página inicial (`Dashboard.html`) apresenta:

- **KPIs clicáveis**: Total, Pendentes, Em análise, Concluídos e "Aguardando Retorno"
  por situação (Área/Cliente). Clicar em um card filtra a tabela.
- **Visão por canal**: totais e distribuição de status por canal.
- **Tabela dinâmica paginada** de atendimentos, com filtros recolhíveis, chips de
  filtros ativos e ações por linha (editar, mudar status, excluir) conforme a permissão.

Analistas veem apenas os próprios atendimentos; Supervisores e ADM veem todos.

---

## 12. Indicadores

Painel analítico (`Indicadores.html`), **restrito à supervisão** (Supervisor/ADM), com
gráficos Chart.js que respondem a todos os filtros e recalculam automaticamente a cada
alteração.

**Padrão de exibição — Quantidade + Percentual diretamente no gráfico** (nunca só na
legenda ou no tooltip). O percentual é sempre calculado sobre o **total de atendimentos
filtrados**: `(quantidade ÷ total filtrado) × 100`.

| Gráfico | Tipo | Exibição |
| --- | --- | --- |
| Atendimentos por dia | Linha | Série temporal |
| Atendimentos por Produto | Barras | Qtd + % acima de cada barra |
| **Atendimentos por Categoria (Top 5)** | Barras | **Somente as 5 categorias com mais atendimentos**; Qtd + % acima de cada barra |
| Atendimentos por Canal | Pizza | Qtd + % sobre cada fatia |
| Atendimentos por Responsável | Barras horizontais | Top 10 + "Outros"; Qtd + % ao lado de cada barra |
| Atendimentos por Status | Pizza | Qtd + % sobre cada fatia |
| Aguardando Retorno (Área × Cliente) | Rosca | Qtd + % sobre cada fatia |
| Evolução diária acumulada | Linha | Abertos × Concluídos |

O **Top 5** de Categoria exibe apenas as cinco maiores categorias (o gráfico ficava
ilegível com muitas categorias), mas o **percentual continua relativo ao total filtrado**
— não à soma do Top 5. Os rótulos numéricos acompanham o tema (inclusive Dark) e são
redesenhados ao trocar de tema sem sair da tela.

### 12.1 Análise de SAC (planilha externa)

Módulo **independente** que analisa uma planilha Google Sheets **externa** ao PRISMA (por
exemplo, um relatório operacional mantido por outra equipe). Restrito à supervisão
(Supervisor/ADM). O **nome da seção é configurável** pelo Administrador — "Análise de SAC"
é apenas o padrão.

**Configuração da fonte** — em *Configurações → Análise de SAC* (ADM), em três passos:

**1. Fonte de dados**

| Campo | Descrição |
| --- | --- |
| Nome da seção (menu) | Rótulo do item no menu lateral e título da tela. |
| Link da planilha de origem | URL do Google Sheets externo (você precisa ter acesso a ele). |
| Nome da aba de origem | Aba, dentro da planilha externa, onde estão os dados. |
| Linha do cabeçalho | Linha onde estão os títulos das colunas (a tabela pode começar em qualquer linha). |

**2. Mapeamento das colunas** — o botão **"Ler cabeçalhos da planilha"** lê a origem e
transforma o mapeamento em listas de seleção, evitando digitar nomes exatos:

| Coluna | Obrigatória | Uso |
| --- | --- | --- |
| Data | sim | Eixo temporal de toda a análise. |
| Status | sim | Base da classificação e da distribuição. |
| Assunto | não | Gráfico "Top 5 Assuntos". |
| Subassunto | não | Gráfico "Top 5 Subassuntos". |
| Quem analisou | não | Gráfico "Casos por Quem analisou". |
| Outras colunas | não | Ficam disponíveis no seletor **"Analisar por"**. |

Se uma coluna mapeada **deixar de existir** na origem, a análise continua com as demais e
a tela exibe um aviso nomeando a coluna que sumiu.

**3. Agrupamento de Status** — o sistema lista os valores distintos encontrados e o ADM
atribui cada um a **Em Aberto**, **Em Análise** ou **Fechado** (*Fechado* e *Rejeitado*
podem ficar no mesmo grupo). Regras:

- um status **não mapeado nunca é contado como "Em Aberto"** — ele entra em
  **Não Classificado**, e o painel mostra quais valores estão pendentes de mapeamento;
- o mesmo status em dois grupos é **recusado** na gravação (contagem ambígua);
- enquanto o ADM não agrupar nada, vale uma heurística por palavra-chave — assim quem já
  usava o módulo não vê os números mudarem depois da atualização.

**Estrutura esperada da planilha de origem** — o sistema é resiliente e **não depende de
posições fixas**:

- as colunas são localizadas pelo **nome do cabeçalho** — se a ordem mudar ou surgirem
  colunas novas, a leitura continua funcionando;
- a tabela pode **começar em qualquer linha** (informe a linha do cabeçalho);
- colunas extras são simplesmente ignoradas.

**Tratamento automático dos dados** (feito no servidor):

- **datas com horário** são reduzidas à data — `02/08/2026 14:35` → `02/08/2026`;
- **linhas totalmente vazias** são ignoradas;
- **células mescladas** na coluna de data são tratadas por *forward-fill* (a última data
  válida é "arrastada" para baixo enquanto não muda);
- **espaços extras** são removidos; linhas sem data ou sem status são descartadas.

**Indicadores principais** — cartões do período filtrado: Total de casos, Em Aberto,
Em Análise, Fechado + Rejeitado, Fora da SLA e Não Classificado.

**Gráficos** — Volume por dia, Distribuição por Status, Top 5 Assuntos, Top 5
Subassuntos e Casos por Quem analisou. Os rankings exibem **quantidade e percentual sobre
o total filtrado** (não sobre a soma do Top 5). O seletor **"Analisar por"** aplica o
mesmo gráfico a qualquer coluna categórica liberada pelo ADM, sem código específico por
coluna.

**Filtro de período** — define a base de todos os percentuais e do total de "Fora da SLA".

**Campo manual "Fora da SLA"** — linha editável na matriz por data, **salva
automaticamente** na aba `IndicadoresSLA` do banco do PRISMA (chave `AAAA-MM-DD`). Por
ser persistido no banco do sistema — e não na planilha externa — o valor **sobrevive a
qualquer releitura** da origem.

**Detalhamento por data** — tabela matriz (indicadores nas linhas, datas nas colunas) com
**scroll horizontal**, **primeira coluna fixa** e **cabeçalho fixo** ao rolar.

**Exportar Excel** — exporta a matriz exibida **e** os rankings do período (com
quantidade e percentual). Usa SheetJS (`.xlsx`); sem a biblioteca, cai para CSV com
BOM/`;`, compatível com **Microsoft Excel** e **LibreOffice**.

**Atualizar Dados** — relê a planilha externa ignorando o cache, sem recarregar a
aplicação.

**Performance e privacidade** — a planilha externa é lida em **uma única chamada**
`getValues()` por consolidação; toda a agregação acontece no servidor e o navegador
recebe **somente agregações**, nunca as linhas cruas. Colunas não mapeadas jamais
trafegam. O consolidado é **cacheado** por configuração + período (`CacheService`, TTL de
5 min), então o tamanho do que trafega acompanha o número de datas e categorias — não o
volume de linhas da origem.

> A planilha externa é aberta **com a credencial de quem acessa** o sistema. Quem não
> tiver permissão nela verá um erro de leitura explícito, não uma tela vazia.

---

## 13. Personalização

- **Campos do formulário e seletores dinâmicos** (ADM): a aba `ConfigCampos` define
  quais campos aparecem no Novo Atendimento, rótulo, tipo, obrigatoriedade, ordem e —
  desde a v4.6 — as **opções dos campos de seleção** (coluna `Opcoes`, separadas por
  `;`). Tudo sem alterar código. Campos personalizados são gravados em JSON na coluna
  `CamposExtras` do atendimento. Ver [seção 10.1](#101-seletores-dinâmicos-criar-campos-sem-código).
- **Catálogo**: produtos, categorias, subcategorias e canais administráveis (ver seção 10).
- **Temas**: quatro temas (Azul padrão, Rosa, Brasil, Dark), selecionáveis no cabeçalho
  e persistidos em `localStorage`. Todo o CSS usa **variáveis de tema** (`--bg`,
  `--card-bg`, `--text-primary`, `--surface-muted`, etc.), o que mantém contraste
  consistente em todas as telas.
- **Identidade**: cores centralizadas em `Styles.html` (bloco `:root`); nome do produto em
  `CONFIG.APP` (`Config.gs`), usado nos títulos, no menu da planilha e no rodapé dos PDFs.

### 13.1 Nomes das telas

O Administrador pode trocar o **nome visível** das telas em *Configurações → Nomes das
telas* — por exemplo, `Dashboard` → `Resultado do Analista`. São renomeáveis: Dashboard,
Novo Atendimento, Relatórios, Indicadores e Análise de SAC.

O nome configurado aparece no **menu lateral**, no **tooltip** e no **título da tela**.
Campo em branco volta ao padrão (há também "Restaurar padrões").

**É estritamente cosmético.** O identificador técnico da página não muda: `data-page`
continua `dashboard`, e rotas, funções, abas, colunas e integrações seguem intactas. Os
nomes são gravados em **Script Properties** (`PRISMA_RA_NOMES_TELAS`) — nenhuma aba ou
coluna nova é criada no Sheets. Enquanto ninguém personalizar nada, a chave sequer é
gravada.

Só o ADM edita; Supervisor e Analista **recebem** os nomes configurados, respeitando as
permissões normais de cada tela. O nome da Análise de SAC tem **fonte única**: editá-lo
aqui ou em *Configurações → Análise de SAC* produz o mesmo resultado.

---

## 14. Performance

O sistema é otimizado para abrir rápido, cadastrar rápido e atualizar quase em tempo
real, minimizando leituras no Google Sheets:

- **Cache de leitura** (`CacheService`, TTL 5 min): cada aba é lida uma vez e reutilizada;
  escritas invalidam apenas o cache da aba afetada.
- **Memo por execução**: dentro de uma mesma requisição, releituras da mesma aba são
  servidas da memória — sem ida ao `CacheService` e sem `JSON.parse` repetido. Seu tempo
  de vida é **menor** que o do cache de 5 min e é limpo pelas mesmas funções que toda
  gravação já chama, então nenhuma leitura correta deixa de ser correta.
- **Bootstrap único**: na abertura, `getBootstrapData` traz usuário + todas as listas de
  apoio em **uma** chamada; as páginas reutilizam esses dados (`App.dropdownData`) em vez
  de consultar o servidor repetidamente.
- **Atualização parcial da interface** (SPA): navegar entre telas troca apenas o conteúdo
  central, sem recarregar a aplicação.
- **Processamento em lote**: alterações que geram várias linhas de histórico usam
  `batchInsert` (uma escrita em vez de N).
- **Escrita direcionada**: `update` mescla apenas os campos alterados; a listagem é
  paginada no cliente (`PAGE_SIZE`).
- **Reuso de consulta**: Indicadores e Relatórios compartilham `getRelatorio` (DRY).
- **Custo zero da cascata** (v4.6): o mapa de subcategorias por produto/categoria é
  calculado **uma única vez** no bootstrap e resolvido no navegador a cada troca de
  produto/categoria — nenhuma leitura extra da planilha e nenhuma chamada ao servidor
  ao usar a cascata. A aba `Subcategorias` participa do mesmo cache de leitura das
  demais (`CacheService`, TTL 5 min), invalidado a cada gravação.

**Diretriz**: nenhuma funcionalidade nova pode degradar o desempenho. Para bases grandes,
ver [Limitações conhecidas](#17-limitações-conhecidas).

---

## 15. Segurança

- **Autenticação por conta Google** (sem senha própria armazenada); acesso liberado
  apenas para e-mails cadastrados e ativos.
- **Autorização no servidor**: `requireAuth_` em toda função pública; permissões por
  perfil aplicadas no back-end (`requireAdmin_`, `requireSupervisor_`,
  `canAccessAtendimento_`), não apenas escondendo itens da interface.
- **Sanitização de entrada** (`sanitizeInput`) e **escape de HTML** na renderização
  (timeline, tabelas) — proteção contra injeção/XSS.
- **Concorrência segura**: `LockService` serializa escritas; unicidade de protocolo
  verificada dentro do lock.
- **Auditoria**: toda alteração relevante é registrada na Timeline e no Histórico.
- **Escopos OAuth mínimos** no manifesto.

---

## 16. Manutenção

- **Menu na planilha** (`onOpen`): "🚀 Abrir Sistema", "🔄 Reinicializar Planilhas"
  (cria abas faltantes sem apagar dados) e "🗑️ Limpar Cache".
- **Diagnóstico**: `testSystem()` (no editor) verifica acesso à planilha, presença das
  abas e leitura de dados.
- **Reinicialização segura**: `initializeSheets` cria apenas o que falta e respeita a
  política de não sobrescrita.
- **Migrações**: `ensureDatabaseReady` executa migrações estruturais quando a versão do
  esquema muda; alterações de esquema ficam versionadas em `Config.gs`.
- **Backups recomendados**: mantenha cópias periódicas da planilha (ver Roadmap —
  backup automático).

---

## 17. Limitações conhecidas

- **Escala do Google Sheets/Apps Script**: o modelo é ideal para operações de pequeno e
  médio porte. Com **milhares** de atendimentos, o `CacheService` (limite de 100 KB por
  chave) deixa de comportar a aba inteira e as leituras passam a ir direto à planilha,
  aumentando o tempo de resposta. Cotas do Apps Script (6 min por execução; execuções
  simultâneas limitadas) também se aplicam.
- **Dependências via CDN** (Chart.js, jsPDF, SheetJS, Material Icons): exigem que o
  ambiente do usuário tenha acesso a essas URLs.
- **Sem backup automático nativo** (planejado no roadmap).
- **Payload do Dashboard**: hoje envia os atendimentos filtrados ao cliente; para bases
  muito grandes, recomenda-se a paginação/agregação no servidor (roadmap).

---

## 18. Roadmap futuro

- **Agregação/paginação do Dashboard no servidor** para bases grandes (reduz payload).
- **Backup automático diário** da planilha (cópia com retenção via `DriveApp` + gatilho).
- **Notificações por e-mail** (`MailApp`) para atendimentos pendentes há mais de N dias.
- **Arquivamento** de atendimentos concluídos antigos (mantém as abas operacionais
  enxutas).
- **Exportação de relatórios em PDF** com layout gerencial.
- **Telemetria de desempenho** (tempo real de `getDashboardData`) para monitorar a
  degradação com dados reais.
- **Compressão de cache** (`Utilities.gzip`) para ampliar o volume cacheável.

---

## 19. Histórico de versões

- **PRISMA Gestão Operacional** — **Rebranding visual**: o produto passa a se apresentar
  como *PRISMA Gestão Operacional / Pelitero Labs* (títulos, menu, cabeçalho, badge `PGO`
  e rodapé dos PDFs), com o nome centralizado em `CONFIG.APP`. Identificadores técnicos
  legados (`PRISMA_RA_*`, `prisma-ra-*`) preservados de propósito.
  **Análise de SAC**: evolução do módulo de indicadores operacionais em um analisador da
  segunda planilha — mapeamento assistido de colunas (Assunto, Subassunto, Quem analisou
  e outras), agrupamento configurável de status com contagem de **Não Classificado**
  (status desconhecido nunca vira "Em Aberto"), filtro de período, gráficos de volume,
  distribuição e Top 5 com quantidade e percentual, seletor genérico **"Analisar por"**,
  aviso de coluna configurada ausente e exportação com os rankings. O navegador passa a
  receber **somente agregações**.
  **Nomes das telas** configuráveis pelo ADM (ver [13.1](#131-nomes-das-telas)).
  **Performance**: memo de leitura por execução.
  **Acessibilidade**: contraste do título do cabeçalho e dos badges corrigido nos quatro
  temas. Nenhuma aba, coluna ou versão de esquema foi alterada.
- **v4.7** — **Módulo Indicadores Operacionais**: nova tela (nome configurável pelo ADM)
  que consolida indicadores de uma planilha Google Sheets externa — colunas localizadas
  pelo nome do cabeçalho, tratamento de datas com horário, células mescladas e linhas
  vazias, consolidação por data (Casos, Em Aberto, Em Análise, Fechado+Rejeitado), campo
  manual "Fora da SLA" persistido (aba `IndicadoresSLA`), tabela com coluna/cabeçalho
  fixos e scroll horizontal, exportação Excel e botão "Atualizar Dados" com cache.
  **Popup de CPF** enriquecido com Status, Categoria e Subcategoria do primeiro registro.
  **Carregamento mais robusto**: `getSpreadsheet` memoizada por execução (de ~10 aberturas
  para 1, reduzindo latência e falhas transitórias) e retentativa silenciosa no Dashboard
  e Indicadores — a mensagem de contingência deixou de aparecer no fluxo normal.
- **v4.6.1** — **Correção crítica de carregamento de dados**: eliminada a falha
  intermitente em que Dashboard e Indicadores apareciam sem registros mesmo com
  dados válidos na planilha. Causa raiz: cache de esquema anterior (sem a coluna
  `Subcategoria`) sendo consumido pelo código novo dentro da janela de TTL,
  deslocando todos os campos a partir de `Categoria` — para o perfil Analista, o
  filtro por responsável deixava de casar e a tela ficava vazia. Correções: chave
  de cache versionada por `SCHEMA_VERSION`, validação de estrutura/esquema do cache
  antes do uso, mapeamento de campos pelo **nome do cabeçalho** (não por posição),
  retentativa na leitura do Sheets, erro explícito em vez de lista vazia silenciosa,
  fallback automático `forceRefresh` no frontend e estados de erro distintos de
  "sem registros" no Dashboard e nos Indicadores. Ver seções 7.1 a 7.4.
- **v4.6** — **Subcategorias**: nova aba `Subcategorias` e coluna `Subcategoria` nos
  atendimentos, fechando a hierarquia Produto → Categoria → Subcategoria com cascata
  no formulário; gerenciamento completo em Configurações (criar, editar, ativar,
  desativar, excluir); Subcategoria disponível em filtros, tabelas e exportações do
  Dashboard e dos Relatórios. **Seletores Dinâmicos**: a seção "Campos e Seletores"
  passa a permitir criar campos do tipo `select` com opções próprias, sem alterar
  código. Migração 100% retrocompatível — nenhum registro existente foi alterado e a
  nova coluna nasce vazia.
- **Produção / Auditoria geral** — Autenticação exclusiva por e-mail consolidada
  (sem login/senha, bloqueio total para não cadastrados); Indicadores → **Categoria em
  Top 5** com quantidade e percentual (sobre o total filtrado) diretamente no gráfico;
  padronização de quantidade+percentual em todos os gráficos categóricos; auditoria do
  tema Dark; limpeza de código legado; README profissional.
- **v4.5** — Autenticação simplificada: somente e-mail, sem login nem senha; bloqueio
  amigável para e-mails não cadastrados.
- **v4.3** — Política de não sobrescrita do Sheets; alerta de CPF duplicado; gráfico de
  Categoria com quantidade/percentual no próprio gráfico; correções (data local,
  escape de HTML na timeline, aliases de CSS, overlays do tema Dark).
- **v4.2** — Canais administráveis; descontinuação do canal Chat Privado; exclusão
  definitiva de categorias e canais; correção da zebra da tabela no tema Dark.

---

<div align="center">

**PRISMA Gestão Operacional** — Pelitero Labs
Gestão de atendimentos multicanal em Google Workspace.

</div>
