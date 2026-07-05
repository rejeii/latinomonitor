# LatinoGG Monitor (Playwright)

Monitor de preços que roda **100% automático no GitHub Actions** — sem PC ligado, sem servidor.
Abre cada produto num **navegador headless** (renderiza JS igual ao seu userscript), lê o preço
em R$ direto do DOM, compara com o `Custo Referência` salvo no Notion e **alerta no Discord**
quando varia ≥ `PRICE_THRESHOLD` ou quando o produto esgota.

> Substitui o monitor antigo em Google Apps Script. A vantagem é que um navegador real
> renderiza a página e passa o desafio JS da Cloudflare que o GAS não conseguia.

---

## Como funciona

```
GitHub Actions (cron diário)
  └── node src/index.js
        ├── notion.js     → lê produtos (Nome, Produto, Custo Atual, Custo Referência, Status)
        ├── scrapers.js   → Playwright abre cada URL e raspa { price, status }
        ├── priceChange.js→ compara price vs Custo Referência (limite PRICE_THRESHOLD)
        ├── grava de volta no Notion (Custo Atual, Custo Referência, Alteração, Status, Data)
        └── discord.js    → webhook quando a variação dispara / produto esgota
```

**Anti-spam:** o `Custo Referência` só é atualizado quando o alerta dispara. Na execução seguinte
a comparação parte do novo valor → a mesma variação **não** alerta de novo. A primeira execução
de um produto só define o baseline (não alerta).

---

## Campos esperados no Notion

| Campo              | Tipo          | Uso                                      |
|--------------------|---------------|------------------------------------------|
| `Nome`             | title         | nome no alerta                           |
| `Produto`          | url           | URL do fornecedor (define o scraper)     |
| `Custo Atual`      | number        | último preço lido (gravado a cada run)   |
| `Custo Referência` | number        | baseline da comparação                   |
| `Alteração`        | select        | Subiu / Desceu / Estável                 |
| `Alteração de`     | number        | tamanho da última variação               |
| `Status`           | select        | Em estoque / Esgotado                    |
| `Data`             | date          | timestamp da última verificação          |
| `Preço Alvo`       | number        | **você preenche** — alerta 🎯 quando o preço fica ≤ alvo |
| `Pausado`          | checkbox      | **você marca** — produto pausado não é monitorado (sem perder o histórico) |
| `Alvo Atingido`    | checkbox      | controle interno do alerta de alvo (o monitor gerencia)  |

> São os mesmos campos do userscript LatinoGo — os dois sistemas convivem sem brigar.
> Campos que faltarem são criados automaticamente no primeiro run.

**Preço alvo (anti-spam):** o alerta 🎯 dispara uma vez, quando o preço *cruza* para
baixo do alvo (o monitor marca `Alvo Atingido`). Enquanto seguir abaixo, não repete.
Se o preço subir acima do alvo, o flag é limpo e o alerta rearma sozinho.

---

## Deploy no GitHub Actions

1. Crie um repositório **privado** e suba esta pasta (`latino-monitor/`) na raiz.
2. Em **Settings → Secrets and variables → Actions → Secrets**, crie:
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_IDS` — IDs separados por vírgula (ex: `abc123...,def456...`)
   - `DISCORD_WEBHOOK_PRECOS`
   - `DISCORD_WEBHOOK_ESGOTADOS` (opcional — se não criar, usa o de preços)
   - `DISCORD_WEBHOOK_INICIO` (opcional — recebe um aviso quando cada run começa)
3. Na aba **Variables** (ao lado de Secrets), crie a variável `PRICE_THRESHOLD` = `10` (opcional).
4. Para rodar agora, vá em **Actions → LatinoGG Monitor → Run workflow**.

### Agendamento (externo, via cron-job.org)

O agendamento é feito **fora do GitHub**, pelo [cron-job.org](https://cron-job.org), que dispara o
workflow a cada 6h chamando a API de `workflow_dispatch`:

```
POST https://api.github.com/repos/rejeii/latinomonitor/actions/workflows/monitor.yml/dispatches
Header: Authorization: Bearer <PAT fine-grained, repo-scoped, Actions: read/write>
Body:   {"ref":"main"}
```

> Por que externo: o `schedule:` nativo do GitHub **desativa após 60 dias sem commits**.
> Disparando de fora via `workflow_dispatch`, isso nunca acontece.
> O PAT deve ser **fine-grained**, restrito a este repo, com permissão mínima **Actions: Read and write**.

---

## Rodar local (teste)

```bash
npm install
npx playwright install chromium

# rodar os testes (não abrem navegador nem tocam Notion/Discord):
npm test

# testar UM produto (não precisa de Notion/Discord):
node src/test-produto.js "https://www.visaovip.com/prod/..."

# rodar o fluxo completo (precisa das variáveis — use um .env ou exporte):
npm start
```

---

## Resiliência do scrape

- **Dedupe:** linhas do Notion com a mesma URL são raspadas **uma vez só** — o resultado
  é reaproveitado em todas (o resumo continua apontando os duplicados pra limpeza).
- **Retry:** quem falha na 1ª tentativa (erro, bloqueio da Cloudflare ou sem preço) ganha
  uma **segunda visita** no fim da fase de scrape — bloqueios costumam se resolver na revisita.
- **Screenshot de debug:** quem falha 2x é fotografado; as imagens saem como **artifact
  `debug-screenshots`** do run no GitHub (guardadas por 7 dias) — diagnóstico de seletor
  quebrado em segundos, sem adivinhação.

---

## Limitações honestas

- **AtacadoCollections + Cloudflare:** um navegador real tem chance boa de passar, mas o IP do
  GitHub Actions é de datacenter. Se a Cloudflare bloquear, o produto aparece como
  `BLOQUEADO (Cloudflare)` no log. Plano B: adicionar `playwright-extra` + plugin stealth, ou
  passar por um proxy residencial (pago). Só dá pra saber rodando.
- **Seletores podem mudar:** os scrapers usam as classes do site (portadas do userscript). Se um
  fornecedor mudar o layout, o seletor daquele site quebra — ajuste em
  [`src/scrapers.js`](src/scrapers.js). O ATK Connect usa `[class*="priceValue"]` justamente para
  resistir à troca do hash do CSS.
- **Sem login:** os preços testados aparecem sem login. Se algum site passar a esconder preço atrás
  de login, é preciso adicionar um passo de autenticação (cookies/storageState) — me avise.
- **TopDek:** fora do escopo (deixado de lado).
