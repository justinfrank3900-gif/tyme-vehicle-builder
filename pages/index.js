'use client';
import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

function fmt$(v) { const n = String(v).replace(/[^0-9]/g,''); if(!n) return ''; return '$'+parseInt(n).toLocaleString(); }
function fmtKms(v) { const n = String(v).replace(/[^0-9]/g,''); if(!n) return ''; return parseInt(n).toLocaleString()+' kms'; }
function fmtDown(v) { const n = String(v).replace(/[^0-9]/g,''); if(!n) return ''; return '$'+parseInt(n).toLocaleString()+' down'; }
function fmtBw(v) { const n = String(v).replace(/[^0-9]/g,''); if(!n) return ''; return '$'+parseInt(n).toLocaleString()+' biweekly'; }
function parseBullets(text) {
  if (!text.trim()) return [];
  return text.split('\n').map(l => l.replace(/^[\*\-\•\·]\s*/,'').trim()).filter(l => l.length > 0);
}

function CropModal({ src, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const cropRef = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);

  function getXY(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) / rect.width, y: (t.clientY - rect.top) / rect.height };
  }

  function getHandles(c) {
    return {
      nw:{x:c.x,y:c.y}, n:{x:c.x+c.w/2,y:c.y}, ne:{x:c.x+c.w,y:c.y},
      w:{x:c.x,y:c.y+c.h/2}, e:{x:c.x+c.w,y:c.y+c.h/2},
      sw:{x:c.x,y:c.y+c.h}, s:{x:c.x+c.w/2,y:c.y+c.h}, se:{x:c.x+c.w,y:c.y+c.h}
    };
  }

  function drawCanvas(c) {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(img,0,0,W,H);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0,0,W,H);
    const cx=c.x*W,cy=c.y*H,cw=c.w*W,ch=c.h*H;
    ctx.drawImage(img,cx/W*img.naturalWidth,cy/H*img.naturalHeight,cw/W*img.naturalWidth,ch/H*img.naturalHeight,cx,cy,cw,ch);
    ctx.strokeStyle='#2196f3'; ctx.lineWidth=2;
    ctx.strokeRect(cx,cy,cw,ch);
    ctx.fillStyle='#2196f3';
    for (const hv of Object.values(getHandles(c))) {
      ctx.beginPath(); ctx.arc(hv.x*W,hv.y*H,8,0,Math.PI*2); ctx.fill();
    }
  }

  // Load image as blob to avoid canvas taint (CORS issue)
  useEffect(() => {
    fetch(src).then(r=>r.blob()).then(blob=>{
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        const c = {x:0,y:0,w:1,h:1};
        cropRef.current = c;
        setReady(true);
        setTimeout(()=>drawCanvas(c),50);
      };
      img.src = url;
    }).catch(()=>{
      // Fallback: try direct with crossOrigin
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { imgRef.current = img; const c={x:0,y:0,w:1,h:1}; cropRef.current=c; setReady(true); setTimeout(()=>drawCanvas(c),50); };
      img.src = src;
    });
  }, []);

  function onMouseDown(e) {
    const canvas = canvasRef.current; if (!canvas) return;
    const p = getXY(e, canvas);
    const c = cropRef.current;
    for (const [hk,hv] of Object.entries(getHandles(c))) {
      if (Math.abs(p.x-hv.x)<0.05 && Math.abs(p.y-hv.y)<0.05) {
        dragRef.current = {type:'handle',handle:hk,start:p,origCrop:{...c}};
        return;
      }
    }
    if (p.x>c.x && p.x<c.x+c.w && p.y>c.y && p.y<c.y+c.h) {
      dragRef.current = {type:'move',start:p,origCrop:{...c}};
    }
  }

  function onMouseMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const p = getXY(e,canvas);
    const dx=p.x-drag.start.x, dy=p.y-drag.start.y;
    let nc={...drag.origCrop};
    if (drag.type==='move') {
      nc.x=Math.max(0,Math.min(1-nc.w,nc.x+dx));
      nc.y=Math.max(0,Math.min(1-nc.h,nc.y+dy));
    } else {
      const h=drag.handle;
      if(h.includes('e')) nc.w=Math.max(0.1,Math.min(1-nc.x,nc.w+dx));
      if(h.includes('s')) nc.h=Math.max(0.1,Math.min(1-nc.y,nc.h+dy));
      if(h.includes('w')){nc.x=Math.max(0,Math.min(nc.x+nc.w-0.1,nc.x+dx));nc.w=drag.origCrop.w-(nc.x-drag.origCrop.x);}
      if(h.includes('n')){nc.y=Math.max(0,Math.min(nc.y+nc.h-0.1,nc.y+dy));nc.h=drag.origCrop.h-(nc.y-drag.origCrop.y);}
    }
    cropRef.current = nc;
    drawCanvas(nc);
  }

  function onMouseUp() { dragRef.current = null; }

  function applyCrop() {
    const img = imgRef.current; if(!img) return;
    const c = cropRef.current;
    const out=document.createElement('canvas');
    out.width=Math.round(c.w*img.naturalWidth);
    out.height=Math.round(c.h*img.naturalHeight);
    out.getContext('2d').drawImage(img,c.x*img.naturalWidth,c.y*img.naturalHeight,out.width,out.height,0,0,out.width,out.height);
    onDone(out.toDataURL('image/jpeg',0.95));
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:1000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{color:'white',fontWeight:700,fontSize:14,marginBottom:12}}>{ready ? 'Crop Photo — drag handles to adjust' : 'Loading image...'}</div>
      <canvas ref={canvasRef} width={600} height={450}
        style={{maxWidth:'90vw',maxHeight:'60vh',cursor:'crosshair',borderRadius:8,border:'2px solid #2196f3'}}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onTouchStart={e=>{e.preventDefault();onMouseDown(e);}}
        onTouchMove={e=>{e.preventDefault();onMouseMove(e);}}
        onTouchEnd={onMouseUp}/>
      <div style={{display:'flex',gap:12,marginTop:16}}>
        <button onClick={applyCrop} style={{background:'#16a34a',color:'white',border:'none',borderRadius:7,padding:'10px 24px',fontWeight:700,cursor:'pointer',fontSize:13}}>Apply Crop</button>
        <button onClick={onCancel} style={{background:'#374151',color:'white',border:'none',borderRadius:7,padding:'10px 24px',fontWeight:700,cursor:'pointer',fontSize:13}}>Cancel</button>
      </div>
    </div>
  );
}

function BrushModal({ src, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const imgRef = useRef(null);
  const painting = useRef(false);
  const [brushSize, setBrushSize] = useState(20);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(src).then(r=>r.blob()).then(blob=>{
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        const canvas = canvasRef.current;
        const mask = maskRef.current;
        if (!canvas || !mask) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        mask.width = img.naturalWidth;
        mask.height = img.naturalHeight;
        // Draw image on canvas
        canvas.getContext('2d').drawImage(img, 0, 0);
        // Init mask as black (keep everything)
        const mctx = mask.getContext('2d');
        mctx.fillStyle = '#000';
        mctx.fillRect(0, 0, mask.width, mask.height);
        setReady(true);
      };
      img.src = url;
    });
  }, []);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - rect.left) * scaleX,
      y: (t.clientY - rect.top) * scaleY
    };
  }

  function paint(e) {
    if (!painting.current) return;
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const img = imgRef.current;
    if (!canvas || !mask || !img) return;
    const pos = getPos(e, canvas);
    const bs = brushSize * (canvas.width / canvas.getBoundingClientRect().width);
    // Draw red overlay on display canvas
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,50,50,0.5)';
    ctx.beginPath(); ctx.arc(pos.x, pos.y, bs, 0, Math.PI*2); ctx.fill();
    // Draw white on mask (white = erase)
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.beginPath(); mctx.arc(pos.x, pos.y, bs, 0, Math.PI*2); mctx.fill();
  }

  function startPaint(e) { e.preventDefault(); painting.current = true; paint(e); }
  function stopPaint() { painting.current = false; }

  function clearMask() {
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const img = imgRef.current;
    if (!canvas || !mask || !img) return;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, mask.width, mask.height);
  }

  async function applyErase() {
    const mask = maskRef.current;
    if (!mask) return;
    const maskDataUrl = mask.toDataURL('image/png');
    onDone(src, maskDataUrl);
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:1001,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{color:'white',fontWeight:700,fontSize:14,marginBottom:8}}>
        {ready ? '🖌️ Paint over logos/badges to erase — then hit Apply' : 'Loading image...'}
      </div>
      <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:8}}>
        <span style={{color:'#aaa',fontSize:11}}>Brush size:</span>
        <input type="range" min="5" max="60" value={brushSize} onChange={e=>setBrushSize(+e.target.value)} style={{width:100}}/>
        <span style={{color:'white',fontSize:11}}>{brushSize}px</span>
        <button onClick={clearMask} style={{background:'#374151',color:'white',border:'none',borderRadius:5,padding:'4px 12px',fontSize:11,cursor:'pointer'}}>Clear</button>
      </div>
      <canvas ref={canvasRef}
        style={{maxWidth:'85vw',maxHeight:'55vh',cursor:'crosshair',borderRadius:6,border:'2px solid #ef4444'}}
        onMouseDown={startPaint} onMouseMove={paint} onMouseUp={stopPaint} onMouseLeave={stopPaint}
        onTouchStart={startPaint} onTouchMove={e=>{e.preventDefault();paint(e);}} onTouchEnd={stopPaint}/>
      <canvas ref={maskRef} style={{display:'none'}}/>
      <div style={{display:'flex',gap:12,marginTop:12}}>
        <button onClick={applyErase} style={{background:'#dc2626',color:'white',border:'none',borderRadius:7,padding:'10px 24px',fontWeight:700,cursor:'pointer',fontSize:13}}>🧹 Erase Painted Areas</button>
        <button onClick={onCancel} style={{background:'#374151',color:'white',border:'none',borderRadius:7,padding:'10px 24px',fontWeight:700,cursor:'pointer',fontSize:13}}>Cancel</button>
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [fields, setFields] = useState({
    title:'',color:'',kms:'',wasP:'',todP:'',savP:'',
    downP:'',bwP:'',upgP:'10 months',
    trade:'',lien:'',equity:'',
    paymentLine:'Payment is all in!!!'
  });
  const [featText, setFeatText] = useState('');
  const [allImgs, setAllImgs] = useState([]);
  const [selImgs, setSelImgs] = useState([]);
  const [cropImg, setCropImg] = useState(null);
  const [pasteUrls, setPasteUrls] = useState('');
  const [imgTab, setImgTab] = useState('auto');
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [erasing, setErasing] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [brushModal, setBrushModal] = useState(null); // {src, selIdx}
  const prevRef = useRef(null);

  function sf(key,val){setFields(f=>({...f,[key]:val}));}

  function clearAll(){
    setFields({title:'',color:'',kms:'',wasP:'',todP:'',savP:'',downP:'',bwP:'',upgP:'10 months',trade:'',lien:'',equity:'',paymentLine:'Payment is all in!!!'});
    setFeatText('');setAllImgs([]);setSelImgs([]);setPasteUrls('');setPreview(false);
  }

  function proxyImg(src){
    if(!src) return src;
    if(src.startsWith('/')||src.startsWith('data:')) return src;
    return `/api/proxy-image?url=${encodeURIComponent(src)}`;
  }

  async function fetchListing(){
    if(!url.trim()) return setStatus({msg:'Paste a listing URL first.',type:'err'});
    clearAll();
    const trimUrl = url.trim();

    const isAutoTrader = trimUrl.includes('autotrader.ca');
    // All platforms go server-side — AutoTrader uses residential proxy on the backend
    setStatus({msg: isAutoTrader ? 'Fetching AutoTrader listing via residential proxy... (20-30 sec)' : 'Pulling listing data...', type:'info'});
    try {
      const r=await fetch('/api/fetch-listing',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:trimUrl})
      });
      const json=await r.json();
      if(!json.success) throw new Error(json.error||'Server error');
      const d=json.data;
      const w=parseInt((d.wasPrice||'').replace(/[^0-9]/g,''));
      const t=parseInt((d.todayPrice||'').replace(/[^0-9]/g,''));
      const sav=(!isNaN(w)&&!isNaN(t)&&w>t)?'$'+(w-t).toLocaleString():'';
      setFields(prev=>({...prev,title:d.title||'',color:d.color||'',kms:d.kms||'',wasP:d.wasPrice||'',todP:d.todayPrice||'',savP:sav,bwP:d.biweeklyPayment||''}));
      const imgs=[...new Set((d.images||[]).filter(u=>u&&u.startsWith('http')))];
      setAllImgs(imgs);
      setStatus(imgs.length
        ?{msg:`✓ ${d.title||'Vehicle'} — ${imgs.length} photos loaded.`,type:'ok'}
        :{msg:`✓ ${d.title||'Data loaded'} — no images found. Use Paste URLs tab.`,type:'warn'});
    } catch(e){
      setStatus({msg:'Pull failed: '+e.message,type:'err'});
    }
  }

  function toggleImg(src){setSelImgs(prev=>prev.includes(src)?prev.filter(s=>s!==src):[...prev,src]);}

  function loadPasted(){
    const urls=pasteUrls.split('\n').map(u=>u.trim()).filter(u=>u.startsWith('http'));
    if(!urls.length) return setStatus({msg:'No valid URLs found.',type:'err'});
    setAllImgs([...new Set(urls)].slice(0,30));setSelImgs([]);
    setImgTab('auto');
    setStatus({msg:`✓ ${urls.length} photos loaded.`,type:'ok'});
  }

  function openCrop(src,idx){setCropImg({src:proxyImg(src),origSrc:src,idx});}

  function applyCrop(dataUrl){
    const{origSrc}=cropImg;
    setSelImgs(prev=>prev.map((s,i)=>i===cropImg.idx?dataUrl:s));
    setAllImgs(prev=>prev.map(s=>s===origSrc?dataUrl:s));
    setCropImg(null);
  }

  async function eraseBackground(src,selIdx){
    setErasing(selIdx);
    try {
      const r=await fetch('/api/remove-bg',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageUrl: src.startsWith('data:') ? src : proxyImg(src)})
      });
      const json=await r.json();
      if(!json.success) throw new Error(json.error||'Remove.bg failed');
      const dataUrl=json.dataUrl;
      setSelImgs(prev=>prev.map((s,i)=>i===selIdx?dataUrl:s));
      setAllImgs(prev=>prev.map(s=>s===src?dataUrl:s));
      setStatus({msg:'✓ Background removed',type:'ok'});
    } catch(e){setStatus({msg:'AI removal failed: '+e.message,type:'err'});}
    setErasing(null);
  }

  async function cleanBranding(){
    if(!selImgs.length) return setStatus({msg:'Select photos first.',type:'err'});
    setCleaning(true);
    setStatus({msg:`Cleaning branding from ${selImgs.length} photo${selImgs.length>1?'s':''}...`,type:'info'});
    let done=0;
    const cleaned=[...selImgs];
    for(let i=0;i<selImgs.length;i++){
      const src=selImgs[i];
      try {
        const r=await fetch('/api/clean-branding',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({imageUrl: src.startsWith('data:') ? src : src})
        });
        const json=await r.json();
        if(json.success){
          cleaned[i]=json.dataUrl;
          done++;
          setStatus({msg:`Cleaning... ${done}/${selImgs.length} done`,type:'info'});
        }
      } catch(e){ /* skip failed, keep original */ }
    }
    setSelImgs(cleaned);
    setStatus({msg:`✓ Cleaned ${done} of ${selImgs.length} photos`,type:'ok'});
    setCleaning(false);
  }

  async function applyBrushErase(src, maskDataUrl) {
    setBrushModal(null);
    setStatus({msg:'Erasing painted areas...', type:'info'});
    try {
      const r = await fetch('/api/clean-branding', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ imageUrl: src, maskDataUrl })
      });
      const json = await r.json();
      if (!json.success) throw new Error(json.error || 'Erase failed');
      const selIdx = brushModal ? brushModal.selIdx : -1;
      if (selIdx >= 0) {
        setSelImgs(prev => prev.map((s,i) => i===selIdx ? json.dataUrl : s));
        setAllImgs(prev => prev.map(s => s===src ? json.dataUrl : s));
      }
      setStatus({msg:'✓ Areas erased', type:'ok'});
    } catch(e) { setStatus({msg:'Erase failed: '+e.message, type:'err'}); }
  }
  const pairs=[];
  for(let i=0;i<selImgs.length;i+=2)
    pairs.push(selImgs[i+1]?[selImgs[i],selImgs[i+1]]:[selImgs[i]]);

  async function doExport(){
    if(!preview) return alert('Build preview first.');
    setExporting(true);
    try {
      const{jsPDF}=window.jspdf;
      const slides=prevRef.current.querySelectorAll('.slide');
      const W=390;
      const pdf=new jsPDF({unit:'px',format:[W,844],hotfixes:['px_scaling']});
      let first=true;
      for(const slide of slides){
        // Pre-render all images with object-fit:contain using canvas
        // html2canvas doesn't support object-fit, so we draw manually
        const imgEls=slide.querySelectorAll('img[data-cover]');
        const coverMap=new Map();
        await Promise.all([...imgEls].map(async imgEl=>{
          const w=imgEl.offsetWidth||390;
          const h=imgEl.offsetHeight||345;
          await new Promise(res=>{if(imgEl.complete)res();else{imgEl.onload=res;imgEl.onerror=res;}});
          const iw=imgEl.naturalWidth,ih=imgEl.naturalHeight;
          if(!iw||!ih) return;
          // Contain: scale to fit, center with black bars
          const scale=Math.min((w*2)/iw,(h*2)/ih);
          const sw=iw*scale,sh=ih*scale;
          const ox=((w*2)-sw)/2,oy=((h*2)-sh)/2;
          const can=document.createElement('canvas');
          can.width=w*2;can.height=h*2;
          const ctx=can.getContext('2d');
          ctx.fillStyle='#000';
          ctx.fillRect(0,0,w*2,h*2);
          ctx.drawImage(imgEl,ox,oy,sw,sh);
          coverMap.set(imgEl,can.toDataURL('image/jpeg',0.95));
        }));
        // Swap img src with pre-rendered canvas data for export
        for(const [imgEl,dataUrl] of coverMap){
          imgEl.dataset.origSrc=imgEl.src;
          imgEl.src=dataUrl;
          imgEl.style.objectFit='fill';
        }
        await Promise.all([...slide.querySelectorAll('img')].map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=r;img.onerror=r;})));
        const c=await window.html2canvas(slide,{scale:2,useCORS:true,allowTaint:true,backgroundColor:'#000000',logging:false,imageTimeout:20000,width:390,windowWidth:390});
        // Restore original srcs
        for(const [imgEl] of coverMap){
          imgEl.src=imgEl.dataset.origSrc;
          imgEl.style.objectFit='';
        }
        const imgData=c.toDataURL('image/jpeg',0.93);
        const ph=Math.round((c.height/c.width)*W);
        if(!first) pdf.addPage([W,ph]);
        else{pdf.deletePage(1);pdf.addPage([W,ph]);}
        first=false;
        pdf.addImage(imgData,'JPEG',0,0,W,ph);
      }
      pdf.save((fields.title||'Vehicle').replace(/\s+/g,'_')+'_Presentation.pdf');
    } catch(e){alert('Export error: '+e.message);}
    setExporting(false);
  }

  const upg=fields.upgP||'10 months';
  const LOGO='/logo.png';
  const HDR=t=>`<div style="padding:16px 18px 10px;border-bottom:2px solid #2196f3;margin-bottom:14px;background:linear-gradient(90deg,rgba(33,150,243,0.12),transparent)"><h2 style="font-size:22px;font-weight:900;color:#2196f3;letter-spacing:3px;text-transform:uppercase;margin:0;text-align:center;text-shadow:0 0 18px rgba(33,150,243,0.5)">${t}</h2></div>`;
  const LOGO_BOT=`<div style="display:flex;flex-direction:column;align-items:center;padding:16px;gap:4px"><img src="${LOGO}" style="width:110px;height:110px;object-fit:contain" crossorigin="anonymous"/></div>`;
  const STAR=items=>items.map(t=>`<div style="display:flex;align-items:center;gap:12px;font-size:19px;font-weight:700;color:white;padding:4px 0"><span style="color:#2196f3;font-size:24px;flex-shrink:0;text-shadow:0 0 10px rgba(33,150,243,0.8)">★</span>${t}</div>`).join('');
  const SH=693,PH=345;
  const pairSlide=(a,b)=>{
    const pA=a.startsWith('data:')?a:proxyImg(a);
    const pB=b.startsWith('data:')?b:proxyImg(b);
    return `<div style="width:390px;height:${SH}px;overflow:hidden;background:#000;display:block"><div style="width:390px;height:${PH}px;background:#000;display:flex;align-items:center;justify-content:center"><img src="${pA}" data-cover="1" style="width:390px;height:${PH}px;object-fit:contain;display:block" crossorigin="anonymous"/></div><div style="width:390px;height:3px;background:#111;display:block"></div><div style="width:390px;height:${PH}px;background:#000;display:flex;align-items:center;justify-content:center"><img src="${pB}" data-cover="1" style="width:390px;height:${PH}px;object-fit:contain;display:block" crossorigin="anonymous"/></div></div>`;
  };
  const singleSlide=a=>{
    const pA=a.startsWith('data:')?a:proxyImg(a);
    return `<div style="width:390px;height:${SH}px;background:#000;display:flex;align-items:center;justify-content:center"><img src="${pA}" data-cover="1" style="width:390px;height:${SH}px;object-fit:contain;display:block" crossorigin="anonymous"/></div>`;
  };

  const slides_html=!preview?null:[
    `<div style="aspect-ratio:9/16;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;padding:30px;background-image:radial-gradient(ellipse at center,#0a1a2e 0%,#000 70%)">
      <img src="${LOGO}" style="width:300px;height:300px;object-fit:contain;margin-bottom:24px" crossorigin="anonymous"/>
      <div style="text-align:center;margin-top:10px">
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:42px;font-weight:900;color:white"><span style="color:#2196f3;font-size:48px;text-shadow:0 0 20px rgba(33,150,243,0.9)">★</span>#1</div>
        <div style="font-size:30px;font-weight:900;color:white;line-height:1.3;margin-top:10px">Auto Finance Company<br/>in the Country</div>
      </div>
    </div>`,
    `<div style="background:linear-gradient(180deg,#050510,#0a0a18);padding-bottom:20px;min-height:${SH}px">
      ${HDR('Unit Description')}
      <div style="padding:0 16px 6px;font-size:24px;font-weight:900;color:white;line-height:1.3;word-wrap:break-word">${fields.title}</div>
      <div style="padding:0 16px 16px;font-size:20px;font-weight:800;color:white">${fields.color}${fields.color&&fields.kms?' – ':''}${fields.kms}</div>
      <div style="padding:0 14px;display:flex;flex-direction:column;gap:8px">
        ${features.map(f=>`<div style="display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.4;color:white;word-wrap:break-word"><div style="width:8px;height:8px;min-width:8px;background:#2196f3;border-radius:50%;margin-top:5px;box-shadow:0 0 6px rgba(33,150,243,0.8)"></div><div>${f}</div></div>`).join('')}
      </div>
    </div>`,
    `<div style="background:linear-gradient(180deg,#050510,#0a0a18);padding-bottom:20px">
      ${HDR('Financial Breakdown')}
      <div style="padding:0 16px;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:24px;font-weight:800;color:white">Was: ${fields.wasP}</div>
        <div style="font-size:28px;font-weight:900;color:white">Today: ${fields.todP}</div>
        <div style="font-size:24px;font-weight:800;color:white">Savings: ${fields.savP}</div>
        ${fields.trade||fields.lien||fields.equity?`<div style="border-top:1px solid #1e1e2e;padding-top:10px;display:flex;flex-direction:column;gap:8px">${fields.trade?`<div style="font-size:22px;font-weight:800;color:white">Trade: ${fields.trade}</div>`:''}${fields.lien?`<div style="font-size:22px;font-weight:800;color:white">Lien: ${fields.lien}</div>`:''}${fields.equity?`<div style="font-size:22px;font-weight:800;color:white">Neg Equity: ${fields.equity}</div>`:''}</div>`:''}
        <div style="border-top:1px solid #1e1e2e;padding-top:12px;display:flex;flex-direction:column;gap:8px">
          ${fields.downP?`<div style="font-size:24px;font-weight:800;color:white">${fields.downP}</div>`:''}
          ${fields.bwP?`<div style="font-size:34px;font-weight:900;color:#4caf50;line-height:1.1">${fields.bwP}</div>`:''}
          <div style="font-size:22px;font-weight:800;color:white">${fields.paymentLine}</div>
          <div style="font-size:26px;font-weight:900;color:#4caf50;margin-top:8px;line-height:1.3">Qualify for an upgrade in<br/>${upg}!</div>
        </div>
      </div>
    </div>`,
    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18);padding-bottom:10px">
      ${HDR('Benefits of This Deal')}
      <div style="padding:16px;display:flex;flex-direction:column;gap:18px">${STAR(['Penalty Free Loan',`Qualify For Upgrade In ${upg}`,'Re Conditioned Vehicle','Risk Free Delivery','Mechanical Guarantee'])}</div>
      ${LOGO_BOT}
    </div>`,
    ...pairs.map(p=>p.length===2?pairSlide(p[0],p[1]):singleSlide(p[0])),
    `<div style="background:linear-gradient(180deg,#05050f,#0a0a18);padding-bottom:10px">
      ${HDR('No Risk Delivery Service')}
      <div style="padding:10px 16px 14px;font-size:18px;font-weight:700;color:#2196f3;line-height:1.5">Your Unit will be delivered to your front door with the following:</div>
      <div style="padding:0 16px;display:flex;flex-direction:column;gap:18px">${STAR(['No Risk Delivery Service','We will help arrange your insurance','We will help set up your registration including plates','Fully reconditioned unit','Constant support after the fact in case of issues'])}</div>
      ${LOGO_BOT}
    </div>`,
    `<div style="background:#000;display:flex;flex-direction:column;align-items:center;padding-bottom:30px;background-image:radial-gradient(ellipse at center,#0a1a2e 0%,#000 70%)">
      ${HDR('Electronic Paperwork')}
      <div style="padding:12px 18px 20px;text-align:center;font-size:17px;font-weight:700;color:#2196f3;line-height:1.6">Paperwork done right on your phone or laptop through our electronic signature partner <strong style="color:white">PandaDoc</strong></div>
      <div style="border:3px solid #2196f3;border-radius:24px;padding:24px 20px;width:240px;background:#0a0a1a;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 0 30px rgba(33,150,243,0.3)">
        <div style="background:#3CBB70;border-radius:10px;padding:12px 20px;display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;background:white;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:#3CBB70">pd</div>
          <span style="font-size:22px;font-weight:900;color:white">PandaDoc</span>
        </div>
        <img src="${LOGO}" style="width:90px;height:90px;object-fit:contain" crossorigin="anonymous"/>
      </div>
    </div>`,
  ];

  const stColors={
    info:{bg:'#1e3a5f',color:'#93c5fd'},ok:{bg:'#14532d',color:'#86efac'},
    err:{bg:'#450a0a',color:'#fca5a5'},warn:{bg:'#451a03',color:'#fdba74'}
  };

  return (
    <>
      <Head>
        <title>TYME — Vehicle Presentation Builder</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"/>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"/>
        <style>{`*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',system-ui,sans-serif}img{display:block}input,textarea,button,select{font-family:inherit}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0a0a12}::-webkit-scrollbar-thumb{background:#1e1e2c;border-radius:3px}`}</style>
      </Head>

      {cropImg&&<CropModal src={cropImg.src} onDone={applyCrop} onCancel={()=>setCropImg(null)}/>}
      {brushModal&&<BrushModal src={proxyImg(brushModal.src)} onDone={(src,mask)=>applyBrushErase(brushModal.src,mask)} onCancel={()=>setBrushModal(null)}/>}

      <div style={{display:'flex',height:'100vh',background:'#0d0d12',color:'#e2e8f0',fontSize:13}}>
        <div style={{width:355,minWidth:355,background:'#13131a',borderRight:'1px solid #1e1e2c',overflowY:'auto',padding:16}}>

          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,paddingBottom:12,borderBottom:'1px solid #1e1e2c'}}>
            <img src={LOGO} style={{width:38,height:38,objectFit:'contain',borderRadius:6}}/>
            <div><div style={{fontWeight:800,fontSize:13}}>Vehicle Presentation Builder</div><div style={{fontSize:10,color:'#64748b'}}>by TYME · Easy Auto Loans Canada</div></div>
          </div>

          <Lbl>Listing URL</Lbl>
          <div style={{display:'flex',gap:6}}>
            <In value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste listing URL..." onKeyDown={e=>e.key==='Enter'&&fetchListing()} style={{flex:1,width:'auto'}}/>
            <Btn onClick={fetchListing}>Pull</Btn>
          </div>
          {status&&<div style={{padding:'8px 11px',borderRadius:6,fontSize:11,marginTop:7,lineHeight:1.4,background:stColors[status.type]?.bg,color:stColors[status.type]?.color}}>{status.msg}</div>}

          <HR/><Lbl>Vehicle Info</Lbl>
          <div style={{marginBottom:8}}><FL>Year / Make / Model / Trim</FL><In value={fields.title} onChange={e=>sf('title',e.target.value)} placeholder="2022 Ford F-150 Lariat FX4"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <div><FL>Colour</FL><In value={fields.color} onChange={e=>sf('color',e.target.value)} placeholder="Black"/></div>
            <div><FL>Kilometres</FL><In value={fields.kms} onChange={e=>sf('kms',e.target.value)} onBlur={e=>sf('kms',fmtKms(e.target.value))} placeholder="99,090 kms"/></div>
          </div>

          <HR/><Lbl>Deal Numbers</Lbl>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <div><FL>Was Price</FL><In value={fields.wasP} onChange={e=>sf('wasP',e.target.value)} onBlur={e=>sf('wasP',fmt$(e.target.value))} placeholder="$58,995"/></div>
            <div><FL>Today&apos;s Price</FL><In value={fields.todP} onChange={e=>sf('todP',e.target.value)} onBlur={e=>{const v=fmt$(e.target.value);sf('todP',v);const w=parseInt(fields.wasP.replace(/[^0-9]/g,''));const t=parseInt(v.replace(/[^0-9]/g,''));if(!isNaN(w)&&!isNaN(t)&&w>t)sf('savP','$'+(w-t).toLocaleString());}} placeholder="$55,995"/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <div><FL>Savings</FL><In value={fields.savP} onChange={e=>sf('savP',e.target.value)} onBlur={e=>sf('savP',fmt$(e.target.value))} placeholder="$3,000"/></div>
            <div><FL>Down Payment</FL><In value={fields.downP} onChange={e=>sf('downP',e.target.value)} onBlur={e=>sf('downP',fmtDown(e.target.value))} placeholder="$3,000 down"/></div>
          </div>
          <div style={{marginBottom:8}}><FL>Biweekly Payment</FL><In value={fields.bwP} onChange={e=>sf('bwP',e.target.value)} onBlur={e=>sf('bwP',fmtBw(e.target.value))} placeholder="283"/></div>
          <div style={{marginBottom:8}}>
            <FL>Payment Line</FL>
            <select value={fields.paymentLine} onChange={e=>sf('paymentLine',e.target.value)} style={{width:'100%',background:'#0f0f16',border:'1px solid #1e1e2c',borderRadius:6,padding:'8px 10px',color:'#e2e8f0',fontSize:12,outline:'none'}}>
              <option>Payment is all in!!!</option>
              <option>Payment includes extended warranty</option>
            </select>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
            <div><FL>Trade</FL><In value={fields.trade} onChange={e=>sf('trade',e.target.value)} onBlur={e=>sf('trade',fmt$(e.target.value))} placeholder="$22,000"/></div>
            <div><FL>Lien</FL><In value={fields.lien} onChange={e=>sf('lien',e.target.value)} onBlur={e=>sf('lien',fmt$(e.target.value))} placeholder="$29,000"/></div>
            <div><FL>Neg Equity</FL><In value={fields.equity} onChange={e=>sf('equity',e.target.value)} onBlur={e=>sf('equity',fmt$(e.target.value))} placeholder="$7,000"/></div>
          </div>
          <div style={{marginBottom:8}}><FL>Upgrade In</FL><In value={fields.upgP} onChange={e=>sf('upgP',e.target.value)} placeholder="10 months"/></div>

          <HR/>
          <Lbl>Key Features <span style={{color:'#64748b',fontSize:9,fontWeight:400,textTransform:'none',letterSpacing:0}}>— paste from ChatGPT, each * line = bullet</span></Lbl>
          <textarea value={featText} onChange={e=>setFeatText(e.target.value)}
            placeholder={"Paste ChatGPT features:\n* Sport Package – Bold athletic look\n* Heated Seats – Year-round comfort"}
            style={{width:'100%',background:'#0f0f16',border:'1px solid #1e1e2c',borderRadius:6,padding:'8px 10px',color:'#e2e8f0',fontSize:12,resize:'vertical',minHeight:100,outline:'none',marginBottom:6}}/>
          {parseBullets(featText).length>0&&<div style={{fontSize:10,color:'#86efac',marginBottom:6}}>✓ {parseBullets(featText).length} bullets detected</div>}

          <HR/><Lbl>Photos</Lbl>
          <div style={{display:'flex',border:'1px solid #1e1e2c',borderRadius:6,overflow:'hidden',marginBottom:8}}>
            {['auto','paste'].map(t=>(
              <button key={t} onClick={()=>setImgTab(t)} style={{flex:1,padding:7,fontSize:11,fontWeight:600,cursor:'pointer',border:'none',background:imgTab===t?'#2196f3':'#0f0f16',color:imgTab===t?'white':'#64748b'}}>
                {t==='auto'?'Auto (from Pull)':'Paste URLs'}
              </button>
            ))}
          </div>

          {imgTab==='auto'&&<>
            <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
              <Btn style={{fontSize:10,padding:'5px 10px',background:'#92400e'}} onClick={()=>setSelImgs([...allImgs])}>Select All</Btn>
              <Btn style={{fontSize:10,padding:'5px 10px',background:'#374151'}} onClick={()=>setSelImgs([])}>Clear</Btn>
              {selImgs.length>0&&<Btn style={{fontSize:10,padding:'5px 10px',background:'#6d28d9',opacity:cleaning?0.6:1}} onClick={cleanBranding} disabled={cleaning}>{cleaning?'🧹 Cleaning...':'🧹 Clean Branding'}</Btn>}
            </div>
            {allImgs.length===0
              ?<div style={{color:'#64748b',fontSize:11,marginBottom:6}}>Pull a listing to load photos</div>
              :<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4}}>
                {allImgs.map((src,i)=>{
                  const isSel=selImgs.includes(src);
                  const selIdx=selImgs.indexOf(src);
                  return(
                    <div key={i} style={{position:'relative',borderRadius:4,overflow:'hidden',border:`2px solid ${isSel?'#2196f3':'transparent'}`,background:'#1a1a2e'}}>
                      <div onClick={()=>toggleImg(src)} style={{aspectRatio:'4/3',cursor:'pointer'}}>
                        <img src={proxyImg(src)} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.parentElement.parentElement.style.display='none'}/>
                      </div>
                      {isSel&&<>
                        <div style={{position:'absolute',top:2,right:2,width:15,height:15,background:'#2196f3',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,color:'white',fontWeight:700}}>✓</div>
                        <div style={{display:'flex',gap:2,padding:'2px 3px',background:'rgba(0,0,0,0.7)'}}>
                          <button onClick={()=>openCrop(src,selIdx)} style={{flex:1,background:'#1e40af',border:'none',borderRadius:3,color:'white',fontSize:9,cursor:'pointer',padding:'2px 0'}}>✂ Crop</button>
                          <button onClick={()=>setBrushModal({src,selIdx})} style={{flex:1,background:'#7c3aed',border:'none',borderRadius:3,color:'white',fontSize:9,cursor:'pointer',padding:'2px 0'}}>🪄 AI</button>
                        </div>
                      </>}
                    </div>
                  );
                })}
              </div>
            }
            {allImgs.length>0&&<div style={{fontSize:10,color:'#64748b',marginTop:4}}>{selImgs.length} selected / {allImgs.length} total</div>}
          </>}

          {imgTab==='paste'&&<>
            <p style={{fontSize:10,color:'#64748b',lineHeight:1.5,marginBottom:6}}>Right-click photo → <strong>Copy image address</strong> → paste below, one per line.</p>
            <textarea value={pasteUrls} onChange={e=>setPasteUrls(e.target.value)} placeholder={"https://...\nhttps://..."} style={{width:'100%',background:'#0f0f16',border:'1px solid #1e1e2c',borderRadius:6,padding:'8px 10px',color:'#e2e8f0',fontSize:12,resize:'vertical',minHeight:100,outline:'none',marginBottom:6}}/>
            <Btn style={{width:'100%',justifyContent:'center',padding:10,background:'#92400e'}} onClick={loadPasted}>Load These Photos</Btn>
          </>}

          <HR/>
          <Btn style={{width:'100%',justifyContent:'center',padding:11,fontSize:13}} onClick={()=>setPreview(true)}>⚡ Build Preview</Btn>
          <Btn style={{width:'100%',justifyContent:'center',padding:11,fontSize:13,background:'#16a34a',marginTop:6}} onClick={doExport}>{exporting?'⏳ Generating...':'↓ Export PDF'}</Btn>
        </div>

        <div style={{flex:1,overflowY:'auto',background:'#111',display:'flex',flexDirection:'column',alignItems:'center',padding:'20px 16px'}} ref={prevRef}>
          {!preview
            ?<div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#64748b',textAlign:'center',gap:8}}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".3"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
              <p style={{fontSize:12}}>Paste URL → Pull<br/>then Build Preview</p>
            </div>
            :slides_html.map((html,i)=>(
              <div key={i}>
                <div className="slide" style={{width:390,background:'#000',color:'white',overflow:'hidden',marginBottom:10,borderRadius:3,boxShadow:'0 3px 16px rgba(0,0,0,.8)'}} dangerouslySetInnerHTML={{__html:html}}/>
              </div>
            ))
          }
        </div>
      </div>
    </>
  );
}

const In=({style,...p})=><input {...p} style={{background:'#0f0f16',border:'1px solid #1e1e2c',borderRadius:6,padding:'8px 10px',color:'#e2e8f0',fontSize:12,outline:'none',width:'100%',...style}}/>;
const Btn=({style,...p})=><button {...p} style={{background:'#2196f3',color:'white',border:'none',borderRadius:6,padding:'8px 13px',fontSize:12,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,...style}}/>;
const Lbl=({children})=><div style={{fontSize:9,fontWeight:700,letterSpacing:'1.5px',textTransform:'uppercase',color:'#64748b',margin:'14px 0 6px'}}>{children}</div>;
const FL=({children})=><div style={{fontSize:10,color:'#64748b',fontWeight:600,letterSpacing:.3,marginBottom:3}}>{children}</div>;
const HR=()=><hr style={{border:'none',borderTop:'1px solid #1e1e2c',margin:'12px 0'}}/>;
