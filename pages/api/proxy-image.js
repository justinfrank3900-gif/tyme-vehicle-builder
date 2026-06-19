export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).end('No URL');
  try {
    const decodedUrl = decodeURIComponent(url);
    // Pick the right referer based on the image CDN
    let referer = 'https://www.autotrader.ca/';
    if (decodedUrl.includes('d2cmedia') || decodedUrl.includes('mountainviewdodge')) {
      referer = 'https://www.mountainviewdodge.com/';
    } else if (decodedUrl.includes('kaizenauto') || decodedUrl.includes('autotradercdn') || decodedUrl.includes('photomanager')) {
      referer = 'https://www.kaizenauto.com/';
    } else if (decodedUrl.includes('cargurus')) {
      // CarGurus CDN - try with their own referer
      referer = 'https://www.cargurus.ca/';
    } else if (decodedUrl.includes('static.cargurus.com')) {
      referer = 'https://www.cargurus.com/';
    } else if (decodedUrl.includes('autoscout24')) {
      referer = 'https://www.autotrader.ca/';
    }

    const r = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return res.status(r.status).end();
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    const buffer = await r.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).end(e.message);
  }
}
