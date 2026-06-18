// ============================================================
//  Scrapers — Playwright (navegador real, lê o DOM renderizado)
//  Seletores portados do userscript LatinoGo.user.js.
//  O preço é lido JÁ EM R$ do DOM — não usa cotação.
// ============================================================

export function detectarFornecedor(url) {
  if (!url) return null;
  if (url.includes('visaovip.com'))           return 'visaovip';
  if (url.includes('atacadoconnect.com'))     return 'atacadoconnect';
  if (url.includes('atacadocollections.com')) return 'atacadocollections';
  return null;
}

// Seletor que indica que a página do produto terminou de renderizar
const READY_SEL = {
  visaovip:           'h2.mt-1.text-2xl.font-bold',
  atacadoconnect:     'h1.font-archivo.font-bold',
  atacadocollections: 'header.product-header h1',
};

// ── Função executada DENTRO da página (contexto do navegador) ──
// Precisa ser autocontida: nada de imports aqui dentro.
// Retorna { price, status, blocked }.
function scrapeInPage(fornecedor) {
  const extractPrice = (text) => {
    if (!text) return 0;
    const m = String(text).match(/R\$\s*([\d.,]+)/);
    if (!m) return 0;
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0;
  };

  // Detecta página de desafio da Cloudflare (Collections pode cair aqui)
  const sample = ((document.title || '') + ' ' +
    ((document.body && document.body.innerText) || '').slice(0, 300));
  const blocked = /just a moment|attention required|verifying you are human|cloudflare/i.test(sample);

  let price = 0;
  let status = 'Em estoque';

  if (fornecedor === 'visaovip') {
    const el = document.querySelector('.border-round-2xl .text-vip:not(.font-medium)');
    price = extractPrice(el?.innerText || '');
    const esgotadoEl = document.querySelector('.error-border');
    status = price > 0 ? 'Em estoque' : (esgotadoEl ? 'Esgotado' : 'Em estoque');

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

  return { price, status, blocked };
}

// Navega até a URL, espera renderizar e raspa preço + status.
export async function scrapeProduto(page, produto) {
  const { url, fornecedor } = produto;

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const readySel = READY_SEL[fornecedor];
  if (readySel) {
    try {
      await page.waitForSelector(readySel, { timeout: 15000 });
    } catch {
      // segue mesmo assim — produto pode estar esgotado e sem o título
    }
  }

  // O preço renderiza no cliente DEPOIS do título (o site converte U$→R$).
  // Faz polling até o preço aparecer (ou esgotado/bloqueado/timeout).
  const deadline = Date.now() + 9000;
  let result;
  do {
    result = await page.evaluate(scrapeInPage, fornecedor);
    if (result.price > 0 || result.status === 'Esgotado' || result.blocked) break;
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);

  return result;
}
