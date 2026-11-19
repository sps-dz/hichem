/**
 * Comptes de l'équipe : premier admin, création d'un membre, changement de rôle,
 * désactivation. Toujours vérifié côté serveur et journalisé.
 *
 * Les gestionnaires prennent leurs dépendances en paramètre (base, service Auth,
 * horloge) pour être testés sans Firebase ; src/index.ts les branche.
 */
import { Firestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { writeAudit } from "./lib/audit";
import { AppError, invalid } from "./lib/errors";
import { Caller, Role, isRole, requireRole, requireSignedIn, staffActor } from "./lib/roles";
import { runTx } from "./lib/tx";

export const STAFF = "staff";

export interface StaffDoc {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

/** Sous-ensemble du service Firebase Auth utilisé ici (remplaçable en test). */
export interface AuthPort {
  createUser(p: { email: string; displayName: string; emailVerified: boolean; disabled: boolean }): Promise<{ uid: string }>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void>;
  updateUser(uid: string, p: { disabled?: boolean }): Promise<unknown>;
  revokeRefreshTokens(uid: string): Promise<void>;
  generatePasswordResetLink(email: string): Promise<string>;
  deleteUser(uid: string): Promise<void>;
}

export interface Deps {
  db: Firestore;
  auth: AuthPort;
  now: () => Timestamp;
  /** E-mails autorisés à devenir le premier admin (paramètre ADMIN_EMAILS). */
  adminEmails: () => string[];
}

/** « a@x.dz, b@y.dz » ou ["a@x.dz","b@y.dz"] → liste en minuscules. */
export function parseEmailList(raw: string): string[] {
  const t = (raw ?? "").trim();
  let items: unknown[] = [];
  if (t.startsWith("[")) {
    try {
      items = JSON.parse(t);
    } catch {
      items = [];
    }
  } else {
    items = t.split(/[,;\s]+/);
  }
  return items.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

function cleanEmail(v: unknown): string {
  if (typeof v !== "string") invalid("E-mail manquant.");
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) invalid("E-mail invalide.");
  return e;
}

function cleanDisplayName(v: unknown): string {
  if (typeof v !== "string") invalid("Nom manquant.");
  const n = v.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 80) invalid("Le nom doit faire entre 2 et 80 caractères.");
  return n;
}

function cleanUid(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) invalid("Identifiant de compte invalide.");
  return v;
}

/**
 * Rôle vérifié dans le jeton ET dans la fiche staff : un compte désactivé, ou dont
 * le rôle vient de changer, est refusé tout de suite, même si son jeton (valable
 * 1 h) dit encore « admin ».
 */
async function requireActiveRole(deps: Deps, callerIn: Caller | null, roles: readonly Role[]): Promise<Caller & { role: Role }> {
  const caller = requireRole(callerIn, roles);
  const snap = await deps.db.collection(STAFF).doc(caller.uid).get();
  const s = snap.exists ? (snap.data() as StaffDoc) : null;
  if (!s || s.disabled || s.role !== caller.role) throw new AppError("permission-denied", "Accès refusé pour ce rôle.");
  return caller;
}

/**
 * Premier admin : le compte connecté devient admin si son e-mail est VÉRIFIÉ et
 * figure dans ADMIN_EMAILS. Corrige la faille du CRM (admin accordé sur un
 * e-mail non vérifié) : sans vérification, refus.
 */
export async function bootstrapAdmin(deps: Deps, callerIn: Caller | null): Promise<{ role: Role }> {
  const caller = requireSignedIn(callerIn);
  const allowed = deps.adminEmails().map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!caller.email || !caller.emailVerified || !allowed.includes(caller.email)) {
    throw new AppError("permission-denied", "Ce compte ne peut pas devenir administrateur.");
  }
  const now = deps.now();
  const ref = deps.db.collection(STAFF).doc(caller.uid);
  await runTx(deps.db, async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? (snap.data() as StaffDoc) : null;
    if (before && before.disabled) throw new AppError("permission-denied", "Ce compte est désactivé.");
    const doc: StaffDoc = {
      uid: caller.uid,
      email: caller.email!,
      displayName: before?.displayName ?? caller.email!,
      role: "admin",
      disabled: false,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
      createdBy: before?.createdBy ?? "bootstrap",
    };
    tx.set(ref, doc);
    writeAudit(deps.db, tx, {
      actor: staffActor(caller),
      action: "staff.bootstrapAdmin",
      entity: STAFF,
      entityId: caller.uid,
      before: before && { role: before.role, disabled: before.disabled },
      after: { role: "admin", disabled: false },
    });
  });
  await deps.auth.setCustomUserClaims(caller.uid, { role: "admin" });
  return { role: "admin" };
}

/**
 * L'admin crée un compte pour un membre de l'équipe. Renvoie un lien pour que
 * la personne choisisse son mot de passe (à lui transmettre, ex. par WhatsApp).
 */
export async function createStaff(
  deps: Deps,
  callerIn: Caller | null,
  data: { email?: unknown; displayName?: unknown; role?: unknown },
): Promise<{ uid: string; passwordLink: string }> {
  const caller = await requireActiveRole(deps, callerIn, ["admin"]);
  const email = cleanEmail(data.email);
  const displayName = cleanDisplayName(data.displayName);
  if (!isRole(data.role)) invalid("Rôle invalide.", { role: data.role });
  const role = data.role;

  let uid: string;
  try {
    // E-mail marqué vérifié : c'est l'admin qui crée le compte et en transmet le lien.
    uid = (await deps.auth.createUser({ email, displayName, emailVerified: true, disabled: false })).uid;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "auth/email-already-exists") throw new AppError("already-exists", "Un compte existe déjà avec cet e-mail.");
    throw e;
  }
  const now = deps.now();
  const doc: StaffDoc = { uid, email, displayName, role, disabled: false, createdAt: now, updatedAt: now, createdBy: caller.uid };
  try {
    await deps.auth.setCustomUserClaims(uid, { role });
    await runTx(deps.db, async (tx) => {
      tx.create(deps.db.collection(STAFF).doc(uid), doc);
      writeAudit(deps.db, tx, { actor: staffActor(caller), action: "staff.create", entity: STAFF, entityId: uid, after: { email, displayName, role } });
    });
  } catch (e) {
    // Pas de compte à moitié créé : on supprime le compte Auth si la suite échoue.
    await deps.auth.deleteUser(uid).catch(() => undefined);
    throw e;
  }
  const passwordLink = await deps.auth.generatePasswordResetLink(email);
  return { uid, passwordLink };
}

/**
 * Garde-fous communs, vérifiés DANS la transaction : pas sur soi-même, et jamais
 * zéro admin actif (deux admins qui se rétrogradent en même temps ne peuvent pas
 * laisser le studio sans administrateur : la seconde transaction est rejouée et
 * voit le premier changement).
 */
async function loadForChange(
  deps: Deps,
  tx: Transaction,
  caller: Caller,
  uid: string,
  losesAdmin: (t: StaffDoc) => boolean,
): Promise<StaffDoc> {
  if (uid === caller.uid) throw new AppError("failed-precondition", "Impossible de modifier son propre compte.");
  const snap = await tx.get(deps.db.collection(STAFF).doc(uid));
  if (!snap.exists) throw new AppError("not-found", "Membre introuvable.");
  const target = snap.data() as StaffDoc;
  if (losesAdmin(target) && target.role === "admin" && !target.disabled) {
    const admins = await tx.get(deps.db.collection(STAFF).where("role", "==", "admin").where("disabled", "==", false));
    if (admins.size <= 1) throw new AppError("failed-precondition", "Il doit rester au moins un administrateur actif.");
  }
  return target;
}

export async function setStaffRole(
  deps: Deps,
  callerIn: Caller | null,
  data: { uid?: unknown; role?: unknown },
): Promise<{ uid: string; role: Role }> {
  const caller = await requireActiveRole(deps, callerIn, ["admin"]);
  const uid = cleanUid(data.uid);
  if (!isRole(data.role)) invalid("Rôle invalide.", { role: data.role });
  const role = data.role;
  const now = deps.now();
  const changed = await runTx(deps.db, async (tx) => {
    const target = await loadForChange(deps, tx, caller, uid, () => role !== "admin");
    if (target.role === role) return false;
    tx.update(deps.db.collection(STAFF).doc(uid), { role, updatedAt: now });
    writeAudit(deps.db, tx, { actor: staffActor(caller), action: "staff.setRole", entity: STAFF, entityId: uid, before: { role: target.role }, after: { role } });
    return true;
  });
  if (!changed) return { uid, role };
  await deps.auth.setCustomUserClaims(uid, { role });
  // Coupe les sessions ouvertes : le nouveau rôle s'applique à la prochaine connexion.
  await deps.auth.revokeRefreshTokens(uid);
  return { uid, role };
}

export async function setStaffDisabled(
  deps: Deps,
  callerIn: Caller | null,
  data: { uid?: unknown; disabled?: unknown },
): Promise<{ uid: string; disabled: boolean }> {
  const caller = await requireActiveRole(deps, callerIn, ["admin"]);
  const uid = cleanUid(data.uid);
  if (typeof data.disabled !== "boolean") invalid("Valeur « désactivé » invalide.");
  const disabled = data.disabled;
  const now = deps.now();
  // La fiche staff d'abord : les règles Firestore coupent l'accès dès cette écriture.
  const changed = await runTx(deps.db, async (tx) => {
    const target = await loadForChange(deps, tx, caller, uid, () => disabled);
    if (target.disabled === disabled) return false;
    tx.update(deps.db.collection(STAFF).doc(uid), { disabled, updatedAt: now });
    writeAudit(deps.db, tx, {
      actor: staffActor(caller),
      action: disabled ? "staff.disable" : "staff.enable",
      entity: STAFF,
      entityId: uid,
      before: { disabled: target.disabled },
      after: { disabled },
    });
    return true;
  });
  if (!changed) return { uid, disabled };
  await deps.auth.updateUser(uid, { disabled });
  if (disabled) await deps.auth.revokeRefreshTokens(uid);
  return { uid, disabled };
}
