// ============================================================
//  LatinoGG Monitor — ponto de entrada (Playwright)
//  Fase 1: raspa todos os produtos (sem escrever).
//  Canário: se um fornecedor vier majoritariamente sem preço,
//           marca como suspeito (scraper quebrado) e SUPRIME
//           escritas e alertas dele.
//  Fase 2: escreve no Notion + acumula alertas (só não-suspeitos).
//  Fim: envia alertas em lote + canário + resumo no Discord.
// ============================================================

import { mkdir } from 'node:fs/promises';
import { criarNavegador } from './browser.js';
import { buscarProdutos, atualizarProduto, prepararDatabases, prepararErrorDb, registrarErro } from './notion.js';
import { scrapeProduto, resultadoRuim } from './scrapers.js';
import { calcPriceChange, calcAlvo } from './priceChange.js';
import { diaSP, parseHist, serializeHist } from './history.js';
import { enviarLotePrecos, enviarLoteAlvos, enviarLoteEsgotados, enviarLoteVoltou, enviarResumo, enviarErro, enviarInicio, enviarAvisoCampos, enviarCanario, enviarAvisoUso, enviarRelatorioErros, extrairCodigo, NOMES } from './discord.js';
import { DELAY_MS, NAV_TIMEOUT_MS, SCRAPE_CONCURRENCY, RETRY_COOLDOWN_MS, PRICE_THRESHOLD, PRICE_THRESHOLD_HIGH, PRICE_HIGH_LEVEL, CANARY_RATIO, CANARY_MIN, ACTIONS_ALERT_PCT, NOTION_ERROR_DB_ID } from './config.js';
import { checarUsoActions } from './usage.js';
import { atualizarEstoqueShopify } from './shopify.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const log   = (...a) => console.log(new Date().toISOString(), ...a);
const tag   = p => `[${NOMES[p.fornecedor] || p.fornecedor}]`;

// Teto de abas por fornecedor (sobrepõe SCRAPE_CONCURRENCY). Collections usa 1 aba;
// VisãoVip usa 5 abas em paralelo (aproveita o processador Ryzen 7 5700X e 48GB RAM para velocidade máxima).
const MAX_ABAS_FORNECEDOR = { atacadocollections: 1, visaovip: 5 };


// Falhas SEGUIDAS no retry que indicam site fora do ar → desiste do resto
// (o canário suprime as escritas do fornecedor caído; nada se perde).
// Sem isso, um site 100% fora faz o retry sequencial estourar o limite
// de 60min do job (204 URLs × deadline ≈ 80min só de revisita).
const RETRY_BAILOUT = 8;

// Máximo de screenshots de debug por fornecedor — com o site caído,
// centenas de fotos idênticas só inflam o artifact e o tempo do run.
const MAX_SHOTS_FORNECEDOR = 3;


async function main() {
  log('=== LatinoGG Monitor (Playwright) iniciado ===');

  const todos    = await buscarProdutos();
  const pausados = todos.filter(p => p.pausado);
  const produtos = todos.filter(p => !p.pausado);
  log(`Produtos para monitorar: ${produtos.length}` + (pausados.length ? ` (⏸️ ${pausados.length} pausados)` : ''));
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

  const { browser, context } = await criarNavegador({ navTimeoutMs: NAV_TIMEOUT_MS });

  // ── FASE 1: raspa tudo (sem escrever) ──
  // Agrupa por URL: linhas duplicadas no Notion reaproveitam o mesmo scrape.
  const porUrl = new Map();   // url -> [produtos]
  for (const p of produtos) {
    const g = porUrl.get(p.url);
    if (g) g.push(p); else porUrl.set(p.url, [p]);
  }
  if (porUrl.size < produtos.length) {
    log(`URLs únicas: ${porUrl.size} (${produtos.length - porUrl.size} linha(s) duplicada(s) reaproveitam o scrape)`);
  }

  // Fila por fornecedor: fornecedores rodam em PARALELO entre si, e cada
  // fornecedor abre até SCRAPE_CONCURRENCY abas consumindo a própria fila
  // (o DELAY_MS vale por aba — a taxa por site cresce com o nº de abas).
  const filas = new Map();   // fornecedor -> [{ url, grupo }]
  for (const [url, grupo] of porUrl) {
    const f = grupo[0].fornecedor;
    if (!filas.has(f)) filas.set(f, []);
    filas.get(f).push({ url, grupo });
  }

  const resultadoUrl = new Map();   // url -> resultado
  let retryFalhas = 0, retryRecuperados = 0, debugShots = 0;

  const rasparFila = async (fornecedor, fila) => {
    const raspar = (page) => async (produto) => {
      try {
        return await scrapeProduto(page, produto);   // { price, status, blocked }
      } catch (e) {
        return { erro: e.message };
      }
    };

    // Abas do fornecedor consumindo a mesma fila até esvaziar
    const pendentes = [...fila];
    let concluidos = 0;
    const abrirAba = async () => {
      const page   = await context.newPage();
      const scrape = raspar(page);
      let item;
      while ((item = pendentes.shift())) {
        const prod = item.grupo[0];
        const r    = await scrape(prod);
        resultadoUrl.set(item.url, r);
        concluidos++;
        const info = (r.price > 0) ? `R$${r.price.toFixed(2)}` : (r.blocked ? 'Bloqueado' : r.status || 'sem preço');
        log(`[${concluidos}/${fila.length}]`, tag(prod), prod.nome, `— ${info}`);
        await sleep(DELAY_MS);
      }
      return page;
    };

    const nAbas = Math.min(MAX_ABAS_FORNECEDOR[fornecedor] ?? SCRAPE_CONCURRENCY, fila.length);
    const pages = await Promise.all(Array.from({ length: nAbas }, abrirAba));

    // ── RETRY: segunda tentativa só para quem falhou (erro/bloqueio/sem preço).
    // Espera RETRY_COOLDOWN_MS antes: rate-limit do fornecedor e desafio da
    // Cloudflare precisam de tempo — revisitar na hora bate na mesma parede.
    // Quem continuar falhando ganha um screenshot em debug/ (artifact do run).
    const page   = pages[0];
    const scrape = raspar(page);
    const falhas = fila.filter(({ url }) => resultadoRuim(resultadoUrl.get(url)));
    if (falhas.length) {
      retryFalhas += falhas.length;
      let recuperadas = 0;
      let seguidas = 0;
      let shotsFornecedor = 0;
      log(`[RETRY] ${NOMES[fornecedor] || fornecedor}: ${falhas.length} URL(s) falharam na 1ª tentativa — aguardando ${Math.round(RETRY_COOLDOWN_MS / 1000)}s antes de tentar de novo`);
      await sleep(RETRY_COOLDOWN_MS);
      for (let i = 0; i < falhas.length; i++) {
        if (seguidas >= RETRY_BAILOUT) {
          log(`[RETRY] ${NOMES[fornecedor] || fornecedor}: ${RETRY_BAILOUT} falhas seguidas — site deve estar fora do ar, desistindo das ${falhas.length - i} restantes`);
          break;
        }
        const { url, grupo } = falhas[i];
        const produto = grupo[0];
        await sleep(DELAY_MS);
        const novo = await scrape(produto);
        if (!resultadoRuim(novo)) {
          log('[RETRY OK]', tag(produto), produto.nome);
          resultadoUrl.set(url, novo);
          recuperadas++;
          seguidas = 0;
        } else if (shotsFornecedor >= MAX_SHOTS_FORNECEDOR) {
          log('[RETRY FALHOU]', tag(produto), produto.nome);
          seguidas++;
        } else {
          // A page ainda está na URL que falhou — fotografa pra diagnóstico
          try {
            await mkdir('debug', { recursive: true });
            const arq = `debug/${String(++debugShots).padStart(2, '0')}-${produto.fornecedor}-${produto.nome.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`;
            await page.screenshot({ path: arq });
            shotsFornecedor++;
            log('[RETRY FALHOU]', tag(produto), produto.nome, `— screenshot: ${arq}`);
          } catch (e) {
            log('[RETRY FALHOU]', tag(produto), produto.nome, `— screenshot falhou: ${e.message}`);
          }
          seguidas++;
        }
      }
      retryRecuperados += recuperadas;
      log(`[RETRY] ${NOMES[fornecedor] || fornecedor}: recuperadas ${recuperadas}/${falhas.length}`);
    }

    for (const p of pages) await p.close();
  };

  log(`Scrape em paralelo: ${filas.size} fornecedor(es), até ${SCRAPE_CONCURRENCY} aba(s) cada`);
  await Promise.all([...filas].map(([f, fila]) => rasparFila(f, fila)));

  // Espalha o resultado de cada URL para todas as linhas que a usam
  const resultados = [];
  for (const [url, grupo] of porUrl) {
    const r = resultadoUrl.get(url);
    for (const produto of grupo) resultados.push({ produto, ...r });
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
  const alvoAlerts     = [];
  const esgotadoAlerts = [];
  const restockAlerts  = [];

  const stats   = {};
  const statsDb = {};
  const novo    = () => ({ ok:0, preco:0, esgotado:0, esgNovo:0, voltou:0, erro:0, bloqueado:0 });
  const bump    = (forn, key) => { (stats[forn]   ??= novo())[key]++; };
  const bumpDb  = (dbId, key) => { (statsDb[dbId] ??= novo())[key]++; };
  const conta   = (p, key)    => { bump(p.fornecedor, key); bumpDb(p.dbId, key); };

  let est = 0, precoAlt = 0, alvoCount = 0, esgotadoTot = 0, esgotadoNovo = 0, voltouCount = 0, erros = 0, bloqueados = 0, suprimidos = 0;
  let shopifyEsgotados = 0, shopifyVoltou = 0, shopifyErros = 0;

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

      // ── Bloqueado (Cloudflare não liberou / fornecedor limitou o ritmo) ──
      if (blocked) {
        const motivo = r.rateLimited
          ? 'Fornecedor limitou o ritmo (requisições fora do normal)'
          : 'Cloudflare bloqueou a página';
        log('[BLOQUEADO]', tag(produto), produto.nome, r.rateLimited ? '— rate-limit do site' : '— Cloudflare');
        bloqueados++; conta(produto, 'bloqueado');
        pushErroProduto(produto, 'Bloqueado', motivo, r);
        continue;
      }

      // ── Esgotado: escreve; alerta e sincroniza Shopify só na transição ──
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

          // Sincroniza estoque na Shopify (Quantidade ➔ 0)
          const cod = produto.codigo || extrairCodigo(produto.url);
          const sh = await atualizarEstoqueShopify({ sku: cod, quantidade: 0, produtoNome: produto.nome });
          if (sh.ok) shopifyEsgotados++; else shopifyErros++;
        } else {
          log('[esgotado]', tag(produto), produto.nome);
        }
        await sleep(150);
        continue;
      }

      // ── Sem preço (404 do site, página quebrada, ou só preço em U$) ──
      if (!price || price <= 0) {
        const tipo = r.notFound ? 'Página 404' : r.usdOnly ? 'Preço só em U$' : 'Sem preço';
        const msg  = r.notFound
          ? 'Produto não carregou (página 404 do site — URL removida; auto-pausado no Notion)'
          : r.usdOnly
            ? 'Página carregou só o preço em dólar (a conversão pra R$ não veio)'
            : 'Não foi possível ler o preço';
        log(r.notFound ? '[404 AUTO-PAUSADO]' : r.usdOnly ? '[SÓ U$]' : '[SEM PREÇO]', tag(produto), produto.nome);
        if (r.notFound) {
          await atualizarProduto(produto.pageId, {
            'Pausado': { checkbox: true },
            'Data':    { date: { start: new Date().toISOString() } },
          }).catch(() => {});
        }
        erros++; conta(produto, 'erro');
        pushErroProduto(produto, tipo, msg, r);
        continue;
      }


      // ── Em estoque: escreve, depois decide alerta e sincroniza Shopify se voltou ──
      const voltou = produto.status === 'Esgotado';
      const change = calcPriceChange(price, produto.custoRef);
      const alvo   = calcAlvo(price, produto.precoAlvo, produto.alvoAtingido);

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
        'Alvo Atingido': { checkbox: alvo.atingido },  // false rearma o alerta de alvo
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

        // Sincroniza estoque na Shopify (Quantidade ➔ 100)
        const cod = produto.codigo || extrairCodigo(produto.url);
        const sh = await atualizarEstoqueShopify({ sku: cod, quantidade: 100, produtoNome: produto.nome });
        if (sh.ok) shopifyVoltou++; else shopifyErros++;
      } else if (change?.triggered) {
        const seta = change.delta > 0 ? '▲' : '▼';
        log('[ALERTA ' + seta + ']', tag(produto), produto.nome,
            `— R$${price.toFixed(2)} (ref R$${(produto.custoRef ?? 0).toFixed(2)}, Δ R$${change.delta.toFixed(2)})`);
        const histValores = Object.keys(hist).sort().map(d => hist[d]);   // série p/ o sparkline
        precoAlerts.push({ produto, preco: price, delta: change.delta, dbNome: labelDb(produto.dbId), menor, novoMenor, novoMenor30, histValores });
        precoAlt++; conta(produto, 'preco');
      } else {
        log('[ok]', tag(produto), produto.nome, `— R$${price.toFixed(2)}`);
        est++; conta(produto, 'ok');
      }


      // Alvo é independente do alerta de variação (os dois podem disparar juntos)
      if (alvo.alertar) {
        log('[ALVO 🎯]', tag(produto), produto.nome,
            `— R$${price.toFixed(2)} ≤ alvo R$${produto.precoAlvo.toFixed(2)}`);
        alvoAlerts.push({ produto, preco: price, dbNome: labelDb(produto.dbId) });
        alvoCount++;
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
    await enviarLoteAlvos(alvoAlerts);
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

  const totalShopify = shopifyEsgotados + shopifyVoltou;
  const linhaShopify = (totalShopify > 0 || shopifyErros > 0)
    ? `\n🛍️ Shopify: ${totalShopify} produto(s) sincronizado(s) (${shopifyEsgotados} esgotado(s) ➔ 0, ${shopifyVoltou} restabelecido(s) ➔ 100)` + (shopifyErros ? ` · ⚠️ ${shopifyErros} falha(s)` : '')
    : '';

  const totais =
    `Limite de alerta: R$${PRICE_THRESHOLD} (R$${PRICE_THRESHOLD_HIGH} acima de R$${PRICE_HIGH_LEVEL})\n` +
    `Total verificado: ${produtos.length}\n` +
    `✅ Estáveis: ${est}\n` +
    `📈 Preço alterado: ${precoAlt}\n` +
    `🎯 Alvo atingido: ${alvoCount}\n` +
    `🚫 Esgotados: ${esgotadoTot} (${esgotadoNovo} novos${novosPorDb ? ' — ' + novosPorDb : ''})\n` +
    `🔄 Voltaram ao estoque: ${voltouCount}\n` +
    `⛔ Bloqueados: ${bloqueados}\n` +
    `❌ Erros: ${erros}` +
    linhaShopify +
    (retryFalhas ? `\n🔁 Retry: ${retryFalhas} falha(s) na 1ª tentativa, ${retryRecuperados} recuperada(s)` : '') +
    (debugShots ? `\n📸 Screenshots de debug: ${debugShots} (artifact do run no GitHub)` : '') +
    (pausados.length ? `\n⏸️ Pausados: ${pausados.length}` : '') +
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
