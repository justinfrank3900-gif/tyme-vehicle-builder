import { useState, useRef } from 'react';
import Head from 'next/head';

export default function Home() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [fields, setFields] = useState({ title:'', color:'', kms:'', wasP:'', todP:'', savP:'', downP:'', bwP:'', upgP:'10 months', feats:'' });
  const [allImgs, setAllImgs] = useState([]);
  const [selImgs, setSelImgs] = useState([]);
  const [pasteUrls, setPasteUrls] = useState('');
  const [imgTab, setImgTab] = useState('auto');
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const prevRef = useRef(null);

  function sf(key, val) { setFields(f => ({ ...f, [key]: val || '' })); }

  function clearAll() {
    setFields({ title:'', color:'', kms:'', wasP:'', todP:'', savP:'', downP:'', bwP:'', upgP:'10 months', feats:'' });
    setAllImgs([]); setSelImgs([]); setPasteUrls(''); setPreview(false);
  }

  async function fetchListing() {
    if (!url.trim()) return setStatus({ msg: 'Paste a listing URL first.', type: 'err' });
    clearAll();
    setStatus({ msg: 'Fetching listing...', type: 'info' });
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
      setFields({
        title: d.title || '', color: d.color || '', kms: d.kms || '',
        wasP: d.wasPrice || '', todP: d.todayPrice || '', savP: sav,
        downP: '', bwP: d.biweeklyPayment || '', upgP: '10 months',
        feats: (d.features || []).join('\n')
      });
      const imgs = [...new Set((d.images || []).filter(u => u && u.startsWith('http')))];
      setAllImgs(imgs);
      if (imgs.length) {
        setStatus({ msg: `✓ ${d.title || 'Vehicle'} — ${imgs.length} photos loaded. Select below.`, type: 'ok' });
      } else {
        setStatus({ msg: `✓ ${d.title || 'Data loaded'} — no images found. Use Paste URLs tab.`, type: 'warn' });
      }
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

  const MAPLE = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:150px;height:150px"><g fill="#2563eb" opacity=".95"><path d="M100 15 L108 38 L132 32 L118 52 L140 58 L122 68 L135 88 L112 80 L110 105 L100 95 L90 105 L88 80 L65 88 L78 68 L60 58 L82 52 L68 32 L92 38 Z"/><rect x="96" y="105" width="8" height="20" rx="3"/></g><g fill="#0a1628"><rect x="58" y="116" width="84" height="25" rx="6"/><path d="M71 116 Q78 100 96 97 L104 97 Q122 100 129 116 Z"/></g><g fill="#1e3a5f"><ellipse cx="74" cy="141" rx="8" ry="8"/><ellipse cx="126" cy="141" rx="8" ry="8"/></g><ellipse cx="134" cy="122" rx="5" ry="4" fill="#93c5fd" opacity=".9"/><ellipse cx="66" cy="122" rx="5" ry="4" fill="#93c5fd" opacity=".9"/></svg>`;
  const MSML = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:55px;height:55px"><g fill="#2563eb" opacity=".95"><path d="M100 15 L108 38 L132 32 L118 52 L140 58 L122 68 L135 88 L112 80 L110 105 L100 95 L90 105 L88 80 L65 88 L78 68 L60 58 L82 52 L68 32 L92 38 Z"/><rect x="96" y="105" width="8" height="20" rx="3"/></g><g fill="#0a1628"><rect x="58" y="116" width="84" height="25" rx="6"/><path d="M71 116 Q78 100 96 97 L104 97 Q122 100 129 116 Z"/></g><g fill="#1e3a5f"><ellipse cx="74" cy="141" rx="8" ry="8"/><ellipse cx="126" cy="141" rx="8" ry="8"/></g><ellipse cx="134" cy="122" rx="5" ry="4" fill="#93c5fd" opacity=".9"/><ellipse cx="66" cy="122" rx="5" ry="4" fill="#93c5fd" opacity=".9"/></svg>`;

  const pairs = [];
  for (let i = 0; i < selImgs.length; i += 2)
    pairs.push(selImgs[i+1] ? [selImgs[i], selImgs[i+1]] : [selImgs[i]]);

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
        const c = await window.html2canvas(slide, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#000000',
          logging: false,
          imageTimeout: 15000,
        });
        const imgData = c.toDataURL('image/jpeg', 0.93);
        const ph = Math.round((c.height / c.width) * W);
        if (!first) pdf.addPage([W, ph]);
        else { pdf.deletePage(1); pdf.addPage([W, ph]); }
        first = false;
        pdf.addImage(imgData, 'JPEG', 0, 0, W, ph);
      }
      pdf.save((fields.title || 'Vehicle').replace(/\s+/g, '_') + '_Presentation.pdf');
    } catch(e) {
      alert('Export error: ' + e.message);
      console.error(e);
    }
    setExporting(false);
  }

  const feats = fields.feats.split('\n').filter(f => f.trim()).map(f => {
    const p = f.split(':');
    return { b: p[0]?.trim() || '', d: p.slice(1).join(':').trim() };
  });
  const upg = fields.upgP || '10 months';

  const HDR = (t) => `<div style="padding:16px 16px 8px;border-bottom:2px solid #2563eb;margin-bottom:12px"><h2 style="font-size:18px;font-weight:900;color:#2563eb;letter-spacing:2.5px;text-transform:uppercase;margin:0">${t}</h2></div>`;
  const LBOT = `<div style="display:flex;flex-direction:column;align-items:center;padding:16px;gap:2px">${MSML}<div style="font-size:12px;font-weight:900;color:#2563eb;letter-spacing:2px;text-align:center;line-height:1.4">EASY AUTO LOANS<br/>CANADA</div></div>`;
  const STAR = (items) => items.map(t => `<div style="display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:white;padding:2px 0"><span style="color:#2563eb;font-size:20px;flex-shrink:0">&#9733;</span>${t}</div>`).join('');

  // Photo slide HTML — object-fit cover to fill properly
  const photoSlideStyle = `width:100%;height:100%;object-fit:cover;object-position:center;display:block`;
  const pairSlide = (a, b) => `<div style="width:100%;aspect-ratio:9/16;display:flex;flex-direction:column;background:#000"><img src="${a}" style="${photoSlideStyle}" crossorigin="anonymous"/><div style="height:4px;background:#000;flex-shrink:0"></div><img src="${b}" style="${photoSlideStyle}" crossorigin="anonymous"/></div>`;
  const singleSlide = (a) => `<div style="width:100%;aspect-ratio:9/16;background:#000;overflow:hidden"><img src="${a}" style="${photoSlideStyle}" crossorigin="anonymous"/></div>`;

  const slides_html = !preview ? null : [
    `<div style="aspect-ratio:9/16;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;padding:30px;text-align:center">${MAPLE}<div style="font-size:22px;font-weight:900;color:#2563eb;letter-spacing:2px;text-transform:uppercase;text-align:center;line-height:1.15;margin-top:4px">EASY AUTO LOANS<br/>CANADA</div><div style="margin-top:36px;text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:7px;font-size:19px;font-weight:900;color:white"><span style="color:#2563eb;font-size:22px">&#9733;</span>#1</div><div style="font-size:15px;font-weight:800;color:white;text-align:center;line-height:1.3;margin-top:4px">Auto Finance Company<br/>in the Country</div></div></div>`,

    `<div style="background:linear-gradient(180deg,#050510,#0a0a18);min-height:500px">${HDR('Unit Description')}<div style="padding:0 16px;font-size:19px;font-weight:900;color:white;margin-bottom:4px">${fields.title}</div><div style="padding:0 16px;font-size:17px;font-weight:800;color:white;margin-bottom:12px">${fields.color} ${fields.kms}</div><div style="padding:0 12px 16px;display:flex;flex-direction:column;gap:7px">${feats.map(f=>`<div style="display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.4;color:white"><div style="width:6px;height:6px;min-width:6px;background:white;border-radius:50%;margin-top:5px"></div><div><strong>${f.b}${f.d?' –':''}</strong><span style="color:#bbb"> ${f.d}</span></div></div>`).join('')}</div></div>`,

    `<div style="background:linear-gradient(180deg,#050510,#0a0a18)">${HDR('Financial Breakdown')}<div style="padding:16px;display:flex;flex-direction:column;gap:12px"><div style="font-size:22px;font-weight:800;color:white">Was: ${fields.wasP}</div><div style="font-size:26px;font-weight:900;color:white">Today: ${fields.todP}</div><div style="font-size:22px;font-weight:800;color:white">Savings: ${fields.savP}</div><div style="border-top:1px solid #1a1a2e;padding-top:12px"><div style="font-size:22px;font-weight:800;color:white">${fields.downP} down</div><div style="font-size:30px;font-weight:900;color:#22c55e">${fields.bwP}</div><div style="font-size:20px;font-weight:800;color:white">Payment is all in!!!</div><div style="font-size:24px;font-weight:900;color:#22c55e;margin-top:12px;line-height:1.3">Qualify for an upgrade in<br/>${upg}!</div></div></div></div>`,

    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18)">${HDR('Benefits of This Deal')}<div style="padding:16px;display:flex;flex-direction:column;gap:14px">${STAR(['Penalty Free Loan',`Qualify For Upgrade In ${upg}`,'Re Conditioned Vehicle','Risk Free Delivery','Mechanical Guarantee'])}</div>${LBOT}</div>`,

    ...pairs.map(p => p.length === 2 ? pairSlide(p[0], p[1]) : singleSlide(p[0])),

    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18)">${HDR('No Risk Delivery Service')}<div style="padding:12px 16px;font-size:16px;font-weight:700;color:#2563eb;line-height:1.4">Your Unit will be delivered to your front door with the following:</div><div style="padding:16px;display:flex;flex-direction:column;gap:14px">${STAR(['No Risk Delivery Service','We will help arrange your insurance','We will help set up your registration including plates','Fully reconditioned unit','Constant support after the fact in case of issues'])}</div>${LBOT}</div>`,

    `<div style="background:#000;display:flex;flex-direction:column;align-items:center;padding-bottom:24px">${HDR('Electronic Paperwork')}<div style="padding:12px;text-align:center;font-size:15px;font-weight:700;color:#2563eb;line-height:1.5">Paperwork done on your phone or laptop through our electronic signature partner <strong>DocuSign</strong></div><div style="border:3px solid #2563eb;border-radius:22px;padding:16px 12px;width:200px;background:#111;display:flex;flex-direction:column;align-items:center;gap:12px"><div style="background:#d4e600;padding:7px 16px;border-radius:4px;font-size:18px;font-weight:900;color:#000">&#8595; DocuSign&reg;</div>${MSML}<div style="font-size:12px;font-weight:900;color:#2563eb;letter-spacing:2px;text-align:center;line-height:1.4">EASY AUTO LOANS<br/>CANADA</div></div></div>`,
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
        <style>{`* { box-sizing: border-box; } body { margin: 0; } img { display: block; }`}</style>
      </Head>
      <div style={{ display:'flex', height:'100vh', fontFamily:'Segoe UI,system-ui,sans-serif', fontSize:13, background:'#0d0d12', color:'#e2e8f0' }}>

        {/* LEFT PANEL */}
        <div style={{ width:350, minWidth:350, background:'#13131a', borderRight:'1px solid #1e1e2c', overflowY:'auto', padding:16 }}>

          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <div style={{ width:32, height:32, background:'#2563eb', borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:14, color:'white', flexShrink:0 }}>T</div>
            <div style={{ fontWeight:700, fontSize:15 }}>Vehicle Presentation Builder <span style={{ color:'#64748b', fontSize:11 }}>by TYME</span></div>
          </div>

          <Lbl>Listing URL — GoAuto · AutoTrader · CarGurus</Lbl>
          <div style={{ display:'flex', gap:6 }}>
            <In value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste listing URL..." onKeyDown={e => e.key==='Enter' && fetchListing()} style={{ flex:1, width:'auto' }} />
            <Btn onClick={fetchListing}>Pull</Btn>
          </div>
          {status && <div style={{ padding:'8px 11px', borderRadius:6, fontSize:11, marginTop:7, lineHeight:1.4, background:stColors[status.type]?.bg, color:stColors[status.type]?.color }}>{status.msg}</div>}

          <HR/>
          <Lbl>Vehicle Info</Lbl>
          <div style={{ marginBottom:8 }}><FL>Year / Make / Model / Trim</FL><In value={fields.title} onChange={e=>sf('title',e.target.value)} placeholder="2020 Kia Sorento EX"/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><FL>Colour</FL><In value={fields.color} onChange={e=>sf('color',e.target.value)} placeholder="Grey"/></div>
            <div><FL>Kilometres</FL><In value={fields.kms} onChange={e=>sf('kms',e.target.value)} placeholder="115,000 kms"/></div>
          </div>

          <HR/>
          <Lbl>Deal Numbers</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><FL>Was Price</FL><In value={fields.wasP} onChange={e=>sf('wasP',e.target.value)} placeholder="$27,995"/></div>
            <div><FL>Today&apos;s Price</FL><In value={fields.todP} onChange={e=>sf('todP',e.target.value)} placeholder="$25,700"/></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><FL>Savings</FL><In value={fields.savP} onChange={e=>sf('savP',e.target.value)} placeholder="$2,295"/></div>
            <div><FL>Down Payment</FL><In value={fields.downP} onChange={e=>sf('downP',e.target.value)} placeholder="$3,000"/></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><FL>Biweekly Payment</FL><In value={fields.bwP} onChange={e=>sf('bwP',e.target.value)} placeholder="$283 biweekly"/></div>
            <div><FL>Upgrade In</FL><In value={fields.upgP} onChange={e=>sf('upgP',e.target.value)} placeholder="10 months"/></div>
          </div>

          <HR/>
          <Lbl>Key Features <span style={{ color:'#64748b', fontSize:9, fontWeight:400, textTransform:'none', letterSpacing:0 }}>Bold: description, one per line</span></Lbl>
          <textarea value={fields.feats} onChange={e=>sf('feats',e.target.value)} placeholder={"3.3L V6 Engine: Strong reliable power\nAWD: Traction in snow and rain\n7-Passenger Seating: Room for the whole family\nHeated Seats: Built for Canadian winters\nPush-Button Start: Keyless convenience"} style={{ width:'100%', background:'#0f0f16', border:'1px solid #1e1e2c', borderRadius:6, padding:'8px 10px', color:'#e2e8f0', fontSize:12, fontFamily:'inherit', resize:'vertical', minHeight:80, outline:'none', marginBottom:8 }}/>

          <HR/>
          <Lbl>Photos</Lbl>
          <div style={{ display:'flex', border:'1px solid #1e1e2c', borderRadius:6, overflow:'hidden', marginBottom:8 }}>
            {['auto','paste'].map(t=>(
              <button key={t} onClick={()=>setImgTab(t)} style={{ flex:1, padding:7, fontSize:11, fontWeight:600, cursor:'pointer', border:'none', background:imgTab===t?'#2563eb':'#0f0f16', color:imgTab===t?'white':'#64748b' }}>
                {t==='auto'?'Auto (from Pull)':'Paste URLs'}
              </button>
            ))}
          </div>

          {imgTab==='auto' && <>
            <p style={{ fontSize:10, color:'#64748b', lineHeight:1.5, marginBottom:6 }}>Photos load after Pull. If none appear, use <strong>Paste URLs</strong> tab.</p>
            <div style={{ display:'flex', gap:6, marginBottom:6 }}>
              <Btn style={{ fontSize:10, padding:'5px 10px', background:'#92400e' }} onClick={()=>setSelImgs([...allImgs])}>Select All</Btn>
              <Btn style={{ fontSize:10, padding:'5px 10px', background:'#374151' }} onClick={()=>setSelImgs([])}>Clear</Btn>
            </div>
            {allImgs.length===0
              ? <div style={{ color:'#64748b', fontSize:11 }}>Pull a listing to load photos</div>
              : <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4 }}>
                  {allImgs.map((src,i)=>(
                    <div key={i} onClick={()=>toggleImg(src)} style={{ aspectRatio:'4/3', borderRadius:4, overflow:'hidden', cursor:'pointer', border:`2px solid ${selImgs.includes(src)?'#2563eb':'transparent'}`, position:'relative', background:'#1a1a2e' }}>
                      <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>e.target.parentElement.style.display='none'}/>
                      {selImgs.includes(src) && <div style={{ position:'absolute', top:2, right:2, width:15, height:15, background:'#2563eb', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color:'white', fontWeight:700 }}>✓</div>}
                    </div>
                  ))}
                </div>
            }
            {allImgs.length>0 && <div style={{ fontSize:10, color:'#64748b', marginTop:4 }}>{selImgs.length} selected / {allImgs.length} total</div>}
          </>}

          {imgTab==='paste' && <>
            <p style={{ fontSize:10, color:'#64748b', lineHeight:1.5, marginBottom:6 }}>Right-click each listing photo → <strong>Copy image address</strong> → paste below, one per line.</p>
            <textarea value={pasteUrls} onChange={e=>setPasteUrls(e.target.value)} placeholder={"https://res.cloudinary.com/...\nhttps://..."} style={{ width:'100%', background:'#0f0f16', border:'1px solid #1e1e2c', borderRadius:6, padding:'8px 10px', color:'#e2e8f0', fontSize:12, fontFamily:'inherit', resize:'vertical', minHeight:100, outline:'none', marginBottom:6 }}/>
            <Btn style={{ width:'100%', justifyContent:'center', padding:10, background:'#92400e' }} onClick={loadPasted}>Load These Photos</Btn>
          </>}

          <HR/>
          <Btn style={{ width:'100%', justifyContent:'center', padding:11, fontSize:13 }} onClick={()=>setPreview(true)}>⚡ Build Preview</Btn>
          <Btn style={{ width:'100%', justifyContent:'center', padding:11, fontSize:13, background:'#16a34a', marginTop:6 }} onClick={doExport}>{exporting?'⏳ Generating...':'↓ Export PDF'}</Btn>
        </div>

        {/* RIGHT PREVIEW */}
        <div style={{ flex:1, overflowY:'auto', background:'#111', display:'flex', flexDirection:'column', alignItems:'center', padding:'20px 16px' }} ref={prevRef}>
          {!preview
            ? <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#64748b', textAlign:'center', gap:8 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".3"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
                <p style={{ fontSize:12 }}>Paste URL → Pull<br/>then Build Preview</p>
              </div>
            : slides_html.map((html,i)=>(
                <div key={i} style={{ alignSelf:'flex-start' }}>
                  <div style={{ fontSize:9, color:'#64748b', marginBottom:2, letterSpacing:.3 }}>SLIDE {i+1}</div>
                  <div className="slide" style={{ width:380, background:'#000', color:'white', overflow:'hidden', marginBottom:8, borderRadius:2, boxShadow:'0 3px 16px rgba(0,0,0,.8)' }} dangerouslySetInnerHTML={{ __html: html }}/>
                </div>
              ))
          }
        </div>
      </div>
    </>
  );
}

const In = ({style,...p}) => <input {...p} style={{ background:'#0f0f16', border:'1px solid #1e1e2c', borderRadius:6, padding:'8px 10px', color:'#e2e8f0', fontSize:12, outline:'none', width:'100%', fontFamily:'inherit', ...style }}/>;
const Btn = ({style,...p}) => <button {...p} style={{ background:'#2563eb', color:'white', border:'none', borderRadius:6, padding:'8px 13px', fontSize:12, fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, ...style }}/>;
const Lbl = ({children}) => <div style={{ fontSize:9, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#64748b', margin:'14px 0 6px' }}>{children}</div>;
const FL = ({children}) => <div style={{ fontSize:10, color:'#64748b', fontWeight:600, letterSpacing:.3, marginBottom:3 }}>{children}</div>;
const HR = () => <hr style={{ border:'none', borderTop:'1px solid #1e1e2c', margin:'12px 0' }}/>;
