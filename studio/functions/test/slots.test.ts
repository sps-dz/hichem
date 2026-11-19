import { runTx } from "../src/lib/tx";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Firestore } from "firebase-admin/firestore";
import { claimSlots, releaseExpiredHolds, releaseSlots, SlotDoc } from "../src/lib/slots";
import { slotKeysFor } from "../src/lib/time";
import { at, expectCode, newDb, T0 } from "./helpers";

const keys = (start: string, durationMinutes: number, bufferMinutes = 0) =>
  slotKeysFor({ date: "2026-12-05", start, durationMinutes, bufferMinutes });

const hold = (db: Firestore, orderId: string, k: string[], now = T0) =>
  runTx(db, (tx) => claimSlots(db, tx, { orderId, keys: k, state: "hold", now }));
const book = (db: Firestore, orderId: string, k: string[], now = T0) =>
  runTx(db, (tx) => claimSlots(db, tx, { orderId, keys: k, state: "booked", now }));
const release = (db: Firestore, orderId: string, k: string[], now = T0) =>
  runTx(db, (tx) => releaseSlots(db, tx, { orderId, keys: k, now }));

async function slot(db: Firestore, key: string) {
  const s = await db.collection("slots").doc(key).get();
  return s.exists ? (s.data() as SlotDoc) : null;
}
async function avail(db: Firestore, date = "2026-12-05") {
  const s = await db.collection("availability").doc(date).get();
  return (s.get("slots") ?? {}) as Record<string, { state: string; until: unknown }>;
}

test("blocage : 60 min, visible dans les disponibilités publiques sans donnée client", async () => {
  const db = newDb();
  const r = await hold(db, "order-A", keys("10:00", 60));
  assert.equal(r.holdExpiresAt!.toMillis(), at(60).toMillis());
  const s = await slot(db, "2026-12-05_1000");
  assert.equal(s!.state, "hold");
  assert.equal(s!.orderId, "order-A");
  const a = await avail(db);
  assert.deepEqual(Object.keys(a).sort(), ["1000", "1030"]);
  assert.equal(a["1000"].state, "hold");
  assert.equal(JSON.stringify(a).includes("order-A"), false);
});

test("chevauchement : une tranche bloquée ou réservée est refusée à une autre commande", async () => {
  const db = newDb();
  await hold(db, "order-A", keys("10:00", 60));
  const e = (await expectCode(hold(db, "order-B", keys("10:30", 60)), "already-exists")) as Error & { conflicts: string[] };
  assert.deepEqual(e.conflicts, ["2026-12-05_1030"]);
  // Rien n'a été écrit pour B, même la tranche libre de 11:00.
  assert.equal(await slot(db, "2026-12-05_1100"), null);
  await book(db, "order-A", keys("10:00", 60));
  await expectCode(book(db, "order-B", keys("09:30", 60)), "already-exists");
  // Juste à côté : accepté.
  await hold(db, "order-B", keys("11:00", 30));
  await hold(db, "order-C", keys("09:30", 30));
});

test("tampon : une réservation qui finit à 11:00 + 15 min de tampon bloque 11:00", async () => {
  const db = newDb();
  await book(db, "order-A", keys("10:00", 60, 15));
  await expectCode(hold(db, "order-B", keys("11:00", 60)), "already-exists");
  await hold(db, "order-B", keys("11:30", 60));
});

test("expiration : un blocage expiré est libre pour les autres, même avant le nettoyage", async () => {
  const db = newDb();
  await hold(db, "order-A", keys("10:00", 60));
  await expectCode(hold(db, "order-B", keys("10:00", 60), at(59)), "already-exists");
  await hold(db, "order-B", keys("10:00", 60), at(60));
  assert.equal((await slot(db, "2026-12-05_1000"))!.orderId, "order-B");
  // A ne peut plus confirmer : sa tranche a été prise.
  await expectCode(book(db, "order-A", keys("10:00", 60), at(61)), "already-exists");
});

test("confirmation : le blocage devient réservation, sans expiration, et ne peut plus redevenir blocage", async () => {
  const db = newDb();
  await hold(db, "order-A", keys("10:00", 60));
  await book(db, "order-A", keys("10:00", 60), at(30));
  const s = await slot(db, "2026-12-05_1000");
  assert.equal(s!.state, "booked");
  assert.equal(s!.holdExpiresAt, null);
  // Une réservation ne s'expire jamais.
  assert.equal(await releaseExpiredHolds(db, at(10_000)), 0);
  assert.equal((await slot(db, "2026-12-05_1000"))!.state, "booked");
  await expectCode(hold(db, "order-A", keys("10:00", 60), at(40)), "failed-precondition");
});

test("libération : seulement les tranches de la commande, et les disponibilités suivent", async () => {
  const db = newDb();
  await book(db, "order-A", keys("10:00", 60));
  await book(db, "order-B", keys("11:00", 60));
  const released = await release(db, "order-B", [...keys("10:00", 60), ...keys("11:00", 60)]);
  assert.deepEqual(released, ["2026-12-05_1100", "2026-12-05_1130"]);
  assert.equal((await slot(db, "2026-12-05_1000"))!.orderId, "order-A");
  assert.equal(await slot(db, "2026-12-05_1100"), null);
  assert.deepEqual(Object.keys(await avail(db)).sort(), ["1000", "1030"]);
});

test("nettoyage planifié : supprime les blocages expirés, garde les actifs et les réservations", async () => {
  const db = newDb();
  await hold(db, "order-A", keys("10:00", 60), T0); // expire à +60
  await hold(db, "order-B", keys("12:00", 30), at(30)); // expire à +90
  await book(db, "order-C", keys("14:00", 30), T0);
  assert.equal(await releaseExpiredHolds(db, at(61)), 2);
  assert.equal(await slot(db, "2026-12-05_1000"), null);
  assert.equal((await slot(db, "2026-12-05_1200"))!.state, "hold");
  assert.equal((await slot(db, "2026-12-05_1400"))!.state, "booked");
  assert.deepEqual(Object.keys(await avail(db)).sort(), ["1200", "1400"]);
  // Repris entre la requête et la transaction : le nettoyage ne touche pas au nouveau blocage.
  await hold(db, "order-D", keys("12:00", 30), at(91));
  assert.equal(await releaseExpiredHolds(db, at(91)), 0);
  assert.equal((await slot(db, "2026-12-05_1200"))!.orderId, "order-D");
});

test("CONCURRENCE : 25 clients visent des créneaux qui se chevauchent au même instant → un seul gagne", async () => {
  const db = newDb();
  const attempts = Array.from({ length: 25 }, (_, i) => {
    const start = ["10:00", "10:30", "10:15", "09:30", "10:00"][i % 5];
    return hold(db, `order-${String(i).padStart(2, "0")}`, keys(start, 90)).then(
      () => ({ i, ok: true, code: undefined as string | undefined }),
      (e) => ({ i, ok: false, code: (e as { code?: string }).code }),
    );
  });
  const results = await Promise.all(attempts);
  const winners = results.filter((r) => r.ok);
  // Toutes ces plages contiennent 10:30-11:00 : un seul gagnant possible.
  assert.equal(winners.length, 1, JSON.stringify(results));
  const loserCodes = results.filter((r) => !r.ok).map((r) => r.code);
  assert.ok(loserCodes.every((c) => c === "already-exists"), JSON.stringify(loserCodes));
  // Chaque tranche occupée appartient au gagnant, et à lui seul.
  const all = await db.collection("slots").get();
  const owners = new Set(all.docs.map((d) => d.get("orderId")));
  assert.equal(owners.size, 1);
  assert.equal([...owners][0], `order-${String(winners[0].i).padStart(2, "0")}`);
  const winnerStart = ["10:00", "10:30", "10:15", "09:30", "10:00"][winners[0].i % 5];
  assert.deepEqual(all.docs.map((d) => d.id).sort(), keys(winnerStart, 90));
});

test("CONCURRENCE : 20 clients sur 20 créneaux distincts → tous acceptés", async () => {
  const db = newDb();
  const starts = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  const results = await Promise.allSettled(starts.map((s, i) => hold(db, `order-${i}`, keys(s, 30))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(Object.keys(await avail(db)).length, 20);
});

test("entrées refusées : tranche en double, identifiant de commande invalide, clé invalide", async () => {
  const db = newDb();
  await expectCode(hold(db, "order-A", ["2026-12-05_1000", "2026-12-05_1000"]), "invalid-argument");
  await expectCode(hold(db, "x", keys("10:00", 30)), "invalid-argument");
  await expectCode(hold(db, "order/../A", keys("10:00", 30)), "invalid-argument");
  await expectCode(hold(db, "order-A", ["2026-12-05 10:00"]), "invalid-argument");
  await expectCode(hold(db, "order-A", []), "invalid-argument");
});
