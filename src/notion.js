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
        const menorPreco = props['Menor Preço']?.number ?? null;
        const hist30     = props['Histórico 30d']?.rich_text?.[0]?.plain_text || '';
        const status     = props['Status']?.select?.name ?? null;
        const fornecedor = detectarFornecedor(url);

        if (!url || !fornecedor) continue;

        produtos.push({ pageId: page.id, nome, url, custoAtual, custoRef, menorPreco, hist30, status, fornecedor, dbId });
      }

      cursor = json.has_more ? json.next_cursor : null;
    } while (cursor);
  }

  return produtos;
}

export async function atualizarProduto(pageId, props) {
  await notionReq('PATCH', `pages/${pageId}`, { properties: props });
}

// Todos os campos que o monitor escreve. Criados automaticamente se faltarem.
// (O campo 'Produto' (url) NÃO entra aqui: é a entrada que você preenche.)
const SCHEMA_MONITOR = {
  'Custo Atual':      { number: { format: 'real' } },
  'Custo Referência': { number: { format: 'real' } },
  'Menor Preço':      { number: { format: 'real' } },
  'Histórico 30d':    { rich_text: {} },
  'Alteração':        { select: {} },
  'Alteração de':     { number: { format: 'real' } },
  'Status':           { select: {} },
  'Data':             { date: {} },
};

// Pega o nome de cada database E garante que TODOS os campos do monitor existam
// (cria os que faltarem). Retorna { nomes, criados } onde criados informa o que
// foi criado por database (pra avisar no log e no Discord).
export async function prepararDatabases() {
  const nomes   = {};
  const criados = [];   // [{ db, campos: [...] }]

  for (const dbId of NOTION_DATABASE_IDS) {
    try {
      const json = await notionReq('GET', `databases/${dbId}`, null);
      const nome = (json.title || []).map(t => t.plain_text).join('').trim() || dbId.slice(0, 8);
      nomes[dbId] = nome;

      const existentes = Object.keys(json.properties || {});
      const novos = {};
      for (const [campo, schema] of Object.entries(SCHEMA_MONITOR)) {
        if (!existentes.includes(campo)) novos[campo] = schema;
      }
      if (Object.keys(novos).length) {
        await notionReq('PATCH', `databases/${dbId}`, { properties: novos });
        criados.push({ db: nome, campos: Object.keys(novos) });
      }
    } catch {
      nomes[dbId] = dbId.slice(0, 8);
    }
  }

  return { nomes, criados };
}
