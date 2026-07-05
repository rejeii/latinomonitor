// ============================================================
//  Lógica de variação de preço (portada do userscript)
//  Compara o preço novo com o "Custo Referência" salvo no Notion.
//  Limite por faixa de valor do produto:
//    custoRef <= PRICE_HIGH_LEVEL  → dispara se |Δ| >= PRICE_THRESHOLD
//    custoRef  > PRICE_HIGH_LEVEL  → dispara se |Δ| >= PRICE_THRESHOLD_HIGH
//  Quando dispara, o "Custo Referência" vira o novo preço → não
//  re-alerta a mesma variação na próxima execução.
// ============================================================

import { PRICE_THRESHOLD, PRICE_THRESHOLD_HIGH, PRICE_HIGH_LEVEL } from './config.js';

// ── Preço alvo (campo "Preço Alvo" no Notion) ──
// Alerta quando o preço cruza para <= alvo. O flag "Alvo Atingido" (escrito
// pelo monitor) evita repetir o alerta a cada run enquanto seguir abaixo do
// alvo; quando o preço sobe acima do alvo, o flag é limpo e o alerta rearma.
export function calcAlvo(price, precoAlvo, jaAtingido) {
  if (precoAlvo == null || !(price > 0)) return { atingido: false, alertar: false };
  const atingido = price <= precoAlvo;
  return { atingido, alertar: atingido && !jaAtingido };
}

export function calcPriceChange(newPrice, custoRef) {
  if (!newPrice || newPrice <= 0) return null;

  const isNew = custoRef == null;

  // Primeira vez que vemos o produto: define baseline, não alerta
  if (isNew) {
    return {
      triggered: false, delta: 0,
      props: {
        'Custo Referência': { number: newPrice },
        'Alteração':        { select: { name: 'Estável' } },
        'Alteração de':     { number: 0 },
      },
    };
  }

  const delta     = newPrice - custoRef;
  const absDelta  = Math.abs(delta);
  const limite    = custoRef > PRICE_HIGH_LEVEL ? PRICE_THRESHOLD_HIGH : PRICE_THRESHOLD;
  const triggered = absDelta >= limite;
  const props     = {};

  if (triggered) {
    props['Custo Referência'] = { number: newPrice };
    props['Alteração']        = { select: { name: delta > 0 ? 'Subiu' : 'Desceu' } };
    props['Alteração de']     = { number: absDelta };
  } else {
    props['Alteração']        = { select: { name: 'Estável' } };
    props['Alteração de']     = { number: 0 };
  }

  return { triggered, delta, props };
}
