/**
 * Local preview of the web app: runs the real backend on the in-memory
 * spreadsheet (with demo data) and serves Index.html on http://localhost:8787.
 * google.script.run is shimmed with fetch() calls to /api/<function>.
 *
 *   npm run preview
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend, SRC } = require('./gas-mock.js');

const PORT = Number(process.env.PORT) || 8787;
const g = loadBackend();
g.setupSheets_();
g.loadDemo_();

const SHIM = `<script>
  // Local preview only: emulates google.script.run over HTTP.
  window.google = { script: { run: (function make(ok, ko) {
    return new Proxy({}, { get(_, fn) {
      if (fn === 'withSuccessHandler') return (h) => make(h, ko);
      if (fn === 'withFailureHandler') return (h) => make(ok, h);
      return (...args) => fetch('/api/' + fn, { method: 'POST', body: JSON.stringify(args) })
        .then((r) => r.json())
        .then((j) => (j.error ? ko && ko(new Error(j.error)) : ok && ok(j.result)));
    } });
  })() } };
</script>`;

function render() {
  const read = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  return read('Index')
    .replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => (n === 'I18n' ? SHIM : '') + read(n))
    .replace(/<\?= appVersion \?>/g, g.$('APP.version'));
}

http.createServer((req, res) => {
  const m = req.url.match(/^\/api\/(api_\w+)$/);
  if (req.method === 'POST' && m && typeof g[m[1]] === 'function') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try { out = { result: g[m[1]](...JSON.parse(body || '[]')) }; } catch (e) { out = { error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(render());
}).listen(PORT, () => console.log('Bet Lab preview on http://localhost:' + PORT));
