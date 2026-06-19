// ============================================================
//  LatinoGG Monitor — ponto de entrada (Playwright)
//  Fluxo: Notion → navegador renderiza cada produto → compara
//  com o Custo Referência → ESCREVE no Notion → acumula alertas
//  → envia tudo em lote no Discord → resumo final.
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { buscarProdutos, atualizarProduto, prepararDatabases } from './notion.js';
import { scrapeProduto } from './scrapers.js';
import { calcPriceChange } from './priceChange.js';
import { enviarLotePrecos, enviarLoteEsgotados, enviarLoteVoltou, enviarResumo, enviarErro, enviarInicio, NOMES } from './discord.js';
import { DELAY_MS, NAV_TIMEOUT_MS, PRICE_THRESHOLD, PRICE_THRESHOLD_HIGH, PRICE_HIGH_LEVEL } from './config.js';

chromium.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (...a) => console.log(new Date().toISOString(), ...a);
const tag   = p => `[${NOMES[p.fornecedor] || p.fornecedor}]`;

async function main() {
  log('=== LatinoGG Monitor (Playwright) iniciado ===');

  const produtos = await buscarProdutos();
  log(`Produtos para monitorar: ${produtos.length}`);
  if (!produtos.length) return;

  const nomesDb = await prepararDatabases();
  const labelDb = id => nomesDb[id] || id.slice(0, 8);

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

  // Acumuladores — Discord só é chamado DEPOIS do loop (em lote)
  const precoAlerts    = [];   // { produto, preco, delta, dbNome }  (subiu OU desceu)
  const esgotadoAlerts = [];   // { produto, dbNome }  (apenas novas transições)
  const restockAlerts  = [];   // { produto, preco, dbNome }  (voltou ao estoque)

  const stats   = {};
  const statsDb = {};
  const novo    = () => ({ ok:0, preco:0, esgotado:0, esgNovo:0, voltou:0, erro:0, bloqueado:0 });
  const bump    = (forn, key) => { (stats[forn]   ??= novo())[key]++; };
  const bumpDb  = (dbId, key) => { (statsDb[dbId] ??= novo())[key]++; };
  const conta   = (p, key)    => { bump(p.fornecedor, key); bumpDb(p.dbId, key); };

  let est = 0, precoAlt = 0, esgotadoTot = 0, esgotadoNovo = 0, voltouCount = 0, erros = 0, bloqueados = 0;

  for (const produto of produtos) {
    try {
      const { price, status, blocked } = await scrapeProduto(page, produto);

      // ── Bloqueado (Cloudflare não liberou) ──
      if (blocked) {
        log('[BLOQUEADO]', tag(produto), produto.nome);
        bloqueados++; conta(produto, 'bloqueado');
        await sleep(DELAY_MS); continue;
      }

      // ── Esgotado: escreve SEMPRE; alerta só na transição ──
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
        await sleep(DELAY_MS); continue;
      }

      // ── Sem preço (falha de leitura) ──
      if (!price || price <= 0) {
        log('[SEM PREÇO]', tag(produto), produto.nome);
        erros++; conta(produto, 'erro');
        await sleep(DELAY_MS); continue;
      }

      // ── Em estoque: escreve SEMPRE, depois decide alerta ──
      const voltou = produto.status === 'Esgotado';   // estava esgotado no Notion → voltou
      const change = calcPriceChange(price, produto.custoRef);

      // Menor preço histórico
      const menor     = (produto.menorPreco == null || price < produto.menorPreco) ? price : produto.menorPreco;
      const novoMenor = produto.menorPreco == null || price < produto.menorPreco;

      const props = {
        'Custo Atual': { number: price },
        'Menor Preço': { number: menor },
        'Data':        { date: { start: new Date().toISOString() } },
        'Status':      { select: { name: status } },
      };
      if (change) Object.assign(props, change.props);
      if (voltou) {
        // ao voltar do esgotado, reseta o baseline pro preço atual
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
        precoAlerts.push({ produto, preco: price, delta: change.delta, dbNome: labelDb(produto.dbId), menor, novoMenor });
        precoAlt++; conta(produto, 'preco');
      } else {
        log('[ok]', tag(produto), produto.nome, `— R$${price.toFixed(2)}`);
        est++; conta(produto, 'ok');
      }

    } catch (e) {
      log('[ERRO]', tag(produto), produto.nome, '—', e.message);
      erros++; conta(produto, 'erro');
    }
    await sleep(DELAY_MS);
  }

  await browser.close();

  // ── Envia os alertas em LOTE (até 10 por mensagem) ──
  try {
    await enviarLotePrecos(precoAlerts);
    await enviarLoteEsgotados(esgotadoAlerts);
    await enviarLoteVoltou(restockAlerts);
  } catch (e) {
    log('Falha ao enviar alertas em lote:', e.message);
  }

  // ── Resumo ──
  const novosPorDb = Object.entries(statsDb)
    .filter(([, s]) => s.esgNovo > 0)
    .map(([id, s]) => `${labelDb(id)}: ${s.esgNovo}`)
    .join(', ');

  const totais =
    `Limite de alerta: R$${PRICE_THRESHOLD} (R$${PRICE_THRESHOLD_HIGH} acima de R$${PRICE_HIGH_LEVEL})\n` +
    `Total verificado: ${produtos.length}\n` +
    `✅ Estáveis: ${est}\n` +
    `📈 Preço alterado: ${precoAlt}\n` +
    `🚫 Esgotados: ${esgotadoTot} (${esgotadoNovo} novos${novosPorDb ? ' — ' + novosPorDb : ''})\n` +
    `🔄 Voltaram ao estoque: ${voltouCount}\n` +
    `⛔ Bloqueados: ${bloqueados}\n` +
    `❌ Erros: ${erros}` +
    (duplicados.length ? `\n⚠️ Duplicados (mesma URL): ${duplicados.length}` : '');

  const porFornecedor = Object.entries(stats).map(([f, s]) =>
    `• ${NOMES[f] || f}: ${s.ok} ok · ${s.preco} alt · ${s.esgotado} esg · ${s.voltou} volt · ${s.bloqueado} bloq · ${s.erro} erro`
  ).join('\n');

  const porDatabase = Object.entries(statsDb).map(([id, s]) =>
    `• ${labelDb(id)}: ${s.ok} ok · ${s.preco} alt · ${s.esgotado} esg · ${s.voltou} volt · ${s.bloqueado} bloq · ${s.erro} erro`
  ).join('\n');

  const blocoDup = duplicados.length
    ? '\n\nDuplicados (limpar no Notion):\n' + duplicados.map(n => `• ${n}`).join('\n')
    : '';

  const resumo = totais + '\n\nPor fornecedor:\n' + porFornecedor + '\n\nPor database:\n' + porDatabase + blocoDup;

  log('================ RESUMO ================');
  resumo.split('\n').forEach(l => log(l));
  log('========================================');

  await enviarResumo(resumo);
}

main().catch(async (e) => {
  console.error(e);
  await enviarErro('Falha geral no monitor: ' + e.message);
  process.exit(1);
});
