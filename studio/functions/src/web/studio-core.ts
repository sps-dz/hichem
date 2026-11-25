/**
 * Cœur partagé par les pages du studio (site client et page Équipe), compilé
 * pour le navigateur dans web/lib/studio-core.js (npm run build:web).
 *
 * Forfait Spark : pas de serveur. Le même moteur de prix tourne chez le client
 * (estimation affichée et envoyée) et chez l'équipe (recalcul de contrôle avant
 * de valider l'acompte). Les règles Firestore protègent les écritures.
 */
import { AppError } from "../lib/errors";
import { normalizeDzPhone } from "../lib/phone";
import { percentOfDzd } from "../lib/money";
import { utcMsToAlgiers } from "../lib/time";
import { Catalog, DEFAULT_CATALOG, assertCatalog } from "../pricing/catalog";
import { Pricing, priceCart } from "../pricing/engine";
import { gridFromStudio, studioFromGrid } from "../pricing/studioGrid";

export { AppError, DEFAULT_CATALOG, assertCatalog, priceCart, gridFromStudio, studioFromGrid, normalizeDzPhone, percentOfDzd, utcMsToAlgiers };
export type { Catalog, Pricing };

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Identifiant aléatoire (lettres et chiffres), tiré au sort par le navigateur. */
export function randomId(length: number, rand: (n: number) => Uint8Array = defaultRandom): string {
  let out = "";
  while (out.length < length) {
    for (const b of rand(length * 2)) {
      if (b < 248) out += ALNUM[b % 62]; // 248 = 4 × 62 : pas de biais
      if (out.length === length) break;
    }
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

/** Code court affiché au client et dans WhatsApp (6 premiers caractères de la demande). */
export const shortCode = (orderId: string) => orderId.slice(0, 6).toUpperCase();

/** Référence définitive, donnée quand l'acompte est validé : STU-2026-000123. */
export const formatRef = (year: number, n: number) => `STU-${year}-${String(n).padStart(6, "0")}`;

export const fmtDA = (n: number) => `${n.toLocaleString("fr-FR").replace(/[  ]/g, " ")} DA`;

/**
 * Lien WhatsApp « clic pour discuter » : ouvre WhatsApp avec le message déjà
 * écrit ; c'est la personne qui appuie sur Envoyer. `phone` en chiffres
 * internationaux, sans « + » (213…), ou au format algérien (05…).
 */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.startsWith("213") && /^\d+$/.test(phone) ? phone : normalizeDzPhone(phone).e164.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export interface OrderDraft {
  orderId: string;
  trackingToken: string;
  name: string;
  phone: string;
  note: string;
  pricing: Pricing;
  holdExpiresAtMs: number | null;
}

/** Message que le client envoie au studio sur WhatsApp, après sa demande. */
export function clientWhatsappText(d: { code: string; name: string; pricing: Pricing; trackingUrl: string }): string {
  const lines = d.pricing.lines.map((l) => `• ${l.label}${l.price === null ? " (sur devis)" : ` : ${fmtDA(l.price)}`}`);
  const money =
    d.pricing.total === null
      ? "Total : sur devis"
      : `Total : ${fmtDA(d.pricing.total)} — acompte ${d.pricing.depositPercent} % : ${fmtDA(d.pricing.deposit!)}`;
  return [
    "Bonjour, je viens d'envoyer une demande sur le site du studio.",
    `Demande n° ${d.code} — ${d.name}`,
    ...lines,
    money,
    `Suivi : ${d.trackingUrl}`,
  ].join("\n");
}

/** Message de l'équipe au client (confirmation de l'acompte, annulation…). */
export function staffWhatsappText(d: { name: string; code: string; ref?: string | null; status: string; total: number | null; deposit?: number | null; trackingUrl: string }): string {
  const who = d.ref ? `${d.ref} (demande ${d.code})` : `demande n° ${d.code}`;
  const body: Record<string, string> = {
    pending: `nous avons bien reçu votre ${who}.${d.deposit ? ` Pour la confirmer, merci de verser l'acompte de ${fmtDA(d.deposit)}.` : ""}`,
    confirmed: `votre acompte est bien reçu : votre ${who} est confirmée.${d.total !== null && d.deposit ? ` Reste à payer : ${fmtDA(d.total - d.deposit)}.` : ""}`,
    cancelled: `votre ${who} est annulée.`,
    done: `merci ! Votre ${who} est terminée.`,
  };
  return `Bonjour ${d.name}, ${body[d.status] ?? `votre ${who} : ${d.status}.`}\nSuivi : ${d.trackingUrl}`;
}

/** Tranches « AAAA-MM-JJ_HHMM » → { 'AAAA-MM-JJ': ['HHMM', …] } (un document days/ par date). */
export function slotsByDay(keys: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of [...new Set(keys)].sort()) (out[k.slice(0, 10)] ??= []).push(k.slice(11));
  return out;
}

/**
 * Prépare les documents d'une demande client. Le navigateur les écrit ensuite en
 * UNE écriture groupée : la demande, sa fiche de suivi, et pour chaque jour de
 * studio l'ajout de ses tranches dans days/{date}. Si une tranche est déjà
 * prise, tout est refusé.
 */
export function buildClientOrder(d: OrderDraft) {
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
      pricing: JSON.parse(JSON.stringify(d.pricing)) as Pricing,
      slots,
      trackingToken: d.trackingToken,
      note: d.note,
      catalogVersion: d.pricing.catalogVersion,
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
      quotePending,
    },
  };
}

/**
 * Contrôle de l'équipe : recalcule le prix d'une demande avec la version du
 * tarif qu'elle cite, à la date où elle a été envoyée, et compare au prix reçu.
 */
export function verifyOrderPricing(catalog: Catalog, lines: unknown[], createdAtMs: number, claimed: Pricing, blocked: Record<string, string[]>): { ok: boolean; pricing: Pricing | null; problems: string[] } {
  try {
    const p = priceCart(catalog, lines, createdAtMs);
    const problems: string[] = [];
    if (p.subtotal !== claimed.subtotal) problems.push(`Sous-total reçu ${fmtDA(claimed.subtotal)}, recalculé ${fmtDA(p.subtotal)}.`);
    if (p.total !== claimed.total) problems.push(`Total reçu ${claimed.total === null ? "sur devis" : fmtDA(claimed.total)}, recalculé ${p.total === null ? "sur devis" : fmtDA(p.total)}.`);
    if (p.deposit !== claimed.deposit) problems.push("Acompte différent du tarif.");
    const keysA = JSON.stringify(slotsByDay(p.lines.flatMap((l) => l.slotKeys ?? [])));
    const keysB = JSON.stringify(slotsByDay(claimed.lines.flatMap((l) => l.slotKeys ?? [])));
    const keysC = JSON.stringify(Object.fromEntries(Object.entries(blocked).sort()));
    if (keysA !== keysB || keysA !== keysC) problems.push("Les tranches bloquées ne correspondent pas au créneau.");
    return { ok: problems.length === 0, pricing: p, problems };
  } catch (e) {
    return { ok: false, pricing: null, problems: [(e as Error).message] };
  }
}

/** Date et heure d'Alger lisibles : « sam. 12/12 14:00 ». */
export function algiersLabel(ms: number): string {
  const t = utcMsToAlgiers(ms);
  return `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}/${t.date.slice(0, 4)} ${t.hm.slice(0, 2)}:${t.hm.slice(2)}`;
}
