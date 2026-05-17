// netlify/functions/noi-feed.js
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
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

function fmtDate(str) {
  if (!str) return '';
  var d = new Date(str);
  if (isNaN(d.getTime())) return '';
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); }
function cdata(s)     { return (s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim(); }

/* ── RSS 2.0 parser ── */
function parseRSS(xml) {
  var items = [];
  var itemRx = /<item[\s\S]*?<\/item>/gi;
  var m;
  while ((m = itemRx.exec(xml)) !== null) {
    var block = m[0];
    var tM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    var lM = /<link[^>]*>([^<]*)<\/link>/i.exec(block)
          || /<link[^>]*href=["']([^"']+)["']/i.exec(block);
    var dM = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block);
    var title = tM ? stripTags(cdata(tM[1])) : '';
    var link  = lM ? lM[1].trim() : '';
    var date  = dM ? fmtDate(dM[1].trim()) : '';
    if (title && link) items.push({ title: title, link: link, date: date });
  }
  return items;
}

/* ── Atom parser ── */
function parseAtom(xml) {
  var items = [];
  var entryRx = /<entry[\s\S]*?<\/entry>/gi;
  var m;
  while ((m = entryRx.exec(xml)) !== null) {
    var block = m[0];
    var tM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
    /* Atom <link> is self-closing: <link href="..." rel="alternate" /> */
    var lM = /<link[^>]+href=["']([^"']+)["'][^>]*(?:rel=["']alternate["'])?/i.exec(block)
          || /<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i.exec(block);
    var dM = /<(?:published|updated)[^>]*>([\s\S]*?)<\/(?:published|updated)>/i.exec(block);
    var title = tM ? stripTags(cdata(tM[1])) : '';
    var link  = lM ? lM[1].trim() : '';
    var date  = dM ? fmtDate(dM[1].trim()) : '';
    if (title && link) items.push({ title: title, link: link, date: date });
  }
  return items;
}

/* ── HTML page scraper (fallback) ── */
function parseNoiHTML(html) {
  var items = [];
  /* НОИ WordPress — news articles are inside <h2> or <h3> with <a> inside */
  var rx = /<(?:h[1-4]|article|li)[^>]*>[\s\S]{0,200}?<a\s[^>]*href=["']([^"']+nssi\.bg[^"']+)["'][^>]*>([\s\S]{5,300}?)<\/a>/gi;
  var m;
  while ((m = rx.exec(html)) !== null) {
    var link  = m[1].trim();
    var title = stripTags(m[2]);
    if (title.length > 10 && title.length < 400 && !items.find(function(i){ return i.link===link; })) {
      items.push({ title: title, link: link, date: '' });
    }
  }
  return items;
}

exports.handler = async function() {
  var attempts = [
    { url: 'https://www.nssi.bg/publichnost/novini/feed/', type: 'feed' },
    { url: 'https://www.nssi.bg/?feed=rss2',               type: 'feed' },
    { url: 'https://www.nssi.bg/feed/',                    type: 'feed' },
    { url: 'https://www.nssi.bg/publichnost/novini/',      type: 'html' },
  ];

  var errors = [];
  for (var i = 0; i < attempts.length; i++) {
    var a = attempts[i];
    try {
      var body  = await get(a.url);
      var items = [];

      if (a.type === 'feed') {
        /* Try RSS first, then Atom */
        items = parseRSS(body);
        if (!items.length) items = parseAtom(body);
      } else {
        items = parseNoiHTML(body);
      }

      items = items.slice(0, 30);
      if (items.length) {
        return {
          statusCode: 200,
          headers: RESP_HEADERS,
          body: JSON.stringify({ ok: true, source: a.url, items: items }),
        };
      }
      errors.push(a.url + ': 0 items (type=' + a.type + ')');
    } catch(e) {
      errors.push(a.url + ': ' + e.message);
    }
  }

  return {
    statusCode: 502,
    headers: RESP_HEADERS,
    body: JSON.stringify({ ok: false, error: 'All НОИ sources failed', detail: errors }),
  };
};
