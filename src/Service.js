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

  function liquidityOf(market, settings) {
    return Math.max(10, num(market.liquidityB, num(settings.DEFAULT_LIQUIDITY_B, 300)));
  }

  /** LMSR state: shares sold per outcome. */
  function sharesByOutcome(ledger, marketId, outcomes) {
    const q = {};
    outcomes.forEach((oc) => { q[oc.outcomeId] = 0; });
    postedBets(ledger, marketId).forEach((b) => {
      if (b.outcomeId in q) q[b.outcomeId] += Odds.sharesOf(b);
    });
    return q;
  }

  const round6 = (x) => Math.round(x * 1e6) / 1e6;

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
        shares: num(t.shares, null),
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
    if (market.mode === MARKET_MODE.LMSR) {
      return Odds.lmsrOdds(sharesByOutcome(ledger, market.marketId, outcomes), liquidityOf(market, settings), fee);
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
   * Price a bet of `stake` on `outcomeId` against the current book.
   * HOUSE / LMSR: odds and shares are locked at entry (1 share pays 1.00).
   * P2P: odds are an estimate (display seed included) and keep moving until close.
   * priceBefore / priceAfter show how much this bet moves the market.
   */
  function priceBet(market, outcomes, ledger, settings, outcomeId, stake) {
    const before = quote(market, outcomes, ledger, settings)[outcomeId];
    if (market.mode === MARKET_MODE.LMSR) {
      const q = sharesByOutcome(ledger, market.marketId, outcomes);
      const r = Odds.lmsrBuy(q, liquidityOf(market, settings), outcomeId, stake, feeOf(market, settings));
      return { odds: r.odds, shares: r.shares, priceBefore: r.priceBefore, priceAfter: r.priceAfter };
    }
    const odds = market.mode === MARKET_MODE.P2P
      ? quote(market, outcomes, ledger, settings, { extra: { outcomeId, stake } })[outcomeId]
      : before;
    if (!odds) fail('NO_PRICE');
    return {
      odds,
      shares: stake * odds,
      priceBefore: Odds.priceFromOdds(before),
      priceAfter: Odds.priceFromOdds(odds),
    };
  }

  /** What a bet would look like right now (see priceBet). */
  function previewBet(marketId, outcomeId, stake) {
    const settings = Repo.settings();
    const market = findMarket(marketId);
    const outcomes = outcomesOf(marketId);
    if (!outcomes.some((o) => o.outcomeId === outcomeId)) fail('OUTCOME_NOT_FOUND');
    const s = cleanStake(stake, settings);
    const ledger = Repo.readAll(SHEET.LEDGER);
    const p = priceBet(market, outcomes, ledger, settings, outcomeId, s);

    const res = {
      mode: market.mode,
      stake: s,
      odds: p.odds,
      price: Odds.priceFromOdds(p.odds),
      shares: p.shares,
      priceBefore: p.priceBefore,
      priceAfter: p.priceAfter,
      potentialReturn: Odds.fromCents(Math.floor(Math.round(p.shares * 1e6) / 1e4)),
    };
    if (market.mode === MARKET_MODE.P2P) {
      const extra = { outcomeId, stake: s };
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

      // HOUSE / LMSR: locked price and shares. P2P: estimate at entry, kept for the audit trail only.
      const p = priceBet(market, outcomes, ledger, settings, outcomeId, s);
      const isPool = market.mode === MARKET_MODE.P2P;

      const txnId = Repo.nextId(SHEET.LEDGER, 'TX', 6);
      Repo.append(SHEET.LEDGER, ledgerRow({
        txnId,
        accountId: userId,
        txnType: TXN_TYPE.BET,
        marketId,
        outcomeId,
        amount: -s,
        oddsAtEntry: Math.round(p.odds * 10000) / 10000,
        priceAtEntry: Math.round(Odds.priceFromOdds(p.odds) * 10000) / 10000,
        shares: isPool ? '' : round6(p.shares),
        notes: isPool ? 'P2P: odds at entry are an estimate' : market.mode + ': odds locked',
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
      const isPool = m.mode === MARKET_MODE.P2P;
      if (isVoid) result = Odds.refundAll(bets);
      else if (isPool) result = Odds.settleP2P(bets, winningOutcomeId, feeOf(m, settings));
      else result = Odds.settleHouse(bets, winningOutcomeId);

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
          txnType: isPool ? TXN_TYPE.FEE : TXN_TYPE.HOUSE_PNL,
          marketId,
          amount: result.houseAmount,
          notes: isPool ? 'House fee + breakage' : 'House result (stakes - payouts)',
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

  // ---------- admin (callers must check the user is the owner) ----------

  const sumBy = (xs, f) => Odds.fromCents(xs.reduce((acc, x) => acc + Odds.toCents(f(x)), 0));
  const isLive = (status) => status === MARKET_STATUS.OPEN || status === MARKET_STATUS.CLOSED;

  /** Everything the admin view needs: KPIs, per-market risk, users, settings, audit. */
  function adminOverview() {
    const settings = Repo.settings();
    const ledger = Repo.readAll(SHEET.LEDGER);
    const posted = ledger.filter((t) => t.status === TXN_STATUS.POSTED);
    const allOutcomes = Repo.readAll(SHEET.OUTCOMES);
    const houseId = settings.HOUSE_ACCOUNT_ID;

    const markets = Repo.readAll(SHEET.MARKETS).map((m) => {
      const status = effectiveStatus(m);
      const outcomes = outcomesOf(m.marketId, allOutcomes);
      const bets = postedBets(ledger, m.marketId);
      const fee = feeOf(m, settings);
      const live = isLive(status);
      const odds = live && outcomes.length ? quote(m, outcomes, ledger, settings) : {};
      const pool = m.mode === MARKET_MODE.P2P;
      const byOutcome = outcomes.map((oc) => {
        const mine = bets.filter((b) => b.outcomeId === oc.outcomeId);
        const settle = pool ? Odds.settleP2P(bets, oc.outcomeId, fee) : Odds.settleHouse(bets, oc.outcomeId);
        return {
          outcomeId: oc.outcomeId,
          label: { en: oc.labelEn, pt: oc.labelPt || oc.labelEn },
          bets: mine.length,
          stake: sumBy(mine, (b) => b.stake),
          liability: pool ? null : Math.round(mine.reduce((a, b) => a + Odds.sharesOf(b), 0) * 100) / 100,
          odds: odds[oc.outcomeId] || null,
          housePnlIfWins: settle.houseAmount,
        };
      });
      const houseRows = posted.filter((t) => t.marketId === m.marketId && t.accountId === houseId);
      const b = liquidityOf(m, settings);
      return {
        marketId: m.marketId,
        title: { en: m.titleEn, pt: m.titlePt || m.titleEn },
        mode: m.mode,
        status,
        feePct: fee,
        seed: pool ? seedOf(m, settings) : null,
        liquidityB: m.mode === MARKET_MODE.LMSR ? b : null,
        maxLoss: m.mode === MARKET_MODE.LMSR ? Math.round(Odds.lmsrMaxLoss(b, outcomes.length) * 100) / 100 : null,
        closesAt: iso(m.closesAt),
        winningOutcomeId: m.winningOutcomeId || '',
        bets: bets.length,
        handle: sumBy(bets, (x) => x.stake),
        worstCase: live && bets.length ? Math.min(...byOutcome.map((o) => o.housePnlIfWins)) : null,
        result: live ? null : sumBy(houseRows, (t) => t.amount),
        outcomes: byOutcome,
      };
    });

    const liveMarketIds = markets.filter((m) => isLive(m.status)).map((m) => m.marketId);
    const users = Repo.readAll(SHEET.USERS).map((u) => {
      const mine = posted.filter((t) => t.accountId === u.userId);
      const balance = sumBy(mine, (t) => t.amount);
      const funded = sumBy(mine.filter((t) => t.txnType === TXN_TYPE.DEPOSIT || t.txnType === TXN_TYPE.ADJUSTMENT), (t) => t.amount);
      const openStakes = sumBy(mine.filter((t) => t.txnType === TXN_TYPE.BET && liveMarketIds.indexOf(t.marketId) !== -1), (t) => -t.amount);
      return {
        userId: u.userId,
        displayName: u.displayName,
        status: u.status,
        balance,
        openStakes,
        settledPnl: Odds.fromCents(Odds.toCents(balance) + Odds.toCents(openStakes) - Odds.toCents(funded)),
        bets: mine.filter((t) => t.txnType === TXN_TYPE.BET).length,
      };
    });

    const sheetSettings = {};
    Repo.readAll(SHEET.SETTINGS).forEach((r) => { sheetSettings[r.key] = r.description; });
    const live = markets.filter((m) => isLive(m.status));
    return {
      kpis: {
        users: users.length,
        creditsHeld: sumBy(users, (u) => u.balance),
        houseBalance: balanceOf(houseId, ledger),
        openMarkets: live.length,
        handleAllTime: sumBy(markets, (m) => m.handle),
        openHandle: sumBy(live, (m) => m.handle),
        worstCaseOpen: sumBy(live, (m) => Math.min(0, m.worstCase || 0)),
        transactions: posted.length,
      },
      markets,
      users,
      settings: DEFAULT_SETTINGS.map(([key, , description]) => ({
        key,
        value: settings[key],
        description: sheetSettings[key] || description,
        editable: Object.prototype.hasOwnProperty.call(NUMERIC_SETTING_RANGES, key),
      })),
      audit: audit(),
    };
  }

  function updateSetting(key, value) {
    return withLock(() => {
      const range = NUMERIC_SETTING_RANGES[key];
      if (!range) fail('SETTING_NOT_EDITABLE');
      const v = Number(value);
      if (!isFinite(v) || v < range[0] || v > range[1]) fail('INVALID_SETTING_VALUE');
      const current = Repo.settings();
      if (key === 'MIN_STAKE' && v > num(current.MAX_STAKE, Infinity)) fail('INVALID_SETTING_VALUE');
      if (key === 'MAX_STAKE' && v < num(current.MIN_STAKE, 0)) fail('INVALID_SETTING_VALUE');
      const row = Repo.readAll(SHEET.SETTINGS).find((r) => r.key === key);
      if (row) Repo.update(SHEET.SETTINGS, row._row, { value: v });
      else Repo.append(SHEET.SETTINGS, { key, value: v, description: '' });
      return { key, value: v };
    });
  }

  const text = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);

  function nextNumber(rows, field, prefix) {
    const re = new RegExp('^' + prefix + '-(\\d+)$');
    return 1 + rows.reduce((max, r) => {
      const m = re.exec(String(r[field]));
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  }

  /**
   * @param {{titleEn, titlePt, mode, houseFeePct, seedPerOutcome, liquidityB, closesAt,
   *          outcomes: {labelEn, labelPt, houseProbability}[]}} input
   */
  function createMarket(input) {
    return withLock(() => {
      const i = input || {};
      const titleEn = text(i.titleEn, 140);
      if (!titleEn) fail('MISSING_TITLE');
      if (!MARKET_MODE[i.mode]) fail('INVALID_MODE');
      const optNum = (v, lo, hi) => {
        if (v === '' || v === null || v === undefined) return '';
        const n = Number(v);
        if (!isFinite(n) || n < lo || n > hi) fail('INVALID_NUMBER');
        return n;
      };
      const fee = optNum(i.houseFeePct, 0, 0.5);
      const seed = optNum(i.seedPerOutcome, 0, 1e6);
      const b = optNum(i.liquidityB, 10, 1e6);
      let closesAt = '';
      if (i.closesAt) {
        closesAt = new Date(i.closesAt);
        if (isNaN(closesAt.getTime()) || closesAt <= new Date()) fail('INVALID_CLOSE_DATE');
      }
      const outcomes = (i.outcomes || [])
        .map((o) => ({ labelEn: text(o.labelEn, 60), labelPt: text(o.labelPt, 60), p: o.houseProbability }))
        .filter((o) => o.labelEn);
      if (outcomes.length < 2 || outcomes.length > 10) fail('INVALID_OUTCOMES');
      if (i.mode === MARKET_MODE.HOUSE && outcomes.some((o) => !(Number(o.p) > 0))) fail('MISSING_PROBABILITIES');

      const marketId = 'MKT-' + String(nextNumber(Repo.readAll(SHEET.MARKETS), 'marketId', 'MKT')).padStart(3, '0');
      Repo.append(SHEET.MARKETS, {
        marketId, titleEn, titlePt: text(i.titlePt, 140), mode: i.mode, status: MARKET_STATUS.OPEN,
        houseFeePct: fee, seedPerOutcome: i.mode === MARKET_MODE.P2P ? seed : '',
        liquidityB: i.mode === MARKET_MODE.LMSR ? b : '', closesAt, createdAt: new Date(),
      });
      Repo.appendMany(SHEET.OUTCOMES, outcomes.map((o, k) => ({
        outcomeId: marketId + '-' + (k + 1), marketId, labelEn: o.labelEn, labelPt: o.labelPt,
        houseProbability: i.mode === MARKET_MODE.HOUSE ? Number(o.p) : '', sortOrder: k + 1,
      })));
      return { marketId };
    });
  }

  function addUser(displayName) {
    return withLock(() => {
      const name = text(displayName, 40);
      if (!name) fail('MISSING_NAME');
      const settings = Repo.settings();
      const userId = 'U-' + String(nextNumber(Repo.readAll(SHEET.USERS), 'userId', 'U')).padStart(3, '0');
      Repo.append(SHEET.USERS, { userId, displayName: name, status: USER_STATUS.ACTIVE, createdAt: new Date() });
      const credits = num(settings.STARTING_CREDITS, 0);
      if (credits > 0) {
        Repo.append(SHEET.LEDGER, ledgerRow({
          txnId: Repo.nextId(SHEET.LEDGER, 'TX', 6), accountId: userId, txnType: TXN_TYPE.DEPOSIT,
          amount: credits, notes: 'Starting credits',
        }));
      }
      return { userId };
    });
  }

  return {
    listUsers, listMarkets, account, previewBet, placeBet,
    grantCredits, closeMarket, settleMarket, voidMarket, audit,
    adminOverview, updateSetting, createMarket, addUser,
    findMarket, outcomesOf,
  };
})();
