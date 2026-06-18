// ============================================================
//  Notion — lê produtos e grava preço/baseline de volta
//  Campos: Nome, Produto (url), Custo Atual, Custo Referência,
//          Alteração, Alteração de, Status, Data
//  (mesmo schema do userscript LatinoGo)
// ============================================================

import { NOTION_TOKEN, NOTION_DATABASE_IDS } from './config.js';
import { detectarFornecedor } from './scrapers.js';

const NOTION_VERSION = '2022-06-28';
const BASE = 'https://api.notion.com/v1';

function headers(withJson) {
  const h = {
    'Authorization':  `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
  };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

async function notionReq(method, endpoint, body, _attempt = 0) {
  const opts = { method, headers: headers(body != null) };
  if (body != null) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}/${endpoint}`, opts);

  if (res.status === 429 && _attempt < 3) {
    const retry = parseInt(res.headers.get('retry-after') || '5', 10);
    await new Promise(r => setTimeout(r, retry * 1000));
    return notionReq(method, endpoint, body, _attempt + 1);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.object === 'error') {
    throw new Error(`Notion ${res.status}: ${json.message || text || 'erro'}`);
  }
  return json;
}

export async function buscarProdutos() {
  const produtos = [];

  for (const dbId of NOTION_DATABASE_IDS) {
    let cursor;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const json = await notionReq('POST', `databases/${dbId}/query`, body);

      for (const page of json.results || []) {
        const props      = page.properties || {};
        const url        = props['Produto']?.url || '';
        const nome       = props['Nome']?.title?.[0]?.plain_text || '(sem nome)';
        const custoAtual = props['Custo Atual']?.number ?? null;
        const custoRef   = props['Custo Referência']?.number ?? null;
        const status     = props['Status']?.select?.name ?? null;
        const fornecedor = detectarFornecedor(url);

        if (!url || !fornecedor) continue;

        produtos.push({ pageId: page.id, nome, url, custoAtual, custoRef, status, fornecedor, dbId });
      }

      cursor = json.has_more ? json.next_cursor : null;
    } while (cursor);
  }

  return produtos;
}

export async function atualizarProduto(pageId, props) {
  await notionReq('PATCH', `pages/${pageId}`, { properties: props });
}

// Retorna { dbId: 'Nome da database' } para usar no resumo.
export async function buscarNomesDatabases() {
  const nomes = {};
  for (const dbId of NOTION_DATABASE_IDS) {
    try {
      const json = await notionReq('GET', `databases/${dbId}`, null);
      nomes[dbId] = (json.title || []).map(t => t.plain_text).join('').trim() || dbId.slice(0, 8);
    } catch {
      nomes[dbId] = dbId.slice(0, 8);
    }
  }
  return nomes;
}
