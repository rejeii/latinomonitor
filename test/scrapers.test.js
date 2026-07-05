// ============================================================
//  Testes de detectarFornecedor, resultadoRuim e scrapeProduto
//  (page falsa — não abre navegador). Rodar: npm test
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

// Timeouts curtos ANTES do import (lidos na carga do módulo)
process.env.READY_TIMEOUT_MS  = '100';
process.env.PRICE_DEADLINE_MS = '600';

const { detectarFornecedor, resultadoRuim, scrapeProduto } = await import('../src/scrapers.js');

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
