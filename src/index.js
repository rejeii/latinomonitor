// ============================================================
//  LatinoGG Monitor — ponto de entrada (Playwright)
//  Fluxo: Notion → navegador renderiza cada produto → compara
//  com o Custo Referência → grava de volta → alerta no Discord.
// ============================================================

import { chromium } from 'playwright';
import { buscarProdutos, atualizarProduto } from './notion.js';
import { scrapeProduto } from './scrapers.js';
import { calcPriceChange } from './priceChange.js';
import { enviarAlertaPreco, enviarAlertaEsgotado, enviarErro } from './discord.js';
import { DELAY_MS, NAV_TIMEOUT_MS } from './config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(new Date().toISOString(), ...a);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

  let alertasPreco = 0, alertasEstoque = 0, erros = 0, bloqueados = 0;

  for (const produto of produtos) {
    try {
      const { price, status, blocked } = await scrapeProduto(page, produto);

      if (blocked) {
        log(`BLOQUEADO (Cloudflare): ${produto.nome}`);
        bloqueados++;
        await sleep(DELAY_MS);
        continue;
      }

      // ── Esgotado: alerta só na TRANSIÇÃO (estava em estoque → esgotou) ──
      if (status === 'Esgotado') {
        if (produto.status !== 'Esgotado') {
          log(`[ESGOTADO] ${produto.nome}`);
          await enviarAlertaEsgotado(produto);
          alertasEstoque++;
        }
        await atualizarProduto(produto.pageId, {
          'Status': { select: { name: 'Esgotado' } },
          'Data':   { date: { start: new Date().toISOString() } },
        });
        await sleep(DELAY_MS);
        continue;
      }

      if (!price || price <= 0) {
        log(`PREÇO INVÁLIDO: ${produto.nome}`);
        erros++;
        await sleep(DELAY_MS);
        continue;
      }

      // ── Variação de preço ──
      const change = calcPriceChange(price, produto.custoRef);

      const props = {
        'Custo Atual': { number: price },
        'Data':        { date: { start: new Date().toISOString() } },
        'Status':      { select: { name: status } },
      };
      if (change) Object.assign(props, change.props);
      await atualizarProduto(produto.pageId, props);

      if (change?.triggered) {
        log(`[${produto.fornecedor}] ${produto.nome} | ref R$${(produto.custoRef ?? 0).toFixed(2)} → R$${price.toFixed(2)} | Δ R$${change.delta.toFixed(2)}`);
        await enviarAlertaPreco(produto, price, change.delta);
        alertasPreco++;
      } else {
        log(`[ok] ${produto.nome} — R$${price.toFixed(2)}`);
      }

    } catch (e) {
      log(`ERRO [${produto.nome}]: ${e.message}`);
      erros++;
    }
    await sleep(DELAY_MS);
  }

  await browser.close();
  log(`=== Concluído: ${alertasPreco} preço, ${alertasEstoque} esgotado, ${bloqueados} bloqueado(s), ${erros} erro(s) ===`);
}

main().catch(async (e) => {
  console.error(e);
  await enviarErro('Falha geral no monitor: ' + e.message);
  process.exit(1);
});
