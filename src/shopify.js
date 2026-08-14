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

// Busca os detalhes da Variante e InventoryItem para pegar os preços atuais
export async function buscarPrecosShopify(sku) {
  if (!sku || !SHOPIFY_DOMAIN || !SHOPIFY_ACCESS_TOKEN) return null;

  try {
    const query = `
      query getVariantPrice($sku: String!) {
        productVariants(first: 5, query: $sku) {
          edges {
            node {
              id
              sku
              price
              compareAtPrice
              inventoryItem {
                id
                cost
              }
            }
          }
        }
      }
    `;

    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: shopifyHeaders(),
      body: JSON.stringify({ query, variables: { sku: `sku:${sku}` } }),
    });

    if (res.ok) {
      const json = await res.json();
      const edges = json?.data?.productVariants?.edges || [];
      const match = edges.find(e => String(e.node?.sku).trim().toLowerCase() === String(sku).trim().toLowerCase()) || edges[0];
      if (match?.node) {
        return {
          variantId: match.node.id,
          inventoryItemId: match.node.inventoryItem?.id,
          price: parseFloat(match.node.price) || 0,
          compareAtPrice: parseFloat(match.node.compareAtPrice) || null,
          cost: parseFloat(match.node.inventoryItem?.cost) || null,
        };
      }
    }
  } catch (e) {
    log(`Erro ao buscar preços do SKU ${sku}:`, e.message);
  }
  return null;
}

// Atualiza o preço de venda, comparação e custo na Shopify
export async function atualizarPrecosShopify({ sku, precoVenda, precoComparacao, precoCusto, produtoNome }) {
  if (!SHOPIFY_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return { ok: false, motivo: 'Configuração ausente' };
  }
  if (!sku) return { ok: false, motivo: 'Sem SKU' };

  try {
    const dados = await buscarPrecosShopify(sku);
    if (!dados) {
      return { ok: false, motivo: 'SKU não encontrado na Shopify' };
    }

    const { variantId, inventoryItemId } = dados;

    // 1. Atualizar Variant (price, compareAtPrice)
    const variantQuery = `
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          userErrors { field message }
        }
      }
    `;
    const variantInput = { id: variantId, price: String(precoVenda) };
    if (precoComparacao != null) {
      variantInput.compareAtPrice = String(precoComparacao);
    }

    const resVariant = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: shopifyHeaders(),
      body: JSON.stringify({ query: variantQuery, variables: { input: variantInput } }),
    });
    
    let variantOk = false;
    if (resVariant.ok) {
      const json = await resVariant.json();
      const errs = json?.data?.productVariantUpdate?.userErrors || [];
      if (errs.length > 0) {
        log(`[ERRO VARIANT] ${produtoNome}:`, errs.map(e => e.message).join(', '));
      } else {
        variantOk = true;
      }
    }

    // 2. Atualizar InventoryItem (cost)
    let costOk = true;
    if (precoCusto != null && inventoryItemId) {
      const costQuery = `
        mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
          inventoryItemUpdate(id: $id, input: $input) {
            userErrors { field message }
          }
        }
      `;
      const resCost = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: shopifyHeaders(),
        body: JSON.stringify({ 
          query: costQuery, 
          variables: { id: inventoryItemId, input: { cost: String(precoCusto) } } 
        }),
      });
      if (resCost.ok) {
        const json = await resCost.json();
        const errs = json?.data?.inventoryItemUpdate?.userErrors || [];
        if (errs.length > 0) {
          costOk = false;
          log(`[ERRO COST] ${produtoNome}:`, errs.map(e => e.message).join(', '));
        }
      } else {
        costOk = false;
      }
    }

    if (variantOk && costOk) {
      log(`[OK PREÇOS] ${produtoNome || sku} ➔ Venda: R$${precoVenda} | Custo: R$${precoCusto}`);
      return { ok: true, precoVenda, precoComparacao, precoCusto };
    } else {
      return { ok: false, motivo: 'Erro GraphQL ao atualizar preços/custo' };
    }
  } catch (e) {
    log(`Falha ao sincronizar preços ${produtoNome || sku}:`, e.message);
    return { ok: false, motivo: e.message };
  }
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
