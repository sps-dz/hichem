// =====================================================================
//  CLIENTPROFIT.JS — « Clients rentables » : classement par bénéfice réel + ventes à marge faible
//  Lecture seule. Coût = dollars vendus × taux d'achat enregistré (même méthode que le reste du site).
//  Marge minimale = le réglage « Marge minimale (%) » de Relation client (10 % par défaut).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, ui = { period: '90', sort: 'profit' };
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function isTask(t) { return t && /^tx-emp-/.test(String(t.id || '')); }
  function minMargin() { var s = ExtStore.get('careSettings', null); return s && isFinite(Number(s.minMarginPct)) ? Number(s.minMarginPct) : 10; }
  function since() { return ui.period === 'all' ? '' : X.addDays(X.today(), -Number(ui.period)); }
  function sales() {
    var from = since();
    return (appState.transactions || []).filter(function (t) { return t && !isTask(t) && (t.status === 'active' || !t.status) && num(t.priceDzd) > 0 && num(t.amount) > 0 && (!from || String(t.date || '') >= from); });
  }
  function byClient() {
    var map = {}, cl = {}; (appState.clients || []).forEach(function (c) { cl[c.id] = c; });
    sales().forEach(function (t) {
      var id = t.clientId || '_', r = map[id] || (map[id] = { id: id, name: (cl[t.clientId] && cl[t.clientId].name) || t.clientName || 'Sans client', n: 0, rev: 0, cost: 0 });
      r.n++; r.rev += num(t.priceDzd); r.cost += X.txCost(t);
    });
    return Object.keys(map).map(function (k) { var r = map[k]; r.profit = r.rev - r.cost; r.pct = r.rev ? r.profit / r.rev * 100 : 0; r.debt = cl[r.id] ? Math.max(0, num(cl[r.id].unpaid)) : 0; return r; });
  }
  function lowMargin() {
    var m = minMargin();
    return sales().map(function (t) { var cost = X.txCost(t), p = num(t.priceDzd), pct = p ? (p - cost) / p * 100 : 0; return { t: t, cost: cost, pct: pct }; })
      .filter(function (x) { return x.cost > 0 && x.pct < m; }).sort(function (a, b) { return a.pct - b.pct; });
  }
  window.cpSet = function (k, v) { ui[k] = v; X.rerender(); };
  function sel(k, opts) { return '<select onchange="cpSet(\'' + k + '\',this.value)" class="' + X.input + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (ui[k] === o[0] ? ' selected' : '') + '>' + E(o[1]) + '</option>'; }).join('') + '</select>'; }
  function render(c) {
    if (!X.isAdmin()) { c.innerHTML = '<p class="text-center py-8 text-gray-500">Réservé à l\'administrateur</p>'; return; }
    var rows = byClient().sort(function (a, b) { return ui.sort === 'rev' ? b.rev - a.rev : (ui.sort === 'pct' ? b.pct - a.pct : b.profit - a.profit); });
    var totRev = rows.reduce(function (s, r) { return s + r.rev; }, 0), totProfit = rows.reduce(function (s, r) { return s + r.profit; }, 0);
    var loss = rows.filter(function (r) { return r.profit < 0; }).length, low = lowMargin(), m = minMargin();
    var body = rows.slice(0, 60).map(function (r, i) {
      return '<tr><td class="p-3 text-xs text-gray-400">' + (i + 1) + '</td><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(r.name) + (r.debt > 0 ? '<div class="text-[11px] font-normal text-red-600">doit ' + X.fmt(r.debt) + '</div>' : '') + '</td>' +
        '<td class="p-3 text-right text-xs">' + r.n + '</td><td class="p-3 text-right font-mono text-xs">' + X.fmt(r.rev) + '</td><td class="p-3 text-right font-mono text-xs text-gray-500">' + X.fmt(r.cost) + '</td>' +
        '<td class="p-3 text-right font-mono font-black ' + (r.profit < 0 ? 'text-red-600' : 'text-green-600') + '">' + X.fmt(r.profit) + '</td><td class="p-3 text-right text-xs font-bold ' + (r.pct < m ? 'text-amber-600' : 'text-gray-600') + '">' + r.pct.toFixed(1) + ' %</td></tr>';
    }).join('');
    var lowRows = low.slice(0, 40).map(function (x) {
      return '<tr><td class="p-3 text-xs whitespace-nowrap">' + X.fmtDate(x.t.date) + '</td><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.t.clientName || '—') + '<div class="text-[11px] font-normal text-gray-500">' + E(x.t.offerName || '') + '</div></td>' +
        '<td class="p-3 text-right font-mono text-xs">' + X.fmt(num(x.t.priceDzd)) + '</td><td class="p-3 text-right font-mono text-xs text-gray-500">' + X.fmt(x.cost) + '</td><td class="p-3 text-right font-black ' + (x.pct < 0 ? 'text-red-600' : 'text-amber-600') + '">' + (x.pct < 0 ? 'PERTE ' : '') + x.pct.toFixed(1) + ' %</td></tr>';
    }).join('');
    c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-ranking-star text-indigo-600 mr-2"></i>Clients rentables</h2><p class="text-xs text-gray-500 mt-1">Quels clients vous rapportent vraiment de l\'argent ? Bénéfice = prix de vente − coût des dollars (au taux d\'achat).</p></div>' +
      '<div class="flex flex-wrap gap-2 mb-4">' + sel('period', [['30', '30 derniers jours'], ['90', '90 derniers jours'], ['365', '12 derniers mois'], ['all', 'Depuis le début']]) + sel('sort', [['profit', 'Trier par bénéfice'], ['rev', 'Trier par chiffre d\'affaires'], ['pct', 'Trier par marge %']]) + '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Chiffre d\'affaires', X.fmt(totRev), '', 'fa-coins') + X.kpi('Bénéfice sur les dollars', X.fmt(totProfit), totProfit >= 0 ? 'text-green-600' : 'text-red-600', 'fa-sack-dollar') +
      X.kpi('Clients à perte', String(loss), loss ? 'text-red-600' : 'text-green-600', 'fa-arrow-trend-down') + X.kpi('Ventes à marge faible', String(low.length), low.length ? 'text-amber-600' : 'text-green-600', 'fa-triangle-exclamation') + '</div>' +
      X.card('Classement des clients', 'fa-ranking-star', '<p class="text-xs text-gray-500 mb-3">Ce bénéfice est avant frais (salaires, loyer, pub…). Un client avec une dette en rouge a acheté mais n\'a pas tout payé : son bénéfice n\'est pas encore dans votre caisse.</p>' + X.table([['#'], ['Client'], ['Ventes', 'r'], ['CA', 'r'], ['Coût', 'r'], ['Bénéfice', 'r'], ['Marge', 'r']], body, { empty: 'Aucune vente sur cette période' })) +
      X.card('Ventes à marge faible (< ' + m + ' %)', 'fa-triangle-exclamation', '<p class="text-xs text-gray-500 mb-3">Ventes où le prix est trop proche du coût des dollars, ou en dessous. À vérifier : prix mal saisi, ou client à qui vous accordez un tarif trop bas. Le seuil se règle dans « Relation client › Réglages ».</p>' + X.table([['Date'], ['Vente'], ['Prix', 'r'], ['Coût', 'r'], ['Marge', 'r']], lowRows, { empty: 'Aucune vente sous la marge minimale 🎉' }));
  }

  // alertes de la cloche (administrateur) : marge faible récente, taux d'achat anormal, caisse non clôturée le soir
  window.GuardsAlerts = function (add, admin) {
    if (!admin) return;
    try {
      var m = minMargin(), from = X.addDays(X.today(), -7), low = 0;
      (appState.transactions || []).forEach(function (t) {
        if (!t || isTask(t) || (t.status !== 'active' && t.status) || String(t.date || '') < from || !(num(t.priceDzd) > 0) || !(num(t.amount) > 0)) return;
        var cost = X.txCost(t); if (cost > 0 && (num(t.priceDzd) - cost) / num(t.priceDzd) * 100 < m) low++;
      });
      if (low) add('warn', 'fa-percent', low + ' vente(s) récente(s) à marge faible (< ' + m + ' %)', 'cette semaine', 'clientprofit', low);
      var odd = (appState.usdPurchases || []).filter(function (u) { var r = num(u && u.rate); return u && (r < 240 || r > 265); }).length;
      if (odd) add('danger', 'fa-dollar-sign', odd + ' achat(s) USD avec un taux hors 240–265', 'peut fausser la caisse', 'integrity', odd);
      var h = Number(new Date().toLocaleString('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Africa/Algiers' }));
      var done = ExtStore.list('cashClosings').some(function (r) { return r.date === X.today(); });
      if (h >= 18 && !done && (appState.transactions || []).length) add('info', 'fa-lock', 'La caisse n\'a pas été clôturée aujourd\'hui', '', 'closing', 1);
    } catch (e) {}
  };
  X.registerTab('clientprofit', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'Clients rentables', icon: 'fa-ranking-star' },
    render: render
  });
})();
