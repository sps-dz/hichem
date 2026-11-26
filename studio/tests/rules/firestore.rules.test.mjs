// Tests des règles Firestore et Storage (version forfait Spark, sans Cloud Functions),
// contre le VRAI émulateur Firebase.
// Lancement : npm run test:emulator (Java 21 + firebase-tools), ou la CI GitHub.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp, collection, deleteDoc, deleteField, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
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

const VERSION = "2026-11-25-forfait-provisoire";
const STAFF = {
  boss: { role: "admin" },
  amel: { role: "employee" },
  compta: { role: "accountant" },
  ancien: { role: "employee", disabled: true },
};
const DAY = "2026-12-12";
const FUTURE = () => Timestamp.fromMillis(Date.now() + 24 * 3600e3);
const PAST = () => Timestamp.fromMillis(Date.now() - 3600e3);

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, s] of Object.entries(STAFF)) {
      await setDoc(doc(db, "staff", uid), { uid, role: s.role, disabled: !!s.disabled, email: `${uid}@studio.dz`, displayName: uid });
    }
    const seed = {
      "publicSettings/catalog": { version: VERSION, catalog: { version: VERSION } },
      "publicSettings/contact": { whatsapp: "213555000000", holdHours: 24 },
      ["catalogVersions/" + VERSION]: { catalog: { version: VERSION } },
      "orders/o1AAAAAAAAAAAAAAAAAA": { status: "pending", trackingToken: "T".repeat(32), slotKeys: [] },
      ["tracking/" + "T".repeat(32)]: { orderId: "o1AAAAAAAAAAAAAAAAAA", status: "pending" },
      [`days/${DAY}`]: { date: DAY, slots: { 1000: { o: "o1AAAAAAAAAAAAAAAAAA", s: "booked", u: null } } },
      "payments/p1": { amount: 2000, recordedBy: "amel" },
      "auditLogs/a1": { action: "x" },
      "counters/orders-2026": { value: 1 },
      "staffInvites/nouveau@studio.dz": { email: "nouveau@studio.dz", role: "employee" },
      "inconnu/x": { a: 1 },
    };
    for (const [path, data] of Object.entries(seed)) await setDoc(doc(db, path), data);
  });
});

/** Contexte Firestore : visiteur, compte sans rôle, ou membre de l'équipe. */
function as(who, extra = {}) {
  if (who === "anon") return env.unauthenticatedContext().firestore();
  if (who === "inconnu") return env.authenticatedContext("inconnu", { email: "x@y.dz", email_verified: true }).firestore();
  return env.authenticatedContext(who, { email: `${who}@studio.dz`, email_verified: true, ...extra }).firestore();
}
const read = (db, path) => getDoc(doc(db, path));

// ---------------------------------------------------------------- lectures

const ALL = [
  "publicSettings/catalog", "publicSettings/contact", `catalogVersions/${VERSION}`,
  "orders/o1AAAAAAAAAAAAAAAAAA", "tracking/" + "T".repeat(32), `days/${DAY}`,
  "payments/p1", "auditLogs/a1", "counters/orders-2026", "staff/amel", "staffInvites/nouveau@studio.dz", "inconnu/x",
];
const PUBLIC = ["publicSettings/catalog", "publicSettings/contact", "tracking/" + "T".repeat(32), `days/${DAY}`];
const OPS = [...PUBLIC, `catalogVersions/${VERSION}`, "orders/o1AAAAAAAAAAAAAAAAAA", "counters/orders-2026"];
const CAN_READ = {
  anon: PUBLIC,
  inconnu: PUBLIC,
  amel: [...OPS, "staff/amel", "payments/p1"], // son propre encaissement
  compta: [...OPS, "payments/p1"],
  boss: ALL.filter((p) => p !== "inconnu/x"),
  ancien: PUBLIC,
};

for (const [who, allowed] of Object.entries(CAN_READ)) {
  test(`lecture : ${who}`, async () => {
    const db = as(who);
    for (const path of ALL) {
      if (allowed.includes(path)) await assertSucceeds(read(db, path), `${who} devrait lire ${path}`);
      else await assertFails(read(db, path), `${who} ne devrait pas lire ${path}`);
    }
  });
}

test("listes : suivi jamais listable ; demandes et encaissements réservés à l'équipe", async () => {
  await assertFails(getDocs(collection(as("anon"), "tracking")));
  await assertFails(getDocs(collection(as("boss"), "tracking")));
  await assertFails(getDocs(collection(as("anon"), "orders")));
  await assertSucceeds(getDocs(collection(as("anon"), "days")));
  await assertSucceeds(getDocs(collection(as("amel"), "orders")));
  await assertFails(getDocs(collection(as("amel"), "payments")));
  await assertSucceeds(getDocs(collection(as("compta"), "payments")));
});

test("jeton : e-mail non vérifié ou compte désactivé → aucun accès d'équipe", async () => {
  await assertFails(read(as("boss", { email_verified: false }), "orders/o1AAAAAAAAAAAAAAAAAA"));
  await assertFails(read(as("ancien"), "orders/o1AAAAAAAAAAAAAAAAAA"));
  const forged = env.authenticatedContext("pirate", { email: "p@x.dz", email_verified: true, role: "admin" }).firestore();
  await assertFails(read(forged, "orders/o1AAAAAAAAAAAAAAAAAA"));
});

// ---------------------------------------------------------------- demande client

const rid = (c, n) => (c + "x".repeat(n)).slice(0, n).replace(/[^A-Za-z0-9]/g, "x");
let seq = 0;

/** Écriture groupée d'une demande client, comme la page client la fait. */
function clientOrder(db, { hms = ["1400", "1430"], date = DAY, hold = FUTURE(), version = VERSION, phone = "+213555123456", status = "pending", tracking = true, extraHm = null, declared = null } = {}) {
  seq++;
  const orderId = rid("ord" + seq, 20);
  const token = rid("tok" + seq, 32);
  const slots = hms.length ? { [date]: declared ?? hms } : {};
  const b = writeBatch(db);
  b.set(doc(db, "orders", orderId), {
    status, source: "web", customer: { name: "Amine K.", phone },
    lines: [{ service: "studio", date, start: "14:00", durationMinutes: 60 }],
    pricing: { total: 3000, deposit: 600 }, slots, ...(hms.length ? { holdExpiresAt: hold } : {}),
    trackingToken: token, note: "", catalogVersion: version, createdAt: serverTimestamp(),
  });
  if (tracking) {
    b.set(doc(db, "tracking", token), {
      orderId, code: orderId.slice(0, 6).toUpperCase(), status: "pending", name: "Amine", lines: [], total: 3000, deposit: 600, remaining: 2400,
      quotePending: false, holdExpiresAt: hms.length ? hold : null, createdAt: serverTimestamp(),
    });
  }
  const all = [...hms, ...(extraHm ? [extraHm] : [])];
  if (all.length) {
    b.set(doc(db, "days", date), { date, slots: Object.fromEntries(all.map((hm) => [hm, { o: orderId, s: "hold", u: hold }])), lastOrderId: orderId, updatedAt: serverTimestamp() }, { merge: true });
  }
  return { commit: () => b.commit(), orderId, token };
}

const dayOf = async (date = DAY) => (await getDoc(doc(as("anon"), "days", date))).data()?.slots ?? {};

test("client : envoie une demande (demande + suivi + tranches) sans compte", async () => {
  const o = clientOrder(as("anon"));
  await assertSucceeds(o.commit());
  const t = await getDoc(doc(as("anon"), "tracking", o.token));
  assert.equal(t.data().status, "pending");
  // Sans studio (shooting, montage) : pas de tranche.
  await assertSucceeds(clientOrder(as("anon"), { hms: [] }).commit());
});

test("client : une journée entière (28 tranches) passe en une seule écriture", async () => {
  const hms = Array.from({ length: 28 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}${i % 2 ? "30" : "00"}`);
  await assertSucceeds(clientOrder(as("anon"), { date: "2026-12-13", hms }).commit());
  assert.equal(Object.keys(await dayOf("2026-12-13")).length, 28);
});

test("client : refus des demandes mal formées", async () => {
  const db = as("anon");
  await assertFails(clientOrder(db, { status: "confirmed" }).commit());
  await assertFails(clientOrder(db, { phone: "0555123456" }).commit());
  await assertFails(clientOrder(db, { version: "ancienne-version" }).commit());
  await assertFails(clientOrder(db, { tracking: false }).commit());
  await assertFails(clientOrder(db, { hold: PAST() }).commit());
  await assertFails(clientOrder(db, { hold: Timestamp.fromMillis(Date.now() + 100 * 3600e3) }).commit());
  // Une tranche bloquée qui n'est pas dans la demande, ou une tranche annoncée mais pas bloquée.
  await assertFails(clientOrder(db, { extraHm: "2000" }).commit());
  await assertFails(clientOrder(db, { hms: ["1400"], declared: ["1400", "1430"] }).commit());
});

test("anti-double réservation : une tranche prise ne peut pas être reprise, même pour une seule demi-heure", async () => {
  const db = as("anon");
  await assertSucceeds(clientOrder(db, { hms: ["1500", "1530"] }).commit());
  // Chevauchement sur une seule tranche → toute la demande est refusée, rien n'est bloqué.
  await assertFails(clientOrder(db, { hms: ["1530", "1600"] }).commit());
  assert.equal((await dayOf())["1600"], undefined);
  // Tranche réservée (confirmée) : jamais reprise.
  await assertFails(clientOrder(db, { hms: ["1000"] }).commit());
  // Deux demandes en même temps sur la même tranche : une seule passe.
  const r = await Promise.allSettled([clientOrder(db, { hms: ["1700"] }).commit(), clientOrder(as("anon"), { hms: ["1700"] }).commit()]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  // Les autres tranches libres du jour restent réservables.
  await assertSucceeds(clientOrder(db, { hms: ["1800", "1830"] }).commit());
});

test("client : ne peut ni modifier, ni annuler sans son lien de suivi, ni libérer une tranche", async () => {
  const db = as("anon");
  const o = clientOrder(db, { hms: ["1100"] });
  await o.commit();
  await assertFails(updateDoc(doc(db, "days", DAY), { "slots.1100": deleteField(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "orders", o.orderId), { status: "cancelled" }));
  await assertFails(updateDoc(doc(db, "tracking", o.token), { status: "confirmed" }));
  await assertFails(deleteDoc(doc(db, "days", DAY)));
  // Bloquer des tranches sans créer de demande : refusé.
  await assertFails(setDoc(doc(db, "days", DAY), { date: DAY, slots: { 1200: { o: o.orderId, s: "hold", u: FUTURE() } }, lastOrderId: o.orderId, updatedAt: serverTimestamp() }, { merge: true }));
});

/** Annulation par le client, comme la page de suivi la fait (demande + suivi dans le même envoi). */
function clientCancel(db, o, { reason = "Empêchement", order = true, tracking = true, orderExtra = {}, trackingExtra = {} } = {}) {
  const b = writeBatch(db);
  if (order) b.update(doc(db, "orders", o.orderId), { status: "cancelled", cancelledBy: "client", cancelReason: reason, cancelledAt: serverTimestamp(), ...orderExtra });
  if (tracking) b.update(doc(db, "tracking", o.token), { status: "cancelled", cancelledBy: "client", cancelReason: reason, updatedAt: serverTimestamp(), ...trackingExtra });
  return b.commit();
}

test("client : annule sa demande avec son lien de suivi, avant ou après l'acompte", async () => {
  const db = as("anon");
  // Avant l'acompte.
  const o = clientOrder(db, { hms: ["1300"] });
  await o.commit();
  // Seulement la demande, ou seulement le suivi : refusé.
  await assertFails(clientCancel(db, o, { tracking: false }));
  await assertFails(clientCancel(db, o, { order: false }));
  // Autre statut, champ en plus, raison trop longue, faux auteur : refusé.
  await assertFails(clientCancel(db, o, { orderExtra: { status: "done" } }));
  await assertFails(clientCancel(db, o, { orderExtra: { pricing: { total: 0 } } }));
  await assertFails(clientCancel(db, o, { reason: "x".repeat(301) }));
  await assertFails(clientCancel(db, o, { orderExtra: { cancelledBy: "studio" } }));
  await assertSucceeds(clientCancel(db, o));
  assert.equal((await getDoc(doc(db, "tracking", o.token))).data().status, "cancelled");
  // Déjà annulée : on ne la « réannule » pas.
  await assertFails(clientCancel(db, o));
  // Après l'acompte (demande confirmée par l'équipe).
  const o2 = clientOrder(db, { hms: [] });
  await o2.commit();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "orders", o2.orderId), { status: "confirmed" });
    await updateDoc(doc(ctx.firestore(), "tracking", o2.token), { status: "confirmed" });
  });
  await assertSucceeds(clientCancel(db, o2, { reason: "" }));
  // Terminée : plus d'annulation.
  const o3 = clientOrder(db, { hms: [] });
  await o3.commit();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "orders", o3.orderId), { status: "done" });
    await updateDoc(doc(ctx.firestore(), "tracking", o3.token), { status: "done" });
  });
  await assertFails(clientCancel(db, o3));
});

// ---------------------------------------------------------------- équipe

function auditEntry(db, w, uid, role, action = "test") {
  const r = doc(collection(db, "auditLogs"));
  w.set(r, { action, entity: "orders", entityId: "x", actorUid: uid, actorEmail: `${uid}@studio.dz`, actorRole: role, at: serverTimestamp(), before: null, after: null });
  return r.id;
}

test("premier administrateur : seulement l'e-mail prévu, vérifié", async () => {
  const ok = env.authenticatedContext("hichem", { email: "comptppl@gmail.com", email_verified: true }).firestore();
  const notVerified = env.authenticatedContext("h2", { email: "comptppl@gmail.com", email_verified: false }).firestore();
  const other = env.authenticatedContext("p", { email: "pirate@gmail.com", email_verified: true }).firestore();
  const fiche = (uid, email, role = "admin") => ({ uid, email, displayName: "H", role, disabled: false, createdAt: serverTimestamp() });
  await assertFails(setDoc(doc(notVerified, "staff", "h2"), fiche("h2", "comptppl@gmail.com")));
  await assertFails(setDoc(doc(other, "staff", "p"), fiche("p", "pirate@gmail.com")));
  await assertFails(setDoc(doc(ok, "staff", "autre"), fiche("autre", "comptppl@gmail.com")));
  await assertSucceeds(setDoc(doc(ok, "staff", "hichem"), fiche("hichem", "comptppl@gmail.com")));
});

test("invitation : la personne invitée rejoint avec le rôle prévu, pas un autre", async () => {
  const db = env.authenticatedContext("nouveau", { email: "nouveau@studio.dz", email_verified: true }).firestore();
  const fiche = (role) => ({ uid: "nouveau", email: "nouveau@studio.dz", displayName: "N", role, disabled: false, createdAt: serverTimestamp() });
  await assertFails(setDoc(doc(db, "staff", "nouveau"), fiche("admin")));
  await assertSucceeds(setDoc(doc(db, "staff", "nouveau"), fiche("employee")));
  // Une fois créée, la fiche ne se modifie pas soi-même.
  await assertFails(updateDoc(doc(db, "staff", "nouveau"), { role: "admin" }));
});

test("admin : invite, change un rôle, désactive — toujours avec le journal", async () => {
  const db = as("boss");
  let w = writeBatch(db);
  let auditId = auditEntry(db, w, "boss", "admin", "staff.invite");
  w.set(doc(db, "staffInvites", "lina@studio.dz"), { email: "lina@studio.dz", role: "accountant", displayName: "Lina", invitedBy: "boss", invitedAt: serverTimestamp(), auditId });
  await assertSucceeds(w.commit());
  // Sans journal : refusé.
  await assertFails(updateDoc(doc(db, "staff", "amel"), { role: "admin", auditId: "inexistant" }));
  w = writeBatch(db);
  auditId = auditEntry(db, w, "boss", "admin", "staff.update");
  w.update(doc(db, "staff", "amel"), { disabled: true, auditId });
  await assertSucceeds(w.commit());
  // Un employé ne gère pas l'équipe.
  const e = as("compta");
  w = writeBatch(e);
  auditId = auditEntry(e, w, "compta", "accountant");
  w.set(doc(e, "staffInvites", "x@studio.dz"), { email: "x@studio.dz", role: "admin", displayName: "", invitedBy: "compta", invitedAt: serverTimestamp(), auditId });
  await assertFails(w.commit());
});

test("journal d'audit : identité réelle obligatoire, jamais modifié ni effacé", async () => {
  const db = as("amel");
  await assertFails(setDoc(doc(db, "auditLogs", "faux"), { action: "x", entity: "orders", entityId: "1", actorUid: "boss", actorEmail: "boss@studio.dz", actorRole: "admin", at: serverTimestamp(), before: null, after: null }));
  await assertFails(setDoc(doc(db, "auditLogs", "faux2"), { action: "x", entity: "orders", entityId: "1", actorUid: "amel", actorEmail: "amel@studio.dz", actorRole: "admin", at: serverTimestamp(), before: null, after: null }));
  await assertFails(updateDoc(doc(as("boss"), "auditLogs", "a1"), { action: "y" }));
  await assertFails(deleteDoc(doc(as("boss"), "auditLogs", "a1")));
});

test("tarifs : seul l'admin publie, avec la copie de version et le journal", async () => {
  const publish = (db, uid, role, version, withCopy = true) => {
    const w = writeBatch(db);
    const auditId = auditEntry(db, w, uid, role, "catalog.publish");
    if (withCopy) w.set(doc(db, "catalogVersions", version), { catalog: { version }, publishedAt: serverTimestamp(), publishedBy: uid, replaced: VERSION });
    w.set(doc(db, "publicSettings", "catalog"), { catalog: { version }, version, publishedAt: serverTimestamp(), publishedBy: uid, auditId });
    return w.commit();
  };
  await assertFails(publish(as("amel"), "amel", "employee", "v2"));
  await assertFails(publish(as("boss"), "boss", "admin", "v2", false));
  await assertFails(publish(as("boss"), "boss", "admin", VERSION)); // version déjà publiée
  await assertSucceeds(publish(as("boss"), "boss", "admin", "v2"));
  await assertFails(updateDoc(doc(as("boss"), "catalogVersions", "v2"), { catalog: { version: "v2", pirate: 1 } }));
});

test("coordonnées : numéro WhatsApp au format 213…, délai d'acompte borné", async () => {
  const save = (data) => {
    const db = as("boss");
    const w = writeBatch(db);
    const auditId = auditEntry(db, w, "boss", "admin", "settings.contact");
    w.set(doc(db, "publicSettings", "contact"), { studioName: "Studio", ccp: "", baridimob: "", depositNote: "", ...data, updatedAt: serverTimestamp(), auditId });
    return w.commit();
  };
  await assertSucceeds(save({ whatsapp: "213555123456", holdHours: 24 }));
  await assertFails(save({ whatsapp: "+213555123456", holdHours: 24 }));
  await assertFails(save({ whatsapp: "213555123456", holdHours: 200 }));
});

test("acompte reçu : l'employé confirme (référence, tranches réservées, encaissement, suivi, journal)", async () => {
  const o = clientOrder(as("anon"), { hms: ["1600", "1630"] });
  await o.commit();
  const confirm = (db, uid, role) => runTransaction(db, async (tx) => {
    const c = await tx.get(doc(db, "counters", "orders-2026"));
    const n = c.data().value + 1;
    const ref = `STU-2026-${String(n).padStart(6, "0")}`;
    const r = doc(collection(db, "auditLogs"));
    tx.set(r, { action: "order.confirm", entity: "orders", entityId: o.orderId, actorUid: uid, actorEmail: `${uid}@studio.dz`, actorRole: role, at: serverTimestamp(), before: null, after: null });
    const auditId = r.id;
    tx.set(doc(db, "counters", "orders-2026"), { value: n });
    tx.update(doc(db, "orders", o.orderId), { status: "confirmed", ref, deposit: { amount: 600, method: "baridimob", by: uid }, updatedAt: serverTimestamp(), updatedBy: uid, auditId });
    tx.set(doc(db, "days", DAY), { date: DAY, slots: { 1600: { o: o.orderId, s: "booked", u: null }, 1630: { o: o.orderId, s: "booked", u: null } }, lastOrderId: o.orderId, updatedAt: serverTimestamp(), auditId }, { merge: true });
    tx.update(doc(db, "tracking", o.token), { status: "confirmed", ref, updatedAt: serverTimestamp(), auditId });
    tx.set(doc(collection(db, "payments")), { orderId: o.orderId, ref, kind: "deposit", amount: 600, method: "baridimob", note: "", recordedAt: serverTimestamp(), recordedBy: uid, auditId });
  });
  await assertFails(confirm(as("compta"), "compta", "accountant")); // le comptable ne confirme pas
  await assertSucceeds(confirm(as("amel"), "amel", "employee"));
  const t = (await getDoc(doc(as("anon"), "tracking", o.token))).data();
  assert.equal(t.status, "confirmed");
  assert.equal(t.ref, "STU-2026-000002");
  assert.equal((await dayOf())["1600"].s, "booked");
  // Le compteur n'avance que d'un en un.
  await assertFails(setDoc(doc(as("amel"), "counters", "orders-2026"), { value: 10 }));
});

test("annulation : l'équipe libère les tranches ; la tranche redevient libre pour un client", async () => {
  const o = clientOrder(as("anon"), { hms: ["1900"] });
  await o.commit();
  const db = as("amel");
  const w = writeBatch(db);
  const auditId = auditEntry(db, w, "amel", "employee", "order.cancel");
  w.update(doc(db, "days", DAY), { "slots.1900": deleteField(), lastOrderId: o.orderId, updatedAt: serverTimestamp(), auditId });
  w.update(doc(db, "orders", o.orderId), { status: "cancelled", updatedAt: serverTimestamp(), updatedBy: "amel", auditId });
  w.update(doc(db, "tracking", o.token), { status: "cancelled", updatedAt: serverTimestamp(), auditId });
  await assertSucceeds(w.commit());
  await assertSucceeds(clientOrder(as("anon"), { hms: ["1900"] }).commit());
  // Statut inconnu ou champ non prévu : refusé.
  const w2 = writeBatch(db);
  const a2 = auditEntry(db, w2, "amel", "employee");
  w2.update(doc(db, "orders", o.orderId), { status: "payée", updatedAt: serverTimestamp(), updatedBy: "amel", auditId: a2 });
  await assertFails(w2.commit());
  const w3 = writeBatch(db);
  const a3 = auditEntry(db, w3, "amel", "employee");
  w3.update(doc(db, "orders", o.orderId), { customer: { name: "X", phone: "+213555000000" }, updatedAt: serverTimestamp(), updatedBy: "amel", auditId: a3 });
  await assertFails(w3.commit());
});

test("annulation après acompte : l'équipe libère le créneau et enregistre le remboursement", async () => {
  const o = clientOrder(as("anon"), { hms: ["2000"] });
  await o.commit();
  await clientCancel(as("anon"), o);
  const db = as("amel");
  const w = writeBatch(db);
  const auditId = auditEntry(db, w, "amel", "employee", "order.refund");
  w.update(doc(db, "days", DAY), { "slots.2000": deleteField(), lastOrderId: o.orderId, updatedAt: serverTimestamp(), auditId });
  w.update(doc(db, "orders", o.orderId), { refund: { amount: 600, method: "cash", by: "amel" }, updatedAt: serverTimestamp(), updatedBy: "amel", auditId });
  w.update(doc(db, "tracking", o.token), { refunded: 600, updatedAt: serverTimestamp(), auditId });
  w.set(doc(collection(db, "payments")), { orderId: o.orderId, ref: "", kind: "refund", amount: 600, method: "cash", note: "", recordedAt: serverTimestamp(), recordedBy: "amel", auditId });
  await assertSucceeds(w.commit());
  await assertSucceeds(clientOrder(as("anon"), { hms: ["2000"] }).commit());
  // Le client ne peut pas se déclarer remboursé.
  await assertFails(updateDoc(doc(as("anon"), "tracking", o.token), { refunded: 9999, updatedAt: serverTimestamp() }));
});

test("site client : seul l'admin choisit les photos, les textes et les carrousels", async () => {
  const media = (db, uid, extra = {}) => setDoc(doc(db, "siteMedia", rid("med" + (++seq), 20)), { type: "image/jpeg", data: "A".repeat(2000), w: 1200, h: 800, createdAt: serverTimestamp(), createdBy: uid, ...extra });
  await assertSucceeds(media(as("boss"), "boss"));
  await assertFails(media(as("amel"), "amel"));
  await assertFails(media(as("anon"), "anon"));
  await assertFails(media(as("boss"), "boss", { type: "text/html" }));
  await assertFails(media(as("boss"), "boss", { data: "A".repeat(960000) }));
  await assertFails(media(as("boss"), "amel"));
  const save = (db, uid, role, data) => {
    const w = writeBatch(db);
    const auditId = auditEntry(db, w, uid, role, "site.save");
    w.set(doc(db, "publicSettings", "site"), { photos: {}, texts: { fr: {}, ar: {}, en: {} }, carousels: [], ...data, updatedAt: serverTimestamp(), auditId });
    return w.commit();
  };
  await assertSucceeds(save(as("boss"), "boss", "admin", { photos: { hero: "x" }, texts: { fr: { vTitle1: "Bonjour" }, ar: {}, en: {} }, carousels: [{ id: "c1", title: { fr: "Parfums" }, media: ["x"] }] }));
  await assertFails(save(as("amel"), "amel", "employee", {}));
  await assertFails(save(as("boss"), "boss", "admin", { photos: { inconnu: "x" } }));
  await assertFails(save(as("boss"), "boss", "admin", { texts: { de: {} } }));
  await assertSucceeds(read(as("anon"), "publicSettings/site"));
  // Sans journal d'audit : refusé.
  await assertFails(setDoc(doc(as("boss"), "publicSettings", "site"), { photos: {}, texts: {}, carousels: [], updatedAt: serverTimestamp() }));
});

test("tout le reste est fermé", async () => {
  for (const who of ["anon", "inconnu", "amel", "boss"]) {
    await assertFails(setDoc(doc(as(who), "inconnu/y"), { a: 1 }));
    await assertFails(setDoc(doc(as(who), "customers/+213555123456"), { a: 1 }));
  }
  await assertFails(deleteDoc(doc(as("boss"), "orders", "o1AAAAAAAAAAAAAAAAAA")));
  await assertFails(deleteDoc(doc(as("boss"), "payments", "p1")));
});

test("stockage : preuves de paiement fermées ; photos publiques en lecture seule", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadString(ref(ctx.storage(), "payment-proofs/o1/recu.jpg"), "x");
    await uploadString(ref(ctx.storage(), "public/studio.jpg"), "x");
  });
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext("boss", { email_verified: true })]) {
    const st = ctx.storage();
    await assertFails(getBytes(ref(st, "payment-proofs/o1/recu.jpg")));
    await assertFails(uploadString(ref(st, "payment-proofs/o1/faux.jpg"), "x"));
    await assertSucceeds(getBytes(ref(st, "public/studio.jpg")));
    await assertFails(uploadString(ref(st, "public/pirate.jpg"), "x"));
  }
});
