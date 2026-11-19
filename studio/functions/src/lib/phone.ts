/**
 * Numéros de téléphone algériens. Le numéro normalisé (+213…) sert
 * d'identifiant du client : la même personne ne doit jamais avoir deux fiches
 * parce qu'elle a tapé « 0555 12 34 56 » une fois et « +213555123456 » une autre.
 */
import { invalid } from "./errors";

export type PhoneKind = "mobile" | "fixed";

export interface NormalizedPhone {
  /** Format international, ex. +213555123456 */
  e164: string;
  kind: PhoneKind;
}

/**
 * Accepte : 0555123456, 05 55 12 34 56, +213555123456, 00213555123456,
 * 213555123456, +213 (0)555 12 34 56, et les fixes 021xxxxxx.
 * Mobiles : 9 chiffres après l'indicatif, commençant par 5, 6 ou 7.
 * Fixes   : 8 chiffres après l'indicatif, commençant par 2, 3 ou 4.
 */
export function normalizeDzPhone(input: unknown): NormalizedPhone {
  if (typeof input !== "string") invalid("Numéro de téléphone manquant.");
  const raw = input.trim();
  if (!/^[+\d\s().\-]{8,25}$/.test(raw)) invalid("Numéro de téléphone invalide.", { phone: raw });

  let digits = raw.replace(/[^\d+]/g, "");
  // « +213 (0)5… » : retirer le 0 national écrit entre parenthèses.
  digits = digits.replace(/^\+?(00)?213\(?0\)?/, "+213");
  if (digits.startsWith("+213")) digits = digits.slice(4);
  else if (digits.startsWith("00213")) digits = digits.slice(5);
  else if (digits.startsWith("213") && digits.length >= 11) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  else invalid("Numéro de téléphone invalide.", { phone: raw });

  if (digits.includes("+")) invalid("Numéro de téléphone invalide.", { phone: raw });
  if (/^[567]\d{8}$/.test(digits)) return { e164: `+213${digits}`, kind: "mobile" };
  if (/^[234]\d{7}$/.test(digits)) return { e164: `+213${digits}`, kind: "fixed" };
  return invalid("Numéro de téléphone invalide.", { phone: raw });
}
