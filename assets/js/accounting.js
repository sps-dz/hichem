// =====================================================================
//  ACCOUNTING.JS — onglet « Comptabilité » (phase 2)
//  Livre de caisse · Rapprochement · Clôture mensuelle · Budget · Bilan mensuel ·
//  Relevé de compte client · Devis & avoirs · Profil entreprise
//  Lecture seule des données existantes (aucun calcul existant n'est modifié) ; les nouvelles
//  données sont stockées dans appState.globalConfig.ext (synchronisé par l'application).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;

  function ui() { if (!appState.ui) appState.ui = {}; if (!appState.ui.accounting) appState.ui.accounting = {}; var u = appState.ui.accounting; if (!u.sub) u.sub = 'ledger'; if (!u.month) u.month = X.month(); return u; }
  var ACCS = { liquide: 'Liquide', baridimob: 'BaridiMob', usdt: 'USDT' };

  // =====================================================================
  //  LIVRE DE CAISSE (même logique que calculateTheoreticalBalance, mais ligne par ligne)
  // =====================================================================
  function buildLedger() {
    var L = { liquide: [], baridimob: [], usdt: [] };
    var rate = (typeof getRedotpayRate === 'function') ? getRedotpayRate() : 250;
    function push(acc, date, ts, label, ref, inn, out) { L[acc].push({ date: date || '', ts: ts || 0, label: label, ref: ref || '', inn: inn || 0, out: out || 0 }); }
    function toAcc(a) { return a === 'baridimob' ? 'baridimob' : (a === 'usdt' ? 'usdt' : 'liquide'); }
    (appState.payments || []).forEach(function (p) {
      var amt = Number(p.amount || 0), m = String(p.method || '').toLowerCase();
      var acc = p.account || (m === 'baridimob' ? 'baridimob' : (m === 'usdt' ? 'usdt' : 'liquide'));
      var lab = 'Paiement reçu — ' + (p.clientName || X.clientName(p.clientId)) + (p.note ? ' (' + p.note + ')' : '');
      if (acc === 'baridimob') push('baridimob', p.date, p.createdAt, lab, 'PAY', amt, 0);
      else if (acc === 'usdt') push('usdt', p.date, p.createdAt, lab, 'PAY', amt / rate, 0);
      else push('liquide', p.date, p.createdAt, lab, 'PAY', amt, 0);
    });
    (appState.transactions || []).forEach(function (t) {
      if (t.status === 'problem') return;
      if (t.paid) {
        var acc = t.paidAccount || 'liquide', amt = Number(t.priceDzd || 0), lab = 'Vente encaissée — ' + (t.clientName || '') + ' — ' + (t.offerName || '');
        if (acc === 'baridimob') push('baridimob', t.date, t.createdAt, lab, 'VTE', amt, 0);
        else if (acc === 'usdt') push('usdt', t.date, t.createdAt, lab, 'VTE', amt / rate, 0);
        else push('liquide', t.date, t.createdAt, lab, 'VTE', amt, 0);
      }
    });
    (appState.expenses || []).forEach(function (e) {
      var acc = toAcc(e.account || 'liquide'), amt = Number(e.amount || 0), lab = 'Frais — ' + (e.category || '') + (e.note ? ' (' + e.note + ')' : '');
      push(acc, e.date, e.createdAt, lab, 'FRA', 0, acc === 'usdt' ? amt / rate : amt);
    });
    (appState.usdPurchases || []).forEach(function (u) {
      var dz = Number(u.totalDzd || 0), us = Number(u.amount || 0), acc = (u.dzdAccount || 'liquide') === 'baridimob' ? 'baridimob' : 'liquide';
      push(acc, u.date, u.createdAt, 'Achat USD (' + us + ' $)', 'ACH', 0, dz);
      push('usdt', u.date, u.createdAt, 'Achat USD — entrée de stock', 'ACH', us, 0);
    });
    (appState.transactions || []).forEach(function (t) {
      if (t.status === 'active' || !t.status) push('usdt', t.date, t.createdAt, 'Vente — consommation USD — ' + (t.clientName || ''), 'VTE', 0, Number(t.amount || 0));
    });
    (appState.usdtExpenses || []).forEach(function (e) { push('usdt', e.date, e.createdAt, 'Dépense USDT — ' + (e.category || '') + (e.note ? ' (' + e.note + ')' : ''), 'DEP', 0, Number(e.amount || 0)); });
    Object.keys(L).forEach(function (k) { L[k].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (a.ts - b.ts); }); });
    return L;
  }
  function manualOf(acc) { var m = appState.manualBalances || {}; return Number(m[acc] || 0); }
  window.AccountingLedger = { build: buildLedger };

  function renderLedger() {
    var u = ui(), acc = u.ledgerAcc || 'liquide', month = u.ledgerMonth === undefined ? X.month() : u.ledgerMonth;
    var L = buildLedger()[acc], man = manualOf(acc), unit = acc === 'usdt' ? ' $' : ' DA';
    var fm = function (n) { return acc === 'usdt' ? X.usd(n) : X.fmt(n); };
    var opening = man, rows = [];
    L.forEach(function (r) {
      var inRange = !month || String(r.date).slice(0, 7) === month;
      if (month && String(r.date).slice(0, 7) < month) opening += r.inn - r.out;
      if (inRange) rows.push(r);
    });
    var run = opening, totIn = 0, totOut = 0;
    var html = rows.map(function (r) {
      run += r.inn - r.out; totIn += r.inn; totOut += r.out;
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">' + X.fmtDate(r.date) + '</td><td class="p-3 font-mono text-xs text-gray-400">' + E(r.ref) + '</td>' +
        '<td class="p-3 text-gray-800 dark:text-gray-100">' + E(r.label) + '</td><td class="p-3 text-right font-mono text-green-600">' + (r.inn ? fm(r.inn) : '') + '</td>' +
        '<td class="p-3 text-right font-mono text-red-600">' + (r.out ? fm(r.out) : '') + '</td><td class="p-3 text-right font-mono font-bold ' + (run < 0 ? 'text-red-600' : 'text-gray-800 dark:text-white') + '">' + fm(run) + '</td></tr>';
    }).join('');
    var head = '<tr class="bg-indigo-50 dark:bg-indigo-900/20 font-bold"><td class="p-3" colspan="5">Solde d\'ouverture' + (month ? ' — ' + E(X.monthLabel(month)) : ' (ajustements manuels)') + '</td><td class="p-3 text-right font-mono">' + fm(opening) + '</td></tr>';
    var foot = '<tfoot><tr class="bg-gray-50 dark:bg-gray-900 font-black"><td class="p-3" colspan="3">Totaux de la période</td><td class="p-3 text-right font-mono text-green-600">' + fm(totIn) + '</td><td class="p-3 text-right font-mono text-red-600">' + fm(totOut) + '</td><td class="p-3 text-right font-mono">' + fm(run) + '</td></tr></tfoot>';
    var theo = (appState.balances || {})[acc];
    var tabs = Object.keys(ACCS).map(function (k) { return '<button onclick="accLedgerAcc(\'' + k + '\')" class="px-3 py-2 rounded-xl text-sm font-bold ' + (k === acc ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200') + '">' + ACCS[k] + '</button>'; }).join(' ');
    var body =
      '<div class="flex flex-wrap items-center gap-2 mb-4">' + tabs +
        '<input type="month" value="' + E(month || '') + '" onchange="accLedgerMonth(this.value)" class="' + X.input + '" title="Période (vide = tout)">' +
        '<button onclick="accLedgerMonth(\'\')" class="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Tout l\'historique</button>' +
        '<span class="flex-1"></span>' + X.btn('CSV', 'accLedgerCsv()', 'border dark:border-gray-600 text-gray-700 dark:text-gray-200', 'fa-file-csv') + X.btn('Imprimer / PDF', 'accLedgerDoc()', null, 'fa-print') + '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Solde d\'ouverture', fm(opening), '', 'fa-door-open') + X.kpi('Entrées', fm(totIn), 'text-green-600', 'fa-arrow-down') + X.kpi('Sorties', fm(totOut), 'text-red-600', 'fa-arrow-up') + X.kpi('Solde de clôture', fm(run), run < 0 ? 'text-red-600' : 'text-indigo-600', 'fa-scale-balanced') + '</div>' +
      X.table([['Date'], ['Réf.'], ['Libellé'], ['Entrée', 'r'], ['Sortie', 'r'], ['Solde', 'r']], head + html, { foot: foot }) +
      '<p class="text-[11px] text-gray-400 mt-2">Le livre reprend exactement les mouvements pris en compte par le solde théorique (paiements, ventes encaissées, frais, achats USD, ventes USD, dépenses USDT). ' +
      (month ? '' : 'Solde actuel de l\'application : <b>' + (theo === undefined ? '—' : fm(theo)) + '</b>. ') + (acc === 'usdt' ? 'Les montants USDT sont en dollars.' : '') + '</p>';
    return X.card('Livre de caisse', 'fa-book', body);
  }
  window.accLedgerAcc = function (a) { ui().ledgerAcc = a; X.rerender(); };
  window.accLedgerMonth = function (m) { ui().ledgerMonth = m || ''; X.rerender(); };
  function ledgerRows() {
    var u = ui(), acc = u.ledgerAcc || 'liquide', month = u.ledgerMonth === undefined ? X.month() : u.ledgerMonth, L = buildLedger()[acc], opening = manualOf(acc), rows = [];
    L.forEach(function (r) { if (month && String(r.date).slice(0, 7) < month) opening += r.inn - r.out; if (!month || String(r.date).slice(0, 7) === month) rows.push(r); });
    return { acc: acc, month: month, opening: opening, rows: rows };
  }
  window.accLedgerCsv = function () {
    var d = ledgerRows(), run = d.opening, out = [['Date', 'Réf.', 'Libellé', 'Entrée', 'Sortie', 'Solde'], ['', '', 'Solde d\'ouverture', '', '', run.toFixed(2)]];
    d.rows.forEach(function (r) { run += r.inn - r.out; out.push([r.date, r.ref, r.label, r.inn ? r.inn.toFixed(2) : '', r.out ? r.out.toFixed(2) : '', run.toFixed(2)]); });
    X.csv(out, 'livre_de_caisse_' + d.acc + '_' + (d.month || 'tout') + '.csv');
  };
  window.accLedgerDoc = function () {
    var d = ledgerRows(), run = d.opening, fm = d.acc === 'usdt' ? X.usd : X.fmt, tin = 0, tout = 0;
    var rows = d.rows.map(function (r) { run += r.inn - r.out; tin += r.inn; tout += r.out; return '<tr style="border-bottom:1px solid ' + X.C.LINE + '"><td style="padding:6px 8px;font-size:11px;white-space:nowrap">' + X.fmtDate(r.date) + '</td><td style="padding:6px;font-size:10px;font-family:monospace;color:#6b7a90">' + E(r.ref) + '</td><td style="padding:6px;font-size:11px">' + E(r.label) + '</td><td style="padding:6px;font-size:11px;text-align:right;color:#0e7a4b">' + (r.inn ? fm(r.inn) : '') + '</td><td style="padding:6px;font-size:11px;text-align:right;color:#c2272d">' + (r.out ? fm(r.out) : '') + '</td><td style="padding:6px 8px;font-size:11px;text-align:right;font-weight:700">' + fm(run) + '</td></tr>'; }).join('');
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 36px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('LIVRE DE CAISSE', ACCS[d.acc] + ' — ' + (d.month ? X.monthLabel(d.month) : 'Tout l\'historique')) +
      '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:' + X.C.NAVY + ';color:#fff;font-size:10px;text-transform:uppercase"><th style="padding:8px;text-align:left">Date</th><th style="padding:8px;text-align:left">Réf.</th><th style="padding:8px;text-align:left">Libellé</th><th style="padding:8px;text-align:right">Entrée</th><th style="padding:8px;text-align:right">Sortie</th><th style="padding:8px;text-align:right">Solde</th></tr></thead><tbody>' +
      '<tr style="background:' + X.C.SOFT + ';font-weight:700"><td colspan="5" style="padding:7px 8px;font-size:11px">Solde d\'ouverture</td><td style="padding:7px 8px;text-align:right;font-size:11px">' + fm(d.opening) + '</td></tr>' + rows +
      '<tr style="background:' + X.C.SOFT + ';font-weight:800"><td colspan="3" style="padding:8px;font-size:11px">Totaux / solde de clôture</td><td style="padding:8px;text-align:right;font-size:11px">' + fm(tin) + '</td><td style="padding:8px;text-align:right;font-size:11px">' + fm(tout) + '</td><td style="padding:8px;text-align:right;font-size:11px">' + fm(run) + '</td></tr></tbody></table>' + X.docFooter() + '</div>';
    X.openDoc({ title: 'Livre de caisse — ' + ACCS[d.acc], filename: 'livre_caisse_' + d.acc + '_' + (d.month || 'tout') + '.pdf', inner: inner, fixed: false });
  };

  // =====================================================================
  //  RAPPROCHEMENT
  // =====================================================================
  function renderRecon() {
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    var b = appState.balances || {}, recs = S.list('reconciliations').slice().sort(function (a, c) { return (c.ts || 0) - (a.ts || 0); });
    var cards = Object.keys(ACCS).map(function (k) {
      var unit = k === 'usdt' ? '$' : 'DA', th = Number(b[k] || 0);
      return '<div class="rounded-2xl border dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"><div class="font-black text-gray-800 dark:text-white mb-2">' + ACCS[k] + '</div>' +
        '<div class="text-xs text-gray-500">Solde théorique</div><div class="text-lg font-black text-indigo-600 mb-3">' + (k === 'usdt' ? X.usd(th) : X.fmt(th)) + '</div>' +
        '<label class="text-xs font-bold text-gray-500">Montant réellement compté (' + unit + ')</label><input id="rec-' + k + '" type="number" step="any" class="' + X.input + ' w-full mt-1 mb-2" oninput="accReconPreview(\'' + k + '\')">' +
        '<div id="recdiff-' + k + '" class="text-sm font-bold text-gray-400 mb-2">Écart : —</div>' +
        '<input id="recnote-' + k + '" type="text" placeholder="Motif de l\'écart (optionnel)" class="' + X.input + ' w-full mb-2">' +
        X.btn('Enregistrer le rapprochement', 'accReconSave(\'' + k + '\')', null, 'fa-check') + '</div>';
    }).join('');
    var rows = recs.slice(0, 40).map(function (r) {
      var fm = r.account === 'usdt' ? X.usd : X.fmt, ok = Math.abs(r.diff) < 0.005;
      return '<tr><td class="p-3 whitespace-nowrap text-xs text-gray-500">' + E(X.fmtTs(r.ts)) + '</td><td class="p-3 font-bold">' + E(ACCS[r.account] || r.account) + '</td><td class="p-3 text-right font-mono">' + fm(r.theoretical) + '</td><td class="p-3 text-right font-mono">' + fm(r.counted) + '</td><td class="p-3 text-right font-mono font-black ' + (ok ? 'text-green-600' : 'text-red-600') + '">' + (ok ? 'OK' : (r.diff > 0 ? '+' : '') + fm(r.diff)) + '</td><td class="p-3 text-xs text-gray-500">' + E(r.note || '') + '</td><td class="p-3 text-xs text-gray-400">' + E(r.by || '') + '</td></tr>';
    }).join('');
    var body = '<p class="text-sm text-gray-500 mb-4">Comptez l\'argent réel de chaque caisse et comparez-le au solde théorique de l\'application. Chaque rapprochement est enregistré (date, écart, motif, auteur). Il ne modifie aucun solde.</p><div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">' + cards + '</div>' +
      '<h4 class="font-bold text-gray-800 dark:text-white mb-2">Historique des rapprochements</h4>' + X.table([['Date'], ['Caisse'], ['Théorique', 'r'], ['Compté', 'r'], ['Écart', 'r'], ['Motif'], ['Par']], rows, { empty: 'Aucun rapprochement enregistré' });
    return X.card('Rapprochement des caisses', 'fa-scale-balanced', body);
  }
  window.accReconPreview = function (k) {
    var v = document.getElementById('rec-' + k).value, el = document.getElementById('recdiff-' + k);
    if (v === '') { el.textContent = 'Écart : —'; el.className = 'text-sm font-bold text-gray-400 mb-2'; return; }
    var d = Number(v) - Number((appState.balances || {})[k] || 0), ok = Math.abs(d) < 0.005, fm = k === 'usdt' ? X.usd : X.fmt;
    el.textContent = ok ? 'Écart : aucun ✓' : 'Écart : ' + (d > 0 ? '+' : '') + fm(d);
    el.className = 'text-sm font-bold mb-2 ' + (ok ? 'text-green-600' : 'text-red-600');
  };
  window.accReconSave = function (k) {
    var v = document.getElementById('rec-' + k).value;
    if (v === '' || !isFinite(Number(v))) return X.toast('Saisissez le montant compté', 'error');
    var th = Number((appState.balances || {})[k] || 0), counted = Number(v), diff = counted - th;
    S.list('reconciliations').push({ id: X.uid('rec'), ts: Date.now(), account: k, theoretical: th, counted: counted, diff: diff, note: document.getElementById('recnote-' + k).value.trim(), by: X.actor() });
    X.log('Rapprochement de caisse', ACCS[k] + ' : théorique ' + th.toFixed(2) + ' / compté ' + counted.toFixed(2) + ' / écart ' + diff.toFixed(2));
    X.save(); X.toast(Math.abs(diff) < 0.005 ? 'Caisse conforme ✓' : 'Écart enregistré', Math.abs(diff) < 0.005 ? 'success' : 'warning'); X.rerender();
  };

  // =====================================================================
  //  CLÔTURE MENSUELLE
  // =====================================================================
  function closures() { return S.map('closures'); }
  window.isMonthLocked = function (month) { var c = closures()[month]; return !!(c && c.locked); };
  function snapshotMonth(month) {
    var r = X.monthRange(month), p = (typeof getProfitSummaryYmd === 'function') ? getProfitSummaryYmd(r.from, r.to) : null;
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    return { revenue: p ? p.revenue : 0, cost: p ? p.cost : 0, expenses: p ? p.expenses + p.usdtExpensesDzd : 0, net: p ? p.netProfit : 0, txCount: p ? p.txCount : 0, balances: Object.assign({}, appState.balances || {}) };
  }
  function renderClosures() {
    var cur = X.month(), months = [];
    for (var i = 1; i <= 12; i++) months.push(X.shiftMonth(cur, -i));
    var rows = months.map(function (m) {
      var c = closures()[m], locked = c && c.locked, p = (typeof getProfitSummaryYmd === 'function') ? getProfitSummaryYmd(X.monthRange(m).from, X.monthRange(m).to) : null;
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(X.monthLabel(m)) + '</td><td class="p-3 text-right font-mono">' + (p ? X.fmt(p.revenue) : '—') + '</td><td class="p-3 text-right font-mono ' + (p && p.netProfit < 0 ? 'text-red-600' : 'text-green-600') + '">' + (p ? X.fmt(p.netProfit) : '—') + '</td>' +
        '<td class="p-3 text-center">' + (locked ? '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-gray-800 text-white"><i class="fas fa-lock mr-1"></i>Clôturé</span>' : '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Ouvert</span>') + '</td>' +
        '<td class="p-3 text-xs text-gray-500">' + (locked ? E(X.fmtTs(c.closedAt)) + ' · ' + E(c.by || '') : (c && c.reopenedAt ? 'Rouvert le ' + E(X.fmtTs(c.reopenedAt)) + (c.reopenReason ? ' — ' + E(c.reopenReason) : '') : '')) + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap">' + (locked ? X.btn('Rouvrir', 'accReopen(\'' + m + '\')', 'bg-amber-100 text-amber-800 hover:bg-amber-200', 'fa-lock-open') : X.btn('Clôturer', 'accClose(\'' + m + '\')', null, 'fa-lock')) + '</td></tr>';
    }).join('');
    var body = '<p class="text-sm text-gray-500 mb-4">Clôturer un mois fige ses chiffres (chiffre d\'affaires, marge, frais, soldes) et <b>verrouille</b> les modifications et suppressions de transactions, frais, paiements et achats USD de ce mois. L\'administrateur peut toujours forcer une modification (confirmation + trace dans le journal d\'audit). Seuls les mois passés peuvent être clôturés.</p>' +
      X.table([['Mois'], ['CA', 'r'], ['Résultat net', 'r'], ['Statut', 'c'], ['Détail'], ['Action', 'r']], rows);
    return X.card('Clôture mensuelle', 'fa-lock', body);
  }
  window.accClose = function (m) {
    if (!X.isAdmin()) return X.toast('Réservé à l\'administrateur', 'error');
    if (m >= X.month()) return X.toast('Seuls les mois passés peuvent être clôturés', 'warning');
    var s = snapshotMonth(m);
    if (!confirm('Clôturer ' + X.monthLabel(m) + ' ?\n\nCA : ' + X.fmt(s.revenue) + '\nRésultat net : ' + X.fmt(s.net) + '\n\nLes modifications de ce mois seront verrouillées.')) return;
    closures()[m] = Object.assign({ locked: true, closedAt: Date.now(), by: X.actor() }, s);
    X.log('Mois clôturé', X.monthLabel(m) + ' — CA ' + X.fmt(s.revenue) + ', net ' + X.fmt(s.net)); X.save(); X.rerender(); X.toast('Mois clôturé', 'success');
  };
  window.accReopen = function (m) {
    if (!X.isAdmin()) return X.toast('Réservé à l\'administrateur', 'error');
    var reason = prompt('Motif de la réouverture de ' + X.monthLabel(m) + ' :'); if (reason === null) return;
    var c = closures()[m] || {}; c.locked = false; c.reopenedAt = Date.now(); c.reopenReason = reason; closures()[m] = c;
    X.log('Mois rouvert', X.monthLabel(m) + ' — ' + reason); X.save(); X.rerender(); X.toast('Mois rouvert', 'info');
  };
  // Verrouillage : on enveloppe les fonctions de modification (annulation si mois clôturé)
  function guardDate(ymd, what) {
    if (!ymd || !X.isYmd(ymd)) return true;
    var m = String(ymd).slice(0, 7);
    if (!isMonthLocked(m)) return true;
    if (!X.isAdmin()) { X.toast('Le mois de ' + X.monthLabel(m) + ' est clôturé : modification impossible', 'error'); return false; }
    if (!confirm('⚠ Le mois de ' + X.monthLabel(m) + ' est CLÔTURÉ.\n' + what + '\n\nModifier quand même ?')) return false;
    X.log('Modification d\'un mois clôturé', X.monthLabel(m) + ' — ' + what);
    return true;
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  X.wrap('deleteTransaction', function (id) { var t = X.find(appState.transactions, id); return t ? guardDate(t.date, 'Suppression de la transaction ' + (t.clientName || '')) : true; });
  X.wrap('saveEditTransaction', function () { var t = X.find(appState.transactions, val('editTxId')); if (!t) return true; return guardDate(t.date, 'Modification de la transaction ' + (t.clientName || '')) && (val('editTxDate') === t.date || guardDate(val('editTxDate'), 'Déplacement d\'une transaction vers ce mois')); });
  X.wrap('deleteExpense', function (id) { var e = X.find(appState.expenses, id); return e ? guardDate(e.date, 'Suppression du frais ' + (e.category || '')) : true; });
  X.wrap('addExpense', function () { return guardDate(val('expenseDate'), 'Ajout d\'un frais'); });
  X.wrap('deletePayment', function (id) { var p = X.find(appState.payments, id); return p ? guardDate(p.date, 'Suppression du paiement de ' + (p.clientName || '')) : true; });
  X.wrap('deleteUsdPurchase', function (id) { var u = X.find(appState.usdPurchases, id); return u ? guardDate(u.date, 'Suppression d\'un achat USD') : true; });
  X.wrap('handleNewTodoSubmit', function (mode) { return mode === 'direct' ? guardDate(val('todoDate'), 'Ajout d\'une vente directe') : true; });
  X.wrap('changeTodoStatus', function (id, st, type) { if (st !== 'done' && st !== 'problem') return true; var arr = type === 'problem' ? appState.transactions : appState.todoTransactions, t = X.find(arr, id); return t ? guardDate(t.date, 'Validation de la tâche ' + (t.clientName || '')) : true; });

  // =====================================================================
  //  BUDGET
  // =====================================================================
  function renderBudget() {
    var u = ui(), m = u.budgetMonth || X.month(), b = S.map('budgets'), r = X.monthRange(m), act = {};
    (appState.expenses || []).forEach(function (e) { if (e && String(e.date).slice(0, 7) === m) { var c = e.category || 'Sans catégorie'; act[c] = (act[c] || 0) + Number(e.amount || 0); } });
    var cats = {}; Object.keys(act).forEach(function (c) { cats[c] = 1; }); Object.keys(b).forEach(function (c) { cats[c] = 1; });
    (((appState.settings || {}).expenseCategories) || []).forEach(function (c) { cats[c] = 1; });
    var names = Object.keys(cats).sort(), tb = 0, ta = 0;
    var rows = names.map(function (c) {
      var bud = Number(b[c] || 0), a = act[c] || 0; tb += bud; ta += a;
      var pct = bud > 0 ? Math.round(a / bud * 100) : null, cls = pct === null ? 'bg-gray-300' : (pct > 100 ? 'bg-red-500' : (pct > 80 ? 'bg-amber-500' : 'bg-green-500'));
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(c) + '</td><td class="p-3 text-right"><input type="number" min="0" value="' + (bud || '') + '" placeholder="0" class="' + X.input + ' w-28 text-right" onchange="accBudgetSet(\'' + X.js(c) + '\', this.value)"></td>' +
        '<td class="p-3 text-right font-mono">' + X.fmt(a) + '</td><td class="p-3 text-right font-mono ' + (bud && a > bud ? 'text-red-600' : 'text-gray-600') + '">' + (bud ? X.fmt(bud - a) : '—') + '</td>' +
        '<td class="p-3" style="min-width:140px"><div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"><div class="h-full ' + cls + '" style="width:' + Math.min(100, pct || 0) + '%"></div></div><div class="text-[10px] text-gray-400 mt-1">' + (pct === null ? 'pas de budget' : pct + ' %') + '</div></td></tr>';
    }).join('');
    var foot = '<tfoot><tr class="bg-gray-50 dark:bg-gray-900 font-black"><td class="p-3">TOTAL</td><td class="p-3 text-right font-mono">' + X.fmt(tb) + '</td><td class="p-3 text-right font-mono">' + X.fmt(ta) + '</td><td class="p-3 text-right font-mono ' + (tb && ta > tb ? 'text-red-600' : '') + '">' + (tb ? X.fmt(tb - ta) : '—') + '</td><td></td></tr></tfoot>';
    var over = names.filter(function (c) { return Number(b[c] || 0) > 0 && (act[c] || 0) > Number(b[c]); });
    var body = '<div class="flex flex-wrap items-center gap-3 mb-4"><input type="month" value="' + E(m) + '" onchange="accBudgetMonth(this.value)" class="' + X.input + '"><span class="text-sm text-gray-500">Le budget mensuel saisi s\'applique à chaque mois.</span></div>' +
      (over.length ? '<div class="mb-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-700"><i class="fas fa-triangle-exclamation mr-2"></i>Budget dépassé : <b>' + over.map(E).join(', ') + '</b></div>' : '') +
      X.table([['Catégorie'], ['Budget mensuel', 'r'], ['Réel', 'r'], ['Écart', 'r'], ['Consommation']], rows, { foot: foot, empty: 'Aucune catégorie' });
    return X.card('Budget vs réel — ' + X.monthLabel(m), 'fa-chart-pie', body);
  }
  window.accBudgetMonth = function (m) { if (m) { ui().budgetMonth = m; X.rerender(); } };
  window.accBudgetSet = function (cat, v) { var b = S.map('budgets'); if (v === '' || Number(v) <= 0) delete b[cat]; else b[cat] = Number(v); X.save(); X.rerender(); };

  // =====================================================================
  //  BILAN MENSUEL
  // =====================================================================
  function bilan(month) {
    var r = X.monthRange(month), p = getProfitSummaryYmd(r.from, r.to), cats = {}, usd = 0, unpaidSales = 0, payroll = 0, nTx = 0;
    (appState.expenses || []).forEach(function (e) { if (e && String(e.date).slice(0, 7) === month) { var c = e.category || 'Sans catégorie'; cats[c] = (cats[c] || 0) + Number(e.amount || 0); } });
    (appState.transactions || []).forEach(function (t) { if (X.valid(t) && String(t.date).slice(0, 7) === month) { usd += Number(t.amount || 0); nTx++; if (!t.paid) unpaidSales += Number(t.priceDzd || 0); } });
    (appState.employeePayments || []).forEach(function (e) { if (e && e.paid && (e.period || String(e.date).slice(0, 7)) === month && e.type !== 'frais' && e.type !== 'autre') payroll += Number(e.amount || 0); });
    var receivables = (appState.clients || []).reduce(function (s, c) { return s + Math.max(0, Number(c.unpaid || 0)); }, 0);
    var cl = closures()[month], bal = (cl && cl.locked && cl.balances) ? cl.balances : (function () { if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances(); return appState.balances || {}; })();
    return { month: month, p: p, cats: cats, usd: usd, unpaidSales: unpaidSales, payroll: payroll, receivables: receivables, balances: bal, closed: !!(cl && cl.locked), nTx: nTx };
  }
  function renderBilan() {
    var u = ui(), m = u.bilanMonth || X.shiftMonth(X.month(), -1), d = bilan(m), p = d.p;
    var cats = Object.keys(d.cats).sort(function (a, b) { return d.cats[b] - d.cats[a]; });
    var body = '<div class="flex flex-wrap items-center gap-3 mb-4"><input type="month" value="' + E(m) + '" onchange="accBilanMonth(this.value)" class="' + X.input + '">' + (d.closed ? '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-gray-800 text-white"><i class="fas fa-lock mr-1"></i>Mois clôturé</span>' : '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Mois ouvert (chiffres provisoires)</span>') +
      '<span class="flex-1"></span>' + X.btn('CSV', 'accBilanCsv()', 'border dark:border-gray-600 text-gray-700 dark:text-gray-200', 'fa-file-csv') + X.btn('PDF pour le comptable', 'accBilanDoc()', null, 'fa-file-pdf') + '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Chiffre d\'affaires', X.fmt(p.revenue), '', 'fa-sack-dollar') + X.kpi('Coût des ventes (USD)', X.fmt(p.cost), 'text-gray-700 dark:text-gray-200', 'fa-coins') + X.kpi('Marge brute', X.fmt(p.grossProfit), 'text-indigo-600', 'fa-chart-line') + X.kpi('Résultat net', X.fmt(p.netProfit), p.netProfit < 0 ? 'text-red-600' : 'text-green-600', 'fa-scale-balanced') + '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Frais du mois', X.fmt(p.expenses + p.usdtExpensesDzd), 'text-red-600', 'fa-receipt') + X.kpi('Salaires payés', X.fmt(d.payroll), '', 'fa-users') + X.kpi('Ventes non encaissées', X.fmt(d.unpaidSales), 'text-amber-600', 'fa-hourglass-half') + X.kpi('Créances clients (actuelles)', X.fmt(d.receivables), 'text-red-600', 'fa-user-clock') + '</div>' +
      '<h4 class="font-bold text-gray-800 dark:text-white mb-2">Frais par catégorie</h4>' + X.table([['Catégorie'], ['Montant', 'r']], cats.map(function (c) { return '<tr><td class="p-3">' + E(c) + '</td><td class="p-3 text-right font-mono">' + X.fmt(d.cats[c]) + '</td></tr>'; }).join(''), { empty: 'Aucun frais ce mois' });
    return X.card('Bilan mensuel — ' + X.monthLabel(m), 'fa-file-invoice-dollar', body);
  }
  window.accBilanMonth = function (m) { if (m) { ui().bilanMonth = m; X.rerender(); } };
  window.accBilanCsv = function () {
    var m = ui().bilanMonth || X.shiftMonth(X.month(), -1), d = bilan(m), p = d.p, rows = [['BILAN MENSUEL', X.monthLabel(m), d.closed ? 'Clôturé' : 'Provisoire'], [], ['Indicateur', 'Montant (DA)'],
      ['Chiffre d\'affaires', Math.round(p.revenue)], ['Coût des ventes (USD)', Math.round(p.cost)], ['Marge brute', Math.round(p.grossProfit)], ['Frais (DA)', Math.round(p.expenses)], ['Dépenses USDT (DA)', Math.round(p.usdtExpensesDzd)], ['Résultat net', Math.round(p.netProfit)],
      ['Salaires payés', Math.round(d.payroll)], ['Ventes non encaissées', Math.round(d.unpaidSales)], ['Créances clients (actuelles)', Math.round(d.receivables)], ['Volume USD vendu', d.usd.toFixed(2)], ['Nombre de ventes', d.nTx], [],
      ['Soldes de caisse', 'Montant'], ['Liquide (DA)', Math.round(d.balances.liquide || 0)], ['BaridiMob (DA)', Math.round(d.balances.baridimob || 0)], ['Stock USDT ($)', Number(d.balances.usdt || 0).toFixed(2)], [], ['Frais par catégorie', 'Montant (DA)']];
    Object.keys(d.cats).sort().forEach(function (c) { rows.push([c, Math.round(d.cats[c])]); });
    X.csv(rows, 'bilan_' + m + '.csv');
  };
  window.accBilanDoc = function () {
    var m = ui().bilanMonth || X.shiftMonth(X.month(), -1), d = bilan(m), p = d.p, row = function (l, v, strong, col) { return '<tr style="border-bottom:1px solid ' + X.C.LINE + (strong ? ';background:' + X.C.SOFT + ';font-weight:800' : '') + '"><td style="padding:8px 12px;font-size:12.5px">' + l + '</td><td style="padding:8px 12px;text-align:right;font-size:12.5px;' + (col ? 'color:' + col : '') + '">' + v + '</td></tr>'; };
    var cats = Object.keys(d.cats).sort(function (a, b) { return d.cats[b] - d.cats[a]; }).map(function (c) { return row(E(c), X.fmt(d.cats[c])); }).join('') || '<tr><td colspan="2" style="padding:10px;text-align:center;color:#8a97ab;font-size:12px">Aucun frais</td></tr>';
    var sec = function (t) { return '<div style="margin:18px 0 6px;font-size:12px;font-weight:800;color:' + X.C.BLUE + ';letter-spacing:.6px;text-transform:uppercase">' + t + '</div>'; };
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 40px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('BILAN MENSUEL', X.monthLabel(m) + (d.closed ? ' — clôturé' : ' — provisoire')) +
      sec('Compte de résultat') + '<table style="width:100%;border-collapse:collapse;border:1px solid ' + X.C.LINE + '">' + row('Chiffre d\'affaires (' + d.nTx + ' vente(s))', X.fmt(p.revenue)) + row('− Coût des ventes (USD achetés)', X.fmt(p.cost)) + row('= Marge brute', X.fmt(p.grossProfit), true) + row('− Frais', X.fmt(p.expenses)) + row('− Dépenses USDT', X.fmt(p.usdtExpensesDzd)) + row('= RÉSULTAT NET', X.fmt(p.netProfit), true, p.netProfit < 0 ? '#c2272d' : '#0e7a4b') + '</table>' +
      sec('Frais par catégorie') + '<table style="width:100%;border-collapse:collapse;border:1px solid ' + X.C.LINE + '">' + cats + '</table>' +
      sec('Situation') + '<table style="width:100%;border-collapse:collapse;border:1px solid ' + X.C.LINE + '">' + row('Salaires payés sur la période', X.fmt(d.payroll)) + row('Ventes non encaissées du mois', X.fmt(d.unpaidSales)) + row('Créances clients (à ce jour)', X.fmt(d.receivables)) + row('Volume USD vendu', X.usd(d.usd)) + '</table>' +
      sec('Soldes de caisse' + (d.closed ? ' (à la clôture)' : ' (à ce jour)')) + '<table style="width:100%;border-collapse:collapse;border:1px solid ' + X.C.LINE + '">' + row('Liquide', X.fmt(d.balances.liquide || 0)) + row('BaridiMob', X.fmt(d.balances.baridimob || 0)) + row('Stock USDT', X.usd(d.balances.usdt || 0)) + '</table>' + X.docFooter() + '</div>';
    X.openDoc({ title: 'Bilan ' + X.monthLabel(m), filename: 'bilan_' + m + '.pdf', inner: inner, fixed: false });
  };

  // =====================================================================
  //  RELEVÉ DE COMPTE CLIENT
  // =====================================================================
  function statementData(clientId, from, to) {
    var c = X.find(appState.clients, clientId); if (!c) return null;
    var ev = [];
    (appState.transactions || []).forEach(function (t) {
      if (t.clientId !== clientId || !X.valid(t)) return;
      if ((from && t.date < from) || (to && t.date > to)) return;
      ev.push({ date: t.date, ts: t.createdAt || 0, label: 'Vente — ' + (t.offerName || '') + (t.duration || t.customDurationDays ? ' (' + (t.duration || t.customDurationDays) + ' j)' : ''), debit: Number(t.priceDzd || 0), credit: t.paid ? Number(t.priceDzd || 0) : 0, note: t.paid ? 'réglée' : 'impayée' });
    });
    (appState.payments || []).forEach(function (p) {
      if (p.clientId !== clientId) return;
      if ((from && p.date < from) || (to && p.date > to)) return;
      ev.push({ date: p.date, ts: p.createdAt || 0, label: 'Paiement reçu (' + (p.method || '') + ')' + (p.note ? ' — ' + p.note : ''), debit: 0, credit: Number(p.amount || 0), note: '' });
    });
    ev.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (a.ts - b.ts); });
    var run = 0, td = 0, tc = 0; ev.forEach(function (e) { run += e.debit - e.credit; e.balance = run; td += e.debit; tc += e.credit; });
    return { client: c, rows: ev, debit: td, credit: tc, balance: run };
  }
  function renderStatement() {
    var u = ui(), opts = (appState.clients || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }).map(function (c) { return '<option value="' + E(c.id) + '"' + (c.id === u.stClient ? ' selected' : '') + '>' + E(c.name || 'Client') + (Number(c.unpaid) > 0 ? ' — dette ' + E(X.fmt(c.unpaid)) : '') + '</option>'; }).join('');
    var d = u.stClient ? statementData(u.stClient, u.stFrom || '', u.stTo || '') : null, rows = '';
    if (d) rows = d.rows.map(function (e) { return '<tr><td class="p-3 whitespace-nowrap">' + X.fmtDate(e.date) + '</td><td class="p-3">' + E(e.label) + '</td><td class="p-3 text-right font-mono">' + (e.debit ? X.fmt(e.debit) : '') + '</td><td class="p-3 text-right font-mono text-green-600">' + (e.credit ? X.fmt(e.credit) : '') + '</td><td class="p-3 text-right font-mono font-bold ' + (e.balance > 0 ? 'text-red-600' : 'text-gray-700 dark:text-gray-200') + '">' + X.fmt(e.balance) + '</td></tr>'; }).join('');
    var body = '<div class="flex flex-wrap items-end gap-3 mb-4"><div><label class="block text-xs font-bold text-gray-500 mb-1">Client</label><select onchange="accStClient(this.value)" class="' + X.input + ' min-w-[220px]"><option value="">-- Choisir --</option>' + opts + '</select></div>' +
      '<div><label class="block text-xs font-bold text-gray-500 mb-1">Du</label><input type="date" value="' + E(u.stFrom || '') + '" onchange="accStDate(\'from\',this.value)" class="' + X.input + '"></div><div><label class="block text-xs font-bold text-gray-500 mb-1">Au</label><input type="date" value="' + E(u.stTo || '') + '" onchange="accStDate(\'to\',this.value)" class="' + X.input + '"></div>' +
      (d ? '<span class="flex-1"></span>' + X.btn('WhatsApp', 'accStWa()', 'bg-green-600 hover:bg-green-700 text-white', 'fa-whatsapp') + X.btn('PDF / Imprimer', 'accStDoc()', null, 'fa-file-pdf') : '') + '</div>' +
      (d ? '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Total facturé', X.fmt(d.debit), '', 'fa-file-invoice') + X.kpi('Total réglé', X.fmt(d.credit), 'text-green-600', 'fa-circle-check') + X.kpi('Solde de la période', X.fmt(d.balance), d.balance > 0 ? 'text-red-600' : 'text-gray-700', 'fa-scale-balanced') + X.kpi('Dette enregistrée (fiche)', X.fmt(d.client.unpaid || 0), Number(d.client.unpaid) > 0 ? 'text-red-600' : 'text-green-600', 'fa-user-clock') + '</div>' +
        X.table([['Date'], ['Opération'], ['Débit', 'r'], ['Crédit', 'r'], ['Solde', 'r']], rows, { empty: 'Aucune opération sur cette période' }) : '<p class="text-sm text-gray-400 italic">Choisissez un client pour générer son relevé.</p>');
    return X.card('Relevé de compte client', 'fa-file-lines', body);
  }
  window.accStClient = function (id) { ui().stClient = id; X.rerender(); };
  window.accStDate = function (k, v) { ui()[k === 'from' ? 'stFrom' : 'stTo'] = v; X.rerender(); };
  window.accStDoc = function () {
    var u = ui(), d = statementData(u.stClient, u.stFrom || '', u.stTo || ''); if (!d) return;
    var rows = d.rows.map(function (e) { return '<tr style="border-bottom:1px solid ' + X.C.LINE + '"><td style="padding:7px 10px;font-size:11.5px;white-space:nowrap">' + X.fmtDate(e.date) + '</td><td style="padding:7px;font-size:11.5px">' + E(e.label) + '</td><td style="padding:7px;font-size:11.5px;text-align:right">' + (e.debit ? X.fmt(e.debit) : '') + '</td><td style="padding:7px;font-size:11.5px;text-align:right;color:#0e7a4b">' + (e.credit ? X.fmt(e.credit) : '') + '</td><td style="padding:7px 10px;font-size:11.5px;text-align:right;font-weight:700;color:' + (e.balance > 0 ? '#c2272d' : '#0f2a52') + '">' + X.fmt(e.balance) + '</td></tr>'; }).join('');
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 40px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('RELEVÉ DE COMPTE', 'Édité le ' + X.fmtDate(X.today())) +
      '<div style="background:' + X.C.SOFT + ';border:1px solid ' + X.C.LINE + ';border-radius:10px;padding:12px 18px;margin-bottom:14px"><div style="font-size:11px;font-weight:800;color:' + X.C.BLUE + ';letter-spacing:1px">CLIENT</div><div style="font-size:18px;font-weight:800">' + E(d.client.name) + '</div><div style="font-size:12px;color:#4b5b75">' + E(d.client.phone || d.client.contact || '') + (u.stFrom || u.stTo ? ' · Période : ' + (u.stFrom ? X.fmtDate(u.stFrom) : '…') + ' → ' + (u.stTo ? X.fmtDate(u.stTo) : '…') : '') + '</div></div>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:' + X.C.NAVY + ';color:#fff;font-size:10.5px;text-transform:uppercase"><th style="padding:9px 10px;text-align:left">Date</th><th style="padding:9px;text-align:left">Opération</th><th style="padding:9px;text-align:right">Débit</th><th style="padding:9px;text-align:right">Crédit</th><th style="padding:9px 10px;text-align:right">Solde</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" style="padding:14px;text-align:center;color:#8a97ab">Aucune opération</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;justify-content:flex-end;gap:12px;margin-top:14px"><div style="background:#e9f8f0;color:#0e7a4b;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:800">Total réglé : ' + X.fmt(d.credit) + '</div><div style="background:' + (d.balance > 0 ? '#fdecec' : '#e9f8f0') + ';color:' + (d.balance > 0 ? '#c2272d' : '#0e7a4b') + ';border-radius:8px;padding:8px 14px;font-size:13px;font-weight:800">' + (d.balance > 0 ? 'Reste à payer : ' + X.fmt(d.balance) : 'Compte soldé ✓') + '</div></div>' +
      (getCompanyProfile().showPayment && getCompanyProfile().paymentNote ? '<div style="margin-top:12px;font-size:11.5px;color:#4b5b75"><b>Règlement :</b> ' + E(getCompanyProfile().paymentNote) + '</div>' : '') + X.docFooter() + '</div>';
    X.openDoc({ title: 'Relevé — ' + d.client.name, filename: 'releve_' + String(d.client.name || 'client').replace(/[^\w]+/g, '_') + '.pdf', inner: inner, fixed: false });
  };
  window.accStWa = function () {
    var u = ui(), d = statementData(u.stClient, u.stFrom || '', u.stTo || ''); if (!d) return;
    var P = getCompanyProfile(), last = d.rows.slice(-6).map(function (e) { return X.fmtDate(e.date) + ' — ' + e.label + ' : ' + (e.debit ? X.fmt(e.debit) : '− ' + X.fmt(e.credit)); }).join('\n');
    var txt = 'Bonjour ' + (d.client.name || '') + ',\nVoici votre relevé de compte ' + P.name + ' :\n\n' + last + '\n\nTotal facturé : ' + X.fmt(d.debit) + '\nTotal réglé : ' + X.fmt(d.credit) + '\n' + (d.balance > 0 ? 'Reste à payer : ' + X.fmt(d.balance) : 'Compte soldé ✓') + (P.showPayment && P.paymentNote ? '\n\nRèglement : ' + P.paymentNote : '') + '\n\nMerci de votre confiance.';
    X.openUrl(X.waLink(d.client.phone || d.client.contact, txt));
  };

  // =====================================================================
  //  DEVIS & AVOIRS
  // =====================================================================
  function nextNo(prefix, list, field) {
    var year = X.today().slice(0, 4), p = prefix + '-' + year + '-', max = 0;
    list.forEach(function (q) { if (q[field] && String(q[field]).indexOf(p) === 0) { var n = parseInt(String(q[field]).slice(p.length), 10); if (n > max) max = n; } });
    return p + String(max + 1).padStart(3, '0');
  }
  var QSTAT = { brouillon: ['Brouillon', 'bg-gray-100 text-gray-600'], envoye: ['Envoyé', 'bg-blue-100 text-blue-700'], accepte: ['Accepté', 'bg-green-100 text-green-700'], refuse: ['Refusé', 'bg-red-100 text-red-700'], converti: ['Converti en To-Do', 'bg-indigo-100 text-indigo-700'] };
  function renderQuotes() {
    var quotes = S.list('quotes').slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }), notes = S.list('creditNotes').slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    var cl = (appState.clients || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }).map(function (c) { return '<option value="' + E(c.id) + '">' + E(c.name) + '</option>'; }).join('');
    var of = (appState.offers || []).map(function (o) { return '<option value="' + E(o.id) + '">' + E(o.name) + ' — ' + E(X.fmt(o.priceDzd)) + '</option>'; }).join('');
    var txs = (appState.transactions || []).filter(X.valid).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 80).map(function (t) { return '<option value="' + E(t.id) + '">' + E(X.fmtDate(t.date)) + ' — ' + E(t.clientName || '') + ' — ' + E(X.fmt(t.priceDzd)) + '</option>'; }).join('');
    var qrows = quotes.map(function (q) {
      var st = QSTAT[q.status] || QSTAT.brouillon, id = X.js(q.id);
      return '<tr><td class="p-3 font-mono text-xs">' + E(q.no) + '</td><td class="p-3 whitespace-nowrap">' + X.fmtDate(q.date) + '</td><td class="p-3 font-bold">' + E(q.clientName) + '</td><td class="p-3">' + E(q.offerName) + '</td><td class="p-3 text-right font-mono">' + X.fmt(q.priceDzd) + '</td>' +
        '<td class="p-3 text-center"><select onchange="accQuoteStatus(\'' + id + '\', this.value)" class="' + X.input + ' text-xs">' + Object.keys(QSTAT).map(function (k) { return '<option value="' + k + '"' + (k === q.status ? ' selected' : '') + '>' + QSTAT[k][0] + '</option>'; }).join('') + '</select></td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button onclick="accQuoteDoc(\'' + id + '\')" class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-lg" title="PDF"><i class="fas fa-file-pdf"></i></button><button onclick="accQuoteConvert(\'' + id + '\')" class="px-2 py-1 text-green-600 hover:bg-green-50 rounded-lg" title="Convertir en To-Do"><i class="fas fa-right-left"></i></button><button onclick="accQuoteDelete(\'' + id + '\')" class="px-2 py-1 text-red-400 hover:bg-red-50 rounded-lg" title="Supprimer"><i class="fas fa-trash-alt"></i></button></td></tr>';
    }).join('');
    var nrows = notes.map(function (n) { var id = X.js(n.id); return '<tr><td class="p-3 font-mono text-xs">' + E(n.no) + '</td><td class="p-3 whitespace-nowrap">' + X.fmtDate(n.date) + '</td><td class="p-3 font-bold">' + E(n.clientName) + '</td><td class="p-3 text-xs text-gray-500">' + E(n.invoiceRef) + '</td><td class="p-3">' + E(n.reason) + '</td><td class="p-3 text-right font-mono text-red-600">− ' + X.fmt(n.amount) + '</td><td class="p-3 text-right whitespace-nowrap"><button onclick="accCreditDoc(\'' + id + '\')" class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-lg" title="PDF"><i class="fas fa-file-pdf"></i></button><button onclick="accCreditDelete(\'' + id + '\')" class="px-2 py-1 text-red-400 hover:bg-red-50 rounded-lg"><i class="fas fa-trash-alt"></i></button></td></tr>'; }).join('');
    var inp = X.input + ' w-full';
    var q = '<div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4"><select id="qClient" class="' + inp + '"><option value="">Client…</option>' + cl + '</select><select id="qOffer" class="' + inp + '" onchange="accQuoteOffer()"><option value="">Offre personnalisée…</option>' + of + '</select><input id="qLabel" class="' + inp + '" placeholder="Désignation (offre perso)"><input id="qPrice" type="number" class="' + inp + '" placeholder="Prix (DA)">' +
      '<input id="qUsd" type="number" class="' + inp + '" placeholder="Budget ($)"><input id="qDays" type="number" class="' + inp + '" placeholder="Durée (jours)"><input id="qValid" type="number" class="' + inp + '" value="15" placeholder="Validité (jours)"><input id="qNote" class="' + inp + '" placeholder="Remarque (optionnel)"></div>' + X.btn('Créer le devis', 'accQuoteCreate()', null, 'fa-plus');
    var c = '<div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4"><select id="cnTx" class="' + inp + ' md:col-span-2"><option value="">Facture / vente concernée…</option>' + txs + '</select><input id="cnAmount" type="number" class="' + inp + '" placeholder="Montant à créditer (DA)"><input id="cnReason" class="' + inp + '" placeholder="Motif (ex : campagne non livrée)"></div>' + X.btn('Créer l\'avoir', 'accCreditCreate()', null, 'fa-plus') +
      '<p class="text-[11px] text-gray-400 mt-2">L\'avoir est un <b>document</b> (numéroté, imprimable). Il ne modifie ni la dette du client ni les caisses : ajustez-les séparément si besoin (paiement, modification de la transaction).</p>';
    return X.card('Devis', 'fa-file-signature', q + '<div class="mt-5"></div>' + X.table([['N°'], ['Date'], ['Client'], ['Offre'], ['Montant', 'r'], ['Statut', 'c'], ['', 'r']], qrows, { empty: 'Aucun devis' })) +
      X.card('Avoirs (notes de crédit)', 'fa-file-circle-minus', c + '<div class="mt-5"></div>' + X.table([['N°'], ['Date'], ['Client'], ['Réf. facture'], ['Motif'], ['Montant', 'r'], ['', 'r']], nrows, { empty: 'Aucun avoir' }));
  }
  window.accQuoteOffer = function () { var o = X.find(appState.offers, val('qOffer')); if (!o) return; document.getElementById('qPrice').value = o.priceDzd || ''; document.getElementById('qDays').value = o.duration || ''; document.getElementById('qLabel').value = o.name || ''; };
  window.accQuoteCreate = function () {
    var c = X.find(appState.clients, val('qClient')), price = Number(val('qPrice')), label = val('qLabel').trim();
    if (!c) return X.toast('Choisissez un client', 'error'); if (!(price > 0)) return X.toast('Prix invalide', 'error'); if (!label) return X.toast('Désignation requise', 'error');
    var list = S.list('quotes');
    list.push({ id: X.uid('quote'), no: nextNo('DEV', list, 'no'), ts: Date.now(), date: X.today(), validDays: Number(val('qValid')) || 15, clientId: c.id, clientName: c.name, offerId: val('qOffer'), offerName: label, priceDzd: price, usd: Number(val('qUsd')) || 0, days: Number(val('qDays')) || 0, note: val('qNote').trim(), status: 'brouillon', by: X.actor() });
    X.log('Devis créé', c.name + ' — ' + label + ' — ' + X.fmt(price)); X.save(); X.rerender(); X.toast('Devis créé', 'success');
  };
  window.accQuoteStatus = function (id, st) { var q = X.find(S.list('quotes'), id); if (!q) return; q.status = st; X.log('Statut du devis ' + q.no, st); X.save(); X.rerender(); };
  window.accQuoteDelete = function (id) { var l = S.list('quotes'), q = X.find(l, id); if (!q || !confirm('Supprimer le devis ' + q.no + ' ?')) return; l.splice(l.indexOf(q), 1); X.log('Devis supprimé', q.no); X.save(); X.rerender(); };
  window.accQuoteDoc = function (id) {
    var q = X.find(S.list('quotes'), id); if (!q) return; var P = getCompanyProfile(), until = X.addDays(q.date, q.validDays || 15), c = X.find(appState.clients, q.clientId) || {};
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 40px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('DEVIS', q.no + ' · ' + X.fmtDate(q.date)) +
      '<div style="display:flex;gap:14px"><div style="flex:1;background:' + X.C.SOFT + ';border:1px solid ' + X.C.LINE + ';border-radius:10px;padding:12px 16px"><div style="font-size:11px;font-weight:800;color:' + X.C.BLUE + '">DESTINATAIRE</div><div style="font-size:17px;font-weight:800">' + E(q.clientName) + '</div><div style="font-size:12px;color:#4b5b75">' + E(c.phone || c.contact || '') + '</div></div><div style="flex:1;background:' + X.C.SOFT + ';border:1px solid ' + X.C.LINE + ';border-radius:10px;padding:12px 16px"><div style="font-size:11px;font-weight:800;color:' + X.C.BLUE + '">VALIDITÉ</div><div style="font-size:15px;font-weight:800">Jusqu\'au ' + X.fmtDate(until) + '</div><div style="font-size:12px;color:#4b5b75">(' + (q.validDays || 15) + ' jours)</div></div></div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:20px;border:1px solid ' + X.C.LINE + '"><thead><tr style="background:' + X.C.NAVY + ';color:#fff;font-size:11px;text-transform:uppercase"><th style="padding:11px 14px;text-align:left">Désignation</th><th style="padding:11px;text-align:center">Durée</th><th style="padding:11px;text-align:right">Budget</th><th style="padding:11px 14px;text-align:right">Montant (DA)</th></tr></thead><tbody><tr><td style="padding:14px;font-size:14px;font-weight:700">' + E(q.offerName) + (q.note ? '<div style="font-size:11.5px;font-weight:400;color:#4b5b75;margin-top:4px">' + E(q.note) + '</div>' : '') + '</td><td style="padding:14px;text-align:center;font-size:13px">' + (q.days ? q.days + ' jours' : '—') + '</td><td style="padding:14px;text-align:right;font-size:13px">' + (q.usd ? X.usd(q.usd) : '—') + '</td><td style="padding:14px;text-align:right;font-size:16px;font-weight:800">' + X.fmt(q.priceDzd) + '</td></tr></tbody></table>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:16px"><div style="background:' + X.C.BLUE + ';color:#fff;border-radius:10px;padding:12px 24px;font-size:20px;font-weight:900">TOTAL : ' + X.fmt(q.priceDzd) + '</div></div>' +
      (typeof amountToFrenchDinars === 'function' ? '<div style="font-size:11.5px;color:#34445f;margin-top:8px;text-align:right">Arrêté le présent devis à la somme de : <i>' + E(amountToFrenchDinars(q.priceDzd)) + '</i></div>' : '') +
      '<div style="margin-top:22px;font-size:12px;color:#34445f;line-height:1.7"><b>Conditions :</b> devis valable ' + (q.validDays || 15) + ' jours.' + (P.showPayment && P.paymentNote ? ' Règlement : ' + E(P.paymentNote) + '.' : '') + '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:30px;gap:40px"><div style="flex:1;text-align:center;font-size:12px;font-weight:800">Bon pour accord (client)<div style="height:56px;border-bottom:1px dashed #9fb0c9;margin-top:6px"></div></div><div style="flex:1;text-align:center;font-size:12px;font-weight:800">' + E(P.name) + '<div style="height:56px;border-bottom:1px dashed #9fb0c9;margin-top:6px"></div></div></div>' + X.docFooter() + '</div>';
    X.openDoc({ title: 'Devis ' + q.no, filename: q.no + '.pdf', inner: inner, fixed: false });
  };
  window.accQuoteConvert = function (id) {
    var q = X.find(S.list('quotes'), id); if (!q) return;
    if (typeof showTab === 'function') showTab('todo');
    setTimeout(function () {
      var opt = document.querySelector('.client-option[data-id="' + String(q.clientId).replace(/"/g, '') + '"]');
      if (opt && typeof selectClient === 'function') selectClient(opt);
      var sel = document.getElementById('todoOfferId');
      if (sel && q.offerId && X.find(appState.offers, q.offerId)) { sel.value = q.offerId; if (typeof updateTodoPrice === 'function') updateTodoPrice(); }
      var price = document.getElementById('todoPrice'); if (price) price.value = q.priceDzd;
      X.toast('Formulaire pré-rempli depuis le devis ' + q.no + ' — vérifiez puis validez', 'info');
    }, 150);
    q.status = 'converti'; X.log('Devis converti en To-Do', q.no); X.save();
  };
  window.accCreditCreate = function () {
    var t = X.find(appState.transactions, val('cnTx')), amt = Number(val('cnAmount')), reason = val('cnReason').trim();
    if (!t) return X.toast('Choisissez la facture / vente', 'error'); if (!(amt > 0)) return X.toast('Montant invalide', 'error'); if (amt > Number(t.priceDzd || 0)) return X.toast('Le montant dépasse celui de la vente', 'error'); if (!reason) return X.toast('Motif requis', 'error');
    var list = S.list('creditNotes');
    list.push({ id: X.uid('cn'), no: nextNo('AV', list, 'no'), ts: Date.now(), date: X.today(), txId: t.id, clientId: t.clientId, clientName: t.clientName, invoiceRef: t.invoiceNo || ('INV-' + String(t.date || '').split('-').join('') + '-' + String(t.id).slice(-6)), amount: amt, reason: reason, by: X.actor() });
    X.log('Avoir créé', (t.clientName || '') + ' — ' + X.fmt(amt) + ' — ' + reason); X.save(); X.rerender(); X.toast('Avoir créé', 'success');
  };
  window.accCreditDelete = function (id) { var l = S.list('creditNotes'), n = X.find(l, id); if (!n || !confirm('Supprimer l\'avoir ' + n.no + ' ?')) return; l.splice(l.indexOf(n), 1); X.log('Avoir supprimé', n.no); X.save(); X.rerender(); };
  window.accCreditDoc = function (id) {
    var n = X.find(S.list('creditNotes'), id); if (!n) return;
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 40px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('AVOIR', n.no + ' · ' + X.fmtDate(n.date)) +
      '<div style="background:' + X.C.SOFT + ';border:1px solid ' + X.C.LINE + ';border-radius:10px;padding:14px 18px"><div style="font-size:11px;font-weight:800;color:' + X.C.BLUE + '">CLIENT</div><div style="font-size:18px;font-weight:800">' + E(n.clientName) + '</div><div style="font-size:12px;color:#4b5b75">Se rapporte à la facture : <b>' + E(n.invoiceRef) + '</b></div></div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:20px;border:1px solid ' + X.C.LINE + '"><thead><tr style="background:' + X.C.NAVY + ';color:#fff;font-size:11px;text-transform:uppercase"><th style="padding:11px 14px;text-align:left">Motif de l\'avoir</th><th style="padding:11px 14px;text-align:right">Montant crédité (DA)</th></tr></thead><tbody><tr><td style="padding:16px 14px;font-size:14px">' + E(n.reason) + '</td><td style="padding:16px 14px;text-align:right;font-size:18px;font-weight:800;color:#c2272d">− ' + X.fmt(n.amount) + '</td></tr></tbody></table>' +
      (typeof amountToFrenchDinars === 'function' ? '<div style="font-size:11.5px;color:#34445f;margin-top:10px;text-align:right">Arrêté le présent avoir à la somme de : <i>' + E(amountToFrenchDinars(n.amount)) + '</i></div>' : '') + X.docFooter() + '</div>';
    X.openDoc({ title: 'Avoir ' + n.no, filename: n.no + '.pdf', inner: inner, fixed: false });
  };

  // =====================================================================
  //  PROFIL ENTREPRISE
  // =====================================================================
  function renderProfile() {
    var P = getCompanyProfile(), f = function (id, label, v, ph) { return '<div><label class="block text-xs font-bold text-gray-500 mb-1">' + label + '</label><input id="pf-' + id + '" value="' + E(v) + '" placeholder="' + E(ph || '') + '" class="' + X.input + ' w-full"></div>'; };
    var body = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">' + f('name', 'Nom de l\'entreprise', P.name) + f('tagline', 'Activité (sous-titre)', P.tagline) + f('email', 'E-mail', P.email) + f('phone', 'Téléphone', P.phone) + f('address1', 'Adresse (ligne 1)', P.address1) + f('address2', 'Adresse (ligne 2)', P.address2) +
      f('nif', 'NIF', P.nif, 'optionnel') + f('rc', 'N° registre de commerce (RC)', P.rc, 'optionnel') + f('nis', 'NIS', P.nis, 'optionnel') + f('ai', 'Article d\'imposition (AI)', P.ai, 'optionnel') + '</div>' +
      '<div class="mb-4">' + f('legalNote', 'Mention légale en bas des documents', P.legalNote, 'optionnel — à valider avec votre comptable') + '</div>' +
      '<div class="mb-4"><label class="block text-xs font-bold text-gray-500 mb-1">Moyens de paiement affichés sur facture / devis / relevé</label><input id="pf-paymentNote" value="' + E(P.paymentNote) + '" placeholder="ex : CCP 0044032948 clé 28 — BaridiMob 0079… " class="' + X.input + ' w-full"><label class="flex items-center gap-2 mt-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="pf-showPayment" ' + (P.showPayment ? 'checked' : '') + '> Afficher ces informations sur les documents</label></div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"><div><label class="block text-xs font-bold text-gray-500 mb-1">Numérotation des factures</label><select id="pf-invoiceNumbering" class="' + X.input + ' w-full"><option value="legacy"' + (P.invoiceNumbering !== 'sequential' ? ' selected' : '') + '>Actuelle (INV-date-identifiant) — inchangée</option><option value="sequential"' + (P.invoiceNumbering === 'sequential' ? ' selected' : '') + '>Séquentielle (FAC-2026-0001, figée à la 1ère émission)</option></select><p class="text-[11px] text-gray-400 mt-1">La séquentielle ne s\'applique qu\'aux factures ouvertes après activation ; les anciennes gardent leur numéro.</p></div>' +
      '<div><label class="block text-xs font-bold text-gray-500 mb-1">Lien paie ↔ caisses</label><label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" id="pf-payrollLink" class="mt-1" ' + (S.get('payrollLink', false) ? 'checked' : '') + '><span>Enregistrer automatiquement chaque salaire <b>payé</b> dans les Frais (catégorie « Salaires »), ce qui le déduit de la caisse.<br><span class="text-[11px] text-amber-600">⚠ À n\'activer que si vos salaires ne sont pas déjà saisis en Frais ou en charges fixes (risque de doublon).</span></span></label></div></div>' +
      X.btn('Enregistrer le profil', 'accProfileSave()', null, 'fa-check');
    return X.card('Profil entreprise & réglages', 'fa-building', body);
  }
  window.accProfileSave = function () {
    var g = function (id) { var el = document.getElementById('pf-' + id); return el ? el.value.trim() : ''; }, P = {};
    ['name', 'tagline', 'email', 'phone', 'address1', 'address2', 'nif', 'rc', 'nis', 'ai', 'legalNote', 'paymentNote', 'invoiceNumbering'].forEach(function (k) { P[k] = g(k); });
    if (!P.name) return X.toast('Le nom est requis', 'error');
    P.showPayment = document.getElementById('pf-showPayment').checked;
    S.set('profile', P, true); S.set('payrollLink', document.getElementById('pf-payrollLink').checked, true);
    X.log('Profil entreprise modifié', P.name + ' — numérotation ' + P.invoiceNumbering + ' — lien paie↔caisses ' + (S.get('payrollLink') ? 'activé' : 'désactivé')); X.save(); X.toast('Profil enregistré', 'success'); X.rerender();
  };

  // =====================================================================
  //  ONGLET
  // =====================================================================
  var SUBS = [['ledger', 'Livre de caisse', 'fa-book'], ['recon', 'Rapprochement', 'fa-scale-balanced'], ['closures', 'Clôtures', 'fa-lock'], ['budget', 'Budget', 'fa-chart-pie'], ['bilan', 'Bilan mensuel', 'fa-file-invoice-dollar'], ['statement', 'Relevé client', 'fa-file-lines'], ['quotes', 'Devis & avoirs', 'fa-file-signature'], ['profile', 'Profil & réglages', 'fa-building']];
  window.accSub = function (s) { ui().sub = s; X.rerender(); };
  X.registerTab('accounting', {
    nav: { group: 'compta', groupLabel: 'Comptabilité', groupIcon: 'fa-calculator', label: 'Comptabilité', icon: 'fa-calculator' },
    render: function (c) {
      var sub = ui().sub, fn = { ledger: renderLedger, recon: renderRecon, closures: renderClosures, budget: renderBudget, bilan: renderBilan, statement: renderStatement, quotes: renderQuotes, profile: renderProfile }[sub] || renderLedger;
      c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-calculator text-indigo-600 mr-2"></i>Comptabilité</h2><p class="text-xs text-gray-500 mt-1">Livre de caisse, clôtures, bilans, documents clients — ajoutés sans modifier vos calculs existants.</p></div>' + X.pills(SUBS, sub, 'accSub') + fn();
    }
  });
  window.AccountingCore = { buildLedger: buildLedger, bilan: bilan, statementData: statementData, guardDate: guardDate };
})();
