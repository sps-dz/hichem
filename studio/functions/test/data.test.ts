import { runTx } from "../src/lib/tx";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccessToken, hashToken, revokeOrderAccess, verifyAccessToken } from "../src/lib/access";
import { writeAudit } from "../src/lib/audit";
import { reserveOrderRef } from "../src/lib/counters";
import { upsertCustomer } from "../src/lib/customers";
import { runDailyBackup } from "../src/backup";
import { at, expectCode, newDb, T0 } from "./helpers";

test("références de commande : 40 commandes simultanées → 40 numéros uniques et consécutifs", async () => {
  const db = newDb();
  const refs = await Promise.all(
    Array.from({ length: 40 }, () =>
      runTx(db, async (tx) => {
        const r = await reserveOrderRef(db, tx, 2026);
        r.commit();
        return r.ref;
      }),
    ),
  );
  assert.equal(new Set(refs).size, 40);
  const expected = Array.from({ length: 40 }, (_, i) => `STU-2026-${String(i + 1).padStart(6, "0")}`);
  assert.deepEqual([...refs].sort(), expected);
  // Nouvelle année : on repart à 1.
  const r27 = await runTx(db, async (tx) => {
    const r = await reserveOrderRef(db, tx, 2027);
    r.commit();
    return r.ref;
  });
  assert.equal(r27, "STU-2027-000001");
});

test("clients : un numéro = une seule fiche, quelle que soit l'écriture", async () => {
  const db = newDb();
  for (const [phone, name] of [
    ["0555 12 34 56", "Amine"],
    ["+213555123456", "Amine B."],
    ["00213 555 123 456", "  Amine   Benali "],
  ]) {
    await runTx(db, async (tx) => {
      const c = await upsertCustomer(db, tx, { phone, name, now: T0 });
      c.write();
    });
  }
  const all = await db.collection("customers").get();
  assert.equal(all.size, 1);
  assert.equal(all.docs[0].id, "+213555123456");
  assert.equal(all.docs[0].get("name"), "Amine Benali");
  await expectCode(
    runTx(db, (tx) => upsertCustomer(db, tx, { phone: "123", name: "X Y", now: T0 })),
    "invalid-argument",
  );
});

test("liens privés : seule l'empreinte est stockée ; expiration et révocation respectées", async () => {
  const db = newDb();
  const token = await runTx(db, async (tx) => createAccessToken(db, tx, { orderId: "order-A", phone: "+213555123456", now: T0, days: 30 }));
  assert.equal(token.length, 43);
  const stored = await db.collection("customerAccess").get();
  assert.equal(stored.size, 1);
  assert.equal(stored.docs[0].id, hashToken(token));
  assert.equal(JSON.stringify(stored.docs[0].data()).includes(token), false);

  assert.deepEqual(await verifyAccessToken(db, token, at(60)), { orderId: "order-A", phone: "+213555123456" });
  await expectCode(verifyAccessToken(db, token, at(30 * 24 * 60)), "permission-denied"); // expiré
  await expectCode(verifyAccessToken(db, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), at(1)), "permission-denied");
  for (const bad of ["", "abc", null, 42, "../../x", "a".repeat(43) + "/"]) await expectCode(verifyAccessToken(db, bad, at(1)), "permission-denied");

  assert.equal(await revokeOrderAccess(db, "order-A", at(2)), 1);
  await expectCode(verifyAccessToken(db, token, at(3)), "permission-denied");
  // Deux liens créés pour la même commande sont différents.
  const t2 = await runTx(db, async (tx) => createAccessToken(db, tx, { orderId: "order-A", phone: "+213555123456", now: T0 }));
  const t3 = await runTx(db, async (tx) => createAccessToken(db, tx, { orderId: "order-A", phone: "+213555123456", now: T0 }));
  assert.notEqual(t2, t3);
});

test("journal d'audit : écrit dans la transaction, annulé si la transaction échoue", async () => {
  const db = newDb();
  await runTx(db, async (tx) => {
    tx.set(db.doc("payments/p1"), { amount: 5000 });
    writeAudit(db, tx, { actor: { kind: "system", job: "test" }, action: "payment.verify", entity: "payments", entityId: "p1", before: undefined, after: { amount: 5000 } });
  });
  await assert.rejects(
    runTx(db, async (tx) => {
      tx.set(db.doc("payments/p2"), { amount: 1 });
      writeAudit(db, tx, { actor: { kind: "system", job: "test" }, action: "payment.verify", entity: "payments", entityId: "p2" });
      throw new Error("échec volontaire");
    }),
  );
  const logs = await db.collection("auditLogs").get();
  assert.equal(logs.size, 1);
  const l = logs.docs[0].data();
  assert.equal(l.entityId, "p1");
  assert.equal(l.before, null);
  assert.deepEqual(l.after, { amount: 5000 });
  assert.ok(l.at, "horodatage serveur");
  assert.equal((await db.doc("payments/p2").get()).exists, false);
});

test("sauvegarde : export vers gs://bucket/firestore/JOUR et trace dans systemJobs", async () => {
  const db = newDb();
  const calls: unknown[] = [];
  const res = await runDailyBackup(
    db,
    { exportDocuments: async (r) => (calls.push(r), { operationName: "op-1" }) },
    { projectId: "studio-test", bucket: "studio-test-backups", now: T0 },
  );
  assert.equal(res.outputUriPrefix, "gs://studio-test-backups/firestore/2026-12-05");
  assert.deepEqual(calls, [{ name: "projects/studio-test/databases/(default)", outputUriPrefix: res.outputUriPrefix, collectionIds: [] }]);
  assert.equal((await db.doc("systemJobs/backup-2026-12-05").get()).get("status"), "started");

  await assert.rejects(
    runDailyBackup(db, { exportDocuments: async () => { throw new Error("quota"); } }, { projectId: "p", bucket: "studio-test-backups", now: at(1440) }),
  );
  assert.equal((await db.doc("systemJobs/backup-2026-12-06").get()).get("status"), "failed");
  await assert.rejects(runDailyBackup(db, { exportDocuments: async () => ({ operationName: "x" }) }, { projectId: "p", bucket: "../evil", now: T0 }));
});
