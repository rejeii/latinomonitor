import { NOTION_TOKEN, NOTION_DATABASE_IDS } from '../src/config.js';

async function main() {
  console.log('=== Analisando todos os produtos e links no Notion ===');

  const produtosComLinkAntigo = [];
  let totalProdutos = 0;

  for (const dbId of NOTION_DATABASE_IDS) {
    // 1. Pega nome da database
    let dbTitle = dbId;
    try {
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
        },
      });
      const dbData = await dbRes.json();
      dbTitle = dbData.title?.[0]?.plain_text || dbId;
    } catch {}

    // 2. Consulta todas as páginas da database
    let cursor = undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      });

      if (!res.ok) {
        console.error(`Erro ao consultar database ${dbTitle}: ${res.statusText}`);
        break;
      }

      const data = await res.json();
      for (const page of data.results || []) {
        totalProdutos++;
        const props = page.properties;
        const nome = props['Nome']?.title?.[0]?.plain_text || '(sem nome)';
        const url = props['Produto']?.url || '';
        const sku = props['Código']?.rich_text?.[0]?.plain_text ||
                    (props['Código']?.number != null ? String(props['Código'].number) : null) ||
                    props['Codigo']?.rich_text?.[0]?.plain_text ||
                    (props['Codigo']?.number != null ? String(props['Codigo'].number) : null) ||
                    props['SKU']?.rich_text?.[0]?.plain_text ||
                    (props['SKU']?.number != null ? String(props['SKU'].number) : null) ||
                    '';

        // Extrai o ID da URL se houver
        const urlIdMatch = url.match(/\/(\d+)\/?(?:$|[?#])/);
        const urlId = urlIdMatch ? urlIdMatch[1] : '';

        // Critérios para link antigo / problemático:
        // 1. VisãoVip com "/produto/" (estrutura antiga antes da mudança para /prod/:categoria/)
        // 2. Ou URL com ID diferente do SKU
        const isOldVisaoVip = url.includes('visaovip.com/produto/');
        const isMismatch = (url.includes('visaovip.com') && sku && urlId && String(sku) !== String(urlId));

        if (isOldVisaoVip || isMismatch) {
          produtosComLinkAntigo.push({
            pageId: page.id,
            database: dbTitle,
            nome,
            sku: sku || urlId || 'N/A',
            urlId,
            url,
            motivo: isOldVisaoVip ? 'Link antigo (/produto/)' : 'SKU/ID divergente da URL',
          });
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  }

  console.log(`\n========================================`);
  console.log(`Total de produtos analisados: ${totalProdutos}`);
  console.log(`Total de produtos com links antigos/problemáticos: ${produtosComLinkAntigo.length}`);
  console.log(`========================================\n`);

  console.log(JSON.stringify(produtosComLinkAntigo, null, 2));
}

main().catch(console.error);
