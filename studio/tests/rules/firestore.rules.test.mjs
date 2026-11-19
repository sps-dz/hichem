// Tests des règles Firestore et Storage, contre le VRAI émulateur Firebase.
// Lancement : npm run test:emulator (Java + firebase-tools requis), ou la CI GitHub.
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadString } from "firebase/storage";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-studio",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8") },
  });
});
after(async () => env?.cleanup());

const STAFF = {
  boss: { role: "admin" },
  amel: { role: "employee" },
  compta: { role: "accountant" },
  ancien: { role: "employee", disabled: true },
};

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, s] of Object.entries(STAFF)) {
      await setDoc(doc(db, "staff", uid), { uid, role: s.role, disabled: !!s.disabled, email: `${uid}@studio.dz` });
    }
    const seed = {
      "services/studio": { name: "Location studio" },
      "publicSettings/site": { name: "Studio" },
      "availability/2026-12-05": { slots: { 1000: { state: "booked", until: null } } },
      "customers/+213555123456": { name: "Amine" },
      "orders/o1": { ref: "STU-2026-000001", total: 10000 },
      "orders/o1/items/i1": { price: 10000 },
      "bookings/b1": { orderId: "o1" },
      "quotes/q1": { orderId: "o1" },
      "slots/2026-12-05_1000": { orderId: "o1", state: "booked" },
      "notifications/n1": { text: "x" },
      "payments/p1": { amount: 2000 },
      "paymentProofs/pp1": { orderId: "o1" },
      "expenses/e1": { amount: 500 },
      "expenseCategories/loyer": { name: "Loyer" },
      "auditLogs/a1": { action: "x" },
      "settings/pricing": { depositPercent: 20 },
      "counters/orders-2026": { value: 1 },
      "systemJobs/backup-2026-12-05": { status: "started" },
      "customerAccess/abc": { orderId: "o1" },
      "inconnu/x": { a: 1 },
    };
    for (const [path, data] of Object.entries(seed)) await setDoc(doc(db, path), data);
  });
});

/** Contexte Firestore pour un visiteur, un client connecté anonymement, ou un membre de l'équipe. */
function as(who, extra = {}) {
  if (who === "anon") return env.unauthenticatedContext().firestore();
  if (who === "inconnu") return env.authenticatedContext("inconnu", { email: "x@y.dz", email_verified: true }).firestore();
  const s = STAFF[who];
  return env.authenticatedContext(who, { email: `${who}@studio.dz`, email_verified: true, role: s.role, ...extra }).firestore();
}

const read = (db, path) => getDoc(doc(db, path));

const ALL = [
  "services/studio", "publicSettings/site", "availability/2026-12-05",
  "customers/+213555123456", "orders/o1", "orders/o1/items/i1", "bookings/b1", "quotes/q1",
  "slots/2026-12-05_1000", "notifications/n1",
  "payments/p1", "paymentProofs/pp1", "expenses/e1", "expenseCategories/loyer",
  "auditLogs/a1", "settings/pricing", "counters/orders-2026", "systemJobs/backup-2026-12-05",
  "customerAccess/abc", "inconnu/x", "staff/amel",
];

// Qui peut lire quoi. Tout ce qui n'est pas listé doit être refusé.
const CAN_READ = {
  anon: ["services/studio", "publicSettings/site", "availability/2026-12-05"],
  inconnu: ["services/studio", "publicSettings/site", "availability/2026-12-05"],
  amel: [
    "services/studio", "publicSettings/site", "availability/2026-12-05",
    "customers/+213555123456", "orders/o1", "orders/o1/items/i1", "bookings/b1", "quotes/q1",
    "slots/2026-12-05_1000", "notifications/n1", "staff/amel",
  ],
  compta: [
    "services/studio", "publicSettings/site", "availability/2026-12-05",
    "customers/+213555123456", "orders/o1", "orders/o1/items/i1", "bookings/b1", "quotes/q1",
    "payments/p1", "paymentProofs/pp1", "expenses/e1", "expenseCategories/loyer",
  ],
  boss: ALL.filter((p) => !["customerAccess/abc", "inconnu/x"].includes(p)),
  ancien: ["services/studio", "publicSettings/site", "availability/2026-12-05"],
};

for (const [who, allowed] of Object.entries(CAN_READ)) {
  test(`lecture : ${who}`, async () => {
    const db = as(who);
    for (const path of ALL) {
      if (allowed.includes(path)) await assertSucceeds(read(db, path));
      else await assertFails(read(db, path));
    }
  });
}

test("écriture : refusée à tout le monde, partout (seules les fonctions écrivent)", async () => {
  for (const who of ["anon", "inconnu", "amel", "compta", "boss"]) {
    const db = as(who);
    for (const path of ALL) {
      await assertFails(setDoc(doc(db, path), { pirate: true }));
      await assertFails(updateDoc(doc(db, path), { pirate: true }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(setDoc(doc(db, "orders/nouvelle"), { total: 1 }));
    await assertFails(setDoc(doc(db, "staff/" + who), { role: "admin", disabled: false }));
  }
});

test("jeton falsifié : un rôle dans le jeton sans fiche staff correspondante ne donne rien", async () => {
  // Rôle admin dans le jeton, mais la fiche dit employé : refus.
  await assertFails(read(as("amel", { role: "admin" }), "auditLogs/a1"));
  // E-mail non vérifié : refus, même avec un vrai rôle.
  await assertFails(read(as("boss", { email_verified: false }), "orders/o1"));
  // Compte inconnu qui s'attribue un rôle : pas de fiche staff → refus.
  const forged = env.authenticatedContext("pirate", { email: "p@x.dz", email_verified: true, role: "admin" }).firestore();
  await assertFails(read(forged, "orders/o1"));
  await assertFails(read(forged, "staff/boss"));
  // Compte désactivé : refus immédiat malgré un jeton encore valide.
  await assertFails(read(as("ancien"), "orders/o1"));
});

test("listes : un visiteur ne peut pas lister les clients ni les commandes", async () => {
  await assertFails(getDocs(collection(as("anon"), "customers")));
  await assertFails(getDocs(collection(as("anon"), "orders")));
  await assertFails(getDocs(collection(as("anon"), "customerAccess")));
  await assertSucceeds(getDocs(collection(as("anon"), "services")));
  await assertSucceeds(getDocs(collection(as("anon"), "availability")));
  await assertSucceeds(getDocs(collection(as("amel"), "orders")));
  await assertFails(getDocs(collection(as("amel"), "payments")));
  await assertFails(getDocs(collection(as("boss"), "customerAccess")));
});

test("stockage : preuves de paiement fermées ; photos publiques en lecture seule", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadString(ref(ctx.storage(), "payment-proofs/o1/recu.jpg"), "x");
    await uploadString(ref(ctx.storage(), "public/studio.jpg"), "x");
  });
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext("boss", { email_verified: true, role: "admin" })]) {
    const st = ctx.storage();
    await assertFails(getBytes(ref(st, "payment-proofs/o1/recu.jpg")));
    await assertFails(uploadString(ref(st, "payment-proofs/o1/faux.jpg"), "x"));
    await assertSucceeds(getBytes(ref(st, "public/studio.jpg")));
    await assertFails(uploadString(ref(st, "public/pirate.jpg"), "x"));
  }
});
