// Stored rows (from the audit "Old value") for the six parcels the popup flagged.
const stored = {
  'Abu Tig Marina': [[27.408094,33.676053],[27.408149,33.674852]],
  'Cyan':           [[27.40445,33.663694],[27.407149,33.660591],[27.407449,33.66341],[27.409511,33.659696]],
  'Fanadir Lagoon': [[27.414604,33.669075],[27.416294,33.668184]],
  'Nines':          [[27.41559,33.660306],[27.420584,33.65649],[27.420732,33.656251],[27.423591,33.655376],[27.426271,33.655635]],
  'Swan Lake':      [[27.405161,33.659119],[27.405536,33.657555],[27.405816,33.660064]],
  'Tawila':         [[27.400141,33.661388],[27.40107,33.659396],[27.401506,33.663181],[27.40202,33.661373],[27.403204,33.663907]],
};
// What the uploaded sheet actually carried (from the audit "New value").
const sheet = {
  'Abu Tig Marina': [27.408094,33.676053], 'Cyan': [27.407449,33.66341],
  'Fanadir Lagoon': [27.416294,33.668184], 'Nines': [27.420732,33.656251],
  'Swan Lake': [27.405161,33.659119], 'Tawila': [27.40202,33.661373],
};

const OLD = (rows,[lat,lng]) => {            // previous logic: first row only
  const [oLat,oLng] = rows[0];
  return Math.abs(oLat-lat)>0.0001 || Math.abs(oLng-lng)>0.0001;
};
const NEW = (rows,[lat,lng]) =>              // fixed logic: any stored row
  !rows.some(([oLat,oLng]) => Math.abs(oLat-lat)<=0.0001 && Math.abs(oLng-lng)<=0.0001);

console.log('parcel'.padEnd(18), 'before'.padEnd(10), 'after');
for (const n of Object.keys(sheet)) {
  console.log(n.padEnd(18), (OLD(stored[n],sheet[n])?'WARNS':'-').padEnd(10), NEW(stored[n],sheet[n])?'WARNS':'-');
}
// Control: a parcel that genuinely moved must still warn.
const moved = [27.500000, 33.700000];
console.log('\ncontrol — Nines genuinely moved to 27.5,33.7:',
  NEW(stored['Nines'], moved) ? 'WARNS (correct)' : 'silent (BUG)');
