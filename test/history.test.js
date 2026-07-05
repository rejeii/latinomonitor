// ============================================================
//  Testes do histórico diário compacto (history.js)
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

import { diaSP, parseHist, serializeHist } from '../src/history.js';

test('diaSP: formato YYYYMMDD e offset para trás', () => {
  assert.match(diaSP(0), /^\d{8}$/);
  assert.ok(diaSP(1) < diaSP(0), 'ontem vem antes de hoje');
  assert.ok(diaSP(30) < diaSP(7), '30 dias atrás vem antes de 7');
});

test('parseHist/serializeHist: ida e volta preserva os dados', () => {
  const s = '20260701:99.9,20260702:95,20260703:105.5';
  const h = parseHist(s);
  assert.deepStrictEqual(h, { '20260701': 99.9, '20260702': 95, '20260703': 105.5 });
  assert.strictEqual(serializeHist(h), s);
});

test('parseHist: entradas vazias ou malformadas são ignoradas', () => {
  assert.deepStrictEqual(parseHist(''), {});
  assert.deepStrictEqual(parseHist(null), {});
  assert.deepStrictEqual(parseHist(undefined), {});
  assert.deepStrictEqual(parseHist('20260701:100,lixo,:5,20260702:'), { '20260701': 100 });
});

test('serializeHist: mapa vazio vira string vazia', () => {
  assert.strictEqual(serializeHist({}), '');
});
