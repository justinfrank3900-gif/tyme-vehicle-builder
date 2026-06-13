export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    // Fetch the source image server-side
    let imageBuffer;
    if (imageUrl.startsWith('data:')) {
      // base64 data URL
      const base64 = imageUrl.split(',')[1];
      imageBuffer = Buffer.from(base64, 'base64');
    } else {
      // Fetch via proxy-friendly server fetch
      const imgResp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://tyme-vehicle-builder.vercel.app/' },
        signal: AbortSignal.timeout(15000)
      });
      if (!imgResp.ok) throw new Error('Could not fetch source image');
      imageBuffer = Buffer.from(await imgResp.arrayBuffer());
    }

    // Call remove.bg
    const fd = new FormData();
    fd.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');
    fd.append('size', 'auto');

    const rbResp = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': 'XuPUhMgNdXrxCXFMhABQbVnD' },
      body: fd,
      signal: AbortSignal.timeout(30000)
    });

    if (!rbResp.ok) {
      const errText = await rbResp.text();
      throw new Error(`remove.bg error ${rbResp.status}: ${errText.slice(0, 200)}`);
    }

    const resultBuffer = Buffer.from(await rbResp.arrayBuffer());
    const base64Result = resultBuffer.toString('base64');
    res.status(200).json({ success: true, dataUrl: `data:image/png;base64,${base64Result}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
