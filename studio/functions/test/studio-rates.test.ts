import { test } from "node:test";
import assert from "node:assert/strict";
import { Catalog, DEFAULT_CATALOG, assertCatalog } from "../src/pricing/catalog";
import { priceCart } from "../src/pricing/engine";
import { StudioGrid, gridFromStudio, studioFromGrid } from "../src/pricing/studioGrid";
import { quote, seedDefaultCatalog, updateStudioRates } from "../src/catalogAdmin";
import { Deps, bootstrapAdmin } from "../src/staff";
import { Caller } from "../src/lib/roles";
import { FakeAuth, T0, expectCode, newDb } from "./helpers";

const NOW = T0.toMillis(); // samedi 05/12/2026 10:00 à Alger
const cat = (): Catalog => JSON.parse(JSON.stringify(DEFAULT_CATALOG));
// Semaine du 06/12/2026 : dimanche 6 … samedi 12.
const DAY = { dim: "2026-12-06", lun: "2026-12-07", mar: "2026-12-08", mer: "2026-12-09", jeu: "2026-12-10", ven: "2026-12-11", sam: "2026-12-12" };
const studioLine = (date: string, start: string, durationMinutes: number, addons?: string[]) => ({ service: "studio", date, start, durationMinutes, ...(addons ? { addons } : {}) });
const p = (c: Catalog, line: Record<string, unknown>) => priceCart(c, [line], NOW).lines[0];

// Le tableau envoyé par l'admin le 25/11/2026 : forfait de chaque tranche, selon le jour.
const TABLE: Record<string, [number, number, number]> = {
  dim: [1500, 2000, 2500],
  lun: [1500, 2000, 2500],
  mar: [1500, 2000, 2500],
  mer: [1500, 2000, 2500],
  jeu: [2000, 2000, 3000],
  ven: [2500, 3000, 3500],
  sam: [2500, 3000, 3500],
};

test("tarifs du 25/11 : chaque jour et chaque tranche, 1 h = le forfait de la tranche", () => {
  const c = cat();
  for (const [day, [morning, afternoon, evening]] of Object.entries(TABLE)) {
    const date = DAY[day as keyof typeof DAY];
    assert.equal(p(c, studioLine(date, "08:00", 60)).price, morning, `${day} 08h`);
    assert.equal(p(c, studioLine(date, "11:00", 60)).price, morning, `${day} 11h`);
    assert.equal(p(c, studioLine(date, "12:00", 60)).price, afternoon, `${day} 12h`);
    assert.equal(p(c, studioLine(date, "16:00", 60)).price, afternoon, `${day} 16h`);
    assert.equal(p(c, studioLine(date, "17:00", 60)).price, evening, `${day} 17h`);
    assert.equal(p(c, studioLine(date, "21:00", 60)).price, evening, `${day} 21h`);
  }
});

test("tarifs du 25/11 : forfait par tranche, chaque tranche touchée est due en entier", () => {
  const c = cat();
  // Dans une seule tranche, la durée ne change pas le prix.
  assert.equal(p(c, studioLine(DAY.dim, "08:00", 240)).price, 1500); // toute la matinée
  assert.equal(p(c, studioLine(DAY.dim, "12:00", 300)).price, 2000); // tout l'après-midi
  assert.equal(p(c, studioLine(DAY.dim, "13:30", 90)).price, 2000);
  // Dimanche 10h–14h : forfait matin + forfait après-midi.
  let l = p(c, studioLine(DAY.dim, "10:00", 240));
  assert.equal(l.price, 1500 + 2000);
  assert.deepEqual(l.details, [
    { label: "Tranche 08:00–12:00 · forfait 1 500 DA", amount: 1500 },
    { label: "Tranche 12:00–17:00 · forfait 2 000 DA", amount: 2000 },
  ]);
  // Lundi 16h–18h : 2 000 + 2 500.
  assert.equal(p(c, studioLine(DAY.lun, "16:00", 120)).price, 4500);
  // Jeudi 11h30–12h30 : 30 min de chaque côté = deux forfaits entiers.
  assert.equal(p(c, studioLine(DAY.jeu, "11:30", 60)).price, 2000 + 2000);
  // Vendredi 20h–22h : forfait du soir (finit pile à la fermeture).
  assert.equal(p(c, studioLine(DAY.ven, "20:00", 120)).price, 3500);
  // Samedi 11h30–17h30 : les trois tranches.
  l = p(c, studioLine(DAY.sam, "11:30", 360));
  assert.equal(l.price, 2500 + 3000 + 3500);
  // Journée complète du mercredi 8h–22h : 1 500 + 2 000 + 2 500.
  assert.equal(p(c, studioLine(DAY.mer, "08:00", 840)).price, 6000);
});

test("tarifs du 25/11 : ouvert tous les jours de 8 h à 22 h, refus en dehors", () => {
  const c = cat();
  assert.throws(() => p(c, studioLine(DAY.ven, "07:30", 60)), /Horaires/);
  assert.throws(() => p(c, studioLine(DAY.sam, "21:30", 60)), /Horaires/);
  assert.throws(() => p(c, studioLine(DAY.dim, "10:00", 30)), /minimale/);
  assert.equal(p(c, studioLine(DAY.ven, "08:00", 60)).price, 2500); // le vendredi est ouvert
});

test("option iPhone 15 Pro Max : +800 DA une seule fois par réservation, quelle que soit la durée", () => {
  const c = cat();
  assert.equal(p(c, studioLine(DAY.dim, "10:00", 60, ["iphone15pm"])).price, 1500 + 800);
  const l = p(c, studioLine(DAY.sam, "12:00", 300, ["iphone15pm"]));
  assert.equal(l.price, 3000 + 800);
  assert.deepEqual(l.details.at(-1), { label: "Utilisation iPhone 15 Pro Max", amount: 800 });
  assert.throws(() => p(c, studioLine(DAY.dim, "10:00", 60, ["iphone15pm", "iphone15pm"])), /double|Options/);
  assert.throws(() => p(c, studioLine(DAY.dim, "10:00", 60, ["drone"])), /Option/);
  // Panier complet : studio + option + pack produit, acompte 20 %.
  const r = priceCart(c, [studioLine(DAY.sam, "14:00", 120, ["iphone15pm"]), { service: "product", packageId: "p10" }], NOW);
  assert.equal(r.total, 3000 + 800 + 22000);
  assert.equal(r.deposit, 5160);
  assert.equal(r.remaining, 20640);
});

test("grille d'administration : le tableau du 25/11 redonne exactement le catalogue, et l'inverse", () => {
  const g = gridFromStudio(DEFAULT_CATALOG.studio);
  assert.deepEqual(g.bands, [
    { from: "08:00", to: "12:00" },
    { from: "12:00", to: "17:00" },
    { from: "17:00", to: "22:00" },
  ]);
  assert.deepEqual(g.rates, [TABLE.dim, TABLE.lun, TABLE.mar, TABLE.mer, TABLE.jeu, TABLE.ven, TABLE.sam]);
  const back = studioFromGrid(g, DEFAULT_CATALOG.studio);
  assert.deepEqual(back.openingHours, DEFAULT_CATALOG.studio.openingHours);
  assert.deepEqual(gridFromStudio(back), g);
  // Mêmes prix sur toute la semaine, heure par heure et à cheval sur deux tranches.
  const c2 = { ...cat(), studio: back };
  for (const date of Object.values(DAY)) {
    for (let h = 8; h < 22; h++) {
      const start = `${String(h).padStart(2, "0")}:00`;
      assert.equal(p(c2, studioLine(date, start, 60)).price, p(cat(), studioLine(date, start, 60)).price, `${date} ${start}`);
      if (h < 21) assert.equal(p(c2, studioLine(date, start, 120)).price, p(cat(), studioLine(date, start, 120)).price, `${date} ${start} 2 h`);
    }
  }
});

test("grille d'administration : jour fermé, nouvelle tranche, options, et refus des grilles incohérentes", () => {
  const base = DEFAULT_CATALOG.studio;
  const g: StudioGrid = JSON.parse(JSON.stringify(gridFromStudio(base)));
  g.rates[5] = [null, null, null]; // vendredi fermé
  g.rates[0] = [null, 2000, 2500]; // dimanche ouvre à 12h
  g.addons.push({ name: "Fond coloré", price: 1000 });
  const s = studioFromGrid(g, base);
  assert.equal(s.openingHours["5"], null);
  assert.deepEqual(s.openingHours["0"], { open: "12:00", close: "22:00" });
  assert.deepEqual(s.addons.map((a) => a.id), ["iphone15pm", "mannequin", "voixoff", "montage", "fond-colore"]);
  const c = { ...cat(), studio: s };
  assertCatalog(c);
  assert.throws(() => p(c, studioLine(DAY.ven, "10:00", 60)), /fermé/);
  assert.throws(() => p(c, studioLine(DAY.dim, "10:00", 60)), /Horaires/);
  assert.equal(p(c, studioLine(DAY.dim, "12:00", 60, ["fond-colore"])).price, 3000);

  const bad = (mutate: (x: StudioGrid) => void, re: RegExp) => {
    const x: StudioGrid = JSON.parse(JSON.stringify(gridFromStudio(base)));
    mutate(x);
    assert.throws(() => studioFromGrid(x, base), re);
  };
  bad((x) => (x.rates[1][1] = null), /case vide entre/);
  bad((x) => (x.rates[2][0] = 1500.5), /entier/);
  bad((x) => (x.rates[2][0] = -100), /négatif/);
  bad((x) => (x.bands[1] = { from: "11:00", to: "17:00" }), /chevauchent/);
  bad((x) => (x.bands[2] = { from: "18:00", to: "22:00" }), /trou/);
  bad((x) => (x.bands[0] = { from: "12:00", to: "08:00" }), /fin doit être après/);
  bad((x) => x.rates.pop(), /7 jours/);
  bad((x) => { x.minMinutes = 45; x.stepMinutes = 30; }, /multiple du pas/);
  bad((x) => (x.rates[0] = [1500, 2000]), /une case par tranche/);
  bad((x) => (x.addons = [{ name: "", price: 800 }]), /nom manquant/);
  bad((x) => (x.addons = [{ name: "iPhone", price: 800.5 }]), /entier/);
  bad((x) => (x.rates = x.rates.map(() => [null, null, null])), /Au moins une case/);
});

test("publication depuis la page d'administration : nouvelle grille en vigueur, autres services intacts, journalisé", async () => {
  const db = newDb();
  const deps: Deps = { db, auth: new FakeAuth(), now: () => T0, adminEmails: () => ["hichem@example.com"] };
  const boss: Caller = { uid: "boss", email: "hichem@example.com", emailVerified: true, role: null };
  await bootstrapAdmin(deps, boss);
  const admin: Caller = { ...boss, role: "admin" };
  await seedDefaultCatalog(deps, admin);

  const g = gridFromStudio(DEFAULT_CATALOG.studio);
  g.rates[6] = [3000, 3500, 4000]; // samedi plus cher
  g.addons[0].price = 1000;
  await expectCode(updateStudioRates(deps, { ...admin, role: "accountant" }, { grid: g, provisional: true }), "permission-denied");
  await expectCode(updateStudioRates(deps, admin, { grid: g }), "invalid-argument");
  await expectCode(updateStudioRates(deps, admin, { grid: { ...g, rates: [] }, provisional: true }), "invalid-argument");
  const { version } = await updateStudioRates(deps, admin, { grid: g, provisional: true });
  assert.match(version, /^studio-2026-12-05-1000-/);

  const q = await quote(db, { cart: [studioLine(DAY.sam, "14:00", 120, ["iphone15pm"]), { service: "product", packageId: "p10" }] }, T0);
  assert.equal(q.lines[0].price, 3500 + 1000); // samedi 14h–16h : nouveau forfait 12h–17h
  assert.equal(q.lines[1].price, 22000); // shooting produit inchangé
  assert.equal(q.catalogVersion, version);
  assert.equal(q.provisional, true);
  const audit = (await db.collection("auditLogs").where("action", "==", "catalog.publish").get()).docs.map((d) => d.get("after").version);
  assert.ok(audit.includes(version));
  assert.equal((await db.collection("catalogVersions").get()).size, 2);
});

test("options à cocher : mannequin à l'heure, voix off et montage au forfait, prix détaillé ligne par ligne", () => {
  const c = cat();
  // Lundi 16h–18h (2 000 + 2 500) + mannequin 2 h × 1 000 + voix off 2 000 + montage 3 500 + iPhone 800.
  const l = p(c, studioLine(DAY.lun, "16:00", 120, ["mannequin", "voixoff", "montage", "iphone15pm"]));
  assert.equal(l.price, 4500 + 2000 + 2000 + 3500 + 800);
  assert.deepEqual(l.details.map((d) => d.amount), [2000, 2500, 2000, 2000, 3500, 800]);
  assert.equal(l.details[2].label, "Mannequin · 2 h × 1 000 DA/h");
  // Sans option : seulement le forfait ; décocher retire la ligne.
  assert.equal(p(c, studioLine(DAY.lun, "16:00", 120)).price, 4500);
  assert.equal(p(c, studioLine(DAY.lun, "16:00", 120, ["voixoff"])).price, 6500);
  // Mannequin 1 h 30 : 1 500 DA (arrondi au dinar).
  assert.equal(p(c, studioLine(DAY.lun, "16:00", 90, ["mannequin"])).details.at(-1)?.amount, 1500);
});

test("options : une option à l'heure n'existe que pour le studio ; description limitée", () => {
  const c = cat();
  c.product.addons = [{ id: "x", name: "X", price: 100, unit: "hour" }];
  assert.throws(() => assertCatalog(c), /unit invalide/);
  const g: StudioGrid = JSON.parse(JSON.stringify(gridFromStudio(DEFAULT_CATALOG.studio)));
  assert.equal(g.addons.find((a) => a.id === "mannequin")?.unit, "hour");
  g.addons.push({ name: "Maquilleuse", price: 1500, unit: "hour", description: "Maquillage avant la séance." });
  const s = studioFromGrid(g, DEFAULT_CATALOG.studio);
  assert.deepEqual(s.addons.at(-1), { id: "maquilleuse", name: "Maquilleuse", price: 1500, unit: "hour", description: "Maquillage avant la séance." });
  assert.deepEqual(gridFromStudio(s).addons.at(-1), { id: "maquilleuse", name: "Maquilleuse", price: 1500, unit: "hour", description: "Maquillage avant la séance." });
  g.addons.push({ name: "Y", price: 1, unit: "jour" as "hour" });
  assert.throws(() => studioFromGrid(g, DEFAULT_CATALOG.studio), /unité invalide/);
});
