// DB rows for "Cyan", in created_at order (oldest first) — the order the
// controller receives them. The oldest is NOT the sheet's row.
const dbCyan = [
  { parcel_name:'Cyan', lat:'27.404450', lng:'33.663694', quadrant:'SE' },  // oldest
  { parcel_name:'Cyan', lat:'27.407149', lng:'33.660591', quadrant:'SE' },
  { parcel_name:'Cyan', lat:'27.407449', lng:'33.663410', quadrant:'SE' },
  { parcel_name:'Cyan', lat:'27.409511', lng:'33.659696', quadrant:'SE' },
];
const name='Cyan', quadrant='SE', lat=27.407449, lng=33.663410;   // the 46-row sheet
const sameName = (p) => String(p.parcel_name) === String(name);

// ---- OLD logic: first stored row only ----
const firstOp = dbCyan.find(p => p.parcel_name === name);
const oQ = String(firstOp.quadrant).trim(), nQ = String(quadrant).trim();
let oldWarn = null;
if (nQ && oQ !== nQ) oldWarn = 'quadrant';
else if (Math.abs(Number(firstOp.lat)-lat)>0.0001 || Math.abs(Number(firstOp.lng)-lng)>0.0001) oldWarn='coordinates';
console.log('OLD logic compares against', firstOp.lat, firstOp.lng, '->', oldWarn ?? 'silent');

// ---- NEW logic: every stored row of that name (mirrors the patched controller) ----
const opsForName = dbCyan.filter(sameName);
const newQuad = quadrant != null ? String(quadrant).trim() : '';
const quadKnown = opsForName.some(p => (p.quadrant != null ? String(p.quadrant).trim() : '') === newQuad);
const coordKnown = lat != null && lng != null && opsForName.some(p => {
  if (p.lat == null || p.lng == null) return false;
  return Math.abs(Number(p.lat)-lat) <= 0.0001 && Math.abs(Number(p.lng)-lng) <= 0.0001;
});
let newWarn = null;
if (newQuad && !quadKnown) newWarn='quadrant';
else if (lat!=null && lng!=null && !coordKnown && opsForName.some(p=>p.lat!=null&&p.lng!=null)) newWarn='coordinates';
console.log('NEW logic compares against all 4 rows      ->', newWarn ?? 'silent');

// Control: Cyan genuinely relocated to a coordinate it has never held.
const mLat=27.500000, mLng=33.700000;
const movedKnown = opsForName.some(p => Math.abs(Number(p.lat)-mLat)<=0.0001 && Math.abs(Number(p.lng)-mLng)<=0.0001);
console.log('control — Cyan moved to 27.5,33.7          ->', movedKnown ? 'silent (BUG)' : 'coordinates (correct)');
