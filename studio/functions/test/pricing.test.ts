import { test } from "node:test";
import assert from "node:assert/strict";
import { Catalog, DEFAULT_CATALOG, assertCatalog } from "../src/pricing/catalog";
import { divRound, priceCart } from "../src/pricing/engine";
import { percentOfDzd } from "../src/lib/money";
import { publishCatalog, quote, seedDefaultCatalog } from "../src/catalogAdmin";
import { Deps, bootstrapAdmin } from "../src/staff";
import { Caller } from "../src/lib/roles";
import { FakeAuth, T0, expectCode, newDb } from "./helpers";

const NOW = T0.toMillis(); // samedi 05/12/2026 10:00 à Alger
// Les tests de mécanique utilisent un studio simple : sam→jeu 9 h–19 h, fermé le vendredi, découpé en
// tranches d'une heure à 4 000 DA le forfait, pour que les montants restent faciles à vérifier ; les vrais
// tarifs ont leurs propres tests (studio-rates.test.ts).
const OPEN9 = { open: "09:00", close: "19:00" };
const SIMPLE_STUDIO: Catalog["studio"] = {
  enabled: true,
  openingHours: { "0": OPEN9, "1": OPEN9, "2": OPEN9, "3": OPEN9, "4": OPEN9, "5": null, "6": OPEN9 },
  periods: Array.from({ length: 10 }, (_, i) => ({
    days: [0, 1, 2, 3, 4, 6],
    from: `${String(9 + i).padStart(2, "0")}:00`,
    to: `${String(10 + i).padStart(2, "0")}:00`,
    price: 4000,
  })),
  minMinutes: 60,
  stepMinutes: 30,
  bufferMinutes: 0,
  specialDates: [],
  addons: [],
  minPrice: 4000,
};
const clone = (): Catalog => JSON.parse(JSON.stringify({ ...DEFAULT_CATALOG, studio: SIMPLE_STUDIO }));
const real = (): Catalog => JSON.parse(JSON.stringify(DEFAULT_CATALOG));
const studio = (date: string, start: string, durationMinutes: number) => ({ service: "studio", date, start, durationMinutes });
const price = (cat: Catalog, cart: unknown[]) => priceCart(cat, cart, NOW);
const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message));

test("catalogue provisoire : valide, et identique après vérification", () => {
  assert.deepEqual(assertCatalog(real()), DEFAULT_CATALOG);
  assert.deepEqual(assertCatalog(clone()), clone());
});

test("catalogue : refuse les erreurs de saisie avant publication", () => {
  const bad: [string, (c: Catalog) => void, RegExp][] = [
    ["prix décimal", (c) => (c.studio.periods[0].price = 4000.5), /entier/],
    ["prix négatif", (c) => (c.product.packages[0].price = -1), /négatif/],
    ["fermeture avant ouverture", (c) => (c.studio.openingHours["1"] = { open: "19:00", close: "09:00" }), /fermeture/],
    ["périodes qui se chevauchent", (c) => c.studio.periods.push({ days: [6], from: "18:00", to: "21:00", price: 5000 }), /chevauchent/],
    ["pack en double", (c) => c.product.packages.push({ ...c.product.packages[0] }), /double/],
    ["remise groupée d'un seul service", (c) => c.bundles.push({ id: "b", name: "B", requires: ["studio"], percent: 10, active: true }), /deux services/],
    ["promotion à 95 %", (c) => c.promotions.push({ id: "x", name: "X", kind: "percent", value: 95, services: [], validFrom: null, validTo: null, minSubtotal: 0, active: true }), /invalide/],
    ["devise étrangère", (c) => ((c as unknown as { currency: string }).currency = "EUR"), /Devise/],
    ["acompte 120 %", (c) => (c.depositPercent = 120), /depositPercent/],
    ["date spéciale en double", (c) => (c.studio.specialDates = [{ date: "2026-12-31", kind: "closed" }, { date: "2026-12-31", kind: "closed" }]), /double/],
    ["pas de tranche de 7 min", (c) => (c.studio.stepMinutes = 7), /diviser/],
  ];
  for (const [name, mutate, re] of bad) {
    const c = clone();
    mutate(c);
    throwsMsg(() => assertCatalog(c), re);
    void name;
  }
});

test("arrondi : au dinar le plus proche, 0,5 vers le haut, sans flottant", () => {
  assert.equal(divRound(30 * 3333, 60), 1667); // 1666,5
  assert.equal(divRound(30 * 3331, 60), 1666); // 1665,5 → 1666
  assert.equal(divRound(10, 3), 3);
  assert.equal(divRound(0, 7), 0);
  assert.throws(() => divRound(-1, 2));
});

test("location studio : forfait de chaque tranche touchée, tranches à bloquer, limites horaires", () => {
  const c = clone();
  const r = price(c, [studio("2026-12-12", "14:00", 120)]);
  assert.equal(r.lines[0].price, 8000);
  assert.deepEqual(r.lines[0].slotKeys, ["2026-12-12_1400", "2026-12-12_1430", "2026-12-12_1500", "2026-12-12_1530"]);
  assert.deepEqual(r.lines[0].booking, { date: "2026-12-12", start: "14:00", end: "16:00", durationMinutes: 120 });
  // 17h30–19h touche les tranches 17h–18h et 18h–19h : deux forfaits entiers.
  assert.equal(price(c, [studio("2026-12-12", "17:30", 90)]).lines[0].price, 8000); // finit pile à 19:00
  assert.equal(price(c, [studio("2026-12-06", "09:00", 600)]).lines[0].price, 40000); // journée complète

  throwsMsg(() => price(c, [studio("2026-12-11", "10:00", 60)]), /fermé/); // vendredi
  throwsMsg(() => price(c, [studio("2026-12-12", "18:30", 60)]), /Horaires/); // déborde après 19:00
  throwsMsg(() => price(c, [studio("2026-12-12", "08:30", 60)]), /Horaires/);
  throwsMsg(() => price(c, [studio("2026-12-12", "10:00", 30)]), /minimale/);
  throwsMsg(() => price(c, [studio("2026-12-12", "10:00", 75)]), /multiple/);
  throwsMsg(() => price(c, [studio("2026-12-12", "10:15", 60)]), /tranche/);
  throwsMsg(() => price(c, [studio("2026-12-05", "09:00", 60)]), /passé/);
  throwsMsg(() => price(c, [studio("2026-02-30", "10:00", 60)]), /inexistante/);
  throwsMsg(() => price(c, [studio("2026-12-12", "25:00", 60)]), /Heure/);
});

test("location studio : forfait par tranche, une tranche entamée est due en entier", () => {
  const c = clone();
  c.studio.periods = [
    { days: [0, 1, 2, 3, 4, 6], from: "09:00", to: "13:00", price: 3000 },
    { days: [0, 1, 2, 3, 4, 6], from: "13:00", to: "19:00", price: 5000 },
  ];
  c.studio.minPrice = 0;
  assertCatalog(c);
  const r = price(c, [studio("2026-12-12", "12:00", 120)]);
  assert.equal(r.lines[0].price, 3000 + 5000);
  assert.deepEqual(r.lines[0].details, [
    { label: "Tranche 09:00–13:00 · forfait 3 000 DA", amount: 3000 },
    { label: "Tranche 13:00–19:00 · forfait 5 000 DA", amount: 5000 },
  ]);
  // 30 min de chaque côté : les deux forfaits entiers.
  assert.equal(price(c, [studio("2026-12-12", "12:30", 60)]).lines[0].price, 3000 + 5000);
  // Dans une seule tranche, la durée ne change pas le prix.
  assert.equal(price(c, [studio("2026-12-12", "09:00", 60)]).lines[0].price, 3000);
  assert.equal(price(c, [studio("2026-12-12", "09:00", 240)]).lines[0].price, 3000);
  assert.equal(price(c, [studio("2026-12-12", "13:00", 360)]).lines[0].price, 5000);
  // Journée entière : la somme des forfaits.
  assert.equal(price(c, [studio("2026-12-12", "09:00", 600)]).lines[0].price, 8000);
  // Trou dans les tarifs : refusé plutôt que facturé faux.
  c.studio.periods = [{ days: [0, 1, 2, 3, 4, 6], from: "09:00", to: "12:00", price: 3000 }];
  throwsMsg(() => price(c, [studio("2026-12-12", "11:00", 120)]), /pas de tarif/);
});

test("location studio : dates spéciales (fermeture, majoration, tarif du jour) et prix minimum", () => {
  const c = clone();
  c.studio.specialDates = [
    { date: "2026-12-12", kind: "adjust", percent: 20, label: "Veille de fête" },
    { date: "2026-12-13", kind: "override", price: 6000 },
    { date: "2026-12-14", kind: "closed" },
    { date: "2026-12-15", kind: "adjust", percent: -25 },
  ];
  assertCatalog(c);
  assert.equal(price(c, [studio("2026-12-12", "14:00", 120)]).lines[0].price, 9600);
  assert.equal(price(c, [studio("2026-12-13", "14:00", 120)]).lines[0].price, 12000);
  throwsMsg(() => price(c, [studio("2026-12-14", "14:00", 120)]), /fermé/);
  assert.equal(price(c, [studio("2026-12-15", "14:00", 90)]).lines[0].price, 6000); // 2 tranches × 3 000
  // Avec un prix minimum de 5 000 DA, une tranche à −25 % (3 000) remonte à 5 000.
  c.studio.minPrice = 5000;
  const r = price(c, [studio("2026-12-15", "14:00", 60)]);
  assert.equal(r.lines[0].price, 5000);
  assert.equal(r.lines[0].minPriceApplied, true);
});

test("tampon : les tranches bloquées incluent le temps entre deux réservations", () => {
  const c = clone();
  c.studio.bufferMinutes = 30;
  const r = price(c, [studio("2026-12-12", "14:00", 60)]);
  assert.deepEqual(r.lines[0].slotKeys, ["2026-12-12_1400", "2026-12-12_1430", "2026-12-12_1500"]);
  assert.equal(r.lines[0].price, 4000); // le tampon n'est pas facturé
});

test("shooting produit : prix du pack + photos supplémentaires", () => {
  const c = clone();
  assert.equal(price(c, [{ service: "product", packageId: "p10" }]).lines[0].price, 22000);
  assert.equal(price(c, [{ service: "product", packageId: "p10", extraPhotos: 5 }]).lines[0].price, 27000);
  throwsMsg(() => price(c, [{ service: "product", packageId: "p99" }]), /Pack inconnu/);
  throwsMsg(() => price(c, [{ service: "product", packageId: "p5", extraPhotos: -1 }]), /invalide/);
  throwsMsg(() => price(c, [{ service: "product", packageId: "p5", addons: ["x"] }]), /Option/);
  c.product.addons = [{ id: "fond", name: "Fond coloré", price: 2000 }];
  assert.equal(price(c, [{ service: "product", packageId: "p5", addons: ["fond"] }]).lines[0].price, 14000);
  throwsMsg(() => price(c, [{ service: "product", packageId: "p5", addons: ["fond", "fond"] }]), /double|Options/);
});

test("shooting vidéo : prix par vidéo et remise de volume par palier", () => {
  const c = clone();
  const v = (reels: number) => price(c, [{ service: "video", reels, format: "9:16" }]).lines[0].price;
  assert.equal(v(1), 8000);
  assert.equal(v(2), 16000);
  assert.equal(v(3), 21600); // 24 000 − 10 %
  assert.equal(v(4), 28800);
  assert.equal(v(5), 34000); // 40 000 − 15 %
  assert.equal(v(10), 68000);
  throwsMsg(() => price(c, [{ service: "video", reels: 0, format: "9:16" }]), /entre 1/);
  throwsMsg(() => price(c, [{ service: "video", reels: 31, format: "9:16" }]), /entre 1/);
  throwsMsg(() => price(c, [{ service: "video", reels: 2, format: "4:3" }]), /Format/);
  throwsMsg(() => price(c, [{ service: "video", reels: 1.5, format: "9:16" }]), /entre 1/);
});

test("montage : tranche de durée + sous-titres + révisions en plus", () => {
  const c = clone();
  const r = price(c, [{ service: "editing", videos: [{ seconds: 30 }, { seconds: 120, subtitles: true }, { seconds: 600, extraRevisions: 2 }] }]);
  assert.equal(r.lines[0].price, 3500 + (6000 + 1500) + (12000 + 2000));
  assert.equal(price(c, [{ service: "editing", videos: [{ seconds: 60 }] }]).lines[0].price, 3500); // limite incluse
  assert.equal(price(c, [{ service: "editing", videos: [{ seconds: 61 }] }]).lines[0].price, 6000);
  throwsMsg(() => price(c, [{ service: "editing", videos: [{ seconds: 601 }] }]), /devis/);
  throwsMsg(() => price(c, [{ service: "editing", videos: [] }]), /entre 1/);
  throwsMsg(() => price(c, [{ service: "editing", videos: [{ seconds: 30, subtitles: "oui" }] }]), /sous-titres/);
});

test("production publicitaire : sur devis, ni total ni acompte tant que le prix n'est pas fixé", () => {
  const c = clone();
  const r = price(c, [studio("2026-12-12", "14:00", 120), { service: "ad", brief: "Pub de 30 s pour une marque de parfum" }]);
  assert.equal(r.status, "quote-pending");
  assert.equal(r.lines[1].price, null);
  assert.equal(r.subtotal, 8000);
  assert.equal(r.total, null);
  assert.equal(r.deposit, null);
  assert.equal(r.discount, null);
});

test("panier : total, acompte 20 % et reste ; refus des paniers invalides", () => {
  const c = clone();
  const r = price(c, [studio("2026-12-12", "14:00", 120), { service: "product", packageId: "p10" }]);
  assert.equal(r.status, "priced");
  assert.equal(r.subtotal, 30000);
  assert.equal(r.discount, null); // aucune remise dans le catalogue provisoire
  assert.equal(r.total, 30000);
  assert.equal(r.deposit, 6000);
  assert.equal(r.remaining, 24000);
  assert.equal(r.catalogVersion, DEFAULT_CATALOG.version);
  assert.equal(r.provisional, true);

  throwsMsg(() => price(c, []), /vide/);
  throwsMsg(() => price(c, Array.from({ length: 21 }, () => ({ service: "product", packageId: "p5" }))), /Au plus/);
  throwsMsg(() => price(c, [{ service: "drone" }]), /inconnu/);
  throwsMsg(() => price(c, [studio("2026-12-12", "14:00", 120), studio("2026-12-12", "15:00", 60)]), /chevauchent/);
  throwsMsg(() => priceCart(c, "pas un panier", NOW), /vide/);
  c.video.enabled = false;
  throwsMsg(() => price(c, [{ service: "video", reels: 1, format: "9:16" }]), /pas disponible/);
  // Le prix envoyé par le navigateur est ignoré.
  const forged = price(clone(), [{ service: "product", packageId: "p10", price: 1 } as unknown as Record<string, unknown>]);
  assert.equal(forged.lines[0].price, 22000);
});

test("remises : la plus avantageuse s'applique, une seule, jamais sous le prix minimum", () => {
  const c = clone();
  c.bundles = [{ id: "studio-produit", name: "Studio + shooting produit", requires: ["studio", "product"], percent: 10, active: true }];
  c.promotions = [
    { id: "hiver", name: "Promo hiver", kind: "amount", value: 2000, services: [], validFrom: "2026-12-01", validTo: "2026-12-31", minSubtotal: 10000, active: true },
    { id: "video20", name: "Vidéo −20 %", kind: "percent", value: 20, services: ["video"], validFrom: null, validTo: null, minSubtotal: 0, active: true },
  ];
  assertCatalog(c);
  const cart = [studio("2026-12-12", "14:00", 120), { service: "product", packageId: "p10" }];
  // Groupe : 10 % de 30 000 = 3 000 > promo hiver 2 000 → groupe seul.
  let r = price(c, cart);
  assert.deepEqual(r.discount, { id: "studio-produit", name: "Studio + shooting produit", source: "bundle", amount: 3000 });
  assert.equal(r.total, 27000);
  assert.equal(r.deposit, 5400);
  // Sans le groupe : promo hiver 2 000.
  c.bundles[0].active = false;
  r = price(c, cart);
  assert.equal(r.discount!.id, "hiver");
  assert.equal(r.total, 28000);
  // Hors période : pas de remise.
  r = priceCart(c, [{ service: "product", packageId: "p10" }], Date.UTC(2027, 0, 10, 9));
  assert.equal(r.discount, null);
  // Sous le minimum de commande : pas de remise.
  assert.equal(price(c, [{ service: "editing", videos: [{ seconds: 30 }] }]).discount, null);
  // Promo ciblée vidéo : 20 % des vidéos seulement.
  r = price(c, [{ service: "video", reels: 2, format: "9:16" }, { service: "editing", videos: [{ seconds: 30 }] }]);
  assert.equal(r.discount!.id, "video20");
  assert.equal(r.discount!.amount, 3200);
  // Prix minimum : une vidéo à 8 000 avec minimum 7 000 → au plus 1 000 de remise.
  c.video.minPrice = 7000;
  r = price(c, [{ service: "video", reels: 1, format: "9:16" }]);
  assert.equal(r.discount!.amount, 1000);
  assert.equal(r.total, 7000);
  // À égalité, la première du catalogue gagne.
  c.promotions = [
    { id: "a", name: "A", kind: "amount", value: 1000, services: [], validFrom: null, validTo: null, minSubtotal: 0, active: true },
    { id: "b", name: "B", kind: "amount", value: 1000, services: [], validFrom: null, validTo: null, minSubtotal: 0, active: true },
  ];
  c.video.minPrice = 0;
  assert.equal(price(c, [{ service: "video", reels: 1, format: "9:16" }]).discount!.id, "a");
});

test("propriété : sur 3 000 paniers au hasard, les montants sont toujours entiers et cohérents", () => {
  const c = clone();
  c.bundles = [{ id: "g", name: "Groupe", requires: ["video", "editing"], percent: 15, active: true }];
  c.promotions = [{ id: "p", name: "P", kind: "percent", value: 7, services: ["product"], validFrom: null, validTo: null, minSubtotal: 0, active: true }];
  let seed = 42;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  for (let i = 0; i < 3000; i++) {
    const cart: unknown[] = [];
    const n = 1 + rnd(4);
    for (let j = 0; j < n; j++) {
      const k = rnd(4);
      if (k === 0) cart.push({ service: "product", packageId: ["p5", "p10", "p20"][rnd(3)], extraPhotos: rnd(20) });
      if (k === 1) cart.push({ service: "video", reels: 1 + rnd(12), format: "9:16" });
      if (k === 2) cart.push({ service: "editing", videos: Array.from({ length: 1 + rnd(3) }, () => ({ seconds: 1 + rnd(600), subtitles: rnd(2) === 1, extraRevisions: rnd(3) })) });
      if (k === 3 && !cart.some((x) => (x as { service: string }).service === "studio")) cart.push(studio("2026-12-12", `${String(9 + rnd(8)).padStart(2, "0")}:${rnd(2) ? "30" : "00"}`, 60 + 30 * rnd(3)));
    }
    const r = price(c, cart);
    const ints = [r.subtotal, r.total, r.deposit, r.remaining, r.discount?.amount ?? 0, ...r.lines.map((l) => l.price as number)];
    assert.ok(ints.every((x) => Number.isSafeInteger(x) && (x as number) >= 0), JSON.stringify(ints));
    assert.equal(r.subtotal, r.lines.reduce((s, l) => s + (l.price as number), 0));
    assert.equal(r.total, r.subtotal - (r.discount?.amount ?? 0));
    assert.equal(r.deposit, percentOfDzd(r.total!, 20));
    assert.equal(r.deposit! + r.remaining!, r.total);
    for (const l of r.lines) assert.equal(l.price, l.details.reduce((s, d) => s + d.amount, 0), l.label);
  }
});

test("publication du catalogue : réservée à l'admin, versionnée, journalisée ; calcul public", async () => {
  const db = newDb();
  const deps: Deps = { db, auth: new FakeAuth(), now: () => T0, adminEmails: () => ["hichem@example.com"] };
  const boss: Caller = { uid: "boss", email: "hichem@example.com", emailVerified: true, role: null };
  await expectCode(quote(db, { cart: [{ service: "product", packageId: "p5" }] }, T0), "failed-precondition");
  await expectCode(seedDefaultCatalog(deps, boss), "permission-denied");
  await bootstrapAdmin(deps, boss);
  const admin: Caller = { ...boss, role: "admin" };
  assert.deepEqual(await seedDefaultCatalog(deps, admin), { version: DEFAULT_CATALOG.version });
  await expectCode(seedDefaultCatalog(deps, admin), "already-exists");

  const q = await quote(db, { cart: [studio("2026-12-12", "14:00", 120)] }, T0);
  assert.equal(q.total, 3000); // samedi 14h–16h : dans la tranche 12h–17h, forfait 3 000 DA
  assert.equal(q.deposit, 600);

  const next = clone();
  next.version = "2026-12-v2";
  for (const per of next.studio.periods) per.price = 4500;
  next.provisional = false;
  await expectCode(publishCatalog(deps, { ...admin, role: "employee" }, { catalog: next }), "permission-denied");
  await expectCode(publishCatalog(deps, admin, { catalog: { ...next, depositPercent: 150 } }), "invalid-argument");
  await publishCatalog(deps, admin, { catalog: next });
  await expectCode(publishCatalog(deps, admin, { catalog: next }), "already-exists"); // même version
  assert.equal((await quote(db, { cart: [studio("2026-12-12", "14:00", 120)] }, T0)).total, 9000);
  assert.equal((await db.collection("catalogVersions").get()).size, 2);
  const logs = (await db.collection("auditLogs").where("action", "==", "catalog.publish").get()).docs.map((d) => d.get("after").version).sort();
  assert.deepEqual(logs, [DEFAULT_CATALOG.version, "2026-12-v2"].sort());
});
