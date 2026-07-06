# PORTO RA

Aplicação corporativa para gestão da operação de Reclame Aqui da Porto. O frontend é uma SPA responsiva servida pelo Google Apps Script; o backend aplica as regras de negócio e utiliza Google Sheets como armazenamento, sem expor a planilha aos analistas.

## Funcionalidades

- cadastro, edição, pesquisa, listagem e exclusão lógica de atendimentos;
- cálculo de SLA em horas úteis por produto, categoria, tipo e canal;
- alteração manual de SLA com justificativa e histórico;
- controle de períodos aguardando área ou cliente;
- timeline permanente de criação, alterações, status, responsável, SLA e observações;
- dashboard com oito KPIs e painel de alertas;
- 14 visualizações de indicadores com filtros globais;
- relatórios operacionais, produtividade, PDF e CSV compatível com Excel;
- configuração de produtos, categorias, status, prioridades, canais, tipos, SLAs, motivos, usuários e parâmetros gerais;
- cache, locks de concorrência, gravações em lote, validação de CPF e proteção contra Número RA duplicado.

O desenho completo está em [ARCHITECTURE.md](ARCHITECTURE.md).

## Estrutura

```text
Code.gs                 Entrada do Web App e setup
Config.gs               Esquema, constantes e dados iniciais
Database.gs             Acesso ao Sheets, cache, locks e migração
Services.gs             Regras de negócio e API do frontend
Utils.gs                Datas, CPF, IDs, horas úteis e conversões
Index.html              Shell da SPA
Scripts.html            Navegação, filtros globais e estado da aplicação
Components.html         Componentes reutilizáveis
Styles.html             Design system responsivo
Dashboard.html          Dashboard e alertas
NovoAtendimento.html    Cadastro e edição
Atendimentos.html       Lista operacional
Pesquisa.html           Pesquisa avançada
Indicadores.html        Gráficos
Relatorios.html         Relatórios e exportações
Configuracoes.html      Administração da operação
appsscript.json         Manifesto Apps Script
```

## Implantação

### Opção 1 — editor do Apps Script

1. Crie um projeto Apps Script independente.
2. Copie os arquivos `.gs`, `.html` e o conteúdo de `appsscript.json`.
3. Execute `setup()` no editor e autorize os escopos.
   - Em projeto independente, o sistema cria `PORTO RA - Banco de Dados`.
   - Para utilizar uma planilha existente, execute `configurarPlanilha('ID_DA_PLANILHA')`.
4. Em **Implantar > Nova implantação**, selecione **Aplicativo da web**.
5. Para que o perfil seja reconhecido pelo e-mail, prefira executar como **usuário que acessa o app** e restrinja o acesso ao domínio corporativo.
6. Abra a URL `/exec`. O primeiro usuário identificado é cadastrado como `Supervisor`.

### Opção 2 — clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json
# informe o scriptId em .clasp.json
clasp push
clasp open
```

Depois, execute `setup()` e crie a implantação como Web App.

## Segurança operacional

- Não publique com acesso anônimo.
- Restrinja a implantação ao domínio Porto.
- Cadastre usuários e perfis na tela **Configurações**.
- Conceda acesso direto à planilha somente aos administradores necessários.
- A exclusão de atendimento é lógica; histórico e timeline são preservados.
- `SPREADSHEET_ID` não precisa ser versionado: o ID é salvo em `PropertiesService`.

## Atualizações

O esquema possui versão. Após um `clasp push`, `ensureDatabaseReady()` migra os cabeçalhos quando necessário, preservando os valores pelo nome das colunas.

