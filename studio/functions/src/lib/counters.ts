/**
 * Références de commande lisibles : STU-2026-000123.
 * Un compteur par année, incrémenté dans une transaction : deux commandes
 * créées au même instant ne reçoivent jamais le même numéro.
 */
import { Firestore, Transaction } from "firebase-admin/firestore";
import { invalid } from "./errors";

export interface CounterReservation {
  ref: string;
  /** Écrit le nouveau compteur ; à appeler après toutes les lectures de la transaction. */
  commit: () => void;
}

export async function reserveOrderRef(db: Firestore, tx: Transaction, year: number): Promise<CounterReservation> {
  if (!Number.isInteger(year) || year < 2024 || year > 2100) invalid("Année invalide.", { year });
  const counterRef = db.collection("counters").doc(`orders-${year}`);
  const snap = await tx.get(counterRef);
  const next = (snap.exists ? Number(snap.get("value")) : 0) + 1;
  if (!Number.isSafeInteger(next) || next > 999_999) invalid("Compteur de commandes saturé.", { year });
  return {
    ref: `STU-${year}-${String(next).padStart(6, "0")}`,
    commit: () =>
      snap.exists
        ? tx.update(counterRef, { value: next }, { lastUpdateTime: snap.updateTime! })
        : tx.create(counterRef, { value: next, year }),
  };
}
