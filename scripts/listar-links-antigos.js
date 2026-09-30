const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_IDS = (process.env.NOTION_DATABASE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const NOMES_DESPAUSADOS = new Set([
  'Projetor Xiaomi Mi Smart L1 Pro 400 Lumens - Cinza (XMTYY03PFMG)',
  'Fone de Ouvido JBL Tune T530BT Pure Bass / Bluetooth - Branco',
  'Teclado Gamer Mecânico Ajazz AK680 Max Nacodexx Mini USB / RGB / Inglês - Preto / Cinza (984662)',
  'Teclado Gamer Mecânico Redragon K660-RGB Dharma TKL USB / RGB / RED / Inglês - Preto',
  'Teclado Mtek KWB-2670W Wireless / Português - Branco',
  'Teclado Gamer Mecânico Redragon K631RGB-PRO-P Castor Pro Wireless / RGB / Inglês - Preto',
  'Kit Gamer Redragon Essentials S147 Teclado + Mouse + Mousepad + Fone / RGB / Espanhol - Preto',
  'Teclado Gamer Mecânico Ajazz AK820 Nacodexx USB / RGB / Moon Yellow / Inglês - Cinza / Branco',
  'Teclado Gamer Mecânico Redragon K556RGB Devarajas USB / RGB / Red / Inglês - Preto',
  'Teclado Gamer Redragon K512RGB-1 Shiva USB / Inglês - Preto',
  'Microfone Hollyland Lark A1 Mini Duo Lavalier Wireless / USB-C - Space Cinza',
  'Microfone Hollyland Lark M2 Lavalier Duo Wireless / Lightning / USB-C - Shine Charcoal (Combo)',
  'Mouse Gamer Ajazz AJ199 Nacodexx Wireless - Preto (987144)',
  'Mouse Gamer Ajazz AJ199 Max Nacodexx Wireless - Branco (987175)',
  'Mouse Gamer Ajazz AJ179APEX Nacodexx Wireless - Branco (983375)',
  'Mouse Gamer Ajazz AJ139 V2 MC Nacodexx Wireless - Branco (985584)',
  'Mouse Satellite A-904G Wireless - Preto',
  'Mouse Gamer Redragon M816-RGB Deicide USB / RGB - Preto',
  'Mouse Gamer Redragon M711RGB Cobra USB / RGB - Preto',
  'Mouse Gamer Ajazz AJ179P MC Nacodexx Wireless - Branco (985867)',
  'Monitor Kolke KES-665 Curve 27" Full HD IPS LED 100Hz / 1Ms - Preto',
  'Monitor Macrovip MV-DM27FH 27" Full HD 100Hz / 1Ms - Preto',
  'Monitor Gamer Macrovip Max MV-DMX24CFHW 24" Full HD Curvo 180Hz / 1Ms - Branco',
  'Monitor MSI Pro MP242 E14A 23.8" Full HD IPS LED 144Hz / 1Ms - Preto',
  'Monitor Gamer Gigabyte GS25F14 24.5" Full HD IPS 144Hz / 1Ms - Preto',
  'Monitor Macrovip MV-DM23FH2 23.8" Full HD 100Hz / 1Ms - Preto'
]);

async function main() {
  console.log('=== Analisando produtos no Notion ===');

  const listaMismatched = [];
  const listaDespausados = [];
  let totalProdutos = 0;

  for (const dbId of NOTION_DATABASE_IDS) {
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

        const urlIdMatch = url.match(/\/(\d+)\/?(?:$|[?#])/);
        const urlId = urlIdMatch ? urlIdMatch[1] : '';

        const item = {
          categoria: dbTitle,
          nome,
          sku: sku || 'N/A',
          urlId: urlId || 'N/A',
          url,
        };

        const isMismatch = (url.includes('visaovip.com') && sku && urlId && String(sku) !== String(urlId));
        if (isMismatch) {
          listaMismatched.push(item);
        }

        if (NOMES_DESPAUSADOS.has(nome)) {
          listaDespausados.push(item);
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  }

  console.log(`\n========================================`);
  console.log(`Total de produtos analisados: ${totalProdutos}`);
  console.log(`1. Produtos com Link Trocado/Corrompido (SKU != ID da URL): ${listaMismatched.length}`);
  console.log(`2. Produtos que estavam Auto-Pausados por 404: ${listaDespausados.length}`);
  console.log(`========================================\n`);

  console.log('### LISTA 1: LINKS TROCADOS / SKU DIVERGENTE ###');
  console.log(JSON.stringify(listaMismatched, null, 2));

  console.log('\n### LISTA 2: PRODUTOS QUE DERAM 404 (DESPAUSADOS) ###');
  console.log(JSON.stringify(listaDespausados, null, 2));
}

main().catch(console.error);
