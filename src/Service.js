/**
 * Business rules. Everything that touches money goes through here and is
 * written to the Ledger tab; balances are always derived from the Ledger.
 *
 * Errors are thrown as stable English codes (e.g. INSUFFICIENT_BALANCE);
 * the web app translates them for the user.
 */
const Service = (() => {
  // ---------- helpers ----------

  function withLock(fn) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  const fail = (code) => { throw new Error(code); };
  const iso = (d) => (d instanceof Date ? d.toISOString() : (d ? String(d) : ''));
  const num = (v, fallback) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? fallback : Number(v));

  function feeOf(market, settings) {
    return num(market.houseFeePct, num(settings.DEFAULT_HOUSE_FEE_PCT, 0));
  }

  function seedOf(market, settings) {
    return num(market.seedPerOutcome, num(settings.DEFAULT_SEED_PER_OUTCOME, 0));
  }

  /** OPEN in the sheet but past Closes At counts as CLOSED. */
  function effectiveStatus(market) {
    if (market.status === MARKET_STATUS.OPEN && market.closesAt && new Date(market.closesAt) <= new Date()) {
      return MARKET_STATUS.CLOSED;
    }
    return market.status;
  }

  function findMarket(marketId) {
    const m = Repo.readAll(SHEET.MARKETS).find((r) => r.marketId === marketId);
    return m || fail('MARKET_NOT_FOUND');
  }

  function outcomesOf(marketId, allOutcomes) {
    return (allOutcomes || Repo.readAll(SHEET.OUTCOMES))
      .filter((o) => o.marketId === marketId)
      .sort((a, b) => num(a.sortOrder, 0) - num(b.sortOrder, 0));
  }

  function postedBets(ledger, marketId) {
    return ledger
      .filter((t) => t.txnType === TXN_TYPE.BET && t.status === TXN_STATUS.POSTED && t.marketId === marketId)
      .map((t) => ({
        txnId: t.txnId,
        accountId: t.accountId,
        outcomeId: t.outcomeId,
        stake: -Number(t.amount),
        oddsAtEntry: num(t.oddsAtEntry, null),
      }));
  }

  function balanceOf(accountId, ledger) {
    const cents = ledger
      .filter((t) => t.accountId === accountId && t.status === TXN_STATUS.POSTED)
      .reduce((acc, t) => acc + Odds.toCents(t.amount), 0);
    return Odds.fromCents(cents);
  }

  /**
   * Current decimal odds per outcome id.
   * opts.extra = { outcomeId, stake } simulates a new bet (P2P only).
   * opts.seed overrides the market seed (0 = "if the market closed now").
   */
  function quote(market, outcomes, ledger, settings, opts) {
    const o = opts || {};
    const fee = feeOf(market, settings);
    if (market.mode === MARKET_MODE.HOUSE) {
      const probs = {};
      outcomes.forEach((oc) => { probs[oc.outcomeId] = num(oc.houseProbability, 0); });
      return Odds.houseOdds(probs, fee, num(settings.MAX_PRICE, 0.99));
    }
    const pools = {};
    outcomes.forEach((oc) => { pools[oc.outcomeId] = 0; });
    postedBets(ledger, market.marketId).forEach((b) => {
      if (b.outcomeId in pools) pools[b.outcomeId] += b.stake;
    });
    if (o.extra && o.extra.outcomeId in pools) pools[o.extra.outcomeId] += o.extra.stake;
    return Odds.poolOdds(pools, fee, o.seed === undefined ? seedOf(market, settings) : o.seed);
  }

  function findActiveUser(userId) {
    const u = Repo.readAll(SHEET.USERS).find((r) => r.userId === userId);
    if (!u) fail('USER_NOT_FOUND');
    if (u.status !== USER_STATUS.ACTIVE) fail('USER_BLOCKED');
    return u;
  }

  function cleanStake(stake, settings) {
    const s = Number(stake);
    if (!isFinite(s) || s <= 0) fail('INVALID_STAKE');
    const rounded = Odds.fromCents(Odds.toCents(s));
    if (rounded < num(settings.MIN_STAKE, 1)) fail('STAKE_TOO_LOW');
    if (rounded > num(settings.MAX_STAKE, Infinity)) fail('STAKE_TOO_HIGH');
    return rounded;
  }

  function ledgerRow(fields) {
    return Object.assign({
      timestamp: new Date(),
      status: TXN_STATUS.POSTED,
      marketId: '', outcomeId: '', oddsAtEntry: '', priceAtEntry: '', relatedTxnId: '', notes: '',
    }, fields);
  }

  // ---------- reads for the web app (never expose fees or pools) ----------

  function listUsers() {
    return Repo.readAll(SHEET.USERS)
      .filter((u) => u.status === USER_STATUS.ACTIVE)
      .map((u) => ({ userId: u.userId, displayName: u.displayName }));
  }

  function listMarkets() {
    const settings = Repo.settings();
    const ledger = Repo.readAll(SHEET.LEDGER);
    const allOutcomes = Repo.readAll(SHEET.OUTCOMES);
    const order = { OPEN: 0, CLOSED: 1, SETTLED: 2, VOID: 3 };
    return Repo.readAll(SHEET.MARKETS)
      .map((m) => {
        const status = effectiveStatus(m);
        const outcomes = outcomesOf(m.marketId, allOutcomes);
        const live = status === MARKET_STATUS.OPEN || status === MARKET_STATUS.CLOSED;
        const odds = live ? quote(m, outcomes, ledger, settings) : {};
        return {
          marketId: m.marketId,
          title: { en: m.titleEn, pt: m.titlePt || m.titleEn },
          mode: m.mode,
          status,
          closesAt: iso(m.closesAt),
          winningOutcomeId: m.winningOutcomeId || '',
          outcomes: outcomes.map((oc) => ({
            outcomeId: oc.outcomeId,
            label: { en: oc.labelEn, pt: oc.labelPt || oc.labelEn },
            odds: odds[oc.outcomeId] || null,
            price: Odds.priceFromOdds(odds[oc.outcomeId]),
          })),
        };
      })
      .sort((a, b) => order[a.status] - order[b.status]);
  }

  /** Balance plus the user's bets with their current state. */
  function account(userId) {
    findActiveUser(userId);
    const ledger = Repo.readAll(SHEET.LEDGER);
    const markets = {};
    Repo.readAll(SHEET.MARKETS).forEach((m) => { markets[m.marketId] = m; });
    const outcomes = {};
    Repo.readAll(SHEET.OUTCOMES).forEach((o) => { outcomes[o.outcomeId] = o; });
    const settledBy = {};
    ledger
      .filter((t) => t.relatedTxnId && t.status === TXN_STATUS.POSTED)
      .forEach((t) => { settledBy[t.relatedTxnId] = t; });

    const bets = ledger
      .filter((t) => t.accountId === userId && t.txnType === TXN_TYPE.BET && t.status === TXN_STATUS.POSTED)
      .map((t) => {
        const m = markets[t.marketId] || {};
        const oc = outcomes[t.outcomeId] || {};
        const settle = settledBy[t.txnId];
        let state = 'OPEN';
        if (m.status === MARKET_STATUS.SETTLED || m.status === MARKET_STATUS.VOID) {
          state = settle ? (settle.txnType === TXN_TYPE.REFUND ? 'REFUNDED' : 'WON') : 'LOST';
        }
        return {
          txnId: t.txnId,
          timestamp: iso(t.timestamp),
          marketTitle: { en: m.titleEn || t.marketId, pt: m.titlePt || m.titleEn || t.marketId },
          mode: m.mode,
          outcomeLabel: { en: oc.labelEn || t.outcomeId, pt: oc.labelPt || oc.labelEn || t.outcomeId },
          stake: -Number(t.amount),
          oddsAtEntry: num(t.oddsAtEntry, null),
          state,
          returned: settle ? Number(settle.amount) : 0,
        };
      })
      .reverse();

    return { userId, balance: balanceOf(userId, ledger), bets };
  }

  /**
   * What a bet would look like right now.
   * HOUSE: odds are locked at entry, so the payout is known.
   * P2P: odds keep moving until the market closes, so we return an estimate
   * (with display seed) and the real "if it closed now" value (no seed).
   */
  function previewBet(marketId, outcomeId, stake) {
    const settings = Repo.settings();
    const market = findMarket(marketId);
    const outcomes = outcomesOf(marketId);
    if (!outcomes.some((o) => o.outcomeId === outcomeId)) fail('OUTCOME_NOT_FOUND');
    const s = cleanStake(stake, settings);
    const ledger = Repo.readAll(SHEET.LEDGER);
    const extra = { outcomeId, stake: s };

    const odds = quote(market, outcomes, ledger, settings, { extra })[outcomeId];
    if (!odds) fail('NO_PRICE');
    const res = {
      mode: market.mode,
      stake: s,
      odds,
      price: Odds.priceFromOdds(odds),
      shares: s * odds, // 1 share pays 1.00, so shares = stake / price
      potentialReturn: Odds.fromCents(Math.floor(Odds.toCents(s) * odds)),
    };
    if (market.mode === MARKET_MODE.P2P) {
      const now = quote(market, outcomes, ledger, settings, { extra, seed: 0 })[outcomeId];
      res.oddsIfClosedNow = now;
      res.returnIfClosedNow = Odds.fromCents(Math.floor(Odds.toCents(s) * now));
    }
    return res;
  }

  // ---------- writes ----------

  function placeBet(userId, marketId, outcomeId, stake) {
    return withLock(() => {
      const settings = Repo.settings();
      findActiveUser(userId);
      const market = findMarket(marketId);
      if (effectiveStatus(market) !== MARKET_STATUS.OPEN) fail('MARKET_NOT_OPEN');
      const outcomes = outcomesOf(marketId);
      if (!outcomes.some((o) => o.outcomeId === outcomeId)) fail('OUTCOME_NOT_FOUND');
      const s = cleanStake(stake, settings);
      const ledger = Repo.readAll(SHEET.LEDGER);
      if (balanceOf(userId, ledger) < s) fail('INSUFFICIENT_BALANCE');

      // HOUSE: locked price. P2P: estimate at entry, kept for the audit trail only.
      const opts = market.mode === MARKET_MODE.P2P ? { extra: { outcomeId, stake: s } } : {};
      const odds = quote(market, outcomes, ledger, settings, opts)[outcomeId];
      if (!odds) fail('NO_PRICE');

      const txnId = Repo.nextId(SHEET.LEDGER, 'TX', 6);
      Repo.append(SHEET.LEDGER, ledgerRow({
        txnId,
        accountId: userId,
        txnType: TXN_TYPE.BET,
        marketId,
        outcomeId,
        amount: -s,
        oddsAtEntry: Math.round(odds * 10000) / 10000,
        priceAtEntry: Math.round(Odds.priceFromOdds(odds) * 10000) / 10000,
        notes: market.mode === MARKET_MODE.P2P ? 'P2P: odds at entry are an estimate' : 'HOUSE: odds locked',
      }));
      return { txnId, balance: balanceOf(userId, Repo.readAll(SHEET.LEDGER)) };
    });
  }

  function grantCredits(userId, amount, note) {
    return withLock(() => {
      findActiveUser(userId);
      const a = Number(amount);
      if (!isFinite(a) || a === 0) fail('INVALID_AMOUNT');
      Repo.append(SHEET.LEDGER, ledgerRow({
        txnId: Repo.nextId(SHEET.LEDGER, 'TX', 6),
        accountId: userId,
        txnType: a > 0 ? TXN_TYPE.DEPOSIT : TXN_TYPE.ADJUSTMENT,
        amount: a,
        notes: note || 'Play credits',
      }));
    });
  }

  function closeMarket(marketId) {
    return withLock(() => {
      const m = findMarket(marketId);
      if (m.status !== MARKET_STATUS.OPEN) fail('MARKET_NOT_OPEN');
      Repo.update(SHEET.MARKETS, m._row, { status: MARKET_STATUS.CLOSED });
    });
  }

  /** Writes PAYOUT / REFUND rows and one FEE or HOUSE_PNL row, then marks the market final. */
  function finalize(marketId, winningOutcomeId, isVoid) {
    return withLock(() => {
      const settings = Repo.settings();
      const m = findMarket(marketId);
      if (m.status === MARKET_STATUS.SETTLED || m.status === MARKET_STATUS.VOID) fail('MARKET_ALREADY_FINAL');
      if (!isVoid && !outcomesOf(marketId).some((o) => o.outcomeId === winningOutcomeId)) fail('OUTCOME_NOT_FOUND');

      const bets = postedBets(Repo.readAll(SHEET.LEDGER), marketId);
      let result;
      if (isVoid) result = Odds.refundAll(bets);
      else if (m.mode === MARKET_MODE.HOUSE) result = Odds.settleHouse(bets, winningOutcomeId);
      else result = Odds.settleP2P(bets, winningOutcomeId, feeOf(m, settings));

      const rows = [];
      result.payouts.forEach((p) => rows.push(ledgerRow({
        accountId: p.accountId, txnType: TXN_TYPE.PAYOUT, marketId, outcomeId: winningOutcomeId,
        amount: p.amount, relatedTxnId: p.txnId,
        oddsAtEntry: result.odds ? Math.round(result.odds * 10000) / 10000 : '',
        notes: result.odds ? 'Final P2P odds' : 'Paid at locked odds',
      })));
      result.refunds.forEach((r) => rows.push(ledgerRow({
        accountId: r.accountId, txnType: TXN_TYPE.REFUND, marketId,
        amount: r.amount, relatedTxnId: r.txnId,
        notes: isVoid ? 'Market void' : 'Nobody backed the winner',
      })));
      if (bets.length && !isVoid && !result.refunds.length) {
        rows.push(ledgerRow({
          accountId: settings.HOUSE_ACCOUNT_ID,
          txnType: m.mode === MARKET_MODE.HOUSE ? TXN_TYPE.HOUSE_PNL : TXN_TYPE.FEE,
          marketId,
          amount: result.houseAmount,
          notes: m.mode === MARKET_MODE.HOUSE ? 'House result (stakes - payouts)' : 'House fee + breakage',
        }));
      }
      rows.forEach((r, i) => { r.txnId = Repo.nextId(SHEET.LEDGER, 'TX', 6, i); });
      Repo.appendMany(SHEET.LEDGER, rows);

      Repo.update(SHEET.MARKETS, m._row, {
        status: isVoid ? MARKET_STATUS.VOID : MARKET_STATUS.SETTLED,
        winningOutcomeId: isVoid ? '' : winningOutcomeId,
        settledAt: new Date(),
      });
      return { rows: rows.length, houseAmount: result.houseAmount, odds: result.odds };
    });
  }

  const settleMarket = (marketId, winningOutcomeId) => finalize(marketId, winningOutcomeId, false);
  const voidMarket = (marketId) => finalize(marketId, '', true);

  /**
   * Integrity checks:
   * - every SETTLED / VOID market sums to exactly zero across all accounts;
   * - no user balance is negative.
   */
  function audit() {
    const ledger = Repo.readAll(SHEET.LEDGER).filter((t) => t.status === TXN_STATUS.POSTED);
    const issues = [];
    const lines = [];
    Repo.readAll(SHEET.MARKETS).forEach((m) => {
      const cents = ledger.filter((t) => t.marketId === m.marketId)
        .reduce((acc, t) => acc + Odds.toCents(t.amount), 0);
      const final = m.status === MARKET_STATUS.SETTLED || m.status === MARKET_STATUS.VOID;
      lines.push(m.marketId + ' [' + m.status + '] net ' + Odds.fromCents(cents));
      if (final && cents !== 0) issues.push(m.marketId + ' does not sum to zero: ' + Odds.fromCents(cents));
    });
    Repo.readAll(SHEET.USERS).forEach((u) => {
      const b = balanceOf(u.userId, ledger);
      if (b < 0) issues.push(u.userId + ' has a negative balance: ' + b);
    });
    const settings = Repo.settings();
    lines.push('House balance: ' + balanceOf(settings.HOUSE_ACCOUNT_ID, ledger));
    return { ok: issues.length === 0, issues, lines };
  }

  return {
    listUsers, listMarkets, account, previewBet, placeBet,
    grantCredits, closeMarket, settleMarket, voidMarket, audit,
    findMarket, outcomesOf,
  };
})();
