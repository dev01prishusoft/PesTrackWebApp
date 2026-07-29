const xlsx = require('xlsx');
const path = require('path');

const file = 'PesTrack gouna parcels and quadrants(2).xlsx';
const filePath = path.join(__dirname, '..', '..', file);
const workbook = xlsx.readFile(filePath);
const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(firstSheet);
console.log(`All rows in ${file}:`, rows);
