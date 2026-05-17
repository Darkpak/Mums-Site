// netlify/functions/nap-news.js
// Fetches and parses the НАП news page server-side — no CORS issues.
// Called from the browser as: GET /.netlify/functions/nap-news

const NAP_URLS = [
	'https://nra.bg/wps/portal/nra/actualno/actualno',
	'https://nra.bg/wps/portal/nra/actualno',
];

const BG_MONTHS = {
	'януари':0,'февруари':1,'март':2,'април':3,'май':4,'юни':5,
	'юли':6,'август':7,'септември':8,'октомври':9,'ноември':10,'декември':11,
};

function fmtDate(str) {
	const d = new Date(str);
	if (isNaN(d)) return '';
	return d.getDate().toString().padStart(2,'0') + '.' +
	       (d.getMonth()+1).toString().padStart(2,'0') + '.' +
	       d.getFullYear();
}

export default async (req, context) => {
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
			const html = await res.text();

			/* Extract links pointing to individual actualno articles */
			const items  = [];
			const linkRx = /href="([^"]*\/actualno\/[^"]+)"[^>]*>([\s\S]{10,300}?)<\/a>/gi;
			let m;

			while ((m = linkRx.exec(html)) !== null) {
				let href  = m[1].trim();
				let title = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');

				if (
					href.endsWith('/actualno/actualno') ||
					href.endsWith('/actualno/') ||
					title.length < 15 ||
					title.length > 400
				) continue;

				const fullUrl = href.startsWith('http') ? href : 'https://nra.bg' + href;
				if (items.find(i => i.link === fullUrl)) continue;

				/* Try to extract a date from surrounding text */
				const start   = Math.max(0, m.index - 200);
				const context = html.slice(start, m.index + m[0].length + 100);
				let dateStr = '';

				const bgM = context.match(
					/(\d{1,2})\s+(януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)\s+(\d{4})/i
				);
				const numM = context.match(/(\d{2})\.(\d{2})\.(\d{4})/);

				if (bgM) {
					const month = BG_MONTHS[bgM[2].toLowerCase()];
					if (month !== undefined) {
						dateStr = fmtDate(new Date(+bgM[3], month, +bgM[1]));
					}
				} else if (numM) {
					dateStr = numM[0];
				}

				items.push({ title, link: fullUrl, date: dateStr });
			}

			if (items.length) {
				return new Response(
					JSON.stringify({ ok: true, items: items.slice(0, 30) }),
					{ headers }
				);
			}
		} catch (e) {
			// try next URL
		}
	}

	return new Response(
		JSON.stringify({ ok: false, error: 'НАП page could not be fetched or parsed' }),
		{ status: 502, headers }
	);
};

export const config = { path: '/api/nap-news' };
