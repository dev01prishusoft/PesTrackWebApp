const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'apps/frontend/src/pages/FrontendPage.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replacements:
// visitId -> id in Visit definitions and accesses
content = content.replace(/visitId:/g, 'id:');
content = content.replace(/\.visitId/g, '.id');

// locId -> id in Finding definitions and accesses (but keep locId for payload args if needed, wait, API payload is also id)
content = content.replace(/locId:/g, 'id:');
content = content.replace(/\.locId/g, '.id');

// czId -> id in ConstructionZone
content = content.replace(/czId:/g, 'id:');
content = content.replace(/\.czId/g, '.id');

// Visit fields
content = content.replace(/category:/g, 'categoryId:');
content = content.replace(/\.category/g, '.categoryId');
content = content.replace(/escalated:/g, 'escalatedToId:');
content = content.replace(/\.escalated/g, '.escalatedToId');
content = content.replace(/status:/g, 'statusId:');
content = content.replace(/\.status/g, '.statusId');

// Category/Status code -> id
content = content.replace(/\.code/g, '.id');
content = content.replace(/code:/g, 'id:');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
