// =====================================================================
//  INTEGRITY.JS — « Contrôle financier » (administrateur)
//  Vérifie que les chiffres sont fiables : reconstitution des caisses, cohérence des soldes clients,
//  lignes anormales (sans montant / sans prix / dates incohérentes), paiements en double.
//  Lecture seule par défaut. Les corrections demandent une confirmation et créent une sauvegarde avant.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc;
  var ui = { sub: 'summary' };

  function ro() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function clients() { return (appState && appState.clients) || []; }
  function byId(id) { return clients().filter(function (c) { return c.id === id; })[0]; }
  function isTaskEntry(t) { return t && /^tx-emp-/.test(String(t.id || '')); }   // tâche saisie dans « Performance salariés » (volontairement sans prix)
  function ymdOfTs(ts) { try { return X.ymdOf(new Date(Number(ts))); } catch (e) { return ''; } }

  // ------------------------------------------------------------------ 1) caisses
  function cashRows() {
    var th = typeof calculateTheoreticalBalance === 'function' ? calculateTheoreticalBalance() : { liquide: 0, baridimob: 0, usdt: 0 };
    var man = appState.manualBalances || {}, bal = appState.balances || {};
    return [['liquide', 'Liquide', 'DA'], ['baridimob', 'BaridiMob / CCP', 'DA'], ['usdt', 'USDT', '$']].map(function (a) {
      var t = num(th[a[0]]), m = num(man[a[0]]), shown = num(bal[a[0]]);
      return { key: a[0], label: a[1], unit: a[2], theo: t, manual: m, shown: shown, gap: shown - (t + m) };
    });
  }
  function money(v, u) { return u === '$' ? X.usd(v) : X.fmt(v); }

  // ------------------------------------------------------------------ 2) solde clients recalculé
  function expectedUnpaid(c) {
    var due = 0, paid = 0;
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTaskEntry(t) || t.clientId !== c.id) return;
      if (t.status === 'problem') return;
      if (!t.paid || t.paidAccount === 'avance') due += num(t.priceDzd);
    });
    (appState.payments || []).forEach(function (p) { if (p && p.clientId === c.id) paid += num(p.amount); });
    return due - paid;
  }
  function clientGaps() {
    return clients().map(function (c) { var exp = expectedUnpaid(c), cur = num(c.unpaid); return { c: c, exp: exp, cur: cur, diff: cur - exp }; })
      .filter(function (r) { return Math.abs(r.diff) > 1; }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  }

  // ------------------------------------------------------------------ 3) lignes anormales
  function anomalies() {
    var out = [], today = X.today(), cl = {}; clients().forEach(function (c) { cl[c.id] = c; });
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTaskEntry(t)) return;
      var why = [];
      if (!t.clientId || !cl[t.clientId]) why.push(t.clientId ? 'client introuvable' : 'sans client');
      if (!(num(t.priceDzd) > 0)) why.push('sans prix');
      if (t.amount === undefined || t.amount === null || t.amount === '' || !isFinite(Number(t.amount))) why.push('sans montant $');
      if (!t.offerName) why.push('sans offre');
      if (!X.isYmd(t.date)) why.push('date invalide');
      else {
        if (t.date > X.addDays(today, 1)) why.push('date dans le futur');
        if (t.createdAt && X.daysBetween(t.date, ymdOfTs(t.createdAt)) > 60) why.push('date très antérieure à la création (' + X.fmtDate(t.date) + ' vs ' + X.fmtDate(ymdOfTs(t.createdAt)) + ')');
      }
      if (why.length) out.push({ kind: 'tx', id: t.id, label: (t.clientName || '—') + ' · ' + (t.offerName || '—'), date: t.date, amount: t.priceDzd, why: why });
    });
    (appState.todoTransactions || []).forEach(function (t) {
      if (!t) return; var why = [];
      if (!t.clientId || !cl[t.clientId]) why.push('client introuvable');
      if (!(num(t.priceDzd) > 0)) why.push('sans prix');
      if (why.length) out.push({ kind: 'todo', id: t.id, label: (t.clientName || '—') + ' · ' + (t.offerName || '—') + ' (To-Do)', date: t.date, amount: t.priceDzd, why: why });
    });
    var seen = {};
    (appState.payments || []).slice().sort(function (a, b) { return num(a.createdAt) - num(b.createdAt); }).forEach(function (p) {
      if (!p) return; var why = [];
      if (!(num(p.amount) > 0)) why.push('montant nul ou négatif');
      if (!p.clientId || !cl[p.clientId]) why.push('client introuvable');
      var k = p.clientId + '|' + num(p.amount) + '|' + (p.method || ''), last = seen[k];
      if (last !== undefined && Math.abs(num(p.createdAt) - last) < 120000) why.push('doublon probable (même client, même montant, moins de 2 min)');
      seen[k] = num(p.createdAt);
      if (why.length) out.push({ kind: 'pay', id: p.id, label: (p.clientName || '—') + ' · ' + (p.method || ''), date: p.date, amount: p.amount, why: why });
    });
    return out;
  }

  // ------------------------------------------------------------------ actions
  window.integDelete = function (kind, id) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    if (kind === 'tx' && typeof deleteTransaction === 'function') deleteTransaction(id);
    else if (kind === 'pay' && typeof deletePayment === 'function') deletePayment(id);
    else if (kind === 'todo' && typeof deleteTodoTransaction === 'function') deleteTodoTransaction(id, 'todo');
    setTimeout(X.rerender, 200);
  };
  window.integAlign = function (clientId) {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var c = byId(clientId); if (!c) return;
    var exp = expectedUnpaid(c), cur = num(c.unpaid);
    if (!confirm('Aligner le solde de « ' + c.name + ' » ?\n\nSolde actuel : ' + X.fmt(cur) + '\nSolde recalculé (ventes non payées − paiements) : ' + X.fmt(exp) + '\n\nÀ n\'utiliser que si l\'écart est une erreur. Une sauvegarde de sécurité est créée avant.')) return;
    var apply = function () {
      c.unpaid = exp; c.updatedAt = Date.now();
      if (exp <= 0) c.debtStartDate = null; else if (!c.debtStartDate) c.debtStartDate = X.today();
      X.log('Solde client aligné', c.name + ' : ' + X.fmt(cur) + ' → ' + X.fmt(exp));
      if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances(); X.save(); X.toast('Solde aligné', 'success'); X.rerender();
    };
    if (window.BackupCore && BackupCore.createSnapshot) BackupCore.createSnapshot('pre-restore', 'Avant alignement du solde de ' + c.name).then(apply, function () { if (confirm('La sauvegarde de sécurité a échoué. Continuer quand même ?')) apply(); });
    else apply();
  };
  window.integCsv = function () {
    var rows = [['Type', 'Libellé', 'Date', 'Montant', 'Problèmes']];
    anomalies().forEach(function (a) { rows.push([a.kind, a.label, a.date || '', a.amount === undefined ? '' : a.amount, a.why.join(' ; ')]); });
    clientGaps().forEach(function (g) { rows.push(['solde', g.c.name, '', g.cur, 'recalculé ' + Math.round(g.exp) + ' (écart ' + Math.round(g.diff) + ')']); });
    X.csv(rows, 'controle-financier.csv');
  };

  // ------------------------------------------------------------------ rendu
  var KIND = { tx: 'Transaction', todo: 'To-Do', pay: 'Paiement' };
  function renderSummary() {
    var cash = cashRows(), an = anomalies(), gaps = clientGaps(), bad = an.length + gaps.length;
    var rows = cash.map(function (r) {
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(r.label) + '</td><td class="p-3 text-right font-mono">' + money(r.theo, r.unit) + '</td><td class="p-3 text-right font-mono ' + (r.manual ? 'text-amber-600 font-bold' : 'text-gray-400') + '">' + money(r.manual, r.unit) + '</td>' +
        '<td class="p-3 text-right font-mono font-black">' + money(r.shown, r.unit) + '</td><td class="p-3 text-center">' + (Math.abs(r.gap) < 0.5 ? '<span class="text-green-600 font-black text-xs">OK</span>' : '<span class="text-red-600 font-black text-xs">écart ' + money(r.gap, r.unit) + '</span>') + '</td></tr>';
    }).join('');
    var nTx = (appState.transactions || []).filter(function (t) { return t && !isTaskEntry(t) && t.status !== 'problem'; }).length;
    return '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Anomalies', String(an.length), an.length ? 'text-red-600' : 'text-green-600', 'fa-triangle-exclamation') + X.kpi('Soldes clients à vérifier', String(gaps.length), gaps.length ? 'text-amber-600' : 'text-green-600', 'fa-scale-unbalanced') +
      X.kpi('Ventes contrôlées', String(nTx), '', 'fa-receipt') + X.kpi('Paiements contrôlés', String((appState.payments || []).length), '', 'fa-money-bill-wave') + '</div>' +
      (bad ? '' : '<div class="p-4 mb-4 rounded-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold"><i class="fas fa-circle-check mr-2"></i>Aucune anomalie détectée : les chiffres sont cohérents.</div>') +
      X.card('Caisses : reconstitution', 'fa-vault', '<p class="text-xs text-gray-500 mb-3">Solde théorique = paiements reçus + ventes encaissées − frais − achats. Le solde affiché y ajoute vos <b>ajustements manuels</b> (en orange). Un « écart » signalerait une incohérence de calcul.</p>' +
        X.table([['Caisse'], ['Théorique', 'r'], ['Ajustement manuel', 'r'], ['Solde affiché', 'r'], ['Contrôle', 'c']], rows, {}));
  }
  function renderAnomalies() {
    var an = anomalies(), admin = X.isAdmin() && !ro();
    var rows = an.map(function (a) {
      return '<tr><td class="p-3 text-xs font-black text-indigo-600">' + KIND[a.kind] + '</td><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(a.label) + '<div class="text-[11px] font-normal text-red-600">' + E(a.why.join(' · ')) + '</div></td><td class="p-3 text-xs whitespace-nowrap">' + X.fmtDate(a.date) + '</td>' +
        '<td class="p-3 text-right font-mono text-xs">' + (a.amount === undefined || a.amount === null ? '<span class="text-red-600">—</span>' : X.fmt(a.amount)) + '</td><td class="p-3 text-right">' + (admin ? '<button type="button" data-k="' + a.kind + '" data-id="' + E(a.id) + '" onclick="integDelete(this.dataset.k,this.dataset.id)" class="px-2 py-1.5 rounded-lg text-red-600 hover:bg-red-50" title="Supprimer"><i class="fas fa-trash"></i></button>' : '') + '</td></tr>';
    }).join('');
    return X.card('Lignes anormales', 'fa-triangle-exclamation', '<p class="text-xs text-gray-500 mb-3">Lignes incomplètes ou incohérentes (sans prix, sans montant, date étrange, paiement en double…). Elles ne modifient pas les caisses tant qu\'elles n\'ont ni prix ni paiement, mais faussent les compteurs. Vérifiez puis supprimez celles qui sont des erreurs ; la suppression d\'un paiement rétablit la dette du client.</p>' +
      X.table([['Type'], ['Ligne'], ['Date'], ['Montant', 'r'], ['', 'r']], rows, { empty: 'Aucune ligne anormale 🎉' }), X.btn('Exporter en CSV', 'integCsv()', 'bg-gray-100 text-gray-700 hover:bg-gray-200', 'fa-file-csv'));
  }
  function renderBalances() {
    var gaps = clientGaps(), admin = X.isAdmin() && !ro();
    var rows = gaps.map(function (g) {
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(g.c.name) + '</td><td class="p-3 text-right font-mono">' + X.fmt(g.cur) + '</td><td class="p-3 text-right font-mono">' + X.fmt(g.exp) + '</td><td class="p-3 text-right font-mono font-black ' + (g.diff > 0 ? 'text-red-600' : 'text-amber-600') + '">' + (g.diff > 0 ? '+' : '') + X.fmt(g.diff) + '</td>' +
        '<td class="p-3 text-right">' + (admin ? '<button type="button" data-id="' + E(g.c.id) + '" onclick="integAlign(this.dataset.id)" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Aligner</button>' : '') + '</td></tr>';
    }).join('');
    return X.card('Soldes clients à vérifier', 'fa-scale-unbalanced', '<p class="text-xs text-gray-500 mb-3">Solde recalculé = ventes validées non payées (ou payées par avance) − paiements reçus. Un écart peut être normal (dette initiale reprise, ajustement manuel) ou venir d\'une erreur. « Aligner » remplace le solde par la valeur recalculée, après sauvegarde.</p>' +
      X.table([['Client'], ['Solde actuel', 'r'], ['Recalculé', 'r'], ['Écart', 'r'], ['', 'r']], rows, { empty: 'Tous les soldes sont cohérents 🎉' }));
  }
  var SUBS = [['summary', 'Synthèse', 'fa-vault'], ['anomalies', 'Lignes anormales', 'fa-triangle-exclamation'], ['balances', 'Soldes clients', 'fa-scale-unbalanced']];
  window.integSub = function (s) { ui.sub = s; X.rerender(); };
  X.registerTab('integrity', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'Contrôle financier', icon: 'fa-shield-halved' },
    render: function (c) {
      if (!X.isAdmin()) { c.innerHTML = '<p class="text-center py-8 text-gray-500">Réservé à l\'administrateur</p>'; return; }
      var fn = { summary: renderSummary, anomalies: renderAnomalies, balances: renderBalances }[ui.sub] || renderSummary;
      c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-shield-halved text-indigo-600 mr-2"></i>Contrôle financier</h2><p class="text-xs text-gray-500 mt-1">Vérifie que caisses, soldes clients, ventes et paiements sont cohérents.</p></div>' + X.pills(SUBS, ui.sub, 'integSub') + fn();
    }
  });
  window.Integrity = { count: function () { try { return anomalies().length + clientGaps().length; } catch (e) { return 0; } }, anomalies: anomalies, clientGaps: clientGaps, cash: cashRows };
})();
