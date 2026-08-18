# PRISMA — Gestão Operacional (PGO)

**Sistema de gestão de atendimentos multicanal** sobre Google Apps Script e Google
Sheets: sem servidor, sem banco de dados externo e sem custo de infraestrutura.

Desenvolvido por **Pelitero Labs**.

---

## O que o sistema faz

O PGO registra e acompanha atendimentos que chegam por vários canais (Reclame Aqui,
SAC, Ouvidoria e outros que o administrador criar), controlando quem vê o quê, quem
pode alterar o quê, e entregando os números da operação prontos para leitura.

| Tela | Para que serve |
|---|---|
| **Dashboard** | Visão do dia: indicadores, filtros e a lista de atendimentos |
| **Novo Atendimento** | Registro e edição, com formulário montado pelo canal |
| **Relatórios** | Consulta com filtros combináveis e exportação |
| **Produtividade Equipe** | Quanto a equipe produziu, por pessoa e por período |
| **Análise de SAC** | Indicadores consolidados a partir de planilha externa |
| **Configurações** | Catálogo, usuários, níveis de acesso, segurança e importação |

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

1. Crie uma planilha no Google Sheets e um projeto do Apps Script vinculado a ela.
2. Copie os arquivos nesta ordem (as constantes de topo são avaliadas na carga):

   1. `Config.gs`, `Utils.gs`, `Database.gs`
   2. `Pgo5.gs`, `Pgo5Auditoria.gs`, `Pgo5Permissoes.gs`, `Pgo5Seguranca.gs`
   3. `Pgo5Usuarios.gs`, `Pgo5Catalogo.gs`, `Pgo5Atendimentos.gs`
   4. `Pgo5Importacao.gs`, `Pgo5Analitico.gs`, `Pgo5Diagnostico.gs`
   5. `Services.gs`, `Code.gs`
   6. Todos os `.html` da pasta `Front/`

3. Publique como **Web App** (executar como você; acesso conforme a política da empresa).
4. Abra o sistema uma vez: as cinco abas e o catálogo inicial são criados sozinhos.
5. Cadastre-se na aba `Usuários` com nível Administrador e defina o PIN.

### Conferência pós-publicação

No editor do Apps Script, execute **`verificarIntegridadeBuildPGO5`**. Ela só lê, e
confere em segundos se todos os arquivos foram publicados e se as regras críticas
continuam de pé. Nenhum teste fora do Apps Script pega um arquivo que ficou para trás
na cópia manual — este pega.

Depois, na interface: o menu aparece → Novo Atendimento lista os canais → a data vem
preenchida com hoje e recusa amanhã → o status abre em Pendente → salvar e ver o
registro no Dashboard.

---

## Importar Base Legada

Traz o histórico de um sistema anterior para dentro da base em uso, sem recriar nada:

- a planilha de origem é aberta **somente para leitura**;
- cada linha é conferida antes de entrar — o que não passa é pulado e informado por
  motivo, nada entra pela metade;
- cada registro importado leva uma etiqueta, então **reimportar não duplica**;
- produtos, categorias e status que só existiam no sistema antigo são criados aqui,
  preservando a hierarquia, para o histórico não aparecer como "Sem dados".

Requer permissão de configuração do sistema **e** PIN.

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
| **5.3** | ago/2026 | **Versão atual.** Importar Base Legada, diagnóstico de build, consolidação dos arquivos e remoção do caminho 4.x |

### O que a 5.3 consolidou

A 5.0 conviveu por um tempo com o modelo antigo, para a virada acontecer sem
interrupção. Concluída a transição, o caminho 4.x saiu: as telas duplicadas foram
unificadas nas versões definitivas e o motor de conversão de base deu lugar à
**Importar Base Legada**, que acrescenta histórico à base em uso em vez de recriá-la.

O sistema passou a ter uma implementação por responsabilidade — **8 arquivos a menos e
cerca de 5.500 linhas removidas**, sem perda de funcionalidade.

---

<sub>Pelitero Labs · PRISMA Gestão Operacional</sub>
