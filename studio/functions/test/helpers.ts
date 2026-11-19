import { FirestoreMock } from "@firebase-bridge/firestore-admin";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import type { AuthPort } from "../src/staff";

const env = new FirestoreMock();

/** Une base Firestore en mémoire, neuve, avec la vraie bibliothèque firebase-admin. */
let n = 0;
export function newDb(): Firestore {
  return env.createDatabase(`studio-test-${++n}`).firestore();
}

export const T0 = Timestamp.fromMillis(Date.UTC(2026, 11, 5, 9, 0)); // 05/12/2026 10:00 à Alger
export const at = (minutesAfterT0: number) => Timestamp.fromMillis(T0.toMillis() + minutesAfterT0 * 60_000);

/** Faux service Firebase Auth qui garde tout en mémoire. */
export class FakeAuth implements AuthPort {
  users = new Map<string, { email: string; displayName: string; disabled: boolean; claims: Record<string, unknown> | null; revoked: number }>();
  failClaimsFor = new Set<string>();
  private n = 0;
  async createUser(p: { email: string; displayName: string; emailVerified: boolean; disabled: boolean }) {
    for (const u of this.users.values()) if (u.email === p.email) throw Object.assign(new Error("exists"), { code: "auth/email-already-exists" });
    const uid = `uid${++this.n}`;
    this.users.set(uid, { email: p.email, displayName: p.displayName, disabled: p.disabled, claims: null, revoked: 0 });
    return { uid };
  }
  async setCustomUserClaims(uid: string, claims: Record<string, unknown> | null) {
    if (this.failClaimsFor.has(String(claims?.role))) throw new Error("claims down");
    const u = this.users.get(uid) ?? { email: "", displayName: "", disabled: false, claims: null, revoked: 0 };
    u.claims = claims;
    this.users.set(uid, u);
  }
  async updateUser(uid: string, p: { disabled?: boolean }) {
    const u = this.users.get(uid);
    if (u && p.disabled !== undefined) u.disabled = p.disabled;
    return u;
  }
  async revokeRefreshTokens(uid: string) {
    const u = this.users.get(uid);
    if (u) u.revoked++;
  }
  async generatePasswordResetLink(email: string) {
    return `https://example.test/reset?email=${encodeURIComponent(email)}`;
  }
  async deleteUser(uid: string) {
    this.users.delete(uid);
  }
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<Error> {
  try {
    await p;
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c !== code) throw new Error(`code attendu ${code}, reçu ${c} (${(e as Error).message})`);
    return e as Error;
  }
  throw new Error(`erreur ${code} attendue, aucune erreur`);
}
