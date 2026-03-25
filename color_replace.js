const fs = require('fs');
const cssPath = 'style.css';
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(/--primary:\s*#6366f1;/g, '--primary: #2563eb;');
css = css.replace(/--primary-alt:\s*#8b5cf6;/g, '--primary-alt: #1d4ed8;');
css = css.replace(/--primary-grad:\s*linear-gradient\(135deg,\s*#6366f1\s*0%,\s*#a855f7\s*100%\);/g, '--primary-grad: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);');
css = css.replace(/rgba\(99,\s*102,\s*241,/g, 'rgba(37, 99, 235,');

css = css.replace(/\.aura-1 \{ width: 600px; height: 600px; background: #6366f1/g, '.aura-1 { width: 600px; height: 600px; background: #2563eb');
css = css.replace(/\.aura-2 \{ width: 500px; height: 500px; background: #a855f7/g, '.aura-2 { width: 500px; height: 500px; background: #1d4ed8');

fs.writeFileSync(cssPath, css);
console.log('CSS Colors Updated');
