// ============================================================
//  Lógica de variação de preço (portada do userscript)
//  Compara o preço novo com o "Custo Referência" salvo no Notion.
//  Só dispara (triggered) quando a variação >= PRICE_THRESHOLD.
//  Quando dispara, o "Custo Referência" vira o novo preço → não
//  re-alerta a mesma variação na próxima execução.
// ============================================================

import { PRICE_THRESHOLD } from './config.js';

export function calcPriceChange(newPrice, custoRef) {
  if (!newPrice || newPrice <= 0) return null;

  const isNew = custoRef == null;

  // Primeira vez que vemos o produto: define baseline, não alerta
  if (isNew) {
    return {
      triggered: false, delta: 0, absDelta: 0,
      props: {
        'Custo Referência': { number: newPrice },
        'Alteração':        { select: { name: 'Estável' } },
        'Alteração de':     { number: 0 },
      },
    };
  }

  const delta     = newPrice - custoRef;
  const absDelta  = Math.abs(delta);
  const triggered = absDelta >= PRICE_THRESHOLD;
  const props     = {};

  if (triggered) {
    props['Custo Referência'] = { number: newPrice };
    props['Alteração']        = { select: { name: delta > 0 ? 'Subiu' : 'Desceu' } };
    props['Alteração de']     = { number: absDelta };
  } else {
    props['Alteração']        = { select: { name: 'Estável' } };
    props['Alteração de']     = { number: 0 };
  }

  return { triggered, delta, absDelta, props };
}
