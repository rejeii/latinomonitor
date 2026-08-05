// ============================================================
//  Scrapers — Playwright (navegador real, lê o DOM renderizado)
//  Seletores portados do userscript LatinoGo.user.js.
//  O preço é lido JÁ EM R$ do DOM — não usa cotação.
// ============================================================

// Lidos direto do env (não via config.js): este módulo também roda no
// test-produto.js, sem NOTION_TOKEN — e o config.js exige o token ao carregar.
const READY_TIMEOUT_MS  = Number(process.env.READY_TIMEOUT_MS  || 20000); // espera o seletor de "página pronta"
const PRICE_DEADLINE_MS = Number(process.env.PRICE_DEADLINE_MS || 22000); // polling do preço (Cloudflare se auto-resolve)
const USD_EXTRA_MS      = Number(process.env.USD_EXTRA_MS      || 15000); // espera extra quando a página está viva mas só com U$

export function detectarFornecedor(url) {
  if (!url) return null;
  if (url.includes('visaovip.com'))           return 'visaovip';
  if (url.includes('atacadoconnect.com'))     return 'atacadoconnect';
  if (url.includes('atacadocollections.com')) return 'atacadocollections';
  return null;
}

// Seletor que indica que a página do produto terminou de renderizar.
// VisãoVip: o 2º seletor casa com a página de erro/404 da SPA ("NÃO
// ENCONTRADO") — libera a espera na hora quando o site está fora do ar,
// em vez de queimar READY_TIMEOUT_MS inteiro em cada URL morta.
const READY_SEL = {
  visaovip:           'h2.mt-1.text-2xl.font-bold, h2.font-sora',
  atacadoconnect:     'h1.font-archivo.font-bold',
  atacadocollections: 'header.product-header h1',
};

// ── Função executada DENTRO da página (contexto do navegador) ──
// Precisa ser autocontida: nada de imports aqui dentro.
// Retorna { price, status, blocked, rateLimited, usdOnly }.
// Exportada só para os testes (roda via page.evaluate em produção).
export function scrapeInPage(fornecedor) {
  const extractPrice = (text) => {
    if (!text) return 0;
    const m = String(text).match(/R\$\s*([\d.,]+)/);
    if (!m) return 0;
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0;
  };

  const bodyText = (document.body && document.body.innerText) || '';
  const sample = ((document.title || '') + ' ' + bodyText.slice(0, 300));

  // Rate-limit do próprio fornecedor (Collections): página estática de
  // "requisições fora do normal" — não se resolve sozinha, só revisitando.
  const rateLimited = /requisições fora do normal/i.test(sample);

  // Desafio da Cloudflare — inclui a variante em português ("Executando
  // verificação de segurança") e a Turnstile ("Verify you are human"),
  // que apareciam como "Sem preço" por escapar do padrão antigo.
  const blocked = rateLimited ||
    /just a moment|attention required|verify(ing)? you are human|verificação de segurança|cloudflare/i.test(sample);

  let price = 0;
  let status = 'Em estoque';
  let usdOnly = false;
  let notFound = false;

  if (fornecedor === 'visaovip') {
    const el = document.querySelector('.border-round-2xl .text-vip:not(.font-medium)');
    price = extractPrice(el?.innerText || '');
    const esgotadoEl = document.querySelector('.error-border');
    status = price > 0 ? 'Em estoque' : (esgotadoEl ? 'Esgotado' : 'Em estoque');
    // Página 404 da SPA ("NÃO ENCONTRADO") — o site rende o shell mas o
    // produto não carrega (instabilidade/queda). Some quando o site volta.
    notFound = !(price > 0) && /não encontrado/i.test(sample);
    // Página renderizou mas só com o preço em U$ (a conversão pra R$ não
    // carregou — instabilidade do site). Não convertemos por conta própria:
    // a cotação exibida é arredondada e alimentaria o baseline com um valor
    // que o site nunca mostrou. Fica como falha transitória com tipo próprio.
    usdOnly = !(price > 0) && !blocked && /U\$\s*[\d.,]+/.test(bodyText);

  } else if (fornecedor === 'atacadoconnect') {
    // [class*="priceValue"] sobrevive à mudança do hash do CSS module
    const el = [...document.querySelectorAll('[class*="priceValue"]')]
      .find(e => e.innerText.includes('R$'));
    price = extractPrice(el?.innerText || '');
    const indisponivel = [...document.querySelectorAll('.bg-gray-bg span')]
      .some(e => e.innerText?.trim().toLowerCase() === 'indisponível');
    status = price > 0 ? 'Em estoque' : (indisponivel ? 'Esgotado' : 'Em estoque');

  } else if (fornecedor === 'atacadocollections') {
    const priceEl = [...document.querySelectorAll('div.price')]
      .find(d => d.querySelector('span.is-circle-br'))
      ?.querySelector('p.title');
    price = extractPrice(priceEl?.innerText?.trim() || '');
    const indisponivel = !!document.querySelector('span.mtag-indisponivel');
    status = price > 0 ? 'Em estoque' : (indisponivel ? 'Esgotado' : 'Em estoque');
  }

  return { price, status, blocked, rateLimited, usdOnly, notFound };
}

// Resultado de scrape que merece retry: erro, bloqueio ou sem preço
// (esgotado NÃO é falha — é um estado legítimo do produto).
export function resultadoRuim(r) {
  return !!r.erro || !!r.blocked || (!(r.price > 0) && r.status !== 'Esgotado');
}

// Tenta detectar e clicar no iFrame do desafio Turnstile da Cloudflare
async function tentarClicarTurnstile(page) {
  try {
    for (const frame of page.frames()) {
      const u = frame.url();
      if (u.includes('challenges.cloudflare.com') || u.includes('turnstile')) {
        const cb = await frame.$('input[type="checkbox"], .cb-i, #challenge-stage input');
        if (cb) {
          await cb.click({ timeout: 1000 }).catch(() => {});
        }
      }
    }
  } catch {}
}

// Navega até a URL, espera renderizar e raspa preço + status.
export async function scrapeProduto(page, produto) {
  const { url, fornecedor } = produto;

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const readySel = READY_SEL[fornecedor];
  if (readySel) {
    try {
      await page.waitForSelector(readySel, { timeout: READY_TIMEOUT_MS });
    } catch {
      // segue mesmo assim — pode ser esgotado sem título OU desafio Cloudflare
    }
  }

  // Polling até o preço aparecer. NÃO desiste no "bloqueado": o desafio da
  // Cloudflare ("Just a moment") se auto-resolve em alguns segundos num
  // navegador real — damos tempo (deadline maior) para ele limpar.
  // Exceção: rate-limit do fornecedor é página estática — esperar não ajuda.
  let deadline = Date.now() + PRICE_DEADLINE_MS;
  let result;
  let vezes404 = 0;
  let estendido = false;
  do {
    await tentarClicarTurnstile(page);
    result = await page.evaluate(scrapeInPage, fornecedor);
    if (result.price > 0 || result.status === 'Esgotado' || result.rateLimited) break;
    // 404 da SPA: 2 leituras seguidas confirmam (1 só pode ser estado
    // transitório do router antes do produto renderizar). Com o site fora
    // do ar, cada URL custa ~1,5s em vez do deadline inteiro.
    if (result.notFound) { if (++vezes404 >= 2) break; }
    else vezes404 = 0;
    // Página viva mas só com U$: a conversão pra R$ pode estar a caminho —
    // estende o deadline UMA vez. Só afeta esse estado raro; página quebrada
    // de outro jeito continua respeitando o deadline normal.
    if (result.usdOnly && !estendido) { deadline += USD_EXTRA_MS; estendido = true; }
    await page.waitForTimeout(700);
  } while (Date.now() < deadline);

  return result;
}

