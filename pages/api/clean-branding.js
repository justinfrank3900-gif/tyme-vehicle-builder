export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const CLIPDROP_KEY = '065cedc3bd2431a7942347071ec7f21cafada26bd26164b07a940f08c55e7f681ace4c195c16788d964027fd347d363a';

// Build a PNG mask with white rectangles in dealer branding zones
// White = erase, Black = keep
function buildMaskBuffer(w, h) {
  // We'll build a minimal valid PNG manually
  // Use a simple approach: create an HTML canvas-equivalent in pure JS
  // Since we can't use canvas server-side easily, use a pre-built mask approach
  // Create mask as raw RGBA buffer then encode as PNG using pngjs or similar
  // Instead: use a data URI approach with fetch
  return null; // handled differently below
}

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
      // Manual brush erase mode - use cleanup with provided mask
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
    }

    // Auto clean mode: Step 1 - remove-text
    const fd1 = new FormData();
    fd1.append('image_file', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');
    const resp1 = await fetch('https://clipdrop-api.co/remove-text/v1', {
      method: 'POST',
      headers: { 'x-api-key': CLIPDROP_KEY },
      body: fd1,
      signal: AbortSignal.timeout(45000)
    });
    if (!resp1.ok) throw new Error(`remove-text error ${resp1.status}`);
    const step1Buffer = Buffer.from(await resp1.arrayBuffer());

    // Step 2: cleanup with auto bottom-bar mask (bottom 18% of image)
    // Send mask as base64 PNG from client - but we need to generate it server-side
    // We'll use a simple PPM->PNG approach or just send back step1 with instructions
    // Actually: generate mask using raw PNG bytes (minimal PNG format)
    // A 1x1 white PNG scaled - instead use Clipdrop's cleanup with a generated mask

    // Generate minimal PNG mask: white bottom 18%, black rest
    // We know image dimensions from the buffer - parse JPEG header
    let imgW = 1280, imgH = 960; // default assumption
    // JPEG dimensions are at byte offset after SOF marker
    try {
      for (let i = 0; i < imageBuffer.length - 8; i++) {
        if (imageBuffer[i] === 0xFF && (imageBuffer[i+1] === 0xC0 || imageBuffer[i+1] === 0xC2)) {
          imgH = (imageBuffer[i+5] << 8) | imageBuffer[i+6];
          imgW = (imageBuffer[i+7] << 8) | imageBuffer[i+8];
          break;
        }
      }
    } catch(_) {}

    // Build PNG mask buffer
    const maskW = imgW, maskH = imgH;
    const barH = Math.round(maskH * 0.18); // bottom 18%
    // Also mask top-left corner (logo area, 20% x 15%)
    const cornerW = Math.round(maskW * 0.22);
    const cornerH = Math.round(maskH * 0.14);

    // Create raw RGBA pixel data
    const pixels = Buffer.alloc(maskW * maskH * 4, 0); // all black (keep)
    // White out bottom bar
    for (let y = maskH - barH; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        const i = (y * maskW + x) * 4;
        pixels[i] = pixels[i+1] = pixels[i+2] = pixels[i+3] = 255;
      }
    }
    // White out top-left corner
    for (let y = 0; y < cornerH; y++) {
      for (let x = 0; x < cornerW; x++) {
        const i = (y * maskW + x) * 4;
        pixels[i] = pixels[i+1] = pixels[i+2] = pixels[i+3] = 255;
      }
    }

    // Encode as PNG using raw chunks
    const { deflateSync } = await import('zlib');

    function pngChunk(type, data) {
      const typeBytes = Buffer.from(type, 'ascii');
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crcData = Buffer.concat([typeBytes, data]);
      let crc = 0xFFFFFFFF;
      for (const b of crcData) {
        crc ^= b;
        for (let k = 0; k < 8; k++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
      }
      const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
      return Buffer.concat([len, typeBytes, data, crcBuf]);
    }

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(maskW, 0); ihdr.writeUInt32BE(maskH, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    ihdr[10] = ihdr[11] = ihdr[12] = 0;

    // Build scanlines (RGB, no alpha, with filter byte 0)
    const scanlines = Buffer.alloc(maskH * (1 + maskW * 3));
    for (let y = 0; y < maskH; y++) {
      scanlines[y * (1 + maskW * 3)] = 0; // filter none
      for (let x = 0; x < maskW; x++) {
        const pi = (y * maskW + x) * 4;
        const si = y * (1 + maskW * 3) + 1 + x * 3;
        scanlines[si] = pixels[pi];
        scanlines[si+1] = pixels[pi+1];
        scanlines[si+2] = pixels[pi+2];
      }
    }

    const compressed = deflateSync(scanlines);
    const pngBuffer = Buffer.concat([
      Buffer.from([137,80,78,71,13,10,26,10]), // PNG signature
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', Buffer.alloc(0))
    ]);

    // Step 2: cleanup with auto mask
    const fd2 = new FormData();
    fd2.append('image_file', new Blob([step1Buffer], { type: 'image/png' }), 'image.png');
    fd2.append('mask_file', new Blob([pngBuffer], { type: 'image/png' }), 'mask.png');
    const resp2 = await fetch('https://clipdrop-api.co/cleanup/v1', {
      method: 'POST',
      headers: { 'x-api-key': CLIPDROP_KEY },
      body: fd2,
      signal: AbortSignal.timeout(60000)
    });
    if (!resp2.ok) {
      // Cleanup failed, return step1 result
      const base64 = step1Buffer.toString('base64');
      return res.status(200).json({ success: true, dataUrl: `data:image/png;base64,${base64}` });
    }
    const result = Buffer.from(await resp2.arrayBuffer());
    res.status(200).json({ success: true, dataUrl: `data:image/jpeg;base64,${result.toString('base64')}` });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
