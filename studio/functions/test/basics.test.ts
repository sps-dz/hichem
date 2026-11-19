import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDzd, percentOfDzd, sumDzd } from "../src/lib/money";
import { normalizeDzPhone } from "../src/lib/phone";
import { algiersToUtcMs, slotKeysFor, utcMsToAlgiers } from "../src/lib/time";

test("argent : dinars entiers uniquement", () => {
  assert.equal(assertDzd(0), 0);
  assert.equal(assertDzd(26500), 26500);
  for (const bad of [-1, 1.5, NaN, Infinity, "100", null, undefined, 1e10]) {
    assert.throws(() => assertDzd(bad as never), /entier|négatif|plafond/);
  }
  assert.equal(sumDzd([10000, 2500, 1]), 12501);
});

test("argent : acompte 20 % arrondi au dinar, sans flottant", () => {
  assert.equal(percentOfDzd(10000, 20), 2000);
  assert.equal(percentOfDzd(12345, 20), 2469); // 2469,0
  assert.equal(percentOfDzd(12347, 20), 2469); // 2469,4 → 2469
  assert.equal(percentOfDzd(12348, 20), 2470); // 2469,6 → 2470
  assert.equal(percentOfDzd(5, 10), 1); // 0,5 → 1
  assert.equal(percentOfDzd(0, 20), 0);
  // Acompte + reste = total, pour tous les totaux de 0 à 100 000.
  for (let t = 0; t <= 100_000; t++) {
    const a = percentOfDzd(t, 20);
    assert.ok(Number.isInteger(a) && a >= 0 && a <= t);
    assert.equal(a + (t - a), t);
    assert.ok(Math.abs(a - t * 0.2) <= 0.5);
  }
  assert.throws(() => percentOfDzd(100, 20.5));
  assert.throws(() => percentOfDzd(100, 101));
});

test("téléphone : toutes les écritures d'un même numéro donnent la même fiche", () => {
  const forms = ["0555123456", "05 55 12 34 56", "+213555123456", "+213 555 12 34 56", "00213555123456", "213555123456", "+213 (0)555 12 34 56", "0555.12.34.56", "0555-12-34-56"];
  for (const f of forms) assert.deepEqual(normalizeDzPhone(f), { e164: "+213555123456", kind: "mobile" }, f);
  assert.deepEqual(normalizeDzPhone("0661 00 00 00"), { e164: "+213661000000", kind: "mobile" });
  assert.deepEqual(normalizeDzPhone("0770000000"), { e164: "+213770000000", kind: "mobile" });
  assert.deepEqual(normalizeDzPhone("021 23 45 67"), { e164: "+21321234567", kind: "fixed" });
  for (const bad of ["", "abc", "0855123456", "055512345", "05551234567", "+33612345678", "+213+555123456", 555123456]) {
    assert.throws(() => normalizeDzPhone(bad as never), /invalide|manquant/, String(bad));
  }
});

test("heure : Alger = UTC+1 toute l'année", () => {
  assert.equal(algiersToUtcMs("2026-12-05", "10:00"), Date.UTC(2026, 11, 5, 9, 0));
  assert.equal(algiersToUtcMs("2026-07-05", "10:00"), Date.UTC(2026, 6, 5, 9, 0)); // pas d'heure d'été
  assert.deepEqual(utcMsToAlgiers(Date.UTC(2026, 11, 5, 23, 30)), { date: "2026-12-06", hm: "0030" });
  assert.throws(() => algiersToUtcMs("2026-02-30", "10:00"), /inexistante/);
  assert.throws(() => algiersToUtcMs("2026-12-05", "24:00"), /Heure/);
});

test("tranches : une réservation occupe toutes les tranches touchées, tampon compris", () => {
  assert.deepEqual(slotKeysFor({ date: "2026-12-05", start: "10:00", durationMinutes: 60 }), ["2026-12-05_1000", "2026-12-05_1030"]);
  assert.deepEqual(slotKeysFor({ date: "2026-12-05", start: "10:15", durationMinutes: 45 }), ["2026-12-05_1000", "2026-12-05_1030"]);
  assert.deepEqual(slotKeysFor({ date: "2026-12-05", start: "10:00", durationMinutes: 60, bufferMinutes: 15 }), [
    "2026-12-05_1000",
    "2026-12-05_1030",
    "2026-12-05_1100",
  ]);
  // Passage de minuit.
  assert.deepEqual(slotKeysFor({ date: "2026-12-05", start: "23:30", durationMinutes: 60 }), ["2026-12-05_2330", "2026-12-06_0000"]);
  assert.equal(slotKeysFor({ date: "2026-12-05", start: "00:00", durationMinutes: 24 * 60 }).length, 48);
  assert.throws(() => slotKeysFor({ date: "2026-12-05", start: "10:00", durationMinutes: 0 }));
  assert.throws(() => slotKeysFor({ date: "2026-12-05", start: "10:00", durationMinutes: 30, bufferMinutes: -5 }));
  assert.throws(() => slotKeysFor({ date: "2026-12-05", start: "10:00", durationMinutes: 49 * 60 }), /trop longue/);
});
