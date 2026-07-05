// ============================================================
//  Digest semanal — variações dos últimos 7 dias, sem scraping.
//  Lê o "Histórico 30d" que o monitor já grava no Notion e envia
//  um resumo no Discord (maiores quedas/subidas + esgotados).
//  Uso: npm run digest   (workflow: digest.yml, domingo 09:00 BRT)
// ============================================================

import { pathToFileURL } from 'node:url';
import { buscarProdutos } from './notion.js';
import { parseHist, diaSP } from './history.js';
import { enviarDigestSemanal, NOMES } from './discord.js';

const brl = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

// Variação da semana por produto: último valor do histórico vs o valor
// registrado até o corte (~7 dias atrás). Produtos com menos de 2 dias
// de histórico ficam de fora. Exportada para os testes.
export function calcularDigest(produtos, corte = diaSP(7)) {
  const variacoes = [];
  for (const p of produtos) {
    const hist = parseHist(p.hist30);
    const dias = Object.keys(hist).sort();
    if (dias.length < 2) continue;

    const antigos = dias.filter(d => d <= corte);
    const baseDia = antigos.length ? antigos[antigos.length - 1] : dias[0];
    const fimDia  = dias[dias.length - 1];
    if (baseDia === fimDia) continue;

    const delta = hist[fimDia] - hist[baseDia];
    if (Math.abs(delta) >= 0.01) variacoes.push({ produto: p, de: hist[baseDia], para: hist[fimDia], delta });
  }

  const quedas  = variacoes.filter(v => v.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  const subidas = variacoes.filter(v => v.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const esgotados = produtos.filter(p => p.status === 'Esgotado');

  return { quedas, subidas, esgotados, total: produtos.length };
}

export function montarTexto({ quedas, subidas, esgotados, total }) {
  const linha = v =>
    `• ${v.produto.nome} (${NOMES[v.produto.fornecedor] || v.produto.fornecedor}): ` +
    `${brl(v.de)} → ${brl(v.para)} (${v.delta > 0 ? '▲' : '▼'} ${brl(Math.abs(v.delta))})`;

  const blocos = [`Produtos acompanhados: ${total}`, ''];
  blocos.push('📉 **Maiores quedas da semana**' + (quedas.length ? '' : ': nenhuma'));
  blocos.push(...quedas.map(linha));
  blocos.push('', '📈 **Maiores subidas da semana**' + (subidas.length ? '' : ': nenhuma'));
  blocos.push(...subidas.map(linha));
  blocos.push('', `🚫 Esgotados no momento: ${esgotados.length}`);
  return blocos.join('\n');
}

async function main() {
  const todos    = await buscarProdutos();
  const produtos = todos.filter(p => !p.pausado);
  const texto    = montarTexto(calcularDigest(produtos));
  console.log(texto);
  await enviarDigestSemanal(texto);
  console.log('Digest enviado.');
}

// Só roda quando chamado direto (node src/digest.js) — os testes só importam
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
