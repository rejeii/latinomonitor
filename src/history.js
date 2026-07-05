// ============================================================
//  Histórico diário compacto de preços — "YYYYMMDD:preço,..."
//  Guarda o MENOR preço de cada dia (campo "Histórico 30d").
//  Usado pelo monitor (menor em 30 dias) e pelo digest semanal.
// ============================================================

// Dia no fuso de São Paulo (YYYYMMDD), com offset em dias pra trás
export const diaSP = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).replace(/-/g, '');
};

export const parseHist = s => {
  const m = {};
  (s || '').split(',').forEach(e => {
    const [d, p] = e.split(':');
    if (d && p) m[d] = parseFloat(p);
  });
  return m;
};

export const serializeHist = m =>
  Object.entries(m).map(([d, p]) => `${d}:${p}`).join(',');
