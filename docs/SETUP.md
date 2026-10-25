# Setup

## 1. Local tools (once)

```bash
npm install -g @google/clasp
clasp login
```

Turn on the **Google Apps Script API** for your account:
<https://script.google.com/home/usersettings>.

## 2. Try it locally (no Google account needed)

```bash
npm test          # odds math + end-to-end backend tests on an in-memory sheet
npm run preview   # web app with demo data on http://localhost:8787
```

## 3. Create the spreadsheet and its script

From the repository root:

```bash
clasp create-script --type sheets --title "Bet Lab" --rootDir src
```

This creates a new Google Sheet in your Drive with a bound Apps Script project
and writes `.clasp.json` (git-ignored). If clasp replaced `src/appsscript.json`,
restore ours and push:

```bash
git checkout -- src/appsscript.json
clasp push
```

Already have a sheet? Open it, go to **Extensions > Apps Script**, copy the
script id from **Project Settings**, and create `.clasp.json` from
`.clasp.json.example`.

## 4. Initialise the sheet

1. Open the spreadsheet and reload it. A **Bet Lab** menu appears.
2. **Bet Lab > Set up sheets** (authorise the script the first time).
3. **Bet Lab > Load demo data** (optional).

## 5. Deploy the web app

In the Apps Script editor (`npm run open`): **Deploy > New deployment > Web app**

- Execute as: **Me**
- Who has access: **Only myself** (v0.1 has no real login; keep it private)

**Bet Lab > Open web app URL** shows the link afterwards. After code changes,
`clasp push` and update the deployment (**Deploy > Manage deployments > Edit > New version**),
or use the `/dev` test URL, which always runs the latest pushed code.

## 6. Operating a market

| Action | How |
| --- | --- |
| New market | Add a row to `Markets` (Mode `P2P` or `HOUSE`, Status `OPEN`) and its rows to `Outcomes`. Leave `House Fee Pct` empty to use the default, `0` for no fee. HOUSE markets need `House Probability` per outcome. |
| Give credits | **Bet Lab > Grant play credits** |
| Stop new bets | **Bet Lab > Close market** (or set `Closes At`) |
| Settle | **Bet Lab > Settle market**, then the winning `Outcome Id` |
| Cancel | **Bet Lab > Void market** — refunds every stake |
| Check | **Bet Lab > Run audit** |

Never edit or delete `Ledger` rows by hand; post an `ADJUSTMENT` instead.

## 7. GitHub

What stays out of the repo (see `.gitignore`): `.clasp.json` (your script id)
and `.clasprc.json` (your OAuth token). There are no other secrets in the code.
