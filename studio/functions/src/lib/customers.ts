/**
 * Fiches clients, identifiées par le téléphone normalisé : `customers/{+213…}`.
 * Le même numéro donne toujours la même fiche.
 */
import { Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { invalid } from "./errors";
import { normalizeDzPhone } from "./phone";

export const CUSTOMERS = "customers";

export interface CustomerDoc {
  phone: string;
  phoneKind: "mobile" | "fixed";
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export function cleanName(name: unknown): string {
  if (typeof name !== "string") invalid("Nom manquant.");
  const n = name.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 80) invalid("Le nom doit faire entre 2 et 80 caractères.");
  return n;
}

/**
 * Crée la fiche si elle n'existe pas, sinon met à jour le nom.
 * Lit avant d'écrire : à appeler avant les autres écritures de la transaction.
 */
export async function upsertCustomer(
  db: Firestore,
  tx: Transaction,
  input: { phone: unknown; name: unknown; now: Timestamp },
): Promise<{ id: string; created: boolean; doc: CustomerDoc; write: () => void }> {
  const phone = normalizeDzPhone(input.phone);
  const name = cleanName(input.name);
  const ref = db.collection(CUSTOMERS).doc(phone.e164);
  const snap = await tx.get(ref);
  const doc: CustomerDoc = snap.exists
    ? { ...(snap.data() as CustomerDoc), name, updatedAt: input.now }
    : { phone: phone.e164, phoneKind: phone.kind, name, createdAt: input.now, updatedAt: input.now };
  return { id: phone.e164, created: !snap.exists, doc, write: () => tx.set(ref, doc) };
}
