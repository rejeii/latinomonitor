// ============================================================
//  Testes do discord.js com fetch simulado (não posta de verdade)
//  Rodar: npm test
// ============================================================
import test from 'node:test';
import assert from 'node:assert';

process.env.NOTION_TOKEN           ||= 'test-token';
process.env.NOTION_DATABASE_IDS    ||= 'db-teste';
process.env.DISCORD_WEBHOOK_PRECOS ||= 'https://example.com/webhook';

const { enviarLotePrecos, enviarLoteAlvos, sparklineUrl, NOMES } = await import('../src/discord.js');

// Captura os POSTs que o módulo faria
const capturar = () => {
  const posts = [];
  globalThis.fetch = async (url, opts) => {
    posts.push({ url, body: JSON.parse(opts.body) });
    return new Response('ok', { status: 200 });
  };
  return posts;
};

const produtoBase = {
  nome: 'Produto X',
  url: 'https://www.visaovip.com/prod/x',
  fornecedor: 'visaovip',
  custoRef: 100,
  custoAtual: 100,
  precoAlvo: 150,
};

test('NOMES: cobre os 3 fornecedores suportados', () => {
  assert.deepStrictEqual(Object.keys(NOMES).sort(),
    ['atacadocollections', 'atacadoconnect', 'visaovip']);
});

test('lotes vazios não postam nada', async () => {
  const posts = capturar();
  await enviarLotePrecos([]);
  await enviarLoteAlvos([]);
  assert.strictEqual(posts.length, 0);
});

test('enviarLotePrecos: embed com preços formatados e badge de menor em 30d', async () => {
  const posts = capturar();
  await enviarLotePrecos([{
    produto: produtoBase, preco: 80, delta: -20, dbNome: 'Pokémon',
    menor: 80, novoMenor: true, novoMenor30: true,
  }]);

  assert.strictEqual(posts.length, 1);
  const embed = posts[0].body.embeds[0];
  assert.strictEqual(embed.title, '🔽  Preço caiu');
  assert.match(embed.description, /Produto X/);
  assert.match(embed.description, /Menor preço dos últimos 30 dias/, 'queda + menor30 mostra o selo de compra');

  const campo = n => embed.fields.find(f => f.name === n)?.value;
  assert.strictEqual(campo('Preço anterior'), 'R$ 100,00');
  assert.strictEqual(campo('Preço atual'),    'R$ 80,00');
  assert.strictEqual(campo('Diferença'),      '-R$ 20,00');
  assert.strictEqual(campo('Fornecedor'),     'VisãoVip');
});

test('enviarLotePrecos: mais de 10 alertas são divididos em mensagens de até 10 embeds', async () => {
  const posts = capturar();
  const itens = Array.from({ length: 23 }, (_, i) => ({
    produto: { ...produtoBase, nome: `P${i}` }, preco: 90, delta: -20, dbNome: 'X',
    menor: null, novoMenor: false, novoMenor30: false,
  }));
  await enviarLotePrecos(itens);

  assert.strictEqual(posts.length, 3, '23 embeds → 3 POSTs (10+10+3)');
  assert.deepStrictEqual(posts.map(p => p.body.embeds.length), [10, 10, 3]);
});

test('enviarLoteAlvos: embed 🎯 com alvo e preço atual', async () => {
  const posts = capturar();
  await enviarLoteAlvos([{ produto: produtoBase, preco: 149.9, dbNome: 'Pokémon' }]);

  const embed = posts[0].body.embeds[0];
  assert.strictEqual(embed.title, '🎯  Preço alvo atingido');
  const campo = n => embed.fields.find(f => f.name === n)?.value;
  assert.strictEqual(campo('Preço alvo'),  'R$ 150,00');
  assert.strictEqual(campo('Preço atual'), 'R$ 149,90');
});

test('sparklineUrl: precisa de pelo menos 2 pontos', () => {
  assert.strictEqual(sparklineUrl(null), null);
  assert.strictEqual(sparklineUrl([]), null);
  assert.strictEqual(sparklineUrl([100]), null);
});

test('sparklineUrl: monta URL do QuickChart com os valores arredondados', () => {
  const url = sparklineUrl([100.555, 95, 105.111]);
  assert.match(url, /^https:\/\/quickchart\.io\/chart\?w=380&h=80&c=/);
  const cfg = JSON.parse(decodeURIComponent(url.split('&c=')[1]));
  assert.strictEqual(cfg.type, 'sparkline');
  assert.deepStrictEqual(cfg.data.datasets[0].data, [100.56, 95, 105.11]);
});

test('embedPreco: alerta com histórico ganha imagem de sparkline; sem histórico, não', async () => {
  const posts = capturar();
  await enviarLotePrecos([
    { produto: produtoBase, preco: 80, delta: -20, dbNome: 'X', menor: null, novoMenor: false, novoMenor30: false, histValores: [100, 90, 80] },
    { produto: produtoBase, preco: 80, delta: -20, dbNome: 'X', menor: null, novoMenor: false, novoMenor30: false },
  ]);
  const [comHist, semHist] = posts[0].body.embeds;
  assert.match(comHist.image?.url ?? '', /quickchart\.io/);
  assert.strictEqual(semHist.image, undefined);
});

test('postEmbeds: um 429 do Discord é aguardado e reenviado', async () => {
  let chamada = 0;
  globalThis.fetch = async () => {
    chamada++;
    return chamada === 1
      ? new Response(JSON.stringify({ retry_after: 0.05 }), { status: 429 })
      : new Response('ok', { status: 200 });
  };
  await enviarLoteAlvos([{ produto: produtoBase, preco: 100, dbNome: 'X' }]);
  assert.strictEqual(chamada, 2, 'retry único após o 429');
});
