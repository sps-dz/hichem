/**
 * Heure du studio : Algérie, UTC+1 toute l'année (pas d'heure d'été).
 * Le calendrier est découpé en tranches fixes (30 min par défaut) ; une
 * réservation occupe toutes les tranches qu'elle touche, tampon compris.
 */
import { invalid } from "./errors";

export const STUDIO_TZ = "Africa/Algiers";
const OFFSET_MS = 60 * 60 * 1000; // UTC+1
const MINUTE = 60 * 1000;

export const DEFAULT_SLOT_MINUTES = 30;
/** Une réservation ne peut pas couvrir plus de 2 jours de tranches. */
export const MAX_SLOTS_PER_BOOKING = 96;

export function assertYmd(date: unknown): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("Date invalide (AAAA-MM-JJ).", { date });
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) invalid("Date inexistante.", { date });
  return date;
}

export function assertHm(hm: unknown): string {
  if (typeof hm !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm)) invalid("Heure invalide (HH:MM).", { hm });
  return hm;
}

/** Date + heure locales d'Alger → instant UTC (ms). */
export function algiersToUtcMs(date: string, hm: string): number {
  assertYmd(date);
  assertHm(hm);
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - OFFSET_MS;
}

/** Instant UTC (ms) → { date: AAAA-MM-JJ, hm: HHMM } à l'heure d'Alger. */
export function utcMsToAlgiers(ms: number): { date: string; hm: string } {
  const t = new Date(ms + OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`,
    hm: `${p(t.getUTCHours())}${p(t.getUTCMinutes())}`,
  };
}

/** Identifiant d'une tranche : « 2026-12-05_1430 » (heure d'Alger). */
export function slotKey(ms: number): string {
  const { date, hm } = utcMsToAlgiers(ms);
  return `${date}_${hm}`;
}

export function parseSlotKey(key: string): { date: string; hm: string } {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4})$/.exec(key);
  if (!m) invalid("Tranche invalide.", { key });
  return { date: m[1], hm: m[2] };
}

export interface SlotRange {
  /** Date locale de début (AAAA-MM-JJ). */
  date: string;
  /** Heure locale de début (HH:MM). */
  start: string;
  /** Durée de la prestation, en minutes. */
  durationMinutes: number;
  /** Temps bloqué après la prestation (rangement, installation), en minutes. */
  bufferMinutes?: number;
  slotMinutes?: number;
}

/**
 * Toutes les tranches touchées par [début, fin + tampon[.
 * Une réservation de 10:15 à 11:00 occupe 10:00 et 10:30.
 */
export function slotKeysFor(range: SlotRange): string[] {
  const slot = range.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  if (!Number.isInteger(slot) || slot <= 0 || 1440 % slot !== 0) invalid("Taille de tranche invalide.", { slot });
  const duration = range.durationMinutes;
  const buffer = range.bufferMinutes ?? 0;
  if (!Number.isInteger(duration) || duration <= 0) invalid("Durée invalide.", { duration });
  if (!Number.isInteger(buffer) || buffer < 0) invalid("Tampon invalide.", { buffer });

  const startMs = algiersToUtcMs(range.date, range.start);
  const endMs = startMs + (duration + buffer) * MINUTE;
  const slotMs = slot * MINUTE;
  // Les tranches sont alignées sur l'heure locale ; l'offset d'Alger est un nombre entier d'heures.
  const first = Math.floor((startMs + OFFSET_MS) / slotMs) * slotMs - OFFSET_MS;
  const keys: string[] = [];
  for (let t = first; t < endMs; t += slotMs) keys.push(slotKey(t));
  if (keys.length > MAX_SLOTS_PER_BOOKING) invalid("Réservation trop longue.", { slots: keys.length });
  return keys;
}
