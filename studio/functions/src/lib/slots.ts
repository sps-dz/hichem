/**
 * Anti-chevauchement du studio.
 *
 * Chaque tranche du calendrier (30 min) est un document `slots/{AAAA-MM-JJ_HHMM}`.
 * Réserver = lire toutes les tranches demandées puis les écrire, dans UNE
 * transaction Firestore. Si deux clients visent la même tranche au même moment,
 * Firestore rejoue la seconde transaction, qui voit alors la tranche prise et
 * échoue : il est impossible que deux commandes obtiennent la même tranche.
 *
 * Un blocage (« hold ») porte une heure d'expiration. Une fois passée, la tranche
 * est considérée libre partout, même avant que la tâche de nettoyage ne la supprime.
 *
 * `availability/{AAAA-MM-JJ}` est la copie publique du jour, sans donnée client,
 * tenue à jour dans les mêmes transactions.
 */
import { FieldValue, Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { AppError, SlotConflictError, invalid } from "./errors";
import { parseSlotKey } from "./time";
import { runTx } from "./tx";

export type SlotState = "hold" | "booked";

export interface SlotDoc {
  key: string;
  date: string;
  hm: string;
  state: SlotState;
  orderId: string;
  holdExpiresAt: Timestamp | null;
  updatedAt: Timestamp;
}

export const SLOTS = "slots";
export const AVAILABILITY = "availability";
/** Durée du blocage pendant que le client remplit sa demande (cahier des charges). */
export const HOLD_MINUTES = 60;

/** Une tranche est libre pour `orderId` si elle n'existe pas, lui appartient, ou est un blocage expiré. */
export function isFreeFor(doc: SlotDoc | undefined, orderId: string, now: Timestamp): boolean {
  if (!doc) return true;
  if (doc.orderId === orderId) return true;
  if (doc.state === "hold" && doc.holdExpiresAt && doc.holdExpiresAt.toMillis() <= now.toMillis()) return true;
  return false;
}

function assertKeys(keys: readonly string[]): string[] {
  if (!Array.isArray(keys) || keys.length === 0) invalid("Aucune tranche demandée.");
  const unique = [...new Set(keys)];
  if (unique.length !== keys.length) invalid("Tranche demandée deux fois.");
  if (unique.length > 96) invalid("Trop de tranches.");
  unique.forEach(parseSlotKey);
  return unique.sort();
}

function assertOrderId(orderId: unknown): string {
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(orderId)) invalid("Identifiant de commande invalide.");
  return orderId;
}

function byDate(keys: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const k of keys) {
    const { date, hm } = parseSlotKey(k);
    m.set(date, [...(m.get(date) ?? []), hm]);
  }
  return m;
}

export interface ClaimInput {
  orderId: string;
  keys: readonly string[];
  state: SlotState;
  now: Timestamp;
  /** Obligatoire pour un blocage ; ignoré pour une réservation confirmée. */
  holdMinutes?: number;
}

export interface ClaimResult {
  keys: string[];
  holdExpiresAt: Timestamp | null;
  /** État des tranches avant l'opération (pour le journal d'audit). */
  before: Record<string, Pick<SlotDoc, "state" | "orderId"> | null>;
}

/**
 * Bloque ou réserve des tranches pour une commande, dans la transaction `tx`.
 * Ne fait que des lectures avant ses écritures : à appeler AVANT toute autre
 * écriture de la même transaction (règle Firestore : lectures d'abord).
 */
export async function claimSlots(db: Firestore, tx: Transaction, input: ClaimInput): Promise<ClaimResult> {
  const orderId = assertOrderId(input.orderId);
  const keys = assertKeys(input.keys);
  if (input.state !== "hold" && input.state !== "booked") invalid("État de tranche invalide.");

  let holdExpiresAt: Timestamp | null = null;
  if (input.state === "hold") {
    const minutes = input.holdMinutes ?? HOLD_MINUTES;
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) invalid("Durée de blocage invalide.");
    holdExpiresAt = Timestamp.fromMillis(input.now.toMillis() + minutes * 60_000);
  }

  const refs = keys.map((k) => db.collection(SLOTS).doc(k));
  const snaps = await tx.getAll(...refs);
  const before: ClaimResult["before"] = {};
  const conflicts: string[] = [];
  snaps.forEach((s, i) => {
    const d = s.exists ? (s.data() as SlotDoc) : undefined;
    before[keys[i]] = d ? { state: d.state, orderId: d.orderId } : null;
    if (!isFreeFor(d, orderId, input.now)) conflicts.push(keys[i]);
    // Une réservation confirmée ne redevient jamais un simple blocage.
    if (d && d.orderId === orderId && d.state === "booked" && input.state === "hold") {
      throw new AppError("failed-precondition", "Cette réservation est déjà confirmée.", { key: keys[i] });
    }
  });
  if (conflicts.length) throw new SlotConflictError(conflicts);

  for (let i = 0; i < keys.length; i++) {
    const { date, hm } = parseSlotKey(keys[i]);
    const doc: SlotDoc = { key: keys[i], date, hm, state: input.state, orderId, holdExpiresAt, updatedAt: input.now };
    // Double sécurité à l'écriture, en plus de la transaction : une tranche absente
    // est créée avec « ne doit pas exister », une tranche lue est modifiée avec
    // « ne doit pas avoir changé depuis la lecture ». Sinon Firestore refuse tout.
    if (!snaps[i].exists) tx.create(refs[i], doc);
    else tx.update(refs[i], { ...doc }, { lastUpdateTime: snaps[i].updateTime! });
  }
  for (const [date, hms] of byDate(keys)) {
    const entries: Record<string, { state: SlotState; until: Timestamp | null }> = {};
    for (const hm of hms) entries[hm] = { state: input.state, until: holdExpiresAt };
    tx.set(db.collection(AVAILABILITY).doc(date), { date, slots: entries, updatedAt: input.now }, { merge: true });
  }
  return { keys, holdExpiresAt, before };
}

export interface ReleaseInput {
  orderId: string;
  keys: readonly string[];
  now: Timestamp;
  /** Si vrai, ne libère que les blocages expirés (tâche de nettoyage). */
  onlyExpiredHolds?: boolean;
}

/**
 * Libère les tranches de `orderId` (annulation, refus, blocage expiré).
 * Une tranche qui appartient à une autre commande n'est jamais touchée.
 * Renvoie les tranches réellement libérées.
 */
export async function releaseSlots(db: Firestore, tx: Transaction, input: ReleaseInput): Promise<string[]> {
  const orderId = assertOrderId(input.orderId);
  const keys = assertKeys(input.keys);
  const refs = keys.map((k) => db.collection(SLOTS).doc(k));
  const snaps = await tx.getAll(...refs);
  const released: string[] = [];
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const d = s.data() as SlotDoc;
    if (d.orderId !== orderId) return;
    if (input.onlyExpiredHolds) {
      const expired = d.state === "hold" && d.holdExpiresAt !== null && d.holdExpiresAt.toMillis() <= input.now.toMillis();
      if (!expired) return;
    }
    tx.delete(refs[i], { lastUpdateTime: s.updateTime! });
    released.push(keys[i]);
  });
  for (const [date, hms] of byDate(released)) {
    const entries: Record<string, FieldValue> = {};
    for (const hm of hms) entries[hm] = FieldValue.delete();
    tx.set(db.collection(AVAILABILITY).doc(date), { slots: entries, updatedAt: input.now }, { merge: true });
  }
  return released;
}

/**
 * Tâche planifiée : supprime les blocages expirés, commande par commande,
 * chacune dans sa propre transaction (qui revérifie l'expiration).
 */
export async function releaseExpiredHolds(db: Firestore, now: Timestamp, limit = 300): Promise<number> {
  const q = await db
    .collection(SLOTS)
    .where("state", "==", "hold")
    .where("holdExpiresAt", "<=", now)
    .limit(limit)
    .get();
  const perOrder = new Map<string, string[]>();
  q.docs.forEach((d) => {
    const s = d.data() as SlotDoc;
    perOrder.set(s.orderId, [...(perOrder.get(s.orderId) ?? []), s.key]);
  });
  let total = 0;
  for (const [orderId, keys] of perOrder) {
    total += (await runTx(db, (tx) => releaseSlots(db, tx, { orderId, keys, now, onlyExpiredHolds: true }))).length;
  }
  return total;
}
