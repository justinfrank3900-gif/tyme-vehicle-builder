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
    const html = await fetchWithRetry(url);
    const data = parseVehicle(html, url);
    res.status(200).json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function fetchWithRetry(url, attempts = 2) {
  const SCRAPER_KEY = 'c12fb1626ab469fb5e3e0807397c93d7';
const scraperUrl = `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=true&premium=true&country_code=ca`;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(scraperUrl, { headers: { 'Accept': 'text/html' }, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (html.length < 500) throw new Error('Response too short: ' + html.slice(0, 100));
      return html;
    } catch (e) {
      if (i === attempts - 1) throw e;
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

function parseVehicle(html, url) {
  const $ = cheerio.load(html);
  const text = $('body').text();
  let platform = detectPlatform(url);
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
    const ngPatterns = [
      /window\['ngVdpModel'\]\s*=\s*(\{.+?\});\s*window/s,
      /window\["ngVdpModel"\]\s*=\s*(\{.+?\});\s*window/s,
      /window\['ngVdpModel'\]\s*=\s*(\{.+)/s,
    ];
    for (const pat of ngPatterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1].startsWith('{')) {
        try { ngData = JSON.parse(m[1]); break; } catch(_) {
          // Try to extract partial JSON
          try {
            const partial = m[1].substring(0, m[1].lastIndexOf('}') + 1);
            ngData = JSON.parse(partial); break;
          } catch(_) {}
        }
      }
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
      // Try all possible gallery key names AutoTrader uses
      const gallery = ngData.gallery || ngData.mediaGallery || ngData.media || {};
      const photos = gallery.photos || gallery.images || gallery.heroPhotos || gallery.allPhotos || gallery.vehiclePhotos || ngData.photos || ngData.images || [];
      const imgUrls = photos.map(p => p.largeUrl || p.highResUrl || p.url || p.src || p.photoUrl || (typeof p === 'string' ? p : null)).filter(Boolean);
      result.images = imgUrls.slice(0, 25);
    }
    // Fallbacks
    if (!result.title) result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (!result.kms) { const m = text.match(/([\d,]+)\s*(?:km|kilometers)/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    if (!result.color) { const m = text.match(/Exterior Colou?r[:\s]+([A-Za-z\s]+?)(?:\n|Interior)/i); if (m) result.color = m[1].trim(); }
    // Image fallbacks - DOM based after JS render
    if (!result.images.length) {
      const imgSet = new Set();
      // CDN URLs in raw HTML
      const cdnMatches = html.matchAll(/https:\/\/[a-z0-9-]+\.autotradercdn\.ca\/photos\/[^"'\s\\]+/gi);
      for (const m of cdnMatches) imgSet.add(m[0].replace(/-\d+x\d+\./, '-2048x1536.'));
      // img tags after JS render
      $('img[src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
      // data-src lazy loaded
      $('img[data-src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('data-src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
      result.images = [...imgSet].filter(u => !u.includes('logo') && !u.includes('icon')).slice(0, 25);
    }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'cargurus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    const cgMatch = html.match(/window\.CarGurus\s*=\s*(\{[\s\S]*?\});\s*\n/) || html.match(/"listing"\s*:\s*(\{[^}]{50,}\})/);
    if (cgMatch) {
      try {
        const cg = JSON.parse(cgMatch[1]);
        const listing = cg.listing || cg;
        if (listing.price) result.todayPrice = '$' + Number(listing.price).toLocaleString();
        // Fix: check both mileage and miles fields
        const odo = listing.mileage || listing.miles || listing.odometer || listing.kilometre || listing.km;
        if (odo) result.kms = formatKms(odo);
        if (listing.exteriorColor) result.color = listing.exteriorColor;
        const imgs = listing.pictures || listing.images || listing.photos || [];
        result.images = imgs.map(p => p.full || p.large || p.url || p.src || p).filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 25);
      } catch (_) {}
    }
    if (jsonLd) {
      if (!result.color) result.color = jsonLd.color || null;
      if (!result.kms && jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (!result.todayPrice && jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    // Text fallback for kms
    if (!result.kms) {
      const m = text.match(/([\d,]+)\s*(?:km|kilometers|miles|mi)\b/i);
      if (m) result.kms = formatKms(m[1].replace(/,/g, ''));
    }
    if (!result.images.length) {
      const cgSet = new Set();
      const cgMatches = html.matchAll(/https:\/\/[^"'\s]*(?:cargurus|static\.cg|vehicle-photos)[^"'\s]*\.(?:jpg|jpeg|png|webp)/gi);
      for (const m of cgMatches) cgSet.add(m[0]);
      $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) cgSet.add(s); });
      $('img[src]').each((_, el) => { const s = $(el).attr('src') || ''; if (s.includes('vehicle') && s.startsWith('http')) cgSet.add(s); });
      result.images = [...cgSet].slice(0, 25);
    }
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'convertus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w+\s*\|.*$/i, '').trim();
    const convMatch = html.match(/var\s+vehicle\s*=\s*(\{[\s\S]*?\});\s*(?:var|\/\/|<\/script>)/) || html.match(/"vehicle"\s*:\s*(\{[\s\S]*?"vin"[\s\S]*?\})/);
    if (convMatch) {
      try {
        const v = JSON.parse(convMatch[1]);
        result.color = v.exteriorColor || v.color || v.ext_color || null;
        if (v.odometer || v.mileage) result.kms = formatKms(v.odometer || v.mileage);
        if (v.price || v.salePrice) result.todayPrice = '$' + Number(v.price || v.salePrice).toLocaleString();
        if (v.msrp || v.originalPrice) result.wasPrice = '$' + Number(v.msrp || v.originalPrice).toLocaleString();
      } catch (_) {}
    }
    if (!result.kms) { const m = text.match(/([\d,]+)\s*(?:km|kilometers)/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.color) { const m = text.match(/(?:Exterior|Ext)[:\s]+([A-Za-z\s]+?)(?:\n|Interior|Int)/i); if (m) result.color = m[1].trim(); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    const imgSet = new Set();
    const cdnMatches = html.matchAll(/https:\/\/[^"'\s\\]*autotradercdn\.ca\/photos\/[^"'\s\\]+/gi);
    for (const m of cdnMatches) imgSet.add(m[0].replace(/-\d+x\d+\./, '-2048x1536.'));
    const convMatches = html.matchAll(/https:\/\/[^"'\s\\]*(?:convertus|tadvantagebeta)[^"'\s\\]*\.(?:jpg|jpeg|png|webp)/gi);
    for (const m of convMatches) { if (!m[0].includes('logo')) imgSet.add(m[0]); }
    $('img[src*="autotradercdn"]').each((_, el) => { const s = $(el).attr('src'); if (s) imgSet.add(s.replace(/-\d+x\d+\./, '-2048x1536.')); });
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s && !s.includes('logo')) imgSet.add(s); });
    $('a[href]').each((_, el) => { const h = $(el).attr('href') || ''; if (h.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(h) && !h.includes('logo')) imgSet.add(h); });
    const photoJsonMatch = html.match(/"photos"\s*:\s*\[([^\]]+)\]/);
    if (photoJsonMatch) { const urlMatches = photoJsonMatch[1].matchAll(/"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi); for (const m of urlMatches) imgSet.add(m[1]); }
    result.images = [...imgSet].filter(u => !u.includes('logo') && !u.includes('icon') && !u.includes('placeholder')).slice(0, 25);
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
    if (!result.kms) { const m = text.match(/(\d[\d,]+)\s*(?:km|kilometers|kilometres)/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
    if (!result.todayPrice) { const m = text.match(/Your Price\s*\$\s*([\d,]+)/i); if (m) result.todayPrice = '$' + m[1]; }
    if (!result.wasPrice) { const m = text.match(/Regular Price\s*\$\s*([\d,]+)/i); if (m) result.wasPrice = '$' + m[1]; }
    if (!result.color) { const m = text.match(/Exterior Colou?r\s*\n?\s*([A-Za-z\s]+)/i); if (m) result.color = m[1].trim().split('\n')[0].trim(); }
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';
    const imgSet = new Set();
    const cloudinaryMatches = html.matchAll(/https:\/\/res\.cloudinary\.com\/goauto-images\/image\/upload\/[^"'\s,)]+/g);
    for (const m of cloudinaryMatches) { const u = m[0].replace(/l_v1:overlays[^/]+\//g, '').replace(/c_fit,[^/]+\//g, ''); if (u.includes('/inventory/')) imgSet.add(u); }
    result.images = [...imgSet].slice(0, 25);
    result.features = extractFeaturesFromText(text);
  }

  else if (platform === 'd2c') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w+\s*$|for\s+sale.*$/i, '').trim();
    const yourPrice = text.match(/Your Price:\s*\n?\s*([\d,]+)/i) || text.match(/Price:\s*([\d,]+)/i);
    if (yourPrice) result.todayPrice = '$' + yourPrice[1].replace(/,/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
    const colorM = text.match(/Ext(?:erior)?[:\s]+([A-Za-z]+)/i);
    if (colorM) result.color = colorM[1].trim();
    const imgSet = new Set();
    $('a[href*="imagescdn.d2cmedia"]').each((_, el) => { const h = $(el).attr('href'); if (h && h.startsWith('http')) imgSet.add(h); });
    $('img[src*="imagescdn.d2cmedia"]').each((_, el) => { const s = $(el).attr('src'); if (s && s.startsWith('http')) imgSet.add(s); });
    const d2cMatches = html.matchAll(/https:\/\/imagescdn\.d2cmedia\.ca\/[^"'\s)]+\.jpg/g);
    for (const m of d2cMatches) imgSet.add(m[0]);
    const allD2c = [...imgSet];
    const fullResSample = allD2c.find(u => u.includes('cbe')) || allD2c.find(u => u.includes('imagescdn.d2cmedia'));
    if (fullResSample) {
      const pm = fullResSample.match(/(https:\/\/imagescdn\.d2cmedia\.ca\/[a-z0-9]+\/\d+\/\d+\/)(\d+)(\/[^"'\s]+\.jpg)/);
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
    if (!result.kms) { const m = text.match(/([\d,]+)\s*(?:km|kilometers)/i); if (m) result.kms = formatKms(m[1].replace(/,/g, '')); }
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
    if (!seen.has(key) && new RegExp(kw, 'i').test(text)) {
      found.push(label);
      seen.add(key);
    }
    if (found.length >= 10) break;
  }
  return found;
}
