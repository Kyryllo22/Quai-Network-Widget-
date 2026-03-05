const DEBUG = true;
function log(...args) { if (DEBUG) console.log(...args); }
const SCRIPT_START = Date.now();
log("🚀 ========== SCRIPT EXECUTION START ==========");
log(`🕐 Start time: ${new Date(SCRIPT_START).toLocaleTimeString()}`);

const WIDGET_TIMEOUT = 8000;
const SAFETY_MARGIN = 1000;
const FETCH_DEADLINE = WIDGET_TIMEOUT - SAFETY_MARGIN;
function haveTime() { return Date.now() - SCRIPT_START < FETCH_DEADLINE; }
function timeLeft() { return Math.max(0, FETCH_DEADLINE - (Date.now() - SCRIPT_START)); }

let widgetHealth = { lastSuccess: Date.now(), consecutiveFails: 0, isThrottled: false };
let apiHealth = {};

try {
  const saved = Keychain.get("soap_widget_health");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed.lastSuccess === 'number') widgetHealth = parsed;
    log("✅ Widget health loaded from Keychain:", JSON.stringify(widgetHealth));
  } else log("🆕 Widget health initialized by default.");
} catch (e) { log("⚠️ Error reading widget health:", e.message); }

try {
  const saved = Keychain.get("soap_api_health");
  if (saved) {
    apiHealth = JSON.parse(saved) || {};
    log("✅ API statistics loaded from Keychain.");
  }
} catch (e) { log("⚠️ Error reading API statistics:", e.message); }

function saveHealth() { try { Keychain.set("soap_widget_health", JSON.stringify(widgetHealth)); } catch {} }
function saveApiHealth() { try { Keychain.set("soap_api_health", JSON.stringify(apiHealth)); } catch {} }

async function hasInternet() {
  log("🌐 Checking internet connection (ping 1.1.1.1)...");
  try {
    const req = new Request("https://1.1.1.1");
    req.timeoutInterval = 2;
    await req.load();
    log("✅ Internet is available.");
    return true;
  } catch {
    log("❌ No internet connection.");
    return false;
  }
}

function isLowPowerMode() { try { return Device.isLowPowerModeEnabled(); } catch { return false; } }

function shouldFetchWithHealth(type, firstRun = false) {
  const now = Date.now();
  const timeSinceLastSuccess = now - widgetHealth.lastSuccess;
  log(`🔍 shouldFetchWithHealth: type=${type}, firstRun=${firstRun}, time since last success=${(timeSinceLastSuccess/1000).toFixed(0)}s`);

  if (timeSinceLastSuccess > 7200000) {
    widgetHealth.isThrottled = true;
    log("⛔ Throttled mode: more than 2 hours without success. Loading only critical (price/burned).");
    return PRIO[type] === 0;
  }
  if (widgetHealth.consecutiveFails > 3) {
    log(`⚠️ Many consecutive failures (${widgetHealth.consecutiveFails}). Loading only critical.`);
    return PRIO[type] === 0;
  }
  if (timeSinceLastSuccess < 300000 && widgetHealth.consecutiveFails > 0) {
    log("⏱️ Too frequent, skipping update");
    return false;
  }
  const decision = shouldFetch(type, firstRun);
  log(`   --> Decision: ${decision ? "✅ fetch" : "⏸️ skip"}`);
  return decision;
}

function isSourceHealthy(source) {
  const h = apiHealth[source];
  if (!h) {
    log(`📊 Source ${source}: no statistics, considered healthy.`);
    return true;
  }
  const now = Date.now();
  if (h.failCount > 5 && (now - h.lastFail) < 3600000) {
    log(`⛔ Source ${source} temporarily disabled (${h.failCount} errors in the last hour).`);
    return false;
  }
  log(`📊 Source ${source}: healthy (errors: ${h.failCount || 0})`);
  return true;
}

function recordSourceFailure(source) {
  if (!apiHealth[source]) apiHealth[source] = { failCount: 0, lastFail: 0 };
  apiHealth[source].failCount++;
  apiHealth[source].lastFail = Date.now();
  log(`❌ Recorded failure for source ${source}. Total failures: ${apiHealth[source].failCount}`);
  saveApiHealth();
}
function recordSourceSuccess(source) {
  if (apiHealth[source]) {
    apiHealth[source].failCount = 0;
    log(`✅ Source ${source} reset error counter.`);
    saveApiHealth();
  }
}

let updateCycle = 0;
try {
  if (Keychain.contains("soap_update_cycle")) {
    const saved = Keychain.get("soap_update_cycle");
    const parsed = parseInt(saved, 10);
    updateCycle = !isNaN(parsed) ? (parsed + 1) % 3 : 0;
    log(`🔄 Previous cycle from Keychain: ${parsed}, new: ${updateCycle}`);
  } else {
    updateCycle = 0;
    log(`🔄 First run, cycle set to 0`);
  }
  Keychain.set("soap_update_cycle", updateCycle.toString());
} catch (e) { log("⚠️ Error with update cycle:", e.message); updateCycle = 0; }
log(`🔄 Final update cycle: ${updateCycle}`);

const PRIO = {
  price: 0, burnedBalance: 0,
  marketData: 1, miningInfo: 1,
  donorbtc: 1, donorbch: 1, donorltc: 1, donordoge: 1,
  donorrvn: 2,
  qiRate: 1,
  donorPrices: 1,
  soapData: 1
};
function shouldFetch(type, firstRun = false) {
  if (!haveTime()) {
    log(`⏳ shouldFetch: time out, skipping ${type}`);
    return false;
  }
  let p = PRIO[type] ?? 1;
  if (firstRun && p === 1) {
    log(`🎯 shouldFetch: first run, priority 1 (${type}) — fetching`);
    return true;
  }
  if (p === 0) {
    log(`🎯 shouldFetch: priority 0 (${type}) — always fetch`);
    return true;
  }
  if (p === 1) {
    const decision = (updateCycle === 0 || updateCycle === 2);
    log(`🎯 shouldFetch: priority 1 (${type}), cycle ${updateCycle} -> ${decision ? "fetch" : "skip"}`);
    return decision;
  }
  if (p === 2) {
    const decision = (updateCycle === 0);
    log(`🎯 shouldFetch: priority 2 (${type}), cycle ${updateCycle} -> ${decision ? "fetch" : "skip"}`);
    return decision;
  }
  return true;
}

const COLOR_PRICE_POSITIVE = new Color("#2CE6B0");
const COLOR_BURNED_ORANGE = new Color("#ff9500");
const THEME = {
  background: { primary: new Color("#1C1C1C", 0), surface: new Color("#1C1C1E") },
  text: { primary: new Color("#FFFFFF"), secondary: new Color("#EBEBF5", 0.7) },
};
log("🎨 Theme and colors loaded.");

const INDICATOR_WINDOW_MS = 6 * 60 * 60 * 1000;
const ROCKET_THRESHOLD = 1.10;
const FULLSCREEN_THRESHOLD = 1.30;
const FULLSCREEN_IMAGE_FILE = "fullscreen_bg.jpg";
const FULLSCREEN_IMAGE_URLS = [
  "https://s10.iimage.su/s/26/gHbGIarxn4rJ2WJ1eDW7KEIzzHf223drOSwvojBvJ.jpg",
  "https://img.ge/i/zsz1R92.jpg",
  "https://i.ibb.co/Z63PVQCc/Fon-Price.jpg"
];

function getBaseLayout() {
  return {
    outerPaddingTop: 17, outerPaddingBottom: 17, outerPaddingLeft: 17, outerPaddingRight: 17,
    spacingAfterPrice: 10, spacingAfterMetrics: 0, spacingAfterTitle: 0, spacingAfterHashrate: 10,
    priceContainerPaddingTop: 7.5, priceContainerPaddingBottom: 7.5,
    priceContainerPaddingLeft: 8, priceContainerPaddingRight: 8,
    metricsContainerPaddingTop: 11, metricsContainerPaddingBottom: 11,
    metricsContainerPaddingLeft: 8, metricsContainerPaddingRight: 8,
    hashrateContainerPaddingTop: 9, hashrateContainerPaddingBottom: 9,
    hashrateContainerPaddingLeft: 8, hashrateContainerPaddingRight: 8,
    burnContainerPaddingTop: 9, burnContainerPaddingBottom: 9,
    burnContainerPaddingLeft: 8, burnContainerPaddingRight: 8,
    fontSize: { price: 26, metric: 16, hashrate: 16, donorPercent: 11, algorithm: 12, burnValue: 18 },
    topLogoSize: 26, bottomLogoSize: 21,
    titleImageWidth: 270, titleImageHeight: 55,
    titleImagePaddingTop: 0, titleImagePaddingBottom: 0,
    titleImagePaddingLeft: 20, titleImagePaddingRight: 20,
    priceColumnsGap: 10, hashrateColumnsGap: 10, metricsItemsGap: 5, burnSectionsGap: 14,
    burnLeftInnerGap: 7, burnRightInnerGap: 7, priceLogoGap: 6,
    hashrateInnerSpacing: 2, donorLinesSpacing: 2, arrowGap: 10,
  };
}
function computeScale() {
  const screenWidth = Device.screenSize().width;
  const baseWidth = 430;
  let s = screenWidth / baseWidth;
  return Math.max(0.8, Math.min(1.3, s));
}
function scaleObject(obj, s) {
  if (typeof obj === 'number') return obj * s;
  if (Array.isArray(obj)) return obj.map(item => scaleObject(item, s));
  if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) newObj[key] = scaleObject(obj[key], s);
    return newObj;
  }
  return obj;
}
const baseLayout = getBaseLayout();
const scale = computeScale();
const LAYOUT = scaleObject(baseLayout, scale);
const CORNER_RADIUS = 18 * scale;
const CONFIG = (() => {
  const fixed = LAYOUT;
  return {
    fonts: fixed.fontSize,
    spacing: {
      outer: { top: fixed.outerPaddingTop, bottom: fixed.outerPaddingBottom, left: fixed.outerPaddingLeft, right: fixed.outerPaddingRight },
      betweenContainers: { afterPrice: fixed.spacingAfterPrice, afterMetrics: fixed.spacingAfterMetrics, afterTitle: fixed.spacingAfterTitle, afterHashrate: fixed.spacingAfterHashrate },
      priceContainerPadding: { top: fixed.priceContainerPaddingTop, bottom: fixed.priceContainerPaddingBottom, left: fixed.priceContainerPaddingLeft, right: fixed.priceContainerPaddingRight },
      metricsContainerPadding: { top: fixed.metricsContainerPaddingTop, bottom: fixed.metricsContainerPaddingBottom, left: fixed.metricsContainerPaddingLeft, right: fixed.metricsContainerPaddingRight },
      hashrateContainerPadding: { top: fixed.hashrateContainerPaddingTop, bottom: fixed.hashrateContainerPaddingBottom, left: fixed.hashrateContainerPaddingLeft, right: fixed.hashrateContainerPaddingRight },
      burnContainerPadding: { top: fixed.burnContainerPaddingTop, bottom: fixed.burnContainerPaddingBottom, left: fixed.burnContainerPaddingLeft, right: fixed.burnContainerPaddingRight },
      gaps: {
        priceColumns: fixed.priceColumnsGap, hashrateColumns: fixed.hashrateColumnsGap,
        metricsItems: fixed.metricsItemsGap, burnSections: fixed.burnSectionsGap,
        burnLeftInner: fixed.burnLeftInnerGap, burnRightInner: fixed.burnRightInnerGap,
        priceLogo: fixed.priceLogoGap, hashrateInner: fixed.hashrateInnerSpacing,
        donorLines: fixed.donorLinesSpacing, arrow: fixed.arrowGap
      }
    },
    logos: { topQuaiSize: fixed.topLogoSize, topQiSize: fixed.topLogoSize, bottomQuaiSize: fixed.bottomLogoSize, cornerRadius: 8 * scale },
    titleImage: { width: fixed.titleImageWidth, height: fixed.titleImageHeight, padding: { top: fixed.titleImagePaddingTop, bottom: fixed.titleImagePaddingBottom, left: fixed.titleImagePaddingLeft, right: fixed.titleImagePaddingRight } }
  };
})();
log("⚙️ Scaled config ready.");

function createStyledContainer(parent, bg = new Color("#1C1C1C", 0.3), pt, pb, pl, pr) {
  let w = parent.addStack();
  w.layoutVertically();
  w.cornerRadius = CORNER_RADIUS;
  w.shadowColor = new Color("#FFFFFF", 0.25);
  w.shadowRadius = 18 * scale;
  w.shadowOffset = new Point(0, -6 * scale);
  let i = w.addStack();
  i.layoutVertically();
  i.backgroundColor = bg;
  i.cornerRadius = CORNER_RADIUS;
  i.borderColor = Color.red(); // 🔴 RED BORDER
  i.borderWidth = 3 * scale;
  i.shadowColor = new Color("#000000", 0.45);
  i.shadowRadius = 22 * scale;
  i.shadowOffset = new Point(0, 6 * scale);
  i.setPadding(pt, pl, pb, pr);
  return { outer: w, inner: i };
}

const KEY_LAST_PRICE = "soap_last_price";
const KEY_LAST_MININGINFO = "soap_last_mininginfo";
const KEY_LAST_BURNED_BALANCE = "soap_last_burned_balance";
const KEY_LAST_MARKET = "soap_last_market";
const KEY_TIMESTAMP = "soap_timestamp";
const KEY_DONOR_DATA = "soap_donor_data";
const KEY_QI_RATE = "soap_qi_rate";
const KEY_DONOR_PRICES = "soap_donor_prices";
const KEY_SOAP_REVENUE = "soap_revenue_24h";
const KEY_LAST_FLAME_TIME = "soap_last_flame_time";
const KEY_LAST_ROCKET_TIME = "soap_last_rocket_time";
const KEY_ROCKET_BASE_PRICE = "soap_rocket_base_price";
log("🔑 Keychain keys initialized.");

const MININGINFO_URL = "https://rpc.quai.network/mininginfo?Decimal=true";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const QUAISCAN_API = "https://quaiscan.io/api";
const BURN_ADDRESS = "0x0050AF0000000000000000000000000000000000";
const SOAP_API_BASE = "https://soap.qu.ai";
const SECONDS_PER_DAY = 86400;
const QUAI_DECIMALS = 1e18;
const BURNED_AMOUNT_FIXED = 29600129;
const QI_RATE_MIN = 0.01; const QI_RATE_MAX = 100.0; const QI_RATE_FIXED = 11.323375;
const DONOR_BLOCK_TIMES = { BCH: 600, LTC: 150, DOGE: 60, RVN: 60 };
const DONOR_REWARDS = { BCH: 3.125, LTC: 6.25, DOGE: 10000, RVN: 1250 };
const RPC_ENDPOINTS = [
  { url: 'https://rpc.quai.network/cyprus1', priority: 1, timeout: 4000, name: 'RPC #1' },
  { url: 'https://rpc.cyprus1.colosseum.quaiscan.io', priority: 2, timeout: 2000, name: 'RPC #2' },
  { url: 'https://quai.drpc.org', priority: 3, timeout: 2000, name: 'RPC #3' }
];
const IMAGE_TIMEOUT = 3000;
const FULLSCREEN_IMAGE_TIMEOUT = 5000;

function loadState() {
  log("📂 Loading state from Keychain...");
  const s = { price:null, mining:null, burned:null, market:null, timestamp:null, lastFlameTime:null, lastRocketTime:null, rocketBasePrice:null };
  try { let v = Keychain.get(KEY_LAST_PRICE); if(v) { s.price = parseFloat(v); log(`   → Price: ${s.price}`); } } catch(e){ log("⚠️ Error reading price:", e.message); }
  try { let v = Keychain.get(KEY_LAST_MININGINFO); if(v) { s.mining = JSON.parse(v); log(`   → Mining info ${s.mining ? 'present' : 'absent'}`); } } catch(e){ log("⚠️ Error reading mining:", e.message); }
  try { let v = Keychain.get(KEY_LAST_BURNED_BALANCE); if(v) { s.burned = parseFloat(v); log(`   → Burned: ${s.burned}`); } } catch(e){ log("⚠️ Error reading burned:", e.message); }
  try { let v = Keychain.get(KEY_LAST_MARKET); if(v) { s.market = JSON.parse(v); log(`   → Market ${s.market ? 'present' : 'absent'}`); } } catch(e){ log("⚠️ Error reading market:", e.message); }
  try { let v = Keychain.get(KEY_TIMESTAMP); if(v) { s.timestamp = parseInt(v,10); log(`   → Timestamp: ${new Date(s.timestamp).toLocaleString()}`); } } catch(e){ log("⚠️ Error reading timestamp:", e.message); }
  try { let v = Keychain.get(KEY_LAST_FLAME_TIME); if(v) { s.lastFlameTime = parseInt(v,10); log(`   → lastFlameTime: ${new Date(s.lastFlameTime).toLocaleString()}`); } } catch(e){}
  try { let v = Keychain.get(KEY_LAST_ROCKET_TIME); if(v) { s.lastRocketTime = parseInt(v,10); log(`   → lastRocketTime: ${new Date(s.lastRocketTime).toLocaleString()}`); } } catch(e){}
  try { let v = Keychain.get(KEY_ROCKET_BASE_PRICE); if(v) { s.rocketBasePrice = parseFloat(v); log(`   → rocketBasePrice: ${s.rocketBasePrice}`); } } catch(e){}
  return s;
}

function saveState(state) {
  if (timeLeft() < 500) { log("⏳ Not enough time to save state, skipping"); return; }
  log("💾 Saving state to Keychain...");
  try {
    const stateStr = JSON.stringify(state);
    const sizeKB = (stateStr.length * 2) / 1024;
    if (sizeKB > 100) log(`⚠️ State size large: ${sizeKB.toFixed(1)} KB`);
    if (state.price != null) Keychain.set(KEY_LAST_PRICE, state.price.toString());
    if (state.mining != null) Keychain.set(KEY_LAST_MININGINFO, JSON.stringify(state.mining));
    if (state.burned != null) Keychain.set(KEY_LAST_BURNED_BALANCE, state.burned.toString());
    if (state.market != null) Keychain.set(KEY_LAST_MARKET, JSON.stringify(state.market));
    if (state.timestamp != null) Keychain.set(KEY_TIMESTAMP, state.timestamp.toString());
    if (state.lastFlameTime != null) Keychain.set(KEY_LAST_FLAME_TIME, state.lastFlameTime.toString());
    if (state.lastRocketTime != null) Keychain.set(KEY_LAST_ROCKET_TIME, state.lastRocketTime.toString());
    if (state.rocketBasePrice != null) Keychain.set(KEY_ROCKET_BASE_PRICE, state.rocketBasePrice.toString());
    log(`   ✅ Saved (${sizeKB.toFixed(1)} KB)`);
  } catch(e){ log("⚠️ Error saving:", e.message); }
}

function loadDonorCache() {
  try {
    let data = JSON.parse(Keychain.get(KEY_DONOR_DATA) || 'null');
    log(`📂 Loaded donor cache: BTC=${data?.btc?.value ? '✅' : '❌'}, BCH=${data?.bch?.value ? '✅' : '❌'}, LTC=${data?.ltc?.value ? '✅' : '❌'}, DOGE=${data?.doge?.value ? '✅' : '❌'}, RVN=${data?.rvn?.value ? '✅' : '❌'}`);
    return data;
  } catch { return null; }
}
function saveDonorCache(data) {
  if (timeLeft() < 500) { log("⏳ Not enough time to save donors, skipping"); return; }
  try {
    const dataStr = JSON.stringify(data);
    const sizeKB = (dataStr.length * 2) / 1024;
    if (sizeKB > 50) log(`⚠️ Donor data size large: ${sizeKB.toFixed(1)} KB`);
    Keychain.set(KEY_DONOR_DATA, dataStr);
    log(`💾 Donors saved (${sizeKB.toFixed(1)} KB)`);
  } catch(e){ log("⚠️ Error saving donors:", e.message); }
}

function loadDonorPricesCache() {
  try {
    let data = JSON.parse(Keychain.get(KEY_DONOR_PRICES) || 'null');
    log(`📂 Loaded donor prices cache: BCH=${data?.bch || 'none'}, LTC=${data?.ltc || 'none'}, DOGE=${data?.doge || 'none'}, RVN=${data?.rvn || 'none'}`);
    return data;
  } catch { return null; }
}
function saveDonorPricesCache(data) {
  if (timeLeft() < 500) { log("⏳ Not enough time to save donor prices, skipping"); return; }
  try {
    const dataStr = JSON.stringify(data);
    const sizeKB = (dataStr.length * 2) / 1024;
    if (sizeKB > 50) log(`⚠️ Donor prices data size large: ${sizeKB.toFixed(1)} KB`);
    Keychain.set(KEY_DONOR_PRICES, dataStr);
    log(`💾 Donor prices saved (${sizeKB.toFixed(1)} KB)`);
  } catch(e){ log("⚠️ Error saving donor prices:", e.message); }
}

function loadRevenueCache() {
  try {
    let data = JSON.parse(Keychain.get(KEY_SOAP_REVENUE) || 'null');
    log(`📂 Loaded revenue cache: ${data?.revenueUsd || 'none'}`);
    return data?.revenueUsd;
  } catch { return null; }
}
function saveRevenueCache(revenue) {
  if (timeLeft() < 500) { log("⏳ Not enough time to save revenue, skipping"); return; }
  try {
    Keychain.set(KEY_SOAP_REVENUE, JSON.stringify({ revenueUsd: revenue, timestamp: Date.now() }));
    log(`💾 Revenue saved: ${revenue}`);
  } catch(e){ log("⚠️ Error saving revenue:", e.message); }
}

function loadQiRate() {
  try {
    let d = JSON.parse(Keychain.get(KEY_QI_RATE) || 'null');
    if (d && Date.now()-d.timestamp<86400000) {
      log(`📂 Qi rate from cache: ${d.value}`);
      return d.value;
    }
  } catch { return null; }
  return null;
}
function saveQiRate(rate) {
  if (timeLeft() < 500) { log("⏳ Not enough time to save Qi rate, skipping"); return; }
  if (rate>QI_RATE_MIN && rate<QI_RATE_MAX) {
    Keychain.set(KEY_QI_RATE, JSON.stringify({value:rate, timestamp:Date.now()}));
    log(`💾 Qi rate saved: ${rate}`);
  }
}

function pruneOldCache() {
  try {
    const keys = [KEY_LAST_PRICE, KEY_LAST_MININGINFO, KEY_LAST_BURNED_BALANCE, KEY_LAST_MARKET, KEY_DONOR_DATA, KEY_QI_RATE, KEY_DONOR_PRICES, KEY_SOAP_REVENUE, KEY_LAST_FLAME_TIME, KEY_LAST_ROCKET_TIME, KEY_ROCKET_BASE_PRICE];
    for (let key of keys) {
      const val = Keychain.get(key);
      if (val && val.length > 200 * 1024) {
        Keychain.remove(key);
        log(`🧹 Cleared cache for ${key} (exceeds 200KB)`);
      }
    }
  } catch(e){ log("⚠️ Error pruning cache:", e.message); }
}
if (haveTime()) {
  Timer.schedule(0, false, () => pruneOldCache());
}

function getTimeout(base) {
  let multiplier = 1.0;
  if (widgetHealth.consecutiveFails > 2) {
    multiplier = 1.5;
    log(`⏱️ Increasing timeout: consecutiveFails=${widgetHealth.consecutiveFails}, multiplier=${multiplier}`);
  }
  return base * multiplier;
}

async function fastFetch(url, baseTimeout = 5000, sourceName = '') {
  if (!haveTime()) { log(`⏳ ${sourceName}: no time, skipping`); return null; }
  if (!await hasInternet()) { log(`⏳ ${sourceName}: no internet, skipping`); return null; }
  if (!isSourceHealthy(sourceName)) return null;
  const finalTimeout = getTimeout(baseTimeout);
  log(`🌐 ${sourceName}: requesting ${url} (timeout ${finalTimeout}ms)`);
  const req = new Request(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now());
  req.timeoutInterval = finalTimeout;
  try {
    const data = await req.loadJSON();
    log(`   ✅ ${sourceName}: success, response size ~${JSON.stringify(data).length} chars`);
    recordSourceSuccess(sourceName);
    return data;
  } catch (e) {
    log(`   ❌ ${sourceName}: error: ${e.message}`);
    recordSourceFailure(sourceName);
    return null;
  }
}

async function rpcCall(url, method, params, baseTimeout = 4000, sourceName = '') {
  if (!haveTime()) { log(`⏳ RPC ${method} (${sourceName}): no time, skipping`); return null; }
  if (!await hasInternet()) { log(`⏳ RPC ${method} (${sourceName}): no internet, skipping`); return null; }
  if (!isSourceHealthy(sourceName)) return null;
  const finalTimeout = getTimeout(baseTimeout);
  log(`🌐 RPC ${method} (${sourceName}) at ${url}, timeout ${finalTimeout}ms`);
  const req = new Request(url);
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ jsonrpc:"2.0", method, params, id:1 });
  req.timeoutInterval = finalTimeout;
  try {
    const resp = await req.loadJSON();
    if (resp?.error) {
      log(`   ⚠️ RPC ${method} (${sourceName}) error in response: ${JSON.stringify(resp.error)}`);
      recordSourceFailure(sourceName);
      return null;
    }
    if (resp?.result) {
      log(`   ✅ RPC ${method} (${sourceName}) success`);
      recordSourceSuccess(sourceName);
      return resp.result;
    }
    log(`   ⚠️ RPC ${method} (${sourceName}) response without result`);
    recordSourceFailure(sourceName);
    return null;
  } catch (e) {
    log(`   ❌ RPC ${method} (${sourceName}) error: ${e.message}`);
    recordSourceFailure(sourceName);
    return null;
  }
}

async function rpcCallWithRetry(endpoint, method, params, sourceBase) {
  const maxRetries = endpoint.priority === 1 ? 2 : 1;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await rpcCall(endpoint.url, method, params, endpoint.timeout, `${sourceBase}_${attempt}`);
    if (result) return result;
  }
  return null;
}

async function shouldRefreshDueToPriceChange(oldPrice, newPrice) {
  if (!oldPrice || !newPrice) return true;
  const change = Math.abs((newPrice - oldPrice) / oldPrice);
  log(`💰 Price change: ${(change*100).toFixed(2)}%`);
  return change > 0.01;
}

async function fetchSoapHashrates(firstRun) {
  log("\n🌐 ===== FETCHING SOAP HASHRATES FROM SOAP API =====");
  if (!shouldFetchWithHealth('soapData', firstRun) || timeLeft() < 2000) {
    log("⏸️ SOAP hashrates: skipped by priority or time");
    return null;
  }
  const sourceName = 'SOAP Hashrates';
  if (!isSourceHealthy(sourceName)) return null;
  const url = `${SOAP_API_BASE}/api/hashrates?limit=1`;
  const data = await fastFetch(url, 4000, sourceName);
  if (data?.series) {
    const result = {
      sha: data.series.sha?.[0]?.hashRate ? parseFloat(data.series.sha[0].hashRate) : null,
      scrypt: data.series.scrypt?.[0]?.hashRate ? parseFloat(data.series.scrypt[0].hashRate) : null,
      kawpow: data.series.kawpow?.[0]?.hashRate ? parseFloat(data.series.kawpow[0].hashRate) : null
    };
    log(`📊 SOAP hashrates: SHA=${result.sha}, Scrypt=${result.scrypt}, Kawpow=${result.kawpow}`);
    return result;
  }
  return null;
}

async function fetchSoapPrices(firstRun) {
  log("\n💰 ===== FETCHING DONOR PRICES FROM SOAP API =====");
  if (!shouldFetchWithHealth('soapData', firstRun) || timeLeft() < 2000) {
    log("⏸️ SOAP prices: skipped by priority or time");
    return null;
  }
  const sourceName = 'SOAP Prices';
  if (!isSourceHealthy(sourceName)) return null;
  const url = `${SOAP_API_BASE}/api/blocks?limit=1`;
  const data = await fastFetch(url, 4000, sourceName);
  if (data?.prices) {
    const result = {
      bch: data.prices.bcash,
      ltc: data.prices.litecoin,
      doge: data.prices.dogecoin,
      rvn: data.prices.ravencoin
    };
    log(`💰 SOAP donor prices: BCH=${result.bch}, LTC=${result.ltc}, DOGE=${result.doge}, RVN=${result.rvn}`);
    return result;
  }
  return null;
}

async function fetchSoapRevenue24h(firstRun) {
  log("\n🧮 ===== FETCHING 24H REVENUE FROM SOAP API =====");
  if (!shouldFetchWithHealth('soapData', firstRun) || timeLeft() < 2000) {
    log("⏸️ SOAP revenue: skipped by priority or time");
    return null;
  }
  const sourceName = 'SOAP Revenue';
  if (!isSourceHealthy(sourceName)) return null;
  const url = `${SOAP_API_BASE}/api/revenues/daily`;
  const data = await fastFetch(url, 4000, sourceName);
  if (data?.total?.revenueUsd !== undefined) {
    log(`🧮 SOAP 24h revenue: ${data.total.revenueUsd}`);
    return data.total.revenueUsd;
  }
  return null;
}

async function fetchQuaiPrice(firstRun) {
  log("\n💰 ===== FETCHING QUAI PRICE =====");
  if (!shouldFetchWithHealth('price', firstRun)) {
    const cached = loadState().price;
    log(`💰 Using cached price: ${cached}`);
    return cached;
  }
  const sources = [
    { name:'CoinGecko', url:`${COINGECKO_API}/simple/price?ids=quai-network&vs_currencies=usd`, path: d => d?.['quai-network']?.usd },
    { name:'MEXC', url:'https://api.mexc.com/api/v3/ticker/24hr?symbol=QUAIUSDT', path: d => d?.lastPrice },
    { name:'Binance', url:'https://api.binance.com/api/v3/ticker/price?symbol=QUAIUSDT', path: d => d?.price },
    { name:'KuCoin', url:'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=QUAI-USDT', path: d => d?.data?.price },
    { name:'Crypto.com', url:'https://api.crypto.com/v2/public/get-ticker?instrument_name=QUAI_USDT', path: d => d?.result?.data?.a },
    { name:'CoinPaprika', url:'https://api.coinpaprika.com/v1/tickers/quai-quai', path: d => d?.quotes?.USD?.price }
  ];
  for (let src of sources) {
    log(`🔍 Trying source: ${src.name}`);
    if (!isSourceHealthy(src.name)) { log(`⏩ ${src.name} temporarily disabled by stats, skipping`); continue; }
    const data = await fastFetch(src.url, 5000, src.name);
    if (data) {
      const price = src.path(data);
      if (price) {
        const numPrice = parseFloat(price);
        log(`💰 Price obtained from ${src.name}: ${numPrice}`);
        return numPrice;
      } else {
        log(`⚠️ ${src.name} returned data but failed to extract price:`, JSON.stringify(data));
      }
    }
  }
  const cached = loadState().price;
  log("⚠️ All price sources unavailable, returning cached:", cached);
  return cached;
}

async function fetchBurnedBalance(firstRun) {
  log("\n🔥 ===== FETCHING BURNED BALANCE =====");
  if (!shouldFetchWithHealth('burnedBalance', firstRun)) {
    const cached = loadState().burned;
    log(`🔥 Using cached balance: ${cached}`);
    return cached;
  }

  const qsUrl = `${QUAISCAN_API}?module=account&action=balance&address=${BURN_ADDRESS}`;
  const qsData = await fastFetch(qsUrl, 5000, 'Quaiscan');
  if (qsData?.status === "1" && qsData?.result) {
    const bal = parseFloat(qsData.result) / QUAI_DECIMALS;
    log(`🔥 Balance from Quaiscan: ${bal} QUAI`);
    return bal;
  }

  const bsUrl = `https://quaiscan.io/api/v2/addresses/${BURN_ADDRESS}`;
  const bsData = await fastFetch(bsUrl, 5000, 'BlockScout v2');
  if (bsData?.coin_balance) {
    const bal = parseFloat(bsData.coin_balance) / QUAI_DECIMALS;
    log(`🔥 Balance from BlockScout v2: ${bal} QUAI`);
    return bal;
  }

  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const ep = RPC_ENDPOINTS[i];
    const hex = await rpcCallWithRetry(ep, "quai_getBalance", [BURN_ADDRESS, "latest"], `RPC_balance_${i}`);
    if (hex) {
      try {
        const bal = Number(BigInt(hex)) / QUAI_DECIMALS;
        log(`🔥 Balance from RPC #${i}: ${bal} QUAI`);
        return bal;
      } catch (e) {
        log(`⚠️ Error converting hex: ${e.message}`);
      }
    }
  }

  const cached = loadState().burned || BURNED_AMOUNT_FIXED;
  log("⚠️ All balance sources unavailable, returning cached/fixed:", cached);
  return cached;
}

async function tryCoinGeckoMarket() {
  const raw = await fastFetch(`${COINGECKO_API}/coins/quai-network?localization=false&tickers=false&market_data=true`, 5000, 'CoinGecko Market');
  if (raw?.market_data) {
    return {
      priceChange24: raw.market_data.price_change_percentage_24h,
      priceChange7d: raw.market_data.price_change_percentage_7d,
      marketCap: raw.market_data.market_cap?.usd,
      volume: raw.market_data.total_volume?.usd,
      rank: raw.market_cap_rank,
      circSupply: raw.market_data.circulating_supply
    };
  }
  return null;
}
async function tryDexScreener() {
  const url = 'https://api.dexscreener.com/latest/dex/search?q=QUAI';
  const data = await fastFetch(url, 4000, 'DEX Screener');
  if (data?.pairs && data.pairs.length > 0) {
    const pair = data.pairs[0];
    return {
      priceChange24: pair.priceChange?.h24,
      priceChange7d: null,
      marketCap: pair.fdv,
      volume: pair.volume?.h24,
      rank: null,
      circSupply: null
    };
  }
  return null;
}
async function fetchMarketData(firstRun) {
  log("\n📊 ===== FETCHING MARKET DATA =====");
  if (!shouldFetchWithHealth('marketData', firstRun) || timeLeft()<3000) {
    log("⏸️ Market: skipped by priority or time");
    const cached = loadState().market;
    return cached || { priceChange24: null, priceChange7d: null, marketCap: null, volume: null, rank: null, circSupply: null };
  }
  let data = await tryCoinGeckoMarket();
  if (data) return data;
  data = await tryDexScreener();
  if (data) return data;
  const cached = loadState().market;
  return cached || { priceChange24: null, priceChange7d: null, marketCap: null, volume: null, rank: null, circSupply: null };
}

async function fetchQiRate(firstRun) {
  log("\n⚡ ===== FETCHING QI RATE =====");
  let cached = loadQiRate();
  if (cached && !firstRun) {
    log("⚡ Qi rate from cache:", cached);
    return cached;
  }
  if (!shouldFetchWithHealth('qiRate', firstRun) || timeLeft()<3000) {
    log("⏸️ Qi rate: skipped by priority or time");
    return cached || QI_RATE_FIXED;
  }
  const QI_AMOUNT = "0x3B9ACA00";
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const ep = RPC_ENDPOINTS[i];
    const hex = await rpcCallWithRetry(ep, "quai_qiToQuai", [QI_AMOUNT, "latest"], `RPC_qi_${i}`);
    if (hex) {
      try {
        const rate = Number(BigInt(hex)) / 1e18;
        if (rate>QI_RATE_MIN && rate<QI_RATE_MAX) {
          log(`⚡ Qi rate obtained from RPC #${i}: ${rate}`);
          return rate;
        } else {
          log(`⚠️ Qi rate outside allowed range: ${rate}`);
        }
      } catch (e) {
        log(`⚠️ Error converting Qi rate: ${e.message}`);
      }
    }
  }
  log("⚠️ Qi rate not obtained, returning cache/fixed:", cached || QI_RATE_FIXED);
  return cached || QI_RATE_FIXED;
}

async function fetchDonorHashrate(coin, firstRun) {
  const coinKey = coin.toLowerCase();
  log(`\n🔄 ===== FETCHING DONOR HASHRATE ${coin} =====`);
  if (!shouldFetchWithHealth(`donor${coinKey}`, firstRun) || timeLeft()<1000) {
    log(`⏸️ ${coin}: skipped by priority or time`);
    return null;
  }
  if (coin === 'RVN') {
    const sourceName = 'RVN_RPC';
    log(`🔍 Trying Ting Finance RPC for RVN...`);
    if (!isSourceHealthy(sourceName)) return null;
    const req = new Request("https://rvn-rpc-mainnet.ting.finance/rpc");
    req.method = "POST";
    req.headers = { "Content-Type": "application/json" };
    req.body = JSON.stringify({ jsonrpc:"2.0", method:"getnetworkhashps", params:[], id:1 });
    req.timeoutInterval = getTimeout(2000);
    try {
      const resp = await req.loadJSON();
      if (resp?.result) {
        const h = parseFloat(resp.result);
        log(`   ✅ RVN hashrate: ${h/1e12} TH/s`);
        return h;
      } else {
        log(`   ⚠️ RVN RPC returned unexpected response:`, resp);
      }
    } catch (e) {
      log(`   ❌ RVN RPC error: ${e.message}`);
    }
    return null;
  }
  const map = {
    BTC: { name:'BlockchairBTC', url:'https://api.blockchair.com/bitcoin/stats' },
    BCH: { name:'BlockchairBCH', url:'https://api.blockchair.com/bitcoin-cash/stats' },
    LTC: { name:'BlockchairLTC', url:'https://api.blockchair.com/litecoin/stats' },
    DOGE: { name:'BlockchairDOGE', url:'https://api.blockchair.com/dogecoin/stats' }
  };
  if (!map[coin] || !isSourceHealthy(map[coin].name)) return null;
  log(`🔍 Requesting Blockchair for ${coin}...`);
  const raw = await fastFetch(map[coin].url, 3000, map[coin].name);
  if (raw?.data?.hashrate_24h) {
    const h = parseFloat(raw.data.hashrate_24h);
    log(`   ✅ ${coin} hashrate: ${h/1e12} TH/s`);
    return h;
  }
  log(`   ❌ ${coin} not obtained via Blockchair`);
  return null;
}
async function fetchDonorNetworkHashrate(firstRun) {
  log("\n🌐 ===== FETCHING ALL DONOR HASHRATES =====");
  const old = loadDonorCache() || {};
  const coins = ['BTC', 'BCH', 'LTC', 'DOGE', 'RVN'];
  const promises = [];
  for (const coin of coins) {
    if (shouldFetchWithHealth(`donor${coin.toLowerCase()}`, firstRun) && timeLeft() >= 1000) {
      promises.push(fetchDonorHashrate(coin, firstRun).then(value => ({ coin, value })));
    }
  }
  const results = await Promise.allSettled(promises);
  const newData = {};
  for (const coin of coins) newData[coin.toLowerCase()] = old[coin.toLowerCase()] || { value: null };
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value && res.value.value !== null) {
      newData[res.value.coin.toLowerCase()] = { value: res.value.value };
      log(`📊 Updated ${res.value.coin}: ${res.value.value}`);
    } else if (res.status === 'fulfilled' && res.value) {
      log(`📊 ${res.value.coin}: fetch failed, keeping cache`);
    }
  }
  log("📊 Final donor data:", JSON.stringify(newData));
  return newData;
}

async function fetchMiningInfo(firstRun) {
  log("\n⛏️ ===== FETCHING MINING INFO (SOAP hashrates) =====");
  if (!shouldFetchWithHealth('miningInfo', firstRun) || timeLeft()<3000) {
    log("⏸️ Mining info: skipped by priority or time");
    return loadState().mining;
  }
  const soapHash = await fetchSoapHashrates(firstRun);
  if (soapHash) {
    return { shaHashRate: soapHash.sha, scryptHashRate: soapHash.scrypt, kawpowHashRate: soapHash.kawpow };
  }
  log("⚠️ SOAP API did not respond, trying old MININGINFO_URL...");
  const urls = [MININGINFO_URL, 'https://quai.drpc.org/mininginfo?Decimal=true'];
  for (let i = 0; i < urls.length; i++) {
    const sourceName = `mining_${i}`;
    log(`🔍 Trying mining source #${i}: ${urls[i]}`);
    if (!isSourceHealthy(sourceName)) continue;
    const raw = await fastFetch(urls[i], 5000, sourceName);
    if (raw?.result) {
      log(`⛏️ Mining info obtained from source #${i}:`, raw.result);
      return raw.result;
    }
  }
  log("⚠️ Mining info not obtained, returning cache");
  return loadState().mining;
}

async function tryCoinGeckoDonorPrices() {
  const sourceName = 'CoinGeckoDonor';
  if (!isSourceHealthy(sourceName)) return null;
  const url = `${COINGECKO_API}/simple/price?ids=bitcoin-cash,litecoin,dogecoin,ravencoin&vs_currencies=usd`;
  const raw = await fastFetch(url, 3000, sourceName);
  if (raw) {
    return {
      bch: raw['bitcoin-cash']?.usd,
      ltc: raw['litecoin']?.usd,
      doge: raw['dogecoin']?.usd,
      rvn: raw['ravencoin']?.usd
    };
  }
  return null;
}
async function tryCoinPaprikaDonorPrices() {
  const sourceName = 'CoinPaprikaDonor';
  const ids = { bch: 'bch-bitcoin-cash', ltc: 'ltc-litecoin', doge: 'doge-dogecoin', rvn: 'rvn-ravencoin' };
  const result = {};
  for (const [coin, id] of Object.entries(ids)) {
    const url = `https://api.coinpaprika.com/v1/tickers/${id}`;
    const data = await fastFetch(url, 3000, `${sourceName}_${coin}`);
    if (data?.quotes?.USD?.price) result[coin] = data.quotes.USD.price;
    else return null;
  }
  return result;
}
async function fetchDonorPrices(firstRun) {
  log("\n💰 ===== FETCHING DONOR PRICES =====");
  const soapPrices = await fetchSoapPrices(firstRun);
  if (soapPrices && Object.keys(soapPrices).length > 0) {
    saveDonorPricesCache(soapPrices);
    return soapPrices;
  }
  const cgPrices = await tryCoinGeckoDonorPrices();
  if (cgPrices && Object.keys(cgPrices).length > 0) {
    saveDonorPricesCache(cgPrices);
    return cgPrices;
  }
  const cpPrices = await tryCoinPaprikaDonorPrices();
  if (cpPrices && Object.keys(cpPrices).length > 0) {
    saveDonorPricesCache(cpPrices);
    return cpPrices;
  }
  const cached = loadDonorPricesCache();
  return cached || { bch: null, ltc: null, doge: null, rvn: null };
}

async function fetchRevenue24h(firstRun, mining, donors, donorPrices) {
  log("\n🧮 ===== FETCHING 24H REVENUE =====");
  const soapRevenue = await fetchSoapRevenue24h(firstRun);
  if (soapRevenue !== null && soapRevenue !== undefined) {
    saveRevenueCache(soapRevenue);
    return soapRevenue;
  }
  const revenue = calculateBackupRevenue(mining, donors, donorPrices);
  if (revenue !== null) {
    saveRevenueCache(revenue);
    return revenue;
  }
  const cached = loadRevenueCache();
  return cached !== null ? cached : 0;
}
function calculateBackupRevenue(mining, donors, donorPrices) {
  log("\n🧮 ===== CALCULATING REVENUE (FALLBACK) =====");
  if (!mining) { log("⛔ No mining data"); return null; }
  if (!donors) { log("⛔ No donors data"); return null; }
  if (!donorPrices) { log("⛔ No donorPrices data"); return null; }
  const shaQuai = parseFloat(mining.shaHashRate) || 0;
  const scrQuai = parseFloat(mining.scryptHashRate) || 0;
  const kawQuai = parseFloat(mining.kawpowHashRate) || 0;
  const bchDonor = Math.max(donors.bch?.value || 1, 1);
  const ltcDonor = Math.max(donors.ltc?.value || 1, 1);
  const dogeDonor = Math.max(donors.doge?.value || 1, 1);
  const rvnDonor = Math.max(donors.rvn?.value || 1, 1);
  const shareBch = Math.min(shaQuai / bchDonor, 1.0);
  const shareLtc = Math.min(scrQuai / ltcDonor, 1.0);
  const shareDoge = Math.min(scrQuai / dogeDonor, 1.0);
  const shareRvn = Math.min(kawQuai / rvnDonor, 1.0);
  const revBch = shareBch * (SECONDS_PER_DAY / DONOR_BLOCK_TIMES.BCH) * DONOR_REWARDS.BCH * (donorPrices.bch || 0);
  const revLtc = shareLtc * (SECONDS_PER_DAY / DONOR_BLOCK_TIMES.LTC) * DONOR_REWARDS.LTC * (donorPrices.ltc || 0);
  const revDoge = shareDoge * (SECONDS_PER_DAY / DONOR_BLOCK_TIMES.DOGE) * DONOR_REWARDS.DOGE * (donorPrices.doge || 0);
  const revRvn = shareRvn * (SECONDS_PER_DAY / DONOR_BLOCK_TIMES.RVN) * DONOR_REWARDS.RVN * (donorPrices.rvn || 0);
  const total = revBch + revLtc + revDoge + revRvn;
  log(`💰 Revenue (fallback): BCH=$${revBch.toFixed(2)}, LTC=$${revLtc.toFixed(2)}, DOGE=$${revDoge.toFixed(2)}, RVN=$${revRvn.toFixed(2)} → TOTAL=$${total.toFixed(2)}`);
  return total;
}

function safeNumber(n) { return (n===null||isNaN(n))?null:parseFloat(n); }
function formatPrice(n) {
  let num = safeNumber(n);
  if (!num) return "⏳";
  if (num < 0.001) return "$0.000";
  if (num > 99999) return "$99999";
  let intPart = Math.floor(num);
  if (intPart === 0) return "$" + num.toFixed(3);
  if (intPart < 10) return "$" + num.toFixed(3);
  if (intPart < 100) return "$" + num.toFixed(2);
  if (intPart < 1000) return "$" + num.toFixed(1);
  return "$" + Math.round(num);
}
function formatNumberNoDollar(n) {
  let num = safeNumber(n);
  if (!num) return "⏳";
  if (num < 1000) return Math.round(num).toString();
  if (num < 1e6) return Math.round(num / 1e3) + 'k';
  if (num < 1e9) return Math.round(num / 1e6) + 'm';
  if (num < 1e12) {
    let val = num / 1e9;
    return (val < 10) ? val.toFixed(1) + 'B' : Math.round(val) + 'B';
  }
  let val = num / 1e12;
  return (val < 10) ? val.toFixed(1) + 'T' : Math.round(val) + 'T';
}
function formatNumberWithDollar(num) {
  let n = safeNumber(num);
  if (!n) return "⏳";
  if (n < 1000) return '$' + Math.round(n);
  if (n < 1e6) return '$' + Math.round(n / 1e3) + 'k';
  if (n < 1e9) return '$' + Math.round(n / 1e6) + 'm';
  if (n < 1e12) {
    let val = n / 1e9;
    return (val < 10) ? '$' + val.toFixed(1) + 'B' : '$' + Math.round(val) + 'B';
  }
  let val = n / 1e12;
  return (val < 10) ? '$' + val.toFixed(1) + 'T' : '$' + Math.round(val) + 'T';
}
function formatRank(rank) {
  let r = safeNumber(rank);
  if (!r) return "⏳";
  if (r < 1000) return '#' + Math.round(r);
  return '#>' + Math.floor(r / 1000) + 'k';
}
function formatHashrate(h) {
  let n = safeNumber(h);
  if (!n) return "⏳";
  const units = [
    { divisor: 1e21, suffix: 'ZH' }, { divisor: 1e18, suffix: 'EH' }, { divisor: 1e15, suffix: 'PH' },
    { divisor: 1e12, suffix: 'TH' }, { divisor: 1e9, suffix: 'GH' }, { divisor: 1e6, suffix: 'MH' },
    { divisor: 1e3, suffix: 'KH' }, { divisor: 1, suffix: 'H' }
  ];
  for (let unit of units) {
    if (n >= unit.divisor) {
      let value = n / unit.divisor;
      let decimals;
      if (value >= 100) decimals = 0;
      else if (value >= 10) decimals = 1;
      else decimals = 2;
      let rounded;
      if (decimals === 0) rounded = Math.round(value);
      else {
        let factor = Math.pow(10, decimals);
        rounded = Math.round(value * factor) / factor;
      }
      return rounded.toFixed(decimals) + ' ' + unit.suffix;
    }
  }
  return n.toFixed(2) + ' H';
}
function calcPercent(cur, net) {
  let v = net?.value;
  if (!v || v <= 0 || !cur || cur <= 0) return "⏳";
  let percent = (cur / v) * 100;
  if (percent < 0.1) return "<0.1%";
  return Math.min(percent, 99.9).toFixed(1) + '%';
}

async function loadCachedImage(urls, file, maxAge=7) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), file);
  if (fm.fileExists(path)) {
    let mod = fm.modificationDate(path);
    if ((Date.now()-mod.getTime())/(86400000) < maxAge) {
      log(`🖼️ Loaded from cache: ${file}`);
      return Image.fromFile(path);
    }
  }
  if (haveTime() && await hasInternet()) {
    const promises = urls.map(url => {
      return new Promise(async (resolve, reject) => {
        try {
          const req = new Request(url);
          req.timeoutInterval = IMAGE_TIMEOUT/1000;
          let img = await req.loadImage();
          resolve(img);
        } catch (e) { reject(e); }
      });
    });
    try {
      const img = await Promise.race(promises);
      fm.writeImage(path, img);
      log(`   ✅ ${file} downloaded`);
      return img;
    } catch (e) {
      log(`   ❌ Failed to download ${file} from any source: ${e.message}`);
    }
  }
  if (fm.fileExists(path)) {
    log(`🖼️ Using outdated cache: ${file}`);
    return Image.fromFile(path);
  }
  return null;
}
function getCachedImageSync(file) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), file);
  if (fm.fileExists(path)) {
    log(`🖼️ Sync load from cache: ${file}`);
    return Image.fromFile(path);
  }
  return null;
}
function applyShadow(textElement) {
  textElement.shadowColor = new Color("#000000", 0.3);
  textElement.shadowRadius = 2 * scale;
  textElement.shadowOffset = new Point(2 * scale, 2 * scale);
}
async function loadFullscreenImage() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), FULLSCREEN_IMAGE_FILE);
  if (fm.fileExists(path)) {
    let mod = fm.modificationDate(path);
    if ((Date.now()-mod.getTime())/(86400000) < 7) {
      log(`🖼️ Loaded from cache: ${FULLSCREEN_IMAGE_FILE}`);
      return Image.fromFile(path);
    }
  }
  if (haveTime() && await hasInternet()) {
    const promises = FULLSCREEN_IMAGE_URLS.map(url => {
      return new Promise(async (resolve, reject) => {
        try {
          const req = new Request(url);
          req.timeoutInterval = FULLSCREEN_IMAGE_TIMEOUT/1000;
          let img = await req.loadImage();
          resolve(img);
        } catch { reject(); }
      });
    });
    try {
      const img = await Promise.race(promises);
      fm.writeImage(path, img);
      log(`   ✅ ${FULLSCREEN_IMAGE_FILE} downloaded`);
      return img;
    } catch {
      log(`   ❌ Failed to download ${FULLSCREEN_IMAGE_FILE}`);
    }
  }
  if (fm.fileExists(path)) {
    log(`🖼️ Using outdated cache: ${FULLSCREEN_IMAGE_FILE}`);
    return Image.fromFile(path);
  }
  return null;
}

async function createWidget() {
  log("\n🎨 ===== WIDGET CREATION START =====\n");
  const w = new ListWidget();
  const sizes = CONFIG;
  w.backgroundColor = THEME.background.primary;
  w.setPadding(sizes.spacing.outer.top, sizes.spacing.outer.left, sizes.spacing.outer.bottom, sizes.spacing.outer.right);
  w.cornerRadius = CORNER_RADIUS;

  let st = loadState();
  let market = {
    price: st?.price,
    priceChange24: st?.market?.priceChange24,
    priceChange7d: st?.market?.priceChange7d,
    marketCap: st?.market?.marketCap,
    volume: st?.market?.volume,
    rank: st?.market?.rank,
    circSupply: st?.market?.circSupply
  };
  let mining = { value: st?.mining };
  let burned = { value: st?.burned };
  let donors = loadDonorCache() || {};
  let qiRate = loadQiRate() || QI_RATE_FIXED;

  let quaiLogo = getCachedImageSync("quai_logo.png");
  let qiLogo = getCachedImageSync("qi_logo.png");
  let titleImage = getCachedImageSync("title_image.png");

  const firstRun = !st?.price || !st?.burned;
  if (firstRun) log("🔴 First run (cache empty)");

  if (isLowPowerMode()) {
    log("🔋 Low power mode — loading only critical data");
    if (!firstRun) return w;
  }

  // НЕТ БЛОКА С ПРОВЕРКОЙ ИНТЕРНЕТА – продолжаем с кэшем

  log("\n🔴 LOADING CRITICAL DATA (price and burned)");
  const criticalResults = await Promise.allSettled([
    fetchQuaiPrice(firstRun),
    fetchBurnedBalance(firstRun)
  ]);
  let newPrice = criticalResults[0].status === 'fulfilled' ? criticalResults[0].value : null;
  let newBurned = criticalResults[1].status === 'fulfilled' ? criticalResults[1].value : null;
  if (newPrice) { market.price = newPrice; log(`💰 Final price: ${newPrice}`); }
  if (newBurned) { burned.value = newBurned; log(`🔥 Final burned balance: ${newBurned}`); }

  if (newPrice && st.price && newPrice >= st.price * FULLSCREEN_THRESHOLD) {
    log("🚀🚀 Price growth ≥30%! Trying to show fullscreen image.");
    const bgImage = await loadFullscreenImage();
    if (bgImage) {
      log("✅ Fullscreen image loaded, creating widget with image.");
      const fullscreenWidget = new ListWidget();
      fullscreenWidget.backgroundImage = bgImage;
      fullscreenWidget.setPadding(0, 0, 0, 0);
      return fullscreenWidget;
    } else {
      log("⚠️ Failed to load fullscreen image, continuing normal widget.");
    }
  }

  const now = Date.now();
  let indicatorsUpdated = false;
  if (newBurned && st.burned && newBurned > st.burned) {
    st.lastFlameTime = now;
    indicatorsUpdated = true;
    log("🔥 Burned increased – flame timer updated");
  }
  if (newPrice && st.price) {
    if (newPrice >= st.price * ROCKET_THRESHOLD) {
      st.lastRocketTime = now;
      st.rocketBasePrice = st.price;
      indicatorsUpdated = true;
      log("🚀 Price growth ≥10% – rocket timer updated, base = " + st.price);
    }
    if (st.lastRocketTime && (now - st.lastRocketTime) < INDICATOR_WINDOW_MS) {
      if (newPrice < st.rocketBasePrice) {
        st.lastRocketTime = null;
        st.rocketBasePrice = null;
        indicatorsUpdated = true;
        log("🚀 Price fell below base – rocket turned off");
      }
    }
    if (st.lastRocketTime && (now - st.lastRocketTime) >= INDICATOR_WINDOW_MS) {
      st.lastRocketTime = null;
      st.rocketBasePrice = null;
      indicatorsUpdated = true;
      log("🚀 6 hours elapsed – rocket turned off");
    }
  }
  
  if (indicatorsUpdated) {
    try {
      if (st.lastFlameTime != null) Keychain.set(KEY_LAST_FLAME_TIME, st.lastFlameTime.toString()); else Keychain.remove(KEY_LAST_FLAME_TIME);
    } catch (e) { log("⚠️ Failed to update flame time in Keychain:", e.message); }
    try {
      if (st.lastRocketTime != null) Keychain.set(KEY_LAST_ROCKET_TIME, st.lastRocketTime.toString()); else Keychain.remove(KEY_LAST_ROCKET_TIME);
    } catch (e) { log("⚠️ Failed to update rocket time in Keychain:", e.message); }
    try {
      if (st.rocketBasePrice != null) Keychain.set(KEY_ROCKET_BASE_PRICE, st.rocketBasePrice.toString()); else Keychain.remove(KEY_ROCKET_BASE_PRICE);
    } catch (e) { log("⚠️ Failed to update rocket base price in Keychain:", e.message); }
  }

  saveState({ price: market.price, burned: burned.value, timestamp: Date.now() });
  if (newPrice && st?.price) {
    if (!await shouldRefreshDueToPriceChange(st.price, newPrice)) {
      log("💰 Price change insignificant, keeping old value");
      market.price = st.price;
    }
  }

  log("\n📦 LOADING OTHER DATA");
  let otherPromises = [];

  if (timeLeft() > 3500 && shouldFetchWithHealth('marketData', firstRun)) otherPromises.push(fetchMarketData(firstRun).then(v => v && Object.assign(market, v)));
  if (timeLeft() > 2500 && shouldFetchWithHealth('qiRate', firstRun)) otherPromises.push(fetchQiRate(firstRun).then(v => v && (qiRate = v)));

  if (timeLeft() > 3000 && shouldFetchWithHealth('miningInfo', firstRun)) {
    otherPromises.push(fetchMiningInfo(firstRun).then(v => v && (mining.value = v)));
  }

  if (timeLeft() > 2000) {
    otherPromises.push(fetchDonorNetworkHashrate(firstRun).then(v => v && (donors = v)));
  }

  let donorPrices = {};
  let revenue24h = null;

  if (timeLeft() > 2000 && shouldFetchWithHealth('soapData', firstRun)) {
    const soapPromises = [
      fetchDonorPrices(firstRun).then(v => { if (v) donorPrices = v; }),
      fetchRevenue24h(firstRun, mining.value, donors, donorPrices).then(v => { if (v !== null) revenue24h = v; })
    ];
    await Promise.allSettled(soapPromises);
  } else {
    const cachedPrices = loadDonorPricesCache();
    if (cachedPrices) donorPrices = cachedPrices;
    const cachedRevenue = loadRevenueCache();
    if (cachedRevenue !== null) revenue24h = cachedRevenue;
  }

  await Promise.allSettled(otherPromises);

  if (revenue24h === null && mining.value && donors && donorPrices) {
    revenue24h = calculateBackupRevenue(mining.value, donors, donorPrices);
  }

  let finalState = {
    price: market.price,
    burned: burned.value,
    market: market,
    mining: mining.value,
    timestamp: Date.now(),
    lastFlameTime: st.lastFlameTime,
    lastRocketTime: st.lastRocketTime,
    rocketBasePrice: st.rocketBasePrice
  };
  saveState(finalState);
  saveDonorCache(donors);
  if (qiRate) saveQiRate(qiRate);

  if (haveTime() && await hasInternet()) {
    log("\n🖼️ LOADING IMAGES (parallel with 1.5s timeouts)");
    const overallTimeout = new Promise((_, reject) => {
      Timer.schedule(5000, false, () => reject(new Error('Image loading timeout')));
    });
    const imagePromises = Promise.allSettled([
      loadCachedImage([
        "https://s10.iimage.su/s/23/g0zlWy9x8Q4zeiHP1SYVR1SZaUR3KfJuiiBZzE9Gl.png",
        "https://i.ibb.co/whFkkYBP/Quai.png",
        "https://img.ge/i/y1qw411.png"
      ], "quai_logo.png", 7),
      loadCachedImage([
        "https://s10.iimage.su/s/23/gOA0KR2xLiWzTQokq5XLzm42ZACOu2prXko3QwzkY.png",
        "https://i.ibb.co/GQV7VFqR/Qi.png",
        "https://img.ge/i/BFEKa26.png"
      ], "qi_logo.png", 7),
      loadCachedImage([
        "https://s10.iimage.su/s/23/gweGgiyxbklIQCC0ND9gsPwEEniaNiscu7pHb639F.png",
        "https://i.ibb.co/pBfLX6Zc/Quai-Network.png",
        "https://img.ge/i/n65NT89.png"
      ], "title_image.png", 7)
    ]);
    try {
      const results = await Promise.race([imagePromises, overallTimeout]);
      if (Array.isArray(results) && results.length === 3) {
        const [quaiResult, qiResult, titleResult] = results;
        if (quaiResult.status === 'fulfilled' && quaiResult.value) quaiLogo = quaiResult.value;
        else log(`⚠️ quai_logo not loaded`);
        if (qiResult.status === 'fulfilled' && qiResult.value) qiLogo = qiResult.value;
        else log(`⚠️ qi_logo not loaded`);
        if (titleResult.status === 'fulfilled' && titleResult.value) titleImage = titleResult.value;
        else log(`⚠️ title_image not loaded`);
      }
    } catch (e) {
      log(`⚠️ Image loading overall timeout (5s)`);
    }
  }

  log(`🎯 24h Revenue to display: ${revenue24h ? formatNumberWithDollar(revenue24h) : "⏳"}`);
  let qiUsd = qiRate && market.price ? qiRate * market.price : null;
  if (qiUsd) log(`⚡ Qi USD: ${qiUsd}`);

  let sha = mining.value?.shaHashRate ? formatHashrate(mining.value.shaHashRate) : "⏳";
  let scr = mining.value?.scryptHashRate ? formatHashrate(mining.value.scryptHashRate) : "⏳";
  let kaw = mining.value?.kawpowHashRate ? formatHashrate(mining.value.kawpowHashRate) : "⏳";
  let curSha = mining.value?.shaHashRate ? parseFloat(mining.value.shaHashRate) : null;
  let curScr = mining.value?.scryptHashRate ? parseFloat(mining.value.scryptHashRate) : null;
  let curKaw = mining.value?.kawpowHashRate ? parseFloat(mining.value.kawpowHashRate) : null;
  let pct = {
    btc: calcPercent(curSha, donors.btc),
    bch: calcPercent(curSha, donors.bch),
    ltc: calcPercent(curScr, donors.ltc),
    doge: calcPercent(curScr, donors.doge),
    rvn: calcPercent(curKaw, donors.rvn)
  };
  log("📊 Donor percentages:", JSON.stringify(pct));
  log("🖌️ Starting UI drawing...");

  let showFlame = (st.lastFlameTime && (Date.now() - st.lastFlameTime) < INDICATOR_WINDOW_MS);
  let showRocket = (st.lastRocketTime && (Date.now() - st.lastRocketTime) < INDICATOR_WINDOW_MS && market.price >= st.rocketBasePrice);

  let priceRow = w.addStack(); priceRow.layoutHorizontally();

  let quaiContainer = createStyledContainer(priceRow, new Color("#1C1C1C", 0.3),
    sizes.spacing.priceContainerPadding.top, sizes.spacing.priceContainerPadding.bottom,
    sizes.spacing.priceContainerPadding.left, sizes.spacing.priceContainerPadding.right);
  quaiContainer.outer.widthWeight = 1;
  let quaiCont = quaiContainer.inner;
  quaiCont.addSpacer(sizes.spacing.priceContainerPadding.top);
  let quaiStack = quaiCont.addStack(); quaiStack.layoutHorizontally(); quaiStack.centerAlignContent(); quaiStack.addSpacer();

  if (showRocket) {
    let rocket = quaiStack.addText("🚀");
    rocket.font = Font.boldSystemFont(sizes.fonts.price);
    rocket.textColor = THEME.text.primary;
    rocket.minimumScaleFactor = 0.85;
    applyShadow(rocket);
  } else if (quaiLogo) {
    let img = quaiStack.addImage(quaiLogo);
    img.imageSize = new Size(sizes.logos.topQuaiSize, sizes.logos.topQuaiSize);
    img.cornerRadius = sizes.logos.cornerRadius;
  } else {
    let fallback = quaiStack.addText("🪙");
    fallback.font = Font.boldSystemFont(sizes.fonts.price);
    fallback.textColor = THEME.text.secondary;
    fallback.minimumScaleFactor = 0.85;
    applyShadow(fallback);
  }
  quaiStack.addSpacer(sizes.spacing.gaps.priceLogo);
  let quaiPrice = quaiStack.addText(formatPrice(market.price));
  quaiPrice.font = Font.boldSystemFont(sizes.fonts.price);
  quaiPrice.textColor = market.price ? COLOR_PRICE_POSITIVE : THEME.text.secondary;
  quaiPrice.minimumScaleFactor = 0.85;
  applyShadow(quaiPrice);
  quaiStack.addSpacer();
  quaiCont.addSpacer(sizes.spacing.priceContainerPadding.bottom);

  priceRow.addSpacer(sizes.spacing.gaps.priceColumns);

  let qiContainer = createStyledContainer(priceRow, new Color("#1C1C1C", 0.3),
    sizes.spacing.priceContainerPadding.top, sizes.spacing.priceContainerPadding.bottom,
    sizes.spacing.priceContainerPadding.left, sizes.spacing.priceContainerPadding.right);
  qiContainer.outer.widthWeight = 1;
  let qiCont = qiContainer.inner;
  qiCont.addSpacer(sizes.spacing.priceContainerPadding.top);
  let qiStack = qiCont.addStack(); qiStack.layoutHorizontally(); qiStack.centerAlignContent(); qiStack.addSpacer();
  if (qiLogo) {
    let img = qiStack.addImage(qiLogo);
    img.imageSize = new Size(sizes.logos.topQiSize, sizes.logos.topQiSize);
    img.cornerRadius = sizes.logos.cornerRadius;
  } else {
    let fallback = qiStack.addText("⚡");
    fallback.font = Font.boldSystemFont(sizes.fonts.price);
    fallback.textColor = THEME.text.secondary;
    fallback.minimumScaleFactor = 0.85;
    applyShadow(fallback);
  }
  qiStack.addSpacer(sizes.spacing.gaps.priceLogo);
  let qiPrice = qiStack.addText(formatPrice(qiUsd));
  qiPrice.font = Font.boldSystemFont(sizes.fonts.price);
  qiPrice.textColor = qiUsd ? COLOR_PRICE_POSITIVE : THEME.text.secondary;
  qiPrice.minimumScaleFactor = 0.85;
  applyShadow(qiPrice);
  qiStack.addSpacer();
  qiCont.addSpacer(sizes.spacing.priceContainerPadding.bottom);

  w.addSpacer(sizes.spacing.betweenContainers.afterPrice);

  let metricsContainer = createStyledContainer(w, new Color("#1C1C1C", 0.3),
    sizes.spacing.metricsContainerPadding.top, sizes.spacing.metricsContainerPadding.bottom,
    sizes.spacing.metricsContainerPadding.left, sizes.spacing.metricsContainerPadding.right);
  metricsContainer.outer.widthWeight = 1;
  let metricsCont = metricsContainer.inner;
  metricsCont.addSpacer(sizes.spacing.metricsContainerPadding.top);
  let metricsRow = metricsCont.addStack(); metricsRow.layoutHorizontally();

  let metricItems = [
    { lbl:"· CIRC ·", val: formatNumberNoDollar(market.circSupply), avail: market.circSupply != null },
    { lbl:"· VOL ·", val: formatNumberWithDollar(market.volume), avail: market.volume != null },
    { lbl:"· RANK ·", val: formatRank(market.rank), avail: market.rank != null },
    { lbl:"· MCAP ·", val: formatNumberWithDollar(market.marketCap), avail: market.marketCap != null }
  ];
  for (let i = 0; i < metricItems.length; i++) {
    let item = metricItems[i];
    let col = metricsRow.addStack(); col.layoutVertically(); col.widthWeight = 1;
    let labelRow = col.addStack(); labelRow.layoutHorizontally(); labelRow.addSpacer();
    let labelText = labelRow.addText(item.lbl);
    labelText.font = Font.regularSystemFont(sizes.fonts.algorithm);
    labelText.textColor = THEME.text.secondary;
    labelText.minimumScaleFactor = 0.85;
    applyShadow(labelText);
    labelRow.addSpacer();
    col.addSpacer(0);
    let valueRow = col.addStack(); valueRow.layoutHorizontally(); valueRow.addSpacer();
    let valueText = valueRow.addText(item.avail ? item.val : "⏳");
    valueText.font = Font.regularSystemFont(sizes.fonts.metric);
    valueText.textColor = item.avail ? THEME.text.primary : THEME.text.secondary;
    valueText.minimumScaleFactor = 0.85;
    applyShadow(valueText);
    valueRow.addSpacer();
    if (i < metricItems.length - 1) metricsRow.addSpacer(sizes.spacing.gaps.metricsItems);
  }
  metricsCont.addSpacer(sizes.spacing.metricsContainerPadding.bottom);
  w.addSpacer(sizes.spacing.betweenContainers.afterMetrics);

  let titleWrapper = w.addStack();
  titleWrapper.layoutVertically();
  titleWrapper.setPadding(sizes.titleImage.padding.top, sizes.titleImage.padding.left, sizes.titleImage.padding.bottom, sizes.titleImage.padding.right);
  let titleRow = titleWrapper.addStack();
  titleRow.layoutHorizontally();
  titleRow.addSpacer();
  if (titleImage) {
    let titleImg = titleRow.addImage(titleImage);
    titleImg.imageSize = new Size(sizes.titleImage.width, sizes.titleImage.height);
  } else {
    let titleText = titleRow.addText("QUAI NETWORK");
    titleText.font = Font.boldSystemFont(20 * scale);
    titleText.textColor = THEME.text.primary;
    titleText.minimumScaleFactor = 0.85;
    applyShadow(titleText);
  }
  titleRow.addSpacer();
  w.addSpacer(sizes.spacing.betweenContainers.afterTitle);

  let hrRow = w.addStack(); hrRow.layoutHorizontally();

  let shaContainer = createStyledContainer(hrRow, new Color("#1C1C1C", 0.3),
    sizes.spacing.hashrateContainerPadding.top, sizes.spacing.hashrateContainerPadding.bottom,
    sizes.spacing.hashrateContainerPadding.left, sizes.spacing.hashrateContainerPadding.right);
  shaContainer.outer.widthWeight = 1;
  let shaSt = shaContainer.inner;
  shaSt.addSpacer(sizes.spacing.hashrateContainerPadding.top);
  let shaValRow = shaSt.addStack(); shaValRow.layoutHorizontally(); shaValRow.addSpacer();
  let shaVal = shaValRow.addText(sha);
  shaVal.font = Font.regularSystemFont(sizes.fonts.hashrate);
  shaVal.textColor = mining.value?.shaHashRate ? THEME.text.primary : THEME.text.secondary;
  shaVal.minimumScaleFactor = 0.85;
  applyShadow(shaVal);
  shaValRow.addSpacer();
  shaSt.addSpacer(sizes.spacing.gaps.hashrateInner);
  let btcR = shaSt.addStack(); btcR.layoutHorizontally(); btcR.addSpacer();
  let btcL = btcR.addText(`BTC ${pct.btc}`);
  btcL.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  btcL.textColor = THEME.text.secondary;
  btcL.minimumScaleFactor = 0.85;
  applyShadow(btcL);
  btcR.addSpacer();
  shaSt.addSpacer(sizes.spacing.gaps.donorLines);
  let bchR = shaSt.addStack(); bchR.layoutHorizontally(); bchR.addSpacer();
  let bchL = bchR.addText(`BCH ${pct.bch}`);
  bchL.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  bchL.textColor = THEME.text.secondary;
  bchL.minimumScaleFactor = 0.85;
  applyShadow(bchL);
  bchR.addSpacer();
  shaSt.addSpacer(sizes.spacing.hashrateContainerPadding.bottom);
  hrRow.addSpacer(sizes.spacing.gaps.hashrateColumns);

  let scrContainer = createStyledContainer(hrRow, new Color("#1C1C1C", 0.3),
    sizes.spacing.hashrateContainerPadding.top, sizes.spacing.hashrateContainerPadding.bottom,
    sizes.spacing.hashrateContainerPadding.left, sizes.spacing.hashrateContainerPadding.right);
  scrContainer.outer.widthWeight = 1;
  let scrSt = scrContainer.inner;
  scrSt.addSpacer(sizes.spacing.hashrateContainerPadding.top);
  let scrValRow = scrSt.addStack(); scrValRow.layoutHorizontally(); scrValRow.addSpacer();
  let scrVal = scrValRow.addText(scr);
  scrVal.font = Font.regularSystemFont(sizes.fonts.hashrate);
  scrVal.textColor = mining.value?.scryptHashRate ? THEME.text.primary : THEME.text.secondary;
  scrVal.minimumScaleFactor = 0.85;
  applyShadow(scrVal);
  scrValRow.addSpacer();
  scrSt.addSpacer(sizes.spacing.gaps.hashrateInner);
  let ltcR = scrSt.addStack(); ltcR.layoutHorizontally(); ltcR.addSpacer();
  let ltcL = ltcR.addText(`LTC ${pct.ltc}`);
  ltcL.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  ltcL.textColor = THEME.text.secondary;
  ltcL.minimumScaleFactor = 0.85;
  applyShadow(ltcL);
  ltcR.addSpacer();
  scrSt.addSpacer(sizes.spacing.gaps.donorLines);
  let dogeR = scrSt.addStack(); dogeR.layoutHorizontally(); dogeR.addSpacer();
  let dogeL = dogeR.addText(`DOGE ${pct.doge}`);
  dogeL.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  dogeL.textColor = THEME.text.secondary;
  dogeL.minimumScaleFactor = 0.85;
  applyShadow(dogeL);
  dogeR.addSpacer();
  scrSt.addSpacer(sizes.spacing.hashrateContainerPadding.bottom);
  hrRow.addSpacer(sizes.spacing.gaps.hashrateColumns);

  let kawContainer = createStyledContainer(hrRow, new Color("#1C1C1C", 0.3),
    sizes.spacing.hashrateContainerPadding.top, sizes.spacing.hashrateContainerPadding.bottom,
    sizes.spacing.hashrateContainerPadding.left, sizes.spacing.hashrateContainerPadding.right);
  kawContainer.outer.widthWeight = 1;
  let kawSt = kawContainer.inner;
  kawSt.addSpacer(sizes.spacing.hashrateContainerPadding.top);
  let kawValRow = kawSt.addStack(); kawValRow.layoutHorizontally(); kawValRow.addSpacer();
  let kawVal = kawValRow.addText(kaw);
  kawVal.font = Font.regularSystemFont(sizes.fonts.hashrate);
  kawVal.textColor = mining.value?.kawpowHashRate ? THEME.text.primary : THEME.text.secondary;
  kawVal.minimumScaleFactor = 0.85;
  applyShadow(kawVal);
  kawValRow.addSpacer();
  kawSt.addSpacer(sizes.spacing.gaps.hashrateInner);
  let rvnR = kawSt.addStack(); rvnR.layoutHorizontally(); rvnR.addSpacer();
  let rvnL = rvnR.addText(`RVN ${pct.rvn}`);
  rvnL.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  rvnL.textColor = THEME.text.secondary;
  rvnL.minimumScaleFactor = 0.85;
  applyShadow(rvnL);
  rvnR.addSpacer();
  kawSt.addSpacer(sizes.spacing.gaps.donorLines);
  let emptyRow = kawSt.addStack(); emptyRow.layoutHorizontally(); emptyRow.addSpacer();
  let emptyText = emptyRow.addText(` `);
  emptyText.font = Font.regularSystemFont(sizes.fonts.donorPercent);
  emptyText.textColor = Color.clear();
  emptyText.minimumScaleFactor = 0.85;
  emptyRow.addSpacer();
  kawSt.addSpacer(sizes.spacing.hashrateContainerPadding.bottom);

  w.addSpacer(sizes.spacing.betweenContainers.afterHashrate);

  let burnOuter = w.addStack(); burnOuter.layoutHorizontally();
  let burnContainer = createStyledContainer(burnOuter, new Color("#1C1C1C", 0.3),
    sizes.spacing.burnContainerPadding.top, sizes.spacing.burnContainerPadding.bottom,
    sizes.spacing.burnContainerPadding.left, sizes.spacing.burnContainerPadding.right);
  burnContainer.outer.widthWeight = 1;
  let burnCont = burnContainer.inner;
  burnCont.addSpacer(sizes.spacing.burnContainerPadding.top);
  let burnRow = burnCont.addStack(); burnRow.layoutHorizontally(); burnRow.centerAlignContent(); burnRow.addSpacer();

  let leftBurnCol = burnRow.addStack(); leftBurnCol.layoutHorizontally(); leftBurnCol.centerAlignContent();
  let qLeft = leftBurnCol.addText("QUAI");
  qLeft.font = Font.regularSystemFont(sizes.fonts.burnValue);
  qLeft.textColor = THEME.text.secondary;
  qLeft.minimumScaleFactor = 0.85;
  applyShadow(qLeft);
  leftBurnCol.addSpacer(sizes.spacing.gaps.burnLeftInner);

  if (showFlame) {
    let flame = leftBurnCol.addText("🔥");
    flame.font = Font.regularSystemFont(sizes.fonts.burnValue);
    flame.textColor = THEME.text.primary;
    flame.minimumScaleFactor = 0.85;
    applyShadow(flame);
  } else if (quaiLogo) {
    let img = leftBurnCol.addImage(quaiLogo);
    img.imageSize = new Size(sizes.logos.bottomQuaiSize, sizes.logos.bottomQuaiSize);
    img.cornerRadius = sizes.logos.cornerRadius;
  } else {
    let coin = leftBurnCol.addText("🪙");
    coin.font = Font.regularSystemFont(sizes.fonts.burnValue);
    coin.textColor = THEME.text.secondary;
    coin.minimumScaleFactor = 0.85;
    applyShadow(coin);
  }

  leftBurnCol.addSpacer(sizes.spacing.gaps.burnLeftInner);
  let burnedVal = leftBurnCol.addText(burned.value ? formatNumberNoDollar(burned.value) : "⏳");
  burnedVal.font = Font.regularSystemFont(sizes.fonts.burnValue);
  burnedVal.textColor = burned.value ? COLOR_BURNED_ORANGE : THEME.text.secondary;
  burnedVal.minimumScaleFactor = 0.85;
  applyShadow(burnedVal);

  burnRow.addSpacer(sizes.spacing.gaps.arrow);
  let arrowStack = burnRow.addStack();
  arrowStack.centerAlignContent();
  let arrow = arrowStack.addText("←");
  arrow.font = Font.regularSystemFont(sizes.fonts.burnValue);
  arrow.textColor = THEME.text.secondary;
  arrow.minimumScaleFactor = 0.85;
  applyShadow(arrow);
  burnRow.addSpacer(sizes.spacing.gaps.arrow);

  let rightBurnCol = burnRow.addStack(); rightBurnCol.layoutHorizontally(); rightBurnCol.centerAlignContent();
  let revenueDisp = revenue24h ? formatNumberWithDollar(revenue24h) : "⏳";
  let revenueVal = rightBurnCol.addText(revenueDisp);
  revenueVal.font = Font.regularSystemFont(sizes.fonts.burnValue);
  revenueVal.textColor = revenue24h ? COLOR_PRICE_POSITIVE : THEME.text.secondary;
  revenueVal.minimumScaleFactor = 0.85;
  applyShadow(revenueVal);
  rightBurnCol.addSpacer(sizes.spacing.gaps.burnRightInner);
  let hour = rightBurnCol.addText("💸");
  hour.font = Font.regularSystemFont(sizes.fonts.burnValue);
  hour.textColor = THEME.text.secondary;
  applyShadow(hour);
  rightBurnCol.addSpacer(sizes.spacing.gaps.burnRightInner);
  let dayL = rightBurnCol.addText("24h");
  dayL.font = Font.regularSystemFont(sizes.fonts.burnValue);
  dayL.textColor = THEME.text.secondary;
  dayL.minimumScaleFactor = 0.85;
  applyShadow(dayL);

  burnRow.addSpacer();
  burnCont.addSpacer(sizes.spacing.burnContainerPadding.bottom);

  widgetHealth.lastSuccess = Date.now();
  widgetHealth.consecutiveFails = 0;
  widgetHealth.isThrottled = false;
  saveHealth();
  log("✅ Widget health updated (success).");

  const totalTime = Date.now() - SCRIPT_START;
  log(`\n✅ ===== WIDGET CREATED =====`);
  log(`⏱️ Total execution time: ${totalTime}ms`);
  return w;
}

if (config.runsInWidget) {
  let w;
  try {
    w = await createWidget();
  } catch (e) {
    console.log("❌ CRITICAL ERROR:", e.message);
    console.log(e.stack);
    w = new ListWidget();
    w.addText("Error: " + e.message);
    w.backgroundColor = THEME.background.primary;
    w.cornerRadius = CORNER_RADIUS;
    widgetHealth.consecutiveFails = (widgetHealth.consecutiveFails || 0) + 1;
    saveHealth();
  }
  w.refreshAfterDate = new Date(Date.now() + 900000);
  Script.setWidget(w);
} else {
  let w = await createWidget();
  await w.presentLarge();
  Script.setWidget(w);
  console.log("🏁 Manual run completed");
  Script.complete();
}