import * as cheerio from 'cheerio';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const platform = detectPlatform(url);
    const html = await fetchPage(url, platform);
    const data = parseVehicle(html, url, platform);
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function fetchPage(url, platform) {
  const SCRAPER_KEY = 'c12fb1626ab469fb5e3e0807397c93d7';
  // GoAuto needs render for Next.js, AutoTrader and CarGurus need render for JS gallery
  // D2C (Mountain View) works without render - render triggers bot detection
  // Convertus (Kaizen) needs render for kms/full data
  const needsRender = ['autotrader', 'cargurus', 'goauto', 'convertus'].includes(platform);
  const scraperUrl = needsRender
    ? `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=true&premium=true&country_code=ca`
    : `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&country_code=ca`;

  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(scraperUrl, { headers: { 'Accept': 'text/html' }, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (html.length < 500) throw new Error('Blocked: ' + html.slice(0, 100));
      return html;
    } catch (e) {
      if (i === 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function detectPlatform(url) {
  if (url.includes('goauto')) return 'goauto';
  if (url.includes('autotrader.ca')) return 'autotrader';
  if (url.includes('cargurus.ca') || url.includes('cargurus.com')) return 'cargurus';
  if (url.includes('kaizenauto') || url.includes('airdriedodge') || url.includes('summitram') || url.includes('chnissan') || url.includes('chhyundai') || url.includes('shawgmc') || url.includes('woodbinegm') || url.includes('okotoksgm') || url.includes('strathmoreford') || url.includes('universalford') || url.includes('summitgm')) return 'convertus';
  return 'generic';
}

function parseVehicle(html, url, platform) {
  const $ = cheerio.load(html);
  const text = $('body').text();
  if (platform === 'generic') {
    if (html.includes('d2cmedia.ca') || html.includes('imagescdn.d2cmedia')) platform = 'd2c';
    else if (html.includes('convertus') || html.includes('tadvantage') || html.includes('autotradercdn.ca')) platform = 'convertus';
  }
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const d = JSON.parse($(el).html());
      const items = Array.isArray(d) ? d : [d];
      for (const item of items) {
        if (['Car','Vehicle','Product'].includes(item['@type'])) { jsonLd = item; break; }
      }
    } catch (_) {}
  });
  const result = { title: null, color: null, kms: null, wasPrice: null, todayPrice: null, biweeklyPayment: null, features: [], images: [] };

  if (platform === 'autotrader') {
    let ngData = null;
    for (const pat of [/window\['ngVdpModel'\]\s*=\s*(\{.+?\});\s*window/s, /window\["ngVdpModel"\]\s*=\s*(\{.+?\});\s*window/s]) {
      const m = html.match(pat);
      if (m && m[1]) { try { ngData = JSON.parse(m[1]); break; } catch(_) {} }
    }
    if (ngData) {
      const hero = ngData.hero || {};
      const specs = ngData.specifications?.specs || ngData.specifications || {};
      const pricing = ngData.price || ngData.pricing || {};
      result.title = [hero.year, hero.make, hero.model, hero.trim].filter(Boolean).join(' ') || null;
      result.color = hero.colourExterior || specs.exteriorColour || specs.colour || null;
      const odo = hero.mileage || specs.kilometres;
      if (odo) result.kms = formatKms(odo);
      if (pricing.price || pricing.listPrice) result.todayPrice = '$' + Number(pricing.price || pricing.listPrice).toLocaleString();
      // Search ALL keys in ngData for image arrays
      const allImgUrls = findImages(ngData);
      result.images = allImgUrls.slice(0, 25);
    }
    if (!result.title) result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    if (!result.color) { const m = text.match(/Exterior Colou?r[:\s]+([A-Za-z\s]+?)(?:\n|Interior)/i); if (m) result.color = m[1].trim(); }
    // Image fallback - extract from rendered DOM and raw HTML
    if (!result.images.length) {
      const imgSet = new Set();
      const ms = html.matchAll(/https:\/\/[a-z0-9-]+\.autotradercdn\.ca\/photos\/[^"'\s\\]+/gi);
      for (const m of ms) imgSet.add(m[0].replace(/-\d+x\d+\./, '-2048x1536.'));
      $('img[src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
      $('img[data-src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('data-src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
      result.images = [...imgSet].filter(u => !u.includes('logo') && !u.includes('icon')).slice(0, 25);
    }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'cargurus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
      // Check unit code - KMT = km already, SMI = miles need conversion
      if (jsonLd.mileageFromOdometer?.value) {
        const val = Number(jsonLd.mileageFromOdometer.value);
        const unit = jsonLd.mileageFromOdometer.unitCode || 'KMT';
        result.kms = formatKms(unit === 'SMI' ? Math.round(val * 1.60934) : val);
      }
      // Images from JSON-LD
      if (jsonLd.image) {
        const imgs = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
        result.images = imgs.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 25);
      }
    }
    if (!result.kms) {
      const kmMatch = text.match(/([\d,]+)\s*km\b/i);
      const miMatch = text.match(/([\d,]+)\s*(?:miles|mi)\b/i);
      if (kmMatch) result.kms = formatKms(kmMatch[1].replace(/,/g, ''));
      else if (miMatch) result.kms = formatKms(Math.round(Number(miMatch[1].replace(/,/g,'')) * 1.60934));
    }
    if (!result.images.length) {
      const cgSet = new Set();
      const ms = html.matchAll(/https:\/\/[^"'\s]*(?:cargurus|vehicle-photos|carphotos)[^"'\s]*\.(?:jpg|jpeg|png|webp)/gi);
      for (const m of ms) cgSet.add(m[0]);
      $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) cgSet.add(s); });
      $('img[src]').each((_, el) => { const s = $(el).attr('src') || ''; if (s.includes('vehicle') && s.startsWith('http')) cgSet.add(s); });
      result.images = [...cgSet].slice(0, 25);
    }
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'convertus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w[\w\s]*\|.*$/i, '').replace(/\s*-\s*\d+[A-Z0-9]+$/, '').trim();

    // Price from meta description - most reliable for Convertus
    const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    const metaPrice = metaDesc.match(/\$([\d,]+)\s*CAD/i) || metaDesc.match(/only\s*\$([\d,]+)/i);
    if (metaPrice) result.todayPrice = '$' + metaPrice[1];

    // Try embedded vehicle JSON
    const convMatch = html.match(/var\s+vehicle\s*=\s*(\{[\s\S]*?\});\s*(?:var|\/\/|<\/script>)/) ||
                      html.match(/window\.vehicle\s*=\s*(\{[\s\S]*?\});/) ||
                      html.match(/"vehicle"\s*:\s*(\{[\s\S]*?"vin"[\s\S]*?\})/);
    if (convMatch) {
      try {
        const v = JSON.parse(convMatch[1]);
        result.color = v.exteriorColor || v.color || v.ext_color || null;
        if (v.odometer || v.mileage || v.kilometres) result.kms = formatKms(v.odometer || v.mileage || v.kilometres);
        if (!result.todayPrice && (v.price || v.salePrice)) result.todayPrice = '$' + Number(v.price || v.salePrice).toLocaleString();
        if (v.msrp || v.originalPrice) result.wasPrice = '$' + Number(v.msrp || v.originalPrice).toLocaleString();
      } catch (_) {}
    }

    // JSON-LD fallback
    if (jsonLd) {
      if (!result.color) result.color = jsonLd.color || null;
      if (!result.kms && jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (!result.todayPrice && jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }

    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.color) { const m = text.match(/(?:Exterior|Ext\.?)[:\s]+([A-Za-z][A-Za-z\s]{2,20}?)(?:\n|Interior|Int\.?|,)/i); if (m) result.color = m[1].trim(); }

    // Images — photomanager CDN pattern
    const imgSet = new Set();
    const ms1 = html.matchAll(/https:\/\/[^"'\s\\]*photomanager[^"'\s\\]*autotradercdn[^"'\s\\]*/gi);
    for (const m of ms1) imgSet.add(m[0]);
    const ms2 = html.matchAll(/https:\/\/[^"'\s\\]*autotradercdn\.ca\/photos\/[^"'\s\\]+/gi);
    for (const m of ms2) imgSet.add(m[0].replace(/-\d+x\d+\./, '-2048x1536.'));
    $('img[src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s && !s.includes('logo')) imgSet.add(s); });
    // og:image is first photo - try to derive the full gallery UUID pattern
    const ogImg = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
    if (ogImg && ogImg.includes('autotradercdn')) {
      // Pattern: .../photos/import/YYYYMM/SITE/DEALER/UUID.jpg-2048x1536
      const baseMatch = ogImg.match(/(https:\/\/[^/]+\/photos\/import\/\d+\/\d+\/\d+\/)[a-f0-9-]+(\.jpg)/i);
      if (!baseMatch) imgSet.add(ogImg);
    }
    result.images = [...imgSet].filter(u => !u.includes('logo') && !u.includes('icon')).slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'goauto') {
    result.title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || null;
    let nextData = null;
    $('script#__NEXT_DATA__').each((_, el) => { try { nextData = JSON.parse($(el).html()); } catch (_) {} });
    if (nextData) {
      const props = findDeep(nextData, 'vehicle') || findDeep(nextData, 'listing');
      if (props) {
        if (!result.title) result.title = formatTitle(props);
        result.color = props.exteriorColour || props.color || props.exteriorColor || null;
        result.kms = props.odometer ? formatKms(props.odometer) : null;
        result.todayPrice = props.price ? '$' + Number(props.price).toLocaleString() : null;
        result.wasPrice = props.regularPrice ? '$' + Number(props.regularPrice).toLocaleString() : null;
      }
    }
    if (!result.kms) { const m = text.match(/(\d[\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.todayPrice) { const m = text.match(/Your Price\s*\$\s*([\d,]+)/i); if (m) result.todayPrice = '$' + m[1]; }
    if (!result.wasPrice) { const m = text.match(/Regular Price\s*\$\s*([\d,]+)/i); if (m) result.wasPrice = '$' + m[1]; }
    if (!result.color) { const m = text.match(/Exterior Colou?r\s*\n?\s*([A-Za-z\s]+)/i); if (m) result.color = m[1].trim().split('\n')[0].trim(); }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';
    const imgSet = new Set();
    const ms3 = html.matchAll(/https:\/\/res\.cloudinary\.com\/goauto-images\/image\/upload\/[^"'\s,)]+/g);
    for (const m of ms3) { const u = m[0].replace(/l_v1:overlays[^/]+\//g, '').replace(/c_fit,[^/]+\//g, ''); if (u.includes('/inventory/')) imgSet.add(u); }
    result.images = [...imgSet].slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'd2c') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w+\s*$|for\s+sale.*$/i, '').trim();
    const yourPrice = text.match(/Your Price:\s*\n?\s*([\d,]+)/i) || text.match(/Price:\s*([\d,]+)/i);
    if (yourPrice) result.todayPrice = '$' + yourPrice[1].replace(/,/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    const colorM = text.match(/Ext(?:erior)?[:\s]+([A-Za-z]+)/i);
    if (colorM) result.color = colorM[1].trim();
    const imgSet = new Set();
    $('a[href*="imagescdn.d2cmedia"]').each((_, el) => { const h = $(el).attr('href'); if (h && h.startsWith('http')) imgSet.add(h); });
    $('img[src*="imagescdn.d2cmedia"]').each((_, el) => { const s = $(el).attr('src'); if (s && s.startsWith('http')) imgSet.add(s); });
    const ms4 = html.matchAll(/https:\/\/imagescdn\.d2cmedia\.ca\/[^"'\s)]+\.jpg/g);
    for (const m of ms4) imgSet.add(m[0]);
    const allD2c = [...imgSet];
    const sample = allD2c.find(u => u.includes('cbe')) || allD2c.find(u => u.includes('imagescdn.d2cmedia'));
    if (sample) {
      const pm = sample.match(/(https:\/\/imagescdn\.d2cmedia\.ca\/[a-z0-9]+\/\d+\/\d+\/)(\d+)(\/[^"'\s]+\.jpg)/);
      if (pm) { for (let i = 1; i <= 30; i++) imgSet.add(`${pm[1]}${i}${pm[3]}`); }
    }
    result.images = [...imgSet].filter(u => !u.includes('logo')).slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  else {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    const imgSet = new Set();
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) imgSet.add(s); });
    $('a[href]').each((_, el) => { const h = $(el).attr('href') || ''; if (h.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(h) && !h.includes('logo')) imgSet.add(h); });
    $('img[src]').each((_, el) => { const s = $(el).attr('src') || ''; if (s.startsWith('http') && !s.includes('logo') && !s.includes('icon')) imgSet.add(s); });
    result.images = [...imgSet].slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  if (result.title) result.title = result.title.replace(/\s+/g, ' ').trim();
  return result;
}

// Recursively search ngVdpModel for image URL arrays
function findImages(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return [];
  const imageKeys = ['photos', 'images', 'heroPhotos', 'allPhotos', 'vehiclePhotos', 'galleryPhotos', 'mediaItems', 'items'];
  for (const key of imageKeys) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) {
      const urls = obj[key].map(p => {
        if (typeof p === 'string' && p.startsWith('http')) return p;
        if (typeof p === 'object') return p.largeUrl || p.highResUrl || p.url || p.src || p.photoUrl || p.imageUrl || null;
        return null;
      }).filter(Boolean);
      if (urls.length > 0) return urls;
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const found = findImages(val, depth + 1);
      if (found.length > 0) return found;
    }
  }
  return [];
}

function formatKms(val) {
  const n = parseInt(String(val).replace(/[^0-9]/g, ''));
  if (isNaN(n)) return null;
  return n.toLocaleString() + ' kms';
}

function formatTitle(props) {
  return [props.year, props.make, props.model, props.trim].filter(Boolean).join(' ') || null;
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
    ['4WD|4x4', '4-Wheel Drive: Off-road and all-weather capability'],
    ['Heated Seat', 'Heated Front Seats: Comfort during cold Canadian winters'],
    ['Heated Steering', 'Heated Steering Wheel: Warm grip in any weather'],
    ['CarPlay|Apple Car', 'Apple CarPlay & Android Auto: Seamless smartphone integration'],
    ['Backup Camera|Rear Camera', 'Backup Camera: Safe and confident reversing'],
    ['Blind Spot', 'Blind Spot Monitor: Safer lane changes'],
    ['Push.Button Start|Remote Start', 'Remote Start & Push-Button Start: Ultimate convenience'],
    ['Wireless Charg', 'Wireless Phone Charging: No cords needed'],
    ['Sunroof|Moonroof|Panoramic', 'Panoramic Sunroof: Open-air driving experience'],
    ['Leather', 'Leather Seats: Premium interior comfort'],
    ['Navigation|Nav Sys', 'Built-in Navigation: Always know where you are going'],
    ['7.Passenger|3rd Row', '7-Passenger Seating: Room for the whole family'],
    ['Lane Keep|Lane Assist', 'Lane Keeping Assist: Advanced safety technology'],
    ['Adaptive Cruise', 'Adaptive Cruise Control: Intelligent highway driving'],
    ['Climate Control', 'Dual-Zone Climate Control: Individual temperature preferences'],
    ['Turbo', 'Turbocharged Engine: More power and efficiency'],
    ['Tow|Trailer', 'Tow Package: Ready for trailers and heavy loads'],
  ];
  const found = [];
  const seen = new Set();
  for (const [kw, label] of keywords) {
    const key = label.split(':')[0];
    if (!seen.has(key) && new RegExp(kw, 'i').test(text)) { found.push(label); seen.add(key); }
    if (found.length >= 10) break;
  }
  return found;
}
