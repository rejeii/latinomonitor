// ============================================================
//  Discord — envio em LOTE (até 10 embeds por mensagem)
//  Agrupar evita o rate limit e garante que todos os alertas
//  saiam, não só os primeiros.
// ============================================================

import { DISCORD_WEBHOOK_PRECOS, DISCORD_WEBHOOK_ESGOTADOS, DISCORD_WEBHOOK_INICIO, DISCORD_WEBHOOK_ERROS } from './config.js';

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

// Gráfico compacto do histórico 30d via QuickChart (vira imagem do embed).
// Exportada só para os testes.
export function sparklineUrl(valores) {
  if (!Array.isArray(valores) || valores.length < 2) return null;
  const cfg = {
    type: 'sparkline',
    data: { datasets: [{ data: valores.map(v => Math.round(v * 100) / 100), borderColor: '#5865F2', fill: false }] },
  };
  return 'https://quickchart.io/chart?w=380&h=80&c=' + encodeURIComponent(JSON.stringify(cfg));
}

function embedPreco(item) {
  const { produto, preco, delta, dbNome, menor, novoMenor, novoMenor30 } = item;
  const subiu = delta > 0;
  const fields = [
    { name: 'Fornecedor',     value: NOMES[produto.fornecedor] || produto.fornecedor,            inline: true },
    { name: 'Database',       value: dbNome || '—',                                              inline: true },
    // Campo com espaço invisível (zero-width space): completa a 1ª linha de
    // 3 colunas pro Discord alinhar "Preço anterior/atual/Diferença" embaixo
    { name: '​',         value: '​',                                                   inline: true },
    { name: 'Preço anterior', value: brl(produto.custoRef ?? produto.custoAtual),                inline: true },
    { name: 'Preço atual',    value: brl(preco),                                                 inline: true },
    { name: 'Diferença',      value: (subiu ? '+' : '-') + brl(Math.abs(delta)),                 inline: true },
  ];
  if (menor != null) {
    fields.push({ name: 'Menor histórico', value: brl(menor) + (novoMenor ? '  🔻 novo!' : ''),  inline: true });
  }
  // Sinal de compra: queda que também é o menor preço dos últimos 30 dias
  const badge30 = (!subiu && novoMenor30) ? '\n🟢 **Menor preço dos últimos 30 dias!**' : '';
  const embed = {
    title:       (subiu ? '🔼  Preço subiu' : '🔽  Preço caiu'),
    // subiu = verde, desceu = vermelho (convenção pedida)
    color:       subiu ? 3066993 : 15158332,
    url:         produto.url,
    description: `**${produto.nome}**` + badge30,
    fields,
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
  // Gráfico dos últimos 30 dias (se houver histórico suficiente)
  const spark = sparklineUrl(item.histValores);
  if (spark) embed.image = { url: spark };
  return embed;
}

function embedAlvo(item) {
  const { produto, preco, dbNome } = item;
  return {
    title:       '🎯  Preço alvo atingido',
    color:       15844367, // dourado
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields: [
      { name: 'Fornecedor',  value: NOMES[produto.fornecedor] || produto.fornecedor, inline: true },
      { name: 'Database',    value: dbNome || '—',                                   inline: true },
      { name: 'Preço alvo',  value: brl(produto.precoAlvo),                          inline: true },
      { name: 'Preço atual', value: brl(preco),                                      inline: true },
    ],
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

// items: [{ produto, preco, delta, dbNome, menor, novoMenor, novoMenor30, histValores }]
export async function enviarLotePrecos(items) {
  if (!items.length) return;
  await postEmbeds(DISCORD_WEBHOOK_PRECOS, items.map(embedPreco));
}

// items: [{ produto, preco, dbNome }]
export async function enviarLoteAlvos(items) {
  if (!items.length) return;
  await postEmbeds(DISCORD_WEBHOOK_PRECOS, items.map(embedAlvo));
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

export async function enviarAvisoCampos(criados) {
  if (!criados || !criados.length) return;
  const desc = criados.map(c => `**${c.db}**: ${c.campos.join(', ')}`).join('\n');
  const embed = {
    title:       '🛠️  Campos criados automaticamente no Notion',
    color:       16776960, // amarelo
    description: desc,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_INICIO || DISCORD_WEBHOOK_PRECOS, [embed]).catch(() => {});
}

// Relatório de erros num canal dedicado (opcional).
export async function enviarRelatorioErros(erros) {
  if (!DISCORD_WEBHOOK_ERROS || !erros.length) return;

  const linhas = erros.slice(0, 20).map(e => {
    const forn = e.fornecedor ? ` · ${e.fornecedor}` : '';
    const db   = e.database ? ` · ${e.database}` : '';
    const msg  = e.mensagem ? `\n   ↳ ${e.mensagem}` : '';
    return `**[${e.tipo}]** ${e.nome}${forn}${db}${msg}`;
  });
  let desc = linhas.join('\n');
  if (erros.length > 20) desc += `\n\n…e mais ${erros.length - 20} — ver database de erros`;
  if (desc.length > 4000) desc = desc.slice(0, 3990) + '…';

  const embed = {
    title:       `⚠️  ${erros.length} erro(s) no monitoramento`,
    color:       15158332, // vermelho
    description: desc,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_ERROS, [embed]).catch(() => {});
}

export async function enviarCanario(canarios) {
  if (!canarios || !canarios.length) return;
  const desc = canarios
    .map(c => `🚨 **${NOMES[c.fornecedor] || c.fornecedor}**: ${c.ruins}/${c.total} sem preço (${Math.round(c.pct * 100)}%) — alertas e atualizações **suprimidos**`)
    .join('\n');
  const embed = {
    title:       '🚨  ALERTA DE EMERGÊNCIA: Scraper possivelmente quebrado',
    color:       15158332, // vermelho
    description: desc + '\n\n**Atenção**: Provável mudança no layout do site do fornecedor ou bloqueio severo. Verifique o scraper imediatamente.',
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  const webhook = DISCORD_WEBHOOK_ERROS || DISCORD_WEBHOOK_INICIO || DISCORD_WEBHOOK_PRECOS;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@everyone 🚨 **ALERTA DE EMERGÊNCIA NO MONITOR**', embeds: [embed] }),
    });
  } catch {}
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

export async function enviarAvisoUso(uso) {
  const embed = {
    title:       '⏱️  Minutos do GitHub Actions chegando ao limite',
    color:       15105570, // laranja
    description:
      `Uso estimado neste mês: **${uso.usado} / ${uso.limite} min** (~${uso.pct}%).\n` +
      `Ao passar de ~85%, deixe o repositório **público** (Actions ilimitado) pra o monitor não parar.`,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_INICIO || DISCORD_WEBHOOK_PRECOS, [embed]).catch(() => {});
}

export async function enviarDigestSemanal(texto) {
  const embed = {
    title:       '🗓️  Digest semanal de preços',
    color:       10181046, // roxo
    description: texto,
    footer:      { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postEmbeds(DISCORD_WEBHOOK_INICIO || DISCORD_WEBHOOK_PRECOS, [embed]);
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
