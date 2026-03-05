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
    log("⛔ Throttled mode: more than 2 hours without success. Loading only critical (price).");
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
  price: 0,
  qiRate: 1
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
  return true;
}

const COLOR_PRICE_POSITIVE = new Color("#2CE6B0");
const THEME = {
  background: { primary: new Color("#1C1C1C", 0), surface: new Color("#1C1C1E") },
  text: { primary: new Color("#FFFFFF"), secondary: new Color("#EBEBF5", 0.7) },
};
log("🎨 Theme and colors loaded.");

const INDICATOR_WINDOW_MS = 6 * 60 * 60 * 1000;
const ROCKET_THRESHOLD = 1.10;

function getBaseLayout() {
  return {
    outerPaddingTop: 15, outerPaddingBottom: 15, outerPaddingLeft: 15, outerPaddingRight: 15,
    spacingAfterPrice: 15,
    priceContainerPaddingTop: 2, priceContainerPaddingBottom: 2,
    priceContainerPaddingLeft: 6, priceContainerPaddingRight: 6,
    fontSize: { price: 26 },
    topLogoSize: 26,
    priceLogoGap: 4,
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
const CORNER_RADIUS = 16 * scale;
const CONFIG = (() => {
  const fixed = LAYOUT;
  return {
    fonts: fixed.fontSize,
    spacing: {
      outer: { top: fixed.outerPaddingTop, bottom: fixed.outerPaddingBottom, left: fixed.outerPaddingLeft, right: fixed.outerPaddingRight },
      betweenContainers: { afterPrice: fixed.spacingAfterPrice },
      priceContainerPadding: { top: fixed.priceContainerPaddingTop, bottom: fixed.priceContainerPaddingBottom, left: fixed.priceContainerPaddingLeft, right: fixed.priceContainerPaddingRight },
      gaps: { priceLogo: fixed.priceLogoGap }
    },
    logos: { topQuaiSize: fixed.topLogoSize, topQiSize: fixed.topLogoSize, cornerRadius: 8 * scale },
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
  i.borderColor = new Color("#FFFFFF", 0.2);
  i.borderWidth = 1.5 * scale;
  i.shadowColor = new Color("#000000", 0.45);
  i.shadowRadius = 22 * scale;
  i.shadowOffset = new Point(0, 6 * scale);
  i.setPadding(pt, pl, pb, pr);
  return { outer: w, inner: i };
}

// Keychain keys – только необходимые
const KEY_LAST_PRICE = "soap_last_price";
const KEY_QI_RATE = "soap_qi_rate";
const KEY_LAST_ROCKET_TIME = "soap_last_rocket_time";
const KEY_ROCKET_BASE_PRICE = "soap_rocket_base_price";
const KEY_TIMESTAMP = "soap_timestamp";
log("🔑 Keychain keys initialized.");

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const QI_RATE_MIN = 0.01; const QI_RATE_MAX = 100.0; const QI_RATE_FIXED = 11.323375;
const RPC_ENDPOINTS = [
  { url: 'https://rpc.quai.network/cyprus1', priority: 1, timeout: 4000, name: 'RPC #1' },
  { url: 'https://rpc.cyprus1.colosseum.quaiscan.io', priority: 2, timeout: 2000, name: 'RPC #2' },
  { url: 'https://quai.drpc.org', priority: 3, timeout: 2000, name: 'RPC #3' }
];
const IMAGE_TIMEOUT = 3000;

function loadState() {
  log("📂 Loading state from Keychain...");
  const s = { price:null, timestamp:null, lastRocketTime:null, rocketBasePrice:null };
  try { let v = Keychain.get(KEY_LAST_PRICE); if(v) { s.price = parseFloat(v); log(`   → Price: ${s.price}`); } } catch(e){ log("⚠️ Error reading price:", e.message); }
  try { let v = Keychain.get(KEY_TIMESTAMP); if(v) { s.timestamp = parseInt(v,10); log(`   → Timestamp: ${new Date(s.timestamp).toLocaleString()}`); } } catch(e){ log("⚠️ Error reading timestamp:", e.message); }
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
    if (state.timestamp != null) Keychain.set(KEY_TIMESTAMP, state.timestamp.toString());
    if (state.lastRocketTime != null) Keychain.set(KEY_LAST_ROCKET_TIME, state.lastRocketTime.toString()); else Keychain.remove(KEY_LAST_ROCKET_TIME);
    if (state.rocketBasePrice != null) Keychain.set(KEY_ROCKET_BASE_PRICE, state.rocketBasePrice.toString()); else Keychain.remove(KEY_ROCKET_BASE_PRICE);
    log(`   ✅ Saved (${sizeKB.toFixed(1)} KB)`);
  } catch(e){ log("⚠️ Error saving:", e.message); }
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
    const keys = [KEY_LAST_PRICE, KEY_QI_RATE, KEY_LAST_ROCKET_TIME, KEY_ROCKET_BASE_PRICE, KEY_TIMESTAMP];
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

async function createWidget() {
  log("\n🎨 ===== WIDGET CREATION START =====\n");
  const w = new ListWidget();
  const sizes = CONFIG;
  w.backgroundColor = THEME.background.primary;
  w.setPadding(sizes.spacing.outer.top, sizes.spacing.outer.left, sizes.spacing.outer.bottom, sizes.spacing.outer.right);
  w.cornerRadius = CORNER_RADIUS;

  let st = loadState();
  let marketPrice = st?.price;
  let qiRate = loadQiRate() || QI_RATE_FIXED;

  let quaiLogo = getCachedImageSync("quai_logo.png");
  let qiLogo = getCachedImageSync("qi_logo.png");

  const firstRun = !st?.price;
  if (firstRun) log("🔴 First run (cache empty)");

  if (isLowPowerMode()) {
    log("🔋 Low power mode — loading only critical data");
    if (!firstRun) return w;
  }

  log("\n🔴 LOADING CRITICAL DATA (price)");
  const criticalResults = await Promise.allSettled([
    fetchQuaiPrice(firstRun)
  ]);
  let newPrice = criticalResults[0].status === 'fulfilled' ? criticalResults[0].value : null;
  if (newPrice) { marketPrice = newPrice; log(`💰 Final price: ${newPrice}`); }

  const now = Date.now();
  let indicatorsUpdated = false;
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
      if (st.lastRocketTime != null) Keychain.set(KEY_LAST_ROCKET_TIME, st.lastRocketTime.toString()); else Keychain.remove(KEY_LAST_ROCKET_TIME);
    } catch (e) { log("⚠️ Failed to update rocket time in Keychain:", e.message); }
    try {
      if (st.rocketBasePrice != null) Keychain.set(KEY_ROCKET_BASE_PRICE, st.rocketBasePrice.toString()); else Keychain.remove(KEY_ROCKET_BASE_PRICE);
    } catch (e) { log("⚠️ Failed to update rocket base price in Keychain:", e.message); }
  }

  saveState({ price: marketPrice, timestamp: Date.now() });
  if (newPrice && st?.price) {
    if (!await shouldRefreshDueToPriceChange(st.price, newPrice)) {
      log("💰 Price change insignificant, keeping old value");
      marketPrice = st.price;
    }
  }

  log("\n📦 LOADING OTHER DATA");
  let otherPromises = [];

  if (timeLeft() > 2500 && shouldFetchWithHealth('qiRate', firstRun)) {
    otherPromises.push(fetchQiRate(firstRun).then(v => v && (qiRate = v)));
  }

  await Promise.allSettled(otherPromises);

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
      ], "qi_logo.png", 7)
    ]);
    try {
      const results = await Promise.race([imagePromises, overallTimeout]);
      if (Array.isArray(results) && results.length === 2) {
        const [quaiResult, qiResult] = results;
        if (quaiResult.status === 'fulfilled' && quaiResult.value) quaiLogo = quaiResult.value;
        else log(`⚠️ quai_logo not loaded`);
        if (qiResult.status === 'fulfilled' && qiResult.value) qiLogo = qiResult.value;
        else log(`⚠️ qi_logo not loaded`);
      }
    } catch (e) {
      log(`⚠️ Image loading overall timeout (5s)`);
    }
  }

  let qiUsd = qiRate && marketPrice ? qiRate * marketPrice : null;
  if (qiUsd) log(`⚡ Qi USD: ${qiUsd}`);

  let showRocket = (st.lastRocketTime && (now - st.lastRocketTime) < INDICATOR_WINDOW_MS && marketPrice >= st.rocketBasePrice);

  // ---- QUAI container (top) ----
  let quaiContainer = createStyledContainer(w, new Color("#1C1C1C", 0.3),
    sizes.spacing.priceContainerPadding.top, sizes.spacing.priceContainerPadding.bottom,
    sizes.spacing.priceContainerPadding.left, sizes.spacing.priceContainerPadding.right);
  quaiContainer.outer.widthWeight = 1;
  let quaiCont = quaiContainer.inner;
  quaiCont.addSpacer();
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
  let quaiPrice = quaiStack.addText(formatPrice(marketPrice));
  quaiPrice.font = Font.boldSystemFont(sizes.fonts.price);
  quaiPrice.textColor = marketPrice ? COLOR_PRICE_POSITIVE : THEME.text.secondary;
  quaiPrice.minimumScaleFactor = 0.85;
  applyShadow(quaiPrice);
  quaiStack.addSpacer();
  quaiCont.addSpacer();

  w.addSpacer(sizes.spacing.betweenContainers.afterPrice);

  // ---- QI container (bottom) ----
  let qiContainer = createStyledContainer(w, new Color("#1C1C1C", 0.3),
    sizes.spacing.priceContainerPadding.top, sizes.spacing.priceContainerPadding.bottom,
    sizes.spacing.priceContainerPadding.left, sizes.spacing.priceContainerPadding.right);
  qiContainer.outer.widthWeight = 1;
  let qiCont = qiContainer.inner;
  qiCont.addSpacer();
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
  qiCont.addSpacer();

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
  await w.presentSmall();
  Script.setWidget(w);
  console.log("🏁 Manual run completed");
  Script.complete();
}