/**
 * Pure odds and settlement math. No Apps Script services are used here, so
 * the same file runs in Node for tests (see tests/odds.test.js).
 *
 * Conventions
 * - Decimal odds: total return per 1 credit staked (stake included). 2.50 -> 1 pays 2.50.
 * - Price: cost of one share that pays 1.00 if the outcome wins. price = 1 / odds.
 *   The price is also the implied probability shown to users (fee included).
 * - Money is settled in integer cents. Payouts are rounded DOWN; the leftover
 *   cents ("breakage") go to the house, so the house never pays more than the pool.
 */
const Odds = (() => {
  const toCents = (x) => Math.round(Number(x) * 100);
  const fromCents = (c) => c / 100;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  /**
   * P2P (pari-mutuel) decimal odds for every outcome, net of the house fee.
   *   odds_i = sum_j(pool_j + seed) * (1 - fee) / (pool_i + seed), floored at 1.00
   * Seed is virtual money that smooths early odds; settlement never uses it.
   * @param {Object<string, number>} pools stake per outcome id
   * @param {number} feePct e.g. 0.03
   * @param {number} seed virtual credits per outcome (0 = pure pool)
   * @return {Object<string, ?number>} null where the odds are undefined
   */
  function poolOdds(pools, feePct, seed) {
    const s = Number(seed) || 0;
    const ids = Object.keys(pools);
    const weight = {};
    ids.forEach((id) => { weight[id] = (Number(pools[id]) || 0) + s; });
    const net = sum(ids.map((id) => weight[id])) * (1 - feePct);
    const odds = {};
    ids.forEach((id) => { odds[id] = weight[id] > 0 ? Math.max(1, net / weight[id]) : null; });
    return odds;
  }

  /**
   * HOUSE-mode decimal odds. Fair probabilities (any positive weights, they are
   * normalised) are loaded with the fee, so prices sum to 1 + fee (the overround).
   *   price_i = min(p_i * (1 + fee), maxPrice);  odds_i = 1 / price_i
   * @param {Object<string, number>} fairProbs probability or weight per outcome id
   * @return {Object<string, ?number>}
   */
  function houseOdds(fairProbs, feePct, maxPrice) {
    const ids = Object.keys(fairProbs);
    const total = sum(ids.map((id) => Math.max(0, Number(fairProbs[id]) || 0)));
    const cap = Number(maxPrice) || 0.99;
    const odds = {};
    ids.forEach((id) => {
      const p = total > 0 ? Math.max(0, Number(fairProbs[id]) || 0) / total : 0;
      odds[id] = p > 0 ? 1 / Math.min(p * (1 + feePct), cap) : null;
    });
    return odds;
  }

  const priceFromOdds = (odds) => (odds ? 1 / odds : null);
  const oddsFromPrice = (price) => (price ? 1 / price : null);

  /**
   * Settle a P2P market. If nobody backed the winner, every stake is refunded.
   * @param {{txnId: string, accountId: string, outcomeId: string, stake: number}[]} bets
   * @return {{odds: ?number, payouts: Object[], refunds: Object[], houseAmount: number}}
   */
  function settleP2P(bets, winningOutcomeId, feePct) {
    const totalC = sum(bets.map((b) => toCents(b.stake)));
    const winners = bets.filter((b) => b.outcomeId === winningOutcomeId);
    const winnerC = sum(winners.map((b) => toCents(b.stake)));
    if (winnerC === 0) return refundAll(bets);

    const odds = Math.max(1, (totalC * (1 - feePct)) / winnerC);
    const payouts = winners.map((b) => ({
      txnId: b.txnId,
      accountId: b.accountId,
      amount: fromCents(Math.floor(toCents(b.stake) * odds)),
    }));
    const paidC = sum(payouts.map((p) => toCents(p.amount)));
    return { odds, payouts, refunds: [], houseAmount: fromCents(totalC - paidC) };
  }

  /**
   * Settle a HOUSE market: each winning bet is paid at the odds locked at entry.
   * houseAmount is the house P&L for the market (negative = house lost).
   * @param {{txnId: string, accountId: string, outcomeId: string, stake: number, oddsAtEntry: number}[]} bets
   */
  function settleHouse(bets, winningOutcomeId) {
    const totalC = sum(bets.map((b) => toCents(b.stake)));
    const payouts = bets
      .filter((b) => b.outcomeId === winningOutcomeId)
      .map((b) => ({
        txnId: b.txnId,
        accountId: b.accountId,
        amount: fromCents(Math.floor(toCents(b.stake) * Number(b.oddsAtEntry))),
      }));
    const paidC = sum(payouts.map((p) => toCents(p.amount)));
    return { odds: null, payouts, refunds: [], houseAmount: fromCents(totalC - paidC) };
  }

  /** Every stake back, house gets nothing. Used for void markets too. */
  function refundAll(bets) {
    return {
      odds: null,
      payouts: [],
      refunds: bets.map((b) => ({ txnId: b.txnId, accountId: b.accountId, amount: Number(b.stake) })),
      houseAmount: 0,
    };
  }

  return {
    poolOdds, houseOdds, priceFromOdds, oddsFromPrice,
    settleP2P, settleHouse, refundAll, toCents, fromCents,
  };
})();

if (typeof module !== 'undefined') module.exports = Odds;
