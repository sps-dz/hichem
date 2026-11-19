/**
 * Conversion des erreurs métier en erreurs renvoyées au navigateur.
 * Une erreur inattendue ne divulgue jamais son détail technique au client.
 */
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { AppError } from "./errors";

export async function toHttps<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw new HttpsError(e.code, e.message, e.details);
    if (e instanceof HttpsError) throw e;
    logger.error(`${name} a échoué`, e);
    throw new HttpsError("internal", "Erreur interne. Réessaie dans un instant.");
  }
}
