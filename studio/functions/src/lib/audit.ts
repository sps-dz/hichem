/**
 * Journal d'audit : une ligne par modification importante (argent, rôles,
 * réservations). Écrit uniquement par les fonctions, dans la même transaction
 * que la modification : si l'une échoue, l'autre n'est pas enregistrée.
 * Les règles Firestore interdisent toute écriture depuis un navigateur,
 * donc personne ne peut effacer ou retoucher une ligne.
 */
import { FieldValue, Firestore, Transaction, WriteBatch } from "firebase-admin/firestore";

export type Actor =
  | { kind: "staff"; uid: string; email: string | null; role: string | null }
  | { kind: "customer"; phone: string }
  | { kind: "system"; job: string };

export interface AuditEntry {
  actor: Actor;
  /** Ex. « staff.create », « slots.hold », « payment.verify ». */
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}

/** Retire les `undefined` (refusés par Firestore) en gardant la structure. */
function clean(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function writeAudit(db: Firestore, writer: Transaction | WriteBatch, entry: AuditEntry): void {
  const ref = db.collection("auditLogs").doc();
  const doc = {
    at: FieldValue.serverTimestamp(),
    actor: clean(entry.actor),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: clean(entry.before ?? null),
    after: clean(entry.after ?? null),
    note: entry.note ?? null,
  };
  // create() échoue si l'identifiant existe déjà : une ligne n'est jamais écrasée.
  (writer as Transaction).create(ref, doc);
}
