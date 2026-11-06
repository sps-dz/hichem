// =====================================================================
//  GUARDS.JS — garde-fous de saisie + journal des modifications sensibles
//  • Achat de dollars : taux hors 240–265 DA → confirmation ; taux impossible (<100 ou >1000) → bloqué ;
//    quantité inhabituelle (> 5 000 $) → confirmation.
//  • Paiement : même client + même montant + même méthode le même jour → confirmation anti-doublon.
//  • Journal : modification / suppression d'une vente et ajout d'un achat USD sont tracés (qui, quoi, avant → après)
//    dans le journal d'activité existant.
//  Ajouts uniquement : les fonctions d'origine sont appelées telles quelles quand la saisie est valide.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext;
  var RATE_MIN = 240, RATE_MAX = 265, BIG_USD = 5000;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  // ------------------------------------------------------------------ achat USD
  X.wrap('addUsdPurchase', function () {
    window.__guardUsdCount = (appState.usdPurchases || []).length;
    var amount = num(val('usdAmount')), rate = num(val('usdRate'));
    if (!amount || !rate) return;                                  // l'application affichera son propre message
    if (rate < 100 || rate > 1000) { X.toast('Taux impossible (' + rate + ' DA pour 1 $). Vérifiez la saisie : un taux normal est entre ' + RATE_MIN + ' et ' + RATE_MAX + '.', 'error'); return false; }
    if (rate < RATE_MIN || rate > RATE_MAX) { if (!confirm('Le taux ' + rate + ' DA est hors de la plage habituelle (' + RATE_MIN + '–' + RATE_MAX + ').\n\nTotal qui sortira de la caisse : ' + X.fmt(amount * rate) + '.\n\nConfirmer cet achat ?')) return false; }
    if (amount > BIG_USD) { if (!confirm('Achat inhabituellement grand : ' + X.usd(amount) + ' (' + X.fmt(amount * rate) + ').\n\nConfirmer ?')) return false; }
  }, function () {
    try {
      var l = appState.usdPurchases || [], u = l[l.length - 1];
      if (l.length > (window.__guardUsdCount || 0) && u) X.log('Achat USD ajouté', X.usd(u.amount) + ' à ' + u.rate + ' DA = ' + X.fmt(u.totalDzd));
    } catch (e) {}
  });

  // ------------------------------------------------------------------ paiement : anti-doublon
  X.wrap('addPayment', function () {
    var clientId = val('paymentClientId'), amount = num(val('paymentAmount')), method = val('paymentMethod') || 'Cash';
    if (!clientId || !amount) return;
    var today = (typeof getLocalDateString === 'function') ? getLocalDateString() : X.today();
    var dup = (appState.payments || []).filter(function (p) { return p && p.clientId === clientId && num(p.amount) === amount && String(p.method || '') === method && p.date === today; });
    if (dup.length && !confirm('Attention : un paiement identique existe déjà aujourd\'hui pour ce client (' + X.fmt(amount) + ', ' + method + ').\n\nEnregistrer quand même un deuxième paiement ?')) return false;
  });

  // ------------------------------------------------------------------ journal : modification / suppression de vente
  var snap = null;
  function pick(t) { return t ? { id: t.id, amount: num(t.amount), price: num(t.priceDzd), date: t.date || '', paid: !!t.paid, name: t.clientName || '', offer: t.offerName || '' } : null; }
  X.wrap('saveEditTransaction', function () { snap = pick(X.find(appState.transactions, val('editTxId'))); }, function () {
    try {
      if (!snap) return; var now = pick(X.find(appState.transactions, snap.id)); if (!now) return;
      var ch = [];
      if (now.amount !== snap.amount) ch.push('montant ' + snap.amount + ' $ → ' + now.amount + ' $');
      if (now.price !== snap.price) ch.push('prix ' + X.fmt(snap.price) + ' → ' + X.fmt(now.price));
      if (now.date !== snap.date) ch.push('date ' + X.fmtDate(snap.date) + ' → ' + X.fmtDate(now.date));
      if (now.paid !== snap.paid) ch.push((snap.paid ? 'payé' : 'impayé') + ' → ' + (now.paid ? 'payé' : 'impayé'));
      if (ch.length) X.log('Vente modifiée', snap.name + ' · ' + snap.offer + ' : ' + ch.join(' ; '));
      snap = null;
    } catch (e) {}
  });
  var delSnap = null;
  X.wrap('deleteTransaction', function (id) { delSnap = pick(X.find(appState.transactions, id)); }, function (id) {
    try { if (delSnap && !X.find(appState.transactions, id)) X.log('Vente supprimée', delSnap.name + ' · ' + delSnap.offer + ' · ' + X.fmt(delSnap.price) + ' (' + X.fmtDate(delSnap.date) + ')'); delSnap = null; } catch (e) {}
  });


  // ------------------------------------------------------------------ facture WhatsApp proposée après une vente validée
  // (WhatsApp ne permet pas l'envoi automatique depuis un navigateur : on ouvre la conversation avec le message prêt, il reste à appuyer sur « Envoyer »)
  function offerInvoice(t) {
    try {
      if (localStorage.getItem('crm_wa_invoice_off') === '1') return;
    } catch (e) {}
    if (!t || typeof window.careOrderMsg !== 'function') return;
    var old = document.getElementById('waInvoiceOffer'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'waInvoiceOffer';
    d.className = 'fixed bottom-4 right-4 z-[60] max-w-sm bg-white dark:bg-gray-800 border dark:border-gray-700 shadow-2xl rounded-2xl p-4 fade-in';
    d.innerHTML = '<p class="text-sm font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-circle-check text-green-600 mr-1"></i>Vente validée : ' + X.esc(t.clientName || '') + '</p><p class="text-xs text-gray-500 mb-3">' + X.esc(t.offerName || '') + ' · ' + X.fmt(num(t.priceDzd)) + '. Envoyer la facture au client ?</p>' +
      '<div class="flex gap-2"><button type="button" id="waInvYes" class="flex-1 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold"><i class="fab fa-whatsapp mr-1"></i>Envoyer sur WhatsApp</button><button type="button" id="waInvNo" class="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold">Plus tard</button></div>';
    document.body.appendChild(d);
    document.getElementById('waInvYes').onclick = function () { d.remove(); try { window.careOrderMsg(t.id, 'facture', 'wa'); } catch (e) {} };
    document.getElementById('waInvNo').onclick = function () { d.remove(); };
    setTimeout(function () { if (d.parentNode) d.remove(); }, 25000);
  }
  function lastValidated(t0) {
    var best = null;
    (appState.transactions || []).forEach(function (t) { if (t && t.status === 'active' && num(t.completedAt) >= t0 && (!best || num(t.completedAt) >= num(best.completedAt))) best = t; });
    return best;
  }
  var _w0 = 0;
  ['changeTodoStatus', 'handleNewTodoSubmit'].forEach(function (n) {
    X.wrap(n, function () { _w0 = Date.now() - 50; }, function () { try { var t = lastValidated(_w0); if (t) setTimeout(function () { offerInvoice(t); }, 400); } catch (e) {} });
  });

  window.CrmGuards = { rateMin: RATE_MIN, rateMax: RATE_MAX };
})();
