// End-to-end: the real backend running against the in-memory spreadsheet mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('../tools/gas-mock.js');

function demo() {
  const g = loadBackend();
  g.setupSheets_();
  g.loadDemo_();
  return { g, S: g.$('Service') };
}

const hasDate = (v) => v instanceof Date
  || (v && typeof v === 'object' && Object.values(v).some(hasDate));

test('setup + demo data leave a consistent ledger', () => {
  const { S } = demo();
  const a = S.audit();
  assert.ok(a.ok, a.issues.join('\n'));
  assert.equal(S.account('U-001').balance, 1000 - 100 - 80);
});

test('web api returns no Dates, fees or pool sizes', () => {
  const { g } = demo();
  const boot = g.api_bootstrap();
  assert.ok(!hasDate(boot), 'google.script.run cannot return Date objects');
  const json = JSON.stringify(boot);
  assert.ok(!/fee|pool|seed/i.test(json), 'house fee must stay invisible');
  assert.ok(!hasDate(g.api_account('U-001')));
});

test('P2P settlement pays winners, books the fee, sums to zero', () => {
  const { S } = demo();
  const r = S.settleMarket('MKT-001', 'MKT-001-A');
  assert.equal(r.houseAmount, 10.21);
  assert.equal(S.account('U-001').balance, 1039.86);
  assert.equal(S.account('U-003').balance, 989.93);
  const bets = S.account('U-002').bets.filter((b) => b.state === 'LOST');
  assert.equal(bets.length, 1);
  assert.ok(S.audit().ok);
});

test('HOUSE settlement pays at locked odds', () => {
  const { S } = demo();
  const r = S.settleMarket('MKT-002', 'MKT-002-Y');
  // Yes priced at 0.6 * 1.05 = 0.63 -> odds 1.5873 (stored at 4 dp)
  assert.equal(S.account('U-001').balance, 946.98);
  assert.equal(r.houseAmount, 13.02);
  assert.ok(S.audit().ok);
});

test('void refunds every stake', () => {
  const { S } = demo();
  S.voidMarket('MKT-003');
  assert.equal(S.account('U-004').balance, 1000 - 40);
  assert.ok(S.audit().ok);
});

test('bet rules are enforced', () => {
  const { S } = demo();
  assert.throws(() => S.placeBet('U-001', 'MKT-001', 'MKT-001-A', 5000), /STAKE_TOO_HIGH/);
  assert.throws(() => S.placeBet('U-001', 'MKT-001', 'MKT-001-A', 0), /INVALID_STAKE/);
  assert.throws(() => S.placeBet('U-001', 'MKT-001', 'MKT-002-Y', 10), /OUTCOME_NOT_FOUND/);
  assert.throws(() => S.placeBet('U-999', 'MKT-001', 'MKT-001-A', 10), /USER_NOT_FOUND/);
  S.placeBet('U-001', 'MKT-001', 'MKT-001-A', 500);
  assert.throws(() => S.placeBet('U-001', 'MKT-001', 'MKT-001-A', 400), /INSUFFICIENT_BALANCE/);
  S.settleMarket('MKT-001', 'MKT-001-A');
  assert.throws(() => S.placeBet('U-002', 'MKT-001', 'MKT-001-A', 10), /MARKET_NOT_OPEN/);
  assert.throws(() => S.settleMarket('MKT-001', 'MKT-001-A'), /MARKET_ALREADY_FINAL/);
});

test('preview: HOUSE is locked, P2P shows estimate and if-closed-now', () => {
  const { S } = demo();
  const h = S.previewBet('MKT-002', 'MKT-002-N', 10);
  assert.ok(Math.abs(h.odds - 1 / (0.4 * 1.05)) < 1e-9);
  assert.equal(h.oddsIfClosedNow, undefined);
  const p = S.previewBet('MKT-003', 'MKT-003-U', 10);
  // no fee, no seed: (70 + 30 + 10) / (30 + 10)
  assert.ok(Math.abs(p.oddsIfClosedNow - 110 / 40) < 1e-9);
  assert.ok(Math.abs(p.shares - 10 / p.price) < 1e-9);
});
