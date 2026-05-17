// netlify/functions/nap-news.js
const https = require('https');
const http  = require('http');

const NAP_URLS = [
  'https://nra.bg/wps/portal/nra/actualno/actualno',
  'https://nra.bg/wps/portal/nra/actualno',
];

const RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=900',
};

const BG_MONTHS = {
  'януари':0,'февруари':1,'март':2,'април':3,'май':4,'юни':5,
  'юли':6,'август':7,'септември':8,'октомври':9,'ноември':10,'декември':11,
};

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var lib = url.startsWith('https') ? https : http;
    var req = lib.get(url, {
      rejectUnauthorized: false,
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() { resolve(body); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fmtDate(day, monthIdx, year) {
  return String(day).padStart(2,'0') + '.' +
         String(monthIdx + 1).padStart(2,'0') + '.' + year;
}

function parseLinks(html) {
  var items  = [];
  var linkRx = /href="([^"]*\/actualno\/[^"?#]+)"[^>]*>([\s\S]{10,300}?)<\/a>/gi;
  var m;
  while ((m = linkRx.exec(html)) !== null) {
    var href  = m[1].trim();
    var title = m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if (
      href.endsWith('/actualno/actualno') ||
      href.endsWith('/actualno/')         ||
      title.length < 15                  ||
      title.length > 400
    ) continue;
    var fullUrl = href.startsWith('http') ? href : 'https://nra.bg' + href;
    if (items.find(function(i){ return i.link === fullUrl; })) continue;
    var ctx  = html.slice(Math.max(0, m.index - 200), m.index + m[0].length + 100);
    var date = '';
    var bgM  = ctx.match(/(\d{1,2})\s+(януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)\s+(\d{4})/i);
    var numM = ctx.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (bgM && BG_MONTHS[bgM[2].toLowerCase()] !== undefined) {
      date = fmtDate(bgM[1], BG_MONTHS[bgM[2].toLowerCase()], bgM[3]);
    } else if (numM) {
      date = numM[0];
    }
    items.push({ title: title, link: fullUrl, date: date });
  }
  return items;
}

exports.handler = async function() {
  var errors = [];
  for (var i = 0; i < NAP_URLS.length; i++) {
    var url = NAP_URLS[i];
    try {
      var html  = await get(url);
      var items = parseLinks(html).slice(0, 30);
      if (items.length) {
        return { statusCode: 200, headers: RESP_HEADERS, body: JSON.stringify({ ok: true, items: items }) };
      }
      errors.push(url + ': 0 links found');
    } catch(e) {
      errors.push(url + ': ' + e.message);
    }
  }
  return {
    statusCode: 502,
    headers: RESP_HEADERS,
    body: JSON.stringify({ ok: false, error: 'НАП page failed', detail: errors }),
  };
};
