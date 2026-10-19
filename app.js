"use strict";
/* PF2e Loot Builder: offline, data from data/items.js (build_data.py) and data/desc/<group>.js (on demand). */

const D = window.LB_DATA;
const ITEMS = D.items;
const SPELLS = D.spells;
const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
const SP_BY_ID = new Map(SPELLS.map(s => [s.id, s]));
const TPL = D.templates;
const TREASURE = D.treasure;
const RARITY = ["common", "uncommon", "rare", "unique"];
const PAGE = 200;
const DD_RENDER_CAP = 300;
const MAX_ITEM_LEVEL = Math.max(...ITEMS.map(i => i.l));
const MAX_PARTY_LEVEL = 20;

/* ---------- helpers ---------- */

const uniq = a => [...new Set(a)];
const cap = s => String(s).replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const titleCase = s => cap(String(s).replace(/-/g, " "));
const ordinal = n => n + ({ 1: "st", 2: "nd", 3: "rd" }[n] || "th");
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const unitCp = i => i.p / (i.per || 1);
const listCell = (arr, fn = esc) => (arr && arr.length ? arr.map(fn).join(", ") : `<span class="muted">—</span>`);
const dash = `<span class="muted">—</span>`;

function fmtCp(cp) {
  if (!cp) return "—";
  const gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10;
  return [gp && gp.toLocaleString() + " gp", sp && sp + " sp", c && c + " cp"].filter(Boolean).join(" ");
}
function fmtBulk(b) { return b == null ? "—" : b === 0 ? "—" : b; }
function fmtBulkSum(sum) {
  const tenths = Math.round(sum * 10), whole = Math.floor(tenths / 10), l = tenths % 10;
  return [whole && whole + " Bulk", l && l + " L"].filter(Boolean).join(" ") || "0";
}
const AX = { "◆": "1 action", "◆◆": "2 actions", "◆◆◆": "3 actions", "⤾": "Reaction", "◇": "Free action", other: "Other activation" };
const axLabel = v => AX[v] || v;
const SAVE_LABEL = { reflex: "Reflex", fortitude: "Fortitude", will: "Will" };
const TIME_LABEL = t => (/^\d+$/.test(t) ? t + (t === "1" ? " action" : " actions") : cap(t));

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

/* ---------- runed gear (base weapon/armor + fundamental + property runes) ---------- */

const BASES = D.bases;
const BASE_BY_ID = new Map(BASES.map(b => [b.id, b]));
const RUNES = ITEMS.filter(i => i.c === "Runes");
const RUNE_BY_NAME = new Map(RUNES.map(r => [r.n, r]));
const RUNE_BY_ID = new Map(RUNES.map(r => [r.id, r]));
const FUND_NAMES = {
  wp: ["Weapon Potency (+1)", "Weapon Potency (+2)", "Weapon Potency (+3)"],
  ws: ["Striking", "Striking (Greater)", "Striking (Major)"],
  ap: ["Armor Potency (+1)", "Armor Potency (+2)", "Armor Potency (+3)"],
  ar: ["Resilient", "Resilient (Greater)", "Resilient (Major)"],
};
const FUND_STEPS = { wp: [2, 10, 16], ws: [4, 12, 19], ap: [5, 11, 18], ar: [8, 14, 20] };
const runeFamily = n => n.replace(/ \((?:Lesser|Greater|Major|True|Supreme|Minor|Moderate)\)$/, "");
/** Property runes this base can take, judged from the rune's usage text; unsure cases are left out. */
const PROP_USAGE = {
  weapon: { "etched-onto-a-weapon": () => true, "etched-onto-melee-weapon": b => !b.rng,
    "etched-onto-bludgeoning-weapon": b => b.wd && b.wd[2] === "bludgeoning",
    "etched-onto-piercing-or-slashing-melee-weapon": b => !b.rng && b.wd && ["piercing", "slashing"].includes(b.wd[2]),
    "etched-onto-piercing-or-slashing-weapon": b => b.wd && ["piercing", "slashing"].includes(b.wd[2]),
    "etched-onto-slashing-melee-weapon": b => !b.rng && b.wd && b.wd[2] === "slashing",
    "etched-onto-thrown-weapon": b => b.t.includes("thrown") },
  armor: { "etched-onto-armor": () => true, "etched-onto-light-armor": b => b.cat === "light", "etched-onto-heavy-armor": b => b.cat === "heavy",
    "etched-onto-med-heavy-armor": b => b.cat === "medium" || b.cat === "heavy" },
};
const PROP_RUNES = RUNES.filter(r => r.p > 0 && ["common", "uncommon"].includes(r.r) && !r.t.includes("cursed") && !/^(Weapon Potency|Armor Potency|Striking|Resilient|Reinforcing)/.test(r.n));
function propRunesFor(b) {
  const table = PROP_USAGE[b.ty];
  return PROP_RUNES.filter(r => table[r.us] && table[r.us](b));
}
const ROMAN = { 1: "+1", 2: "+2", 3: "+3" };

function runedParts(e) {
  const b = BASE_BY_ID.get(e.base);
  const runes = [];
  const key = b.ty === "weapon" ? { p: "wp", f: "ws" } : { p: "ap", f: "ar" };
  if (e.pot) runes.push(RUNE_BY_NAME.get(FUND_NAMES[key.p][e.pot - 1]));
  if (e.fun) runes.push(RUNE_BY_NAME.get(FUND_NAMES[key.f][e.fun - 1]));
  for (const id of e.props) runes.push(RUNE_BY_ID.get(id));
  return { b, runes: runes.filter(Boolean) };
}
function runedName(e) {
  const { b, runes } = runedParts(e);
  const fundName = e.fun ? ["Striking", "Greater Striking", "Major Striking"][e.fun - 1] : null;
  const fundArm = e.fun ? ["Resilient", "Greater Resilient", "Major Resilient"][e.fun - 1] : null;
  const parts = [e.pot ? ROMAN[e.pot] : "", b.ty === "weapon" ? fundName : fundArm, ...e.props.map(id => RUNE_BY_ID.get(id).n.replace(/^(.*?) \((Greater|Major|True|Lesser)\)$/, "$2 $1")), b.n];
  return parts.filter(Boolean).join(" ");
}

function rollRuned() {
  const kind = state.runed.kind, cat = state.runed.cat;
  const bases = BASES.filter(b => (kind === "both" || b.ty === kind) && (!cat || b.cat === cat));
  if (!bases.length) return null;
  const lo = state.useWindow ? state.party.level + state.relMin : 2, hi = state.useWindow ? state.party.level + state.relMax : 20;
  for (let tries = 0; tries < 200; tries++) {
    // weapons vastly outnumber armor: choose the gear type first so "both" is an even split
    const types = [...new Set(bases.map(x => x.ty))];
    const ty = pick(types);
    const b = pick(bases.filter(x => x.ty === ty)), w = b.ty === "weapon";
    const pk = w ? "wp" : "ap", fk = w ? "ws" : "ar";
    const T = Math.max(2, lo) + rnd(Math.max(0, hi - Math.max(2, lo)) + 1);
    const pot = tierAt(FUND_STEPS[pk], T), fmax = tierAt(FUND_STEPS[fk], T);
    if (!pot) continue;
    const fun = fmax ? (Math.random() < 0.7 ? fmax : 1 + rnd(fmax)) : 0;
    const cap = state.runed.props === "auto" ? pot : Math.min(pot, +state.runed.props);
    const k = state.runed.props === "auto" ? rnd(cap + 1) : cap;
    const pool = propRunesFor(b).filter(r => r.l <= T);
    const props = [];
    const fams = new Set();
    for (const r of sample(pool, pool.length, true)) {
      if (props.length >= k) break;
      if (fams.has(runeFamily(r.n))) continue;
      fams.add(runeFamily(r.n));
      props.push(r.id);
    }
    const e = { kind: "runed", base: b.id, pot, fun, props };
    const lvl = entryInfo({ ...e, qty: 1 }).level;
    if (lvl >= lo && lvl <= hi) return e;
  }
  return null;
}
const tierAt = (steps, L) => steps.filter(s => L >= s).length;

/* ---------- filters ---------- */

const countValues = (rows, get) => {
  const m = new Map();
  for (const r of rows) for (const v of get(r)) m.set(v, (m.get(v) || 0) + 1);
  return m;
};

const ARMOR_TYPE = { Light: "Light", Medium: "Medium", Heavy: "Heavy", Unarmored: "Clothing (unarmored)", "Light barding": "Barding (light)", "Heavy barding": "Barding (heavy)" };
const armorType = i => (i.ty === "armor" ? ARMOR_TYPE[i.sc] || i.sc : null);

const ITEM_FILTERS = [
  { key: "type", section: "General", label: "Type", get: i => [i.k ? "Consumable" : "Permanent"], order: ["Permanent", "Consumable"] },
  { key: "rarity", section: "General", label: "Rarity", get: i => [i.r], order: RARITY, fmt: cap },
  { key: "cat", section: "General", label: "Category", get: i => [i.c], order: "alpha" },
  { key: "sub", section: "General", label: "Subcategory", multi: true, search: true, get: i => [i.c + " › " + i.sc], order: "alpha" },
  { key: "ckind", section: "General", label: "Consumable type", multi: true, get: i => (i.ck ? [i.ck] : []), order: "count" },
  { key: "base", section: "General", label: "Base item", multi: true, search: true, get: i => (i.bi ? [i.bi] : []), order: "alpha", fmt: titleCase },
  { key: "trait", section: "General", label: "Traits", multi: true, search: true, get: i => i.t, order: "alpha" },
  { key: "class", section: "General", label: "Class", multi: true, get: i => i.cl || [], order: "alpha", fmt: cap },

  { key: "atype", section: "Equipment details", label: "Armor type", multi: true, get: i => (i.ty === "armor" ? [armorType(i)] : []),
    order: ["Light", "Medium", "Heavy", "Clothing (unarmored)", "Barding (light)", "Barding (heavy)"] },
  { key: "dtype", section: "Equipment details", label: "Damage type", multi: true, get: i => (i.wd && i.wd[2] ? [i.wd[2]] : []), order: "count", fmt: cap },
  { key: "ddie", section: "Equipment details", label: "Damage dice", multi: true, get: i => (i.wd ? [`${i.wd[0]}${i.wd[1]}`] : []), order: "count" },
  { key: "wgroup", section: "Equipment details", label: "Weapon group", multi: true, get: i => (i.ty === "weapon" && i.grp ? [i.grp] : []), order: "count", fmt: cap },
  { key: "mat", section: "Equipment details", label: "Material", multi: true, get: i => (i.mat ? [i.mat] : []), order: "count", fmt: titleCase },
  { key: "act", section: "Equipment details", label: "Activation", multi: true, get: i => (i.ax ? [axLabel(i.ax)] : []), order: "count" },
  { key: "inv", section: "Equipment details", label: "Invested", get: i => [i.inv ? "Invested" : "Not invested"], order: ["Invested", "Not invested"] },
  { key: "spell", section: "Equipment details", label: "Spell granted", multi: true, search: true, get: i => i.sp || [], order: "count" },
];

const SPELL_FILTERS = [
  { key: "rarity", section: "Spells", label: "Rarity", get: s => [s.r], order: RARITY, fmt: cap },
  { key: "tradition", section: "Spells", label: "Tradition", multi: true, get: s => s.td, order: "count", fmt: cap },
  { key: "strait", section: "Spells", label: "Spell traits", multi: true, search: true, get: s => s.t, order: "alpha" },
  { key: "save", section: "Spells", label: "Save", multi: true, get: s => (s.sv ? [s.sv] : []), order: "count", fmt: v => SAVE_LABEL[v] || cap(v) },
  { key: "sdmg", section: "Spells", label: "Damage type", multi: true, get: s => s.dt, order: "count", fmt: cap },
  { key: "area", section: "Spells", label: "Area", multi: true, get: s => (s.ar ? [s.ar] : []), order: "count", fmt: cap },
  { key: "time", section: "Spells", label: "Casting time", multi: true, get: s => (s.tm ? [s.tm] : []), order: "count", fmt: TIME_LABEL },
];

const DS = {
  items: { rows: ITEMS, filters: ITEM_FILTERS },
  spells: { rows: SPELLS, filters: SPELL_FILTERS },
};
for (const [dsKey, ds] of Object.entries(DS)) {
  for (const f of ds.filters) {
    f.ds = dsKey;
    f.counts = countValues(ds.rows, f.get);
    let opts = [...f.counts.keys()];
    if (f.order === "alpha") opts.sort((a, b) => a.localeCompare(b));
    else if (f.order === "count") opts.sort((a, b) => f.counts.get(b) - f.counts.get(a) || a.localeCompare(b));
    else opts = f.order.filter(v => f.counts.has(v));
    f.options = opts;
    f.fmt = f.fmt || (v => v);
  }
  for (const r of ds.rows) {
    r._f = {};
    for (const f of ds.filters) r._f[f.key] = f.get(r);
    r._name = r.n.toLowerCase();
  }
}
const sectionsOf = ds => uniq(DS[ds].filters.map(f => f.section));

/* ---------- state ---------- */

const newFilters = ds => Object.fromEntries(DS[ds].filters.map(f => [f.key, { inc: [], exc: [], mode: "any" }]));
const state = {
  party: { level: 5, size: 4 },
  useWindow: true,
  relMin: -1,
  relMax: 1,
  filters: { items: newFilters("items"), spells: newFilters("spells") },
  ranges: { lvMin: "", lvMax: "", pMin: "", pMax: "", rkMin: "", rkMax: "" },
  name: "",
  tab: "overview",
  sort: { key: "l", dir: 1 },
  gold: { on: false, pct: 30, adjust: true, pp: false, topUp: false },
  amount: 5,
  unique: true,
  genKind: "both",
  loot: [],
  lootName: "",
  hideZero: false,
  preferRunes: false,
  profile: "Default",
  runed: { kind: "both", cat: "", props: "auto" },
  spRank: {},
};
let shown = PAGE;
let uid = 1;

function loadState() {
  const s = store.get("lb-state", null);
  if (!s) return;
  for (const k of ["party", "gold", "ranges"]) Object.assign(state[k], s[k] || {});
  for (const k of ["useWindow", "relMin", "relMax", "name", "tab", "amount", "unique", "genKind", "lootName", "hideZero", "sort", "preferRunes", "runed", "profile"]) if (k in s) state[k] = s[k];
  for (const dsKey of Object.keys(DS)) {
    for (const f of DS[dsKey].filters) if (s.filters && s.filters[dsKey] && s.filters[dsKey][f.key]) Object.assign(state.filters[dsKey][f.key], s.filters[dsKey][f.key]);
  }
  state.loot = (s.loot || []).filter(e => entryValid(e)).map(e => ({ ...e, uid: uid++ }));
}
const entryValid = e => (e.kind === "item" ? BY_ID.has(e.id) : e.kind === "runed" ? BASE_BY_ID.has(e.base) : SP_BY_ID.has(e.sid));
function saveState() { store.set("lb-state", { ...state, loot: state.loot.map(({ uid: _, ...e }) => e) }); }

/* ---------- tabs & columns ---------- */

const priceStr = i => (i.p ? fmtCp(i.p) + (i.per ? ` <span class="muted">/ ${i.per}</span>` : "") : "—");
const dmgStr = i => (i.wd ? `${i.wd[0]}${i.wd[1]} ${esc(i.wd[2] || "")}` : "");
const sgn = v => (v == null ? "—" : (v >= 0 ? "+" : "") + v);

function spellPrice(s, kind) {
  const rank = rankOf(s);
  const t = TPL[kind][rank];
  return t ? { cp: t.p, level: t.l } : null;
}
function rankOf(s) { return state.spRank[s.id] || s.l; }

const COL = {
  add: { label: "", cls: "addcol", cell: i => `<button class="add" title="Add to loot">+</button>` },
  n: { label: "Name", cls: "name", sort: i => i.n, cell: i => esc(i.n) },
  l: { label: "Lvl", cls: "num", sort: i => i.l, cell: i => i.l },
  c: { label: "Category", sort: i => i.c + i.sc, cell: i => `${esc(i.c)} <span class="muted">› ${esc(i.sc)}</span>` },
  ck: { label: "Consumable", sort: i => i.ck || "", cell: i => (i.ck ? esc(i.ck) : (i.k ? "" : "Permanent")) },
  p: { label: "Price", cls: "num nowrap", sort: unitCp, cell: priceStr },
  b: { label: "Bulk", cls: "num", sort: i => (i.b === "L" ? 0.1 : i.b || 0), cell: i => fmtBulk(i.b) },
  r: { label: "Rarity", sort: i => RARITY.indexOf(i.r), cell: i => `<span class="tag rar-${i.r}">${i.r === "common" ? "" : cap(i.r)}</span>` },
  traits: { label: "Traits", cls: "traits wide-s", cell: i => listCell(i.t) },
  dmg: { label: "Damage", sort: i => (i.wd ? i.wd[0] * parseInt(String(i.wd[1]).slice(1), 10) : null), cls: "nowrap", cell: i => dmgStr(i) || dash },
  grp: { label: "Group", sort: i => i.grp || "", cell: i => (i.ty === "weapon" && i.grp ? cap(i.grp) : dash) },
  rng: { label: "Range", cls: "num", sort: i => i.rng, cell: i => (i.rng ? i.rng + " ft" : dash) },
  rl: { label: "Reload", cls: "num", sort: i => (i.rl == null ? null : +i.rl), cell: i => (i.rl != null && i.rl !== "" ? esc(i.rl) : dash) },
  atype: { label: "Type", sort: i => (i.ty === "armor" ? ["Light", "Medium", "Heavy"].indexOf(i.sc) + 1 || 9 : null), cell: i => (i.ty === "armor" ? `<span class="tag armor-${esc(i.sc.toLowerCase().replace(/ /g, "-"))}">${esc(armorType(i))}</span>` : i.sh ? "Shield" : dash) },
  ac: { label: "AC", cls: "num", sort: i => (i.ar ? i.ar[0] : i.sh ? i.sh[0] : null), cell: i => (i.ar ? sgn(i.ar[0]) : i.sh ? sgn(i.sh[0]) : dash) },
  dex: { label: "Dex cap", cls: "num", sort: i => (i.ar ? i.ar[1] : null), cell: i => (i.ar && i.ar[1] != null ? sgn(i.ar[1]) : dash) },
  chk: { label: "Check", cls: "num", sort: i => (i.ar ? i.ar[2] : null), cell: i => (i.ar ? i.ar[2] : dash) },
  spd: { label: "Speed", cls: "num", sort: i => (i.ar ? i.ar[3] : null), cell: i => (i.ar ? i.ar[3] : dash) },
  str: { label: "Str", cls: "num", sort: i => (i.ar ? i.ar[4] : null), cell: i => (i.ar && i.ar[4] != null ? i.ar[4] : dash) },
  hard: { label: "Hardness / HP", cls: "num nowrap", sort: i => (i.sh ? i.sh[1] : null), cell: i => (i.sh ? `${i.sh[1]} / ${i.sh[2]}` : dash) },
  us: { label: "Usage", sort: i => i.us || "", cell: i => (i.us ? esc(titleCase(i.us)) : dash) },
  ax: { label: "Activation", sort: i => i.ax || "", cell: i => (i.ax ? esc(axLabel(i.ax)) : dash) },
  inv: { label: "Inv.", cls: "num", sort: i => i.inv || 0, cell: i => (i.inv ? "✓" : "") },
  sp: { label: "Spells granted", cls: "wide", cell: i => listCell(i.sp) },
  mat: { label: "Material", sort: i => i.mat || "", cell: i => (i.mat ? esc(titleCase(i.mat)) : dash) },

  // spells
  s_add: { label: "", cls: "addcol spadd", cell: s => {
    const hi = s.hv ? 10 : s.l, rank = rankOf(s);
    const opts = Array.from({ length: hi - s.l + 1 }, (_, k) => s.l + k).map(r => `<option value="${r}"${r === rank ? " selected" : ""}>${ordinal(r)}</option>`).join("");
    return `<select class="rk" title="Spell rank"${hi === s.l ? " disabled" : ""}>${opts}</select><button class="add" data-kind="scroll">Scroll</button><button class="add" data-kind="wand"${rank > 9 ? " disabled" : ""}>Wand</button>`;
  } },
  s_l: { label: "Rank", cls: "num", sort: s => s.l, cell: s => s.l },
  s_td: { label: "Traditions", sort: s => s.td.join(), cell: s => listCell(s.td, cap) },
  s_t: { label: "Traits", cls: "traits wide-s", cell: s => listCell(s.t) },
  s_tm: { label: "Cast", cls: "nowrap", sort: s => s.tm || "", cell: s => (s.tm ? esc(TIME_LABEL(s.tm)) : dash) },
  s_sv: { label: "Save", sort: s => s.sv || "", cell: s => (s.sv ? esc(SAVE_LABEL[s.sv] || s.sv) : dash) },
  s_dt: { label: "Damage", cell: s => listCell(s.dt, cap) },
  s_sp: { label: "Scroll", cls: "nowrap num", sort: s => spellPrice(s, "scroll")?.cp ?? null, cell: s => { const p = spellPrice(s, "scroll"); return p ? `${fmtCp(p.cp)} <span class="muted">L${p.level}</span>` : dash; } },
  s_wp: { label: "Wand", cls: "nowrap num", sort: s => spellPrice(s, "wand")?.cp ?? null, cell: s => { const p = spellPrice(s, "wand"); return p ? `${fmtCp(p.cp)} <span class="muted">L${p.level}</span>` : dash; } },
};
const TABS = [
  { id: "overview", label: "Overview", ds: "items", cols: ["add", "n", "l", "c", "ck", "p", "b", "r", "traits"] },
  { id: "weapons", label: "Weapons & ammo", ds: "items", only: i => i.ty === "weapon" || i.ty === "ammo", cols: ["add", "n", "l", "p", "b", "dmg", "grp", "rng", "rl", "mat", "traits"] },
  { id: "armor", label: "Armor & shields", ds: "items", only: i => i.ty === "armor" || i.ty === "shield", cols: ["add", "n", "l", "atype", "p", "b", "ac", "dex", "chk", "spd", "str", "hard", "mat", "traits"] },
  { id: "magic", label: "Usage & spells", ds: "items", cols: ["add", "n", "l", "p", "b", "us", "ax", "inv", "sp", "traits"] },
  { id: "runed", label: "Runed gear", ds: "runed", cols: [] },
  { id: "scrolls", label: "Scrolls & wands", ds: "spells", cols: ["s_add", "n", "s_l", "s_sp", "s_wp", "s_td", "s_tm", "s_sv", "s_dt", "s_t", "r"] },
];
const currentTab = () => TABS.find(t => t.id === state.tab) || TABS[0];
const currentDS = () => currentTab().ds;
const rowId = r => r.id;

/* ---------- filtering ---------- */

function inRanges(ds, r) {
  const g = state.ranges;
  if (ds === "items") {
    if (g.lvMin !== "" && r.l < +g.lvMin) return false;
    if (g.lvMax !== "" && r.l > +g.lvMax) return false;
    if (g.pMin !== "" && unitCp(r) < +g.pMin * 100) return false;
    if (g.pMax !== "" && unitCp(r) > +g.pMax * 100) return false;
  } else {
    if (g.rkMin !== "" && r.l < +g.rkMin) return false;
    if (g.rkMax !== "" && r.l > +g.rkMax) return false;
  }
  return true;
}

function matchesFilters(ds, r, skipKey = null) {
  if (!inRanges(ds, r)) return false;
  for (const f of DS[ds].filters) {
    if (f.key === skipKey) continue;
    const st = state.filters[ds][f.key];
    const vals = r._f[f.key];
    if (st.exc.length && vals.some(v => st.exc.includes(v))) return false;
    if (st.inc.length) {
      const ok = st.mode === "all" && f.multi ? st.inc.every(v => vals.includes(v)) : vals.some(v => st.inc.includes(v));
      if (!ok) return false;
    }
  }
  if (state.name) {
    const terms = state.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every(t => r._name.includes(t))) return false;
  }
  return true;
}

/** Option counts for one dropdown among rows passing every other choice (own choices ignored, except in All mode). */
function liveCounts(f) {
  const st = state.filters[f.ds][f.key];
  const skip = st.mode === "all" && f.multi && st.inc.length ? null : f.key;
  const m = new Map();
  for (const r of DS[f.ds].rows) {
    if (!matchesFilters(f.ds, r, skip)) continue;
    for (const v of r._f[f.key]) m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}
const filtered = ds => DS[ds].rows.filter(r => matchesFilters(ds, r));

/* ---------- dropdown UI ---------- */

let openDD = null;

function ddSummary(f) {
  const st = state.filters[f.ds][f.key];
  if (!st.inc.length && !st.exc.length) return "Any";
  const parts = [];
  if (st.inc.length) parts.push(st.inc.map(f.fmt).join(st.mode === "all" && f.multi ? " + " : " / "));
  if (st.exc.length) parts.push(st.exc.map(v => "not " + f.fmt(v)).join(", "));
  return parts.join("; ");
}

function buildFilterBar() {
  const ds = currentDS();
  if (ds === "runed") return;
  const bar = document.getElementById("filterBar");
  bar.innerHTML = "";
  const rows = {};
  for (const s of sectionsOf(ds)) {
    const row = document.createElement("div");
    row.className = "filter-row";
    row.innerHTML = `<span class="filter-sec">${s}</span>`;
    bar.appendChild(row);
    rows[s] = row;
  }
  for (const f of DS[ds].filters) {
    const wrap = document.createElement("div");
    wrap.className = "dd";
    const st = state.filters[ds][f.key];
    const btn = document.createElement("button");
    btn.className = "dd-btn" + (st.inc.length || st.exc.length ? " active" : "");
    btn.innerHTML = `<span class="lbl">${f.label}:</span> <span class="sum"></span> <span class="caret">▼</span>`;
    btn.querySelector(".sum").textContent = ddSummary(f);
    btn.addEventListener("click", e => { e.stopPropagation(); toggleDD(f, wrap); });
    wrap.appendChild(btn);
    rows[f.section].appendChild(wrap);
    f._wrap = wrap;
  }
}

function toggleDD(f, wrap) {
  const wasOpen = openDD && openDD.f === f;
  closeDD();
  if (wasOpen) return;
  const panel = document.createElement("div");
  panel.className = "dd-panel";
  panel.addEventListener("click", e => e.stopPropagation());
  const st = state.filters[f.ds][f.key];

  const tools = document.createElement("div");
  tools.className = "dd-tools";
  if (f.multi) {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.title = "Any: match at least one checked value. All: match every checked value.";
    for (const m of ["any", "all"]) {
      const b = document.createElement("button");
      b.textContent = m === "any" ? "Any" : "All";
      b.className = st.mode === m ? "on" : "";
      b.addEventListener("click", () => { st.mode = m; seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderList(); onFiltersChanged(); });
      seg.appendChild(b);
    }
    tools.appendChild(seg);
  } else {
    tools.appendChild(document.createElement("span"));
  }
  const clr = document.createElement("button");
  clr.className = "ghost";
  clr.textContent = "Clear";
  clr.addEventListener("click", () => { st.inc = []; st.exc = []; renderList(); onFiltersChanged(); });
  tools.appendChild(clr);
  panel.appendChild(tools);

  const hint = document.createElement("div");
  hint.className = "dd-hint dd-hint-row";
  hint.innerHTML = `<span>Click once to require, twice to exclude.</span>
    <label title="Hide options that would leave no results with the other filters"><input type="checkbox"${state.hideZero ? " checked" : ""}> Hide unavailable</label>`;
  hint.querySelector("input").addEventListener("change", e => { state.hideZero = e.target.checked; saveState(); renderList(); });
  panel.appendChild(hint);

  let search = null;
  let checkAll = null;
  let shownRest = [];
  if (f.search) {
    search = document.createElement("input");
    search.type = "search";
    search.placeholder = `Search ${f.label.toLowerCase()}…`;
    search.addEventListener("input", renderList);
    panel.appendChild(search);
    checkAll = document.createElement("button");
    checkAll.className = "ghost check-all";
    checkAll.addEventListener("click", () => {
      for (const v of shownRest) if (!st.inc.includes(v) && !st.exc.includes(v)) st.inc.push(v);
      st.mode = "any";
      panel.querySelectorAll(".seg button").forEach((b, i) => b.classList.toggle("on", i === 0));
      renderList();
      onFiltersChanged();
    });
    panel.appendChild(checkAll);
  }
  const limits = document.createElement("div");
  limits.className = "dd-hint dd-limits";
  panel.appendChild(limits);
  const list = document.createElement("div");
  list.className = "dd-list";
  panel.appendChild(list);
  const capNote = document.createElement("div");
  capNote.className = "dd-hint";
  panel.appendChild(capNote);

  function renderList() {
    list.innerHTML = "";
    const q = search ? search.value.trim().toLowerCase() : "";
    let lastGroup = null;
    const live = liveCounts(f);
    const others = DS[f.ds].filters.filter(o => o !== f && (state.filters[f.ds][o.key].inc.length || state.filters[f.ds][o.key].exc.length)).map(o => o.label);
    if (state.name) others.push("name search");
    limits.innerHTML = "Counts limited to " + (others.length ? `your other filters: <b>${esc(others.join(", "))}</b>` : "the level/price range");
    const checked = f.options.filter(v => st.inc.includes(v) || st.exc.includes(v));
    const matching = f.options.filter(v => !checked.includes(v) && (!q || f.fmt(v).toLowerCase().includes(q)));
    const available = matching.filter(v => live.get(v));
    const unavailable = state.hideZero ? [] : matching.filter(v => !live.get(v));
    const ordered = [...available, ...unavailable];
    const rest = ordered.slice(0, DD_RENDER_CAP);
    shownRest = q ? available : [];
    if (checkAll) {
      checkAll.hidden = !q || !available.length;
      checkAll.textContent = `Require any of the ${available.length.toLocaleString()} matching “${q}”`;
    }
    capNote.hidden = ordered.length <= DD_RENDER_CAP;
    capNote.textContent = `${(ordered.length - DD_RENDER_CAP).toLocaleString()} more — type to narrow the list.`;
    for (const v of [...checked, ...rest]) {
      const zero = !live.get(v);
      if (zero && !checked.includes(v)) {
        if (lastGroup !== "__none") {
          const gh = document.createElement("div");
          gh.className = "dd-group";
          gh.textContent = "No results with current filters";
          list.appendChild(gh);
          lastGroup = "__none";
        }
      }
      const row = document.createElement("button");
      const s = st.inc.includes(v) ? "inc" : st.exc.includes(v) ? "exc" : "";
      row.className = "dd-opt " + s + (zero ? " zero" : "");
      row.innerHTML = `<span class="box">${s === "inc" ? "✓" : s === "exc" ? "✕" : ""}</span><span class="name"></span><span class="cnt">${live.get(v) || 0}</span>`;
      row.querySelector(".name").textContent = f.fmt(v);
      row.title = f.fmt(v);
      row.addEventListener("click", () => {
        if (st.inc.includes(v)) { st.inc = st.inc.filter(x => x !== v); st.exc.push(v); }
        else if (st.exc.includes(v)) st.exc = st.exc.filter(x => x !== v);
        else st.inc.push(v);
        renderList();
        onFiltersChanged();
      });
      list.appendChild(row);
    }
  }
  renderList();
  wrap.appendChild(panel);
  openDD = { f, panel };
  if (search) search.focus();
}

function closeDD() {
  if (openDD) { openDD.panel.remove(); openDD = null; }
}

function refreshDDButtons() {
  for (const f of DS[currentDS()].filters) {
    const st = state.filters[f.ds][f.key];
    const btn = f._wrap && f._wrap.querySelector(".dd-btn");
    if (!btn) continue;
    btn.classList.toggle("active", !!(st.inc.length || st.exc.length));
    btn.querySelector(".sum").textContent = ddSummary(f);
  }
}

function onFiltersChanged() {
  refreshDDButtons();
  shown = PAGE;
  renderTable();
  saveState();
}

/* ---------- range controls ---------- */

function renderRanges() {
  const el = document.getElementById("rangeControls");
  if (currentDS() === "runed") { el.innerHTML = ""; return; }
  const g = state.ranges;
  if (currentDS() === "items") {
    const lv = key => `<select data-range="${key}"><option value="">Any</option>${Array.from({ length: MAX_ITEM_LEVEL + 1 }, (_, i) => `<option value="${i}"${String(g[key]) === String(i) ? " selected" : ""}>${i}</option>`).join("")}</select>`;
    el.innerHTML = `<label>Level ${lv("lvMin")} to ${lv("lvMax")}</label>
      <label>Price <input type="number" min="0" step="any" data-range="pMin" placeholder="min gp" value="${esc(g.pMin)}"> to <input type="number" min="0" step="any" data-range="pMax" placeholder="max gp" value="${esc(g.pMax)}"></label>`;
  } else {
    const rk = key => `<select data-range="${key}"><option value="">Any</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}"${String(g[key]) === String(i + 1) ? " selected" : ""}>${ordinal(i + 1)}</option>`).join("")}</select>`;
    el.innerHTML = `<label>Spell rank ${rk("rkMin")} to ${rk("rkMax")}</label>`;
  }
}

/* ---------- table ---------- */

function renderTabs() {
  document.getElementById("tabs").innerHTML = TABS.map(t =>
    `<button class="tab${t.id === currentTab().id ? " on" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
}

function renderTable() {
  const tab = currentTab();
  if (tab.ds === "runed") { document.getElementById("matchCount").textContent = `${BASES.length} base items, ${PROP_RUNES.length} property runes`; return; }
  if (!tab.cols.includes(state.sort.key) || !COL[state.sort.key].sort) state.sort = { key: tab.ds === "spells" ? "s_l" : "l", dir: 1 };
  const rows = filtered(tab.ds).filter(tab.only || (() => true));
  const { key, dir } = state.sort;
  const val = COL[key].sort;
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || y == null) return (x == null) - (y == null) || a.n.localeCompare(b.n);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || a.n.localeCompare(b.n);
  });
  document.getElementById("matchCount").textContent = `${rows.length.toLocaleString()} match`;
  document.getElementById("thead").innerHTML = "<tr>" + tab.cols.map(id => {
    const col = COL[id];
    const cls = [col.cls, col.sort ? "sortable" : "", id === key ? "sorted" + (dir < 0 ? " desc" : "") : ""].filter(Boolean).join(" ");
    return `<th${col.sort ? ` data-sort="${id}"` : ""} class="${cls}">${col.label}</th>`;
  }).join("") + "</tr>";
  document.getElementById("tbody").innerHTML = rows.slice(0, shown).map(r =>
    `<tr data-id="${esc(rowId(r))}"${tab.ds === "items" && isOwned(r) ? ' class="owned" title="Owned by the party"' : ""}>` + tab.cols.map(id => `<td class="${COL[id].cls || ""}">${COL[id].cell(r)}</td>`).join("") + "</tr>"
  ).join("");
  const more = document.getElementById("moreBtn");
  more.hidden = rows.length <= shown;
  more.textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
}

/* ---------- loot list ---------- */

function entryInfo(e) {
  if (e.kind === "item") {
    const it = BY_ID.get(e.id);
    const per = it.per || 1;
    return { name: it.n, level: it.l, cp: Math.round(it.p * e.qty / per), bulk: (it.b === "L" ? 0.1 : it.b || 0) * e.qty / per, consumable: !!it.k, row: it };
  }
  if (e.kind === "runed") {
    const { b, runes } = runedParts(e);
    return { name: runedName(e), level: Math.max(...runes.map(r => r.l), 0), cp: (b.p + runes.reduce((n, r) => n + r.p, 0)) * e.qty,
      bulk: (b.b === "L" ? 0.1 : b.b || 0) * e.qty, consumable: false, row: { runed: true, e, b, runes } };
  }
  const s = SP_BY_ID.get(e.sid);
  const t = TPL[e.kind][e.rank];
  return { name: `${e.kind === "scroll" ? "Scroll" : "Wand"} of ${s.n} (Rank ${e.rank})`, level: t.l, cp: t.p * e.qty, bulk: e.kind === "scroll" ? 0.1 * e.qty : 0.1 * e.qty, consumable: e.kind === "scroll", row: s };
}

function addEntry(entry, n = 1) {
  const ex = entry.kind !== "runed" && state.loot.find(e => e.kind === entry.kind && e.id === entry.id && e.sid === entry.sid && e.rank === entry.rank);
  if (ex) ex.qty += n * (entry.step || 1);
  else state.loot.push({ ...entry, qty: n * (entry.step || 1), uid: uid++ });
}
const addItem = (id, n = 1) => addEntry({ kind: "item", id, step: BY_ID.get(id).per || 1 }, n);
const addSpellItem = (sid, kind, rank, n = 1) => addEntry({ kind, sid, rank }, n);

function suggested() {
  return TREASURE[state.party.level - 1];
}
const sumCounts = txt => [...txt.matchAll(/:\s*(\d+)/g)].reduce((a, m) => a + +m[1], 0);

/** Currency the party should have received at the start of this level (levels 1..L-1), with the per-PC adjustment. */
function expectedCurrency() {
  const extra = state.gold.adjust ? state.party.size - 4 : 0;
  return TREASURE.slice(0, state.party.level - 1).reduce((a, r) => a + r.cur + r.pc * extra, 0);
}

function goldBreakdown() {
  if (!state.gold.on) return null;
  const t = suggested();
  let base = t.cur + (state.gold.adjust ? t.pc * (state.party.size - 4) : 0);
  let note = "";
  const w = wealth();
  if (state.gold.topUp && w) {
    const exp = expectedCurrency();
    base = Math.max(0, base + exp - w.gp);
    note = `level ${t.l} currency ${exp - w.gp >= 0 ? "+" : "−"} ${Math.abs(Math.round(exp - w.gp)).toLocaleString()} gp (party has ${w.gp.toLocaleString()} of ${Math.round(exp).toLocaleString()} expected)`;
  }
  const gp = Math.max(0, Math.round(base * state.gold.pct / 100));
  return { gp, base: Math.round(base), note, coins: state.gold.pp ? { pp: Math.floor(gp / 10), gp: gp % 10 } : { gp } };
}
const coinsStr = c => [c.pp && c.pp.toLocaleString() + " pp", (c.gp || !c.pp) && (c.gp || 0).toLocaleString() + " gp"].filter(Boolean).join(" ");

function renderSuggested() {
  const t = suggested();
  const hasRunes = wealth() && (wealth().runes || []).length;
  document.getElementById("suggested").innerHTML = `
    <div class="sug"><b>Suggested at level ${t.l}</b> (party of 4): total ${t.total.toLocaleString()} gp, of which currency ${t.cur.toLocaleString()} gp
      (+${t.pc.toLocaleString()} gp per extra PC)</div>
    <div class="sug muted">Permanent: ${esc(t.perm.replace(/\s+:/g, ""))} · Consumables: ${esc(t.cons.replace(/\s+:/g, ""))}</div>
    ${hasRunes ? runeBaselineHtml(t) : ""}`;
  const pr = document.getElementById("preferRunes");
  if (pr) pr.addEventListener("change", e => { state.preferRunes = e.target.checked; saveState(); });
  const fr = document.getElementById("fillRunes");
  if (fr) fr.addEventListener("click", () => { for (const [c, s] of pendingGaps()) addGapEntries(gapEntries(c, s)); renderLoot(); });
}

function renderLoot() {
  const list = document.getElementById("lootList");
  list.innerHTML = "";
  let cp = 0, bulk = 0, perm = 0, cons = 0;
  for (const e of state.loot) {
    const info = entryInfo(e);
    cp += info.cp;
    bulk += info.bulk;
    if (info.consumable) cons += e.qty; else perm += e.qty;
    const li = document.createElement("li");
    li.className = "enc-item";
    const rel = info.level - state.party.level;
    li.innerHTML = `
      <div class="enc-name" title="${esc(info.name)}">${esc(info.name)}</div>
      <div class="enc-xp">${fmtCp(info.cp)}</div>
      <div class="enc-ctrl">
        <span class="lvl">Lvl ${info.level} · ${rel === 0 ? "party" : rel > 0 ? "party +" + rel : "party " + rel}${info.consumable ? " · consumable" : ""}</span>
        <span class="spacer"></span>
        <button class="dec" title="One fewer">−</button><span class="count">${e.qty}</span><button class="inc" title="One more">+</button>
        <button class="rm ghost" title="Remove">×</button>
      </div>`;
    li.querySelector(".enc-name").addEventListener("click", () => openDrawer(info.row, e));
    const step = e.kind === "item" ? (BY_ID.get(e.id).per || 1) : 1;
    if (e.kind === "runed") li.querySelector(".inc").hidden = true;
    li.querySelector(".dec").addEventListener("click", () => { e.qty -= step; if (e.qty <= 0) state.loot = state.loot.filter(x => x !== e); renderLoot(); });
    li.querySelector(".inc").addEventListener("click", () => { e.qty += step; renderLoot(); });
    li.querySelector(".rm").addEventListener("click", () => { state.loot = state.loot.filter(x => x !== e); renderLoot(); });
    list.appendChild(li);
  }
  document.getElementById("lootEmpty").hidden = state.loot.length > 0;
  if (wealth() && (wealth().runes || []).length && !document.activeElement?.closest?.("#suggested")) renderSuggested();
  const g = goldBreakdown();
  const t = suggested();
  const total = cp + (g ? g.gp * 100 : 0);
  document.getElementById("totals").innerHTML = `
    ${g ? `<div class="trow"><span>Gold</span><b>${coinsStr(g.coins)}</b><span class="muted">${state.gold.pct}% of ${g.base.toLocaleString()} gp${g.note ? " (" + esc(g.note) + ")" : ""}</span></div>` : ""}
    <div class="trow"><span>Items</span><b>${fmtCp(cp)}</b><span class="muted">${perm} permanent · ${cons} consumable · ${fmtBulkSum(bulk)}</span></div>
    <div class="trow"><span>Total value</span><b>${fmtCp(total)}</b><span class="muted">suggested ${t.total.toLocaleString()} gp</span></div>
    <div class="trow muted"><span>Item counts</span><span>permanent ${perm} / ${sumCounts(t.perm)}</span><span>consumable ${cons} / ${sumCounts(t.cons)}</span></div>`;
  saveState();
}

/* ---------- random loot ---------- */

const windowOk = level => !state.useWindow || (level - state.party.level >= state.relMin && level - state.party.level <= state.relMax);

function say(msg, bad = false) {
  const el = document.getElementById("genMsg");
  el.hidden = !msg;
  el.textContent = msg;
  el.style.color = bad ? "" : "var(--muted)";
}

function sample(pool, n, unique) {
  if (!unique) return Array.from({ length: n }, () => pick(pool));
  const a = pool.slice(), out = [];
  while (out.length < n && a.length) out.push(a.splice(rnd(a.length), 1)[0]);
  return out;
}

function randomItems() {
  const have = new Set(state.loot.filter(e => e.kind === "item").map(e => e.id));
  let pool = filtered("items").filter(i => windowOk(i.l) && i.p > 0); // priceless items (artifacts etc.) are added by hand only
  if (state.unique) pool = pool.filter(i => !have.has(i.id));
  pool = pool.filter(i => !isOwned(i));
  if (!pool.length && !state.preferRunes) return say("No items match the filters" + (state.useWindow ? " inside the party level window." : "."), true);
  let first = 0;
  if (state.preferRunes) {
    // missing upgrades go first (same base item as the character's gear), the rest is random
    for (const [c, s] of pendingGaps()) {
      if (first >= state.amount) break;
      const list = gapEntries(c, s);
      addGapEntries(list);
      first += list.length;
    }
  }
  const got = sample(pool, state.amount - first, state.unique);
  for (const i of got) addItem(i.id);
  const total = first + got.length;
  say(total < state.amount ? `Only ${total} matching item(s) available.` : `Added ${total} item(s)${first ? ` (${first} missing rune${first > 1 ? "s" : ""})` : ` from ${pool.length.toLocaleString()} candidates`}.`);
}

/** (spell, kind, rank) options: spell chosen uniformly first so heightenable spells are not favoured. */
function spellOptions(spell) {
  const out = [];
  const kinds = state.genKind === "both" ? ["scroll", "wand"] : [state.genKind];
  const g = state.ranges;
  for (const kind of kinds) {
    for (let r = spell.l; r <= (spell.hv ? 10 : spell.l); r++) {
      const t = TPL[kind][r];
      if (!t || !windowOk(t.l)) continue;
      if (g.rkMin !== "" && r < +g.rkMin) continue;
      if (g.rkMax !== "" && r > +g.rkMax) continue;
      out.push({ kind, rank: r });
    }
  }
  return out;
}

function randomSpells() {
  const pool = filtered("spells").map(s => ({ s, opts: spellOptions(s) })).filter(x => x.opts.length);
  if (!pool.length) return say("No spells match the filters" + (state.useWindow ? " at the party level window." : "."), true);
  const got = sample(pool, state.amount, state.unique);
  for (const x of got) { const o = pick(x.opts); addSpellItem(x.s.id, o.kind, o.rank); }
  say(got.length < state.amount ? `Only ${got.length} matching spell(s) available.` : `Added ${got.length} scroll/wand item(s).`);
}

function randomRuned() {
  let n = 0;
  for (let i = 0; i < state.amount; i++) {
    const e = rollRuned();
    if (!e) break;
    state.loot.push({ ...e, qty: 1, uid: uid++ });
    n++;
  }
  say(n ? `Added ${n} runed item(s).` : "Could not build runed gear in the party level window; widen it or change the category.", !n);
}

function generate() {
  if (currentDS() === "spells") randomSpells(); else if (currentDS() === "runed") randomRuned(); else randomItems();
  renderLoot();
}

/* ---------- descriptions (data/desc/<group>.js, loaded on demand) ---------- */

window.LB_DESC = window.LB_DESC || {};
window.LB_DESC_ADD = blocks => Object.assign(window.LB_DESC, blocks);
const shardLoads = new Map();
function loadDesc(group) {
  if (!shardLoads.has(group)) {
    shardLoads.set(group, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = `data/desc/${encodeURIComponent(group)}.js`;
      el.onload = resolve;
      el.onerror = () => { shardLoads.delete(group); reject(new Error("missing shard " + group)); };
      document.head.appendChild(el);
    }));
  }
  return shardLoads.get(group);
}

function openDrawer(row, entry) {
  if (row.runed) {
    const body = document.getElementById("drawerBody");
    body.dataset.id = "runed";
    body.innerHTML = `<div class="sb"><h3>${esc(runedName(row.e))}</h3>
      <div class="sub">${esc(row.b.ty === "weapon" ? "Weapon" : "Armor")} · base ${esc(row.b.n)} (${fmtCp(row.b.p)}) · item level ${Math.max(...row.runes.map(r => r.l), 0)}</div>
      <dl>${row.runes.map(r => `<dt>${esc(r.n)}</dt><dd>level ${r.l} · ${fmtCp(r.p)}</dd>`).join("")}</dl>
      <p class="note">Price is base plus all runes. In Foundry the macro imports the base item and sets these runes on it.</p></div>`;
    document.getElementById("drawer").hidden = false;
    return;
  }
  const isSpell = !("c" in row);
  const key = row.id;
  const group = isSpell ? "spells" : row.dg;
  const body = document.getElementById("drawerBody");
  const meta = isSpell
    ? `Spell · rank ${row.l} · ${row.td.map(cap).join(", ") || "no tradition"}${row.hv ? " · heightenable" : ""}`
    : `${esc(row.c)} › ${esc(row.sc)} · Level ${row.l}`;
  const facts = isSpell
    ? [["Cast", row.tm ? TIME_LABEL(row.tm) : "—"], ["Save", row.sv ? (SAVE_LABEL[row.sv] || row.sv) : "—"], ["Damage", row.dt.map(cap).join(", ") || "—"]]
    : [["Price", priceStr(row)], ["Bulk", row.b == null ? "—" : row.b === 0 ? "—" : row.b], ["Usage", row.us ? titleCase(row.us) : "—"]];
  const render = (html, msg) => {
    body.innerHTML = `<div class="sb">
      <div class="sb-actions">${isSpell
        ? `<button id="dAddScroll" class="primary">Add scroll</button><button id="dAddWand">Add wand</button>`
        : `<button id="dAdd" class="primary">Add to loot</button>`}</div>
      <h3>${esc(row.n)}</h3>
      <div class="sub">${meta}${row.r && row.r !== "common" ? ` · <span class="tag rar-${row.r}">${cap(row.r)}</span>` : ""}</div>
      <p class="sb-traits">${(row.t || []).map(t => `<span class="tag">${esc(t)}</span>`).join(" ")}</p>
      <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}${!isSpell && row.sp ? `<dt>Spells</dt><dd>${esc(row.sp.join(", "))}</dd>` : ""}</dl>
      <div class="sb-text">${html || ""}</div>
      ${msg ? `<p class="note">${msg}</p>` : ""}
    </div>`;
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener("click", fn); };
    on("dAdd", () => { addItem(row.id); renderLoot(); });
    on("dAddScroll", () => { addSpellItem(row.id, "scroll", rankOf(row)); renderLoot(); });
    on("dAddWand", () => { if (rankOf(row) <= 9) { addSpellItem(row.id, "wand", rankOf(row)); renderLoot(); } });
  };
  body.dataset.id = key;
  render(window.LB_DESC[key], window.LB_DESC[key] ? "" : "Loading description…");
  document.getElementById("drawer").hidden = false;
  body.parentElement.scrollTop = 0;
  if (!window.LB_DESC[key]) {
    loadDesc(group).then(() => { if (body.dataset.id === key) render(window.LB_DESC[key], window.LB_DESC[key] ? "" : "No description."); })
      .catch(() => { if (body.dataset.id === key) render("", "Description file missing. Rerun build_data.py."); });
  }
}

/* ---------- saves ---------- */

function refreshSaves() {
  const saves = store.get(savesKey(), {});
  document.getElementById("loadSelect").innerHTML = `<option value="">Load saved…</option>` +
    Object.keys(saves).sort().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
}
const snapshot = () => ({ party: { ...state.party }, gold: { ...state.gold }, loot: state.loot.map(({ uid: _, ...e }) => e) });
function applySnapshot(s) {
  Object.assign(state.party, s.party || {});
  Object.assign(state.gold, s.gold || {});
  state.loot = (s.loot || []).filter(entryValid).map(e => ({ ...e, uid: uid++ }));
  syncControls();
  renderSuggested();
  renderLoot();
}

/* ---------- fundamental rune baseline (GM Core, Automatic Bonus Progression table; used only as an inventory target) ---------- */


const ordPlus = n => (n ? "+" + n : "");
const strikingLabel = (t, armor) => (t ? (armor ? ["Resilient", "Greater Resilient", "Major Resilient"] : ["Striking", "Greater Striking", "Major Striking"])[t - 1] : "");
const slugOf = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normRune = s => String(s).toLowerCase().replace(/[()]/g, "").split(/[\s-]+/).filter(Boolean).sort().join(" ");
const RUNE_BY_NORM = new Map(RUNES.map(r => [normRune(r.n), r]));
const findBase = d => d && (BASES.find(b => b.u === d.u) || BASES.find(b => slugOf(b.n) === d.b));
const gearLabel = (have, armor, d) => [ordPlus(have.pot), strikingLabel(have.fun, armor), d ? d.n : (armor ? "no armor" : "no weapon")].filter(Boolean).join(" ");

/**
 * Per character: for weapon and armor, what they have vs. what the level baseline wants (fundamental runes only).
 * [{ name, slots: [{ slot, armor, desc, base, have, want, need }] }]; "need" is cleared once a runed entry for that slot is in the loot list.
 */
function charGaps() {
  const w = wealth();
  if (!w || !w.runes || !w.runes.length) return [];
  const L = state.party.level;
  return w.runes.map(r => ({
    name: r.n,
    slots: [["weapon", "wp", "ws", r.w, false], ["armor", "ap", "ar", r.a, true]].map(([slot, pk, fk, desc, armor]) => {
      const tp = tierAt(FUND_STEPS[pk], L), tf = tierAt(FUND_STEPS[fk], L);
      const have = { pot: r[pk], fun: r[fk] };
      const want = { pot: Math.max(have.pot, tp), fun: Math.max(have.fun, tf) };
      const short = have.pot < tp || have.fun < tf;
      const done = state.loot.some(x => x.kind === "runed" && x.forChar === r.n && x.slot === slot);
      return { slot, armor, desc, base: findBase(desc), have, want, need: short && !done, short };
    }),
  }));
}

/** Loot entries that close one character's gap: the same base item with the missing runes (existing property runes kept). */
function gapEntries(c, s) {
  if (s.base) {
    const props = (s.desc.props || []).map(n => RUNE_BY_NORM.get(normRune(n))).filter(r => r && propRunesFor(s.base).includes(r)).map(r => r.id);
    return [{ kind: "runed", base: s.base.id, pot: s.want.pot, fun: s.want.fun, props, forChar: c.name, slot: s.slot, qty: 1 }];
  }
  // no known base item (nothing carried, or a specific magic item): hand out the loose runes instead
  const pk = s.armor ? "ap" : "wp", fk = s.armor ? "ar" : "ws";
  const out = [];
  if (s.want.pot > s.have.pot) out.push({ kind: "item", id: RUNE_BY_NAME.get(FUND_NAMES[pk][s.want.pot - 1]).id, qty: 1, step: 1 });
  if (s.want.fun > s.have.fun) out.push({ kind: "item", id: RUNE_BY_NAME.get(FUND_NAMES[fk][s.want.fun - 1]).id, qty: 1, step: 1 });
  return out;
}
function addGapEntries(list) {
  for (const x of list) {
    if (x.kind === "runed") state.loot.push({ ...x, uid: uid++ });
    else addEntry(x);
  }
}
const pendingGaps = () => charGaps().flatMap(c => c.slots.filter(s => s.need).map(s => [c, s]));

function runeBaselineHtml(t) {
  const L = state.party.level;
  const cg = charGaps();
  const exp = (pk, fk, armor) => [ordPlus(tierAt(FUND_STEPS[pk], L)), strikingLabel(tierAt(FUND_STEPS[fk], L), armor)].filter(Boolean).join(" ") || "none";
  const pending = pendingGaps().length;
  return `<div class="runegap"><div class="rg-head"><b>Rune baseline, level ${t.l}</b></div>
    <div class="rg-exp muted">Expected: weapon ${esc(exp("wp", "ws", false))} · armor ${esc(exp("ap", "ar", true))}</div>
    ${cg.map(c => `<div class="rg-char"><div class="rg-name">${esc(c.name)}</div>${c.slots.map(s => `
      <div class="rg-line ${s.short ? (s.need ? "gap" : "filled") : "ok"}"><span class="rg-slot">${s.armor ? "Armor" : "Weapon"}</span>
        <span class="rg-have">${esc(gearLabel(s.have, s.armor, s.desc))}</span>
        ${s.short ? `<span class="rg-to">${s.need ? "→ needs " : "✓ added "}<b>${esc([ordPlus(s.want.pot), strikingLabel(s.want.fun, s.armor)].filter(Boolean).join(" "))}</b>${s.base ? "" : `<span class="muted"> (loose runes)</span>`}</span>` : `<span class="rg-to">✓</span>`}
      </div>`).join("")}</div>`).join("")}
    <label class="check"><input type="checkbox" id="preferRunes"${state.preferRunes ? " checked" : ""}> Prefer missing runes in random loot</label>
    ${pending ? `<button id="fillRunes" class="ghost">Add missing upgrades (${pending})</button>` : `<span class="muted">No gaps.</span>`}</div>`;
}

/* ---------- profiles: one per Foundry world/campaign (party data, owned items, saved loot lists) ---------- */

const profiles = () => store.get("lb-profiles", {});
const curProfile = () => profiles()[state.profile] || {};
function updateProfile(fn, name = state.profile) {
  const all = profiles();
  all[name] = all[name] || {};
  fn(all[name]);
  store.set("lb-profiles", all);
}
const savesKey = (name = state.profile) => "lb-saves:" + name;
const GOLD_DEFAULT = { on: false, pct: 30, adjust: true, pp: false, topUp: false };

/** First run after the profile feature: the existing single-campaign data becomes the "Default" profile. */
function initProfiles() {
  if (!store.get("lb-profiles", null)) {
    store.set("lb-profiles", { Default: { owned: store.get("lb-owned", []), wealth: store.get("lb-wealth", null) } });
    store.set(savesKey("Default"), store.get("lb-saves", {}));
  }
  if (!profiles()[state.profile]) updateProfile(() => {});
}

function switchProfile(name) {
  if (name === state.profile) return;
  updateProfile(p => { p.party = { ...state.party }; p.gold = { ...state.gold }; p.loot = state.loot.map(({ uid: _, ...e }) => e); p.lootName = state.lootName; });
  state.profile = name;
  updateProfile(() => {}, name);
  const p = profiles()[name];
  state.party = { level: 5, size: 4, ...(p.party || {}) };
  state.gold = { ...GOLD_DEFAULT, ...(p.gold || {}) };
  state.loot = (p.loot || []).filter(entryValid).map(e => ({ ...e, uid: uid++ }));
  state.lootName = p.lootName || "";
  saveState();
  refreshProfileUI();
}

function refreshProfileUI() {
  const names = Object.keys(profiles()).sort((x, y) => x.localeCompare(y));
  const sel = document.getElementById("profile");
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = state.profile;
  document.getElementById("profileDel").disabled = names.length < 2;
  syncControls();
  loadOwned();
  refreshSaves();
  renderSuggested();
  renderLoot();
  renderTable();
}

/* ---------- owned items (blacklist from the players' inventories) ---------- */

const OWNED_MACRO = String.raw`// PF2e Loot Builder: list the permanent items, currency and fundamental runes owned by the characters in the "The Party" actor folder.
// pf2e keeps the party in a Party actor (the special "The Party" entry); fall back to a plain actor folder of that name
const party = game.actors.party ?? game.actors.find(a => a.type === "party");
let characters;
if (party) {
  characters = party.members.filter(a => a.type === "character");
} else {
  const root = game.folders.find(f => f.type === "Actor" && f.name.toLowerCase().replace(/^the /, "") === "party");
  if (!root) return ui.notifications.error("No Party actor or \"The Party\" actor folder found.");
  const ids = new Set([root.id, ...root.getSubfolders(true).map(f => f.id)]);
  characters = game.actors.filter(a => a.type === "character" && ids.has(a.folder?.id));
}
if (!characters.length) return ui.notifications.error("The party has no characters.");
const owned = new Map();
let coinsGp = 0, members = 0;
const runes = [];
for (const a of characters) {
  members++;
  // best fundamental runes among carried (not stowed) weapons and armor
  const r = { n: a.name, wp: 0, ws: 0, ap: 0, ar: 0, w: null, a: null };
  // the gear's base item (so the builder can offer the upgrade on the same chassis) and its property rune names
  const gear = (i, type) => {
    const tbl = CONFIG.PF2E?.runes?.[type]?.property ?? {};
    const src = i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? "";
    return { n: i.name, b: i.system?.baseItem ?? null, u: src.split(".").pop(),
      props: (i.system?.runes?.property ?? []).map(k => game.i18n.localize(tbl[k]?.name ?? k)) };
  };
  for (const i of a.items) {
    if (i.system?.equipped?.carryType === "stowed") continue;
    const ru = i.system?.runes ?? {};
    if (i.type === "weapon" && ((ru.potency ?? 0) * 10 + (ru.striking ?? 0)) >= r.wp * 10 + r.ws) { r.wp = ru.potency ?? 0; r.ws = ru.striking ?? 0; r.w = gear(i, "weapon"); }
    if (i.type === "armor" && ((ru.potency ?? 0) * 10 + (ru.resilient ?? 0)) >= r.ap * 10 + r.ar) { r.ap = ru.potency ?? 0; r.ar = ru.resilient ?? 0; r.a = gear(i, "armor"); }
  }
  runes.push(r);
  const c = a.inventory?.coins;
  coinsGp += c ? (c.goldValue ?? ((c.pp ?? 0) * 10 + (c.gp ?? 0) + (c.sp ?? 0) / 10 + (c.cp ?? 0) / 100)) : 0;
  for (const i of a.items) {
    if (["spell", "feat", "action", "lore", "effect", "condition", "ancestry", "heritage", "background", "class", "deity", "melee", "spellcastingEntry", "treasure"].includes(i.type) || i.type === "consumable") continue;
    const traits = i.system?.traits?.value ?? [];
    if (traits.includes("consumable") || traits.includes("scroll") || traits.includes("wand")) continue;
    const src = i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? "";
    const u = src.split(".").pop();
    owned.set(i.name + "|" + u, { n: i.name, u: /^[A-Za-z0-9]{16}$/.test(u) ? u : "" });
  }
}
coinsGp = Math.round(coinsGp * 100) / 100;
const text = JSON.stringify({ lootBuilderOwned: [...owned.values()], coinsGp, members, runes, world: game.world?.title ?? null, partyName: party?.name ?? null });
await game.clipboard.copyPlainText(text);
ui.notifications.info("Copied " + owned.size + " owned item(s) and " + coinsGp + " gp of party currency and the runes of " + members + " characters to the clipboard.");`;

let owned = { ids: new Set(), names: new Set() };
function loadOwned() {
  const o = curProfile().owned || [];
  owned = { ids: new Set(o.map(x => x.u).filter(Boolean)), names: new Set(o.map(x => x.n.toLowerCase())) };
  document.getElementById("ownedCount").textContent = o.length;
}
/** Permanent items only: consumables (and scrolls/wands) are never blacklisted. */
const wealth = () => curProfile().wealth || null;
const isOwned = i => !i.k && (owned.ids.has(i.u) || owned.names.has(i._name));

/* ---------- Foundry export ---------- */

function lootSummary() {
  const name = document.getElementById("lootName").value.trim() || `Loot L${state.party.level}`;
  const entries = state.loot.map(e => {
    if (e.kind === "item") {
      const it = BY_ID.get(e.id);
      return { kind: "item", name: it.n, id: it.u, qty: e.qty };
    }
    if (e.kind === "runed") {
      const { b, runes } = runedParts(e);
      return { kind: "runed", name: runedName(e), id: b.u, bname: b.n, ty: b.ty, pot: e.pot, fun: e.fun, props: e.props.map(id => RUNE_BY_ID.get(id).n), qty: 1 };
    }
    const s = SP_BY_ID.get(e.sid), t = TPL[e.kind][e.rank];
    return { kind: e.kind, name: `${e.kind === "scroll" ? "Scroll" : "Wand"} of ${s.n} (Rank ${e.rank})`, tu: t.u, sid: s.u, sname: s.n, rank: e.rank, qty: e.qty };
  });
  const g = goldBreakdown();
  return { name, party: { ...state.party }, packs: D.packs, entries, coins: g ? g.coins : null };
}

const MACRO_BODY = String.raw`
if (!game.user.isGM) return ui.notifications.warn("Loot import: run this macro as GM.");
const ROOT = "Loot";
const root = game.folders.find(f => f.type === "Actor" && !f.folder && f.name.toLowerCase() === ROOT.toLowerCase())
  ?? await Folder.create({ name: ROOT, type: "Actor", color: "#c9a04a" });
const itemPack = game.packs.get(LOOT.packs.item);
const spellPack = game.packs.get(LOOT.packs.spell);
if (!itemPack) return ui.notifications.error("Loot import: compendium " + LOOT.packs.item + " not found.");
const itemIndex = await itemPack.getIndex();
const spellIndex = spellPack ? await spellPack.getIndex() : null;
// fall back to a name match if an id changed between system versions
const find = (index, id, name) => (index?.has(id) ? id : index?.find(i => i.name === name)?._id);

const docs = [];
const missing = [];
const unresolved = [];
for (const e of LOOT.entries) {
  if (e.kind === "item") {
    const id = find(itemIndex, e.id, e.name);
    if (!id) { missing.push(e); continue; }
    const src = (await itemPack.getDocument(id)).toObject();
    delete src._id;
    src.system.quantity = e.qty;
    docs.push(src);
    continue;
  }
  if (e.kind === "runed") {
    const id = find(itemIndex, e.id, e.bname);
    if (!id) { missing.push(e); continue; }
    const src = (await itemPack.getDocument(id)).toObject();
    delete src._id;
    const type = e.ty === "weapon" ? "weapon" : "armor";
    const table = CONFIG.PF2E?.runes?.[type]?.property ?? {};
    const norm = s => String(s).toLowerCase().replace(/[()]/g, "").split(/[\s-]+/).filter(Boolean).sort().join(" ");
    const keyFor = name => Object.keys(table).find(k => norm(game.i18n.localize(table[k]?.name ?? "")) === norm(name))
      ?? Object.keys(table).find(k => norm(k.replace(/([A-Z])/g, " $1")) === norm(name));
    const keys = [];
    for (const n of e.props) { const k = keyFor(n); if (k) keys.push(k); else unresolved.push(n); }
    src.system.runes = { ...(src.system.runes ?? {}), potency: e.pot, property: keys };
    src.system.runes[type === "weapon" ? "striking" : "resilient"] = e.fun;
    src.system.quantity = 1;
    docs.push(src);
    continue;
  }
  // scroll / wand: pf2e rank template + the spell embedded in it (same shape as the spell sheet's "Create scroll/wand")
  const tid = find(itemIndex, e.tu, null);
  const sid = spellIndex ? find(spellIndex, e.sid, e.sname) : null;
  if (!tid || !sid) { missing.push(e); continue; }
  const src = (await itemPack.getDocument(tid)).toObject();
  const spell = (await spellPack.getDocument(sid)).toObject();
  spell._id = foundry.utils.randomID();
  foundry.utils.setProperty(spell, "system.location.heightenedLevel", e.rank);
  delete src._id;
  src.name = e.name;
  src.system.quantity = e.qty;
  src.system.spell = spell;
  const traits = new Set(src.system.traits.value);
  for (const t of spell.system.traits.value) traits.add(t);
  src.system.traits.value = [...traits];
  src.system.description.value = "<p>@UUID[Compendium." + LOOT.packs.spell + ".Item." + sid + "]{" + e.sname + "}</p><hr />" + src.system.description.value;
  docs.push(src);
}

const actor = await Actor.create({ name: LOOT.name, type: "loot", folder: root.id, system: { lootSheetType: "Loot" } });
if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
let coinNote = "";
if (LOOT.coins) {
  if (typeof actor.inventory?.addCoins === "function") await actor.inventory.addCoins(LOOT.coins);
  else coinNote = " (could not add coins automatically: " + JSON.stringify(LOOT.coins) + ")";
}

const rows = LOOT.entries.filter(e => !missing.includes(e)).map(e => "<li>" + e.qty + "× " + e.name + "</li>");
const unres = unresolved.length ? "<p><strong>Property runes the system did not recognise (not applied)</strong>: " + unresolved.join(", ") + "</p>" : "";
const miss = missing.map(e => "<li>" + e.qty + "× " + e.name + " (not found in the compendium)</li>");
const coins = LOOT.coins ? "<p>Coins: " + Object.entries(LOOT.coins).map(([k, v]) => v + " " + k).join(", ") + coinNote + "</p>" : "";
await ChatMessage.create({
  whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
  content: "<h3>@UUID[" + actor.uuid + "]{" + actor.name + "}</h3><p>Party level " + LOOT.party.level + "</p>" + coins +
    "<ul>" + rows.join("") + "</ul>" + (miss.length ? "<p><strong>Missing</strong></p><ul>" + miss.join("") + "</ul>" : "") + unres,
});
if (missing.length) ui.notifications.warn("Loot import: " + missing.length + " entr" + (missing.length === 1 ? "y" : "ies") + " not found, see chat.");
else ui.notifications.info('Loot actor "' + actor.name + '" created with ' + docs.length + " item(s).");
`;

function foundryMacro() {
  const sum = lootSummary();
  return `// PF2e Loot Builder export: ${sum.name.replace(/[\r\n]/g, " ")}
// Script macro. Run as GM. Creates a loot actor in Actors > Loot with the items below (copied from the pf2e compendium),
// builds scrolls/wands from the pf2e rank templates, adds coins, and whispers a summary to the GM.
const LOOT = ${JSON.stringify(sum, null, 2)};
${MACRO_BODY}`;
}

function openMacroDialog() {
  document.getElementById("macroMsg").textContent = "";
  if (!state.loot.length && !state.gold.on) { alert("The loot list is empty."); return; }
  document.getElementById("macroText").value = foundryMacro();
  document.getElementById("macroDialog").showModal();
}

/* ---------- wiring ---------- */

const sel = (id, options, value) => {
  const el = document.getElementById(id);
  el.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  el.value = String(value);
  return el;
};
const relLabel = r => (r === 0 ? "party" : r > 0 ? `party +${r}` : `party ${r}`);

function syncControls() {
  document.getElementById("partyLevel").value = state.party.level;
  document.getElementById("partySize").value = state.party.size;
  document.getElementById("useWindow").checked = state.useWindow;
  document.getElementById("relMin").disabled = document.getElementById("relMax").disabled = !state.useWindow;
  document.getElementById("goldOn").checked = state.gold.on;
  document.getElementById("goldPct").value = state.gold.pct;
  document.getElementById("goldPc").checked = state.gold.adjust;
  document.getElementById("goldPp").checked = state.gold.pp;
  document.getElementById("lootName").value = state.lootName;
}

function switchTab(id) {
  const before = currentDS();
  state.tab = id;
  const runed = currentDS() === "runed";
  document.getElementById("runedPanel").hidden = !runed;
  document.getElementById("tableWrap").hidden = runed;
  document.getElementById("filterBar").hidden = runed;
  if (currentDS() !== before) { closeDD(); buildFilterBar(); renderRanges(); }
  document.getElementById("kindWrap").hidden = currentDS() !== "spells";
  renderTabs();
  shown = PAGE;
  renderTable();
  saveState();
}

function init() {
  loadState();
  sel("partyLevel", Array.from({ length: MAX_PARTY_LEVEL }, (_, i) => [i + 1, i + 1]), state.party.level);
  sel("partySize", Array.from({ length: 8 }, (_, i) => [i + 1, i + 1]), state.party.size);
  const rels = Array.from({ length: 9 }, (_, i) => i - 4).map(r => [r, relLabel(r)]);
  sel("relMin", rels, state.relMin);
  sel("relMax", rels, state.relMax);
  sel("amount", Array.from({ length: 30 }, (_, i) => [i + 1, i + 1]), state.amount);
  document.getElementById("unique").checked = state.unique;
  document.getElementById("genKind").value = state.genKind;
  document.getElementById("nameSearch").value = state.name;
  syncControls();

  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on("partyLevel", "change", e => { state.party.level = +e.target.value; renderSuggested(); renderLoot(); saveState(); });
  on("partySize", "change", e => { state.party.size = +e.target.value; renderLoot(); saveState(); });
  on("useWindow", "change", e => { state.useWindow = e.target.checked; syncControls(); saveState(); });
  on("relMin", "change", e => {
    state.relMin = +e.target.value;
    if (state.relMax < state.relMin) { state.relMax = state.relMin; document.getElementById("relMax").value = state.relMax; }
    saveState();
  });
  on("relMax", "change", e => {
    state.relMax = +e.target.value;
    if (state.relMin > state.relMax) { state.relMin = state.relMax; document.getElementById("relMin").value = state.relMin; }
    saveState();
  });
  on("amount", "change", e => { state.amount = +e.target.value; saveState(); });
  on("unique", "change", e => { state.unique = e.target.checked; saveState(); });
  on("genKind", "change", e => { state.genKind = e.target.value; saveState(); });
  on("randomBtn", "click", generate);
  on("clearLoot", "click", () => { state.loot = []; say(""); renderLoot(); });

  on("goldOn", "change", e => { state.gold.on = e.target.checked; renderLoot(); });
  on("goldPct", "input", e => { state.gold.pct = Math.max(0, +e.target.value || 0); renderLoot(); });
  on("goldPc", "change", e => { state.gold.adjust = e.target.checked; renderLoot(); });
  on("goldPp", "change", e => { state.gold.pp = e.target.checked; renderLoot(); });

  let nameTimer;
  on("nameSearch", "input", e => { clearTimeout(nameTimer); nameTimer = setTimeout(() => { state.name = e.target.value.trim(); onFiltersChanged(); }, 150); });
  on("lootName", "input", e => { state.lootName = e.target.value; saveState(); });
  on("rangeControls", "change", e => {
    const k = e.target.dataset.range;
    if (!k) return;
    state.ranges[k] = e.target.value;
    onFiltersChanged();
  });
  on("clearFilters", "click", () => {
    const ds = currentDS();
    state.filters[ds] = newFilters(ds);
    for (const k of ds === "items" ? ["lvMin", "lvMax", "pMin", "pMax"] : ["rkMin", "rkMax"]) state.ranges[k] = "";
    state.name = ""; document.getElementById("nameSearch").value = "";
    closeDD();
    renderRanges();
    onFiltersChanged();
  });

  on("tbody", "click", e => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const ds = currentDS();
    const row = ds === "items" ? BY_ID.get(tr.dataset.id) : SP_BY_ID.get(tr.dataset.id);
    const addBtn = e.target.closest(".add");
    if (addBtn) {
      if (ds === "items") addItem(row.id);
      else addSpellItem(row.id, addBtn.dataset.kind, rankOf(row));
      renderLoot();
    } else if (e.target.closest(".name")) openDrawer(row);
  });
  on("tbody", "change", e => {
    const rk = e.target.closest(".rk");
    if (!rk) return;
    const tr = rk.closest("tr");
    state.spRank[tr.dataset.id] = +rk.value;
    const s = SP_BY_ID.get(tr.dataset.id);
    const tab = currentTab();
    tr.innerHTML = tab.cols.map(id => `<td class="${COL[id].cls || ""}">${COL[id].cell(s)}</td>`).join("");
  });
  on("moreBtn", "click", () => { shown += PAGE; renderTable(); });
  on("thead", "click", e => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
    renderTable();
    saveState();
  });
  on("tabs", "click", e => {
    const b = e.target.closest("[data-tab]");
    if (b) switchTab(b.dataset.tab);
  });

  on("drawerClose", "click", () => { document.getElementById("drawer").hidden = true; });
  on("drawer", "click", e => { if (e.target.id === "drawer") e.currentTarget.hidden = true; });
  document.addEventListener("click", closeDD);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeDD(); document.getElementById("drawer").hidden = true; }
  });

  on("saveBtn", "click", () => {
    const name = document.getElementById("lootName").value.trim();
    if (!name || !state.loot.length) return;
    const saves = store.get(savesKey(), {});
    saves[name] = snapshot();
    store.set(savesKey(), saves);
    refreshSaves();
    document.getElementById("loadSelect").value = name;
  });
  on("loadSelect", "change", e => {
    const name = e.target.value;
    if (!name) return;
    const s = store.get(savesKey(), {})[name];
    if (s) { document.getElementById("lootName").value = name; state.lootName = name; applySnapshot(s); }
  });
  on("deleteSave", "click", () => {
    const name = document.getElementById("loadSelect").value;
    if (!name) return;
    const saves = store.get(savesKey(), {});
    delete saves[name];
    store.set(savesKey(), saves);
    refreshSaves();
  });
  on("macroBtn", "click", openMacroDialog);
  on("macroClose", "click", () => document.getElementById("macroDialog").close());
  on("macroCopy", "click", async () => {
    const ta = document.getElementById("macroText");
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand("copy"); }
    document.getElementById("macroMsg").textContent = "Copied.";
  });
  on("macroDownload", "click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("macroText").value], { type: "text/javascript" }));
    a.download = "loot-macro.js";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const cats = [...new Set(BASES.map(b => b.cat))].sort();
  document.getElementById("runedCat").innerHTML = `<option value="">Any</option>` + cats.map(c => `<option value="${c}">${cap(c)}</option>`).join("");
  for (const [id, k] of [["runedKind", "kind"], ["runedCat", "cat"], ["runedProps", "props"]]) {
    document.getElementById(id).value = state.runed[k];
    on(id, "change", e => { state.runed[k] = e.target.value; saveState(); });
  }
  document.getElementById("runedPanel").hidden = currentDS() !== "runed";
  document.getElementById("tableWrap").hidden = currentDS() === "runed";
  document.getElementById("filterBar").hidden = currentDS() === "runed";
  loadOwned();
  document.getElementById("goldTop").checked = state.gold.topUp;
  on("goldTop", "change", e => { state.gold.topUp = e.target.checked; renderLoot(); });
  document.getElementById("ownedMacro").value = OWNED_MACRO;
  on("ownedBtn", "click", () => { document.getElementById("ownedMsg").textContent = ""; document.getElementById("ownedDialog").showModal(); });
  on("ownedClose", "click", () => document.getElementById("ownedDialog").close());
  on("ownedMacroCopy", "click", async () => {
    try { await navigator.clipboard.writeText(OWNED_MACRO); } catch { document.getElementById("ownedMacro").select(); document.execCommand("copy"); }
    document.getElementById("ownedMsg").textContent = "Macro copied.";
  });
  on("ownedImport", "click", () => {
    const msg = document.getElementById("ownedMsg");
    try {
      const d = JSON.parse(document.getElementById("ownedPaste").value);
      const list = d.lootBuilderOwned;
      if (!Array.isArray(list)) throw new Error("no list");
      const world = typeof d.world === "string" && d.world.trim() ? d.world.trim() : null;
      if (world && world !== state.profile) switchProfile(world);
      updateProfile(p => {
        p.owned = list;
        if (typeof d.coinsGp === "number") p.wealth = { gp: d.coinsGp, members: d.members || 0, runes: Array.isArray(d.runes) ? d.runes : [] };
        if (d.partyName) p.partyName = d.partyName;
      });
      refreshProfileUI();
      msg.textContent = `Profile “${state.profile}”: imported ${list.length} item(s); ${ITEMS.filter(isOwned).length} match the builder's items.` + (wealth() ? ` Party currency: ${wealth().gp.toLocaleString()} gp; ${(wealth().runes || []).length} character(s) read for runes.` : "");
    } catch { msg.textContent = "Could not read that: paste the text the macro copied."; }
  });
  on("ownedClear", "click", () => { updateProfile(p => { p.owned = []; p.wealth = null; }); loadOwned(); renderSuggested(); renderTable(); document.getElementById("ownedMsg").textContent = "List cleared."; });

  initProfiles();
  on("profile", "change", e => switchProfile(e.target.value));
  on("profileNew", "click", () => {
    const name = (prompt("Name of the new profile (usually the campaign / Foundry world):") || "").trim();
    if (!name) return;
    if (profiles()[name]) { switchProfile(name); return; }
    updateProfile(() => {}, name);
    switchProfile(name);
  });
  on("profileDel", "click", () => {
    const names = Object.keys(profiles());
    if (names.length < 2 || !confirm(`Delete profile “${state.profile}” with its party data and saved loot lists?`)) return;
    const all = profiles();
    const gone = state.profile;
    const next = names.filter(n => n !== gone).sort()[0];
    delete all[gone];
    store.set("lb-profiles", all);
    try { localStorage.removeItem(savesKey(gone)); } catch { /* storage unavailable */ }
    state.profile = next;
    state.party = { level: 5, size: 4, ...(all[next].party || {}) };
    state.gold = { ...GOLD_DEFAULT, ...(all[next].gold || {}) };
    state.loot = (all[next].loot || []).filter(entryValid).map(e => ({ ...e, uid: uid++ }));
    state.lootName = all[next].lootName || "";
    saveState();
    refreshProfileUI();
  });
  refreshProfileUI();
  refreshSaves();
  renderTabs();
  buildFilterBar();
  renderRanges();
  document.getElementById("kindWrap").hidden = currentDS() !== "spells";
  renderSuggested();
  renderTable();
  renderLoot();
}

init();
