// ============================================================
//  Navegador compartilhado — Chromium + plugin stealth, com a
//  mesma configuração para o monitor (index.js) e o testador
//  de produto avulso (test-produto.js).
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Abre o Chromium com a config padrão do projeto e devolve { browser, context }.
// navTimeoutMs (opcional) vira o timeout de navegação de todas as páginas
// criadas a partir do context.
export async function criarNavegador({ navTimeoutMs } = {}) {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ],
  };

  const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY;
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: UA,
    locale:    'pt-BR',
    viewport:  { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  // Oculta navigator.webdriver e preenche objetos nativos de navegador real
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
      if (!window.chrome) {
        window.chrome = { runtime: {} };
      }
    } catch {}
  });

  if (navTimeoutMs) context.setDefaultNavigationTimeout(navTimeoutMs);
  return { browser, context };
}

