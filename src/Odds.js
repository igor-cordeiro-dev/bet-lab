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

  // ---------- LMSR automated market maker ----------
  //
  // q_i = shares sold of outcome i (each pays 1.00 if i wins).
  // Cost function C(q) = b * ln(sum_j exp(q_j / b)); price_i = exp(q_i / b) / sum_j exp(q_j / b).
  // Buying costs C(q after) - C(q before), so a big order walks the price up gradually
  // instead of jumping. b is the damping knob; the house's worst case is b * ln(n).

  /** Instantaneous prices (sum to 1). */
  function lmsrPrices(q, b) {
    const ids = Object.keys(q);
    const m = Math.max(...ids.map((id) => q[id]));
    const w = {};
    ids.forEach((id) => { w[id] = Math.exp((q[id] - m) / b); });
    const s = sum(ids.map((id) => w[id]));
    const prices = {};
    ids.forEach((id) => { prices[id] = w[id] / s; });
    return prices;
  }

  /**
   * Shares of outcome `id` that `spend` credits buy (closed form, numerically stable):
   *   exp((q_i + d) / b) = S * (exp(spend / b) - 1) + exp(q_i / b),  S = sum_j exp(q_j / b)
   */
  function lmsrSharesFor(q, b, id, spend) {
    const ids = Object.keys(q);
    const m = Math.max(...ids.map((k) => q[k]));
    const s = sum(ids.map((k) => Math.exp((q[k] - m) / b)));
    const inner = s * Math.expm1(spend / b) + Math.exp((q[id] - m) / b);
    return m + b * Math.log(inner) - q[id];
  }

  /**
   * Quote a purchase. The fee is taken from the stake first; the rest buys shares.
   * @return {{shares: number, odds: number, avgPrice: number, priceBefore: number, priceAfter: number}}
   */
  function lmsrBuy(q, b, id, stake, feePct) {
    const spend = stake * (1 - feePct);
    const shares = lmsrSharesFor(q, b, id, spend);
    const after = Object.assign({}, q, { [id]: q[id] + shares });
    return {
      shares,
      odds: shares / stake,
      avgPrice: stake / shares,
      priceBefore: lmsrPrices(q, b)[id] / (1 - feePct),
      priceAfter: lmsrPrices(after, b)[id] / (1 - feePct),
    };
  }

  /** Decimal odds for a tiny bet on each outcome, fee included. */
  function lmsrOdds(q, b, feePct) {
    const p = lmsrPrices(q, b);
    const odds = {};
    Object.keys(p).forEach((id) => { odds[id] = (1 - feePct) / p[id]; });
    return odds;
  }

  const lmsrMaxLoss = (b, outcomes) => b * Math.log(outcomes);

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

  /** Shares a bet holds; older rows without Shares fall back to stake x odds. */
  const sharesOf = (b) => (b.shares ? Number(b.shares) : Number(b.stake) * Number(b.oddsAtEntry));

  /**
   * Settle a HOUSE or LMSR market: each winning share pays 1.00 (= stake x locked odds).
   * houseAmount is the house P&L for the market (negative = house lost).
   * @param {{txnId: string, accountId: string, outcomeId: string, stake: number, oddsAtEntry: number, shares: ?number}[]} bets
   */
  function settleHouse(bets, winningOutcomeId) {
    const totalC = sum(bets.map((b) => toCents(b.stake)));
    const payouts = bets
      .filter((b) => b.outcomeId === winningOutcomeId)
      .map((b) => ({
        txnId: b.txnId,
        accountId: b.accountId,
        amount: fromCents(Math.floor(Math.round(sharesOf(b) * 1e6) / 1e4)),
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
    lmsrPrices, lmsrSharesFor, lmsrBuy, lmsrOdds, lmsrMaxLoss,
    settleP2P, settleHouse, refundAll, sharesOf, toCents, fromCents,
  };
})();

if (typeof module !== 'undefined') module.exports = Odds;
