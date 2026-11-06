// =====================================================================
//  FINANCE-HELP.JS — rend les onglets « Paiements » et « Achats USD » lisibles pour un novice
//  Ajoute, au-dessus des tableaux existants : un résumé en mots simples + une explication dépliable,
//  et repère visuellement les lignes douteuses (taux anormal, client introuvable).
//  Lecture seule : aucune donnée ni aucun calcul existant n'est modifié.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc;
  var RATE_MIN = 240, RATE_MAX = 265;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function box(label, value, hint, cls) {
    return '<div class="bg-gray-50 rounded-2xl p-3 border"><p class="text-[11px] font-bold text-gray-500 mb-0.5">' + E(label) + '</p><p class="text-lg font-black ' + (cls || 'text-gray-800') + '">' + value + '</p>' + (hint ? '<p class="text-[11px] text-gray-500 leading-snug mt-0.5">' + hint + '</p>' : '') + '</div>';
  }
  function band(title, help, boxes) {
    return '<div class="mb-6" data-fh="1"><div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">' + boxes.join('') + '</div>' +
      '<details class="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"><summary class="font-bold cursor-pointer"><i class="fas fa-circle-question mr-2"></i>' + E(title) + '</summary><div class="mt-2 space-y-1 leading-relaxed">' + help + '</div></details></div>';
  }
  function inject(container, html) {
    try {
      if (!container || container.querySelector('[data-fh]')) return;
      var anchor = container.querySelector('.overflow-x-auto'); if (anchor) anchor.insertAdjacentHTML('beforebegin', html);
    } catch (e) {}
  }
  function methodGroup(p) {
    var m = String(p.account || p.method || '').toLowerCase();
    if (m === 'baridimob' || m === 'ccp') return 'online';
    if (m === 'usdt') return 'usdt';
    return 'cash';
  }

  // ------------------------------------------------------------------ PAIEMENTS
  X.wrap('renderPaymentsTable', null, function (container) {
    var ym = X.month(), all = (appState.payments || []).filter(Boolean), tot = 0, mon = 0, g = { cash: 0, online: 0, usdt: 0 }, ids = {}, orphan = 0;
    (appState.clients || []).forEach(function (c) { ids[c.id] = 1; });
    all.forEach(function (p) {
      var a = num(p.amount); tot += a; if (String(p.date || '').slice(0, 7) === ym) mon += a; g[methodGroup(p)] += a; if (!ids[p.clientId]) orphan++;
    });
    var html = band('C\'est quoi un paiement ?',
      '<p><b>Un paiement</b> = un client vous a donné de l\'argent (espèces, virement BaridiMob/CCP ou USDT).</p>' +
      '<p>L\'argent entre dans la bonne caisse (liquide ou compte en ligne) et <b>la dette du client diminue</b> du même montant.</p>' +
      '<p>Si vous supprimez un paiement par erreur, l\'argent sort de la caisse et la dette du client remonte.</p>' +
      '<p>« Saisi par » indique qui a enregistré le paiement ; l\'heure est celle d\'Alger.</p>',
      [box('Reçu ce mois-ci', X.fmt(mon), 'Tout ce que les clients ont payé en ' + E(X.monthLabel(ym).toLowerCase()), 'text-green-600'),
       box('Reçu depuis le début', X.fmt(tot), all.length + ' paiements enregistrés', ''),
       box('En espèces', X.fmt(g.cash), 'Va dans la caisse « liquide »', ''),
       box('Virements (BaridiMob/CCP)', X.fmt(g.online), 'Va sur vos comptes en ligne' + (g.usdt ? ' · USDT : ' + X.fmt(g.usdt) : ''), '')]);
    if (orphan) html = html.replace('<details', '<div class="mb-3 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold"><i class="fas fa-triangle-exclamation mr-1"></i>' + orphan + ' paiement(s) au total sont rattachés à un client introuvable (supprimé ou fusionné) : ils comptent dans la caisse mais pas dans une fiche client. Voir « Contrôle financier ».</div><details');
    inject(container, html);
    // repère les lignes dont le client n'existe plus
    try {
      var byId = {}; all.forEach(function (p) { byId[p.id] = p; });
      container.querySelectorAll('tbody tr').forEach(function (tr) {
        var b = tr.querySelector('button[onclick^="deletePayment"]'); if (!b) return;
        var m = String(b.getAttribute('onclick')).match(/'([^']+)'/), p = m && byId[m[1]];
        if (p && !ids[p.clientId]) { var td = tr.children[1]; if (td) td.insertAdjacentHTML('beforeend', '<div class="text-[11px] font-normal text-amber-600">client introuvable</div>'); }
      });
    } catch (e) {}
  });

  // ------------------------------------------------------------------ ACHATS USD
  X.wrap('renderUsdPurchasesTable', null, function (container) {
    var all = (appState.usdPurchases || []).filter(Boolean), usd = 0, dzd = 0, okUsd = 0, okDzd = 0, odd = 0, byId = {};
    all.forEach(function (u) {
      byId[u.id] = u; var a = num(u.amount), t = num(u.totalDzd), r = num(u.rate);
      usd += a; dzd += t;
      if (r >= 100 && r <= 1000) { okUsd += a; okDzd += a * r; }          // moyenne : on écarte les taux impossibles
      if (!(r >= RATE_MIN && r <= RATE_MAX)) odd++;
    });
    var avg = okUsd ? okDzd / okUsd : 0, last = all.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); })[0];
    var html = band('C\'est quoi un achat de dollars ?',
      '<p><b>Un achat</b> = vous avez échangé des dinars (DA) contre des dollars USDT, pour les revendre ensuite à vos clients.</p>' +
      '<p><b>Le taux</b> = combien de DA vous payez pour 1 dollar. Chez vous il tourne autour de <b>' + RATE_MIN + ' à ' + RATE_MAX + ' DA</b>. Un taux très différent est presque toujours une erreur de frappe (ex. 355 000 au lieu de 355).</p>' +
      '<p><b>Total DA</b> = montant × taux. C\'est l\'argent qui <b>sort de votre caisse</b> au moment de l\'achat : un taux faux fausse donc toute votre caisse.</p>' +
      '<p>Les lignes en rouge ci-dessous ont un taux hors de la plage normale : vérifiez-les, puis corrigez-les dans « Contrôle financier › Taux USD ».</p>',
      [box('Dollars achetés (total)', X.usd(usd), all.length + ' achats', 'text-teal-600'),
       box('Dinars dépensés (total)', X.fmt(dzd), 'Somme des totaux des achats', odd ? 'text-red-600' : ''),
       box('Taux moyen payé', avg ? Math.round(avg * 100) / 100 + ' DA' : '—', 'Moyenne hors taux impossibles', ''),
       box('Dernier achat', last ? X.fmtDate(last.date) : '—', last ? num(last.amount).toLocaleString('fr-FR') + ' $ à ' + num(last.rate) + ' DA' : '', '')]);
    if (odd) html = html.replace('<details', '<div class="mb-3 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold"><i class="fas fa-triangle-exclamation mr-1"></i>' + odd + ' achat(s) ont un taux hors de ' + RATE_MIN + '–' + RATE_MAX + ' DA. Vérifiez-les : ils peuvent fausser votre caisse.</div><details');
    inject(container, html);
    try {
      container.querySelectorAll('tbody tr').forEach(function (tr) {
        var b = tr.querySelector('button[onclick^="deleteUsdPurchase"]'); if (!b) return;
        var m = String(b.getAttribute('onclick')).match(/'([^']+)'/), u = m && byId[m[1]]; if (!u) return;
        var r = num(u.rate);
        if (!(r >= RATE_MIN && r <= RATE_MAX)) {
          tr.classList.add('bg-red-50');
          var td = tr.children[2]; if (td) td.insertAdjacentHTML('beforeend', '<div class="text-[11px] font-bold ' + ((r < 100 || r > 1000) ? 'text-red-600' : 'text-amber-600') + '">' + ((r < 100 || r > 1000) ? 'taux impossible' : 'taux inhabituel') + '</div>');
        }
      });
    } catch (e) {}
  });

  // ------------------------------------------------------------------ HISTORIQUE DES TRANSACTIONS (ventes)
  X.wrap('renderTransactionsTable', null, function (container) {
    var ym = X.month(), n = 0, sales = 0, usd = 0, unpaidN = 0, unpaidDa = 0, prevSales = 0, pym = X.shiftMonth(ym, -1), byId = {};
    (appState.transactions || []).forEach(function (t) {
      if (!t || /^tx-emp-/.test(String(t.id || ''))) return; byId[t.id] = t;
      if (t.status !== 'active' && t.status) return;
      var m = String(t.date || '').slice(0, 7);
      if (m === ym) { n++; sales += num(t.priceDzd); usd += num(t.amount); if (!t.paid) { unpaidN++; unpaidDa += num(t.priceDzd); } }
      else if (m === pym) prevSales += num(t.priceDzd);
    });
    var cmp = 'Mois en cours (jour ' + Number(X.today().slice(8)) + '). Mois précédent complet : ' + X.fmt(prevSales);
    inject(container, band('Comment lire cet historique ?',
      '<p><b>Une ligne = une vente</b> : un client a commandé des dollars de publicité (<b>Montant $</b>) pour un certain <b>Prix en DA</b>.</p>' +
      '<p><b>Date / Fin :</b> la date de début et la date de fin de la campagne (début + durée).</p>' +
      '<p><b>PAYÉ / IMPAYÉ :</b> indique si le client a payé <i>cette vente</i> au moment de la valider. Si un client paie plus tard, son paiement est enregistré dans l\'onglet « Paiements » et réduit sa dette dans sa fiche : <b>la dette réelle d\'un client se lit dans sa fiche, pas sur cette ligne</b>.</p>' +
      '<p><b>⚠ Problème :</b> la vente a eu un souci (campagne bloquée…) ; elle n\'est pas comptée dans la caisse.</p>',
      [box('Ventes ce mois-ci', String(n), E(X.monthLabel(ym).toLowerCase()), ''),
       box('Chiffre d\'affaires du mois', X.fmt(sales), cmp, 'text-indigo-600'),
       box('Dollars vendus', X.usd(usd), 'Pub lancée pour vos clients', ''),
       box('Ventes non payées sur le coup', X.fmt(unpaidDa), unpaidN + ' vente(s) du mois marquée(s) impayée(s)', unpaidN ? 'text-red-600' : 'text-green-600')]));
    try {
      container.querySelectorAll('tbody tr').forEach(function (tr) {
        var b = tr.querySelector('button[onclick^="editTransaction"]'); if (!b) return;
        var m = String(b.getAttribute('onclick')).match(/'([^']+)'/), t = m && byId[m[1]]; if (!t || t.status === 'completed') return;
        if (!(num(t.priceDzd) > 0)) { var td = tr.children[5]; if (td) td.insertAdjacentHTML('beforeend', '<div class="text-[11px] font-bold text-red-600">prix manquant</div>'); }
      });
    } catch (e) {}
  });

  // ------------------------------------------------------------------ FRAIS
  X.wrap('renderExpensesTab', null, function (container) {
    var ym = X.month(), tot = 0, n = 0, cats = {}, purch = 0;
    (appState.expenses || []).forEach(function (e) {
      if (!e || String(e.date || '').slice(0, 7) !== ym) return;
      var a = num(e.amount); tot += a; n++; var c = e.category || 'Autre'; cats[c] = (cats[c] || 0) + a;
    });
    (appState.usdPurchases || []).forEach(function (u) { if (u && String(u.date || '').slice(0, 7) === ym) purch += num(u.totalDzd); });
    var top = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
    var html = band('Frais, caisse et rentabilité : comment lire cette page ?',
      '<p><b>Un frais</b> = de l\'argent que vous dépensez pour faire tourner l\'activité (salaires, loyer, internet, pub…). Il fait <b>baisser votre bénéfice</b>.</p>' +
      '<p><b>Un achat de dollars n\'est pas un frais</b> : c\'est de la marchandise que vous revendrez. Il apparaît dans la liste plus bas pour que la caisse soit complète, mais il ne réduit pas votre bénéfice.</p>' +
      '<p><b>« Trésorerie »</b> = l\'argent qui est vraiment entré et sorti de votre caisse. <b>« Rentabilité comptable »</b> = ce que vous avez réellement gagné, en répartissant les gros frais (comme un loyer payé d\'un coup) sur les jours qu\'ils couvrent. <b>Pour savoir si vous gagnez de l\'argent, regardez la rentabilité comptable.</b></p>',
      [box('Frais du mois', X.fmt(tot), n + ' dépense(s) en ' + E(X.monthLabel(ym).toLowerCase()), 'text-rose-600'),
       box('Plus gros poste', top ? E(top) : '—', top ? X.fmt(cats[top]) : 'Aucun frais ce mois-ci', ''),
       box('Achats de dollars du mois', X.fmt(purch), 'Marchandise : pas un frais', purch > 100000000 ? 'text-red-600' : ''),
       box('Frais depuis le début', X.fmt((appState.expenses || []).reduce(function (s, e) { return s + num(e && e.amount); }, 0)), 'Hors achats de dollars', '')]);
    if (purch > 100000000) html = html.replace('<details', '<div class="mb-3 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold"><i class="fas fa-triangle-exclamation mr-1"></i>Les achats de dollars de ce mois dépassent 100 millions de DA : un taux d\'achat est sûrement faux. Voir « Contrôle financier › Taux USD ».</div><details');
    try { if (container && !container.querySelector('[data-fh]')) container.insertAdjacentHTML('afterbegin', html); } catch (e) {}
  });
})();
