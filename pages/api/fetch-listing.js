import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const html = await fetchWithRetry(url);
    const data = parseVehicle(html, url);
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function fetchWithRetry(url, attempts = 2) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-CA,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function parseVehicle(html, url) {
  const $ = cheerio.load(html);
  const platform = detectPlatform(url);
  const text = $('body').text();

  // Try JSON-LD first (works on most platforms)
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const d = JSON.parse($(el).html());
      const items = Array.isArray(d) ? d : [d];
      for (const item of items) {
        if (item['@type'] === 'Car' || item['@type'] === 'Vehicle' || item['@type'] === 'Product') {
          jsonLd = item; break;
        }
      }
    } catch (_) {}
  });

  // Try Next.js __NEXT_DATA__
  let nextData = null;
  $('script#__NEXT_DATA__').each((_, el) => {
    try { nextData = JSON.parse($(el).html()); } catch (_) {}
  });

  const result = {
    title: null, color: null, kms: null,
    wasPrice: null, todayPrice: null, biweeklyPayment: null,
    features: [], images: []
  };

  // ── GOAUTO ──────────────────────────────────────────────
  if (platform === 'goauto') {
    // Title from og:title or h1
    result.title = $('meta[property="og:title"]').attr('content') ||
                   $('h1').first().text().trim() || null;

    // Try Next.js page props
    if (nextData) {
      const props = findDeep(nextData, 'vehicle') || findDeep(nextData, 'listing');
      if (props) {
        result.title = result.title || formatTitle(props);
        result.color = props.exteriorColour || props.color || props.exteriorColor || null;
        result.kms = props.odometer ? formatKms(props.odometer) : null;
        result.todayPrice = props.price ? '$' + Number(props.price).toLocaleString() : null;
        result.wasPrice = props.regularPrice ? '$' + Number(props.regularPrice).toLocaleString() : null;
      }
    }

    // Fallback: parse text
    if (!result.kms) {
      const m = text.match(/(\d[\d,]+)\s*(?:km|kilometers|kilometres)/i);
      if (m) result.kms = formatKms(m[1].replace(/,/g, ''));
    }
    if (!result.todayPrice) {
      const m = text.match(/Your Price\s*\$\s*([\d,]+)/i) || text.match(/Sale Price\s*\$\s*([\d,]+)/i);
      if (m) result.todayPrice = '$' + m[1];
    }
    if (!result.wasPrice) {
      const m = text.match(/Regular Price\s*\$\s*([\d,]+)/i) || text.match(/Was\s*\$\s*([\d,]+)/i);
      if (m) result.wasPrice = '$' + m[1];
    }
    if (!result.color) {
      const m = text.match(/Exterior Colou?r\s*\n?\s*([A-Za-z\s]+)/i);
      if (m) result.color = m[1].trim().split('\n')[0].trim();
    }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';

    // Images from Cloudinary
    const imgSet = new Set();
    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src.includes('cloudinary') && src.includes('inventory')) {
        const clean = src.replace(/l_v1:overlays[^/]+\//g, '').replace(/c_fit,[^/]+\//g, '').replace(/f_auto,[^/]*/g, 'f_auto,w_1200,q_auto');
        imgSet.add(clean);
      }
    });
    // Also check srcset and data-src
    $('img[srcset], img[data-src]').each((_, el) => {
      const s = $(el).attr('data-src') || '';
      if (s.includes('cloudinary')) imgSet.add(s);
    });
    // Extract from page source directly
    const cloudinaryMatches = html.matchAll(/https:\/\/res\.cloudinary\.com\/goauto-images\/image\/upload\/[^"'\s,)]+/g);
    for (const m of cloudinaryMatches) {
      const url = m[0].replace(/l_v1:overlays[^/]+\//g, '').replace(/c_fit,[^/]+\//g, '');
      if (url.includes('/inventory/')) imgSet.add(url);
    }
    result.images = [...imgSet].slice(0, 25);

    // Features from highlights section
    const highlights = [];
    $('.highlight, [class*="highlight"], [class*="feature"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 60) highlights.push(t);
    });
    if (highlights.length) result.features = highlights.slice(0, 10).map(h => h + ':');
    else result.features = extractFeaturesFromText(text);
  }

  // ── AUTOTRADER ──────────────────────────────────────────
  else if (platform === 'autotrader') {
    result.title = $('h1.hero-title, h1[class*="title"], h1').first().text().trim() ||
                   $('meta[property="og:title"]').attr('content') || null;

    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }

    // AutoTrader price patterns
    if (!result.todayPrice) {
      const m = text.match(/\$\s*([\d,]+)\s*(?:plus GST|CAD|Price)/i);
      if (m) result.todayPrice = '$' + m[1];
    }
    if (!result.kms) {
      const m = text.match(/([\d,]+)\s*(?:km|kilometers)/i);
      if (m) result.kms = formatKms(m[1].replace(/,/g, ''));
    }
    if (!result.color) {
      const m = text.match(/(?:Exterior|Colour|Color)[:\s]+([A-Za-z\s]+?)(?:\n|Interior|Doors)/i);
      if (m) result.color = m[1].trim();
    }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';

    // AutoTrader images
    const imgSet = new Set();
    const atImgMatches = html.matchAll(/https:\/\/[^"'\s]*(?:images\.autotrader|at-media)[^"'\s]*/g);
    for (const m of atImgMatches) imgSet.add(m[0]);
    $('img[src*="autotrader"], img[data-src*="autotrader"]').each((_, el) => {
      const s = $(el).attr('src') || $(el).attr('data-src') || '';
      if (s.startsWith('http')) imgSet.add(s);
    });
    result.images = [...imgSet].filter(u => !u.includes('logo') && !u.includes('icon')).slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  // ── CARGURUS ──────────────────────────────────────────
  else if (platform === 'cargurus') {
    result.title = $('h1').first().text().trim() ||
                   $('meta[property="og:title"]').attr('content') || null;

    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    if (!result.kms) {
      const m = text.match(/([\d,]+)\s*(?:mi|miles|km)/i);
      if (m) result.kms = formatKms(m[1].replace(/,/g, ''));
    }

    const cgImgSet = new Set();
    const cgMatches = html.matchAll(/https:\/\/[^"'\s]*(?:static\.cargurus|i\.imgur|cg-media)[^"'\s]*/g);
    for (const m of cgMatches) cgImgSet.add(m[0]);
    result.images = [...cgImgSet].slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  // ── GENERIC FALLBACK ─────────────────────────────────
  else {
    result.title = $('h1').first().text().trim() ||
                   $('meta[property="og:title"]').attr('content') || null;
    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    const imgSet = new Set();
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) imgSet.add(s); });
    $('img[src]').each((_, el) => { const s = $(el).attr('src'); if (s && s.startsWith('http') && !s.includes('logo') && !s.includes('icon')) imgSet.add(s); });
    result.images = [...imgSet].slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  // Clean up title
  if (result.title) result.title = result.title.replace(/\s+/g, ' ').trim();

  return result;
}

function detectPlatform(url) {
  if (url.includes('goauto')) return 'goauto';
  if (url.includes('autotrader.ca')) return 'autotrader';
  if (url.includes('cargurus')) return 'cargurus';
  return 'generic';
}

function formatKms(val) {
  const n = parseInt(String(val).replace(/[^0-9]/g, ''));
  if (isNaN(n)) return null;
  return n.toLocaleString() + ' kms';
}

function formatTitle(props) {
  const parts = [props.year, props.make, props.model, props.trim].filter(Boolean);
  return parts.join(' ') || null;
}

function findDeep(obj, key, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  if (obj[key]) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findDeep(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractFeaturesFromText(text) {
  const keywords = [
    ['V6', '3.3L V6 Engine: Strong highway performance and towing capability'],
    ['V8', 'V8 Engine: Powerful and capable'],
    ['AWD', 'All-Wheel Drive: Added confidence in snow, rain, and challenging conditions'],
    ['4WD', '4-Wheel Drive: Off-road and all-weather capability'],
    ['Heated Seat', 'Heated Front Seats: Comfort during cold Canadian winters'],
    ['Heated Steering', 'Heated Steering Wheel: Warm grip in any weather'],
    ['CarPlay', 'Apple CarPlay & Android Auto: Seamless smartphone integration'],
    ['Backup', 'Backup Camera: Safe and confident reversing'],
    ['Blind Spot', 'Blind Spot Monitor: Safer lane changes'],
    ['Push.Button Start', 'Push-Button Start: Keyless convenience'],
    ['Wireless Charg', 'Wireless Phone Charging: No cords needed'],
    ['Sunroof', 'Sunroof / Moonroof: Open-air driving experience'],
    ['Leather', 'Leather Seats: Premium interior comfort'],
    ['Navigation', 'Built-in Navigation: Always know where you are going'],
    ['7.Passenger', '7-Passenger Seating: Room for the whole family'],
    ['Remote Start', 'Remote Start: Warm up or cool down before you get in'],
    ['Lane Keep', 'Lane Keeping Assist: Advanced safety technology'],
    ['Adaptive Cruise', 'Adaptive Cruise Control: Intelligent highway driving'],
    ['Climate Control', 'Dual-Zone Climate Control: Individual temperature preferences'],
    ['Panoramic', 'Panoramic Sunroof: Expansive open-air feeling'],
  ];
  const found = [];
  const seen = new Set();
  for (const [kw, label] of keywords) {
    const key = label.split(':')[0];
    if (!seen.has(key) && new RegExp(kw, 'i').test(text)) {
      found.push(label);
      seen.add(key);
    }
    if (found.length >= 10) break;
  }
  return found;
}
