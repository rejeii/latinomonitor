// ============================================================
//  Estimativa de minutos do GitHub Actions usados no mês.
//  Usa o token READ-ONLY do próprio workflow (GH_TOKEN) — precisa
//  de permissão actions:read (concedida no workflow). Sem secret novo.
//  Estimativa: soma a duração dos runs do mês (arredonda p/ cima por run).
// ============================================================

import { ACTIONS_LIMIT_MIN } from './config.js';

export async function checarUsoActions() {
  const token = process.env.GH_TOKEN;
  const repo  = process.env.GH_REPO;   // "owner/nome"
  if (!token || !repo) return null;

  try {
    const H = {
      Authorization: `Bearer ${token}`,
      'User-Agent':  'latino-monitor',
      Accept:        'application/vnd.github+json',
    };
    const base = `https://api.github.com/repos/${repo}`;

    // Repo público não tem limite de minutos → nem checa
    const info = await (await fetch(base, { headers: H })).json();
    if (info && info.private === false) return { publico: true };

    // Início do mês (UTC) como aproximação do ciclo de cobrança
    const now   = new Date();
    const desde = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const filtro = encodeURIComponent('>=' + desde);

    let minutos = 0;
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`${base}/actions/runs?per_page=100&page=${page}&created=${filtro}`, { headers: H });
      if (!res.ok) break;
      const json = await res.json();
      const runs = json.workflow_runs || [];
      if (!runs.length) break;
      for (const r of runs) {
        if (r.status !== 'completed' || !r.run_started_at || !r.updated_at) continue;
        const ms = new Date(r.updated_at) - new Date(r.run_started_at);
        if (ms > 0) minutos += Math.ceil(ms / 60000); // GitHub cobra arredondando p/ cima por run
      }
      if (runs.length < 100) break;
    }

    const pct = Math.round((minutos / ACTIONS_LIMIT_MIN) * 100);
    return { publico: false, usado: minutos, limite: ACTIONS_LIMIT_MIN, pct };
  } catch {
    return null;
  }
}
