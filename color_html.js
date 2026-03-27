const fs = require('fs');
const htmlPath = 'index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(/rgba\(99,\s*102,\s*241,/g, 'rgba(37, 99, 235,');
html = html.replace(/rgba\(168,\s*85,\s*247,/g, 'rgba(29, 78, 216,');

fs.writeFileSync(htmlPath, html);
console.log('HTML Colors Updated');
