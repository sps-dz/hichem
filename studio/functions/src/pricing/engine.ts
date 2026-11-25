/**
 * Moteur de prix : UN seul calcul, en dinars entiers, exécuté sur le serveur.
 * Le site client l'appelle pour afficher l'estimation ; à la création de la
 * commande, le serveur le refait et ignore tout prix envoyé par le navigateur.
 *
 * Panier → prix de chaque ligne → sous-total → meilleure remise (une seule,
 * sans cumul) → total → acompte → reste. Le résultat complet sert d'instantané
 * figé dans la commande.
 */
import { invalid } from "../lib/errors";
import { assertDzd, percentOfDzd } from "../lib/money";
import { algiersToUtcMs, assertHm, assertYmd, slotKeysFor, utcMsToAlgiers } from "../lib/time";
import { Addon, Catalog, ServiceId, StudioPeriod } from "./catalog";

/** a / b arrondi au plus proche, 0,5 vers le haut (entiers positifs). */
export function divRound(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= 0) invalid("Calcul hors limites.");
  return Math.floor((2 * a + b) / (2 * b));
}

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fmt = (n: number) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} DA`;

// ---------------------------------------------------------------- types

export type CartLineInput =
  | { service: "studio"; date: string; start: string; durationMinutes: number; addons?: string[] }
  | { service: "product"; packageId: string; extraPhotos?: number; addons?: string[] }
  | { service: "video"; reels: number; format: string; addons?: string[] }
  | { service: "editing"; videos: { seconds: number; subtitles?: boolean; extraRevisions?: number }[] }
  | { service: "ad"; brief?: string };

export interface PriceDetail {
  label: string;
  amount: number;
}

export interface PricedLine {
  id: string;
  service: ServiceId;
  label: string;
  /** null = devis en attente (production publicitaire). */
  price: number | null;
  details: PriceDetail[];
  minPriceApplied: boolean;
  /** Location studio : tranches de calendrier à bloquer (tampon compris). */
  slotKeys?: string[];
  booking?: { date: string; start: string; end: string; durationMinutes: number };
  input: CartLineInput;
}

export interface AppliedDiscount {
  id: string;
  name: string;
  source: "promotion" | "bundle";
  amount: number;
}

export interface Pricing {
  catalogVersion: string;
  provisional: boolean;
  currency: "DZD";
  status: "priced" | "quote-pending";
  lines: PricedLine[];
  subtotal: number;
  discount: AppliedDiscount | null;
  total: number | null;
  depositPercent: number;
  deposit: number | null;
  remaining: number | null;
  rounding: string;
  computedAt: string;
}

const MAX_LINES = 20;

// ---------------------------------------------------------------- lignes

function addonsTotal(ids: unknown, available: Addon[], details: PriceDetail[], durationMinutes = 0): number {
  if (ids === undefined) return 0;
  if (!Array.isArray(ids) || ids.length > available.length) invalid("Options invalides.");
  const seen = new Set<string>();
  let sum = 0;
  for (const id of ids) {
    const a = available.find((x) => x.id === id);
    if (!a || seen.has(String(id))) invalid("Option inconnue ou en double.", { option: id });
    seen.add(String(id));
    if (a.unit === "hour") {
      // Option à l'heure (location studio) : prix × durée, arrondi au dinar.
      const amount = divRound(a.price * durationMinutes, 60);
      const h = durationMinutes % 60 ? `${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60}` : `${durationMinutes / 60} h`;
      details.push({ label: `${a.name} · ${h} × ${fmt(a.price)}/h`, amount });
      sum += amount;
    } else {
      details.push({ label: a.name, amount: a.price });
      sum += a.price;
    }
  }
  return sum;
}

function applyMin(price: number, min: number, details: PriceDetail[]): { price: number; applied: boolean } {
  if (price >= min) return { price, applied: false };
  details.push({ label: "Ajustement au prix minimum", amount: min - price });
  return { price: min, applied: true };
}

function priceStudio(cat: Catalog, raw: Record<string, unknown>, now: number, id: string): PricedLine {
  const cfg = cat.studio;
  const date = assertYmd(raw.date);
  const start = assertHm(raw.start);
  const duration = raw.durationMinutes;
  if (typeof duration !== "number" || !Number.isSafeInteger(duration)) invalid("Durée invalide.");
  if (duration < cfg.minMinutes) invalid(`Durée minimale : ${cfg.minMinutes} minutes.`);
  if (duration % cfg.stepMinutes !== 0) invalid(`La durée doit être un multiple de ${cfg.stepMinutes} minutes.`);
  const startMin = minutesOf(start);
  if (startMin % cfg.stepMinutes !== 0) invalid(`L'heure de début doit tomber sur une tranche de ${cfg.stepMinutes} minutes.`);
  const endMin = startMin + duration;

  const special = cfg.specialDates.find((s) => s.date === date);
  if (special?.kind === "closed") invalid("Le studio est fermé ce jour-là.", { date });
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hours = cfg.openingHours[String(dow)];
  if (!hours) invalid("Le studio est fermé ce jour-là.", { date });
  if (startMin < minutesOf(hours.open) || endMin > minutesOf(hours.close)) {
    invalid(`Horaires d'ouverture ce jour-là : ${hours.open} – ${hours.close}.`, { date });
  }
  if (algiersToUtcMs(date, start) <= now) invalid("Ce créneau est déjà passé.");

  // Forfait par tranche : chaque tranche touchée par la réservation est due en
  // entier, même si elle n'est utilisée qu'en partie (16h–18h = tranche
  // 12h–17h + tranche 17h–22h).
  const periods = cfg.periods.filter((p: StudioPeriod) => p.days.includes(dow)).sort((a, b) => minutesOf(a.from) - minutesOf(b.from));
  const details: PriceDetail[] = [];
  let covered = 0;
  let price = 0;
  for (const p of periods) {
    const a = Math.max(startMin, minutesOf(p.from));
    const b = Math.min(endMin, minutesOf(p.to));
    if (b <= a) continue;
    covered += b - a;
    let amount = special?.kind === "override" ? special.price! : p.price;
    let label = `Tranche ${p.from}–${p.to} · forfait ${fmt(amount)}`;
    if (special?.kind === "adjust") {
      amount = divRound(amount * (100 + special.percent!), 100);
      label += ` · ${special.percent! > 0 ? "+" : ""}${special.percent} % (${special.label ?? "date spéciale"})`;
    } else if (special?.kind === "override") {
      label += ` (${special.label ?? "tarif du jour"})`;
    }
    details.push({ label, amount });
    price += amount;
  }
  if (covered !== duration) invalid("Une partie de ce créneau n'a pas de tarif : contactez le studio.", { date, start });
  price += addonsTotal(raw.addons, cfg.addons ?? [], details, duration);

  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "studio",
    label: `Location studio · ${date} ${start}–${hmOf(endMin)}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    slotKeys: slotKeysFor({ date, start, durationMinutes: duration, bufferMinutes: cfg.bufferMinutes, slotMinutes: cfg.stepMinutes }),
    booking: { date, start, end: hmOf(endMin), durationMinutes: duration },
    input: { service: "studio", date, start, durationMinutes: duration, addons: (raw.addons as string[] | undefined) ?? [] },
  };
}

function priceProduct(cat: Catalog, raw: Record<string, unknown>, id: string): PricedLine {
  const cfg = cat.product;
  const pkg = cfg.packages.find((p) => p.id === raw.packageId);
  if (!pkg) invalid("Pack inconnu.", { packageId: raw.packageId });
  const extra = raw.extraPhotos ?? 0;
  if (typeof extra !== "number" || !Number.isSafeInteger(extra) || extra < 0 || extra > 500) invalid("Nombre de photos supplémentaires invalide.");
  const details: PriceDetail[] = [{ label: `${pkg.name} (${pkg.products} produits × ${pkg.photosPerProduct} photos)`, amount: pkg.price }];
  let price = pkg.price;
  if (extra > 0) {
    const amount = extra * cfg.extraPhotoPrice;
    details.push({ label: `${extra} photo(s) supplémentaire(s) × ${fmt(cfg.extraPhotoPrice)}`, amount });
    price += amount;
  }
  price += addonsTotal(raw.addons, cfg.addons, details);
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "product",
    label: `Shooting produit · ${pkg.name}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "product", packageId: pkg.id, extraPhotos: extra, addons: (raw.addons as string[] | undefined) ?? [] },
  };
}

function priceVideo(cat: Catalog, raw: Record<string, unknown>, id: string): PricedLine {
  const cfg = cat.video;
  const reels = raw.reels;
  if (typeof reels !== "number" || !Number.isSafeInteger(reels) || reels < 1 || reels > cfg.maxReels) invalid(`Nombre de vidéos : entre 1 et ${cfg.maxReels}.`);
  if (typeof raw.format !== "string" || !cfg.formats.includes(raw.format)) invalid("Format vidéo invalide.", { format: raw.format });
  const base = reels * cfg.pricePerReel;
  const details: PriceDetail[] = [{ label: `${reels} vidéo(s) × ${fmt(cfg.pricePerReel)} · ${raw.format}`, amount: base }];
  let price = base;
  const tier = [...cfg.volumeTiers].reverse().find((t) => reels >= t.minQty);
  if (tier) {
    const off = divRound(base * tier.percent, 100);
    details.push({ label: `Remise de volume dès ${tier.minQty} vidéos (−${tier.percent} %)`, amount: -off });
    price -= off;
  }
  price += addonsTotal(raw.addons, cfg.addons, details);
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "video",
    label: `Shooting vidéo · ${reels} vidéo(s) ${raw.format}`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "video", reels, format: raw.format, addons: (raw.addons as string[] | undefined) ?? [] },
  };
}

function priceEditing(cat: Catalog, raw: Record<string, unknown>, id: string): PricedLine {
  const cfg = cat.editing;
  const videos = raw.videos;
  if (!Array.isArray(videos) || videos.length < 1 || videos.length > cfg.maxVideos) invalid(`Nombre de vidéos à monter : entre 1 et ${cfg.maxVideos}.`);
  const details: PriceDetail[] = [];
  let price = 0;
  const clean: { seconds: number; subtitles: boolean; extraRevisions: number }[] = [];
  videos.forEach((v, i) => {
    if (!isObj(v)) invalid(`Vidéo ${i + 1} invalide.`);
    const seconds = v.seconds;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1) invalid(`Vidéo ${i + 1} : durée invalide.`);
    const tier = cfg.durationTiers.find((t) => seconds <= t.maxSeconds);
    if (!tier) invalid(`Vidéo ${i + 1} : trop longue pour le tarif en ligne, demandez un devis.`);
    const subtitles = v.subtitles === undefined ? false : v.subtitles;
    if (typeof subtitles !== "boolean") invalid(`Vidéo ${i + 1} : sous-titres invalides.`);
    const extra = v.extraRevisions ?? 0;
    if (typeof extra !== "number" || !Number.isSafeInteger(extra) || extra < 0 || extra > 20) invalid(`Vidéo ${i + 1} : révisions invalides.`);
    details.push({ label: `Vidéo ${i + 1} · jusqu'à ${tier.maxSeconds} s · ${cfg.includedRevisions} révision(s) incluse(s)`, amount: tier.price });
    price += tier.price;
    if (subtitles) {
      details.push({ label: `Vidéo ${i + 1} · sous-titres`, amount: cfg.subtitlesPrice });
      price += cfg.subtitlesPrice;
    }
    if (extra > 0) {
      details.push({ label: `Vidéo ${i + 1} · ${extra} révision(s) en plus`, amount: extra * cfg.extraRevisionPrice });
      price += extra * cfg.extraRevisionPrice;
    }
    clean.push({ seconds, subtitles, extraRevisions: extra });
  });
  const min = applyMin(price, cfg.minPrice, details);
  return {
    id,
    service: "editing",
    label: `Montage vidéo · ${videos.length} vidéo(s)`,
    price: min.price,
    details,
    minPriceApplied: min.applied,
    input: { service: "editing", videos: clean },
  };
}

function priceAd(raw: Record<string, unknown>, id: string): PricedLine {
  const brief = raw.brief === undefined ? "" : raw.brief;
  if (typeof brief !== "string" || brief.length > 2000) invalid("Description du projet trop longue.");
  return {
    id,
    service: "ad",
    label: "Production publicitaire · sur devis",
    price: null,
    details: [{ label: "Prix fixé par le studio après étude du projet", amount: 0 }],
    minPriceApplied: false,
    input: { service: "ad", brief: brief.trim() },
  };
}

// ---------------------------------------------------------------- remises

interface Candidate extends AppliedDiscount {
  order: number;
}

function minFor(cat: Catalog, s: ServiceId): number {
  return s === "ad" ? 0 : cat[s].minPrice;
}

/** Montant maximum retirable sans faire passer une ligne sous son prix minimum. */
function headroom(cat: Catalog, lines: PricedLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, (l.price ?? 0) - minFor(cat, l.service)), 0);
}

export function bestDiscount(cat: Catalog, lines: PricedLine[], subtotal: number, orderDate: string): AppliedDiscount | null {
  const priced = lines.filter((l) => l.price !== null);
  const candidates: Candidate[] = [];
  let order = 0;
  for (const p of cat.promotions) {
    order++;
    if (!p.active) continue;
    if (p.validFrom && orderDate < p.validFrom) continue;
    if (p.validTo && orderDate > p.validTo) continue;
    if (subtotal < p.minSubtotal) continue;
    const eligible = p.services.length ? priced.filter((l) => p.services.includes(l.service)) : priced;
    const base = eligible.reduce((s, l) => s + (l.price as number), 0);
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
    const base = eligible.reduce((s, l) => s + (l.price as number), 0);
    const amount = Math.min(divRound(base * b.percent, 100), headroom(cat, eligible));
    if (amount > 0) candidates.push({ id: b.id, name: b.name, source: "bundle", amount, order });
  }
  if (!candidates.length) return null;
  // La plus avantageuse pour le client ; à égalité, la première du catalogue.
  candidates.sort((x, y) => y.amount - x.amount || x.order - y.order);
  const { order: _o, ...best } = candidates[0];
  void _o;
  return best;
}

// ---------------------------------------------------------------- panier

/**
 * Calcule un panier complet. `now` (ms) sert à refuser un créneau passé et à
 * choisir les promotions valides ce jour-là (heure d'Alger).
 */
export function priceCart(cat: Catalog, cartIn: unknown, now: number): Pricing {
  if (!Array.isArray(cartIn) || cartIn.length === 0) invalid("Le panier est vide.");
  if (cartIn.length > MAX_LINES) invalid(`Au plus ${MAX_LINES} lignes par commande.`);
  const lines: PricedLine[] = cartIn.map((raw, i) => {
    if (!isObj(raw)) invalid(`Ligne ${i + 1} invalide.`);
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
        if (!cat.video.enabled) invalid("Le shooting vidéo n'est pas disponible.");
        return priceVideo(cat, raw, id);
      case "editing":
        if (!cat.editing.enabled) invalid("Le montage vidéo n'est pas disponible.");
        return priceEditing(cat, raw, id);
      case "ad":
        if (!cat.ad.enabled) invalid("La production publicitaire n'est pas disponible.");
        return priceAd(raw, id);
      default:
        return invalid(`Ligne ${i + 1} : service inconnu.`);
    }
  });

  // Deux créneaux studio du même panier ne doivent pas se chevaucher.
  const keys = new Set<string>();
  for (const l of lines) {
    for (const k of l.slotKeys ?? []) {
      if (keys.has(k)) invalid("Deux réservations du panier se chevauchent.");
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
    currency: "DZD" as const,
    lines,
    subtotal,
    depositPercent: cat.depositPercent,
    rounding: "Dinars entiers ; arrondi au dinar le plus proche (0,5 vers le haut) à chaque segment ou remise.",
    computedAt: new Date(now).toISOString(),
  };
  if (pending) {
    // Le total, la remise et l'acompte seront calculés à l'acceptation du devis.
    return { ...base, status: "quote-pending", discount: null, total: null, deposit: null, remaining: null };
  }
  const discount = bestDiscount(cat, lines, subtotal, orderDate);
  const total = subtotal - (discount?.amount ?? 0);
  const deposit = percentOfDzd(total, cat.depositPercent);
  return { ...base, status: "priced", discount, total, deposit, remaining: total - deposit };
}
