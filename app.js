/* RiskDesk v2 — app.js
 * Kalkulator risiko, jurnal, analitik, dan jembatan MT5.
 * Semua data disimpan di localStorage; sinkronisasi cloud (Supabase) bersifat opsional.
 */
(() => {
"use strict";

const VERSION = "2.7.0";
const KEY = "riskdesk.v2", OLD_KEY = "riskdesk.v1", AUTH_KEY = "riskdesk.auth";

/* ================================================================
 * 1. DATA BAWAAN
 * ================================================================ */
// s=simbol, c=kategori, cs=contract size, pip=ukuran pip, d=digit, q=mata uang kutipan,
// spr=spread (pip), swL/swS=swap buy/sell per lot per malam (mata uang akun)
const mk = (s, c, cs, pip, d, q, spr) => ({ s, c, cs, pip, d, q, spr, swL: 0, swS: 0 });
const fx = (s, c, spr) => mk(s, c, 100000, s.endsWith("JPY") ? 0.01 : 0.0001, s.endsWith("JPY") ? 3 : 5, s.slice(3), spr);
const DEFAULT_SYMBOLS = [
  ...["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"].map(s => fx(s, "Forex Major", 1.2)),
  ...["EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD","GBPJPY","GBPCHF","GBPAUD","GBPCAD","GBPNZD",
      "AUDJPY","AUDCHF","AUDCAD","AUDNZD","NZDJPY","NZDCHF","NZDCAD","CADJPY","CADCHF","CHFJPY"].map(s => fx(s, "Forex Minor", 2.5)),
  ...["USDSGD","USDHKD","USDZAR","USDMXN","USDTRY","USDNOK","USDSEK","USDPLN","USDCNH","USDDKK","USDHUF","USDCZK",
      "EURTRY","EURNOK","EURSEK","EURPLN","EURZAR","EURHUF","GBPZAR","GBPSGD","AUDSGD","SGDJPY"].map(s => fx(s, "Forex Exotic", 30)),
  mk("XAUUSD","Logam",100,0.1,2,"USD",3), mk("XAGUSD","Logam",5000,0.01,3,"USD",3), mk("XAUEUR","Logam",100,0.1,2,"EUR",5),
  mk("XPTUSD","Logam",100,0.1,2,"USD",30), mk("XPDUSD","Logam",100,0.1,2,"USD",50),
  mk("US30","Indeks",1,1,2,"USD",2), mk("US500","Indeks",1,0.1,2,"USD",5), mk("NAS100","Indeks",1,1,2,"USD",1.5), mk("US2000","Indeks",1,0.1,2,"USD",3),
  mk("GER40","Indeks",1,1,2,"EUR",1.5), mk("UK100","Indeks",1,1,2,"GBP",1.5), mk("FRA40","Indeks",1,1,2,"EUR",1.5), mk("EU50","Indeks",1,1,2,"EUR",2),
  mk("JP225","Indeks",100,1,0,"JPY",10), mk("AUS200","Indeks",1,1,2,"AUD",2), mk("HK50","Indeks",1,1,2,"HKD",8),
  mk("USOIL","Energi",100,0.01,2,"USD",3), mk("UKOIL","Energi",100,0.01,2,"USD",4), mk("XNGUSD","Energi",10000,0.001,3,"USD",5),
  mk("BTCUSD","Kripto",1,1,2,"USD",20), mk("ETHUSD","Kripto",1,0.1,2,"USD",20), mk("SOLUSD","Kripto",1,0.01,2,"USD",20),
  mk("BNBUSD","Kripto",1,0.1,2,"USD",10), mk("XRPUSD","Kripto",1,0.0001,4,"USD",20), mk("LTCUSD","Kripto",1,0.01,2,"USD",20),
  mk("ADAUSD","Kripto",1,0.0001,4,"USD",20), mk("DOGEUSD","Kripto",1,0.00001,5,"USD",30)
];

// 1 USD = x mata uang (perkiraan; perbarui di Pengaturan → Kurs). USC = akun cent.
const DEFAULT_RATES = { USD:1, USC:1, EUR:0.86, GBP:0.74, JPY:147, CHF:0.80, CAD:1.38, AUD:1.52, NZD:1.70, SGD:1.29, HKD:7.80,
  ZAR:17.6, MXN:18.6, TRY:41.5, NOK:10.1, SEK:9.5, PLN:3.65, CNH:7.15, DKK:6.4, HUF:340, CZK:21, IDR:16400 };

const DEF_SET = {
  balance:1000, ccy:"USD", leverage:500,
  maxRisk:25, warnAt:80, perTrade:2, minRR:1.5, lotStep:0.01,
  dailyLoss:5, weeklyLoss:10, newsWin:30,
  block:true, lossLock:true, corrWarn:true, newsWarn:true, autoBal:true, sound:true, notif:false,
  costs:true, comm:0,
  theme:"dark", onboarded:false, pin:"", menu:"all", space:"trade", spaces:null,
  sb:{ url:"", key:"" }, watch:null, liveInMeter:true, pendInMeter:true, followMt5Bal:false,
  setups:["Breakout","Pullback","Reversal","Range","Trend follow","News"],
  emotions:["Tenang","Yakin","Ragu","FOMO","Balas dendam","Bosan"]
};

// Jenis instrumen tabungan bawaan (bisa diubah/ditambah di menu Tabungan → Jenis & alokasi)
// mode "unit": nilai = jumlah × pengali × harga; mode "nominal": nilai = nominal rupiah
const DEFAULT_SAVE_TYPES = [
  { id:"emas", name:"Emas", unit:"gram", mult:1, mode:"unit", dec:4, color:"#E0B04B", price:"Harga per gram", target:0 },
  { id:"saham", name:"Saham", unit:"lot", mult:100, mode:"unit", dec:0, color:"#5AA9E6", price:"Harga per lembar", target:0 },
  { id:"reksadana", name:"Reksa dana", unit:"unit", mult:1, mode:"unit", dec:4, color:"#2BC4A0", price:"NAB per unit", target:0 },
  { id:"sbn", name:"SBN (ORI, SBR, ST)", unit:"Rp nominal", mult:1, mode:"nominal", dec:0, color:"#B57BEA", price:"", target:0 },
  { id:"kripto", name:"Kripto (spot)", unit:"koin", mult:1, mode:"unit", dec:8, color:"#F2A33A", price:"Harga per koin", target:0, auto:"coingecko" },
  { id:"tunai", name:"Tunai / dana darurat", unit:"Rp", mult:1, mode:"nominal", dec:0, color:"#8A9AB5", price:"", target:0 }
];

// Kategori arus kas bawaan. type: "in" pemasukan, "out" pengeluaran, "move" pindah dana (tidak dihitung sebagai konsumsi)
const fc = (id, name, type, color, kw) => ({ id, name, type, color, kw });
const DEFAULT_FIN_CATS = [
  fc("in-salary", "Gaji", "in", "#2BC4A0", ["GAJI", "PAYROLL", "SALARY", "THR"]),
  fc("in-bonus", "Bonus, bunga & refund", "in", "#7FD1D9", ["BONUS", "BUNGA", "INTEREST", "CASHBACK", "REFUND", "JASA GIRO"]),
  fc("in-biz", "Usaha / sampingan", "in", "#9DB4FF", ["PENJUALAN", "INVOICE", "SELLER"]),
  fc("in-other", "Pemasukan lain", "in", "#5AA9E6", []),
  fc("out-food", "Makan & minum", "out", "#F2A33A", ["GOFOOD", "GRABFOOD", "SHOPEEFOOD", "RESTO", "RESTORAN", "CAFE", "KOPI", "MCD", "MCDONALDS", "KFC", "STARBUCKS", "BAKSO", "WARUNG", "PIZZA", "CHATIME", "JANJI JIWA", "KENANGAN", "SOLARIA", "HOKBEN"]),
  fc("out-transport", "Transportasi", "out", "#5AA9E6", ["GOJEK", "GOCAR", "GORIDE", "GRAB", "MAXIM", "PERTAMINA", "SPBU", "SHELL", "TOL", "ETOLL", "E TOLL", "KRL", "MRT", "TRANSJAKARTA", "PARKIR", "KAI", "TRAVELOKA", "TIKET"]),
  fc("out-shop", "Belanja", "out", "#E77FB3", ["INDOMARET", "ALFAMART", "ALFAMIDI", "SUPERINDO", "HYPERMART", "TRANSMART", "LOTTE", "TOKOPEDIA", "SHOPEE", "LAZADA", "BLIBLI", "TIKTOK", "ZALORA", "IKEA", "ACE"]),
  fc("out-bills", "Tagihan & utilitas", "out", "#B57BEA", ["PLN", "PDAM", "TELKOM", "INDIHOME", "BIZNET", "FIRST MEDIA", "MYREPUBLIC", "TELKOMSEL", "INDOSAT", "SMARTFREN", "PULSA", "PAKET DATA", "BPJS", "LISTRIK", "IURAN"]),
  fc("out-home", "Rumah & keluarga", "out", "#C8D96F", ["SEWA", "KOS", "KONTRAKAN", "IPL", "LAUNDRY", "ART"]),
  fc("out-debt", "Cicilan & kredit", "out", "#F0616D", ["CICILAN", "ANGSURAN", "KPR", "PINJAMAN", "LEASING", "KARTU KREDIT", "PAYLATER", "AKULAKU", "KREDIVO", "ADIRA", "FIF"]),
  fc("out-fun", "Hiburan & langganan", "out", "#9DB4FF", ["NETFLIX", "SPOTIFY", "YOUTUBE", "DISNEY", "VIDIO", "APPLE COM", "STEAM", "PLAYSTATION", "BIOSKOP", "XXI", "CGV"]),
  fc("out-health", "Kesehatan", "out", "#7FD1D9", ["APOTEK", "KLINIK", "RUMAH SAKIT", "DOKTER", "HALODOC", "ALODOKTER", "KIMIA FARMA", "GUARDIAN"]),
  fc("out-edu", "Pendidikan", "out", "#E0B04B", ["SEKOLAH", "KURSUS", "SPP", "UNIVERSITAS", "KAMPUS", "RUANGGURU", "UDEMY"]),
  fc("out-give", "Zakat & donasi", "out", "#2BC4A0", ["ZAKAT", "INFAQ", "INFAK", "SEDEKAH", "DONASI", "KITABISA", "BAZNAS", "WAKAF"]),
  fc("out-ewallet", "Top up e-wallet", "out", "#5AA9E6", ["GOPAY", "OVO", "DANA", "SHOPEEPAY", "LINKAJA", "TOPUP", "TOP UP"]),
  fc("out-cash", "Tarik tunai", "out", "#8A9AB5", ["TARIK TUNAI", "PENARIKAN TUNAI", "TARIKAN ATM"]),
  fc("out-fee", "Biaya bank & pajak", "out", "#8A9AB5", ["BIAYA ADM", "BIAYA ADMIN", "ADM BULANAN", "BIAYA TRANSFER", "PAJAK", "MATERAI", "BIAYA"]),
  fc("out-other", "Pengeluaran lain", "out", "#8A9AB5", []),
  fc("mv-invest", "Ke/dari investasi", "move", "#2BC4A0", ["BIBIT", "AJAIB", "STOCKBIT", "PEGADAIAN", "INDODAX", "PINTU", "TOKOCRYPTO", "RDN", "SEKURITAS", "BAREKSA", "TANAMDUIT", "PLUANG", "REKSA DANA", "MIRAE", "IPOT", "BIONS", "SBN", "DEPOSITO"]),
  fc("mv-trade", "Ke/dari trading", "move", "#E0B04B", ["EXNESS", "FBS", "OCTAFX", "OCTA", "MONEX", "MIFX", "HSB", "DIDIMAX", "VALBURY", "FINEX", "ICMARKETS", "XM GLOBAL"]),
  fc("mv-self", "Antar rekening sendiri", "move", "#8A9AB5", [])
];
const DEFAULT_FIN_RULES = { months: 3, emMonths: 6, emPct: 50, invPct: 70, tradePct: 15, maxTradeShare: 10, buffer: 1, emExtra: 0 };

// Kelompok aset yang bergerak mirip (dipakai untuk peringatan korelasi)
const GROUPS = {
  "Indeks AS":["US30","US500","NAS100","US2000"],
  "Indeks Eropa":["GER40","FRA40","EU50","UK100"],
  "Logam mulia":["XAUUSD","XAGUSD","XAUEUR","XPTUSD","XPDUSD"],
  "Minyak":["USOIL","UKOIL"],
  "Kripto":["BTCUSD","ETHUSD","SOLUSD","BNBUSD","XRPUSD","LTCUSD","ADAUSD","DOGEUSD"]
};
// Nama alternatif yang sering dipakai broker
const ALIASES = { GOLD:"XAUUSD", SILVER:"XAGUSD", DJ30:"US30", WS30:"US30", DJI:"US30", DOW:"US30", USA30:"US30",
  USTEC:"NAS100", US100:"NAS100", NDX:"NAS100", USA100:"NAS100", NQ100:"NAS100", SPX500:"US500", SP500:"US500", USA500:"US500", SPX:"US500",
  DE40:"GER40", GER30:"GER40", DAX40:"GER40", DE30:"GER40", XTIUSD:"USOIL", WTI:"USOIL", USOUSD:"USOIL", XBRUSD:"UKOIL", BRENT:"UKOIL",
  UKOUSD:"UKOIL", JPN225:"JP225", NIKKEI:"JP225", FTSE100:"UK100", F40:"FRA40", STOXX50:"EU50", EUSTX50:"EU50", HK33:"HK50", HSI:"HK50" };

const OT_LABEL = { buy_limit:"Buy Limit", sell_limit:"Sell Limit", buy_stop:"Buy Stop", sell_stop:"Sell Stop", buy_stop_limit:"Buy Stop Limit", sell_stop_limit:"Sell Stop Limit" };
/** Label jenis order untuk posisi manual (otype) atau live (orderType). */
const orderLabel = p => p.orderType ? OT_LABEL[p.orderType] || p.orderType
  : (p.otype && p.otype !== "market") ? (p.dir === "buy" ? "Buy " : "Sell ") + (p.otype === "limit" ? "Limit" : "Stop") : "";
const isPending = p => !!(p.pending || (p.otype && p.otype !== "market"));
const SEG_COLORS = ["#E0B04B","#5AA9E6","#B57BEA","#2BC4A0","#F07C8A","#F2A33A","#7FD1D9","#E77FB3","#9DB4FF","#C8D96F"];
const DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

/* ================================================================
 * 2. PENYIMPANAN
 * ================================================================ */
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };

function hash(str) { let h = 5381; for (const ch of String(str)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return "h" + (h >>> 0).toString(36); }

function blank() {
  return {
    settings: { ...DEF_SET, sb: { ...DEF_SET.sb }, setups: [...DEF_SET.setups], emotions: [...DEF_SET.emotions], pin: hash("1234") },
    rates: { ...DEFAULT_RATES },
    symbols: DEFAULT_SYMBOLS.map(x => ({ ...x })),
    positions: [], history: [], news: [],
    savings: { types: DEFAULT_SAVE_TYPES.map(t => ({ ...t })), assets: [], tx: [], goals: [], plans: [] },
    finance: { accounts: [], tx: [], cats: DEFAULT_FIN_CATS.map(c => ({ ...c, kw: [...c.kw] })), learn: {}, rules: { ...DEFAULT_FIN_RULES } },
    last: { sym: "XAUUSD" }, updatedAt: 0
  };
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== "object") return b;
  const ds = d.settings || {};
  const st = { ...b.settings, ...ds, sb: { ...b.settings.sb, ...(ds.sb || {}) } };
  if (!Array.isArray(st.setups)) st.setups = b.settings.setups;
  if (!Array.isArray(st.emotions)) st.emotions = b.settings.emotions;
  if (!st.pin) st.pin = hash("1234");
  let syms = b.symbols;
  if (Array.isArray(d.symbols) && d.symbols.length) {
    syms = d.symbols.map(x => {
      const def = DEFAULT_SYMBOLS.find(y => y.s === x.s);
      return { swL: 0, swS: 0, ...x, spr: x.spr != null ? x.spr : (def ? def.spr : 0) };
    });
  }
  return {
    ...d, // simpan kunci yang tidak dikenal agar versi lain tidak kehilangan data
    settings: st,
    rates: { ...b.rates, ...(d.rates || {}) },
    symbols: syms,
    positions: Array.isArray(d.positions) ? d.positions : [],
    history: Array.isArray(d.history) ? d.history.map(h => h.id ? h : { ...h, id: "h" + Math.random().toString(36).slice(2, 10) }) : [],
    news: Array.isArray(d.news) ? d.news : [],
    savings: (() => {
      const sv = d.savings || {}, arr = k => Array.isArray(sv[k]) ? sv[k] : [];
      const types = arr("types").length ? arr("types") : b.savings.types;
      types.forEach(t => { if (t.id === "kripto" && t.auto === undefined) t.auto = "coingecko"; });
      return { types, assets: arr("assets"), tx: arr("tx"), goals: arr("goals"), plans: arr("plans") };
    })(),
    finance: (() => {
      const f = d.finance || {}, arr = k => Array.isArray(f[k]) ? f[k] : [];
      const cats = arr("cats").length ? arr("cats") : b.finance.cats;
      ["in-other", "out-other"].forEach(id => { if (!cats.some(c => c.id === id)) cats.push(b.finance.cats.find(c => c.id === id)); });
      return { accounts: arr("accounts"), tx: arr("tx"), cats, learn: f.learn && typeof f.learn === "object" ? f.learn : {}, rules: { ...DEFAULT_FIN_RULES, ...(f.rules || {}) } };
    })(),
    last: d.last || b.last,
    updatedAt: +d.updatedAt || 0
  };
}
function load() {
  const v2 = lsGet(KEY), v1 = lsGet(OLD_KEY);
  let d = null;
  try { d = JSON.parse(v2 || v1); } catch (e) {}
  const s = normalize(d);
  if (!v2 && v1 && d) s.settings.onboarded = true; // pengguna versi 1
  return s;
}
let S = load();
/** Bandingkan versi "a.b.c". Hasil > 0 jika a lebih baru dari b. */
function cmpVer(a, b) { const x = String(a || "0").split(".").map(Number), y = String(b || "0").split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
// Jika data di browser ditulis oleh versi aplikasi yang lebih baru, versi ini tidak boleh menulis (agar data tidak rusak)
let readOnly = cmpVer(S.appVersion, VERSION) > 0;
function save(opts = {}) {
  if (readOnly) { showStaleBanner(); return; }
  S.updatedAt = Date.now();
  S.appVersion = VERSION;
  if (!lsSet(KEY, JSON.stringify(S))) toast("Gagal menyimpan", "Penyimpanan browser penuh atau diblokir.", "danger");
  resolveCache.clear();
  if (!opts.noSync) Cloud.schedule();
}
function showStaleBanner() {
  if (document.getElementById("staleBanner")) return;
  const b = document.createElement("div");
  b.id = "staleBanner"; b.className = "stale-banner";
  b.innerHTML = `<span>Versi RiskDesk yang lebih baru sudah dipakai di tab/perangkat ini. Muat ulang agar data tetap aman.</span><button class="btn sm primary" type="button">Muat ulang</button>`;
  b.querySelector("button").onclick = () => location.reload();
  document.body.appendChild(b);
}
const exportData = () => JSON.parse(JSON.stringify(S));

/* ================================================================
 * 3. UTILITAS
 * ================================================================ */
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = v => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[\s\u00a0]/g, "").replace(",", "."));
  return isFinite(n) ? n : NaN;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const fmt = (v, dec = 2) => isFinite(v) ? v.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
const fmtP = (v, d) => isFinite(v) ? (+v).toFixed(d) : "—"; // harga: format MT5 (titik desimal)
const ccyDec = c => (c === "IDR" || c === "JPY" || c === "HUF") ? 0 : 2;
const ccySym = c => ({ USD:"$", EUR:"€", GBP:"£", JPY:"¥", IDR:"Rp ", USC:"¢" }[c] || c + " ");
const money = (v, c = S.settings.ccy) => isFinite(v) ? (v < 0 ? "−" : "") + ccySym(c) + fmt(Math.abs(v), ccyDec(c)) : "—";
const moneyS = v => isFinite(v) ? (v > 0 ? "+" : "") + money(v) : "—";
const pct = (v, d = 2) => isFinite(v) ? fmt(v, d) + "%" : "—";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const roundLot = (v, step) => +(Math.floor(v / step + 1e-9) * step).toFixed(2);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const randHex = n => { const a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); };
const toTime = v => typeof v === "number" ? v : new Date(v).getTime();
function relTime(t) {
  const m = Math.round((t - Date.now()) / 60000), a = Math.abs(m);
  const s = a < 60 ? a + " mnt" : a < 1440 ? Math.round(a / 60) + " jam" : Math.round(a / 1440) + " hari";
  return a < 1 ? "sekarang" : m > 0 ? "dalam " + s : s + " lalu";
}
function toAcct(valQuote, q) {
  const rq = S.rates[q], ra = S.rates[S.settings.ccy];
  if (!rq || !ra) return NaN;
  return valQuote / rq * ra;
}

/* ================================================================
 * 4. SIMBOL & PERHITUNGAN INTI
 * ================================================================ */
const resolveCache = new Map();
function resolveSym(raw) {
  if (!raw) return null;
  if (resolveCache.has(raw)) return resolveCache.get(raw);
  let m = S.symbols.find(x => x.s === raw);
  if (!m) {
    const up = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    m = S.symbols.find(x => x.s === up);
    if (!m) for (const [a, t] of Object.entries(ALIASES)) {
      if (up === a || (up.startsWith(a) && up.length - a.length <= 4)) { m = S.symbols.find(x => x.s === t); if (m) break; }
    }
    if (!m) m = S.symbols.filter(x => up.startsWith(x.s)).sort((a, b) => b.s.length - a.s.length)[0];
    if (!m) m = S.symbols.filter(x => up.endsWith(x.s)).sort((a, b) => b.s.length - a.s.length)[0];
  }
  resolveCache.set(raw, m || null);
  return m || null;
}
const symDigits = raw => (resolveSym(raw) || { d: 5 }).d;

function pnlAt(sym, dir, lot, entry, exit) {
  return toAcct((exit - entry) * (dir === "buy" ? 1 : -1) * sym.cs * lot, sym.q);
}

/** Hitung semua angka untuk satu rencana/posisi. Rugi bernilai negatif. */
function calc(p) {
  const sym = resolveSym(p.sym);
  if (!sym || !(p.lot > 0) || !(p.entry > 0)) return null;
  const st = S.settings, sign = p.dir === "buy" ? 1 : -1, unit = sym.cs * p.lot;
  const r = { sym };
  r.pipVal = toAcct(sym.pip * unit, sym.q);
  r.margin = toAcct(unit * p.entry / st.leverage, sym.q);
  r.spread = st.costs ? (sym.spr || 0) * r.pipVal : 0;
  r.comm = st.costs ? (st.comm || 0) * p.lot : 0;
  r.swap = st.costs ? (p.dir === "buy" ? sym.swL : sym.swS) * p.lot * (p.nights || 0) : 0;
  r.cost = r.spread + r.comm - (r.swap || 0);
  if (isFinite(p.sl)) {
    r.slDist = Math.abs(p.entry - p.sl);
    r.slPips = r.slDist / sym.pip;
    r.slOk = (p.sl - p.entry) * sign < 0;
    r.grossLoss = toAcct((p.sl - p.entry) * sign * unit, sym.q);
    r.loss = r.grossLoss - r.cost;
  }
  if (isFinite(p.tp)) {
    r.tpDist = Math.abs(p.tp - p.entry);
    r.tpPips = r.tpDist / sym.pip;
    r.tpOk = (p.tp - p.entry) * sign > 0;
    r.grossWin = toAcct((p.tp - p.entry) * sign * unit, sym.q);
    r.win = r.grossWin - r.cost;
  }
  if (r.slOk && r.tpOk) { r.rr = r.tpDist / r.slDist; r.netRR = r.win / Math.abs(r.loss); }
  r.risk = r.slOk ? Math.max(0, -r.loss) : NaN;
  return r;
}

/* ---------- Posisi live MT5 ---------- */
const Live = {
  account: null, positions: [], updated: 0, timer: null,
  loaded: false,
  get stale() { return !this.updated || Date.now() - this.updated > 120000; },
  /** Bandingkan data lama dan baru, lalu beri notifikasi perubahan pending order / posisi. */
  diff(prev, next) {
    const key = x => String(x.ticket);
    const pend = a => new Map(a.filter(x => x.kind === "pending").map(x => [key(x), x]));
    const open = a => new Map(a.filter(x => x.kind !== "pending").map(x => [key(x), x]));
    const pP = pend(prev), nP = pend(next), pO = open(prev), nO = open(next);
    const lbl = x => `${x.symbol} ${OT_LABEL[x.order_type] || String(x.type).toUpperCase()} ${x.volume} lot`;
    const rk = x => x.loss_at_sl != null ? " · risiko " + money(Math.max(0, -x.loss_at_sl)) : " · tanpa SL";
    nP.forEach((x, k) => { if (!pP.has(k)) notify("Pending order baru", lbl(x) + " @ " + x.price_open + rk(x), x.loss_at_sl == null ? "warn" : ""); });
    pP.forEach((x, k) => {
      if (nP.has(k)) return;
      if (nO.has(k)) notify("Pending order terisi", lbl(x) + " sekarang menjadi posisi terbuka" + rk(x), "warn");
      else toast("Pending order hilang", lbl(x) + " dibatalkan atau kedaluwarsa.", "");
    });
    nO.forEach((x, k) => { if (!pO.has(k) && !pP.has(k)) toast("Posisi baru di MT5", `${x.symbol} ${String(x.type).toUpperCase()} ${x.volume} lot${rk(x)}`, x.loss_at_sl == null ? "warn" : "ok"); });
  },
  get connected() { return !!(Cloud.sess && this.updated); },
  items() {
    return this.positions.map(x => ({
      mt5: true, id: "mt5-" + x.ticket, ticket: x.ticket, sym: x.symbol,
      pending: x.kind === "pending", orderType: x.order_type || "", trigger: +x.price_trigger || NaN, expiration: +x.expiration || 0,
      dir: String(x.type).toLowerCase().includes("sell") ? "sell" : "buy",
      lot: +x.volume, entry: +x.price_open, sl: +x.sl > 0 ? +x.sl : NaN, tp: +x.tp > 0 ? +x.tp : NaN,
      cur: +x.price_current, profit: +x.profit, swap: +x.swap,
      lossAtSl: x.loss_at_sl != null ? +x.loss_at_sl : NaN, winAtTp: x.profit_at_tp != null ? +x.profit_at_tp : NaN
    }));
  },
  start() { this.stop(); if (!Cloud.sess || !Cloud.cfg()) return; this.poll(); this.timer = setInterval(() => this.poll(), 15000); },
  stop() { clearInterval(this.timer); this.timer = null; },
  reset() { this.stop(); this.account = null; this.positions = []; this.updated = 0; this.loaded = false; onDataChange(); },
  async poll() {
    if (!Cloud.sess) return;
    try {
      const rows = await Cloud.req(`/rest/v1/riskdesk_mt5?select=account,positions,updated_at&user_id=eq.${Cloud.sess.user.id}`);
      const r = rows && rows[0];
      if (!r) return;
      this.account = r.account || null;
      const prev = this.positions, next = Array.isArray(r.positions) ? r.positions : [];
      if (this.loaded) this.diff(prev, next);
      this.positions = next; this.loaded = !!r.account;
      this.updated = r.account ? new Date(r.updated_at).getTime() : 0;
      const bal = this.account ? +this.account.balance : NaN;
      if (S.settings.followMt5Bal && bal > 0 && Math.abs(bal - S.settings.balance) > 0.005) { S.settings.balance = bal; save(); }
      onDataChange();
    } catch (e) { console.warn("Live MT5:", e.message); }
  }
};

/** Risiko satu posisi (manual atau live). */
function riskInfo(p) {
  if (p.mt5) {
    if (!isFinite(p.sl)) return { risk: NaN, noSl: true };
    if (isFinite(p.lossAtSl)) return { risk: Math.max(0, -p.lossAtSl), locked: p.lossAtSl >= 0, win: p.winAtTp };
    const r = calc({ ...p, nights: 0 });
    if (!r) return { risk: NaN, unknown: true };
    return { risk: r.slOk ? Math.max(0, -r.grossLoss) : 0, locked: !r.slOk, win: r.grossWin };
  }
  const r = calc(p);
  return { risk: r ? r.risk : NaN, win: r ? r.win : NaN, rr: r ? r.rr : NaN };
}
function riskItems() {
  const usePend = S.settings.pendInMeter !== false;
  const items = S.positions.filter(p => usePend || !isPending(p))
    .map((p, i) => ({ p, pending: isPending(p), color: SEG_COLORS[i % SEG_COLORS.length], ...riskInfo(p) }));
  if (S.settings.liveInMeter && Live.connected) {
    Live.items().filter(p => usePend || !p.pending)
      .forEach((p, i) => items.push({ p, live: true, pending: p.pending, color: SEG_COLORS[(S.positions.length + i) % SEG_COLORS.length], ...riskInfo(p) }));
  }
  return items;
}
const totalRisk = () => riskItems().reduce((a, it) => a + (isFinite(it.risk) ? it.risk : 0), 0);

/* ---------- Batas rugi harian / mingguan ---------- */
function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
const realizedSince = t => S.history.reduce((a, h) => a + (toTime(h.closed) >= t ? (+h.pnl || 0) : 0), 0);
function lossLimits() {
  const st = S.settings, bal = st.balance;
  const dNet = realizedSince(startOfDay()), wNet = realizedSince(startOfWeek());
  const dBase = st.autoBal ? bal - dNet : bal, wBase = st.autoBal ? bal - wNet : bal;
  const dLim = dBase * st.dailyLoss / 100, wLim = wBase * st.weeklyLoss / 100;
  const dUsed = Math.max(0, -dNet), wUsed = Math.max(0, -wNet);
  const dHit = dLim > 0 && dUsed >= dLim, wHit = wLim > 0 && wUsed >= wLim;
  return { dNet, wNet, dLim, wLim, dUsed, wUsed, dLeft: dLim - dUsed, wLeft: wLim - wUsed, dHit, wHit, locked: st.lossLock && (dHit || wHit) };
}

/* ---------- Korelasi / paparan ---------- */
function legs(sym, dir) {
  const sg = dir === "buy" ? 1 : -1, out = [];
  if (/^(Forex|Logam)/.test(sym.c) && sym.s.length === 6) { out.push({ k: sym.s.slice(0, 3), sg }); out.push({ k: sym.s.slice(3), sg: -sg }); }
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(sym.s)) out.push({ k: g, sg });
  if (!out.length) out.push({ k: sym.s, sg });
  return out;
}
function exposureMap(list) {
  const map = {};
  list.forEach(it => {
    const sym = resolveSym(it.p.sym); if (!sym) return;
    legs(sym, it.p.dir).forEach(l => {
      const e = map[l.k] = map[l.k] || { k: l.k, long: 0, short: 0, risk: 0 };
      l.sg > 0 ? e.long++ : e.short++;
      e.risk += isFinite(it.risk) ? it.risk : 0;
    });
  });
  return map;
}

/* ---------- Berita ---------- */
function newsCcys(sym) {
  if (/^(Forex|Logam)/.test(sym.c) && sym.s.length === 6) return [sym.s.slice(0, 3), sym.s.slice(3)];
  return [sym.q];
}
function newsHits(sym) {
  const cc = newsCcys(sym), now = Date.now(), win = S.settings.newsWin * 60000;
  const rel = S.news.filter(n => cc.includes(n.ccy) && n.imp !== "low");
  return {
    now: rel.filter(n => Math.abs(n.t - now) <= win).sort((a, b) => a.t - b.t),
    soon: rel.filter(n => n.t - now > win && n.t - now <= 4 * 3600000).sort((a, b) => a.t - b.t)
  };
}

/* ================================================================
 * 5. KERANGKA UI: navigasi, tema, toast, dialog
 * ================================================================ */
const TITLES = { market:"Pasar", dash:"Dashboard", pos:"Posisi", journal:"Jurnal", stats:"Analitik", tools:"Alat bantu", news:"Kalender berita", save:"Investasi", fin:"Keuangan", settings:"Pengaturan" };
let curView = "dash";
function go(v) {
  if (!TITLES[v]) v = firstView();
  const g = NAV_GROUP[v];
  if (g !== "all" && !enabledSpaces().includes(g)) v = firstView();
  curView = v;
  if (v !== "settings") setSpace(NAV_GROUP[v], true);
  $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === v && (!b.dataset.sub || b.dataset.sub === (v === "fin" ? fnTab : svTab))));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("viewTitle").textContent = TITLES[v];
  if (v === "pos") renderPositions();
  if (v === "journal") renderHistory();
  if (v === "stats") renderStats();
  if (v === "tools") { renderPartial(); if (!$("smBal").value) $("smBal").value = S.settings.balance; }
  if (v === "news") renderNews();
  if (v === "settings") showSettings();
  if (v === "save") renderSavings();
  if (v === "fin") renderFinance();
  if (v === "market") renderMarket();
  renderHelp();
  try { history.replaceState(null, "", "#" + v); } catch (e) {}
  window.scrollTo(0, 0);
}
$$(".nav-btn").forEach(b => b.addEventListener("click", () => { if (b.dataset.sub) { if (b.dataset.view === "fin") fnTab = b.dataset.sub; else svTab = b.dataset.sub; } go(b.dataset.view); }));
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); });

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
function applyTheme() {
  const t = S.settings.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  $("themeBtn").innerHTML = t === "dark" ? SUN : MOON;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "dark" ? "#0E1726" : "#F2F4F8";
}
$("themeBtn").onclick = () => { S.settings.theme = S.settings.theme === "light" ? "dark" : "light"; save(); applyTheme(); renderStats(); if (curView === "market") renderMarket(); if (curView === "save") renderSavings(); };

function toast(title, body, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "danger" ? 7000 : 4200);
}
let actx;
function beep(danger) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    (danger ? [880, 660, 880] : [660]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.18;
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.17);
    });
  } catch (e) {}
}
function notify(title, body, kind) {
  toast(title, body, kind); beep(kind === "danger");
  if (S.settings.notif && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("RiskDesk: " + title, { body, icon: "icon-192.png" }); } catch (e) {}
  }
}

/** Dialog serbaguna. Mengembalikan objek nilai input [name], atau null bila batal. */
function ask({ title, body, ok = "Simpan", danger = false }) {
  return new Promise(res => {
    const m = $("askModal");
    $("askTitle").textContent = title;
    $("askBody").innerHTML = body;
    $("askOk").textContent = ok;
    $("askOk").className = "btn " + (danger ? "danger-solid" : "primary");
    m.classList.add("open");
    const first = m.querySelector("#askBody input, #askBody select, #askBody textarea");
    setTimeout(() => (first || $("askOk")).focus(), 60);
    const done = v => { m.classList.remove("open"); $("askOk").onclick = $("askCancel").onclick = m.onkeydown = m.onclick = null; res(v); };
    $("askOk").onclick = () => { const vals = {}; $$("[name]", $("askBody")).forEach(i => vals[i.name] = i.type === "checkbox" ? i.checked : i.value); done(vals); };
    $("askCancel").onclick = () => done(null);
    m.onclick = e => { if (e.target === m) done(null); };
    m.onkeydown = e => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") { e.preventDefault(); $("askOk").click(); }
    };
  });
}
const confirmBox = (title, text, ok = "Lanjutkan", danger = true) => ask({ title, body: `<p class="c-muted" style="margin:0">${esc(text)}</p>`, ok, danger }).then(v => !!v);

/* ---------- Jam & sesi pasar ---------- */
const SESS = [["Sydney", 21, 6], ["Tokyo", 0, 9], ["London", 7, 16], ["New York", 12, 21]];
function tick() {
  const now = new Date(), h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const wd = now.getUTCDay(), weekend = wd === 6 || (wd === 0 && h < 21) || (wd === 5 && h >= 21);
  $("sessions").innerHTML = weekend ? `<span class="sess"><i></i>Pasar forex tutup</span>` : SESS.map(([n, a, b]) => {
    const on = a < b ? (h >= a && h < b) : (h >= a || h < b);
    return `<span class="sess ${on ? "on" : ""}"><i></i>${n}</span>`;
  }).join("");
  let tz = "";
  try { tz = new Intl.DateTimeFormat("id-ID", { timeZoneName: "short" }).formatToParts(now).find(p => p.type === "timeZoneName").value; } catch (e) {}
  $("clock").textContent = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + (tz ? " " + tz : "");
}

/* ================================================================
 * 6. KALKULATOR
 * ================================================================ */
let dir = "buy", curEmo = "", otype = "market";
let curSym = resolveSym(S.last.sym) ? resolveSym(S.last.sym).s : "XAUUSD";

function readForm() {
  return { sym: curSym, dir, otype, lot: num($("lot").value), entry: num($("entry").value), sl: num($("sl").value), tp: num($("tp").value),
    nights: Math.max(0, num($("nights").value) || 0), setup: $("setup").value, emo: curEmo, note: $("note").value.trim() };
}

/* ---------- Pemilih simbol ---------- */
const symInput = $("symInput"), symList = $("symList");
let comboIdx = -1;
function renderCombo(q = "") {
  q = q.toUpperCase().trim();
  const groups = {};
  S.symbols.filter(x => !q || x.s.includes(q) || x.c.toUpperCase().includes(q)).forEach(x => (groups[x.c] = groups[x.c] || []).push(x));
  let html = "";
  for (const g in groups) {
    html += `<div class="combo-group">${esc(g)}</div>`;
    groups[g].forEach(x => { html += `<div class="combo-item" role="option" data-s="${esc(x.s)}">${esc(x.s)}<span>${esc(x.q)}</span></div>`; });
  }
  symList.innerHTML = html || `<div class="empty">Simbol tidak ditemukan. Tambahkan di Pengaturan → Simbol.</div>`;
  comboIdx = -1;
}
function openCombo(open) { symList.classList.toggle("open", open); symInput.setAttribute("aria-expanded", open); }
function pickSym(s, persist = true) {
  const sym = resolveSym(s) || S.symbols[0];
  const changed = S.last.sym !== sym.s;
  curSym = sym.s; S.last.sym = sym.s;
  if (persist && changed) save({ noSync: true });
  symInput.value = sym.s; openCombo(false);
  ["entry", "sl", "tp", "pcTp1"].forEach(id => $(id).step = Math.pow(10, -sym.d));
  $("symInfo").textContent = `Contract ${fmt(sym.cs, 0)} · 1 pip = ${sym.pip} · kutipan ${sym.q} · spread ±${fmt(sym.spr, 1)} pip`;
  update();
}
symInput.addEventListener("focus", () => { renderCombo(""); symInput.select(); openCombo(true); });
symInput.addEventListener("input", () => { renderCombo(symInput.value); openCombo(true); });
symInput.addEventListener("keydown", e => {
  const its = $$(".combo-item", symList);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    comboIdx = clamp(comboIdx + (e.key === "ArrowDown" ? 1 : -1), 0, its.length - 1);
    its.forEach((el, i) => el.classList.toggle("act", i === comboIdx));
    its[comboIdx] && its[comboIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault(); const el = its[comboIdx] || its[0]; if (el) { pickSym(el.dataset.s); $("entry").focus(); }
  } else if (e.key === "Escape") { openCombo(false); symInput.value = curSym; }
});
symList.addEventListener("mousedown", e => { const el = e.target.closest(".combo-item"); if (el) { e.preventDefault(); pickSym(el.dataset.s); } });
symInput.addEventListener("blur", () => setTimeout(() => { openCombo(false); symInput.value = curSym; }, 120));

/* ---------- Input lain ---------- */
function setDir(d) { dir = d; $("dirBuy").classList.toggle("on", d === "buy"); $("dirSell").classList.toggle("on", d === "sell"); syncPipFields(); const b = $$("[data-ot]").find(x => x.dataset.ot === otype); if (b && otype !== "market") b.click(); else update(); }
$("dirBuy").onclick = () => setDir("buy");
$$("[data-ot]").forEach(b => b.onclick = () => {
  otype = b.dataset.ot;
  $$("[data-ot]").forEach(x => x.classList.toggle("on", x === b));
  $("otHint").textContent = { market: "Langsung dieksekusi di harga pasar.", limit: dir === "buy" ? "Buy Limit: entry di bawah harga sekarang." : "Sell Limit: entry di atas harga sekarang.", stop: dir === "buy" ? "Buy Stop: entry di atas harga sekarang." : "Sell Stop: entry di bawah harga sekarang." }[otype];
  update();
});
$("dirSell").onclick = () => setDir("sell");
$$("[data-lot]").forEach(b => b.onclick = () => {
  const st = S.settings.lotStep || 0.01;
  $("lot").value = +Math.max(st, (num($("lot").value) || 0) + st * +b.dataset.lot).toFixed(2);
  update();
});
["lot", "tp", "nights", "note", "riskVal"].forEach(id => $(id).addEventListener("input", update));
$("entry").addEventListener("input", () => { syncPipFields(); update(); });
$("sl").addEventListener("input", update);
$("riskMode").addEventListener("change", update);
$("setup").addEventListener("change", update);
function pipsToPrice(which) {
  const sym = resolveSym(curSym), e = num($("entry").value), p = num($(which + "Pips").value);
  if (!isFinite(e) || !isFinite(p)) return;
  const sign = (dir === "buy") === (which === "tp") ? 1 : -1;
  $(which).value = (e + sign * p * sym.pip).toFixed(sym.d);
  update();
}
// Saat entry/arah berubah dan kolom pip terisi, harga SL/TP ikut dihitung ulang
function syncPipFields() { if ($("slPips").value) pipsToPrice("sl"); if ($("tpPips").value) pipsToPrice("tp"); }
$("slPips").addEventListener("input", () => pipsToPrice("sl"));
$("tpPips").addEventListener("input", () => pipsToPrice("tp"));
$("sl").addEventListener("input", () => { $("slPips").value = ""; });
$("tp").addEventListener("input", () => { $("tpPips").value = ""; });

function renderTagInputs() {
  $("setup").innerHTML = `<option value="">— Pilih setup —</option>` + S.settings.setups.map(s => `<option>${esc(s)}</option>`).join("");
  $("emoChips").innerHTML = S.settings.emotions.map(e => `<button type="button" data-emo="${esc(e)}" class="${e === curEmo ? "on" : ""}">${esc(e)}</button>`).join("");
}
$("emoChips").addEventListener("click", e => {
  const b = e.target.closest("[data-emo]"); if (!b) return;
  curEmo = curEmo === b.dataset.emo ? "" : b.dataset.emo;
  $$("[data-emo]").forEach(x => x.classList.toggle("on", x.dataset.emo === curEmo));
});

/* ---------- Tiket hasil ---------- */
let lastSizerLot = NaN;
function update() {
  const p = readForm(), st = S.settings, sym = resolveSym(curSym), bal = st.balance;
  $("tSym").textContent = curSym;
  $("tDir").textContent = `${otype === "market" ? dir.toUpperCase() : orderLabel(p).toUpperCase()} ${isFinite(p.lot) ? p.lot : ""}`;
  $("tDir").className = "badge " + dir;

  const r = calc(p);
  const errs = [];
  $("sl").classList.toggle("bad", !!(r && isFinite(p.sl) && !r.slOk));
  $("tp").classList.toggle("bad", !!(r && isFinite(p.tp) && !r.tpOk));
  if (r && isFinite(p.sl) && !r.slOk) errs.push(dir === "buy" ? "SL untuk Buy harus di bawah harga entry." : "SL untuk Sell harus di atas harga entry.");
  if (r && isFinite(p.tp) && !r.tpOk) errs.push(dir === "buy" ? "TP untuk Buy harus di atas harga entry." : "TP untuk Sell harus di bawah harga entry.");
  $("calcErr").textContent = errs.join(" ");

  const okSl = r && r.slOk, okTp = r && r.tpOk;
  $("tLoss").textContent = okSl ? money(r.loss) : "—";
  $("tLossPct").textContent = okSl ? `${pct(Math.abs(r.loss) / bal * 100)} modal${r.cost ? " · kotor " + money(r.grossLoss) : ""}` : "Isi entry & SL";
  $("tWin").textContent = okTp ? money(r.win) : "—";
  $("tWinPct").textContent = okTp ? `${pct(r.win / bal * 100)} modal${r.cost ? " · kotor " + money(r.grossWin) : ""}` : "Isi entry & TP";
  $("tDist").textContent = r ? `${okSl ? fmt(r.slPips, 1) : "—"} / ${okTp ? fmt(r.tpPips, 1) : "—"} pip` : "—";
  $("tPipVal").textContent = r ? money(r.pipVal) : "—";
  $("tCost").textContent = r ? (st.costs ? money(r.cost) : "Tidak dihitung") : "—";
  $("tMargin").textContent = r ? `${money(r.margin)} · ${pct(r.margin / bal * 100, 1)}` : "—";

  const rr = okSl && okTp ? r.netRR : NaN;
  $("rrTxt").textContent = isFinite(rr) ? `R:R 1 : ${fmt(rr, 2)}` : "R:R —";
  const rp = isFinite(rr) ? 100 / (1 + rr) : 50;
  $("rrRisk").style.width = rp + "%"; $("rrRew").style.width = (100 - rp) + "%";
  $("tBE").textContent = isFinite(rr) ? pct(100 / (1 + rr), 1) : "—";

  const used = totalRisk(), lim = lossLimits();
  const newRisk = okSl ? r.risk : 0;
  const after = (used + newRisk) / bal * 100;
  $("tAfter").textContent = okSl ? pct(after) : "—";
  $("tDayLeft").textContent = st.dailyLoss > 0 ? money(Math.max(0, lim.dLeft)) : "—";

  /* Checklist */
  const checks = [];
  if (lim.locked) checks.push(["bad", `Batas rugi ${lim.dHit ? "harian" : "mingguan"} sudah tercapai. Entry dikunci sampai ${lim.dHit ? "besok" : "minggu depan"}.`]);
  if (r && !isFinite(p.sl)) checks.push(["bad", "Belum ada stop loss. Risiko tidak terbatas."]);
  if (okSl) {
    const tr = r.risk / bal * 100;
    checks.push([tr <= st.perTrade ? "" : "bad", `Risiko trade ini ${pct(tr)} (maks ${st.perTrade}%)`]);
    checks.push([after < st.maxRisk * st.warnAt / 100 ? "" : after <= st.maxRisk ? "mid" : "bad", `Total risiko menjadi ${pct(after)} dari batas ${st.maxRisk}%`]);
    if (st.dailyLoss > 0 && !lim.locked && r.risk > lim.dLeft) checks.push(["mid", `Jika SL kena, batas rugi harian ${st.dailyLoss}% terlewati`]);
  }
  if (isFinite(rr)) checks.push([rr >= st.minRR ? "" : "mid", `R:R bersih 1:${fmt(rr, 2)} (minimum 1:${fmt(st.minRR, 1)})`]);
  if (r && isFinite(r.margin) && r.margin > bal * 0.5) checks.push(["mid", `Margin memakan ${pct(r.margin / bal * 100, 0)} modal`]);
  if (st.corrWarn && sym && r) {
    const ex = exposureMap(riskItems());
    const same = legs(sym, dir).filter(l => ex[l.k] && (l.sg > 0 ? ex[l.k].long : ex[l.k].short) > 0);
    if (same.length) {
      const n = Math.max(...same.map(l => l.sg > 0 ? ex[l.k].long : ex[l.k].short));
      checks.push(["mid", `Searah dengan ${n} posisi lain (${same.map(l => (l.sg > 0 ? "long " : "short ") + l.k).join(", ")}). Risiko efektif bertumpuk.`]);
    }
  }
  if (st.newsWarn && sym) {
    const nh = newsHits(sym);
    nh.now.forEach(n => checks.push(["bad", `Berita ${n.ccy} "${n.title}" ${relTime(n.t)}. Hindari entry ±${st.newsWin} menit.`]));
    if (!nh.now.length && nh.soon[0]) checks.push(["info", `Berita ${nh.soon[0].ccy} "${nh.soon[0].title}" ${relTime(nh.soon[0].t)}`]);
  }
  $("checks").innerHTML = checks.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("");

  const overCap = st.block && okSl && after > st.maxRisk;
  const valid = okSl && (!isFinite(p.tp) || okTp);
  $("addPos").disabled = !valid || overCap || lim.locked;
  $("addPos").textContent = lim.locked ? "Entry dikunci: batas rugi tercapai" : overCap ? `Ditolak: melewati batas ${st.maxRisk}%` : otype === "market" ? "Tambahkan ke posisi" : "Tambahkan pending order";

  /* Penghitung lot */
  const rv = num($("riskVal").value);
  const riskAmt = $("riskMode").value === "pct" ? bal * rv / 100 : rv;
  lastSizerLot = NaN;
  if (okSl && riskAmt > 0) {
    const perLot = calc({ ...p, lot: 1 });
    const lossPerLot = Math.abs(perLot.loss);
    const step = st.lotStep || 0.01;
    lastSizerLot = roundLot(riskAmt / lossPerLot, step);
    if (lastSizerLot >= step) {
      $("sizerLot").textContent = fmt(lastSizerLot, 2);
      $("sizerAmt").textContent = `≈ risiko ${money(lastSizerLot * lossPerLot)}`;
    } else { $("sizerLot").textContent = "< " + step; $("sizerAmt").textContent = "SL terlalu lebar untuk risiko ini"; }
  } else { $("sizerLot").textContent = "—"; $("sizerAmt").textContent = "Isi entry & SL dulu"; }
  $("useLot").disabled = !(lastSizerLot >= (st.lotStep || 0.01));

  renderBudget(okSl ? r.risk : 0);
  if (curView === "tools") renderPartial();
}
$("useLot").onclick = () => { if (lastSizerLot > 0) { $("lot").value = lastSizerLot; update(); } };

/* ================================================================
 * 7. METER RISIKO & PERINGATAN
 * ================================================================ */
let lastLevel = null;
function riskLevel(usedPct, lim) {
  const st = S.settings;
  if (lim.locked) return "locked";
  if (usedPct >= st.maxRisk) return "danger";
  if (usedPct >= st.maxRisk * st.warnAt / 100) return "warn";
  return "ok";
}
function renderBudget(preview = 0) {
  const st = S.settings, bal = st.balance, items = riskItems();
  const used = items.reduce((a, it) => a + (isFinite(it.risk) ? it.risk : 0), 0), usedPct = used / bal * 100;
  const scaleMax = Math.max(st.maxRisk * 1.4, usedPct + preview / bal * 100 + 2);
  const lim = lossLimits(), level = riskLevel(usedPct, lim);
  $("riskPct").innerHTML = `${pct(usedPct)}<small>dari batas ${st.maxRisk}%</small>`;
  $("riskPct").style.color = level === "danger" || level === "locked" ? "var(--sell)" : level === "warn" ? "var(--warn)" : "var(--text)";
  $("bBalance").textContent = money(bal);
  $("bUsed").textContent = money(used);
  $("bLeft").textContent = money(Math.max(0, bal * st.maxRisk / 100 - used));
  const nPend = items.filter(it => it.pending).length;
  $("bCount").textContent = nPend ? `${items.length - nPend} + ${nPend} pending` : items.length;

  let segs = items.map(it => {
    const w = isFinite(it.risk) ? it.risk / bal * 100 / scaleMax * 100 : 0;
    const kind = it.pending ? orderLabel(it.p) : it.p.dir.toUpperCase();
    const lbl = `${it.p.sym} ${kind} ${it.p.lot} lot${it.live ? " (MT5)" : ""}${it.pending ? " · pending" : ""}: ${isFinite(it.risk) ? money(it.risk) : "tanpa SL"}`;
    return `<div class="seg${it.live ? " live" : ""}${it.pending ? " pending" : ""}" title="${esc(lbl)}" style="width:${w}%;background-color:${it.color}"></div>`;
  }).join("");
  if (preview > 0) segs += `<div class="seg preview" title="Rencana entry saat ini" style="width:${preview / bal * 100 / scaleMax * 100}%"></div>`;
  $("meterFill").innerHTML = segs;
  $("wall").style.left = (st.maxRisk / scaleMax * 100) + "%";
  $("wall").dataset.label = `Batas ${st.maxRisk}%`;
  $("warnLine").style.left = (st.maxRisk * st.warnAt / 100 / scaleMax * 100) + "%";
  $("meterScale").innerHTML = [0, .25, .5, .75, 1].map(f => `<span>${fmt(scaleMax * f, 1)}%</span>`).join("");

  const setBar = (bar, txt, usedAmt, limAmt, limPct) => {
    const f = limAmt > 0 ? usedAmt / limAmt : 0;
    $(bar).style.width = clamp(f * 100, 0, 100) + "%";
    $(bar).style.background = f >= 1 ? "var(--sell)" : f >= .7 ? "var(--warn)" : "var(--buy)";
    $(txt).textContent = limPct > 0 ? `${money(usedAmt)} / ${money(limAmt)}` : "Tidak dibatasi";
  };
  setBar("dayBar", "dayTxt", lim.dUsed, lim.dLim, st.dailyLoss);
  setBar("weekBar", "weekTxt", lim.wUsed, lim.wLim, st.weeklyLoss);

  const noSl = items.filter(it => it.noSl).length;
  const pend = items.filter(it => it.pending), pendRisk = pend.reduce((a, it) => a + (isFinite(it.risk) ? it.risk : 0), 0);
  let text;
  if (level === "locked") text = `Batas rugi ${lim.dHit ? "harian" : "mingguan"} tercapai (${money(lim.dHit ? lim.dUsed : lim.wUsed)}). Entry baru dikunci. Istirahat dulu, evaluasi jurnal. Jika itu hanya uji coba, hapus trade-nya di menu Jurnal.`;
  else if (level === "danger") text = `Total SL sudah ${pct(usedPct)} dari modal, melewati batas ${st.maxRisk}%. Kurangi lot atau tutup sebagian posisi.`;
  else if (level === "warn") text = `Mendekati batas: total SL ${pct(usedPct)}. Sisa ruang risiko ${money(bal * st.maxRisk / 100 - used)}.`;
  else if (!items.length) text = "Belum ada posisi. Isi rencana entry di bawah untuk mulai mengukur risiko.";
  else text = `Aman. Total SL ${pct(usedPct)} dari modal, di bawah batas ${st.maxRisk}%.`;
  if (pend.length && level !== "locked") text += ` Termasuk ${pend.length} pending order (${money(pendRisk)}) yang belum terisi.`;
  if (noSl) text += ` ${noSl} posisi/order MT5 tanpa SL tidak bisa diukur.`;
  $("budgetMsg").className = "budget-msg " + (noSl && level === "ok" ? "warn" : level);
  $("budgetMsg").textContent = text;

  if (lastLevel !== null && level !== lastLevel && level !== "ok") {
    const titles = { warn: "Mendekati batas risiko", danger: `Batas risiko ${st.maxRisk}% tersentuh`, locked: "Batas rugi tercapai" };
    notify(titles[level], level === "locked" ? "Entry baru dikunci untuk melindungi modal." : `Total SL semua posisi = ${pct(usedPct)} dari modal.`, level === "warn" ? "warn" : "danger");
  }
  lastLevel = level;
  $("navPosN").textContent = items.length || "";
}

/* ---------- Paparan & berita di dashboard ---------- */
function renderExposure() {
  const ex = Object.values(exposureMap(riskItems())).filter(e => e.long + e.short > 0)
    .sort((a, b) => Math.max(b.long, b.short) - Math.max(a.long, a.short) || b.risk - a.risk);
  if (!ex.length) { $("exposure").innerHTML = `<p class="empty">Belum ada posisi. Paparan muncul setelah Anda menambah posisi.</p>`; return; }
  $("exposure").innerHTML = ex.slice(0, 8).map(e => {
    const net = e.long - e.short, hot = e.long >= 2 || e.short >= 2;
    const pill = net > 0 ? `<span class="pill buy">Long ${e.long}</span>` : net < 0 ? `<span class="pill sell">Short ${e.short}</span>` : `<span class="pill neu">Netral</span>`;
    return `<div class="expo-row${hot ? " hot" : ""}"><b>${esc(e.k)}</b>${pill}<span class="num c-muted">${money(e.risk)}</span></div>`;
  }).join("") + (ex.some(e => e.long >= 2 || e.short >= 2) ? `<p class="hint" style="margin-top:10px">Baris berwarna kuning berarti ada 2 posisi atau lebih yang searah.</p>` : "");
}
function renderNewsSoon() {
  const now = Date.now();
  const list = S.news.filter(n => n.imp !== "low" && n.t > now - S.settings.newsWin * 60000 && n.t < now + 7 * 864e5).sort((a, b) => a.t - b.t).slice(0, 5);
  const hot = S.news.filter(n => n.imp === "high" && Math.abs(n.t - now) < 24 * 3600000 && n.t > now).length;
  $("navNewsN").textContent = hot || "";
  if (!list.length) { $("newsSoon").innerHTML = `<p class="empty">Belum ada jadwal berita minggu ini. Tambahkan di menu Berita.</p>`; return; }
  $("newsSoon").innerHTML = list.map(newsRow).join("");
}
function newsRow(n, withDel) {
  const now = Date.now(), d = new Date(n.t), win = S.settings.newsWin * 60000;
  const cls = n.t < now - win ? "past" : Math.abs(n.t - now) <= win ? "now" : "";
  const impTxt = { high: "Tinggi", med: "Sedang", low: "Rendah" }[n.imp];
  return `<div class="news-row ${cls}"><time>${d.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" })}<br>${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
    <div class="t"><b>${esc(n.ccy)} · ${esc(n.title)}</b><small>${relTime(n.t)}</small></div>
    <div class="actions"><span class="pill ${n.imp}">${impTxt}</span>${withDel ? `<button class="btn sm ghost" data-ndel="${esc(n.id)}" aria-label="Hapus berita">✕</button>` : ""}</div></div>`;
}

/** Dipanggil setiap kali data posisi/riwayat/live berubah. */
function onDataChange() {
  update(); renderExposure(); renderNewsSoon();
  if (curView === "pos") renderPositions();
  if (curView === "journal") renderHistory();
  if (curView === "stats") renderStats();
  if (curView === "save") renderSavings();
  if (curView === "fin") renderFinance();
}

/* ================================================================
 * 8. POSISI
 * ================================================================ */
$("addPos").onclick = () => {
  const p = readForm(), r = calc(p);
  if (!r || !r.slOk) return;
  const pos = { ...p, id: uid(), time: new Date().toISOString() };
  S.positions.push(pos); save();
  toast("Posisi ditambahkan", `${p.sym} ${p.dir.toUpperCase()} ${p.lot} lot · risiko ${money(r.risk)}`, "ok");
  onDataChange();
};

function renderPositions() {
  const body = $("posBody");
  if (!S.positions.length) body.innerHTML = `<tr><td colspan="11" class="empty">Belum ada posisi manual. Tambahkan dari kalkulator di Dashboard.</td></tr>`;
  else body.innerHTML = S.positions.map((p, i) => {
    const r = calc(p), d = symDigits(p.sym);
    return `<tr>
      <td class="num"><span class="dot" style="background:${SEG_COLORS[i % SEG_COLORS.length]}"></span>${esc(p.sym)}</td>
      <td><span class="pill ${p.dir}">${p.dir.toUpperCase()}</span>${isPending(p) ? ` <span class="pill pend">${esc(orderLabel(p))}</span>` : ""}</td>
      <td class="num">${p.lot}</td>
      <td class="num">${fmtP(p.entry, d)}</td><td class="num">${fmtP(p.sl, d)}</td><td class="num">${isFinite(p.tp) ? fmtP(p.tp, d) : "—"}</td>
      <td class="num c-sell">${r ? money(-r.risk) : "—"}</td>
      <td class="num c-buy">${r && isFinite(r.win) ? money(r.win) : "—"}</td>
      <td class="num">${r && isFinite(r.netRR) ? "1:" + fmt(r.netRR, 2) : "—"}</td>
      <td>${esc(p.setup) || '<span class="c-muted">—</span>'}</td>
      <td><div class="actions">${isPending(p) ? `
        <button class="btn sm" data-close="fill" data-id="${p.id}" title="Order sudah terisi menjadi posisi">Terisi</button>
        <button class="btn sm ghost" data-close="del" data-id="${p.id}" title="Batalkan pending order" aria-label="Batalkan pending order">Batal</button>` : `
        <button class="btn sm" data-close="tp" data-id="${p.id}" ${isFinite(p.tp) ? "" : "disabled"}>TP</button>
        <button class="btn sm" data-close="sl" data-id="${p.id}">SL</button>
        <button class="btn sm" data-close="manual" data-id="${p.id}">Harga lain</button>
        <button class="btn sm ghost" data-close="del" data-id="${p.id}" title="Hapus tanpa mencatat" aria-label="Hapus tanpa mencatat">✕</button>`}
      </div></td></tr>`;
  }).join("");
  renderLive();
}

$("posBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-close]"); if (!b) return;
  const idx = S.positions.findIndex(p => p.id === b.dataset.id); if (idx < 0) return;
  const p = S.positions[idx], mode = b.dataset.close;
  if (mode === "fill") {
    p.otype = "market"; p.time = new Date().toISOString(); save();
    toast("Pending order terisi", `${p.sym} ${p.dir.toUpperCase()} ${p.lot} lot sekarang posisi terbuka.`, "ok"); onDataChange(); return;
  }
  if (mode === "del") {
    const pd = isPending(p);
    if (!(await confirmBox(pd ? "Batalkan pending order?" : "Hapus posisi?", `${p.sym} ${pd ? orderLabel(p) : p.dir.toUpperCase()} ${p.lot} lot akan dihapus tanpa dicatat ke jurnal.`, pd ? "Batalkan order" : "Hapus"))) return;
    S.positions.splice(idx, 1); save(); onDataChange(); return;
  }
  let exit = mode === "tp" ? p.tp : mode === "sl" ? p.sl : NaN;
  if (mode === "manual") {
    const v = await ask({ title: `Tutup ${p.sym}`, ok: "Tutup posisi",
      body: `<div class="field"><label>Harga penutupan</label><input name="exit" type="number" step="any" class="num" value="${p.entry}"></div>` });
    if (!v) return;
    exit = num(v.exit);
    if (!isFinite(exit)) { toast("Harga tidak valid", "Masukkan angka harga penutupan.", "danger"); return; }
  }
  closePosition(idx, exit, mode === "tp" ? "TP" : mode === "sl" ? "SL" : "Manual");
});

function closePosition(idx, exit, result) {
  const p = S.positions[idx], sym = resolveSym(p.sym), r = calc(p);
  const pnl = pnlAt(sym, p.dir, p.lot, p.entry, exit) - (r ? r.cost : 0);
  S.history.unshift({ ...p, exit, pnl, risk: r ? r.risk : NaN, result, opened: p.time, closed: new Date().toISOString(), src: "manual" });
  S.positions.splice(idx, 1);
  if (S.settings.autoBal) S.settings.balance = +(S.settings.balance + pnl).toFixed(2);
  save();
  toast(pnl >= 0 ? "Posisi ditutup profit" : "Posisi ditutup rugi", `${p.sym}: ${moneyS(pnl)}`, pnl >= 0 ? "ok" : "warn");
  onDataChange();
}
$("clearPos").onclick = async () => {
  if (!S.positions.length) return;
  if (await confirmBox("Hapus semua posisi manual?", "Posisi akan dihapus tanpa dicatat ke jurnal.", "Hapus semua")) { S.positions = []; save(); onDataChange(); }
};

function renderLive() {
  const chip = $("liveChip"), acct = Live.account;
  if (!Cloud.sess) { chip.className = "chip"; chip.innerHTML = "<i></i>Tidak terhubung"; }
  else if (!Live.updated) { chip.className = "chip warn"; chip.innerHTML = "<i></i>Menunggu EA"; }
  else if (Live.stale) { chip.className = "chip err"; chip.innerHTML = "<i></i>EA tidak aktif"; }
  else { chip.className = "chip ok"; chip.innerHTML = "<i></i>Live"; }
  $("liveSub").textContent = !Cloud.sess ? "Masuk ke akun cloud di Pengaturan → Cloud & MT5, lalu pasang EA RiskDesk Bridge di MT5."
    : !Live.updated ? "Akun terhubung. Pasang EA RiskDesk Bridge di MT5 dengan SyncToken dari Pengaturan."
    : `Pembaruan terakhir ${relTime(Live.updated)}${Live.stale ? ". Pastikan MT5 menyala dan EA berjalan." : "."}`;
  $("liveAcct").innerHTML = acct ? [
    ["Akun", `${esc(acct.login || "")} · ${esc(acct.server || "")}`], ["Balance", money(+acct.balance)], ["Equity", money(+acct.equity)],
    ["Margin terpakai", money(+acct.margin)], ["Free margin", money(+acct.margin_free)],
    ["Margin level", +acct.margin > 0 ? pct(acct.equity / acct.margin * 100, 0) : "—"]
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b class="num">${v}</b></div>`).join("") : "";
  const all = Live.items().sort((a, b) => a.pending - b.pending);
  const nOpen = all.filter(p => !p.pending).length, nPend = all.length - nOpen;
  $("liveCount").textContent = Live.updated ? `${nOpen} posisi terbuka · ${nPend} pending order` : "";
  if (!all.length) { $("liveBody").innerHTML = `<tr><td colspan="10" class="empty">${Live.updated ? "Tidak ada posisi terbuka atau pending order di MT5." : "Belum ada data dari MT5."}</td></tr>`; return; }
  $("liveBody").innerHTML = all.map(p => {
    const ri = riskInfo(p), sym = resolveSym(p.sym), d = sym ? sym.d : 5;
    let status;
    if (p.pending) {
      const gap = sym && isFinite(p.cur) ? Math.abs((isFinite(p.trigger) ? p.trigger : p.entry) - p.cur) / sym.pip : NaN;
      status = `<span class="pill pend">Menunggu</span>${isFinite(gap) ? ` <span class="c-muted num">${fmt(gap, 1)} pip lagi</span>` : ""}${ri.noSl ? ' <span class="pill high">Tanpa SL</span>' : ""}`;
    } else status = ri.noSl ? `<span class="pill high">Tanpa SL</span>` : ri.locked ? `<span class="pill buy">SL di profit</span>` : `<span class="pill neu">Aktif</span>`;
    const jenis = p.pending ? `<span class="pill pend">${esc(orderLabel(p))}</span>` : `<span class="pill open">Open</span>`;
    return `<tr class="${p.pending ? "row-pend" : ""}"><td class="num">${esc(p.sym)}</td><td>${jenis}</td><td><span class="pill ${p.dir}">${p.dir.toUpperCase()}</span></td><td class="num">${p.lot}</td>
      <td class="num">${fmtP(p.entry, d)}</td><td class="num">${isFinite(p.sl) ? fmtP(p.sl, d) : "—"}</td><td class="num">${isFinite(p.tp) ? fmtP(p.tp, d) : "—"}</td>
      <td class="num ${p.pending ? "c-muted" : p.profit >= 0 ? "c-buy" : "c-sell"}">${p.pending ? "—" : moneyS(p.profit)}</td>
      <td class="num c-sell">${isFinite(ri.risk) ? money(-ri.risk) : "∞"}</td><td>${status}</td></tr>`;
  }).join("");
}

/* ================================================================
 * 9. JURNAL
 * ================================================================ */
function periodFilter(list, v) {
  if (v === "all") return list;
  const t = v === "1" ? startOfDay() : Date.now() - (+v) * 864e5;
  return list.filter(h => toTime(h.closed) >= t);
}
const rMult = h => isFinite(h.risk) && h.risk > 0 ? h.pnl / h.risk : NaN;

function renderHistory() {
  const q = $("jSearch").value.trim().toLowerCase();
  const list = periodFilter(S.history, $("jPeriod").value)
    .filter(h => !q || [h.sym, h.setup, h.emo, h.note].join(" ").toLowerCase().includes(q));
  const net = list.reduce((a, h) => a + (+h.pnl || 0), 0);
  $("jCount").innerHTML = list.length ? `${list.length} trade · net <span class="num ${net >= 0 ? "c-buy" : "c-sell"}">${moneyS(net)}</span>` : "Posisi yang ditutup tercatat di sini.";
  if (!list.length) {
    $("histBody").innerHTML = `<tr><td colspan="13" class="empty">${S.history.length ? "Tidak ada trade yang cocok dengan filter." : "Jurnal masih kosong. Tutup posisi lewat menu Posisi, atau import laporan dari MT5."}</td></tr>`;
    return;
  }
  $("histBody").innerHTML = list.slice(0, 500).map(h => {
    const d = symDigits(h.sym), R = rMult(h);
    return `<tr><td class="c-muted">${new Date(h.closed).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</td>
      <td class="num">${esc(h.sym)}</td><td><span class="pill ${h.dir}">${String(h.dir).toUpperCase()}</span></td>
      <td class="num">${h.lot}</td><td class="num">${fmtP(+h.entry, d)}</td><td class="num">${fmtP(+h.exit, d)}</td>
      <td>${esc(h.result)}${h.src === "mt5" ? ' <span class="pill neu">MT5</span>' : ""}</td>
      <td class="num ${h.pnl >= 0 ? "c-buy" : "c-sell"}">${moneyS(+h.pnl)}</td>
      <td class="num">${isFinite(R) ? fmt(R, 2) + "R" : "—"}</td>
      <td>${esc(h.setup) || '<span class="c-muted">—</span>'}</td><td>${esc(h.emo) || '<span class="c-muted">—</span>'}</td>
      <td class="wrap c-muted">${esc(h.note)}</td>
      <td><div class="actions"><button class="btn sm ghost" data-hedit="${esc(h.id)}" aria-label="Ubah catatan">Ubah</button><button class="btn sm ghost" data-hdel="${esc(h.id)}" aria-label="Hapus">✕</button></div></td></tr>`;
  }).join("");
}
$("jPeriod").addEventListener("change", renderHistory);
$("jSearch").addEventListener("input", renderHistory);
$("histBody").addEventListener("click", async e => {
  const del = e.target.closest("[data-hdel]"), ed = e.target.closest("[data-hedit]");
  if (del) {
    const i = S.history.findIndex(h => h.id === del.dataset.hdel); if (i < 0) return;
    if (!(await confirmBox("Hapus catatan trade?", `${S.history[i].sym} ${moneyS(S.history[i].pnl)} akan dihapus dari jurnal. Modal tidak berubah.`, "Hapus"))) return;
    S.history.splice(i, 1); save(); onDataChange();
  }
  if (ed) {
    const h = S.history.find(x => x.id === ed.dataset.hedit); if (!h) return;
    const opt = (list, cur) => `<option value="">—</option>` + [...new Set([...list, cur].filter(Boolean))].map(s => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
    const v = await ask({ title: `Ubah catatan ${h.sym}`, body: `
      <div class="row"><div class="field"><label>Setup</label><select name="setup">${opt(S.settings.setups, h.setup)}</select></div>
      <div class="field"><label>Emosi</label><select name="emo">${opt(S.settings.emotions, h.emo)}</select></div></div>
      <div class="field"><label>Catatan / pelajaran</label><textarea name="note">${esc(h.note)}</textarea></div>` });
    if (!v) return;
    Object.assign(h, { setup: v.setup, emo: v.emo, note: v.note.trim() }); save(); onDataChange();
  }
});
$("clearHist").onclick = async () => {
  if (!S.history.length) return;
  if (await confirmBox("Hapus seluruh jurnal?", "Semua catatan trade dan statistik akan hilang. Unduh backup dulu jika perlu.", "Hapus jurnal")) { S.history = []; save(); onDataChange(); }
};

/* ---------- Ekspor ---------- */
const CSV_COLS = ["opened","closed","symbol","direction","lot","entry","sl","tp","exit","result","pnl","risk","setup","emotion","note","source","ticket"];
$("exportCsv").onclick = () => {
  if (!S.history.length) { toast("Jurnal kosong", "Belum ada data untuk diekspor."); return; }
  const rows = [CSV_COLS];
  S.history.forEach(h => rows.push([h.opened || "", h.closed, h.sym, h.dir, h.lot, h.entry, h.sl ?? "", h.tp ?? "", h.exit, h.result,
    (+h.pnl).toFixed(2), isFinite(h.risk) ? (+h.risk).toFixed(2) : "", h.setup || "", h.emo || "", h.note || "", h.src || "", h.ticket || ""]));
  download(`riskdesk-jurnal-${new Date().toISOString().slice(0, 10)}.csv`, "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
};
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ---------- Import laporan MT5 / CSV ---------- */
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const text = decodeFile(await f.arrayBuffer());
    const rows = /<table/i.test(text) ? parseMt5Html(text) : parseCsvJournal(text);
    if (!rows.length) { toast("Tidak ada trade ditemukan", "Pastikan file adalah laporan History MT5 (HTML) atau CSV dari RiskDesk.", "danger"); return; }
    const seen = new Set(S.history.map(h => h.ticket ? "t" + h.ticket : h.closed + h.sym + h.entry));
    let added = 0, unknown = new Set();
    rows.forEach(h => {
      const k = h.ticket ? "t" + h.ticket : h.closed + h.sym + h.entry;
      if (seen.has(k)) return;
      seen.add(k); S.history.push(h); added++;
      if (!resolveSym(h.sym)) unknown.add(h.sym);
    });
    S.history.sort((a, b) => toTime(b.closed) - toTime(a.closed));
    save(); onDataChange();
    toast("Import selesai", `${added} trade baru ditambahkan, ${rows.length - added} sudah ada.`, "ok");
    if (unknown.size) toast("Simbol belum dikenal", `${[...unknown].slice(0, 5).join(", ")}. Tambahkan di Pengaturan → Simbol agar perhitungan R akurat.`, "warn");
  } catch (err) { console.error(err); toast("Gagal membaca file", "Format file tidak dikenali.", "danger"); }
});
function decodeFile(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  const t = new TextDecoder("utf-8").decode(buf);
  return /\u0000/.test(t.slice(0, 400)) ? new TextDecoder("utf-16le").decode(buf) : t;
}
function parseMtDate(s) {
  const m = String(s).match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).toISOString() : null;
}
function parseMt5Html(html) {
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
  for (const tr of doc.querySelectorAll("tr")) {
    const t = [...tr.children].filter(td => !td.classList.contains("hidden")).map(c => c.textContent.replace(/\u00a0/g, " ").trim());
    // Tabel Positions: Time, Position, Symbol, Type, Volume, Price, S/L, T/P, Time, Price, Commission, Swap, Profit
    if (t.length < 13 || !/^(buy|sell)/i.test(t[3]) || !parseMtDate(t[0]) || !parseMtDate(t[8]) || !isFinite(num(t[9])) || !isFinite(num(t[12]))) continue;
    const dirv = /^sell/i.test(t[3]) ? "sell" : "buy";
    const lot = num(String(t[4]).split("/")[0]), entry = num(t[5]), sl = num(t[6]), tp = num(t[7]), exit = num(t[9]);
    const pnl = (num(t[12]) || 0) + (num(t[10]) || 0) + (num(t[11]) || 0);
    const symObj = resolveSym(t[2]);
    const symName = symObj ? symObj.s : t[2].toUpperCase();
    let risk = NaN;
    if (symObj && sl > 0) { const r = calc({ sym: symName, dir: dirv, lot, entry, sl, tp: NaN, nights: 0 }); if (r && r.slOk) risk = Math.abs(r.grossLoss); }
    const near = (a, b) => symObj && a > 0 && Math.abs(a - b) <= symObj.pip * 3;
    out.push({ id: uid(), ticket: t[1], sym: symName, dir: dirv, lot, entry, sl: sl > 0 ? sl : NaN, tp: tp > 0 ? tp : NaN, exit, pnl, risk,
      result: near(tp, exit) ? "TP" : near(sl, exit) ? "SL" : "Manual", opened: parseMtDate(t[0]), closed: parseMtDate(t[8]), setup: "", emo: "", note: "", src: "mt5" });
  }
  return out;
}
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function parseCsvJournal(text) {
  const rows = parseCsv(text.replace(/^\ufeff/, ""));
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase()), ix = k => head.indexOf(k);
  if (ix("symbol") < 0 || ix("pnl") < 0) return [];
  return rows.slice(1).filter(r => r.length >= head.length - 1 && r[ix("symbol")]).map(r => {
    const g = k => ix(k) >= 0 ? r[ix(k)] : "";
    return { id: uid(), ticket: g("ticket"), sym: g("symbol"), dir: /sell/i.test(g("direction")) ? "sell" : "buy", lot: num(g("lot")),
      entry: num(g("entry")), sl: num(g("sl")), tp: num(g("tp")), exit: num(g("exit")), pnl: num(g("pnl")) || 0, risk: num(g("risk")),
      result: g("result") || "Manual", opened: g("opened") || g("closed"), closed: g("closed") || new Date().toISOString(),
      setup: g("setup"), emo: g("emotion"), note: g("note"), src: g("source") || "csv" };
  });
}

/* ================================================================
 * 10. ANALITIK
 * ================================================================ */
function sessionOf(iso) {
  const h = new Date(iso).getUTCHours();
  return h < 7 ? "Asia" : h < 12 ? "London" : h < 16 ? "London + New York" : h < 21 ? "New York" : "Sydney";
}
function computeStats(L) {
  const s = { n: L.length };
  const wins = L.filter(h => h.pnl > 0), losses = L.filter(h => h.pnl < 0);
  s.gw = wins.reduce((a, h) => a + h.pnl, 0); s.gl = Math.abs(losses.reduce((a, h) => a + h.pnl, 0));
  s.net = s.gw - s.gl; s.wr = L.length ? wins.length / L.length * 100 : NaN;
  s.pf = s.gl ? s.gw / s.gl : (s.gw ? Infinity : NaN);
  s.avgW = wins.length ? s.gw / wins.length : NaN; s.avgL = losses.length ? s.gl / losses.length : NaN;
  s.exp = L.length ? s.net / L.length : NaN;
  const Rs = L.map(rMult).filter(isFinite); s.avgR = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : NaN;
  const ord = [...L].sort((a, b) => toTime(a.closed) - toTime(b.closed));
  let eq = 0, peak = 0, dd = 0, ls = 0, ws = 0, mls = 0, mws = 0; s.curve = [0];
  ord.forEach(h => {
    eq += h.pnl; s.curve.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    if (h.pnl < 0) { ls++; ws = 0; } else if (h.pnl > 0) { ws++; ls = 0; }
    mls = Math.max(mls, ls); mws = Math.max(mws, ws);
  });
  s.maxDD = dd; s.mls = mls; s.mws = mws;
  const startBal = S.settings.autoBal ? S.settings.balance - realizedSince(0) : S.settings.balance;
  s.maxDDpct = startBal > 0 ? dd / (startBal + Math.max(0, peak)) * 100 : NaN;
  s.best = L.length ? Math.max(...L.map(h => h.pnl)) : NaN; s.worst = L.length ? Math.min(...L.map(h => h.pnl)) : NaN;
  return s;
}
function groupBy(L, keyFn, order) {
  const m = {};
  L.forEach(h => { const k = keyFn(h); if (!k) return; (m[k] = m[k] || []).push(h); });
  let rows = Object.entries(m).map(([k, list]) => ({ k, n: list.length, wr: list.filter(h => h.pnl > 0).length / list.length * 100, net: list.reduce((a, h) => a + h.pnl, 0) }));
  if (order) rows.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)); else rows.sort((a, b) => b.net - a.net);
  return rows;
}
function barList(el, rows, emptyMsg) {
  if (!rows.length) { $(el).innerHTML = `<p class="empty">${emptyMsg || "Belum ada data."}</p>`; return; }
  const mx = Math.max(...rows.map(r => Math.abs(r.net))) || 1;
  $(el).innerHTML = rows.map(r => `<div class="brow"><div class="bk">${esc(r.k)}<span>${r.n} trade · WR ${fmt(r.wr, 0)}%</span></div>
    <div class="btrack"><i class="${r.net >= 0 ? "pos" : "neg"}" style="width:${Math.abs(r.net) / mx * 50}%"></i></div>
    <div class="bv num ${r.net >= 0 ? "c-buy" : "c-sell"}">${moneyS(r.net)}</div></div>`).join("");
}
function lineChart(svg, series, opts = {}) {
  const W = 600, H = 160, pad = 8;
  const all = series.flatMap(s => s.pts).concat(opts.band ? opts.band.flat() : []);
  $(svg).setAttribute("preserveAspectRatio", all.length < 2 ? "xMidYMid meet" : "none");
  if (all.length < 2) { $(svg).innerHTML = `<text x="300" y="84" text-anchor="middle" fill="currentColor" opacity=".55" font-size="13" font-family="Manrope,sans-serif">${esc(opts.empty || "Belum ada data")}</text>`; return; }
  const mn = Math.min(...all, opts.base ?? Infinity), mx = Math.max(...all, opts.base ?? -Infinity), rg = (mx - mn) || 1;
  const n = series[0].pts.length;
  const X = i => i / (n - 1) * W, Y = v => H - pad - (v - mn) / rg * (H - pad * 2);
  let out = "";
  if (opts.base != null) out += `<line x1="0" x2="${W}" y1="${Y(opts.base)}" y2="${Y(opts.base)}" stroke="currentColor" opacity=".25" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`;
  if (opts.band) {
    const [lo, hi] = opts.band;
    out += `<path d="M${hi.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("L")}L${lo.map((v, i) => [i, v]).reverse().map(([i, v]) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("L")}Z" fill="${opts.bandColor}" opacity=".16"/>`;
  }
  series.forEach(s => {
    const d = s.pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("");
    if (s.fill) out += `<path d="${d}L${W},${H}L0,${H}Z" fill="${s.color}" opacity=".12"/>`;
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" opacity="${s.op || 1}" vector-effect="non-scaling-stroke"/>`;
  });
  $(svg).innerHTML = out;
}
function renderStats() {
  const L = periodFilter(S.history, $("sPeriod").value), s = computeStats(L);
  const k = (label, val, cls = "") => `<div class="kpi"><span>${label}</span><b class="num ${cls}">${val}</b></div>`;
  $("kpis").innerHTML = [
    k("Total trade", s.n), k("Win rate", pct(s.wr, 1)), k("Net P/L", moneyS(s.net), s.net > 0 ? "c-buy" : s.net < 0 ? "c-sell" : ""),
    k("Profit factor", isFinite(s.pf) ? fmt(s.pf, 2) : s.pf === Infinity ? "∞" : "—"), k("Ekspektasi / trade", moneyS(s.exp)),
    k("Rata-rata R", isFinite(s.avgR) ? fmt(s.avgR, 2) + "R" : "—"), k("Rata-rata profit", money(s.avgW), "c-buy"), k("Rata-rata rugi", money(isFinite(s.avgL) ? -s.avgL : NaN), "c-sell"),
    k("Drawdown maks", s.n ? `${money(-s.maxDD)}${isFinite(s.maxDDpct) ? " · " + pct(s.maxDDpct, 1) : ""}` : "—", "c-sell"),
    k("Rugi beruntun maks", s.n ? s.mls + "×" : "—"), k("Profit terbesar", moneyS(s.best)), k("Rugi terbesar", moneyS(s.worst))
  ].join("");
  const col = s.net >= 0 ? getCss("--buy") : getCss("--sell");
  lineChart("curve", [{ pts: s.curve, color: col, fill: true }], { base: 0, empty: "Kurva ekuitas muncul setelah trade pertama ditutup" });

  barList("byPair", groupBy(L, h => h.sym).slice(0, 10));
  barList("bySess", groupBy(L, h => sessionOf(h.opened || h.closed), ["Sydney", "Asia", "London", "London + New York", "New York"]));
  barList("byDay", groupBy(L, h => DAYS[new Date(h.opened || h.closed).getDay()], DAYS));
  barList("bySetup", groupBy(L, h => h.setup), "Pilih setup saat entry agar data ini terisi.");
  barList("byEmo", groupBy(L, h => h.emo), "Pilih kondisi emosi saat entry agar data ini terisi.");

  const ins = [];
  if (s.n < 5) ins.push("Kumpulkan minimal 20–30 trade agar pola mulai terlihat bermakna.");
  else {
    const pairs = groupBy(L, h => h.sym).filter(r => r.n >= 2);
    if (pairs.length) { const b = pairs[0], w = pairs[pairs.length - 1];
      ins.push(`Pair terbaik: <b>${esc(b.k)}</b> (${moneyS(b.net)}, WR ${fmt(b.wr, 0)}%).`);
      if (w.net < 0 && w.k !== b.k) ins.push(`Pair paling merugikan: <b>${esc(w.k)}</b> (${moneyS(w.net)}). Pertimbangkan berhenti trading pair ini sementara.`); }
    const ses = groupBy(L, h => sessionOf(h.opened || h.closed)).filter(r => r.n >= 3);
    if (ses.length > 1) { const w = ses[ses.length - 1]; if (w.net < 0) ins.push(`Sesi ${esc(w.k)} cenderung merugi (${moneyS(w.net)} dari ${w.n} trade).`); }
    const emo = groupBy(L, h => h.emo).filter(r => r.n >= 2);
    const badEmo = emo.filter(r => r.net < 0).pop();
    if (badEmo) ins.push(`Saat merasa <b>${esc(badEmo.k)}</b>, hasil Anda ${moneyS(badEmo.net)}. Jadikan ini sinyal untuk tidak entry.`);
    if (isFinite(s.avgW) && isFinite(s.avgL)) {
      const rr = s.avgW / s.avgL, be = 100 / (1 + rr);
      ins.push(`Rata-rata profit ${fmt(rr, 2)}× rata-rata rugi, jadi Anda butuh win rate di atas ${fmt(be, 0)}% untuk untung. Saat ini ${fmt(s.wr, 0)}%.`);
    }
    if (s.mls >= 4) ins.push(`Pernah rugi ${s.mls}× berturut-turut. Pastikan risiko per trade cukup kecil untuk bertahan dari rangkaian seperti ini.`);
  }
  $("insights").innerHTML = ins.map(t => `<li>${t}</li>`).join("");
}
$("sPeriod").addEventListener("change", renderStats);
const getCss = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";

/* ================================================================
 * 11. ALAT: PARTIAL CLOSE & SIMULASI
 * ================================================================ */
let pcLastEdit = "r";
$("pcR").addEventListener("input", () => { pcLastEdit = "r"; renderPartial(); });
$("pcTp1").addEventListener("input", () => { pcLastEdit = "price"; renderPartial(); });
["pcPct", "pcPlus"].forEach(id => $(id).addEventListener("input", renderPartial));
$("pcMove").addEventListener("change", renderPartial);

function renderPartial() {
  const p = readForm(), r = calc(p), sym = resolveSym(curSym), st = S.settings;
  $("pcPlus").disabled = $("pcMove").value !== "bep";
  if (!r || !r.slOk || !r.tpOk) {
    $("pcInfo").innerHTML = `Isi entry, SL, dan TP di <a href="#dash" data-go="dash">Dashboard</a> terlebih dahulu. Alat ini memakai rencana entry tersebut.`;
    $("pcOut").innerHTML = ""; return;
  }
  const sign = dir === "buy" ? 1 : -1;
  $("pcInfo").innerHTML = `Rencana: <b class="num">${esc(curSym)} ${dir.toUpperCase()} ${p.lot} lot</b> · entry <span class="num">${fmtP(p.entry, sym.d)}</span> · SL <span class="num">${fmtP(p.sl, sym.d)}</span> · TP <span class="num">${fmtP(p.tp, sym.d)}</span>`;
  let tp1;
  if (pcLastEdit === "r") { const R = num($("pcR").value); tp1 = p.entry + sign * R * r.slDist; if (isFinite(tp1)) $("pcTp1").value = tp1.toFixed(sym.d); }
  else { tp1 = num($("pcTp1").value); if (isFinite(tp1)) $("pcR").value = +(((tp1 - p.entry) * sign) / r.slDist).toFixed(2); }
  const errs = [];
  if (!isFinite(tp1) || (tp1 - p.entry) * sign <= 0) errs.push("Target 1 harus berada di arah profit.");
  else if ((tp1 - p.tp) * sign >= 0) errs.push("Target 1 harus lebih dekat dari TP akhir.");
  const step = st.lotStep || 0.01, pctC = clamp(num($("pcPct").value) || 0, 0, 100);
  const lot1 = roundLot(p.lot * pctC / 100, step), lot2 = +(p.lot - lot1).toFixed(2);
  if (lot1 < step) errs.push(`Lot yang ditutup (${fmt(p.lot * pctC / 100, 3)}) lebih kecil dari lot minimum ${step}. Perbesar lot atau persentase.`);
  if (lot2 < step) errs.push("Sisa lot terlalu kecil. Kurangi persentase.");
  if (errs.length) { $("pcOut").innerHTML = `<p class="hint err" style="margin-top:6px">${errs.join(" ")}</p>`; return; }

  const mv = $("pcMove").value;
  const newSl = mv === "be" ? p.entry : mv === "bep" ? p.entry + sign * (num($("pcPlus").value) || 0) * sym.pip : p.sl;
  const P = (lot, exit) => pnlAt(sym, dir, lot, p.entry, exit);
  const cost = r.cost, risk = r.risk;
  const sc = [
    ["SL kena sebelum target 1", P(p.lot, p.sl) - cost],
    [`Target 1, lalu sisa kena SL baru`, P(lot1, tp1) + P(lot2, newSl) - cost],
    [`Target 1, lalu sisa kena TP`, P(lot1, tp1) + P(lot2, p.tp) - cost],
    ["Tanpa partial: langsung TP penuh", P(p.lot, p.tp) - cost]
  ];
  $("pcOut").innerHTML = `<table class="scen" style="margin-top:6px"><thead><tr><th>Skenario</th><th style="text-align:right">Hasil</th><th style="text-align:right">R</th></tr></thead><tbody>` +
    sc.map(([n, v]) => `<tr><td>${n}</td><td class="num ${v >= 0 ? "c-buy" : "c-sell"}" style="text-align:right">${moneyS(v)}</td><td class="num" style="text-align:right">${fmt(v / risk, 2)}R</td></tr>`).join("") +
    `</tbody></table><p class="hint" style="margin-top:10px">Tutup <b class="num">${lot1}</b> lot di <span class="num">${fmtP(tp1, sym.d)}</span>, sisakan <b class="num">${lot2}</b> lot dengan SL di <span class="num">${fmtP(newSl, sym.d)}</span>. ` +
    (sc[1][1] >= 0 ? "Setelah target 1 tercapai, posisi ini tidak bisa lagi berakhir rugi." : "Setelah target 1, posisi masih bisa rugi karena SL belum digeser cukup jauh.") + `</p>`;
}

function percentile(sorted, q) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
$("smFromJ").onclick = () => {
  const s = computeStats(S.history);
  if (s.n < 5 || !isFinite(s.avgW) || !isFinite(s.avgL)) { toast("Data jurnal belum cukup", "Butuh minimal 5 trade dengan profit dan rugi."); return; }
  $("smWr").value = +s.wr.toFixed(1);
  $("smRr").value = +(s.avgW / s.avgL).toFixed(2);
  $("smBal").value = S.settings.balance;
  toast("Statistik jurnal dipakai", `Win rate ${fmt(s.wr, 1)}%, R:R rata-rata ${fmt(s.avgW / s.avgL, 2)}.`, "ok");
};
$("smRun").onclick = () => {
  const bal0 = num($("smBal").value), risk = num($("smRisk").value) / 100, wr = num($("smWr").value) / 100, rr = num($("smRr").value);
  const n = Math.round(num($("smN").value)), ddLim = num($("smDD").value) / 100, comp = $("smComp").checked, runs = 1000;
  if (!(bal0 > 0) || !(risk > 0) || !(wr >= 0 && wr <= 1) || !(rr > 0) || !(n >= 1 && n <= 2000) || !(ddLim > 0)) {
    toast("Isian belum lengkap", "Periksa modal, risiko, win rate (0–100), R:R, dan jumlah trade (1–2000).", "danger"); return;
  }
  const steps = Array.from({ length: n + 1 }, () => new Float64Array(runs));
  const finals = [], dds = [], streaks = []; let hitDD = 0;
  for (let k = 0; k < runs; k++) {
    let eq = bal0, peak = bal0, maxdd = 0, ls = 0, mls = 0, hit = false;
    steps[0][k] = eq;
    for (let i = 0; i < n; i++) {
      const stake = (comp ? eq : bal0) * risk;
      if (Math.random() < wr) { eq += stake * rr; ls = 0; } else { eq -= stake; ls++; if (ls > mls) mls = ls; }
      if (eq < 0) eq = 0;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 1;
      if (dd > maxdd) maxdd = dd;
      if (dd >= ddLim) hit = true;
      steps[i + 1][k] = eq;
    }
    finals.push(eq); dds.push(maxdd); streaks.push(mls); if (hit) hitDD++;
  }
  const sortN = a => [...a].sort((x, y) => x - y);
  const fS = sortN(finals), dS = sortN(dds), sS = sortN(streaks);
  const p5 = [], p50 = [], p95 = [];
  steps.forEach(arr => { const s = Float64Array.from(arr).sort(); p5.push(percentile(s, .05)); p50.push(percentile(s, .5)); p95.push(percentile(s, .95)); });
  const brass = getCss("--brass");
  lineChart("smChart", [{ pts: p50, color: brass, w: 2.5 }, { pts: p5, color: getCss("--sell"), w: 1, op: .7 }, { pts: p95, color: getCss("--buy"), w: 1, op: .7 }],
    { band: [p5, p95], bandColor: brass, base: bal0 });
  const ev = wr * rr - (1 - wr);
  const k = (label, val, cls = "") => `<div class="kpi"><span>${label}</span><b class="num ${cls}">${val}</b></div>`;
  const prof = finals.filter(v => v > bal0).length / runs * 100;
  $("smOut").innerHTML = [
    k("Hasil median", money(percentile(fS, .5))), k("Skenario buruk (5%)", money(percentile(fS, .05)), "c-sell"), k("Skenario baik (95%)", money(percentile(fS, .95)), "c-buy"),
    k("Peluang berakhir profit", pct(prof, 0)), k("Median drawdown maks", pct(percentile(dS, .5) * 100, 1)),
    k(`Peluang drawdown ≥ ${fmt(ddLim * 100, 0)}%`, pct(hitDD / runs * 100, 0), hitDD / runs > .2 ? "c-sell" : ""),
    k("Rugi beruntun terpanjang (median)", Math.round(percentile(sS, .5)) + "×"), k("Ekspektasi per trade", (ev >= 0 ? "+" : "") + fmt(ev, 2) + "R", ev >= 0 ? "c-buy" : "c-sell")
  ].join("");
  if (ev < 0) toast("Sistem dengan ekspektasi negatif", "Dengan win rate dan R:R ini, modal cenderung berkurang dalam jangka panjang.", "warn");
};

/* ================================================================
 * 12. KALENDER BERITA
 * ================================================================ */
const NEWS_CCY = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF","CNY","CNH"];
function renderNews() {
  const cutoff = Date.now() - 2 * 864e5;
  const before = S.news.length;
  S.news = S.news.filter(n => n.t >= cutoff);
  if (S.news.length !== before) save();
  const list = [...S.news].sort((a, b) => a.t - b.t);
  if (!list.length) { $("newsList").innerHTML = `<p class="empty">Belum ada jadwal. Ambil kalender otomatis atau tambahkan manual di samping.</p>`; return; }
  let html = "", lastDay = "";
  list.forEach(n => {
    const day = new Date(n.t).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
    if (day !== lastDay) { html += `<h3 style="margin:16px 0 4px">${day}</h3>`; lastDay = day; }
    html += newsRow(n, true);
  });
  $("newsList").innerHTML = html;
}
$("newsList").addEventListener("click", e => {
  const b = e.target.closest("[data-ndel]"); if (!b) return;
  S.news = S.news.filter(n => n.id !== b.dataset.ndel); save(); renderNews(); renderNewsSoon(); update();
});
$("nAdd").onclick = () => {
  const t = new Date($("nTime").value).getTime(), title = $("nTitle").value.trim();
  if (!isFinite(t)) { toast("Waktu belum diisi", "Pilih tanggal dan jam rilis berita.", "danger"); return; }
  if (!title) { toast("Nama berita belum diisi", "Contoh: CPI, NFP, FOMC.", "danger"); return; }
  S.news.push({ id: uid(), t, ccy: $("nCcy").value, title, imp: $("nImp").value });
  save(); $("nTitle").value = "";
  renderNews(); renderNewsSoon(); update();
  toast("Berita ditambahkan", `${$("nCcy").value} · ${title}`, "ok");
};
$("nFetch").onclick = async () => {
  const btn = $("nFetch"); btn.disabled = true; $("nInfo").textContent = "Mengambil kalender…";
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    const keys = new Set(S.news.map(n => n.t + n.ccy + n.title));
    let added = 0;
    arr.forEach(x => {
      const imp = x.impact === "High" ? "high" : x.impact === "Medium" ? "med" : null;
      const t = new Date(x.date).getTime();
      if (!imp || !isFinite(t)) return;
      const k = t + x.country + x.title;
      if (keys.has(k)) return;
      keys.add(k); S.news.push({ id: uid(), t, ccy: x.country, title: x.title, imp, src: "ff" }); added++;
    });
    save(); renderNews(); renderNewsSoon(); update();
    $("nInfo").textContent = `${added} berita baru ditambahkan dari kalender minggu ini.`;
  } catch (e) {
    $("nInfo").innerHTML = `Kalender otomatis tidak bisa diakses dari browser ini. Tambahkan manual dari <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">forexfactory.com/calendar</a>.`;
  }
  btn.disabled = false;
};

/* ================================================================
 * 16. TABUNGAN INVESTASI (emas, saham, SBN, reksa dana, kripto, dll.)
 *     Semua nilai dalam Rupiah. Metode harga rata-rata (average cost).
 * ================================================================ */
const KIND_LABEL = { buy: "Beli / setor", sell: "Jual / tarik", income: "Dividen / kupon / bunga", fee: "Biaya" };
const SV = () => S.savings;
const svType = id => SV().types.find(t => t.id === id) || { id, name: id, unit: "unit", mult: 1, mode: "unit", dec: 4, color: "#8A9AB5", price: "Harga per unit" };
const svAsset = id => SV().assets.find(a => a.id === id);
const rp = v => isFinite(v) ? (v < 0 ? "−" : "") + "Rp\u00a0" + Math.abs(Math.round(v)).toLocaleString("id-ID") : "—";
const rpS = v => isFinite(v) ? (v > 0 ? "+" : "") + rp(v) : "—";
const qtyFmt = (v, dec) => isFinite(v) ? v.toLocaleString("id-ID", { maximumFractionDigits: dec ?? 4 }) : "—";
const ymOf = d => String(d).slice(0, 7);
const thisYm = () => new Date().toISOString().slice(0, 7);
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const ymLabel = ym => { const [y, m] = ym.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "2-digit" }); };
const txSorted = () => [...SV().tx].sort((a, b) => (a.date + (a.t || "")).localeCompare(b.date + (b.t || "")));

/* ---------- Riwayat harga ---------- */
/** Simpan harga terbaru + riwayat (maks. satu titik per hari). */
function recordPrice(a, p, t = Date.now()) {
  if (!(p > 0)) return;
  const day = new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  a.prices = (a.prices || []).filter(x => x.d !== day);
  a.prices.push({ d: day, p: +p });
  a.prices.sort((x, y) => x.d.localeCompare(y.d));
  if (a.prices.length > 1500) a.prices = a.prices.slice(-1500);
  const last = a.prices[a.prices.length - 1];
  if (last.d === day || !a.priceAt || t >= a.priceAt) { a.price = last.p; a.priceAt = Math.max(t, a.priceAt && last.d === day ? a.priceAt : 0); }
}
/** Titik harga gabungan (riwayat + harga transaksi) untuk grafik. */
function pricePoints(a) {
  const pts = (a.prices || []).map(x => ({ d: x.d, p: x.p }));
  SV().tx.filter(x => x.asset === a.id && (x.kind === "buy" || x.kind === "sell") && +x.price > 0).forEach(x => pts.push({ d: x.date, p: +x.price, tx: true }));
  return pts.sort((x, y) => x.d.localeCompare(y.d) || (x.tx ? -1 : 1));
}

/* ---------- Harga kripto otomatis (CoinGecko) ---------- */
const CG_MAP = { BTC:"bitcoin", ETH:"ethereum", BNB:"binancecoin", SOL:"solana", XRP:"ripple", ADA:"cardano", DOGE:"dogecoin", USDT:"tether",
  USDC:"usd-coin", LTC:"litecoin", TRX:"tron", DOT:"polkadot", AVAX:"avalanche-2", LINK:"chainlink", TON:"the-open-network", SHIB:"shiba-inu",
  PEPE:"pepe", POL:"polygon-ecosystem-token", MATIC:"matic-network", ATOM:"cosmos", XLM:"stellar", NEAR:"near", APT:"aptos", SUI:"sui", ARB:"arbitrum", OP:"optimism", PAXG:"pax-gold", XAUT:"tether-gold" };
let cgLast = 0, cgBusy = false;
const autoAssets = () => SV().assets.filter(a => svType(a.type).auto === "coingecko" && (a.cg || CG_MAP[(a.code || "").toUpperCase()]));
async function svAutoPrices(force) {
  const list = autoAssets();
  if (!list.length || cgBusy || (!force && Date.now() - cgLast < 10 * 60000)) return;
  cgBusy = true;
  const ids = [...new Set(list.map(a => a.cg || CG_MAP[a.code.toUpperCase()]))];
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?vs_currencies=idr&ids=" + encodeURIComponent(ids.join(",")));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json(); let n = 0;
    list.forEach(a => { const id = a.cg || CG_MAP[a.code.toUpperCase()]; if (j[id] && j[id].idr > 0) { recordPrice(a, j[id].idr); a.priceSrc = "auto"; n++; } });
    cgLast = Date.now();
    if (n) { save(); if (curView === "save") renderSavings(); }
    if (force) toast("Harga kripto diperbarui", `${n} aset diperbarui dari CoinGecko.`, n ? "ok" : "warn");
  } catch (e) {
    if (force) toast("Gagal mengambil harga kripto", "CoinGecko sedang tidak bisa diakses. Coba lagi nanti atau isi manual lewat tombol Harga.", "warn");
  }
  cgBusy = false;
}

/** Hitung posisi satu aset dari riwayat transaksinya. */
function assetStats(a) {
  const t = svType(a.type), nominal = t.mode === "nominal", mult = nominal ? 1 : (t.mult || 1);
  let qty = 0, cost = 0, realized = 0, income = 0, netIn = 0, lastPrice = NaN, first = null;
  txSorted().filter(x => x.asset === a.id).forEach(x => {
    const price = nominal ? 1 : +x.price, q = +x.qty || 0, fee = +x.fee || 0;
    if (!first) first = x.date;
    if (x.kind === "buy") { qty += q; cost += q * mult * price + fee; netIn += q * mult * price + fee; lastPrice = price; }
    else if (x.kind === "sell") {
      const avg = qty > 0 ? cost / qty : 0, proceeds = q * mult * price - fee;
      realized += proceeds - avg * q; cost -= avg * q; qty -= q; netIn -= proceeds; lastPrice = price;
      if (qty < 1e-12) { qty = 0; cost = 0; }
    }
    else if (x.kind === "income") income += +x.amount || 0;
    else if (x.kind === "fee") realized -= +x.amount || 0;
  });
  const price = nominal ? 1 : (a.price > 0 ? +a.price : lastPrice);
  const value = qty * mult * (isFinite(price) ? price : 0);
  const unreal = value - cost;
  return { t, qty, cost, avg: qty > 0 ? cost / (qty * mult) : NaN, price, value, unreal, unrealPct: cost > 0 ? unreal / cost * 100 : NaN,
    realized, income, netIn, total: unreal + realized + income, first, mult, nominal };
}
function portfolio() {
  const rows = SV().assets.map(a => ({ a, st: assetStats(a) }));
  const sum = k => rows.reduce((s, r) => s + (r.st[k] || 0), 0);
  const byType = {};
  rows.forEach(r => { const k = r.a.type; byType[k] = (byType[k] || 0) + r.st.value; });
  const yr = new Date().getFullYear() + "";
  const incomeYear = SV().tx.filter(x => x.kind === "income" && x.date.startsWith(yr)).reduce((s, x) => s + (+x.amount || 0), 0);
  return { rows, value: sum("value"), cost: sum("cost"), unreal: sum("unreal"), realized: sum("realized"), income: sum("income"), netIn: sum("netIn"), byType, incomeYear };
}

/* ---------- Navigasi sub-tab ---------- */
let svTab = "sv-sum";
$$("[data-sv]").forEach(b => b.onclick = () => { svTab = b.dataset.sv; renderSavings(); });

const SV_TITLES = { "sv-sum": "Ringkasan", "sv-assets": "Aset", "sv-tx": "Transaksi", "sv-goals": "Target", "sv-plans": "Setoran rutin", "sv-proj": "Proyeksi", "sv-types": "Jenis & alokasi" };
function renderSavings() {
  $$("[data-sv]").forEach(b => b.classList.toggle("on", b.dataset.sv === svTab));
  if (curView === "save") {
    $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === "save" && b.dataset.sub === svTab));
    $("viewTitle").textContent = "Investasi · " + (SV_TITLES[svTab] || "");
  }
  $$(".subpane").forEach(p => p.classList.toggle("on", p.id === svTab));
  renderHelp();
  if (svTab === "sv-sum" || svTab === "sv-assets") svAutoPrices(false);
  const fn = { "sv-sum": svRenderSummary, "sv-assets": svRenderAssets, "sv-tx": svRenderTx, "sv-goals": svRenderGoals,
    "sv-plans": svRenderPlans, "sv-proj": svRenderProj, "sv-types": svRenderTypes }[svTab];
  if (fn) fn();
}

/* ---------- Ringkasan ---------- */
function svRenderSummary() {
  const P = portfolio(), k = (l, v, c = "", tip = "") => `<div class="kpi"><span>${l}${tip ? " " + qi(tip) : ""}</span><b class="num ${c}">${v}</b></div>`;
  const ret = P.unreal + P.realized + P.income;
  $("svKpis").innerHTML = [
    k("Total nilai tabungan", rp(P.value), "", "Jumlah nilai semua aset, dihitung dengan harga terakhir yang tercatat."),
    k("Modal bersih disetor", rp(P.netIn), "", "Total uang yang Anda masukkan, dikurangi uang yang sudah ditarik/dijual."),
    k("Untung/rugi belum dijual", `${rpS(P.unreal)}${P.cost > 0 ? " · " + pct(P.unreal / P.cost * 100, 1) : ""}`, P.unreal >= 0 ? "c-buy" : "c-sell", "Selisih nilai sekarang dengan modal aset yang masih Anda pegang. Belum menjadi uang nyata sampai dijual."),
    k("Total imbal hasil", rpS(ret), ret >= 0 ? "c-buy" : "c-sell", "Untung/rugi belum dijual + untung/rugi dari penjualan + dividen/kupon/bunga."),
    k(`Dividen/kupon ${new Date().getFullYear()}`, rp(P.incomeYear), "c-buy", "Pendapatan pasif tahun ini: dividen saham, kupon SBN, bunga."),
    k("Jumlah aset", SV().assets.length, "", "Banyaknya aset yang Anda catat.")
  ].join("");
  svMountTicker();
  // Alokasi
  const types = SV().types.filter(t => (P.byType[t.id] || 0) > 0);
  if (!P.value) { $("svAllocBar").innerHTML = ""; $("svAllocLegend").innerHTML = `<p class="empty">Belum ada aset. Mulai dengan <b>Tambah aset</b>, lalu <b>Catat transaksi</b> pembelian pertama.</p>`; }
  else {
    $("svAllocBar").innerHTML = types.map(t => `<i style="width:${P.byType[t.id] / P.value * 100}%;background:${t.color}" title="${esc(t.name)}"></i>`).join("");
    $("svAllocLegend").innerHTML = types.map(t => {
      const p = P.byType[t.id] / P.value * 100, tgt = +t.target || 0;
      return `<div class="lg"><span class="dot" style="background:${t.color}"></span><b>${esc(t.name)}</b><span class="num">${pct(p, 1)}</span><span class="num c-muted">${rp(P.byType[t.id])}</span>${tgt ? `<span class="c-muted">target ${tgt}%</span>` : ""}</div>`;
    }).join("");
  }
  // Pertumbuhan
  const g = svGrowth();
  if (g.months.length >= 2) {
    lineChart("svCurve", [{ pts: g.contrib, color: getCss("--muted"), w: 1.5 }, { pts: g.value, color: getCss("--brass"), w: 2.5, fill: true }], {});
    $("svCurveHint").innerHTML = `<span style="color:var(--brass)">━</span> nilai (dari riwayat harga yang tercatat) &nbsp; <span class="c-muted">━ modal disetor</span> · ${ymLabel(g.months[0])} sampai ${ymLabel(g.months[g.months.length - 1])}`;
  } else { lineChart("svCurve", [{ pts: [], color: "#888" }], { empty: "Grafik pertumbuhan muncul setelah ada transaksi di 2 bulan berbeda" }); $("svCurveHint").textContent = ""; }
  // Target & rutin mini
  $("svGoalsMini").innerHTML = SV().goals.length ? SV().goals.slice(0, 4).map(goalCard).join("") : `<p class="empty">Belum ada target. Buat di tab <b>Target</b>.</p>`;
  const plans = SV().plans.filter(p => p.active);
  $("svStreak").innerHTML = plans.length ? streakText() : "Belum ada jadwal setoran rutin.";
  $("svPlansMini").innerHTML = plans.length ? plans.map(planRow).join("") : `<p class="empty">Atur jadwal di tab <b>Rutin</b>, misalnya beli emas setiap tanggal 25.</p>`;
}
function svGrowth() {
  const tx = txSorted(); if (!tx.length) return { months: [], contrib: [], value: [] };
  const months = []; let [y, m] = ymOf(tx[0].date).split("-").map(Number);
  const end = thisYm();
  while (true) { const ym = `${y}-${String(m).padStart(2, "0")}`; months.push(ym); if (ym >= end || months.length > 600) break; m++; if (m > 12) { m = 1; y++; } }
  const qty = {}, last = {}, contrib = [], value = []; let c = 0, i = 0;
  const ptsBy = {}; SV().assets.forEach(a => ptsBy[a.id] = pricePoints(a));
  const priceAt = (id, ym) => { const pts = ptsBy[id] || []; let p = NaN; for (const x of pts) { if (ymOf(x.d) <= ym) p = x.p; else break; } return p; };
  months.forEach((ym, mi) => {
    while (i < tx.length && ymOf(tx[i].date) <= ym) {
      const x = tx[i++], a = svAsset(x.asset); if (!a) continue;
      const t = svType(a.type), nom = t.mode === "nominal", mult = nom ? 1 : (t.mult || 1), price = nom ? 1 : +x.price, q = +x.qty || 0, fee = +x.fee || 0;
      if (x.kind === "buy") { qty[a.id] = (qty[a.id] || 0) + q; c += q * mult * price + fee; last[a.id] = price; }
      if (x.kind === "sell") { qty[a.id] = (qty[a.id] || 0) - q; c -= q * mult * price - fee; last[a.id] = price; }
    }
    const isNow = mi === months.length - 1;
    let v = 0;
    Object.keys(qty).forEach(id => {
      const a = svAsset(id); if (!a) return;
      const t = svType(a.type), nom = t.mode === "nominal", mult = nom ? 1 : (t.mult || 1);
      const ph = priceAt(id, ym);
      const p = nom ? 1 : (isNow && a.price > 0 ? +a.price : (isFinite(ph) ? ph : last[id]));
      v += (qty[id] || 0) * mult * (p || 0);
    });
    contrib.push(c); value.push(v);
  });
  return { months, contrib, value };
}

/* ---------- Aset ---------- */
function svRenderAssets() {
  const P = portfolio();
  if (!SV().assets.length) { $("svAssetList").innerHTML = `<p class="empty">Belum ada aset. Klik <b>Tambah aset</b>, misalnya "Emas Antam", "BBCA", atau "ORI025".</p>`; return; }
  let html = "";
  SV().types.forEach(t => {
    const rows = P.rows.filter(r => r.a.type === t.id); if (!rows.length) return;
    const tot = rows.reduce((s, r) => s + r.st.value, 0);
    html += `<h3 class="type-h"><span class="dot" style="background:${t.color}"></span>${esc(t.name)} <span class="num c-muted">${rp(tot)}</span></h3>
      <div class="tbl-wrap"><table><thead><tr><th>Aset</th><th>Jumlah</th><th>Harga rata-rata</th><th>Harga sekarang</th><th>Nilai</th><th>Untung/rugi</th><th>Target</th><th></th></tr></thead><tbody>` +
      rows.map(({ a, st }) => {
        const goal = SV().goals.find(g => g.id === a.goal);
        const stale = a.priceAt ? Math.round((Date.now() - a.priceAt) / 864e5) : null;
        return `<tr><td><b>${esc(a.name)}</b>${a.code ? ` <span class="c-muted num">${esc(a.code)}</span>` : ""}</td>
          <td class="num">${st.nominal ? rp(st.qty) : qtyFmt(st.qty, t.dec) + " " + esc(t.unit)}</td>
          <td class="num">${st.nominal ? "—" : rp(st.avg)}</td>
          <td class="num">${st.nominal ? "—" : rp(st.price)}${stale !== null && !st.nominal ? `<br><small class="${stale > 30 ? "c-warn" : "c-muted"}">${a.priceSrc === "auto" && svType(a.type).auto ? "otomatis · " : ""}${stale ? stale + " hari lalu" : "hari ini"}</small>` : ""}</td>
          <td class="num"><b>${rp(st.value)}</b></td>
          <td class="num ${st.unreal >= 0 ? "c-buy" : "c-sell"}">${st.nominal ? (st.income ? `<span class="c-buy">+${rp(st.income)} kupon/bunga</span>` : "—") : `${rpS(st.unreal)}<br><small>${pct(st.unrealPct, 1)}</small>`}</td>
          <td>${goal ? `<span class="pill neu">${esc(goal.name)}</span>` : '<span class="c-muted">—</span>'}</td>
          <td><div class="actions">${st.nominal ? "" : `<button class="btn sm" data-sva="price" data-id="${a.id}" data-tip="Isi harga terbaru agar nilai dan untung/rugi akurat. Riwayat harga tersimpan untuk grafik.">Harga</button>`}
            ${tvForAsset(a) ? `<button class="btn sm" data-sva="chart" data-id="${a.id}" data-tip="Grafik harga dari TradingView (untuk dilihat, bukan untuk perhitungan).">Grafik</button>` : ""}
            <button class="btn sm primary" data-sva="tx" data-id="${a.id}" data-tip="Catat beli, jual, dividen/kupon, atau biaya untuk aset ini.">Transaksi</button>
            <button class="btn sm ghost" data-sva="edit" data-id="${a.id}" data-tip="Ganti nama/kode atau hubungkan aset ke target.">Ubah</button>
            <button class="btn sm ghost" data-sva="del" data-id="${a.id}" aria-label="Hapus aset" data-tip="Hapus aset beserta semua transaksinya.">✕</button></div></td></tr>`;
      }).join("") + `</tbody></table></div>`;
  });
  $("svAssetList").innerHTML = html;
  $("svCgBtn").hidden = !autoAssets().length;
}
$("svCgBtn").onclick = () => svAutoPrices(true);
$("svAssetList").addEventListener("click", async e => {
  const b = e.target.closest("[data-sva]"); if (!b) return;
  const a = svAsset(b.dataset.id); if (!a) return;
  const act = b.dataset.sva;
  if (act === "price") return svUpdatePrice(a);
  if (act === "chart") return svChart(a);
  if (act === "tx") return svTxForm({ asset: a.id });
  if (act === "edit") return svAssetForm(a);
  if (act === "del") {
    const n = SV().tx.filter(x => x.asset === a.id).length;
    if (!(await confirmBox(`Hapus ${a.name}?`, `Aset dan ${n} transaksinya akan dihapus permanen.`, "Hapus aset"))) return;
    SV().assets = SV().assets.filter(x => x.id !== a.id); SV().tx = SV().tx.filter(x => x.asset !== a.id);
    SV().plans = SV().plans.filter(p => p.asset !== a.id); save(); renderSavings();
  }
});
const typeOptions = cur => SV().types.map(t => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${esc(t.name)} (${esc(t.unit)})</option>`).join("");
const goalOptions = cur => `<option value="">Tanpa target</option>` + SV().goals.map(g => `<option value="${g.id}" ${g.id === cur ? "selected" : ""}>${esc(g.name)}</option>`).join("");

async function svAssetForm(a, preset = {}) {
  const v0 = { type: "emas", name: "", code: "", price: "", goal: "", ...(a || {}), ...preset };
  const pr = ask({ title: a ? `Ubah ${a.name}` : "Tambah aset", ok: a ? "Simpan" : "Tambah aset", body: `
    <div class="field"><label>Jenis</label><select name="type" id="fType">${typeOptions(v0.type)}</select></div>
    <div class="row"><div class="field"><label>Nama aset</label><input name="name" type="text" value="${esc(v0.name)}" placeholder="mis. Emas Antam, Bank BCA"></div>
    <div class="field"><label>Kode (opsional)</label><input name="code" type="text" value="${esc(v0.code)}" placeholder="mis. BBCA, ORI025, BTC"></div></div>
    <div class="field" id="fPriceWrap"><label id="fPriceLbl">Harga sekarang (Rp)</label><input name="price" type="number" step="any" class="num" value="${v0.price || ""}" placeholder="boleh dikosongkan"></div>
    <div class="field" id="fCgWrap"><label>ID CoinGecko ${qi("Untuk harga otomatis. Terisi sendiri untuk koin populer (BTC, ETH, SOL, dll.). Untuk koin lain, salin ID dari alamat halaman koin di coingecko.com, mis. coingecko.com/en/coins/bitcoin → bitcoin.")}</label><input name="cg" id="fCg" type="text" value="${esc(v0.cg || "")}" placeholder="otomatis dari kode, mis. bitcoin" spellcheck="false"></div>
    <div class="field" id="fTvWrap"><label>Simbol TradingView (opsional) ${qi("Untuk menampilkan grafik harga. Terisi otomatis untuk saham (IDX:KODE) dan kripto (INDODAX:KODEIDR). Contoh lain: OANDA:XAUUSD.")}</label><input name="tv" type="text" value="${esc(v0.tv || "")}" placeholder="otomatis, mis. IDX:BBCA" spellcheck="false"></div>
    <div class="field"><label>Untuk target ${qi("Nilai aset ini akan dihitung sebagai progres target yang dipilih.")}</label><select name="goal">${goalOptions(v0.goal)}</select></div>` });
  const sync = () => { const t = svType($("fType").value); $("fPriceWrap").hidden = t.mode === "nominal"; $("fPriceLbl").textContent = (t.price || "Harga per unit") + " sekarang (Rp)"; $("fCgWrap").hidden = t.auto !== "coingecko"; };
  $("fType").onchange = sync; sync();
  const v = await pr; if (!v) return null;
  if (!v.name.trim()) { toast("Nama aset belum diisi", "Contoh: Emas Antam, BBCA, Reksa dana pasar uang.", "danger"); return svAssetForm(a, v); }
  const price = num(v.price);
  const obj = a || { id: uid(), created: Date.now() };
  const code = v.code.trim().toUpperCase();
  Object.assign(obj, { type: v.type, name: v.name.trim(), code, goal: v.goal, tv: (v.tv || "").trim().toUpperCase(), cg: (v.cg || "").trim().toLowerCase() || (svType(v.type).auto === "coingecko" ? (CG_MAP[code] || "") : "") });
  if (price > 0 && price !== +obj.price) { recordPrice(obj, price); obj.priceSrc = "manual"; }
  if (!a) SV().assets.push(obj);
  save(); renderSavings();
  if (svType(obj.type).auto === "coingecko" && obj.cg) { cgLast = 0; svAutoPrices(false); }
  if (!a) { toast("Aset ditambahkan", `${obj.name}. Lanjutkan dengan mencatat pembelian.`, "ok"); svTxForm({ asset: obj.id, kind: "buy" }); }
  return obj;
}
async function svUpdatePrice(a) {
  const t = svType(a.type), hist = (a.prices || []).slice(-6).reverse();
  const histHtml = hist.length ? `<p class="lbl" style="margin:14px 0 6px">Riwayat harga terakhir</p><div class="hist">` + hist.map((x, i) => {
    const prev = hist[i + 1], ch = prev ? (x.p - prev.p) / prev.p * 100 : NaN;
    return `<div><span class="c-muted">${new Date(x.d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span><b class="num">${rp(x.p)}</b><span class="num ${ch >= 0 ? "c-buy" : "c-sell"}">${isFinite(ch) ? (ch >= 0 ? "+" : "") + fmt(ch, 1) + "%" : ""}</span></div>`;
  }).join("") + `</div>` : "";
  const v = await ask({ title: `Harga ${a.name}`, ok: "Simpan harga", body: `<div class="field"><label>${esc(t.price || "Harga per unit")} sekarang (Rp)</label><input name="price" type="number" step="any" class="num" value="${a.price || ""}"></div>
    <div class="field"><label>Tanggal harga</label><input name="date" type="date" value="${todayStr()}"></div>
    <p class="hint">Cek harga di aplikasi tempat Anda membeli (mis. Pegadaian, aplikasi sekuritas, Bibit, Indodax). Setiap pembaruan disimpan sebagai riwayat untuk grafik pertumbuhan.</p>${histHtml}` });
  if (!v) return; const p = num(v.price);
  if (!(p > 0)) { toast("Harga tidak valid", "Isi angka lebih dari 0.", "danger"); return; }
  const t0 = v.date ? new Date(v.date + "T12:00:00").getTime() : Date.now();
  recordPrice(a, p, Math.min(t0, Date.now())); a.priceSrc = "manual"; save(); renderSavings();
}

/* ---------- Transaksi ---------- */
async function svTxForm(preset = {}, editTx) {
  if (!SV().assets.length) { toast("Tambah aset dulu", "Transaksi dicatat untuk aset tertentu."); return svAssetForm(null); }
  const x0 = { asset: SV().assets[0].id, kind: "buy", date: todayStr(), qty: "", price: "", fee: "", amount: "", total: "", note: "", ...(editTx || {}), ...preset };
  if (!x0.price) { const a = svAsset(x0.asset); if (a && a.price) x0.price = a.price; }
  const pr = ask({ title: editTx ? "Ubah transaksi" : "Catat transaksi", ok: "Simpan", body: `
    <div class="row"><div class="field"><label>Aset</label><select name="asset" id="xAsset">${SV().assets.map(a => `<option value="${a.id}" ${a.id === x0.asset ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Jenis transaksi</label><select name="kind" id="xKind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${k === x0.kind ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="field"><label>Tanggal</label><input name="date" type="date" value="${x0.date}"></div>
    <div id="xUnit"><div class="row"><div class="field"><label id="xQtyLbl">Jumlah</label><input name="qty" id="xQty" type="number" step="any" class="num" value="${x0.qty}"></div>
      <div class="field"><label id="xPriceLbl">Harga</label><input name="price" id="xPrice" type="number" step="any" class="num" value="${x0.price}"></div></div>
      <div class="row"><div class="field"><label>Total (Rp)</label><input name="total" id="xTotal" type="number" step="any" class="num" value="${x0.total}" placeholder="isi total untuk menghitung jumlah"></div>
      <div class="field"><label>Biaya / fee (Rp)</label><input name="fee" type="number" step="any" class="num" value="${x0.fee}"></div></div>
      <p class="hint" id="xCalc"></p></div>
    <div class="field" id="xAmtWrap"><label id="xAmtLbl">Nominal (Rp)</label><input name="amount" id="xAmt" type="number" step="any" class="num" value="${x0.amount}"></div>
    <div class="field"><label>Catatan</label><input name="note" type="text" value="${esc(x0.note)}" placeholder="opsional"></div>` });
  const mode = () => { const a = svAsset($("xAsset").value), t = svType(a.type), k = $("xKind").value;
    return { a, t, k, unit: t.mode !== "nominal" && (k === "buy" || k === "sell") }; };
  const sync = () => {
    const m = mode();
    $("xUnit").hidden = !m.unit; $("xAmtWrap").hidden = m.unit;
    $("xAmtLbl").textContent = m.k === "income" ? "Nominal diterima (Rp)" : m.k === "fee" ? "Nominal biaya (Rp)" : m.k === "buy" ? "Nominal disetor (Rp)" : "Nominal ditarik (Rp)";
    $("xQtyLbl").textContent = `Jumlah (${m.t.unit})`; $("xPriceLbl").textContent = (m.t.price || "Harga per unit") + " (Rp)";
    if (m.unit && !$("xPrice").value && m.a.price) $("xPrice").value = m.a.price;
    calc();
  };
  const calc = () => {
    const m = mode(); if (!m.unit) return;
    const q = num($("xQty").value), p = num($("xPrice").value), mult = m.t.mult || 1;
    $("xCalc").textContent = q > 0 && p > 0 ? `${qtyFmt(q, m.t.dec)} ${m.t.unit} × ${rp(p)}${mult !== 1 ? " × " + mult : ""} = ${rp(q * p * mult)}` : (m.t.mult > 1 ? `1 ${m.t.unit} = ${m.t.mult} unit harga` : "");
  };
  $("xAsset").onchange = sync; $("xKind").onchange = sync;
  $("xQty").oninput = () => { const m = mode(), q = num($("xQty").value), p = num($("xPrice").value); if (q > 0 && p > 0) $("xTotal").value = Math.round(q * p * (m.t.mult || 1)); calc(); };
  $("xPrice").oninput = $("xQty").oninput;
  $("xTotal").oninput = () => { const m = mode(), tot = num($("xTotal").value), p = num($("xPrice").value); if (tot > 0 && p > 0) $("xQty").value = +(tot / (p * (m.t.mult || 1))).toFixed(Math.min(8, m.t.dec ?? 4)); calc(); };
  sync();
  const v = await pr; if (!v) return null;
  const a = svAsset(v.asset), t = svType(a.type), unit = t.mode !== "nominal" && (v.kind === "buy" || v.kind === "sell");
  const tx = { id: editTx ? editTx.id : uid(), t: editTx ? editTx.t : Date.now().toString(36), asset: v.asset, kind: v.kind, date: v.date || todayStr(), note: v.note.trim() };
  if (unit) {
    tx.qty = num(v.qty); tx.price = num(v.price); tx.fee = num(v.fee) || 0;
    if (!(tx.qty > 0) || !(tx.price > 0)) { toast("Jumlah dan harga wajib diisi", "Isi jumlah dan harga, atau total dan harga.", "danger"); return svTxForm(v, editTx); }
    if (v.kind === "sell") { const st = assetStats(a); const avail = st.qty + (editTx && editTx.kind === "sell" ? +editTx.qty : 0); if (tx.qty > avail + 1e-9) { toast("Melebihi saldo", `Saldo ${a.name} hanya ${qtyFmt(avail, t.dec)} ${t.unit}.`, "danger"); return svTxForm(v, editTx); } }
    const txT = Math.min(new Date(tx.date + "T12:00:00").getTime(), Date.now());
    if (!a.priceAt || txT >= a.priceAt - 864e5) { recordPrice(a, tx.price, txT); a.priceSrc = "manual"; }
  } else {
    const amt = num(v.amount);
    if (!(amt > 0)) { toast("Nominal wajib diisi", "Isi nominal dalam rupiah.", "danger"); return svTxForm(v, editTx); }
    if (t.mode === "nominal" && (v.kind === "buy" || v.kind === "sell")) { tx.qty = amt; tx.price = 1; tx.fee = 0; }
    else tx.amount = amt;
  }
  if (editTx) Object.assign(editTx, tx); else SV().tx.push(tx);
  save(); renderSavings();
  toast("Transaksi dicatat", `${KIND_LABEL[tx.kind]} · ${a.name}`, "ok");
  return tx;
}
function svRenderTx() {
  const fa = $("svTxAsset").value, fk = $("svTxKind").value;
  $("svTxAsset").innerHTML = `<option value="">Semua aset</option>` + SV().assets.map(a => `<option value="${a.id}" ${a.id === fa ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const list = txSorted().reverse().filter(x => (!fa || x.asset === fa) && (!fk || x.kind === fk));
  if (!list.length) { $("svTxBody").innerHTML = `<tr><td colspan="8" class="empty">Belum ada transaksi.</td></tr>`; return; }
  $("svTxBody").innerHTML = list.map(x => {
    const a = svAsset(x.asset) || { name: "(aset dihapus)", type: "" }, t = svType(a.type), unitTx = x.qty != null && t.mode !== "nominal";
    const total = x.amount != null ? +x.amount : (+x.qty || 0) * (t.mode === "nominal" ? 1 : (t.mult || 1)) * (+x.price || 0);
    const sign = x.kind === "sell" || x.kind === "income" ? "c-buy" : x.kind === "fee" ? "c-sell" : "";
    return `<tr><td class="c-muted">${new Date(x.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
      <td><b>${esc(a.name)}</b></td><td>${KIND_LABEL[x.kind]}</td>
      <td class="num">${unitTx ? qtyFmt(+x.qty, t.dec) + " " + esc(t.unit) : "—"}</td><td class="num">${unitTx ? rp(+x.price) : "—"}</td>
      <td class="num ${sign}">${rp(total)}${+x.fee ? `<br><small class="c-muted">fee ${rp(+x.fee)}</small>` : ""}</td>
      <td class="wrap c-muted">${esc(x.note)}</td>
      <td><div class="actions"><button class="btn sm ghost" data-svx="edit" data-id="${x.id}">Ubah</button><button class="btn sm ghost" data-svx="del" data-id="${x.id}" aria-label="Hapus">✕</button></div></td></tr>`;
  }).join("");
}
$("svTxAsset").addEventListener("change", svRenderTx);
$("svTxKind").addEventListener("change", svRenderTx);
$("svTxBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-svx]"); if (!b) return;
  const x = SV().tx.find(y => y.id === b.dataset.id); if (!x) return;
  if (b.dataset.svx === "edit") return svTxForm({}, x);
  if (await confirmBox("Hapus transaksi?", "Saldo dan perhitungan aset akan dihitung ulang.", "Hapus")) { SV().tx = SV().tx.filter(y => y.id !== x.id); save(); renderSavings(); }
});
$$("[data-svadd]").forEach(b => b.onclick = () => b.dataset.svadd === "asset" ? svAssetForm(null) : b.dataset.svadd === "goal" ? svGoalForm(null) : b.dataset.svadd === "plan" ? svPlanForm(null) : svTxForm({}));
$("svExport").onclick = () => {
  if (!SV().tx.length) { toast("Belum ada transaksi", "Tidak ada data untuk diekspor."); return; }
  const rows = [["tanggal", "aset", "kode", "jenis_aset", "transaksi", "jumlah", "satuan", "harga", "fee", "nominal", "catatan"]];
  txSorted().forEach(x => { const a = svAsset(x.asset) || {}, t = svType(a.type);
    rows.push([x.date, a.name || "", a.code || "", t.name, KIND_LABEL[x.kind], x.qty ?? "", t.unit, x.price ?? "", x.fee ?? "", x.amount ?? "", x.note || ""]); });
  download(`tabungan-${todayStr()}.csv`, "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
};

/* ---------- Target ---------- */
function goalStats(g) {
  const assets = SV().assets.filter(a => a.goal === g.id);
  const cur = assets.reduce((s, a) => s + assetStats(a).value, 0);
  const now = new Date(), dl = g.deadline ? new Date(g.deadline) : null;
  const months = dl ? Math.max(0, (dl.getFullYear() - now.getFullYear()) * 12 + dl.getMonth() - now.getMonth()) : NaN;
  const i = (+g.ret || 0) / 100 / 12;
  let need = NaN;
  if (isFinite(months) && months > 0) {
    const gap = g.target - cur * Math.pow(1 + i, months);
    need = gap <= 0 ? 0 : i > 0 ? gap * i / (Math.pow(1 + i, months) - 1) : gap / months;
  }
  return { cur, pct: g.target > 0 ? cur / g.target * 100 : 0, months, need, assets };
}
function goalCard(g) {
  const s = goalStats(g), done = s.pct >= 100;
  return `<div class="goal" style="--gc:${g.color || "var(--brass)"}"><div class="goal-top"><b>${esc(g.name)}</b><span class="num">${pct(Math.min(s.pct, 999), 0)}</span></div>
    <div class="bar"><i style="width:${clamp(s.pct, 0, 100)}%;background:${g.color || "var(--brass)"}"></i></div>
    <div class="goal-sub"><span class="num">${rp(s.cur)} / ${rp(g.target)}</span><span>${g.deadline ? new Date(g.deadline).toLocaleDateString("id-ID", { month: "short", year: "numeric" }) : "tanpa tenggat"}</span></div>
    <p class="hint">${done ? "🎉 Target tercapai." : isFinite(s.need) ? `Perlu ±<b class="num">${rp(s.need)}</b>/bulan selama ${s.months} bulan${+g.ret ? ` (asumsi imbal hasil ${g.ret}%/tahun)` : ""}.` : g.deadline ? "Tenggat sudah lewat." : "Atur tenggat untuk melihat setoran per bulan."}${s.assets.length ? "" : " Hubungkan aset ke target ini lewat tombol Ubah di tab Aset."}</p></div>`;
}
function svRenderGoals() {
  $("svGoals").innerHTML = SV().goals.length ? SV().goals.map(g => goalCard(g) + `<div class="actions goal-act"><button class="btn sm ghost" data-svg="edit" data-id="${g.id}">Ubah</button><button class="btn sm ghost" data-svg="del" data-id="${g.id}">Hapus</button></div>`).map(h => `<div class="goal-wrap">${h}</div>`).join("")
    : `<p class="empty">Belum ada target. Contoh: Dana darurat Rp30 juta, Umroh 2028, Pendidikan anak.</p>`;
}
$("svGoals").addEventListener("click", async e => {
  const b = e.target.closest("[data-svg]"); if (!b) return;
  const g = SV().goals.find(x => x.id === b.dataset.id); if (!g) return;
  if (b.dataset.svg === "edit") return svGoalForm(g);
  if (await confirmBox(`Hapus target ${g.name}?`, "Aset yang terhubung tidak ikut terhapus.", "Hapus")) {
    SV().goals = SV().goals.filter(x => x.id !== g.id); SV().assets.forEach(a => { if (a.goal === g.id) a.goal = ""; }); save(); renderSavings();
  }
});
const GOAL_COLORS = ["#E0B04B", "#2BC4A0", "#5AA9E6", "#B57BEA", "#F07C8A", "#F2A33A"];
async function svGoalForm(g, preset = {}) {
  const v0 = { name: "", target: "", deadline: "", ret: "", ...(g || {}), ...preset };
  const v = await ask({ title: g ? "Ubah target" : "Target baru", ok: "Simpan", body: `
    <div class="field"><label>Nama target</label><input name="name" type="text" value="${esc(v0.name)}" placeholder="mis. Dana darurat, Umroh 2028"></div>
    <div class="row"><div class="field"><label>Jumlah target (Rp)</label><input name="target" type="number" step="any" class="num" value="${v0.target}"></div>
    <div class="field"><label>Tenggat</label><input name="deadline" type="date" value="${v0.deadline}"></div></div>
    <div class="field"><label>Asumsi imbal hasil per tahun (%, opsional)</label><input name="ret" type="number" step="0.1" class="num" value="${v0.ret}" placeholder="0 = tanpa asumsi"></div>
    <p class="hint">Asumsi hanya untuk perkiraan setoran per bulan, bukan jaminan hasil.</p>` });
  if (!v) return;
  const target = num(v.target);
  if (!v.name.trim() || !(target > 0)) { toast("Lengkapi target", "Isi nama dan jumlah target.", "danger"); return svGoalForm(g, v); }
  const obj = g || { id: uid(), color: GOAL_COLORS[SV().goals.length % GOAL_COLORS.length] };
  Object.assign(obj, { name: v.name.trim(), target, deadline: v.deadline, ret: num(v.ret) || 0 });
  if (!g) SV().goals.push(obj);
  save(); renderSavings();
}

/* ---------- Setoran rutin ---------- */
function planStatus(p) {
  const ym = thisYm(), done = (p.done || []).includes(ym), day = new Date().getDate();
  return done ? "done" : day > p.day ? "late" : day === p.day ? "today" : "soon";
}
function streakText() {
  const plans = SV().plans.filter(p => p.active); if (!plans.length) return "";
  const allDone = ym => plans.every(p => (p.done || []).includes(ym));
  let d = new Date(); d.setDate(1);
  if (!allDone(thisYm())) d.setMonth(d.getMonth() - 1);
  let n = 0;
  while (n < 600) { const ym = d.toISOString().slice(0, 7); if (!allDone(ym)) break; n++; d.setMonth(d.getMonth() - 1); }
  const total = plans.reduce((s, p) => s + (+p.amount || 0), 0);
  return `Rencana ${rp(total)}/bulan · ${n ? `🔥 ${n} bulan berturut-turut konsisten` : "mulai bangun kebiasaan bulan ini"}`;
}
function planRow(p) {
  const a = svAsset(p.asset), s = planStatus(p);
  const lbl = { done: '<span class="pill buy">Sudah</span>', late: '<span class="pill high">Terlewat</span>', today: '<span class="pill med">Hari ini</span>', soon: '<span class="pill neu">Belum</span>' }[s];
  return `<div class="plan-row"><div><b>${esc(a ? a.name : "(aset dihapus)")}</b><small class="c-muted">Tanggal ${p.day} · ${rp(p.amount)}</small></div>${lbl}
    ${s === "done" ? `<button class="btn sm ghost" data-svp="undo" data-id="${p.id}">Batal</button>` : `<button class="btn sm primary" data-svp="do" data-id="${p.id}">Catat</button>`}</div>`;
}
function svRenderPlans() {
  const plans = SV().plans;
  $("svPlanStreak").innerHTML = plans.some(p => p.active) ? streakText() : "";
  $("svPlans").innerHTML = plans.length ? plans.map(p => `<div class="plan-wrap${p.active ? "" : " off"}">${planRow(p)}<div class="actions"><button class="btn sm ghost" data-svp="toggle" data-id="${p.id}">${p.active ? "Jeda" : "Aktifkan"}</button><button class="btn sm ghost" data-svp="edit" data-id="${p.id}">Ubah</button><button class="btn sm ghost" data-svp="del" data-id="${p.id}">Hapus</button></div></div>`).join("")
    : `<p class="empty">Belum ada jadwal. Contoh: beli emas Rp500.000 setiap tanggal 25.</p>`;
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-svp]"); if (!b) return;
  const p = SV().plans.find(x => x.id === b.dataset.id); if (!p) return;
  const act = b.dataset.svp, ym = thisYm();
  if (act === "do") {
    const a = svAsset(p.asset); if (!a) return;
    const t = svType(a.type), price = a.price > 0 ? +a.price : NaN;
    const preset = t.mode === "nominal" ? { asset: a.id, kind: "buy", amount: p.amount, note: "Setoran rutin" }
      : { asset: a.id, kind: "buy", total: p.amount, price: isFinite(price) ? price : "", qty: isFinite(price) ? +(p.amount / (price * (t.mult || 1))).toFixed(Math.min(8, t.dec ?? 4)) : "", note: "Setoran rutin" };
    const tx = await svTxForm(preset);
    if (tx) { p.done = [...new Set([...(p.done || []), ym])]; save(); renderSavings(); }
  }
  if (act === "undo") { p.done = (p.done || []).filter(x => x !== ym); save(); renderSavings(); }
  if (act === "toggle") { p.active = !p.active; save(); renderSavings(); }
  if (act === "edit") svPlanForm(p);
  if (act === "del" && await confirmBox("Hapus jadwal?", "Riwayat transaksi tidak ikut terhapus.", "Hapus")) { SV().plans = SV().plans.filter(x => x.id !== p.id); save(); renderSavings(); }
});
async function svPlanForm(p, preset = {}) {
  if (!SV().assets.length) { toast("Tambah aset dulu", "Jadwal rutin dibuat untuk aset tertentu."); return svAssetForm(null); }
  const v0 = { asset: SV().assets[0].id, amount: "", day: 25, ...(p || {}), ...preset };
  const v = await ask({ title: p ? "Ubah jadwal rutin" : "Jadwal setoran rutin", ok: "Simpan", body: `
    <div class="field"><label>Aset</label><select name="asset">${SV().assets.map(a => `<option value="${a.id}" ${a.id === v0.asset ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="row"><div class="field"><label>Nominal per bulan (Rp)</label><input name="amount" type="number" step="any" class="num" value="${v0.amount}"></div>
    <div class="field"><label>Tanggal setiap bulan (1–28)</label><input name="day" type="number" min="1" max="28" class="num" value="${v0.day}"></div></div>` });
  if (!v) return;
  const amount = num(v.amount), day = Math.round(num(v.day));
  if (!(amount > 0) || !(day >= 1 && day <= 28)) { toast("Periksa isian", "Nominal lebih dari 0 dan tanggal 1–28.", "danger"); return svPlanForm(p, v); }
  const obj = p || { id: uid(), active: true, done: [] };
  Object.assign(obj, { asset: v.asset, amount, day });
  if (!p) SV().plans.push(obj);
  save(); renderSavings();
}
/** Pengingat sekali sehari saat aplikasi dibuka */
function svRemind() {
  const due = SV().plans.filter(p => p.active && ["today", "late"].includes(planStatus(p)));
  if (!due.length) return;
  const key = "svRemind:" + todayStr();
  if (lsGet(key)) return; lsSet(key, "1");
  toast("Setoran rutin", `${due.length} jadwal tabungan perlu dicatat bulan ini. Buka menu Tabungan → Rutin.`, "warn");
}

/* ---------- Proyeksi ---------- */
function svRenderProj() {
  if (!$("pjInit").value) { const P = portfolio(); $("pjInit").value = Math.round(P.value) || 0; $("pjMonthly").value = SV().plans.filter(p => p.active).reduce((s, p) => s + (+p.amount || 0), 0) || 1000000; }
  const init = num($("pjInit").value) || 0, m = num($("pjMonthly").value) || 0, r = (num($("pjRet").value) || 0) / 100, yrs = clamp(Math.round(num($("pjYears").value) || 0), 1, 50), inf = (num($("pjInf").value) || 0) / 100;
  const i = r / 12, val = [init], dep = [init];
  let v = init, d = init;
  for (let k = 1; k <= yrs * 12; k++) { v = v * (1 + i) + m; d += m; if (k % 12 === 0) { val.push(v); dep.push(d); } }
  const real = v / Math.pow(1 + inf, yrs);
  lineChart("pjChart", [{ pts: dep, color: getCss("--muted"), w: 1.5 }, { pts: val, color: getCss("--brass"), w: 2.5, fill: true }], {});
  const k = (l, x, c = "") => `<div class="kpi"><span>${l}</span><b class="num ${c}">${x}</b></div>`;
  $("pjOut").innerHTML = [k(`Perkiraan nilai setelah ${yrs} tahun`, rp(v)), k("Total yang disetor", rp(d)), k("Hasil investasi", rpS(v - d), "c-buy"),
    k(`Daya beli setara hari ini (inflasi ${fmt(inf * 100, 1)}%)`, rp(real))].join("");
}
["pjInit", "pjMonthly", "pjRet", "pjYears", "pjInf"].forEach(id => $(id).addEventListener("input", svRenderProj));
$("pjFromData").onclick = () => { $("pjInit").value = ""; svRenderProj(); };

/* ---------- Jenis instrumen & alokasi ---------- */
function svRenderTypes() {
  $("svTypeBody").innerHTML = SV().types.map((t, i) => `<tr data-i="${i}">
    <td><input type="color" data-k="color" value="${t.color}" aria-label="Warna"></td>
    <td><input type="text" data-k="name" value="${esc(t.name)}" aria-label="Nama"></td>
    <td><input type="text" data-k="unit" value="${esc(t.unit)}" aria-label="Satuan"></td>
    <td><select data-k="mode" aria-label="Cara hitung"><option value="unit" ${t.mode === "unit" ? "selected" : ""}>Jumlah × harga</option><option value="nominal" ${t.mode === "nominal" ? "selected" : ""}>Nominal Rp</option></select></td>
    <td><input type="number" data-k="mult" value="${t.mult || 1}" step="any" class="num" aria-label="Pengali" ${t.mode === "nominal" ? "disabled" : ""}></td>
    <td><input type="text" data-k="price" value="${esc(t.price || "")}" aria-label="Label harga" ${t.mode === "nominal" ? "disabled" : ""}></td>
    <td><select data-k="auto" aria-label="Harga otomatis" ${t.mode === "nominal" ? "disabled" : ""}><option value="" ${!t.auto ? "selected" : ""}>Manual</option><option value="coingecko" ${t.auto === "coingecko" ? "selected" : ""}>CoinGecko (kripto)</option></select></td>
    <td><input type="number" data-k="target" value="${t.target || 0}" step="1" class="num" aria-label="Target alokasi %"></td>
    <td><button class="btn sm ghost" data-svt="${i}" aria-label="Hapus jenis">✕</button></td></tr>`).join("");
  const tot = SV().types.reduce((s, t) => s + (+t.target || 0), 0);
  $("svTypeHint").innerHTML = tot ? `Total target alokasi: <b class="num ${tot === 100 ? "c-buy" : "c-warn"}">${tot}%</b>${tot === 100 ? "" : " (sebaiknya 100%)"}` : "Isi kolom Target % jika ingin membandingkan alokasi aktual dengan rencana.";
  // Perbandingan alokasi
  const P = portfolio(), rows = SV().types.filter(t => (+t.target || 0) > 0 || (P.byType[t.id] || 0) > 0);
  $("svRebal").innerHTML = !P.value ? `<p class="empty">Perbandingan muncul setelah ada aset bernilai.</p>` : rows.map(t => {
    const act = (P.byType[t.id] || 0) / P.value * 100, tg = +t.target || 0, diff = tg ? (tg - act) / 100 * P.value : 0;
    return `<div class="rebal"><div class="rebal-top"><span><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</span><span class="num">${pct(act, 1)}${tg ? ` / target ${tg}%` : ""}</span></div>
      <div class="rebal-bar"><i style="width:${clamp(act, 0, 100)}%;background:${t.color}"></i>${tg ? `<b style="left:${clamp(tg, 0, 100)}%"></b>` : ""}</div>
      ${tg && Math.abs(act - tg) >= 5 ? `<small class="${diff > 0 ? "c-buy" : "c-warn"}">${diff > 0 ? "Kurang" : "Lebih"} ±${rp(Math.abs(diff))} dari target</small>` : ""}</div>`;
  }).join("");
}
$("svTypeBody").addEventListener("change", e => {
  const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
  const t = SV().types[+tr.dataset.i];
  t[k] = ["mult", "target"].includes(k) ? num(e.target.value) || 0 : e.target.value;
  if (k === "mode") svRenderTypes();
});
$("svTypeBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-svt]"); if (!b) return;
  const t = SV().types[+b.dataset.svt], used = SV().assets.some(a => a.type === t.id);
  if (used) { toast("Jenis masih dipakai", `Masih ada aset berjenis ${t.name}. Pindahkan atau hapus asetnya dulu.`, "danger"); return; }
  if (await confirmBox(`Hapus jenis ${t.name}?`, "Jenis ini akan hilang dari pilihan.", "Hapus")) { SV().types.splice(+b.dataset.svt, 1); save(); svRenderTypes(); }
});
$("svAddType").onclick = () => { SV().types.push({ id: "t" + uid(), name: "Jenis baru", unit: "unit", mult: 1, mode: "unit", dec: 4, color: "#7FD1D9", price: "Harga per unit", target: 0 }); svRenderTypes(); };
$("svSaveTypes").onclick = () => {
  const bad = SV().types.find(t => !t.name.trim() || !t.unit.trim() || (t.mode === "unit" && !(t.mult > 0)));
  if (bad) { toast("Periksa jenis instrumen", "Nama, satuan, dan pengali harus terisi.", "danger"); return; }
  save(); renderSavings(); toast("Jenis instrumen disimpan", "Perubahan berlaku untuk semua aset.", "ok");
};

/* ---------- Ruang: Trading, Investasi, Keuangan ---------- */
const NAV_GROUP = { market: "trade", dash: "trade", pos: "trade", journal: "trade", stats: "trade", tools: "trade", news: "trade", save: "invest", fin: "fin", settings: "all" };
const SPACE_FIRST = { trade: "dash", invest: "save", fin: "fin" };
/** Ruang yang diaktifkan pengguna (minimal satu). */
function enabledSpaces() {
  let sp = S.settings.spaces;
  if (!Array.isArray(sp) || !sp.length) { const m = S.settings.menu || "all"; sp = m === "trade" ? ["trade"] : m === "save" ? ["invest"] : ["trade", "invest", "fin"]; }
  return ["trade", "invest", "fin"].filter(x => sp.includes(x));
}
function curSpace() { const en = enabledSpaces(); return en.includes(S.settings.space) ? S.settings.space : en[0]; }
function applyMenu() {
  const en = enabledSpaces(), sp = curSpace();
  $$(".nav-btn").forEach(b => { const g = NAV_GROUP[b.dataset.view]; b.hidden = !(g === "all" || g === sp); });
  $$(".nav-label").forEach(l => l.hidden = l.dataset.group !== sp);
  $$(".space-switch").forEach(w => { w.hidden = en.length < 2; w.style.gridTemplateColumns = `repeat(${en.length},1fr)`; w.classList.toggle("three", en.length >= 3); });
  $$(".space-switch [data-space]").forEach(b => { b.hidden = !en.includes(b.dataset.space); b.classList.toggle("on", b.dataset.space === sp); });
  document.body.dataset.space = sp; document.body.dataset.menu = en.join(" ");
}
function setSpace(sp, silent) {
  if (!enabledSpaces().includes(sp)) { applyMenu(); return; }
  if (S.settings.space !== sp) { S.settings.space = sp; save({ noSync: true }); }
  applyMenu();
  if (!silent) go(firstView());
}
function firstView() { return SPACE_FIRST[curSpace()]; }
document.addEventListener("click", e => { const b = e.target.closest(".space-switch [data-space]"); if (b) setSpace(b.dataset.space); });
document.addEventListener("click", e => { const b = e.target.closest("[data-sv-go]"); if (b) { svTab = b.dataset.svGo; renderSavings(); } });

/* ================================================================
 * 17. BANTUAN KONTEKSTUAL: tooltip, ikon "?", dan kartu cara pakai
 * ================================================================ */
const NAV_TIPS = {
  market: "Harga & grafik live dari TradingView: indeks, forex, emas, kripto, saham IDX, dan kalender ekonomi.",
  dash: "Rencanakan entry: isi pair, lot, entry, SL, TP. Lihat rugi/untung dan total risiko semua SL sebelum membuka posisi di MT5.",
  pos: "Posisi & pending order: dari kalkulator (manual) dan otomatis dari MT5. Tutup posisi manual di sini agar tercatat di jurnal.",
  journal: "Riwayat trade yang sudah ditutup. Tambahkan setup, emosi, dan pelajaran, atau import laporan History dari MT5.",
  stats: "Evaluasi performa: win rate, profit factor, drawdown, serta pola per pair, sesi, hari, setup, dan emosi.",
  tools: "Simulasi partial close & break-even, dan simulasi pertumbuhan modal.",
  news: "Jadwal berita ekonomi. Entry yang terlalu dekat jadwal berita akan diberi peringatan.",
  "sv-sum": "Gambaran semua tabungan: total nilai, untung/rugi, alokasi, pertumbuhan, target, dan setoran bulan ini.",
  "sv-assets": "Daftar tabungan Anda. Mulai dari sini: Tambah aset, catat pembelian, dan perbarui harga.",
  "sv-tx": "Semua beli, jual, dividen/kupon/bunga, dan biaya. Ubah atau hapus jika salah catat.",
  "sv-goals": "Tujuan menabung (mis. Umroh 2028) dan berapa yang perlu disetor per bulan.",
  "sv-plans": "Jadwal menabung bulanan. Klik Catat setelah membeli agar rekor konsistensi bertambah.",
  "sv-proj": "Perkirakan nilai tabungan di masa depan dari setoran rutin dan asumsi imbal hasil.",
  "sv-types": "Atur jenis instrumen (tambah deposito, obligasi, dll.), harga otomatis, dan target porsi tiap jenis.",
  "fn-sum": "Gambaran arus kas: saldo rekening, pemasukan & pengeluaran bulan ini, tren 12 bulan, dan kategori terbesar.",
  "fn-tx": "Semua transaksi bank & tunai. Import PDF e-statement, catat manual, dan koreksi kategori (aplikasi belajar dari koreksi Anda).",
  "fn-pat": "Pola pengeluaran: kategori yang naik/turun, transaksi rutin, hari & tanggal paling boros, rasio menabung.",
  "fn-proj": "Perkiraan saldo akhir bulan dan beberapa bulan ke depan, serta tagihan rutin yang belum dibayar.",
  "fn-plan": "Hitung berapa yang aman untuk dana darurat, ditabung/investasi, dan modal trading berdasarkan aturan Anda.",
  "fn-set": "Kelola rekening, saldo awal, kategori, dan kata kunci untuk kategori otomatis.",
  settings: "Akun, batas risiko, biaya, simbol, akun cloud, backup, dan PIN."
};

const HELP = {
  market: { t: "Cara pakai Pasar", s: ["Pita harga di atas menampilkan **daftar pantauan** Anda (ubah di bagian paling bawah).", "Klik nama simbol untuk membuka grafiknya, atau **Pair di kalkulator** untuk grafik pair yang sedang Anda rencanakan.", "Data dari TradingView hanya untuk dilihat. Untuk entry, tetap cek harga di MT5 karena harga broker bisa sedikit berbeda."] },
  dash: { t: "Cara pakai Dashboard", s: ["Pilih **pair**, **Buy/Sell**, dan jenis order.", "Isi **lot**, **entry**, **SL**, **TP**. Bisa juga isi SL/TP dalam pip, harganya dihitung otomatis.", "Baca tiket di kanan: rugi jika kena SL, untung jika kena TP, dan checklist aturan.", "Klik **Tambahkan ke posisi** agar ikut dijumlahkan di meter. Garis merah di meter = batas total risiko (bawaan 25% modal)."] },
  pos: { t: "Cara pakai Posisi", s: ["Posisi manual: tutup dengan tombol **TP**, **SL**, atau **Harga lain** agar tercatat di Jurnal.", "Pending manual (Limit/Stop): klik **Terisi** saat tereksekusi, atau **Batal**.", "Bagian **Posisi live** terisi otomatis jika EA RiskDesk Bridge terpasang di MT5."] },
  journal: { t: "Cara pakai Jurnal", s: ["Klik **Ubah** pada baris untuk menambah setup, emosi, dan pelajaran.", "**Import laporan MT5**: di MT5 buka History → klik kanan → Report → HTML, lalu pilih filenya.", "**Ekspor CSV** untuk dibuka di Excel atau Google Sheets."] },
  stats: { t: "Cara pakai Analitik", s: ["Pilih periode di kanan atas.", "Baca **Temuan utama** untuk pola penting.", "Kumpulkan 20–30 trade agar pola mulai bermakna."] },
  tools: { t: "Cara pakai Alat", s: ["**Partial close** memakai rencana entry di Dashboard. Atur target 1, persentase ditutup, dan ke mana SL digeser.", "**Simulasi** mengulang 1.000 urutan trade acak. Klik *Pakai statistik jurnal* untuk memakai angka Anda sendiri."] },
  news: { t: "Cara pakai Berita", s: ["Klik **Ambil kalender minggu ini otomatis**, atau tambah manual dari ForexFactory.", "Saat merencanakan entry pada pair terkait dekat jadwal berita, checklist memberi peringatan merah."] },
  "sv-sum": { t: "Cara pakai Ringkasan", s: ["Belum ada data? Klik **Tambah aset**, lalu catat pembelian pertama.", "Perbarui harga secara berkala di menu **Aset** agar nilai akurat. Harga kripto terbarui otomatis.", "Arahkan kursor (atau ketuk **?**) pada tiap angka untuk penjelasannya."] },
  "sv-assets": { t: "Cara pakai Aset", s: ["**Tambah aset**: satu aset untuk tiap tabungan, mis. *Emas Antam*, *BBCA*, *ORI025*, *Bitcoin*.", "**Transaksi**: catat pembelian/penjualan aset tersebut.", "**Harga**: isi harga terbaru. Setiap pembaruan tersimpan sebagai riwayat dan dipakai di grafik.", "**Ubah**: ganti nama atau hubungkan aset ke target."] },
  "sv-tx": { t: "Cara pakai Transaksi", s: ["Klik **Catat transaksi**, pilih aset dan jenis transaksi.", "Untuk pembelian, cukup isi **Total (Rp)** dan **Harga**. Jumlah gram/lot/unit dihitung otomatis.", "Dividen, kupon SBN, dan bunga dicatat sebagai **Dividen / kupon / bunga**."] },
  "sv-goals": { t: "Cara pakai Target", s: ["Klik **Tambah target**: isi nama, nominal, dan tenggat.", "Buka **Aset → Ubah** dan pilih target untuk aset yang dialokasikan.", "Kartu target menghitung perkiraan setoran per bulan."] },
  "sv-plans": { t: "Cara pakai Setoran rutin", s: ["Klik **Tambah jadwal**, mis. Emas Rp500.000 setiap tanggal 25.", "Setelah benar-benar membeli, klik **Catat**. Transaksi tercatat dan status menjadi *Sudah*.", "Lewat tanggal tapi belum dicatat? Statusnya *Terlewat*."] },
  "sv-proj": { t: "Cara pakai Proyeksi", s: ["Isi saldo awal, setoran per bulan, imbal hasil, lama, dan inflasi.", "Klik **Pakai data tabungan** untuk mengisi otomatis dari data Anda.", "Hasilnya perkiraan, bukan jaminan."] },
  "sv-types": { t: "Cara pakai Jenis & alokasi", s: ["**Tambah jenis** untuk instrumen lain (deposito, obligasi, P2P, properti).", "**Cara hitung**: *Nominal Rp* untuk yang dihitung dari nominal; *Jumlah × harga* untuk yang punya harga per unit.", "**Pengali**: unit harga per satuan, mis. 1 lot saham = 100 lembar.", "**Harga otomatis** CoinGecko untuk kripto. **Target %** untuk membandingkan porsi aktual dengan rencana."] },
  "fn-sum": { t: "Cara pakai Keuangan", s: ["Klik **Import mutasi** dan pilih PDF e-statement, Excel (.xlsx/.xls), atau CSV dari bank (Mandiri, BRI, BNI, Jago, SeaBank, blu, dll.). Bisa beberapa file sekaligus.", "Periksa hasil bacaan, koreksi bila perlu, lalu **Simpan**. Saldo rekening ikut diperbarui.", "Untuk uang tunai atau transaksi lain, klik **Catat manual**.", "Lanjut ke **Alokasi dana** untuk melihat berapa yang aman ditabung dan dipakai trading."] },
  "fn-tx": { t: "Cara pakai Transaksi", s: ["Ubah kategori langsung dari kolom **Kategori**. Transaksi serupa ikut berubah dan import berikutnya otomatis memakai kategori itu.", "Baris kuning bertanda **cek** artinya arah masuk/keluar tidak pasti: klik **⇄** jika terbalik.", "**Pindah dana** (ke investasi, trading, rekening sendiri) tidak dihitung sebagai pengeluaran."] },
  "fn-pat": { t: "Cara pakai Pola", s: ["**Naik/turun** membandingkan bulan ini dengan rata-rata 3 bulan sebelumnya.", "**Transaksi rutin** terdeteksi otomatis setelah ada data minimal 3 bulan.", "Pakai temuan ini untuk memilih pengeluaran yang bisa ditekan."] },
  "fn-proj": { t: "Cara pakai Proyeksi", s: ["Atur berapa bulan ke depan yang ingin dilihat.", "Perkiraan memakai rata-rata bulan-bulan terakhir (atur jumlah bulan di menu Alokasi dana).", "Tagihan rutin yang biasanya muncul tapi belum terbayar bulan ini ditampilkan sebagai pengingat."] },
  "fn-plan": { t: "Cara pakai Alokasi dana", s: ["Pilih template **Konservatif**, **Seimbang**, atau **Agresif**, lalu sesuaikan angkanya.", "Surplus bulanan dibagi berurutan: **dana darurat** dulu sampai target, lalu sisanya ke **investasi** dan **trading** sesuai persentase.", "Trading otomatis 0 jika dana darurat < 1 bulan atau porsi modal trading melewati batas.", "Ini hitungan dari aturan Anda sendiri, bukan saran investasi."] },
  "fn-set": { t: "Cara pakai Kategori & rekening", s: ["Atur **saldo** rekening per tanggal tertentu jika belum ada dari import.", "Tambahkan **kata kunci** (pisahkan koma) agar transaksi masuk kategori yang tepat, mis. nama toko langganan.", "Masukkan nama Anda sendiri sebagai kata kunci **Antar rekening sendiri** agar transfer ke rekening sendiri tidak dihitung pengeluaran."] },
  settings: { t: "Cara pakai Pengaturan", s: ["Ubah modal, batas risiko, dan ruang yang tersedia di tab **Akun & risiko**.", "Daftar atau masuk akun cloud di tab **Cloud & MT5**.", "Unduh backup dan ganti PIN di tab **Data & keamanan**."] }
};

/* ---------- Tooltip mengambang ---------- */
const tipBox = document.createElement("div");
tipBox.className = "tipbox"; tipBox.setAttribute("role", "tooltip"); tipBox.hidden = true;
document.body.appendChild(tipBox);
let tipFor = null;
function showTip(el) {
  const txt = el.dataset.tip; if (!txt) return;
  tipFor = el; tipBox.textContent = txt; tipBox.hidden = false;
  const r = el.getBoundingClientRect(), bw = Math.min(300, window.innerWidth - 24);
  tipBox.style.maxWidth = bw + "px";
  const h = tipBox.offsetHeight, w = tipBox.offsetWidth;
  let left = r.left + r.width / 2 - w / 2;
  left = clamp(left, 12, window.innerWidth - w - 12);
  let top = r.bottom + 8;
  if (el.closest(".nav") && window.innerWidth > 900) { left = r.right + 10; top = r.top + r.height / 2 - h / 2; }
  else if (top + h > window.innerHeight - 8) top = r.top - h - 8;
  tipBox.style.left = left + "px"; tipBox.style.top = Math.max(8, top) + "px";
}
function hideTip() { tipBox.hidden = true; tipFor = null; }
const canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
document.addEventListener("mouseover", e => { if (!canHover) return; const el = e.target.closest("[data-tip]"); if (el && el !== tipFor) showTip(el); else if (!el && tipFor) hideTip(); });
document.addEventListener("focusin", e => { const el = e.target.closest("[data-tip]"); if (el && canHover) showTip(el); });
document.addEventListener("focusout", hideTip);
document.addEventListener("scroll", hideTip, true);
// Ikon "?" bisa diketuk (HP)
document.addEventListener("click", e => {
  const q = e.target.closest(".q");
  if (q) { e.preventDefault(); e.stopPropagation(); tipFor === q && !tipBox.hidden ? hideTip() : showTip(q); return; }
  if (!tipBox.hidden && !canHover) hideTip();
}, true);
const qi = tip => `<span class="q" tabindex="0" role="button" aria-label="Penjelasan" data-tip="${esc(tip)}">?</span>`;

/* ---------- Kartu "cara pakai" per halaman ---------- */
function helpKey() { return curView === "save" ? svTab : curView === "fin" ? fnTab : curView; }
function renderHelp(force) {
  const key = helpKey(), h = HELP[key];
  $$(".help-slot").forEach(s => s.innerHTML = "");
  if (!h) return;
  const off = S.settings.helpOff || [];
  if (off.includes(key) && !force) return;
  const slot = $$(".help-slot").find(s => s.dataset.help === key);
  if (!slot) return;
  slot.innerHTML = `<div class="help-card"><div class="help-head"><b>💡 ${esc(h.t)}</b><button class="btn sm ghost" type="button" data-help-close="${key}">Mengerti, sembunyikan</button></div>
    <ol>${h.s.map(x => `<li>${md(x)}</li>`).join("")}</ol></div>`;
}
// markdown mini untuk teks bantuan
function md(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>"); }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-help-close]"); if (!b) return;
  S.settings.helpOff = [...new Set([...(S.settings.helpOff || []), b.dataset.helpClose])];
  save({ noSync: true }); renderHelp();
  toast("Panduan disembunyikan", "Klik tombol ? di kanan atas untuk menampilkannya lagi.");
});
$("helpBtn").onclick = () => {
  const key = helpKey(), off = S.settings.helpOff || [];
  if (off.includes(key)) { S.settings.helpOff = off.filter(k => k !== key); save({ noSync: true }); }
  renderHelp(true);
  const card = document.querySelector(".help-card"); if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
};
$("helpReset").onclick = () => { S.settings.helpOff = []; save({ noSync: true }); toast("Panduan singkat aktif lagi", "Kartu cara pakai akan tampil di setiap halaman.", "ok"); };

function applyNavTips() {
  $$(".nav-btn").forEach(b => { const k = b.dataset.sub || b.dataset.view; if (NAV_TIPS[k]) b.dataset.tip = NAV_TIPS[k]; });
}

/* ================================================================
 * 18. PEMBACA MUTASI BANK (PDF e-statement / teks)
 *     Bekerja di browser. Heuristik umum agar cocok untuk banyak bank:
 *     baris diawali tanggal = transaksi; kolom Debit/Kredit/Saldo dibaca
 *     dari posisi header; arah juga dicek dari selisih saldo.
 * ================================================================ */
const MON_IDX = { jan:1, feb:2, mar:3, apr:4, mei:5, may:5, jun:6, jul:7, agu:8, agt:8, ags:8, aug:8, sep:9, okt:10, oct:10, nov:11, des:12, dec:12 };
const RX_DATES = [
  { re: /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?!\d)/, f: m => [+m[3], +m[2], +m[1]] },
  { re: /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?!\d)/, f: m => [+m[1], +m[2], +m[3]] },
  { re: /^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})(?!\d)/, f: m => [+m[3], MON_IDX[m[2].slice(0, 3).toLowerCase()], +m[1]] },
  { re: /^(\d{1,2})[\s\-]([A-Za-z]{3,9})(?![A-Za-z])(?!\s*\d)/, f: m => [null, MON_IDX[m[2].slice(0, 3).toLowerCase()], +m[1]] },
  { re: /^(\d{1,2})[\/\-](\d{1,2})(?![\/\-.\d])/, f: m => [null, +m[2], +m[1]] }
];
function parseDateStart(s, defYear) {
  const t = String(s).trim().replace(/^\d{1,4}[.)]?\s+(?=\d{1,2}[\/\-.\s])/, ""); // buang nomor urut di depan
  const off = String(s).trim().length - t.length;
  for (const d of RX_DATES) {
    const m = t.match(d.re); if (!m) continue;
    let [y, mo, da] = d.f(m);
    if (!mo || mo < 1 || mo > 12 || !(da >= 1 && da <= 31)) continue;
    if (y === null) { if (!defYear) continue; y = defYear; }
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100) continue;
    return { iso: `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, len: off + m[0].length, full: d.f(m)[0] !== null };
  }
  return null;
}
const RX_AMT_ITEM = /^([+\-−]?)\s*\(?\s*(?:Rp\.?|IDR)?\s*([+\-−]?)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})\s*\)?\s*(CR|DB|DR|Cr|Db|Dr|K|D)?\.?$/;
const RX_AMT_TEXT = /(?:^|\s)([+\-−]?\(?(?:Rp\.?\s?|IDR\s?)?[+\-−]?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})\)?(?:\s?(?:CR|DB|DR|K|D)\b)?)(?=\s|$)/g;
function parseAmt(str) {
  const raw = String(str).trim(), m = raw.match(RX_AMT_ITEM); if (!m) return null;
  const sign = (m[1] || m[2] || "").replace("−", "-"), n = m[3];
  const last = Math.max(n.lastIndexOf("."), n.lastIndexOf(",")), tail = last >= 0 ? n.length - last - 1 : 0;
  const v = last >= 0 && tail <= 2 ? parseFloat(n.slice(0, last).replace(/[.,]/g, "") + "." + n.slice(last + 1)) : parseFloat(n.replace(/[.,]/g, ""));
  const mk = (m[4] || "").toUpperCase(), paren = raw.includes("(") && raw.includes(")");
  let dir = 0;
  if (sign === "-" || paren || mk === "DB" || mk === "DR" || mk === "D") dir = -1;
  else if (sign === "+" || mk === "CR" || mk === "K") dir = 1;
  return isFinite(v) ? { v, dir, raw } : null;
}
/** Kelompokkan item teks PDF menjadi baris (per halaman). items: {s, x, y, w} */
function groupLines(items, tol = 2.6) {
  const rows = [];
  [...items].filter(i => i.s && i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => {
    let r = rows.find(r => Math.abs(r.y - it.y) <= tol);
    if (!r) { r = { y: it.y, items: [] }; rows.push(r); }
    r.items.push(it);
  });
  rows.sort((a, b) => b.y - a.y);
  rows.forEach(r => { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map(i => i.s.trim()).join(" ").replace(/\s+/g, " ").trim(); });
  return rows;
}
const HDR = {
  debit: /^(debit|debet|db|dr|keluar|uang keluar|withdrawal|withdrawals|pengeluaran|mutasi debet|mutasi debit|debit amount|penarikan)$/i,
  credit: /^(kredit|credit|cr|masuk|uang masuk|deposit|deposits|pemasukan|mutasi kredit|credit amount|setoran)$/i,
  balance: /^(saldo|balance|saldo akhir|running balance|ending balance)$/i,
  amount: /^(nominal|jumlah|amount|mutasi|nilai|transaksi \(rp\)|jumlah \(idr\))$/i,
  dk: /^(d\/k|db\/cr|dr\/cr|d\/c|tipe|type|jenis)$/i
};
const RX_SKIP = /^(saldo akhir|saldo awal|total|jumlah mutasi|mutasi debet|mutasi kredit|halaman|page|catatan|note|opening balance|closing balance|ending balance|beginning balance|saldo sebelumnya|periode|period|no\. rekening|nomor rekening|account)/i;
const RX_OPEN = /(saldo awal|opening balance|beginning balance|saldo sebelumnya|previous balance)/i;
const RX_CLOSE = /(saldo akhir|closing balance|ending balance)/i;
const RX_IN = /\b(CR|KREDIT|MASUK|INCOMING|TERIMA|DITERIMA|GAJI|PAYROLL|SALARY|BUNGA|INTEREST|REFUND|CASHBACK|SETOR|SETORAN|TRANSFER DARI|TRF DARI|TRSF DARI|DARI|RECEIVED)\b/i;
const RX_OUT = /\b(DB|DR|DEBET|DEBIT|BAYAR|PEMBAYARAN|PAYMENT|PURCHASE|PEMBELIAN|BELI|TARIK|BIAYA|ADM|ADMIN|TRANSFER KE|TRF KE|TRSF KE|KE|TOPUP|TOP UP|QRIS)\b/i;
const BANKS = [[/bank mandiri|\bmandiri\b|livin/i, "Mandiri"], [/rakyat indonesia|\bBRI\b|brimo/i, "BRI"], [/negara indonesia|\bBNI\b|wondr/i, "BNI"],
  [/\bjago\b/i, "Jago"], [/seabank/i, "SeaBank"], [/\bblu\b|bca digital/i, "blu"], [/central asia|\bBCA\b|klikbca|mybca/i, "BCA"],
  [/syariah indonesia|\bBSI\b/i, "BSI"], [/permata/i, "Permata"], [/\bcimb/i, "CIMB Niaga"], [/danamon/i, "Danamon"], [/\bocbc/i, "OCBC"], [/allo bank/i, "Allo"], [/superbank/i, "Superbank"], [/neo ?bank|neo commerce/i, "Neobank"]];

/**
 * Baca mutasi dari halaman-halaman berisi baris (hasil groupLines).
 * Hasil: { bank, txs:[{date, desc, amount(+masuk/−keluar), bal, unsure}], openBal, closeBal, from, to }
 */
function parseStatement(pages) {
  const all = []; pages.forEach((rows, pi) => rows.forEach(r => all.push({ ...r, page: pi })));
  const fullText = all.map(r => r.text).join("\n");
  // Nama bank: utamakan bagian atas halaman pertama (kop surat), baru seluruh teks
  const p0 = pages[0] || [], firstTx = p0.findIndex(r => parseDateStart(r.text, 2000) && !/periode|period/i.test(r.text));
  const headText = p0.slice(0, firstTx > 0 ? Math.min(firstTx, 12) : 6).map(r => r.text).join("\n");
  const bank = (BANKS.find(([re]) => re.test(headText)) || BANKS.find(([re]) => re.test(fullText)) || [null, ""])[1];
  // Tahun bawaan untuk tanggal tanpa tahun
  const yrs = {}; all.forEach(r => { const d = parseDateStart(r.text, null); if (d && d.full) { const y = d.iso.slice(0, 4); yrs[y] = (yrs[y] || 0) + 1; } });
  let defYear = +Object.keys(yrs).sort((a, b) => yrs[b] - yrs[a])[0] || 0;
  if (!defYear) { const m = fullText.match(/\b(20\d{2})\b/); defYear = m ? +m[1] : new Date().getFullYear(); }

  let cols = null, openBal = NaN, closeBal = NaN;
  const blocks = []; let cur = null;
  const amtItems = r => r.items.map(it => { const a = parseAmt(it.s); return a ? { ...a, cx: it.x + (it.w || 0) / 2, rx: it.x + (it.w || 0) } : null; }).filter(Boolean);
  const markerOf = r => { const it = r.items.find(i => /^(D|K|DB|CR|DR|C)$/i.test(i.s.trim())); return it ? (/^(K|CR|C)$/i.test(it.s.trim()) ? 1 : -1) : 0; };
  all.forEach(r => {
    // Header kolom
    const roles = {};
    r.items.forEach(it => { const t = it.s.trim(); for (const k in HDR) if (HDR[k].test(t)) roles[k] = it.x + (it.w || 0) / 2; });
    const nRoles = Object.keys(roles).length;
    if (nRoles >= 2 && (roles.balance || roles.debit || roles.credit || roles.amount)) { cols = roles; cur = null; return; }
    const d = parseDateStart(r.text, defYear);
    if (RX_OPEN.test(r.text) && !d) { const a = amtItems(r); if (a.length) openBal = a[a.length - 1].v; return; }
    if (RX_CLOSE.test(r.text) && !d) { const a = amtItems(r); if (a.length) closeBal = a[a.length - 1].v; cur = null; return; }
    if (d) { cur = { date: d.iso, dlen: d.len, rows: [r], page: r.page, y: r.y }; blocks.push(cur); return; }
    if (cur && !RX_SKIP.test(r.text) && r.page === cur.page && cur.rows.length < 6 && Math.abs(cur.rows[cur.rows.length - 1].y - r.y) < 30 && r.text.length < 160) cur.rows.push(r);
    else cur = null;
  });

  const txs = [];
  blocks.forEach(b => {
    let amts = []; b.rows.forEach(r => amts.push(...amtItems(r)));
    const text = b.rows.map(r => r.text).join(" ");
    if (!amts.length) { // satu item berisi seluruh baris: cari angka di teks
      let m; RX_AMT_TEXT.lastIndex = 0;
      while ((m = RX_AMT_TEXT.exec(text))) { const a = parseAmt(m[1]); if (a) amts.push({ ...a, cx: NaN }); }
    }
    if (!amts.length) return;
    let amt = NaN, dir = 0, bal = NaN;
    if (cols && amts.some(a => isFinite(a.cx))) {
      const near = a => { let best = null, bd = Infinity; for (const k of ["debit", "credit", "balance", "amount"]) if (cols[k] !== undefined) { const dd = Math.abs(cols[k] - a.cx); if (dd < bd) { bd = dd; best = k; } } return best; };
      amts.forEach(a => a.role = near(a));
      const db = amts.find(a => a.role === "debit" && a.v > 0), cr = amts.find(a => a.role === "credit" && a.v > 0);
      const bl = amts.filter(a => a.role === "balance").pop(), am = amts.find(a => a.role === "amount" && a.v > 0);
      if (bl) bal = bl.v * (bl.dir === -1 ? -1 : 1);
      if (db && !cr) { amt = db.v; dir = -1; }
      else if (cr && !db) { amt = cr.v; dir = 1; }
      else if (am) { amt = am.v; dir = am.dir || b.rows.map(markerOf).find(x => x) || 0; }
    }
    if (!isFinite(amt)) {
      const nz = amts.filter(a => a.v > 0);
      if (nz.length >= 2) { const bl = nz[nz.length - 1]; bal = bl.v; amt = nz[0].v; dir = nz[0].dir; }
      else if (nz.length === 1) { amt = nz[0].v; dir = nz[0].dir; }
      if (!dir) dir = b.rows.map(markerOf).find(x => x) || 0;
    }
    if (!(amt > 0)) return;
    let desc = text.slice(b.dlen).replace(RX_AMT_TEXT, " ").replace(/\b\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\b/g, " ")
      .replace(/(?:^|\s)(D|K|DB|CR|DR)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
    if (RX_OPEN.test(desc)) { if (isFinite(bal)) openBal = bal; else openBal = amt; return; }
    if (RX_CLOSE.test(desc)) { closeBal = isFinite(bal) ? bal : amt; return; }
    txs.push({ date: b.date, desc: desc || "(tanpa keterangan)", amt, dir, bal, unsure: false });
  });

  return finalizeTxs(txs, openBal, closeBal, bank);
}
/** Urutkan kronologis, pastikan arah dari selisih saldo, dan susun hasil akhir. txs: {date, desc, amt, dir, bal} */
function finalizeTxs(txs, openBal, closeBal, bank) {
  // Urutan kronologis (sebagian aplikasi menampilkan terbaru di atas)
  let desc = 0, asc = 0;
  for (let i = 1; i < txs.length; i++) { if (txs[i].date < txs[i - 1].date) desc++; else if (txs[i].date > txs[i - 1].date) asc++; }
  if (desc > asc) txs.reverse();
  // Arah dari selisih saldo
  let prev = openBal;
  if (!isFinite(prev) && txs[0] && isFinite(txs[0].bal) && txs[0].dir) prev = txs[0].bal - txs[0].dir * txs[0].amt;
  txs.forEach((t, i) => {
    if (isFinite(t.bal) && isFinite(prev)) {
      const diff = t.bal - prev;
      // Selisih saldo paling bisa dipercaya: jika cocok persis, pakai arahnya
      if (Math.abs(Math.abs(diff) - t.amt) < 1) { if (t.dir && t.dir !== Math.sign(diff)) t.unsure = true; t.dir = Math.sign(diff); }
    }
    if (!t.dir && i === 0 && isFinite(t.bal) && txs[1] && isFinite(txs[1].bal)) { /* tidak bisa dipastikan */ }
    if (!t.dir) {
      const inn = RX_IN.test(t.desc), out = RX_OUT.test(t.desc);
      t.dir = inn && !out ? 1 : -1; t.unsure = true;
    }
    prev = isFinite(t.bal) ? t.bal : (isFinite(prev) ? prev + t.dir * t.amt : NaN);
  });
  const lastBal = [...txs].reverse().find(t => isFinite(t.bal));
  if (!isFinite(closeBal) && lastBal) closeBal = lastBal.bal;
  return {
    bank, openBal, closeBal,
    txs: txs.map(t => ({ date: t.date, desc: t.desc, amount: Math.round(t.dir * t.amt * 100) / 100, bal: t.bal, unsure: t.unsure })),
    from: txs[0] ? txs[0].date : "", to: txs.length ? txs[txs.length - 1].date : ""
  };
}
/** Teks yang ditempel (fallback bila PDF berupa gambar/terkunci): setiap baris jadi satu item. */
function parseStatementText(text) {
  const rows = String(text).split(/\r?\n/).map((ln, i) => {
    // Teks tempelan: posisi kolom memakai urutan sel (dipisah tab atau 2+ spasi)
    const parts = ln.split(/\t|\s{2,}/).filter(Boolean);
    const items = parts.map((p, k) => ({ s: p, x: k * 100, y: -i * 10, w: 0 }));
    return { y: -i * 10, items, text: ln.replace(/\s+/g, " ").trim() };
  }).filter(r => r.text);
  return parseStatement([rows]);
}

/* ---------- Spreadsheet (Excel / CSV) ---------- */
const SHEET_HDR = {
  date: /^(tanggal|tgl|date|tanggal transaksi|tgl transaksi|transaction date|posting date|tanggal posting|value date|trx date|waktu|tanggal & waktu|date\/time)$/i,
  desc: /^(keterangan|uraian|uraian transaksi|deskripsi|description|remark|remarks|detail|details|catatan|transaksi|transaction|narrative|keterangan transaksi|berita)$/i,
  debit: HDR.debit, credit: HDR.credit, balance: HDR.balance, amount: HDR.amount, dk: HDR.dk
};
/** Angka dari sel: angka asli, "1.500.000,00", "1,500,000.00", "-150000", "150.000 DB" */
function cellAmt(v) {
  if (typeof v === "number") return isFinite(v) ? { v: Math.abs(v), dir: v < 0 ? -1 : 0 } : null;
  const t = String(v ?? "").trim(); if (!t) return null;
  const a = parseAmt(t); if (a) return a;
  const m = t.replace(/\s/g, "").match(/^([+\-−]?)(?:Rp\.?|IDR)?(\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return { v: parseFloat(m[2] + (m[3] ? "." + m[3] : "")), dir: m[1] === "-" || m[1] === "−" ? -1 : m[1] === "+" ? 1 : 0 };
}
/** Tanggal dari sel: Date, nomor seri Excel, atau teks */
function cellDate(v, defYear) {
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const d = parseDateStart(String(v ?? ""), defYear); return d ? d.iso : null;
}
/**
 * Baca mutasi dari baris spreadsheet (array of arrays). Mencari baris judul kolom,
 * lalu memetakan Tanggal / Keterangan / Debit / Kredit / Nominal / D-K / Saldo.
 * Jika judul tidak ditemukan, jatuh ke pembaca heuristik umum.
 */
function parseSheetRows(rows, name) {
  const txt = c => String(c ?? "").trim();
  let hi = -1, map = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const m = {};
    (rows[r] || []).forEach((c, k) => { const t = txt(c); for (const key in SHEET_HDR) if (m[key] === undefined && SHEET_HDR[key].test(t)) m[key] = k; });
    if (m.date !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined)) { hi = r; map = m; break; }
  }
  const headTxt = rows.slice(0, Math.max(hi, 6)).map(r => (r || []).map(txt).join(" ")).join("\n") + "\n" + (name || "");
  const bank = (BANKS.find(([re]) => re.test(headTxt)) || [null, ""])[1];
  if (!map) { // tanpa judul kolom: pakai pembaca umum dengan posisi kolom = indeks sel
    const lines = rows.map((r, i) => { const items = (r || []).map((c, k) => ({ s: c instanceof Date ? cellDate(c) : typeof c === "number" ? (Number.isInteger(c) && Math.abs(c) < 1e5 ? String(c) : c.toFixed(2)) : txt(c), x: k * 100, y: -i * 10, w: 0 })).filter(it => it.s);
      return { y: -i * 10, items, text: items.map(it => it.s).join(" ") }; }).filter(l => l.text);
    const res = parseStatement([lines]); if (!res.bank) res.bank = bank; return res;
  }
  const yrs = {}; rows.slice(hi + 1).forEach(r => { const d = cellDate((r || [])[map.date], 0); if (d) yrs[d.slice(0, 4)] = (yrs[d.slice(0, 4)] || 0) + 1; });
  const defYear = +Object.keys(yrs).sort((a, b) => yrs[b] - yrs[a])[0] || new Date().getFullYear();
  const txs = []; let openBal = NaN, closeBal = NaN, last = null;
  // Kolom nominal bertanda: jika ada nilai negatif, nilai positif berarti uang masuk
  const amtSigned = map.amount !== undefined && rows.slice(hi + 1).some(r => { const a = cellAmt((r || [])[map.amount]); return a && a.dir === -1; });
  rows.slice(hi + 1).forEach(r => {
    r = r || [];
    const date = cellDate(r[map.date], defYear);
    const desc = map.desc !== undefined ? txt(r[map.desc]) : r.filter((c, k) => ![map.date, map.debit, map.credit, map.amount, map.balance, map.dk].includes(k) && typeof c === "string").map(txt).join(" ");
    if (!date) { // baris lanjutan keterangan atau ringkasan
      const line = r.map(txt).join(" ");
      if (RX_OPEN.test(line) && map.balance !== undefined) { const a = cellAmt(r[map.balance]); if (a) openBal = a.v; }
      else if (RX_CLOSE.test(line) && map.balance !== undefined) { const a = cellAmt(r[map.balance]); if (a) closeBal = a.v; }
      else if (last && desc && !RX_SKIP.test(desc)) last.desc = (last.desc + " " + desc).trim();
      return;
    }
    const db = map.debit !== undefined ? cellAmt(r[map.debit]) : null, cr = map.credit !== undefined ? cellAmt(r[map.credit]) : null;
    const am = map.amount !== undefined ? cellAmt(r[map.amount]) : null, bl = map.balance !== undefined ? cellAmt(r[map.balance]) : null;
    let amt = NaN, dir = 0;
    if (db && db.v > 0 && !(cr && cr.v > 0)) { amt = db.v; dir = -1; }
    else if (cr && cr.v > 0 && !(db && db.v > 0)) { amt = cr.v; dir = 1; }
    else if (am && am.v > 0) {
      amt = am.v; dir = am.dir;
      if (!dir && map.dk !== undefined) { const k = txt(r[map.dk]).toUpperCase(); dir = /^(K|CR|C|KREDIT|CREDIT|MASUK|IN)/.test(k) ? 1 : /^(D|DB|DR|DEBIT|DEBET|KELUAR|OUT)/.test(k) ? -1 : 0; }
      if (!dir && amtSigned) dir = 1;
    }
    if (!(amt > 0)) { if (RX_OPEN.test(desc) && bl) openBal = bl.v; return; }
    if (RX_OPEN.test(desc)) { openBal = bl ? bl.v : amt; return; }
    last = { date, desc: desc || "(tanpa keterangan)", amt, dir, bal: bl ? bl.v * (bl.dir === -1 ? -1 : 1) : NaN, unsure: false };
    txs.push(last);
  });
  return finalizeTxs(txs, openBal, closeBal, bank);
}
/** Pecah teks CSV dengan deteksi pemisah (; , tab |) dan tanda kutip. */
function parseCsvRows(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const delim = [";", ",", "\t", "|"].map(d => [d, (sample.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/* ================================================================
 * 19. RUANG KEUANGAN: arus kas, import mutasi, pola, proyeksi, alokasi
 *     Nilai dalam Rupiah. amount > 0 = masuk, < 0 = keluar.
 *     Kategori bertipe "move" (pindah dana: ke investasi/trading/rekening
 *     sendiri) tidak dihitung sebagai pemasukan/pengeluaran.
 * ================================================================ */
const FN = () => S.finance;
const fnCat = id => FN().cats.find(c => c.id === id) || { id, name: "Lainnya", type: "out", color: "#8A9AB5", kw: [] };
const fnAcct = id => FN().accounts.find(a => a.id === id);
const fnKey = d => String(d || "").toUpperCase().replace(/[0-9]+/g, " ").replace(/[^A-Z ]+/g, " ").replace(/\b(TRSF|TRF|E BANKING|EBANKING|CR|DB|DR|QRIS|PEMBAYARAN|PEMBELIAN|TRANSFER|KE|DARI|ATM|DEBIT|KREDIT)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
const monthsBack = (n, from = thisYm()) => { const out = []; let [y, m] = from.split("-").map(Number); for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m < 1) { m = 12; y--; } } return out; };
const isMove = t => fnCat(t.cat).type === "move";

/** Kategorikan otomatis: aturan hasil belajar → kata kunci → bawaan. */
function autoCat(desc, amount) {
  const key = fnKey(desc), learn = FN().learn || {};
  if (key && learn[key] && FN().cats.some(c => c.id === learn[key])) return learn[key];
  const up = " " + String(desc).toUpperCase().replace(/[^A-Z0-9]+/g, " ") + " ";
  const has = k => { const w = String(k).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim(); return w && up.includes(" " + w + " "); };
  const hit = types => FN().cats.find(c => types.includes(c.type) && (c.kw || []).some(has));
  const c = hit(["move"]) || hit(amount >= 0 ? ["in"] : ["out"]);
  if (c) return c.id;
  return amount >= 0 ? "in-other" : "out-other";
}

/* ---------- Agregasi ---------- */
function monthAgg(ym) {
  const r = { in: 0, out: 0, move: 0, byCat: {}, n: 0 };
  FN().tx.forEach(t => {
    if (ymOf(t.date) !== ym) return;
    const c = fnCat(t.cat); r.n++;
    if (c.type === "move") { r.move += t.amount; return; }
    if (t.amount >= 0) r.in += t.amount; else r.out += -t.amount;
    r.byCat[c.id] = (r.byCat[c.id] || 0) + Math.abs(t.amount);
  });
  r.surplus = r.in - r.out;
  return r;
}
function dataMonths() { return [...new Set(FN().tx.map(t => ymOf(t.date)))].sort(); }
/** Bulan dasar untuk rata-rata: N bulan terakhir yang punya data, tanpa bulan berjalan bila ada bulan lengkap. */
function baseMonths(n) {
  let ms = dataMonths(); const cur = thisYm();
  if (ms.length > 1 || (ms.length === 1 && ms[0] !== cur)) ms = ms.filter(m => m !== cur);
  return ms.slice(-n);
}
function averages(n) {
  const ms = baseMonths(n); if (!ms.length) return { in: 0, out: 0, surplus: 0, months: [], byCat: {} };
  const aggs = ms.map(monthAgg), avg = k => aggs.reduce((s, a) => s + a[k], 0) / aggs.length, byCat = {};
  aggs.forEach(a => Object.entries(a.byCat).forEach(([k, v]) => byCat[k] = (byCat[k] || 0) + v / aggs.length));
  return { in: avg("in"), out: avg("out"), surplus: avg("surplus"), months: ms, byCat };
}
function acctBalance(a) {
  const base = +a.balance || 0, at = a.balanceAt || "0000";
  return base + FN().tx.filter(t => t.acct === a.id && t.date > at).reduce((s, t) => s + t.amount, 0);
}
const totalBank = () => FN().accounts.reduce((s, a) => s + acctBalance(a), 0);
function tradeIDR() {
  if (!enabledSpaces().includes("trade")) return 0;
  const st = S.settings, r = S.rates, idr = r.IDR || 16400;
  if (!(st.balance > 0)) return 0;
  if (st.ccy === "USC") return st.balance / 100 * idr;
  return st.balance / (r[st.ccy] || 1) * idr;
}
const emergencyNow = () => SV().assets.filter(a => svType(a.type).id === "tunai").reduce((s, a) => s + assetStats(a).value, 0) + (+FN().rules.emExtra || 0);
/** Transaksi rutin: kunci sama, muncul di ≥3 bulan berbeda, nominal mirip (±20%). */
function recurring() {
  const g = {};
  FN().tx.forEach(t => { if (isMove(t)) return; const k = fnKey(t.desc) + (t.amount >= 0 ? "|in" : "|out"); if (!fnKey(t.desc)) return; (g[k] = g[k] || []).push(t); });
  return Object.entries(g).map(([k, list]) => {
    const months = new Set(list.map(t => ymOf(t.date))); if (months.size < 3) return null;
    const amts = list.map(t => Math.abs(t.amount)).sort((a, b) => a - b), med = amts[Math.floor(amts.length / 2)];
    if (amts.filter(a => Math.abs(a - med) / med <= 0.2).length < 3) return null;
    const days = list.map(t => +t.date.slice(8, 10)).sort((a, b) => a - b);
    const last = list.map(t => t.date).sort().pop();
    return { key: k.split("|")[0], dir: k.endsWith("|in") ? 1 : -1, amount: med, day: days[Math.floor(days.length / 2)], months: months.size, cat: list[list.length - 1].cat, last, seenThisMonth: ymOf(last) === thisYm() };
  }).filter(Boolean).sort((a, b) => b.amount - a.amount);
}

/* ---------- Navigasi sub-halaman ---------- */
let fnTab = "fn-sum";
const FN_TITLES = { "fn-sum": "Ringkasan", "fn-tx": "Transaksi", "fn-pat": "Pola", "fn-proj": "Proyeksi", "fn-plan": "Alokasi dana", "fn-set": "Kategori & rekening" };
function renderFinance() {
  $$("#v-fin .subpane").forEach(p => p.classList.toggle("on", p.id === fnTab));
  if (curView === "fin") {
    $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === "fin" && b.dataset.sub === fnTab));
    $("viewTitle").textContent = "Keuangan · " + (FN_TITLES[fnTab] || "");
  }
  renderHelp();
  ({ "fn-sum": fnRenderSum, "fn-tx": fnRenderTx, "fn-pat": fnRenderPat, "fn-proj": fnRenderProj, "fn-plan": fnRenderPlan, "fn-set": fnRenderSet }[fnTab] || (() => {}))();
}
document.addEventListener("click", e => { const b = e.target.closest("[data-fn-go]"); if (b) { fnTab = b.dataset.fnGo; renderFinance(); } });

/* ---------- Grafik batang HTML (tajam di semua ukuran) ---------- */
function bars(el, labels, a, b, opts = {}) {
  const mx = Math.max(1, ...a, ...(b || []));
  $(el).innerHTML = `<div class="hbars">` + labels.map((l, i) => `<div class="hb-col" title="${esc(l)}: ${opts.aName || "Masuk"} ${rp(a[i])}${b ? ` · ${opts.bName || "Keluar"} ${rp(b[i])}` : ""}">
    <div class="hb-bars"><i class="hb-a" style="height:${a[i] / mx * 100}%;background:${opts.aColor || "var(--buy)"}"></i>${b ? `<i class="hb-b" style="height:${b[i] / mx * 100}%;background:${opts.bColor || "var(--sell)"}"></i>` : ""}</div>
    <span>${esc(l)}</span></div>`).join("") + `</div>`;
}

/* ---------- Ringkasan ---------- */
function fnRenderSum() {
  const cur = monthAgg(thisYm()), av = averages(+FN().rules.months || 3), bank = totalBank();
  const k = (l, v, c = "", tip = "") => `<div class="kpi"><span>${l}${tip ? " " + qi(tip) : ""}</span><b class="num ${c}">${v}</b></div>`;
  $("fnKpis").innerHTML = [
    k("Saldo rekening", rp(bank), "", "Total saldo semua rekening: saldo terakhir dari mutasi/isian Anda + transaksi setelahnya."),
    k("Pemasukan bulan ini", rp(cur.in), "c-buy"), k("Pengeluaran bulan ini", rp(cur.out), "c-sell"),
    k("Surplus bulan ini", rpS(cur.surplus), cur.surplus >= 0 ? "c-buy" : "c-sell", "Pemasukan dikurangi pengeluaran. Pindah dana (ke investasi, trading, rekening sendiri) tidak dihitung."),
    k(`Rata-rata surplus (${av.months.length} bln)`, rpS(av.surplus), av.surplus >= 0 ? "c-buy" : "c-sell", "Rata-rata surplus bulanan dari bulan-bulan lengkap terakhir. Dipakai untuk proyeksi dan alokasi."),
    k("Rasio menabung", av.in > 0 ? pct(av.surplus / av.in * 100, 0) : "—", "", "Bagian pemasukan yang tersisa setelah pengeluaran. Patokan umum yang sering dipakai: 20% atau lebih.")
  ].join("");
  const ms = monthsBack(12).filter(m => !FN().tx.length || m >= (dataMonths()[0] || m));
  const aggs = ms.map(monthAgg);
  if (!FN().tx.length) $("fnBars").innerHTML = `<p class="empty">Belum ada data. Klik <b>Import mutasi</b> untuk membaca PDF e-statement, atau <b>Catat manual</b>.</p>`;
  else bars("fnBars", ms.map(ymLabel), aggs.map(a => a.in), aggs.map(a => a.out));
  // Kategori bulan ini vs rata-rata
  const cats = Object.entries(cur.byCat).filter(([id]) => fnCat(id).type === "out").sort((a, b) => b[1] - a[1]);
  const tot = cats.reduce((s, [, v]) => s + v, 0);
  $("fnCats").innerHTML = cats.length ? cats.slice(0, 10).map(([id, v]) => {
    const c = fnCat(id), avg = av.byCat[id] || 0, ch = avg ? (v - avg) / avg * 100 : NaN;
    return `<div class="rebal"><div class="rebal-top"><span><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span><span class="num">${rp(v)} <small class="c-muted">${pct(v / tot * 100, 0)}</small></span></div>
      <div class="rebal-bar"><i style="width:${v / cats[0][1] * 100}%;background:${c.color}"></i></div>
      ${isFinite(ch) && Math.abs(ch) >= 15 ? `<small class="${ch > 0 ? "c-warn" : "c-buy"}">${ch > 0 ? "▲" : "▼"} ${fmt(Math.abs(ch), 0)}% dibanding rata-rata (${rp(avg)})</small>` : ""}</div>`;
  }).join("") : `<p class="empty">Belum ada pengeluaran bulan ini.</p>`;
  $("fnAccts").innerHTML = FN().accounts.length ? FN().accounts.map(a => `<div class="expo-row"><b>${esc(a.name)}</b><span class="c-muted">${a.balanceAt ? "per " + new Date(a.balanceAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : ""}</span><span class="num">${rp(acctBalance(a))}</span></div>`).join("")
    : `<p class="empty">Rekening dibuat otomatis saat import mutasi, atau tambahkan di <b>Kategori & rekening</b>.</p>`;
}

/* ---------- Transaksi ---------- */
function fnCatOptions(cur, type) {
  const groups = { in: "Pemasukan", out: "Pengeluaran", move: "Pindah dana" };
  return Object.entries(groups).map(([t, g]) => `<optgroup label="${g}">` + FN().cats.filter(c => c.type === t && (!type || type === t || t === "move")).map(c => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${esc(c.name)}</option>`).join("") + `</optgroup>`).join("");
}
function fnRenderTx() {
  const fm = $("fnFMonth").value, fa = $("fnFAcct").value, fc = $("fnFCat").value, q = $("fnFSearch").value.trim().toUpperCase();
  $("fnFMonth").innerHTML = `<option value="">Semua bulan</option>` + dataMonths().reverse().map(m => `<option value="${m}" ${m === fm ? "selected" : ""}>${ymLabel(m)}</option>`).join("");
  $("fnFAcct").innerHTML = `<option value="">Semua rekening</option>` + FN().accounts.map(a => `<option value="${a.id}" ${a.id === fa ? "selected" : ""}>${esc(a.name)}</option>`).join("") + `<option value="-" ${fa === "-" ? "selected" : ""}>Tunai / tanpa rekening</option>`;
  $("fnFCat").innerHTML = `<option value="">Semua kategori</option><option value="?" ${fc === "?" ? "selected" : ""}>Perlu dicek</option>` + fnCatOptions(fc);
  const list = FN().tx.filter(t => (!fm || ymOf(t.date) === fm) && (!fa || (fa === "-" ? !t.acct : t.acct === fa)) && (!fc || (fc === "?" ? t.unsure : t.cat === fc)) && (!q || t.desc.toUpperCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.t || "").localeCompare(a.t || ""));
  const sIn = list.filter(t => !isMove(t) && t.amount > 0).reduce((s, t) => s + t.amount, 0), sOut = list.filter(t => !isMove(t) && t.amount < 0).reduce((s, t) => s - t.amount, 0);
  $("fnTxSum").innerHTML = list.length ? `${list.length} transaksi · masuk <b class="num c-buy">${rp(sIn)}</b> · keluar <b class="num c-sell">${rp(sOut)}</b>` : "";
  $("fnTxBody").innerHTML = list.length ? list.slice(0, 800).map(t => {
    const a = fnAcct(t.acct);
    return `<tr class="${t.unsure ? "row-pend" : ""}"><td class="c-muted">${new Date(t.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })}</td>
      <td class="wrap">${esc(t.desc)}${t.unsure ? ' <span class="pill med" data-tip="Arah masuk/keluar tidak bisa dipastikan dari PDF. Cek dan klik ⇄ jika terbalik.">cek</span>' : ""}</td>
      <td class="c-muted">${a ? esc(a.name) : "Tunai"}</td>
      <td><select class="fn-cat" data-id="${t.id}" aria-label="Kategori">${fnCatOptions(t.cat)}</select></td>
      <td class="num ${isMove(t) ? "c-muted" : t.amount >= 0 ? "c-buy" : "c-sell"}" style="text-align:right">${rpS(t.amount)}</td>
      <td><div class="actions"><button class="btn sm ghost" data-fnx="flip" data-id="${t.id}" data-tip="Balik arah: masuk ↔ keluar">⇄</button><button class="btn sm ghost" data-fnx="edit" data-id="${t.id}">Ubah</button><button class="btn sm ghost" data-fnx="del" data-id="${t.id}" aria-label="Hapus">✕</button></div></td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">${FN().tx.length ? "Tidak ada transaksi yang cocok." : "Belum ada transaksi. Klik Import mutasi atau Catat manual."}</td></tr>`;
}
["fnFMonth", "fnFAcct", "fnFCat"].forEach(id => $(id).addEventListener("change", fnRenderTx));
$("fnFSearch").addEventListener("input", fnRenderTx);
$("fnTxBody").addEventListener("change", e => {
  const s = e.target.closest(".fn-cat"); if (!s) return;
  const t = FN().tx.find(x => x.id === s.dataset.id); if (!t) return;
  t.cat = s.value; t.catManual = true; t.unsure = false;
  const key = fnKey(t.desc);
  if (key) { FN().learn = FN().learn || {}; FN().learn[key] = s.value; }
  // Terapkan ke transaksi lain dengan kunci yang sama (yang belum diubah manual)
  let n = 0; FN().tx.forEach(x => { if (x !== t && !x.catManual && fnKey(x.desc) === key && Math.sign(x.amount) === Math.sign(t.amount)) { x.cat = s.value; n++; } });
  save(); if (n) toast("Kategori dipelajari", `${n} transaksi serupa ikut diubah ke ${fnCat(s.value).name}. Import berikutnya juga otomatis.`, "ok");
  fnRenderTx();
});
$("fnTxBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-fnx]"); if (!b) return;
  const t = FN().tx.find(x => x.id === b.dataset.id); if (!t) return;
  if (b.dataset.fnx === "flip") { t.amount = -t.amount; t.unsure = false; if (!t.catManual) t.cat = autoCat(t.desc, t.amount); save(); fnRenderTx(); }
  if (b.dataset.fnx === "edit") fnTxForm(t);
  if (b.dataset.fnx === "del" && await confirmBox("Hapus transaksi?", t.desc, "Hapus")) { FN().tx = FN().tx.filter(x => x !== t); save(); fnRenderTx(); }
});
async function fnTxForm(edit, preset = {}) {
  const t0 = { kind: "out", date: todayStr(), amount: "", acct: FN().accounts[0] ? FN().accounts[0].id : "", cat: "", desc: "", ...(edit ? { kind: isMove(edit) ? "move" : edit.amount >= 0 ? "in" : "out", date: edit.date, amount: Math.abs(edit.amount), acct: edit.acct || "", cat: edit.cat, desc: edit.desc } : {}), ...preset };
  const pr = ask({ title: edit ? "Ubah transaksi" : "Catat transaksi", ok: "Simpan", body: `
    <div class="seg3" id="fkKind" role="group" style="margin-bottom:14px">${[["out", "Pengeluaran"], ["in", "Pemasukan"], ["move", "Pindah dana"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === t0.kind ? "on" : ""}">${l}</button>`).join("")}</div>
    <input type="hidden" name="kind" id="fkKindV" value="${t0.kind}">
    <div class="row"><div class="field"><label>Nominal (Rp)</label><input name="amount" type="number" step="any" class="num" value="${t0.amount}" inputmode="decimal"></div>
    <div class="field"><label>Tanggal</label><input name="date" type="date" value="${t0.date}"></div></div>
    <div class="field"><label>Keterangan</label><input name="desc" id="fkDesc" type="text" value="${esc(t0.desc)}" placeholder="mis. Makan siang, Gaji Oktober"></div>
    <div class="row"><div class="field"><label>Kategori</label><select name="cat" id="fkCat"></select></div>
    <div class="field"><label>Rekening</label><select name="acct"><option value="">Tunai / tanpa rekening</option>${FN().accounts.map(a => `<option value="${a.id}" ${a.id === t0.acct ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div></div>
    <p class="hint" id="fkHint"></p>` });
  const hints = { out: "Uang keluar untuk kebutuhan/konsumsi.", in: "Uang masuk: gaji, bonus, usaha, bunga, dan lainnya.", move: "Pindah dana ke investasi, trading, atau rekening sendiri. Tidak dihitung sebagai pengeluaran." };
  const fillCats = () => { const k = $("fkKindV").value, cur = $("fkCat").value || t0.cat;
    $("fkCat").innerHTML = FN().cats.filter(c => c.type === k).map(c => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    if (!t0.cat && $("fkDesc").value) { const g = autoCat($("fkDesc").value, k === "in" ? 1 : -1); if (fnCat(g).type === k) $("fkCat").value = g; }
    $("fkHint").textContent = hints[k]; };
  $$("#fkKind button").forEach(b => b.onclick = () => { $$("#fkKind button").forEach(x => x.classList.toggle("on", x === b)); $("fkKindV").value = b.dataset.k; t0.cat = ""; fillCats(); });
  $("fkDesc").onchange = () => { if (!edit) { t0.cat = ""; fillCats(); } };
  fillCats();
  const v = await pr; if (!v) return;
  const amt = num(v.amount);
  if (!(amt > 0)) { toast("Nominal wajib diisi", "Isi angka lebih dari 0.", "danger"); return fnTxForm(edit, v); }
  const sign = v.kind === "in" ? 1 : v.kind === "out" ? -1 : (edit ? Math.sign(edit.amount) || -1 : -1);
  const obj = edit || { id: uid(), t: Date.now().toString(36), src: "manual" };
  Object.assign(obj, { date: v.date || todayStr(), amount: sign * amt, desc: v.desc.trim() || fnCat(v.cat).name, cat: v.cat, acct: v.acct, catManual: true, unsure: false });
  if (!edit) FN().tx.push(obj);
  save(); renderFinance();
  toast("Transaksi disimpan", `${obj.desc} · ${rpS(obj.amount)}`, "ok");
}

/* ---------- Import mutasi PDF ---------- */
let pdfLib = null;
function loadPdfJs() {
  if (pdfLib) return Promise.resolve(pdfLib);
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfLib = window.pdfjsLib; return Promise.resolve(pdfLib); }
  const srcs = ["https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/"];
  const tryLoad = i => new Promise((res, rej) => {
    if (i >= srcs.length) return rej(new Error("Pustaka PDF tidak bisa dimuat. Periksa koneksi internet."));
    const sc = document.createElement("script"); sc.src = srcs[i] + "pdf.min.js";
    let done = false; const next = () => { if (done) return; done = true; tryLoad(i + 1).then(res, rej); };
    const to = setTimeout(next, 20000);
    sc.onload = () => { if (done) return; clearTimeout(to); if (window.pdfjsLib) { done = true; window.pdfjsLib.GlobalWorkerOptions.workerSrc = srcs[i] + "pdf.worker.min.js"; pdfLib = window.pdfjsLib; res(pdfLib); } else next(); };
    sc.onerror = () => { clearTimeout(to); next(); };
    document.head.appendChild(sc);
  });
  return tryLoad(0);
}
async function readPdf(buf, password) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), password }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(groupLines(tc.items.map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))));
  }
  return pages;
}
let xlsxLib = null;
function loadXlsx() {
  if (xlsxLib) return Promise.resolve(xlsxLib);
  if (window.XLSX) { xlsxLib = window.XLSX; return Promise.resolve(xlsxLib); }
  const srcs = ["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"];
  const tryLoad = i => new Promise((res, rej) => {
    if (i >= srcs.length) return rej(new Error("Pustaka Excel tidak bisa dimuat. Periksa koneksi internet."));
    const sc = document.createElement("script"); sc.src = srcs[i];
    let done = false; const next = () => { if (done) return; done = true; tryLoad(i + 1).then(res, rej); };
    const to = setTimeout(next, 20000);
    sc.onload = () => { if (done) return; clearTimeout(to); if (window.XLSX) { done = true; xlsxLib = window.XLSX; res(xlsxLib); } else next(); };
    sc.onerror = () => { clearTimeout(to); next(); };
    document.head.appendChild(sc);
  });
  return tryLoad(0);
}
/** Baca file Excel/CSV menjadi hasil mutasi (pilih lembar dengan transaksi terbanyak). */
async function readSheetFile(f, buf) {
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (ext === "csv" || ext === "txt") {
    const text = decodeFile(buf);
    return parseSheetRows(parseCsvRows(text), f.name);
  }
  const X = await loadXlsx();
  const wb = X.read(new Uint8Array(buf), { type: "array", cellDates: true });
  let best = null;
  wb.SheetNames.forEach(n => {
    const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
    const r = parseSheetRows(rows, f.name + " " + n);
    if (!best || r.txs.length > best.txs.length) best = r;
  });
  return best || { txs: [] };
}
$("fnImportFile").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = ""; if (!files.length) return;
  for (const f of files) await fnImportOne(f);
});
async function fnImportOne(f) {
  toast("Membaca mutasi", f.name);
  let buf; try { buf = await f.arrayBuffer(); } catch (err) { toast("File tidak bisa dibaca", f.name, "danger"); return; }
  if (/\.(xlsx|xls|xlsm|csv|txt)$/i.test(f.name)) {
    let res;
    try { res = await readSheetFile(f, buf); } catch (err) { toast("Gagal membaca file", (err && err.message) || "Format tidak dikenali.", "danger"); return; }
    if (!res.txs.length) {
      await ask({ title: "Transaksi tidak ditemukan", ok: "Mengerti", body: `<p class="hint">Kolom transaksi di <b>${esc(f.name)}</b> belum dikenali. Pastikan ada kolom <b>Tanggal</b> dan kolom nominal (<b>Debit/Kredit</b>, atau <b>Nominal</b> + <b>D/K</b>). Jika file terkunci kata sandi, buka di Excel lalu simpan ulang tanpa sandi.</p>` });
      return;
    }
    return fnPreview(res, f.name);
  }
  let pages = null, pw;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { pages = await readPdf(buf.slice(0), pw); break; }
    catch (err) {
      if (err && err.name === "PasswordException") {
        const v = await ask({ title: "PDF berkata sandi", ok: "Buka", body: `<p class="hint" style="margin-bottom:10px">${err.code === 2 ? "<b class='c-sell'>Kata sandi salah.</b> " : ""}File <b>${esc(f.name)}</b> dilindungi kata sandi. Biasanya berupa tanggal lahir (mis. DDMMYYYY) atau kombinasi yang dijelaskan di email e-statement dari bank. Kata sandi hanya dipakai untuk membuka file di perangkat ini dan tidak disimpan.</p>
          <div class="field"><label>Kata sandi PDF</label><input name="pw" type="password" autocomplete="off"></div>` });
        if (!v) return; pw = v.pw; continue;
      }
      toast("Gagal membaca PDF", (err && err.message) || "File tidak dikenali.", "danger"); return;
    }
  }
  if (!pages) return;
  const res = parseStatement(pages);
  if (!res.txs.length) {
    const scanned = pages.every(p => p.length < 3);
    await ask({ title: "Transaksi tidak ditemukan", ok: "Mengerti", body: `<p class="hint">${scanned ? "PDF ini sepertinya berupa gambar/hasil scan, sehingga teksnya tidak bisa dibaca." : "Format mutasi ini belum dikenali."} Alternatif: buka PDF, blok tabel transaksi, salin (Ctrl+C), lalu pakai tombol <b>Tempel teks mutasi</b>. Atau catat manual.</p>` });
    return;
  }
  fnPreview(res, f.name);
}
$("fnPasteBtn").onclick = async () => {
  const v = await ask({ title: "Tempel teks mutasi", ok: "Baca", body: `<p class="hint" style="margin-bottom:10px">Buka PDF/halaman mutasi, blok tabel transaksi (termasuk baris judul kolom bila ada), salin, lalu tempel di sini.</p><div class="field"><textarea name="txt" rows="10" style="font-family:var(--mono);font-size:12px" placeholder="02/09/2026  GAJI PT MAJU  0,00  12.500.000,00  16.500.000,00"></textarea></div>` });
  if (!v || !v.txt.trim()) return;
  const res = parseStatementText(v.txt);
  if (!res.txs.length) { toast("Transaksi tidak ditemukan", "Pastikan setiap baris diawali tanggal dan berisi nominal.", "warn"); return; }
  fnPreview(res, "teks tempelan");
};

let fnPrev = null;
function fnPreview(res, fname) {
  const keyOf = (acct, t) => `${acct}|${t.date}|${Math.round(t.amount)}|${fnKey(t.desc)}`;
  const bankName = res.bank || "";
  let match = FN().accounts.find(a => bankName && (a.bank === bankName || a.name.toLowerCase().includes(bankName.toLowerCase())));
  if (!match && !bankName && FN().accounts.length) { // bank tidak terdeteksi: pilih rekening yang paling banyak cocok dengan transaksi lama
    let best = 0;
    FN().accounts.forEach(a => { const keys = new Set(FN().tx.filter(t => t.acct === a.id).map(t => keyOf(a.id, t))); const n = res.txs.filter(t => keys.has(keyOf(a.id, t))).length; if (n > best) { best = n; match = a; } });
  }
  fnPrev = { res, rows: res.txs.map(t => ({ ...t, cat: autoCat(t.desc, t.amount), on: true })), acct: match ? match.id : "new", fname };
  const markDup = () => { const keys = new Set(FN().tx.map(t => keyOf(t.acct, t))); fnPrev.rows.forEach(r => { r.dup = fnPrev.acct !== "new" && keys.has(keyOf(fnPrev.acct, r)); r.on = !r.dup; }); };
  markDup();
  const m = $("fnImpModal");
  $("fnImpTitle").textContent = `Periksa hasil bacaan · ${fname}`;
  $("fnImpAcct").innerHTML = FN().accounts.map(a => `<option value="${a.id}" ${a.id === fnPrev.acct ? "selected" : ""}>${esc(a.name)}</option>`).join("") + `<option value="new" ${fnPrev.acct === "new" ? "selected" : ""}>+ Rekening baru${bankName ? ": " + esc(bankName) : ""}</option>`;
  $("fnImpNewName").value = bankName ? bankName : "";
  $("fnImpNewWrap").hidden = fnPrev.acct !== "new";
  $("fnImpAcct").onchange = () => { fnPrev.acct = $("fnImpAcct").value; $("fnImpNewWrap").hidden = fnPrev.acct !== "new"; markDup(); draw(); };
  const draw = () => {
    const sel = fnPrev.rows.filter(r => r.on), sIn = sel.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0), sOut = sel.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    const uns = fnPrev.rows.filter(r => r.unsure).length, dups = fnPrev.rows.filter(r => r.dup).length;
    $("fnImpInfo").innerHTML = `${bankName ? `Bank terdeteksi: <b>${esc(bankName)}</b> · ` : ""}Periode <b>${res.from ? new Date(res.from).toLocaleDateString("id-ID") : "?"}</b> – <b>${res.to ? new Date(res.to).toLocaleDateString("id-ID") : "?"}</b> · ${fnPrev.rows.length} transaksi${isFinite(res.closeBal) ? ` · saldo akhir <b class="num">${rp(res.closeBal)}</b>` : ""}
      <br>Dipilih ${sel.length}: masuk <b class="num c-buy">${rp(sIn)}</b>, keluar <b class="num c-sell">${rp(sOut)}</b>${uns ? ` · <span class="c-warn">${uns} baris perlu dicek arahnya</span>` : ""}${dups ? ` · <span class="c-muted">${dups} sudah pernah diimport (tidak dicentang)</span>` : ""}`;
    $("fnImpBody").innerHTML = fnPrev.rows.map((r, i) => `<tr class="${r.unsure ? "row-pend" : ""}${r.dup ? " row-dup" : ""}">
      <td><input type="checkbox" data-i="${i}" data-imp="on" ${r.on ? "checked" : ""} aria-label="Sertakan"></td>
      <td class="c-muted num">${r.date.slice(8, 10)}/${r.date.slice(5, 7)}</td>
      <td class="wrap">${esc(r.desc)}${r.unsure ? ' <span class="pill med">cek</span>' : ""}${r.dup ? ' <span class="pill neu">sudah ada</span>' : ""}</td>
      <td><select data-i="${i}" data-imp="cat" aria-label="Kategori">${fnCatOptions(r.cat)}</select></td>
      <td class="num ${r.amount >= 0 ? "c-buy" : "c-sell"}" style="text-align:right">${rpS(r.amount)}</td>
      <td><button class="btn sm ghost" type="button" data-i="${i}" data-imp="flip" data-tip="Balik arah masuk ↔ keluar">⇄</button></td></tr>`).join("");
  };
  fnPrev.draw = draw; draw();
  m.classList.add("open");
}
$("fnImpBody").addEventListener("change", e => {
  const el = e.target.closest("[data-imp]"); if (!el || !fnPrev) return; const r = fnPrev.rows[+el.dataset.i];
  if (el.dataset.imp === "on") r.on = el.checked; if (el.dataset.imp === "cat") r.cat = el.value; fnPrev.draw();
});
$("fnImpBody").addEventListener("click", e => {
  const el = e.target.closest("[data-imp='flip']"); if (!el || !fnPrev) return; const r = fnPrev.rows[+el.dataset.i];
  r.amount = -r.amount; r.unsure = false; r.cat = autoCat(r.desc, r.amount); fnPrev.draw();
});
$("fnImpAll").onclick = () => { if (!fnPrev) return; const on = !fnPrev.rows.every(r => r.on); fnPrev.rows.forEach(r => r.on = on); fnPrev.draw(); };
$("fnImpCancel").onclick = () => { $("fnImpModal").classList.remove("open"); fnPrev = null; };
$("fnImpSave").onclick = () => {
  if (!fnPrev) return;
  let acctId = fnPrev.acct;
  if (acctId === "new") {
    const name = $("fnImpNewName").value.trim() || fnPrev.res.bank || "Rekening";
    const a = { id: uid(), name, bank: fnPrev.res.bank || "", balance: 0, balanceAt: "" };
    FN().accounts.push(a); acctId = a.id;
  }
  const sel = fnPrev.rows.filter(r => r.on);
  sel.forEach(r => FN().tx.push({ id: uid(), t: Date.now().toString(36), acct: acctId, date: r.date, desc: r.desc, amount: r.amount, cat: r.cat, src: "pdf", unsure: false }));
  const a = fnAcct(acctId), res = fnPrev.res;
  if (a && isFinite(res.closeBal) && res.to && (!a.balanceAt || res.to >= a.balanceAt)) { a.balance = res.closeBal; a.balanceAt = res.to; }
  save(); $("fnImpModal").classList.remove("open"); fnPrev = null; renderFinance();
  toast("Mutasi diimport", `${sel.length} transaksi masuk ke ${a ? a.name : "rekening"}.`, "ok");
};

/* ---------- Pola ---------- */
function fnRenderPat() {
  const cur = monthAgg(thisYm()), av = averages(3);
  const rows = Object.keys({ ...cur.byCat, ...av.byCat }).filter(id => fnCat(id).type === "out").map(id => {
    const a = av.byCat[id] || 0, c = cur.byCat[id] || 0; return { id, a, c, ch: a ? (c - a) / a * 100 : NaN };
  });
  const up = rows.filter(r => r.ch >= 20 && r.c - r.a > 50000).sort((x, y) => (y.c - y.a) - (x.c - x.a)).slice(0, 5);
  const dn = rows.filter(r => r.a > 0 && r.ch <= -20).sort((x, y) => (x.c - x.a) - (y.c - y.a)).slice(0, 5);
  const li = (r, cls) => `<div class="expo-row"><b>${esc(fnCat(r.id).name)}</b><span class="num ${cls}">${r.ch > 0 ? "+" : ""}${fmt(r.ch, 0)}%</span><span class="num c-muted">${rp(r.c)} vs ${rp(r.a)}</span></div>`;
  $("fnUp").innerHTML = up.length ? up.map(r => li(r, "c-warn")).join("") : `<p class="empty">Tidak ada lonjakan pengeluaran bulan ini.</p>`;
  $("fnDown").innerHTML = dn.length ? dn.map(r => li(r, "c-buy")).join("") : `<p class="empty">Belum ada kategori yang turun signifikan.</p>`;
  const rec = recurring();
  $("fnRec").innerHTML = rec.length ? rec.slice(0, 12).map(r => `<div class="expo-row"><b>${esc(r.key)}</b><span class="c-muted">±tgl ${r.day} · ${r.months} bln</span><span class="num ${r.dir > 0 ? "c-buy" : "c-sell"}">${r.dir > 0 ? "+" : "−"}${rp(r.amount)}</span></div>`).join("")
    + `<p class="hint" style="margin-top:8px">Total rutin keluar ±${rp(rec.filter(r => r.dir < 0).reduce((s, r) => s + r.amount, 0))}/bulan.</p>` : `<p class="empty">Transaksi rutin terdeteksi setelah ada data minimal 3 bulan.</p>`;
  // Hari & tanggal
  const wd = [0, 0, 0, 0, 0, 0, 0], part = [0, 0, 0];
  const out = FN().tx.filter(t => t.amount < 0 && !isMove(t) && baseMonths(6).concat(thisYm()).includes(ymOf(t.date)));
  out.forEach(t => { const d = new Date(t.date + "T12:00:00"); wd[(d.getDay() + 6) % 7] += -t.amount; const dd = d.getDate(); part[dd <= 10 ? 0 : dd <= 20 ? 1 : 2] += -t.amount; });
  if (out.length) { bars("fnWd", ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"], wd, null, { aColor: "var(--sell)", aName: "Keluar" }); bars("fnPart", ["Tgl 1–10", "Tgl 11–20", "Tgl 21–31"], part, null, { aColor: "var(--warn)", aName: "Keluar" }); }
  else { $("fnWd").innerHTML = `<p class="empty">Belum ada data.</p>`; $("fnPart").innerHTML = ""; }
  const big = FN().tx.filter(t => ymOf(t.date) === thisYm() && t.amount < 0 && !isMove(t)).sort((a, b) => a.amount - b.amount).slice(0, 5);
  $("fnBig").innerHTML = big.length ? big.map(t => `<div class="expo-row"><b class="wrap" style="font-weight:600">${esc(t.desc)}</b><span class="c-muted">${new Date(t.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</span><span class="num c-sell">${rp(-t.amount)}</span></div>`).join("") : `<p class="empty">Belum ada pengeluaran bulan ini.</p>`;
  const ms = monthsBack(6).filter(m => dataMonths().includes(m));
  $("fnRate").innerHTML = ms.length ? ms.map(m => { const a = monthAgg(m), r = a.in > 0 ? a.surplus / a.in * 100 : NaN;
    return `<div class="rebal"><div class="rebal-top"><span>${ymLabel(m)}</span><span class="num ${a.surplus >= 0 ? "c-buy" : "c-sell"}">${rpS(a.surplus)} · ${isFinite(r) ? fmt(r, 0) + "%" : "—"}</span></div><div class="rebal-bar"><i style="width:${clamp(isFinite(r) ? r : 0, 0, 100)}%;background:var(--buy)"></i><b style="left:20%"></b></div></div>`; }).join("") + `<p class="hint" style="margin-top:6px">Garis tegak = patokan 20%.</p>` : `<p class="empty">Belum ada data.</p>`;
}

/* ---------- Proyeksi ---------- */
function fnRenderProj() {
  const H = clamp(Math.round(num($("fnHz").value) || 6), 1, 24), n = +FN().rules.months || 3, av = averages(n), cur = monthAgg(thisYm()), bank = totalBank();
  const day = new Date().getDate(), dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const remOut = Math.max(0, av.out - cur.out), remIn = Math.max(0, av.in - cur.in);
  const endMonth = bank + remIn - remOut;
  const pts = [bank, endMonth]; let v = endMonth;
  for (let i = 1; i < H; i++) { v += av.surplus; pts.push(v); }
  lineChart("fnProjChart", [{ pts, color: getCss("--brass"), w: 2.5, fill: true }], { base: 0 });
  const k = (l, x, c = "", tip = "") => `<div class="kpi"><span>${l}${tip ? " " + qi(tip) : ""}</span><b class="num ${c}">${x}</b></div>`;
  $("fnProjK").innerHTML = [
    k("Pengeluaran bulan ini sejauh ini", `${rp(cur.out)} <small class="c-muted">/ rata-rata ${rp(av.out)}</small>`, cur.out > av.out ? "c-warn" : ""),
    k("Perkiraan sisa pengeluaran bulan ini", rp(remOut), "", "Rata-rata pengeluaran bulanan dikurangi yang sudah keluar bulan ini."),
    k("Perkiraan saldo akhir bulan", rp(endMonth), endMonth < 0 ? "c-sell" : ""),
    k(`Perkiraan saldo ${H} bulan lagi`, rp(pts[pts.length - 1]), pts[pts.length - 1] < bank ? "c-warn" : "c-buy"),
    k("Hari tersisa bulan ini", `${dim - day} hari`)
  ].join("");
  const rec = recurring().filter(r => r.dir < 0 && !r.seenThisMonth);
  $("fnProjRec").innerHTML = rec.length ? rec.map(r => `<div class="expo-row"><b>${esc(r.key)}</b><span class="c-muted">±tgl ${r.day}</span><span class="num c-sell">${rp(r.amount)}</span></div>`).join("") : `<p class="empty">Tidak ada tagihan rutin yang belum terbayar bulan ini (atau data belum cukup).</p>`;
  $("fnProjNote").textContent = av.months.length ? `Berdasarkan rata-rata ${av.months.length} bulan: pemasukan ${rp(av.in)}, pengeluaran ${rp(av.out)}, surplus ${rpS(av.surplus)} per bulan.` : "Butuh data minimal 1 bulan untuk proyeksi.";
}
$("fnHz").addEventListener("input", fnRenderProj);

/* ---------- Alokasi dana ---------- */
const FN_PRESETS = {
  konservatif: { emMonths: 6, emPct: 60, invPct: 80, tradePct: 5, maxTradeShare: 5, buffer: 1 },
  seimbang: { emMonths: 6, emPct: 50, invPct: 70, tradePct: 15, maxTradeShare: 10, buffer: 1 },
  agresif: { emMonths: 3, emPct: 40, invPct: 60, tradePct: 30, maxTradeShare: 20, buffer: 0.5 }
};
function fnRenderPlan() {
  const R = FN().rules;
  ["months", "emMonths", "emPct", "invPct", "tradePct", "maxTradeShare", "buffer", "emExtra"].forEach(k => { const el = $("fr_" + k); if (document.activeElement !== el) el.value = R[k] ?? ""; });
  const av = averages(+R.months || 3), cur = monthAgg(thisYm()), bank = totalBank();
  const inv = portfolio().value, trade = tradeIDR(), net = bank + inv + trade;
  const emNow = emergencyNow(), emTarget = (+R.emMonths || 0) * av.out, emGap = Math.max(0, emTarget - emNow);
  const buffer = (+R.buffer || 0) * av.out, remOut = Math.max(0, av.out - cur.out);
  const free = Math.max(0, bank - buffer - remOut);
  const tradeShare = net > 0 ? trade / net * 100 : 0, tradeOver = tradeShare > (+R.maxTradeShare || 0);
  const surplus = Math.max(0, av.surplus);
  const emAlloc = Math.min(emGap, surplus * (+R.emPct || 0) / 100);
  const rest = surplus - emAlloc;
  const emWeak = emTarget > 0 && emNow < av.out; // kurang dari 1 bulan
  let tradeAlloc = (tradeOver || emWeak) ? 0 : rest * (+R.tradePct || 0) / 100;
  const invAlloc = rest * (+R.invPct || 0) / 100;
  if (invAlloc + tradeAlloc > rest) tradeAlloc = Math.max(0, rest - invAlloc);
  const flex = Math.max(0, rest - invAlloc - tradeAlloc);
  const k = (l, x, c = "", tip = "") => `<div class="kpi"><span>${l}${tip ? " " + qi(tip) : ""}</span><b class="num ${c}">${x}</b></div>`;
  $("fnPlanK").innerHTML = [
    k("Rata-rata surplus/bulan", rpS(av.surplus), av.surplus >= 0 ? "c-buy" : "c-sell"),
    k("Total kekayaan tercatat", rp(net), "", "Saldo rekening + nilai tabungan investasi + modal trading (dikonversi ke rupiah)."),
    k("Dana darurat", `${rp(emNow)} <small class="c-muted">/ ${rp(emTarget)}</small>`, emNow >= emTarget ? "c-buy" : "c-warn", "Nilai aset jenis Tunai/dana darurat di ruang Investasi + tambahan manual. Target = bulan × rata-rata pengeluaran."),
    k("Porsi modal trading", `${pct(tradeShare, 1)} <small class="c-muted">batas ${R.maxTradeShare}%</small>`, tradeOver ? "c-sell" : "", "Modal trading (dari pengaturan Trading) dibanding total kekayaan."),
    k("Dana bebas di rekening sekarang", rp(free), "", "Saldo rekening − sisa perkiraan pengeluaran bulan ini − dana penyangga. Ini yang aman dipindahkan sekarang.")
  ].join("");
  const parts = [["Dana darurat", emAlloc, "#8A9AB5"], ["Investasi / tabungan", invAlloc, "#2BC4A0"], ["Modal trading", tradeAlloc, "#E0B04B"], ["Fleksibel / sisa", flex, "#5AA9E6"]];
  $("fnPlanBar").innerHTML = surplus > 0 ? parts.map(([l, v, c]) => `<i style="width:${v / surplus * 100}%;background:${c}" title="${l}"></i>`).join("") : "";
  $("fnPlanList").innerHTML = surplus > 0 ? parts.map(([l, v, c]) => `<div class="lg"><span class="dot" style="background:${c}"></span><b>${l}</b><span class="num">${rp(v)}</span><span class="num c-muted">${pct(v / surplus * 100, 0)}</span></div>`).join("") : "";
  const notes = [];
  if (!av.months.length) notes.push(["info", "Import mutasi atau catat transaksi minimal 1 bulan agar alokasi bisa dihitung."]);
  else if (av.surplus <= 0) notes.push(["bad", `Rata-rata pengeluaran (${rp(av.out)}) sama atau lebih besar dari pemasukan (${rp(av.in)}). Menurut aturan ini, belum ada dana untuk investasi maupun trading. Lihat menu Pola untuk kategori yang bisa ditekan.`]);
  if (emWeak) notes.push(["bad", "Dana darurat kurang dari 1 bulan pengeluaran, jadi alokasi trading diset 0 sampai dana darurat lebih aman."]);
  else if (emGap > 0) notes.push(["mid", `Dana darurat masih kurang ${rp(emGap)}. Dengan ${rp(emAlloc)}/bulan, perkiraan terpenuhi dalam ±${emAlloc > 0 ? Math.ceil(emGap / emAlloc) : "∞"} bulan.`]);
  else if (emTarget > 0) notes.push(["", "Dana darurat sudah memenuhi target."]);
  if (tradeOver) notes.push(["bad", `Modal trading sudah ${pct(tradeShare, 1)} dari total kekayaan, di atas batas ${R.maxTradeShare}%. Alokasi trading bulan ini 0.`]);
  if (free > 0 && av.surplus > 0) notes.push(["info", `Saat ini ada sekitar ${rp(free)} di rekening yang bisa dipindahkan tanpa mengganggu kebutuhan bulan ini dan dana penyangga.`]);
  $("fnPlanNotes").innerHTML = notes.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("");
}
$$("[data-preset]").forEach(b => b.onclick = () => { Object.assign(FN().rules, FN_PRESETS[b.dataset.preset]); save(); fnRenderPlan(); toast("Template diterapkan", `Aturan ${b.textContent.trim()} dipakai. Sesuaikan bila perlu.`, "ok"); });
["months", "emMonths", "emPct", "invPct", "tradePct", "maxTradeShare", "buffer", "emExtra"].forEach(kk => $("fr_" + kk).addEventListener("change", () => {
  const v = num($("fr_" + kk).value); if (!(v >= 0)) return; FN().rules[kk] = v; save(); fnRenderPlan();
}));

/* ---------- Kategori & rekening ---------- */
function fnRenderSet() {
  $("fnAcctBody").innerHTML = FN().accounts.length ? FN().accounts.map(a => `<tr><td><b>${esc(a.name)}</b><br><small class="c-muted">${esc(a.bank || "")}</small></td>
    <td class="num">${rp(+a.balance || 0)}<br><small class="c-muted">${a.balanceAt ? "per " + new Date(a.balanceAt).toLocaleDateString("id-ID") : "belum diatur"}</small></td>
    <td class="num"><b>${rp(acctBalance(a))}</b></td>
    <td><div class="actions"><button class="btn sm" data-fna="edit" data-id="${a.id}">Ubah</button><button class="btn sm ghost" data-fna="del" data-id="${a.id}" aria-label="Hapus">✕</button></div></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">Belum ada rekening.</td></tr>`;
  $("fnCatBody").innerHTML = FN().cats.map((c, i) => `<tr data-i="${i}">
    <td><input type="color" data-k="color" value="${c.color}" aria-label="Warna"></td>
    <td><input type="text" data-k="name" value="${esc(c.name)}" aria-label="Nama"></td>
    <td><select data-k="type" aria-label="Tipe"><option value="out" ${c.type === "out" ? "selected" : ""}>Pengeluaran</option><option value="in" ${c.type === "in" ? "selected" : ""}>Pemasukan</option><option value="move" ${c.type === "move" ? "selected" : ""}>Pindah dana</option></select></td>
    <td><input type="text" data-k="kw" value="${esc((c.kw || []).join(", "))}" aria-label="Kata kunci" style="min-width:260px"></td>
    <td>${["in-other", "out-other"].includes(c.id) ? "" : `<button class="btn sm ghost" data-fnc="${i}" aria-label="Hapus">✕</button>`}</td></tr>`).join("");
  $("fnLearnInfo").textContent = `${Object.keys(FN().learn || {}).length} aturan hasil belajar dari koreksi Anda.`;
}
$("fnAcctBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-fna]"); if (!b) return; const a = fnAcct(b.dataset.id); if (!a) return;
  if (b.dataset.fna === "edit") return fnAcctForm(a);
  const n = FN().tx.filter(t => t.acct === a.id).length;
  if (await confirmBox(`Hapus rekening ${a.name}?`, `${n} transaksinya ikut dihapus.`, "Hapus")) { FN().accounts = FN().accounts.filter(x => x !== a); FN().tx = FN().tx.filter(t => t.acct !== a.id); save(); renderFinance(); }
});
async function fnAcctForm(a) {
  const v = await ask({ title: a ? `Ubah ${a.name}` : "Tambah rekening", ok: "Simpan", body: `
    <div class="row"><div class="field"><label>Nama rekening</label><input name="name" type="text" value="${esc(a ? a.name : "")}" placeholder="mis. Mandiri Gaji, Jago Utama"></div>
    <div class="field"><label>Bank</label><input name="bank" type="text" value="${esc(a ? a.bank || "" : "")}"></div></div>
    <div class="row"><div class="field"><label>Saldo (Rp)</label><input name="balance" type="number" step="any" class="num" value="${a ? a.balance || "" : ""}"></div>
    <div class="field"><label>Per tanggal</label><input name="at" type="date" value="${a && a.balanceAt ? a.balanceAt : todayStr()}"></div></div>
    <p class="hint">Saldo per tanggal tertentu. Transaksi setelah tanggal itu akan menambah/mengurangi saldo otomatis. Import mutasi juga memperbarui saldo ini.</p>` });
  if (!v) return; if (!v.name.trim()) { toast("Nama wajib diisi", "", "danger"); return; }
  const obj = a || { id: uid() }; Object.assign(obj, { name: v.name.trim(), bank: v.bank.trim(), balance: num(v.balance) || 0, balanceAt: v.at });
  if (!a) FN().accounts.push(obj); save(); renderFinance();
}
$("fnAddAcct").onclick = () => fnAcctForm(null);
$("fnCatBody").addEventListener("change", e => {
  const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return; const c = FN().cats[+tr.dataset.i];
  c[k] = k === "kw" ? e.target.value.split(",").map(x => x.trim()).filter(Boolean) : e.target.value;
});
$("fnCatBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-fnc]"); if (!b) return; const c = FN().cats[+b.dataset.fnc];
  if (!(await confirmBox(`Hapus kategori ${c.name}?`, "Transaksinya dipindah ke Lainnya.", "Hapus"))) return;
  FN().tx.forEach(t => { if (t.cat === c.id) t.cat = t.amount >= 0 ? "in-other" : "out-other"; });
  FN().cats = FN().cats.filter(x => x !== c); save(); fnRenderSet();
});
$("fnAddCat").onclick = () => { FN().cats.push({ id: "c" + uid(), name: "Kategori baru", type: "out", color: "#7FD1D9", kw: [] }); fnRenderSet(); };
$("fnSaveCats").onclick = () => { save(); toast("Kategori disimpan", "Kata kunci dipakai untuk import berikutnya.", "ok"); };
$("fnReapply").onclick = async () => {
  if (!(await confirmBox("Terapkan ulang kategori?", "Kategori otomatis dihitung ulang untuk transaksi yang belum Anda ubah manual.", "Terapkan", false))) return;
  let n = 0; FN().tx.forEach(t => { if (t.catManual) return; const c = autoCat(t.desc, t.amount); if (c !== t.cat) { t.cat = c; n++; } });
  save(); renderFinance(); toast("Selesai", `${n} transaksi berubah kategori.`, "ok");
};
$("fnLearnReset").onclick = async () => { if (await confirmBox("Hapus aturan hasil belajar?", "Kategori yang sudah ada tidak berubah.", "Hapus")) { FN().learn = {}; save(); fnRenderSet(); } };
$$("[data-fnadd]").forEach(b => b.onclick = () => b.dataset.fnadd === "manual" ? fnTxForm(null) : $("fnImportFile").click());

/* ================================================================
 * 20. PASAR: widget resmi TradingView (harga, grafik, kalender)
 *     Widget hanya untuk DITAMPILKAN. Datanya berada di dalam iframe
 *     TradingView dan tidak bisa dibaca aplikasi untuk perhitungan.
 * ================================================================ */
const TV_BASE = "https://s3.tradingview.com/external-embedding/embed-widget-";
const DEFAULT_WATCH = ["IDX:COMPOSITE", "OANDA:XAUUSD", "FX_IDC:USDIDR", "FOREXCOM:SPXUSD", "FOREXCOM:NSXUSD", "FOREXCOM:DJI", "FX:EURUSD", "TVC:USOIL", "BITSTAMP:BTCUSD"];
const TV_TITLES = { "IDX:COMPOSITE": "IHSG", "OANDA:XAUUSD": "Emas (XAU/USD)", "FX_IDC:USDIDR": "USD/IDR", "FOREXCOM:SPXUSD": "S&P 500", "FOREXCOM:NSXUSD": "Nasdaq 100",
  "FOREXCOM:DJI": "Dow Jones", "FX:EURUSD": "EUR/USD", "TVC:USOIL": "Minyak WTI", "BITSTAMP:BTCUSD": "Bitcoin", "INDODAX:BTCIDR": "BTC/IDR", "OANDA:XAGUSD": "Perak" };
const TV_INDEX = { US30: "FOREXCOM:DJI", US500: "FOREXCOM:SPXUSD", NAS100: "FOREXCOM:NSXUSD", US2000: "FOREXCOM:US2000", GER40: "PEPPERSTONE:GER40", UK100: "FOREXCOM:UKXGBP",
  FRA40: "PEPPERSTONE:FRA40", EU50: "PEPPERSTONE:EUSTX50", JP225: "PEPPERSTONE:JPN225", AUS200: "PEPPERSTONE:AUS200", HK50: "PEPPERSTONE:HK50",
  USOIL: "TVC:USOIL", UKOIL: "TVC:UKOIL", XNGUSD: "PEPPERSTONE:NATGAS" };
/** Simbol MT5 → simbol TradingView (bisa diubah pengguna di daftar pantauan). */
function tvSymbol(mt5) {
  const sym = resolveSym(mt5); if (!sym) return "OANDA:XAUUSD";
  if (TV_INDEX[sym.s]) return TV_INDEX[sym.s];
  if (sym.c === "Kripto") return "BINANCE:" + sym.s.replace(/USD$/, "USDT");
  if (sym.c === "Logam") return "OANDA:" + sym.s;
  return "FX:" + sym.s;
}
/** Simbol TradingView bawaan untuk aset tabungan. */
function tvForAsset(a) {
  if (a.tv) return a.tv;
  const t = svType(a.type).id, code = (a.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t === "saham" && code) return "IDX:" + code;
  if (t === "kripto" && code) return "INDODAX:" + code + "IDR";
  if (t === "emas") return "OANDA:XAUUSD";
  return "";
}
const tvTheme = () => (S.settings.theme === "light" ? "light" : "dark");
/** Pasang satu widget TradingView ke elemen. sig mencegah pemasangan ulang yang tidak perlu. */
function tvMount(el, widget, config, sig) {
  if (typeof el === "string") el = $(el); if (!el) return;
  const key = widget + "|" + tvTheme() + "|" + (sig || JSON.stringify(config));
  if (el.dataset.tvSig === key) return;
  el.dataset.tvSig = key;
  el.innerHTML = "";
  const box = document.createElement("div"); box.className = "tradingview-widget-container"; box.style.height = "100%"; box.style.width = "100%";
  const inner = document.createElement("div"); inner.className = "tradingview-widget-container__widget"; inner.style.height = "calc(100% - 22px)";
  const cr = document.createElement("div"); cr.className = "tradingview-widget-copyright";
  cr.innerHTML = `<a href="https://id.tradingview.com/" rel="noopener nofollow" target="_blank">Data &amp; grafik oleh TradingView</a>`;
  const sc = document.createElement("script"); sc.type = "text/javascript"; sc.async = true; sc.src = TV_BASE + widget + ".js";
  sc.textContent = JSON.stringify({ colorTheme: tvTheme(), theme: tvTheme(), isTransparent: true, locale: "id", ...config });
  box.append(inner, cr, sc); el.appendChild(box);
}
const watchList = () => (Array.isArray(S.settings.watch) && S.settings.watch.length ? S.settings.watch : DEFAULT_WATCH);
const tickerSyms = list => list.map(s => ({ proName: s, title: TV_TITLES[s] || s.split(":").pop() }));

/* ---------- Halaman Pasar (ruang Trading) ---------- */
let mkSym = null;
function renderMarket() {
  if (!navigator.onLine) { $("mkOffline").hidden = false; return; }
  $("mkOffline").hidden = true;
  tvMount("mkTicker", "ticker-tape", { symbols: tickerSyms(watchList()), showSymbolLogo: true, displayMode: "adaptive" });
  if (!mkSym) mkSym = tvSymbol(curSym);
  $("mkSymTxt").textContent = mkSym;
  const chips = [...new Set([tvSymbol(curSym), ...watchList()])];
  $("mkChips").innerHTML = chips.map(s => `<button type="button" class="chipbtn ${s === mkSym ? "on" : ""}" data-mksym="${esc(s)}">${esc(TV_TITLES[s] || s.split(":").pop())}</button>`).join("");
  tvMount("mkChart", "advanced-chart", { autosize: true, symbol: mkSym, interval: "60", timezone: "Asia/Jakarta", style: "1", allow_symbol_change: true, hide_volume: true, support_host: "https://www.tradingview.com" });
  tvMount("mkOverview", "market-overview", { dateRange: "1D", showChart: true, width: "100%", height: "100%", showSymbolLogo: true, showFloatingTooltip: true,
    tabs: [
      { title: "Indeks", symbols: [{ s: "IDX:COMPOSITE", d: "IHSG" }, { s: "FOREXCOM:SPXUSD", d: "S&P 500" }, { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100" }, { s: "FOREXCOM:DJI", d: "Dow Jones" }, { s: "PEPPERSTONE:JPN225", d: "Nikkei 225" }, { s: "PEPPERSTONE:GER40", d: "DAX 40" }] },
      { title: "Forex", symbols: [{ s: "FX:EURUSD", d: "EUR/USD" }, { s: "FX:GBPUSD", d: "GBP/USD" }, { s: "FX:USDJPY", d: "USD/JPY" }, { s: "FX:AUDUSD", d: "AUD/USD" }, { s: "FX_IDC:USDIDR", d: "USD/IDR" }, { s: "TVC:DXY", d: "Indeks Dolar" }] },
      { title: "Komoditas", symbols: [{ s: "OANDA:XAUUSD", d: "Emas" }, { s: "OANDA:XAGUSD", d: "Perak" }, { s: "TVC:USOIL", d: "Minyak WTI" }, { s: "TVC:UKOIL", d: "Minyak Brent" }] },
      { title: "Kripto", symbols: [{ s: "BITSTAMP:BTCUSD", d: "Bitcoin" }, { s: "BITSTAMP:ETHUSD", d: "Ethereum" }, { s: "BINANCE:SOLUSDT", d: "Solana" }, { s: "INDODAX:BTCIDR", d: "BTC/IDR" }] },
      { title: "Saham IDX", symbols: [{ s: "IDX:BBCA", d: "BCA" }, { s: "IDX:BBRI", d: "BRI" }, { s: "IDX:BMRI", d: "Mandiri" }, { s: "IDX:TLKM", d: "Telkom" }, { s: "IDX:ASII", d: "Astra" }] }
    ] });
  tvMount("mkCal", "events", { width: "100%", height: "100%", importanceFilter: "0,1", countryFilter: "us,eu,gb,jp,au,ca,ch,cn,id" });
  if (document.activeElement !== $("mkWatch")) $("mkWatch").value = watchList().join(", ");
}
document.addEventListener("click", e => { const b = e.target.closest("[data-mksym]"); if (b) { mkSym = b.dataset.mksym; renderMarket(); } });
$("mkUseCalc").onclick = () => { mkSym = tvSymbol(curSym); renderMarket(); };
$("mkSaveWatch").onclick = () => {
  const list = $("mkWatch").value.split(/[,\n]/).map(x => x.trim().toUpperCase()).filter(x => /^[A-Z0-9_.!]+:[A-Z0-9_.!]+$/.test(x));
  if (!list.length) { toast("Daftar kosong", "Format simbol: BURSA:KODE, mis. IDX:BBCA, OANDA:XAUUSD.", "danger"); return; }
  S.settings.watch = [...new Set(list)]; save(); $("mkTicker").dataset.tvSig = ""; renderMarket(); if (curView === "save") renderSavings();
  toast("Daftar pantauan disimpan", `${list.length} simbol.`, "ok");
};
$("mkResetWatch").onclick = () => { S.settings.watch = null; save(); $("mkWatch").value = DEFAULT_WATCH.join(", "); renderMarket(); };
window.addEventListener("online", () => { if (curView === "market") renderMarket(); });

/* ---------- Ticker di ringkasan Investasi & grafik aset ---------- */
function svMountTicker() {
  const syms = [...new Set(["IDX:COMPOSITE", "OANDA:XAUUSD", "FX_IDC:USDIDR", ...SV().assets.map(tvForAsset).filter(Boolean)])].slice(0, 16);
  if (!navigator.onLine) { $("svTicker").innerHTML = `<p class="hint">Harga pasar tampil saat terhubung internet.</p>`; return; }
  tvMount("svTicker", "ticker-tape", { symbols: tickerSyms(syms), showSymbolLogo: true, displayMode: "adaptive" });
}
async function svChart(a) {
  const sym = tvForAsset(a);
  const pr = ask({ title: `Grafik ${a.name}`, ok: "Tutup", body: `<div id="svChartBox" style="height:360px"></div>
    <p class="hint" style="margin-top:8px">Simbol: <b class="num">${esc(sym)}</b>. Ubah lewat tombol <b>Ubah</b> pada aset jika grafik tidak muncul. ${svType(a.type).id === "emas" ? "Emas ditampilkan sebagai harga spot dunia (XAU/USD) sebagai acuan, bukan harga Antam/Pegadaian." : ""} Sebagian data bursa (mis. IDX) bisa tertunda.</p>` });
  $("askCancel").hidden = true;
  tvMount("svChartBox", "symbol-overview", { symbols: [[a.name, sym + "|12M"]], chartOnly: false, width: "100%", height: "100%", autosize: true, showVolume: false, chartType: "area", scalePosition: "right", dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"] });
  await pr; $("askCancel").hidden = false;
}

/* ================================================================
 * 13. PENGATURAN
 * ================================================================ */
let authed = false;
const ccyOptions = cur => Object.keys(S.rates).map(c => `<option value="${c}" ${c === cur ? "selected" : ""}>${c === "USC" ? "USC (akun cent)" : c}</option>`).join("");

function showSettings() {
  $("pinView").hidden = authed; $("setView").hidden = !authed;
  if (!authed) { $("pinInput").value = ""; $("pinErr").textContent = ""; setTimeout(() => $("pinInput").focus(), 80); }
  else fillSettings();
}
function tryPin() {
  if (hash($("pinInput").value) === S.settings.pin) { authed = true; showSettings(); }
  else { $("pinErr").textContent = "PIN salah. Coba lagi."; $("pinInput").select(); }
}
$("pinBtn").onclick = tryPin;
$("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") tryPin(); });
$("lockSet").onclick = () => { authed = false; showSettings(); };
$("forgotPin").onclick = async () => {
  if (!(await confirmBox("Reset PIN dan pengaturan?", "PIN kembali ke 1234 dan pengaturan akun kembali ke bawaan. Posisi, jurnal, simbol, dan berita tidak dihapus.", "Reset"))) return;
  const keep = { sb: S.settings.sb, theme: S.settings.theme };
  S.settings = { ...blank().settings, ...keep, onboarded: true };
  save(); authed = true; showSettings(); onDataChange();
  toast("PIN direset", "PIN sekarang 1234. Segera ganti di tab Data & keamanan.", "warn");
};
$$(".tabs button").forEach(b => b.onclick = () => {
  $$(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  $$(".tabpane").forEach(p => p.classList.toggle("on", p.id === b.dataset.tab));
});

function fillSettings() {
  const st = S.settings, set = (id, v) => $(id).value = v, chk = (id, v) => $(id).checked = !!v;
  set("aBal", st.balance); $("aCcy").innerHTML = ccyOptions(st.ccy); set("aLev", st.leverage);
  { const en = enabledSpaces(); chk("aSpTrade", en.includes("trade")); chk("aSpInvest", en.includes("invest")); chk("aSpFin", en.includes("fin")); }
  set("aMax", st.maxRisk); set("aWarn", st.warnAt); set("aPer", st.perTrade);
  set("aDay", st.dailyLoss); set("aWeek", st.weeklyLoss); set("aMinRR", st.minRR);
  set("aLotStep", st.lotStep); set("aNewsWin", st.newsWin);
  chk("aBlock", st.block); chk("aLock", st.lossLock); chk("aCorr", st.corrWarn); chk("aNews", st.newsWarn);
  chk("aAutoBal", st.autoBal); chk("aSound", st.sound); chk("aNotif", st.notif);
  set("aSetups", st.setups.join(", ")); set("aEmos", st.emotions.join(", "));
  chk("cCosts", st.costs); set("cComm", st.comm);
  $("rateGrid").innerHTML = Object.entries(S.rates).filter(([c]) => c !== "USD" && c !== "USC").map(([c, v]) =>
    `<div class="field"><label for="r_${c}">1 USD = … ${c}</label><input type="number" class="num" id="r_${c}" data-rate="${c}" step="any" value="${v}"></div>`).join("");
  set("sbUrl", st.sb.url); set("sbKey", st.sb.key);
  const def = defaultSb(), builtIn = !!(def.url && def.key);
  $("sbUrl").placeholder = def.url || "https://xxxx.supabase.co";
  $("sbKey").placeholder = builtIn ? "Memakai key bawaan situs" : "";
  $$("#t-cloud .steps")[0].hidden = builtIn;
  $("sbUrl").closest(".row").hidden = builtIn && !st.sb.url;
  $("saveSb").parentElement.hidden = builtIn && !st.sb.url;
  $("cloudIntro").textContent = builtIn
    ? "Masuk atau daftar dengan email untuk menyinkronkan data di semua perangkat. Setiap orang memakai akunnya sendiri, dan posisi MT5 bisa masuk otomatis."
    : "Opsional. Dengan akun cloud, data tersinkron di semua perangkat Anda, setiap orang punya akun sendiri, dan posisi MT5 bisa masuk otomatis.";
  chk("aLiveMeter", st.liveInMeter); chk("aFollowBal", st.followMt5Bal); chk("aPendMeter", st.pendInMeter !== false);
  renderSymAdmin(); Cloud.render();
}
$("saveAcc").onclick = () => {
  const g = id => num($(id).value);
  const vals = { balance: g("aBal"), leverage: g("aLev"), maxRisk: g("aMax"), warnAt: g("aWarn"), perTrade: g("aPer"),
    minRR: g("aMinRR"), lotStep: g("aLotStep"), dailyLoss: g("aDay"), weeklyLoss: g("aWeek"), newsWin: g("aNewsWin") };
  const names = { balance: "Modal", leverage: "Leverage", maxRisk: "Batas total risiko", warnAt: "Peringatan dini", perTrade: "Risiko per trade",
    minRR: "R:R minimum", lotStep: "Langkah lot", dailyLoss: "Batas rugi harian", weeklyLoss: "Batas rugi mingguan", newsWin: "Jeda berita" };
  for (const [k, v] of Object.entries(vals)) {
    const allowZero = ["dailyLoss", "weeklyLoss", "newsWin", "minRR"].includes(k);
    if (!(allowZero ? v >= 0 : v > 0)) { toast("Nilai tidak valid", `${names[k]} harus berupa angka ${allowZero ? "0 atau lebih" : "lebih dari 0"}.`, "danger"); return; }
  }
  const list = id => [...new Set($(id).value.split(",").map(s => s.trim()).filter(Boolean))];
  const spaces = [["trade", "aSpTrade"], ["invest", "aSpInvest"], ["fin", "aSpFin"]].filter(([, id]) => $(id).checked).map(([k]) => k);
  if (!spaces.length) { toast("Pilih minimal satu ruang", "Trading, Investasi, atau Keuangan.", "danger"); return; }
  Object.assign(S.settings, vals, { spaces, menu: "all", ccy: $("aCcy").value, block: $("aBlock").checked, lossLock: $("aLock").checked, corrWarn: $("aCorr").checked,
    newsWarn: $("aNews").checked, autoBal: $("aAutoBal").checked, sound: $("aSound").checked, notif: $("aNotif").checked,
    setups: list("aSetups"), emotions: list("aEmos") });
  if (S.settings.notif && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  save(); lastLevel = null; renderTagInputs(); applyMenu(); onDataChange();
  toast("Pengaturan disimpan", "Semua perhitungan memakai nilai baru.", "ok");
};
$("saveCost").onclick = () => {
  const c = num($("cComm").value);
  if (!(c >= 0)) { toast("Komisi tidak valid", "Isi 0 jika akun Anda tanpa komisi.", "danger"); return; }
  S.settings.costs = $("cCosts").checked; S.settings.comm = c; save(); onDataChange();
  toast("Biaya disimpan", S.settings.costs ? "Spread, komisi, dan swap ikut dihitung." : "Biaya tidak dihitung.", "ok");
};
$("saveRates").onclick = () => {
  $$("[data-rate]").forEach(i => { const v = num(i.value); if (v > 0) S.rates[i.dataset.rate] = v; });
  save(); onDataChange(); toast("Kurs disimpan", "Konversi hasil diperbarui.", "ok");
};
$("fetchRates").onclick = async () => {
  $("rateInfo").textContent = "Mengambil kurs…";
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await res.json();
    if (j.result !== "success") throw new Error();
    let n = 0;
    Object.keys(S.rates).forEach(c => { if (c === "USD" || c === "USC") return; const k = c === "CNH" ? "CNY" : c; if (j.rates[k]) { S.rates[c] = +j.rates[k].toFixed(4); n++; } });
    save(); fillSettings(); onDataChange();
    $("rateInfo").textContent = `${n} kurs diperbarui (${new Date(j.time_last_update_unix * 1000).toLocaleDateString("id-ID")}).`;
  } catch (e) { $("rateInfo").textContent = "Gagal mengambil kurs. Isi manual dari Market Watch MT5."; }
};

/* ---------- Tabel simbol ---------- */
function renderSymAdmin() {
  const q = $("symFilter").value.toUpperCase().trim(), ccys = Object.keys(S.rates).filter(c => c !== "USC");
  $("symBody").innerHTML = S.symbols.map((x, i) => (q && !x.s.includes(q) && !x.c.toUpperCase().includes(q)) ? "" : `<tr data-i="${i}">
    <td><input type="text" data-k="s" value="${esc(x.s)}" class="num" aria-label="Simbol"></td>
    <td><input type="text" data-k="c" value="${esc(x.c)}" aria-label="Kategori"></td>
    <td><input type="number" data-k="cs" value="${x.cs}" step="any" class="num" aria-label="Contract size"></td>
    <td><input type="number" data-k="pip" value="${x.pip}" step="any" class="num" aria-label="Ukuran pip"></td>
    <td><input type="number" data-k="d" value="${x.d}" step="1" class="num" style="min-width:56px" aria-label="Digit"></td>
    <td><select data-k="q" aria-label="Mata uang kutipan">${ccys.map(c => `<option ${c === x.q ? "selected" : ""}>${c}</option>`).join("")}</select></td>
    <td><input type="number" data-k="spr" value="${x.spr}" step="any" class="num" aria-label="Spread"></td>
    <td><input type="number" data-k="swL" value="${x.swL}" step="any" class="num" aria-label="Swap buy"></td>
    <td><input type="number" data-k="swS" value="${x.swS}" step="any" class="num" aria-label="Swap sell"></td>
    <td><button class="btn sm ghost" data-sdel="${i}" type="button" aria-label="Hapus simbol">✕</button></td></tr>`).join("");
}
$("symFilter").addEventListener("input", renderSymAdmin);
$("symBody").addEventListener("change", e => {
  const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
  const x = S.symbols[+tr.dataset.i];
  x[k] = k === "s" ? e.target.value.toUpperCase().trim() : (k === "c" || k === "q") ? e.target.value : num(e.target.value);
  resolveCache.clear();
});
$("symBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-sdel]"); if (!b || S.symbols.length <= 1) return;
  const x = S.symbols[+b.dataset.sdel];
  if (!(await confirmBox(`Hapus simbol ${x.s}?`, "Simbol akan hilang dari daftar pilihan.", "Hapus"))) return;
  S.symbols.splice(+b.dataset.sdel, 1); save(); renderSymAdmin(); pickSym(curSym);
});
$("addSym").onclick = () => { S.symbols.unshift({ s: "SIMBOLBARU", c: "Lainnya", cs: 1, pip: 0.01, d: 2, q: "USD", spr: 0, swL: 0, swS: 0 }); $("symFilter").value = ""; renderSymAdmin(); $("symBody").querySelector("input").select(); };
$("saveSyms").onclick = () => {
  const bad = S.symbols.find(x => !x.s || !(x.cs > 0) || !(x.pip > 0) || !(x.d >= 0) || !(x.spr >= 0) || !isFinite(x.swL) || !isFinite(x.swS));
  if (bad) { toast("Data simbol belum lengkap", `Periksa ${bad.s || "(tanpa nama)"}: contract, pip, digit, dan spread harus angka yang valid.`, "danger"); return; }
  const dup = S.symbols.map(x => x.s).find((s, i, a) => a.indexOf(s) !== i);
  if (dup) { toast("Simbol ganda", `${dup} muncul lebih dari sekali.`, "danger"); return; }
  save(); pickSym(curSym); onDataChange(); toast("Simbol disimpan", `${S.symbols.length} simbol tersedia.`, "ok");
};
$("resetSyms").onclick = async () => {
  if (!(await confirmBox("Kembalikan daftar simbol bawaan?", "Semua perubahan contract size, spread, swap, dan simbol tambahan akan hilang.", "Kembalikan"))) return;
  S.symbols = DEFAULT_SYMBOLS.map(x => ({ ...x })); save(); renderSymAdmin(); pickSym(curSym); onDataChange();
};

/* ---------- Keamanan & data ---------- */
$("savePin").onclick = () => {
  const v = $("newPin").value;
  if (!/^\d{4,8}$/.test(v)) { toast("PIN tidak valid", "Gunakan 4–8 angka.", "danger"); return; }
  S.settings.pin = hash(v); save(); $("newPin").value = ""; toast("PIN diganti", "Gunakan PIN baru saat membuka pengaturan.", "ok");
};
$("backup").onclick = () => download(`riskdesk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "RiskDesk", version: VERSION, ...exportData() }, null, 2), "application/json");
$("restore").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d.settings || !Array.isArray(d.symbols)) throw new Error();
      if (!(await confirmBox("Pulihkan backup?", "Data di perangkat ini akan diganti dengan isi file backup.", "Pulihkan", false))) return;
      applyData(d);
      toast("Backup dipulihkan", "Semua data telah dimuat ulang.", "ok");
    } catch (err) { toast("File tidak dikenali", "Pilih file backup JSON dari RiskDesk.", "danger"); }
  };
  rd.readAsText(f);
});
$("resetAll").onclick = async () => {
  if (!(await confirmBox("Reset semua data?", "Pengaturan, simbol, posisi, jurnal, dan berita di perangkat ini akan dihapus. Data di cloud tidak ikut terhapus.", "Reset semua"))) return;
  Cloud.signOut(true); lsDel(KEY); lsDel(OLD_KEY);
  S = blank(); authed = false; save({ noSync: true });
  refreshAll(); go("dash"); openOnboarding();
};
function applyData(d, t, keepSb) {
  if (cmpVer(d && d.appVersion, VERSION) > 0) { readOnly = true; showStaleBanner(); return false; }
  S = normalize(d);
  if (t) S.updatedAt = t;
  if (keepSb && keepSb.url) S.settings.sb = keepSb;
  if (!readOnly) lsSet(KEY, JSON.stringify(S));
  resolveCache.clear();
  refreshAll();
  return true;
}
function refreshAll() {
  applyTheme(); applyMenu(); renderTagInputs(); pickSym(resolveSym(S.last.sym) ? resolveSym(S.last.sym).s : "XAUUSD", false);
  lastLevel = null; onDataChange();
  if (curView === "settings") showSettings();
}

/* ================================================================
 * 14. CLOUD (SUPABASE) & JEMBATAN MT5
 * ================================================================ */
const Cloud = {
  sess: (() => { try { return JSON.parse(lsGet(AUTH_KEY)); } catch (e) { return null; } })(),
  timer: null, status: "local", lastSync: 0, token: "",
  cfg() {
    const sb = S.settings.sb || {}, def = defaultSb();
    const url = sb.url || def.url, key = sb.key || def.key;
    return url && key ? { url: cleanSbUrl(url), key: key.trim() } : null;
  },
  setSess(s) { this.sess = s; s ? lsSet(AUTH_KEY, JSON.stringify(s)) : lsDel(AUTH_KEY); },
  mkSess(j) { return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user.id, email: j.user.email } }; },
  async req(path, { method = "GET", body, auth = true, prefer } = {}) {
    const c = this.cfg(); if (!c) throw new Error("Koneksi Supabase belum diatur.");
    if (auth) await this.refreshIfNeeded();
    const h = { apikey: c.key, "Content-Type": "application/json" };
    if (auth && this.sess) h.Authorization = "Bearer " + this.sess.access_token;
    if (prefer) h.Prefer = prefer;
    const res = await fetch(c.url + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!res.ok) { const err = new Error((j && (j.error_description || j.msg || j.message || j.error)) || "HTTP " + res.status); err.status = res.status; throw err; }
    return j;
  },
  async refreshIfNeeded() {
    const s = this.sess; if (!s || Date.now() < s.expires_at - 60000) return;
    const c = this.cfg();
    const res = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.access_token) { this.signOut(true); toast("Sesi cloud berakhir", "Silakan masuk lagi di Pengaturan → Cloud & MT5.", "warn"); throw new Error("Sesi berakhir"); }
    this.setSess(this.mkSess(j));
  },
  async signIn(email, pw) {
    const j = await this.req("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: pw }, auth: false });
    this.setSess(this.mkSess(j)); await this.afterLogin(true);
  },
  async signUp(email, pw, invite) {
    const j = await this.req("/auth/v1/signup", { method: "POST", body: { email, password: pw, data: { invite_code: invite || "" } }, auth: false });
    if (j && j.access_token) { this.setSess(this.mkSess(j)); await this.afterLogin(true); return true; }
    return false;
  },
  signOut(silent) { this.setSess(null); this.token = ""; this.status = "local"; Live.reset(); this.chip(); this.render(); if (!silent) toast("Keluar dari akun cloud", "Data tetap tersimpan di perangkat ini.", "ok"); },
  /** Menyamakan data lokal dan cloud. interactive=true: tanya pengguna bila cloud lebih baru. */
  async afterLogin(interactive) {
    const rows = await this.req(`/rest/v1/riskdesk_data?select=data,updated_at&user_id=eq.${this.sess.user.id}`);
    const remote = rows && rows[0], rt = remote ? new Date(remote.updated_at).getTime() : 0;
    this.base = Math.max(rt, this.base || 0);
    if (remote && rt > (S.updatedAt || 0) + 1000) {
      let use = true;
      if (interactive && S.updatedAt) use = await confirmBox("Data cloud ditemukan", `Data cloud terakhir diperbarui ${new Date(rt).toLocaleString("id-ID")}. Muat data cloud ke perangkat ini? Pilih Batal untuk menimpa cloud dengan data perangkat ini.`, "Muat data cloud", false);
      if (use) { if (applyData(remote.data, rt, S.settings.sb) && interactive) toast("Data dimuat dari cloud", "Perangkat ini sekarang sama dengan cloud.", "ok"); }
      else await this.push();
    } else if (!remote || (S.updatedAt || 0) > rt + 1000) await this.push();
    this.status = "ok"; this.lastSync = Date.now(); this.chip();
    await this.ensureToken().catch(e => console.warn(e));
    this.render(); Live.start();
  },
  schedule() { if (!this.sess || !this.cfg()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.push().catch(e => this.fail(e)), 1500); },
  async push() {
    if (!this.sess) return;
    this.status = "syncing"; this.chip();
    if (readOnly) { this.status = "ok"; this.chip(); return; }
    // Jangan pernah menimpa data cloud yang lebih baru dengan data lama
    const rows = await this.req(`/rest/v1/riskdesk_data?select=data,updated_at&user_id=eq.${this.sess.user.id}`);
    const remote = rows && rows[0], rt = remote ? new Date(remote.updated_at).getTime() : 0;
    if (remote && rt > (S.updatedAt || 0) + 500) {
      applyData(remote.data, rt, S.settings.sb);
      this.base = rt; this.status = "ok"; this.lastSync = Date.now(); this.chip(); this.render();
      toast("Data diperbarui dari perangkat lain", "Ada perubahan yang lebih baru di perangkat lain. Ulangi perubahan terakhir jika belum tersimpan.", "warn");
      return;
    }
    await this.req("/rest/v1/riskdesk_data", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: this.sess.user.id, data: exportData(), updated_at: new Date(S.updatedAt || Date.now()).toISOString() } });
    this.base = S.updatedAt || Date.now();
    this.status = "ok"; this.lastSync = Date.now(); this.chip(); this.render();
  },
  fail(e) { this.status = "error"; this.chip(); console.warn("Sinkronisasi:", e.message); },
  async ensureToken() {
    const id = this.sess.user.id;
    const rows = await this.req(`/rest/v1/riskdesk_mt5?select=token&user_id=eq.${id}`);
    if (rows && rows[0]) this.token = rows[0].token;
    else { const t = randHex(20); await this.req("/rest/v1/riskdesk_mt5", { method: "POST", prefer: "return=minimal", body: { user_id: id, token: t } }); this.token = t; }
  },
  async newToken() {
    const t = randHex(20);
    await this.req(`/rest/v1/riskdesk_mt5?user_id=eq.${this.sess.user.id}`, { method: "PATCH", prefer: "return=minimal", body: { token: t } });
    this.token = t; this.render();
  },
  chip() {
    const c = $("syncChip"), map = { local: ["", "Lokal"], syncing: ["warn", "Menyinkronkan"], ok: ["ok", "Tersinkron"], error: ["err", "Gagal sinkron"] };
    const [cls, txt] = this.sess ? map[this.status] : map.local;
    c.className = "chip " + cls; c.innerHTML = `<i></i>${txt}`;
    $("navCloud").textContent = this.sess ? " dan cloud" : "";
  },
  render() {
    const inn = !!this.sess;
    $("cloudAuth").hidden = inn; $("cloudUser").hidden = !inn;
    if (inn) {
      $("cUserEmail").textContent = this.sess.user.email;
      $("cLastSync").textContent = this.lastSync ? `Sinkron terakhir ${relTime(this.lastSync)}.` : "";
      $("cToken").textContent = this.token || "Memuat…";
      const c = this.cfg();
      $("cEaUrl").textContent = c ? c.url : "—";
      $("cEaKey").textContent = c ? c.key : "—";
    }
    renderLive();
  }
};
$("syncChip").onclick = () => { go("settings"); if (authed) $$(".tabs button").find(b => b.dataset.tab === "t-cloud").click(); };
/** Koneksi bawaan dari config.js (jika pemilik situs sudah mengisinya). */
function defaultSb() {
  const c = window.RISKDESK_CONFIG || {};
  const key = String(c.supabaseKey || "").trim();
  return { url: String(c.supabaseUrl || "").trim(), key: /^sb_secret_/i.test(key) ? "" : key };
}
/** Rapikan Project URL: buang /rest/v1 dan sejenisnya, ubah alamat dashboard menjadi https://REF.supabase.co */
function cleanSbUrl(raw) {
  let u = String(raw || "").trim().replace(/\s+/g, "");
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  const m = u.match(/^(https?:\/\/[^\/?#]+)/i);
  return m ? m[1].replace(/^http:/i, "https:") : u;
}
$("saveSb").onclick = () => {
  const url = $("sbUrl").value.trim() ? cleanSbUrl($("sbUrl").value) : "", key = $("sbKey").value.trim();
  if (url && !/^https:\/\/[^\/]+\.[a-z]{2,}$/i.test(url)) { toast("URL tidak valid", "Contoh yang benar: https://abcdefgh.supabase.co", "danger"); return; }
  if (key && /^sb_secret_/i.test(key)) { toast("Itu secret key", "Jangan pakai secret key. Salin publishable / anon key.", "danger"); return; }
  $("sbUrl").value = url;
  S.settings.sb = { url, key }; save({ noSync: true });
  $("cloudMsg").textContent = url && key ? "Koneksi disimpan. Silakan masuk atau daftar." : "Koneksi dihapus.";
};
async function cloudAuth(mode) {
  const email = $("cEmail").value.trim(), pw = $("cPass").value;
  if (!Cloud.cfg()) { $("cloudMsg").textContent = "Isi dan simpan Project URL serta anon key terlebih dahulu."; return; }
  if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 6) { $("cloudMsg").textContent = "Isi email yang valid dan kata sandi minimal 6 karakter."; return; }
  $("cloudMsg").textContent = mode === "in" ? "Masuk…" : "Mendaftarkan…";
  try {
    if (mode === "in") { await Cloud.signIn(email, pw); $("cloudMsg").textContent = "Berhasil masuk. Data tersinkron."; }
    else {
      const ok = await Cloud.signUp(email, pw, $("cInvite").value.trim());
      $("cloudMsg").textContent = ok ? "Akun dibuat dan sudah masuk." : "Akun dibuat. Buka email Anda untuk konfirmasi, lalu tekan Masuk.";
    }
    $("cPass").value = "";
  } catch (e) {
    const m = e.message || "";
    $("cloudMsg").textContent = mode === "up" && (/RISKDESK_INVITE_INVALID|database error saving new user/i.test(m) || e.status === 500) ? "Kode undangan salah. Minta kode yang benar ke pemilik situs."
      : /already registered|already exists/i.test(m) ? "Email ini sudah terdaftar. Klik Masuk."
      : /invalid login/i.test(m) ? "Email atau kata sandi salah." : /not confirmed/i.test(m) ? "Email belum dikonfirmasi. Cek kotak masuk Anda."
      : /relation|does not exist|schema cache/i.test(m) ? "Tabel belum dibuat. Jalankan supabase-setup.sql di SQL Editor."
      : /invalid path/i.test(m) ? "Project URL salah. Isi persis seperti https://abcdefgh.supabase.co tanpa tambahan apa pun, lalu Simpan koneksi."
      : /api key|apikey|jwt/i.test(m) ? "Key tidak cocok. Salin ulang publishable / anon key dari Project Settings → API Keys."
      : /failed to fetch|networkerror/i.test(m) ? "Tidak bisa terhubung ke Supabase. Periksa Project URL dan koneksi internet." : "Gagal: " + m;
  }
}
$("cLogin").onclick = () => cloudAuth("in");
$("cSignup").onclick = () => cloudAuth("up");
$("cLogout").onclick = () => Cloud.signOut();
$("cSyncNow").onclick = async () => { try { await Cloud.afterLogin(true); toast("Tersinkron", "Data perangkat dan cloud sudah sama.", "ok"); } catch (e) { Cloud.fail(e); toast("Gagal sinkron", e.message, "danger"); } };
$("cCopyToken").onclick = async () => { try { await navigator.clipboard.writeText(Cloud.token); toast("Token disalin", "Tempel ke input SyncToken di EA.", "ok"); } catch (e) { toast("Gagal menyalin", "Pilih teks token lalu salin manual."); } };
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  const txt = $(b.dataset.copy).textContent.trim();
  try { await navigator.clipboard.writeText(txt); toast("Disalin", "Tempel ke input EA di MT5.", "ok"); }
  catch (err) { toast("Gagal menyalin", "Pilih teksnya lalu salin manual."); }
});
$("cNewToken").onclick = async () => {
  if (!(await confirmBox("Buat token baru?", "EA yang memakai token lama akan berhenti mengirim data sampai token baru dipasang.", "Buat baru", false))) return;
  try { await Cloud.newToken(); toast("Token baru dibuat", "Perbarui input SyncToken di EA.", "ok"); } catch (e) { toast("Gagal", e.message, "danger"); }
};
$("aLiveMeter").onchange = () => { S.settings.liveInMeter = $("aLiveMeter").checked; save(); onDataChange(); };
$("aPendMeter").onchange = () => { S.settings.pendInMeter = $("aPendMeter").checked; save(); onDataChange(); };
$("aFollowBal").onchange = () => { S.settings.followMt5Bal = $("aFollowBal").checked; save(); Live.poll(); };

/* ================================================================
 * 15. ONBOARDING, PWA & INISIALISASI
 * ================================================================ */
function openOnboarding() {
  $("oCcy").innerHTML = ccyOptions(S.settings.ccy);
  $("oBal").value = S.settings.balance; $("oLev").value = S.settings.leverage; $("oMax").value = S.settings.maxRisk; $("oDay").value = S.settings.dailyLoss;
  const en = enabledSpaces();
  $$("[data-ospace]").forEach(x => x.classList.toggle("on", en.includes(x.dataset.ospace)));
  $("oTrade").hidden = !en.includes("trade");
  $("onbModal").classList.add("open"); setTimeout(() => $("oBal").focus(), 80);
}
$$("[data-ospace]").forEach(c => c.onclick = () => {
  c.classList.toggle("on"); c.setAttribute("aria-pressed", c.classList.contains("on"));
  if (!$$("[data-ospace].on").length) c.classList.add("on");
  $("oTrade").hidden = !$$("[data-ospace].on").some(x => x.dataset.ospace === "trade");
});
$("oStart").onclick = () => {
  const bal = num($("oBal").value), lev = num($("oLev").value), mx = num($("oMax").value), dl = num($("oDay").value), pin = $("oPin").value;
  const spaces = $$("[data-ospace].on").map(x => x.dataset.ospace), useTrade = spaces.includes("trade");
  S.settings.spaces = spaces; S.settings.menu = "all"; S.settings.space = spaces[0];
  if (useTrade && (!(bal > 0) || !(lev > 0) || !(mx > 0) || !(dl >= 0))) { toast("Periksa isian", "Modal, leverage, dan batas risiko harus berupa angka lebih dari 0.", "danger"); return; }
  if (pin && !/^\d{4,8}$/.test(pin)) { toast("PIN tidak valid", "Gunakan 4–8 angka, atau kosongkan.", "danger"); return; }
  if (useTrade) Object.assign(S.settings, { balance: bal, ccy: $("oCcy").value, leverage: lev, maxRisk: mx, dailyLoss: dl, weeklyLoss: dl * 2 });
  S.settings.onboarded = true;
  if (pin) S.settings.pin = hash(pin);
  save(); $("onbModal").classList.remove("open"); lastLevel = null; applyMenu(); onDataChange(); go(firstView());
  toast("Siap digunakan", pin ? "Pengaturan disimpan." : "PIN pengaturan: 1234. Ganti kapan saja di Pengaturan.", "ok");
};

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; $("installBtn").hidden = true; };
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; toast("Terpasang", "RiskDesk sekarang ada di layar utama Anda.", "ok"); });
if ("serviceWorker" in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then(r => r.update && r.update()).catch(e => console.warn("SW:", e)));
  // Saat versi baru aktif, muat ulang sekali agar semua tab/jendela memakai versi terbaru
  let swReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (swReloaded) return; swReloaded = true; location.reload(); });
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("onbModal").classList.contains("open") && S.settings.onboarded) $("onbModal").classList.remove("open");
});
// Sinkron antar tab di perangkat yang sama: hanya terima data yang lebih baru, tanpa menyimpan ulang
window.addEventListener("storage", e => {
  if (e.key !== KEY || !e.newValue) return;
  let d; try { d = JSON.parse(e.newValue); } catch (err) { return; }
  if (cmpVer(d.appVersion, VERSION) > 0) { readOnly = true; showStaleBanner(); return; }
  if (!((+d.updatedAt || 0) > (S.updatedAt || 0))) return;
  S = normalize(d); resolveCache.clear(); refreshAll();
});

// Saat aplikasi dibuka kembali (pindah tab / buka HP), ambil data terbaru dari cloud
let lastVisPull = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Cloud.sess && Cloud.cfg() && Date.now() - lastVisPull > 20000) {
    lastVisPull = Date.now();
    Cloud.afterLogin(false).catch(e => Cloud.fail(e));
  }
});

/* ---------- Mulai ---------- */
$("verTxt").textContent = "v" + VERSION;
$("nCcy").innerHTML = NEWS_CCY.map(c => `<option>${c}</option>`).join("");
$("lot").value = S.settings.lotStep >= 0.01 ? S.settings.lotStep : 0.01;
applyTheme(); applyMenu(); applyNavTips(); renderTagInputs(); pickSym(curSym, false);
if (readOnly) showStaleBanner();
onDataChange();
tick(); setInterval(tick, 30000);
setInterval(() => { renderNewsSoon(); update(); if (curView === "pos") renderLive(); }, 60000);
Cloud.chip();
if (Cloud.sess && Cloud.cfg()) Cloud.afterLogin(false).catch(e => Cloud.fail(e));
if (!S.settings.onboarded) openOnboarding();
go(location.hash.slice(1) || firstView());
if (S.settings.onboarded) setTimeout(svRemind, 1500);

// Ekspos minimal untuk debugging di konsol
window.RiskDesk = { version: VERSION, get state() { return S; }, calc, parseMt5Html, parseCsvJournal, importFile: f => fnImportOne(f) };
})();
