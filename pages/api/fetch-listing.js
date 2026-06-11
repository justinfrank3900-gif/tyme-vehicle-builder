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
  const scraperUrl = `https://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(url)}&render=true&country_code=ca`;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(scraperUrl, {
        headers: { 'Accept': 'text/html' },
        redirect: 'follow'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (html.length < 1000) throw new Error('Response too short');
      return html;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 1500));
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
      const d = JSON
