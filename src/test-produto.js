// ============================================================
//  Teste de produto individual (não precisa de Notion/Discord)
//  Uso: node src/test-produto.js "https://www.visaovip.com/prod/..."
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeProduto, detectarFornecedor } from './scrapers.js';

chromium.use(StealthPlugin());

const url = process.argv[2];
if (!url) {
  console.error('Uso: node src/test-produto.js "<URL do produto>"');
  process.exit(1);
}

const fornecedor = detectarFornecedor(url);
if (!fornecedor) {
  console.error('Fornecedor não reconhecido para:', url);
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 1366, height: 768 } });
const page = await context.newPage();

const res = await scrapeProduto(page, { url, fornecedor });
console.log('Fornecedor:', fornecedor);
console.log('Resultado: ', res);

await browser.close();
