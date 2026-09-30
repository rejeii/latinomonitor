import { NOTION_TOKEN, NOTION_DATABASE_IDS } from '../src/config.js';

async function debugDatabases() {
  for (const dbId of NOTION_DATABASE_IDS) {
    // 1. Pega metadata da database (título e propriedades)
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const dbData = await dbRes.json();
    const dbTitle = dbData.title?.[0]?.plain_text || dbId;
    const propNames = Object.keys(dbData.properties || {});
    console.log(`\n========================================`);
    console.log(`Database: "${dbTitle}" (${dbId})`);
    console.log(`Propriedades encontradas:`, propNames.join(', '));

    // 2. Consulta todas as páginas dessa database
    let cursor = undefined;
    let totalPages = 0;
    let totalPausados = 0;

    do {
      const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      });
      const qData = await qRes.json();
      totalPages += (qData.results || []).length;

      for (const page of qData.results || []) {
        const props = page.properties;
        // Procura qualquer propriedade que pareça com "pausado"
        for (const [k, v] of Object.entries(props)) {
          if (k.toLowerCase().includes('paus') && v.type === 'checkbox' && v.checkbox === true) {
            totalPausados++;
            const nome = props['Nome']?.title?.[0]?.plain_text || page.id;
            console.log(`  -> [${k}=true] ${nome}`);
          }
        }
      }

      cursor = qData.has_more ? qData.next_cursor : undefined;
    } while (cursor);

    console.log(`Resumo ${dbTitle}: ${totalPages} páginas, ${totalPausados} com checkbox de pausado marcado.`);
  }
}

debugDatabases().catch(console.error);
