// ============================================================
//  Testes do notion.js com fetch simulado (não toca o Notion real)
//  Rodar: npm test
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

process.env.NOTION_TOKEN           ||= 'test-token';
process.env.NOTION_DATABASE_IDS    ||= 'db-teste';
process.env.DISCORD_WEBHOOK_PRECOS ||= 'https://example.com/webhook';

const { buscarProdutos } = await import('../src/notion.js');

const paginaProduto = (nome, extra = {}) => ({
  id: 'page-' + nome,
  properties: {
    'Nome':    { title: [{ plain_text: nome }] },
    'Produto': { url: 'https://www.visaovip.com/prod/' + nome },
    ...extra,
  },
});

test('buscarProdutos: resposta não-JSON (gateway 502) vira erro legível', async () => {
  globalThis.fetch = async () =>
    new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502 });

  await assert.rejects(buscarProdutos, (e) => {
    assert.match(e.message, /resposta não-JSON/);
    assert.match(e.message, /502/);
    return true;
  });
});

test('buscarProdutos: erro JSON do próprio Notion mantém a mensagem original', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ object: 'error', message: 'database not found' }), { status: 404 });

  await assert.rejects(buscarProdutos, /Notion 404: database not found/);
});

test('buscarProdutos: lê os campos (inclusive Preço Alvo/Pausado/Alvo Atingido) com defaults', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [
      paginaProduto('com-alvo', {
        'Custo Atual':      { number: 199.9 },
        'Custo Referência': { number: 180 },
        'Preço Alvo':       { number: 150 },
        'Alvo Atingido':    { checkbox: true },
        'Status':           { select: { name: 'Em estoque' } },
      }),
      paginaProduto('pausado', { 'Pausado': { checkbox: true } }),
      paginaProduto('cru'),                                     // linha nova, só Nome+URL
      { id: 'page-invalida', properties: { 'Nome': { title: [{ plain_text: 'sem-url' }] } } },
    ],
    has_more: false,
  }), { status: 200 });

  const produtos = await buscarProdutos();
  assert.strictEqual(produtos.length, 3, 'linha sem URL de fornecedor é ignorada');

  const [comAlvo, pausado, cru] = produtos;
  assert.strictEqual(comAlvo.custoAtual, 199.9);
  assert.strictEqual(comAlvo.custoRef, 180);
  assert.strictEqual(comAlvo.precoAlvo, 150);
  assert.strictEqual(comAlvo.alvoAtingido, true);
  assert.strictEqual(comAlvo.pausado, false);
  assert.strictEqual(comAlvo.fornecedor, 'visaovip');

  assert.strictEqual(pausado.pausado, true);

  assert.strictEqual(cru.custoRef, null,      'campo ausente vira null');
  assert.strictEqual(cru.precoAlvo, null);
  assert.strictEqual(cru.pausado, false,      'checkbox ausente vira false');
  assert.strictEqual(cru.alvoAtingido, false);
});

test('buscarProdutos: segue paginação do Notion (has_more/next_cursor)', async () => {
  let chamada = 0;
  globalThis.fetch = async () => {
    chamada++;
    return new Response(JSON.stringify(chamada === 1
      ? { results: [paginaProduto('p1')], has_more: true, next_cursor: 'cursor-2' }
      : { results: [paginaProduto('p2')], has_more: false }
    ), { status: 200 });
  };

  const produtos = await buscarProdutos();
  assert.strictEqual(chamada, 2, 'fez as 2 chamadas da paginação');
  assert.deepStrictEqual(produtos.map(p => p.nome), ['p1', 'p2']);
});
