// netlify/functions/noi-feed.js
// Fetches the НОИ WordPress RSS feed server-side — no CORS issues.
// Called from the browser as: GET /.netlify/functions/noi-feed

const NOI_FEEDS = [
	'https://www.nssi.bg/feed/',
	'https://www.nssi.bg/publichnost/novini/feed/',
	'https://www.nssi.bg/?feed=rss2',
];

export default async (req, context) => {
	const headers = {
		'Access-Control-Allow-Origin': '*',
		'Content-Type': 'application/json',
		'Cache-Control': 'public, max-age=900', // cache 15 min
	};

	for (const url of NOI_FEEDS) {
		try {
			const res = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AccountingBot/1.0)' },
				signal: AbortSignal.timeout(10000),
			});
			if (!res.ok) continue;

			const xml  = await res.text();
			const items = [];

			/* Simple regex-based XML parse — no external deps needed */
			const itemRx   = /<item[\s\S]*?<\/item>/gi;
			const titleRx  = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i;
			const linkRx   = /<link>([\s\S]*?)<\/link>/i;
			const dateRx   = /<pubDate>([\s\S]*?)<\/pubDate>/i;

			let match;
			while ((match = itemRx.exec(xml)) !== null) {
				const block = match[0];
				const titleM = titleRx.exec(block);
				const linkM  = linkRx.exec(block);
				const dateM  = dateRx.exec(block);
				const title  = (titleM?.[1] || titleM?.[2] || '').trim();
				const link   = (linkM?.[1] || '').trim();
				const date   = (dateM?.[1] || '').trim();
				if (title && link) items.push({ title, link, date });
			}

			if (items.length) {
				return new Response(JSON.stringify({ ok: true, source: url, items: items.slice(0, 30) }), { headers });
			}
		} catch (e) {
			// try next URL
		}
	}

	return new Response(JSON.stringify({ ok: false, error: 'All НОИ feed URLs failed' }), { status: 502, headers });
};

export const config = { path: '/api/noi-feed' };
