// ==UserScript==
// @name         LatinoGo
// @namespace    http://tampermonkey.net/
// @version      38.0.2
// @description  Sincroniza produtos (VisãoVip, AtacadoConnect, AtacadoCollections) + Radar GG nas buscas para meu Amor <3
// @icon         https://cdn.discordapp.com/attachments/1407825836350115985/1512530057074049124/faviconretina.png?ex=6a246ce3&is=6a231b63&hm=f62ec4a7848f0c5e9f1563cc3ee830b88cbff237f86e2543f9c1747cc0243c5f&
// @match        https://www.visaovip.com/*
// @match        https://visaovip.com/*
// @match        https://atacadoconnect.com/*
// @match        https://www.atacadoconnect.com/*
// @match        https://www.atacadocollections.com/*
// @match        https://atacadocollections.com/*
// @match        https://guthib.com/*
// @match        https://blackscreen.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-idle
// @connect      api.notion.com
// @connect      cdn.visaovip.com
// @connect      cdn.atacadoconnect.com
// @connect      www.atacadocollections.com
// @connect      atacadocollections.com
// ==/UserScript==
(function () {
'use strict';

// ────────────────────────────────────────────────────────────
// src/01-config.js
// ────────────────────────────────────────────────────────────
const NOTION_VERSION = '2022-06-28';
const IMG_LIMIT      = 15;

const OBS_TIMEOUT_MS     = 15000;
const VV_IMG_TIMEOUT_MS  = 10000;
const CATALOG_CACHE_TTL  = 60 * 60 * 1000; // 1 hora
const RADAR_YELLOW_DB_ID = '3921a1b9d046807d85c0cb40ee38070b'; // Tabela "Adicionar" (destaque amarelo)

const DEFAULT_CATEGORIES = [
    'Air Cooler','Cadeira Gamer','Caixa de Som','Console','Controle','Cooler',
    'Fone de Ouvido','Fonte','Gabinete','HD','Headset','Hub USB','Kit','Memória RAM',
    'Mesa Digitalizadora','Microfone','Monitor','Mouse','Notebook','Periférico',
    'Placa de Vídeo','Processador','SSD','Suporte','Teclado','Water Cooler','Webcam',
];

const store = {
    get: (key, def) => {
        try { return JSON.parse(GM_getValue(key, JSON.stringify(def))); }
        catch (e) {
            console.warn(`[LatinoGo] store.get('${key}') corrompido, usando default:`, e);
            try { nsLog('warn', `storage corrompido: ${key}`); } catch {}
            return def;
        }
    },
    set: (key, val) => GM_setValue(key, JSON.stringify(val)),
};

const getSites        = ()      => store.get('ns_sites', []);
const setSites        = v       => store.set('ns_sites', v);
const getAccounts     = ()      => store.get('ns_accounts', []);
const setAccounts     = v       => store.set('ns_accounts', v);
const getDatabases    = ()      => store.get('ns_databases', []);
const setDatabases    = v       => store.set('ns_databases', v);
const getRefDbs       = ()      => store.get('ns_ref_dbs', []);
const setRefDbs       = v       => store.set('ns_ref_dbs', v);
const getCatalogCache = ()      => store.get('ns_catalog_cache', null);
const setCatalogCache = v       => store.set('ns_catalog_cache', v);
const getFields       = dbId    => store.get(`ns_fields_${dbId}`, []);
const setFields       = (id, v) => store.set(`ns_fields_${id}`, v);
const getConfig       = ()      => Object.assign(
    { confirmOnUpdate: true, radarEnabled: true, includeMainDbsInRadar: true },
    store.get('ns_config', {})
);
const setConfig       = v       => store.set('ns_config', v);
const getExtraCats    = ()      => store.get('ns_extra_cats', []);
const getErrorDbs     = ()      => store.get('ns_error_dbs', []);
const setErrorDbs     = v       => store.set('ns_error_dbs', v);
const setExtraCats    = v       => store.set('ns_extra_cats', v);
const uid             = ()      => Math.random().toString(36).slice(2, 10);

if (!getSites().length) {
    setSites([
        { id: uid(), name: 'VisãoVip',          match: 'visaovip.com/prod/',                    readySel: 'h1.text-2xl.font-bold, h2.text-2xl.font-bold' },
        { id: uid(), name: 'AtacadoConnect',     match: 'atacadoconnect.com/produto/',           readySel: 'h1.font-archivo.font-bold' },
        { id: uid(), name: 'AtacadoCollections', match: 'atacadocollections.com/produto/',       readySel: 'header.product-header h1' },
    ]);
}

const READY_SEL_MAP = {
    'visaovip.com':              'h1.text-2xl.font-bold, h2.text-2xl.font-bold',
    'atacadoconnect.com':        'h1.font-archivo.font-bold',
    'atacadocollections.com':    'header.product-header h1',
};
const _sites = getSites();
let _migrated = false;
_sites.forEach(s => {
    if (!s.readySel || (s.match.includes('visaovip.com') && s.readySel.startsWith('h2.'))) {
        const key = Object.keys(READY_SEL_MAP).find(k => s.match.includes(k));
        if (key) { s.readySel = READY_SEL_MAP[key]; _migrated = true; }
    }
});
if (_migrated) setSites(_sites);

const IS_CONFIG_ONLY = window.location.href.includes('guthib.com')
    || window.location.href.includes('blackscreen.app');

const url = window.location.href;

// Logo oficial da LatinoGG (Icon/nBackground/logomarca.svg com viewBox ajustado)
const GG_LOGO_SVG = `<svg viewBox="110 385 1215 665" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M444.139 400L465.492 411.984L681.019 532.949L746.768 569.85L830.665 616.937L812.449 646.575L795.152 674.717L755.779 738.776L656.041 717.464L450.34 673.51L354.368 653.218L345.822 671.771L324.457 718.151L318.416 731.265L311.712 745.818L306.043 758.124C325.142 780.308 345.421 801.447 366.783 821.442C381.128 834.869 395.961 847.781 411.253 860.148C445.929 888.191 482.964 913.432 522.014 935.526C549.941 951.327 578.899 965.519 608.761 977.975C617.951 981.808 627.226 985.477 636.583 988.978C648.325 993.37 660.195 997.499 672.188 1001.36C693.748 1008.29 715.701 1014.34 738.006 1019.48C764.101 1025.48 790.677 1030.23 817.667 1033.65C802.628 1034.48 787.48 1034.9 772.233 1034.9C757.793 1034.9 743.441 1034.52 729.187 1033.78C716.799 1033.13 704.484 1032.2 692.25 1031C666.952 1028.52 641.996 1024.88 617.435 1020.13C607.174 1018.15 596.983 1015.97 586.864 1013.6C554.314 1005.98 522.518 996.406 491.608 984.996C489.86 984.351 488.115 983.7 486.373 983.043C434.799 963.598 385.73 939.044 339.781 909.998C312.679 892.866 286.663 874.172 261.86 854.041C247.69 842.541 233.917 830.573 220.562 818.159C206.874 805.436 193.627 792.245 180.845 778.611C168.96 765.934 157.476 752.874 146.417 739.453C139.09 730.562 131.949 721.511 125 712.308L204.096 726.504L230.518 731.246L214.022 704.259L233.707 660.142L247.118 630.086L257.038 607.855L246.553 590.701L199.119 513.101L240.836 522.015L290.089 532.539L290.399 532.605L297.981 534.225L365.909 548.74L399.217 555.857L575.955 593.622L714.024 623.125L545.061 548.243L509.732 496.348L460.167 423.543L444.139 400Z" fill="#26F03A"/><path d="M1011.71 575.69L988.512 567.286L939.771 495.691L921.596 468.994L890.367 423.124L934.613 447.814L960.365 462.185L1050.64 512.561L1050.84 512.671L1296.05 649.511L1308 656.179L1301.35 665.499L1292.76 677.527L1249.85 737.619L1245.52 743.689L1219.64 739.726L1092.67 720.28L989.554 704.488L985.576 703.879L937.214 696.473L900.268 756.379L893.037 768.104L853.403 832.368L847.479 841.974L812.429 898.805L813.446 898.824L813.495 898.825C816.967 898.888 820.446 898.919 823.933 898.919C886.775 898.919 947.249 888.773 1003.81 870.031C1019.93 864.687 1035.74 858.644 1051.19 851.939C1061.6 847.422 1071.84 842.605 1081.92 837.499L1040.73 836.574L1011.32 793.38L987.467 758.336L1086.57 760.562L1120.61 761.326L1124.74 761.419L1193.92 762.972L1231.15 763.808L1269.84 764.676C1260.22 778.081 1250.03 791.053 1239.32 803.556C1231.01 813.249 1222.38 822.66 1213.45 831.774L1212.85 832.39C1212.25 832.998 1211.65 833.605 1211.05 834.21C1210.55 834.719 1210.04 835.226 1209.53 835.733C1208.02 837.251 1206.49 838.76 1204.96 840.261C1198.86 846.233 1192.63 852.068 1186.27 857.764C1171.71 870.794 1156.49 883.089 1140.65 894.59C1129.03 902.803 1111.22 914.803 1098.99 922.148C1064.82 942.664 1028.34 959.709 990.017 972.796C947.453 982.914 903.044 988.27 857.385 988.27C853.089 988.27 848.804 988.222 844.53 988.128C816.913 987.518 789.78 984.949 763.262 980.554L762.129 980.365C726.459 974.379 691.912 965.088 658.809 952.818L700.194 885.484L734.481 829.698L735.521 828.006L738.912 822.489L738.966 822.402L781.189 753.705L786.349 745.308L826.762 679.557L840.658 656.948L844.333 650.969L856.38 631.369L857.429 629.662L877.564 596.902L889.493 577.494L996.492 600.358L996.889 600.443L1013.5 603.992L1199.5 643.737L1012.03 575.808L1011.71 575.69Z" fill="#26F03A"/><path fill-rule="evenodd" clip-rule="evenodd" d="M635.773 750.44L500.34 747.399L525.197 784.133L553.277 825.629L589.066 826.433L578.478 843.658L572.29 853.727L546.199 896.177C573.017 913.623 601.388 928.879 631.061 941.693L631.42 941.109L670.208 878.002L700.368 828.932L707.763 816.899L717.345 801.308L747.074 752.939L683.444 751.51L635.773 750.44Z" fill="#26F03A"/></svg>`;

// Logotipo horizontal oficial da LatinoGG (Icon+Text/nBackground/logo_nbk.svg) para o cabeçalho do painel
const GG_HEADER_LOGO_SVG = `<svg viewBox="45 155 2295 340" fill="none" xmlns="http://www.w3.org/2000/svg" style="height:22px;width:auto;display:block" aria-label="LatinoGG"><path d="M215.053 165L410.113 274.34L372.322 335.749L218.182 302.854L169.75 292.626L145.363 345.501C155.002 356.682 165.235 367.336 176.016 377.414C183.255 384.181 190.74 390.689 198.457 396.922C215.957 411.056 234.646 423.778 254.353 434.914C268.446 442.878 283.06 450.031 298.13 456.309C302.767 458.241 307.448 460.09 312.17 461.854C318.095 464.068 324.086 466.149 330.138 468.093C341.018 471.587 352.097 474.639 363.353 477.226C376.522 480.254 389.934 482.646 403.554 484.369C395.964 484.788 388.32 485 380.626 485C373.339 485 366.096 484.81 358.903 484.434C352.651 484.107 346.436 483.64 340.262 483.036C327.496 481.787 314.902 479.951 302.507 477.557C297.329 476.556 292.186 475.459 287.079 474.265C270.653 470.426 254.607 465.598 239.009 459.848C238.127 459.523 237.246 459.194 236.367 458.863C210.34 449.063 185.577 436.687 162.389 422.047C148.712 413.413 135.583 403.99 123.066 393.844C115.916 388.048 108.965 382.016 102.225 375.759C95.3179 369.346 88.6324 362.698 82.1822 355.826C76.1841 349.437 70.3892 342.854 64.808 336.09C61.1105 331.608 57.5069 327.047 54 322.409L107.25 331.953L98.9248 318.351L120.633 269.762L91.4042 222.005L351.25 277.459L265.983 239.717L215.053 165Z" fill="#26F03A"/><path d="M489.77 249.315L440.242 176.655L651 294.119L619.469 338.225L463.883 314.427L400.91 416.406L401.448 416.416C403.2 416.447 404.956 416.463 406.715 416.463C438.429 416.463 468.947 411.35 497.488 401.903C505.626 399.21 513.603 396.164 521.401 392.784C526.653 390.508 531.824 388.08 536.908 385.506L516.122 385.04L489.243 345.607L631.741 348.803C626.886 355.559 621.746 362.097 616.338 368.399C612.145 373.284 607.792 378.028 603.286 382.621L602.98 382.932C602.679 383.238 602.377 383.544 602.074 383.849C601.82 384.105 601.565 384.361 601.309 384.617C600.544 385.382 599.774 386.142 599.001 386.899C595.922 389.908 592.777 392.85 589.566 395.72C582.221 402.288 574.538 408.485 566.545 414.282C560.683 418.421 551.695 424.469 545.522 428.171C528.28 438.511 509.867 447.103 490.53 453.699C469.05 458.798 446.639 461.497 423.597 461.497C421.429 461.497 419.267 461.474 417.11 461.426C403.173 461.119 389.48 459.824 376.098 457.609L375.526 457.513C357.526 454.496 340.091 449.814 323.386 443.629L439.8 254.46L596.247 287.847L489.77 249.315Z" fill="#26F03A"/><path fill-rule="evenodd" clip-rule="evenodd" d="M243.415 340.095L270.129 379.524L288.19 379.929L266.558 415.081C280.091 423.874 294.409 431.564 309.383 438.022L367.929 342.887L243.415 340.095Z" fill="#26F03A"/><path d="M1858.03 281.986L1804.09 424.491L759.476 423.231L802.6 281.007L1858.03 281.986Z" stroke="#26F03A" stroke-width="20"/><path d="M988.85 370.515L979.275 396.819H819.213L851.945 306.888H883.766L860.608 370.515H988.85Z" fill="#26F03A"/><path d="M1021.57 306.888H1181.64L1148.9 396.819H1116.84L1126.42 370.515H1030.24L1020.66 396.819H988.842L1021.57 306.888ZM1137.3 340.613L1140 333.193H1043.82L1041.12 340.613H1137.3Z" fill="#26F03A"/><path d="M1351.03 306.888L1341.53 332.968H1277.65L1254.41 396.819H1222.35L1245.59 332.968H1181.71L1191.2 306.888H1351.03Z" fill="#26F03A"/><path d="M1327.87 396.819L1360.6 306.888H1392.42L1359.69 396.819H1327.87Z" fill="#26F03A"/><path d="M1562.02 306.888L1529.28 396.819H1497.22L1481.94 385.578L1471.96 378.159H1471.72L1461.58 370.515L1456.43 366.917L1451.36 363.095L1446.61 359.723L1441.14 355.676L1431 348.032L1421.34 341.062L1401.04 396.819H1369.22L1401.95 306.888H1433.78L1448.59 318.13L1458.57 325.549L1458.88 325.999L1468.46 333.193L1473.38 336.79L1478.2 340.613L1483.98 345.109L1488.18 348.032L1497.84 355.676L1507.82 363.095L1509.17 363.995L1529.96 306.888H1562.02Z" fill="#26F03A"/><path d="M1571.58 306.888H1731.41L1698.67 396.819H1538.85L1571.58 306.888ZM1679.13 363.095L1687.31 340.613H1591.13L1582.95 363.095H1679.13Z" fill="#26F03A"/><path fill-rule="evenodd" clip-rule="evenodd" d="M1847.18 272H2327.01L2265.17 434.034H1785.81L1847.18 272ZM1874.58 376.248L1892.24 329.553H2058.67L2071.12 296.642H1863.01L1820.45 409.159H2028.56L2055.16 338.836H1940.37L1929.73 366.965H2003.15L1999.64 376.248H1874.58ZM2112.79 329.553L2095.13 376.248H2220.19L2223.7 366.965H2150.28L2160.92 338.836H2275.71L2249.11 409.159H2041L2083.56 296.642H2291.67L2279.22 329.553H2112.79Z" fill="#26F03A"/></svg>`;

// ────────────────────────────────────────────────────────────
// src/02-utils.js
// ────────────────────────────────────────────────────────────
function getText(sel) {
    if (!sel) return '';
    const el = document.querySelector(sel);
    return el ? el.innerText.trim() : '';
}

function extractPrice(text) {
    if (!text) return 0;
    const m = String(text).match(/R\$\s*([\d.,]+)/);
    if (!m) return 0;
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0;
}

function fmtBRL(n) {
    return 'R$' + (Number(n) || 0).toFixed(2).replace('.', ',');
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeText(text) {
    return (text || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractNotionId(input) {
    input = (input || '').trim();
    const mHyp = input.match(/([0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12})/i);
    if (mHyp) return mHyp[1].replace(/-/g, '').toLowerCase();
    const m32 = input.match(/([0-9a-z]{32})(?:[?#&]|$)/i);
    if (m32) return m32[1].toLowerCase();
    if (/^[0-9a-z]{32}$/i.test(input)) return input.toLowerCase();
    return null;
}

function toUUID(id) {
    if (!id) return id;
    const s = id.replace(/-/g, '');
    if (s.length !== 32) return id;
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

const CAT_STOP_WORDS = new Set(['de','da','do','das','dos','e','a','o','as','os','em','para','com','por','um','uma']);

const currentSite = getSites().find(s => url.includes(s.match)) || null;

// ────────────────────────────────────────────────────────────
// src/03-scrapers.js
// ────────────────────────────────────────────────────────────
function extractVisaoVipSpecs() {
    // 1. Tenta extrair do DOM (layout novo Radix/Tailwind ou layout antigo PrimeVue .p-panel)
    const domRows = document.querySelectorAll(
        'div.items-center.gap-2.md\\:flex, div.items-center.gap-2, [value="specifications"] section > div, .p-panel section > div'
    );
    const specs = [];
    domRows.forEach(block => {
        const label = block.querySelector('p.font-bold, p.font-semibold')?.innerText?.trim();
        const value = block.querySelector('span.text-gray-500, span.text-color-secondary, span')?.innerText?.trim();
        if (label && value && !specs.some(s => s.label === label)) {
            specs.push({ label, value });
        }
    });
    if (specs.length) return specs;

    // 2. Fallback direto dos scripts Next.js (garante extração mesmo antes de renderizar o accordion)
    const scripts = document.querySelectorAll('script');
    for (const sc of scripts) {
        const text = sc.textContent || '';
        if (text.includes('specificationName')) {
            const regex = /specificationName\\*":\\*"(.*?)\\*",\\*"specificationValue\\*":\\*"(.*?)\\*",\\*"specificationOrder/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const label = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
                const value = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
                if (label && value && !specs.some(s => s.label === label)) {
                    specs.push({ label, value });
                }
            }
            if (specs.length) return specs;
        }
    }
    return [];
}

function scrapeVisaoVip() {
    const name = getText('h1.text-2xl.font-bold, h2.text-2xl.font-bold') || getText('h1, h2');
    const sku  = getText('span.font-normal.texto-cinza-200');

    const brand = (() => {
        const brandLink = document.querySelector('a[href*="/busca/marca/"]');
        if (brandLink) {
            const p = brandLink.querySelector('p');
            if (p?.innerText?.trim()) return p.innerText.trim();
        }
        const logoImg = document.querySelector('a[href*="/busca/marca/"] img[alt^="Logo "]');
        if (logoImg) return logoImg.alt.replace(/^Logo\s+/i, '').trim();
        const rows = [...document.querySelectorAll('.sm\\:flex-1.md\\:flex')];
        const row  = rows.find(r => r.querySelector('p.font-bold')?.innerText?.includes('MARCA'));
        return row?.querySelector('span.text-color-secondary')?.innerText?.trim() || '';
    })();

    const priceEl = document.querySelector('.border-round-2xl .text-vip:not(.font-medium)');
    const price   = extractPrice(priceEl?.innerText || '');

    const description = getText('div.mb-2.texto-cinza-200 span');

    const specs = extractVisaoVipSpecs();

    const _vvProductId = window.location.pathname.split('/').filter(Boolean).pop() || '';
    const _vvIdIsNumeric = /^\d+$/.test(_vvProductId);
    const images = (() => {
        const collectImgs = (filterFn) => {
            const imgs = new Set();
            document.querySelectorAll('.swiper-wrapper img[alt^="Produto"]').forEach(el => {
                const src = el.src || el.dataset.src;
                if (src && !src.includes('data:') && !src.endsWith('.svg') && filterFn(src)) imgs.add(src);
            });
            if (!imgs.size) {
                const main = document.querySelector('img[alt="Produto 0"]');
                if (main?.src && filterFn(main.src)) imgs.add(main.src);
            }
            return imgs;
        };
        if (_vvIdIsNumeric) {
            const filtered = collectImgs(src => src.includes(_vvProductId));
            if (filtered.size) return [...filtered].slice(0, IMG_LIMIT);
        }
        return [...collectImgs(() => true)].slice(0, IMG_LIMIT);
    })();

    const { status, tags } = getProductInfoVisaoVip(price);
    return { name, sku, price, brand, description, specs, images, status, tags };
}

function scrapeAtacadoConnect() {
    const name = getText('h1.font-archivo.font-bold');

    const sku = (() => {
        const btn = document.querySelector('button.flex.items-center.gap-1.text-primary');
        if (!btn) return '';
        return (btn.childNodes[0]?.textContent || '').trim();
    })();

    const priceEl = document.querySelector('.page-module__P-0F3q__priceRow span.text-gray-2.page-module__P-0F3q__priceValue')
                 ?? [...document.querySelectorAll('.page-module__P-0F3q__priceValue')]
                        .find(el => el.innerText.includes('R$'));
    const price   = extractPrice(priceEl?.innerText || '');

    const brand = (() => {
        const el = document.querySelector('a[href^="/marca/"]');
        return el ? el.innerText.trim() : '';
    })();

    const descEl      = document.querySelector('.page-module__P-0F3q__productDescription div.text-gray-3');
    const description = descEl?.innerText?.trim() || '';

    const specsContainer = document.querySelector('.page-module__P-0F3q__productSpecs');
    const specs = specsContainer
        ? [...specsContainer.querySelectorAll('.border-b.flex')].reduce((acc, row) => {
            const cols  = row.querySelectorAll('span');
            const label = cols[0]?.innerText?.trim();
            const value = cols[1]?.innerText?.trim();
            if (label && value) acc.push({ label, value });
            return acc;
          }, [])
        : [];

    const images = (() => {
        const set = new Set();
        const mainImg = document.querySelector('div.absolute.cursor-pointer img.object-contain');
        if (mainImg?.src) set.add(mainImg.src);
        document.querySelectorAll('button.relative img.object-contain').forEach(img => {
            const src = (img.src || '').replace('/thumb/', '/');
            if (src && src.includes('cdn.atacadoconnect.com')) set.add(src);
        });
        return [...set].slice(0, IMG_LIMIT);
    })();

    const { status, tags } = getProductInfoAtacadoConnect(price);
    return { name, sku, price, brand, description, specs, images, status, tags };
}

function scrapeAtacadoCollections() {
    const header = document.querySelector('header.product-header');
    const sku   = header?.querySelector('p.title.is-small')?.innerText?.trim() || '';
    const brand = header?.querySelector('p.text')?.innerText?.trim() || '';
    const name  = header?.querySelector('h1')?.innerText?.trim() || '';

    const priceEl = [...document.querySelectorAll('div.price')]
        .find(d => d.querySelector('span.is-circle-br'))
        ?.querySelector('p.title');
    const price   = extractPrice(priceEl?.innerText?.trim() || '');

    const description = document.querySelector('.product--section-description .content')?.innerText?.trim() || '';

    const specs = [];
    document.querySelectorAll('.product--section-specs dl dt').forEach(dt => {
        const label = dt.innerText?.trim();
        const value = dt.nextElementSibling?.innerText?.trim();
        if (label && value) specs.push({ label, value });
    });

    const origin = window.location.origin;
    function collectAcImages() {
        const mainSwiper = document.querySelector('.swiper.is-original');
        const source = mainSwiper
            ? mainSwiper.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate) a.link img')
            : document.querySelectorAll('.product-content-images .swiper-slide a.link img');
        return [...source]
            .map(img => {
                const src = img.getAttribute('data-original') || img.getAttribute('src') || '';
                if (!src) return null;
                return src.startsWith('http') ? src : `${origin}/${src.replace(/^\//, '')}`;
            })
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, IMG_LIMIT);
    }
    const images = collectAcImages();

    const { status, tags } = getProductInfoAtacadoCollections(price);
    return { name, sku, price, brand, description, specs, images, status, tags };
}

const SCRAPER_MAP = {
    'VisãoVip':           scrapeVisaoVip,
    'AtacadoConnect':     scrapeAtacadoConnect,
    'AtacadoCollections': scrapeAtacadoCollections,
};

function scrapeCurrentPage() {
    const site = getSites().find(s => location.href.includes(s.match));
    const scraper = site && SCRAPER_MAP[site.name];
    if (scraper) return scraper();
    return { name: '', sku: '', price: 0, brand: '', description: '', specs: [], images: [], status: 'Em estoque', tags: [] };
}

function getProductInfoVisaoVip(price) {
    const tags = [];
    const container = document.querySelector('div.absolute.flex-column:not(.top-0):not(.right-0)');
    if (container) {
        container.querySelectorAll('.p-tag-value').forEach(el => {
            const t = el.innerText?.trim().toUpperCase();
            if (t === 'OFERTA') tags.push('OFERTA');
        });
    }
    const esgotadoEl = document.querySelector('.error-border');
    const status = price > 0 ? 'Em estoque' : (esgotadoEl ? 'Esgotado' : 'Em estoque');
    return { status, tags };
}

function getProductInfoAtacadoConnect(price) {
    const indisponivel = [...document.querySelectorAll('.bg-gray-bg span')]
        .some(el => el.innerText?.trim().toLowerCase() === 'indisponível');
    const status = price > 0 ? 'Em estoque' : (indisponivel ? 'Esgotado' : 'Em estoque');
    return { status, tags: [] };
}

function getProductInfoAtacadoCollections(price) {
    const indisponivel = !!document.querySelector('span.mtag-indisponivel');
    const status = price > 0 ? 'Em estoque' : (indisponivel ? 'Esgotado' : 'Em estoque');
    return { status, tags: [] };
}

// ────────────────────────────────────────────────────────────
// src/04-notion.js
// ────────────────────────────────────────────────────────────
function resolveDatabase(brand) {
    const dbs      = getDatabases();
    const accounts = getAccounts();
    const bn       = (brand || '').toLowerCase().trim();
    let db = dbs.find(d => !d.isDefault && (d.brands || []).some(b => b.toLowerCase().trim() === bn));
    if (!db) db = dbs.find(d => d.isDefault);
    if (!db) return null;
    const account = accounts.find(a => a.id === db.accountId);
    if (!account) return null;
    return { db, account, fields: getFields(db.id) };
}

async function notionReq(method, endpoint, body, token, _attempt = 0) {
    const MAX_RETRIES = 3;
    const backoffMs = (a) => Math.min(1000 * 2 ** a, 8000); // 1s, 2s, 4s…
    const opts = {
        method,
        url: `https://api.notion.com/v1/${endpoint}`,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
        },
    };
    if (body !== null && body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.data = JSON.stringify(body);
    }
    let res;
    try {
        res = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...opts,
                onload:  resolve,
                onerror: (err) => reject(new Error('Erro de rede: ' + (err?.statusText || 'desconhecido'))),
            });
        });
    } catch (netErr) {
        if (_attempt < MAX_RETRIES) {
            const wait = backoffMs(_attempt);
            nsLog('warn', `Notion erro de rede — retry em ${wait / 1000}s (tentativa ${_attempt + 1}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, wait));
            return notionReq(method, endpoint, body, token, _attempt + 1);
        }
        throw netErr;
    }
    if (res.status === 429 && _attempt < MAX_RETRIES) {
        const retryAfter = parseInt(res.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1] || '10', 10);
        nsLog('warn', `Notion rate limit (429) — aguardando ${retryAfter}s (tentativa ${_attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return notionReq(method, endpoint, body, token, _attempt + 1);
    }
    if (res.status >= 500 && res.status < 600 && _attempt < MAX_RETRIES) {
        const wait = backoffMs(_attempt);
        nsLog('warn', `Notion ${res.status} — retry em ${wait / 1000}s (tentativa ${_attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        return notionReq(method, endpoint, body, token, _attempt + 1);
    }
    if (res.status >= 200 && res.status < 300) return res;
    let msg = `Notion API error ${res.status}`;
    try {
        const json = JSON.parse(res.responseText);
        if (json.message) msg = `Notion: ${json.message}`;
    } catch {}
    throw new Error(msg);
}

function skuToNumber(sku) {
    if (sku === null || sku === undefined) return null;
    if (typeof sku === 'number') return Number.isFinite(sku) ? sku : null;
    const digits = String(sku).replace(/\D/g, '');
    return digits ? Number(digits) : null;
}

async function notionFindExisting(product, db, token) {
    const skuNum = skuToNumber(product.sku);
    if (skuNum !== null) {
        const res  = await notionReq('POST', `databases/${db.notionDbId}/query`, {
            filter: { property: 'SKU', number: { equals: skuNum } },
        }, token);
        const json = JSON.parse(res.responseText);
        if (json.results?.length) return json.results[0];
    }
    if (product.name) {
        const norm      = normalizeText(product.name);
        const prefix    = product.name.trim().slice(0, 20);
        const useFilter = prefix.length >= 4;
        let cursor = undefined;
        do {
            const body = cursor ? { start_cursor: cursor } : {};
            if (useFilter) {
                body.filter = { property: 'Nome', title: { contains: prefix } };
            }
            const res  = await notionReq('POST', `databases/${db.notionDbId}/query`, body, token);
            const json = JSON.parse(res.responseText);
            const found = (json.results || []).find(p =>
                normalizeText(p.properties?.Nome?.title?.[0]?.plain_text || '') === norm
            );
            if (found) return found;
            cursor = json.has_more ? json.next_cursor : undefined;
        } while (cursor);
    }
    return null;
}

function buildNotionProperties(product, categories) {
    const props = {};

    if (product.name)
        props['Nome'] = { title: [{ text: { content: product.name } }] };
    const skuNum = skuToNumber(product.sku);
    if (skuNum !== null)
        props['SKU'] = { number: skuNum };
    if (product.brand)
        props['Marca'] = { select: { name: product.brand } };
    if (window.location.href)
        props['Produto'] = { url: window.location.href };
    if (categories?.length)
        props['Categoria'] = { multi_select: categories.map(c => ({ name: c })) };

    props['Data']  = { date: { start: new Date().toISOString() } };

    const dimensoes = product.specs?.find(s =>
        s.label?.toUpperCase().includes('DIMENS')
    )?.value || '';
    if (dimensoes)
        props['Dimensões do Produto'] = { rich_text: [{ text: { content: dimensoes } }] };

    return props;
}

const IMAGES_HEADING = '📷 Imagens';

function buildNotionBlocks(description, specs, images) {
    const blocks = [];

    if (description?.trim()) {
        blocks.push({
            object: 'block', type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: 'Descrição' } }] },
        });
        description.split('\n\n').filter(Boolean).forEach(para => {
            for (let i = 0; i < para.length; i += 2000) {
                blocks.push({
                    object: 'block', type: 'paragraph',
                    paragraph: { rich_text: [{ type: 'text', text: { content: para.slice(i, i + 2000) } }] },
                });
            }
        });
    }

    if (specs?.length) {
        if (description?.trim()) blocks.push({ object: 'block', type: 'divider', divider: {} });
        blocks.push({
            object: 'block', type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: 'Especificações' } }] },
        });
        blocks.push({
            object: 'block', type: 'table',
            table: {
                table_width: 2, has_column_header: true, has_row_header: false,
                children: [
                    {
                        object: 'block', type: 'table_row',
                        table_row: { cells: [
                            [{ type: 'text', text: { content: 'Campo' }, annotations: { bold: true } }],
                            [{ type: 'text', text: { content: 'Valor' }, annotations: { bold: true } }],
                        ]},
                    },
                    ...specs.map(({ label, value }) => ({
                        object: 'block', type: 'table_row',
                        table_row: { cells: [
                            [{ type: 'text', text: { content: label } }],
                            [{ type: 'text', text: { content: value } }],
                        ]},
                    })),
                ],
            },
        });
    }

    if (images?.length) {
        if (description?.trim() || specs?.length)
            blocks.push({ object: 'block', type: 'divider', divider: {} });
        blocks.push({
            object: 'block', type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: IMAGES_HEADING } }] },
        });
        images.forEach(imgUrl => {
            blocks.push({
                object: 'block', type: 'bulleted_list_item',
                bulleted_list_item: {
                    rich_text: [{ type: 'text', text: { content: imgUrl, link: { url: imgUrl } } }],
                },
            });
        });
    }

    return blocks;
}

async function extractImagesFromBlocks(pageId, token) {
    const allBlocks = [];
    let cursor = undefined;
    do {
        const endpoint = cursor
            ? `blocks/${pageId}/children?start_cursor=${encodeURIComponent(cursor)}`
            : `blocks/${pageId}/children`;
        const res  = await notionReq('GET', endpoint, null, token);
        const json = JSON.parse(res.responseText);
        (json.results || []).forEach(b => allBlocks.push(b));
        cursor = json.has_more ? json.next_cursor : undefined;
    } while (cursor);

    const images = [];
    let inImagesSection = false;
    for (const block of allBlocks) {
        if (block.type === 'heading_2') {
            const text = block.heading_2?.rich_text?.[0]?.plain_text || '';
            inImagesSection = text === IMAGES_HEADING;
            continue;
        }
        if (inImagesSection) {
            if (block.type === 'bulleted_list_item') {
                const url = block.bulleted_list_item?.rich_text?.[0]?.text?.content || '';
                if (url.startsWith('http')) images.push(url);
            } else {
                inImagesSection = false;
            }
        }
    }
    return images;
}

async function notionUpdateBody(pageId, description, specs, images, token) {
    const blocks = buildNotionBlocks(description, specs, images);
    if (!blocks.length) return;

    const newHash   = btoa(encodeURIComponent(
        (description || '') + JSON.stringify(specs || []) + JSON.stringify(images || [])
    )).slice(0, 24);
    const hashKey   = `ns_body_hash_${pageId.replace(/-/g, '')}`;
    const savedHash = store.get(hashKey, '');
    if (savedHash && savedHash === newHash) return;

    const existing = [];
    let cursor = undefined;
    do {
        const url = cursor
            ? `blocks/${pageId}/children?start_cursor=${encodeURIComponent(cursor)}`
            : `blocks/${pageId}/children`;
        const resGet = await notionReq('GET', url, null, token);
        const json   = JSON.parse(resGet.responseText);
        (json.results || []).forEach(b => existing.push(b));
        cursor = json.has_more ? json.next_cursor : undefined;
    } while (cursor);

    const OWNED_HEADINGS = new Set(['Descrição', 'Especificações', IMAGES_HEADING]);
    let ownedStart = -1;
    for (let i = 0; i < existing.length; i++) {
        if (existing[i].type === 'heading_2') {
            const txt = existing[i].heading_2?.rich_text?.[0]?.plain_text || '';
            if (OWNED_HEADINGS.has(txt)) { ownedStart = i; break; }
        }
    }
    const toDelete = ownedStart >= 0 ? existing.slice(ownedStart) : existing;

    const DELETE_CONCURRENCY = 3;
    for (let i = 0; i < toDelete.length; i += DELETE_CONCURRENCY) {
        const chunk = toDelete.slice(i, i + DELETE_CONCURRENCY);
        await Promise.all(chunk.map(b =>
            notionReq('DELETE', `blocks/${b.id}`, null, token).catch(() => {})
        ));
    }
    await notionReq('PATCH', `blocks/${pageId}/children`, { children: blocks }, token);
    store.set(hashKey, newHash);
}

const FIELD_RENAMES = {
    'Fornecedor':       'Produto',
};

const NOTION_SCHEMA = {
    'Nome':                 { title: {} },
    'SKU':                  { number: { format: 'number' } },
    'Marca':                { select: {} },
    'Produto':              { url: {} },
    'Categoria':            { multi_select: {} },
    'Data':                 { date: {} },
    'Dimensões do Produto': { rich_text: {} },
};

const NOTION_SCHEMA_KEYS = Object.keys(NOTION_SCHEMA);

const _ENSURED_TTL = 86400000;
const _ensuredDbs = {
    _cache: null,
    _load() { if (!this._cache) this._cache = store.get('ns_ensured_dbs', {}); return this._cache; },
    has(dbId) { const t = this._load()[dbId]; return !!t && Date.now() - t < _ENSURED_TTL; },
    add(dbId) { const d = this._load(); d[dbId] = Date.now(); store.set('ns_ensured_dbs', d); },
};

async function ensureDbExtraFields(dbId, token) {
    if (_ensuredDbs.has(dbId)) return;
    try {
        const res  = await notionReq('GET', `databases/${dbId}`, null, token);
        const json = JSON.parse(res.responseText);
        if (json.object === 'error') return;
        const existing = Object.keys(json.properties || {});
        const toCreate = {};
        if (!existing.includes('Dimensões do Produto')) toCreate['Dimensões do Produto'] = NOTION_SCHEMA['Dimensões do Produto'];
        if (Object.keys(toCreate).length)
            await notionReq('PATCH', `databases/${dbId}`, { properties: toCreate }, token);
        _ensuredDbs.add(dbId);
    } catch (e) { console.warn('[LatinoGo] ensureDbExtraFields:', e); nsLog('warn', `ensureDbExtraFields: ${e?.message || e}`); }
}

const ERROR_DB_SCHEMA = {
    'Nome':    { title: {} },
    'Produto': { url: {} },
    'Erro':    { rich_text: {} },
    'Data':    { date: {} },
    'Origem':  { rich_text: {} },
};

const ERROR_DB_SCHEMA_KEYS = Object.keys(ERROR_DB_SCHEMA);

async function generateErrorDbFields(dbId, token) {
    const res  = await notionReq('GET', `databases/${dbId}`, null, token);
    const json = JSON.parse(res.responseText);
    if (json.object === 'error') throw new Error(json.message || json.code);
    const existing = Object.keys(json.properties || {});
    const created = [], existed = [], renamed = [], failed = [];

    if (existing.includes('Fornecedor') && !existing.includes('Produto')) {
        try {
            const patch = await notionReq('PATCH', `databases/${dbId}`, { properties: { 'Fornecedor': { name: 'Produto' } } }, token);
            const pJson = JSON.parse(patch.responseText);
            if (pJson.object === 'error') failed.push({ name: 'Fornecedor', msg: pJson.message || pJson.code });
            else { renamed.push('Fornecedor → Produto'); existing.push('Produto'); }
        } catch (e) { failed.push({ name: 'Fornecedor', msg: e.message }); }
    }

    for (const [name, schema] of Object.entries(ERROR_DB_SCHEMA)) {
        if (name === 'Nome') { existed.push(name); continue; }
        if (existing.includes(name)) { existed.push(name); continue; }
        try {
            const patch = await notionReq('PATCH', `databases/${dbId}`, { properties: { [name]: schema } }, token);
            const pJson = JSON.parse(patch.responseText);
            if (pJson.object === 'error') failed.push({ name, msg: pJson.message || pJson.code });
            else created.push(name);
        } catch (e) { failed.push({ name, msg: e.message }); }
    }
    return { created, existed, renamed, failed };
}

async function generateTableFields(dbId, token) {
    const res  = await notionReq('GET', `databases/${dbId}`, null, token);
    const json = JSON.parse(res.responseText);
    if (json.object === 'error') throw new Error(json.message || json.code);
    const existing = Object.keys(json.properties || {});
    const created  = [], existed = [], renamed = [], failed = [];

    for (const [oldName, newName] of Object.entries(FIELD_RENAMES)) {
        if (!existing.includes(oldName)) continue;
        if (existing.includes(newName)) { existed.push(newName); continue; }
        try {
            const patch = await notionReq('PATCH', `databases/${dbId}`, { properties: { [oldName]: { name: newName } } }, token);
            const pJson = JSON.parse(patch.responseText);
            if (pJson.object === 'error') failed.push({ name: oldName, msg: pJson.message || pJson.code });
            else { renamed.push(`${oldName} → ${newName}`); existing.push(newName); }
        } catch (e) { failed.push({ name: oldName, msg: e.message }); }
    }

    for (const [name, schema] of Object.entries(NOTION_SCHEMA)) {
        if (name === 'Nome') { existed.push(name); continue; }
        if (existing.includes(name)) { existed.push(name); continue; }
        try {
            const patch = await notionReq('PATCH', `databases/${dbId}`, { properties: { [name]: schema } }, token);
            const pJson = JSON.parse(patch.responseText);
            if (pJson.object === 'error') failed.push({ name, msg: pJson.message || pJson.code });
            else created.push(name);
        } catch (e) { failed.push({ name, msg: e.message }); }
    }

    return { created, existed, renamed, failed };
}

function translateNotionError(json) {
    const c = json.code || '', m = json.message || '';
    if (c === 'unauthorized')        return 'Token inválido ou sem permissão.';
    if (c === 'restricted_resource') return 'Database não compartilhado com a integração.';
    if (c === 'object_not_found')    return 'Database não encontrado. Confira o ID.';
    if (c === 'validation_error')    return `Campo inválido: ${m}`;
    if (c === 'rate_limited')        return 'Limite de requisições. Aguarde e tente novamente.';
    return `Erro (${c || 'desconhecido'}): ${m}`;
}

// ────────────────────────────────────────────────────────────
// src/05-shopify-csv.js
// ────────────────────────────────────────────────────────────
const SHOPIFY_CSV_HEADERS = [
    'Title','URL handle','Description','Vendor','Product category','Type','Tags',
    'Published on online store','Status','SKU','Barcode',
    'Option1 name','Option1 value','Option1 Linked To',
    'Option2 name','Option2 value','Option2 Linked To',
    'Option3 name','Option3 value','Option3 Linked To',
    'Price','Compare-at price','Cost per item',
    'Charge tax','Tax code',
    'Unit price total measure','Unit price total measure unit',
    'Unit price base measure','Unit price base measure unit',
    'Inventory tracker','Inventory quantity','Continue selling when out of stock',
    'Weight value (grams)','Weight unit for display',
    'Requires shipping','Fulfillment service',
    'Product image URL','Image position','Image alt text','Variant image URL',
    'Gift card','SEO title','SEO description',
    'Color (product.metafields.shopify.color-pattern)',
    'Google Shopping / Google product category',
    'Google Shopping / Gender','Google Shopping / Age group',
    'Google Shopping / Manufacturer part number (MPN)',
    'Google Shopping / Ad group name','Google Shopping / Ads labels',
    'Google Shopping / Condition','Google Shopping / Custom product',
    'Google Shopping / Custom label 0','Google Shopping / Custom label 1',
    'Google Shopping / Custom label 2','Google Shopping / Custom label 3',
    'Google Shopping / Custom label 4',
    'Collection',
];

function mapStatusToShopify(status) {
    return 'draft';
}

function toHandle(name) {
    return (name || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

function csvCell(val) {
    const s = String(val ?? '').replace(/\r/g, '');
    if (s.includes(',') || s.includes('"') || s.includes('\n'))
        return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function buildShopifyCSV(products) {
    const rows = [SHOPIFY_CSV_HEADERS.join(',')];

    for (const p of products) {
        const handle      = toHandle(p.name);
        const status      = mapStatusToShopify(p.status);
        const tagParts = [p.categories || '', p.brand || ''].filter(Boolean);
        const tags        = tagParts.join(', ').replace(/,\s*/g, ', ');
        const price       = p.price ? p.price.toFixed(2) : '';
        const firstImage  = (p.images && p.images[0]) || '';
        const published   = status === 'active' ? 'TRUE' : 'FALSE';

        const mainRow = new Array(SHOPIFY_CSV_HEADERS.length).fill('');
        const set = (col, val) => { mainRow[SHOPIFY_CSV_HEADERS.indexOf(col)] = csvCell(val); };

        set('Title',                     p.name || '');
        set('URL handle',                handle);
        const descHtml = (p.description || '')
            .split('\n\n').filter(Boolean)
            .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
            .join('');

        const specsForDesc = (p.specs || []).map(s => ({
            label: (s.label || '').replace(/:+$/, '').trim(),
            value: s.value || '',
        }));
        const specsHtml = specsForDesc.length
            ? '<h3><strong>ESPECIFICAÇÕES</strong></h3>' +
              specsForDesc.map(s =>
                  `<p><strong>${s.label}</strong><br>${s.value}</p>`
              ).join('')
            : '';

        const skuHtml = p.sku
            ? `<p><strong>SKU</strong><br>${p.sku}</p>`
            : '';

        const disclaimerHtml = '<h6><em> *As descrições e especificações dos produtos são de responsabilidade do fabricante. Não nos responsabilizamos por imprecisões ou inconsistências nas informações ou imagens exibidas. </em></h6>';

        set('Description', descHtml + specsHtml + skuHtml + disclaimerHtml);
        set('Tags',                      tags);
        set('Published on online store', published);
        set('Status',                    status);
        set('SKU',                       p.sku || '');
        set('Price',                     price);
        set('Cost per item',             price);
        set('Charge tax',                'TRUE');
        set('Inventory tracker',         'shopify');
        set('Inventory quantity',        '100');
        set('Continue selling when out of stock', 'DENY');
        set('Requires shipping',         'TRUE');
        set('Fulfillment service',       'manual');
        set('Product image URL',         firstImage);
        set('Image position',            firstImage ? '1' : '');
        set('Gift card',                 'FALSE');
        set('SEO title',                 (p.name || '').slice(0, 70));
        if (p.brand) set('Collection',   p.brand);

        rows.push(mainRow.join(','));

        if (p.images && p.images.length > 1) {
            for (let i = 1; i < p.images.length; i++) {
                const imgRow = new Array(SHOPIFY_CSV_HEADERS.length).fill('');
                const setImg = (col, val) => { imgRow[SHOPIFY_CSV_HEADERS.indexOf(col)] = csvCell(val); };
                setImg('URL handle',      handle);
                setImg('Product image URL', p.images[i]);
                setImg('Image position',  String(i + 1));
                rows.push(imgRow.join(','));
            }
        }
    }

    return rows.join('\r\n');
}

function downloadCSV(csvString, filename) {
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

// ────────────────────────────────────────────────────────────
// src/06-logging.js
// ────────────────────────────────────────────────────────────
const NS_LOG_KEY    = 'ns_log_entries';
const NS_LOG_MAX    = 200;
const PRICE_LOG_MAX = 50;

function getPriceLog(pageId)      { return store.get(`ns_pricelog_${pageId.replace(/-/g,'')}`, []); }
function setPriceLog(pageId, log) { store.set(`ns_pricelog_${pageId.replace(/-/g,'')}`, log); }

function recordPriceLog(pageId, price, status) {
    if (!pageId || !price) return;
    const log  = getPriceLog(pageId);
    const last = log[0];
    if (last && Math.abs(last.price - price) < 0.01 && last.status === status) return;
    log.unshift({ ts: new Date().toISOString(), price, status: status || '' });
    if (log.length > PRICE_LOG_MAX) log.length = PRICE_LOG_MAX;
    setPriceLog(pageId, log);
}

function minPriceLog(pageId) {
    const log = getPriceLog(pageId);
    if (!log.length) return null;
    return log.reduce((m, e) => e.price < m ? e.price : m, log[0].price);
}

function nsLog(type, msg) {
    const entries = store.get(NS_LOG_KEY, []);
    const now  = new Date();
    const time = now.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    entries.unshift({ type, msg, time, ts: now.toISOString() });
    if (entries.length > NS_LOG_MAX) entries.length = NS_LOG_MAX;
    store.set(NS_LOG_KEY, entries);
    const logList = document.getElementById('ns-log-list');
    if (logList) renderLogEntries(logList, entries);
}

function exportLogJSON() {
    const entries = store.get(NS_LOG_KEY, []);
    if (!entries.length) return false;
    const chronological = [...entries].reverse().map(e => ({
        data:      e.ts ? new Date(e.ts).toLocaleString('pt-BR') : (e.time || ''),
        timestamp: e.ts || '',
        tipo:      e.type || 'info',
        mensagem:  e.msg || '',
    }));
    const payload = {
        exportado_em: new Date().toLocaleString('pt-BR'),
        total:        chronological.length,
        entradas:     chronological,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `latinogo_log_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
    return true;
}

function renderLogEntries(container, entries) {
    if (!entries?.length) {
        container.innerHTML = '<div class="ns-log-empty" style="color:#555;text-align:center;padding:16px 0">Nenhum evento registrado.</div>';
        return;
    }
    const colorMap = { error: '#ff5555', warn: '#ffcc00', info: '#888', ok: '#00cc66' };
    container.innerHTML = entries.map(e =>
        `<div style="padding:2px 0;line-height:1.5;color:${colorMap[e.type] || '#888'}">[${e.time}] ${e.msg}</div>`
    ).join('');
}

// ────────────────────────────────────────────────────────────
// src/07-bootstrap.js
// ────────────────────────────────────────────────────────────
function openConfigPanelModal() {
    let panel = document.getElementById('ns-panel');
    if (panel) {
        panel.dispatchEvent(new CustomEvent('ns:destroy'));
        panel.remove();
        return;
    }
    try {
        initPanel({ match: location.hostname, name: 'Config', readySel: '' });
        panel = document.getElementById('ns-panel');
        if (!panel) return;
        panel.querySelectorAll('.ns-tab').forEach(b => b.classList.remove('active'));
        panel.querySelectorAll('.ns-pane').forEach(p => p.classList.remove('active'));
        const syncTab  = panel.querySelector('.ns-tab[data-tab="sync"]');
        const syncPane = panel.querySelector('#ns-pane-sync');
        if (syncTab)  syncTab.style.display = 'none';
        if (syncPane) syncPane.style.display = 'none';
        const configTab  = panel.querySelector('.ns-tab[data-tab="config"]');
        const configPane = panel.querySelector('#ns-pane-config');
        if (configTab)  configTab.classList.add('active');
        if (configPane) configPane.classList.add('active');
    } catch (e) { console.error('[LatinoGo] Erro ao abrir painel config:', e); }
}

function safeInitPanel() {
    if (document.getElementById('ns-panel')) return;
    const activeSite = getSites().find(s => location.href.includes(s.match));
    if (!activeSite) return;
    try { initPanel(activeSite); }
    catch (e) { console.error('[LatinoGo] Erro ao inicializar painel:', e); }
}

if (IS_CONFIG_ONLY) {
    const initConfigPanel = () => {
        if (document.getElementById('ns-panel')) return;
        openConfigPanelModal();
    };
    if (document.body) initConfigPanel();
    else document.addEventListener('DOMContentLoaded', initConfigPanel, { once: true });
} else if (currentSite) {
    if (document.body) safeInitPanel();
    else document.addEventListener('DOMContentLoaded', safeInitPanel, { once: true });
    const _bodyWait = setInterval(() => {
        if (document.body && !document.getElementById('ns-panel')) safeInitPanel();
    }, 300);
    setTimeout(() => clearInterval(_bodyWait), OBS_TIMEOUT_MS);
}

let _lastUrl     = location.href;
let _lastName    = '';
let _reinitTimer = null;

function waitForDomReady(readySel, timeout, cb) {
    if (!readySel || document.querySelector(readySel)) { cb(); return; }
    const start = Date.now();
    const iv = setInterval(() => {
        if (document.querySelector(readySel)) { clearInterval(iv); cb(); }
        else if (Date.now() - start > timeout) { clearInterval(iv); cb(); }
    }, 150);
}

function waitForVVSwiper(timeout, cb) {
    if (!location.href.includes('visaovip.com')) { cb(); return; }
    const productId = location.pathname.split('/').filter(Boolean).pop() || '';
    if (!/^\d+$/.test(productId)) { cb(); return; }
    const start = Date.now();
    const iv = setInterval(() => {
        const img = document.querySelector('.swiper-wrapper img[alt^="Produto"]');
        if (img?.src?.includes(productId)) { clearInterval(iv); cb(); return; }
        if (Date.now() - start > timeout)  { clearInterval(iv); cb(); }
    }, 150);
}

function handleUrlChange() {
    const newUrl = location.href;
    if (newUrl === _lastUrl) return;
    _lastUrl = newUrl;

    const newSite = getSites().find(s => newUrl.includes(s.match));

    if (!newSite) {
        const panelEl = document.getElementById('ns-panel');
        if (panelEl) { panelEl.dispatchEvent(new CustomEvent('ns:destroy')); panelEl.remove(); }
        _lastName = '';
        if (typeof scheduleRadarScan === 'function') scheduleRadarScan(400);
        if (typeof updateRadarFloatingPill === 'function') updateRadarFloatingPill();
        return;
    }

    if (typeof updateRadarFloatingPill === 'function') updateRadarFloatingPill();

    if (_reinitTimer) clearTimeout(_reinitTimer);
    _reinitTimer = setTimeout(() => {
        _reinitTimer = null;
        waitForDomReady(newSite.readySel, 8000, () => {
            waitForVVSwiper(4000, () => {
                const panelEl = document.getElementById('ns-panel');
                if (!panelEl) safeInitPanel();
                else panelEl.dispatchEvent(new CustomEvent('ns:reinit', { detail: scrapeCurrentPage() }));
            });
        });
    }, 300);
}

const _origPush    = history.pushState.bind(history);
const _origReplace = history.replaceState.bind(history);
history.pushState    = (...a) => { _origPush(...a);    handleUrlChange(); };
history.replaceState = (...a) => { _origReplace(...a); handleUrlChange(); };
window.addEventListener('popstate', handleUrlChange);

new MutationObserver(() => handleUrlChange())
    .observe(document.querySelector('head > title') || document.head, { childList: true, subtree: true });

setInterval(() => {
    handleUrlChange();
    if (IS_CONFIG_ONLY) return;
    const panelEl    = document.getElementById('ns-panel');
    const activeSite = getSites().find(s => location.href.includes(s.match));
    if (!panelEl || !activeSite) { if (_lastName) _lastName = ''; return; }
    const titleEl = document.querySelector('h1, h2');
    const currentName = titleEl?.innerText?.trim() || '';
    if (currentName && currentName !== _lastName && _lastName !== '') {
        _lastName = currentName;
        if (_reinitTimer) clearTimeout(_reinitTimer);
        _reinitTimer = setTimeout(() => {
            waitForVVSwiper(4000, () => {
                panelEl.dispatchEvent(new CustomEvent('ns:reinit', { detail: scrapeCurrentPage() }));
                _reinitTimer = null;
            });
        }, 1200);
    } else if (currentName && _lastName === '') {
        _lastName = currentName;
    }
}, 500);

// ────────────────────────────────────────────────────────────
// src/08-styles.js
// ────────────────────────────────────────────────────────────
function injectCSS() {
    if (document.getElementById('ns-style')) return;
    const s = document.createElement('style');
    s.id = 'ns-style';
    s.textContent = `#ns-panel{position:fixed;top:20px;right:20px;width:340px;max-height:92vh;overflow-y:auto;background:#0f0f0f;color:#f0f0f0;border-radius:14px;z-index:999999;font-family:'Segoe UI',sans-serif;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.6);border:1px solid #2a2a2a;touch-action:none}#ns-header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#1a1a1a;border-radius:14px 14px 0 0;cursor:move;user-select:none;border-bottom:1px solid #2a2a2a}.ns-hbtns{display:flex;gap:6px}.ns-icon-btn{background:#2a2a2a;color:#ccc;border:none;border-radius:6px;cursor:pointer;padding:4px 8px;font-size:13px}.ns-icon-btn:hover{background:#3a3a3a}.ns-tabs{display:flex;gap:3px;padding:10px 10px 0;background:#1a1a1a}.ns-tab{flex:1;padding:6px 4px;border:1px solid #2a2a2a;border-bottom:none;background:#0f0f0f;color:#555;font-size:11px;font-weight:600;border-radius:8px 8px 0 0;cursor:pointer;letter-spacing:.3px;transition:all .15s}.ns-tab.active{color:#f0f0f0;border-color:#3a3a3a}.ns-pane{padding:14px 16px;display:none}.ns-pane.active{display:block;animation:ns-fade .18s ease}@keyframes ns-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.ns-card{background:#1a1a1a;border-radius:10px;padding:12px;margin-bottom:12px;border:1px solid #2a2a2a}.ns-card-name{font-size:13px;font-weight:600;color:#f0f0f0;margin-bottom:8px;line-height:1.4}.ns-meta{display:flex;gap:14px;flex-wrap:wrap}.ns-meta-item{font-size:11px;color:#666}.ns-meta-item span{color:#ccc;font-weight:600}.ns-price{color:#00cc66!important;font-size:14px!important}.ns-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.ns-pill{font-size:10px;padding:2px 8px;border-radius:99px;background:#2a2a2a;color:#888}.ns-pill.ok{background:#0d2a1a;color:#00cc66}.ns-tag-pill{background:#2a1a00;color:#ffaa33;font-weight:700}.ns-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.3px;margin-top:10px}.ns-badge-checking{background:#2a2a2a;color:#888}.ns-badge-exists{background:#0d2a1a;color:#00cc66}.ns-badge-new{background:#2a1a1a;color:#ff7755}.ns-badge-noconfig{background:#2a2a1a;color:#ffcc00}.ns-badge-error{background:#2a1a1a;color:#ff5555}.ns-spin{display:inline-block;animation:ns-spin 1s linear infinite}@keyframes ns-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}.ns-stock{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700}.ns-stock-ok{background:#0d2a1a;color:#00cc66}.ns-stock-oferta{background:#2a1f00;color:#ffaa33}.ns-stock-out{background:#2a1a1a;color:#ff5555}.ns-stock-ask{background:#2a2a1a;color:#ffcc00}.ns-db-box{background:#1a1a1a;border-radius:8px;padding:8px 12px;margin-bottom:12px;border:1px solid #2a2a2a;display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap}.ns-db-name{font-weight:600;color:#f0f0f0}.ns-db-account{color:#555;margin-left:auto;font-size:11px}.ns-brand-pill{background:#1a3a2a;color:#00cc66;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}.ns-default-pill{background:#2a2a2a;color:#888;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}.ns-notion-btn{background:#1a1a2a;color:#7788ff;border:1px solid #2a2a4a;border-radius:6px;font-size:11px;padding:4px 10px;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:5px}.ns-notion-btn:hover{background:#2a2a4a}.ns-lbl{font-size:10px;color:#555;letter-spacing:.5px;text-transform:uppercase;display:block;margin-bottom:6px}.ns-cat-wrap{position:relative;margin-bottom:10px}.ns-cat-wrap input{width:100%;padding:7px 10px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#f0f0f0;font-size:12px;outline:none;box-sizing:border-box}.ns-cat-wrap input:focus{border-color:#00cc66}#ns-cat-suggestions{position:absolute;top:100%;left:0;right:0;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:6px;z-index:10;max-height:160px;overflow-y:auto}.ns-sug-item{padding:7px 10px;font-size:12px;cursor:pointer;color:#ccc}.ns-sug-item:hover{background:#2a2a2a}.ns-sug-add{color:#00cc66;font-weight:600}#ns-errdb-db-checks{display:flex;flex-wrap:wrap;gap:5px}#ns-errdb-db-checks label{font-size:11px;color:#ccc;display:flex;align-items:center;gap:4px;cursor:pointer;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:99px;padding:3px 10px}#ns-errdb-db-checks label:hover{border-color:#444}#ns-errdb-db-checks input[type=checkbox]{accent-color:#00cc66;cursor:pointer}#ns-version-badge{font-size:10px;color:#444;font-family:monospace;letter-spacing:.3px;user-select:none}#ns-cat-list{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}.ns-cat-pill-opt{font-size:11px;color:#888;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:99px;padding:3px 10px;cursor:pointer;transition:background .15s,color .15s,border-color .15s;display:inline-flex;align-items:center;gap:4px;position:relative}.ns-cat-pill-opt:hover{background:#2a2a2a;color:#ccc;border-color:#3a3a3a}.ns-cat-del{opacity:0;pointer-events:none;transition:opacity .15s;margin-left:2px;color:#888;font-size:11px;line-height:1;cursor:pointer;padding:0 2px;border-radius:3px}.ns-cat-pill-opt:hover .ns-cat-del{opacity:1;pointer-events:auto}.ns-cat-del:hover{color:#ff4444;background:rgba(255,68,68,.12)}#ns-sync-sticky{position:sticky;bottom:0;background:#0f0f0f;border-top:1px solid #2a2a2a;padding:10px 0 4px;margin-top:8px;z-index:10}#ns-selected-cats-wrap{margin-bottom:8px}#ns-selected-cats{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:2px}.ns-sel-cat-pill{display:inline-flex;align-items:center;font-size:11px;padding:3px 10px;border-radius:99px;background:#0d3a20;color:#00cc66;border:1px solid #00cc6644;font-weight:600;cursor:pointer;transition:background .15s,color .15s}.ns-sel-cat-pill:hover{background:#3a0d0d;color:#ff5555;border-color:#ff555544}#ns-sync-btn{width:100%;padding:10px;background:#00cc66;border:none;color:#000;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;margin-top:4px}#ns-sync-btn:hover{background:#00e874}#ns-sync-btn:disabled{background:#2a2a2a;color:#666;cursor:not-allowed}.ns-confirm{display:flex;gap:6px;margin-top:8px}.ns-btn-no{flex:1;padding:8px;background:#2a2a2a;border:1px solid #3a3a3a;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px}.ns-btn-yes{flex:1;padding:8px;background:#2a1a1a;border:1px solid #3a1a1a;color:#ff7755;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700}.ns-result{display:none;margin-top:10px;padding:8px 12px;border-radius:8px;font-size:12px}.ns-result-ok{background:#0d2a1a;color:#00cc66}.ns-result-error{background:#2a1a1a;color:#ff5555}.ns-result-warn{background:#2a2a1a;color:#ffcc00}.ns-result-info{background:#1a1a2a;color:#7788ff}hr.ns-hr{border:none;border-top:1px solid #2a2a2a;margin:12px 0}.ns-sync-info{font-size:11px;color:#555;margin-top:6px;display:none}.ns-site-badge{font-size:10px;color:#444;text-align:right;margin-bottom:10px}.ns-section-title{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}.ns-add-btn{font-size:11px;padding:3px 10px;background:#2a2a2a;color:#ccc;border:1px solid #3a3a3a;border-radius:6px;cursor:pointer;white-space:nowrap}.ns-add-btn:hover{background:#3a3a3a}.ns-item{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:12px}.ns-item-header{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}.ns-item-name{font-weight:700;color:#f0f0f0;font-size:13px}.ns-item-sub{color:#555;font-size:11px;font-family:monospace}.ns-item-actions{margin-left:auto;display:flex;gap:6px;align-items:center}.ns-open-db-btn{color:#00cc66;font-size:11px;text-decoration:none;padding:0;line-height:1}.ns-open-db-btn:hover{color:#00ff88}.ns-edit-btn{background:none;border:none;color:#7788ff;cursor:pointer;font-size:11px;padding:0}.ns-edit-btn:hover{color:#aabbff}.ns-del-btn{background:none;border:none;color:#ff5555;cursor:pointer;font-size:11px;padding:0}.ns-del-btn:hover{color:#ff7777}.ns-form{background:#1a1a1a;border:1px solid #3a3a3a;border-radius:10px;padding:12px;margin-bottom:8px}.ns-form-row{margin-bottom:8px}.ns-form-row label{display:block;font-size:10px;color:#666;margin-bottom:4px;letter-spacing:.5px}.ns-form-row input,.ns-form-row select,.ns-form-row textarea{width:100%;padding:7px 10px;background:#0f0f0f;border:1px solid #3a3a3a;border-radius:6px;color:#f0f0f0;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit}.ns-form-row input:focus,.ns-form-row select:focus,.ns-form-row textarea:focus{border-color:#00cc66}.ns-form-actions{display:flex;gap:6px;margin-top:10px}.ns-save-btn{flex:1;padding:8px;background:#00cc66;border:none;color:#000;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px}.ns-save-btn:hover{background:#00e874}.ns-cancel-btn{padding:8px 12px;background:#2a2a2a;border:1px solid #3a3a3a;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px}.ns-toggle-row{display:flex;align-items:center;gap:10px;padding:4px 0}.ns-toggle-lbl{font-size:13px;color:#ccc}.ns-switch{position:relative;display:inline-block;width:38px;height:22px;margin-left:auto;flex-shrink:0}.ns-switch input{opacity:0;width:0;height:0}.ns-slider{position:absolute;inset:0;background:#3a3a3a;border-radius:99px;cursor:pointer;transition:background .2s}.ns-slider::before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .2s}.ns-switch input:checked+.ns-slider{background:#00cc66}.ns-switch input:checked+.ns-slider::before{transform:translateX(16px)}.ns-number-row{display:flex;align-items:center;gap:8px;padding:4px 0}.ns-number-row label{font-size:13px;color:#ccc}.ns-number-row input[type=number]{width:60px;padding:5px 8px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:6px;color:#f0f0f0;font-size:13px;outline:none;margin-left:auto}.ns-number-row input[type=number]:focus{border-color:#00cc66}.ns-db-list{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}.ns-db-entry{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;transition:border-color .15s}.ns-db-entry:hover{border-color:#3a3a3a}.ns-db-entry.active{border-color:#00cc66}.ns-db-entry .ns-db-entry-name{font-weight:600;color:#f0f0f0;flex:1}.ns-db-entry .ns-db-entry-acc{color:#555;font-size:10px}.ns-db-entry .ns-db-entry-brand{color:#00cc66;font-size:10px;font-weight:700}.ns-db-entry .ns-check-dot{width:8px;height:8px;border-radius:50%;background:#2a2a2a;flex-shrink:0;transition:background .15s}.ns-db-entry.active .ns-check-dot{background:#00cc66}.ns-gen-table-btn{font-size:11px;padding:4px 10px;background:#1a1a2a;color:#7788ff;border:1px solid #2a2a4a;border-radius:6px;cursor:pointer;font-weight:600;margin-top:6px;width:100%}.ns-gen-table-btn:hover{background:#2a2a4a}.ns-auto-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.ns-auto-filters select{flex:1;min-width:80px;padding:6px 8px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#ccc;font-size:12px;outline:none}.ns-auto-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.ns-auto-header label{font-size:12px;color:#888;display:flex;align-items:center;gap:6px;cursor:pointer}#ns-auto-list{max-height:200px;overflow-y:auto;background:#1a1a1a;border-radius:8px;border:1px solid #2a2a2a;margin-bottom:10px}.ns-auto-item{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-bottom:1px solid #2a2a2a}.ns-auto-item:last-child{border-bottom:none}.ns-auto-item input[type=checkbox]{accent-color:#00cc66;margin-top:2px;flex-shrink:0}.ns-auto-info{flex:1;min-width:0}.ns-auto-name{font-size:12px;color:#f0f0f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ns-auto-meta{font-size:10px;color:#555;margin-top:2px}.ns-auto-empty{padding:16px;text-align:center;color:#555;font-size:12px}.ns-auto-actions{display:flex;gap:6px;margin-bottom:10px}.ns-auto-actions button{flex:1;padding:9px;border-radius:8px;border:1px solid #3a3a3a;cursor:pointer;font-size:12px;font-weight:700}.ns-refresh-btn{background:#2a2a2a;color:#ccc}.ns-refresh-btn:hover{background:#3a3a3a}.ns-migrate-btn{background:#1a2233;color:#7799ff;border-color:#334!important;flex:0!important}.ns-migrate-btn:disabled{opacity:.4;cursor:not-allowed}.ns-auto-actions-2{margin-top:-4px}.ns-auto-actions-2 .ns-migrate-btn{flex:1!important}.ns-migrate-panel{background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:10px 12px;margin-bottom:8px}#ns-auto-log{background:#0a0a0a;border-radius:8px;border:1px solid #2a2a2a;padding:10px 12px;font-size:11px;font-family:monospace;max-height:160px;overflow-y:auto;display:none}.ns-log-line{padding:2px 0;line-height:1.5}.ns-log-ok{color:#00cc66}.ns-log-error{color:#ff5555}.ns-log-info{color:#888}.ns-log-skip{color:#ffcc00}
/* Radar GG — selo nos cards de busca/listagem */
.ns-gg-card-badge{position:absolute;top:10px;left:10px;z-index:25;display:inline-flex;align-items:center;gap:5px;padding:4px 8px 4px 6px;background:rgba(12,12,12,.92);border:1.5px solid #26F03A;border-radius:99px;box-shadow:0 3px 10px rgba(0,0,0,.45);color:#f0f0f0;font-family:'Segoe UI',sans-serif;font-size:10px;font-weight:700;line-height:1;letter-spacing:.2px;text-decoration:none;cursor:pointer;backdrop-filter:blur(4px);transition:transform .15s ease,box-shadow .15s ease,background .15s ease;max-width:calc(100% - 92px)}
.ns-gg-card-badge:hover{transform:translateY(-1px) scale(1.03);background:#0a0a0a;box-shadow:0 4px 14px rgba(38,240,58,.35)}
.ns-gg-card-badge svg{width:18px;height:11px;flex-shrink:0;display:block}
.ns-gg-card-badge-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8ffe9}
.ns-gg-card-badge.is-paused{border-color:#ffaa33}
.ns-gg-card-badge.is-paused .ns-gg-card-badge-label{color:#ffd699}
.ns-gg-card-badge.is-yellow{border-color:#ffcc00}
.ns-gg-card-badge.is-yellow:hover{box-shadow:0 4px 14px rgba(255,204,0,.4)}
.ns-gg-card-badge.is-yellow .ns-gg-card-badge-label{color:#ffe680}
.ns-gg-card-badge.is-yellow svg path{fill:#ffcc00}
.ns-gg-card-highlight{box-shadow:inset 0 0 0 2px rgba(38,240,58,.55)!important}
.ns-gg-card-highlight-yellow{box-shadow:inset 0 0 0 2px rgba(255,204,0,.7)!important}
/* Pill flutuante discreta nas páginas de listagem */
#ns-radar-pill{position:fixed;bottom:16px;right:16px;z-index:999990;display:inline-flex;align-items:center;gap:8px;padding:7px 12px;background:rgba(15,15,15,.94);color:#e8e8e8;border:1px solid #2a2a2a;border-left:3px solid #26F03A;border-radius:99px;font-family:'Segoe UI',sans-serif;font-size:11px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.5);backdrop-filter:blur(6px);user-select:none}
#ns-radar-pill svg{width:20px;height:12px;flex-shrink:0;display:block}
#ns-radar-pill button{background:#222;color:#ccc;border:1px solid #333;border-radius:99px;padding:3px 8px;font-size:11px;cursor:pointer;font-weight:600;line-height:1.2}
#ns-radar-pill button:hover{background:#2e2e2e;color:#fff;border-color:#26F03A}
#ns-radar-pill button:disabled{opacity:.5;cursor:wait}
.ns-radar-status-box{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:11px;color:#999;line-height:1.5}
.ns-radar-status-box strong{color:#26F03A}`;
    document.head.appendChild(s);
}

// ────────────────────────────────────────────────────────────
// src/09-panel-template.js
// ────────────────────────────────────────────────────────────
function buildPanelHTML(product, allCats, extraCats, activeSite) {
    activeSite = activeSite || currentSite;
    const priceStr = product.price ? product.price.toFixed(2).replace('.', ',') : 'Aguardando…';
    const version = GM_info?.script?.version;

    return `
<div id="ns-header">
<div style="display:flex;align-items:center;gap:7px">
${GG_HEADER_LOGO_SVG}
<span id="ns-version-badge">${version ? 'v' + version : ''}</span>
</div>
<div class="ns-hbtns"><button class="ns-icon-btn" id="ns-min-btn" title="Minimizar">—</button></div>
</div>
<div class="ns-tabs">
<button class="ns-tab active" data-tab="sync">Sync</button>
<button class="ns-tab" data-tab="auto">Automação</button>
<button class="ns-tab" data-tab="config">Config</button>
<button class="ns-tab" data-tab="log">Log</button>
</div>
<div class="ns-pane active" id="ns-pane-sync">
<div class="ns-site-badge">📍 ${esc(activeSite.match)}</div>
<div class="ns-card">
<div class="ns-card-name" id="ns-name">${product.name ? esc(product.name) : '<span style="color:#555;font-style:italic">Não encontrado</span>'}</div>
<div class="ns-meta">
<div class="ns-meta-item">COD <span id="ns-sku">${esc(product.sku || '—')}</span></div>
<div class="ns-meta-item">Marca <span id="ns-brand">${esc(product.brand || '—')}</span></div>
<div class="ns-meta-item">R$ <span class="ns-price" id="ns-price">${priceStr}</span></div>
</div>
<div class="ns-pills" id="ns-pills"></div>
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">
<div id="ns-badge" class="ns-badge ns-badge-checking" style="margin-top:0"><span class="ns-spin">⟳</span> Verificando…</div>
<div id="ns-stock" style="display:none"></div>
</div>
<div id="ns-sync-info" class="ns-sync-info"></div>
<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
<button class="ns-notion-btn" id="ns-open-btn" style="display:none">↗ Ver no Notion</button>
<button class="ns-notion-btn" id="ns-imgs-btn" style="display:none;color:#aabbff;border-color:#2a2a4a">⬇ Baixar imagens</button>
<button class="ns-notion-btn" id="ns-csv-btn" style="display:none;color:#88ffcc;border-color:#1a3a2a">⬇ CSV Shopify</button>
</div>
</div>
<div id="ns-db-list" class="ns-db-list" style="display:none"></div>
<span class="ns-lbl">Categorias</span>
<div id="ns-cat-list"></div>
<div id="ns-sync-sticky">
<div id="ns-selected-cats-wrap" style="display:none">
<span class="ns-lbl" style="margin-bottom:4px">Selecionadas</span>
<div id="ns-selected-cats"></div>
</div>
<div class="ns-cat-wrap">
<input type="text" id="ns-cat-input" placeholder="Buscar ou adicionar categoria…" autocomplete="off">
<div id="ns-cat-suggestions" style="display:none"></div>
</div>
<div id="ns-update-all-wrap" style="display:none;margin-bottom:6px">
<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#888;cursor:pointer">
<input type="checkbox" id="ns-update-all" style="accent-color:#00cc66">
Atualizar todos os campos (nome, marca, categorias)
</label>
</div>
<button id="ns-sync-btn">Sincronizar no Notion</button>
<div id="ns-confirm" class="ns-confirm" style="display:none">
<button class="ns-btn-no" id="ns-btn-no">Cancelar</button>
<button class="ns-btn-yes" id="ns-btn-yes">Atualizar mesmo assim</button>
</div>
<div id="ns-result" class="ns-result"></div>
</div>
</div>
<div class="ns-pane" id="ns-pane-auto">
<div class="ns-auto-filters">
<select id="ns-filter-db"><option value="">Databases</option></select>
<select id="ns-filter-brand"><option value="">Marcas</option></select>
<select id="ns-filter-days">
<option value="">Data</option>
<option value="7">+7 dias</option>
<option value="14">+14 dias</option>
<option value="30">+30 dias</option>
</select>
<select id="ns-filter-status">
<option value="">Status</option>
<option value="Em estoque">Em estoque</option>
<option value="Em estoque (Oferta)">Oferta</option>
<option value="Esgotado">Esgotado</option>
<option value="Sob consulta">Sob consulta</option>
</select>
</div>
<input type="text" id="ns-auto-search" placeholder="🔍 Nome ou SKU…" style="width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #2a2a2a;border-radius:8px;padding:7px 10px;font-size:12px;margin-bottom:8px;outline:none">
<div class="ns-auto-header">
<label><input type="checkbox" id="ns-sel-all" style="accent-color:#00cc66"> Selecionar todos</label>
<span id="ns-auto-count" style="font-size:11px;color:#555;margin-left:auto"></span>
</div>
<div id="ns-auto-list"><div class="ns-auto-empty">Carregando…</div></div>
<div class="ns-auto-actions">
<button class="ns-refresh-btn" id="ns-refresh-btn">↺ Atualizar lista</button>
</div>
<div class="ns-auto-actions ns-auto-actions-2">
<button class="ns-migrate-btn" id="ns-migrate-btn" disabled title="Mover selecionados para outra database">⇄ Migrar</button>
<button class="ns-migrate-btn" id="ns-clone-btn" disabled title="Clonar selecionados para outra database (mantém na origem)">⧉ Clonar</button>
<button class="ns-migrate-btn" id="ns-auto-csv-btn" disabled title="Exportar selecionados como CSV Shopify" style="color:#88ffcc;border-color:#1a3a2a!important">⬇ CSV</button>
</div>
<div class="ns-migrate-panel" id="ns-migrate-panel" style="display:none">
<div style="font-size:11px;color:#888;margin-bottom:6px" id="ns-migrate-panel-label">Mover selecionados para:</div>
<select id="ns-migrate-db-sel" style="width:100%;background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:6px"><option value="">Escolha a database destino…</option></select>
<button class="ns-save-btn" id="ns-migrate-confirm-btn" disabled style="width:100%">Confirmar</button>
<div style="font-size:10px;color:#555;margin-top:5px" id="ns-migrate-panel-hint"></div>
</div>
<div id="ns-auto-log"></div>
</div>
<div class="ns-pane" id="ns-pane-config">
<div style="margin-bottom:16px">
<div class="ns-section-title">
<span>Radar GG · Consulta</span>
<div style="display:flex;gap:4px">
<button class="ns-add-btn" id="ns-add-refdb">+ 1</button>
<button class="ns-add-btn" id="ns-bulk-refdb" title="Colar vários links/IDs de uma vez">+ Em lote</button>
</div>
</div>
<div style="font-size:11px;color:#666;margin-bottom:8px;line-height:1.4">Banco somente leitura usado para marcar com a logo GG os produtos que já existem no Notion direto na busca (sem adicionar nem remover itens).</div>
<div class="ns-toggle-row">
<span class="ns-toggle-lbl" style="font-size:12px">Mostrar selo GG nos cards da busca</span>
<label class="ns-switch"><input type="checkbox" id="ns-radar-toggle"><span class="ns-slider"></span></label>
</div>
<div class="ns-toggle-row" style="margin-bottom:8px">
<span class="ns-toggle-lbl" style="font-size:12px">Incluir também Databases de Sync</span>
<label class="ns-switch"><input type="checkbox" id="ns-radar-include-main"><span class="ns-slider"></span></label>
</div>
<div class="ns-radar-status-box">
<div id="ns-radar-status-text">Catálogo ainda não sincronizado.</div>
<button class="ns-gen-table-btn" id="ns-radar-sync-btn" style="margin-top:6px;background:#0d2a1a;color:#26F03A;border-color:#26F03A44">↻ Sincronizar catálogo agora</button>
</div>
<div id="ns-refdbs-list"></div>
<div id="ns-refdb-form" class="ns-form" style="display:none">
<input type="hidden" id="ns-refdb-edit-id">
<div class="ns-form-row"><label>NOME (opcional — busca do Notion se vazio)</label><input type="text" id="ns-refdb-name" placeholder="Ex: Placa Mãe"></div>
<div class="ns-form-row">
<label>LINK OU ID DA DATABASE</label>
<input type="text" id="ns-refdb-link" placeholder="Cole o link ou ID do Notion…">
<div id="ns-refdb-id-preview" style="margin-top:5px;font-size:11px;display:none"></div>
</div>
<input type="hidden" id="ns-refdb-id-val">
<div class="ns-form-row"><label>CONTA VINCULADA</label><select id="ns-refdb-account-sel"></select></div>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-refdb">Cancelar</button>
<button class="ns-save-btn" id="ns-save-refdb">Salvar</button>
</div>
</div>
<div id="ns-refdb-bulk-form" class="ns-form" style="display:none">
<div class="ns-form-row"><label>CONTA VINCULADA</label><select id="ns-refdb-bulk-acc"></select></div>
<div class="ns-form-row">
<label>LINKS OU IDS DAS DATABASES (um por linha ou separados por vírgula)</label>
<textarea id="ns-refdb-bulk-text" rows="5" placeholder="Cole aqui os links ou IDs de todas as suas databases do Notion…"></textarea>
</div>
<div id="ns-refdb-bulk-status" style="font-size:11px;color:#888;margin-bottom:6px;display:none"></div>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-refdb-bulk">Cancelar</button>
<button class="ns-save-btn" id="ns-save-refdb-bulk">Importar todas</button>
</div>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Sites reconhecidos <button class="ns-add-btn" id="ns-add-site">+ Adicionar</button></div>
<div id="ns-sites-list"></div>
<div id="ns-site-form" class="ns-form" style="display:none">
<input type="hidden" id="ns-site-id">
<div class="ns-form-row"><label>NOME</label><input type="text" id="ns-site-name" placeholder="Ex: TopDek"></div>
<div class="ns-form-row"><label>URL DE MATCH</label><input type="text" id="ns-site-match" placeholder="Ex: topdekinformatica.com.br/produto/"></div>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-site">Cancelar</button>
<button class="ns-save-btn" id="ns-save-site">Salvar</button>
</div>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Contas Notion <button class="ns-add-btn" id="ns-add-account">+ Adicionar</button></div>
<div id="ns-accounts-list"></div>
<div id="ns-account-form" class="ns-form" style="display:none">
<input type="hidden" id="ns-account-id">
<div class="ns-form-row"><label>APELIDO</label><input type="text" id="ns-account-name" placeholder="Ex: Pessoal"></div>
<div class="ns-form-row"><label>TOKEN</label><input type="password" id="ns-account-token" placeholder="ntn_…"></div>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-account">Cancelar</button>
<button class="ns-save-btn" id="ns-save-account">Salvar</button>
</div>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Databases <button class="ns-add-btn" id="ns-add-db">+ Adicionar</button></div>
<div id="ns-databases-list"></div>
<div id="ns-db-form" class="ns-form" style="display:none">
<input type="hidden" id="ns-db-edit-id">
<div class="ns-form-row"><label>NOME</label><input type="text" id="ns-db-form-name" placeholder="Ex: GPUs"></div>
<div class="ns-form-row">
<label>LINK OU ID DA DATABASE</label>
<input type="text" id="ns-db-link" placeholder="Cole o link ou ID do Notion…">
<div id="ns-db-id-preview" style="margin-top:5px;font-size:11px;display:none"></div>
</div>
<input type="hidden" id="ns-db-id-val">
<div class="ns-form-row"><label>CONTA VINCULADA</label><select id="ns-db-account-sel"></select></div>
<div class="ns-form-row"><label>MARCAS (vírgula — vazio = default)</label><input type="text" id="ns-db-brands" placeholder="Samsung, LG…"></div>
<div id="ns-db-fields-panel" style="display:none;margin-bottom:10px">
<div style="font-size:11px;color:#888;margin-bottom:6px">Campos da database:</div>
<div id="ns-db-fields-list" style="display:flex;flex-direction:column;gap:3px;font-size:11px"></div>
</div>
<button class="ns-gen-table-btn" id="ns-db-gen-btn-form" style="width:100%;margin-bottom:8px" disabled>⚙ Gerar campos no Notion</button>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-db">Cancelar</button>
<button class="ns-save-btn" id="ns-save-db">Salvar</button>
</div>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Erros <button class="ns-add-btn" id="ns-add-errdb">+ Adicionar</button></div>
<div style="font-size:11px;color:#666;margin-bottom:8px">Produtos com erro no sync/automação são enviados aqui para revisão manual.</div>
<div id="ns-errdbs-list"></div>
<div id="ns-errdb-form" class="ns-form" style="display:none">
<input type="hidden" id="ns-errdb-edit-id">
<div class="ns-form-row"><label>NOME</label><input type="text" id="ns-errdb-form-name" placeholder="Ex: Fila de Erros"></div>
<div class="ns-form-row">
<label>LINK OU ID DA DATABASE</label>
<input type="text" id="ns-errdb-link" placeholder="Cole o link ou ID do Notion…">
<div id="ns-errdb-id-preview" style="margin-top:5px;font-size:11px;display:none"></div>
</div>
<input type="hidden" id="ns-errdb-id-val">
<div class="ns-form-row"><label>CONTA VINCULADA</label><select id="ns-errdb-account-sel"></select></div>
<div class="ns-form-row">
<label>DATABASES MONITORADAS</label>
<div id="ns-errdb-db-checks"></div>
<div style="font-size:10px;color:#555;margin-top:5px">Vazio = captura erros de todas as databases</div>
</div>
<div id="ns-errdb-fields-panel" style="display:none;margin-bottom:10px">
<div style="font-size:11px;color:#888;margin-bottom:6px">Campos da database:</div>
<div id="ns-errdb-fields-list" style="display:flex;flex-direction:column;gap:3px;font-size:11px"></div>
</div>
<button class="ns-gen-table-btn" id="ns-errdb-gen-btn" style="width:100%;margin-bottom:8px" disabled>⚙ Gerar campos no Notion</button>
<div class="ns-form-actions">
<button class="ns-cancel-btn" id="ns-cancel-errdb">Cancelar</button>
<button class="ns-save-btn" id="ns-save-errdb">Salvar</button>
</div>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Comportamento</div>
<div class="ns-toggle-row">
<span class="ns-toggle-lbl">Confirmação ao atualizar</span>
<label class="ns-switch"><input type="checkbox" id="ns-confirm-toggle"><span class="ns-slider"></span></label>
</div>
</div>
<hr class="ns-hr">
<div style="margin-bottom:16px">
<div class="ns-section-title">Backup</div>
<div style="display:flex;gap:6px">
<button class="ns-add-btn" id="ns-export-btn" style="flex:1;text-align:center">⬇ Exportar</button>
<button class="ns-add-btn" id="ns-import-btn" style="flex:1;text-align:center">⬆ Importar</button>
</div>
<input type="file" id="ns-import-file" accept=".json" style="display:none">
</div>
</div>
<div class="ns-pane" id="ns-pane-log">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
<span class="ns-lbl" style="margin-bottom:0">Histórico de erros e eventos</span>
<div style="display:flex;gap:6px">
<button class="ns-add-btn" id="ns-log-export-btn">⬇ Exportar</button>
<button class="ns-add-btn" id="ns-log-clear-btn">🗑 Limpar</button>
</div>
</div>
<div id="ns-log-list" style="background:#0a0a0a;border-radius:8px;border:1px solid #2a2a2a;padding:10px 12px;font-size:11px;font-family:monospace;max-height:420px;overflow-y:auto">
<div class="ns-log-empty" style="color:#555;text-align:center;padding:16px 0">Nenhum evento registrado.</div>
</div>
</div>
    `;
}

// ────────────────────────────────────────────────────────────
// src/10-errors.js
// ────────────────────────────────────────────────────────────
async function sendToErrorDb(name, supplierUrl, errorMsg, srcDbId) {
    const errDbs = getErrorDbs();
    const accs   = getAccounts();
    for (const edb of errDbs) {
        if (edb.dbIds?.length && !edb.dbIds.includes(srcDbId)) continue;
        const acc = accs.find(a => a.id === edb.accountId);
        if (!acc) continue;
        try {
            await notionReq('POST', 'pages', {
                parent: { database_id: toUUID(edb.notionDbId) },
                properties: {
                    'Nome':    { title:     [{ text: { content: (name || 'Sem nome').slice(0, 100) } }] },
                    'Produto': { url:        supplierUrl || null },
                    'Erro':    { rich_text: [{ text: { content: (errorMsg || '').slice(0, 500) } }] },
                    'Data':    { date:       { start: new Date().toISOString() } },
                    'Origem':  { rich_text: [{ text: { content: srcDbId ? (getDatabases().find(d => d.id === srcDbId)?.name || srcDbId) : '—' } }] },
                },
            }, acc.token);
        } catch (e) {
            console.warn('[LatinoGo] sendToErrorDb falhou:', e);
            nsLog('warn', `sendToErrorDb (${edb.name || edb.id}): ${e?.message || e}`);
        }
    }
}

// ────────────────────────────────────────────────────────────
// src/11-panel.js
// ────────────────────────────────────────────────────────────
function initPanel(activeSite) {
    activeSite = activeSite || currentSite;
    injectCSS();

    const ctx = {};
    ctx.product = scrapeCurrentPage();

    const extraCats = getExtraCats();
    const allCats   = [...DEFAULT_CATEGORIES, ...extraCats.filter(c => !DEFAULT_CATEGORIES.includes(c))];

    const panel = document.createElement('div');
    panel.id = 'ns-panel';
    panel.innerHTML = buildPanelHTML(ctx.product, allCats, extraCats, activeSite);
    document.body.appendChild(panel);
    const $  = sel => panel.querySelector(sel);
    const $$ = sel => panel.querySelectorAll(sel);

    ctx.selectedCats = new Set();

    function autoMarkCatsByName(name) {
        if (!name) return;
        const norm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        allCats.forEach(cat => {
            const catNorm = cat.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const words = catNorm.split(/\s+/).filter(w => w.length >= 4 && !CAT_STOP_WORDS.has(w));
            if (!words.length) return;
            const isCompound = catNorm.split(/\s+/).length > 1;
            if (isCompound ? norm.includes(catNorm) : words.some(w => norm.includes(w))) ctx.selectedCats.add(cat);
        });
    }

    autoMarkCatsByName(ctx.product.name);

    function renderPriceLog(pageId) {
        let wrap = $('#ns-price-log-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'ns-price-log-wrap';
            wrap.style.cssText = 'margin:6px 0 2px;font-size:10px;color:#666;font-family:monospace;line-height:1.6';
            const badge = $('#ns-badge');
            if (badge?.parentNode) badge.parentNode.insertBefore(wrap, badge.nextSibling);
        }
        const log = getPriceLog(pageId);
        if (!log.length) { wrap.innerHTML = ''; return; }
        const minP  = log.reduce((m, e) => e.price < m ? e.price : m, log[0].price);
        const fmtDt = s => { const d = new Date(s); return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; };
        const rows  = log.slice(0, 5).map((e, i) => {
            const prev  = log[i + 1];
            const arrow = prev ? (e.price > prev.price ? ' <span style="color:#ff5555">▲</span>' : e.price < prev.price ? ' <span style="color:#00cc66">▼</span>' : '') : '';
            return `<span style="color:#555">${fmtDt(e.ts)}</span> ${fmtBRL(e.price)}${arrow}`;
        });
        const minNote = `<span style="color:#ffaa00">★ mín: ${fmtBRL(minP)}</span>`;
        wrap.innerHTML = `<div style="margin-bottom:2px">${minNote} &nbsp;·&nbsp; últimos ${log.length > 5 ? '5/' + log.length : log.length} preços</div>${rows.join('<br>')}`;
    }

    ctx.existingPage = null;
    ctx.resolution   = null;
    ctx.dbs          = getDatabases();
    ctx.accounts     = getAccounts();
    const _panelObs  = [];

    $$('.ns-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.ns-tab').forEach(b => b.classList.remove('active'));
            $$('.ns-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            $(`#ns-pane-${btn.dataset.tab}`).classList.add('active');
            if (btn.dataset.tab === 'auto') loadAutoList();
            if (btn.dataset.tab === 'config') updateRadarStatusUI();
            if (btn.dataset.tab === 'log') {
                const logList = $('#ns-log-list');
                if (logList) renderLogEntries(logList, store.get(NS_LOG_KEY, []));
            }
        });
    });

    const logClearBtn = $('#ns-log-clear-btn');
    if (logClearBtn) logClearBtn.addEventListener('click', () => {
        store.set(NS_LOG_KEY, []);
        const logList = $('#ns-log-list');
        if (logList) renderLogEntries(logList, []);
    });

    const logExportBtn = $('#ns-log-export-btn');
    if (logExportBtn) logExportBtn.addEventListener('click', () => {
        if (!exportLogJSON()) alert('Nenhum evento registrado para exportar.');
    });

    let minimized = false;
    $('#ns-min-btn').addEventListener('click', () => {
        minimized = !minimized;
        $$('.ns-tabs, .ns-pane').forEach(el => el.style.display = minimized ? 'none' : '');
        $('#ns-min-btn').textContent = minimized ? '□' : '—';
    });

    let dragging = false, ox = 0, oy = 0, rafId = null, px = 0, py = 0;
    $('#ns-header').addEventListener('mousedown', e => {
        if (e.target.closest('.ns-icon-btn')) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        panel.style.right = 'auto'; e.preventDefault();
    });
    function _onMouseMove(e) {
        if (!dragging) return;
        px = e.clientX - ox; py = e.clientY - oy;
        if (!rafId) rafId = requestAnimationFrame(() => { panel.style.left = px + 'px'; panel.style.top = py + 'px'; rafId = null; });
    }
    function _onMouseUp() { dragging = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup',   _onMouseUp);

    panel.addEventListener('ns:destroy', () => {
        document.removeEventListener('mousemove', _onMouseMove);
        document.removeEventListener('mouseup',   _onMouseUp);
        _panelObs.forEach(o => { try { o.disconnect(); } catch {} });
        _panelObs.length = 0;
    }, { once: true });

    if (url.includes('visaovip.com/prod/')) {
        function tryLoadSpecs() {
            if (ctx.product.specs.length) return true;
            const rows = extractVisaoVipSpecs();
            if (!rows.length) return false;
            ctx.product.specs = rows;
            renderPills(ctx.product);
            return true;
        }
        if (!tryLoadSpecs()) {
            const specsObs = new MutationObserver(() => { if (tryLoadSpecs()) { specsObs.disconnect(); _panelObs.splice(_panelObs.indexOf(specsObs), 1); } });
            specsObs.observe(document.body, { childList: true, subtree: true });
            _panelObs.push(specsObs);
            setTimeout(() => { specsObs.disconnect(); _panelObs.splice(_panelObs.indexOf(specsObs), 1); }, OBS_TIMEOUT_MS);
        }
        if (!ctx.product.price) {
            const priceObs = new MutationObserver(() => {
                const el = document.querySelector('.border-round-2xl .text-vip:not(.font-medium)');
                if (!el) return;
                const p = extractPrice(el.innerText);
                if (!p) return;
                ctx.product.price = p;
                const priceEl = $('#ns-price');
                if (priceEl) priceEl.textContent = p.toFixed(2).replace('.', ',');
                renderPills(ctx.product);
                setStock(ctx.product.status);
                priceObs.disconnect(); _panelObs.splice(_panelObs.indexOf(priceObs), 1);
            });
            priceObs.observe(document.body, { childList: true, subtree: true });
            _panelObs.push(priceObs);
            setTimeout(() => { priceObs.disconnect(); _panelObs.splice(_panelObs.indexOf(priceObs), 1); }, OBS_TIMEOUT_MS);
        }
    }

    if (url.includes('atacadocollections.com/produto/') && !ctx.product.images.length) {
        const acColObs = new MutationObserver(() => {
            if (!document.querySelector('.swiper.is-original')) return;
            const origin2 = window.location.origin;
            const imgs = [...document.querySelectorAll('.swiper.is-original .swiper-slide:not(.swiper-slide-duplicate) a.link img')]
                .map(img => { const src = img.getAttribute('data-original') || img.getAttribute('src') || ''; if (!src) return null; return src.startsWith('http') ? src : `${origin2}/${src.replace(/^\//, '')}`; })
                .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, IMG_LIMIT);
            if (!imgs.length) return;
            ctx.product.images = imgs;
            renderPills(ctx.product);
            acColObs.disconnect(); _panelObs.splice(_panelObs.indexOf(acColObs), 1);
        });
        acColObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        _panelObs.push(acColObs);
        setTimeout(() => { acColObs.disconnect(); _panelObs.splice(_panelObs.indexOf(acColObs), 1); }, OBS_TIMEOUT_MS);
    }

    if (url.includes('atacadoconnect.com/produto/') && !ctx.product.price) {
        const acObs = new MutationObserver(() => {
            const el = [...document.querySelectorAll('.page-module__P-0F3q__priceValue')].find(e => e.innerText.includes('R$'));
            if (!el) return;
            const p = extractPrice(el.innerText);
            if (!p) return;
            ctx.product.price = p;
            const priceEl = $('#ns-price');
            if (priceEl) priceEl.textContent = p.toFixed(2).replace('.', ',');
            renderPills(ctx.product);
            setStock(ctx.product.status);
            acObs.disconnect(); _panelObs.splice(_panelObs.indexOf(acObs), 1);
        });
        acObs.observe(document.body, { childList: true, subtree: true });
        _panelObs.push(acObs);
        setTimeout(() => { acObs.disconnect(); _panelObs.splice(_panelObs.indexOf(acObs), 1); }, OBS_TIMEOUT_MS);
    }

    function renderPills(p) {
        const el = $('#ns-pills');
        if (!el) return;
        const pills = [
            { label: `🖼 ${p.images.length} imagem${p.images.length !== 1 ? 'ns' : ''}`, ok: p.images.length > 0 },
            { label: `📋 ${p.specs.length} specs`, ok: p.specs.length > 0 },
            { label: p.description ? '📝 Descrição' : '📝 Sem descrição', ok: !!p.description },
        ].map(i => `<span class="ns-pill${i.ok ? ' ok' : ''}">${i.label}</span>`).join('');
        const tagPills = (p.tags || []).filter(t => t !== 'OFERTA').map(t => `<span class="ns-pill ns-tag-pill">${esc(t)}</span>`).join('');
        el.innerHTML = pills + tagPills;
        const btn = $('#ns-imgs-btn');
        if (!btn) return;
        btn.style.display = p.images.length ? 'inline-flex' : 'none';
        if (p.images.length) btn.textContent = `⬇ Baixar imagens (${p.images.length})`;

        const csvBtn = $('#ns-csv-btn');
        if (csvBtn) csvBtn.style.display = p.name ? 'inline-flex' : 'none';
    }
    renderPills(ctx.product);

    function setStock(status) {
        const el = $('#ns-stock');
        if (!el) return;
        if (!status) { el.style.display = 'none'; return; }
        const map = { 'Em estoque': 'ns-stock-ok', 'Em estoque (Oferta)': 'ns-stock-oferta', 'Esgotado': 'ns-stock-out', 'Sob consulta': 'ns-stock-ask' };
        const displayStatus = ctx.product.tags?.includes('OFERTA') && status === 'Em estoque' ? 'Em estoque (Oferta)' : status;
        el.style.display = 'block';
        el.innerHTML = `<span class="ns-stock ${map[displayStatus] || 'ns-stock-ok'}">● ${esc(displayStatus)}</span>`;
    }
    setStock(ctx.product.status);

    function setBadge(type, text) { const b = $('#ns-badge'); if (!b) return; b.className = `ns-badge ns-badge-${type}`; b.innerHTML = text; }
    function setSyncInfo(text)    { const el = $('#ns-sync-info'); if (!el) return; el.style.display = text ? 'block' : 'none'; el.innerHTML = text; }
    function setResult(type, text){ const el = $('#ns-result'); if (!el) return; el.className = `ns-result${type ? ' ns-result-' + type : ''}`; el.style.display = text ? 'block' : 'none'; el.innerHTML = text; }

    function applyExistingState(found) {
        ctx.existingPage = found || null;
        const updateAllWrap = $('#ns-update-all-wrap');
        if (ctx.existingPage) {
            setBadge('exists', '✓ Já existe no Notion');
            const dt = ctx.existingPage.last_edited_time ? new Date(ctx.existingPage.last_edited_time).toLocaleString('pt-BR') : '—';
            setSyncInfo(`Última edição: ${dt}`);
            if (updateAllWrap) updateAllWrap.style.display = 'block';
            renderPriceLog(ctx.existingPage.id);
        } else {
            setBadge('new', '✦ Produto novo');
            setSyncInfo('');
            if (updateAllWrap) updateAllWrap.style.display = 'none';
            const priceLogWrap = $('#ns-price-log-wrap');
            if (priceLogWrap) priceLogWrap.innerHTML = '';
        }
    }

    async function verifyExisting() {
        ctx.dbs      = getDatabases();
        ctx.accounts = getAccounts();
        if (!ctx.dbs.length || !ctx.accounts.length) { setBadge('noconfig', '⚙️ Configure databases e campos'); return; }

        ctx.resolution = resolveDatabase(ctx.product.brand);
        if (!ctx.resolution) {
            const fallbackDb  = ctx.dbs.find(d => ctx.accounts.some(a => a.id === d.accountId));
            const fallbackAcc = fallbackDb ? ctx.accounts.find(a => a.id === fallbackDb.accountId) : null;
            if (fallbackDb && fallbackAcc) ctx.resolution = { db: fallbackDb, account: fallbackAcc, fields: getFields(fallbackDb.id) };
            else { setBadge('noconfig', '⚙️ Configure databases e campos'); return; }
        }

        const productBrand = (ctx.product.brand || '').toLowerCase().trim();
        const visibleDbs   = !productBrand ? ctx.dbs : ctx.dbs.filter(d => d.isDefault || d.brands?.some(b => b.toLowerCase().trim() === productBrand));
        const dbsToShow    = visibleDbs.length ? visibleDbs : ctx.dbs;

        const dbListEl = $('#ns-db-list');
        if (dbListEl) {
            dbListEl.style.display = 'flex';
            dbListEl.innerHTML = dbsToShow.map(d => {
                const acc        = ctx.accounts.find(a => a.id === d.accountId);
                const isRes      = d.id === ctx.resolution.db.id;
                const brandLabel = d.isDefault ? 'default' : (d.brands?.join(', ') || 'default');
                return `<div class="ns-db-entry${isRes ? ' active' : ''}" data-dbid="${d.id}" title="${esc(brandLabel)}">
                    <span class="ns-check-dot"></span>
                    <span class="ns-db-entry-name">${esc(d.name)}</span>
                    <span class="ns-db-entry-brand">${esc(brandLabel)}</span>
                    <span class="ns-db-entry-acc">${esc(acc?.name || '—')}</span>
                    <span class="ns-db-entry-checking" style="font-size:10px;color:#555"><span class="ns-spin">⟳</span></span>
                </div>`;
            }).join('');

            dbListEl.querySelectorAll('.ns-db-entry').forEach(entry => {
                entry.addEventListener('click', async () => {
                    dbListEl.querySelectorAll('.ns-db-entry').forEach(e => e.classList.remove('active'));
                    entry.classList.add('active');
                    const selDb  = ctx.dbs.find(d => d.id === entry.dataset.dbid);
                    const selAcc = ctx.accounts.find(a => a.id === selDb?.accountId);
                    if (!selDb || !selAcc) return;
                    ctx.resolution = { db: selDb, account: selAcc, fields: getFields(selDb.id) };

                    applyExistingState(_dbResults[selDb.id] || null);

                    setBadge('checking', '<span class="ns-spin">⟳</span> Confirmando…');
                    try {
                        const found = await notionFindExisting(ctx.product, selDb, selAcc.token);
                        _dbResults[selDb.id] = found || null;
                        if (ctx.resolution.db.id === selDb.id) applyExistingState(found);
                    } catch (e) {
                        console.warn('[LatinoGo] re-check tabela selecionada:', e);
                        if (ctx.resolution.db.id === selDb.id) applyExistingState(_dbResults[selDb.id] || null);
                    }
                });
            });
        }

        setBadge('checking', '<span class="ns-spin">⟳</span> Verificando…');
        const _dbResults = {};

        await Promise.all(dbsToShow.map(async d => {
            const acc     = ctx.accounts.find(a => a.id === d.accountId);
            const entryEl = dbListEl?.querySelector(`.ns-db-entry[data-dbid="${d.id}"]`);
            const spinner = entryEl?.querySelector('.ns-db-entry-checking');
            if (!acc) { if (spinner) spinner.innerHTML = ''; return; }
            try {
                const found = await notionFindExisting(ctx.product, d, acc.token);
                _dbResults[d.id] = found || null;
                if (spinner) {
                    if (found) { const pageUrl = found.url || `https://notion.so/${found.id.replace(/-/g, '')}`; spinner.innerHTML = `<a href="${pageUrl}" target="_blank" style="color:#7788ff;text-decoration:none;font-size:11px" title="Ver no Notion">↗</a>`; }
                    else spinner.innerHTML = '';
                }
            } catch (e) { console.warn('[LatinoGo] checkExisting:', e); if (spinner) spinner.innerHTML = '<span style="color:#ff5555;font-size:10px">✕</span>'; }
        }));

        const existingDbId = _dbResults[ctx.resolution.db.id]
            ? ctx.resolution.db.id
            : dbsToShow.map(d => d.id).find(id => _dbResults[id]);

        if (existingDbId && existingDbId !== ctx.resolution.db.id) {
            const selDb  = ctx.dbs.find(d => d.id === existingDbId);
            const selAcc = selDb ? ctx.accounts.find(a => a.id === selDb.accountId) : null;
            if (selDb && selAcc) {
                ctx.resolution = { db: selDb, account: selAcc, fields: getFields(selDb.id) };
                if (dbListEl) dbListEl.querySelectorAll('.ns-db-entry').forEach(e =>
                    e.classList.toggle('active', e.dataset.dbid === existingDbId));
            }
        }

        applyExistingState(_dbResults[ctx.resolution.db.id] || null);
        const openBtn = $('#ns-open-btn');
        if (openBtn) openBtn.style.display = 'none';
    }
    const _verifyTimer = setTimeout(verifyExisting, 500);
    panel.addEventListener('ns:destroy', () => clearTimeout(_verifyTimer), { once: true });

    panel.addEventListener('ns:reinit', (e) => {
        const fresh = e.detail;
        ctx.product = Object.assign({}, fresh);
        ctx.product.images = [];
        ctx.product.status = ctx.product.status || 'Em estoque';

        const priceStr = ctx.product.price ? ctx.product.price.toFixed(2).replace('.', ',') : 'Aguardando…';
        const nameEl  = $('#ns-name');
        const priceEl = $('#ns-price');
        const skuEl   = $('#ns-sku');
        const brandEl = $('#ns-brand');
        if (nameEl)  nameEl.textContent  = ctx.product.name  || '—';
        if (priceEl) priceEl.textContent = priceStr;
        if (skuEl)   skuEl.textContent   = ctx.product.sku   || '—';
        if (brandEl) brandEl.textContent = ctx.product.brand || '—';

        renderPills(ctx.product);
        setStock(ctx.product.status);
        setResult('', '');
        setSyncInfo('');

        ctx.selectedCats.clear();
        autoMarkCatsByName(ctx.product.name);
        renderCatList();
        renderSelectedCats();
        setBadge('checking', '<span class="ns-spin">⟳</span> Verificando…');
        const dbListEl2 = $('#ns-db-list');
        if (dbListEl2) dbListEl2.style.display = 'none';
        const openBtn = $('#ns-open-btn');
        if (openBtn) openBtn.style.display = 'none';

        ctx.existingPage = null;
        ctx.resolution   = null;
        ctx.autoProducts = [];
        const updateAllWrap = $('#ns-update-all-wrap');
        if (updateAllWrap) { updateAllWrap.style.display = 'none'; $('#ns-update-all').checked = false; }
        verifyExisting();

        if (location.href.includes('visaovip.com/prod/')) {
            const _slug = location.pathname.split('/').filter(Boolean)[2] || '';
            const vvImgObs = new MutationObserver(() => {
                const slides = document.querySelectorAll('.swiper-wrapper img[alt^="Produto"]');
                if (!slides.length) return;
                const imgs = [...slides]
                    .map(el => el.src || el.dataset.src)
                    .filter(s => s && !s.includes('data:') && !s.endsWith('.svg') && (!_slug || s.includes(_slug)))
                    .filter((v, i, a) => a.indexOf(v) === i).slice(0, IMG_LIMIT);
                if (!imgs.length) return;
                ctx.product.images = imgs;
                renderPills(ctx.product);
                vvImgObs.disconnect();
            });
            vvImgObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
            setTimeout(() => vvImgObs.disconnect(), VV_IMG_TIMEOUT_MS);
        }
    });

    $('#ns-imgs-btn').addEventListener('click', async () => {
        if (!ctx.product.images.length) { setResult('warn', 'Nenhuma imagem encontrada.'); return; }
        const base = (ctx.product.name || 'produto').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 40).toLowerCase();
        const detectRealExt = async (blob, fallback) => {
            try {
                const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
                if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
                if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
                if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
                    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
                if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
            } catch {}
            const mimeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
            if (blob?.type && mimeMap[blob.type.toLowerCase()]) return mimeMap[blob.type.toLowerCase()];
            return fallback || 'jpg';
        };
        const downloadOne = (src, i) => new Promise(resolve => {
            const urlExt = src.split('?')[0].split('.').pop().replace(/[^a-z]/gi, '').toLowerCase() || 'jpg';
            GM_xmlhttpRequest({
                method: 'GET', url: src, responseType: 'blob',
                onload: async r => {
                    const ext = await detectRealExt(r.response, urlExt);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(r.response);
                    a.download = `${base}_${String(i + 1).padStart(2, '0')}.${ext}`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                    resolve();
                },
                onerror: () => { window.open(src, '_blank'); resolve(); },
            });
        });
        setResult('ok', `⬇ Baixando ${ctx.product.images.length} imagem(ns)…`);
        const imgs = ctx.product.images;
        for (let i = 0; i < imgs.length; i += 3) {
            await Promise.all(imgs.slice(i, i + 3).map((src, j) => downloadOne(src, i + j)));
        }
        nsLog('ok', `Imagens: ${imgs.length} baixada(s) — ${ctx.product.name || 'produto'}`);
    });

    $('#ns-csv-btn').addEventListener('click', () => {
        if (!ctx.product.name) { setResult('warn', 'Produto não identificado.'); return; }
        const categories = [...ctx.selectedCats].join(', ');
        const csv = buildShopifyCSV([{ ...ctx.product, categories }]);
        const filename = `${toHandle(ctx.product.name)}_shopify.csv`;
        downloadCSV(csv, filename);
        nsLog('ok', `CSV: ${ctx.product.name} → ${filename}`);
        setResult('ok', `✅ CSV gerado: ${esc(filename)}`);
    });

    function getCatList() {
        return [...new Set([...allCats, ...getExtraCats()])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function renderCatList() {
        const list = $('#ns-cat-list');
        if (!list) return;
        const unselected = getCatList().filter(c => !ctx.selectedCats.has(c));
        list.innerHTML = unselected.map(c => {
            const isExtra = getExtraCats().includes(c);
            const delBtn  = isExtra ? `<span class="ns-cat-del" data-cat="${esc(c)}" title="Remover categoria">×</span>` : '';
            return `<span class="ns-cat-pill-opt" data-cat="${esc(c)}">${esc(c)}${delBtn}</span>`;
        }).join('');
        list.querySelectorAll('.ns-cat-pill-opt').forEach(pill => {
            pill.addEventListener('click', e => {
                if (e.target.classList.contains('ns-cat-del')) return;
                ctx.selectedCats.add(pill.dataset.cat);
                renderCatList();
                renderSelectedCats();
            });
        });
        list.querySelectorAll('.ns-cat-del').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const name = btn.dataset.cat;
                const extras = getExtraCats().filter(c => c !== name);
                setExtraCats(extras);
                allCats.splice(allCats.indexOf(name), 1);
                ctx.selectedCats.delete(name);
                renderCatList();
                renderSelectedCats();
            });
        });
    }

    function renderSelectedCats() {
        const wrap = $('#ns-selected-cats-wrap');
        const cont = $('#ns-selected-cats');
        if (!wrap || !cont) return;
        if (!ctx.selectedCats.size) { wrap.style.display = 'none'; cont.innerHTML = ''; return; }
        wrap.style.display = 'block';
        cont.innerHTML = [...ctx.selectedCats].map(c =>
            `<span class="ns-sel-cat-pill" data-cat="${esc(c)}">${esc(c)}</span>`
        ).join('');
        cont.querySelectorAll('.ns-sel-cat-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                ctx.selectedCats.delete(pill.dataset.cat);
                renderCatList();
                renderSelectedCats();
            });
        });
    }

    function addCategory(name) {
        name = name.trim(); if (!name) return false;
        const allNow = getCatList();
        const match  = allNow.find(c => c.toLowerCase() === name.toLowerCase());
        if (match) {
            ctx.selectedCats.add(match);
            renderCatList();
            renderSelectedCats();
            return false;
        }
        const extras = getExtraCats();
        if (!extras.includes(name)) { extras.push(name); setExtraCats(extras); allCats.push(name); }
        ctx.selectedCats.add(name);
        renderCatList();
        renderSelectedCats();
        return true;
    }

    (function initCatSearch() {
        const input = $('#ns-cat-input');
        const sugs  = $('#ns-cat-suggestions');

        function renderSugs(q) {
            sugs.innerHTML = ''; if (!q) { sugs.style.display = 'none'; return; }
            const ql       = q.toLowerCase();
            const all      = getCatList();
            const filtered = all.filter(c => c.toLowerCase().includes(ql) && !ctx.selectedCats.has(c));
            const exact    = all.some(c => c.toLowerCase() === ql);
            if (!filtered.length && exact) { sugs.style.display = 'none'; return; }
            sugs.style.display = 'block';
            if (!exact) {
                const add = document.createElement('div');
                add.className = 'ns-sug-item ns-sug-add';
                add.textContent = `+ Adicionar "${q}"`;
                add.addEventListener('click', () => { addCategory(q); input.value = ''; sugs.style.display = 'none'; });
                sugs.appendChild(add);
            }
            filtered.forEach(cat => {
                const item = document.createElement('div');
                item.className = 'ns-sug-item';
                item.textContent = cat;
                item.addEventListener('click', () => { ctx.selectedCats.add(cat); renderCatList(); renderSelectedCats(); input.value = ''; sugs.style.display = 'none'; });
                sugs.appendChild(item);
            });
        }

        input.addEventListener('input', () => renderSugs(input.value.trim()));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); addCategory(input.value.trim()); input.value = ''; sugs.style.display = 'none'; }
            if (e.key === 'Escape') { sugs.style.display = 'none'; input.value = ''; }
        });
        const _onOutside = e => { if (!e.target.closest('.ns-cat-wrap') && !e.target.closest('#ns-sync-sticky')) sugs.style.display = 'none'; };
        document.addEventListener('click', _onOutside);
        panel.addEventListener('ns:destroy', () => document.removeEventListener('click', _onOutside), { once: true });
    })();

    renderCatList();
    renderSelectedCats();

    const cfg = getConfig();
    $('#ns-confirm-toggle').checked = cfg.confirmOnUpdate;
    $('#ns-confirm-toggle').addEventListener('change', function () { const c = getConfig(); c.confirmOnUpdate = this.checked; setConfig(c); });

    // ── Config do Radar GG (Databases de Consulta) ──
    $('#ns-radar-toggle').checked = cfg.radarEnabled !== false;
    $('#ns-radar-toggle').addEventListener('change', function () {
        const c = getConfig(); c.radarEnabled = this.checked; setConfig(c);
        if (this.checked) scheduleRadarScan(100);
        else clearAllRadarBadges();
        updateRadarFloatingPill();
    });

    $('#ns-radar-include-main').checked = cfg.includeMainDbsInRadar !== false;
    $('#ns-radar-include-main').addEventListener('change', function () {
        const c = getConfig(); c.includeMainDbsInRadar = this.checked; setConfig(c);
        updateRadarStatusUI();
    });

    function updateRadarStatusUI(customMsg) {
        const el = $('#ns-radar-status-text');
        if (!el) return;
        if (customMsg) { el.innerHTML = customMsg; return; }
        const cache = getCatalogCache();
        if (!cache || !cache.updatedAt) {
            el.innerHTML = 'Catálogo ainda não sincronizado. Clique abaixo para indexar.';
            return;
        }
        const mins = Math.max(0, Math.round((Date.now() - cache.updatedAt) / 60000));
        const age  = mins < 1 ? 'agora mesmo' : mins < 60 ? `há ${mins} min` : `há ${Math.round(mins / 60)}h`;
        el.innerHTML = `<strong>${cache.totalProducts || 0}</strong> produto(s) em <strong>${cache.totalDbs || 0}</strong> database(s)<br><span style="color:#666">Atualizado ${age}</span>`;
    }

    $('#ns-radar-sync-btn').addEventListener('click', async function () {
        this.disabled = true;
        this.textContent = '⟳ Sincronizando catálogo…';
        try {
            const cache = await syncCatalogIndex((done, total, dbName) => {
                updateRadarStatusUI(`Sincronizando <strong>${done}/${total}</strong> (${esc(dbName)})…`);
            });
            updateRadarStatusUI();
            scheduleRadarScan(50);
            updateRadarFloatingPill();
            nsLog('ok', `Radar GG: ${cache.totalProducts} produto(s) indexados de ${cache.totalDbs} database(s)`);
        } catch (e) {
            updateRadarStatusUI(`<span style="color:#ff5555">Erro: ${esc(e.message || e)}</span>`);
            nsLog('error', `Radar GG sync: ${e.message || e}`);
        } finally {
            this.disabled = false;
            this.textContent = '↻ Sincronizar catálogo agora';
        }
    });

    function renderRefDbs() {
        const list   = $('#ns-refdbs-list');
        if (!list) return;
        const refDbs = getRefDbs();
        const accs   = getAccounts();
        list.innerHTML = refDbs.length
            ? refDbs.map(d => {
                const acc = accs.find(a => a.id === d.accountId);
                return `<div class="ns-item"><div class="ns-item-header"><span class="ns-item-name">${esc(d.name)}</span><div class="ns-item-actions"><a href="https://notion.so/${(d.notionDbId || '').replace(/-/g,'')}" target="_blank" class="ns-open-db-btn" title="Abrir no Notion">↗</a><button class="ns-edit-btn" data-id="${d.id}" data-type="refdb">✎</button><button class="ns-del-btn" data-id="${d.id}" data-type="refdb">✕</button></div></div><div class="ns-item-sub">${esc(acc?.name || '—')} · ${d.notionDbId?.slice(0, 8) || '?'}… · somente leitura</div></div>`;
              }).join('')
            : '<div style="color:#555;font-size:12px;padding:4px 0">Nenhuma database de consulta extra.</div>';
        list.querySelectorAll('.ns-edit-btn[data-type=refdb]').forEach(btn => btn.addEventListener('click', () => openRefDbForm(getRefDbs().find(d => d.id === btn.dataset.id))));
        list.querySelectorAll('.ns-del-btn[data-type=refdb]').forEach(btn => btn.addEventListener('click', () => {
            setRefDbs(getRefDbs().filter(d => d.id !== btn.dataset.id));
            renderRefDbs();
        }));
    }

    function openRefDbForm(db) {
        const accs = getAccounts();
        const sel  = $('#ns-refdb-account-sel');
        sel.innerHTML = accs.map(a => `<option value="${a.id}"${db?.accountId === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
        $('#ns-refdb-edit-id').value = db?.id         || '';
        $('#ns-refdb-name').value    = db?.name       || '';
        $('#ns-refdb-link').value    = db?.notionDbId || '';
        $('#ns-refdb-id-val').value  = db?.notionDbId || '';
        const preview = $('#ns-refdb-id-preview');
        if (db?.notionDbId) { preview.style.display = 'block'; preview.textContent = `ID: ${db.notionDbId}`; preview.style.color = '#00cc66'; }
        else preview.style.display = 'none';
        $('#ns-refdb-bulk-form').style.display = 'none';
        $('#ns-refdb-form').style.display = 'block';
    }

    $('#ns-refdb-link').addEventListener('input', function () {
        const id = extractNotionId(this.value);
        const preview = $('#ns-refdb-id-preview');
        $('#ns-refdb-id-val').value = id || '';
        if (id) { preview.style.display = 'block'; preview.textContent = `ID: ${id}`; preview.style.color = '#00cc66'; }
        else    { preview.style.display = this.value ? 'block' : 'none'; preview.textContent = this.value ? 'ID não reconhecido' : ''; preview.style.color = '#ff5555'; }
    });

    $('#ns-add-refdb').addEventListener('click', () => openRefDbForm(null));
    $('#ns-cancel-refdb').addEventListener('click', () => { $('#ns-refdb-form').style.display = 'none'; });
    $('#ns-save-refdb').addEventListener('click', async function () {
        const id         = $('#ns-refdb-edit-id').value;
        let name         = $('#ns-refdb-name').value.trim();
        const notionDbId = $('#ns-refdb-id-val').value.trim();
        const accountId  = $('#ns-refdb-account-sel').value;
        if (!notionDbId || !accountId) { alert('Informe um link/ID válido e a conta Notion.'); return; }
        if (!name) {
            const acc = getAccounts().find(a => a.id === accountId);
            if (acc) {
                this.disabled = true; this.textContent = 'Buscando nome…';
                try {
                    const res  = await notionReq('GET', `databases/${notionDbId}`, null, acc.token);
                    const json = JSON.parse(res.responseText);
                    name = json.title?.map(t => t.plain_text).join('').trim() || `DB ${notionDbId.slice(0, 6)}`;
                } catch { name = `DB ${notionDbId.slice(0, 6)}`; }
                finally { this.disabled = false; this.textContent = 'Salvar'; }
            } else {
                name = `DB ${notionDbId.slice(0, 6)}`;
            }
        }
        const list = getRefDbs();
        if (id) {
            const d = list.find(x => x.id === id);
            if (d) Object.assign(d, { name, notionDbId, accountId });
        } else if (!list.some(x => x.notionDbId === notionDbId)) {
            list.push({ id: uid(), name, notionDbId, accountId });
        }
        setRefDbs(list);
        $('#ns-refdb-form').style.display = 'none';
        renderRefDbs();
    });

    // Importação em lote de várias databases de consulta de uma vez
    $('#ns-bulk-refdb').addEventListener('click', () => {
        const accs = getAccounts();
        $('#ns-refdb-bulk-acc').innerHTML = accs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
        $('#ns-refdb-bulk-text').value = '';
        $('#ns-refdb-bulk-status').style.display = 'none';
        $('#ns-refdb-form').style.display = 'none';
        $('#ns-refdb-bulk-form').style.display = 'block';
    });
    $('#ns-cancel-refdb-bulk').addEventListener('click', () => { $('#ns-refdb-bulk-form').style.display = 'none'; });
    $('#ns-save-refdb-bulk').addEventListener('click', async function () {
        const accountId = $('#ns-refdb-bulk-acc').value;
        const acc       = getAccounts().find(a => a.id === accountId);
        const raw       = $('#ns-refdb-bulk-text').value || '';
        const statusEl  = $('#ns-refdb-bulk-status');
        if (!acc) { alert('Cadastre uma conta Notion primeiro.'); return; }

        const tokens = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
        const ids    = [...new Set(tokens.map(extractNotionId).filter(Boolean))];
        if (!ids.length) { alert('Nenhum ID ou link válido do Notion encontrado.'); return; }

        this.disabled = true;
        statusEl.style.display = 'block';
        const list = getRefDbs();
        let added = 0;

        for (let i = 0; i < ids.length; i++) {
            const notionDbId = ids[i];
            if (list.some(d => d.notionDbId === notionDbId)) continue;
            statusEl.textContent = `Lendo nome ${i + 1}/${ids.length}…`;
            let name = `DB ${notionDbId.slice(0, 6)}`;
            try {
                const res  = await notionReq('GET', `databases/${notionDbId}`, null, acc.token);
                const json = JSON.parse(res.responseText);
                const t    = json.title?.map(x => x.plain_text).join('').trim();
                if (t) name = t;
            } catch {}
            list.push({ id: uid(), name, notionDbId, accountId });
            added++;
        }

        setRefDbs(list);
        this.disabled = false;
        statusEl.style.display = 'none';
        $('#ns-refdb-bulk-form').style.display = 'none';
        renderRefDbs();
        nsLog('ok', `Radar GG: ${added} database(s) adicionada(s) em lote`);
    });

    $('#ns-sync-btn').addEventListener('click', async () => {
        if (!ctx.resolution) { setResult('warn', '⚙️ Configure databases e campos primeiro.'); return; }
        if (ctx.existingPage && $('#ns-confirm-toggle').checked) {
            $('#ns-confirm').style.display = 'flex';
            $('#ns-sync-btn').style.display = 'none';
            setResult('warn', 'Produto já existe. Deseja atualizar?');
            return;
        }
        await runSync();
    });
    $('#ns-btn-no').addEventListener('click', () => {
        $('#ns-confirm').style.display = 'none';
        $('#ns-sync-btn').style.display = 'block';
        setResult('', '');
    });
    $('#ns-btn-yes').addEventListener('click', async () => {
        $('#ns-confirm').style.display = 'none';
        $('#ns-sync-btn').style.display = 'block';
        await runSync();
    });

    async function runSync() {
        if (!ctx.resolution) return;
        const { db, account } = ctx.resolution;
        const btn = $('#ns-sync-btn');
        btn.disabled = true; btn.textContent = 'Sincronizando…';
        setResult('info', 'Conectando ao Notion…');

        try {
            if (!ctx.existingPage) {
                try {
                    const _recheck = await notionFindExisting(ctx.product, db, account.token);
                    if (_recheck) { ctx.existingPage = _recheck; setSyncInfo('Produto já existia — atualizando em vez de duplicar.'); }
                } catch (e) { console.warn('[LatinoGo] recheck dedup:', e); }
            }
            const categories = [...ctx.selectedCats];
            const updateAll  = !!$('#ns-update-all')?.checked;

            let properties;
            if (ctx.existingPage && !updateAll) {
                properties = {
                    'Data': { date: { start: new Date().toISOString() } },
                };
                const _skuNum = skuToNumber(ctx.product.sku);
                if (_skuNum !== null) properties['SKU'] = { number: _skuNum };
                if (categories.length)
                    properties['Categoria'] = { multi_select: categories.map(c => ({ name: c })) };

                const dimensoes = ctx.product.specs?.find(s => s.label?.toUpperCase().includes('DIMENS'))?.value || '';
                if (dimensoes)
                    properties['Dimensões do Produto'] = { rich_text: [{ text: { content: dimensoes } }] };
            } else {
                properties = buildNotionProperties(ctx.product, categories);
            }

            await ensureDbExtraFields(db.notionDbId, account.token);

            if (ctx.existingPage) {
                const res  = await notionReq('PATCH', `pages/${ctx.existingPage.id}`, { properties }, account.token);
                const json = JSON.parse(res.responseText);
                if (json.object === 'error') { nsLog('error', `Sync: ${ctx.product.name || 'produto'} — ${translateNotionError(json)}`); setResult('error', `❌ ${esc(translateNotionError(json))}`); return; }
                if (ctx.product.description || ctx.product.specs?.length)
                    await notionUpdateBody(ctx.existingPage.id, ctx.product.description, ctx.product.specs, ctx.product.images, account.token);
                recordPriceLog(ctx.existingPage.id, ctx.product.price, ctx.product.status);
                addProductToCatalogCache({
                    sku: skuToNumber(ctx.product.sku),
                    url: window.location.href,
                    dbId: db.notionDbId,
                    dbName: db.name,
                    pageUrl: ctx.existingPage.url || `https://notion.so/${ctx.existingPage.id.replace(/-/g, '')}`,
                    name: ctx.product.name,
                    status: ctx.product.status,
                    paused: false,
                });
                nsLog('ok', `Sync: ${ctx.product.name || ctx.product.sku || 'produto'} atualizado em ${db.name}`);
                setResult('ok', '✅ Produto atualizado!');
                setBadge('exists', '✓ Já existe no Notion');
                setSyncInfo(`Última edição: ${new Date().toLocaleString('pt-BR')}`);
            } else {
                const blocks = buildNotionBlocks(ctx.product.description, ctx.product.specs, ctx.product.images);
                const body   = { parent: { database_id: toUUID(db.notionDbId) }, properties };
                if (blocks.length) body.children = blocks;
                const res  = await notionReq('POST', 'pages', body, account.token);
                const json = JSON.parse(res.responseText);
                if (json.object === 'error') { nsLog('error', `Sync: ${ctx.product.name || 'produto'} — ${translateNotionError(json)}`); setResult('error', `❌ ${esc(translateNotionError(json))}`); return; }
                ctx.existingPage = json;
                const newPageId = json.id;
                recordPriceLog(newPageId, ctx.product.price, ctx.product.status);
                addProductToCatalogCache({
                    sku: skuToNumber(ctx.product.sku),
                    url: window.location.href,
                    dbId: db.notionDbId,
                    dbName: db.name,
                    pageUrl: json.url || `https://notion.so/${json.id.replace(/-/g, '')}`,
                    name: ctx.product.name,
                    status: ctx.product.status,
                    paused: false,
                });
                nsLog('ok', `Sync: ${ctx.product.name || ctx.product.sku || 'produto'} criado em ${db.name}`);
                setResult('ok', '✅ Produto criado no Notion!');
                setBadge('exists', '✓ Já existe no Notion');
                const openBtn = $('#ns-open-btn');
                if (openBtn) {
                    openBtn.style.display = 'inline-flex';
                    openBtn.onclick = () => window.open(json.url || `https://notion.so/${json.id.replace(/-/g, '')}`, '_blank');
                }
            }
        } catch (e) {
            console.error('[LatinoGo]', e);
            nsLog('error', `Sync: ${e?.message || e}`);
            setResult('error', '❌ Erro de conexão. Veja o Log.');
            sendToErrorDb(ctx.product.name, window.location.href, e?.message || String(e), ctx.resolution?.db?.id);
        } finally {
            btn.disabled = false; btn.textContent = 'Sincronizar no Notion';
        }
    }

    function renderSites() {
        const list = $('#ns-sites-list');
        const ss   = getSites();
        list.innerHTML = ss.length
            ? ss.map(s => `<div class="ns-item"><div class="ns-item-header"><span class="ns-item-name">${esc(s.name)}</span><span class="ns-item-sub">${esc(s.match)}</span><div class="ns-item-actions"><button class="ns-edit-btn" data-id="${s.id}" data-type="site">✎</button><button class="ns-del-btn" data-id="${s.id}" data-type="site">✕</button></div></div></div>`).join('')
            : '<div style="color:#555;font-size:12px;padding:4px 0">Nenhum site.</div>';
        list.querySelectorAll('.ns-edit-btn[data-type=site]').forEach(btn => btn.addEventListener('click', () => openSiteForm(getSites().find(s => s.id === btn.dataset.id))));
        list.querySelectorAll('.ns-del-btn[data-type=site]').forEach(btn => btn.addEventListener('click', () => { setSites(getSites().filter(s => s.id !== btn.dataset.id)); renderSites(); }));
    }
    function openSiteForm(site) {
        $('#ns-site-id').value    = site?.id    || '';
        $('#ns-site-name').value  = site?.name  || '';
        $('#ns-site-match').value = site?.match || '';
        $('#ns-site-form').style.display = 'block';
    }
    $('#ns-add-site').addEventListener('click', () => openSiteForm(null));
    $('#ns-cancel-site').addEventListener('click', () => { $('#ns-site-form').style.display = 'none'; });
    $('#ns-save-site').addEventListener('click', () => {
        const id = $('#ns-site-id').value;
        const name = $('#ns-site-name').value.trim();
        const match = $('#ns-site-match').value.trim();
        if (!name || !match) return;
        const ss = getSites();
        if (id) { const s = ss.find(x => x.id === id); if (s) { s.name = name; s.match = match; } }
        else ss.push({ id: uid(), name, match });
        setSites(ss); $('#ns-site-form').style.display = 'none'; renderSites();
    });

    function renderAccounts() {
        const list = $('#ns-accounts-list');
        const accs = getAccounts();
        list.innerHTML = accs.length
            ? accs.map(a => `<div class="ns-item"><div class="ns-item-header"><span class="ns-item-name">${esc(a.name)}</span><span class="ns-item-sub">${esc(a.token.slice(0,12))}…</span><div class="ns-item-actions"><button class="ns-edit-btn" data-id="${a.id}" data-type="account">✎</button><button class="ns-del-btn" data-id="${a.id}" data-type="account">✕</button></div></div></div>`).join('')
            : '<div style="color:#555;font-size:12px;padding:4px 0">Nenhuma conta.</div>';
        list.querySelectorAll('.ns-edit-btn[data-type=account]').forEach(btn => btn.addEventListener('click', () => openAccountForm(getAccounts().find(a => a.id === btn.dataset.id))));
        list.querySelectorAll('.ns-del-btn[data-type=account]').forEach(btn => btn.addEventListener('click', () => { setAccounts(getAccounts().filter(a => a.id !== btn.dataset.id)); renderAccounts(); }));
    }
    function openAccountForm(acc) {
        $('#ns-account-id').value    = acc?.id    || '';
        $('#ns-account-name').value  = acc?.name  || '';
        $('#ns-account-token').value = acc?.token || '';
        $('#ns-account-form').style.display = 'block';
    }
    $('#ns-add-account').addEventListener('click', () => openAccountForm(null));
    $('#ns-cancel-account').addEventListener('click', () => { $('#ns-account-form').style.display = 'none'; });
    $('#ns-save-account').addEventListener('click', () => {
        const id    = $('#ns-account-id').value;
        const name  = $('#ns-account-name').value.trim();
        const token = $('#ns-account-token').value.trim();
        if (!name || !token) return;
        const accs = getAccounts();
        if (id) { const a = accs.find(x => x.id === id); if (a) { a.name = name; a.token = token; } }
        else accs.push({ id: uid(), name, token });
        setAccounts(accs); $('#ns-account-form').style.display = 'none'; renderAccounts(); renderDatabases(); renderRefDbs();
    });

    function renderDatabases() {
        const list = $('#ns-databases-list');
        const dbs  = getDatabases();
        const accs = getAccounts();
        list.innerHTML = dbs.length
            ? dbs.map(d => {
                const acc = accs.find(a => a.id === d.accountId);
                const brandsPill = d.brands?.length
                    ? d.brands.map(b => `<span class="ns-brand-pill">${esc(b)}</span>`).join(' ')
                    : `<span class="ns-default-pill">default</span>`;
                return `<div class="ns-item"><div class="ns-item-header"><span class="ns-item-name">${esc(d.name)}</span><div class="ns-item-actions"><a href="https://notion.so/${(d.notionDbId || '').replace(/-/g,'')}" target="_blank" class="ns-open-db-btn" title="Abrir no Notion">↗</a><button class="ns-edit-btn" data-id="${d.id}" data-type="db">✎</button><button class="ns-del-btn" data-id="${d.id}" data-type="db">✕</button></div></div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">${brandsPill}</div><div class="ns-item-sub">${esc(acc?.name || '—')} · ${d.notionDbId?.slice(0, 8) || '?'}…</div></div>`;
              }).join('')
            : '<div style="color:#555;font-size:12px;padding:4px 0">Nenhum database.</div>';
        list.querySelectorAll('.ns-edit-btn[data-type=db]').forEach(btn => btn.addEventListener('click', () => openDbForm(getDatabases().find(d => d.id === btn.dataset.id))));
        list.querySelectorAll('.ns-del-btn[data-type=db]').forEach(btn => btn.addEventListener('click', () => { setDatabases(getDatabases().filter(d => d.id !== btn.dataset.id)); renderDatabases(); }));
    }

    async function renderDbFieldsPanel(dbId, accountId, listId, panelId, schemaType) {
        const fieldsPanel = $('#' + panelId);
        const fieldsList  = $('#' + listId);
        if (!dbId || !accountId) { fieldsPanel.style.display = 'none'; return; }
        const acc = getAccounts().find(a => a.id === accountId);
        if (!acc) { fieldsPanel.style.display = 'none'; return; }
        fieldsPanel.style.display = 'block';
        fieldsList.innerHTML = '<span style="color:#555">Carregando…</span>';
        const knownFields = schemaType === 'error' ? ERROR_DB_SCHEMA_KEYS : NOTION_SCHEMA_KEYS;
        try {
            const res      = await notionReq('GET', `databases/${dbId}`, null, acc.token);
            const json     = JSON.parse(res.responseText);
            if (json.object === 'error') throw new Error(json.message || json.code);
            const existing = Object.keys(json.properties || {});
            _renderFieldRows(fieldsList, knownFields, existing);
        } catch (e) {
            fieldsList.innerHTML = `<span style="color:#ff5555">Erro ao carregar campos: ${esc(e.message || e)}</span>`;
        }
    }

    function _renderFieldRows(fieldsList, knownFields, existing, pending) {
        pending = pending || [];
        const rows = [];
        knownFields.forEach(f => {
            if (pending.includes(f))
                rows.push(`<div style="color:#ff9900">🟠 ${esc(f)} <span style="color:#555">(criando…)</span></div>`);
            else if (existing.includes(f))
                rows.push(`<div style="color:#00cc66">🟢 ${esc(f)}</div>`);
            else
                rows.push(`<div style="color:#ff5555">🔴 ${esc(f)} <span style="color:#555">(faltando)</span></div>`);
        });
        existing.forEach(f => {
            if (!knownFields.includes(f))
                rows.push(`<div style="color:#888">⚫ ${esc(f)}</div>`);
        });
        fieldsList.innerHTML = rows.join('');
    }

    async function generateFieldsLive(dbId, accountId, listId, panelId, schemaType) {
        const fieldsList  = $('#' + listId);
        const knownFields = schemaType === 'error' ? ERROR_DB_SCHEMA_KEYS : NOTION_SCHEMA_KEYS;
        const acc         = getAccounts().find(a => a.id === accountId);
        if (!acc) return { created:[], existed:[], renamed:[], failed:[] };

        const res0  = await notionReq('GET', `databases/${dbId}`, null, acc.token);
        const json0 = JSON.parse(res0.responseText);
        if (json0.object === 'error') throw new Error(json0.message || json0.code);
        let existing = Object.keys(json0.properties || {});

        const genFn   = schemaType === 'error' ? generateErrorDbFields : generateTableFields;
        const missing = knownFields.filter(f => !existing.includes(f));
        _renderFieldRows(fieldsList, knownFields, existing, missing);

        const result = await genFn(dbId, acc.token);

        const res1  = await notionReq('GET', `databases/${dbId}`, null, acc.token);
        const json1 = JSON.parse(res1.responseText);
        const existingFinal = Object.keys(json1.properties || {});
        _renderFieldRows(fieldsList, knownFields, existingFinal, []);

        return result;
    }

    function openDbForm(db) {
        const accs = getAccounts();
        const sel  = $('#ns-db-account-sel');
        sel.innerHTML = accs.map(a => `<option value="${a.id}"${db?.accountId === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
        $('#ns-db-edit-id').value    = db?.id         || '';
        $('#ns-db-form-name').value  = db?.name       || '';
        $('#ns-db-link').value       = db?.notionDbId || '';
        $('#ns-db-id-val').value     = db?.notionDbId || '';
        $('#ns-db-brands').value     = db?.brands?.join(', ') || '';
        const preview = $('#ns-db-id-preview');
        if (db?.notionDbId) { preview.style.display = 'block'; preview.textContent = `ID: ${db.notionDbId}`; }
        else preview.style.display = 'none';
        $('#ns-db-gen-btn-form').disabled = !db?.notionDbId;
        $('#ns-db-form').style.display = 'block';
        renderDbFieldsPanel(db?.notionDbId || '', db?.accountId || sel.value, 'ns-db-fields-list', 'ns-db-fields-panel', 'main');
    }

    $('#ns-db-link').addEventListener('input', function () {
        const id      = extractNotionId(this.value);
        const preview = $('#ns-db-id-preview');
        $('#ns-db-id-val').value = id || '';
        $('#ns-db-gen-btn-form').disabled = !id;
        if (id) { preview.style.display = 'block'; preview.textContent = `ID: ${id}`; preview.style.color = '#00cc66'; }
        else { preview.style.display = this.value ? 'block' : 'none'; preview.textContent = this.value ? 'ID não reconhecido' : ''; preview.style.color = '#ff5555'; }
        const accountId = $('#ns-db-account-sel').value;
        renderDbFieldsPanel(id || '', accountId, 'ns-db-fields-list', 'ns-db-fields-panel', 'main');
    });

    $('#ns-db-account-sel').addEventListener('change', function () {
        const dbId = $('#ns-db-id-val').value;
        renderDbFieldsPanel(dbId, this.value, 'ns-db-fields-list', 'ns-db-fields-panel', 'main');
    });

    $('#ns-db-gen-btn-form').addEventListener('click', async function () {
        const notionDbId = $('#ns-db-id-val').value.trim();
        const accountId  = $('#ns-db-account-sel').value;
        if (!notionDbId || !accountId) { alert('Preencha o ID da database e a conta vinculada antes de gerar.'); return; }
        this.disabled = true; this.textContent = '⚙ Gerando…';
        try {
            const { created, existed, renamed, failed } = await generateFieldsLive(notionDbId, accountId, 'ns-db-fields-list', 'ns-db-fields-panel', 'main');
            const lines = [];
            if (renamed.length) lines.push(`🔄 Renomeados: ${renamed.join(', ')}`);
            if (created.length) lines.push(`✅ Criados: ${created.join(', ')}`);
            if (existed.length) lines.push(`✓ Já existiam: ${existed.join(', ')}`);
            if (failed.length)  lines.push(`❌ Falhas: ${failed.map(f => f.name + ' (' + f.msg + ')').join(', ')}`);
            alert(lines.join('\n') || 'Nenhuma alteração.');
        } catch (e) { alert('Erro: ' + (e.message || e)); }
        finally { this.disabled = false; this.textContent = '⚙ Gerar campos no Notion'; }
    });

    $('#ns-add-db').addEventListener('click', () => openDbForm(null));
    $('#ns-cancel-db').addEventListener('click', () => { $('#ns-db-form').style.display = 'none'; });
    $('#ns-save-db').addEventListener('click', () => {
        const id         = $('#ns-db-edit-id').value;
        const name       = $('#ns-db-form-name').value.trim();
        const notionDbId = $('#ns-db-id-val').value.trim();
        const accountId  = $('#ns-db-account-sel').value;
        const brands     = $('#ns-db-brands').value.split(',').map(b => b.trim()).filter(Boolean);
        if (!name || !notionDbId || !accountId) return;
        const dbs = getDatabases();
        const isDefault = !brands.length;
        if (id) { const d = dbs.find(x => x.id === id); if (d) Object.assign(d, { name, notionDbId, accountId, brands, isDefault }); }
        else dbs.push({ id: uid(), name, notionDbId, accountId, brands, isDefault });
        setDatabases(dbs); $('#ns-db-form').style.display = 'none'; renderDatabases();
    });

    function renderErrorDbs() {
        const list   = $('#ns-errdbs-list');
        const errDbs = getErrorDbs();
        const accs   = getAccounts();
        const dbs    = getDatabases();
        list.innerHTML = errDbs.length
            ? errDbs.map(e => {
                const acc   = accs.find(a => a.id === e.accountId);
                const scope = e.dbIds?.length ? e.dbIds.map(id => dbs.find(d => d.id === id)?.name || id).join(', ') : 'Todas';
                return `<div class="ns-item"><div class="ns-item-header"><span class="ns-item-name">${esc(e.name)}</span><div class="ns-item-actions"><a href="https://notion.so/${(e.notionDbId || '').replace(/-/g,'')}" target="_blank" class="ns-open-db-btn" title="Abrir no Notion">↗</a><button class="ns-edit-btn" data-id="${e.id}" data-type="errdb">✎</button><button class="ns-del-btn" data-id="${e.id}" data-type="errdb">✕</button></div></div><div class="ns-item-sub">${esc(acc?.name || '—')} · ${e.notionDbId?.slice(0,8) || '?'}… · Scope: ${esc(scope)}</div></div>`;
              }).join('')
            : '<div style="color:#555;font-size:12px;padding:4px 0">Nenhuma database de erros.</div>';
        list.querySelectorAll('.ns-edit-btn[data-type=errdb]').forEach(btn => btn.addEventListener('click', () => openErrDbForm(getErrorDbs().find(e => e.id === btn.dataset.id))));
        list.querySelectorAll('.ns-del-btn[data-type=errdb]').forEach(btn => btn.addEventListener('click', () => { setErrorDbs(getErrorDbs().filter(e => e.id !== btn.dataset.id)); renderErrorDbs(); }));
    }

    function openErrDbForm(errDb) {
        const accs = getAccounts();
        const dbs  = getDatabases();
        const sel  = $('#ns-errdb-account-sel');
        sel.innerHTML = accs.map(a => `<option value="${a.id}"${errDb?.accountId === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
        $('#ns-errdb-edit-id').value   = errDb?.id         || '';
        $('#ns-errdb-form-name').value = errDb?.name        || '';
        $('#ns-errdb-link').value       = errDb?.notionDbId || '';
        $('#ns-errdb-id-val').value     = errDb?.notionDbId || '';
        const preview = $('#ns-errdb-id-preview');
        if (errDb?.notionDbId) { preview.style.display = 'block'; preview.textContent = `ID: ${errDb.notionDbId}`; }
        else preview.style.display = 'none';
        $('#ns-errdb-gen-btn').disabled = !errDb?.notionDbId;
        const checks = $('#ns-errdb-db-checks');
        checks.innerHTML = dbs.map(d => `<label><input type="checkbox" value="${d.id}"${errDb?.dbIds?.includes(d.id) ? ' checked' : ''}> ${esc(d.name)}</label>`).join('');
        $('#ns-errdb-form').style.display = 'block';
        renderDbFieldsPanel(errDb?.notionDbId || '', errDb?.accountId || sel.value, 'ns-errdb-fields-list', 'ns-errdb-fields-panel', 'error');
    }

    $('#ns-errdb-link').addEventListener('input', function () {
        const id      = extractNotionId(this.value);
        const preview = $('#ns-errdb-id-preview');
        $('#ns-errdb-id-val').value = id || '';
        $('#ns-errdb-gen-btn').disabled = !id;
        if (id) { preview.style.display = 'block'; preview.textContent = `ID: ${id}`; preview.style.color = '#00cc66'; }
        else    { preview.style.display = this.value ? 'block' : 'none'; preview.textContent = this.value ? 'ID não reconhecido' : ''; preview.style.color = '#ff5555'; }
        const accountId = $('#ns-errdb-account-sel').value;
        renderDbFieldsPanel(id || '', accountId, 'ns-errdb-fields-list', 'ns-errdb-fields-panel', 'error');
    });

    $('#ns-errdb-gen-btn').addEventListener('click', async function () {
        const notionDbId = $('#ns-errdb-id-val').value.trim();
        const accountId  = $('#ns-errdb-account-sel').value;
        const acc        = getAccounts().find(a => a.id === accountId);
        if (!notionDbId || !acc) { alert('Preencha o ID da database e a conta vinculada antes de gerar.'); return; }
        this.disabled = true; this.textContent = '⚙ Gerando…';
        try {
            const { created, existed, renamed, failed } = await generateFieldsLive(notionDbId, accountId, 'ns-errdb-fields-list', 'ns-errdb-fields-panel', 'error');
            const lines = [];
            if (renamed.length) lines.push(`🔄 Renomeados: ${renamed.join(', ')}`);
            if (created.length) lines.push(`✅ Criados: ${created.join(', ')}`);
            if (existed.length) lines.push(`✓ Já existiam: ${existed.join(', ')}`);
            if (failed.length)  lines.push(`❌ Falhas: ${failed.map(f => f.name + ' (' + f.msg + ')').join(', ')}`);
            alert(lines.join('\n') || 'Nenhuma alteração.');
        } catch (e) { alert('Erro: ' + (e.message || e)); }
        finally { this.disabled = false; this.textContent = '⚙ Gerar campos no Notion'; }
    });

    $('#ns-errdb-account-sel').addEventListener('change', function () {
        const dbId = $('#ns-errdb-id-val').value;
        renderDbFieldsPanel(dbId, this.value, 'ns-errdb-fields-list', 'ns-errdb-fields-panel', 'error');
    });

    $('#ns-add-errdb').addEventListener('click', () => openErrDbForm(null));
    $('#ns-cancel-errdb').addEventListener('click', () => { $('#ns-errdb-form').style.display = 'none'; });
    $('#ns-save-errdb').addEventListener('click', () => {
        const id         = $('#ns-errdb-edit-id').value;
        const name       = $('#ns-errdb-form-name').value.trim();
        const notionDbId = $('#ns-errdb-id-val').value.trim();
        const accountId  = $('#ns-errdb-account-sel').value;
        const dbIds      = [...$$('#ns-errdb-db-checks input:checked')].map(cb => cb.value);
        if (!name || !notionDbId || !accountId) return;
        const errDbs = getErrorDbs();
        if (id) { const e = errDbs.find(x => x.id === id); if (e) Object.assign(e, { name, notionDbId, accountId, dbIds }); }
        else errDbs.push({ id: uid(), name, notionDbId, accountId, dbIds });
        setErrorDbs(errDbs); $('#ns-errdb-form').style.display = 'none'; renderErrorDbs();
    });

    $('#ns-export-btn').addEventListener('click', () => {
        if (!confirm('⚠️ Este arquivo de backup inclui os tokens das suas contas Notion em texto puro. Guarde-o em local seguro e não o compartilhe.\n\nExportar mesmo assim?')) return;
        const data = { sites: getSites(), accounts: getAccounts(), databases: getDatabases(), refDbs: getRefDbs(), errorDbs: getErrorDbs(), config: getConfig(), extraCats: getExtraCats() };
        getDatabases().forEach(d => { data[`fields_${d.id}`] = getFields(d.id); });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `notionsync_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $('#ns-import-btn').addEventListener('click', () => { $('#ns-import-file').click(); });
    $('#ns-import-file').addEventListener('change', function () {
        const file = this.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.sites)     setSites(data.sites);
                if (data.accounts)  setAccounts(data.accounts);
                if (data.databases) setDatabases(data.databases);
                if (data.refDbs)    setRefDbs(data.refDbs);
                if (data.errorDbs)  setErrorDbs(data.errorDbs);
                if (data.config)    setConfig(data.config);
                if (data.extraCats) setExtraCats(data.extraCats);
                if (data.databases) data.databases.forEach(d => { if (data[`fields_${d.id}`]) setFields(d.id, data[`fields_${d.id}`]); });
                renderSites(); renderAccounts(); renderDatabases(); renderRefDbs(); renderErrorDbs();
                alert('Importado com sucesso!');
            } catch (e) { alert('Erro ao importar: JSON inválido.'); }
        };
        reader.readAsText(file);
        this.value = '';
    });

    ctx.autoProducts = [];
    ctx._autoListTs  = 0;
    const AUTO_LIST_TTL = 5 * 60 * 1000;

    async function loadAutoList(force = false) {
        if (!force && ctx.autoProducts.length && Date.now() - ctx._autoListTs < AUTO_LIST_TTL) {
            renderAutoList();
            return;
        }
        const list = $('#ns-auto-list');
        list.innerHTML = '<div class="ns-auto-empty">Carregando…</div>';
        ctx.dbs      = getDatabases();
        ctx.accounts = getAccounts();
        const allPages = [];

        for (const db of ctx.dbs) {
            const acc = ctx.accounts.find(a => a.id === db.accountId);
            if (!acc) continue;
            try {
                let cursor = undefined;
                do {
                    const body = cursor ? { start_cursor: cursor } : {};
                    const res  = await notionReq('POST', `databases/${db.notionDbId}/query`, body, acc.token);
                    const json = JSON.parse(res.responseText);
                    if (json.object === 'error') break;
                    (json.results || []).forEach(p => {
                        const supplier = p.properties?.Produto?.url || '';
                        if (!supplier) return;
                        const activeSite = getSites().find(s => supplier.includes(s.match));
                        if (!activeSite) return;
                        const editedAt = p.last_edited_time ? new Date(p.last_edited_time) : null;
                        allPages.push({
                            id: p.id, name: p.properties?.Nome?.title?.[0]?.plain_text || '—',
                            brand: p.properties?.Marca?.select?.name || '',
                            price: p.properties?.['Custo Atual']?.number ?? null,
                            sku: p.properties?.SKU?.number ?? p.properties?.COD?.number ?? null,
                            supplier, editedAt, dbId: db.id, dbName: db.name,
                            status: p.properties?.Status?.select?.name || '',
                        });
                    });
                    cursor = json.has_more ? json.next_cursor : undefined;
                } while (cursor);
            } catch (e) { console.warn('[LatinoGo] loadAutoList:', e); }
        }

        ctx.autoProducts = allPages;
        ctx._autoListTs  = Date.now();

        const dbSel    = $('#ns-filter-db');
        const brandSel = $('#ns-filter-brand');
        const dbIds    = [...new Set(allPages.map(p => p.dbId))];
        const brands   = [...new Set(allPages.map(p => p.brand).filter(Boolean))].sort();
        const prevDb    = dbSel.value;
        const prevBrand = brandSel.value;
        dbSel.innerHTML    = '<option value="">Databases</option>';
        brandSel.innerHTML = '<option value="">Marcas</option>';
        dbIds.forEach(id => { const db = ctx.dbs.find(d => d.id === id); if (db) dbSel.innerHTML += `<option value="${id}">${esc(db.name)}</option>`; });
        brands.forEach(b => { brandSel.innerHTML += `<option value="${esc(b)}">${esc(b)}</option>`; });
        if (prevDb    && dbSel.querySelector(`option[value="${prevDb}"]`))    dbSel.value    = prevDb;
        if (prevBrand && [...brandSel.options].some(o => o.value === prevBrand)) brandSel.value = prevBrand;
        renderAutoList();
    }

    function renderAutoList() {
        const filterDb     = $('#ns-filter-db').value;
        const filterBrand  = $('#ns-filter-brand').value;
        const filterDays   = parseInt($('#ns-filter-days').value) || 0;
        const filterStatus = $('#ns-filter-status').value;
        const searchQ      = ($('#ns-auto-search')?.value || '').toLowerCase().trim();
        const checkedIds   = new Set([...$$('.ns-auto-check:checked')].map(cb => cb.dataset.id));

        const filtered = ctx.autoProducts.filter(p => {
            if (filterDb     && p.dbId   !== filterDb)     return false;
            if (filterBrand  && p.brand  !== filterBrand)  return false;
            if (filterStatus && p.status !== filterStatus) return false;
            if (filterDays  && p.editedAt) { const diffDays = (Date.now() - p.editedAt.getTime()) / 86400000; if (diffDays < filterDays) return false; }
            if (searchQ) { const nameMatch = p.name?.toLowerCase().includes(searchQ); const skuMatch = p.sku !== null && String(p.sku).includes(searchQ); if (!nameMatch && !skuMatch) return false; }
            return true;
        });

        $('#ns-auto-count').textContent = `${filtered.length} produto${filtered.length !== 1 ? 's' : ''}`;
        const list = $('#ns-auto-list');

        if (!filtered.length) { list.innerHTML = '<div class="ns-auto-empty">Nenhum produto.</div>'; return; }

        list.innerHTML = filtered.map(p => {
            const dateLabel  = p.editedAt ? p.editedAt.toLocaleDateString('pt-BR') : '—';
            const priceLabel = p.price !== null ? fmtBRL(p.price) : '—';
            return `<div class="ns-auto-item"><input type="checkbox" class="ns-auto-check" data-id="${p.id}" data-url="${esc(p.supplier)}"><div class="ns-auto-info"><div class="ns-auto-name" title="${esc(p.name)}">${esc(p.name)}</div><div class="ns-auto-meta">${esc(p.brand)} · ${esc(p.dbName)} · sync: ${dateLabel} · ${priceLabel}</div></div></div>`;
        }).join('');

        list.querySelectorAll('.ns-auto-check').forEach(cb => {
            if (checkedIds.has(cb.dataset.id)) cb.checked = true;
            cb.addEventListener('change', updateStartBtn);
        });
        updateStartBtn();
    }

    function updateStartBtn() {
        const all     = [...$$('.ns-auto-check')];
        const checked = all.filter(cb => cb.checked);
        const hasChecked = !!checked.length;
        $('#ns-migrate-btn').disabled  = !hasChecked;
        $('#ns-clone-btn').disabled    = !hasChecked;
        $('#ns-auto-csv-btn').disabled = !hasChecked;
        const selAll = $('#ns-sel-all');
        if (selAll) {
            selAll.checked       = all.length > 0 && checked.length === all.length;
            selAll.indeterminate = checked.length > 0 && checked.length < all.length;
        }
    }

    $('#ns-sel-all').addEventListener('change', function () {
        $$('.ns-auto-check').forEach(cb => { cb.checked = this.checked; });
        updateStartBtn();
    });

    function logAuto(msg, type) {
        const el = $('#ns-auto-log');
        if (!el) return;
        el.style.display = 'block';
        const cls  = { ok: 'ns-log-ok', error: 'ns-log-error', warn: 'ns-log-skip', info: 'ns-log-info' }[type] || 'ns-log-info';
        const line = document.createElement('div');
        line.className = `ns-log-line ${cls}`;
        line.textContent = msg;
        el.appendChild(line);
        el.scrollTop = el.scrollHeight;
    }

    const migrateBtn        = $('#ns-migrate-btn');
    const cloneBtn          = $('#ns-clone-btn');
    const migratePanel      = $('#ns-migrate-panel');
    const migrateDbSel      = $('#ns-migrate-db-sel');
    const migrateConfirmBtn = $('#ns-migrate-confirm-btn');
    const migratePanelLabel = $('#ns-migrate-panel-label');
    const migratePanelHint  = $('#ns-migrate-panel-hint');
    let migrateMode = 'move';

    function openMigratePanel(mode) {
        migrateMode = mode;
        const srcDbIds = new Set([...$$('.ns-auto-check:checked')].map(cb => ctx.autoProducts.find(p => p.id === cb.dataset.id)?.dbId).filter(Boolean));
        migrateDbSel.innerHTML = '<option value="">Escolha a database destino…</option>';
        ctx.dbs.filter(d => !srcDbIds.has(d.id)).forEach(d => { migrateDbSel.innerHTML += `<option value="${d.id}">${esc(d.name)}</option>`; });
        migrateConfirmBtn.disabled = true;
        if (mode === 'clone') { migratePanelLabel.textContent = 'Clonar selecionados para:'; migratePanelHint.textContent = 'Os produtos serão criados na database destino. A origem não é alterada.'; }
        else                  { migratePanelLabel.textContent = 'Mover selecionados para:';  migratePanelHint.textContent = 'Os produtos serão criados na database destino e arquivados na origem.'; }
        migratePanel.style.display = 'block';
    }

    migrateBtn.addEventListener('click', () => openMigratePanel('move'));
    cloneBtn.addEventListener('click',   () => openMigratePanel('clone'));

    $('#ns-auto-csv-btn').addEventListener('click', async () => {
        const checked = [...$$('.ns-auto-check:checked')];
        if (!checked.length) return;

        const selected = checked.map(cb => ctx.autoProducts.find(p => p.id === cb.dataset.id)).filter(Boolean);
        logAuto(`Gerando CSV Shopify para ${selected.length} produto(s)…`, 'info');

        const enriched = [];
        for (let i = 0; i < selected.length; i += 5) {
            const batch = selected.slice(i, i + 5);
            const results = await Promise.all(batch.map(async p => {
                const db  = getDatabases().find(d => d.id === p.dbId);
                const acc = db ? getAccounts().find(a => a.id === db.accountId) : null;
                let categories = '';
                let images     = [];
                if (acc) {
                    try {
                        const res  = await notionReq('GET', `pages/${p.id}`, null, acc.token);
                        const json = JSON.parse(res.responseText);
                        const cats = json.properties?.Categoria?.multi_select || [];
                        categories = cats.map(c => c.name).join(', ');
                    } catch (e) { console.warn('[LatinoGo] enrich categories:', e); }
                    try {
                        images = await extractImagesFromBlocks(p.id, acc.token);
                    } catch (e) { console.warn('[LatinoGo] enrich images:', e); }
                }
                return { ...p, categories, images, description: '' };
            }));
            enriched.push(...results);
        }

        const csv      = buildShopifyCSV(enriched);
        const date     = new Date().toISOString().slice(0, 10);
        const filename = `latinogo_shopify_${date}.csv`;
        downloadCSV(csv, filename);
        logAuto(`✅ CSV gerado: ${filename} (${enriched.length} produto(s))`, 'ok');
    });
    migrateDbSel.addEventListener('change', () => { migrateConfirmBtn.disabled = !migrateDbSel.value; });

    migrateConfirmBtn.addEventListener('click', async () => {
        const destDbId = migrateDbSel.value;
        const destDb   = ctx.dbs.find(d => d.id === destDbId);
        if (!destDb) return;
        const destAcc = ctx.accounts.find(a => a.id === destDb.accountId);
        if (!destAcc) { alert('Conta Notion não encontrada para a database destino.'); return; }

        const selected = [...$$('.ns-auto-check:checked')].map(cb => ctx.autoProducts.find(p => p.id === cb.dataset.id)).filter(Boolean);
        const isClone  = migrateMode === 'clone';
        migratePanel.style.display = 'none';
        migrateBtn.disabled = true; cloneBtn.disabled = true;

        let ok = 0, errors = 0, skipped = 0;
        const actionLabel = isClone ? 'Clone' : 'Migração';
        logAuto(`─── ${actionLabel}: ${selected.length} produto(s) → ${destDb.name} ───`, 'info');

        const destDbRes  = await notionReq('GET', `databases/${destDb.notionDbId}`, null, destAcc.token);
        const destFields = new Set(Object.keys(JSON.parse(destDbRes.responseText).properties || {}));

        const COPY_FIELDS  = ['Nome','SKU','Marca','Produto','Categoria','Data','Dimensões do Produto'];
        const sanitizeProp = val => {
            if (!val) return null;
            if (val.type === 'title')        return { title: val.title };
            if (val.type === 'rich_text')    return { rich_text: val.rich_text };
            if (val.type === 'number')       return { number: val.number };
            if (val.type === 'select' && val.select)            return { select: { name: val.select.name } };
            if (val.type === 'multi_select' && val.multi_select) return { multi_select: val.multi_select.map(o => ({ name: o.name })) };
            if (val.type === 'status' && val.status)            return { status: { name: val.status.name } };
            if (val.type === 'date')         return { date: val.date };
            if (val.type === 'url')          return { url: val.url };
            if (val.type === 'email')        return { email: val.email };
            if (val.type === 'phone_number') return { phone_number: val.phone_number };
            if (val.type === 'checkbox')     return { checkbox: val.checkbox };
            return null;
        };

        for (const p of selected) {
            const srcDb  = ctx.dbs.find(d => d.id === p.dbId);
            const srcAcc = srcDb ? ctx.accounts.find(a => a.id === srcDb.accountId) : null;
            try {
                const srcProps     = JSON.parse((await notionReq('GET', `pages/${p.id}`, null, srcAcc?.token || destAcc.token)).responseText).properties || {};
                const liveSupplier = srcProps?.Produto?.url || '';
                if (!liveSupplier) { logAuto(`⚠ ${p.name} — pulado: sem link do produto`, 'warn'); nsLog('warn', `${actionLabel}: ${p.name} — sem link (Produto)`); skipped++; continue; }

                const liveSku      = srcProps?.SKU?.number ?? srcProps?.COD?.number ?? null;
                const alreadyExists = await notionFindExisting({ sku: liveSku, name: p.name }, { notionDbId: destDb.notionDbId }, destAcc.token);
                if (alreadyExists) {
                    logAuto(`⚠ ${p.name} — já existe em ${destDb.name}${!isClone && srcAcc ? ', arquivando na origem' : ''}`, 'warn');
                    nsLog('warn', `${actionLabel}: ${p.name} — já existe na destino`);
                    if (!isClone && srcAcc) await notionReq('PATCH', `pages/${p.id}`, { archived: true }, srcAcc.token);
                    skipped++; continue;
                }

                const newProps = {};
                COPY_FIELDS.forEach(k => {
                    if (!destFields.has(k)) return;
                    const srcVal = srcProps[k] ?? (k === 'SKU' ? srcProps['COD'] : undefined);
                    const s = sanitizeProp(srcVal);
                    if (s) newProps[k] = s;
                });

                const createJson = JSON.parse((await notionReq('POST', 'pages', { parent: { database_id: toUUID(destDb.notionDbId) }, properties: newProps }, destAcc.token)).responseText);
                if (!createJson.id) throw new Error('Página criada mas sem ID retornado — verifique manualmente');
                const verifyJson = JSON.parse((await notionReq('GET', `pages/${createJson.id}`, null, destAcc.token)).responseText);
                if (verifyJson.object !== 'page' || verifyJson.archived) throw new Error('Verify falhou — página não encontrada ou arquivada na destino');

                if (!isClone && srcAcc) await notionReq('PATCH', `pages/${p.id}`, { archived: true }, srcAcc.token);
                logAuto(`✓ ${p.name} → ${destDb.name}`, 'ok');
                nsLog('ok', `${actionLabel}: ${p.name} → ${destDb.name}`);
                ok++;
            } catch (e) {
                const reason = e?.message || 'Erro desconhecido';
                logAuto(`✕ ${p.name} — ${reason}`, 'error');
                nsLog('error', `${actionLabel}: ${p.name} — ${reason}`);
                sendToErrorDb(p.name, p.supplier, reason, p.dbId);
                errors++;
            }
        }

        logAuto(`─── Concluído: ${ok} ok, ${skipped} pulado(s), ${errors} erro(s) ───`, 'info');
        migrateBtn.disabled = false; cloneBtn.disabled = false;
        loadAutoList(true);
    });

    $('#ns-refresh-btn')?.addEventListener('click', () => loadAutoList(true));
    ['#ns-filter-db', '#ns-filter-brand', '#ns-filter-days', '#ns-filter-status'].forEach(sel => {
        $(sel)?.addEventListener('change', renderAutoList);
    });
    $('#ns-auto-search')?.addEventListener('input', renderAutoList);

    renderSites(); renderAccounts(); renderDatabases(); renderRefDbs(); renderErrorDbs();
    updateRadarStatusUI();
}

// ────────────────────────────────────────────────────────────
// src/12-catalog-radar.js — Radar GG nos cards de busca/listagem
// ────────────────────────────────────────────────────────────
function extractSupplierKey(rawUrl) {
    if (!rawUrl) return null;
    const u = String(rawUrl).toLowerCase();
    if (u.includes('visaovip.com') || u.startsWith('/prod/')) {
        const m = u.match(/\/(\d+)\/?(?:$|[?#])/);
        if (m) return { provider: 'visaovip', id: m[1] };
    }
    if (u.includes('atacadoconnect.com') || u.startsWith('/produto/')) {
        const m = u.match(/\/(\d+)\/?(?:$|[?#])/);
        if (m) return { provider: 'atacadoconnect', id: m[1] };
    }
    if (u.includes('atacadocollections.com')) {
        const m = u.match(/-(\d+)\/?(?:$|[?#])/);
        if (m) return { provider: 'atacadocollections', id: m[1] };
    }
    return null;
}

function getAllRadarSourceDbs() {
    const cfg     = getConfig();
    const accs    = getAccounts();
    const seen    = new Set();
    const sources = [];
    const addList = (arr) => {
        for (const d of (arr || [])) {
            if (!d?.notionDbId || seen.has(d.notionDbId)) continue;
            const acc = accs.find(a => a.id === d.accountId);
            if (!acc) continue;
            seen.add(d.notionDbId);
            sources.push({ name: d.name || 'Database', notionDbId: d.notionDbId, token: acc.token });
        }
    };
    addList(getRefDbs());
    if (cfg.includeMainDbsInRadar !== false) addList(getDatabases());
    return sources;
}

function _pushIndexEntry(map, key, entry) {
    if (!key) return;
    if (!map[key]) map[key] = [];
    if (!map[key].some(e => e.dbName === entry.dbName && e.pageUrl === entry.pageUrl)) {
        map[key].push(entry);
    }
}

let _catalogSyncPromise = null;

async function syncCatalogIndex(onProgress) {
    if (_catalogSyncPromise) return _catalogSyncPromise;
    _catalogSyncPromise = (async () => {
        const sources = getAllRadarSourceDbs();
        const bySku    = {};
        const byUrlKey = {};
        let totalProducts = 0;
        let doneDbs = 0;

        const CONCURRENCY = 3;
        for (let i = 0; i < sources.length; i += CONCURRENCY) {
            const batch = sources.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async src => {
                try {
                    let cursor = undefined;
                    do {
                        const body = { page_size: 100 };
                        if (cursor) body.start_cursor = cursor;
                        const res  = await notionReq('POST', `databases/${src.notionDbId}/query`, body, src.token);
                        const json = JSON.parse(res.responseText);
                        if (json.object === 'error') break;
                        for (const p of (json.results || [])) {
                            if (p.archived) continue;
                            const props = p.properties || {};
                            const prodUrl = props['Produto']?.url || '';
                            const rawSku =
                                props['SKU']?.number ??
                                props['SKU']?.rich_text?.[0]?.plain_text ??
                                props['Código']?.number ??
                                props['Código']?.rich_text?.[0]?.plain_text ??
                                props['Codigo']?.number ??
                                props['Codigo']?.rich_text?.[0]?.plain_text ??
                                props['COD']?.number ??
                                null;
                            const skuNum = skuToNumber(rawSku);
                            const keyObj = extractSupplierKey(prodUrl);
                            if (skuNum === null && !keyObj) continue;

                            const entry = {
                                dbId:    src.notionDbId,
                                dbName:  src.name,
                                pageUrl: p.url || `https://notion.so/${p.id.replace(/-/g, '')}`,
                                name:    props['Nome']?.title?.[0]?.plain_text || '',
                                status:  props['Status']?.select?.name || '',
                                paused:  props['Pausado']?.checkbox === true,
                            };
                            totalProducts++;
                            if (skuNum !== null) _pushIndexEntry(bySku, String(skuNum), entry);
                            if (keyObj) {
                                _pushIndexEntry(byUrlKey, `${keyObj.provider}:${keyObj.id}`, entry);
                                _pushIndexEntry(bySku, String(keyObj.id), entry);
                            }
                        }
                        cursor = json.has_more ? json.next_cursor : undefined;
                    } while (cursor);
                } catch (e) {
                    console.warn(`[LatinoGo] Radar sync (${src.name}):`, e);
                    nsLog('warn', `Radar GG (${src.name}): ${e?.message || e}`);
                } finally {
                    doneDbs++;
                    if (typeof onProgress === 'function') onProgress(doneDbs, sources.length, src.name);
                }
            }));
        }

        const cache = {
            updatedAt: Date.now(),
            totalProducts,
            totalDbs: sources.length,
            bySku,
            byUrlKey,
        };
        setCatalogCache(cache);
        return cache;
    })();

    try { return await _catalogSyncPromise; }
    finally { _catalogSyncPromise = null; }
}

function addProductToCatalogCache({ sku, url: prodUrl, dbId, dbName, pageUrl, name, status, paused }) {
    const cache = getCatalogCache();
    if (!cache) return;
    const entry = { dbId: dbId || '', dbName, pageUrl, name: name || '', status: status || '', paused: !!paused };
    const keyObj = extractSupplierKey(prodUrl);
    if (sku != null) _pushIndexEntry(cache.bySku, String(sku), entry);
    if (keyObj) {
        _pushIndexEntry(cache.byUrlKey, `${keyObj.provider}:${keyObj.id}`, entry);
        _pushIndexEntry(cache.bySku, String(keyObj.id), entry);
    }
    cache.totalProducts = (cache.totalProducts || 0) + 1;
    setCatalogCache(cache);
}

function lookupInCatalog(cache, provider, id, fallbackSku) {
    if (!cache) return null;
    if (provider && id && cache.byUrlKey?.[`${provider}:${id}`]?.length) {
        return cache.byUrlKey[`${provider}:${id}`];
    }
    if (id && cache.bySku?.[String(id)]?.length) {
        return cache.bySku[String(id)];
    }
    if (fallbackSku && cache.bySku?.[String(fallbackSku)]?.length) {
        return cache.bySku[String(fallbackSku)];
    }
    return null;
}

function clearAllRadarBadges() {
    document.querySelectorAll('.ns-gg-card-badge').forEach(el => el.remove());
    document.querySelectorAll('.ns-gg-card-highlight, .ns-gg-card-highlight-yellow').forEach(el => {
        el.classList.remove('ns-gg-card-highlight', 'ns-gg-card-highlight-yellow');
    });
}

function _detectPageProvider() {
    const h = location.hostname.toLowerCase();
    if (h.includes('visaovip.com'))           return 'visaovip';
    if (h.includes('atacadoconnect.com'))     return 'atacadoconnect';
    if (h.includes('atacadocollections.com')) return 'atacadocollections';
    return null;
}

function _collectListingCards(provider) {
    const cards = new Map(); // cardEl -> { id, sku }

    if (provider === 'visaovip') {
        document.querySelectorAll('a[href*="/prod/"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/(\d+)\/?(?:$|[?#])/);
            if (!m) return;
            const card = a.closest('.bg-vip.relative, div.border-round-2xl.relative, article, li') || a.parentElement;
            if (!card || cards.has(card)) return;
            // Evita marcar links de menu/breadcrumb/header que não são cards de produto
            if (card.getBoundingClientRect().height < 120) return;
            const codMatch = (card.innerText || '').match(/C[óo]digo:\s*(\d+)/i);
            cards.set(card, { id: m[1], sku: codMatch ? codMatch[1] : m[1] });
        });
    } else if (provider === 'atacadoconnect') {
        document.querySelectorAll('a[href*="/produto/"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/(\d+)\/?(?:$|[?#])/);
            if (!m) return;
            const card = a.classList.contains('relative') ? a : (a.closest('.relative, article, li') || a);
            if (!card || cards.has(card)) return;
            if (card.getBoundingClientRect().height < 120) return;
            cards.set(card, { id: m[1], sku: m[1] });
        });
    } else if (provider === 'atacadocollections') {
        document.querySelectorAll('a[href*="/produto/"]').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(/-(\d+)\/?(?:$|[?#])/);
            if (!m) return;
            const card = a.closest('article, .product-item, .card, li, .relative') || a.parentElement;
            if (!card || cards.has(card)) return;
            if (card.getBoundingClientRect().height < 120) return;
            cards.set(card, { id: m[1], sku: m[1] });
        });
    }

    return cards;
}

let _lastMatchesOnPage = 0;

function scanListingCards() {
    const provider = _detectPageProvider();
    if (!provider) return;

    const cfg = getConfig();
    if (cfg.radarEnabled === false) {
        clearAllRadarBadges();
        _lastMatchesOnPage = 0;
        return;
    }

    // Na página individual do produto, não polui os cards internos (o painel Sync já verifica)
    const isProductPage = !!getSites().find(s => location.href.includes(s.match));
    if (isProductPage) {
        clearAllRadarBadges();
        _lastMatchesOnPage = 0;
        return;
    }

    const cache = getCatalogCache();
    if (!cache) return;

    injectCSS();
    const cards = _collectListingCards(provider);
    let foundCount = 0;

    cards.forEach(({ id, sku }, cardEl) => {
        const matches = lookupInCatalog(cache, provider, id, sku);
        const existingBadge = cardEl.querySelector(':scope > .ns-gg-card-badge');

        if (!matches?.length) {
            if (existingBadge) existingBadge.remove();
            cardEl.classList.remove('ns-gg-card-highlight', 'ns-gg-card-highlight-yellow');
            return;
        }

        foundCount++;
        const first     = matches[0];
        const dbNames   = [...new Set(matches.map(m => m.dbName))];
        const allPaused = matches.every(m => m.paused);
        const isYellow  = matches.some(m =>
            (m.dbId && m.dbId.replace(/-/g, '').toLowerCase() === RADAR_YELLOW_DB_ID) ||
            normalizeText(m.dbName) === 'adicionar'
        );
        const labelTxt  = dbNames.length > 1 ? `${dbNames[0]} +${dbNames.length - 1}` : dbNames[0];
        const tooltip   = matches.map(m =>
            `${m.dbName}${m.status ? ' · ' + m.status : ''}${m.paused ? ' (Pausado)' : ''}`
        ).join('\n') + '\nClique para abrir no Notion';

        const stateKey = `${id}|${labelTxt}|${allPaused}|${isYellow}`;
        if (existingBadge && existingBadge.dataset.nsKey === stateKey) {
            return;
        }
        if (existingBadge) existingBadge.remove();

        if (getComputedStyle(cardEl).position === 'static') {
            cardEl.style.position = 'relative';
        }
        cardEl.classList.remove('ns-gg-card-highlight', 'ns-gg-card-highlight-yellow');
        cardEl.classList.add(isYellow ? 'ns-gg-card-highlight-yellow' : 'ns-gg-card-highlight');

        const badge = document.createElement('a');
        badge.className = `ns-gg-card-badge${isYellow ? ' is-yellow' : (allPaused ? ' is-paused' : '')}`;
        badge.dataset.nsKey = stateKey;
        badge.href = first.pageUrl;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.title = tooltip;
        badge.innerHTML = `${GG_LOGO_SVG}<span class="ns-gg-card-badge-label">${allPaused ? '⏸ ' : ''}${esc(labelTxt)}</span>`;
        badge.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(first.pageUrl, '_blank', 'noopener,noreferrer');
        });
        cardEl.appendChild(badge);
    });

    _lastMatchesOnPage = foundCount;
    updateRadarFloatingPill();
}

let _radarScanTimer = null;
function scheduleRadarScan(delay = 250) {
    if (_radarScanTimer) clearTimeout(_radarScanTimer);
    _radarScanTimer = setTimeout(() => {
        _radarScanTimer = null;
        scanListingCards();
    }, delay);
}

function updateRadarFloatingPill(syncText) {
    const provider = _detectPageProvider();
    const isProductPage = !!getSites().find(s => location.href.includes(s.match));
    let pill = document.getElementById('ns-radar-pill');

    if (!provider || isProductPage || IS_CONFIG_ONLY) {
        if (pill) pill.remove();
        return;
    }

    injectCSS();
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'ns-radar-pill';
        document.body.appendChild(pill);
    }

    const cfg   = getConfig();
    const cache = getCatalogCache();
    let text;
    if (syncText) {
        text = syncText;
    } else if (cfg.radarEnabled === false) {
        text = 'Radar pausado';
    } else if (!cache) {
        text = 'Catálogo vazio';
    } else {
        const hitStr = _lastMatchesOnPage > 0
            ? `<span style="color:#26F03A">${_lastMatchesOnPage} na página</span> · `
            : '';
        text = `${hitStr}${cache.totalProducts || 0} no Notion`;
    }

    pill.innerHTML = `
        ${GG_LOGO_SVG}
        <span>${text}</span>
        <button type="button" id="ns-radar-pill-sync" title="Atualizar índice do Notion agora">↻</button>
        <button type="button" id="ns-radar-pill-cfg" title="Configurar Databases de Consulta">⚙</button>
    `;

    const syncBtn = pill.querySelector('#ns-radar-pill-sync');
    if (syncBtn) {
        syncBtn.disabled = !!syncText;
        syncBtn.addEventListener('click', async () => {
            const sources = getAllRadarSourceDbs();
            if (!sources.length) {
                openConfigPanelModal();
                return;
            }
            updateRadarFloatingPill('Sincronizando…');
            try {
                await syncCatalogIndex((done, total) => {
                    updateRadarFloatingPill(`Sync ${done}/${total}…`);
                });
                scanListingCards();
                updateRadarFloatingPill();
            } catch (e) {
                updateRadarFloatingPill('Erro no sync');
                setTimeout(() => updateRadarFloatingPill(), 3000);
            }
        });
    }

    const cfgBtn = pill.querySelector('#ns-radar-pill-cfg');
    if (cfgBtn) {
        cfgBtn.addEventListener('click', () => openConfigPanelModal());
    }
}

function initCatalogRadar() {
    const provider = _detectPageProvider();
    if (!provider || IS_CONFIG_ONLY) return;

    const start = () => {
        updateRadarFloatingPill();
        const cfg     = getConfig();
        const cache   = getCatalogCache();
        const sources = getAllRadarSourceDbs();

        if (cfg.radarEnabled !== false) {
            if (cache) scheduleRadarScan(250);
            if (sources.length) {
                const stale = !cache || !cache.updatedAt || (Date.now() - cache.updatedAt > CATALOG_CACHE_TTL);
                if (stale) {
                    updateRadarFloatingPill('Indexando Notion…');
                    syncCatalogIndex((done, total) => {
                        updateRadarFloatingPill(`Indexando ${done}/${total}…`);
                    }).then(() => {
                        scanListingCards();
                        updateRadarFloatingPill();
                    }).catch(() => updateRadarFloatingPill());
                }
            }
        }

        const obs = new MutationObserver((mutations) => {
            if (getConfig().radarEnabled === false) return;
            const relevant = mutations.some(m =>
                [...m.addedNodes].some(n => n.nodeType === 1 && !n.classList?.contains('ns-gg-card-badge') && n.id !== 'ns-radar-pill')
            );
            if (relevant) scheduleRadarScan(300);
        });
        obs.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
}

initCatalogRadar();

})();
