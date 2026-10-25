/**
 * Spreadsheet menu: admin-only actions.
 *
 * Every admin entry point calls requireSheetUi_() first. SpreadsheetApp.getUi()
 * only works inside the spreadsheet, so these functions cannot be triggered
 * from the web app through google.script.run.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APP.name)
    .addItem('Set up sheets', 'menuSetup')
    .addItem('Load demo data', 'menuLoadDemo')
    .addSeparator()
    .addItem('Grant play credits', 'menuGrantCredits')
    .addItem('Close market', 'menuCloseMarket')
    .addItem('Settle market', 'menuSettleMarket')
    .addItem('Void market (refund all)', 'menuVoidMarket')
    .addSeparator()
    .addItem('Run audit', 'menuAudit')
    .addItem('Open web app URL', 'menuWebAppUrl')
    .addToUi();
}

function requireSheetUi_() {
  return SpreadsheetApp.getUi(); // throws outside the spreadsheet UI
}

function ask_(ui, title, prompt) {
  const res = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  return res.getResponseText().trim();
}

function run_(ui, fn) {
  try {
    const msg = fn();
    if (msg) ui.alert(msg);
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

// ---------- setup ----------

function menuSetup() {
  const ui = requireSheetUi_();
  run_(ui, () => { setupSheets_(); return 'Sheets are ready.'; });
}

function setupSheets_() {
  const ss = Repo.spreadsheet();
  writeReadme_(ss);
  Object.keys(HEADERS).forEach((name) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = HEADERS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eaed');
    sh.setFrozenRows(1);
  });

  const settings = Repo.sheet(SHEET.SETTINGS);
  const existing = Repo.readAll(SHEET.SETTINGS).map((r) => r.key);
  const missing = DEFAULT_SETTINGS.filter(([k]) => existing.indexOf(k) === -1);
  if (missing.length) {
    settings.getRange(settings.getLastRow() + 1, 1, missing.length, 3).setValues(missing.map((r) => r.slice()));
  }

  const list = (values) => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  const col = (name, header) => HEADERS[name].indexOf(header) + 1;
  const markets = Repo.sheet(SHEET.MARKETS);
  markets.getRange(2, col(SHEET.MARKETS, 'Mode'), 999).setDataValidation(list(Object.values(MARKET_MODE)));
  markets.getRange(2, col(SHEET.MARKETS, 'Status'), 999).setDataValidation(list(Object.values(MARKET_STATUS)));
  Repo.sheet(SHEET.USERS).getRange(2, col(SHEET.USERS, 'Status'), 999).setDataValidation(list(Object.values(USER_STATUS)));

  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('Página1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);
}

function writeReadme_(ss) {
  const sh = ss.getSheetByName(SHEET.README) || ss.insertSheet(SHEET.README, 0);
  const lines = [
    [APP.name + ' v' + APP.version],
    ['⚠️ ' + DISCLAIMER.en],
    ['⚠️ ' + DISCLAIMER.pt],
    [''],
    ['Tabs: Settings (parameters), Users, Markets, Outcomes, Ledger (every credit movement, the audit trail).'],
    ['Do not edit Ledger rows by hand. To correct a mistake, use the menu or post an ADJUSTMENT.'],
    ['House fee is configured per market (House Fee Pct) and is never shown in the web app.'],
  ];
  sh.clear();
  sh.getRange(1, 1, lines.length, 1).setValues(lines);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1, 2, 1).setFontWeight('bold').setFontColor('#b06000');
  sh.setColumnWidth(1, 900);
}

// ---------- demo data ----------

function menuLoadDemo() {
  const ui = requireSheetUi_();
  if (Repo.readAll(SHEET.MARKETS).length || Repo.readAll(SHEET.USERS).length) {
    ui.alert('Demo data needs empty Users and Markets tabs.');
    return;
  }
  run_(ui, () => { loadDemo_(); return 'Demo data loaded. Run audit to check the ledger.'; });
}

function loadDemo_() {
  const now = new Date();
  const inDays = (d) => new Date(now.getTime() + d * 86400000);
  const settings = Repo.settings();

  Repo.appendMany(SHEET.USERS, ['Alice', 'Bruno', 'Carla', 'Diego'].map((name, i) => ({
    userId: 'U-' + String(i + 1).padStart(3, '0'), displayName: name, status: USER_STATUS.ACTIVE, createdAt: now,
  })));

  Repo.appendMany(SHEET.MARKETS, [
    { marketId: 'MKT-001', titleEn: 'Match winner: Lions vs Tigers', titlePt: 'Vencedor: Leões x Tigres',
      mode: MARKET_MODE.P2P, status: MARKET_STATUS.OPEN, houseFeePct: 0.03, seedPerOutcome: 50, closesAt: inDays(7), createdAt: now },
    { marketId: 'MKT-002', titleEn: 'Will it rain in São Paulo tomorrow?', titlePt: 'Vai chover em São Paulo amanhã?',
      mode: MARKET_MODE.HOUSE, status: MARKET_STATUS.OPEN, houseFeePct: 0.05, closesAt: inDays(1), createdAt: now },
    { marketId: 'MKT-003', titleEn: 'Total goals: over or under 2.5', titlePt: 'Total de gols: mais ou menos de 2,5',
      mode: MARKET_MODE.P2P, status: MARKET_STATUS.OPEN, houseFeePct: 0, seedPerOutcome: 0, closesAt: inDays(7), createdAt: now },
    { marketId: 'MKT-004', titleEn: 'Will the Lions win the league?', titlePt: 'Os Leões vão ganhar o campeonato?',
      mode: MARKET_MODE.LMSR, status: MARKET_STATUS.OPEN, houseFeePct: 0.02, liquidityB: 300, closesAt: inDays(30), createdAt: now },
  ]);

  Repo.appendMany(SHEET.OUTCOMES, [
    { outcomeId: 'MKT-001-A', marketId: 'MKT-001', labelEn: 'Lions', labelPt: 'Leões', sortOrder: 1 },
    { outcomeId: 'MKT-001-D', marketId: 'MKT-001', labelEn: 'Draw', labelPt: 'Empate', sortOrder: 2 },
    { outcomeId: 'MKT-001-B', marketId: 'MKT-001', labelEn: 'Tigers', labelPt: 'Tigres', sortOrder: 3 },
    { outcomeId: 'MKT-002-Y', marketId: 'MKT-002', labelEn: 'Yes', labelPt: 'Sim', houseProbability: 0.6, sortOrder: 1 },
    { outcomeId: 'MKT-002-N', marketId: 'MKT-002', labelEn: 'No', labelPt: 'Não', houseProbability: 0.4, sortOrder: 2 },
    { outcomeId: 'MKT-003-O', marketId: 'MKT-003', labelEn: 'Over 2.5', labelPt: 'Mais de 2,5', sortOrder: 1 },
    { outcomeId: 'MKT-003-U', marketId: 'MKT-003', labelEn: 'Under 2.5', labelPt: 'Menos de 2,5', sortOrder: 2 },
    { outcomeId: 'MKT-004-Y', marketId: 'MKT-004', labelEn: 'Yes', labelPt: 'Sim', sortOrder: 1 },
    { outcomeId: 'MKT-004-N', marketId: 'MKT-004', labelEn: 'No', labelPt: 'Não', sortOrder: 2 },
  ]);

  Service.listUsers().forEach((u) => Service.grantCredits(u.userId, settings.STARTING_CREDITS, 'Demo starting credits'));

  [
    ['U-001', 'MKT-001', 'MKT-001-A', 100],
    ['U-002', 'MKT-001', 'MKT-001-B', 150],
    ['U-003', 'MKT-001', 'MKT-001-A', 50],
    ['U-004', 'MKT-001', 'MKT-001-D', 40],
    ['U-001', 'MKT-002', 'MKT-002-Y', 80],
    ['U-002', 'MKT-002', 'MKT-002-N', 60],
    ['U-003', 'MKT-003', 'MKT-003-O', 70],
    ['U-004', 'MKT-003', 'MKT-003-U', 30],
    ['U-002', 'MKT-004', 'MKT-004-Y', 120],
    ['U-004', 'MKT-004', 'MKT-004-N', 50],
  ].forEach(([u, m, o, s]) => Service.placeBet(u, m, o, s));
}

// ---------- operations ----------

function menuGrantCredits() {
  const ui = requireSheetUi_();
  const userId = ask_(ui, 'Grant play credits', 'User Id (e.g. U-001):');
  if (!userId) return;
  const amount = ask_(ui, 'Grant play credits', 'Amount (negative = adjustment):');
  if (!amount) return;
  run_(ui, () => { Service.grantCredits(userId, Number(amount), 'Admin grant'); return 'Done.'; });
}

function menuCloseMarket() {
  const ui = requireSheetUi_();
  const marketId = ask_(ui, 'Close market', 'Market Id (no new bets after this):');
  if (!marketId) return;
  run_(ui, () => { Service.closeMarket(marketId); return marketId + ' is CLOSED.'; });
}

function menuSettleMarket() {
  const ui = requireSheetUi_();
  const marketId = ask_(ui, 'Settle market', 'Market Id:');
  if (!marketId) return;
  run_(ui, () => {
    Service.findMarket(marketId);
    const options = Service.outcomesOf(marketId).map((o) => o.outcomeId + ' = ' + o.labelEn).join('\n');
    const winner = ask_(ui, 'Settle ' + marketId, 'Winning Outcome Id:\n' + options);
    if (!winner) return null;
    const r = Service.settleMarket(marketId, winner);
    return marketId + ' settled. Ledger rows: ' + r.rows + '. House amount: ' + r.houseAmount +
      (r.odds ? '. Final odds: ' + r.odds.toFixed(4) : '');
  });
}

function menuVoidMarket() {
  const ui = requireSheetUi_();
  const marketId = ask_(ui, 'Void market', 'Market Id (every stake is refunded):');
  if (!marketId) return;
  run_(ui, () => { const r = Service.voidMarket(marketId); return marketId + ' void. Refund rows: ' + r.rows; });
}

function menuAudit() {
  const ui = requireSheetUi_();
  run_(ui, () => {
    const a = Service.audit();
    return (a.ok ? '✅ Ledger OK' : '❌ Issues found:\n' + a.issues.join('\n')) + '\n\n' + a.lines.join('\n');
  });
}

function menuWebAppUrl() {
  const ui = requireSheetUi_();
  const url = ScriptApp.getService().getUrl();
  ui.alert(url ? 'Web app: ' + url : 'Not deployed yet. In the Apps Script editor: Deploy > New deployment > Web app.');
}
