# Market model

Bet Lab is a learning project. All amounts are play credits.

## Odds formats

| Format | Example | Meaning |
| --- | --- | --- |
| Decimal | `2.50` | Total return per 1 credit staked (stake included). |
| Probability / price | `40% · 0.40` | Price of one share that pays `1.00` if the outcome wins. `price = 1 / decimal`. Stake 10 at 0.40 buys 25 shares → returns 25.00 if it wins. |

Both formats show the **same number**; the user only picks how to read it.

## Market modes

### `P2P` — users vs users (pari-mutuel pool)

There is no starting price: odds come only from where the money is.

```
odds_i = Σ_j (pool_j + seed) × (1 − fee) / (pool_i + seed)      (floored at 1.00)
```

- **Fee** (`House Fee Pct`) is taken from the pool before it is split, so the
  odds the user sees are already net of it. Nothing is deducted later.
- **Seed** is virtual money per outcome used *only for display*, so a brand-new
  market shows sensible odds (`seed=50` on 2 outcomes → `2.00 / 2.00` with no fee).
  Settlement never uses it.
- **Odds move until the market closes.** Every new bet changes them. The odds
  recorded on a bet (`Odds At Entry`) are an estimate for the audit trail; the
  final payout uses the final pool:

```
final_odds = total_pool × (1 − fee) / winner_pool
payout     = floor_to_cent(stake × final_odds)
house      = total_pool − Σ payouts          (fee + rounding "breakage")
```

- If nobody backed the winner, every stake is refunded and the house gets 0.
- Winners never get back less than their stake.

### `HOUSE` — the house sets the price and is the counterparty

The admin enters a fair probability (or any weights) per outcome in
`Outcomes > House Probability`.

```
price_i = min(p_i × (1 + fee), MAX_PRICE)      odds_i = 1 / price_i
```

- Prices sum to `1 + fee` (the "overround").
- **Odds are locked at entry**: the payout is known when the bet is placed.
- The house can lose: `HOUSE_PNL = Σ stakes − Σ payouts`.
- v0.1 prices are static (they do not react to bets).

### `LMSR` — automated market maker (damped, money-driven)

The problem with a pure pool: odds are `total / money on your side`, so a
1,000 bet into a 100 pool *is* the pool — the price jumps and the big bettor
dilutes himself. Damping needs someone to provide liquidity. In LMSR
(Logarithmic Market Scoring Rule, used by prediction markets) the house does,
with a known worst case.

```
q_i      = shares sold of outcome i (each pays 1.00 if i wins)
C(q)     = b × ln( Σ_j e^(q_j / b) )               cost function
price_i  = e^(q_i / b) / Σ_j e^(q_j / b)            prices sum to 1
buy      = pay C(q after) − C(q before)              closed form in Odds.lmsrSharesFor
```

- **b is the damping knob.** Larger b → calmer prices, more subsidy.
  Example, 2 outcomes at 50/50, one bet of 1,000:

  | b | Yes price after |
  | --- | --- |
  | 100 | ≈ 100% |
  | 300 | ≈ 98% |
  | 1,000 | ≈ 82% |
  | 3,000 | ≈ 64% |

- **Price locked at purchase**: the bet buys a fixed number of shares; the
  payout is known. The bet slip shows the price impact (e.g. `57% → 93%`).
- **Fee**: taken from the stake first, the rest buys shares. Displayed price = `price_i / (1 − fee)`.
- **House worst case = b × ln(n)** (minus fees collected). Example: b = 300, 2 outcomes → 207.94.
- Money still drives prices — no admin probabilities needed. Prices start equal.

## Is the fee really invisible?

The UI never shows the fee, the pools or the seed. But because odds are net of
the fee, the implied probabilities of all outcomes add up to more than 100%
(`1 / (1 − fee)` in P2P, `1 + fee` in HOUSE). That is true of every real
bookmaker and is a nice thing to observe while learning. With `fee = 0` the sum
is exactly 100%.

## Ledger

Every credit movement is one row in `Ledger`. `Amount` is signed from the point
of view of `Account Id`.

| Txn Type | Account | Sign | When |
| --- | --- | --- | --- |
| `DEPOSIT` | user | + | Admin grants play credits |
| `BET` | user | − | User places a bet |
| `PAYOUT` | user | + | Winning bet at settlement (`Related Txn Id` = bet) |
| `REFUND` | user | + | Market void, or nobody backed the winner |
| `FEE` | `HOUSE` | + | P2P settlement: fee + breakage |
| `HOUSE_PNL` | `HOUSE` | ± | HOUSE / LMSR settlement: stakes − payouts |
| `ADJUSTMENT` | any | ± | Manual correction (never edit old rows) |

**Invariant:** the rows of every settled or void market add up to exactly zero.
`Bet Lab > Run audit` checks it, plus "no negative balances".

Balances are never stored; they are always `Σ Amount` per account.

## Roadmap ideas

1. Real identities: deploy the web app for "Anyone with a Google account" and use the signed-in email instead of the demo user picker.
2. HOUSE odds that react to exposure (move the price when one side gets too much money).
3. Limits per user / per market, market close by trigger.
4. Selling shares back to an LMSR market before close (a cash-out by design choice — currently off).
