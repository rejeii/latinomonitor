// ============================================================
//  Testes de detectarFornecedor, resultadoRuim e scrapeProduto
//  (page falsa — não abre navegador). Rodar: npm test
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

// Timeouts curtos ANTES do import (lidos na carga do módulo)
process.env.READY_TIMEOUT_MS  = '100';
process.env.PRICE_DEADLINE_MS = '600';

const { detectarFornecedor, resultadoRuim, scrapeProduto, scrapeInPage } = await import('../src/scrapers.js');

test('detectarFornecedor: reconhece os 3 fornecedores e rejeita o resto', () => {
  assert.strictEqual(detectarFornecedor('https://www.visaovip.com/prod/x'), 'visaovip');
  assert.strictEqual(detectarFornecedor('https://atacadoconnect.com/p/y'), 'atacadoconnect');
  assert.strictEqual(detectarFornecedor('https://loja.atacadocollections.com/z'), 'atacadocollections');
  assert.strictEqual(detectarFornecedor('https://exemplo.com/produto'), null);
  assert.strictEqual(detectarFornecedor(''), null);
  assert.strictEqual(detectarFornecedor(null), null);
});

test('resultadoRuim: classifica o que merece retry', () => {
  assert.strictEqual(resultadoRuim({ erro: 'timeout' }), true, 'erro → ruim');
  assert.strictEqual(resultadoRuim({ price: 0, status: 'Em estoque', blocked: true }), true, 'bloqueado → ruim');
  assert.strictEqual(resultadoRuim({ price: 0, status: 'Em estoque', blocked: false }), true, 'sem preço → ruim');
  assert.strictEqual(resultadoRuim({ price: 0, status: 'Esgotado', blocked: false }), false, 'esgotado é estado legítimo, não falha');
  assert.strictEqual(resultadoRuim({ price: 99.9, status: 'Em estoque', blocked: false }), false, 'preço ok → bom');
});

// Page falsa mínima para exercitar o fluxo do scrapeProduto sem navegador
const fakePage = (evaluateImpl) => ({
  goto:            async () => {},
  waitForSelector: async () => {},
  waitForTimeout:  ms => new Promise(r => setTimeout(r, ms)),
  evaluate:        evaluateImpl,
});

test('scrapeProduto: retorna na hora quando o preço aparece', async () => {
  const page = fakePage(async () => ({ price: 123.45, status: 'Em estoque', blocked: false }));
  const t0 = Date.now();
  const r  = await scrapeProduto(page, { url: 'https://www.visaovip.com/prod/x', fornecedor: 'visaovip' });
  assert.strictEqual(r.price, 123.45);
  assert.ok(Date.now() - t0 < 500, 'não deve esperar o deadline se o preço já veio');
});

test('scrapeProduto: esgotado encerra o polling sem esperar o deadline', async () => {
  const page = fakePage(async () => ({ price: 0, status: 'Esgotado', blocked: false }));
  const r = await scrapeProduto(page, { url: 'https://www.visaovip.com/prod/x', fornecedor: 'visaovip' });
  assert.strictEqual(r.status, 'Esgotado');
});

test('scrapeProduto: sem preço, insiste até o deadline (PRICE_DEADLINE_MS) e devolve o último resultado', async () => {
  let chamadas = 0;
  const page = fakePage(async () => { chamadas++; return { price: 0, status: 'Em estoque', blocked: true }; });
  const t0 = Date.now();
  const r  = await scrapeProduto(page, { url: 'https://www.visaovip.com/prod/x', fornecedor: 'visaovip' });
  const dt = Date.now() - t0;
  assert.strictEqual(r.blocked, true);
  assert.ok(chamadas >= 1);
  assert.ok(dt >= 500 && dt < 3000, `polling respeitou o deadline de 600ms (durou ${dt}ms)`);
});

test('scrapeProduto: rate-limit é página estática — encerra o polling na hora', async () => {
  let chamadas = 0;
  const page = fakePage(async () => { chamadas++; return { price: 0, status: 'Em estoque', blocked: true, rateLimited: true }; });
  const t0 = Date.now();
  const r  = await scrapeProduto(page, { url: 'https://loja.atacadocollections.com/x', fornecedor: 'atacadocollections' });
  assert.strictEqual(r.rateLimited, true);
  assert.strictEqual(chamadas, 1);
  assert.ok(Date.now() - t0 < 500, 'não deve esperar o deadline no rate-limit');
});

// ── scrapeInPage com um document falso (a função é autocontida) ──
const comDocumento = (doc, fn) => {
  globalThis.document = {
    title: '',
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
    ...doc,
  };
  try { return fn(); } finally { delete globalThis.document; }
};

test('scrapeInPage: desafio da Cloudflare em português é Bloqueado (não "Sem preço")', () => {
  const r = comDocumento(
    { body: { innerText: 'visaovip.com\nExecutando verificação de segurança\nEste site utiliza um serviço de segurança para proteção contra bots maliciosos.' } },
    () => scrapeInPage('visaovip'));
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.rateLimited, false);
});

test('scrapeInPage: Turnstile ("Verify you are human") é Bloqueado', () => {
  const r = comDocumento(
    { body: { innerText: 'Verify you are human' } },
    () => scrapeInPage('visaovip'));
  assert.strictEqual(r.blocked, true);
});

test('scrapeInPage: rate-limit da Collections vira blocked + rateLimited', () => {
  const r = comDocumento(
    { body: { innerText: 'Ops, você fez requisições fora do normal.\n— Volte acessar novamente em alguns minutos.' } },
    () => scrapeInPage('atacadocollections'));
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.rateLimited, true);
});

test('scrapeInPage: VisãoVip só com preço em U$ marca usdOnly (sem converter)', () => {
  const r = comDocumento(
    { body: { innerText: 'Memória RAM Macrovip Max DDR4 16GB\nU$ 82,50\nConfirme a cotação ao realizar a compra.' } },
    () => scrapeInPage('visaovip'));
  assert.strictEqual(r.price, 0);
  assert.strictEqual(r.usdOnly, true);
  assert.strictEqual(r.blocked, false);
});

test('scrapeInPage: VisãoVip com R$ no seletor lê o preço e não marca usdOnly', () => {
  const el = { innerText: 'R$ 431,48' };
  const r = comDocumento({
    body: { innerText: 'U$ 82,50\nR$ 431,48\nConfirme a cotação ao realizar a compra.' },
    querySelector: sel => sel === '.border-round-2xl .text-vip:not(.font-medium)' ? el : null,
  }, () => scrapeInPage('visaovip'));
  assert.strictEqual(r.price, 431.48);
  assert.strictEqual(r.usdOnly, false);
});
