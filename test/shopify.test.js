process.env.NOTION_TOKEN           ||= 'test-token';
process.env.NOTION_DATABASE_IDS    ||= 'db-teste';
process.env.DISCORD_WEBHOOK_PRECOS ||= 'https://example.com/webhook';
process.env.SHOPIFY_ACCESS_TOKEN   ||= 'test-shopify-token';

import test from 'node:test';
import assert from 'node:assert';

const { buscarInventoryItemId, atualizarEstoqueShopify, buscarPrecosShopify, atualizarPrecosShopify } = await import('../src/shopify.js');



test('atualizarEstoqueShopify: retorna sem erro se SKU for ausente', async () => {
  const res = await atualizarEstoqueShopify({ sku: null, quantidade: 0, produtoNome: 'Teste' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.motivo, 'Sem SKU');
});

test('atualizarEstoqueShopify: busca variante e atualiza estoque com mock de fetch', async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('graphql.json')) {
        return new Response(JSON.stringify({
          data: {
            inventoryItems: {
              edges: [
                { node: { id: 'gid://shopify/InventoryItem/99887766', sku: '55612' } }
              ]
            }
          }
        }), { status: 200 });
      }
      if (urlStr.includes('inventory_levels/set.json')) {
        const body = JSON.parse(opts.body);
        assert.strictEqual(body.inventory_item_id, 99887766);
        assert.strictEqual(body.available, 0);
        return new Response(JSON.stringify({ inventory_level: { available: 0 } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const res = await atualizarEstoqueShopify({ sku: '55612', quantidade: 0, produtoNome: 'Fone JBL' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.inventoryItemId, '99887766');
    assert.strictEqual(res.quantidade, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('atualizarPrecosShopify: busca os precos e atualiza na Shopify (mock fetch)', async () => {
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      const body = JSON.parse(opts.body);
      
      // Mock para buscarPrecosShopify (primeira chamada)
      if (body.query.includes('getVariantPrice')) {
        return new Response(JSON.stringify({
          data: {
            productVariants: {
              edges: [
                { node: { id: 'gid://shopify/ProductVariant/111', sku: '12345', price: '100.00', compareAtPrice: '150.00', inventoryItem: { id: 'gid://shopify/InventoryItem/222', cost: '80.00' } } }
              ]
            }
          }
        }), { status: 200 });
      }
      
      // Mock para productVariantUpdate
      if (body.query.includes('productVariantUpdate')) {
        assert.strictEqual(body.variables.input.id, 'gid://shopify/ProductVariant/111');
        assert.strictEqual(body.variables.input.price, '120');
        assert.strictEqual(body.variables.input.compareAtPrice, '180');
        return new Response(JSON.stringify({ data: { productVariantUpdate: { userErrors: [] } } }), { status: 200 });
      }
      
      // Mock para inventoryItemUpdate
      if (body.query.includes('inventoryItemUpdate')) {
        assert.strictEqual(body.variables.id, 'gid://shopify/InventoryItem/222');
        assert.strictEqual(body.variables.input.cost, '95');
        return new Response(JSON.stringify({ data: { inventoryItemUpdate: { userErrors: [] } } }), { status: 200 });
      }

      return new Response('{}', { status: 200 });
    };

    const res = await atualizarPrecosShopify({ sku: '12345', precoVenda: 120, precoComparacao: 180, precoCusto: 95, produtoNome: 'Teste Preco' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.precoVenda, 120);
    assert.strictEqual(res.precoCusto, 95);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
