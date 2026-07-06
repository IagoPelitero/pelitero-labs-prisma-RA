# Arquitetura do PORTO RA

## Visão geral

```text
Navegador
  └─ Index.html
      ├─ App / filtros / navegação SPA
      ├─ páginas e componentes
      └─ google.script.run
             │
Google Apps Script
  ├─ Code.gs       entrada, usuário e setup
  ├─ Services.gs   validação e regras de negócio
  ├─ Database.gs   cache, locks e operações em lote
  └─ Utils.gs      funções puras e horas úteis
             │
Google Sheets
  ├─ dados transacionais
  ├─ cadastros configuráveis
  └─ auditoria e snapshots
```

A página não é recarregada durante a navegação. `App.navigateTo()` troca apenas o conteúdo central, e as chamadas assíncronas atualizam cards, tabelas e gráficos.

## Fluxo de navegação

| Rota | Responsabilidade |
|---|---|
| Dashboard | KPIs, prioridades do dia e alertas de espera/SLA |
| Novo Atendimento | criação, cálculo do SLA e validações |
| Atendimentos | pesquisa instantânea, ordenação, paginação e ações |
| Pesquisa | consulta combinada por RA, CPF, cliente e classificadores |
| Indicadores | gráficos atualizados pelos filtros globais |
| Relatórios | relatório detalhado, produtividade, PDF e CSV |
| Configurações | cadastros e parâmetros, restritos à supervisão |

Os filtros globais mantêm um único objeto com período, analista, produto, categoria, status, prioridade, canal, Número RA, cliente e CPF. Dashboard, atendimentos e indicadores consultam esse estado.

## Modelo de dados

### Atendimentos

Registro principal. `Id` é a chave técnica e `NumeroRA` é único entre registros ativos. Contém identificação do cliente, classificação, responsável, status, SLA, espera, resolução e auditoria de criação/atualização/exclusão.

### Timeline

Relação `N:1` com Atendimentos por `AtendimentoId`. Armazena eventos legíveis da operação. Nunca é removida, inclusive quando o atendimento recebe exclusão lógica.

### Histórico

Relação `N:1` opcional por `AtendimentoId`. Armazena alterações campo a campo, valores anterior/novo, usuário e justificativa. Também registra mudanças administrativas sem atendimento vinculado.

### Cadastros

- `Usuários`: identidade, perfil (`Analista`/`Supervisor`), equipe e atividade.
- `Produtos`.
- `Categorias`: `ProdutoId → Produtos.Id`.
- `Status`: tipo inicial, espera, intermediário ou final.
- `Prioridades`: multiplicador de SLA.
- `Canais`.
- `TiposAtendimento`.
- `MotivosPendencia`.

### SLAs

Cada regra pode referenciar `ProdutoId`, `CategoriaId`, `TipoAtendimentoId` e `CanalId`. Campos vazios funcionam como curinga. A regra compatível mais específica vence; na ausência de regra é usado `SLA_PADRAO_HORAS`. O multiplicador da prioridade é aplicado em seguida.

### Apoio e operação

- `Configurações`: parâmetros chave/valor para alertas, horário útil e SLA padrão.
- `Dashboard`: último snapshot dos KPIs.
- `Relatórios`: log de geração de relatórios.

## Regras críticas

1. O backend repete todas as validações do frontend.
2. A checagem de `NumeroRA` e a gravação ocorrem sob o mesmo `LockService`.
3. Datas retornadas ao browser são serializadas em ISO 8601.
4. Status de espera abre um período; a saída calcula horas e registra evento estruturado.
5. Status final registra data e tempo útil de resolução.
6. Alteração de SLA exige justificativa.
7. Configurações exigem perfil de supervisão no servidor.
8. Exclusões são lógicas e auditadas.

## Desempenho e evolução

- leituras usam `CacheService`;
- escritas invalidam somente as chaves afetadas;
- histórico é inserido em lote;
- `PropertiesService` guarda o ID da base e a versão do esquema;
- migrações reorganizam dados pelo nome do cabeçalho;
- a separação entre serviços e acesso a dados permite substituir Sheets ou integrar APIs, e-mail e notificações sem reescrever a interface.

