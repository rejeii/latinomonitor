// ============================================================
//  Discord — envio em LOTE (até 10 embeds por mensagem)
//  Agrupar evita o rate limit e garante que todos os alertas
//  saiam, não só os primeiros.
// ============================================================

import { DISCORD_WEBHOOK_PRECOS, DISCORD_WEBHOOK_ESGOTADOS, DISCORD_WEBHOOK_INICIO } from './config.js';

export const NOMES = {
  visaovip:           'VisãoVip',
  atacadoconnect:     'AtacadoConnect',
  atacadocollections: 'AtacadoCollections',
};

const brl   = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const agora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Envia embeds em lotes de até 10, com folga entre lotes e 1 retry no 429.
async function postEmbeds(webhook, embeds) {
  for (const grupo of chunk(embeds, 10)) {
    let res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: grupo }),
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const espera = Math.ceil((j.retry_after ?? 2) * 1000) + 300;
      await new Promise(r => setTimeout(r, espera));
      res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: grupo }),
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Discord ${res.status}: ${t}`);
    }
    await new Promise(r => setTimeout(r, 800)); // folga entre lotes
  }
}

function embedPreco(item) {
  const { produto, preco, delta, dbNome, menor, novoMenor } = item;
  const subiu = delta > 0;
  const fields = [
    { name: 'Fornecedor',     value: NOMES[produto.fornecedor] || produto.fornecedor,            inline: true },
    { name: 'Database',       value: dbNome || '—',                                              inline: true },
    { name: '​',         value: '​',                                                   inline: true },
    { name: 'Preço anterior', value: brl(produto.custoRef ?? produto.custoAtual),                inline: true },
    { name: 'Preço atual',    value: brl(preco),                                                 inline: true },
    { name: 'Diferença',      value: (subiu ? '+' : '-') + brl(Math.abs(delta)),                 inline: true },
  ];
  if (menor != null) {
    fields.push({ name: 'Menor histórico', value: brl(menor) + (novoMenor ? '  🔻 novo!' : ''),  inline: true });
  }
  return {
    title:       (subiu ? '📈  Preço subiu' : '📉  Preço caiu'),
    // subiu = verde, desceu = vermelho (convenção pedida)
    color:       subiu ? 3066993 : 15158332,
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields,
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
}

function embedEsgotado(produto, dbNome) {
  return {
    title:       '🚫  Produto esgotado no fornecedor',
    color:       9807270,
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields: [
      { name: 'Fornecedor',     value: NOMES[produto.fornecedor] || produto.fornecedor, inline: true },
      { name: 'Database',       value: dbNome || '—',                                   inline: true },
      { name: 'Custo anterior', value: brl(produto.custoAtual ?? produto.custoRef),     inline: true },
    ],
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
}

function embedVoltou(produto, precoNovo, dbNome) {
  return {
    title:       '🔄  Produto voltou ao estoque',
    color:       5763719,
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields: [
      { name: 'Fornecedor',  value: NOMES[produto.fornecedor] || produto.fornecedor, inline: true },
      { name: 'Database',    value: dbNome || '—',                                   inline: true },
      { name: 'Preço atual', value: brl(precoNovo),                                  inline: true },
    ],
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
}

// items: [{ produto, preco, delta, pct, dbNome, menor, novoMenor }]
export async function enviarLotePrecos(items) {
  if (!items.length) return;
  await postEmbeds(DISCORD_WEBHOOK_PRECOS, items.map(embedPreco));
}

// items: [{ produto, dbNome }]
export async function enviarLoteEsgotados(items) {
  if (!items.length) return;
  await postEmbeds(DISCORD_WEBHOOK_ESGOTADOS, items.map(i => embedEsgotado(i.produto, i.dbNome)));
}

// items: [{ produto, preco, dbNome }]  → vai pro canal de estoque
export async function enviarLoteVoltou(items) {
  if (!items.length) return;
  await postEmbeds(DISCORD_WEBHOOK_ESGOTADOS, items.map(i => embedVoltou(i.produto, i.preco, i.dbNome)));
}

export async function enviarInicio(texto) {
  if (!DISCORD_WEBHOOK_INICIO) return;
  const embed = {
    title:       '🟢  Monitoramento iniciado',
    color:       5763719,
    description: texto,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_INICIO, [embed]).catch(() => {});
}

export async function enviarResumo(texto) {
  const embed = {
    title:       '📊  Resumo do monitoramento',
    color:       3447003,
    description: texto,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  // mesmo canal do aviso de início (cai no de preços se o de início não existir)
  await postEmbeds(DISCORD_WEBHOOK_INICIO || DISCORD_WEBHOOK_PRECOS, [embed]).catch(() => {});
}

export async function enviarErro(mensagem) {
  const embed = {
    title:       '⚠️  Erro no Monitor LatinoGG',
    color:       16776960,
    description: mensagem,
    footer:      { text: agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_PRECOS, [embed]).catch(() => {});
}
