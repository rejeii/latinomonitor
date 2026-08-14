// ============================================================
//  Testes de calcPriceChange e calcAlvo (node:test — sem deps)
//  Rodar: npm test
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

// config.js valida env ao carregar — dummies antes do import dinâmico
process.env.NOTION_TOKEN           ||= 'test-token';
process.env.NOTION_DATABASE_IDS    ||= 'db-teste';
process.env.DISCORD_WEBHOOK_PRECOS ||= 'https://example.com/webhook';

const { calcPriceChange, calcAlvo } = await import('../src/priceChange.js');

// Defaults: PRICE_THRESHOLD=15, PRICE_THRESHOLD_HIGH=20, PRICE_HIGH_LEVEL=1000

test('calcPriceChange: preço inválido retorna null', () => {
  assert.strictEqual(calcPriceChange(0, 100), null);
  assert.strictEqual(calcPriceChange(null, 100), null);
  assert.strictEqual(calcPriceChange(-5, 100), null);
});

test('calcPriceChange: primeira leitura define baseline sem alertar', () => {
  const r = calcPriceChange(250, null);
  assert.strictEqual(r.triggered, false);
  assert.strictEqual(r.props['Custo Referência'].number, 250);
  assert.strictEqual(r.props['Alteração'].select.name, 'Estável');
});

test('calcPriceChange: variação abaixo do limite não alerta nem move o baseline', () => {
  const r = calcPriceChange(114, 100);   // Δ 14 < 15
  assert.strictEqual(r.triggered, false);
  assert.strictEqual(r.props['Custo Referência'], undefined, 'baseline NÃO muda sem alerta');
  assert.strictEqual(r.props['Alteração'].select.name, 'Estável');
});

test('calcPriceChange: subida >= limite alerta e move o baseline (anti-spam)', () => {
  const r = calcPriceChange(115, 100);   // Δ 15 >= 15
  assert.strictEqual(r.triggered, true);
  assert.strictEqual(r.delta, 15);
  assert.strictEqual(r.props['Custo Referência'].number, 115, 'baseline vira o preço novo');
  assert.strictEqual(r.props['Alteração'].select.name, 'Subiu');
  assert.strictEqual(r.props['Alteração de'].number, 15);
});

test('calcPriceChange: queda >= limite alerta como Desceu', () => {
  const r = calcPriceChange(80, 100);    // Δ -20
  assert.strictEqual(r.triggered, true);
  assert.strictEqual(r.delta, -20);
  assert.strictEqual(r.props['Alteração'].select.name, 'Desceu');
});

test('calcPriceChange: produto caro (> R$1000) usa o limite alto de R$20', () => {
  assert.strictEqual(calcPriceChange(1215, 1200).triggered, false, 'Δ 15 < 20 no produto caro');
  assert.strictEqual(calcPriceChange(1220, 1200).triggered, true,  'Δ 20 >= 20 dispara');
});

test('calcAlvo: sem alvo definido nunca alerta', () => {
  assert.deepStrictEqual(calcAlvo(100, null, false), { atingido: false, alertar: false });
});

test('calcAlvo: alerta ao cruzar para <= alvo (inclusive igual)', () => {
  assert.deepStrictEqual(calcAlvo(95, 100, false),  { atingido: true, alertar: true });
  assert.deepStrictEqual(calcAlvo(100, 100, false), { atingido: true, alertar: true });
});

test('calcAlvo: não repete o alerta enquanto seguir abaixo (flag marcada)', () => {
  assert.deepStrictEqual(calcAlvo(90, 100, true), { atingido: true, alertar: false });
});

test('calcAlvo: preço acima do alvo limpa a flag (rearma) sem alertar', () => {
  assert.deepStrictEqual(calcAlvo(110, 100, true), { atingido: false, alertar: false });
});

test('calcAlvo: depois de rearmar, nova queda alerta de novo', () => {
  assert.deepStrictEqual(calcAlvo(99, 100, false), { atingido: true, alertar: true });
});

test('calcAlvo: preço inválido não alerta', () => {
  assert.deepStrictEqual(calcAlvo(0, 100, false), { atingido: false, alertar: false });
});

const { calcularPrecoPsicologico, calcularPrecoComparacao } = await import('../src/priceChange.js');

test('calcularPrecoPsicologico: arredonda para o próximo múltiplo de 10 terminando em .90', () => {
  assert.strictEqual(calcularPrecoPsicologico(1513.79), 1519.90);
  assert.strictEqual(calcularPrecoPsicologico(1500.00), 1499.90);
  assert.strictEqual(calcularPrecoPsicologico(1386.01), 1389.90);
  assert.strictEqual(calcularPrecoPsicologico(1519.90), 1519.90); // já no formato
});

test('calcularPrecoPsicologico: retorna o próprio valor se for inválido', () => {
  assert.strictEqual(calcularPrecoPsicologico(0), 0);
  assert.strictEqual(calcularPrecoPsicologico(null), null);
});

test('calcularPrecoComparacao: mantém a proporção do desconto e aplica regra psicológica', () => {
  // precoAntigo = 1500, compAntigo = 2000 (desconto de 25%, fator 1.333...)
  // precoNovo = 1513.79 -> compNovoCru = 2018.38... -> arredonda p/ 2019.90
  assert.strictEqual(calcularPrecoComparacao(1500, 2000, 1513.79), 2019.90);
  
  // Se precoComparacao antigo era menor que o precoAntigo (sem desconto), retorna null
  assert.strictEqual(calcularPrecoComparacao(2000, 1500, 1500), null);
  
  // Se faltar algum parametro, retorna null
  assert.strictEqual(calcularPrecoComparacao(null, 2000, 1500), null);
});
