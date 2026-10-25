/**
 * Thin data-access layer over the spreadsheet tabs.
 * Rows come back as objects keyed by camelCase header ("Market Id" -> marketId),
 * plus _row (1-based sheet row) so they can be updated in place.
 */
const Repo = (() => {
  const keyOf = (header) => header
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');

  function spreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  function sheet(name) {
    const sh = spreadsheet().getSheetByName(name);
    if (!sh) throw new Error('MISSING_SHEET: ' + name + ' (run Bet Lab > Set up sheets)');
    return sh;
  }

  function readAll(name) {
    const values = sheet(name).getDataRange().getValues();
    const keys = HEADERS[name].map(keyOf);
    return values.slice(1)
      .map((row, i) => {
        const obj = { _row: i + 2 };
        keys.forEach((k, c) => { obj[k] = row[c]; });
        return obj;
      })
      .filter((obj) => obj[keys[0]] !== '' && obj[keys[0]] !== null);
  }

  function toRow(name, obj) {
    return HEADERS[name].map((h) => {
      const v = obj[keyOf(h)];
      return v === undefined || v === null ? '' : v;
    });
  }

  function append(name, obj) {
    sheet(name).appendRow(toRow(name, obj));
  }

  function appendMany(name, objs) {
    if (!objs.length) return;
    const sh = sheet(name);
    const rows = objs.map((o) => toRow(name, o));
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  /** Overwrite only the given fields of an existing row. */
  function update(name, rowNumber, patch) {
    const sh = sheet(name);
    HEADERS[name].forEach((h, c) => {
      const k = keyOf(h);
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        sh.getRange(rowNumber, c + 1).setValue(patch[k]);
      }
    });
  }

  /** Settings tab as { KEY: value }, falling back to DEFAULT_SETTINGS. */
  function settings() {
    const out = {};
    DEFAULT_SETTINGS.forEach(([k, v]) => { out[k] = v; });
    readAll(SHEET.SETTINGS).forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  /**
   * Sequential id for the row about to be appended, e.g. TX-000042.
   * Pass offset when appending several rows in one batch. Call inside a lock.
   */
  function nextId(name, prefix, width, offset) {
    const n = sheet(name).getLastRow() + (offset || 0); // row 1 is the header
    return prefix + '-' + String(n).padStart(width, '0');
  }

  return { keyOf, spreadsheet, sheet, readAll, append, appendMany, update, settings, nextId };
})();
