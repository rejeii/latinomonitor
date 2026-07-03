// ============================================================
//  LatinoGG Monitor — ponto de entrada (Playwright)
//  Fase 1: raspa todos os produtos (sem escrever).
//  Canário: se um fornecedor vier majoritariamente sem preço,
//           marca como suspeito (scraper quebrado) e SUPRIME
//           escritas e alertas dele.
//  Fase 2: escreve no Notion + acumula alertas (só não-suspeitos).
//  Fim: envia alertas em lote + canário + resumo no Discord.
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { buscarProdutos, atualizarProduto, prepararDatabases, prepararErrorDb, registrarErro } from './notion.js';
import { scrapeProduto } from './scrapers.js';
import { calcPriceChange } from './priceChange.js';
import { enviarLotePrecos, enviarLoteEsgotados, enviarLoteVoltou, enviarResumo, enviarErro, enviarInicio, enviarAvisoCampos, enviarCanario, enviarAvisoUso, enviarRelatorioErros, NOMES } from './discord.js';
import { DELAY_MS, NAV_TIMEOUT_MS, PRICE_THRESHOLD, PRICE_THRESHOLD_HIGH, PRICE_HIGH_LEVEL, CANARY_RATIO, CANARY_MIN, ACTIONS_ALERT_PCT, NOTION_ERROR_DB_ID } from './config.js';
import { checarUsoActions } from './usage.js';

chromium.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(new Date().toISOString(), ...a);
const tag   = p => `[${NOMES[p.fornecedor] || p.fornecedor}]`;

// Histórico de preço diário (compacto) para o menor preço dos últimos 30 dias.
const diaSP = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).replace(/-/g, ''); // YYYYMMDD
};
const parseHist     = s => { const m = {}; (s || '').split(',').forEach(e => { const [d, p] = e.split(':'); if (d && p) m[d] = parseFloat(p); }); return m; };
const serializeHist = m => Object.entries(m).map(([d, p]) => `${d}:${p}`).join(',');

async function main() {
  log('=== LatinoGG Monitor (Playwright) iniciado ===');

  const produtos = await buscarProdutos();
  log(`Produtos para monitorar: ${produtos.length}`);
  if (!produtos.length) return;

  const { nomes: nomesDb, criados } = await prepararDatabases();
  const labelDb = id => nomesDb[id] || id.slice(0, 8);

  // Coleta detalhada de erros do run (vai pro resumo e pra database de erros)
  const errosDetalhe = [];
  const pushErroProduto = (produto, tipo, mensagem, r) => errosDetalhe.push({
    nome:       produto.nome,
    url:        produto.url,
    fornecedor: NOMES[produto.fornecedor] || produto.fornecedor,
    database:   labelDb(produto.dbId),
    tipo, mensagem,
    statusLido: r?.status ?? null,
    precoLido:  (typeof r?.price === 'number') ? r.price : null,
    pageId:     produto.pageId,
  });

  // Avisa se algum campo foi criado automaticamente (tabela nova/crua)
  if (criados.length) {
    for (const c of criados) log('[CAMPOS CRIADOS]', c.db, '→', c.campos.join(', '));
    await enviarAvisoCampos(criados);
  }

  // Detecta produtos duplicados (mesma URL em 2+ linhas do Notion)
  const urlCount = {};
  for (const p of produtos) urlCount[p.url] = (urlCount[p.url] || 0) + 1;
  const duplicados = [...new Set(produtos.filter(p => urlCount[p.url] > 1).map(p => p.nome))];

  // Avisa no Discord que o monitoramento começou (antes de raspar)
  await enviarInicio(`Verificando **${produtos.length}** produtos em ${Object.keys(nomesDb).length} database(s): ${Object.values(nomesDb).join(', ')}.`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale:    'pt-BR',
    viewport:  { width: 1366, height: 768 },
  });
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  const page = await context.newPage();

  // ── FASE 1: raspa tudo (sem escrever) ──
  const resultados = [];
  for (const produto of produtos) {
    try {
      const s = await scrapeProduto(page, produto);  // { price, status, blocked }
      resultados.push({ produto, ...s });
    } catch (e) {
      resultados.push({ produto, erro: e.message });
    }
    await sleep(DELAY_MS);
  }
  await browser.close();

  // ── CANÁRIO: fornecedor majoritariamente sem preço = scraper quebrado ──
  const bruto = {};
  for (const r of resultados) {
    const f = r.produto.fornecedor;
    (bruto[f] ??= { total: 0, ruins: 0 }).total++;
    if (r.erro || !(r.price > 0)) bruto[f].ruins++;   // esgotado/sem-preço/bloqueado/erro
  }
  const suspeitos = new Set();
  const canarios  = [];
  for (const [f, b] of Object.entries(bruto)) {
    const pct = b.total ? b.ruins / b.total : 0;
    if (b.total >= CANARY_MIN && pct >= CANARY_RATIO) {
      suspeitos.add(f);
      canarios.push({ fornecedor: f, total: b.total, ruins: b.ruins, pct });
    }
  }
  for (const c of canarios) {
    const fn = NOMES[c.fornecedor] || c.fornecedor;
    log(`[CANÁRIO] ${fn}: ${c.ruins}/${c.total} sem preço (${Math.round(c.pct * 100)}%) → SUPRIMIDO`);
    errosDetalhe.push({
      nome: `Scraper suspeito — ${fn}`, url: null, fornecedor: fn, database: null,
      tipo: 'Scraper suspeito',
      mensagem: `${c.ruins}/${c.total} produtos sem preço (${Math.round(c.pct * 100)}%) — alertas e escritas suprimidos`,
      statusLido: null, precoLido: null, pageId: null,
    });
  }

  // Acumuladores — Discord só é chamado DEPOIS do processamento (em lote)
  const precoAlerts    = [];
  const esgotadoAlerts = [];
  const restockAlerts  = [];

  const stats   = {};
  const statsDb = {};
  const novo    = () => ({ ok:0, preco:0, esgotado:0, esgNovo:0, voltou:0, erro:0, bloqueado:0 });
  const bump    = (forn, key) => { (stats[forn]   ??= novo())[key]++; };
  const bumpDb  = (dbId, key) => { (statsDb[dbId] ??= novo())[key]++; };
  const conta   = (p, key)    => { bump(p.fornecedor, key); bumpDb(p.dbId, key); };

  let est = 0, precoAlt = 0, esgotadoTot = 0, esgotadoNovo = 0, voltouCount = 0, erros = 0, bloqueados = 0, suprimidos = 0;

  // ── FASE 2: processa (escreve + alerta), pulando fornecedores suspeitos ──
  for (const r of resultados) {
    const { produto } = r;

    // Canário: não escreve nem alerta o fornecedor suspeito (preserva o Notion)
    if (suspeitos.has(produto.fornecedor)) { suprimidos++; continue; }

    try {
      if (r.erro) {
        log('[ERRO]', tag(produto), produto.nome, '—', r.erro);
        erros++; conta(produto, 'erro');
        pushErroProduto(produto, 'Erro', r.erro, r);
        continue;
      }

      const { price, status, blocked } = r;

      // ── Bloqueado (Cloudflare não liberou) ──
      if (blocked) {
        log('[BLOQUEADO]', tag(produto), produto.nome);
        bloqueados++; conta(produto, 'bloqueado');
        pushErroProduto(produto, 'Bloqueado', 'Cloudflare bloqueou a página', r);
        continue;
      }

      // ── Esgotado: escreve; alerta só na transição ──
      if (status === 'Esgotado') {
        esgotadoTot++; conta(produto, 'esgotado');
        await atualizarProduto(produto.pageId, {
          'Status': { select: { name: 'Esgotado' } },
          'Data':   { date: { start: new Date().toISOString() } },
        });
        if (produto.status !== 'Esgotado') {
          log('[ESGOTADO]', tag(produto), produto.nome);
          esgotadoAlerts.push({ produto, dbNome: labelDb(produto.dbId) });
          esgotadoNovo++; conta(produto, 'esgNovo');
        } else {
          log('[esgotado]', tag(produto), produto.nome);
        }
        await sleep(150);
        continue;
      }

      // ── Sem preço (não deve cair aqui — price<=0 só com erro/esgotado) ──
      if (!price || price <= 0) {
        log('[SEM PREÇO]', tag(produto), produto.nome);
        erros++; conta(produto, 'erro');
        pushErroProduto(produto, 'Sem preço', 'Não foi possível ler o preço', r);
        continue;
      }

      // ── Em estoque: escreve, depois decide alerta ──
      const voltou = produto.status === 'Esgotado';
      const change = calcPriceChange(price, produto.custoRef);

      // Menor preço histórico (todo o período)
      const menor     = (produto.menorPreco == null || price < produto.menorPreco) ? price : produto.menorPreco;
      const novoMenor = produto.menorPreco == null || price < produto.menorPreco;

      // Menor preço dos últimos 30 dias (histórico diário, podado a 30 dias)
      const hist = parseHist(produto.hist30);
      const hoje = diaSP(0);
      hist[hoje] = hist[hoje] != null ? Math.min(hist[hoje], price) : price;
      const limite30 = diaSP(30);
      for (const d of Object.keys(hist)) if (d < limite30) delete hist[d];
      const menor30     = Math.min(...Object.values(hist));
      const novoMenor30 = price <= menor30;

      const props = {
        'Custo Atual':   { number: price },
        'Menor Preço':   { number: menor },
        'Histórico 30d': { rich_text: [{ text: { content: serializeHist(hist) } }] },
        'Data':          { date: { start: new Date().toISOString() } },
        'Status':        { select: { name: status } },
      };
      if (change) Object.assign(props, change.props);
      if (voltou) {
        props['Custo Referência'] = { number: price };
        props['Alteração']        = { select: { name: 'Estável' } };
        props['Alteração de']     = { number: 0 };
      }
      await atualizarProduto(produto.pageId, props);

      if (voltou) {
        log('[VOLTOU]', tag(produto), produto.nome, `— R$${price.toFixed(2)}`);
        restockAlerts.push({ produto, preco: price, dbNome: labelDb(produto.dbId) });
        voltouCount++; conta(produto, 'voltou');
      } else if (change?.triggered) {
        const seta = change.delta > 0 ? '▲' : '▼';
        log('[ALERTA ' + seta + ']', tag(produto), produto.nome,
            `— R$${price.toFixed(2)} (ref R$${(produto.custoRef ?? 0).toFixed(2)}, Δ R$${change.delta.toFixed(2)})`);
        precoAlerts.push({ produto, preco: price, delta: change.delta, dbNome: labelDb(produto.dbId), menor, novoMenor, novoMenor30 });
        precoAlt++; conta(produto, 'preco');
      } else {
        log('[ok]', tag(produto), produto.nome, `— R$${price.toFixed(2)}`);
        est++; conta(produto, 'ok');
      }

      await sleep(150);

    } catch (e) {
      log('[ERRO]', tag(produto), produto.nome, '—', e.message);
      erros++; conta(produto, 'erro');
      pushErroProduto(produto, 'Erro', e.message, r);
    }
  }

  // ── Envia os alertas em LOTE (até 10 por mensagem) ──
  try {
    await enviarLotePrecos(precoAlerts);
    await enviarLoteEsgotados(esgotadoAlerts);
    await enviarLoteVoltou(restockAlerts);
    await enviarCanario(canarios);
  } catch (e) {
    log('Falha ao enviar alertas em lote:', e.message);
  }

  // ── Uso de minutos do GitHub Actions (vai no resumo) ──
  let linhaUso = '';
  let usoInfo  = null;
  try {
    usoInfo = await checarUsoActions();
    if (usoInfo && usoInfo.publico) {
      linhaUso = '\n⏱️ Actions: repositório público (ilimitado)';
      log('[USO] repositório público — Actions ilimitado');
    } else if (usoInfo) {
      linhaUso = `\n⏱️ Actions: ~${usoInfo.usado}/${usoInfo.limite} min (${usoInfo.pct}%)`;
      log(`[USO] GitHub Actions ~${usoInfo.usado}/${usoInfo.limite} min (${usoInfo.pct}%)`);
    }
  } catch (e) {
    log('Falha ao checar uso de Actions:', e.message);
  }

  // ── Resumo ──
  const novosPorDb = Object.entries(statsDb)
    .filter(([, s]) => s.esgNovo > 0)
    .map(([id, s]) => `${labelDb(id)}: ${s.esgNovo}`)
    .join(', ');

  const linhaCanario = canarios.length
    ? '\n🐤 Suprimidos (scraper suspeito): ' + suprimidos + ' — ' + canarios.map(c => NOMES[c.fornecedor] || c.fornecedor).join(', ')
    : '';

  const totais =
    `Limite de alerta: R$${PRICE_THRESHOLD} (R$${PRICE_THRESHOLD_HIGH} acima de R$${PRICE_HIGH_LEVEL})\n` +
    `Total verificado: ${produtos.length}\n` +
    `✅ Estáveis: ${est}\n` +
    `📈 Preço alterado: ${precoAlt}\n` +
    `🚫 Esgotados: ${esgotadoTot} (${esgotadoNovo} novos${novosPorDb ? ' — ' + novosPorDb : ''})\n` +
    `🔄 Voltaram ao estoque: ${voltouCount}\n` +
    `⛔ Bloqueados: ${bloqueados}\n` +
    `❌ Erros: ${erros}` +
    (duplicados.length ? `\n⚠️ Duplicados (mesma URL): ${duplicados.length}` : '') +
    linhaCanario +
    linhaUso;

  const porFornecedor = Object.entries(stats).map(([f, s]) =>
    `• ${NOMES[f] || f}: ${s.ok} ok · ${s.preco} alt · ${s.esgotado} esg · ${s.voltou} volt · ${s.bloqueado} bloq · ${s.erro} erro`
  ).join('\n');

  const porDatabase = Object.entries(statsDb).map(([id, s]) =>
    `• ${labelDb(id)}: ${s.ok} ok · ${s.preco} alt · ${s.esgotado} esg · ${s.voltou} volt · ${s.bloqueado} bloq · ${s.erro} erro`
  ).join('\n');

  const blocoDup = duplicados.length
    ? '\n\nDuplicados (limpar no Notion):\n' + duplicados.map(n => `• ${n}`).join('\n')
    : '';

  const blocoErros = errosDetalhe.length
    ? `\n\nErros (${errosDetalhe.length}${NOTION_ERROR_DB_ID ? ' — detalhes na database de erros' : ''}):\n` +
      errosDetalhe.slice(0, 10).map(e => `• [${e.tipo}] ${e.nome}`).join('\n') +
      (errosDetalhe.length > 10 ? `\n• …e mais ${errosDetalhe.length - 10}` : '')
    : '';

  const resumo = totais + '\n\nPor fornecedor:\n' + porFornecedor + '\n\nPor database:\n' + porDatabase + blocoDup + blocoErros;

  log('================ RESUMO ================');
  resumo.split('\n').forEach(l => log(l));
  log('========================================');

  await enviarResumo(resumo);

  // Relatório de erros no canal dedicado (se houver)
  await enviarRelatorioErros(errosDetalhe);

  // Aviso mais visível (embed separado) se passar do limite
  if (usoInfo && !usoInfo.publico && usoInfo.pct >= ACTIONS_ALERT_PCT) {
    await enviarAvisoUso(usoInfo);
  }

  // ── Database de erros no Notion (prepara/verifica sempre; grava se houver erro) ──
  if (NOTION_ERROR_DB_ID) {
    const runUrl = (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
    try {
      const prep = await prepararErrorDb(NOTION_ERROR_DB_ID);
      if (!prep.ok) {
        log('[ERRO DB] sem acesso à database de erros (compartilhou com a integração?):', prep.erro || '');
      } else {
        if (prep.criados?.length) log('[ERRO DB] campos criados:', prep.criados.join(', '));
        if (errosDetalhe.length) {
          for (const e of errosDetalhe) {
            try { await registrarErro(NOTION_ERROR_DB_ID, prep.tituloProp, { ...e, runUrl }); }
            catch (err) { log('[ERRO DB] falha numa linha:', err.message); }
            await sleep(200);
          }
          log(`[ERRO DB] ${errosDetalhe.length} erro(s) registrado(s) no Notion`);
        } else {
          log('[ERRO DB] database acessível, 0 erros neste run');
        }
      }
    } catch (e) {
      log('[ERRO DB] falha geral:', e.message);
    }
  }
}

main().catch(async (e) => {
  console.error(e);
  await enviarErro('Falha geral no monitor: ' + e.message);
  process.exit(1);
});
