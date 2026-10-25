/**
 * Builds the two files you paste into the Apps Script editor (no clasp needed):
 *   dist/Code.gs     all src/*.js concatenated in load order
 *   dist/Index.html  Index.html with every include() inlined
 *
 *   npm run bundle
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'dist');
const JS_ORDER = ['Config', 'Odds', 'Repo', 'Service', 'Admin', 'WebApp'];

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const code = JS_ORDER.map((n) => '// ===== ' + n + '.js =====\n' + read(n + '.js')).join('\n');
const index = read('Index.html').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n + '.html'));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'Code.gs'), code);
fs.writeFileSync(path.join(OUT, 'Index.html'), index);
console.log('dist/Code.gs ' + code.length + ' bytes, dist/Index.html ' + index.length + ' bytes');
