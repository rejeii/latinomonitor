// ============================================================
//  LatinoGG Monitor — ponto de entrada (Playwright)
//  Fluxo: Notion → navegador renderiza cada produto → compara
//  com o Custo Referência → ESCREVE no Notion → acumula alertas
//  → envia tudo em lote no Discord → resumo final.
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { buscarProdutos, atualizarProduto } from './notion.js';
import { scrapeProduto } from './scrapers.js';
import { calcPriceChange } from './priceChange.js';
import { enviarLotePrecos, enviarLoteEsgotados, enviarResumo, enviarErro, NOMES } from './discord.js';
import { DELAY_MS, NAV_TIMEOUT_MS, PRICE_THRESHOLD } from './config.js';

chromium.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(new Date().toISOString(), ...a);
const tag   = p => `[${NOMES[p.fornecedor] || p.fornecedor}]`;

async function main() {
  log('=== LatinoGG Monitor (Playwright) iniciado ===');

  const produtos = await buscarProdutos();
  log(`Produtos para monitorar: ${produtos.length}`);
  if (!produtos.length) return;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale:    'pt-BR',
    viewport:  { width: 1366, height: 768 },
  });
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  const page = await context.newPage();

  // Acumuladores — Discord só é chamado DEPOIS do loop (em lote)
  const precoAlerts    = [];   // { produto, preco, delta }  (subiu OU desceu)
  const esgotadoAlerts = [];   // { produto }  (apenas novas transições)

  const stats = {};
  const bump  = (forn, key) => { (stats[forn] ??= { ok:0, preco:0, esgotado:0, erro:0, bloqueado:0 })[key]++; };

  let est = 0, precoAlt = 0, esgotadoTot = 0, esgotadoNovo = 0, erros = 0, bloqueados = 0;

  for (const produto of produtos) {
    try {
      const { price, status, blocked } = await scrapeProduto(page, produto);

      // ── Bloqueado (Cloudflare não liberou) ──
      if (blocked) {
        log('[BLOQUEADO]', tag(produto), produto.nome);
        bloqueados++; bump(produto.fornecedor, 'bloqueado');
        await sleep(DELAY_MS); continue;
      }

      // ── Esgotado: escreve SEMPRE; alerta só na transição ──
      if (status === 'Esgotado') {
        esgotadoTot++; bump(produto.fornecedor, 'esgotado');
        await atualizarProduto(produto.pageId, {
          'Status': { select: { name: 'Esgotado' } },
          'Data':   { date: { start: new Date().toISOString() } },
        });
        if (produto.status !== 'Esgotado') {
          log('[ESGOTADO]', tag(produto), produto.nome);
          esgotadoAlerts.push({ produto });
          esgotadoNovo++;
        } else {
          log('[esgotado]', tag(produto), produto.nome);
        }
        await sleep(DELAY_MS); continue;
      }

      // ── Sem preço (falha de leitura) ──
      if (!price || price <= 0) {
        log('[SEM PREÇO]', tag(produto), produto.nome);
        erros++; bump(produto.fornecedor, 'erro');
        await sleep(DELAY_MS); continue;
      }

      // ── Em estoque: escreve SEMPRE, depois decide alerta ──
      const change = calcPriceChange(price, produto.custoRef);
      const props = {
        'Custo Atual': { number: price },
        'Data':        { date: { start: new Date().toISOString() } },
        'Status':      { select: { name: status } },
      };
      if (change) Object.assign(props, change.props);
      await atualizarProduto(produto.pageId, props);

      if (change?.triggered) {
        const seta = change.delta > 0 ? '▲' : '▼';
        log('[ALERTA ' + seta + ']', tag(produto), produto.nome,
            `— R$${price.toFixed(2)} (ref R$${(produto.custoRef ?? 0).toFixed(2)}, Δ R$${change.delta.toFixed(2)})`);
        precoAlerts.push({ produto, preco: price, delta: change.delta });
        precoAlt++; bump(produto.fornecedor, 'preco');
      } else {
        log('[ok]', tag(produto), produto.nome, `— R$${price.toFixed(2)}`);
        est++; bump(produto.fornecedor, 'ok');
      }

    } catch (e) {
      log('[ERRO]', tag(produto), produto.nome, '—', e.message);
      erros++; bump(produto.fornecedor, 'erro');
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  // ── Envia os alertas em LOTE (até 10 por mensagem) ──
  try {
    await enviarLotePrecos(precoAlerts);
    await enviarLoteEsgotados(esgotadoAlerts);
  } catch (e) {
    log('Falha ao enviar alertas em lote:', e.message);
  }

  // ── Resumo ──
  const totais =
    `Limite de alerta: R$${PRICE_THRESHOLD}\n` +
    `Total verificado: ${produtos.length}\n` +
    `✅ Estáveis: ${est}\n` +
    `📈 Preço alterado: ${precoAlt}\n` +
    `🚫 Esgotados: ${esgotadoTot} (${esgotadoNovo} novos)\n` +
    `⛔ Bloqueados: ${bloqueados}\n` +
    `❌ Erros: ${erros}`;

  const porFornecedor = Object.entries(stats).map(([f, s]) =>
    `• ${NOMES[f] || f}: ${s.ok} ok · ${s.preco} alt · ${s.esgotado} esg · ${s.bloqueado} bloq · ${s.erro} erro`
  ).join('\n');

  const resumo = totais + '\n\nPor fornecedor:\n' + porFornecedor;

  log('================ RESUMO ================');
  resumo.split('\n').forEach(l => log(l));
  log('========================================');

  await enviarResumo(resumo);
}

main().catch(async (e) => {
  console.error(e);
  await enviarErro('Falha geral no monitor: ' + e.message);
  process.exit(1);
});
