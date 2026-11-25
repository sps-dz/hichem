import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CATALOG, Catalog } from "../src/pricing/catalog";
import { priceCart } from "../src/pricing/engine";
import {
  buildClientOrder, clientWhatsappText, formatRef, paymentWhatsappText, randomId, shortCode, slotsByDay, staffWhatsappText, verifyOrderPricing, whatsappLink,
} from "../src/web/studio-core";
import { T0 } from "./helpers";

const NOW = T0.toMillis(); // samedi 05/12/2026 10:00 à Alger
const cat = (): Catalog => JSON.parse(JSON.stringify(DEFAULT_CATALOG));
const cart = [
  { service: "studio", date: "2026-12-07", start: "16:00", durationMinutes: 120, addons: ["iphone15pm"] },
  { service: "product", packageId: "p5" },
];

test("identifiants aléatoires : longueur et alphabet attendus par les règles", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(randomId(20), /^[A-Za-z0-9]{20}$/);
    assert.match(randomId(32), /^[A-Za-z0-9]{32}$/);
  }
  assert.notEqual(randomId(32), randomId(32));
  assert.equal(shortCode("abc123XYZ"), "ABC123");
  assert.equal(formatRef(2026, 123), "STU-2026-000123");
});

test("lien WhatsApp : numéro international sans +, message encodé", () => {
  assert.equal(whatsappLink("213555123456", "Bonjour & merci"), "https://wa.me/213555123456?text=Bonjour%20%26%20merci");
  assert.equal(whatsappLink("0555 12 34 56", "x"), "https://wa.me/213555123456?text=x");
  assert.equal(whatsappLink("+213555123456", "x"), "https://wa.me/213555123456?text=x");
  assert.throws(() => whatsappLink("123", "x"));
});

test("message WhatsApp du client : demande, lignes, total, acompte et lien de suivi", () => {
  const p = priceCart(cat(), cart, NOW);
  const t = clientWhatsappText({ code: "ABC123", name: "Amine K.", pricing: p, trackingUrl: "https://studio.dz/suivi.html?t=x" });
  assert.match(t, /Demande n° ABC123 — Amine K\./);
  assert.match(t, /Location studio · 2026-12-07 16:00–18:00 : 5 300 DA/); // 2 000 + 2 500 + iPhone 800
  assert.match(t, /Total : 17 300 DA — acompte 20 % : 3 460 DA/);
  // Le lien de suivi est toujours là, juste après le numéro de la demande.
  assert.equal(t.split("\n")[2], "Lien de suivi de ma demande : https://studio.dz/suivi.html?t=x");
  const q = priceCart(cat(), [{ service: "ad", brief: "Pub" }], NOW);
  assert.match(clientWhatsappText({ code: "X", name: "A", pricing: q, trackingUrl: "https://studio.dz/suivi.html?t=y" }), /Total : sur devis/);
  // Sans lien de suivi valable, pas de message.
  for (const bad of ["", "u", "https://studio.dz/", "suivi.html?t=x"]) {
    assert.throws(() => clientWhatsappText({ code: "X", name: "A", pricing: q, trackingUrl: bad }), /Lien de suivi manquant/);
  }
  assert.match(paymentWhatsappText({ name: "Amine", code: "ABC123", ref: "STU-2026-000001", kind: "deposit", amount: 3460, remaining: 13840, trackingUrl: "https://s/suivi.html?t=x" }),
    /^Bonjour Amine, nous avons bien reçu votre acompte de 3 460 DA pour votre STU-2026-000001 \(demande ABC123\) : elle est confirmée\. Reste à payer : 13 840 DA\.\nSuivi : https:\/\/s\/suivi\.html\?t=x$/);
  assert.match(paymentWhatsappText({ name: "A", code: "X", kind: "balance", amount: 5000, trackingUrl: "u" }), /paiement de 5 000 DA pour votre demande n° X\. Merci/);
  assert.match(staffWhatsappText({ name: "Amine", code: "ABC123", ref: "STU-2026-000001", status: "confirmed", total: 17300, deposit: 3460, trackingUrl: "u" }), /confirmée\. Reste à payer : 13 840 DA/);
});

test("demande client : tranches regroupées par jour, suivi sans téléphone", () => {
  const p = priceCart(cat(), cart, NOW);
  const b = buildClientOrder({ orderId: "A".repeat(20), trackingToken: "B".repeat(32), name: "Amine Kaci", phone: "+213555123456", note: "", pricing: p, holdExpiresAtMs: NOW + 3600e3 });
  assert.deepEqual(b.slots, { "2026-12-07": ["1600", "1630", "1700", "1730"] });
  assert.deepEqual(b.order.slots, b.slots);
  assert.equal(b.holdExpiresAtMs, NOW + 3600e3);
  assert.equal(b.tracking.name, "Amine");
  assert.equal(JSON.stringify(b.tracking).includes("555123456"), false);
  assert.equal(b.order.catalogVersion, DEFAULT_CATALOG.version);
  // Sans studio : aucun blocage.
  const q = buildClientOrder({ orderId: "A".repeat(20), trackingToken: "B".repeat(32), name: "A", phone: "+213555123456", note: "", pricing: priceCart(cat(), [cart[1]], NOW), holdExpiresAtMs: NOW });
  assert.deepEqual(q.slots, {});
  assert.equal(q.holdExpiresAtMs, null);
  assert.deepEqual(slotsByDay(["2026-12-08_0900", "2026-12-07_2130", "2026-12-07_2100"]), { "2026-12-07": ["2100", "2130"], "2026-12-08": ["0900"] });
});

test("contrôle de l'équipe : un prix ou un créneau trafiqué est signalé", () => {
  const c = cat();
  const p = priceCart(c, cart, NOW);
  const blocked = slotsByDay(p.lines.flatMap((l) => l.slotKeys ?? []));
  assert.deepEqual(verifyOrderPricing(c, cart, NOW + 5000, p, blocked).problems, []);
  // Total baissé par le navigateur.
  const forged = { ...p, total: 1000, deposit: 200 };
  const v = verifyOrderPricing(c, cart, NOW, forged, blocked);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(" "), /Total reçu 1 000 DA, recalculé 17 300 DA/);
  // Moins de tranches bloquées que le créneau demandé.
  assert.match(verifyOrderPricing(c, cart, NOW, p, { "2026-12-07": ["1600"] }).problems.join(" "), /tranches bloquées/);
  // Ligne invalide : le message du moteur est rendu.
  assert.equal(verifyOrderPricing(c, [{ service: "drone" }], NOW, p, {}).ok, false);
});
