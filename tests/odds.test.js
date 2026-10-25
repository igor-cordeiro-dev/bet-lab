const test = require('node:test');
const assert = require('node:assert/strict');
const Odds = require('../src/Odds.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('poolOdds: odds are net of fee and prices sum to 1 / (1 - fee)', () => {
  const odds = Odds.poolOdds({ A: 150, B: 250 }, 0.03, 0);
  close(odds.A, (400 * 0.97) / 150);
  close(odds.B, (400 * 0.97) / 250);
  close(1 / odds.A + 1 / odds.B, 1 / 0.97);
});

test('poolOdds: empty outcome is undefined without seed, defined with seed', () => {
  assert.equal(Odds.poolOdds({ A: 100, B: 0 }, 0, 0).B, null);
  const seeded = Odds.poolOdds({ A: 0, B: 0 }, 0, 50);
  close(seeded.A, 2);
  close(seeded.B, 2);
});

test('poolOdds: never below 1.00', () => {
  assert.equal(Odds.poolOdds({ A: 100, B: 0 }, 0.05, 0).A, 1);
});

test('houseOdds: normalises weights and loads the fee into the price', () => {
  const odds = Odds.houseOdds({ Y: 3, N: 2 }, 0.05, 0.99);
  close(1 / odds.Y, 0.6 * 1.05);
  close(1 / odds.N, 0.4 * 1.05);
  close(1 / odds.Y + 1 / odds.N, 1.05);
});

test('houseOdds: price capped at maxPrice', () => {
  const odds = Odds.houseOdds({ Y: 0.99, N: 0.01 }, 0.05, 0.99);
  close(odds.Y, 1 / 0.99);
});

test('price <-> odds', () => {
  close(Odds.priceFromOdds(2.5), 0.4);
  close(Odds.oddsFromPrice(0.4), 2.5);
  assert.equal(Odds.priceFromOdds(null), null);
});

test('settleP2P: winners share the pool net of fee, breakage goes to the house', () => {
  const bets = [
    { txnId: 't1', accountId: 'a', outcomeId: 'A', stake: 100 },
    { txnId: 't2', accountId: 'b', outcomeId: 'B', stake: 150 },
    { txnId: 't3', accountId: 'c', outcomeId: 'A', stake: 50 },
    { txnId: 't4', accountId: 'd', outcomeId: 'D', stake: 40 },
  ];
  const r = Odds.settleP2P(bets, 'A', 0.03);
  close(r.odds, (340 * 0.97) / 150);
  assert.deepEqual(r.payouts.map((p) => p.amount), [219.86, 109.93]);
  assert.equal(r.houseAmount, 10.21);
  const total = Odds.toCents(340);
  const out = r.payouts.reduce((s, p) => s + Odds.toCents(p.amount), 0) + Odds.toCents(r.houseAmount);
  assert.equal(out, total, 'pool is fully distributed');
});

test('settleP2P: nobody backed the winner -> everyone refunded', () => {
  const r = Odds.settleP2P([{ txnId: 't1', accountId: 'a', outcomeId: 'A', stake: 10 }], 'B', 0.03);
  assert.equal(r.payouts.length, 0);
  assert.deepEqual(r.refunds, [{ txnId: 't1', accountId: 'a', amount: 10 }]);
  assert.equal(r.houseAmount, 0);
});

test('settleP2P: winners never get back less than their stake', () => {
  const r = Odds.settleP2P([{ txnId: 't1', accountId: 'a', outcomeId: 'A', stake: 10 }], 'A', 0.05);
  assert.equal(r.payouts[0].amount, 10);
  assert.equal(r.houseAmount, 0);
});

test('settleHouse: pays at locked odds, house P&L can be negative', () => {
  const r = Odds.settleHouse([
    { txnId: 't1', accountId: 'a', outcomeId: 'Y', stake: 80, oddsAtEntry: 3 },
    { txnId: 't2', accountId: 'b', outcomeId: 'N', stake: 60, oddsAtEntry: 1.5 },
  ], 'Y');
  assert.deepEqual(r.payouts, [{ txnId: 't1', accountId: 'a', amount: 240 }]);
  assert.equal(r.houseAmount, -100);
});

// ---------- LMSR ----------

const cost = (q, b) => b * Math.log(Object.values(q).reduce((s, x) => s + Math.exp(x / b), 0));

test('lmsr: prices start equal and always sum to 1', () => {
  const p = Odds.lmsrPrices({ Y: 0, N: 0, D: 0 }, 100);
  close(p.Y, 1 / 3);
  const p2 = Odds.lmsrPrices({ Y: 250, N: 10, D: 0 }, 100);
  close(p2.Y + p2.N + p2.D, 1);
});

test('lmsr: shares bought cost exactly the amount spent (cost function)', () => {
  const q = { Y: 40, N: 120 };
  const d = Odds.lmsrSharesFor(q, 150, 'Y', 75);
  close(cost({ Y: q.Y + d, N: q.N }, 150) - cost(q, 150), 75, 1e-7);
});

test('lmsr: fee comes off the stake and is baked into odds', () => {
  const r = Odds.lmsrBuy({ Y: 0, N: 0 }, 100, 'Y', 100, 0.02);
  close(r.shares, Odds.lmsrSharesFor({ Y: 0, N: 0 }, 100, 'Y', 98));
  close(r.priceBefore, 0.5 / 0.98);
  close(Odds.lmsrOdds({ Y: 0, N: 0 }, 100, 0.02).Y, 1.96);
});

test('lmsr: bigger b = calmer price for the same bet (damping)', () => {
  const move = (b) => { const r = Odds.lmsrBuy({ Y: 0, N: 0 }, b, 'Y', 1000, 0); return r.priceAfter - r.priceBefore; };
  assert.ok(move(100) > move(300));
  assert.ok(move(300) > move(1000));
  // b=1000: a 1000-credit bet takes Yes from 50% to ~81.6% (P2P with a 100 pool would go to ~91%)
  close(0.5 + move(1000), 0.816, 1e-3);
});

test('lmsr: house never loses more than b * ln(n)', () => {
  const b = 200;
  let q = { Y: 0, N: 0 };
  const bets = [];
  for (let i = 0; i < 20; i++) {
    const r = Odds.lmsrBuy(q, b, 'Y', 500, 0);
    bets.push({ txnId: 't' + i, accountId: 'a', outcomeId: 'Y', stake: 500, shares: r.shares });
    q = { Y: q.Y + r.shares, N: q.N };
  }
  const loss = -Odds.settleHouse(bets, 'Y').houseAmount;
  assert.ok(loss > 0 && loss <= b * Math.log(2) + 0.01, `loss ${loss}`);
});
