// netlify/functions/noi-feed.js
const https = require('https');
const http  = require('http');

const NOI_FEEDS = [
  'https://www.nssi.bg/feed/',
  'https://www.nssi.bg/publichnost/novini/feed/',
  'https://www.nssi.bg/?feed=rss2',
];

const RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=900',
};

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var lib = url.startsWith('https') ? https : http;
    var req = lib.get(url, {
      rejectUnauthorized: false,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AccountingBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
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
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() { resolve(body); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fmtDate(str) {
  var d = new Date(str);
  if (isNaN(d.getTime())) return '';
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' +
         d.getFullYear();
}

function parseRSS(xml) {
  var items  = [];
  var itemRx = /<item[\s\S]*?<\/item>/gi;
  var m, block, title, link, date;
  while ((m = itemRx.exec(xml)) !== null) {
    block = m[0];
    var titleM = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block);
    var linkM  = /<link>([^<]*)<\/link>/i.exec(block);
    var dateM  = /<pubDate>([^<]*)<\/pubDate>/i.exec(block);
    title = titleM ? titleM[1].replace(/<[^>]+>/g,'').trim() : '';
    link  = linkM  ? linkM[1].trim() : '';
    date  = dateM  ? fmtDate(dateM[1]) : '';
    if (title && link) items.push({ title: title, link: link, date: date });
  }
  return items;
}

exports.handler = async function() {
  var errors = [];
  for (var i = 0; i < NOI_FEEDS.length; i++) {
    var url = NOI_FEEDS[i];
    try {
      var xml   = await get(url);
      var items = parseRSS(xml).slice(0, 30);
      if (items.length) {
        return { statusCode: 200, headers: RESP_HEADERS, body: JSON.stringify({ ok: true, items: items }) };
      }
      errors.push(url + ': 0 items parsed');
    } catch(e) {
      errors.push(url + ': ' + e.message);
    }
  }
  return {
    statusCode: 502,
    headers: RESP_HEADERS,
    body: JSON.stringify({ ok: false, error: 'All НОИ feeds failed', detail: errors }),
  };
};
