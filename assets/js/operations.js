// =====================================================================
//  OPERATIONS.JS — onglet « Pilotage » (phase 3)
//  Cycle de vie des campagnes · Rentabilité · Dettes & risque · Comptes pub · Objectifs & qualité
//  + Rapport PDF des résultats Meta. Lecture des données existantes ; nouvelles données dans ExtStore.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;

  function ui() { if (!appState.ui) appState.ui = {}; if (!appState.ui.ops) appState.ui.ops = {}; var u = appState.ui.ops; if (!u.sub) u.sub = 'camp'; return u; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function daysOf(t) { var n = Number(String(t.duration || t.customDurationDays || '').trim()); return Number.isFinite(n) && n > 0 ? n : 0; }

  // =====================================================================
  //  CAMPAGNES
  // =====================================================================
  function campaigns() {
    var today = X.today();
    return (appState.transactions || []).filter(function (t) { return t && (t.status === 'active' || !t.status) && X.isYmd(t.date) && daysOf(t) > 0; }).map(function (t) {
      var end = X.addDays(t.date, daysOf(t) - 1), st = today < t.date ? 'planned' : (today > end ? 'ended' : 'running');
      return { t: t, start: t.date, end: end, status: st, left: X.daysBetween(today, end), sinceEnd: X.daysBetween(end, today) };
    }).sort(function (a, b) { return a.end.localeCompare(b.end); });
  }
  window.OpsCampaigns = campaigns;
  var CSTAT = { planned: ['Planifiée', 'bg-blue-100 text-blue-700'], running: ['En cours', 'bg-green-100 text-green-700'], ended: ['Terminée', 'bg-gray-100 text-gray-600'] };
  function renewalMsg(t) {
    var c = X.find(appState.clients, t.clientId) || {}, P = getCompanyProfile(), end = X.addDays(t.date, daysOf(t) - 1);
    return 'Bonjour ' + (t.clientName || c.name || '') + ',\nVotre campagne « ' + (t.offerName || '') + ' » ' + (end < X.today() ? 's\'est terminée le ' : 'se termine le ') + X.fmtDate(end) + '.\nSouhaitez-vous la renouveler pour continuer à profiter de vos résultats ?\n\nMerci de votre confiance — ' + P.name;
  }
  function renderCampaigns() {
    var u = ui(), f = u.campFilter || 'active', all = campaigns(), ren = S.map('renewals');
    var list = all.filter(function (c) { return f === 'all' ? true : (f === 'active' ? (c.status === 'running' || c.status === 'planned') : (f === 'ending' ? (c.status === 'running' && c.left <= 2) : (f === 'toRenew' ? (c.status === 'ended' && c.sinceEnd <= 14 && !(ren[c.t.id] && (ren[c.t.id].status === 'renewed' || ren[c.t.id].status === 'declined'))) : c.status === f))); });
    var cnt = { running: 0, ending: 0, ended: 0, toRenew: 0 };
    all.forEach(function (c) { if (c.status === 'running') { cnt.running++; if (c.left <= 2) cnt.ending++; } if (c.status === 'ended' && c.sinceEnd <= 14 && !(ren[c.t.id] && (ren[c.t.id].status === 'renewed' || ren[c.t.id].status === 'declined'))) cnt.toRenew++; });
    var chips = [['active', 'Actives'], ['ending', 'Se terminent bientôt (≤ 2 j)'], ['toRenew', 'À relancer pour renouvellement'], ['ended', 'Terminées'], ['all', 'Toutes']].map(function (k) { return '<button onclick="opsCampFilter(\'' + k[0] + '\')" class="px-3 py-2 rounded-xl text-xs font-bold ' + (k[0] === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200') + '">' + k[1] + '</button>'; }).join(' ');
    var rows = list.slice(0, 200).map(function (c) {
      var t = c.t, st = CSTAT[c.status], r = ren[t.id], id = X.js(t.id), acc = t.adAccountId ? ((X.find(appState.adAccounts, t.adAccountId) || {}).name || 'Inconnu') : 'Organique';
      var when = c.status === 'running' ? (c.left === 0 ? '<b class="text-red-600">se termine aujourd\'hui</b>' : (c.left <= 2 ? '<b class="text-amber-600">J−' + c.left + '</b>' : 'J−' + c.left)) : (c.status === 'ended' ? 'il y a ' + c.sinceEnd + ' j' : 'dans ' + X.daysBetween(X.today(), c.start) + ' j');
      var rs = r ? '<span class="px-2 py-1 rounded-full text-[10px] font-black ' + (r.status === 'renewed' ? 'bg-green-100 text-green-700' : (r.status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')) + '">' + (r.status === 'renewed' ? 'Renouvelée' : (r.status === 'declined' ? 'Refusée' : 'Relancé ' + X.fmtDate(String(r.date || '').slice(0, 10))) ) + '</span>' : '';
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(t.clientName) + '<div class="text-[11px] font-normal text-gray-400">' + E(t.offerName) + '</div></td><td class="p-3 text-xs">' + E(acc) + '</td>' +
        '<td class="p-3 whitespace-nowrap text-xs">' + X.fmtDate(c.start) + ' → ' + X.fmtDate(c.end) + '<div class="text-[11px] text-gray-400">' + when + '</div></td><td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-[10px] font-black ' + st[1] + '">' + st[0] + '</span></td><td class="p-3 text-xs">' + E(t.launchedByName || t.employeeName || 'Admin') + '</td><td class="p-3 text-center">' + (t.paid ? '<span class="text-green-600 font-black text-xs">Payé</span>' : '<span class="text-red-600 font-black text-xs">Impayé</span>') + '</td><td class="p-3 text-center">' + rs + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button onclick="opsRenewWa(\'' + id + '\')" class="px-2 py-1 text-green-600 hover:bg-green-50 rounded-lg" title="Relancer par WhatsApp (renouvellement)"><i class="fab fa-whatsapp"></i></button><button onclick="opsRenewSet(\'' + id + '\',\'renewed\')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Marquer renouvelée"><i class="fas fa-rotate"></i></button><button onclick="opsRenewSet(\'' + id + '\',\'declined\')" class="px-2 py-1 text-gray-400 hover:bg-gray-100 rounded-lg" title="Refusée / pas de renouvellement"><i class="fas fa-ban"></i></button></td></tr>';
    }).join('');
    var body = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('En cours', String(cnt.running), 'text-green-600', 'fa-play') + X.kpi('Se terminent (≤ 2 j)', String(cnt.ending), cnt.ending ? 'text-amber-600' : '', 'fa-hourglass-end') + X.kpi('À relancer (renouvellement)', String(cnt.toRenew), cnt.toRenew ? 'text-red-600' : '', 'fa-rotate') + X.kpi('Terminées (total)', String(all.filter(function (c) { return c.status === 'ended'; }).length), 'text-gray-600', 'fa-flag-checkered') + '</div><div class="flex flex-wrap gap-2 mb-4">' + chips + '</div>' +
      X.table([['Client / offre'], ['Compte pub'], ['Période'], ['Statut', 'c'], ['Lancé par'], ['Paiement', 'c'], ['Renouvellement', 'c'], ['', 'r']], rows, { empty: 'Aucune campagne dans cette vue' }) +
      '<p class="text-[11px] text-gray-400 mt-2">La période est calculée comme sur les factures : début + (durée − 1) jours. Seules les ventes validées avec une durée sont listées.</p>';
    return X.card('Cycle de vie des campagnes', 'fa-bullhorn', body);
  }
  window.opsCampFilter = function (f) { ui().campFilter = f; X.rerender(); };
  window.opsRenewWa = function (id) {
    var t = X.find(appState.transactions, id); if (!t) return; var c = X.find(appState.clients, t.clientId) || {};
    X.openUrl(X.waLink(c.phone || c.contact, renewalMsg(t)));
    var r = S.map('renewals'); if (!r[id] || r[id].status === 'contacted') r[id] = { status: 'contacted', date: new Date().toISOString() };
    X.log('Relance de renouvellement', (t.clientName || '') + ' — ' + (t.offerName || '')); X.save(); X.rerender();
  };
  window.opsRenewSet = function (id, st) { var t = X.find(appState.transactions, id); if (!t) return; S.map('renewals')[id] = { status: st, date: new Date().toISOString() }; X.log('Renouvellement : ' + (st === 'renewed' ? 'accepté' : 'refusé'), (t.clientName || '') + ' — ' + (t.offerName || '')); X.save(); X.rerender(); };

  // =====================================================================
  //  RENTABILITÉ
  // =====================================================================
  function profitRows(group, from, to) {
    var g = {};
    (appState.transactions || []).forEach(function (t) {
      if (!X.valid(t) || !X.isYmd(t.date) || t.date < from || t.date > to) return;
      var key = group === 'offer' ? (t.offerName || '—') : (group === 'client' ? (t.clientName || '—') : (group === 'ad' ? (t.adAccountId ? ((X.find(appState.adAccounts, t.adAccountId) || {}).name || 'Compte inconnu') : 'Organique') : (t.launchedByName || t.employeeName || 'Admin')));
      var r = g[key] || (g[key] = { key: key, n: 0, rev: 0, cost: 0, unpaid: 0, usd: 0 });
      r.n++; r.rev += Number(t.priceDzd || 0); r.cost += X.txCost(t); r.usd += Number(t.amount || 0); if (!t.paid) r.unpaid += Number(t.priceDzd || 0);
    });
    return Object.keys(g).map(function (k) { var r = g[k]; r.margin = r.rev - r.cost; r.pct = r.rev > 0 ? r.margin / r.rev * 100 : 0; return r; }).sort(function (a, b) { return b.margin - a.margin; });
  }
  window.OpsProfit = profitRows;
  function renderProfit() {
    var u = ui(), grp = u.profGroup || 'offer', m = u.profMonth === undefined ? X.month() : u.profMonth, rg = m ? X.monthRange(m) : { from: '0000-01-01', to: '9999-12-31' };
    var rows = profitRows(grp, rg.from, rg.to), tot = rows.reduce(function (s, r) { s.n += r.n; s.rev += r.rev; s.cost += r.cost; s.unpaid += r.unpaid; return s; }, { n: 0, rev: 0, cost: 0, unpaid: 0 }), maxM = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.margin); }).concat([1]));
    var groups = [['offer', 'Par offre'], ['client', 'Par client'], ['ad', 'Par compte pub'], ['emp', 'Par employé']].map(function (k) { return '<button onclick="opsProfGroup(\'' + k[0] + '\')" class="px-3 py-2 rounded-xl text-sm font-bold ' + (k[0] === grp ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200') + '">' + k[1] + '</button>'; }).join(' ');
    var html = rows.map(function (r) {
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(r.key) + '</td><td class="p-3 text-right">' + r.n + '</td><td class="p-3 text-right font-mono">' + X.fmt(r.rev) + '</td><td class="p-3 text-right font-mono text-gray-500">' + X.fmt(r.cost) + '</td><td class="p-3 text-right font-mono font-black ' + (r.margin < 0 ? 'text-red-600' : 'text-green-600') + '">' + X.fmt(r.margin) + '</td><td class="p-3 text-right text-xs font-bold ' + (r.pct < 10 ? 'text-red-600' : 'text-gray-600') + '">' + r.pct.toFixed(1) + ' %</td>' +
        '<td class="p-3 text-right font-mono ' + (r.unpaid ? 'text-amber-600' : 'text-gray-400') + '">' + (r.unpaid ? X.fmt(r.unpaid) : '—') + '</td><td class="p-3" style="min-width:110px"><div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"><div class="h-full ' + (r.margin < 0 ? 'bg-red-500' : 'bg-green-500') + '" style="width:' + Math.round(Math.abs(r.margin) / maxM * 100) + '%"></div></div></td></tr>';
    }).join('');
    var foot = '<tfoot><tr class="bg-gray-50 dark:bg-gray-900 font-black"><td class="p-3">TOTAL</td><td class="p-3 text-right">' + tot.n + '</td><td class="p-3 text-right font-mono">' + X.fmt(tot.rev) + '</td><td class="p-3 text-right font-mono">' + X.fmt(tot.cost) + '</td><td class="p-3 text-right font-mono">' + X.fmt(tot.rev - tot.cost) + '</td><td class="p-3 text-right">' + (tot.rev ? ((tot.rev - tot.cost) / tot.rev * 100).toFixed(1) + ' %' : '—') + '</td><td class="p-3 text-right font-mono">' + X.fmt(tot.unpaid) + '</td><td></td></tr></tfoot>';
    var body = '<div class="flex flex-wrap items-center gap-2 mb-4">' + groups + '<input type="month" value="' + E(m) + '" onchange="opsProfMonth(this.value)" class="' + X.input + '"><button onclick="opsProfMonth(\'\')" class="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Tout l\'historique</button><span class="flex-1"></span>' + X.btn('CSV', 'opsProfCsv()', 'border dark:border-gray-600 text-gray-700 dark:text-gray-200', 'fa-file-csv') + '</div>' +
      X.table([['Groupe'], ['Ventes', 'r'], ['CA', 'r'], ['Coût USD', 'r'], ['Marge', 'r'], ['Marge %', 'r'], ['Impayé', 'r'], ['']], html, { foot: foot, empty: 'Aucune vente sur cette période' }) + '<p class="text-[11px] text-gray-400 mt-2">Coût = dollars vendus × taux d\'achat de la vente (taux figé pour les nouvelles ventes, taux global pour les anciennes). Hors frais généraux. Les ventes en « problème » sont exclues.</p>';
    return X.card('Rentabilité', 'fa-chart-column', body);
  }
  window.opsProfGroup = function (g) { ui().profGroup = g; X.rerender(); };
  window.opsProfMonth = function (m) { ui().profMonth = m || ''; X.rerender(); };
  window.opsProfCsv = function () { var u = ui(), grp = u.profGroup || 'offer', m = u.profMonth === undefined ? X.month() : u.profMonth, rg = m ? X.monthRange(m) : { from: '0000-01-01', to: '9999-12-31' }; var out = [['Groupe', 'Ventes', 'CA (DA)', 'Coût (DA)', 'Marge (DA)', 'Marge %', 'Impayé (DA)']]; profitRows(grp, rg.from, rg.to).forEach(function (r) { out.push([r.key, r.n, Math.round(r.rev), Math.round(r.cost), Math.round(r.margin), r.pct.toFixed(1), Math.round(r.unpaid)]); }); X.csv(out, 'rentabilite_' + grp + '_' + (m || 'tout') + '.csv'); };

  // =====================================================================
  //  DETTES & RISQUE
  // =====================================================================
  function debtors() {
    var today = X.today();
    return (appState.clients || []).filter(function (c) { return c && Number(c.unpaid || 0) > 0; }).map(function (c) {
      var since = c.debtStartDate || (c.updatedAt ? X.ymdOf(new Date(c.updatedAt)) : today), age = Math.max(0, X.daysBetween(since, today)), m = X.meta(c.id);
      return { c: c, since: since, age: age, bucket: age <= 7 ? 0 : (age <= 30 ? 1 : 2), meta: m, promiseLate: !!(m.promiseDate && m.promiseDate < today) };
    }).sort(function (a, b) { return b.age - a.age; });
  }
  window.OpsDebtors = debtors;
  var BUCKETS = [['0 – 7 jours', 'bg-green-50 border-green-200 text-green-700'], ['8 – 30 jours', 'bg-amber-50 border-amber-200 text-amber-700'], ['plus de 30 jours', 'bg-red-50 border-red-200 text-red-700']];
  function debtCardsHtml() {
    var d = debtors(), tot = [0, 0, 0], cnt = [0, 0, 0]; d.forEach(function (x) { tot[x.bucket] += Number(x.c.unpaid || 0); cnt[x.bucket]++; });
    var cards = BUCKETS.map(function (b, i) { return '<div class="rounded-2xl border p-4 ' + b[1] + '"><div class="text-[11px] font-black uppercase">' + b[0] + '</div><div class="text-xl font-black mt-1">' + X.fmt(tot[i]) + '</div><div class="text-xs opacity-80">' + cnt[i] + ' client(s)</div></div>'; }).join('');
    var rows = d.slice(0, 100).map(function (x) {
      var c = x.c, m = x.meta, id = X.js(c.id), over = m.creditLimit && Number(c.unpaid) > Number(m.creditLimit);
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(c.name) + '</td><td class="p-3 text-right font-mono font-black text-red-600">' + X.fmt(c.unpaid) + '</td><td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-[10px] font-black ' + BUCKETS[x.bucket][1] + '">' + x.age + ' j</span></td>' +
        '<td class="p-3 text-xs">' + (m.promiseDate ? '<span class="' + (x.promiseLate ? 'text-red-600 font-black' : 'text-gray-700 dark:text-gray-200') + '">' + X.fmtDate(m.promiseDate) + (x.promiseLate ? ' (dépassée)' : '') + '</span>' + (m.promiseAmount ? '<div class="text-gray-400">' + X.fmt(m.promiseAmount) + '</div>' : '') : '<span class="text-gray-300">—</span>') + '</td>' +
        '<td class="p-3 text-xs text-right">' + (m.creditLimit ? '<span class="' + (over ? 'text-red-600 font-black' : '') + '">' + X.fmt(m.creditLimit) + (over ? ' ⚠' : '') + '</span>' : '<span class="text-gray-300">—</span>') + '</td>' +
        '<td class="p-3 text-xs">' + (m.nextFollowUp ? X.fmtDate(m.nextFollowUp) : '<span class="text-gray-300">—</span>') + (m.lastReminder ? '<div class="text-gray-400">dernière relance : ' + X.fmtDate(String(m.lastReminder).slice(0, 10)) + '</div>' : '') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button onclick="opsDebtWa(\'' + id + '\')" class="px-2 py-1 text-green-600 hover:bg-green-50 rounded-lg" title="Relance WhatsApp adaptée à l\'ancienneté"><i class="fab fa-whatsapp"></i></button><button onclick="opsDebtForm(\'' + id + '\')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Promesse / plafond / relance"><i class="fas fa-pen"></i></button></td></tr>';
    }).join('');
    return '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">' + cards + '</div>' + X.table([['Client'], ['Dette', 'r'], ['Ancienneté', 'c'], ['Promesse de paiement'], ['Plafond', 'r'], ['Prochaine relance'], ['', 'r']], rows, { empty: 'Aucune créance en cours 🎉' });
  }
  function renderDebts() {
    var body = debtCardsHtml() + '<p class="text-[11px] text-gray-400 mt-2">Plafond de crédit : lors de la création d\'une To-Do <b>non payée</b>, un avertissement s\'affiche si la dette du client dépasserait son plafond (vous restez libre de continuer).</p>';
    return X.card('Dettes & risque clients', 'fa-user-clock', body);
  }
  function debtMsg(x) {
    var c = x.c, P = getCompanyProfile(), amt = X.fmt(c.unpaid), nm = c.name || '';
    if (x.age <= 7) return 'Bonjour ' + nm + ',\nPetit rappel amical : il reste ' + amt + ' à régler pour vos dernières campagnes.\nMerci de votre confiance — ' + P.name;
    if (x.age <= 30) return 'Bonjour ' + nm + ',\nSauf erreur de notre part, ' + amt + ' reste impayé depuis ' + x.age + ' jours.\nPouvez-vous régulariser cette semaine ? Merci — ' + P.name;
    return 'Bonjour ' + nm + ',\nVotre solde de ' + amt + ' est impayé depuis plus de ' + x.age + ' jours. Merci de régulariser rapidement afin d\'éviter la suspension de vos prochaines campagnes.\n' + P.name;
  }
  window.opsDebtWa = function (id) { var x = debtors().filter(function (d) { return d.c.id === id; })[0]; if (!x) return; X.openUrl(X.waLink(x.c.phone || x.c.contact, debtMsg(x))); X.setMeta(id, { lastReminder: new Date().toISOString() }); X.log('Relance de dette (WhatsApp)', x.c.name + ' — ' + X.fmt(x.c.unpaid) + ' — ' + x.age + ' j'); X.rerender(); };
  window.opsDebtForm = function (id) {
    var c = X.find(appState.clients, id); if (!c) return; var m = X.meta(id), old = document.getElementById('opsDebtModal'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'opsDebtModal'; el.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-3'; el.style.zIndex = '60';
    var i = X.input + ' w-full', l = 'block text-xs font-bold text-gray-500 mb-1';
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border dark:border-gray-700"><h3 class="text-lg font-bold text-gray-800 dark:text-white mb-1">' + E(c.name) + '</h3><p class="text-xs text-gray-500 mb-4">Dette actuelle : <b>' + X.fmt(c.unpaid || 0) + '</b></p>' +
      '<div class="space-y-3"><div class="grid grid-cols-2 gap-3"><div><label class="' + l + '">Promesse de paiement (date)</label><input id="df-pd" type="date" value="' + E(m.promiseDate || '') + '" class="' + i + '"></div><div><label class="' + l + '">Montant promis (DA)</label><input id="df-pa" type="number" value="' + E(m.promiseAmount || '') + '" class="' + i + '"></div></div>' +
      '<div class="grid grid-cols-2 gap-3"><div><label class="' + l + '">Plafond de crédit (DA)</label><input id="df-cl" type="number" value="' + E(m.creditLimit || '') + '" placeholder="vide = aucun" class="' + i + '"></div><div><label class="' + l + '">Prochaine relance</label><input id="df-nf" type="date" value="' + E(m.nextFollowUp || '') + '" class="' + i + '"></div></div>' +
      '<div><label class="' + l + '">Note</label><input id="df-note" value="' + E(m.followUpNote || '') + '" class="' + i + '"></div></div><div class="flex gap-3 mt-5"><button onclick="document.getElementById(\'opsDebtModal\').remove()" class="flex-1 px-4 py-3 rounded-xl font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">Annuler</button><button onclick="opsDebtSave(\'' + X.js(id) + '\')" class="flex-1 px-4 py-3 rounded-xl font-bold bg-indigo-600 text-white">Enregistrer</button></div></div>';
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); }); document.body.appendChild(el);
  };
  window.opsDebtSave = function (id) {
    X.setMeta(id, { promiseDate: val('df-pd'), promiseAmount: Number(val('df-pa')) || 0, creditLimit: Number(val('df-cl')) || 0, nextFollowUp: val('df-nf'), followUpNote: val('df-note').trim() });
    var el = document.getElementById('opsDebtModal'); if (el) el.remove(); X.log('Suivi de dette mis à jour', X.clientName(id)); X.toast('Suivi enregistré', 'success'); X.rerender();
  };
  // Plafond de crédit : avertissement à la création d'une To-Do non payée
  X.wrap('handleNewTodoSubmit', function (mode) {
    try {
      var cid = val('todoClientId'), paid = (document.getElementById('todoPaid') || {}).checked, price = Number(val('todoPrice')) || 0, c = X.find(appState.clients, cid), lim = c ? Number(X.meta(cid).creditLimit) || 0 : 0;
      if (c && lim > 0 && !paid && Number(c.unpaid || 0) + price > lim) {
        if (!confirm('⚠ Plafond de crédit dépassé pour ' + c.name + '\nDette actuelle : ' + X.fmt(c.unpaid || 0) + ' + cette vente : ' + X.fmt(price) + '\nPlafond : ' + X.fmt(lim) + '\n\nContinuer quand même ?')) return false;
        X.log('Plafond de crédit dépassé (autorisé)', c.name + ' — ' + X.fmt(Number(c.unpaid || 0) + price) + ' / ' + X.fmt(lim));
      }
    } catch (e) {}
    return true;
  });
  // Vieillissement des dettes ajouté sous « Dettes/Relances » (sans modifier cet écran)
  X.wrap('renderRemindersTable', null, function (container) {
    if (!container || !X.isAdmin()) return;
    var card = document.createElement('div'); card.className = 'mt-6'; card.innerHTML = X.card('Vieillissement des dettes & promesses', 'fa-hourglass-half', debtCardsHtml()); container.appendChild(card);
  });

  // =====================================================================
  //  COMPTES PUB
  // =====================================================================
  function adSpent(accId) { var s = 0, n = 0; (appState.transactions || []).forEach(function (t) { if ((t.status === 'active' || !t.status) && t.adAccountId === accId) { s += Number(t.amount || 0); n++; } }); return { spent: s, n: n }; }
  X.wrap('rechargeAdAccount', function (id) { var a = X.find(appState.adAccounts, id); window.__adBefore = a ? { id: id, bal: Number(a.balance) || 0 } : null; }, function () {
    var b = window.__adBefore; window.__adBefore = null; if (!b) return; var a = X.find(appState.adAccounts, b.id), now = a ? Number(a.balance) || 0 : b.bal;
    if (now > b.bal) { S.list('adRecharges').push({ id: X.uid('rch'), ts: Date.now(), date: X.today(), accId: b.id, accName: a.name, amount: now - b.bal, before: b.bal, after: now, by: X.actor() }); X.save(); }
  });
  function renderAds() {
    var th = Number(S.get('adThreshold', 20)), accs = appState.adAccounts || [], rech = S.list('adRecharges').slice().sort(function (a, b) { return b.ts - a.ts; });
    var rows = accs.map(function (a) {
      var sp = adSpent(a.id), bal = Number(a.balance || 0), low = bal < th, last = rech.filter(function (r) { return r.accId === a.id; })[0];
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(a.name) + '<div class="text-[11px] font-normal text-gray-400">' + E(a.platform) + '</div></td><td class="p-3 text-right font-mono font-black ' + (low ? 'text-red-600' : 'text-green-600') + '">' + X.usd(bal) + (low ? ' ⚠' : '') + '</td><td class="p-3 text-right font-mono">' + X.usd(sp.spent) + '</td><td class="p-3 text-right">' + sp.n + '</td><td class="p-3 text-xs text-gray-500">' + (last ? X.fmtDate(last.date) + ' · ' + X.usd(last.amount) : '—') + '</td></tr>';
    }).join('');
    var rr = rech.slice(0, 40).map(function (r) { return '<tr><td class="p-3 whitespace-nowrap text-xs">' + X.fmtDate(r.date) + '</td><td class="p-3 font-bold">' + E(r.accName) + '</td><td class="p-3 text-right font-mono text-green-600">+ ' + X.usd(r.amount) + '</td><td class="p-3 text-right font-mono text-xs text-gray-500">' + X.usd(r.before) + ' → ' + X.usd(r.after) + '</td><td class="p-3 text-xs text-gray-400">' + E(r.by) + '</td></tr>'; }).join('');
    var body = '<div class="flex flex-wrap items-center gap-3 mb-4"><label class="text-sm text-gray-600 dark:text-gray-300">Alerte quand le solde est inférieur à</label><input type="number" id="adTh" value="' + th + '" class="' + X.input + ' w-24"> $ ' + X.btn('Enregistrer', 'opsAdThreshold()', null, 'fa-check') + '<span class="flex-1"></span>' + X.btn('Historique CSV', 'opsAdCsv()', 'border dark:border-gray-600 text-gray-700 dark:text-gray-200', 'fa-file-csv') + '</div>' +
      X.table([['Compte'], ['Solde', 'r'], ['Dépensé (ventes)', 'r'], ['Campagnes', 'r'], ['Dernière recharge']], rows, { empty: 'Aucun compte publicitaire' }) +
      '<h4 class="font-bold text-gray-800 dark:text-white mt-6 mb-2">Historique des recharges</h4>' + X.table([['Date'], ['Compte'], ['Montant', 'r'], ['Solde', 'r'], ['Par']], rr, { empty: 'Aucune recharge enregistrée depuis cette mise à jour' });
    return X.card('Comptes publicitaires', 'fa-rectangle-ad', body);
  }
  window.opsAdThreshold = function () { S.set('adThreshold', Math.max(0, Number(val('adTh')) || 0)); X.toast('Seuil enregistré', 'success'); X.rerender(); };
  window.opsAdCsv = function () { var out = [['Date', 'Compte', 'Montant ($)', 'Solde avant', 'Solde après', 'Par']]; S.list('adRecharges').forEach(function (r) { out.push([r.date, r.accName, r.amount, r.before, r.after, r.by]); }); X.csv(out, 'recharges_comptes_pub.csv'); };

  // =====================================================================
  //  OBJECTIFS & QUALITÉ ÉQUIPE
  // =====================================================================
  function teamStats(month) {
    var goals = S.map('goals'), emps = (appState.employees || []).filter(function (e) { return e.active !== false; });
    return emps.map(function (e) {
      var ok = 0, pb = 0, usd = 0, rev = 0;
      (appState.transactions || []).forEach(function (t) { if (t && t.employeeId === e.id && String(t.date).slice(0, 7) === month) { if (t.status === 'problem') pb++; else { ok++; rev += Number(t.priceDzd || 0); usd += Number(t.amount || 0); } } });
      var abs = (appState.absences || []).filter(function (a) { return a && a.employeeId === e.id && String(a.date).slice(0, 7) === month; }).length, target = Number(goals[e.id] || 0);
      return { e: e, ok: ok, pb: pb, rev: rev, usd: usd, abs: abs, target: target, pct: target > 0 ? Math.round(ok / target * 100) : null, pbRate: (ok + pb) > 0 ? pb / (ok + pb) * 100 : 0 };
    });
  }
  window.OpsTeam = teamStats;
  function renderGoals() {
    var u = ui(), m = u.goalMonth || X.month(), rows = teamStats(m).map(function (s) {
      var cls = s.pct === null ? 'bg-gray-300' : (s.pct >= 100 ? 'bg-green-500' : (s.pct >= 60 ? 'bg-amber-500' : 'bg-red-500'));
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(s.e.name || s.e.login) + '</td><td class="p-3 text-right font-black text-indigo-600">' + s.ok + '</td><td class="p-3 text-right"><input type="number" min="0" value="' + (s.target || '') + '" placeholder="—" class="' + X.input + ' w-20 text-right" onchange="opsGoalSet(\'' + X.js(s.e.id) + '\', this.value)"></td>' +
        '<td class="p-3" style="min-width:140px"><div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"><div class="h-full ' + cls + '" style="width:' + Math.min(100, s.pct || 0) + '%"></div></div><div class="text-[10px] text-gray-400 mt-1">' + (s.pct === null ? 'pas d\'objectif' : s.pct + ' %') + '</div></td>' +
        '<td class="p-3 text-right font-mono">' + X.fmt(s.rev) + '</td><td class="p-3 text-right ' + (s.pb ? 'text-red-600 font-black' : 'text-gray-400') + '">' + s.pb + '</td><td class="p-3 text-right text-xs ' + (s.pbRate > 10 ? 'text-red-600 font-black' : 'text-gray-600') + '">' + s.pbRate.toFixed(0) + ' %</td><td class="p-3 text-right">' + s.abs + '</td></tr>';
    }).join('');
    var body = '<div class="flex items-center gap-3 mb-4"><input type="month" value="' + E(m) + '" onchange="opsGoalMonth(this.value)" class="' + X.input + '"><span class="text-xs text-gray-500">L\'objectif mensuel (nombre de tâches) s\'applique à chaque mois.</span></div>' +
      X.table([['Salarié'], ['Tâches validées', 'r'], ['Objectif', 'r'], ['Progression'], ['CA généré', 'r'], ['Problèmes', 'r'], ['Taux de problème', 'r'], ['Absences', 'r']], rows, { empty: 'Aucun salarié actif' }) + '<p class="text-[11px] text-gray-400 mt-2">Taux de problème = tâches passées en « Problème » ÷ (validées + problèmes). Au-delà de 10 %, la ligne est signalée.</p>';
    return X.card('Objectifs & qualité de l\'équipe', 'fa-bullseye', body);
  }
  window.opsGoalMonth = function (m) { if (m) { ui().goalMonth = m; X.rerender(); } };
  window.opsGoalSet = function (id, v) { var g = S.map('goals'); if (!(Number(v) > 0)) delete g[id]; else g[id] = Number(v); X.save(); X.rerender(); };

  // =====================================================================
  //  RAPPORT META (PDF client)
  // =====================================================================
  window.openMetaReportPdf = function () {
    var k = (typeof getMetaLiveLastKpis === 'function') ? getMetaLiveLastKpis() : null; if (!k) return X.toast('Chargez d\'abord les résultats d\'une campagne', 'warning');
    var P = getCompanyProfile(), cl = val('meta-live-client-search').trim(), since = val('meta-live-since'), until = val('meta-live-until'), f = function (n) { return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/\u202f/g, '\u00a0'); };
    var box = function (l, v, s) { return '<div style="flex:1;background:' + X.C.SOFT + ';border:1px solid ' + X.C.LINE + ';border-radius:12px;padding:16px 18px"><div style="font-size:10.5px;font-weight:800;color:' + X.C.BLUE + ';letter-spacing:1px;text-transform:uppercase">' + l + '</div><div style="font-size:26px;font-weight:900;margin-top:4px">' + v + '</div>' + (s ? '<div style="font-size:11px;color:#6b7a90;margin-top:2px">' + s + '</div>' : '') + '</div>'; };
    var inner = '<div style="width:794px;box-sizing:border-box;padding:34px 40px;font-family:\'Segoe UI\',Arial,sans-serif;color:' + X.C.NAVY + ';background:#fff">' + X.docHeader('RAPPORT DE CAMPAGNE', 'Édité le ' + X.fmtDate(X.today())) +
      '<div style="background:' + X.C.NAVY + ';color:#fff;border-radius:12px;padding:16px 22px"><div style="font-size:11px;letter-spacing:1px;opacity:.8">CAMPAGNE</div><div style="font-size:20px;font-weight:800;margin-top:2px">' + E(k.campaignName || '—') + '</div>' + (cl ? '<div style="font-size:12px;opacity:.85;margin-top:4px">Client : ' + E(cl) + '</div>' : '') + (since && until ? '<div style="font-size:12px;opacity:.85;margin-top:2px">Période analysée : ' + X.fmtDate(since) + ' → ' + X.fmtDate(until) + '</div>' : '') + '</div>' +
      '<div style="display:flex;gap:14px;margin-top:18px">' + box('Résultats', f(k.results), E(k.resultLabel || '')) + box('Coût par résultat', k.cprFinite ? f(k.costPerResult) : '—', E(k.currency || '')) + '</div>' +
      '<div style="display:flex;gap:14px;margin-top:14px">' + box('Impressions', f(k.impressions), 'personnes touchées (affichages)') + box('Budget consommé', f(k.spend), E(k.currency || '')) + '</div>' +
      '<div style="margin-top:14px;font-size:12px;color:#34445f">Date de fin de la campagne : <b>' + (k.stopDate ? X.fmtDate(k.stopDate) : '—') + '</b></div>' +
      '<div style="margin-top:24px;padding:14px 18px;border-left:4px solid ' + X.C.BLUE + ';background:#f6f9fe;font-size:12.5px;line-height:1.7;color:#34445f">Ces chiffres proviennent directement de la plateforme publicitaire. Pour prolonger la diffusion ou lancer une nouvelle campagne, contactez-nous.</div>' + X.docFooter() + '</div>';
    X.openDoc({ title: 'Rapport — ' + (k.campaignName || 'campagne'), filename: 'rapport_campagne_' + String(k.campaignName || 'meta').replace(/[^\w]+/g, '_').slice(0, 40) + '.pdf', inner: inner, fixed: false });
  };

  // =====================================================================
  //  ONGLET
  // =====================================================================
  var SUBS = [['camp', 'Campagnes', 'fa-bullhorn'], ['profit', 'Rentabilité', 'fa-chart-column'], ['debts', 'Dettes & risque', 'fa-user-clock'], ['ads', 'Comptes pub', 'fa-rectangle-ad'], ['goals', 'Objectifs & qualité', 'fa-bullseye']];
  window.opsSub = function (s) { ui().sub = s; X.rerender(); };
  X.registerTab('pilotage', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'Pilotage', icon: 'fa-gauge' },
    render: function (c) {
      var sub = ui().sub, fn = { camp: renderCampaigns, profit: renderProfit, debts: renderDebts, ads: renderAds, goals: renderGoals }[sub] || renderCampaigns;
      c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-gauge text-indigo-600 mr-2"></i>Pilotage</h2><p class="text-xs text-gray-500 mt-1">Campagnes, rentabilité, créances, comptes pub et équipe en un coup d\'œil.</p></div>' + X.pills(SUBS, sub, 'opsSub') + fn();
    }
  });
})();
