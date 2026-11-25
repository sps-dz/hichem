// Fichier généré par « npm run build:web » depuis functions/src/web/studio-core.ts — ne pas modifier à la main.

// src/lib/errors.ts
var AppError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
};
function invalid(message, details) {
  throw new AppError("invalid-argument", message, details);
}

// src/lib/phone.ts
function normalizeDzPhone(input) {
  if (typeof input !== "string") invalid("Num\xE9ro de t\xE9l\xE9phone manquant.");
  const raw = input.trim();
  if (!/^[+\d\s().\-]{8,25}$/.test(raw)) invalid("Num\xE9ro de t\xE9l\xE9phone invalide.", { phone: raw });
  let digits = raw.replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+?(00)?213\(?0\)?/, "+213");
  if (digits.startsWith("+213")) digits = digits.slice(4);
  else if (digits.startsWith("00213")) digits = digits.slice(5);
  else if (digits.startsWith("213") && digits.length >= 11) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  else invalid("Num\xE9ro de t\xE9l\xE9phone invalide.", { phone: raw });
  if (digits.includes("+")) invalid("Num\xE9ro de t\xE9l\xE9phone invalide.", { phone: raw });
  if (/^[567]\d{8}$/.test(digits)) return { e164: `+213${digits}`, kind: "mobile" };
  if (/^[234]\d{7}$/.test(digits)) return { e164: `+213${digits}`, kind: "fixed" };
  return invalid("Num\xE9ro de t\xE9l\xE9phone invalide.", { phone: raw });
}

// src/lib/money.ts
var MAX_DZD = 1e9;
function assertDzd(value, field = "montant") {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${field} doit \xEAtre un nombre entier de dinars.`, { field, value });
  }
  if (value < 0) invalid(`${field} ne peut pas \xEAtre n\xE9gatif.`, { field, value });
  if (value > MAX_DZD) invalid(`${field} d\xE9passe le plafond autoris\xE9.`, { field, value });
  return value;
}
function percentOfDzd(amount, percent) {
  assertDzd(amount);
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) {
    invalid("Le pourcentage doit \xEAtre un entier entre 0 et 100.", { percent });
  }
  return Math.floor((amount * percent + 50) / 100);
}

// src/lib/time.ts
var OFFSET_MS = 60 * 60 * 1e3;
var MINUTE = 60 * 1e3;
var DEFAULT_SLOT_MINUTES = 30;
var MAX_SLOTS_PER_BOOKING = 96;
function assertYmd(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("Date invalide (AAAA-MM-JJ).", { date });
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) invalid("Date inexistante.", { date });
  return date;
}
function assertHm(hm) {
  if (typeof hm !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) invalid("Heure invalide (HH:MM).", { hm });
  return hm;
}
function algiersToUtcMs(date, hm) {
  assertYmd(date);
  assertHm(hm);
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - OFFSET_MS;
}
function utcMsToAlgiers(ms) {
  const t = new Date(ms + OFFSET_MS);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`,
    hm: `${p(t.getUTCHours())}${p(t.getUTCMinutes())}`
  };
}
function slotKey(ms) {
  const { date, hm } = utcMsToAlgiers(ms);
  return `${date}_${hm}`;
}
function slotKeysFor(range) {
  const slot = range.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  if (!Number.isInteger(slot) || slot <= 0 || 1440 % slot !== 0) invalid("Taille de tranche invalide.", { slot });
  const duration = range.durationMinutes;
  const buffer = range.bufferMinutes ?? 0;
  if (!Number.isInteger(duration) || duration <= 0) invalid("Dur\xE9e invalide.", { duration });
  if (!Number.isInteger(buffer) || buffer < 0) invalid("Tampon invalide.", { buffer });
  const startMs = algiersToUtcMs(range.date, range.start);
  const endMs = startMs + (duration + buffer) * MINUTE;
  const slotMs = slot * MINUTE;
  const first = Math.floor((startMs + OFFSET_MS) / slotMs) * slotMs - OFFSET_MS;
  const keys = [];
  for (let t = first; t < endMs; t += slotMs) keys.push(slotKey(t));
  if (keys.length > MAX_SLOTS_PER_BOOKING) invalid("R\xE9servation trop longue.", { slots: keys.length });
  return keys;
}

// src/pricing/catalog.ts
var SERVICE_IDS = ["studio", "product", "video", "editing", "ad"];
var OPEN = { open: "08:00", close: "22:00" };
var SUN_WED = [0, 1, 2, 3];
var THU = [4];
var FRI_SAT = [5, 6];
var DEFAULT_CATALOG = {
  version: "2026-11-25-options-provisoire",
  currency: "DZD",
  depositPercent: 20,
  provisional: true,
  studio: {
    enabled: true,
    // Tous les jours 8 h – 22 h ; FORFAIT par tranche selon le jour (tranche touchée = due en entier).
    openingHours: { "0": OPEN, "1": OPEN, "2": OPEN, "3": OPEN, "4": OPEN, "5": OPEN, "6": OPEN },
    periods: [
      { days: SUN_WED, from: "08:00", to: "12:00", price: 1500 },
      { days: SUN_WED, from: "12:00", to: "17:00", price: 2e3 },
      { days: SUN_WED, from: "17:00", to: "22:00", price: 2500 },
      { days: THU, from: "08:00", to: "12:00", price: 2e3 },
      { days: THU, from: "12:00", to: "17:00", price: 2e3 },
      { days: THU, from: "17:00", to: "22:00", price: 3e3 },
      { days: FRI_SAT, from: "08:00", to: "12:00", price: 2500 },
      { days: FRI_SAT, from: "12:00", to: "17:00", price: 3e3 },
      { days: FRI_SAT, from: "17:00", to: "22:00", price: 3500 }
    ],
    minMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    specialDates: [],
    // Options à cocher par le client. Mannequin, voix off et montage : prix PROVISOIRES à fixer
    // dans la page Équipe (« Options par réservation »).
    addons: [
      { id: "iphone15pm", name: "Utilisation iPhone 15 Pro Max", price: 800 },
      { id: "mannequin", name: "Mannequin", price: 1e3, unit: "hour", description: "Un mannequin pendant toute la s\xE9ance." },
      { id: "voixoff", name: "Voix off", price: 2e3, description: "Enregistrement d'une voix off pour votre vid\xE9o." },
      { id: "montage", name: "Montage apr\xE8s la s\xE9ance", price: 3500, description: "Une vid\xE9o mont\xE9e jusqu'\xE0 1 min, 2 r\xE9visions incluses." }
    ],
    minPrice: 0
  },
  product: {
    enabled: true,
    packages: [
      { id: "p5", name: "Pack 5 produits", products: 5, photosPerProduct: 3, price: 12e3 },
      { id: "p10", name: "Pack 10 produits", products: 10, photosPerProduct: 3, price: 22e3 },
      { id: "p20", name: "Pack 20 produits", products: 20, photosPerProduct: 3, price: 4e4 }
    ],
    extraPhotoPrice: 1e3,
    addons: [],
    minPrice: 12e3
  },
  video: {
    enabled: true,
    pricePerReel: 8e3,
    formats: ["9:16", "16:9"],
    volumeTiers: [
      { minQty: 3, percent: 10 },
      { minQty: 5, percent: 15 }
    ],
    addons: [],
    maxReels: 30,
    minPrice: 8e3
  },
  editing: {
    enabled: true,
    durationTiers: [
      { maxSeconds: 60, price: 3500 },
      { maxSeconds: 180, price: 6e3 },
      { maxSeconds: 600, price: 12e3 }
    ],
    subtitlesPrice: 1500,
    includedRevisions: 2,
    extraRevisionPrice: 1e3,
    maxVideos: 30,
    minPrice: 3500
  },
  ad: { enabled: true, mode: "quote" },
  promotions: [],
  bundles: []
};
var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function intIn(v, field, min, max) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) invalid(`${field} invalide.`, { field, value: v });
  return v;
}
function text(v, field, max = 80) {
  if (typeof v !== "string" || !v.trim() || v.length > max) invalid(`${field} invalide.`, { field });
  return v.trim();
}
function bool(v, field) {
  if (typeof v !== "boolean") invalid(`${field} invalide.`, { field });
  return v;
}
var minutesOf = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
function addons(v, field, allowHourly = false) {
  if (!Array.isArray(v) || v.length > 30) invalid(`${field} invalide.`);
  const ids = /* @__PURE__ */ new Set();
  return v.map((a, i) => {
    if (!isObj(a)) invalid(`${field}[${i}] invalide.`);
    const id = text(a.id, `${field}[${i}].id`, 40);
    if (!ID_RE.test(id) || ids.has(id)) invalid(`${field}[${i}].id invalide ou en double.`);
    ids.add(id);
    const out = { id, name: text(a.name, `${field}[${i}].name`), price: assertDzd(a.price, `${field}[${i}].price`) };
    if (a.unit !== void 0 && a.unit !== "booking") {
      if (a.unit !== "hour" || !allowHourly) invalid(`${field}[${i}].unit invalide.`);
      out.unit = "hour";
    }
    if (a.description !== void 0 && a.description !== "") out.description = text(a.description, `${field}[${i}].description`, 160);
    return out;
  });
}
function assertCatalog(c) {
  if (!isObj(c)) invalid("Catalogue invalide.");
  const version = text(c.version, "version", 60);
  if (c.currency !== "DZD") invalid("Devise invalide (DZD uniquement).");
  const depositPercent = intIn(c.depositPercent, "depositPercent", 0, 100);
  const provisional = bool(c.provisional, "provisional");
  const s = c.studio;
  if (!isObj(s)) invalid("studio invalide.");
  const oh = s.openingHours;
  if (!isObj(oh)) invalid("studio.openingHours invalide.");
  const openingHours = {};
  for (let d = 0; d < 7; d++) {
    const v2 = oh[String(d)];
    if (v2 === null || v2 === void 0) {
      openingHours[String(d)] = null;
      continue;
    }
    if (!isObj(v2)) invalid(`Horaires du jour ${d} invalides.`);
    const open = assertHm(v2.open);
    const close = assertHm(v2.close);
    if (minutesOf(close) <= minutesOf(open)) invalid(`Horaires du jour ${d} : fermeture avant ouverture.`);
    openingHours[String(d)] = { open, close };
  }
  if (!Array.isArray(s.periods) || s.periods.length === 0 || s.periods.length > 50) invalid("studio.periods invalide.");
  const periods = s.periods.map((p2, i) => {
    if (!isObj(p2) || !Array.isArray(p2.days) || p2.days.length === 0) invalid(`P\xE9riode ${i} invalide.`);
    const days = [...new Set(p2.days.map((d) => intIn(d, `periods[${i}].days`, 0, 6)))].sort();
    const from = assertHm(p2.from);
    const to = assertHm(p2.to);
    if (minutesOf(to) <= minutesOf(from)) invalid(`P\xE9riode ${i} : fin avant d\xE9but.`);
    return { days, from, to, price: assertDzd(p2.price, `periods[${i}].price`) };
  });
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a2 = periods[i];
      const b = periods[j];
      const sameDay = a2.days.some((d) => b.days.includes(d));
      const overlap = minutesOf(a2.from) < minutesOf(b.to) && minutesOf(b.from) < minutesOf(a2.to);
      if (sameDay && overlap) invalid(`Les p\xE9riodes ${i} et ${j} se chevauchent.`);
    }
  }
  const stepMinutes = intIn(s.stepMinutes, "studio.stepMinutes", 5, 240);
  if (1440 % stepMinutes !== 0) invalid("studio.stepMinutes doit diviser une journ\xE9e.");
  const minMinutes = intIn(s.minMinutes, "studio.minMinutes", stepMinutes, 1440);
  const bufferMinutes = intIn(s.bufferMinutes, "studio.bufferMinutes", 0, 240);
  if (!Array.isArray(s.specialDates) || s.specialDates.length > 400) invalid("studio.specialDates invalide.");
  const seen = /* @__PURE__ */ new Set();
  const specialDates = s.specialDates.map((sd, i) => {
    if (!isObj(sd)) invalid(`Date sp\xE9ciale ${i} invalide.`);
    const date = assertYmd(sd.date);
    if (seen.has(date)) invalid(`Date sp\xE9ciale ${date} en double.`);
    seen.add(date);
    const label = sd.label === void 0 ? void 0 : text(sd.label, `specialDates[${i}].label`);
    if (sd.kind === "closed") return { date, kind: "closed", label };
    if (sd.kind === "adjust") return { date, kind: "adjust", percent: intIn(sd.percent, `specialDates[${i}].percent`, -90, 300), label };
    if (sd.kind === "override") return { date, kind: "override", price: assertDzd(sd.price, `specialDates[${i}].price`), label };
    return invalid(`Date sp\xE9ciale ${i} : type inconnu.`);
  });
  const studio = {
    enabled: bool(s.enabled, "studio.enabled"),
    openingHours,
    periods,
    minMinutes,
    stepMinutes,
    bufferMinutes,
    specialDates,
    addons: addons(s.addons ?? [], "studio.addons", true),
    minPrice: assertDzd(s.minPrice, "studio.minPrice")
  };
  const p = c.product;
  if (!isObj(p) || !Array.isArray(p.packages) || p.packages.length > 30) invalid("product invalide.");
  const pkgIds = /* @__PURE__ */ new Set();
  const packages = p.packages.map((k, i) => {
    if (!isObj(k)) invalid(`Pack ${i} invalide.`);
    const id = text(k.id, `packages[${i}].id`, 40);
    if (!ID_RE.test(id) || pkgIds.has(id)) invalid(`Pack ${i} : identifiant invalide ou en double.`);
    pkgIds.add(id);
    return {
      id,
      name: text(k.name, `packages[${i}].name`),
      products: intIn(k.products, `packages[${i}].products`, 1, 1e3),
      photosPerProduct: intIn(k.photosPerProduct, `packages[${i}].photosPerProduct`, 1, 100),
      price: assertDzd(k.price, `packages[${i}].price`)
    };
  });
  const product = {
    enabled: bool(p.enabled, "product.enabled"),
    packages,
    extraPhotoPrice: assertDzd(p.extraPhotoPrice, "product.extraPhotoPrice"),
    addons: addons(p.addons, "product.addons"),
    minPrice: assertDzd(p.minPrice, "product.minPrice")
  };
  if (product.enabled && packages.length === 0) invalid("Shooting produit activ\xE9 sans aucun pack.");
  const v = c.video;
  if (!isObj(v) || !Array.isArray(v.formats) || !Array.isArray(v.volumeTiers)) invalid("video invalide.");
  const formats = v.formats.map((f, i) => text(f, `video.formats[${i}]`, 20));
  if (formats.length === 0) invalid("Au moins un format vid\xE9o.");
  const volumeTiers = v.volumeTiers.map((t, i) => {
    if (!isObj(t)) invalid(`Palier ${i} invalide.`);
    return { minQty: intIn(t.minQty, `volumeTiers[${i}].minQty`, 2, 1e3), percent: intIn(t.percent, `volumeTiers[${i}].percent`, 1, 90) };
  }).sort((a2, b) => a2.minQty - b.minQty);
  for (let i = 1; i < volumeTiers.length; i++) {
    if (volumeTiers[i].minQty === volumeTiers[i - 1].minQty) invalid("Deux paliers de volume au m\xEAme seuil.");
  }
  const video = {
    enabled: bool(v.enabled, "video.enabled"),
    pricePerReel: assertDzd(v.pricePerReel, "video.pricePerReel"),
    formats,
    volumeTiers,
    addons: addons(v.addons, "video.addons"),
    maxReels: intIn(v.maxReels, "video.maxReels", 1, 1e3),
    minPrice: assertDzd(v.minPrice, "video.minPrice")
  };
  const e = c.editing;
  if (!isObj(e) || !Array.isArray(e.durationTiers) || e.durationTiers.length === 0) invalid("editing invalide.");
  const durationTiers = e.durationTiers.map((t, i) => {
    if (!isObj(t)) invalid(`Tranche de montage ${i} invalide.`);
    return { maxSeconds: intIn(t.maxSeconds, `durationTiers[${i}].maxSeconds`, 1, 36e3), price: assertDzd(t.price, `durationTiers[${i}].price`) };
  }).sort((a2, b) => a2.maxSeconds - b.maxSeconds);
  for (let i = 1; i < durationTiers.length; i++) {
    if (durationTiers[i].maxSeconds === durationTiers[i - 1].maxSeconds) invalid("Deux tranches de montage \xE0 la m\xEAme dur\xE9e.");
  }
  const editing = {
    enabled: bool(e.enabled, "editing.enabled"),
    durationTiers,
    subtitlesPrice: assertDzd(e.subtitlesPrice, "editing.subtitlesPrice"),
    includedRevisions: intIn(e.includedRevisions, "editing.includedRevisions", 0, 50),
    extraRevisionPrice: assertDzd(e.extraRevisionPrice, "editing.extraRevisionPrice"),
    maxVideos: intIn(e.maxVideos, "editing.maxVideos", 1, 1e3),
    minPrice: assertDzd(e.minPrice, "editing.minPrice")
  };
  const a = c.ad;
  if (!isObj(a) || a.mode !== "quote") invalid("ad invalide.");
  const ad = { enabled: bool(a.enabled, "ad.enabled"), mode: "quote" };
  if (!Array.isArray(c.promotions) || c.promotions.length > 100) invalid("promotions invalide.");
  const promoIds = /* @__PURE__ */ new Set();
  const promotions = c.promotions.map((x, i) => {
    if (!isObj(x)) invalid(`Promotion ${i} invalide.`);
    const id = text(x.id, `promotions[${i}].id`, 40);
    if (!ID_RE.test(id) || promoIds.has(id)) invalid(`Promotion ${i} : identifiant invalide ou en double.`);
    promoIds.add(id);
    const kind = x.kind === "percent" || x.kind === "amount" ? x.kind : invalid(`Promotion ${i} : type inconnu.`);
    const value = kind === "percent" ? intIn(x.value, `promotions[${i}].value`, 1, 90) : assertDzd(x.value, `promotions[${i}].value`);
    if (!Array.isArray(x.services)) invalid(`Promotion ${i} : services invalides.`);
    const services = x.services.map((sv) => SERVICE_IDS.includes(sv) ? sv : invalid(`Promotion ${i} : service inconnu.`));
    const validFrom = x.validFrom === null ? null : assertYmd(x.validFrom);
    const validTo = x.validTo === null ? null : assertYmd(x.validTo);
    if (validFrom && validTo && validTo < validFrom) invalid(`Promotion ${i} : dates invers\xE9es.`);
    return { id, name: text(x.name, `promotions[${i}].name`), kind, value, services, validFrom, validTo, minSubtotal: assertDzd(x.minSubtotal, `promotions[${i}].minSubtotal`), active: bool(x.active, `promotions[${i}].active`) };
  });
  if (!Array.isArray(c.bundles) || c.bundles.length > 50) invalid("bundles invalide.");
  const bundleIds = /* @__PURE__ */ new Set();
  const bundles = c.bundles.map((x, i) => {
    if (!isObj(x) || !Array.isArray(x.requires)) invalid(`Remise group\xE9e ${i} invalide.`);
    const id = text(x.id, `bundles[${i}].id`, 40);
    if (!ID_RE.test(id) || bundleIds.has(id) || promoIds.has(id)) invalid(`Remise group\xE9e ${i} : identifiant invalide ou en double.`);
    bundleIds.add(id);
    const requires = [...new Set(x.requires.map((sv) => SERVICE_IDS.includes(sv) ? sv : invalid(`Remise group\xE9e ${i} : service inconnu.`)))];
    if (requires.length < 2) invalid(`Remise group\xE9e ${i} : au moins deux services.`);
    return { id, name: text(x.name, `bundles[${i}].name`), requires, percent: intIn(x.percent, `bundles[${i}].percent`, 1, 90), active: bool(x.active, `bundles[${i}].active`) };
  });
  return { version, currency: "DZD", depositPercent, provisional, studio, product, video, editing, ad, promotions, bundles };
}

// src/pricing/engine.ts
function divRound(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= 0) invalid("Calcul hors limites.");
  return Math.floor((2 * a + b) / (2 * b));
}
var minutesOf2 = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
var hmOf = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var fmt = (n) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} DA`;
var MAX_LINES = 20;
function addonsTotal(ids, available, details, durationMinutes = 0) {
  if (ids === void 0) return 0;
  if (!Array.isArray(ids) || ids.length > available.length) invalid("Options invalides.");
  const seen = /* @__PURE__ */ new Set();
  let sum = 0;
  for (const id of ids) {
    const a = available.find((x) => x.id === id);
    if (!a || seen.has(String(id))) invalid("Option inconnue ou en double.", { option: id });
    seen.add(String(id));
    if (a.unit === "hour") {
      const amount = divRound(a.price * durationMinutes, 60);
      const h = durationMinutes % 60 ? `${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60}` : `${durationMinutes / 60} h`;
      details.push({ label: `${a.name} \xB7 ${h} \xD7 ${fmt(a.price)}/h`, amount });
      sum += amount;
    } else {
      details.push({ label: a.name, amount: a.price });
      sum += a.price;
    }
  }
  return sum;
}
function applyMin(price, min, details) {
  if (price >= min) return { price, applied: false };
  details.push({ label: "Ajustement au prix minimum", amount: min - price });
  return { price: min, applied: true };
}
function priceStudio(cat, raw, now, id) {
  const cfg = cat.studio;
  const date = assertYmd(raw.date);
  const start = assertHm(raw.start);
  const duration = raw.durationMinutes;
  if (typeof duration !== "number" || !Number.isSafeInteger(duration)) invalid("Dur\xE9e invalide.");
  if (duration < cfg.minMinutes) invalid(`Dur\xE9e minimale : ${cfg.minMinutes} minutes.`);
  if (duration % cfg.stepMinutes !== 0) invalid(`La dur\xE9e doit \xEAtre un multiple de ${cfg.stepMinutes} minutes.`);
  const startMin = minutesOf2(start);
  if (startMin % cfg.stepMinutes !== 0) invalid(`L'heure de d\xE9but doit tomber sur une tranche de ${cfg.stepMinutes} minutes.`);
  const endMin = startMin + duration;
  const special = cfg.specialDates.find((s) => s.date === date);
  if (special?.kind === "closed") invalid("Le studio est ferm\xE9 ce jour-l\xE0.", { date });
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hours = cfg.openingHours[String(dow)];
  if (!hours) invalid("Le studio est ferm\xE9 ce jour-l\xE0.", { date });
  if (startMin < minutesOf2(hours.open) || endMin > minutesOf2(hours.close)) {
    invalid(`Horaires d'ouverture ce jour-l\xE0 : ${hours.open} \u2013 ${hours.close}.`, { date });
  }
  if (algiersToUtcMs(date, start) <= now) invalid("Ce cr\xE9neau est d\xE9j\xE0 pass\xE9.");
  const periods = cfg.periods.filter((p) => p.days.includes(dow)).sort((a, b) => minutesOf2(a.from) - minutesOf2(b.from));
  const details = [];
  let covered = 0;
  let price = 0;
  for (const p of periods) {
    const a = Math.max(startMin, minutesOf2(p.from));
    const b = Math.min(endMin, minutesOf2(p.to));
    if (b <= a) continue;
    covered += b - a;
    let amount = special?.kind === "override" ? special.price : p.price;
    let label = `Tranche ${p.from}\u2013${p.to} \xB7 forfait ${fmt(amount)}`;
    if (special?.kind === "adjust") {
      amount = divRound(amount * (100 + special.percent), 100);
      label += ` \xB7 ${special.percent > 0 ? "+" : ""}${special.percent} % (${special.label ?? "date sp\xE9ciale"})`;
    } else if (special?.kind === "override") {
      label += ` (${special.label ?? "tarif du jour"})`;
    }
    details.push({ label, amount });
    price += amount;
  }
  if (covered !== duration) invalid("Une partie de ce cr\xE9neau n'a pas de tarif : contactez le studio.", { date, start });
  price += addonsTotal(raw.addons, cfg.addons ?? [], details, duration);
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "studio",
    label: `Location studio \xB7 ${date} ${start}\u2013${hmOf(endMin)}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    slotKeys: slotKeysFor({ date, start, durationMinutes: duration, bufferMinutes: cfg.bufferMinutes, slotMinutes: cfg.stepMinutes }),
    booking: { date, start, end: hmOf(endMin), durationMinutes: duration },
    input: { service: "studio", date, start, durationMinutes: duration, addons: raw.addons ?? [] }
  };
}
function priceProduct(cat, raw, id) {
  const cfg = cat.product;
  const pkg = cfg.packages.find((p) => p.id === raw.packageId);
  if (!pkg) invalid("Pack inconnu.", { packageId: raw.packageId });
  const extra = raw.extraPhotos ?? 0;
  if (typeof extra !== "number" || !Number.isSafeInteger(extra) || extra < 0 || extra > 500) invalid("Nombre de photos suppl\xE9mentaires invalide.");
  const details = [{ label: `${pkg.name} (${pkg.products} produits \xD7 ${pkg.photosPerProduct} photos)`, amount: pkg.price }];
  let price = pkg.price;
  if (extra > 0) {
    const amount = extra * cfg.extraPhotoPrice;
    details.push({ label: `${extra} photo(s) suppl\xE9mentaire(s) \xD7 ${fmt(cfg.extraPhotoPrice)}`, amount });
    price += amount;
  }
  price += addonsTotal(raw.addons, cfg.addons, details);
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "product",
    label: `Shooting produit \xB7 ${pkg.name}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "product", packageId: pkg.id, extraPhotos: extra, addons: raw.addons ?? [] }
  };
}
function priceVideo(cat, raw, id) {
  const cfg = cat.video;
  const reels = raw.reels;
  if (typeof reels !== "number" || !Number.isSafeInteger(reels) || reels < 1 || reels > cfg.maxReels) invalid(`Nombre de vid\xE9os : entre 1 et ${cfg.maxReels}.`);
  if (typeof raw.format !== "string" || !cfg.formats.includes(raw.format)) invalid("Format vid\xE9o invalide.", { format: raw.format });
  const base = reels * cfg.pricePerReel;
  const details = [{ label: `${reels} vid\xE9o(s) \xD7 ${fmt(cfg.pricePerReel)} \xB7 ${raw.format}`, amount: base }];
  let price = base;
  const tier = [...cfg.volumeTiers].reverse().find((t) => reels >= t.minQty);
  if (tier) {
    const off = divRound(base * tier.percent, 100);
    details.push({ label: `Remise de volume d\xE8s ${tier.minQty} vid\xE9os (\u2212${tier.percent} %)`, amount: -off });
    price -= off;
  }
  price += addonsTotal(raw.addons, cfg.addons, details);
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "video",
    label: `Shooting vid\xE9o \xB7 ${reels} vid\xE9o(s) ${raw.format}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "video", reels, format: raw.format, addons: raw.addons ?? [] }
  };
}
function priceEditing(cat, raw, id) {
  const cfg = cat.editing;
  const videos = raw.videos;
  if (!Array.isArray(videos) || videos.length < 1 || videos.length > cfg.maxVideos) invalid(`Nombre de vid\xE9os \xE0 monter : entre 1 et ${cfg.maxVideos}.`);
  const details = [];
  let price = 0;
  const clean = [];
  videos.forEach((v, i) => {
    if (!isObj2(v)) invalid(`Vid\xE9o ${i + 1} invalide.`);
    const seconds = v.seconds;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1) invalid(`Vid\xE9o ${i + 1} : dur\xE9e invalide.`);
    const tier = cfg.durationTiers.find((t) => seconds <= t.maxSeconds);
    if (!tier) invalid(`Vid\xE9o ${i + 1} : trop longue pour le tarif en ligne, demandez un devis.`);
    const subtitles = v.subtitles === void 0 ? false : v.subtitles;
    if (typeof subtitles !== "boolean") invalid(`Vid\xE9o ${i + 1} : sous-titres invalides.`);
    const extra = v.extraRevisions ?? 0;
    if (typeof extra !== "number" || !Number.isSafeInteger(extra) || extra < 0 || extra > 20) invalid(`Vid\xE9o ${i + 1} : r\xE9visions invalides.`);
    details.push({ label: `Vid\xE9o ${i + 1} \xB7 jusqu'\xE0 ${tier.maxSeconds} s \xB7 ${cfg.includedRevisions} r\xE9vision(s) incluse(s)`, amount: tier.price });
    price += tier.price;
    if (subtitles) {
      details.push({ label: `Vid\xE9o ${i + 1} \xB7 sous-titres`, amount: cfg.subtitlesPrice });
      price += cfg.subtitlesPrice;
    }
    if (extra > 0) {
      details.push({ label: `Vid\xE9o ${i + 1} \xB7 ${extra} r\xE9vision(s) en plus`, amount: extra * cfg.extraRevisionPrice });
      price += extra * cfg.extraRevisionPrice;
    }
    clean.push({ seconds, subtitles, extraRevisions: extra });
  });
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "editing",
    label: `Montage vid\xE9o \xB7 ${videos.length} vid\xE9o(s)`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "editing", videos: clean }
  };
}
function priceAd(raw, id) {
  const brief = raw.brief === void 0 ? "" : raw.brief;
  if (typeof brief !== "string" || brief.length > 2e3) invalid("Description du projet trop longue.");
  return {
    id,
    service: "ad",
    label: "Production publicitaire \xB7 sur devis",
    price: null,
    details: [{ label: "Prix fix\xE9 par le studio apr\xE8s \xE9tude du projet", amount: 0 }],
    minPriceApplied: false,
    input: { service: "ad", brief: brief.trim() }
  };
}
function minFor(cat, s) {
  return s === "ad" ? 0 : cat[s].minPrice;
}
function headroom(cat, lines) {
  return lines.reduce((sum, l) => sum + Math.max(0, (l.price ?? 0) - minFor(cat, l.service)), 0);
}
function bestDiscount(cat, lines, subtotal, orderDate) {
  const priced = lines.filter((l) => l.price !== null);
  const candidates = [];
  let order = 0;
  for (const p of cat.promotions) {
    order++;
    if (!p.active) continue;
    if (p.validFrom && orderDate < p.validFrom) continue;
    if (p.validTo && orderDate > p.validTo) continue;
    if (subtotal < p.minSubtotal) continue;
    const eligible = p.services.length ? priced.filter((l) => p.services.includes(l.service)) : priced;
    const base = eligible.reduce((s, l) => s + l.price, 0);
    if (base <= 0) continue;
    const raw = p.kind === "percent" ? divRound(base * p.value, 100) : Math.min(p.value, base);
    const amount = Math.min(raw, headroom(cat, eligible));
    if (amount > 0) candidates.push({ id: p.id, name: p.name, source: "promotion", amount, order });
  }
  for (const b of cat.bundles) {
    order++;
    if (!b.active) continue;
    if (!b.requires.every((s) => priced.some((l) => l.service === s))) continue;
    const eligible = priced.filter((l) => b.requires.includes(l.service));
    const base = eligible.reduce((s, l) => s + l.price, 0);
    const amount = Math.min(divRound(base * b.percent, 100), headroom(cat, eligible));
    if (amount > 0) candidates.push({ id: b.id, name: b.name, source: "bundle", amount, order });
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => y.amount - x.amount || x.order - y.order);
  const { order: _o, ...best } = candidates[0];
  void _o;
  return best;
}
function priceCart(cat, cartIn, now) {
  if (!Array.isArray(cartIn) || cartIn.length === 0) invalid("Le panier est vide.");
  if (cartIn.length > MAX_LINES) invalid(`Au plus ${MAX_LINES} lignes par commande.`);
  const lines = cartIn.map((raw, i) => {
    if (!isObj2(raw)) invalid(`Ligne ${i + 1} invalide.`);
    const id = `l${i + 1}`;
    const service = raw.service;
    switch (service) {
      case "studio":
        if (!cat.studio.enabled) invalid("La location du studio n'est pas disponible.");
        return priceStudio(cat, raw, now, id);
      case "product":
        if (!cat.product.enabled) invalid("Le shooting produit n'est pas disponible.");
        return priceProduct(cat, raw, id);
      case "video":
        if (!cat.video.enabled) invalid("Le shooting vid\xE9o n'est pas disponible.");
        return priceVideo(cat, raw, id);
      case "editing":
        if (!cat.editing.enabled) invalid("Le montage vid\xE9o n'est pas disponible.");
        return priceEditing(cat, raw, id);
      case "ad":
        if (!cat.ad.enabled) invalid("La production publicitaire n'est pas disponible.");
        return priceAd(raw, id);
      default:
        return invalid(`Ligne ${i + 1} : service inconnu.`);
    }
  });
  const keys = /* @__PURE__ */ new Set();
  for (const l of lines) {
    for (const k of l.slotKeys ?? []) {
      if (keys.has(k)) invalid("Deux r\xE9servations du panier se chevauchent.");
      keys.add(k);
    }
  }
  const subtotal = lines.reduce((s, l) => s + (l.price ?? 0), 0);
  assertDzd(subtotal, "sous-total");
  const pending = lines.some((l) => l.price === null);
  const orderDate = utcMsToAlgiers(now).date;
  const base = {
    catalogVersion: cat.version,
    provisional: cat.provisional,
    currency: "DZD",
    lines,
    subtotal,
    depositPercent: cat.depositPercent,
    rounding: "Dinars entiers ; arrondi au dinar le plus proche (0,5 vers le haut) \xE0 chaque segment ou remise.",
    computedAt: new Date(now).toISOString()
  };
  if (pending) {
    return { ...base, status: "quote-pending", discount: null, total: null, deposit: null, remaining: null };
  }
  const discount = bestDiscount(cat, lines, subtotal, orderDate);
  const total = subtotal - (discount?.amount ?? 0);
  const deposit = percentOfDzd(total, cat.depositPercent);
  return { ...base, status: "priced", discount, total, deposit, remaining: total - deposit };
}

// src/pricing/studioGrid.ts
var minutesOf3 = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
var isObj3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
function slug(name) {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return s || "option";
}
function studioFromGrid(gridIn, base) {
  if (!isObj3(gridIn)) invalid("Grille de tarifs invalide.");
  const g = gridIn;
  if (!Array.isArray(g.bands) || g.bands.length < 1 || g.bands.length > 12) invalid("Il faut entre 1 et 12 tranches horaires.");
  const bands = g.bands.map((b, i) => {
    if (!isObj3(b)) invalid(`Tranche ${i + 1} invalide.`);
    const from = assertHm(b.from);
    const to = assertHm(b.to);
    if (minutesOf3(to) <= minutesOf3(from)) invalid(`Tranche ${i + 1} : l'heure de fin doit \xEAtre apr\xE8s l'heure de d\xE9but.`);
    return { from, to };
  });
  for (let i = 1; i < bands.length; i++) {
    if (minutesOf3(bands[i].from) < minutesOf3(bands[i - 1].to)) invalid(`Les tranches ${i} et ${i + 1} se chevauchent ou ne sont pas dans l'ordre.`);
  }
  if (!Array.isArray(g.rates) || g.rates.length !== 7) invalid("La grille doit avoir 7 jours.");
  const rates = g.rates.map((row, d) => {
    if (!Array.isArray(row) || row.length !== bands.length) invalid(`${DAY_NAMES[d]} : une case par tranche.`);
    return row.map((v, b) => v === null || v === "" ? null : assertDzd(v, `${DAY_NAMES[d]} ${bands[b].from}\u2013${bands[b].to}`));
  });
  const openingHours = {};
  for (let d = 0; d < 7; d++) {
    const open = rates[d].map((v, b) => v === null ? -1 : b).filter((b) => b >= 0);
    if (!open.length) {
      openingHours[String(d)] = null;
      continue;
    }
    const first = open[0];
    const last = open[open.length - 1];
    for (let b = first; b <= last; b++) {
      if (rates[d][b] === null) invalid(`${DAY_NAMES[d]} : case vide entre deux tranches ouvertes. Laissez vide seulement en d\xE9but ou en fin de journ\xE9e.`);
      if (b > first && bands[b].from !== bands[b - 1].to) invalid(`${DAY_NAMES[d]} : trou entre ${bands[b - 1].to} et ${bands[b].from}. Les tranches ouvertes doivent se suivre.`);
    }
    openingHours[String(d)] = { open: bands[first].from, close: bands[last].to };
  }
  const periods = [];
  bands.forEach((band, b) => {
    const byRate = /* @__PURE__ */ new Map();
    for (let d = 0; d < 7; d++) {
      const r = rates[d][b];
      if (r !== null) byRate.set(r, [...byRate.get(r) ?? [], d]);
    }
    for (const [price, days] of byRate) periods.push({ days, from: band.from, to: band.to, price });
  });
  if (!periods.length) invalid("Au moins une case doit avoir un prix.");
  if (!Array.isArray(g.addons) || g.addons.length > 30) invalid("Options invalides.");
  const ids = /* @__PURE__ */ new Set();
  const addons2 = g.addons.map((a, i) => {
    if (!isObj3(a)) invalid(`Option ${i + 1} invalide.`);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 80) invalid(`Option ${i + 1} : nom manquant.`);
    const name = a.name.trim();
    let id = typeof a.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : slug(name);
    for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`;
    ids.add(id);
    const out = { id, name, price: assertDzd(a.price, `Option \xAB ${name} \xBB`) };
    if (a.unit === "hour") out.unit = "hour";
    else if (a.unit !== void 0 && a.unit !== "booking") invalid(`Option \xAB ${name} \xBB : unit\xE9 invalide.`);
    if (typeof a.description === "string" && a.description.trim()) {
      if (a.description.length > 160) invalid(`Option \xAB ${name} \xBB : description trop longue (160 caract\xE8res au plus).`);
      out.description = a.description.trim();
    }
    return out;
  });
  const int = (v, field) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) invalid(`${field} invalide.`);
    return v;
  };
  const minMinutes = int(g.minMinutes, "Dur\xE9e minimale");
  const stepMinutes = int(g.stepMinutes, "Pas de r\xE9servation");
  if (stepMinutes > 0 && minMinutes % stepMinutes !== 0) {
    invalid(`La dur\xE9e minimale (${minMinutes} min) doit \xEAtre un multiple du pas de r\xE9servation (${stepMinutes} min), par exemple ${Math.ceil(minMinutes / stepMinutes) * stepMinutes} min.`);
  }
  return {
    enabled: base.enabled,
    openingHours,
    periods,
    minMinutes,
    stepMinutes,
    bufferMinutes: int(g.bufferMinutes, "Temps entre deux r\xE9servations"),
    specialDates: base.specialDates,
    addons: addons2,
    minPrice: assertDzd(g.minPrice, "Prix minimum")
  };
}
function gridFromStudio(s) {
  const keys = [...new Set(s.periods.map((p) => `${p.from}-${p.to}`))].sort((a, b) => minutesOf3(a.slice(0, 5)) - minutesOf3(b.slice(0, 5)));
  const bands = keys.map((k) => ({ from: k.slice(0, 5), to: k.slice(6, 11) }));
  const rates = Array.from(
    { length: 7 },
    (_, d) => bands.map((b) => s.periods.find((p) => p.from === b.from && p.to === b.to && p.days.includes(d))?.price ?? null)
  );
  return {
    bands,
    rates,
    addons: (s.addons ?? []).map((a) => ({ id: a.id, name: a.name, price: a.price, ...a.unit ? { unit: a.unit } : {}, ...a.description ? { description: a.description } : {} })),
    minMinutes: s.minMinutes,
    stepMinutes: s.stepMinutes,
    bufferMinutes: s.bufferMinutes,
    minPrice: s.minPrice
  };
}

// src/web/studio-core.ts
var ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomId(length, rand = defaultRandom) {
  let out = "";
  while (out.length < length) {
    for (const b of rand(length * 2)) {
      if (b < 248) out += ALNUM[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
function defaultRandom(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
var shortCode = (orderId) => orderId.slice(0, 6).toUpperCase();
var formatRef = (year, n) => `STU-${year}-${String(n).padStart(6, "0")}`;
var fmtDA = (n) => `${n.toLocaleString("fr-FR").replace(/[  ]/g, " ")} DA`;
function whatsappLink(phone, text2) {
  const digits = phone.startsWith("213") && /^\d+$/.test(phone) ? phone : normalizeDzPhone(phone).e164.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text2)}`;
}
function assertTrackingUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\/\S+suivi\.html\?t=[A-Za-z0-9]+$/.test(url)) {
    throw new AppError("invalid-argument", "Lien de suivi manquant : message WhatsApp impossible.");
  }
  return url;
}
function clientWhatsappText(d) {
  const url = assertTrackingUrl(d.trackingUrl);
  const lines = d.pricing.lines.map((l) => `\u2022 ${l.label}${l.price === null ? " (sur devis)" : ` : ${fmtDA(l.price)}`}`);
  const money = d.pricing.total === null ? "Total : sur devis" : `Total : ${fmtDA(d.pricing.total)} \u2014 acompte ${d.pricing.depositPercent} % : ${fmtDA(d.pricing.deposit)}`;
  return [
    "Bonjour, je viens d'envoyer une demande sur le site du studio.",
    `Demande n\xB0 ${d.code} \u2014 ${d.name}`,
    `Lien de suivi de ma demande : ${url}`,
    "",
    ...lines,
    money
  ].join("\n");
}
function staffWhatsappText(d) {
  const who = d.ref ? `${d.ref} (demande ${d.code})` : `demande n\xB0 ${d.code}`;
  const body = {
    pending: `nous avons bien re\xE7u votre ${who}.${d.deposit ? ` Pour la confirmer, merci de verser l'acompte de ${fmtDA(d.deposit)}.` : ""}`,
    confirmed: `votre acompte est bien re\xE7u : votre ${who} est confirm\xE9e.${d.total !== null && d.deposit ? ` Reste \xE0 payer : ${fmtDA(d.total - d.deposit)}.` : ""}`,
    cancelled: `votre ${who} est annul\xE9e.`,
    done: `merci ! Votre ${who} est termin\xE9e.`
  };
  return `Bonjour ${d.name}, ${body[d.status] ?? `votre ${who} : ${d.status}.`}
Suivi : ${d.trackingUrl}`;
}
function paymentWhatsappText(d) {
  const who = d.ref ? `${d.ref} (demande ${d.code})` : `demande n\xB0 ${d.code}`;
  const body = {
    deposit: `nous avons bien re\xE7u votre acompte de ${fmtDA(d.amount)} pour votre ${who} : elle est confirm\xE9e.${d.remaining ? ` Reste \xE0 payer : ${fmtDA(d.remaining)}.` : ""}`,
    balance: `nous avons bien re\xE7u votre paiement de ${fmtDA(d.amount)} pour votre ${who}. Merci !`,
    refund: `nous vous avons rembours\xE9 ${fmtDA(d.amount)} pour votre ${who}.`
  };
  return `Bonjour ${d.name}, ${body[d.kind] ?? `paiement de ${fmtDA(d.amount)} pour votre ${who}.`}
Suivi : ${d.trackingUrl}`;
}
function slotsByDay(keys) {
  var _a;
  const out = {};
  for (const k of [...new Set(keys)].sort()) (out[_a = k.slice(0, 10)] ?? (out[_a] = [])).push(k.slice(11));
  return out;
}
function buildClientOrder(d) {
  const slotKeys = [...new Set(d.pricing.lines.flatMap((l) => l.slotKeys ?? []))].sort();
  const slots = slotsByDay(slotKeys);
  const quotePending = d.pricing.status === "quote-pending";
  const lines = d.pricing.lines.map((l) => ({ service: l.service, label: l.label, price: l.price, booking: l.booking ?? null }));
  return {
    slotKeys,
    /** À écrire en Timestamp dans la demande, sa fiche de suivi et chaque tranche (null si pas de studio). */
    holdExpiresAtMs: slotKeys.length ? d.holdExpiresAtMs : null,
    slots,
    order: {
      status: "pending",
      source: "web",
      customer: { name: d.name, phone: d.phone },
      lines: d.pricing.lines.map((l) => l.input),
      pricing: JSON.parse(JSON.stringify(d.pricing)),
      slots,
      trackingToken: d.trackingToken,
      note: d.note,
      catalogVersion: d.pricing.catalogVersion
    },
    tracking: {
      orderId: d.orderId,
      code: shortCode(d.orderId),
      status: "pending",
      name: d.name.split(/\s+/)[0],
      lines,
      total: d.pricing.total,
      deposit: d.pricing.deposit,
      remaining: d.pricing.remaining,
      quotePending
    }
  };
}
function verifyOrderPricing(catalog, lines, createdAtMs, claimed, blocked) {
  try {
    const p = priceCart(catalog, lines, createdAtMs);
    const problems = [];
    if (p.subtotal !== claimed.subtotal) problems.push(`Sous-total re\xE7u ${fmtDA(claimed.subtotal)}, recalcul\xE9 ${fmtDA(p.subtotal)}.`);
    if (p.total !== claimed.total) problems.push(`Total re\xE7u ${claimed.total === null ? "sur devis" : fmtDA(claimed.total)}, recalcul\xE9 ${p.total === null ? "sur devis" : fmtDA(p.total)}.`);
    if (p.deposit !== claimed.deposit) problems.push("Acompte diff\xE9rent du tarif.");
    const keysA = JSON.stringify(slotsByDay(p.lines.flatMap((l) => l.slotKeys ?? [])));
    const keysB = JSON.stringify(slotsByDay(claimed.lines.flatMap((l) => l.slotKeys ?? [])));
    const keysC = JSON.stringify(Object.fromEntries(Object.entries(blocked).sort()));
    if (keysA !== keysB || keysA !== keysC) problems.push("Les tranches bloqu\xE9es ne correspondent pas au cr\xE9neau.");
    return { ok: problems.length === 0, pricing: p, problems };
  } catch (e) {
    return { ok: false, pricing: null, problems: [e.message] };
  }
}
function algiersLabel(ms) {
  const t = utcMsToAlgiers(ms);
  return `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}/${t.date.slice(0, 4)} ${t.hm.slice(0, 2)}:${t.hm.slice(2)}`;
}
export {
  AppError,
  DEFAULT_CATALOG,
  algiersLabel,
  assertCatalog,
  buildClientOrder,
  clientWhatsappText,
  fmtDA,
  formatRef,
  gridFromStudio,
  normalizeDzPhone,
  paymentWhatsappText,
  percentOfDzd,
  priceCart,
  randomId,
  shortCode,
  slotsByDay,
  staffWhatsappText,
  studioFromGrid,
  utcMsToAlgiers,
  verifyOrderPricing,
  whatsappLink
};
