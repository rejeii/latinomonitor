// ============================================================
//  Teste de produto individual (não precisa de Notion/Discord)
//  Uso: node src/test-produto.js "https://www.visaovip.com/prod/..."
// ============================================================

import { criarNavegador } from './browser.js';
import { scrapeProduto, detectarFornecedor } from './scrapers.js';

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

const { browser, context } = await criarNavegador();
const page = await context.newPage();

const res = await scrapeProduto(page, { url, fornecedor });
console.log('Fornecedor:', fornecedor);
console.log('Resultado: ', res);

await browser.close();
