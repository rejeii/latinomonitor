// ============================================================
//  Configuração — tudo via variáveis de ambiente.
//  Em produção: GitHub Secrets (ver README).
//  Local: exporte as variáveis ou use um .env (não commitado).
// ============================================================

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const NOTION_TOKEN = req('NOTION_TOKEN');

// IDs das databases do Notion, separados por vírgula
export const NOTION_DATABASE_IDS = req('NOTION_DATABASE_IDS')
  .split(',').map(s => s.trim()).filter(Boolean);

export const DISCORD_WEBHOOK_PRECOS = req('DISCORD_WEBHOOK_PRECOS');
// Se não houver canal separado de esgotados, cai no de preços
export const DISCORD_WEBHOOK_ESGOTADOS =
  process.env.DISCORD_WEBHOOK_ESGOTADOS || DISCORD_WEBHOOK_PRECOS;
// Webhook opcional para avisar que o monitoramento começou
export const DISCORD_WEBHOOK_INICIO = process.env.DISCORD_WEBHOOK_INICIO || '';

// Disparo do alerta de preço (R$ absolutos, com faixa por valor do produto):
//   produto <= PRICE_HIGH_LEVEL  → alerta se variar >= PRICE_THRESHOLD       (R$15)
//   produto  > PRICE_HIGH_LEVEL  → alerta se variar >= PRICE_THRESHOLD_HIGH  (R$20)
export const PRICE_THRESHOLD      = Number(process.env.PRICE_THRESHOLD || 15);
export const PRICE_THRESHOLD_HIGH = Number(process.env.PRICE_THRESHOLD_HIGH || 20);
export const PRICE_HIGH_LEVEL     = Number(process.env.PRICE_HIGH_LEVEL || 1000);

// Timeout de navegação por página (ms)
export const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);

// Delay entre produtos (ms) — não martelar os fornecedores
export const DELAY_MS = Number(process.env.DELAY_MS || 800);

// Abas simultâneas POR fornecedor na fase de scrape. Fornecedores já rodam
// em paralelo entre si; este número multiplica a taxa de requisições que
// CADA site recebe (o DELAY_MS vale por aba). 1 = sequencial por fornecedor.
export const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 3);

// Espera (ms) antes da 2ª tentativa de quem falhou no scrape. Dá tempo do
// rate-limit do fornecedor expirar ("volte em alguns minutos") e do desafio
// da Cloudflare limpar — retry imediato tende a bater na mesma parede.
export const RETRY_COOLDOWN_MS = Number(process.env.RETRY_COOLDOWN_MS || 90000);

// Canário (detector de scraper quebrado): se um fornecedor com pelo menos
// CANARY_MIN produtos vier com CANARY_RATIO (fração) sem preço, é tratado como
// scraper quebrado → suprime escritas e alertas dele.
export const CANARY_RATIO = Number(process.env.CANARY_RATIO || 0.6);
export const CANARY_MIN   = Number(process.env.CANARY_MIN   || 10);

// Aviso de minutos do GitHub Actions: alerta no Discord ao passar de
// ACTIONS_ALERT_PCT% do total ACTIONS_LIMIT_MIN (free do plano privado = 2000).
export const ACTIONS_LIMIT_MIN = Number(process.env.ACTIONS_LIMIT_MIN || 2000);
export const ACTIONS_ALERT_PCT = Number(process.env.ACTIONS_ALERT_PCT || 80);

// Database de erros no Notion (opcional). Cada erro do run vira uma linha.
export const NOTION_ERROR_DB_ID = process.env.NOTION_ERROR_DB_ID || '';

// Canal dedicado de erros no Discord (opcional). Se vazio, erros só no resumo.
export const DISCORD_WEBHOOK_ERROS = process.env.DISCORD_WEBHOOK_ERROS || '';

// Configurações da Shopify
export const SHOPIFY_DOMAIN       = process.env.SHOPIFY_DOMAIN || 'latinogg.myshopify.com';
export const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
export const SHOPIFY_LOCATION_ID   = process.env.SHOPIFY_LOCATION_ID || '114689999165';

