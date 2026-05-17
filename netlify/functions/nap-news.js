// netlify/functions/nap-news.js
//
// НАП's main actualno page is JavaScript-rendered (WebSphere Portal),
// so server-side fetching gets an empty shell. Instead we target:
//  1. НАП's WCM (Web Content Manager) REST/XML endpoints
//  2. The printer-friendly / plain versions of the page
//  3. A sitemap-based approach
//  4. kik-info.com's НАП news section as a reliable proxy source
//
const https = require('https');
const http  = require('http');

const RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=900',
};

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 8) return reject(new Error('Too many redirects'));
    var lib = url.startsWith('https') ? https : http;
    var req = lib.get(url, {
      rejectUnauthorized: false,
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,*/*;q=0.8',
        'Accept-Language': 'bg,en;q=0.9',
      },
    }, function(res) {
      if ([301,302,303,307,308].indexOf(res.statusCode) !== -1 && res.headers.location) {
        var next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return get(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.setEncoding('utf8');
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end',  function()  { resolve(body); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim(); }
function cdata(s)     { return (s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim(); }

function fmtDate(str) {
  if (!str) return '';
  var d = new Date(str);
  if (isNaN(d.getTime())) return '';
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

/* ── Parser for kik-info.com НАП news section ──
   kik-info aggregates НАП news with direct links back to nra.bg.
   This is our most reliable source. */
function parseKikInfo(html) {
  var items = [];
  /* Articles are in <h3 class="entry-title"> or similar, with <a href="..."> */
  var rx = /<a\s+[^>]*href=["']([^"']*(?:nra\.bg|kik-info\.com/novini/nap)[^"']*)["'][^>]*>([\s\S]{10,300}?)<\/a>/gi;
  var m;
  while ((m = rx.exec(html)) !== null) {
    var link  = m[1].trim();
    var title = stripTags(m[2]);
    if (
      title.length > 15 && title.length < 400 &&
      !items.find(function(i){ return i.link === link; })
    ) {
      /* Try to find a date near this link */
      var ctx  = html.slice(Math.max(0, m.index - 300), m.index + m[0].length + 100);
      var dateM = ctx.match(/(\d{1,2})[.\s\/](\d{2})[.\s\/](\d{4})/);
      var date = dateM ? dateM[1].padStart(2,'0') + '.' + dateM[2] + '.' + dateM[3] : '';
      items.push({ title: title, link: link, date: date });
    }
  }
  return items;
}

/* ── RSS parser (in case НАП ever exposes a feed) ── */
function parseRSS(xml) {
  var items = [];
  var itemRx = /<item[\s\S]*?<\/item>/gi;
  var m;
  while ((m = itemRx.exec(xml)) !== null) {
    var block = m[0];
    var tM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    var lM = /<link[^>]*>([^<]+)<\/link>/i.exec(block);
    var dM = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block);
    var title = tM ? stripTags(cdata(tM[1])) : '';
    var link  = lM ? lM[1].trim() : '';
    var date  = dM ? fmtDate(dM[1].trim()) : '';
    if (title && link) items.push({ title: title, link: link, date: date });
  }
  return items;
}

/* ── Generic НАП HTML parser with broad link detection ── */
function parseNapHTML(html, baseUrl) {
  var items = [];
  /* Broad: any link with meaningful text on nra.bg pages */
  var rx = /<a\s[^>]*href=["']([^"'#?]+)["'][^>]*>([\s\S]{15,350}?)<\/a>/gi;
  var m;
  while ((m = rx.exec(html)) !== null) {
    var href  = m[1].trim();
    var title = stripTags(m[2]);
    /* Must look like a news article: has a year in URL or title is sentence-length */
    if (
      title.length < 15 || title.length > 400 ||
      /^(начало|новини|меню|търси|вход|контакти|english|нагоре)/i.test(title)
    ) continue;
    var fullUrl = href.startsWith('http') ? href : 'https://nra.bg' + (href.startsWith('/') ? '' : '/') + href;
    if (items.find(function(i){ return i.link===fullUrl; })) continue;
    var ctx   = html.slice(Math.max(0, m.index-200), m.index + m[0].length + 100);
    var dateM = ctx.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    var date  = dateM ? dateM[0] : '';
    items.push({ title: title, link: fullUrl, date: date });
  }
  return items;
}

exports.handler = async function() {
  var attempts = [
    /* 1. kik-info.com НАП news — aggregated, server-rendered, most reliable */
    { url: 'https://kik-info.com/novini/nap/', parser: 'kikinfo' },
    /* 2. НАП WCM content library — sometimes exposes static HTML */
    { url: 'https://nra.bg/wps/wcm/connect/nra.bg/nra/home/actualno', parser: 'naphtml' },
    /* 3. Printer-friendly version — WebSphere sometimes renders these statically */
    { url: 'https://nra.bg/wps/portal/nra/actualno/actualno?WT.ac=news&printable=true', parser: 'naphtml' },
    /* 4. Direct WCM REST endpoint */
    { url: 'https://nra.bg/wps/wcm/connect/nra.bg/nra/actualno/', parser: 'rss' },
  ];

  var errors = [];
  for (var i = 0; i < attempts.length; i++) {
    var a = attempts[i];
    try {
      var body  = await get(a.url);
      var items = [];
      if      (a.parser === 'kikinfo') items = parseKikInfo(body);
      else if (a.parser === 'rss')     items = parseRSS(body);
      else                             items = parseNapHTML(body, a.url);
      items = items.slice(0, 30);
      if (items.length) {
        return {
          statusCode: 200,
          headers: RESP_HEADERS,
          body: JSON.stringify({ ok: true, source: a.url, items: items }),
        };
      }
      errors.push(a.url + ': 0 items');
    } catch(e) {
      errors.push(a.url + ': ' + e.message);
    }
  }

  return {
    statusCode: 502,
    headers: RESP_HEADERS,
    body: JSON.stringify({ ok: false, error: 'All НАП sources failed', detail: errors }),
  };
};
