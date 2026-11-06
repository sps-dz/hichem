// =====================================================================
//  MYFINANCE.JS — « Ma finance » : une page simple, en mots de tous les jours (administrateur)
//  Lecture seule : ne modifie aucune donnée, n'altère aucun calcul existant.
//  4 questions : Combien j'ai ? · Combien on me doit ? · Combien j'ai gagné ce mois ? · Quelque chose cloche ?
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc;
  var ui = { month: null };
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function isTask(t) { return t && /^tx-emp-/.test(String(t.id || '')); }
  function inMonth(d, ym) { return String(d || '').slice(0, 7) === ym; }

  // ventes validées du mois (même règle que la caisse : on ignore les « problèmes » et les anciennes ventes sans montant)
  function monthStats(ym) {
    var sales = 0, cost = 0, n = 0, usd = 0, cashIn = 0, exp = 0;
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTask(t) || !inMonth(t.date, ym)) return;
      if (t.status !== 'active' && t.status) return;
      sales += num(t.priceDzd); usd += num(t.amount); cost += X.txCost(t); n++;
    });
    (appState.payments || []).forEach(function (p) { if (p && inMonth(p.date, ym)) cashIn += num(p.amount); });
    (appState.expenses || []).forEach(function (e) { if (e && inMonth(e.date, ym)) exp += num(e.amount); });
    return { sales: sales, cost: cost, exp: exp, profit: sales - cost - exp, n: n, usd: usd, cashIn: cashIn };
  }
  function debts() {
    var owe = 0, adv = 0, list = [];
    (appState.clients || []).forEach(function (c) {
      var u = num(c.unpaid);
      if (u > 0) { owe += u; list.push({ c: c, u: u }); } else if (u < 0) adv += -u;
    });
    list.sort(function (a, b) { return b.u - a.u; });
    return { owe: owe, adv: adv, list: list };
  }
  function warnings() {
    var w = [], b = appState.balances || {};
    if (num(b.liquide) < 0) w.push('Votre caisse « Liquide » est négative (' + X.fmt(b.liquide) + '). Ce n\'est pas possible dans la réalité : il y a sûrement une erreur de saisie (souvent un achat de dollars avec un mauvais taux).');
    if (num(b.baridimob) < 0) w.push('Votre compte BaridiMob / CCP est négatif (' + X.fmt(b.baridimob) + ') : vérifiez vos achats et vos frais.');
    if (num(b.usdt) < 0) w.push('Votre stock de dollars est négatif (' + X.usd(b.usdt) + ') : vous avez vendu plus de dollars que vous n\'en avez enregistré à l\'achat. Il manque peut-être des achats dans l\'onglet « Achats ».');
    var oddRates = (appState.usdPurchases || []).filter(function (u) { var r = num(u.rate); return u && (r < 100 || r > 1000); }).length;
    if (oddRates) w.push(oddRates + ' achat(s) de dollars ont un taux impossible (par exemple 355 000 au lieu de 355). Corrigez-les dans « Contrôle financier › Taux USD ».');
    try { if (window.Integrity) { var a = Integrity.anomalies().length; if (a) w.push(a + ' ligne(s) incomplète(s) ou en double à vérifier dans « Contrôle financier › Lignes anormales ».'); } } catch (e) {}
    return w;
  }

  function big(label, value, hint, cls) {
    return '<div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4 border dark:border-gray-700"><p class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">' + E(label) + '</p><p class="text-2xl font-black ' + (cls || 'text-gray-800 dark:text-white') + '">' + value + '</p><p class="text-[11px] text-gray-500 mt-1 leading-snug">' + hint + '</p></div>';
  }
  function sign(v) { return v >= 0 ? 'text-green-600' : 'text-red-600'; }

  window.mfMonth = function (d) { ui.month = X.shiftMonth(ui.month || X.month(), d); X.rerender(); };
  window.mfGo = function (tab) { try { if (typeof showTab === 'function') showTab(tab); } catch (e) {} };

  function render(c) {
    if (!X.isAdmin()) { c.innerHTML = '<p class="text-center py-8 text-gray-500">Réservé à l\'administrateur</p>'; return; }
    var ym = ui.month || (ui.month = X.month()), cur = monthStats(ym), prev = monthStats(X.shiftMonth(ym, -1));
    var b = appState.balances || {}, d = debts(), w = warnings();
    var html = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-wallet text-indigo-600 mr-2"></i>Ma finance</h2><p class="text-xs text-gray-500 mt-1">Une vue simple de votre argent. Rien ici ne modifie vos données.</p></div>';

    // 0) alertes en langage simple
    html += w.length ? '<div class="p-4 mb-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm"><p class="font-black mb-2"><i class="fas fa-triangle-exclamation mr-2"></i>À vérifier avant de vous fier aux chiffres</p><ul class="list-disc pl-5 space-y-1">' + w.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' + '<div class="mt-3">' + X.btn('Ouvrir le Contrôle financier', "mfGo('integrity')", 'bg-amber-600 text-white hover:bg-amber-700', 'fa-shield-halved') + '</div></div>'
      : '<div class="p-4 mb-6 rounded-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold"><i class="fas fa-circle-check mr-2"></i>Tout semble cohérent : vos chiffres sont fiables.</div>';

    // 1) combien j'ai
    html += X.card('1. Combien d\'argent j\'ai en ce moment ?', 'fa-vault',
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
      big('Argent en main (liquide)', X.fmt(b.liquide), 'Les billets que vous avez physiquement : encaissements en espèces moins vos dépenses et achats de dollars.', sign(num(b.liquide))) +
      big('Sur BaridiMob / CCP', X.fmt(b.baridimob), 'L\'argent sur vos comptes en ligne (virements reçus moins ce que vous avez payé avec).', sign(num(b.baridimob))) +
      big('Stock de dollars (USDT)', X.usd(b.usdt), 'Les dollars que vous avez achetés et pas encore revendus à des clients. C\'est votre « marchandise ».', sign(num(b.usdt))) + '</div>');

    // 2) combien on me doit
    var top = d.list.slice(0, 5).map(function (r) { return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(r.c.name) + '</td><td class="p-3 text-right font-mono font-black text-red-600">' + X.fmt(r.u) + '</td></tr>'; }).join('');
    html += X.card('2. Combien mes clients me doivent ?', 'fa-hand-holding-dollar',
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">' +
      big('Argent à récupérer', X.fmt(d.owe), d.list.length + ' client(s) ont acheté sans avoir tout payé. C\'est de l\'argent qui vous appartient mais que vous n\'avez pas encore reçu.', d.owe ? 'text-red-600' : 'text-green-600') +
      big('Avances des clients', X.fmt(d.adv), 'Argent que des clients vous ont payé d\'avance. Vous leur devez des services en échange : ce n\'est pas un bénéfice.', 'text-indigo-600') + '</div>' +
      (top ? '<p class="text-xs font-bold text-gray-500 mb-2">Les 5 plus gros montants à récupérer</p>' + X.table([['Client'], ['Doit', 'r']], top, {}) + '<div class="mt-3">' + X.btn('Relancer les clients', "mfGo('care')", 'bg-indigo-600 text-white hover:bg-indigo-700', 'fa-bell') + '</div>' : '<p class="text-sm text-green-600 font-bold">Aucun client ne vous doit d\'argent 🎉</p>'));

    // 3) combien j'ai gagné ce mois
    function delta(a, p, good) { if (!p || ym >= X.month()) return '';   // mois en cours = incomplet : pas de comparaison trompeuse
      var diff = a - p; if (!diff) return ''; var up = diff > 0; return '<span class="' + ((up === good) ? 'text-green-600' : 'text-red-600') + ' font-bold">' + (up ? '▲ +' : '▼ ') + X.fmt(diff) + '</span> vs mois précédent'; }
    html += X.card('3. Combien j\'ai gagné en ' + X.monthLabel(ym).toLowerCase() + ' ?', 'fa-chart-line',
      '<div class="flex gap-2 mb-4">' + X.btn('◀ Mois précédent', 'mfMonth(-1)', 'bg-gray-100 text-gray-700 hover:bg-gray-200') + X.btn('Mois suivant ▶', 'mfMonth(1)', 'bg-gray-100 text-gray-700 hover:bg-gray-200') + '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' +
      big('Ce que j\'ai vendu', X.fmt(cur.sales), cur.n + ' vente(s). ' + delta(cur.sales, prev.sales, true), '') +
      big('Ce que m\'ont coûté les dollars', X.fmt(cur.cost), 'Le prix auquel vous avez acheté les ' + X.usd(cur.usd) + ' revendus. ' + delta(cur.cost, prev.cost, false), '') +
      big('Mes frais', X.fmt(cur.exp), 'Dépenses du mois (pub, salaires, loyer…). ' + delta(cur.exp, prev.exp, false), '') +
      big('Bénéfice estimé', X.fmt(cur.profit), 'Ventes − coût des dollars − frais. ' + delta(cur.profit, prev.profit, true), sign(cur.profit)) + '</div>' +
      '<p class="text-xs text-gray-500 leading-relaxed">Pour comparer : vous avez réellement <b>encaissé ' + X.fmt(cur.cashIn) + '</b> en paiements ce mois-ci. La différence avec les ventes vient des clients qui n\'ont pas encore payé (voir section 2). Le bénéfice est une <b>estimation</b> : il utilise vos taux d\'achat enregistrés.</p>');

    // 4) petit lexique
    html += X.card('Les mots simples', 'fa-book-open', '<dl class="text-sm space-y-2 text-gray-600 dark:text-gray-300">' +
      '<div><dt class="font-black inline">Chiffre d\'affaires (ventes) :</dt> <dd class="inline">tout ce que vous avez vendu, avant de retirer vos coûts.</dd></div>' +
      '<div><dt class="font-black inline">Bénéfice :</dt> <dd class="inline">ce qu\'il vous reste une fois les coûts et les frais retirés. C\'est votre vrai gain.</dd></div>' +
      '<div><dt class="font-black inline">Marge :</dt> <dd class="inline">ce que vous gagnez sur chaque dollar vendu (prix de vente − prix d\'achat).</dd></div>' +
      '<div><dt class="font-black inline">Impayé / dette client :</dt> <dd class="inline">un client a reçu le service mais n\'a pas encore tout payé.</dd></div>' +
      '<div><dt class="font-black inline">Avance :</dt> <dd class="inline">un client a payé avant d\'acheter ; son argent sert pour ses prochaines commandes.</dd></div>' +
      '<div><dt class="font-black inline">Stock de dollars :</dt> <dd class="inline">les dollars achetés qui attendent d\'être revendus.</dd></div></dl>');
    c.innerHTML = html;
  }
  X.registerTab('myfinance', {
    nav: { group: 'compta', groupLabel: 'Comptabilité', groupIcon: 'fa-calculator', label: 'Ma finance (simple)', icon: 'fa-wallet' },
    render: render
  });
})();
