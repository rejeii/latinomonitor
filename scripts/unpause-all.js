import { buscarProdutos, atualizarProduto } from '../src/notion.js';

async function main() {
  console.log('=== Buscando todos os produtos via buscarProdutos() ===');
  const todos = await buscarProdutos();
  const pausados = todos.filter(p => p.pausado);
  console.log(`Total de produtos no Notion: ${todos.length}`);
  console.log(`Total de produtos pausados encontrados: ${pausados.length}`);

  let count = 0;
  for (const p of pausados) {
    count++;
    try {
      await atualizarProduto(p.pageId, {
        'Pausado': { checkbox: false },
      });
      console.log(`[${count}/${pausados.length}] Despausado: ${p.nome}`);
    } catch (e) {
      console.error(`Erro ao despausar ${p.nome}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 100)); // rate limit Notion API
  }

  console.log(`\n=== Concluído! ${count} produtos foram despausados. ===`);
}

main().catch(console.error);
