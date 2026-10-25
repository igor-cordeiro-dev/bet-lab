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
  assert.equal(S.account('U-004').balance, 1000 - 40 - 50);
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

test('LMSR market: locked shares, damped price, settles to zero', () => {
  const { S } = demo();
  const p = S.previewBet('MKT-004', 'MKT-004-Y', 500);
  assert.ok(p.priceAfter > p.priceBefore, 'buying Yes pushes its price up');
  assert.ok(p.shares > 500, 'shares bought at an average price below 1');
  S.placeBet('U-001', 'MKT-004', 'MKT-004-Y', 500);
  const r = S.settleMarket('MKT-004', 'MKT-004-Y');
  assert.ok(r.houseAmount < 0, 'house subsidised the winners');
  assert.ok(-r.houseAmount <= 300 * Math.log(2) + 0.01 + 170, 'loss bounded by b ln 2 plus fees collected');
  assert.ok(S.audit().ok);
});

test('admin api: owner only, fails closed when the viewer is unknown', () => {
  const { g } = demo();
  assert.equal(g.api_bootstrap().isAdmin, true);
  assert.ok(g.api_adminOverview().kpis.users === 4);
  g.__viewer = '';
  assert.equal(g.api_bootstrap().isAdmin, false);
  assert.throws(() => g.api_adminOverview(), /NOT_ADMIN/);
  g.__viewer = 'someone@example.com';
  assert.throws(() => g.api_adminSettleMarket('MKT-001', 'MKT-001-A'), /NOT_ADMIN/);
  assert.throws(() => g.api_adminGrantCredits('U-001', 1e6), /NOT_ADMIN/);
});

test('admin overview: KPIs, risk per outcome, no Dates', () => {
  const { S } = demo();
  const o = S.adminOverview();
  assert.ok(!hasDate(o));
  assert.equal(o.kpis.openMarkets, 4);
  assert.equal(o.kpis.creditsHeld, 4000 - 100 - 150 - 50 - 40 - 80 - 60 - 70 - 30 - 120 - 50);
  const house = o.markets.find((m) => m.marketId === 'MKT-002');
  // if Yes wins the house pays 80 x 1.5873 = 126.98 on 140 staked
  assert.equal(house.outcomes.find((x) => x.outcomeId === 'MKT-002-Y').housePnlIfWins, 13.02);
  assert.ok(o.markets.find((m) => m.marketId === 'MKT-004').maxLoss > 0);
  assert.ok(o.audit.ok);
});

test('admin: create market, add user, settings are validated', () => {
  const { S } = demo();
  const { marketId } = S.createMarket({
    titleEn: 'Test', mode: 'LMSR', liquidityB: 500,
    outcomes: [{ labelEn: 'A' }, { labelEn: 'B' }, { labelEn: '' }],
  });
  assert.equal(marketId, 'MKT-005');
  assert.equal(S.outcomesOf(marketId).length, 2);
  assert.throws(() => S.createMarket({ titleEn: 'x', mode: 'HOUSE', outcomes: [{ labelEn: 'A' }, { labelEn: 'B' }] }), /MISSING_PROBABILITIES/);
  assert.throws(() => S.createMarket({ titleEn: 'x', mode: 'NOPE', outcomes: [] }), /INVALID_MODE/);
  const { userId } = S.addUser('Eva');
  assert.equal(userId, 'U-005');
  assert.equal(S.account(userId).balance, 1000);
  S.updateSetting('MAX_STAKE', 800);
  S.placeBet(userId, marketId, marketId + '-1', 700);
  assert.throws(() => S.updateSetting('HOUSE_ACCOUNT_ID', 'X'), /SETTING_NOT_EDITABLE/);
  assert.throws(() => S.updateSetting('DEFAULT_HOUSE_FEE_PCT', 0.9), /INVALID_SETTING_VALUE/);
  assert.throws(() => S.updateSetting('MIN_STAKE', 900), /INVALID_SETTING_VALUE/);
});
