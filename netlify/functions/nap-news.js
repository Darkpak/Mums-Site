// netlify/functions/nap-news.js
// Fetches and parses the НАП news page server-side.
// Available at: /.netlify/functions/nap-news

const NAP_URLS = [
  'https://nra.bg/wps/portal/nra/actualno/actualno',
  'https://nra.bg/wps/portal/nra/actualno',
];

const BG_MONTHS = {
  'януари': 0, 'февруари': 1, 'март': 2, 'април': 3,
  'май': 4,    'юни': 5,      'юли': 6,  'август': 7,
  'септември': 8, 'октомври': 9, 'ноември': 10, 'декември': 11,
};

function fmtDate(day, month, year) {
  return String(day).padStart(2, '0') + '.' +
    String(month + 1).padStart(2, '0') + '.' + year;
}

function parseLinks(html) {
  const items  = [];
  const linkRx = /href="([^"]*\/actualno\/[^"?#]+)"[^>]*>([\s\S]{10,300}?)<\/a>/gi;
  let m;
  while ((m = linkRx.exec(html)) !== null) {
    const href  = m[1].trim();
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    if (
      href.endsWith('/actualno/actualno') ||
      href.endsWith('/actualno/') ||
      title.length < 15 ||
      title.length > 400
    ) continue;

    const fullUrl = href.startsWith('http') ? href : 'https://nra.bg' + href;
    if (items.find(i => i.link === fullUrl)) continue;

    // Look for a date in surrounding text
    const ctx  = html.slice(Math.max(0, m.index - 200), m.index + m[0].length + 100);
    let date   = '';
    const bgM  = ctx.match(/(\d{1,2})\s+(януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)\s+(\d{4})/i);
    const numM = ctx.match(/(\d{2})\.(\d{2})\.(\d{4})/);

    if (bgM && BG_MONTHS[bgM[2].toLowerCase()] !== undefined) {
      date = fmtDate(bgM[1], BG_MONTHS[bgM[2].toLowerCase()], bgM[3]);
    } else if (numM) {
      date = numM[0];
    }

    items.push({ title, link: fullUrl, date });
  }
  return items;
}

exports.handler = async function () {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=900',
  };

  for (const url of NAP_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'bg,en;q=0.9',
        },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const html  = await res.text();
      const items = parseLinks(html).slice(0, 30);
      if (items.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items }) };
      }
    } catch (e) {
      // try next URL
    }
  }

  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ ok: false, error: 'НАП page could not be fetched or parsed' }),
  };
};
