export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const CLIPDROP_KEY = '065cedc3bd2431a7942347071ec7f21cafada26bd26164b07a940f08c55e7f681ace4c195c16788d964027fd347d363a';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    // Fetch the image server-side
    let imageBuffer;
    if (imageUrl.startsWith('data:')) {
      const base64 = imageUrl.split(',')[1];
      imageBuffer = Buffer.from(base64, 'base64');
    } else {
      const imgResp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://tyme-vehicle-builder.vercel.app/' },
        signal: AbortSignal.timeout(15000)
      });
      if (!imgResp.ok) throw new Error('Could not fetch image');
      imageBuffer = Buffer.from(await imgResp.arrayBuffer());
    }

    // Call Clipdrop cleanup (removes text, logos, signs automatically)
    const fd = new FormData();
    fd.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

    const resp = await fetch('https://clipdrop-api.co/cleanup/v1', {
      method: 'POST',
      headers: { 'x-api-key': CLIPDROP_KEY },
      body: fd,
      signal: AbortSignal.timeout(60000)
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Clipdrop error ${resp.status}: ${err.slice(0, 200)}`);
    }

    const resultBuffer = Buffer.from(await resp.arrayBuffer());
    const base64Result = resultBuffer.toString('base64');
    res.status(200).json({ success: true, dataUrl: `data:image/png;base64,${base64Result}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
