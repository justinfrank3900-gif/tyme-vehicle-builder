import { useState, useRef } from 'react';
import Head from 'next/head';

const PANDADOC_LOGO = `<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg" style="width:160px;height:48px">
  <rect width="200" height="60" rx="8" fill="#3CBA70"/>
  <text x="12" y="22" font-family="Arial Black,sans-serif" font-weight="900" font-size="14" fill="white">🐼 PandaDoc</text>
  <text x="12" y="42" font-family="Arial,sans-serif" font-size="10" fill="rgba(255,255,255,0.85)">eSign &amp; Track Documents</text>
</svg>`;

function fmt$(v) {
  const n = v.replace(/[^0-9]/g, '');
  if (!n) return '';
  return '$' + parseInt(n).toLocaleString();
}
function fmtKms(v) {
  const n = v.replace(/[^0-9]/g, '');
  if (!n) return '';
  return parseInt(n).toLocaleString() + ' kms';
}
function fmtDown(v) {
  const n = v.replace(/[^0-9]/g, '');
  if (!n) return '';
  return '$' + parseInt(n).toLocaleString() + ' down';
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [fields, setFields] = useState({
    title: '', color: '', kms: '', wasP: '', todP: '', savP: '',
    downP: '', bwP: '', bwNoWarranty: '', upgP: '10 months',
    trade: '', lien: '', equity: ''
  });
  const [features, setFeatures] = useState([]);
  const [newFeat, setNewFeat] = useState('');
  const [allImgs, setAllImgs] = useState([]);
  const [selImgs, setSelImgs] = useState([]);
  const [pasteUrls, setPasteUrls] = useState('');
  const [imgTab, setImgTab] = useState('auto');
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const prevRef = useRef(null);

  function sf(key, val) { setFields(f => ({ ...f, [key]: val })); }
  function sfFmt(key, val, fn) { setFields(f => ({ ...f, [key]: fn(val) })); }

  function clearAll() {
    setFields({ title: '', color: '', kms: '', wasP: '', todP: '', savP: '', downP: '', bwP: '', bwNoWarranty: '', upgP: '10 months', trade: '', lien: '', equity: '' });
    setFeatures([]); setAllImgs([]); setSelImgs([]); setPasteUrls(''); setPreview(false);
  }

  function proxyImg(src) {
    if (!src) return src;
    if (src.startsWith('/')) return src;
    return `/api/proxy-image?url=${encodeURIComponent(src)}`;
  }

  function addFeature() {
    if (!newFeat.trim()) return;
    setFeatures(f => [...f, newFeat.trim()]);
    setNewFeat('');
  }
  function removeFeature(i) { setFeatures(f => f.filter((_, idx) => idx !== i)); }

  async function fetchListing() {
    if (!url.trim()) return setStatus({ msg: 'Paste a listing URL first.', type: 'err' });
    clearAll();
    setStatus({ msg: 'Pulling listing data... (up to 30 seconds)', type: 'info' });
    try {
      const r = await fetch('/api/fetch-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      const json = await r.json();
      if (!json.success) throw new Error(json.error || 'Server error');
      const d = json.data;
      const w = parseInt((d.wasPrice || '').replace(/[^0-9]/g, ''));
      const t = parseInt((d.todayPrice || '').replace(/[^0-9]/g, ''));
      const sav = (!isNaN(w) && !isNaN(t) && w > t) ? '$' + (w - t).toLocaleString() : '';
      setFields(prev => ({
        ...prev,
        title: d.title || '', color: d.color || '',
        kms: d.kms || '', wasP: d.wasPrice || '',
        todP: d.todayPrice || '', savP: sav,
        bwP: d.biweeklyPayment || '',
      }));
      const imgs = [...new Set((d.images || []).filter(u => u && u.startsWith('http')))];
      setAllImgs(imgs);
      setStatus(imgs.length
        ? { msg: `✓ ${d.title || 'Vehicle'} — ${imgs.length} photos loaded.`, type: 'ok' }
        : { msg: `✓ ${d.title || 'Data loaded'} — no images found. Use Paste URLs tab.`, type: 'warn' }
      );
    } catch (e) {
      setStatus({ msg: 'Pull failed: ' + e.message, type: 'err' });
    }
  }

  function toggleImg(src) {
    setSelImgs(prev => prev.includes(src) ? prev.filter(s => s !== src) : [...prev, src]);
  }

  function loadPasted() {
    const urls = pasteUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    if (!urls.length) return setStatus({ msg: 'No valid URLs found.', type: 'err' });
    setAllImgs([...new Set(urls)].slice(0, 30)); setSelImgs([]);
    setImgTab('auto');
    setStatus({ msg: `✓ ${urls.length} photos loaded.`, type: 'ok' });
  }

  // Build pairs for photo slides
  const pairs = [];
  for (let i = 0; i < selImgs.length; i += 2)
    pairs.push(selImgs[i + 1] ? [selImgs[i], selImgs[i + 1]] : [selImgs[i]]);

  async function doExport() {
    if (!preview) return alert('Build preview first.');
    setExporting(true);
    try {
      const { jsPDF } = window.jspdf;
      const slides = prevRef.current.querySelectorAll('.slide');
      const W = 390;
      const pdf = new jsPDF({ unit: 'px', format: [W, 844], hotfixes: ['px_scaling'] });
      let first = true;
      for (const slide of slides) {
        // Wait for images to load
        const imgs = slide.querySelectorAll('img');
        await Promise.all([...imgs].map(img =>
          img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
        ));
        const c = await window.html2canvas(slide, {
          scale: 2, useCORS: true, allowTaint: false,
          backgroundColor: '#000000', logging: false, imageTimeout: 20000,
        });
        const imgData = c.toDataURL('image/jpeg', 0.93);
        const ph = Math.round((c.height / c.width) * W);
        if (!first) pdf.addPage([W, ph]);
        else { pdf.deletePage(1); pdf.addPage([W, ph]); }
        first = false;
        pdf.addImage(imgData, 'JPEG', 0, 0, W, ph);
      }
      pdf.save((fields.title || 'Vehicle').replace(/\s+/g, '_') + '_Presentation.pdf');
    } catch (e) {
      alert('Export error: ' + e.message);
    }
    setExporting(false);
  }

  const upg = fields.upgP || '10 months';

  // Slide HTML builders
  const LOGO_URL = '/logo.png';

  const slideStyle = `width:390px;background:#000;color:white;overflow:hidden;margin-bottom:8px;border-radius:3px;box-shadow:0 3px 16px rgba(0,0,0,.8);flex-shrink:0`;

  const HDR = t => `<div style="padding:18px 18px 10px;border-bottom:2px solid #2196f3;margin-bottom:14px;background:linear-gradient(90deg,rgba(33,150,243,0.15),transparent)"><h2 style="font-size:20px;font-weight:900;color:#2196f3;letter-spacing:3px;text-transform:uppercase;margin:0;text-shadow:0 0 20px rgba(33,150,243,0.6)">${t}</h2></div>`;

  const LOGO_BOT = `<div style="display:flex;flex-direction:column;align-items:center;padding:20px 16px 16px;gap:4px"><img src="${LOGO_URL}" style="width:120px;height:120px;object-fit:contain"/></div>`;

  const STAR = items => items.map(t => `<div style="display:flex;align-items:center;gap:12px;font-size:18px;font-weight:700;color:white;padding:3px 0"><span style="color:#2196f3;font-size:22px;flex-shrink:0;text-shadow:0 0 10px rgba(33,150,243,0.8)">★</span>${t}</div>`).join('');

  const PS = `width:100%;height:50%;object-fit:cover;object-position:center;display:block`;

  const pairSlide = (a, b) => `<div style="width:100%;aspect-ratio:9/16;display:flex;flex-direction:column;background:#000"><img src="${proxyImg(a)}" style="${PS}" crossorigin="anonymous"/><div style="height:3px;background:#000;flex-shrink:0"></div><img src="${proxyImg(b)}" style="${PS}" crossorigin="anonymous"/></div>`;
  const singleSlide = a => `<div style="width:100%;aspect-ratio:9/16;background:#000;overflow:hidden"><img src="${proxyImg(a)}" style="width:100%;height:100%;object-fit:cover;object-position:center;display:block" crossorigin="anonymous"/></div>`;

  const slides_html = !preview ? null : [
    // COVER
    `<div style="aspect-ratio:9/16;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;padding:30px;background-image:radial-gradient(ellipse at center,#0a1a2e 0%,#000 70%)">
      <img src="${LOGO_URL}" style="width:280px;height:280px;object-fit:contain;margin-bottom:20px"/>
      <div style="margin-top:20px;text-align:center">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:22px;font-weight:900;color:white">
          <span style="color:#2196f3;font-size:28px;text-shadow:0 0 15px rgba(33,150,243,0.9)">★</span>#1
        </div>
        <div style="font-size:18px;font-weight:800;color:white;text-align:center;line-height:1.3;margin-top:6px">Auto Finance Company<br/>in the Country</div>
      </div>
    </div>`,

    // UNIT DESCRIPTION
    `<div style="background:linear-gradient(180deg,#050510,#0a0a18);min-height:500px">
      ${HDR('Unit Description')}
      <div style="padding:0 18px;font-size:21px;font-weight:900;color:white;margin-bottom:4px">${fields.title}</div>
      <div style="padding:0 18px;font-size:18px;font-weight:800;color:white;margin-bottom:14px">${fields.color}${fields.color && fields.kms ? ' – ' : ''}${fields.kms}</div>
      <div style="padding:0 14px 18px;display:flex;flex-direction:column;gap:8px">
        ${features.map(f => `<div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;color:white">
          <div style="width:7px;height:7px;min-width:7px;background:#2196f3;border-radius:50%;margin-top:5px;box-shadow:0 0 6px rgba(33,150,243,0.8)"></div>
          <div style="font-weight:600">${f}</div>
        </div>`).join('')}
      </div>
    </div>`,

    // FINANCIAL BREAKDOWN
    `<div style="background:linear-gradient(180deg,#050510,#0a0a18)">
      ${HDR('Financial Breakdown')}
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:22px;font-weight:800;color:white">Was: ${fields.wasP}</div>
        <div style="font-size:27px;font-weight:900;color:white">Today: ${fields.todP}</div>
        <div style="font-size:22px;font-weight:800;color:white">Savings: ${fields.savP}</div>
        ${fields.trade || fields.lien || fields.equity ? `
        <div style="border-top:1px solid #1a1a2e;padding-top:10px;display:flex;flex-direction:column;gap:6px">
          ${fields.trade ? `<div style="font-size:20px;font-weight:800;color:white">Trade: ${fields.trade}</div>` : ''}
          ${fields.lien ? `<div style="font-size:20px;font-weight:800;color:white">Lien: ${fields.lien}</div>` : ''}
          ${fields.equity ? `<div style="font-size:20px;font-weight:800;color:white">Neg Equity: ${fields.equity}</div>` : ''}
        </div>` : ''}
        <div style="border-top:1px solid #1a1a2e;padding-top:10px">
          <div style="font-size:22px;font-weight:800;color:white">${fields.downP}</div>
          ${fields.bwP ? `<div style="font-size:30px;font-weight:900;color:#4caf50;line-height:1.2">${fields.bwP}</div>` : ''}
          ${fields.bwNoWarranty ? `<div style="font-size:22px;font-weight:900;color:#4caf50;line-height:1.2">${fields.bwNoWarranty}</div>` : ''}
          <div style="font-size:20px;font-weight:800;color:white;margin-top:6px">Payment is all in!!!</div>
          <div style="font-size:24px;font-weight:900;color:#4caf50;margin-top:14px;line-height:1.3">Qualify for an upgrade in<br/>${upg}!</div>
        </div>
      </div>
    </div>`,

    // BENEFITS
    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18)">
      ${HDR('Benefits of This Deal')}
      <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
        ${STAR(['Penalty Free Loan', `Qualify For Upgrade In ${upg}`, 'Re Conditioned Vehicle', 'Risk Free Delivery', 'Mechanical Guarantee'])}
      </div>
      ${LOGO_BOT}
    </div>`,

    // PHOTO SLIDES
    ...pairs.map(p => p.length === 2 ? pairSlide(p[0], p[1]) : singleSlide(p[0])),

    // DELIVERY
    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18)">
      ${HDR('No Risk Delivery Service')}
      <div style="padding:12px 18px;font-size:17px;font-weight:700;color:#2196f3;line-height:1.5">Your Unit will be delivered to your front door with the following:</div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
        ${STAR(['No Risk Delivery Service', 'We will help arrange your insurance', 'We will help set up your registration including plates', 'Fully reconditioned unit', 'Constant support after the fact in case of issues'])}
      </div>
      ${LOGO_BOT}
    </div>`,

    // PANDADOC
    `<div style="background:#000;display:flex;flex-direction:column;align-items:center;padding-bottom:28px;background-image:radial-gradient(ellipse at center,#0a1a2e 0%,#000 70%)">
      ${HDR('Electronic Paperwork')}
      <div style="padding:12px 18px;text-align:center;font-size:16px;font-weight:700;color:#2196f3;line-height:1.6">Paperwork can be done right on your cell phone or laptop through our electronic signature partner <strong style="color:white">PandaDoc</strong></div>
      <div style="border:3px solid #2196f3;border-radius:24px;padding:20px 16px;width:220px;background:#0a0a1a;display:flex;flex-direction:column;align-items:center;gap:14px;box-shadow:0 0 30px rgba(33,150,243,0.3)">
        <div style="background:#3CBA70;padding:10px 20px;border-radius:8px;font-size:20px;font-weight:900;color:white;display:flex;align-items:center;gap:8px">🐼 PandaDoc</div>
        <img src="${LOGO_URL}" style="width:80px;height:80px;object-fit:contain"/>
      </div>
    </div>`,
  ];

  const stColors = {
    info: { bg: '#1e3a5f', color: '#93c5fd' },
    ok: { bg: '#14532d', color: '#86efac' },
    err: { bg: '#450a0a', color: '#fca5a5' },
    warn: { bg: '#451a03', color: '#fdba74' }
  };

  return (
    <>
      <Head>
        <title>TYME — Vehicle Presentation Builder</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" />
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
          img { display: block; }
          input, textarea, button { font-family: inherit; }
          ::-webkit-scrollbar { width: 5px; }
          ::-webkit-scrollbar-track { background: #0a0a12; }
          ::-webkit-scrollbar-thumb { background: #1e1e2c; border-radius: 3px; }
        `}</style>
      </Head>

      <div style={{ display: 'flex', height: '100vh', background: '#0d0d12', color: '#e2e8f0', fontSize: 13 }}>

        {/* ── LEFT PANEL ── */}
        <div style={{ width: 355, minWidth: 355, background: '#13131a', borderRight: '1px solid #1e1e2c', overflowY: 'auto', padding: 16 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1e1e2c' }}>
            <img src={LOGO_URL} style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6 }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#e2e8f0' }}>Vehicle Presentation Builder</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>by TYME · Easy Auto Loans Canada</div>
            </div>
          </div>

          {/* URL */}
          <Lbl>Listing URL</Lbl>
          <div style={{ display: 'flex', gap: 6 }}>
            <In value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste listing URL..." onKeyDown={e => e.key === 'Enter' && fetchListing()} style={{ flex: 1, width: 'auto' }} />
            <Btn onClick={fetchListing}>Pull</Btn>
          </div>
          {status && <div style={{ padding: '8px 11px', borderRadius: 6, fontSize: 11, marginTop: 7, lineHeight: 1.4, background: stColors[status.type]?.bg, color: stColors[status.type]?.color }}>{status.msg}</div>}

          <HR />

          {/* Vehicle Info */}
          <Lbl>Vehicle Info</Lbl>
          <div style={{ marginBottom: 8 }}><FL>Year / Make / Model / Trim</FL><In value={fields.title} onChange={e => sf('title', e.target.value)} placeholder="2022 Ford F-150 Lariat FX4" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Colour</FL><In value={fields.color} onChange={e => sf('color', e.target.value)} placeholder="Black" /></div>
            <div><FL>Kilometres</FL><In value={fields.kms}
              onChange={e => sf('kms', e.target.value)}
              onBlur={e => sf('kms', fmtKms(e.target.value))}
              placeholder="99,090 kms" /></div>
          </div>

          <HR />

          {/* Deal Numbers */}
          <Lbl>Deal Numbers</Lbl>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Was Price</FL><In value={fields.wasP} onChange={e => sf('wasP', e.target.value)} onBlur={e => sf('wasP', fmt$(e.target.value))} placeholder="$58,995" /></div>
            <div><FL>Today's Price</FL><In value={fields.todP} onChange={e => sf('todP', e.target.value)} onBlur={e => { const v = fmt$(e.target.value); sf('todP', v); const w = parseInt(fields.wasP.replace(/[^0-9]/g, '')); const t = parseInt(v.replace(/[^0-9]/g, '')); if (!isNaN(w) && !isNaN(t) && w > t) sf('savP', '$' + (w - t).toLocaleString()); }} placeholder="$55,995" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Savings</FL><In value={fields.savP} onChange={e => sf('savP', e.target.value)} onBlur={e => sf('savP', fmt$(e.target.value))} placeholder="$3,000" /></div>
            <div><FL>Down Payment</FL><In value={fields.downP} onChange={e => sf('downP', e.target.value)} onBlur={e => sf('downP', fmtDown(e.target.value))} placeholder="$3,000 down" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Biweekly (w/ warranty)</FL><In value={fields.bwP} onChange={e => sf('bwP', e.target.value)} placeholder="$533 biweekly" /></div>
            <div><FL>Biweekly (no warranty)</FL><In value={fields.bwNoWarranty} onChange={e => sf('bwNoWarranty', e.target.value)} placeholder="$509 biweekly" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Trade</FL><In value={fields.trade} onChange={e => sf('trade', e.target.value)} onBlur={e => sf('trade', fmt$(e.target.value))} placeholder="$22,000" /></div>
            <div><FL>Lien</FL><In value={fields.lien} onChange={e => sf('lien', e.target.value)} onBlur={e => sf('lien', fmt$(e.target.value))} placeholder="$29,000" /></div>
            <div><FL>Neg Equity</FL><In value={fields.equity} onChange={e => sf('equity', e.target.value)} onBlur={e => sf('equity', fmt$(e.target.value))} placeholder="$7,000" /></div>
          </div>
          <div style={{ marginBottom: 8 }}><FL>Upgrade In</FL><In value={fields.upgP} onChange={e => sf('upgP', e.target.value)} placeholder="10 months" /></div>

          <HR />

          {/* Key Features */}
          <Lbl>Key Features <span style={{ color: '#64748b', fontSize: 9, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— enter manually, one at a time</span></Lbl>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <In value={newFeat} onChange={e => setNewFeat(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFeature()} placeholder="Type feature and press Enter or +" style={{ flex: 1, width: 'auto' }} />
            <Btn onClick={addFeature} style={{ padding: '8px 12px', fontSize: 16 }}>+</Btn>
          </div>
          {features.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
              {features.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0f0f16', border: '1px solid #1e1e2c', borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ color: '#2196f3', fontSize: 14, flexShrink: 0 }}>●</span>
                  <span style={{ flex: 1, fontSize: 12, color: '#e2e8f0' }}>{f}</span>
                  <button onClick={() => removeFeature(i)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <HR />

          {/* Photos */}
          <Lbl>Photos</Lbl>
          <div style={{ display: 'flex', border: '1px solid #1e1e2c', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            {['auto', 'paste'].map(t => (
              <button key={t} onClick={() => setImgTab(t)} style={{ flex: 1, padding: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none', background: imgTab === t ? '#2196f3' : '#0f0f16', color: imgTab === t ? 'white' : '#64748b' }}>
                {t === 'auto' ? 'Auto (from Pull)' : 'Paste URLs'}
              </button>
            ))}
          </div>

          {imgTab === 'auto' && <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Btn style={{ fontSize: 10, padding: '5px 10px', background: '#92400e' }} onClick={() => setSelImgs([...allImgs])}>Select All</Btn>
              <Btn style={{ fontSize: 10, padding: '5px 10px', background: '#374151' }} onClick={() => setSelImgs([])}>Clear</Btn>
            </div>
            {allImgs.length === 0
              ? <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6 }}>Pull a listing to load photos</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                {allImgs.map((src, i) => (
                  <div key={i} onClick={() => toggleImg(src)} style={{ aspectRatio: '4/3', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${selImgs.includes(src) ? '#2196f3' : 'transparent'}`, position: 'relative', background: '#1a1a2e' }}>
                    <img src={proxyImg(src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.parentElement.style.display = 'none'} />
                    {selImgs.includes(src) && <div style={{ position: 'absolute', top: 2, right: 2, width: 15, height: 15, background: '#2196f3', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'white', fontWeight: 700 }}>✓</div>}
                  </div>
                ))}
              </div>
            }
            {allImgs.length > 0 && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{selImgs.length} selected / {allImgs.length} total</div>}
          </>}

          {imgTab === 'paste' && <>
            <p style={{ fontSize: 10, color: '#64748b', lineHeight: 1.5, marginBottom: 6 }}>Right-click listing photo → <strong>Copy image address</strong> → paste below, one per line.</p>
            <textarea value={pasteUrls} onChange={e => setPasteUrls(e.target.value)} placeholder={"https://...\nhttps://..."} style={{ width: '100%', background: '#0f0f16', border: '1px solid #1e1e2c', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, resize: 'vertical', minHeight: 100, outline: 'none', marginBottom: 6 }} />
            <Btn style={{ width: '100%', justifyContent: 'center', padding: 10, background: '#92400e' }} onClick={loadPasted}>Load These Photos</Btn>
          </>}

          <HR />
          <Btn style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 13 }} onClick={() => setPreview(true)}>⚡ Build Preview</Btn>
          <Btn style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 13, background: '#16a34a', marginTop: 6 }} onClick={doExport}>{exporting ? '⏳ Generating...' : '↓ Export PDF'}</Btn>
        </div>

        {/* ── RIGHT PREVIEW ── */}
        <div style={{ flex: 1, overflowY: 'auto', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px' }} ref={prevRef}>
          {!preview
            ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', textAlign: 'center', gap: 8 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".3"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 21V9" /></svg>
              <p style={{ fontSize: 12 }}>Paste URL → Pull<br />then Build Preview</p>
            </div>
            : slides_html.map((html, i) => (
              <div key={i} style={{ alignSelf: 'flex-start' }}>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, letterSpacing: .3 }}>SLIDE {i + 1}</div>
                <div className="slide" style={{ width: 390, background: '#000', color: 'white', overflow: 'hidden', marginBottom: 8, borderRadius: 3, boxShadow: '0 3px 16px rgba(0,0,0,.8)' }} dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            ))
          }
        </div>
      </div>
    </>
  );
}

const In = ({ style, ...p }) => <input {...p} style={{ background: '#0f0f16', border: '1px solid #1e1e2c', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none', width: '100%', ...style }} />;
const Btn = ({ style, ...p }) => <button {...p} style={{ background: '#2196f3', color: 'white', border: 'none', borderRadius: 6, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, ...style }} />;
const Lbl = ({ children }) => <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#64748b', margin: '14px 0 6px' }}>{children}</div>;
const FL = ({ children }) => <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: .3, marginBottom: 3 }}>{children}</div>;
const HR = () => <hr style={{ border: 'none', borderTop: '1px solid #1e1e2c', margin: '12px 0' }} />;
