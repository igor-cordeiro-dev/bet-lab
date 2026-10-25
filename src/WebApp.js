/**
 * Web app entry point and the api_* functions the UI calls with google.script.run.
 * Only these top-level functions are meant for the browser; they never return
 * house fees or raw pool sizes.
 */

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appVersion = APP.version;
  return t.evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Used by templates: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Admin = the person viewing the app is the script owner. Fails closed: if Google
 * does not reveal the viewer's email (e.g. a consumer account opening someone
 * else's app), the viewer is not admin.
 */
function isAdmin_() {
  const viewer = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  return Boolean(viewer) && viewer === owner;
}

function requireAdmin_() {
  if (!isAdmin_()) throw new Error('NOT_ADMIN');
}

function api_bootstrap() {
  return { app: APP, users: Service.listUsers(), markets: Service.listMarkets(), isAdmin: isAdmin_() };
}

function api_markets() {
  return Service.listMarkets();
}

function api_account(userId) {
  return Service.account(userId);
}

function api_previewBet(marketId, outcomeId, stake) {
  return Service.previewBet(marketId, outcomeId, stake);
}

function api_placeBet(userId, marketId, outcomeId, stake) {
  return Service.placeBet(userId, marketId, outcomeId, stake);
}

// ---------- admin (owner only) ----------

function api_adminOverview() {
  requireAdmin_();
  return Service.adminOverview();
}

function api_adminUpdateSetting(key, value) {
  requireAdmin_();
  return Service.updateSetting(key, value);
}

function api_adminCreateMarket(input) {
  requireAdmin_();
  return Service.createMarket(input);
}

function api_adminAddUser(displayName) {
  requireAdmin_();
  return Service.addUser(displayName);
}

function api_adminGrantCredits(userId, amount) {
  requireAdmin_();
  return Service.grantCredits(userId, amount, 'Admin grant (web)');
}

function api_adminCloseMarket(marketId) {
  requireAdmin_();
  return Service.closeMarket(marketId);
}

function api_adminSettleMarket(marketId, winningOutcomeId) {
  requireAdmin_();
  return Service.settleMarket(marketId, winningOutcomeId);
}

function api_adminVoidMarket(marketId) {
  requireAdmin_();
  return Service.voidMarket(marketId);
}
