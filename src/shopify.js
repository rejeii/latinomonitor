// ============================================================
//  Shopify — Sincronização automática de níveis de estoque
// ============================================================

import { SHOPIFY_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_LOCATION_ID } from './config.js';

const log = (...a) => console.log(new Date().toISOString(), '[SHOPIFY]', ...a);

function shopifyHeaders() {
  return {
    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    'Content-Type':           'application/json',
  };
}

// Busca o inventory_item_id de uma variante na Shopify pelo SKU
export async function buscarInventoryItemId(sku) {
  if (!sku || !SHOPIFY_DOMAIN || !SHOPIFY_ACCESS_TOKEN) return null;

  try {
    // Tenta via GraphQL Admin API (mais rápido e preciso por busca exata de SKU)
    const query = `
      query getInventoryItem($sku: String!) {
        inventoryItems(first: 5, query: $sku) {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
    `;

    const resGraph = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: shopifyHeaders(),
      body: JSON.stringify({ query, variables: { sku: `sku:${sku}` } }),
    });

    if (resGraph.ok) {
      const jsonGraph = await resGraph.json();
      const edges = jsonGraph?.data?.inventoryItems?.edges || [];
      const match = edges.find(e => String(e.node?.sku).trim().toLowerCase() === String(sku).trim().toLowerCase()) || edges[0];
      if (match?.node?.id) {
        const numericId = match.node.id.split('/').pop();
        return numericId;
      }
    }

    // Fallback via REST API (variants.json)
    const resRest = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/variants.json?fields=id,sku,inventory_item_id`, {
      method: 'GET',
      headers: shopifyHeaders(),
    });

    if (resRest.ok) {
      const jsonRest = await resRest.json();
      const variant = (jsonRest.variants || []).find(v => String(v.sku).trim().toLowerCase() === String(sku).trim().toLowerCase());
      if (variant?.inventory_item_id) {
        return String(variant.inventory_item_id);
      }
    }
  } catch (e) {
    log(`Erro ao buscar SKU ${sku}:`, e.message);
  }

  return null;
}

// Define o estoque na Shopify (available = quantidade) para um determinado SKU
export async function atualizarEstoqueShopify({ sku, quantidade, produtoNome }) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_LOCATION_ID) {
    log('Configuração da Shopify ausente, ignorando sincronização');
    return { ok: false, motivo: 'Configuração ausente' };
  }

  if (!sku) {
    log(`[${produtoNome || 'Produto'}] sem SKU/Código para sincronizar com a Shopify`);
    return { ok: false, motivo: 'Sem SKU' };
  }

  try {
    const inventoryItemId = await buscarInventoryItemId(sku);
    if (!inventoryItemId) {
      log(`[${produtoNome || sku}] SKU "${sku}" não encontrado na Shopify`);
      return { ok: false, motivo: 'SKU não encontrado na Shopify' };
    }

    const body = {
      location_id:       Number(SHOPIFY_LOCATION_ID),
      inventory_item_id: Number(inventoryItemId),
      available:         Number(quantidade),
    };

    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/inventory_levels/set.json`, {
      method:  'POST',
      headers: shopifyHeaders(),
      body:    JSON.stringify(body),
    });

    if (res.ok) {
      log(`[OK] ${produtoNome || sku} (SKU: ${sku}) ➔ Estoque alterado para ${quantidade} na Shopify`);
      return { ok: true, inventoryItemId, quantidade };
    } else {
      const errText = await res.text().catch(() => '');
      log(`[ERRO ${res.status}] ${produtoNome || sku}:`, errText);
      return { ok: false, motivo: `Shopify HTTP ${res.status}` };
    }
  } catch (e) {
    log(`Falha ao sincronizar ${produtoNome || sku}:`, e.message);
    return { ok: false, motivo: e.message };
  }
}
