export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).end('No URL');
  try {
    const r = await fetch(decodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.mountainviewdodge.com/',
      }
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
