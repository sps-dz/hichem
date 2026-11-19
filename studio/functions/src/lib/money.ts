/**
 * Argent : toujours des dinars entiers (DZD), jamais de virgule flottante.
 * Tous les montants entrent et sortent par ces fonctions.
 */
import { invalid } from "./errors";

export const CURRENCY = "DZD" as const;

/** Plafond de sécurité pour un montant unique (1 milliard DA). */
export const MAX_DZD = 1_000_000_000;

/** Vérifie qu'une valeur est un montant valide en dinars entiers, ≥ 0. */
export function assertDzd(value: unknown, field = "montant"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${field} doit être un nombre entier de dinars.`, { field, value });
  }
  if (value < 0) invalid(`${field} ne peut pas être négatif.`, { field, value });
  if (value > MAX_DZD) invalid(`${field} dépasse le plafond autorisé.`, { field, value });
  return value;
}

/** Somme exacte de montants en dinars entiers. */
export function sumDzd(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += assertDzd(v);
  if (!Number.isSafeInteger(total)) invalid("Somme hors limites.");
  return total;
}

/**
 * Pourcentage d'un montant, arrondi au dinar le plus proche (0,5 → au-dessus).
 * Calcul en entiers : (montant × pourcentage + 50) / 100, division entière.
 * `percent` est un entier (20 pour 20 %).
 */
export function percentOfDzd(amount: number, percent: number): number {
  assertDzd(amount);
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) {
    invalid("Le pourcentage doit être un entier entre 0 et 100.", { percent });
  }
  return Math.floor((amount * percent + 50) / 100);
}
