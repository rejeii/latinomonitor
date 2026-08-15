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
  // Gateway/proxy pode devolver HTML de erro (502 etc.) em vez de JSON
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Notion ${res.status}: resposta não-JSON — ${text.slice(0, 120).trim() || '(vazia)'}`);
  }
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
        const precoAlvo  = props['Preço Alvo']?.number ?? null;
        const pausado    = props['Pausado']?.checkbox === true;
        const alvoAtingido = props['Alvo Atingido']?.checkbox === true;
        const precoVenda = props['Preço Venda']?.number ?? null;
        const precoComparacao = props['Preço Comparação']?.number ?? null;
        const ignorarMargem = props['Ignorar Margem']?.checkbox === true || props['Ignorar margem']?.checkbox === true;
        const fornecedor = detectarFornecedor(url);

        const codigo     = props['Código']?.rich_text?.[0]?.plain_text ||
                           (props['Código']?.number != null ? String(props['Código'].number) : null) ||
                           props['Codigo']?.rich_text?.[0]?.plain_text ||
                           (props['Codigo']?.number != null ? String(props['Codigo'].number) : null) ||
                           props['SKU']?.rich_text?.[0]?.plain_text ||
                           (props['SKU']?.number != null ? String(props['SKU'].number) : null) ||
                           null;

        if (!url || !fornecedor) continue;

        produtos.push({ pageId: page.id, nome, url, codigo, custoAtual, custoRef, menorPreco, hist30, status, precoAlvo, pausado, alvoAtingido, fornecedor, dbId, precoVenda, precoComparacao, ignorarMargem });
      }



      cursor = json.has_more ? json.next_cursor : null;
    } while (cursor);
  }

  return produtos;
}

export async function atualizarProduto(pageId, props) {
  await notionReq('PATCH', `pages/${pageId}`, { properties: props });
}

// Campos que o monitor usa. Criados automaticamente se faltarem.
// (O campo 'Produto' (url) NÃO entra aqui: é a entrada que você preenche.)
// 'Preço Alvo' e 'Pausado' também são entrada sua, mas são criados aqui
// por conveniência — você só marca/preenche quando quiser usar.
const SCHEMA_MONITOR = {
  'Custo Atual':      { number: { format: 'real' } },
  'Custo Referência': { number: { format: 'real' } },
  'Menor Preço':      { number: { format: 'real' } },
  'Histórico 30d':    { rich_text: {} },
  'Alteração':        { select: {} },
  'Alteração de':     { number: { format: 'real' } },
  'Status':           { select: {} },
  'Data':             { date: {} },
  'Preço Alvo':       { number: { format: 'real' } },
  'Pausado':          { checkbox: {} },
  'Alvo Atingido':    { checkbox: {} },
  'Preço Venda':      { number: { format: 'real' } },
  'Preço Comparação': { number: { format: 'real' } },
  'Ignorar Margem':   { checkbox: {} },
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

// ── Database de erros ──────────────────────────────────────
// Campos criados automaticamente se faltarem (fora o título, que já existe).
const ERROR_SCHEMA = {
  'URL':         { url: {} },
  'Fornecedor':  { select: {} },
  'Database':    { rich_text: {} },
  'Tipo':        { select: {} },
  'Mensagem':    { rich_text: {} },
  'Status lido': { rich_text: {} },
  'Preço lido':  { number: { format: 'real' } },
  'Data':        { date: {} },
  'Run':         { url: {} },
  'Page ID':     { rich_text: {} },
};

// Garante o schema da database de erros. Retorna { ok, tituloProp, criados }.
export async function prepararErrorDb(dbId) {
  if (!dbId) return { ok: false, erro: 'sem NOTION_ERROR_DB_ID' };
  try {
    const json  = await notionReq('GET', `databases/${dbId}`, null);
    const props = json.properties || {};
    const tituloProp = Object.entries(props).find(([, p]) => p.type === 'title')?.[0] || 'Name';

    const existentes = Object.keys(props);
    const criar = {};
    for (const [campo, schema] of Object.entries(ERROR_SCHEMA)) {
      if (!existentes.includes(campo)) criar[campo] = schema;
    }
    const criados = Object.keys(criar);
    if (criados.length) await notionReq('PATCH', `databases/${dbId}`, { properties: criar });
    return { ok: true, tituloProp, criados };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// Cria uma linha na database de erros.
export async function registrarErro(dbId, tituloProp, d) {
  const txt = s => [{ text: { content: String(s).slice(0, 2000) } }];
  const props = {
    [tituloProp]: { title: txt(d.nome || '(sem nome)') },
    'Tipo':       { select: { name: d.tipo || 'Erro' } },
    'Data':       { date: { start: new Date().toISOString() } },
  };
  if (d.url)                            props['URL']         = { url: d.url };
  if (d.fornecedor)                     props['Fornecedor']  = { select: { name: d.fornecedor } };
  if (d.database)                       props['Database']    = { rich_text: txt(d.database) };
  if (d.mensagem)                       props['Mensagem']    = { rich_text: txt(d.mensagem) };
  if (d.statusLido)                     props['Status lido'] = { rich_text: txt(d.statusLido) };
  if (typeof d.precoLido === 'number')  props['Preço lido']  = { number: d.precoLido };
  if (d.runUrl)                         props['Run']         = { url: d.runUrl };
  if (d.pageId)                         props['Page ID']     = { rich_text: txt(d.pageId) };

  await notionReq('POST', 'pages', { parent: { database_id: dbId }, properties: props });
}
