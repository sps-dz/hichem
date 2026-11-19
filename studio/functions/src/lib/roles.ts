/**
 * Rôles de l'équipe, portés par le compte Firebase Auth (custom claim `role`)
 * et recopiés dans `staff/{uid}`. Les règles Firestore vérifient les deux.
 */
import { AppError } from "./errors";
import type { Actor } from "./audit";

export const ROLES = ["admin", "employee", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Ce que les fonctions savent de l'appelant (extrait du jeton vérifié par Firebase). */
export interface Caller {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  role: Role | null;
}

export function callerFromToken(auth: { uid: string; token: Record<string, unknown> } | undefined): Caller | null {
  if (!auth) return null;
  const t = auth.token;
  return {
    uid: auth.uid,
    email: typeof t.email === "string" ? t.email.toLowerCase() : null,
    emailVerified: t.email_verified === true,
    role: isRole(t.role) ? t.role : null,
  };
}

export function requireSignedIn(caller: Caller | null): Caller {
  if (!caller) throw new AppError("unauthenticated", "Connexion requise.");
  return caller;
}

export function requireRole(caller: Caller | null, roles: readonly Role[]): Caller & { role: Role } {
  const c = requireSignedIn(caller);
  if (!c.emailVerified || !c.role || !roles.includes(c.role)) {
    throw new AppError("permission-denied", "Accès refusé pour ce rôle.");
  }
  return c as Caller & { role: Role };
}

export function staffActor(c: Caller): Actor {
  return { kind: "staff", uid: c.uid, email: c.email, role: c.role };
}
