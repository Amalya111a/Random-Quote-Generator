const CATEGORIES = ["motivation","wisdom","love","success","life","happiness","humor","leadership"];
// Quotable API tag for each of our categories
const API_TAG = {motivation:"motivational",wisdom:"wisdom",love:"love",success:"success",life:"life",happiness:"happiness",humor:"humor",leadership:"leadership"};

// Offline fallback database
const LOCAL = [
  {text:"Success is not final, failure is not fatal: it is the courage to continue that counts.",author:"Winston Churchill",category:"motivation"},
  {text:"The only true wisdom is in knowing you know nothing.",author:"Socrates",category:"wisdom"},
  {text:"Being deeply loved by someone gives you strength, while loving someone deeply gives you courage.",author:"Lao Tzu",category:"love"},
  {text:"It does not matter how slowly you go as long as you do not stop.",author:"Confucius",category:"success"},
  {text:"In the middle of every difficulty lies opportunity.",author:"Albert Einstein",category:"life"},
  {text:"Happiness is not something ready made. It comes from your own actions.",author:"Dalai Lama",category:"happiness"},
  {text:"Before you criticize someone, walk a mile in their shoes. That way, you're a mile away and you have their shoes.",author:"Jack Handey",category:"humor"},
  {text:"A leader is best when people barely know he exists.",author:"Lao Tzu",category:"leadership"}
];

const $ = id => document.getElementById(id);
const store = {
  get(k, fallback){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// ---- State (preferences + user quotes persist in localStorage) ----
let prefs = store.get("qg_prefs", {categories: [...CATEGORIES], lang: "en"});
let custom = store.get("qg_custom", []);
let favs = store.get("qg_favs", []);   // favorite quotes
const apiCache = {};            // category -> quotes from API
const seen = new Set();         // quote texts already shown
const trCache = new Map();      // "lang|text" -> translation
let current = null;
let requestId = 0;              // counter for showQuote (picking a quote)
let renderId = 0;               // counter for render (translation + display)

// ---- UI helpers ----
function setStatus(msg, type = "ok"){
  const el = $("status");
  el.textContent = msg; el.className = "status " + type;
  clearTimeout(setStatus.t);
  setStatus.t = setTimeout(() => { el.textContent = ""; }, 3500);
}

function renderCategories(){
  $("categories").innerHTML = CATEGORIES.map(c =>
    `<label class="chip"><input type="checkbox" value="${c}" ${prefs.categories.includes(c) ? "checked" : ""}><span>${c}</span></label>`
  ).join("");
  $("c-category").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
}

function savePrefs(){ store.set("qg_prefs", prefs); }

// ---- Data ----
const API_SOURCES = [
  {name: "QuoteSlate API",
   url: c => `https://quoteslate.vercel.app/api/quotes/random?tags=${c}&count=30`,
   parse: d => (Array.isArray(d) ? d : d.quotes || []).map(q => ({text: q.quote || q.text, author: q.author}))},
  {name: "Quotable API",
   url: c => `https://api.quotable.io/quotes?tags=${API_TAG[c]}&limit=30`,
   parse: d => d.results.map(q => ({text: q.content, author: q.author}))}
];

async function fetchApiQuotes(cat){
  if (cat in apiCache) return apiCache[cat];
  for (const src of API_SOURCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(src.url(cat), {signal: ctrl.signal});
      if (!res.ok) throw new Error("HTTP " + res.status);
      const list = src.parse(await res.json()).filter(q => q.text && q.author);
      if (!list.length) throw new Error("empty result");
      console.log(`[quotes] ${cat}: ${list.length} quotes from ${src.name}`);
      return (apiCache[cat] = list.map(q => ({...q, category: cat, source: src.name})));
    } catch (err) {
      console.warn(`[quotes] ${src.name} failed for "${cat}":`, err.message);
    } finally { clearTimeout(timer); }
  }
  return (apiCache[cat] = []);   // all APIs failed: local quotes only
}

async function buildPool(cats){
  const fromApi = (await Promise.all(cats.map(fetchApiQuotes))).flat();
  const all = [...fromApi, ...custom.map(q => ({...q, source: "Added by you"})), ...LOCAL.map(q => ({...q, source: "Local database"}))].filter(q => cats.includes(q.category));
  return [...new Map(all.map(q => [q.text, q])).values()];   // remove duplicates
}

async function translate(text, lang){
  if (lang === "en") return text;
  const key = lang + "|" + text;
  if (trCache.has(key)) return trCache.get(key);
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`);
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    // MyMemory can answer HTTP 200 with a quota warning inside the body, so check responseStatus too
    if (res.ok && Number(data?.responseStatus) === 200 && out) { trCache.set(key, out); return out; }
  } catch {}
  setStatus("Translation unavailable, showing original.", "err");
  return text;
}

// ---- Core ----
async function showQuote(){
  const id = ++requestId;
  const cats = prefs.categories;
  if (!cats.length) {
    $("quote-text").textContent = "Select at least one category.";
    $("quote-author").textContent = "";
    $("source").textContent = "";
    current = null;
    updateFavBtn();
    $("new-btn").disabled = false;   // an older in-flight request must not leave the button locked
    return;
  }
  $("new-btn").disabled = true;
  try {
    const pool = await buildPool(cats);
    if (id !== requestId) return;               // a newer request replaced this one
    let unseen = pool.filter(q => !seen.has(q.text));
    if (!unseen.length) {                       // everything shown: start a new round
      pool.forEach(q => seen.delete(q.text));
      // avoid showing the same quote twice in a row when a new round starts
      unseen = pool.length > 1 && current ? pool.filter(q => q.text !== current.text) : pool;
    }
    const q = unseen[Math.floor(Math.random() * unseen.length)];
    seen.add(q.text);
    current = q;
    await render();
  } finally {
    if (id === requestId) $("new-btn").disabled = false;
  }
}

async function render(){
  if (!current) return;
  const id = ++renderId;
  const q = current;
  const text = await translate(q.text, prefs.lang);
  if (id !== renderId) return;                  // a newer render replaced this one
  $("quote-text").textContent = `"${text}"`;
  $("quote-author").textContent = "- " + q.author;
  $("source").textContent = "Source: " + q.source;
  updateFavBtn();
  const box = $("quote-box");
  box.classList.remove("animate"); void box.offsetWidth; box.classList.add("animate");
}

const shareText = () => `${$("quote-text").textContent} ${$("quote-author").textContent}`;

// ---- Events ----
$("categories").addEventListener("change", () => {
  prefs.categories = [...document.querySelectorAll("#categories input:checked")].map(i => i.value);
  savePrefs(); showQuote();
});

$("lang").addEventListener("change", e => {
  prefs.lang = e.target.value; savePrefs();
  render();                                     // translate current quote, don't pick a new one
});

$("new-btn").addEventListener("click", showQuote);

$("copy-btn").addEventListener("click", async () => {
  if (!current) return setStatus("No quote to copy yet.", "err");
  try { await navigator.clipboard.writeText(shareText()); setStatus("Copied to clipboard!"); }
  catch { setStatus("Could not copy.", "err"); }
});

function shareTo(kind, text){
  const t = encodeURIComponent(text);
  const urls = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}&quote=${t}`,
    whatsapp: `https://wa.me/?text=${t}`
  };
  if (kind === "native") navigator.share({text}).catch(() => {});
  else window.open(urls[kind], "_blank", "noopener,noreferrer");
}

document.querySelectorAll("[data-share]").forEach(btn => btn.addEventListener("click", () => {
  if (!current) return setStatus("No quote to share yet.", "err");
  shareTo(btn.dataset.share, shareText());
}));
if (navigator.share) $("native-share").hidden = false;

$("add-btn").addEventListener("click", () => {
  const text = $("c-text").value.trim(), author = $("c-author").value.trim();
  if (!text || !author) return setStatus("Please fill in both fields.", "err");
  const item = {text, author, category: $("c-category").value};
  custom.push(item);
  store.set("qg_custom", custom);
  $("c-text").value = ""; $("c-author").value = "";

  // make sure the new quote's category is selected so it belongs to the active pool
  if (!prefs.categories.includes(item.category)) {
    prefs.categories.push(item.category);
    savePrefs();
    renderCategories();
    $("c-category").value = item.category;
  }

  // cancel any quote request in flight and show the new quote right away
  requestId++;
  $("new-btn").disabled = false;
  seen.add(text);
  current = {...item, source: "Added by you"};
  render();
  setStatus("Quote added to database!");
});

// ---- Favorites (saved in localStorage) ----
function updateFavBtn(){
  const on = !!current && favs.some(f => f.text === current.text);
  const b = $("fav-btn");
  b.textContent = on ? "♥ Favorited" : "♡ Favorite";
  b.setAttribute("aria-pressed", String(on));
  b.classList.toggle("on", on);
}

function renderFavs(){
  const box = $("fav-list");
  box.textContent = "";
  if (!favs.length) {
    const p = document.createElement("p");
    p.className = "fav-empty";
    p.textContent = "No favorites yet. Press \u2661 Favorite on a quote you like.";
    box.append(p);
    return;
  }
  favs.forEach((f, i) => {
    const row = document.createElement("div"); row.className = "fav-item";
    const txt = document.createElement("div"); txt.className = "fav-text";
    txt.textContent = `"${f.text}" - ${f.author}`;
    const mk = (label, cls, fn) => {
      const b = document.createElement("button"); b.className = cls; b.textContent = label;
      b.addEventListener("click", fn); return b;
    };
    const line = `"${f.text}" - ${f.author}`;
    const dd = document.createElement("div"); dd.className = "dd";
    const menu = document.createElement("div"); menu.className = "dd-menu"; menu.hidden = true;
    const pick = kind => () => { shareTo(kind, line); menu.hidden = true; };
    menu.append(
      mk("Facebook", "mini", pick("facebook")),
      mk("WhatsApp", "mini", pick("whatsapp")),
      ...(navigator.share ? [mk("More...", "mini", pick("native"))] : [])
    );
    dd.append(mk("Share \u25BE", "mini", () => { menu.hidden = !menu.hidden; }), menu);
    row.append(
      txt,
      mk("Show", "mini", () => {                 // show it above so Copy/Share work on it
        requestId++; $("new-btn").disabled = false;
        seen.add(f.text); current = {...f}; render();
      }),
      dd,
      mk("Remove", "mini danger", () => {
        favs.splice(i, 1); store.set("qg_favs", favs); renderFavs(); updateFavBtn();
      })
    );
    box.append(row);
  });
}

$("fav-btn").addEventListener("click", () => {
  if (!current) return setStatus("No quote to save yet.", "err");
  const i = favs.findIndex(f => f.text === current.text);
  if (i >= 0) { favs.splice(i, 1); setStatus("Removed from favorites."); }
  else {
    favs.push({text: current.text, author: current.author, category: current.category, source: current.source});
    setStatus("Added to favorites!");
  }
  store.set("qg_favs", favs); renderFavs(); updateFavBtn();
});

// close any open share dropdown on outside click or Escape
const closeMenus = except => document.querySelectorAll(".dd-menu").forEach(m => { if (!except || !m.parentElement.contains(except)) m.hidden = true; });
document.addEventListener("click", e => closeMenus(e.target));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });

// ---- Init ----
renderCategories();
renderFavs();
$("lang").value = prefs.lang;
showQuote();
