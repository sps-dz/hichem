/**
 * Transaction Firestore avec nouvelle tentative si une précondition d'écriture
 * échoue (un document a changé entre la lecture et l'écriture). Firestore rejoue
 * déjà lui-même les transactions en conflit ; ceci couvre le cas restant, pour
 * qu'une collision se termine par un vrai résultat (accepté ou « créneau pris »)
 * plutôt que par une erreur technique.
 *
 * Seules les erreurs techniques Firestore (codes numériques gRPC 6, 9 et 10) sont
 * rejouées ; une AppError métier (« failed-precondition » en texte) ne l'est jamais.
 */
import { Firestore, Transaction } from "firebase-admin/firestore";

const RETRYABLE = new Set([6, 9, 10]); // ALREADY_EXISTS (création concurrente), FAILED_PRECONDITION, ABORTED

export async function runTx<T>(db: Firestore, fn: (tx: Transaction) => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await db.runTransaction(fn);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (i >= attempts || typeof code !== "number" || !RETRYABLE.has(code)) throw e;
      await new Promise((r) => setTimeout(r, 20 * i + Math.floor(Math.random() * 30)));
    }
  }
}
