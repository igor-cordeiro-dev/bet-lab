/**
 * Minimal in-memory stand-in for the Apps Script services Bet Lab uses
 * (SpreadsheetApp, LockService, HtmlService, ScriptApp). Loads src/*.js into a
 * vm context so the real backend code runs in Node for tests and local preview.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const LOAD_ORDER = ['Config.js', 'Odds.js', 'Repo.js', 'Service.js', 'Admin.js', 'WebApp.js'];

function makeSheet(name) {
  const data = [];
  const isEmpty = (row) => !row || row.every((v) => v === '' || v === null || v === undefined);
  const sheet = {
    data,
    getName: () => name,
    getLastRow: () => {
      let n = data.length;
      while (n > 0 && isEmpty(data[n - 1])) n--;
      return n;
    },
    getDataRange: () => ({
      getValues: () => {
        const rows = data.slice(0, sheet.getLastRow()).map((r) => r || []);
        const width = Math.max(0, ...rows.map((r) => r.length));
        return rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? '' : r[i])));
      },
    }),
    appendRow: (row) => { data[sheet.getLastRow()] = row.slice(); },
    getRange: (r, c, nr, nc) => makeRange(sheet, r, c, nr || 1, nc || 1),
    setFrozenRows() {},
    setColumnWidth() {},
    clear() { data.length = 0; },
  };
  return sheet;
}

function makeRange(sheet, r, c) {
  const self = {
    setValues(values) {
      values.forEach((row, i) => {
        const rr = r - 1 + i;
        sheet.data[rr] = sheet.data[rr] || [];
        row.forEach((v, j) => { sheet.data[rr][c - 1 + j] = v; });
      });
      return self;
    },
    setValue(v) { return self.setValues([[v]]); },
  };
  ['setFontWeight', 'setBackground', 'setFontSize', 'setFontColor', 'setDataValidation'].forEach((m) => {
    self[m] = () => self;
  });
  return self;
}

function makeSpreadsheet() {
  const sheets = [makeSheet('Sheet1')];
  return {
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n, index) => {
      const s = makeSheet(n);
      if (index === undefined) sheets.push(s); else sheets.splice(index, 0, s);
      return s;
    },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
}

function chain() {
  const p = new Proxy(function () {}, { get: () => p, apply: () => p });
  return p;
}

/** Fresh backend with an empty spreadsheet. Returns the vm context (globals). */
function loadBackend() {
  const ss = makeSpreadsheet();
  const alerts = [];
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => ({ alert: (m) => alerts.push(m), createMenu: chain, prompt: chain, ButtonSet: {}, Button: {} }),
      newDataValidation: chain,
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => '' }) },
    HtmlService: {
      createHtmlOutputFromFile: (n) => ({ getContent: () => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8') }),
    },
  });
  LOAD_ORDER.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  ctx.__spreadsheet = ss;
  ctx.__alerts = alerts;
  ctx.$ = (expr) => vm.runInContext(expr, ctx);
  return ctx;
}

module.exports = { loadBackend, SRC };
