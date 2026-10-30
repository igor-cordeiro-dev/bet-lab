/**
 * Bet Lab — experimental learning project. Play credits only, no real money.
 *
 * Central configuration: sheet names, headers, enums and default settings.
 *
 * @OnlyCurrentDoc  Limits the script to the spreadsheet it is bound to.
 */

const APP = Object.freeze({
  name: 'Bet Lab',
  version: '0.3.0',
});

const SHEET = Object.freeze({
  README: 'Readme',
  SETTINGS: 'Settings',
  USERS: 'Users',
  MARKETS: 'Markets',
  OUTCOMES: 'Outcomes',
  LEDGER: 'Ledger',
  ORDERS: 'Orders',
});

// Header row of every data tab. Repo.js maps "Market Id" <-> "marketId".
const HEADERS = Object.freeze({
  [SHEET.SETTINGS]: ['Key', 'Value', 'Description'],
  [SHEET.USERS]: ['User Id', 'Display Name', 'Status', 'Created At'],
  [SHEET.MARKETS]: [
    'Market Id', 'Title En', 'Title Pt', 'Mode', 'Status', 'House Fee Pct',
    'Seed Per Outcome', 'Closes At', 'Winning Outcome Id', 'Settled At', 'Created At',
    'Liquidity B',
  ],
  [SHEET.OUTCOMES]: [
    'Outcome Id', 'Market Id', 'Label En', 'Label Pt', 'House Probability', 'Sort Order',
  ],
  [SHEET.LEDGER]: [
    'Txn Id', 'Timestamp', 'Account Id', 'Txn Type', 'Market Id', 'Outcome Id',
    'Amount', 'Odds At Entry', 'Price At Entry', 'Related Txn Id', 'Status', 'Notes',
    'Shares',
  ],
  // Limit orders (LMSR markets). Not money movements: each fill posts a BET row to
  // the Ledger. Budget - Spent of an open order is reserved from the user's balance.
  [SHEET.ORDERS]: [
    'Order Id', 'Created At', 'User Id', 'Market Id', 'Outcome Id', 'Limit Price',
    'Budget', 'Spent', 'Shares', 'Status', 'Expires At', 'Updated At', 'Notes',
  ],
});
// New columns are only ever appended at the end, so existing sheets keep working.

const MARKET_MODE = Object.freeze({
  P2P: 'P2P',     // users vs users, pari-mutuel pool
  HOUSE: 'HOUSE', // house sets prices and is the counterparty
  LMSR: 'LMSR',   // automated market maker: damped, money-driven prices locked at purchase
});

const MARKET_STATUS = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',   // no new bets, waiting for result
  SETTLED: 'SETTLED',
  VOID: 'VOID',       // cancelled, all stakes refunded
});

const USER_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED' });

// Amount is always signed from the point of view of Account Id.
const TXN_TYPE = Object.freeze({
  DEPOSIT: 'DEPOSIT',       // play credits granted by admin (+)
  BET: 'BET',               // stake leaves the user (-)
  PAYOUT: 'PAYOUT',         // winnings to the user (+)
  REFUND: 'REFUND',         // stake returned on void (+)
  FEE: 'FEE',               // P2P house fee, to the house account (+)
  HOUSE_PNL: 'HOUSE_PNL',   // HOUSE-mode result, to the house account (+/-)
  ADJUSTMENT: 'ADJUSTMENT', // manual correction (+/-)
});

const TXN_STATUS = Object.freeze({ POSTED: 'POSTED', REVERSED: 'REVERSED' });

const ORDER_STATUS = Object.freeze({
  OPEN: 'OPEN',           // resting, budget reserved
  FILLED: 'FILLED',       // budget fully spent
  CANCELLED: 'CANCELLED', // by the user, or the market stopped taking bets
  EXPIRED: 'EXPIRED',     // Expires At passed
});

// Seeded into the Settings tab by setup. The sheet is the source of truth afterwards.
const DEFAULT_SETTINGS = Object.freeze([
  ['HOUSE_ACCOUNT_ID', 'HOUSE', 'Ledger account that receives fees and house P&L'],
  ['DEFAULT_HOUSE_FEE_PCT', 0.03, 'Fee used for new markets (0 = no house fee). Hidden from users'],
  ['DEFAULT_SEED_PER_OUTCOME', 50, 'Virtual credits per outcome, P2P display odds only'],
  ['STARTING_CREDITS', 1000, 'Play credits granted to demo users'],
  ['MIN_STAKE', 1, 'Smallest bet allowed'],
  ['MAX_STAKE', 500, 'Largest single bet allowed'],
  ['MAX_PRICE', 0.99, 'HOUSE mode: cap on price per share (keeps odds above 1.01)'],
  ['DEFAULT_LIQUIDITY_B', 300, 'LMSR mode: liquidity b. Higher = calmer prices, house max loss = b x ln(outcomes)'],
]);

const NUMERIC_SETTING_RANGES = Object.freeze({
  DEFAULT_HOUSE_FEE_PCT: [0, 0.5],
  DEFAULT_SEED_PER_OUTCOME: [0, 1e6],
  STARTING_CREDITS: [0, 1e6],
  MIN_STAKE: [0.01, 1e6],
  MAX_STAKE: [0.01, 1e6],
  MAX_PRICE: [0.5, 0.999],
  DEFAULT_LIQUIDITY_B: [10, 1e6],
});

const DISCLAIMER = Object.freeze({
  en: 'Experimental learning project. Play credits only — no real money, no prizes, not offered to the public.',
  pt: 'Projeto experimental de aprendizado. Apenas créditos fictícios — sem dinheiro real, sem prêmios, não oferecido ao público.',
});
