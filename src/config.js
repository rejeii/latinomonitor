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

// Variação (R$) mínima para disparar alerta. Default 10.
export const PRICE_THRESHOLD = Number(process.env.PRICE_THRESHOLD || 10);

// Timeout de navegação por página (ms)
export const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);

// Delay entre produtos (ms) — não martelar os fornecedores
export const DELAY_MS = Number(process.env.DELAY_MS || 800);
