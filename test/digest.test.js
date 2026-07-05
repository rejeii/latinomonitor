// ============================================================
//  Testes do digest semanal (lógica pura, sem Notion/Discord)
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

process.env.NOTION_TOKEN           ||= 'test-token';
process.env.NOTION_DATABASE_IDS    ||= 'db-teste';
process.env.DISCORD_WEBHOOK_PRECOS ||= 'https://example.com/webhook';

const { calcularDigest, montarTexto } = await import('../src/digest.js');

// Histórico sintético: corte fixo em 20260628 (produtos usam dias em volta)
const CORTE = '20260628';
const produto = (nome, hist30, status = 'Em estoque') =>
  ({ nome, fornecedor: 'visaovip', hist30, status });

test('calcularDigest: quedas e subidas ordenadas pela variação da semana', () => {
  const produtos = [
    produto('queda-grande', '20260627:200,20260704:150'),   // -50
    produto('queda-pequena', '20260627:100,20260704:95'),   // -5
    produto('subida', '20260627:100,20260704:130'),         // +30
    produto('estavel', '20260627:100,20260704:100'),        // 0 → fora
    produto('sem-historico', ''),                           // fora
    produto('um-dia-so', '20260704:100'),                   // fora
    produto('esgotado', '20260627:80,20260704:80', 'Esgotado'),
  ];

  const d = calcularDigest(produtos, CORTE);
  assert.deepStrictEqual(d.quedas.map(v => v.produto.nome), ['queda-grande', 'queda-pequena']);
  assert.strictEqual(d.quedas[0].delta, -50);
  assert.deepStrictEqual(d.subidas.map(v => v.produto.nome), ['subida']);
  assert.strictEqual(d.esgotados.length, 1);
  assert.strictEqual(d.total, 7);
});

test('calcularDigest: usa o registro mais recente ATÉ o corte como base da semana', () => {
  // registros em 20/06 e 26/06 (antes do corte 28/06) e 04/07 (depois):
  // a base deve ser 26/06 (o mais recente até o corte), não 20/06
  const d = calcularDigest([produto('p', '20260620:300,20260626:250,20260704:200')], CORTE);
  assert.strictEqual(d.quedas[0].de, 250);
  assert.strictEqual(d.quedas[0].delta, -50);
});

test('calcularDigest: produto que só tem registros na semana usa o primeiro dia como base', () => {
  const d = calcularDigest([produto('novo', '20260701:120,20260704:100')], CORTE);
  assert.strictEqual(d.quedas[0].de, 120);
  assert.strictEqual(d.quedas[0].delta, -20);
});

test('calcularDigest: limita a 5 quedas e 5 subidas', () => {
  const muitos = Array.from({ length: 8 }, (_, i) =>
    produto(`q${i}`, `20260627:100,20260704:${100 - (i + 1)}`));
  const d = calcularDigest(muitos, CORTE);
  assert.strictEqual(d.quedas.length, 5);
  assert.strictEqual(d.quedas[0].produto.nome, 'q7', 'a maior queda vem primeiro');
});

test('montarTexto: contém os produtos, setas e o total', () => {
  const produtos = [
    produto('Placa X', '20260627:200,20260704:150'),
    produto('Fonte Y', '20260627:100,20260704:130'),
  ];
  const texto = montarTexto(calcularDigest(produtos, CORTE));
  assert.match(texto, /Produtos acompanhados: 2/);
  assert.match(texto, /Placa X \(VisãoVip\): R\$ 200,00 → R\$ 150,00 \(▼ R\$ 50,00\)/);
  assert.match(texto, /Fonte Y \(VisãoVip\): R\$ 100,00 → R\$ 130,00 \(▲ R\$ 30,00\)/);
  assert.match(texto, /Esgotados no momento: 0/);
});

test('montarTexto: semana sem variações mostra "nenhuma"', () => {
  const texto = montarTexto(calcularDigest([produto('estavel', '20260627:100,20260704:100')], CORTE));
  assert.match(texto, /Maiores quedas da semana\*\*: nenhuma/);
  assert.match(texto, /Maiores subidas da semana\*\*: nenhuma/);
});
