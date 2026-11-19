import { test } from "node:test";
import assert from "node:assert/strict";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { Caller } from "../src/lib/roles";
import { Deps, parseEmailList, bootstrapAdmin, createStaff, setStaffDisabled, setStaffRole } from "../src/staff";
import { FakeAuth, T0, expectCode, newDb } from "./helpers";

function setup(adminEmails = ["hichem@example.com"]) {
  const db: Firestore = newDb();
  const auth = new FakeAuth();
  const deps: Deps = { db, auth, now: () => T0, adminEmails: () => adminEmails };
  return { db, auth, deps };
}

const boss: Caller = { uid: "boss", email: "hichem@example.com", emailVerified: true, role: null };
const asAdmin = (c: Caller): Caller => ({ ...c, role: "admin" });

async function auditActions(db: Firestore) {
  return (await db.collection("auditLogs").get()).docs.map((d) => d.get("action")).sort();
}

test("premier admin : refusé si e-mail non vérifié, absent de la liste, ou non connecté", async () => {
  const { deps, db, auth } = setup();
  await expectCode(bootstrapAdmin(deps, null), "unauthenticated");
  await expectCode(bootstrapAdmin(deps, { ...boss, emailVerified: false }), "permission-denied");
  await expectCode(bootstrapAdmin(deps, { ...boss, email: "intrus@example.com" }), "permission-denied");
  await expectCode(bootstrapAdmin(deps, { ...boss, email: null }), "permission-denied");
  assert.equal((await db.collection("staff").get()).size, 0);
  // Liste vide (paramètre non rempli) : personne ne devient admin.
  await expectCode(bootstrapAdmin({ ...deps, adminEmails: () => [] }, boss), "permission-denied");

  assert.deepEqual(await bootstrapAdmin(deps, { ...boss, email: "hichem@example.com" }), { role: "admin" });
  assert.equal((await db.doc("staff/boss").get()).get("role"), "admin");
  assert.deepEqual(auth.users.get("boss")!.claims, { role: "admin" });
  assert.deepEqual(await auditActions(db), ["staff.bootstrapAdmin"]);
});

test("création de compte : réservée à l'admin, données vérifiées, lien de mot de passe renvoyé", async () => {
  const { deps, db, auth } = setup();
  await bootstrapAdmin(deps, boss);
  const admin = asAdmin(boss);

  for (const c of [null, { ...admin, role: "employee" as const }, { ...admin, role: "accountant" as const }, { ...admin, emailVerified: false }]) {
    await expectCode(createStaff(deps, c, { email: "a@b.dz", displayName: "Amel", role: "employee" }), c ? "permission-denied" : "unauthenticated");
  }
  await expectCode(createStaff(deps, admin, { email: "pas-un-email", displayName: "Amel", role: "employee" }), "invalid-argument");
  await expectCode(createStaff(deps, admin, { email: "a@b.dz", displayName: "A", role: "employee" }), "invalid-argument");
  await expectCode(createStaff(deps, admin, { email: "a@b.dz", displayName: "Amel", role: "superadmin" }), "invalid-argument");

  const r = await createStaff(deps, admin, { email: " Amel@Studio.DZ ", displayName: "Amel", role: "employee" });
  assert.match(r.passwordLink, /reset/);
  const s = (await db.doc(`staff/${r.uid}`).get()).data()!;
  assert.equal(s.email, "amel@studio.dz");
  assert.equal(s.role, "employee");
  assert.equal(s.disabled, false);
  assert.equal(s.createdBy, "boss");
  assert.deepEqual(auth.users.get(r.uid)!.claims, { role: "employee" });
  await expectCode(createStaff(deps, admin, { email: "amel@studio.dz", displayName: "Amel 2", role: "employee" }), "already-exists");
});

test("création de compte : si le rôle ne peut pas être posé, le compte Auth est supprimé (pas de compte orphelin)", async () => {
  const { deps, db, auth } = setup();
  await bootstrapAdmin(deps, boss);
  auth.failClaimsFor.add("accountant");
  await assert.rejects(createStaff(deps, asAdmin(boss), { email: "compta@studio.dz", displayName: "Compta", role: "accountant" }));
  assert.equal([...auth.users.values()].some((u) => u.email === "compta@studio.dz"), false);
  assert.equal((await db.collection("staff").where("email", "==", "compta@studio.dz").get()).size, 0);
});

test("rôles : changement journalisé, sessions coupées ; interdit sur soi-même", async () => {
  const { deps, db, auth } = setup();
  await bootstrapAdmin(deps, boss);
  const admin = asAdmin(boss);
  const { uid } = await createStaff(deps, admin, { email: "amel@studio.dz", displayName: "Amel", role: "employee" });

  await setStaffRole(deps, admin, { uid, role: "accountant" });
  assert.equal((await db.doc(`staff/${uid}`).get()).get("role"), "accountant");
  assert.deepEqual(auth.users.get(uid)!.claims, { role: "accountant" });
  assert.equal(auth.users.get(uid)!.revoked, 1);

  await expectCode(setStaffRole(deps, admin, { uid: "boss", role: "employee" }), "failed-precondition");
  await expectCode(setStaffRole(deps, admin, { uid: "inconnu", role: "employee" }), "not-found");
  await expectCode(setStaffRole(deps, { ...admin, role: "accountant" }, { uid, role: "admin" }), "permission-denied");
  await expectCode(setStaffRole(deps, admin, { uid: "a/b", role: "admin" }), "invalid-argument");
  // Même rôle : rien ne change, pas de ligne d'audit en plus.
  await setStaffRole(deps, admin, { uid, role: "accountant" });
  assert.deepEqual(await auditActions(db), ["staff.bootstrapAdmin", "staff.create", "staff.setRole"]);
});

test("désactivation : accès coupé (fiche + Auth + sessions), jamais le dernier admin", async () => {
  const { deps, db, auth } = setup();
  await bootstrapAdmin(deps, boss);
  const admin = asAdmin(boss);
  const { uid } = await createStaff(deps, admin, { email: "amel@studio.dz", displayName: "Amel", role: "employee" });

  await setStaffDisabled(deps, admin, { uid, disabled: true });
  assert.equal((await db.doc(`staff/${uid}`).get()).get("disabled"), true);
  assert.equal(auth.users.get(uid)!.disabled, true);
  assert.equal(auth.users.get(uid)!.revoked, 1);
  await setStaffDisabled(deps, admin, { uid, disabled: false });
  assert.equal(auth.users.get(uid)!.disabled, false);
  await expectCode(setStaffDisabled(deps, admin, { uid, disabled: "oui" }), "invalid-argument");
  await expectCode(setStaffDisabled(deps, admin, { uid: "boss", disabled: true }), "failed-precondition");
});

test("CONCURRENCE : deux admins qui se rétrogradent en même temps ne laissent jamais zéro admin", async () => {
  const { deps, db } = setup(["a@studio.dz", "b@studio.dz"]);
  const a: Caller = { uid: "A", email: "a@studio.dz", emailVerified: true, role: null };
  const b: Caller = { uid: "B", email: "b@studio.dz", emailVerified: true, role: null };
  await bootstrapAdmin(deps, a);
  await bootstrapAdmin(deps, b);

  const results = await Promise.allSettled([
    setStaffRole(deps, asAdmin(a), { uid: "B", role: "employee" }),
    setStaffRole(deps, asAdmin(b), { uid: "A", role: "employee" }),
  ]);
  const admins = (await db.collection("staff").where("role", "==", "admin").where("disabled", "==", false).get()).size;
  assert.equal(admins, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);

  // Même chose avec la désactivation.
  const { deps: d2, db: db2 } = setup(["a@studio.dz", "b@studio.dz"]);
  await bootstrapAdmin(d2, a);
  await bootstrapAdmin(d2, b);
  await Promise.allSettled([
    setStaffDisabled(d2, asAdmin(a), { uid: "B", disabled: true }),
    setStaffDisabled(d2, asAdmin(b), { uid: "A", disabled: true }),
  ]);
  assert.equal((await db2.collection("staff").where("role", "==", "admin").where("disabled", "==", false).get()).size, 1);
});

test("premier admin : un compte désactivé ne peut pas se réactiver par ce chemin", async () => {
  const { deps } = setup(["a@studio.dz", "b@studio.dz"]);
  const a: Caller = { uid: "A", email: "a@studio.dz", emailVerified: true, role: null };
  const b: Caller = { uid: "B", email: "b@studio.dz", emailVerified: true, role: null };
  await bootstrapAdmin(deps, a);
  await bootstrapAdmin(deps, b);
  await setStaffDisabled(deps, asAdmin(a), { uid: "B", disabled: true });
  await expectCode(bootstrapAdmin(deps, b), "permission-denied");
  void Timestamp;
});

test("ADMIN_EMAILS : liste avec virgules, espaces ou format JSON", () => {
  assert.deepEqual(parseEmailList("Hichem@Example.com, b@studio.dz"), ["hichem@example.com", "b@studio.dz"]);
  assert.deepEqual(parseEmailList('["a@x.dz","B@y.dz"]'), ["a@x.dz", "b@y.dz"]);
  assert.deepEqual(parseEmailList(""), []);
  assert.deepEqual(parseEmailList("[cassé"), []);
});

test("jeton encore valide d'un admin désactivé ou rétrogradé : refusé tout de suite", async () => {
  const { deps } = setup(["a@studio.dz", "b@studio.dz"]);
  const a: Caller = { uid: "A", email: "a@studio.dz", emailVerified: true, role: null };
  const b: Caller = { uid: "B", email: "b@studio.dz", emailVerified: true, role: null };
  await bootstrapAdmin(deps, a);
  await bootstrapAdmin(deps, b);
  await setStaffDisabled(deps, asAdmin(a), { uid: "B", disabled: true });
  // B a encore un jeton « admin » pendant au plus 1 h : il ne peut rien faire.
  await expectCode(createStaff(deps, asAdmin(b), { email: "x@studio.dz", displayName: "Xavier", role: "admin" }), "permission-denied");
  await expectCode(setStaffDisabled(deps, asAdmin(b), { uid: "A", disabled: true }), "permission-denied");
  // Jeton « admin » sans fiche staff (rôle posé à la main dans la console) : refusé.
  await expectCode(createStaff(deps, { uid: "Z", email: "z@x.dz", emailVerified: true, role: "admin" }, { email: "y@studio.dz", displayName: "Yanis", role: "admin" }), "permission-denied");
});
