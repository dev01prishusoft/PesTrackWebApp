async function exportFindingsPDF(sortBy='number'){
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to export', true, 3000); return;
  }
  showNotif('⏳ Initialising…', false, 0);

  // Yield to let UI update, then run async
  await new Promise(r=>setTimeout(r,50));

  // Ensure CDN libs are ready (they should be in <head> but add fallback)
  if(!window.jspdf){
    try{
      await new Promise((res,rej)=>{
        const s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload=res; s.onerror=()=>rej(new Error('Failed to load jsPDF'));
        document.head.appendChild(s);
      });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }
  if(!window.html2canvas){
    try{
      await new Promise((res,rej)=>{
        const s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload=res; s.onerror=()=>rej(new Error('Failed to load html2canvas'));
        document.head.appendChild(s);
      });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }

  try{
    const {jsPDF} = window.jspdf;

    // ── Page dimensions ───────────────────────────────────────────
    const pdf = new jsPDF({orientation:'portrait', unit:'mm', format:'a4'});
    // Map pages are now PORTRAIT — taller map area lets the site fill the
    // page at a higher zoom. Variable names kept from the landscape version.
    const LW = 210, LH = 297; // map-page dims (portrait)
    const PW = 210, PH = 297; // portrait dims
    const ML = 14, MR = 14, MB = 10;
    const HDR = 12; // header height

    const STAT_COLORS = {open:'#FB923C', repeat:'#EF4444', resolved:'#22C55E'};
    const STAT_LABELS = {open:'1st Offense', repeat:'Repeat', resolved:'Resolved'};
    // Built from the dashboard's CATS so PDF labels always match exactly
    const CAT_LABELS = Object.fromEntries((window._CATS||[]).map(c=>[c.id, c.label]));
    const CLIENT = (window._CLIENT_CONFIG&&window._CLIENT_CONFIG.name)||'El Gouna';

    function hexToRgb(h){
      h=h.replace('#','');
      return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
    }
    function pdfText(str){
      if(!str) return '';
      return str.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu,'')
                .replace(/[^\x00-\xFF]/g,'').trim();
    }
    function stripZeros(ref){ return ref ? String(parseInt(ref,10)||ref) : '?'; }

    showNotif('⏳ Step 1/4: Loading logo…', false, 0);
    const logoCanvas = document.createElement('canvas');
    const li = new Image();
    await new Promise(r=>{li.onload=r; li.onerror=r; li.src=LOGO_PESTRACK;});
    logoCanvas.width=li.naturalWidth||400; logoCanvas.height=li.naturalHeight||120;
    logoCanvas.getContext('2d').drawImage(li,0,0);

    // Preload construction icons (cons.png composite for map markers; single excavator for legend)
    let constrMapImgData = null, constrMapAspect = 1.207;
    let constrLegendImgData = null;
    try{
      const _ciMap = new Image();
      await new Promise(r=>{_ciMap.onload=r; _ciMap.onerror=r; _ciMap.src=CONSTR_MAP_ICON_DATA;});
      const _cMapCv = document.createElement('canvas');
      _cMapCv.width = _ciMap.naturalWidth || 309;
      _cMapCv.height = _ciMap.naturalHeight || 256;
      _cMapCv.getContext('2d').drawImage(_ciMap, 0, 0);
      constrMapImgData = _cMapCv.toDataURL('image/png');
      constrMapAspect = _cMapCv.width / _cMapCv.height;

      const _ciLeg = new Image();
      await new Promise(r=>{_ciLeg.onload=r; _ciLeg.onerror=r; _ciLeg.src=CONSTR_LEGEND_ICON_DATA;});
      const _cLegCv = document.createElement('canvas');
      _cLegCv.width = _ciLeg.naturalWidth || 168;
      _cLegCv.height = _ciLeg.naturalHeight || 168;
      _cLegCv.getContext('2d').drawImage(_ciLeg, 0, 0);
      constrLegendImgData = _cLegCv.toDataURL('image/png');
    }catch(e){ console.warn('Construction icon preload failed:', e); }

    function drawHeader(w, title, sub){
      pdf.setFillColor(255,255,255); pdf.rect(0,0,w,HDR,'F');
      pdf.setDrawColor(220,225,236); pdf.setLineWidth(0.3); pdf.line(0,HDR,w,HDR);
      const lh=8, lw=lh*(logoCanvas.width/logoCanvas.height);
      pdf.addImage(logoCanvas.toDataURL('image/png'),'PNG', ML, 2, lw, lh);
      pdf.setTextColor(28,35,51);
      pdf.setFontSize(8.5); pdf.setFont('helvetica','bold');
      pdf.text(title, w/2, 6, {align:'center'});
      pdf.setFontSize(6); pdf.setFont('helvetica','normal'); pdf.setTextColor(100,110,130);
      pdf.text(sub, w/2, 10.5, {align:'center'});
    }

    // ── PAGE 1: Portrait map — resize map to A4 portrait ratio first ──
    const mapEl = document.getElementById('map');
    const mapPxW = mapEl.offsetWidth;

    // Target height for A4 portrait ratio (no bottom margin — legend overlays map)
    const mapAreaH = LH - HDR;          // 285mm (portrait)
    const a4ratio  = LW / mapAreaH;     // 210/285 ≈ 0.74 (tall)
    const targetPxH = Math.round(mapPxW / a4ratio);
    const origStyle = mapEl.style.height;

    showNotif('⏳ Step 2/4: Capturing map…', false, 0);

    // Snapshot toggle state at PDF generation time (needed now to know what to zoom to)
    const findings = window._ptFindings;
    const PDF_HIDE_CONSTR    = !!window._hideConstr;
    const PDF_HIDE_FINDINGS  = !!window._hideFindings;
    const PDF_HIDE_RESOLVED  = !!window._hideResolved;
    // Filter findings by hide-resolved toggle for marker generation, counts, and detail pages
    const visibleFindings = PDF_HIDE_RESOLVED
      ? findings.filter(loc => {
          const latest = loc.visits && loc.visits[0];
          return !(latest && latest.status === 'resolved');
        })
      : findings;

    // Remember the user's current view so we can restore it after capture
    const origCenter = map.getCenter();
    const origZoom   = map.getZoom();

    // Temporarily resize map to A4 portrait proportions
    mapEl.style.height = targetPxH + 'px';
    map.invalidateSize();

    // ── AUTO-ZOOM: fit the tall viewport tightly around the actual data ──
    // This is the point of portrait — the site fills the page at the highest
    // zoom that still contains every finding (+ construction zones).
    const fitBounds = L.latLngBounds([]);
    if(!PDF_HIDE_FINDINGS) visibleFindings.forEach(l=>fitBounds.extend([l.lat, l.lng]));
    if(!PDF_HIDE_CONSTR) (window._ptConstrZones||[]).forEach(cz=>fitBounds.extend([cz.lat, cz.lng]));
    if(fitBounds.isValid()){
      map.fitBounds(fitBounds, {padding:[40,40], maxZoom:17, animate:false});
    }
    await new Promise(r=>setTimeout(r,900)); // let tiles settle (taller portrait capture)
    const captureZoom = map.getZoom();       // zoom used for marker-size scaling

    // Hide finding markers, construction icons, AND layer control during capture
    // (construction icons would otherwise be double-drawn — captured by html2canvas
    //  AND drawn explicitly via pdf.addImage below)
    const fiMarkers = mapEl.querySelectorAll('.fi-marker-wrap');
    fiMarkers.forEach(el=>el.style.visibility='hidden');
    const czMarkers = mapEl.querySelectorAll('.cz-divicon');
    czMarkers.forEach(el=>el.style.visibility='hidden');
    const layerCtrl = mapEl.closest('#map') ? document.querySelector('.leaflet-control-layers') : null;
    const layerCtrlEl = document.querySelector('.leaflet-control-layers');
    if(layerCtrlEl) layerCtrlEl.style.display='none';
    await new Promise(r=>setTimeout(r,200));

    const mapCanvas = await html2canvas(mapEl,{
      scale:1.5, useCORS:true, backgroundColor:'#e8e0d8', logging:false,
      width:mapPxW, height:targetPxH
    });
    const mapImg = mapCanvas.toDataURL('image/jpeg', 0.88);

    // ── Capture container points BEFORE restoring map size ────────
    // latLngToContainerPoint must be called while map is still at targetPxH,
    // otherwise pt.y is against a different height than the scaling math uses.
    showNotif('⏳ Step 3/4: Drawing markers…', false, 0);
    const drawX=0, drawY=HDR, drawW=LW, drawH=mapAreaH;

    const markers = visibleFindings.map(loc=>{
      const pt = map.latLngToContainerPoint([loc.lat, loc.lng]);
      const px = drawX + (pt.x / mapPxW) * drawW;
      const py = drawY + (pt.y / targetPxH) * drawH;
      return {loc, px, py, ax:px, ay:py};
    });

    // Capture construction-zone container points BEFORE map restore — same reason as findings
    const _czRaw = (window._ptConstrZones || []);
    const czPoints = _czRaw.map(cz=>{
      const pt = map.latLngToContainerPoint([cz.lat, cz.lng]);
      const cx = drawX + (pt.x / mapPxW) * drawW;
      const cy = drawY + (pt.y / targetPxH) * drawH;
      return {cx, cy};
    });

    // Measure the page-mm length of 1 km BEFORE map restore.
    // Offset the map centre by 1000 m of longitude and project both points.
    const _sc = map.getCenter();
    const _dLng = 1000 / (111320 * Math.cos(_sc.lat * Math.PI/180));
    const _p0 = map.latLngToContainerPoint([_sc.lat, _sc.lng]);
    const _p1 = map.latLngToContainerPoint([_sc.lat, _sc.lng + _dLng]);
    const KM_MM = Math.abs(_p1.x - _p0.x) / mapPxW * drawW;  // mm per 1 km

    // Restore map to original size AND view AFTER coordinate capture
    fiMarkers.forEach(el=>el.style.visibility='');
    czMarkers.forEach(el=>el.style.visibility='');
    if(layerCtrlEl) layerCtrlEl.style.display='';
    mapEl.style.height = origStyle || '';
    map.invalidateSize();
    map.setView(origCenter, origZoom, {animate:false});

    // Draw header on page 1
    drawHeader(LW, `SITE FINDINGS REPORT — ${CLIENT}`,
      `${visibleFindings.length} location${visibleFindings.length!==1?'s':''}  ·  ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);

    // Map fills from below header to bottom of page
    pdf.addImage(mapImg,'JPEG', 0, HDR, LW, mapAreaH);

    // ── Cluster detection & radial displacement ───────────────────
    // Scale marker size with the zoom the map was CAPTURED at
    const zoom = captureZoom;
    const TS = Math.max(2.2, Math.min(5.0, 2.2 + (zoom - 14) * 0.45)); // mm half-width
    const dotR = Math.max(1.0, TS * 0.38);
    const lblFont = Math.max(3.2, TS * 0.82);
    const numFont = Math.max(3.0, TS * 0.75);
    const CLUSTER_THRESH = TS * 3;
    const DISP_R = TS * 3.2;

    const assigned = new Array(markers.length).fill(-1);
    const clusters = [];
    for(let i=0;i<markers.length;i++){
      if(assigned[i]>=0) continue;
      const cl=[i]; assigned[i]=clusters.length;
      for(let j=i+1;j<markers.length;j++){
        if(assigned[j]>=0) continue;
        const dx=markers[i].px-markers[j].px, dy=markers[i].py-markers[j].py;
        if(Math.sqrt(dx*dx+dy*dy)<CLUSTER_THRESH){ cl.push(j); assigned[j]=clusters.length; }
      }
      clusters.push(cl);
    }

    clusters.forEach(cl=>{
      if(cl.length===1) return;
      const cx = cl.reduce((s,i)=>s+markers[i].px,0)/cl.length;
      const cy = cl.reduce((s,i)=>s+markers[i].py,0)/cl.length;
      cl.forEach((mi,idx)=>{
        const angle = (2*Math.PI*idx/cl.length) - Math.PI/2;
        markers[mi].px = cx + DISP_R*Math.cos(angle);
        markers[mi].py = cy + DISP_R*Math.sin(angle);
      });
    });

    // ── Build photo thumbnails — FIRST photo ever uploaded per location ──
    // Visits are sorted newest-first, so scan from the END (oldest visit).
    const THW = Math.max(13, TS*3.6);     // thumbnail edge length, mm
    const CR  = Math.max(2.4, TS*1.1);    // status circle radius, mm
    const thumbs = {};                    // locId → square JPEG dataURL

    function _firstPhotoB64(loc){
      for(let i=loc.visits.length-1; i>=0; i--){
        const ph = loc.visits[i] && loc.visits[i].photos;
        if(ph && ph.length) return ph[0];
      }
      return null;
    }
    function _makeThumb(b64){
      return new Promise(resolve=>{
        const img = new Image();
        img.onload = ()=>{
          try{
            const S = 220;  // px — crisp at print size, tiny file weight
            const side = Math.min(img.width, img.height);
            const sx = (img.width - side)/2, sy = (img.height - side)/2;
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, S, S);
            resolve(c.toDataURL('image/jpeg', 0.72));
          }catch(e){ resolve(null); }
        };
        img.onerror = ()=>resolve(null);
        img.src = b64;
      });
    }
    if(!PDF_HIDE_FINDINGS){
      for(const m of markers){
        const b64 = _firstPhotoB64(m.loc);
        if(b64){
          const t = await _makeThumb(b64);
          if(t) thumbs[m.loc.locId] = t;
        }
      }
    }

    // ── Place thumbnails — choose a ray direction per marker that ──
    //    keeps the photo on the page, off the legend, and clear of
    //    already-placed thumbnails and other markers.
    const placedBoxes = [];
    const legendKeepout = {x:0, y:LH-14, w:120, h:14};
    const scaleKeepout  = {x:LW-12-KM_MM, y:LH-13, w:KM_MM+12, h:13};
    function _boxesOverlap(a, b, gap){
      return !(a.x+a.w+gap < b.x || b.x+b.w+gap < a.x ||
               a.y+a.h+gap < b.y || b.y+b.h+gap < a.y);
    }
    const RAY_LEN = THW*0.85 + TS*2.2;
    const RAY_ANGLES = [-60,-120,-30,-150,30,150,60,120,0,180,-90,90]
      .map(d=>d*Math.PI/180);

    if(!PDF_HIDE_FINDINGS) markers.forEach(m=>{
      if(!thumbs[m.loc.locId]) return;
      let best = null, bestScore = Infinity;
      for(const ang of RAY_ANGLES){
        const tcx = m.ax + RAY_LEN*Math.cos(ang);
        const tcy = m.ay + RAY_LEN*Math.sin(ang);
        const box = {x:tcx-THW/2, y:tcy-THW/2, w:THW, h:THW};
        if(box.x < 1 || box.x+box.w > LW-1 || box.y < HDR+4 || box.y+box.h > LH-2) continue;
        let score = 0;
        if(_boxesOverlap(box, legendKeepout, 0)) score += 4;
        if(_boxesOverlap(box, scaleKeepout, 0)) score += 4;
        placedBoxes.forEach(pb=>{ if(_boxesOverlap(box, pb, 1)) score += 3; });
        markers.forEach(o=>{
          if(o===m) return;
          if(o.ax > box.x-CR-1 && o.ax < box.x+box.w+CR+1 &&
             o.ay > box.y-CR-1 && o.ay < box.y+box.h+CR+1) score += 1;
        });
        if(score < bestScore){ bestScore = score; best = box; if(score === 0) break; }
      }
      if(!best){
        // Marker hugging the page edge — clamp a box inside bounds
        const tcx = Math.min(Math.max(m.ax + RAY_LEN*0.7, 1+THW/2), LW-1-THW/2);
        const tcy = Math.min(Math.max(m.ay - RAY_LEN*0.7, HDR+4+THW/2), LH-2-THW/2);
        best = {x:tcx-THW/2, y:tcy-THW/2, w:THW, h:THW};
      }
      m.thumbBox = best;
      placedBoxes.push(best);
    });

    // ── Draw markers on PDF map — three passes: rays under photos,
    //    photos (with drop shadow), then plain black numbers on top ──
    if(!PDF_HIDE_FINDINGS){
      // Pass 1: one ray per finding — true GPS point → thumbnail centre
      markers.forEach(m=>{
        const {loc, ax, ay} = m;
        const latest = loc.visits[0];
        const sc = latest ? (STAT_COLORS[latest.status]||'#FB923C') : '#FB923C';
        const [r,g,b] = hexToRgb(sc);
        if(m.thumbBox && thumbs[loc.locId]){
          const tcx = m.thumbBox.x + m.thumbBox.w/2;
          const tcy = m.thumbBox.y + m.thumbBox.h/2;
          pdf.setDrawColor(r,g,b); pdf.setLineWidth(0.45);
          pdf.line(ax, ay, tcx, tcy);
        }
      });

      // Pass 2: photo thumbnails — drop shadow, white underlay, status frame
      markers.forEach(m=>{
        const tb = m.thumbBox, thumb = thumbs[m.loc.locId];
        if(!tb || !thumb) return;
        const latest = m.loc.visits[0];
        const sc = latest ? (STAT_COLORS[latest.status]||'#FB923C') : '#FB923C';
        const [r,g,b] = hexToRgb(sc);
        // Slight drop shadow below/right of the photo
        try{
          pdf.saveGraphicsState();
          pdf.setGState(new pdf.GState({opacity:0.25}));
          pdf.setFillColor(35,40,50);
          pdf.rect(tb.x+0.8, tb.y+1.1, tb.w+0.6, tb.h+0.6, 'F');
          pdf.restoreGraphicsState();
        }catch(e){
          pdf.setFillColor(205,208,214);
          pdf.rect(tb.x+0.8, tb.y+1.1, tb.w+0.6, tb.h+0.6, 'F');
        }
        pdf.setFillColor(255,255,255);
        pdf.rect(tb.x-0.5, tb.y-0.5, tb.w+1, tb.h+1, 'F');
        try{ pdf.addImage(thumb, 'JPEG', tb.x, tb.y, tb.w, tb.h); }catch(e){}
        pdf.setDrawColor(r,g,b); pdf.setLineWidth(0.55);
        pdf.rect(tb.x, tb.y, tb.w, tb.h, 'S');
      });

      // Pass 3: GPS dots + plain black ref numbers above each photo
      markers.forEach(m=>{
        const {loc, ax, ay} = m;
        const latest = loc.visits[0];
        const sc = latest ? (STAT_COLORS[latest.status]||'#FB923C') : '#FB923C';
        const [r,g,b] = hexToRgb(sc);

        // Status-coloured dot at the exact GPS point (drawn over the ray end)
        pdf.setFillColor(r,g,b);
        pdf.setDrawColor(255,255,255); pdf.setLineWidth(0.3);
        pdf.circle(ax, ay, dotR, 'FD');

        const numStr = stripZeros(loc.refNum);
        const numPt = Math.max(7, CR*2.4);
        pdf.setFontSize(numPt); pdf.setFont('helvetica','bold');
        const tb = m.thumbBox;
        let nx, ny;
        if(tb && thumbs[loc.locId]){
          nx = tb.x + tb.w/2;
          ny = tb.y - 1.4;                       // sitting above the photo
          if(ny - numPt*0.35 < HDR+2) ny = tb.y + tb.h + 3.4; // no room → below
        }else{
          nx = ax; ny = ay - dotR - 1.2;          // no photo: number above the dot
          if(ny - numPt*0.35 < HDR+2) ny = ay + dotR + 3.4;
        }
        // thin white halo so the number stays readable over map detail
        pdf.setDrawColor(255,255,255); pdf.setLineWidth(0.5);
        pdf.setTextColor(15,18,24);
        try{ pdf.text(numStr, nx, ny, {align:'center', renderingMode:'stroke'}); }catch(e){}
        pdf.text(numStr, nx, ny, {align:'center'});
      });
    }

    // ── Draw construction zones on PDF map ────────────────────────
    // Uses czPoints captured BEFORE map restore (same approach as finding markers)
    if(czPoints.length && !PDF_HIDE_CONSTR && constrMapImgData){
      const czIconH = Math.max(10, TS*3.5);            // mm  (halved)
      const czIconW = czIconH * constrMapAspect;        // mm
      czPoints.forEach(({cx, cy})=>{
        try{
          pdf.addImage(constrMapImgData, 'PNG',
            cx - czIconW/2, cy - czIconH/2, czIconW, czIconH);
        }catch(e){}
      });
    }

    showNotif('⏳ Step 4/4: Building details…', false, 0);
    // ── Legend overlaid on map — bottom-left, tight fit ───────────
    const LEG_H = 8.5;
    const LEG_INNER_PAD = 4;   // padding between items
    const LEG_EDGE = 2;        // padding at left and right edges
    const LEG_X = ML;
    const LEG_Y = LH - 4 - LEG_H;

    // Build legend items conditional on toggles
    const items = [];
    if(!PDF_HIDE_FINDINGS){
      items.push({color:'#FB923C', label:'1st Offense', shape:'cir'});
      items.push({color:'#EF4444', label:'Repeat',       shape:'cir'});
      if(!PDF_HIDE_RESOLVED){
        items.push({color:'#22C55E', label:'Resolved',   shape:'cir'});
      }
    }
    if(!PDF_HIDE_CONSTR && constrLegendImgData){
      items.push({color:null,      label:'Construction', shape:'excavator'});
    }

    function drawScaleBar(){
      // 1 km scale bar — bottom-right corner, away from the legend
      if(!isFinite(KM_MM) || KM_MM <= 0) return;
      const bx2 = LW - 6;            // right end
      const bx1 = bx2 - KM_MM;       // left end (1 km away)
      const by  = LH - 7;            // bar baseline
      // white plaque behind for legibility
      pdf.setFillColor(255,255,255);
      pdf.setDrawColor(180,188,200); pdf.setLineWidth(0.2);
      pdf.roundedRect(bx1-3, by-5, KM_MM+6, 8.5, 1, 1, 'FD');
      // bar with end ticks
      pdf.setDrawColor(28,35,51); pdf.setLineWidth(0.5);
      pdf.line(bx1, by, bx2, by);
      pdf.line(bx1, by-1.6, bx1, by+1.6);
      pdf.line(bx2, by-1.6, bx2, by+1.6);
      // halfway tick (500 m)
      pdf.setLineWidth(0.3);
      pdf.line((bx1+bx2)/2, by-1, (bx1+bx2)/2, by+1);
      pdf.setFontSize(5.5); pdf.setFont('helvetica','bold');
      pdf.setTextColor(28,35,51);
      pdf.text('1 km', (bx1+bx2)/2, by-2, {align:'center'});
    }

    function drawMapLegend(){
      drawScaleBar();
      if(items.length === 0) return;
      const ts = 2.8;
      // Measure content width exactly
      pdf.setFontSize(5); pdf.setFont('helvetica','normal');
      let contentW = 0;
      items.forEach((item, idx)=>{
        contentW += ts*2 + 1.5 + pdf.getTextWidth(item.label);
        if(idx < items.length-1) contentW += LEG_INNER_PAD;
      });
      const legendW = contentW + LEG_EDGE * 2;

      pdf.setFillColor(255,255,255); pdf.setDrawColor(210,215,225);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(LEG_X, LEG_Y, legendW, LEG_H, 1.5, 1.5, 'FD');

      let lx = LEG_X + LEG_EDGE + ts;
      items.forEach((item, idx)=>{
        pdf.setFontSize(5); pdf.setFont('helvetica','normal'); pdf.setTextColor(40,50,60);
        if(item.shape === 'excavator'){
          // Single excavator legend icon
          const cy = LEG_Y + LEG_H/2;
          const iconSize = ts*2.4;
          try{
            pdf.addImage(constrLegendImgData, 'PNG',
              lx-iconSize/2, cy-iconSize/2, iconSize, iconSize);
          }catch(e){}
        } else {
          const [r,g,b] = hexToRgb(item.color);
          pdf.setFillColor(r,g,b); pdf.setDrawColor(255,255,255); pdf.setLineWidth(0.3);
          pdf.circle(lx, LEG_Y+LEG_H/2, ts*0.85, 'FD');
        }
        const tw = pdf.getTextWidth(item.label);
        pdf.text(item.label, lx+ts+1.5, LEG_Y+(LEG_H/2)+1.3);
        lx += ts*2 + 1.5 + tw + (idx < items.length-1 ? LEG_INNER_PAD : 0);
      });
    }
    drawMapLegend();

    // ── PAGE 2: Compact overview map — tiny dot at GPS point, short
    //    ray, small numbered status circle. Same data, more map visible ──
    if(!PDF_HIDE_FINDINGS && markers.length){
      pdf.addPage([LW, LH], 'portrait');
      drawHeader(LW, `SITE FINDINGS REPORT — ${CLIENT}`,
        `Compact overview  ·  ${visibleFindings.length} location${visibleFindings.length!==1?'s':''}  ·  ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
      pdf.addImage(mapImg,'JPEG', 0, HDR, LW, mapAreaH);

      // Construction zones — same icons as page 1
      if(czPoints.length && !PDF_HIDE_CONSTR && constrMapImgData){
        const czIconH2 = Math.max(10, TS*3.5);  // halved
        const czIconW2 = czIconH2 * constrMapAspect;
        czPoints.forEach(({cx, cy})=>{
          try{
            pdf.addImage(constrMapImgData, 'PNG',
              cx - czIconW2/2, cy - czIconH2/2, czIconW2, czIconH2);
          }catch(e){}
        });
      }

      const CR2  = Math.max(1.6, CR * 0.6);    // small circle radius, mm
      const DOT2 = Math.max(0.6, dotR * 0.6);  // tiny dot at exact GPS point
      const RAY2 = CR2 * 2.6;                  // short ray length
      const placed2 = [];
      const ANG2 = [-60,-120,-30,-150,30,150,60,120,-90,90,0,180]
        .map(d=>d*Math.PI/180);

      // Pick a circle position per marker, avoiding other circles, dots,
      // page edges and the legend corner. Uses the ORIGINAL GPS point
      // (ax/ay), not the page-1 displaced position.
      markers.forEach(m=>{
        let best = null, bestScore = Infinity;
        for(const ang of ANG2){
          const cx = m.ax + RAY2*Math.cos(ang);
          const cy = m.ay + RAY2*Math.sin(ang);
          if(cx-CR2 < 1 || cx+CR2 > LW-1 || cy-CR2 < HDR+1 || cy+CR2 > LH-2) continue;
          let score = 0;
          if(cx-CR2 < 120 && cy+CR2 > LH-14) score += 4;   // legend keep-out
          if(cx+CR2 > LW-12-KM_MM && cy+CR2 > LH-13) score += 4; // scale-bar keep-out
          placed2.forEach(p=>{
            if(Math.hypot(cx-p.x, cy-p.y) < CR2*2 + 0.6) score += 3;
          });
          markers.forEach(o=>{
            if(o === m) return;
            if(Math.hypot(cx-o.ax, cy-o.ay) < CR2 + DOT2 + 0.5) score += 1;
          });
          if(score < bestScore){ bestScore = score; best = {x:cx, y:cy}; if(score === 0) break; }
        }
        if(!best){
          best = {x: Math.min(Math.max(m.ax + RAY2, 1+CR2), LW-1-CR2),
                  y: Math.min(Math.max(m.ay - RAY2, HDR+1+CR2), LH-2-CR2)};
        }
        m.miniPos = best;
        placed2.push(best);
      });

      // Pass A: rays (bottom layer)
      markers.forEach(m=>{
        const latest = m.loc.visits[0];
        const sc = latest ? (STAT_COLORS[latest.status]||'#FB923C') : '#FB923C';
        const [r,g,b] = hexToRgb(sc);
        pdf.setDrawColor(r,g,b); pdf.setLineWidth(0.3);
        pdf.line(m.ax, m.ay, m.miniPos.x, m.miniPos.y);
      });

      // Pass B: GPS dots + numbered circles (top layer)
      markers.forEach(m=>{
        const latest = m.loc.visits[0];
        const sc = latest ? (STAT_COLORS[latest.status]||'#FB923C') : '#FB923C';
        const [r,g,b] = hexToRgb(sc);

        pdf.setFillColor(r,g,b);
        pdf.setDrawColor(255,255,255); pdf.setLineWidth(0.25);
        pdf.circle(m.ax, m.ay, DOT2, 'FD');

        pdf.setFillColor(r,g,b);
        pdf.setDrawColor(255,255,255); pdf.setLineWidth(0.3);
        pdf.circle(m.miniPos.x, m.miniPos.y, CR2, 'FD');

        const numStr = stripZeros(m.loc.refNum);
        pdf.setFontSize(Math.max(4.5, CR2*2.2)); pdf.setFont('helvetica','bold');
        pdf.setTextColor(255,255,255);
        pdf.text(numStr, m.miniPos.x, m.miniPos.y+0.15, {align:'center', baseline:'middle'});
      });

      drawMapLegend();
    }

    // ── PAGES 2+: Portrait detail pages ───────────────────────────
    // Skip detail pages entirely when "Only Construction" is on
    const _renderDetailPages = !PDF_HIDE_FINDINGS;

    const CW = PW - ML - MR;
    let y = HDR + 4;

    function ensurePage(needed){
      if(y+needed > PH-MB){
        pdf.addPage([PW, PH],'portrait');
        pdf.setFillColor(255,255,255); pdf.rect(0,0,PW,HDR,'F');
        pdf.setDrawColor(220,225,236); pdf.line(0,HDR,PW,HDR);
        pdf.setTextColor(28,35,51); pdf.setFontSize(6); pdf.setFont('helvetica','bold');
        pdf.text(`SITE FINDINGS REPORT — ${CLIENT} (cont.)`, PW/2, 8.5, {align:'center'});
        y = HDR+4;
      }
    }

    const CAT_ORDER = (window._CATS||[]).map(c=>c.id);
    const ESCALATED_ORDER = ['SOTAICO','Client QA','Client FM','Client Subcontractor RS','Client Subcontractor OC','Client Subcontractor Other','Client Senior Management','Other',''];

    function lastEscalated(loc){
      for(const v of loc.visits){ if(v.escalated) return v.escalated; }
      return '';
    }

    let sorted;
    if(sortBy === 'category'){
      sorted = [...visibleFindings].sort((a,b)=>{
        const ca = CAT_ORDER.indexOf(a.visits[0]&&a.visits[0].cat||'');
        const cb = CAT_ORDER.indexOf(b.visits[0]&&b.visits[0].cat||'');
        if(ca !== cb) return (ca<0?99:ca) - (cb<0?99:cb);
        return (a.refNum||'999') > (b.refNum||'999') ? 1 : -1;
      });
    } else if(sortBy === 'escalated'){
      sorted = [...visibleFindings].sort((a,b)=>{
        const ea = ESCALATED_ORDER.indexOf(lastEscalated(a));
        const eb = ESCALATED_ORDER.indexOf(lastEscalated(b));
        const ra = ea < 0 ? 99 : ea, rb = eb < 0 ? 99 : eb;
        if(ra !== rb) return ra - rb;
        return (a.refNum||'999') > (b.refNum||'999') ? 1 : -1;
      });
    } else if(sortBy === 'quadrant'){
      // Canonical quadrant order: NW → NE → SW → SE
      const QUAD_ORDER = ['NW','NE','SW','SE'];
      // Build a lookup: parcel name → {quad, position in parcel list}
      const parcelList = window._PARCELS || [];
      const parcelIdx  = {};
      parcelList.forEach((p,i) => { parcelIdx[p.name] = i; });
      sorted = [...visibleFindings].sort((a,b) => {
        // Determine each finding's quad from its assigned parcel
        const pA = parcelList.find(p=>p.name===a.parcel);
        const pB = parcelList.find(p=>p.name===b.parcel);
        const qA = QUAD_ORDER.indexOf(pA ? pA.quad : '');
        const qB = QUAD_ORDER.indexOf(pB ? pB.quad : '');
        const qAi = qA < 0 ? 99 : qA;
        const qBi = qB < 0 ? 99 : qB;
        if(qAi !== qBi) return qAi - qBi;
        // Same quadrant — sort by parcel order within the parcel list
        const piA = parcelIdx[a.parcel] !== undefined ? parcelIdx[a.parcel] : 999;
        const piB = parcelIdx[b.parcel] !== undefined ? parcelIdx[b.parcel] : 999;
        if(piA !== piB) return piA - piB;
        // Same parcel — fall back to finding number
        return (a.refNum||'999') > (b.refNum||'999') ? 1 : -1;
      });
    } else {
      sorted = [...visibleFindings].sort((a,b)=>(a.refNum||'999')>(b.refNum||'999')?1:-1);
    }

    const sortLabel = sortBy==='category' ? 'Sorted by Category'
      : sortBy==='escalated' ? 'Sorted by Assigned/Escalated To'
      : sortBy==='quadrant'  ? 'Sorted by Quadrant & Parcel'
      : 'Sorted by Finding #';

    if(_renderDetailPages){
    pdf.addPage([PW, PH],'portrait');
    drawHeader(PW, `SITE FINDINGS REPORT — ${CLIENT}`,
      `Finding Details  ·  ${visibleFindings.length} location${visibleFindings.length!==1?'s':''}  ·  ${sortLabel}  ·  Prepared ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
    y = HDR+4;

    for(const loc of sorted){
      ensurePage(28);
      const latest = loc.visits[0];
      if(!latest) continue;
      const statColor = hexToRgb(STAT_COLORS[latest.status]||'#FB923C');
      const catLabel = CAT_LABELS[latest.cat]||latest.cat;
      const totalVisits = loc.visits.length;
      const repeats = loc.visits.filter(v=>v.status==='repeat').length;

      // Finding header bar — #ref, PARCEL and Label, all bold and equally prominent
      pdf.setFillColor(...statColor);
      pdf.rect(ML, y, CW, 7, 'F');
      pdf.setTextColor(255,255,255);
      pdf.setFontSize(8); pdf.setFont('helvetica','bold');
      const bandParts = [`#${stripZeros(loc.refNum||'?')}`];
      if(loc.parcel) bandParts.push(pdfText(loc.parcel));
      if(latest.label) bandParts.push(pdfText(latest.label));
      pdf.text(bandParts.join('  ·  '), ML+3, y+5);
      y += 8;

      // Summary line — status/visits/category/coords, all one row, one font
      pdf.setFillColor(245,247,250); pdf.rect(ML, y, CW, 7, 'F');
      pdf.setTextColor(60,70,90); pdf.setFontSize(6.5); pdf.setFont('helvetica','normal');
      const sumTxt = `${STAT_LABELS[latest.status]||'Open'}  |  ${totalVisits} visit${totalVisits>1?'s':''}  |  ${repeats} repeat${repeats!==1?'s':''}  |  CAT: ${pdfText(catLabel)}  |  Coords: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      pdf.text(sumTxt, ML+3, y+4.5);
      y += 9;

      for(const visit of loc.visits){
        const vColor = hexToRgb(STAT_COLORS[visit.status]||'#FB923C');
        const vCat = CAT_LABELS[visit.cat]||visit.cat;
        const photoCount = (visit.photos||[]).length;
        const noteLines = visit.notes ? pdf.splitTextToSize(pdfText(visit.notes), CW-12).length : 0;
        const photoRows = Math.ceil(photoCount/3); // conservative: ~3 portrait per row
        ensurePage(8 + noteLines*3.5 + 3 + 3.5); // reserve space for visit header + notes only; photos paginate per-row

        // Visit row — date + status + category
        pdf.setFillColor(250,251,253); pdf.rect(ML+3, y, CW-3, 6, 'F');
        pdf.setFillColor(...vColor); pdf.rect(ML+3, y, 2, 6, 'F');
        pdf.setTextColor(40,50,70); pdf.setFontSize(6.5); pdf.setFont('helvetica','bold');
        pdf.text(visit.date, ML+7, y+4.2);
        pdf.setFont('helvetica','normal');
        pdf.text(`${STAT_LABELS[visit.status]||''}  ·  ${pdfText(vCat)}`, ML+30, y+4.2);
        y += 7;

        // Assigned / Escalated To — always printed
        pdf.setFontSize(6); pdf.setFont('helvetica','normal');
        if(visit.escalated){
          pdf.setTextColor(90,50,160);
          pdf.text(`Assigned / Escalated to: ${pdfText(visit.escalated)}`, ML+6, y+3);
        } else {
          pdf.setTextColor(170,175,185);
          pdf.text('Assigned / Escalated to: —', ML+6, y+3);
        }
        pdf.setTextColor(80,90,100);
        y += 4;

        if(visit.notes){
          const lines = pdf.splitTextToSize(pdfText(visit.notes), CW-12);
          pdf.setFontSize(6); pdf.setTextColor(80,90,100);
          lines.forEach(l=>{ ensurePage(4); pdf.text(l, ML+6, y+3); y+=3.5; });
          y += 1;
        }

        if(photoCount>0){
          // ── Aspect-ratio-aware photo layout ──────────────────────
          // Each photo is rendered preserving its natural aspect ratio
          // within a fixed bounding box.  Portrait images (h>w) are
          // placed in a box MAX_H tall; landscape images (w>=h) are
          // placed in a box MAX_W wide.  Because portrait images are
          // narrower, more of them fit per row; landscape images are
          // wider so fewer fit per row.
          const MAX_W = 30, MAX_H = 40, gap = 3;
          // helper: decode a data-URI into a natural {w,h} via an Image element
          function getImgDims(dataUri){
            return new Promise(function(resolve){
              const img = new Image();
              img.onload = function(){ resolve({w:img.naturalWidth, h:img.naturalHeight}); };
              img.onerror = function(){ resolve({w:1, h:1}); };
              img.src = dataUri;
            });
          }
          // Resolve all photo dimensions, then render
          const dimPromises = visit.photos.map(p => getImgDims(p));
          const dims = await Promise.all(dimPromises);

          // Build rows: each photo has its own pW/pH; pack into rows
          // that fit within the column width CW-6.
          const rowItems = [];
          let curRow = [];
          let curRowW = 0;
          for(let pi=0;pi<visit.photos.length;pi++){
            const {w, h} = dims[pi];
            const ar = w / Math.max(h, 1);
            let itemW, itemH;
            if(ar >= 1){
              // landscape: fix width to MAX_W
              itemW = MAX_W;
              itemH = Math.min(MAX_H, Math.round(MAX_W / ar));
            } else {
              // portrait: fix height to MAX_H
              itemH = MAX_H;
              itemW = Math.min(MAX_W, Math.round(MAX_H * ar));
            }
            // does it fit on current row?
            const needed = curRow.length === 0 ? itemW : itemW + gap;
            if(curRow.length > 0 && curRowW + needed > CW - 6){
              rowItems.push(curRow);
              curRow = [];
              curRowW = 0;
            }
            curRow.push({pi, itemW, itemH, data: visit.photos[pi]});
            curRowW += (curRow.length === 1 ? itemW : itemW + gap);
          }
          if(curRow.length) rowItems.push(curRow);

          // Render rows
          for(const row of rowItems){
            const rowH = Math.max(...row.map(r => r.itemH));
            ensurePage(rowH + 4);
            let ppx = ML + 3;
            for(const item of row){
              try{
                pdf.addImage(item.data, 'JPEG', ppx, y, item.itemW, item.itemH);
                pdf.setDrawColor(200,210,220); pdf.setLineWidth(0.2);
                pdf.rect(ppx, y, item.itemW, item.itemH);
              }catch(e){}
              ppx += item.itemW + gap;
            }
            y += rowH + gap;
          }
          y += 1;
        }
        y += 2;
      }
      y += 5;
    }
    } // end if(_renderDetailPages)

    // ════════════════════════════════════════════════════════════════
    // RECAP / SUMMARY PAGE — totals by category, status, and region
    // ════════════════════════════════════════════════════════════════
    (function drawRecap(){
      // Each finding's "current" classification = its latest visit
      const recap = visibleFindings.map(loc=>{
        const latest = loc.visits[0] || {};
        const quad = (window._quadOfLoc ? window._quadOfLoc(loc) : null);
        const lastEsc = (loc.visits.find(v=>v.escalated)||{}).escalated || null;
        return {
          cat: latest.cat || 'other',
          status: latest.status || 'open',
          parcel: loc.parcel || 'Unassigned',
          quad: quad || 'Unassigned',
          escalated: lastEsc,
          repeats: loc.visits.filter(v=>v.status==='repeat').length,
          visits: loc.visits.length
        };
      });
      const total = recap.length;

      pdf.addPage([PW, PH],'portrait');
      drawHeader(PW, `SITE FINDINGS REPORT — ${CLIENT}`,
        `Recap & Totals  ·  ${total} location${total!==1?'s':''}  ·  Prepared ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
      y = HDR + 8;

      function sectionTitle(txt){
        ensurePage(12);
        pdf.setTextColor(28,35,51); pdf.setFontSize(10); pdf.setFont('helvetica','bold');
        pdf.text(txt, ML, y); y += 2;
        pdf.setDrawColor(45,138,78); pdf.setLineWidth(0.5); pdf.line(ML, y, ML+CW, y);
        y += 5;
      }

      // Generic 2-column table: [{label, count, color?}]
      function drawTable(rows, totalCount){
        const rowH = 6.2;
        const barMax = CW - 70;           // width available for the count bar
        const labelX = ML + 2;
        const countX = ML + CW - 2;       // right-aligned count
        const maxCount = Math.max(1, ...rows.map(r=>r.count));
        rows.forEach((r,i)=>{
          ensurePage(rowH+1);
          if(i % 2 === 0){ pdf.setFillColor(247,249,251); pdf.rect(ML, y-0.5, CW, rowH, 'F'); }
          // colour swatch
          if(r.color){
            const c = hexToRgb(r.color);
            pdf.setFillColor(...c); pdf.rect(ML+2, y+0.8, 3, 3, 'F');
          }
          const tx = r.color ? ML+7 : ML+2;
          pdf.setTextColor(40,50,70); pdf.setFontSize(8); pdf.setFont('helvetica','normal');
          pdf.text(pdfText(String(r.label)), tx, y+4);
          // bar
          const bw = (r.count/maxCount)*barMax;
          const bc = r.color ? hexToRgb(r.color) : [148,163,184];
          pdf.setFillColor(...bc);
          pdf.rect(ML + CW - 22 - barMax, y+1, bw, rowH-2.5, 'F');
          // count + pct
          const pct = totalCount ? Math.round(r.count/totalCount*100) : 0;
          pdf.setFont('helvetica','bold'); pdf.setTextColor(28,35,51);
          pdf.text(`${r.count}  (${pct}%)`, countX, y+4, {align:'right'});
          y += rowH;
        });
        // total row
        ensurePage(rowH+2);
        pdf.setDrawColor(200,208,220); pdf.setLineWidth(0.3); pdf.line(ML, y, ML+CW, y);
        y += 0.5;
        pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(28,35,51);
        pdf.text('Total', ML+2, y+4);
        pdf.text(String(totalCount), countX, y+4, {align:'right'});
        y += rowH + 6;
      }

      // ── 1) By Category ──────────────────────────────────────────
      sectionTitle('Totals by Category');
      {
        const order = (window._CATS||[]).map(c=>c.id);
        const colorOf = Object.fromEntries((window._CATS||[]).map(c=>[c.id,c.color]));
        const counts = {};
        recap.forEach(r=>{ counts[r.cat] = (counts[r.cat]||0)+1; });
        const rows = Object.keys(counts)
          .sort((a,b)=> (order.indexOf(a)) - (order.indexOf(b)))
          .map(id=>({ label: CAT_LABELS[id]||id, count: counts[id], color: colorOf[id] }));
        drawTable(rows, total);
      }

      // ── 2) By Status (1st offense / repeat / resolved) ──────────
      sectionTitle('Totals by Status');
      {
        const statOrder = ['open','repeat','resolved'];
        const counts = {};
        recap.forEach(r=>{ counts[r.status] = (counts[r.status]||0)+1; });
        const rows = statOrder.filter(s=>counts[s]).map(s=>({
          label: STAT_LABELS[s]||s, count: counts[s], color: STAT_COLORS[s]
        }));
        drawTable(rows, total);
        // extra note: total repeat visits across all findings
        const totalRepeatVisits = recap.reduce((s,r)=>s+r.repeats,0);
        ensurePage(6);
        pdf.setFont('helvetica','normal'); pdf.setFontSize(6.5); pdf.setTextColor(100,110,130);
        pdf.text(`Note: status reflects each location's most recent visit. Total repeat visits recorded across all locations: ${totalRepeatVisits}.`, ML+2, y);
        y += 8;
      }

      // ── 3) By Region (Parcel) ───────────────────────────────────
      sectionTitle('Totals by Region (Parcel)');
      {
        const quadName = window._QUADS || {};
        const quadOrder = window._QUAD_ORDER || ['NW','NE','SW','SE'];
        // group parcels under their quadrant
        const byQuad = {};
        recap.forEach(r=>{
          const q = r.quad || 'Unassigned';
          byQuad[q] = byQuad[q] || {};
          byQuad[q][r.parcel] = (byQuad[q][r.parcel]||0) + 1;
        });
        const quads = Object.keys(byQuad).sort((a,b)=>{
          const ia = quadOrder.indexOf(a), ib = quadOrder.indexOf(b);
          return (ia<0?99:ia) - (ib<0?99:ib);
        });
        quads.forEach(q=>{
          const parcels = byQuad[q];
          const quadTotal = Object.values(parcels).reduce((s,n)=>s+n,0);
          ensurePage(10);
          pdf.setFillColor(28,35,51); pdf.rect(ML, y, CW, 6, 'F');
          pdf.setTextColor(255,255,255); pdf.setFontSize(8); pdf.setFont('helvetica','bold');
          pdf.text(`${pdfText(quadName[q]||q)}`, ML+2, y+4);
          pdf.text(`${quadTotal} finding${quadTotal!==1?'s':''}`, ML+CW-2, y+4, {align:'right'});
          y += 8;
          const rows = Object.keys(parcels).sort((a,b)=>parcels[b]-parcels[a])
            .map(p=>({ label: p, count: parcels[p] }));
          drawTable(rows, quadTotal);
        });
      }

      // ── 4) By Assigned / Escalated To ──────────────────────────
      sectionTitle('Totals by Assigned / Escalated To');
      {
        const escOrder = ['SOTAICO','Client QA','Client FM','Client Subcontractor RS','Client Subcontractor OC','Client Subcontractor Other','Client Senior Management','Other'];
        const counts = {};
        let unassigned = 0;
        recap.forEach(r=>{
          if(r.escalated){ counts[r.escalated] = (counts[r.escalated]||0)+1; }
          else { unassigned++; }
        });
        const rows = escOrder
          .filter(e=>counts[e])
          .map(e=>({ label: e, count: counts[e] }));
        if(unassigned > 0) rows.push({ label: 'Not Assigned', count: unassigned });
        if(rows.length === 0){
          ensurePage(8);
          pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(120,130,150);
          pdf.text('No assignments recorded.', ML+2, y); y += 8;
        } else {
          drawTable(rows, total);
        }
      }
    })();

    // ── FINDING RECAP TABLE (per Excel template) ─────────────────
    // Columns: Finding # | Category | Assigned to | Date First Opened |
    //          # Repeats | Date Resolved | Date Reopened | Days Outstanding
    // Sort order matches the detail pages (sortBy variable already set above)
    (function drawRecapTable(){
      if(!_renderDetailPages) return;          // skip if "Only Constr." is on

      const today = new Date();
      today.setHours(0,0,0,0);

      // Helper: days between two date strings (YYYY-MM-DD)
      function daysBetween(d1str, d2){
        const d1 = new Date(d1str + 'T00:00:00');
        return Math.round((d2 - d1) / 86400000);
      }

      // Build one row per location (same sorted order as detail pages)
      const rows = sorted.map(loc => {
        const visitsChron = [...loc.visits].sort((a,b)=> a.date < b.date ? -1 : 1); // oldest first
        const latest     = loc.visits[0] || {};
        const catLabel   = CAT_LABELS[latest.cat] || latest.cat || '—';
        const lastEsc    = (loc.visits.find(v=>v.escalated)||{}).escalated || '—';
        const firstDate  = visitsChron[0]  ? visitsChron[0].date  : '';
        const repeats    = loc.visits.filter(v=>v.status==='repeat').length;

        // Resolved: most-recent visit that is "resolved"
        const resolvedVisit = loc.visits.find(v=>v.status==='resolved');
        const resolvedDate  = resolvedVisit ? resolvedVisit.date : '';

        // Reopened: any visit (open/repeat) that is NEWER than the most-recent resolved visit
        let reopenedDate = '';
        if(resolvedVisit){
          const reopenVisit = loc.visits.find(v=>
            v.status !== 'resolved' && v.date > resolvedVisit.date
          );
          reopenedDate = reopenVisit ? reopenVisit.date : '';
        }

        // Days outstanding:
        //   - If current status is resolved AND not reopened → first opened → resolved date
        //   - Otherwise (open, repeat, or resolved+reopened) → first opened → today
        let daysOut = '';
        if(firstDate){
          const isResolved = latest.status === 'resolved' && !reopenedDate;
          const endDate    = isResolved ? new Date(resolvedDate + 'T00:00:00') : today;
          daysOut = daysBetween(firstDate, endDate);
        }

        return {
          refNum: loc.refNum || '?',
          label: latest.label || '—',
          catLabel,
          parcel: loc.parcel || 'Unassigned',
          lastEsc,
          firstDate,
          repeats,
          resolvedDate,
          reopenedDate,
          daysOut,
          status: latest.status || 'open',
        };
      });

      // All-findings average: start from rows (already computed correctly), then
      // supplement with any resolved findings that were hidden by the toggle.
      // This guarantees the same computation logic and same data as the table rows.
      const _rowDays = rows.filter(r => r.daysOut !== '').map(r => r.daysOut);
      const _resolvedHiddenDays = PDF_HIDE_RESOLVED
        ? findings
            .filter(loc => { const lat = loc.visits[0]; return lat && lat.status === 'resolved'; })
            .map(loc => {
              const vc = [...loc.visits].sort((a,b)=> a.date < b.date ? -1 : 1);
              const fd = vc[0] ? vc[0].date : '';
              if(!fd) return null;
              const rv = loc.visits.find(v=>v.status==='resolved');
              if(!rv) return null;
              const rd = rv.date;
              const rv2 = loc.visits.find(v=>v.status!=='resolved' && v.date > rv.date);
              const rod = rv2 ? rv2.date : '';
              // Only count as truly resolved (not reopened)
              if(rod) return daysBetween(fd, today);
              return daysBetween(fd, new Date(rd+'T00:00:00'));
            }).filter(d => d !== null)
        : [];
      const _allDaysForAvg = [..._rowDays, ..._resolvedHiddenDays];
      const _avgAllDays = _allDaysForAvg.length > 0
        ? Math.round(_allDaysForAvg.reduce((s,d)=>s+d, 0) / _allDaysForAvg.length)
        : null;

      // ── Page setup ─────────────────────────────────────────────
      pdf.addPage([PW, PH], 'portrait');
      drawHeader(PW, `SITE FINDINGS REPORT — ${CLIENT}`,
        `Finding Recap  ·  ${rows.length} finding${rows.length!==1?'s':''}  ·  ${sortLabel}  ·  Prepared ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);

      // Section heading bar
      const CWT = PW - ML - MR;
      let yt = HDR + 6;
      pdf.setFillColor(28,35,51); pdf.rect(ML, yt, CWT, 6.5, 'F');
      pdf.setTextColor(255,255,255); pdf.setFontSize(7); pdf.setFont('helvetica','bold');
      pdf.text('FINDING RECAP TABLE', ML+3, yt+4.5);
      yt += 8;

      // ── Column definitions (widths must sum to CWT=182mm) ──────
      // Finding# | Label | Category | Parcel/Area | Assigned To | Date 1st | Repeats | Resolved | Reopened | Days
      const cols = [
        { label:'#',              w:9 },
        { label:'Label',          w:30 },
        { label:'Category',       w:22 },
        { label:'Parcel / Area',  w:22 },
        { label:'Assigned / Esc.',w:22 },
        { label:'First Opened',   w:17 },
        { label:'Repeats',        w:10 },
        { label:'Resolved',       w:17 },
        { label:'Reopened',       w:17 },
        { label:'Days Outstanding', w:16 },
      ];

      const ROW_H   = 5.8;
      const FONT_SZ = 5.8;

      // Draw column headers
      function drawColHeaders(yy){
        pdf.setFillColor(45,55,72); pdf.rect(ML, yy, CWT, ROW_H+0.5, 'F');
        pdf.setTextColor(255,255,255); pdf.setFontSize(FONT_SZ-0.5); pdf.setFont('helvetica','bold');
        let cx = ML;
        cols.forEach(c => {
          pdf.text(c.label, cx+1.5, yy+ROW_H-1.2);
          cx += c.w;
        });
        return yy + ROW_H + 0.5;
      }

      yt = drawColHeaders(yt);

      // Draw one data row
      function drawRow(row, idx, yy){
        const even = idx % 2 === 0;
        pdf.setFillColor(even ? 247 : 255, even ? 249 : 255, even ? 251 : 255);
        pdf.rect(ML, yy, CWT, ROW_H, 'F');

        // Status colour stripe on left
        const sc = STAT_COLORS[row.status] || '#FB923C';
        const [sr,sg,sb] = hexToRgb(sc);
        pdf.setFillColor(sr,sg,sb);
        pdf.rect(ML, yy, 1.5, ROW_H, 'F');

        pdf.setTextColor(40,50,70); pdf.setFontSize(FONT_SZ); pdf.setFont('helvetica','normal');
        const vals = [
          '#'+stripZeros(row.refNum),
          row.label,
          row.catLabel,
          row.parcel,
          row.lastEsc,
          row.firstDate   || '—',
          row.repeats > 0 ? String(row.repeats) : '0',
          row.resolvedDate || '—',
          row.reopenedDate || '—',
          row.daysOut !== '' ? String(row.daysOut)+'d' : '—',
        ];

        let cx = ML;
        vals.forEach((val, vi) => {
          const colW = cols[vi].w;
          // Right-align numeric columns (repeats, days)
          const rightAlign = vi === 6 || vi === 9;
          const txt = pdf.splitTextToSize(pdfText(val), colW - 3)[0] || '';
          if(rightAlign){
            pdf.text(txt, cx + colW - 2, yy + ROW_H - 1.4, {align:'right'});
          } else {
            pdf.text(txt, cx + 1.8, yy + ROW_H - 1.4);
          }
          cx += colW;
        });

        // Light grid line under row
        pdf.setDrawColor(220,228,240); pdf.setLineWidth(0.1);
        pdf.line(ML, yy+ROW_H, ML+CWT, yy+ROW_H);

        return yy + ROW_H;
      }

      // Vertical column dividers (drawn once per page as reference lines)
      function drawColDividers(yTop, yBot){
        pdf.setDrawColor(200,210,225); pdf.setLineWidth(0.15);
        let cx = ML;
        cols.forEach((c, i) => {
          cx += c.w;
          if(i < cols.length-1) pdf.line(cx, yTop, cx, yBot);
        });
      }

      // Render all rows with auto-page-break
      let rowIdx = 0;
      let pageTopY = yt;
      rows.forEach(row => {
        if(yt + ROW_H > PH - MB){
          drawColDividers(pageTopY, yt);
          pdf.addPage([PW, PH], 'portrait');
          pdf.setFillColor(255,255,255); pdf.rect(0,0,PW,HDR,'F');
          pdf.setDrawColor(220,225,236); pdf.line(0,HDR,PW,HDR);
          pdf.setTextColor(28,35,51); pdf.setFontSize(6); pdf.setFont('helvetica','bold');
          pdf.text(`SITE FINDINGS REPORT — ${CLIENT} (cont.)`, PW/2, 8.5, {align:'center'});
          yt = HDR + 4;
          pageTopY = yt;
          yt = drawColHeaders(yt);
        }
        yt = drawRow(row, rowIdx, yt);
        rowIdx++;
      });

      // Totals row
      if(yt + ROW_H + 1 > PH - MB){
        drawColDividers(pageTopY, yt);
        pdf.addPage([PW, PH], 'portrait');
        yt = HDR + 4;
        pageTopY = yt;
      }
      pdf.setDrawColor(45,55,72); pdf.setLineWidth(0.4);
      pdf.line(ML, yt, ML+CWT, yt);
      pdf.setFillColor(240,243,248); pdf.rect(ML, yt, CWT, ROW_H+0.5, 'F');
      pdf.setTextColor(28,35,51); pdf.setFontSize(FONT_SZ); pdf.setFont('helvetica','bold');
      // Average is always computed from ALL findings (unfiltered) so it remains
      // meaningful even when "Hide Resolved" is active in the main UI.
      const avgDays = _avgAllDays !== null ? String(_avgAllDays)+'d' : '—';
      const avgLabel = 'Avg. Days Outstanding (incl. resolved):';
      pdf.text(avgLabel, ML+2, yt+ROW_H-0.8);
      const daysColX = cols.slice(0,-1).reduce((s,c)=>s+c.w, ML);
      const daysColW = cols[cols.length-1].w;
      pdf.text(avgDays, daysColX+daysColW-2, yt+ROW_H-0.8, {align:'right'});
      yt += ROW_H + 1;

      drawColDividers(pageTopY, yt);

    })();

    const date = new Date().toISOString().slice(0,10);
    const cid = (window._CLIENT_CONFIG&&window._CLIENT_CONFIG.id)||'ElGouna';
    pdf.save(`PesTrack Pest Pressure Sources - El Gouna ${date}.pdf`);
    showNotif('✅ Report saved');
  }catch(err){
    console.error('PDF error:',err);
    showNotif('❌ '+(err.message||err), true, 8000);
    // Restore markers if error during capture
    document.querySelectorAll('.fi-marker-wrap').forEach(el=>el.style.visibility='');
    document.querySelectorAll('.cz-divicon').forEach(el=>el.style.visibility='');
    const _lce = document.querySelector('.leaflet-control-layers');
    if(_lce) _lce.style.display='';
  }
}

window.exportFindingsPDF = exportFindingsPDF;
