# Padrão de código do RECC

Uma regra acima de todas: **quem abrir este código daqui a dois anos precisa
entender sem perguntar para ninguém.** Vale para estagiário no primeiro dia.

Nome curto economiza dez segundos de digitação e custa dez minutos de leitura,
toda vez. Não vale a troca.

---

## 1. Tudo em português, por extenso

| Não escreva | Escreva |
|---|---|
| `plLer_` | `lerRegistros_` |
| `seqProximoId_` | `proximoIdentificador_` |
| `instSemear_` | `semearDadosIniciais_` |
| `{ c: 'CPF', t: 'id', p: true }` | `{ cabecalho: 'CPF', tipo: 'identificador', protegido: true }` |
| `def`, `ss`, `cfg`, `qtd`, `tmp` | `esquema`, `planilha`, `configuracao`, `quantidade` |
| `cache` | `memoria`, `jaLido` |
| `soft delete` | `exclusão lógica` |
| `widget` | `componente` |
| `layout` | `disposição` |
| `snapshot` | `retrato` |
| `hash` | `chave` |

Abreviação só quando a palavra inteira é a abreviação: `Id`, `CPF`, `SUSEP`.

## 2. As exceções, e por que existem

Três coisas ficam em inglês, e **é para o seu bem**: se você renomear, não vai
achar nada na documentação quando precisar.

| Fica como está | Porque |
|---|---|
| `SpreadsheetApp`, `LockService`, `PropertiesService`, `CacheService`, `HtmlService` | São nomes de serviços do Google |
| `getValues`, `setValues`, `getRange`, `getLastRow`, `onEdit`, `doGet` | São funções do Google, não nossas |
| `Power BI`, `Google Planilhas`, `Apps Script`, `BigQuery` | São nomes de produtos |
| `README.md` | O GitHub só exibe o arquivo na pasta se ele tiver esse nome |
| `function`, `return`, `String`, `default`, `delete` | São palavras da própria linguagem JavaScript |

Sempre que um desses aparecer pela primeira vez num arquivo, o comentário
explica em português o que ele faz.

## 3. O sublinhado no fim do nome

`lerRegistros_` termina com `_`. Isso **não** é enfeite: no Apps Script, função
terminada em sublinhado **não pode ser chamada pelo navegador**. É a diferença
entre uma peça interna e uma porta aberta para fora.

- `instalarRECC()` — sem sublinhado: alguém chama de propósito.
- `lerRegistros_()` — com sublinhado: só o próprio servidor usa.

Na dúvida, ponha o sublinhado. Tirar depois é fácil; descobrir que uma função
interna estava exposta é caro.

## 4. Nome de função diz o que ela FAZ

| Ruim | Bom | Por quê |
|---|---|---|
| `processar()` | `converterParaNumero_()` | "Processar" não diz nada |
| `handle()` | `ocultarRegistro_()` | Inglês e vago |
| `check()` | `conferirEstrutura_()` | Idem |
| `gravar()` | `formatarEGravar_()` | O nome ensina a regra: formata **antes** de gravar |

O último é o caso mais importante do sistema. O nome da função existe para
lembrar a ordem — se alguém inverter, o Sheets corrompe identificador.

## 5. Comentário explica o PORQUÊ, não o quê

```javascript
// Ruim — repete o código
// Percorre as colunas
for (var i = 0; i < colunas.length; i++) {

// Bom — conta o que o código não consegue contar
// A hora é ancorada em 1970, e não na época do Sheets (30/12/1899), porque
// São Paulo usava -03:06:28 naquela data e a hora chegaria deslocada.
```

Quando um trecho existe por causa de um bug que já aconteceu, **escreva o bug
no comentário.** É a única forma de alguém não reintroduzi-lo.

## 6. Onde cada coisa mora

```
RECC/
├── Servidor/     os arquivos .gs, que rodam no Apps Script
├── Telas/        os arquivos .html, que rodam no navegador
└── Testes/       a suíte, que roda no computador com node
```

Nada de `Back` e `Front`: **Servidor** e **Telas** dizem a mesma coisa em
português.

## 7. Antes de commitar

```bash
node RECC/Testes/rodar.js
```

Cinco execuções seguidas sem falha. Rodar uma vez não pega teste instável.
