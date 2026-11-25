/**
 * Catalogue et tarifs du studio. Tous les prix viennent d'ici (modifiables
 * depuis le tableau de bord en phase 9), jamais du code du site client.
 *
 * DEFAULT_CATALOG contient des tarifs PROVISOIRES : location studio fixée par
 * l'admin le 25/11/2026 (forfait par tranche horaire selon le jour),
 * autres services réglés le 20/11/2026 sur la moyenne du marché algérien.
 * Tout se modifie depuis la page d'administration, sans toucher au code.
 */
import { invalid } from "../lib/errors";
import { assertDzd } from "../lib/money";
import { assertHm, assertYmd } from "../lib/time";

export type ServiceId = "studio" | "product" | "video" | "editing" | "ad";
export const SERVICE_IDS: readonly ServiceId[] = ["studio", "product", "video", "editing", "ad"];

/** Jours : 0 = dimanche … 6 = samedi. */
export interface StudioPeriod {
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM (exclu)
  price: number; // DA, forfait de la tranche entière
}

export interface SpecialDate {
  date: string; // AAAA-MM-JJ
  kind: "closed" | "adjust" | "override";
  /** adjust : pourcentage entier, +20 = majoration de 20 %, -10 = remise de 10 %. */
  percent?: number;
  /** override : forfait qui remplace celui de chaque tranche ce jour-là. */
  price?: number;
  label?: string;
}

export interface StudioConfig {
  enabled: boolean;
  /** Horaires d'ouverture par jour (0–6) ; null = fermé. */
  openingHours: Record<string, { open: string; close: string } | null>;
  periods: StudioPeriod[];
  minMinutes: number;
  stepMinutes: number;
  bufferMinutes: number;
  specialDates: SpecialDate[];
  /** Options ajoutées une fois par réservation (ex. iPhone 15 Pro Max). */
  addons: Addon[];
  minPrice: number;
}

export interface ProductPackage {
  id: string;
  name: string;
  products: number;
  photosPerProduct: number;
  price: number;
}

export type AddonUnit = "booking" | "hour";

export interface Addon {
  id: string;
  name: string;
  price: number;
  /** Location studio : « hour » = prix × durée réservée ; absent ou « booking » = une fois par réservation. */
  unit?: AddonUnit;
  /** Texte court affiché au client sous la case à cocher. */
  description?: string;
}

export interface ProductConfig {
  enabled: boolean;
  packages: ProductPackage[];
  extraPhotoPrice: number;
  addons: Addon[];
  minPrice: number;
}

export interface VolumeTier {
  minQty: number;
  percent: number; // remise entière en %
}

export interface VideoConfig {
  enabled: boolean;
  pricePerReel: number;
  formats: string[];
  volumeTiers: VolumeTier[];
  addons: Addon[];
  maxReels: number;
  minPrice: number;
}

export interface EditingTier {
  maxSeconds: number;
  price: number;
}

export interface EditingConfig {
  enabled: boolean;
  durationTiers: EditingTier[];
  subtitlesPrice: number;
  includedRevisions: number;
  extraRevisionPrice: number;
  maxVideos: number;
  minPrice: number;
}

export interface AdConfig {
  enabled: boolean;
  /** "quote" : toujours sur devis, l'admin fixe le prix. */
  mode: "quote";
}

export interface Promotion {
  id: string;
  name: string;
  kind: "percent" | "amount";
  value: number;
  services: ServiceId[]; // vide = toute la commande
  validFrom: string | null; // AAAA-MM-JJ inclus
  validTo: string | null; // AAAA-MM-JJ inclus
  minSubtotal: number;
  active: boolean;
}

export interface BundleRule {
  id: string;
  name: string;
  requires: ServiceId[]; // tous présents dans le panier
  percent: number; // sur les lignes de ces services
  active: boolean;
}

export interface Catalog {
  version: string;
  currency: "DZD";
  depositPercent: number;
  provisional: boolean;
  studio: StudioConfig;
  product: ProductConfig;
  video: VideoConfig;
  editing: EditingConfig;
  ad: AdConfig;
  promotions: Promotion[];
  bundles: BundleRule[];
}

// ---------------------------------------------------------------- tarifs provisoires

const OPEN = { open: "08:00", close: "22:00" };
const SUN_WED = [0, 1, 2, 3];
const THU = [4];
const FRI_SAT = [5, 6];

export const DEFAULT_CATALOG: Catalog = {
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
      { days: SUN_WED, from: "12:00", to: "17:00", price: 2000 },
      { days: SUN_WED, from: "17:00", to: "22:00", price: 2500 },
      { days: THU, from: "08:00", to: "12:00", price: 2000 },
      { days: THU, from: "12:00", to: "17:00", price: 2000 },
      { days: THU, from: "17:00", to: "22:00", price: 3000 },
      { days: FRI_SAT, from: "08:00", to: "12:00", price: 2500 },
      { days: FRI_SAT, from: "12:00", to: "17:00", price: 3000 },
      { days: FRI_SAT, from: "17:00", to: "22:00", price: 3500 },
    ],
    minMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    specialDates: [],
    // Options à cocher par le client. Mannequin, voix off et montage : prix PROVISOIRES à fixer
    // dans la page Équipe (« Options par réservation »).
    addons: [
      { id: "iphone15pm", name: "Utilisation iPhone 15 Pro Max", price: 800 },
      { id: "mannequin", name: "Mannequin", price: 1000, unit: "hour", description: "Un mannequin pendant toute la séance." },
      { id: "voixoff", name: "Voix off", price: 2000, description: "Enregistrement d'une voix off pour votre vidéo." },
      { id: "montage", name: "Montage après la séance", price: 3500, description: "Une vidéo montée jusqu'à 1 min, 2 révisions incluses." },
    ],
    minPrice: 0,
  },
  product: {
    enabled: true,
    packages: [
      { id: "p5", name: "Pack 5 produits", products: 5, photosPerProduct: 3, price: 12000 },
      { id: "p10", name: "Pack 10 produits", products: 10, photosPerProduct: 3, price: 22000 },
      { id: "p20", name: "Pack 20 produits", products: 20, photosPerProduct: 3, price: 40000 },
    ],
    extraPhotoPrice: 1000,
    addons: [],
    minPrice: 12000,
  },
  video: {
    enabled: true,
    pricePerReel: 8000,
    formats: ["9:16", "16:9"],
    volumeTiers: [
      { minQty: 3, percent: 10 },
      { minQty: 5, percent: 15 },
    ],
    addons: [],
    maxReels: 30,
    minPrice: 8000,
  },
  editing: {
    enabled: true,
    durationTiers: [
      { maxSeconds: 60, price: 3500 },
      { maxSeconds: 180, price: 6000 },
      { maxSeconds: 600, price: 12000 },
    ],
    subtitlesPrice: 1500,
    includedRevisions: 2,
    extraRevisionPrice: 1000,
    maxVideos: 30,
    minPrice: 3500,
  },
  ad: { enabled: true, mode: "quote" },
  promotions: [],
  bundles: [],
};

// ---------------------------------------------------------------- validation

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) invalid(`${field} invalide.`, { field, value: v });
  return v;
}
function text(v: unknown, field: string, max = 80): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) invalid(`${field} invalide.`, { field });
  return v.trim();
}
function bool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") invalid(`${field} invalide.`, { field });
  return v;
}
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

function addons(v: unknown, field: string, allowHourly = false): Addon[] {
  if (!Array.isArray(v) || v.length > 30) invalid(`${field} invalide.`);
  const ids = new Set<string>();
  return v.map((a, i) => {
    if (!isObj(a)) invalid(`${field}[${i}] invalide.`);
    const id = text(a.id, `${field}[${i}].id`, 40);
    if (!ID_RE.test(id) || ids.has(id)) invalid(`${field}[${i}].id invalide ou en double.`);
    ids.add(id);
    const out: Addon = { id, name: text(a.name, `${field}[${i}].name`), price: assertDzd(a.price, `${field}[${i}].price`) };
    if (a.unit !== undefined && a.unit !== "booking") {
      if (a.unit !== "hour" || !allowHourly) invalid(`${field}[${i}].unit invalide.`);
      out.unit = "hour";
    }
    if (a.description !== undefined && a.description !== "") out.description = text(a.description, `${field}[${i}].description`, 160);
    return out;
  });
}

/**
 * Vérifie un catalogue complet avant publication. Refuse tout prix non entier,
 * période qui se chevauche, horaire incohérent : un catalogue publié est
 * toujours calculable sans erreur.
 */
export function assertCatalog(c: unknown): Catalog {
  if (!isObj(c)) invalid("Catalogue invalide.");
  const version = text(c.version, "version", 60);
  if (c.currency !== "DZD") invalid("Devise invalide (DZD uniquement).");
  const depositPercent = intIn(c.depositPercent, "depositPercent", 0, 100);
  const provisional = bool(c.provisional, "provisional");

  // Studio
  const s = c.studio;
  if (!isObj(s)) invalid("studio invalide.");
  const oh = s.openingHours;
  if (!isObj(oh)) invalid("studio.openingHours invalide.");
  const openingHours: StudioConfig["openingHours"] = {};
  for (let d = 0; d < 7; d++) {
    const v = oh[String(d)];
    if (v === null || v === undefined) {
      openingHours[String(d)] = null;
      continue;
    }
    if (!isObj(v)) invalid(`Horaires du jour ${d} invalides.`);
    const open = assertHm(v.open);
    const close = assertHm(v.close);
    if (minutesOf(close) <= minutesOf(open)) invalid(`Horaires du jour ${d} : fermeture avant ouverture.`);
    openingHours[String(d)] = { open, close };
  }
  if (!Array.isArray(s.periods) || s.periods.length === 0 || s.periods.length > 50) invalid("studio.periods invalide.");
  const periods: StudioPeriod[] = s.periods.map((p, i) => {
    if (!isObj(p) || !Array.isArray(p.days) || p.days.length === 0) invalid(`Période ${i} invalide.`);
    const days = [...new Set(p.days.map((d) => intIn(d, `periods[${i}].days`, 0, 6)))].sort();
    const from = assertHm(p.from);
    const to = assertHm(p.to);
    if (minutesOf(to) <= minutesOf(from)) invalid(`Période ${i} : fin avant début.`);
    return { days, from, to, price: assertDzd(p.price, `periods[${i}].price`) };
  });
  // Pas de chevauchement de périodes le même jour.
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i];
      const b = periods[j];
      const sameDay = a.days.some((d) => b.days.includes(d));
      const overlap = minutesOf(a.from) < minutesOf(b.to) && minutesOf(b.from) < minutesOf(a.to);
      if (sameDay && overlap) invalid(`Les périodes ${i} et ${j} se chevauchent.`);
    }
  }
  const stepMinutes = intIn(s.stepMinutes, "studio.stepMinutes", 5, 240);
  if (1440 % stepMinutes !== 0) invalid("studio.stepMinutes doit diviser une journée.");
  const minMinutes = intIn(s.minMinutes, "studio.minMinutes", stepMinutes, 1440);
  const bufferMinutes = intIn(s.bufferMinutes, "studio.bufferMinutes", 0, 240);
  if (!Array.isArray(s.specialDates) || s.specialDates.length > 400) invalid("studio.specialDates invalide.");
  const seen = new Set<string>();
  const specialDates: SpecialDate[] = s.specialDates.map((sd, i) => {
    if (!isObj(sd)) invalid(`Date spéciale ${i} invalide.`);
    const date = assertYmd(sd.date);
    if (seen.has(date)) invalid(`Date spéciale ${date} en double.`);
    seen.add(date);
    const label = sd.label === undefined ? undefined : text(sd.label, `specialDates[${i}].label`);
    if (sd.kind === "closed") return { date, kind: "closed", label };
    if (sd.kind === "adjust") return { date, kind: "adjust", percent: intIn(sd.percent, `specialDates[${i}].percent`, -90, 300), label };
    if (sd.kind === "override") return { date, kind: "override", price: assertDzd(sd.price, `specialDates[${i}].price`), label };
    return invalid(`Date spéciale ${i} : type inconnu.`);
  });
  const studio: StudioConfig = {
    enabled: bool(s.enabled, "studio.enabled"),
    openingHours,
    periods,
    minMinutes,
    stepMinutes,
    bufferMinutes,
    specialDates,
    addons: addons(s.addons ?? [], "studio.addons", true),
    minPrice: assertDzd(s.minPrice, "studio.minPrice"),
  };

  // Shooting produit
  const p = c.product;
  if (!isObj(p) || !Array.isArray(p.packages) || p.packages.length > 30) invalid("product invalide.");
  const pkgIds = new Set<string>();
  const packages: ProductPackage[] = p.packages.map((k, i) => {
    if (!isObj(k)) invalid(`Pack ${i} invalide.`);
    const id = text(k.id, `packages[${i}].id`, 40);
    if (!ID_RE.test(id) || pkgIds.has(id)) invalid(`Pack ${i} : identifiant invalide ou en double.`);
    pkgIds.add(id);
    return {
      id,
      name: text(k.name, `packages[${i}].name`),
      products: intIn(k.products, `packages[${i}].products`, 1, 1000),
      photosPerProduct: intIn(k.photosPerProduct, `packages[${i}].photosPerProduct`, 1, 100),
      price: assertDzd(k.price, `packages[${i}].price`),
    };
  });
  const product: ProductConfig = {
    enabled: bool(p.enabled, "product.enabled"),
    packages,
    extraPhotoPrice: assertDzd(p.extraPhotoPrice, "product.extraPhotoPrice"),
    addons: addons(p.addons, "product.addons"),
    minPrice: assertDzd(p.minPrice, "product.minPrice"),
  };
  if (product.enabled && packages.length === 0) invalid("Shooting produit activé sans aucun pack.");

  // Shooting vidéo
  const v = c.video;
  if (!isObj(v) || !Array.isArray(v.formats) || !Array.isArray(v.volumeTiers)) invalid("video invalide.");
  const formats = v.formats.map((f, i) => text(f, `video.formats[${i}]`, 20));
  if (formats.length === 0) invalid("Au moins un format vidéo.");
  const volumeTiers = v.volumeTiers
    .map((t, i) => {
      if (!isObj(t)) invalid(`Palier ${i} invalide.`);
      return { minQty: intIn(t.minQty, `volumeTiers[${i}].minQty`, 2, 1000), percent: intIn(t.percent, `volumeTiers[${i}].percent`, 1, 90) };
    })
    .sort((a, b) => a.minQty - b.minQty);
  for (let i = 1; i < volumeTiers.length; i++) {
    if (volumeTiers[i].minQty === volumeTiers[i - 1].minQty) invalid("Deux paliers de volume au même seuil.");
  }
  const video: VideoConfig = {
    enabled: bool(v.enabled, "video.enabled"),
    pricePerReel: assertDzd(v.pricePerReel, "video.pricePerReel"),
    formats,
    volumeTiers,
    addons: addons(v.addons, "video.addons"),
    maxReels: intIn(v.maxReels, "video.maxReels", 1, 1000),
    minPrice: assertDzd(v.minPrice, "video.minPrice"),
  };

  // Montage
  const e = c.editing;
  if (!isObj(e) || !Array.isArray(e.durationTiers) || e.durationTiers.length === 0) invalid("editing invalide.");
  const durationTiers = e.durationTiers
    .map((t, i) => {
      if (!isObj(t)) invalid(`Tranche de montage ${i} invalide.`);
      return { maxSeconds: intIn(t.maxSeconds, `durationTiers[${i}].maxSeconds`, 1, 36000), price: assertDzd(t.price, `durationTiers[${i}].price`) };
    })
    .sort((a, b) => a.maxSeconds - b.maxSeconds);
  for (let i = 1; i < durationTiers.length; i++) {
    if (durationTiers[i].maxSeconds === durationTiers[i - 1].maxSeconds) invalid("Deux tranches de montage à la même durée.");
  }
  const editing: EditingConfig = {
    enabled: bool(e.enabled, "editing.enabled"),
    durationTiers,
    subtitlesPrice: assertDzd(e.subtitlesPrice, "editing.subtitlesPrice"),
    includedRevisions: intIn(e.includedRevisions, "editing.includedRevisions", 0, 50),
    extraRevisionPrice: assertDzd(e.extraRevisionPrice, "editing.extraRevisionPrice"),
    maxVideos: intIn(e.maxVideos, "editing.maxVideos", 1, 1000),
    minPrice: assertDzd(e.minPrice, "editing.minPrice"),
  };

  // Production pub
  const a = c.ad;
  if (!isObj(a) || a.mode !== "quote") invalid("ad invalide.");
  const ad: AdConfig = { enabled: bool(a.enabled, "ad.enabled"), mode: "quote" };

  // Promotions et remises groupées
  if (!Array.isArray(c.promotions) || c.promotions.length > 100) invalid("promotions invalide.");
  const promoIds = new Set<string>();
  const promotions: Promotion[] = c.promotions.map((x, i) => {
    if (!isObj(x)) invalid(`Promotion ${i} invalide.`);
    const id = text(x.id, `promotions[${i}].id`, 40);
    if (!ID_RE.test(id) || promoIds.has(id)) invalid(`Promotion ${i} : identifiant invalide ou en double.`);
    promoIds.add(id);
    const kind = x.kind === "percent" || x.kind === "amount" ? x.kind : invalid(`Promotion ${i} : type inconnu.`);
    const value = kind === "percent" ? intIn(x.value, `promotions[${i}].value`, 1, 90) : assertDzd(x.value, `promotions[${i}].value`);
    if (!Array.isArray(x.services)) invalid(`Promotion ${i} : services invalides.`);
    const services = x.services.map((sv) => (SERVICE_IDS.includes(sv as ServiceId) ? (sv as ServiceId) : invalid(`Promotion ${i} : service inconnu.`)));
    const validFrom = x.validFrom === null ? null : assertYmd(x.validFrom);
    const validTo = x.validTo === null ? null : assertYmd(x.validTo);
    if (validFrom && validTo && validTo < validFrom) invalid(`Promotion ${i} : dates inversées.`);
    return { id, name: text(x.name, `promotions[${i}].name`), kind, value, services, validFrom, validTo, minSubtotal: assertDzd(x.minSubtotal, `promotions[${i}].minSubtotal`), active: bool(x.active, `promotions[${i}].active`) };
  });
  if (!Array.isArray(c.bundles) || c.bundles.length > 50) invalid("bundles invalide.");
  const bundleIds = new Set<string>();
  const bundles: BundleRule[] = c.bundles.map((x, i) => {
    if (!isObj(x) || !Array.isArray(x.requires)) invalid(`Remise groupée ${i} invalide.`);
    const id = text(x.id, `bundles[${i}].id`, 40);
    if (!ID_RE.test(id) || bundleIds.has(id) || promoIds.has(id)) invalid(`Remise groupée ${i} : identifiant invalide ou en double.`);
    bundleIds.add(id);
    const requires = [...new Set(x.requires.map((sv) => (SERVICE_IDS.includes(sv as ServiceId) ? (sv as ServiceId) : invalid(`Remise groupée ${i} : service inconnu.`))))];
    if (requires.length < 2) invalid(`Remise groupée ${i} : au moins deux services.`);
    return { id, name: text(x.name, `bundles[${i}].name`), requires, percent: intIn(x.percent, `bundles[${i}].percent`, 1, 90), active: bool(x.active, `bundles[${i}].active`) };
  });

  return { version, currency: "DZD", depositPercent, provisional, studio, product, video, editing, ad, promotions, bundles };
}
