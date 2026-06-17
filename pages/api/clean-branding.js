export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const CLIPDROP_KEY = '065cedc3bd2431a7942347071ec7f21cafada26bd26164b07a940f08c55e7f681ace4c195c16788d964027fd347d363a';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl, maskDataUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

    // Fetch the source image
    let imageBuffer;
    if (imageUrl.startsWith('data:')) {
      imageBuffer = Buffer.from(imageUrl.split(',')[1], 'base64');
    } else {
      const imgResp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://tyme-vehicle-builder.vercel.app/' },
        signal: AbortSignal.timeout(15000)
      });
      if (!imgResp.ok) throw new Error('Could not fetch image');
      imageBuffer = Buffer.from(await imgResp.arrayBuffer());
    }

    if (maskDataUrl) {
      // Cleanup mode: erase painted areas using mask
      const maskBuffer = Buffer.from(maskDataUrl.split(',')[1], 'base64');
      const fd = new FormData();
      fd.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');
      fd.append('mask_file', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
      const resp = await fetch('https://clipdrop-api.co/cleanup/v1', {
        method: 'POST',
        headers: { 'x-api-key': CLIPDROP_KEY },
        body: fd,
        signal: AbortSignal.timeout(60000)
      });
      if (!resp.ok) throw new Error(`Clipdrop cleanup error ${resp.status}: ${(await resp.text()).slice(0,200)}`);
      const result = Buffer.from(await resp.arrayBuffer());
      return res.status(200).json({ success: true, dataUrl: `data:image/jpeg;base64,${result.toString('base64')}` });
    } else {
      // Text removal mode: auto-remove all text/watermarks
      const fd = new FormData();
      fd.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');
      const resp = await fetch('https://clipdrop-api.co/remove-text/v1', {
        method: 'POST',
        headers: { 'x-api-key': CLIPDROP_KEY },
        body: fd,
        signal: AbortSignal.timeout(60000)
      });
      if (!resp.ok) throw new Error(`Clipdrop remove-text error ${resp.status}: ${(await resp.text()).slice(0,200)}`);
      const result = Buffer.from(await resp.arrayBuffer());
      return res.status(200).json({ success: true, dataUrl: `data:image/png;base64,${result.toString('base64')}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
