/**
 * Liens privés des clients (pas de compte client).
 *
 * Le client reçoit un lien contenant un jeton aléatoire de 256 bits. La base ne
 * garde que l'empreinte SHA-256 du jeton : même quelqu'un qui lirait la base ne
 * pourrait pas reconstituer un lien valable. Le lien donne accès à UNE commande,
 * expire, et peut être révoqué (lien perdu ou transféré → l'admin en renvoie un).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { AppError, invalid } from "./errors";

export const ACCESS = "customerAccess";
/** Validité par défaut d'un lien : à confirmer par l'admin (réglage). */
export const DEFAULT_ACCESS_DAYS = 90;

export interface AccessDoc {
  orderId: string;
  phone: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  revoked: boolean;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function assertTokenShape(token: unknown): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError("permission-denied", "Lien invalide ou expiré.");
  }
  return token;
}

/** Crée un lien pour une commande. Renvoie le jeton en clair, à mettre dans l'URL. */
export function createAccessToken(
  db: Firestore,
  tx: Transaction,
  input: { orderId: string; phone: string; now: Timestamp; days?: number },
): string {
  const days = input.days ?? DEFAULT_ACCESS_DAYS;
  if (!Number.isInteger(days) || days <= 0 || days > 3650) invalid("Durée de lien invalide.");
  const token = randomBytes(32).toString("base64url"); // 43 caractères
  const doc: AccessDoc = {
    orderId: input.orderId,
    phone: input.phone,
    createdAt: input.now,
    expiresAt: Timestamp.fromMillis(input.now.toMillis() + days * 86_400_000),
    revoked: false,
  };
  tx.create(db.collection(ACCESS).doc(hashToken(token)), doc);
  return token;
}

/** Vérifie un jeton ; renvoie la commande et le téléphone auxquels il donne accès. */
export async function verifyAccessToken(
  db: Firestore,
  token: unknown,
  now: Timestamp,
): Promise<{ orderId: string; phone: string }> {
  const t = assertTokenShape(token);
  const hash = hashToken(t);
  const snap = await db.collection(ACCESS).doc(hash).get();
  const denied = new AppError("permission-denied", "Lien invalide ou expiré.");
  if (!snap.exists) throw denied;
  // Défense en profondeur : comparaison à temps constant de l'empreinte.
  if (!timingSafeEqual(Buffer.from(snap.id, "hex"), Buffer.from(hash, "hex"))) throw denied;
  const d = snap.data() as AccessDoc;
  if (d.revoked || d.expiresAt.toMillis() <= now.toMillis()) throw denied;
  return { orderId: d.orderId, phone: d.phone };
}

/** Révoque tous les liens d'une commande (avant d'en envoyer un nouveau). */
export async function revokeOrderAccess(db: Firestore, orderId: string, now: Timestamp): Promise<number> {
  const q = await db.collection(ACCESS).where("orderId", "==", orderId).where("revoked", "==", false).get();
  if (q.empty) return 0;
  const batch = db.batch();
  q.docs.forEach((d) => batch.update(d.ref, { revoked: true, revokedAt: now }));
  await batch.commit();
  return q.size;
}
