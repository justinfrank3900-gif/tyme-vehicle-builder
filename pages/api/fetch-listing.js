import * as cheerio from 'cheerio';

export const config = {
  maxDuration: 90,
};

const SCRAPER_KEY = 'c12fb1626ab469fb5e3e0807397c93d7';

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
  const directHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-CA,en;q=0.9',
  };

  if (platform === 'd2c') {
    const r = await fetch(url, { headers: directHeaders, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    if (html.length < 500) throw new Error('Empty response');
    return html;
  }

  // Paid ScraperAPI — render=true with premium for JS-heavy sites
  const renderUrl = `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=true&country_code=ca&timeout=60000`;

  try {
    const r = await fetch(renderUrl, {
      headers: { 'Accept': 'text/html' },
      signal: AbortSignal.timeout(80000)
    });
    if (!r.ok) throw new Error(`ScraperAPI HTTP ${r.status}`);
    const html = await r.text();
    if (html.startsWith('An error') || html.length < 500) {
      throw new Error('ScraperAPI blocked: ' + html.slice(0, 80));
    }
    return html;
  } catch(e) {
    // If render fails, try without render as fallback
    const noRenderUrl = `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&country_code=ca`;
    const r2 = await fetch(noRenderUrl, {
      headers: { 'Accept': 'text/html' },
      signal: AbortSignal.timeout(20000)
    });
    if (!r2.ok) throw new Error(`ScraperAPI HTTP ${r2.status}`);
    const html2 = await r2.text();
    if (html2.startsWith('An error') || html2.length < 500) throw new Error('ScraperAPI could not fetch: ' + html2.slice(0, 80));
    return html2;
  }
}

function detectPlatform(url) {
  if (url.includes('autotrader.ca')) return 'autotrader';
  if (url.includes('cargurus.ca') || url.includes('cargurus.com')) return 'cargurus';
  if (url.includes('kaizenauto') || url.includes('airdriedodge') || url.includes('summitram') ||
      url.includes('chnissan') || url.includes('chhyundai') || url.includes('shawgmc') ||
      url.includes('woodbinegm') || url.includes('okotoksgm') || url.includes('strathmoreford') ||
      url.includes('universalford') || url.includes('summitgm')) return 'convertus';
  return 'generic';
}

function parseVehicle(html, url, platform) {
  const $ = cheerio.load(html);
  const text = $('body').text();

  // Auto-detect D2C from page content
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
    // Try ngVdpModel
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
      result.color = hero.colourExterior || specs.exteriorColour || null;
      const odo = hero.mileage || specs.kilometres;
      if (odo) result.kms = formatKms(odo);
      if (pricing.price || pricing.listPrice) result.todayPrice = '$' + Number(pricing.price || pricing.listPrice).toLocaleString();
    }
    if (!result.title) result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g,'')); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    if (!result.color) { const m = text.match(/Exterior Colou?r[:\s]+([A-Za-z\s]+?)(?:\n|Interior)/i); if (m) result.color = m[1].trim(); }
    const imgSet = new Set();
    const ms = html.matchAll(/https:\/\/[a-z0-9-]+\.autotradercdn\.ca\/photos\/[^"'\s\\<>]+/gi);
    for (const m of ms) imgSet.add(m[0].replace(/-\d+x\d+(\.[a-z]+)$/, '-2048x1536$1'));
    $('img').each((_, el) => { const s = $(el).attr('src') || $(el).attr('data-src') || ''; if (s.includes('autotradercdn')) imgSet.add(s); });
    result.images = [...imgSet].filter(u => !u.includes('logo')).slice(0, 25);
    const bwm = text.match(/\$\s*([\d.]+)\s*\/?\s*bi-?weekly/i);
    if (bwm) result.biweeklyPayment = '$' + Math.round(parseFloat(bwm[1])) + ' biweekly';
    result.features = extractFeatures(text);
  }

  else if (platform === 'cargurus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
      if (jsonLd.mileageFromOdometer?.value) {
        const val = Number(jsonLd.mileageFromOdometer.value);
        const unit = (jsonLd.mileageFromOdometer.unitCode || 'KMT').toUpperCase();
        result.kms = formatKms(unit === 'SMI' ? Math.round(val * 1.60934) : val);
      }
      if (jsonLd.image) {
        const imgs = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
        result.images = imgs.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 25);
      }
    }
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km\b/i); if (m) result.kms = formatKms(m[1].replace(/,/g,'')); }
    if (!result.images.length) {
      const cgSet = new Set();
      const ms = html.matchAll(/https:\/\/[^"'\s<>]*(?:cargurus|vehicle-photos)[^"'\s<>]*\.(?:jpg|jpeg|png|webp)/gi);
      for (const m of ms) cgSet.add(m[0]);
      $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) cgSet.add(s); });
      result.images = [...cgSet].slice(0, 25);
    }
    result.features = extractFeatures(text);
  }

  else if (platform === 'convertus') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w[\w\s]*\|.*$/i, '').trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const metaPrice = metaDesc.match(/\$([\d,]+)\s*CAD/i) || metaDesc.match(/only\s*\$([\d,]+)/i);
    if (metaPrice) result.todayPrice = '$' + metaPrice[1];
    if (jsonLd) {
      if (!result.color) result.color = jsonLd.color || null;
      if (!result.kms && jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (!result.todayPrice && jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    const convMatch = html.match(/var\s+vehicle\s*=\s*(\{[\s\S]*?\});\s*(?:var|\/\/|<\/script>)/) ||
                      html.match(/window\.vehicle\s*=\s*(\{[\s\S]*?\});/);
    if (convMatch) {
      try {
        const v = JSON.parse(convMatch[1]);
        if (!result.color) result.color = v.exteriorColor || v.color || null;
        if (!result.kms && (v.odometer || v.mileage)) result.kms = formatKms(v.odometer || v.mileage);
        if (!result.todayPrice && (v.price || v.salePrice)) result.todayPrice = '$' + Number(v.price || v.salePrice).toLocaleString();
      } catch (_) {}
    }
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g,'')); }
    const imgSet = new Set();
    const ms1 = html.matchAll(/https:\/\/[^"'\s\\<>]*autotradercdn\.ca\/photos\/[^"'\s\\<>]+/gi);
    for (const m of ms1) imgSet.add(m[0].replace(/-\d+x\d+(\.[a-z]+)$/, '-2048x1536$1'));
    $('img').each((_, el) => { const s = $(el).attr('src') || ''; if (s.includes('autotradercdn')) imgSet.add(s); });
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s && !s.includes('logo')) imgSet.add(s); });
    result.images = [...imgSet].filter(u => !u.includes('logo')).slice(0, 25);
    result.features = extractFeatures(text);
  }

  else if (platform === 'd2c') {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (result.title) result.title = result.title.replace(/in\s+\w+\s*$|for\s+sale.*$/i, '').trim();
    const yourPrice = text.match(/Your Price:\s*\n?\s*([\d,]+)/i) || text.match(/Price:\s*([\d,]+)/i);
    if (yourPrice) result.todayPrice = '$' + yourPrice[1].replace(/,/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g,'')); }
    const colorM = text.match(/Ext(?:erior)?[:\s]+([A-Za-z]+)/i);
    if (colorM) result.color = colorM[1].trim();
    const imgSet = new Set();
    $('a[href*="imagescdn.d2cmedia"]').each((_, el) => { const h = $(el).attr('href'); if (h) imgSet.add(h); });
    $('img[src*="imagescdn.d2cmedia"]').each((_, el) => { const s = $(el).attr('src'); if (s) imgSet.add(s); });
    const ms4 = html.matchAll(/https:\/\/imagescdn\.d2cmedia\.ca\/[^"'\s)<>]+\.jpg/g);
    for (const m of ms4) imgSet.add(m[0]);
    const allD2c = [...imgSet];
    const sample = allD2c.find(u => u.includes('cbe')) || allD2c[0];
    if (sample) {
      const pm = sample.match(/(https:\/\/imagescdn\.d2cmedia\.ca\/[a-z0-9]+\/\d+\/\d+\/)(\d+)(\/[^"'\s]+\.jpg)/);
      if (pm) { for (let i = 1; i <= 30; i++) imgSet.add(`${pm[1]}${i}${pm[3]}`); }
    }
    result.images = [...imgSet].filter(u => !u.includes('logo')).slice(0, 25);
    result.features = extractFeatures(text);
  }

  else {
    result.title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || null;
    if (jsonLd) {
      result.color = jsonLd.color || null;
      if (jsonLd.mileageFromOdometer?.value) result.kms = formatKms(jsonLd.mileageFromOdometer.value);
      if (jsonLd.offers?.price) result.todayPrice = '$' + Number(jsonLd.offers.price).toLocaleString();
    }
    if (!result.kms) { const m = text.match(/([\d,]+)\s*km/i); if (m) result.kms = formatKms(m[1].replace(/,/g,'')); }
    if (!result.todayPrice) { const m = text.match(/\$\s*([\d,]+)/); if (m) result.todayPrice = '$' + m[1]; }
    const imgSet = new Set();
    $('meta[property="og:image"]').each((_, el) => { const s = $(el).attr('content'); if (s) imgSet.add(s); });
    $('img[src]').each((_, el) => { const s = $(el).attr('src') || ''; if (s.startsWith('http') && !s.includes('logo')) imgSet.add(s); });
    result.images = [...imgSet].slice(0, 25);
    result.features = extractFeatures(text);
  }

  if (result.title) result.title = result.title.replace(/\s+/g, ' ').trim();
  return result;
}

function formatKms(val) {
  const n = parseInt(String(val).replace(/[^0-9]/g, ''));
  if (isNaN(n)) return null;
  return n.toLocaleString() + ' kms';
}

function extractFeatures(text) {
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
  const found = [], seen = new Set();
  for (const [kw, label] of keywords) {
    const key = label.split(':')[0];
    if (!seen.has(key) && new RegExp(kw, 'i').test(text)) { found.push(label); seen.add(key); }
    if (found.length >= 10) break;
  }
  return found;
}
