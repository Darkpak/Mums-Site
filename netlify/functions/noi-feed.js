// netlify/functions/noi-feed.js
// Fetches НОИ RSS feed server-side and returns JSON.
// Available at: /.netlify/functions/noi-feed

const NOI_FEEDS = [
  'https://www.nssi.bg/feed/',
  'https://www.nssi.bg/publichnost/novini/feed/',
  'https://www.nssi.bg/?feed=rss2',
];

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return '';
  return d.getDate().toString().padStart(2, '0') + '.' +
    (d.getMonth() + 1).toString().padStart(2, '0') + '.' +
    d.getFullYear();
}

function parseItems(xml) {
  const items = [];
  const itemRx  = /<item[\s\S]*?<\/item>/gi;
  const titleRx = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([^<]*)<\/title>/i;
  const linkRx  = /<link>([^<]*)<\/link>/i;
  const dateRx  = /<pubDate>([^<]*)<\/pubDate>/i;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block  = m[0];
    const titleM = titleRx.exec(block);
    const linkM  = linkRx.exec(block);
    const dateM  = dateRx.exec(block);
    const title  = ((titleM && (titleM[1] || titleM[2])) || '').trim();
    const link   = (linkM && linkM[1] || '').trim();
    const date   = fmtDate((dateM && dateM[1]) || '');
    if (title && link) items.push({ title, link, date });
  }
  return items;
}

exports.handler = async function () {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=900',
  };

  for (const url of NOI_FEEDS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AccountingBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const xml   = await res.text();
      const items = parseItems(xml).slice(0, 30);
      if (items.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, items }) };
      }
    } catch (e) {
      // try next feed URL
    }
  }

  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ ok: false, error: 'All НОИ feed URLs failed' }),
  };
};
