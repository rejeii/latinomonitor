// ============================================================
//  Discord — alertas via webhook (embeds portados do GAS)
// ============================================================

import { DISCORD_WEBHOOK_PRECOS, DISCORD_WEBHOOK_ESGOTADOS } from './config.js';

export const NOMES = {
  visaovip:           'VisãoVip',
  atacadoconnect:     'AtacadoConnect',
  atacadocollections: 'AtacadoCollections',
};

const brl   = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const agora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function postWebhook(webhook, embed) {
  const res = await fetch(webhook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${t}`);
  }
}

export async function enviarAlertaPreco(produto, precoNovo, delta) {
  const subiu = delta > 0;
  const embed = {
    title:       (subiu ? '📈' : '📉') + '  Variação de preço detectada',
    color:       subiu ? 15158332 : 3066993,
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields: [
      { name: 'Fornecedor',     value: NOMES[produto.fornecedor] || produto.fornecedor,    inline: true },
      { name: 'Preço anterior', value: brl(produto.custoRef ?? produto.custoAtual),        inline: true },
      { name: 'Preço atual',    value: brl(precoNovo),                                     inline: true },
      { name: 'Diferença',      value: (delta > 0 ? '+' : '-') + brl(Math.abs(delta)),     inline: true },
    ],
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postWebhook(DISCORD_WEBHOOK_PRECOS, embed);
}

export async function enviarAlertaEsgotado(produto) {
  const embed = {
    title:       '🚫  Produto esgotado no fornecedor',
    color:       9807270,
    url:         produto.url,
    description: `**${produto.nome}**`,
    fields: [
      { name: 'Fornecedor',     value: NOMES[produto.fornecedor] || produto.fornecedor,  inline: true },
      { name: 'Custo anterior', value: brl(produto.custoAtual ?? produto.custoRef),      inline: true },
    ],
    footer: { text: 'LatinoGG Monitor · ' + agora() },
  };
  await postWebhook(DISCORD_WEBHOOK_ESGOTADOS, embed);
}

export async function enviarErro(mensagem) {
  const embed = {
    title:       '⚠️  Erro no Monitor LatinoGG',
    color:       16776960,
    description: mensagem,
    footer:      { text: agora() },
  };
  await postWebhook(DISCORD_WEBHOOK_PRECOS, embed).catch(() => {});
}
