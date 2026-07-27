const xlsx=require('/Users/apple/Projects/PesTrackWebApp/apps/backend/node_modules/xlsx');
const R='/Users/apple/Projects/PesTrackWebApp/';
// Mirrors the standalone HTML: one entry per sheet row, {name, quad, lat, lng}
function load(file){ const wb=xlsx.readFile(R+file);
  const rows=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); const out=[];
  for(const r of rows){ const name=r['parcel name'], quad=r['quadrant'], c=r['coordinate'];
    if(!name||!quad||!c) continue;
    const m=String(c).match(/([\d.]+)°?N[,\s]+([\d.]+)°?E/i); if(!m) continue;
    out.push({name:String(name), quad:String(quad), lat:+m[1], lng:+m[2]}); }
  return out; }

// The standalone client's diff (PesTrack_ElGouna_V6_04(2).html:519-530)
function clientDiff(prevParcels, parcels){
  const quadChanges=[], coordChanges=[];
  parcels.forEach(np=>{
    const op=prevParcels.find(p=>p.name===np.name);
    if(!op || op.name.includes('General')) return;
    if(op.quad!==np.quad) quadChanges.push(`"${np.name}": ${op.quad} → ${np.quad}`);
    else { const dLat=Math.abs(op.lat-np.lat), dLng=Math.abs(op.lng-np.lng);
      if(dLat>0.0001||dLng>0.0001) coordChanges.push(`"${np.name}"`); }
  });
  return {quadChanges, coordChanges};
}

const f1=load('PesTrack gouna parcels and quadrants(2).xlsx');
const f2=load('PesTrack gouna parcels and quadrants-new.xlsx');
const f3=load('PesTrack gouna parcels and quadrants (2).xlsx');
const names=a=>new Set(a.map(p=>p.name));
console.log('rows  file1:',f1.length,' file2:',f2.length,' file3:',f3.length);
console.log('distinct names  file2:',names(f2).size,' file3:',names(f3).size);
console.log('file2 has multiple rows per name?', f2.length!==names(f2).size);

let r=clientDiff(f1,f2);
console.log('\nCLIENT upload2 (prev = file1):  quad',r.quadChanges.length,' coord',r.coordChanges.length);
r=clientDiff(f2,f3);
console.log('CLIENT upload3 (prev = file2):  quad',r.quadChanges.length,' coord',r.coordChanges.length);
r.coordChanges.forEach(c=>console.log('     ',c));
