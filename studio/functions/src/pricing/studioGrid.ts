/**
 * Grille de tarifs du studio telle que l'admin la voit : des tranches horaires
 * en colonnes (08h–12h, 12h–17h, 17h–22h…), les 7 jours en lignes, et dans
 * chaque case le FORFAIT de la tranche entière (vide = fermé sur cette tranche).
 *
 * La page d'administration envoie cette grille ; le serveur la convertit en
 * périodes de catalogue, la vérifie, et publie une nouvelle version. Aucun
 * prix n'est donc écrit dans le code.
 */
import { invalid } from "../lib/errors";
import { assertDzd } from "../lib/money";
import { assertHm } from "../lib/time";
import { Addon, StudioConfig, StudioPeriod } from "./catalog";

export interface StudioGrid {
  bands: { from: string; to: string }[];
  /** rates[jour 0=dimanche … 6=samedi][tranche] = forfait de la tranche, ou null (fermé). */
  rates: (number | null)[][];
  addons: { id?: string; name: string; price: number }[];
  minMinutes: number;
  stepMinutes: number;
  bufferMinutes: number;
  minPrice: number;
}

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function slug(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || "option";
}

/** Grille → configuration studio du catalogue (garde les dates spéciales et l'activation). */
export function studioFromGrid(gridIn: unknown, base: StudioConfig): StudioConfig {
  if (!isObj(gridIn)) invalid("Grille de tarifs invalide.");
  const g = gridIn;
  if (!Array.isArray(g.bands) || g.bands.length < 1 || g.bands.length > 12) invalid("Il faut entre 1 et 12 tranches horaires.");
  const bands = g.bands.map((b, i) => {
    if (!isObj(b)) invalid(`Tranche ${i + 1} invalide.`);
    const from = assertHm(b.from);
    const to = assertHm(b.to);
    if (minutesOf(to) <= minutesOf(from)) invalid(`Tranche ${i + 1} : l'heure de fin doit être après l'heure de début.`);
    return { from, to };
  });
  for (let i = 1; i < bands.length; i++) {
    if (minutesOf(bands[i].from) < minutesOf(bands[i - 1].to)) invalid(`Les tranches ${i} et ${i + 1} se chevauchent ou ne sont pas dans l'ordre.`);
  }

  if (!Array.isArray(g.rates) || g.rates.length !== 7) invalid("La grille doit avoir 7 jours.");
  const rates: (number | null)[][] = g.rates.map((row, d) => {
    if (!Array.isArray(row) || row.length !== bands.length) invalid(`${DAY_NAMES[d]} : une case par tranche.`);
    return row.map((v, b) => (v === null || v === "" ? null : assertDzd(v, `${DAY_NAMES[d]} ${bands[b].from}–${bands[b].to}`)));
  });

  const openingHours: StudioConfig["openingHours"] = {};
  for (let d = 0; d < 7; d++) {
    const open = rates[d].map((v, b) => (v === null ? -1 : b)).filter((b) => b >= 0);
    if (!open.length) {
      openingHours[String(d)] = null;
      continue;
    }
    const first = open[0];
    const last = open[open.length - 1];
    // Ouvert sans interruption : pas de case vide ni de trou horaire entre deux tranches ouvertes.
    for (let b = first; b <= last; b++) {
      if (rates[d][b] === null) invalid(`${DAY_NAMES[d]} : case vide entre deux tranches ouvertes. Laissez vide seulement en début ou en fin de journée.`);
      if (b > first && bands[b].from !== bands[b - 1].to) invalid(`${DAY_NAMES[d]} : trou entre ${bands[b - 1].to} et ${bands[b].from}. Les tranches ouvertes doivent se suivre.`);
    }
    openingHours[String(d)] = { open: bands[first].from, close: bands[last].to };
  }

  // Une période par tranche et par prix (les jours au même prix sont regroupés).
  const periods: StudioPeriod[] = [];
  bands.forEach((band, b) => {
    const byRate = new Map<number, number[]>();
    for (let d = 0; d < 7; d++) {
      const r = rates[d][b];
      if (r !== null) byRate.set(r, [...(byRate.get(r) ?? []), d]);
    }
    for (const [price, days] of byRate) periods.push({ days, from: band.from, to: band.to, price });
  });
  if (!periods.length) invalid("Au moins une case doit avoir un prix.");

  if (!Array.isArray(g.addons) || g.addons.length > 30) invalid("Options invalides.");
  const ids = new Set<string>();
  const addons: Addon[] = g.addons.map((a, i) => {
    if (!isObj(a)) invalid(`Option ${i + 1} invalide.`);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 80) invalid(`Option ${i + 1} : nom manquant.`);
    const name = a.name.trim();
    let id = typeof a.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : slug(name);
    for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`;
    ids.add(id);
    return { id, name, price: assertDzd(a.price, `Option « ${name} »`) };
  });

  const int = (v: unknown, field: string) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) invalid(`${field} invalide.`);
    return v;
  };
  return {
    enabled: base.enabled,
    openingHours,
    periods,
    minMinutes: int(g.minMinutes, "Durée minimale"),
    stepMinutes: int(g.stepMinutes, "Pas de réservation"),
    bufferMinutes: int(g.bufferMinutes, "Temps entre deux réservations"),
    specialDates: base.specialDates,
    addons,
    minPrice: assertDzd(g.minPrice, "Prix minimum"),
  };
}

/** Configuration studio → grille, pour afficher le tableau dans la page d'administration. */
export function gridFromStudio(s: StudioConfig): StudioGrid {
  const keys = [...new Set(s.periods.map((p) => `${p.from}-${p.to}`))].sort((a, b) => minutesOf(a.slice(0, 5)) - minutesOf(b.slice(0, 5)));
  const bands = keys.map((k) => ({ from: k.slice(0, 5), to: k.slice(6, 11) }));
  const rates = Array.from({ length: 7 }, (_, d) =>
    bands.map((b) => s.periods.find((p) => p.from === b.from && p.to === b.to && p.days.includes(d))?.price ?? null),
  );
  return {
    bands,
    rates,
    addons: (s.addons ?? []).map((a) => ({ id: a.id, name: a.name, price: a.price })),
    minMinutes: s.minMinutes,
    stepMinutes: s.stepMinutes,
    bufferMinutes: s.bufferMinutes,
    minPrice: s.minPrice,
  };
}
