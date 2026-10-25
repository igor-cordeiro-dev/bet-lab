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

function api_bootstrap() {
  return { app: APP, users: Service.listUsers(), markets: Service.listMarkets() };
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
