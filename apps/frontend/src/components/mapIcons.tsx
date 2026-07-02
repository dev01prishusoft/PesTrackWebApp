import L from 'leaflet';
import { CONSTR_MAP_ICON_DATA } from '../lib/constants';
import type { Finding, Visit, References } from '../lib/types';

// Minimal shapes used by the builders (kept local so this stays decoupled from constants typing).
type StatCfg = { color: string; emoji: string; label: string };

const statOf = (id: string, refs: References): StatCfg => {
  const st = refs.statuses.find(s => s.id === id);
  return st ? { color: st.color, emoji: st.emoji, label: st.label } : { color: '#FB923C', emoji: '🟠', label: '1st Offense' };
};

const catOf = (id: string, refs: References) => {
  const cat = refs.categories.find(c => c.id === id);
  return cat ? { id: cat.id, label: cat.label } : { id: 'unknown', label: 'Unknown' };
};

// ── Construction-zone marker (legacy PNG icon) ────────────────────────────
export function makeZoneIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer">
        <img src="${CONSTR_MAP_ICON_DATA}" width="60" height="50" style="display:block;user-select:none" alt="Construction zone">
      </div>`,
    className: 'cz-divicon',
    iconSize: [60, 50],
    iconAnchor: [30, 25],
  });
}

// ── Finding marker (triangle SVG + label) — exact legacy match ────────────
export function makeFindingIcon(finding: Finding, refs: References): L.DivIcon {
  const latest = finding.visits[0];
  const stat = statOf(latest.statusId, refs);
  const cat = catOf(latest.categoryId, refs);
  const shortLbl = (latest.label || cat.label || '').substring(0, 22);
  const refDisplay = parseInt(finding.ref_num, 10) || finding.ref_num;
  const _tc = stat.color;

  const _triSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="58" viewBox="0 0 64 58">
      <polygon points="32,3 61,55 3,55" fill="${_tc}" stroke="#1a1a1a" stroke-width="3" stroke-linejoin="round"/>
      <text x="32" y="47" text-anchor="middle" font-size="22" font-weight="900" font-family="Arial,sans-serif" fill="#fff" stroke="#1a1a1a" stroke-width="0.5">${refDisplay}</text>
    </svg>`;

  const markerHtml = `<div class="fi-marker-wrap">
      ${_triSVG}
      <div class="fi-marker-label" style="color:${_tc};border:1px solid ${_tc}">${shortLbl}</div>
    </div>`;

  return L.divIcon({ html: markerHtml, className: '', iconSize: [240, 72], iconAnchor: [120, 29] });
}

// ── Finding popup (timeline of visits) — exact legacy markup ──────────────
export function buildFindingPopupHtml(finding: Finding, isClientViewer: boolean, refs: References): string {
  const latest = finding.visits[0];
  const stat = statOf(latest.statusId, refs);
  const cat = catOf(latest.categoryId, refs);

  const timelineHTML = finding.visits
    .map((v: Visit) => {
      const photos = v.photos || [];
      const vs = statOf(v.statusId, refs);
      const vc = catOf(v.categoryId, refs);
      const esc = refs.escalations.find(e => e.id === v.escalatedToId);
      const photosHTML = photos
        .map(
          (p) =>
            `<img src="${p}" class="fi-popup-photo" title="Click to enlarge" data-locid="${finding.id}" data-visitid="${v.id}" />`
        )
        .join('');

      return `
        <div class="fi-tl-entry">
          <div class="fi-tl-date">${v.visitDate} — ${vc.label}</div>
          <span class="fi-tl-status" style="background:${vs.color}">${vs.emoji} ${vs.label}</span>
          ${
            !isClientViewer
              ? `<button class="fi-del-btn" data-locid="${finding.id}" data-visitid="${v.id}">✏ edit</button>
             <button class="fi-del-btn" data-locid="${finding.id}" data-visitid="${v.id}">✕ delete</button>`
              : ''
          }
          ${v.notes ? `<div class="fi-tl-note">${v.notes}</div>` : ''}
          ${esc ? `<div class="fi-tl-note font-bold text-[9px]" style="color:#7C3AED">➜ ${esc.label}</div>` : ''}
          ${photosHTML ? `<div class="fi-tl-photos">${photosHTML}</div>` : ''}
        </div>`;
    })
    .join('');

  return `
    <div class="fi-popup">
      <div class="fi-pop-hdr" style="background:${stat.color}">
        #${parseInt(finding.ref_num) || finding.ref_num} · ${cat.label} — ${latest.label || ''}
      </div>
      <div class="fi-pop-body">
        <div class="fi-timeline">${timelineHTML}</div>
        ${!isClientViewer ? `<button class="fi-add-btn" data-locid="${finding.id}">+ Add New Visit</button>` : ''}
      </div>
    </div>`;
}
