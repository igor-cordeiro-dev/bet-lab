# Bet Lab

> **⚠️ Experimental learning project — not a betting service.**
> Bet Lab is a personal sandbox for studying how betting markets work
> (odds, implied probability, pari-mutuel pools, house margin, ledgers).
> It uses **play credits only**. There is no real money, no deposits, no
> withdrawals, and no prizes of any value. It is not offered to the public.
>
> **⚠️ Projeto experimental de aprendizado — não é uma casa de apostas.**
> O Bet Lab é um laboratório pessoal para estudar como mercados de aposta
> funcionam (odds, probabilidade implícita, pools pari-mutuel, margem da casa,
> livro-razão). Usa **apenas créditos fictícios**. Não há dinheiro real,
> depósitos, saques nem prêmios de qualquer valor. Não é oferecido ao público.

Built with **Google Sheets** (database + audit ledger) and **Google Apps Script**
(backend + web app). Backend is 100% English; the web app UI is available in
English and Portuguese.

## Features (v0.3)

| Area | What it does |
| --- | --- |
| Market modes | `P2P` — users bet against each other in a pool (pari-mutuel). `HOUSE` — the house sets the prices and is the counterparty. `LMSR` — automated market maker: prices driven by bettors' money but damped by a liquidity parameter, locked at purchase, house loss capped at `b × ln(outcomes)`. |
| Limit orders | On LMSR markets: buy only at or below a price, with a budget and optional expiry. Budget is reserved, fills happen automatically (possibly in parts) as other trades move the price, cancel any time. |
| Admin view | Owner-only tab in the web app: ledger audit, KPIs, house risk per outcome, create / close / settle / void markets, users and credits, settings. |
| Odds formats | Decimal odds (e.g. `2.50`) or prediction-market style (probability `40%` / price `0.40` per share that pays `1.00`). |
| House fee | Per market, `0%` or more. Baked into the displayed odds and never shown to users. |
| Ledger | Every movement of credits is one row: `BET`, `PAYOUT`, `REFUND`, `FEE`, `HOUSE_PNL`, `DEPOSIT`, `ADJUSTMENT`. Each settled market sums to zero. |
| Admin | Spreadsheet menu **Bet Lab**: set up tabs, load demo data, grant credits, close / settle / void markets, run audit. |
| No cash-out | Bets stay live until the market settles. |

See [docs/MODEL.md](docs/MODEL.md) for the math and [docs/SETUP.md](docs/SETUP.md)
to run it yourself.

## Repository layout

```
src/               Apps Script project (pushed with clasp)
  appsscript.json  Manifest
  Config.js        Sheet names, headers, enums, defaults
  Odds.js          Pure odds, LMSR, limit-order matching, settlement (also runs in Node)
  Repo.js          Sheet read/write helpers
  Service.js       Business rules: quotes, bets, settlement, audit
  Admin.js         Spreadsheet menu (admin-only actions)
  WebApp.js        doGet + api_* functions called by the UI
  Index.html       Web app shell
  Styles.html      CSS
  I18n.html        UI strings (en, pt)
  Client.html      Front-end logic (bettor view)
  AdminClient.html Front-end logic (admin view)
tests/             Node tests: odds math + end-to-end backend on a mock sheet
tools/             Apps Script mock, local preview server, deploy bundler
docs/              Model and setup notes
```

## Quick start

```bash
npm test          # no Google account needed
npm run preview   # http://localhost:8787 with demo data
npm run bundle    # dist/Code.gs + dist/Index.html to paste into Apps Script
```

## License

MIT — see [LICENSE](LICENSE).
