/* ═══════════════════════════════════════════════════════════════════════
   PesTrack — Report module
   Extracted from desktop prototype V6.05.10, 15 September 2026.

   Contains all four reports, complete and working:
     · PDF Report            openPdfSortModal() → launchPdfWithSort()
     · Recap Report          openRecapSortModal() → launchRecapWithSort()
     · Activity Report       openActivityModal() → launchActivityReport()
     · Overdue Report        openOverdueModal() → launchOverdueReport()
     · Single-finding print  printFindingHistory(locId)

   ── WHAT THIS MODULE NEEDS FROM THE HOST PAGE ────────────────────────
   It reads data and draws. It does NOT read or write storage, and makes
   no API calls. Provide the following and it runs unchanged:

   DATA
     window._ptFindings      Array of findings. Shape (identical to the
                             production JSON export, which was used to test
                             every figure in the specification):
       { locId, refNum, parcel, lat, lng,
         visits: [ { id, date, cat, status, label, notes, escalated,
                     photos: [dataURI, …],
                     createdByName, createdById,
                     engineerName, engineerId, updatedAt } ] }
       visits must be ordered NEWEST FIRST.
     window._ptConstrZones   Array of { czId, lat, lng }. May be [].

   CONFIG
     window._CATS            [{ id, label, color }, …] category list
     window._CLIENT_CONFIG   { id, name }  e.g. { id:'ElGouna', name:'El Gouna' }
     window._quadOfLoc       fn(loc) → quadrant name. Legacy; quadrants no
                             longer appear in any report. May return null.
     window._visitUser       fn(visit) → string. Resolves who recorded a
                             visit (createdByName in production data).

   VIEW STATE  (the dashboard's existing toggles; false is fine)
     window._hideConstr, window._hideFindings, window._hideResolved

   PAGE OBJECTS
     map                     the Leaflet map instance (used to capture the
                             map image and to project marker coordinates)
     #map                    the map container element
     showNotif(msg, isError, durationMs)   existing notification helper

   ASSETS
     LOGO_PESTRACK, CONSTR_MAP_ICON_DATA, CONSTR_LEGEND_ICON_DATA
     — see report-assets.js

   MARKUP
     The four modals in report-modals.html, and buttons wired to the
     open*() functions above.

   LIBRARIES
     jsPDF 2.5.1 and html2canvas 1.4.1 (the module loads them from CDN if
     they are absent).

   ── TWO THINGS NOT TO CHANGE WITHOUT READING THE SPEC ────────────────
   1. Arabic notes are rendered by the browser and embedded as images,
      then BATCHED into a single html2canvas pass and sliced apart.
      Rendering them one at a time takes the report from 2.8s to 61s.
   2. The "By Assigned / Escalated To" sort uses a fixed ordering array,
      not alphabetical order. Renaming or adding an escalation option
      means updating that array too.
   ═══════════════════════════════════════════════════════════════════════ */

// ── FINDINGS PDF REPORT ───────────────────────────────────────────────
function openPdfSortModal(){
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to export', true, 3000); return;
  }
  document.getElementById('m-pdf-sort').style.display = 'flex';
}
window.openPdfSortModal = openPdfSortModal;

// Show/hide the date boxes, and seed them with a sensible 6-month window.
function togglePdfHistRange(){
  const on = document.getElementById('pdf-fullhist').checked;
  const box = document.getElementById('pdf-hist-range');
  box.style.display = on ? 'flex' : 'none';
  document.getElementById('pdf-hist-err').style.display = 'none';
  if(on){
    const from = document.getElementById('pdf-hist-from');
    const to   = document.getElementById('pdf-hist-to');
    if(!to.value || !from.value){
      const today = new Date();
      const back  = new Date(today); back.setMonth(back.getMonth() - 6); back.setDate(back.getDate() + 1);
      to.value   = today.toISOString().slice(0,10);
      from.value = back.toISOString().slice(0,10);
    }
  }
}
window.togglePdfHistRange = togglePdfHistRange;

// Latest permitted To date for a given From: six calendar months minus a day.
// setMonth alone overflows on month-ends (31 Aug + 6 months becomes 3 Mar, not
// 28 Feb), which quietly allowed ranges slightly over six months, so the day of
// month is clamped to the length of the target month first.
function _sixMonthCap(from){
  const d = new Date(from + 'T00:00:00');
  const day = d.getDate();
  const c = new Date(d.getFullYear(), d.getMonth(), 1);
  c.setMonth(c.getMonth() + 6);
  const lastDayOfTarget = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  c.setDate(Math.min(day, lastDayOfTarget));
  c.setDate(c.getDate() - 1);
  const pad = n => String(n).padStart(2,'0');
  return `${c.getFullYear()}-${pad(c.getMonth()+1)}-${pad(c.getDate())}`;
}

// Inclusive span in days between two YYYY-MM-DD strings.
function _daySpan(a, b){
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000) + 1;
}

function launchPdfWithSort(){
  const sel = document.querySelector('input[name="pdf-sort"]:checked');
  const sortBy = sel ? sel.value : 'number';
  const thumbEl = document.getElementById('pdf-thumbmap');
  const withThumbMap = !!(thumbEl && thumbEl.checked);

  const opts = {};
  const histOn = document.getElementById('pdf-fullhist');
  if(histOn && histOn.checked){
    const from = (document.getElementById('pdf-hist-from').value || '').trim();
    const to   = (document.getElementById('pdf-hist-to').value   || '').trim();
    const err  = document.getElementById('pdf-hist-err');
    function fail(msg){ err.textContent = msg; err.style.display = 'block'; }
    if(!from || !to)            return fail('Enter both a From and a To date.');
    if(to < from)               return fail('The To date is earlier than the From date.');
    const capStr = _sixMonthCap(from);
    if(to > capStr){
      return fail(`That range is ${_daySpan(from,to)} days. The maximum is 6 months — with a From of ${from}, the latest To date is ${capStr}.`);
    }
    err.style.display = 'none';
    opts.histFrom = from; opts.histTo = to;
  }

  document.getElementById('m-pdf-sort').style.display = 'none';
  exportFindingsPDF(sortBy, false, withThumbMap, opts);
}
window.launchPdfWithSort = launchPdfWithSort;

// ── Full history for ONE finding (button on the map popup) ────────────
function printFindingHistory(locId){
  const loc = (window._ptFindings||[]).find(f => f.locId === locId);
  if(!loc){ showNotif('⚠️ Finding not found', true, 3000); return; }
  const n = (loc.visits||[]).length;
  showNotif(`⏳ Building full history — ${n} visit${n!==1?'s':''}…`, false, 0);
  exportFindingsPDF('number', false, false, {onlyLocId: locId});
}
window.printFindingHistory = printFindingHistory;

// ── Recap Report: recap & totals + finding recap table only ──────────
function openRecapSortModal(){
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to export', true, 3000); return;
  }
  document.getElementById('m-recap-sort').style.display = 'flex';
}
window.openRecapSortModal = openRecapSortModal;

function launchRecapWithSort(){
  const sel = document.querySelector('input[name="recap-sort"]:checked');
  const sortBy = sel ? sel.value : 'number';
  document.getElementById('m-recap-sort').style.display = 'none';
  exportFindingsPDF(sortBy, true);   // recapOnly = true
}
window.launchRecapWithSort = launchRecapWithSort;

async function exportFindingsPDF(sortBy='number', recapOnly=false, withThumbMap=false, opts={}){
  // v6.05.9 opts:
  //   histFrom / histTo — 'YYYY-MM-DD'. Visits in this window print in FULL
  //     (description + photos), the way the whole report worked before 6.05.3.
  //     Capped at 6 months by the menu, because that cap is what keeps the
  //     report from growing back to 112 pages.
  //   onlyLocId — print one finding, entire history in full, no recap sections.
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to export', true, 3000); return;
  }
  showNotif('⏳ Initialising…', false, 0);

  // Yield to let UI update, then run async
  await new Promise(r=>setTimeout(r,50));

  if(typeof window.prefetchPhotosForPdf === 'function'){
    showNotif('⏳ Loading photos…', false, 0);
    await window.prefetchPhotosForPdf();
  }
  if(typeof window.ensureFindingsPhotosDataUris === 'function'){
    await window.ensureFindingsPhotosDataUris();
  }

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
  if(!window.html2canvas){   // needed for the map pages and for Arabic note rendering
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
      // Remove only emojis and special symbols, but keep Arabic and other languages
      return str.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu,'').trim();
    }
    
    // ── Detect if text contains Arabic characters ──
    function hasArabic(text){
      if(!text) return false;
      return /[\u0600-\u06FF\u0750-\u077F]/.test(text);
    }

    // ── Load & register an Arabic-capable font (Noto Naskh Arabic) ──
    // jsPDF's built-in fonts (helvetica etc.) have NO Arabic glyphs, which
    // is why Arabic renders garbled. We fetch a real TTF once and embed it.
    let arabicFontReady = false;
    async function loadArabicFont(){
      if(arabicFontReady) return true;
      try{
        const url = 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf';
        const resp = await fetch(url);
        if(!resp.ok) throw new Error('Font fetch failed: '+resp.status);
        const buf = await resp.arrayBuffer();
        // Convert ArrayBuffer → base64 in chunks (avoids call-stack limits)
        const bytes = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 0x8000;
        for(let i=0; i<bytes.length; i+=CHUNK){
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i+CHUNK));
        }
        const b64 = btoa(binary);
        pdf.addFileToVFS('NotoNaskhArabic-Regular.ttf', b64);
        pdf.addFont('NotoNaskhArabic-Regular.ttf', 'NotoNaskhArabic', 'normal');
        arabicFontReady = true;
        return true;
      }catch(e){
        console.warn('Arabic font load failed — Arabic text may not render:', e);
        return false;
      }
    }

    // ── Set appropriate font based on text content ──
    function setFontForText(text, fontSize, weight='normal'){
      if(hasArabic(text) && arabicFontReady){
        // Embedded font has one weight; jsPDF handles Arabic letter shaping
        pdf.setFont('NotoNaskhArabic', 'normal');
      } else {
        pdf.setFont('helvetica', weight);
      }
      pdf.setFontSize(fontSize);
    }

    // ── Render Arabic/mixed-language text via the browser into an image ──
    // jsPDF's bidi handling drops/mangles Latin text mixed with Arabic.
    // Browsers do bidi perfectly, so we render such notes in a hidden div
    // and snapshot it with html2canvas (already loaded for the map pages).
    async function renderNotesImage(text, widthMM, opts){
      try{
        const _o = opts || {};
        const _fontMM = _o.fontMM || 2.1;      // text height on the page
        const _scale  = _o.scale  || 2;        // oversampling for crispness
        const _jpeg   = !!_o.jpeg;             // JPEG is far lighter than PNG for text
        const pxPerMM = 6;
        const wPx = Math.round(widthMM * pxPerMM);
        const div = document.createElement('div');
        div.setAttribute('dir','auto');
        div.style.cssText = 'position:fixed;left:-99999px;top:0;background:#ffffff;color:rgb(80,90,100);'
          + `width:${wPx}px;font-family:Arial,Tahoma,sans-serif;font-size:${Math.round(_fontMM*pxPerMM)}px;line-height:1.45;`
          + 'unicode-bidi:plaintext;white-space:pre-wrap;word-wrap:break-word;padding:0;margin:0;';
        div.textContent = text;
        document.body.appendChild(div);
        const canvas = await html2canvas(div, {scale:_scale, backgroundColor:'#ffffff', logging:false});
        document.body.removeChild(div);
        const hMM = (canvas.height / canvas.width) * widthMM;
        return {data: _jpeg ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png'),
                fmt: _jpeg ? 'JPEG' : 'PNG', wMM: widthMM, hMM};
      }catch(e){ console.warn('Notes image render failed, falling back to font:', e); return null; }
    }
    
    // ── Batched note rendering (v6.05.6) ────────────────────────────
    // html2canvas clones the ENTIRE document on every call, so rendering one
    // note at a time cost ~300ms each — about 40 seconds across a full El Gouna
    // report. Every Arabic note in the report is instead laid out in a single
    // hidden container, rendered in ONE html2canvas pass, and then sliced apart
    // using each child's offsetTop/offsetHeight. Same output, ~1 second.
    const _noteQueue  = [];        // {key, text, widthMM, fontMM}
    const _noteImages = {};        // key -> {data, fmt, wMM, hMM}
    function queueNote(key, text, widthMM, fontMM){
      _noteQueue.push({key, text, widthMM, fontMM: fontMM || 2.1});
    }
    async function flushNoteQueue(){
      if(!_noteQueue.length) return;
      const pxPerMM = 6, SCALE = 1.5, GAP = 10;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-99999px;top:0;background:#ffffff;padding:0;margin:0;';
      const kids = _noteQueue.map(n=>{
        const d = document.createElement('div');
        d.setAttribute('dir','auto');
        d.style.cssText = `background:#ffffff;color:rgb(80,90,100);`
          + `width:${Math.round(n.widthMM*pxPerMM)}px;`
          + `font-family:Arial,Tahoma,sans-serif;font-size:${Math.round(n.fontMM*pxPerMM)}px;`
          + `line-height:1.45;unicode-bidi:plaintext;white-space:pre-wrap;`
          + `word-wrap:break-word;padding:0;margin:0 0 ${GAP}px 0;`;
        d.textContent = n.text;
        host.appendChild(d);
        return d;
      });
      document.body.appendChild(host);
      try{
        const canvas = await html2canvas(host, {scale:SCALE, backgroundColor:'#ffffff', logging:false});
        _noteQueue.forEach((n,i)=>{
          const el = kids[i];
          const sy = Math.round(el.offsetTop * SCALE);
          const sw = Math.round(el.offsetWidth * SCALE);
          const sh = Math.round(el.offsetHeight * SCALE);
          if(sw <= 0 || sh <= 0) return;
          const c = document.createElement('canvas');
          c.width = sw; c.height = sh;
          c.getContext('2d').drawImage(canvas, 0, sy, sw, sh, 0, 0, sw, sh);
          _noteImages[n.key] = { data: c.toDataURL('image/jpeg', 0.85), fmt: 'JPEG',
                                 wMM: n.widthMM, hMM: (sh / SCALE) / pxPerMM };
        });
      }catch(e){ console.warn('Batched note render failed, falling back per-note:', e); }
      document.body.removeChild(host);
      _noteQueue.length = 0;
    }

    function stripZeros(ref){ return ref ? String(parseInt(ref,10)||ref) : '?'; }

    // ── Preload Arabic font only if any finding text needs it ──
    const anyArabic = (window._ptFindings||[]).some(loc =>
      hasArabic(loc.label) ||
      (loc.visits||[]).some(v => hasArabic(v.notes) || hasArabic(v.escalated) || hasArabic(v.label))
    );
    if(anyArabic){
      showNotif('⏳ Loading Arabic font…', false, 0);
      await loadArabicFont();
    }

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

    function drawCategoryHeader(catName){
      // Draw a prominent category header when sorting by category
      pdf.setFillColor(28,35,51); // Black/Dark
      pdf.rect(ML, y, CW, 10, 'F');
      pdf.setTextColor(255,255,255);
      pdf.setFontSize(11);
      pdf.setFont('helvetica','bold');
      pdf.text(pdfText(catName), ML + CW/2, y + 6.5, {align:'center'});
      y += 12;
    }

    // ── PAGE 1: Portrait map — resize map to A4 portrait ratio first ──
    const mapEl = document.getElementById('map');
    const mapPxW = mapEl.offsetWidth;

    // Target height for A4 portrait ratio (no bottom margin — legend overlays map)
    const mapAreaH = LH - HDR;          // 285mm (portrait)
    const a4ratio  = LW / mapAreaH;     // 210/285 ≈ 0.74 (tall)
    const targetPxH = Math.round(mapPxW / a4ratio);
    const origStyle = mapEl.style.height;

    showNotif(recapOnly ? '⏳ Building recap…' : '⏳ Step 2/4: Capturing map…', false, 0);

    // Snapshot toggle state at PDF generation time (needed now to know what to zoom to)
    const findings = window._ptFindings;
    const PDF_HIDE_CONSTR    = !!window._hideConstr;
    const PDF_HIDE_FINDINGS  = !!window._hideFindings;
    const PDF_HIDE_RESOLVED  = !!window._hideResolved;
    // Filter findings by hide-resolved toggle for marker generation, counts, and detail pages
    const _baseFindings = opts.onlyLocId
      ? findings.filter(loc => loc.locId === opts.onlyLocId)
      : findings;
    // A single-finding report ignores Hide Resolved — you asked for that finding.
    const visibleFindings = (PDF_HIDE_RESOLVED && !opts.onlyLocId)
      ? _baseFindings.filter(loc => {
          const latest = loc.visits && loc.visits[0];
          return !(latest && latest.status === 'resolved');
        })
      : _baseFindings;

    {   // v6.05.7: the map page is now produced for the Recap Report too
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

    // ── Marker sizing ─────────────────────────────────────────────
    // v6.05.3: the photo-thumbnail map page was removed. With 100+ findings
    // the thumbnails overlapped into an unreadable collage and added many
    // megabytes and several pages to the report. Only the numbered-marker
    // map is produced now, and it is page 1.
    // Scale marker size with the zoom the map was CAPTURED at
    const zoom = captureZoom;
    const TS = Math.max(2.2, Math.min(5.0, 2.2 + (zoom - 14) * 0.45)); // mm half-width
    const dotR = Math.max(1.0, TS * 0.38);
    const CR  = Math.max(2.4, TS*1.1);    // status circle radius, mm


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
    // ── Numbered status markers on the map (page 1) ──
    if(!PDF_HIDE_FINDINGS && markers.length){
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
    }

    drawMapLegend();

    // ── OPTIONAL EXTRA PAGE: photo thumbnail map ────────────────────
    // v6.05.7: restored as an OPTION (checkbox in the PDF Report menu). It was
    // removed in 6.05.3 because at 100+ findings the thumbnails overlap into an
    // unreadable collage — but on smaller sites, or a filtered selection, it is
    // the most informative page in the report. Off by default; the clean
    // numbered map above stays page 1 either way.
    if(withThumbMap && !PDF_HIDE_FINDINGS && markers.length){
      showNotif('⏳ Building photo thumbnail map…', false, 0);
      pdf.addPage([LW, LH], 'portrait');
      drawHeader(LW, `SITE FINDINGS REPORT — ${CLIENT}`,
        `Photo map  ·  ${visibleFindings.length} location${visibleFindings.length!==1?'s':''}  ·  ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
      pdf.addImage(mapImg,'JPEG', 0, HDR, LW, mapAreaH);

      if(czPoints.length && !PDF_HIDE_CONSTR && constrMapImgData){
        const czIconH3 = Math.max(10, TS*3.5);
        const czIconW3 = czIconH3 * constrMapAspect;
        czPoints.forEach(({cx, cy})=>{
          try{ pdf.addImage(constrMapImgData, 'PNG',
                 cx - czIconW3/2, cy - czIconH3/2, czIconW3, czIconH3); }catch(e){}
        });
      }

      // Cluster spacing constants — these lived with the marker-sizing block
      // before 6.05.3 and are only needed by this optional page.
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

      drawMapLegend();
    }

    } // end map pages

    // ── PAGES 2+: Portrait detail pages ───────────────────────────
    // Skip detail pages entirely when "Only Construction" is on, or for a recap-only report
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
    const ESCALATED_ORDER = ['SOTAICO','Client Super','Client FM','Client Subcontractor RS','Client Subcontractor OC','Client Subcontractor Other','Client Senior Management','Client Other','Other',''];

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
        // Secondary sort by parcel
        const pa = (a.parcel||'Unassigned').toLowerCase();
        const pb = (b.parcel||'Unassigned').toLowerCase();
        if(pa !== pb) return pa.localeCompare(pb);
        return (a.refNum||'999') > (b.refNum||'999') ? 1 : -1;
      });
    } else if(sortBy === 'escalated'){
      sorted = [...visibleFindings].sort((a,b)=>{
        const ea = ESCALATED_ORDER.indexOf(lastEscalated(a));
        const eb = ESCALATED_ORDER.indexOf(lastEscalated(b));
        const ra = ea < 0 ? 99 : ea, rb = eb < 0 ? 99 : eb;
        if(ra !== rb) return ra - rb;
        // Secondary sort by parcel
        const pa = (a.parcel||'Unassigned').toLowerCase();
        const pb = (b.parcel||'Unassigned').toLowerCase();
        if(pa !== pb) return pa.localeCompare(pb);
        return (a.refNum||'999') > (b.refNum||'999') ? 1 : -1;
      });
    } else if(sortBy === 'quadrant'){
      // "By Parcel": alphabetical by parcel/region, then by finding number
      // within each parcel. NO quadrant grouping. (The radio value is kept as
      // 'quadrant' to reuse the existing wiring.)
      sorted = [...visibleFindings].sort((a,b) => {
        const pa = (a.parcel||'Unassigned');
        const pb = (b.parcel||'Unassigned');
        const pc = pa.localeCompare(pb, undefined, {sensitivity:'base'});
        if(pc !== 0) return pc;
        // Within a parcel: by finding number (numeric-aware so 2 < 10)
        return String(a.refNum||'').localeCompare(String(b.refNum||''), undefined, {numeric:true});
      });
    } else {
      sorted = [...visibleFindings].sort((a,b)=>(a.refNum||'999')>(b.refNum||'999')?1:-1);
    }

    const sortLabel = sortBy==='category' ? 'Sorted by Category'
      : sortBy==='escalated' ? 'Sorted by Assigned/Escalated To'
      : sortBy==='quadrant'  ? 'Sorted by Parcel'
      : 'Sorted by Finding #';

    // v6.05.3: detail pages are now DEFINED here but CALLED after the recap
    // sections, so the report reads: map → recap & totals → finding recap
    // table → per-finding details.
    async function drawDetailPages(){
    pdf.addPage([PW, PH],'portrait');
    drawHeader(PW, `SITE FINDINGS REPORT — ${CLIENT}`,
      `${opts.onlyLocId ? 'Full history — every visit in full'
         : (opts.histFrom && opts.histTo) ? `Full detail for visits ${opts.histFrom} to ${opts.histTo}`
         : 'Finding Details (current status in full, history in brief)'}  ·  ${visibleFindings.length} location${visibleFindings.length!==1?'s':''}  ·  ${sortLabel}  ·  Prepared ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
    y = HDR+4;

    // ── Which visits print in FULL? ────────────────────────────────
    // Before 6.05.3 every visit did. Now the current status always does, plus
    // anything the caller asks for: a date window, or a single-finding report.
    const HIST_FROM = opts.histFrom || null;
    const HIST_TO   = opts.histTo   || null;
    const ONLY_LOC  = opts.onlyLocId || null;
    function isFullVisit(vi, v){
      if(ONLY_LOC) return true;                    // one finding: everything
      if(vi === 0) return true;                    // current status, always
      if(HIST_FROM && HIST_TO && v && v.date && v.date >= HIST_FROM && v.date <= HIST_TO) return true;
      return false;
    }

    // Queue every Arabic note in the report and render them in one pass
    // BEFORE drawing begins (see flushNoteQueue above).
    for(const _loc of sorted){
      (_loc.visits||[]).forEach((_v, _vi)=>{
        const _raw = pdfText(_v.notes||'');
        if(!_raw || !hasArabic(_raw)) return;
        const _key = (_loc.locId||'?') + '#' + _vi;
        if(isFullVisit(_vi, _v)) queueNote(_key, _raw, CW-12, 2.1);
        else                     queueNote(_key, _raw.replace(/\s+/g,' ').trim(), CW-12, 1.97);
      });
    }
    await flushNoteQueue();

    let currentCat = null;
    let currentEscalated = null;
    let currentParcel = null;
    for(const loc of sorted){
      const latest = loc.visits[0];
      if(!latest) continue;
      const locCat = latest.cat || 'other';
      const locEscalated = lastEscalated(loc);
      const locParcel = loc.parcel || 'Unassigned';

      // If category changed and we're sorting by category, draw category header
      if(sortBy === 'category' && locCat !== currentCat){
        drawCategoryHeader(CAT_LABELS[locCat] || locCat);
        currentCat = locCat;
      }

      // If escalated changed and we're sorting by escalated, draw escalated header
      if(sortBy === 'escalated' && locEscalated !== currentEscalated){
        drawCategoryHeader(locEscalated || 'Not Assigned');
        currentEscalated = locEscalated;
      }

      // If parcel changed and we're sorting by parcel, draw a parcel header
      if(sortBy === 'quadrant' && locParcel !== currentParcel){
        drawCategoryHeader(locParcel);
        currentParcel = locParcel;
      }
      ensurePage(28);
      const statColor = hexToRgb(STAT_COLORS[latest.status]||'#FB923C');
      const catLabel = CAT_LABELS[latest.cat]||latest.cat;
      const totalVisits = loc.visits.length;
      const repeats = loc.visits.filter(v=>v.status==='repeat').length;

      // Finding header bar — #ref, PARCEL and Label, all bold and equally prominent
      pdf.setFillColor(...statColor);
      pdf.rect(ML, y, CW, 7, 'F');
      pdf.setTextColor(255,255,255);
      const bandParts = [`#${stripZeros(loc.refNum||'?')}`];
      if(loc.parcel) bandParts.push(pdfText(loc.parcel));
      if(latest.label) bandParts.push(pdfText(latest.label));
      const bandTxt = bandParts.join('  ·  ');
      setFontForText(bandTxt, 8, 'bold');
      pdf.text(bandTxt, ML+3, y+5);
      y += 8;

      // Summary line — status/visits/category/coords, all one row, one font
      pdf.setFillColor(245,247,250); pdf.rect(ML, y, CW, 7, 'F');
      pdf.setTextColor(60,70,90);
      const sumTxt = `${STAT_LABELS[latest.status]||'Open'}  |  ${totalVisits} visit${totalVisits>1?'s':''}  |  ${repeats} repeat${repeats!==1?'s':''}  |  CAT: ${pdfText(catLabel)}  |  Coords: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      setFontForText(sumTxt, 6.5, 'normal');
      pdf.text(sumTxt, ML+3, y+4.5);
      y += 9;

      // ── CURRENT STATUS — the latest visit only, in full ────────────
      // v6.05.3: previously every visit was printed in full, photos
      // included, which is what pushed the report past 100 pages. Only the
      // most recent visit now gets the full treatment (description +
      // photos); earlier occurrences are condensed to one line each in the
      // history block that follows.
      for(let _vi=0; _vi<loc.visits.length; _vi++){
        const visit = loc.visits[_vi];
        if(!isFullVisit(_vi, visit)) continue;   // handled by the compact block below
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
        const catText = pdfText(vCat);
        setFontForText(catText, 6.5, 'normal');
        pdf.text(`${STAT_LABELS[visit.status]||''}  ·  ${catText}`, ML+30, y+4.2);
        y += 7;

        // Assigned / Escalated To — always printed
        pdf.setFontSize(6); 
        if(visit.escalated){
          pdf.setTextColor(90,50,160);
          const escalatedText = pdfText(visit.escalated);
          setFontForText(escalatedText, 6, 'normal');
          pdf.text(`Assigned / Escalated to: ${escalatedText}`, ML+6, y+3);
        } else {
          pdf.setFont('helvetica','normal');
          pdf.setTextColor(170,175,185);
          pdf.text('Assigned / Escalated to: —', ML+6, y+3);
        }
        pdf.setTextColor(80,90,100);
        y += 4;

        if(visit.notes){
          const cleanNotes = pdfText(visit.notes);
          if(hasArabic(cleanNotes)){
            // Arabic or mixed text: browser renders bidi perfectly → embed as image
            const img = _noteImages[(loc.locId||'?')+'#'+_vi] || await renderNotesImage(cleanNotes, CW-12);
            if(img){
              ensurePage(Math.min(img.hMM, 240) + 2);
              pdf.addImage(img.data, img.fmt||'PNG', ML+6, y+1, img.wMM, img.hMM);
              y += img.hMM + 2;
            } else {
              // Fallback: embedded Arabic font (pure Arabic renders fine)
              setFontForText(cleanNotes, 6, 'normal');
              const lines = pdf.splitTextToSize(cleanNotes, CW-12);
              pdf.setTextColor(80,90,100);
              lines.forEach(l=>{ ensurePage(4.5); pdf.text(l, ML+CW-6, y+3, {align:'right'}); y+=4; });
              y += 1;
            }
          } else {
            // English-only: original text path, unchanged
            pdf.setFont('helvetica','normal'); pdf.setFontSize(6);
            const lines = pdf.splitTextToSize(cleanNotes, CW-12);
            pdf.setTextColor(80,90,100);
            lines.forEach(l=>{ ensurePage(4); pdf.text(l, ML+6, y+3); y+=3.5; });
            y += 1;
          }
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

      // ── PRIOR OCCURRENCES — one compact line each, NO photos ────────
      // v6.05.3: history is what the reader needs to know happened, not
      // re-see. Each earlier visit gets a single line: date, status,
      // category, who it was assigned to, photo count, and as much of the
      // observation as fits on the line. Photos are deliberately omitted —
      // they are the bulk of the old report's page count and file size.
      const _compact = [];
      for(let ci=0; ci<loc.visits.length; ci++){
        if(!isFullVisit(ci, loc.visits[ci])) _compact.push(ci);
      }
      if(_compact.length){
        const nPrior = _compact.length;
        ensurePage(10);
        pdf.setFont('helvetica','bold'); pdf.setFontSize(6); pdf.setTextColor(110,120,140);
        pdf.text(`Previous occurrences (${nPrior}) — summary only, photos in dashboard`, ML+6, y+3);
        y += 5;
        // v6.05.6: the observation now WRAPS onto as many lines as it needs
        // instead of being truncated, and the recorder's name is not shown in
        // this report. Arabic notes are handled properly: pure Arabic uses the
        // embedded Noto font right-aligned, and the handful that mix Arabic
        // with Latin go through the browser-rendered image path, because jsPDF
        // mangles mixed bidi text on a single line.
        const PROWH = 4.6, PNOTEH = 3.2;
        const BOXX = ML+6, BOXW = CW-6, TXTX = ML+9, NOTEW = CW-6-6;
        function priorBand(h, rgb){
          pdf.setFillColor(250,251,253); pdf.rect(BOXX, y, BOXW, h, 'F');
          pdf.setFillColor(rgb[0],rgb[1],rgb[2]); pdf.rect(BOXX, y, 1.6, h, 'F');
        }
        for(const vi of _compact){
          const pv = loc.visits[vi];
          const pvRGB = hexToRgb(STAT_COLORS[pv.status]||'#FB923C');
          const pvCat = pdfText(CAT_LABELS[pv.cat]||pv.cat||'');
          const nPh = (pv.photos||[]).length;
          const bits = [pv.date || '—', STAT_LABELS[pv.status]||''];
          if(pvCat) bits.push(pvCat);
          if(pv.escalated) bits.push('-> '+pdfText(pv.escalated));
          if(nPh) bits.push(`${nPh} photo${nPh>1?'s':''}`);
          const headTxt = bits.filter(Boolean).join('  ·  ');

          const noteRaw = pdfText(pv.notes||'').replace(/\s+/g,' ').trim();
          const noteArabic = hasArabic(noteRaw);
          const noteMixed  = noteArabic && /[A-Za-z]/.test(noteRaw);

          // Measure first so the header and its note stay on the same page.
          let noteLines = null, noteImg = null;
          if(noteRaw){
            // Any Arabic — mixed or not — is rendered by the browser and
            // embedded as an image. jsPDF's own Arabic handling does not join
            // letters reliably, and this is the path already proven by the
            // latest-visit notes. Rendered at 1x and at the history text size
            // so it stays light: these are short notes.
            if(noteArabic) noteImg = _noteImages[(loc.locId||'?')+'#'+vi]
                        || await renderNotesImage(noteRaw, NOTEW, {fontMM:1.97, scale:1, jpeg:true});
            if(!noteImg){
              setFontForText(noteRaw, 5.6, 'normal');
              noteLines = pdf.splitTextToSize(noteRaw, NOTEW);
            }
          }
          const noteH = noteImg ? noteImg.hMM + 1
                      : noteLines ? noteLines.length*PNOTEH + 0.8 : 0;
          ensurePage(Math.min(PROWH + noteH + 1.5, 200));

          priorBand(PROWH, pvRGB);
          pdf.setFont('helvetica','bold'); pdf.setFontSize(5.6); pdf.setTextColor(60,70,90);
          pdf.text(headTxt, TXTX, y+3.1);
          y += PROWH;

          if(noteImg){
            priorBand(noteImg.hMM + 1, pvRGB);
            try{ pdf.addImage(noteImg.data, noteImg.fmt||'PNG', TXTX, y+0.4, noteImg.wMM, noteImg.hMM); }catch(e){}
            y += noteImg.hMM + 1;
          } else if(noteLines){
            setFontForText(noteRaw, 5.6, 'normal');
            pdf.setTextColor(120,130,148);
            for(const ln of noteLines){
              ensurePage(PNOTEH + 0.5);
              priorBand(PNOTEH, pvRGB);
              if(noteArabic) pdf.text(ln, BOXX + BOXW - 3, y+2.3, {align:'right'});
              else           pdf.text(ln, TXTX, y+2.3);
              y += PNOTEH;
            }
            y += 0.8;
          }
          y += 0.6;
        }
        y += 1.5;
      }
      y += 5;
    }
    } // end drawDetailPages

    // ════════════════════════════════════════════════════════════════
    // RECAP / SUMMARY PAGE — totals by category, status, and region
    // ════════════════════════════════════════════════════════════════
    (function drawRecap(){
      if(opts.onlyLocId) return;   // single-finding report: no site-wide totals
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
        // RESOLVED is always tallied from ALL findings (latest visit = resolved),
        // even when those findings are excluded from the rest of this report by the
        // "Hide Resolved" toggle / selection criteria. This makes the resolved total
        // reflect reality (e.g. all 20–30 resolved findings) rather than showing 0
        // just because they were hidden. Open / Repeat are counted from what's shown.
        const resolvedTotalAll = (findings||[]).filter(loc=>{
          const latest = loc.visits && loc.visits[0];
          return latest && latest.status === 'resolved';
        }).length;
        counts.resolved = resolvedTotalAll;
        // Status table total = open + repeat + (all) resolved, so counts and
        // percentages stay internally consistent even when resolved are hidden.
        const statusTotal = statOrder.reduce((s,k)=>s+(counts[k]||0),0);
        // Always show 'resolved' even when its count is 0.
        const rows = statOrder.filter(s=>counts[s] || s==='resolved').map(s=>({
          label: STAT_LABELS[s]||s, count: counts[s]||0, color: STAT_COLORS[s]
        }));
        drawTable(rows, statusTotal);
        // extra note: total repeat visits across all findings
        const totalRepeatVisits = recap.reduce((s,r)=>s+r.repeats,0);
        const _resolvedHiddenNote = (PDF_HIDE_RESOLVED && resolvedTotalAll>0)
          ? ' Resolved total includes findings hidden from the rest of this report.'
          : '';
        ensurePage(6);
        pdf.setFont('helvetica','normal'); pdf.setFontSize(6.5); pdf.setTextColor(100,110,130);
        pdf.text(`Note: status reflects each location's most recent visit. Total repeat visits recorded across all locations: ${totalRepeatVisits}.${_resolvedHiddenNote}`, ML+2, y);
        y += 8;
      }

      // ── 3) By Region (Parcel) — flat list, most findings → least ─
      // No quadrant grouping: every parcel/region is listed together and
      // ranked by finding count (highest first), so the busiest regions
      // are at the top at a glance.
      sectionTitle('Totals by Region (Parcel)');
      {
        const counts = {};
        recap.forEach(r=>{ const p = r.parcel || 'Unassigned'; counts[p] = (counts[p]||0)+1; });
        const rows = Object.keys(counts)
          .sort((a,b)=>{
            if(counts[b] !== counts[a]) return counts[b] - counts[a];   // most → least
            return a.localeCompare(b);                                   // tie-break: name
          })
          .map(p=>({ label: p, count: counts[p] }));
        drawTable(rows, total);
      }

      // ── 4) By Assigned / Escalated To ──────────────────────────
      sectionTitle('Totals by Assigned / Escalated To');
      {
        const escOrder = ['SOTAICO','Client Super','Client FM','Client Subcontractor RS','Client Subcontractor OC','Client Subcontractor Other','Client Senior Management','Client Other','Other'];
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
      if(opts.onlyLocId) return;   // single-finding report: no recap table
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

    // ── PER-FINDING DETAIL PAGES — now LAST, after the recap sections ──
    // v6.05.3: the recap & totals page and the finding recap table come
    // first so the reader gets the whole picture before the detail.
    if(_renderDetailPages && !recapOnly){
      showNotif('⏳ Building finding details…', false, 0);
      await drawDetailPages();
    }

    const date = new Date().toISOString().slice(0,10);
    const cid = (window._CLIENT_CONFIG&&window._CLIENT_CONFIG.id)||'ElGouna';
    // ── Page numbers: "Page X of Y" centered in the bottom margin of every
    //    page. Drawn last so the total count is final (after any deletePage).
    //    A white pill sits behind the text so it stays legible over full-bleed
    //    map pages. All pages in this report are A4 portrait (PW×PH).
    const _pageCount = pdf.getNumberOfPages();
    for(let i=1;i<=_pageCount;i++){
      pdf.setPage(i);
      const _lbl = `Page ${i} of ${_pageCount}`;
      pdf.setFont('helvetica','normal'); pdf.setFontSize(7);
      const _tw = pdf.getTextWidth(_lbl);
      pdf.setFillColor(255,255,255);
      pdf.roundedRect(PW/2 - _tw/2 - 2.5, PH-7.6, _tw+5, 5, 1, 1, 'F');
      pdf.setTextColor(90,100,120);
      pdf.text(_lbl, PW/2, PH-4, {align:'center'});
    }
    if(recapOnly){
      pdf.save(`PesTrack Recap Report - El Gouna ${date}.pdf`);
    } else if(opts.onlyLocId){
      const _one = visibleFindings[0];
      const _ref = _one ? stripZeros(_one.refNum||'?') : '?';
      pdf.save(`PesTrack Finding ${_ref} Full History - El Gouna ${date}.pdf`);
    } else if(opts.histFrom && opts.histTo){
      pdf.save(`PesTrack Full History ${opts.histFrom} to ${opts.histTo} - El Gouna.pdf`);
    } else {
      pdf.save(`PesTrack Pest Pressure Sources - El Gouna ${date}.pdf`);
    }
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

// ════════════════════════════════════════════════════════════════════
//  ACTIVITY REPORT — dated change-log over a From→To range
//  One row per event: Date · Logged by · Finding # · Action ·
//  Category · Label · Parcel · Observation · Assigned to
//  Action is derived from each visit's position/status in its finding's
//  history: earliest visit = "Add Finding", a resolved visit = "Resolved",
//  any other later visit = "New Visit".
// ════════════════════════════════════════════════════════════════════
function _actAllVisitDates(){
  const ds = [];
  (window._ptFindings||[]).forEach(loc => (loc.visits||[]).forEach(v => { if(v.date) ds.push(v.date); }));
  return ds.sort();
}

function openActivityModal(){
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to report', true, 3000); return;
  }
  const ds = _actAllVisitDates();
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('act-from').value = ds[0] || today;
  document.getElementById('act-to').value   = ds.length ? ds[ds.length-1] : today;
  document.getElementById('m-activity').style.display = 'flex';
}
window.openActivityModal = openActivityModal;

function actQuickRange(days){
  const ds = _actAllVisitDates();
  const today = new Date().toISOString().slice(0,10);
  if(days === 'all'){
    document.getElementById('act-from').value = ds[0] || today;
    document.getElementById('act-to').value   = ds.length ? ds[ds.length-1] : today;
    return;
  }
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - (days - 1));
  document.getElementById('act-from').value = from.toISOString().slice(0,10);
  document.getElementById('act-to').value   = to.toISOString().slice(0,10);
}
window.actQuickRange = actQuickRange;

function launchActivityReport(){
  const from = document.getElementById('act-from').value;
  const to   = document.getElementById('act-to').value;
  if(!from || !to){ showNotif('⚠️ Please choose both dates', true, 3000); return; }
  if(from > to){ showNotif('⚠️ "From" date is after "To" date', true, 3500); return; }
  const sel = document.querySelector('input[name="act-sort"]:checked');
  const sortBy = sel ? sel.value : 'date';
  document.getElementById('m-activity').style.display = 'none';
  exportActivityPDF(from, to, sortBy);
}
window.launchActivityReport = launchActivityReport;

// Build the flat, chronological event list (used by the PDF and testable alone)
// sortBy: 'date' (most recent first) | 'logged' (grouped by person, newest first within each)
function _buildActivityRows(fromDate, toDate, sortBy){
  sortBy = sortBy || 'date';
  const CAT_LABELS = Object.fromEntries((window._CATS||[]).map(c=>[c.id, c.label]));
  const events = [];
  (window._ptFindings||[]).forEach(loc=>{
    const sorted = [...(loc.visits||[])].sort((a,b)=>{
      if((a.date||'') !== (b.date||'')) return (a.date||'') < (b.date||'') ? -1 : 1;
      const au = a.updatedAt||'', bu = b.updatedAt||'';
      if(au !== bu) return au < bu ? -1 : 1;
      return 0;
    });
    sorted.forEach((v,i)=>{
      let action;
      if(i === 0) action = 'Add Finding';
      else if(v.status === 'resolved') action = 'Resolved';
      else action = 'New Visit';
      events.push({
        date:     v.date || '',
        loggedBy: window._visitUser(v),
        refNum:   loc.refNum || '?',
        action,
        cat:      CAT_LABELS[v.cat] || v.cat || '',
        label:    v.label || '',
        parcel:   loc.parcel || 'Unassigned',
        notes:    v.notes || '',
        assigned: (v.escalated && v.escalated !== 'Not assigned') ? v.escalated : '',
        status:   v.status || 'open'
      });
    });
  });
  const filtered = events.filter(e => e.date && e.date >= fromDate && e.date <= toDate);
  const byDateDesc = (a,b)=>{
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;   // most recent first
    const ra = parseInt(a.refNum,10)||0, rb = parseInt(b.refNum,10)||0;
    if(ra !== rb) return ra - rb;
    return 0;
  };
  if(sortBy === 'logged'){
    filtered.sort((a,b)=>{
      const la = (a.loggedBy||'~').toLowerCase(), lb = (b.loggedBy||'~').toLowerCase();
      if(la !== lb) return la < lb ? -1 : 1;                 // group by person (A→Z; blanks last)
      return byDateDesc(a,b);                                // newest first within a person
    });
  } else {
    filtered.sort(byDateDesc);
  }
  return filtered;
}
window._buildActivityRows = _buildActivityRows;

async function exportActivityPDF(fromDate, toDate, sortBy){
  sortBy = sortBy || 'date';
  if(!window._ptFindings || !window._ptFindings.length){
    showNotif('⚠️ No findings to report', true, 3000); return;
  }
  showNotif('⏳ Building activity report…', false, 0);
  await new Promise(r=>setTimeout(r,50));

  // Ensure CDN libs are ready
  if(!window.jspdf){
    try{ await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload=res; s.onerror=()=>rej(new Error('jsPDF')); document.head.appendChild(s); });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }
  if(!window.html2canvas){
    try{ await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=res; s.onerror=()=>rej(new Error('html2canvas')); document.head.appendChild(s); });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }

  let wrap = null;
  try{
    const {jsPDF} = window.jspdf;
    const CLIENT = (window._CLIENT_CONFIG&&window._CLIENT_CONFIG.name)||'El Gouna';
    const STAT = { open:{color:'#FB923C'}, repeat:{color:'#EF4444'}, resolved:{color:'#22C55E'} };
    const ACT  = { 'Add Finding':'#2563EB', 'New Visit':'#D97706', 'Resolved':'#16A34A' };

    const rows = _buildActivityRows(fromDate, toDate, sortBy);
    if(!rows.length){ showNotif('⚠️ No activity found in that date range', true, 4000); return; }

    const cnt = {'Add Finding':0,'New Visit':0,'Resolved':0};
    rows.forEach(r=>{ cnt[r.action] = (cnt[r.action]||0)+1; });

    // ── Columns (order per request) — fixed px widths, sum = RENDER_W ──
    const COLW = [78,110,68,96,120,176,150,382,120];
    const COLH = ['Date','Logged by','Finding #','Action','Category','Label','Parcel / Area','Observation','Assigned to'];
    const RENDER_W = COLW.reduce((s,w)=>s+w,0);

    const esc = s => String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const colgroup = '<colgroup>'+COLW.map(w=>`<col style="width:${w}px">`).join('')+'</colgroup>';
    const cell = 'padding:5px 7px;border:1px solid #E2E8F0;vertical-align:top;font-size:12px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;';

    const headHtml =
      `<table dir="ltr" style="border-collapse:collapse;width:${RENDER_W}px;table-layout:fixed;font-family:Arial,Tahoma,sans-serif">`
      + colgroup
      + '<tr>' + COLH.map(h=>`<th style="${cell}color:#fff;background:#1E293B;border-color:#334155;font-size:11px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:.03em;word-break:normal;overflow-wrap:normal">${esc(h)}</th>`).join('') + '</tr>'
      + '</table>';

    let bodyRows = '';
    rows.forEach((r,idx)=>{
      const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      const stc = (STAT[r.status]||STAT.open).color;
      const acc = ACT[r.action] || '#475569';
      bodyRows += '<tr>'
        + `<td style="${cell}background:${bg};white-space:nowrap;border-left:3px solid ${stc}">${esc(r.date)}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.loggedBy)||'—'}</td>`
        + `<td style="${cell}background:${bg};text-align:center;font-weight:700">#${esc(String(parseInt(r.refNum,10)||r.refNum))}</td>`
        + `<td style="${cell}background:${bg}"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${acc};color:#fff;font-size:11px;font-weight:700;white-space:nowrap">${esc(r.action)}</span></td>`
        + `<td style="${cell}background:${bg}">${esc(r.cat)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.label)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.parcel)||'—'}</td>`
        + `<td style="${cell}background:${bg}" dir="auto">${esc(r.notes)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.assigned)||'—'}</td>`
        + '</tr>';
    });
    const bodyHtml =
      `<table dir="ltr" style="border-collapse:collapse;width:${RENDER_W}px;table-layout:fixed;font-family:Arial,Tahoma,sans-serif;background:#fff">`
      + colgroup + bodyRows + '</table>';

    // Off-screen render
    wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-99999px;top:0;width:${RENDER_W}px;background:#fff;`;
    const headDiv = document.createElement('div'); headDiv.innerHTML = headHtml;
    const bodyDiv = document.createElement('div'); bodyDiv.innerHTML = bodyHtml;
    wrap.appendChild(headDiv); wrap.appendChild(bodyDiv);
    document.body.appendChild(wrap);

    const bodyTable = bodyDiv.querySelector('table');
    const rowTops = [];
    bodyTable.querySelectorAll('tr').forEach(tr => rowTops.push(tr.offsetTop));

    const SCALE = 2;
    showNotif('⏳ Rendering table…', false, 0);
    const headCanvas = await html2canvas(headDiv.querySelector('table'), {scale:SCALE, backgroundColor:'#ffffff', logging:false});
    const bodyCanvas = await html2canvas(bodyTable, {scale:SCALE, backgroundColor:'#ffffff', logging:false});
    document.body.removeChild(wrap); wrap = null;

    // ── PDF (landscape A4) ──
    const pdf = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
    const PW = 297, PH = 210, ML = 10, MR = 10, MB = 10;
    const CW = PW - ML - MR;
    const mmPerPx = CW / RENDER_W;                 // css-px → mm
    const headHmm = (headCanvas.height / SCALE) * mmPerPx;

    // Logo
    let logoData=null, logoAsp=3.3;
    try{
      const li = new Image();
      await new Promise(r=>{li.onload=r; li.onerror=r; li.src=LOGO_PESTRACK;});
      const lc = document.createElement('canvas'); lc.width=li.naturalWidth||400; lc.height=li.naturalHeight||120;
      lc.getContext('2d').drawImage(li,0,0);
      logoData = lc.toDataURL('image/png'); logoAsp = lc.width/lc.height;
    }catch(e){}

    const fmtD = d => { try{ return new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return d; } };
    const genDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const TITLE_H = 23;

    function drawTitleBlock(){
      if(logoData){ const lh=9, lw=lh*logoAsp; pdf.addImage(logoData,'PNG',ML,7,lw,lh); }
      pdf.setTextColor(15,23,42); pdf.setFont('helvetica','bold'); pdf.setFontSize(13);
      pdf.text(`ACTIVITY REPORT — ${CLIENT}`, PW/2, 12, {align:'center'});
      pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(71,85,105);
      pdf.text(`${fmtD(fromDate)}   to   ${fmtD(toDate)}`, PW/2, 18, {align:'center'});
      pdf.setFontSize(7.5); pdf.setTextColor(100,116,139);
      const sortLabel = sortBy === 'logged' ? 'Sorted by: Logged by' : 'Sorted by: Date (newest first)';
      pdf.text(sortLabel, ML, 20.5);
      pdf.text(`Generated ${genDate}`, PW-MR, 8, {align:'right'});
      pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(15,23,42);
      pdf.text(`${rows.length} events    Add Finding: ${cnt['Add Finding']}    New Visit: ${cnt['New Visit']}    Resolved: ${cnt['Resolved']}`, PW-MR, 14, {align:'right'});
    }
    function drawMiniHeader(){
      pdf.setDrawColor(220,225,236); pdf.setLineWidth(0.3); pdf.line(0,9,PW,9);
      pdf.setTextColor(15,23,42); pdf.setFont('helvetica','bold'); pdf.setFontSize(8);
      pdf.text(`ACTIVITY REPORT — ${CLIENT} (cont.)`, ML, 6);
      pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(100,116,139);
      pdf.text(`${fmtD(fromDate)} to ${fmtD(toDate)}`, PW-MR, 6, {align:'right'});
    }
    function drawHead(y){
      pdf.addImage(headCanvas.toDataURL('image/png'),'PNG', ML, y, CW, headHmm);
      return y + headHmm;
    }

    // Slice boundaries (canvas px) at each row top; final = full canvas height
    const boundaries = rowTops.map(t => Math.min(t*SCALE, bodyCanvas.height));
    boundaries.push(bodyCanvas.height);
    const totalPx = bodyCanvas.height;

    let firstPage = true, startPx = 0;
    while(startPx < totalPx - 0.5){
      let topY;
      if(firstPage){ drawTitleBlock(); topY = TITLE_H; }
      else { drawMiniHeader(); topY = 11; }
      const yRows = drawHead(topY);
      const availMm = PH - MB - yRows;
      const maxSlicePx = (availMm / mmPerPx) * SCALE;

      let endPx = startPx;
      for(let i=0;i<boundaries.length;i++){
        const b = boundaries[i];
        if(b <= startPx) continue;
        if(b - startPx <= maxSlicePx) endPx = b; else break;
      }
      if(endPx <= startPx) endPx = Math.min(totalPx, startPx + maxSlicePx); // row taller than page

      const sliceH = endPx - startPx;
      const tmp = document.createElement('canvas');
      tmp.width = bodyCanvas.width; tmp.height = Math.round(sliceH);
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,tmp.width,tmp.height);
      ctx.drawImage(bodyCanvas, 0, startPx, bodyCanvas.width, sliceH, 0, 0, bodyCanvas.width, sliceH);
      pdf.addImage(tmp.toDataURL('image/jpeg', 0.92),'JPEG', ML, yRows, CW, (sliceH/SCALE)*mmPerPx);

      startPx = endPx;
      if(startPx < totalPx - 0.5){ pdf.addPage([PW,PH],'landscape'); }
      firstPage = false;
    }

    pdf.save(`PesTrack Activity Report - El Gouna ${fromDate} to ${toDate}.pdf`);
    showNotif('✅ Activity report saved');
  }catch(err){
    console.error('Activity PDF error:', err);
    showNotif('❌ '+(err.message||err), true, 8000);
    if(wrap && wrap.parentNode){ try{ wrap.parentNode.removeChild(wrap); }catch(e){} }
  }
}
window.exportActivityPDF = exportActivityPDF;

// ════════════════════════════════════════════════════════════════════
//  OVERDUE RE-INSPECTION REPORT
//  Every OPEN finding whose most-recent visit is older than N days
//  (default 8). Resolved findings excluded. Sorted oldest last-inspection
//  first (most overdue at the top).
// ════════════════════════════════════════════════════════════════════
function openOverdueModal(){
  if(!window._ptFindings || window._ptFindings.length === 0){
    showNotif('⚠️ No findings to report', true, 3000); return;
  }
  document.getElementById('m-overdue').style.display = 'flex';
}
window.openOverdueModal = openOverdueModal;

function launchOverdueReport(){
  let days = parseInt(document.getElementById('ov-days').value, 10);
  if(!days || days < 1) days = 8;
  document.getElementById('m-overdue').style.display = 'none';
  exportOverduePDF(days);
}
window.launchOverdueReport = launchOverdueReport;

// Build overdue rows (testable alone). thresholdDays: re-inspected within
// this many days = NOT overdue. Returns rows sorted most-overdue first.
function _buildOverdueRows(thresholdDays){
  thresholdDays = thresholdDays || 8;
  const CAT_LABELS = Object.fromEntries((window._CATS||[]).map(c=>[c.id, c.label]));
  const STAT_LABEL = { open:'1st Offense', repeat:'Repeat', resolved:'Resolved' };
  const today = new Date(); today.setHours(0,0,0,0);
  const rows = [];
  (window._ptFindings||[]).forEach(loc=>{
    const visits = loc.visits||[];
    if(!visits.length) return;
    const desc = [...visits].sort((a,b)=>{
      if((a.date||'') !== (b.date||'')) return (a.date||'') < (b.date||'') ? 1 : -1;
      const au=a.updatedAt||'', bu=b.updatedAt||'';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    const latest = desc[0];
    if((latest.status||'open') === 'resolved') return;      // ignore resolved
    const firstV = desc[desc.length-1];
    const lastDate = latest.date;
    if(!lastDate) return;
    const daysSince = Math.floor((today - new Date(lastDate+'T00:00:00')) / 86400000);
    if(daysSince <= thresholdDays) return;                  // re-inspected recently → not overdue
    rows.push({
      refNum:      loc.refNum || '?',
      firstDate:   firstV.date || '',
      lastDate,
      daysSince,
      status:      latest.status || 'open',
      statusLabel: STAT_LABEL[latest.status] || latest.status || '',
      cat:         CAT_LABELS[latest.cat] || latest.cat || '',
      label:       latest.label || '',
      parcel:      loc.parcel || 'Unassigned',
      assigned:    (latest.escalated && latest.escalated !== 'Not assigned') ? latest.escalated : '',
      loggedBy:    window._visitUser(latest),
      notes:       latest.notes || ''
    });
  });
  rows.sort((a,b)=>{
    if(a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? -1 : 1;  // oldest last-inspection first
    const ra=parseInt(a.refNum,10)||0, rb=parseInt(b.refNum,10)||0;
    return ra - rb;
  });
  return rows;
}
window._buildOverdueRows = _buildOverdueRows;

async function exportOverduePDF(thresholdDays){
  thresholdDays = thresholdDays || 8;
  if(!window._ptFindings || !window._ptFindings.length){
    showNotif('⚠️ No findings to report', true, 3000); return;
  }
  showNotif('⏳ Building overdue report…', false, 0);
  await new Promise(r=>setTimeout(r,50));

  if(!window.jspdf){
    try{ await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload=res; s.onerror=()=>rej(new Error('jsPDF')); document.head.appendChild(s); });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }
  if(!window.html2canvas){
    try{ await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload=res; s.onerror=()=>rej(new Error('html2canvas')); document.head.appendChild(s); });
    }catch(e){ showNotif('❌ No internet connection — PDF requires online access', true, 5000); return; }
  }

  let wrap = null;
  try{
    const {jsPDF} = window.jspdf;
    const CLIENT = (window._CLIENT_CONFIG&&window._CLIENT_CONFIG.name)||'El Gouna';
    const STAT = { open:{color:'#FB923C'}, repeat:{color:'#EF4444'} };

    const rows = _buildOverdueRows(thresholdDays);
    if(!rows.length){ showNotif(`✅ No findings overdue beyond ${thresholdDays} days`, false, 4000); return; }

    const cnt = { open:0, repeat:0 };
    let maxDays = 0;
    rows.forEach(r=>{ cnt[r.status] = (cnt[r.status]||0)+1; if(r.daysSince>maxDays) maxDays=r.daysSince; });

    // Colour for the "days since" pill — amber up to 2×threshold, red beyond
    const dayColor = d => d > thresholdDays*2 ? '#DC2626' : '#D97706';

    // ── Columns ──
    const COLW = [60,92,100,80,92,118,163,140,113,342];
    const COLH = ['Finding #','First Logged','Last Inspected','Days Since','Status','Category','Label','Parcel / Area','Assigned to','Latest Observation'];
    const RENDER_W = COLW.reduce((s,w)=>s+w,0);

    const esc = s => String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const colgroup = '<colgroup>'+COLW.map(w=>`<col style="width:${w}px">`).join('')+'</colgroup>';
    const cell = 'padding:5px 7px;border:1px solid #E2E8F0;vertical-align:top;font-size:12px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;';

    const headHtml =
      `<table dir="ltr" style="border-collapse:collapse;width:${RENDER_W}px;table-layout:fixed;font-family:Arial,Tahoma,sans-serif">`
      + colgroup
      + '<tr>' + COLH.map(h=>`<th style="${cell}color:#fff;background:#7C2D12;border-color:#9A3412;font-size:11px;font-weight:700;text-align:left;text-transform:uppercase;letter-spacing:.03em;word-break:normal;overflow-wrap:normal">${esc(h)}</th>`).join('') + '</tr>'
      + '</table>';

    let bodyRows = '';
    rows.forEach((r,idx)=>{
      const bg = idx % 2 === 0 ? '#FEF9F5' : '#FFFFFF';
      const stc = (STAT[r.status]||STAT.open).color;
      const dc  = dayColor(r.daysSince);
      bodyRows += '<tr>'
        + `<td style="${cell}background:${bg};text-align:center;font-weight:700;border-left:3px solid ${stc}">#${esc(String(parseInt(r.refNum,10)||r.refNum))}</td>`
        + `<td style="${cell}background:${bg};white-space:nowrap">${esc(r.firstDate)||'—'}</td>`
        + `<td style="${cell}background:${bg};white-space:nowrap">${esc(r.lastDate)||'—'}</td>`
        + `<td style="${cell}background:${bg};text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${dc};color:#fff;font-size:11px;font-weight:700;white-space:nowrap">${r.daysSince}d</span></td>`
        + `<td style="${cell}background:${bg}"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${stc};color:#fff;font-size:11px;font-weight:700;white-space:nowrap">${esc(r.statusLabel)}</span></td>`
        + `<td style="${cell}background:${bg}">${esc(r.cat)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.label)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.parcel)||'—'}</td>`
        + `<td style="${cell}background:${bg}">${esc(r.assigned)||'—'}</td>`
        + `<td style="${cell}background:${bg}" dir="auto">${esc(r.notes)||'—'}</td>`
        + '</tr>';
    });
    const bodyHtml =
      `<table dir="ltr" style="border-collapse:collapse;width:${RENDER_W}px;table-layout:fixed;font-family:Arial,Tahoma,sans-serif;background:#fff">`
      + colgroup + bodyRows + '</table>';

    wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-99999px;top:0;width:${RENDER_W}px;background:#fff;`;
    const headDiv = document.createElement('div'); headDiv.innerHTML = headHtml;
    const bodyDiv = document.createElement('div'); bodyDiv.innerHTML = bodyHtml;
    wrap.appendChild(headDiv); wrap.appendChild(bodyDiv);
    document.body.appendChild(wrap);

    const bodyTable = bodyDiv.querySelector('table');
    const rowTops = [];
    bodyTable.querySelectorAll('tr').forEach(tr => rowTops.push(tr.offsetTop));

    const SCALE = 2;
    showNotif('⏳ Rendering table…', false, 0);
    const headCanvas = await html2canvas(headDiv.querySelector('table'), {scale:SCALE, backgroundColor:'#ffffff', logging:false});
    const bodyCanvas = await html2canvas(bodyTable, {scale:SCALE, backgroundColor:'#ffffff', logging:false});
    document.body.removeChild(wrap); wrap = null;

    const pdf = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'});
    const PW = 297, PH = 210, ML = 10, MR = 10, MB = 10;
    const CW = PW - ML - MR;
    const mmPerPx = CW / RENDER_W;
    const headHmm = (headCanvas.height / SCALE) * mmPerPx;

    let logoData=null, logoAsp=3.3;
    try{
      const li = new Image();
      await new Promise(r=>{li.onload=r; li.onerror=r; li.src=LOGO_PESTRACK;});
      const lc = document.createElement('canvas'); lc.width=li.naturalWidth||400; lc.height=li.naturalHeight||120;
      lc.getContext('2d').drawImage(li,0,0);
      logoData = lc.toDataURL('image/png'); logoAsp = lc.width/lc.height;
    }catch(e){}

    const genDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const TITLE_H = 23;

    function drawTitleBlock(){
      if(logoData){ const lh=9, lw=lh*logoAsp; pdf.addImage(logoData,'PNG',ML,7,lw,lh); }
      pdf.setTextColor(124,45,18); pdf.setFont('helvetica','bold'); pdf.setFontSize(13);
      pdf.text(`OVERDUE RE-INSPECTION REPORT — ${CLIENT}`, PW/2, 12, {align:'center'});
      pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(71,85,105);
      pdf.text(`Open findings not re-inspected in the last ${thresholdDays} days`, PW/2, 18, {align:'center'});
      pdf.setFontSize(7.5); pdf.setTextColor(100,116,139);
      pdf.text('Sorted by: oldest last-inspection first', ML, 20.5);
      pdf.text(`As of ${genDate}`, PW-MR, 8, {align:'right'});
      pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(124,45,18);
      pdf.text(`${rows.length} overdue    1st Offense: ${cnt.open||0}    Repeat: ${cnt.repeat||0}    Longest: ${maxDays}d`, PW-MR, 14, {align:'right'});
    }
    function drawMiniHeader(){
      pdf.setDrawColor(220,225,236); pdf.setLineWidth(0.3); pdf.line(0,9,PW,9);
      pdf.setTextColor(124,45,18); pdf.setFont('helvetica','bold'); pdf.setFontSize(8);
      pdf.text(`OVERDUE RE-INSPECTION — ${CLIENT} (cont.)`, ML, 6);
      pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(100,116,139);
      pdf.text(`Not re-inspected in ${thresholdDays}+ days · as of ${genDate}`, PW-MR, 6, {align:'right'});
    }
    function drawHead(y){
      pdf.addImage(headCanvas.toDataURL('image/png'),'PNG', ML, y, CW, headHmm);
      return y + headHmm;
    }

    const boundaries = rowTops.map(t => Math.min(t*SCALE, bodyCanvas.height));
    boundaries.push(bodyCanvas.height);
    const totalPx = bodyCanvas.height;

    let firstPage = true, startPx = 0;
    while(startPx < totalPx - 0.5){
      let topY;
      if(firstPage){ drawTitleBlock(); topY = TITLE_H; }
      else { drawMiniHeader(); topY = 11; }
      const yRows = drawHead(topY);
      const availMm = PH - MB - yRows;
      const maxSlicePx = (availMm / mmPerPx) * SCALE;

      let endPx = startPx;
      for(let i=0;i<boundaries.length;i++){
        const b = boundaries[i];
        if(b <= startPx) continue;
        if(b - startPx <= maxSlicePx) endPx = b; else break;
      }
      if(endPx <= startPx) endPx = Math.min(totalPx, startPx + maxSlicePx);

      const sliceH = endPx - startPx;
      const tmp = document.createElement('canvas');
      tmp.width = bodyCanvas.width; tmp.height = Math.round(sliceH);
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,tmp.width,tmp.height);
      ctx.drawImage(bodyCanvas, 0, startPx, bodyCanvas.width, sliceH, 0, 0, bodyCanvas.width, sliceH);
      pdf.addImage(tmp.toDataURL('image/jpeg', 0.92),'JPEG', ML, yRows, CW, (sliceH/SCALE)*mmPerPx);

      startPx = endPx;
      if(startPx < totalPx - 0.5){ pdf.addPage([PW,PH],'landscape'); }
      firstPage = false;
    }

    const iso = new Date().toISOString().slice(0,10);
    pdf.save(`PesTrack Overdue Re-inspection - El Gouna ${iso} (${thresholdDays}d).pdf`);
    showNotif('✅ Overdue report saved');
  }catch(err){
    console.error('Overdue PDF error:', err);
    showNotif('❌ '+(err.message||err), true, 8000);
    if(wrap && wrap.parentNode){ try{ wrap.parentNode.removeChild(wrap); }catch(e){} }
  }
}
window.exportOverduePDF = exportOverduePDF;
