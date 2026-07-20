# Pelitero Labs Prisma RA

**Sistema de gestão de atendimentos multicanal** construído sobre Google Apps Script e
Google Sheets — sem servidores, sem banco de dados externo e sem custo de infraestrutura.

Desenvolvido por **Pelitero Labs**.

> Este documento é a referência completa do produto: destina-se tanto ao administrador
> que vai operá-lo quanto ao desenvolvedor que dará manutenção ou evoluções. Ao final
> de sua leitura, é possível instalar, configurar, personalizar, manter e entender toda
> a arquitetura do Prisma RA.

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
10. [Gerenciamento de produtos, categorias e canais](#10-gerenciamento-de-produtos-categorias-e-canais)
11. [Dashboards](#11-dashboards)
12. [Indicadores](#12-indicadores)
13. [Personalização](#13-personalização)
14. [Performance](#14-performance)
15. [Segurança](#15-segurança)
16. [Manutenção](#16-manutenção)
17. [Limitações conhecidas](#17-limitações-conhecidas)
18. [Roadmap futuro](#18-roadmap-futuro)
19. [Histórico de versões](#19-histórico-de-versões)

---

## 1. Visão geral

O **Prisma RA** é um produto da Pelitero Labs para equipes que tratam manifestações de
clientes recebidas por múltiplos canais — no cenário de referência, uma célula de
**Reclame Aqui**, com os canais *Reclame Aqui* e *SAC Preventivo*. O sistema registra,
distribui e acompanha cada atendimento até a conclusão, com trilha de auditoria completa.

Roda 100% dentro do Google Workspace: o front-end é servido como **Web App** pelo Google
Apps Script e o **Google Sheets** funciona como banco de dados. Não há servidores para
manter, nem custo de hospedagem.

### O que o sistema entrega

- **Registro e acompanhamento** de atendimentos multicanal, com fluxo de status
  (Pendente → Em análise → Concluído) e "Aguardando Retorno de" (Área/Cliente);
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

O Prisma RA segue uma arquitetura em camadas, com separação clara entre back-end
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
     Configuracoes                 assíncronas do front-end              Aba Produtos
                                                                         Aba Categorias
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
 └─ Utils.gs                Funções utilitárias puras (IDs, CPF, sanitização, datas)

Front/                       Camada de interface (HtmlService)
 ├─ Index.html              Shell: layout (sidebar + header) e include dos demais
 ├─ Styles.html             CSS completo, variáveis de tema e os 4 temas
 ├─ Scripts.html            Objeto App: rotas, sessão, temas, helpers compartilhados
 ├─ Components.html         Peças de UI reutilizáveis (cards, modais, tabelas, toasts)
 ├─ Dashboard.html          Página inicial: KPIs, canais e tabela de atendimentos
 ├─ NovoAtendimento.html    Formulário dinâmico de cadastro/edição + timeline
 ├─ Relatorios.html         Relatórios filtráveis com exportação
 ├─ Indicadores.html        Painel analítico (Chart.js), restrito à supervisão
 └─ Configuracoes.html      Administração (produtos, categorias, canais, usuários, campos)

.claude/                     Metadados de projeto
 ├─ appsscript.json         Manifesto do Apps Script (timezone, escopos, runtime)
 ├─ .clasp.json.example     Modelo para publicação via clasp (CLI)
 └─ .claspignore / .gitignore

README.md                    Este documento
```

> **Publicação via `clasp`**: como o Apps Script mantém os arquivos "planos" (sem
> subpastas), ao subir o projeto com `clasp` os arquivos de `Back/` e `Front/` convivem
> no mesmo projeto. As pastas são uma organização **do repositório**; no editor do Apps
> Script os arquivos aparecem lado a lado.

---

## 5. Autenticação por e-mail

O Prisma RA **não usa login nem senha**. A identidade é sempre a da conta Google que
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
   > Seu e-mail não está cadastrado para utilizar o Prisma RA. Entre em contato com o
   > Administrador para solicitar seu acesso.

Não há acesso parcial, tela de login, token de sessão nem senha armazenada. `requireAuth_`
é a **primeira instrução de toda função pública** do servidor — inclusive as chamadas
diretas via `google.script.run` são barradas para e-mails não cadastrados.

**Pré-requisito de implantação:** o Web App deve ser publicado com **"Executar como:
usuário que acessa"** para que `Session.getActiveUser()` traga o e-mail real de quem usa
o sistema (ver [Configuração inicial](#8-configuração-inicial-e-instalação)).

---

## 6. Permissões

Três perfis, definidos na coluna `Perfil` da aba Usuários. As regras são aplicadas
**no servidor** (não apenas escondendo itens na interface).

| Recurso | Analista | Supervisor | Administrador (ADM) |
| --- | :---: | :---: | :---: |
| Ver/editar os **próprios** atendimentos | ✅ | ✅ | ✅ |
| Ver/editar atendimentos de **toda a equipe** | — | ✅ | ✅ |
| Delegar/reatribuir responsável | — | ✅ | ✅ |
| Aba **Indicadores** | — | ✅ | ✅ |
| Aba **Configurações** (produtos, categorias) | — | ✅ | ✅ |
| **Usuários**, **Canais** e **Campos do formulário** | — | — | ✅ |
| Seção **Banco de Dados** (link da planilha) | — | — | ✅ |

Funções-chave: `isAdminProfile_`, `isSupervisorProfile_`, `canAccessAtendimento_`,
`restrictToOwnerIfNeeded_`, `requireSupervisor_`, `requireAdmin_` (em `Services.gs`).

---

## 7. Integração com o Google Sheets (banco de dados)

Cada aba da planilha é uma "tabela". As colunas e os dados padrão são definidos em
`Config.gs` (`COLUMNS`, `DEFAULT_*`).

| Aba | Função |
| --- | --- |
| `ReclameAqui`, `SACPreventivo` | Atendimentos, separados por canal. Consultas consolidam todas as abas de canal. |
| `Canais` | Canais administráveis (ADM). Canais sem aba própria gravam em `ReclameAqui`, preservando o canal real na coluna `Canal`. |
| `ConfigCampos` | Configuração dinâmica do formulário de Novo Atendimento. |
| `Timeline` | Linha do tempo de cada atendimento (criação, mudanças, observações). |
| `Histórico` | Trilha de auditoria campo a campo (quem, quando, valor anterior/novo, justificativa). |
| `Usuários` | Cadastro de acesso: `Nome`, `Email`, `Perfil`, `Equipe`, `Ativo`, datas. |
| `Produtos`, `Categorias` | Catálogo administrável (categorias podem se vincular a um produto). |

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

## 10. Gerenciamento de produtos, categorias e canais

Em **Configurações**. Produtos e Categorias são acessíveis a Supervisor/ADM; **Canais**
é exclusivo do ADM.

- **Produtos**: catálogo de produtos (ex.: Cartão de Crédito, Conta Digital). Desativar
  preserva o histórico (desativação lógica).
- **Categorias**: motivos do atendimento, opcionalmente vinculados a um produto.
  Exclusão é **definitiva** (remove a linha do Sheets, com confirmação).
- **Canais**: canais de entrada. Exclusão **definitiva**, com guarda para o sistema
  **nunca ficar sem canal ativo** (`assertOutroCanalAtivo_`). Canais sem aba própria
  gravam os atendimentos na aba `ReclameAqui`, preservando o canal real.

Toda alteração recarrega automaticamente as listas do formulário, do Dashboard, dos
Indicadores e dos filtros (via `App.reloadBootstrap`), sem recarregar a aplicação.

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

---

## 13. Personalização

- **Campos do formulário** (ADM): a aba `ConfigCampos` define quais campos aparecem no
  Novo Atendimento, rótulo, tipo, obrigatoriedade e ordem — sem alterar código. Campos
  personalizados são gravados em JSON na coluna `CamposExtras` do atendimento.
- **Catálogo**: produtos, categorias e canais administráveis (ver seção 10).
- **Temas**: quatro temas (Azul padrão, Rosa, Brasil, Dark), selecionáveis no cabeçalho
  e persistidos em `localStorage`. Todo o CSS usa **variáveis de tema** (`--bg`,
  `--card-bg`, `--text-primary`, `--surface-muted`, etc.), o que mantém contraste
  consistente em todas as telas.
- **Identidade**: cores e rótulos centralizados em `Styles.html` (bloco `:root`) e
  `Config.gs`.

---

## 14. Performance

O sistema é otimizado para abrir rápido, cadastrar rápido e atualizar quase em tempo
real, minimizando leituras no Google Sheets:

- **Cache de leitura** (`CacheService`, TTL 5 min): cada aba é lida uma vez e reutilizada;
  escritas invalidam apenas o cache da aba afetada.
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

**Pelitero Labs Prisma RA** — gestão de atendimentos multicanal em Google Workspace.

</div>
