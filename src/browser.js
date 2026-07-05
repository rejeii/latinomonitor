// ============================================================
//  Navegador compartilhado — Chromium + plugin stealth, com a
//  mesma configuração para o monitor (index.js) e o testador
//  de produto avulso (test-produto.js).
// ============================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Abre o Chromium com a config padrão do projeto e devolve { browser, context }.
// navTimeoutMs (opcional) vira o timeout de navegação de todas as páginas
// criadas a partir do context.
export async function criarNavegador({ navTimeoutMs } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    locale:    'pt-BR',
    viewport:  { width: 1366, height: 768 },
  });
  if (navTimeoutMs) context.setDefaultNavigationTimeout(navTimeoutMs);
  return { browser, context };
}
