import { NOTION_TOKEN, NOTION_DATABASE_IDS } from '../src/config.js';
import { atualizarProduto } from '../src/notion.js';

async function main() {
  console.log('=== Verificando produtos pausados no Notion ===');
  let totalPausados = 0;
  let despausados = 0;

  for (const dbId of NOTION_DATABASE_IDS) {
    let hasMore = true;
    let nextCursor = undefined;

    while (hasMore) {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'Pausado',
            checkbox: { equals: true },
          },
          start_cursor: nextCursor,
          page_size: 100,
        }),
      });

      if (!res.ok) {
        console.error(`Erro ao consultar database ${dbId}: ${res.statusText}`);
        break;
      }

      const data = await res.json();
      totalPausados += data.results.length;

      for (const page of data.results) {
        const nome = page.properties['Nome']?.title?.[0]?.plain_text || page.id;
        try {
          await atualizarProduto(page.id, {
            'Pausado': { checkbox: false },
          });
          despausados++;
          console.log(`[DESPAUSADO ${despausados}] ${nome}`);
        } catch (e) {
          console.error(`Erro ao despausar ${nome}: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 100)); // rate-limit Notion
      }

      hasMore = data.has_more;
      nextCursor = data.next_cursor;
    }
  }

  if (totalPausados === 0) {
    console.log('\nNenhum produto pausado encontrado. Todas as databases estão com todos os produtos ativos!');
  } else {
    console.log(`\n=== Finalizado com sucesso: ${despausados}/${totalPausados} produtos despausados! ===`);
  }
}

main().catch(console.error);
