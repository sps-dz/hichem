// =====================================================================
//  FINANCE-CORE.JS — noyau financier UNIQUE + « Nouveau départ comptable »
//
//  1) UNE SEULE SOURCE DE VÉRITÉ : FinanceCore.movements() liste chaque mouvement d'argent
//     (entrées/sorties par caisse : Liquide, BaridiMob/CCP, USDT). Les soldes du site
//     (calculateTheoreticalBalance → appState.balances), le livre de caisse (Comptabilité),
//     la clôture de caisse, Ma finance et le Contrôle financier lisent tous ces mêmes mouvements :
//     ils ne peuvent plus donner des chiffres différents.
//
//  2) NOUVEAU DÉPART (non destructif) : à partir d'une date, la comptabilité repart de zéro.
//     • Rien n'est supprimé : ventes, campagnes, factures, primes et historique restent intacts.
//     • Les caisses (Liquide, BaridiMob, USDT) repartent du solde d'ouverture (0 par défaut).
//     • Les soldes clients (dettes > 0, avances < 0) sont CONSERVÉS tels quels.
//     • Les lignes d'argent d'avant le départ sont figées (plus modifiables / supprimables).
//     • Annulable : on revient exactement à l'état précédent.
//
//  3) RÈGLES DE CALCUL (identiques pour tous les écrans) :
//     • Paiement client : + caisse (Espèces → Liquide ; BaridiMob ou CCP → BaridiMob ; USDT → USDT) ; dette client − montant.
//     • Vente payée tout de suite : + caisse choisie (sauf « avance du client » : l'argent est déjà entré par un paiement).
//     • Vente non payée ou payée par avance : aucune entrée d'argent ; dette client + prix.
//     • Vente validée : − USDT (dollars consommés). Vente « problème » : ne compte nulle part.
//     • Frais : − caisse. Achat USD : − caisse payée (Liquide ou BaridiMob) et + USDT.
//     • Dépense USDT : − USDT. Salaire payé : − caisse, une seule fois (via son frais lié s'il existe).
//     • Versement studio / shooting : + caisse choisie.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, S = ExtStore, E = X.esc;
  var ACC = ['liquide', 'baridimob', 'usdt'];
  var LABEL = { liquide: 'Liquide', baridimob: 'BaridiMob / CCP', usdt: 'USDT' };
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function ro() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function rate() { var r = (typeof getRedotpayRate === 'function') ? num(getRedotpayRate()) : 250; return r > 0 ? r : 250; }
  function isTask(t) { return t && /^tx-emp-/.test(String(t.id || '')); }
  // Une vente consomme des dollars si elle n'est ni en « problème » ni au format ancien (« completed », déjà sorti du stock à l'époque).
  function consumesUsdt(t) { return t && !isTask(t) && t.status !== 'problem' && t.status !== 'completed'; }

  // ------------------------------------------------------------------ nouveau départ : état
  function cfg() { var c = S.get('ledgerStart', null); return (c && c.date) ? c : null; }
  function active() { return !!cfg(); }
  // Un élément compte dans la nouvelle comptabilité s'il a été saisi ou validé APRÈS l'activation du départ.
  // Si la date de départ choisie est dans le passé, les lignes déjà saisies et datées entre cette date et la veille
  // de l'activation comptent aussi. Une ligne saisie avant l'activation ne compte jamais au-delà (même datée dans le futur) :
  // au moment de l'activation, les caisses valent exactement le solde d'ouverture.
  function inLedger(o) {
    var c = cfg(); if (!c) return true; if (!o) return false;
    var at = num(c.at);
    if (at > 0 && (num(o.createdAt) >= at || num(o.completedAt) >= at || num(o.paidAt) >= at)) return true;
    var d = String(o.date || ''), atDay = c.atDay || (at > 0 ? X.ymdOf(new Date(at)) : c.date);
    if (!X.isYmd(d) || d < c.date) return false;
    // départ AUJOURD'HUI : rien de ce qui a été saisi avant l'activation (caisses = solde d'ouverture).
    // départ dans le PASSÉ : tout ce qui est daté entre cette date et aujourd'hui (inclus) compte.
    return c.date < atDay ? d <= atDay : false;
  }

  // ------------------------------------------------------------------ règles de caisse
  function payAccount(p) {
    if (p.account === 'liquide' || p.account === 'baridimob' || p.account === 'usdt') return p.account;
    var m = String(p.method || '').toLowerCase().trim();
    if (m === 'baridimob' || m === 'ccp' || m === 'virement') return 'baridimob';
    if (m === 'usdt') return 'usdt';
    return 'liquide';
  }
  function cashAccount(a) { return a === 'baridimob' ? 'baridimob' : (a === 'usdt' ? 'usdt' : 'liquide'); }
  function linkedExpenseIds() { var s = {}; (appState.expenses || []).forEach(function (e) { if (e && e.payrollPaymentId) s[e.payrollPaymentId] = 1; if (e && /^exp_pay_/.test(String(e.id || ''))) s[String(e.id).slice(8)] = 1; }); return s; }

  // ------------------------------------------------------------------ LA liste unique des mouvements
  // { acc, date, ts, label, ref, inn, out } — montants en DA pour Liquide/BaridiMob, en USDT pour USDT.
  function movements() {
    var L = [], R = rate(), c = cfg();
    function push(acc, o, label, ref, inn, out) { L.push({ acc: acc, date: o.date || '', ts: num(o.createdAt), label: label, ref: ref, inn: inn || 0, out: out || 0, src: o.id || '' }); }
    function toAcc(acc, amtDzd, o) { var r = num(o && o.usdtRate) > 0 ? num(o.usdtRate) : R; return acc === 'usdt' ? amtDzd / r : amtDzd; }
    function pushD(acc, o, label, ref, dzdIn, dzdOut) { push(acc, o, label, ref, toAcc(acc, dzdIn, o), toAcc(acc, dzdOut, o)); L[L.length - 1].dzd = dzdIn || -dzdOut; }
    if (c) ACC.forEach(function (a) { var v = num((c.opening || {})[a]); L.push({ acc: a, date: c.date, ts: num(c.at) - 1, label: 'Solde d\'ouverture — nouveau départ', ref: 'OUV', inn: v > 0 ? v : 0, out: v < 0 ? -v : 0, src: 'opening' }); });
    (appState.payments || []).forEach(function (p) {
      if (!p || !inLedger(p)) return;
      var a = payAccount(p), amt = num(p.amount);
      pushD(a, p, 'Paiement reçu — ' + (p.clientName || X.clientName(p.clientId)) + (p.note ? ' (' + p.note + ')' : ''), 'PAY', amt, 0);
    });
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTask(t) || !inLedger(t)) return;
      // l'argent reçu compte dès qu'il est reçu, même si la vente est en « problème » (il est physiquement en caisse)
      if (t.paid && t.paidAccount !== 'avance') pushD(cashAccount(t.paidAccount || 'liquide'), t, (t.status === 'problem' ? 'Argent reçu (vente en problème) — ' : 'Vente encaissée — ') + (t.clientName || '') + ' — ' + (t.offerName || ''), 'VTE', num(t.priceDzd), 0);
      if (consumesUsdt(t)) push('usdt', t, 'Vente — dollars consommés — ' + (t.clientName || ''), 'VTE', 0, num(t.amount));
    });
    // tâches To-Do déjà payées (argent reçu avant validation) : en caisse dès la réception
    (appState.todoTransactions || []).forEach(function (t) {
      if (!t || !t.paid || t.paidAccount === 'avance' || !inLedger(t)) return;
      pushD(cashAccount(t.paidAccount || 'liquide'), t, 'Argent reçu (tâche pas encore validée) — ' + (t.clientName || '') + ' — ' + (t.offerName || ''), 'VTE', num(t.priceDzd), 0);
    });
    (appState.expenses || []).forEach(function (e) {
      if (!e || !inLedger(e)) return;
      var a = cashAccount(e.account || 'liquide');
      pushD(a, e, 'Frais — ' + (e.category || '') + (e.note ? ' (' + e.note + ')' : ''), 'FRA', 0, num(e.amount));
    });
    (appState.usdPurchases || []).forEach(function (u) {
      if (!u || !inLedger(u)) return;
      var a = (u.dzdAccount === 'baridimob') ? 'baridimob' : 'liquide';
      push(a, u, 'Achat USD (' + num(u.amount) + ' $ à ' + num(u.rate) + ')', 'ACH', 0, num(u.totalDzd));
      push('usdt', u, 'Achat USD — entrée de stock', 'ACH', num(u.amount), 0);
    });
    (appState.usdtExpenses || []).forEach(function (e) {
      if (!e || !inLedger(e)) return;
      push('usdt', e, 'Dépense USDT — ' + (e.category || '') + (e.note ? ' (' + e.note + ')' : ''), 'DEP', 0, num(e.amount));
    });
    // salaires payés SANS frais lié (sinon le frais lié les compte déjà : jamais deux fois)
    var linked = linkedExpenseIds();
    (appState.employeePayments || []).forEach(function (p) {
      if (!p || !p.paid || linked[p.id] || !(num(p.amount) > 0) || !inLedger(p)) return;
      var m = String(p.method || '').toLowerCase(), a = m === 'usdt' ? 'usdt' : ((m === 'baridimob' || m === 'virement' || m === 'ccp') ? 'baridimob' : 'liquide');
      pushD(a, p, 'Salaire payé — ' + (p.employeeName || p.employeeId || ''), 'SAL', 0, num(p.amount));
    });
    // versements studio et shooting
    [['studioBookings', 'Studio'], ['productShoots', 'Shooting']].forEach(function (k) {
      (S.list(k[0]) || []).forEach(function (r) {
        (r && r.payments || []).forEach(function (p) {
          var o = { date: p.date, createdAt: p.ts || p.createdAt || 0, id: r.id, usdtRate: p.usdtRate };
          if (!inLedger(o)) return;
          var a = cashAccount(p.account || 'liquide');
          pushD(a, o, 'Versement ' + k[1] + ' — ' + (r.clientName || '') + (r.product ? ' — ' + r.product : ''), 'STU', num(p.amount), 0);
        });
      });
    });
    return L;
  }
  // Argent reçu des clients sur une période (paiements, ventes encaissées, versements studio), en DA saisis.
  function received(from, to) {
    var s = 0; movements().forEach(function (m) { if ((m.ref === 'PAY' || m.ref === 'VTE' || m.ref === 'STU') && m.inn > 0 && m.date >= from && m.date <= to) s += num(m.dzd); }); return s;
  }
  // Flux de caisse réel d'une période : entrées, sorties (frais, salaires) et achats de dollars, en DA.
  function cashFlow(from, to) {
    var r = { inn: 0, out: 0, usd: 0 };
    movements().forEach(function (m) {
      if (m.ref === 'OUV' || !(m.date >= from && m.date <= to)) return;
      if (m.ref === 'ACH') { if (m.acc !== 'usdt') r.usd += m.out; return; }
      if (m.ref === 'FRA' || m.ref === 'SAL' || m.ref === 'DEP') { if (m.dzd !== undefined) r.out += -num(m.dzd); return; }
      if ((m.ref === 'PAY' || m.ref === 'VTE' || m.ref === 'STU') && m.inn > 0) r.inn += num(m.dzd);
    });
    r.net = r.inn - r.out; return r;
  }
  function ledger() {
    var L = { liquide: [], baridimob: [], usdt: [] };
    movements().forEach(function (m) { L[m.acc].push(m); });
    ACC.forEach(function (k) { L[k].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (a.ts - b.ts); }); });
    return L;
  }
  function theoretical() {
    var b = { liquide: 0, baridimob: 0, usdt: 0 };
    movements().forEach(function (m) { b[m.acc] += m.inn - m.out; });
    return b;
  }

  // ------------------------------------------------------------------ soldes clients
  // Variation de la dette d'un client due aux lignes comptées dans la comptabilité (même règle que le code de saisie).
  function clientDeltas() {
    var d = {};
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTask(t) || !t.clientId || t.status === 'problem' || !inLedger(t)) return;
      if (!t.paid || t.paidAccount === 'avance') d[t.clientId] = (d[t.clientId] || 0) + num(t.priceDzd);
    });
    (appState.payments || []).forEach(function (p) { if (p && p.clientId && inLedger(p)) d[p.clientId] = (d[p.clientId] || 0) - num(p.amount); });
    return d;
  }
  function expectedUnpaid(clientId) {
    var c = cfg(), d = clientDeltas();
    return num(c ? (c.clientOpening || {})[clientId] : 0) + num(d[clientId]);
  }
  function clientGaps() {
    var c = cfg(), d = clientDeltas(), op = c ? (c.clientOpening || {}) : {};
    return (appState.clients || []).map(function (cl) { var e = num(op[cl.id]) + num(d[cl.id]), cur = num(cl.unpaid); return { c: cl, exp: e, cur: cur, diff: cur - e }; })
      .filter(function (r) { return Math.abs(r.diff) > 1; }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  }

  // ------------------------------------------------------------------ branchement : le site entier calcule via le noyau
  window.calculateTheoreticalBalance = function () { return theoretical(); };


  // ------------------------------------------------------------------ DETTES CLIENTS CALCULÉES (après le nouveau départ)
  // La dette d'un client n'est plus un chiffre « à part » qui peut dériver : elle est recalculée en permanence
  // = solde de départ + ventes non payées (ou payées par avance) − paiements, depuis le départ.
  function syncClientBalances() {
    var c = cfg(); if (!c || !c.clientOpening) return 0;                 // pas de recalcul pendant l'activation (soldes de départ pas encore figés)
    var d = clientDeltas(), op = c.clientOpening || {}, changed = 0, today = X.today();
    (appState.clients || []).forEach(function (cl) {
      var exp = Math.round((num(op[cl.id]) + num(d[cl.id])) * 100) / 100, cur = num(cl.unpaid);
      if (Math.abs(exp - cur) > 0.004) {
        if (cur <= 0 && exp > 0) cl.debtStartDate = today; else if (exp <= 0) cl.debtStartDate = null;
        cl.unpaid = exp; cl.updatedAt = Date.now(); changed++;
      }
    });
    return changed;
  }
  X.wrap('recalculateFinanceBalances', null, function () { try { syncClientBalances(); freezeAndTotals(); } catch (e) { console.warn('FinanceCore clients', e); } });
  // Les écrans lisent toujours un solde à jour (clôture, tableau du matin, ma finance, contrôle…)
  ['showTab', 'renderCurrentTab', 'autoSave'].forEach(function (n) { X.wrap(n, function () { try { if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances(); } catch (e) {} }); });
  // Fusion de doublons : le solde de départ de la fiche fusionnée passe sur la fiche conservée (appelé par crm.js).
  function transferOpening(fromId, toId) {
    var c = cfg(); if (!c || !fromId || !toId || fromId === toId) return;
    var op = Object.assign({}, c.clientOpening || {});
    if (op[fromId]) { op[toId] = Math.round((num(op[toId]) + num(op[fromId])) * 100) / 100; delete op[fromId]; if (Math.abs(op[toId]) < 0.005) delete op[toId]; }
    c.clientOpening = op; S.set('ledgerStart', c, true);
  }

  // Le « total dépensé » de chaque client est recalculé (au lieu d'un compteur qui dérive) ;
  // les montants USDT sont figés au taux du jour de leur saisie (un changement de taux ne réécrit pas le passé).
  function frozenRateTargets() {
    var out = [];
    (appState.payments || []).forEach(function (p) { if (p && payAccount(p) === 'usdt') out.push(p); });
    (appState.transactions || []).concat(appState.todoTransactions || []).forEach(function (t) { if (t && t.paid && t.paidAccount === 'usdt') out.push(t); });
    (appState.expenses || []).forEach(function (e) { if (e && e.account === 'usdt') out.push(e); });
    (appState.employeePayments || []).forEach(function (p) { if (p && p.paid && String(p.method || '').toLowerCase() === 'usdt') out.push(p); });
    return out;
  }
  function freezeAndTotals() {
    var R = rate(), now = Date.now(), recent = now - 86400000, c = cfg();
    frozenRateTargets().forEach(function (o) {
      if (num(o.usdtRate) > 0) return;
      if (num(o.createdAt) >= recent || num(o.paidAt) >= recent || (c && inLedger(o))) { o.usdtRate = R; o.updatedAt = now; }
    });
    [['studioBookings'], ['productShoots']].forEach(function (k) { (S.list(k[0]) || []).forEach(function (r) { (r && r.payments || []).forEach(function (p) { if (p.account === 'usdt' && !(num(p.usdtRate) > 0)) p.usdtRate = R; }); }); });
    var tot = {};
    (appState.transactions || []).forEach(function (t) { if (t && t.clientId && !isTask(t) && t.status !== 'problem') tot[t.clientId] = (tot[t.clientId] || 0) + num(t.priceDzd || (t.status === 'completed' ? t.totalDzd : 0)); });
    (appState.clients || []).forEach(function (cl) { var v = Math.round(num(tot[cl.id]) * 100) / 100; if (Math.abs(num(cl.totalSpent) - v) > 0.5) { cl.totalSpent = v; cl.updatedAt = now; } });
  }

  // Ancien calcul (tout l'historique, sans départ) : affiché à titre d'information pour aider à retrouver le vrai solde.
  function historyBalance(clientId) {
    var due = 0;
    (appState.transactions || []).forEach(function (t) { if (t && !isTask(t) && t.clientId === clientId && t.status !== 'problem' && (!t.paid || t.paidAccount === 'avance')) due += num(t.priceDzd); });
    (appState.payments || []).forEach(function (p) { if (p && p.clientId === clientId) due -= num(p.amount); });
    return due;
  }
  function timeline(clientId) {
    var ev = [];
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTask(t) || t.clientId !== clientId || t.status === 'problem') return;
      var eff = (!t.paid || t.paidAccount === 'avance') ? num(t.priceDzd) : 0;
      ev.push({ date: t.date || '', ts: num(t.completedAt || t.createdAt), kind: 'Vente', label: (t.offerName || '') + (t.paid ? (t.paidAccount === 'avance' ? ' (payée par avance)' : ' (payée ' + (t.paidAccount || 'liquide') + ')') : ' (non payée)'), amount: num(t.priceDzd), eff: eff, inL: inLedger(t) });
    });
    (appState.payments || []).forEach(function (p) {
      if (!p || p.clientId !== clientId) return;
      ev.push({ date: p.date || '', ts: num(p.createdAt) || num(String(p.id || '').replace(/\D/g, '').slice(0, 13)), kind: 'Paiement', label: (p.method || '') + (p.note ? ' — ' + p.note : ''), amount: num(p.amount), eff: -num(p.amount), inL: inLedger(p) });
    });
    ev.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (a.ts - b.ts); });
    var run = 0, prev = null;
    ev.forEach(function (e) {
      run += e.eff; e.run = run;
      e.burst = !!(prev && prev.kind === 'Paiement' && e.kind === 'Paiement' && prev.amount === e.amount && prev.date === e.date && e.ts && prev.ts && Math.abs(e.ts - prev.ts) < 60000);
      prev = e;
    });
    return ev;
  }
  var fcUi = { q: '', open: '' };
  window.fcSearch = function (v) { fcUi.q = String(v || ''); var el = document.getElementById('fcClientList'); if (el) el.innerHTML = clientListHtml(); };
  window.fcHist = function (id) { fcUi.open = fcUi.open === id ? '' : id; var el = document.getElementById('fcClientList'); if (el) el.innerHTML = clientListHtml(); };
  window.fcSetOpening = function (id) {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var c = cfg(), cl = X.find(appState.clients, id); if (!c || !cl) return;
    var raw = String(val('fcOp_' + id) || '').replace(/\s/g, '').replace(',', '.');
    if (raw === '' || !isFinite(Number(raw))) return X.toast('Saisissez un montant (négatif si vous lui devez de l\'argent)', 'error');
    var v = Math.round(Number(raw) * 100) / 100, op = Object.assign({}, c.clientOpening || {}), old = num(op[id]);
    if (Math.abs(v - old) < 0.005) return X.toast('Aucun changement', 'info');
    if (!confirm('Solde de départ de ' + cl.name + ' :\n' + X.fmt(old) + ' → ' + X.fmt(v) + '\n\n' + (v > 0 ? 'Il vous doit ' + X.fmt(v) : v < 0 ? 'Vous lui devez ' + X.fmt(-v) + ' (avance)' : 'Rien de part et d\'autre') + ' au jour du départ.\n\nConfirmer ?')) return;
    if (Math.abs(v) < 0.005) delete op[id]; else op[id] = v;
    c.clientOpening = op; S.set('ledgerStart', c);
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    X.log('Solde de départ client corrigé', cl.name + ' : ' + X.fmt(old) + ' → ' + X.fmt(v));
    X.save(); X.toast('Solde de départ enregistré', 'success'); X.rerender();
  };
  function clientListHtml() {
    var c = cfg(); if (!c) return '';
    var op = c.clientOpening || {}, q = fcUi.q.trim().toLowerCase();
    var rows = (appState.clients || []).map(function (cl) {
      var o = num(op[cl.id]), h = historyBalance(cl.id), diff = Math.abs(o - h) > 1;
      return { cl: cl, o: o, h: h, diff: diff, now: num(cl.unpaid) };
    }).filter(function (r) {
      if (q) return String(r.cl.name || '').toLowerCase().indexOf(q) >= 0 || String(r.cl.phone || '').indexOf(q) >= 0 || String(r.cl.readableId || '').toLowerCase().indexOf(q) >= 0;
      return Math.abs(r.o) > 0.004 || r.diff;
    }).sort(function (a, b) { return (b.diff - a.diff) || (Math.abs(b.o) - Math.abs(a.o)); }).slice(0, 80);
    if (!rows.length) return '<p class="text-center text-gray-400 italic py-6">Aucun client</p>';
    return rows.map(function (r) {
      var id = E(r.cl.id), hist = '';
      if (fcUi.open === r.cl.id) {
        var tl = timeline(r.cl.id);
        hist = '<div class="mt-3 overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-gray-500"><th class="p-1 text-left">Date</th><th class="p-1 text-left">Opération</th><th class="p-1 text-right">Montant</th><th class="p-1 text-right">Solde cumulé</th></tr></thead><tbody>' +
          tl.map(function (e) { return '<tr class="border-t dark:border-gray-700' + (e.burst ? ' bg-red-50 dark:bg-red-900/20' : '') + (e.inL ? ' font-bold' : '') + '"><td class="p-1 whitespace-nowrap">' + E(X.fmtDate(e.date)) + '</td><td class="p-1">' + E(e.kind) + ' — ' + E(e.label) + (e.burst ? ' <span class="text-red-600 font-black">doublon probable ?</span>' : '') + (e.inL ? ' <span class="text-indigo-600">(depuis le départ)</span>' : '') + '</td><td class="p-1 text-right font-mono">' + X.fmt(e.amount) + '</td><td class="p-1 text-right font-mono">' + X.fmt(e.run) + '</td></tr>'; }).join('') +
          '</tbody></table><p class="text-[11px] text-gray-400 mt-1">Solde cumulé : positif = il vous doit, négatif = vous lui devez. Les lignes en rouge sont des paiements identiques saisis à moins d\'une minute d\'intervalle.</p></div>';
      }
      return '<div class="p-3 rounded-2xl border dark:border-gray-700 mb-2 ' + (r.diff ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-900/10' : 'bg-white dark:bg-gray-800') + '">' +
        '<div class="flex flex-wrap items-center gap-3 justify-between"><div class="min-w-[180px]"><div class="font-bold text-gray-800 dark:text-white">' + E(r.cl.name || '—') + ' <span class="text-xs text-gray-400">' + E(r.cl.readableId || '') + '</span></div>' +
        '<div class="text-xs text-gray-500">Solde actuel : <b class="' + (r.now > 0 ? 'text-red-600' : r.now < 0 ? 'text-green-600' : '') + '">' + X.fmt(r.now) + '</b> · Recalcul sur tout l\'ancien historique : ' + X.fmt(r.h) + (r.diff ? ' <b class="text-amber-700">(différent : à vérifier)</b>' : '') + '</div></div>' +
        (ro() ? '' : '<div class="flex items-center gap-2"><label class="text-xs font-bold text-gray-600">Solde au départ<input id="fcOp_' + id + '" type="number" step="1" value="' + (Math.round(r.o * 100) / 100) + '" class="' + X.input + ' w-36 !p-2 text-sm ml-1"></label>' +
        '<button type="button" data-id="' + id + '" onclick="fcSetOpening(this.dataset.id)" class="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">Enregistrer</button>') +
        '<button type="button" data-id="' + id + '" onclick="fcHist(this.dataset.id)" class="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold">' + (fcUi.open === r.cl.id ? 'Masquer' : 'Historique') + '</button>' + (ro() ? '' : '</div>') + '</div>' + hist + '</div>';
    }).join('');
  }
  function clientsCard() {
    var c = cfg(); if (!c) return '';
    var nDiff = (appState.clients || []).filter(function (cl) { return Math.abs(num((c.clientOpening || {})[cl.id]) - historyBalance(cl.id)) > 1; }).length;
    return X.card('Soldes clients au départ', 'fa-users',
      '<p class="text-sm text-gray-600 dark:text-gray-300 mb-2">La dette de chaque client est maintenant <b>calculée automatiquement</b> : solde au départ + ventes non payées − paiements depuis le départ. Elle ne peut plus dériver.</p>' +
      '<p class="text-sm text-gray-600 dark:text-gray-300 mb-3">Vérifiez les soldes au départ, surtout les <b class="text-amber-700">' + nDiff + ' client(s) en orange</b> : l\'ancien historique ne correspond pas à leur solde. Saisissez le vrai montant : <b>positif</b> s\'il vous doit, <b>négatif</b> si vous lui devez (avance). Exemple : vous lui devez 2 × 26 500 → <b>-53000</b>.</p>' +
      '<input type="search" placeholder="Chercher un client (nom, téléphone, C-xxx)…" oninput="fcSearch(this.value)" value="' + E(fcUi.q) + '" class="' + X.input + ' w-full mb-3">' +
      '<div id="fcClientList">' + clientListHtml() + '</div>');
  }

  // ------------------------------------------------------------------ verrou : l'argent d'avant le départ est figé
  function lockMsg(what) { X.toast(what + ' : cette ligne est antérieure au nouveau départ comptable du ' + X.fmtDate(cfg().date) + '. Elle est archivée et ne peut plus être modifiée.', 'error'); return false; }
  function locked(o) { return active() && o && !inLedger(o); }
  X.wrap('deletePayment', function (id) { var p = X.find(appState.payments, id); if (locked(p)) return lockMsg('Suppression du paiement'); });
  X.wrap('deleteExpense', function (id) { var e = X.find(appState.expenses, id); if (locked(e)) return lockMsg('Suppression du frais'); });
  X.wrap('deleteUsdPurchase', function (id) { var u = X.find(appState.usdPurchases, id); if (locked(u)) return lockMsg('Suppression de l\'achat USD'); });
  X.wrap('deleteTransaction', function (id) { var t = X.find(appState.transactions, id); if (locked(t)) return lockMsg('Suppression de la vente'); });
  X.wrap('saveEditTransaction', function () {
    var t = X.find(appState.transactions, val('editTxId')); if (!locked(t)) return;
    var el = document.getElementById('editTxPaid');
    var moneyChanged = num(val('editTxAmount')) !== num(t.amount) || num(val('editTxPrice')) !== num(t.priceDzd) || (el && !!el.checked !== !!t.paid) || (val('editTxDate') || t.date) !== t.date;
    if (moneyChanged) return lockMsg('Modification du montant, du prix, du paiement ou de la date');
  });

  // ------------------------------------------------------------------ corrections de calcul (zéro écart)
  // a) Paiement : montant > 0 obligatoire ; paiement sans dette = avance (confirmation) ; caisse enregistrée (CCP → BaridiMob)
  var payCount = 0;
  X.wrap('addPayment', function () {
    payCount = (appState.payments || []).length;
    var amount = num(val('paymentAmount')), cl = X.find(appState.clients, val('paymentClientId'));
    if (val('paymentAmount') !== '' && !(amount > 0)) { X.toast('Le montant du paiement doit être supérieur à 0', 'error'); return false; }
    if (!cl || !(amount > 0)) return;
    var due = num(cl.unpaid);
    if (due <= 0 && !confirm(cl.name + ' ne doit rien actuellement.\n\nCe paiement de ' + X.fmt(amount) + ' sera enregistré comme une AVANCE (argent reçu d\'avance pour ses prochaines commandes).\n\nAttention : si vous avez déjà coché « Payé » sur sa vente, ne saisissez pas ce paiement, sinon l\'argent serait compté deux fois.\n\nContinuer ?')) return false;
    if (due > 0 && amount > due + 0.5 && !confirm('Ce paiement (' + X.fmt(amount) + ') dépasse la dette de ' + cl.name + ' (' + X.fmt(due) + ').\n\nLe surplus de ' + X.fmt(amount - due) + ' deviendra une avance.\n\nContinuer ?')) return false;
  }, function () {
    var l = appState.payments || [];
    if (l.length > payCount) { var p = l[l.length - 1]; if (p && !p.account) { p.account = payAccount(p); } }
  });
  // b) Achat USD : quantité et taux > 0 ; choix de la caisse qui paie (Liquide ou BaridiMob/CCP)
  var usdCount = 0;
  X.wrap('addUsdPurchase', function () {
    usdCount = (appState.usdPurchases || []).length;
    var a = val('usdAmount'), r = val('usdRate');
    if ((a !== '' && !(num(a) > 0)) || (r !== '' && !(num(r) > 0))) { X.toast('La quantité et le taux doivent être supérieurs à 0', 'error'); return false; }
  }, function () {
    var l = appState.usdPurchases || [];
    if (l.length > usdCount) { var u = l[l.length - 1]; if (u) { u.dzdAccount = val('usdDzdAccount') === 'baridimob' ? 'baridimob' : 'liquide'; u.updatedAt = Date.now(); } if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances(); }
  });
  // c) Suppression d'une vente : la dette et le total dépensé du client sont corrigés
  var delTx = null;
  X.wrap('deleteTransaction', function (id) { var t = X.find(appState.transactions, id); delTx = t ? JSON.parse(JSON.stringify(t)) : null; }, function (id) {
    try {
      if (!delTx || X.find(appState.transactions, id)) { delTx = null; return; }
      var t = delTx, cl = X.find(appState.clients, t.clientId); delTx = null;
      if (cl && t.status !== 'problem' && !isTask(t)) {
        var ds = cl.debtStartDate;
        // nouveau départ actif : la dette est déjà recalculée automatiquement (pas de deuxième retrait)
        if (!active() && (!t.paid || t.paidAccount === 'avance')) { if (typeof adjustClientUnpaid === 'function') adjustClientUnpaid(cl, -num(t.priceDzd)); else cl.unpaid = num(cl.unpaid) - num(t.priceDzd); }
        if (t.status === 'active' || !t.status) cl.totalSpent = Math.max(0, num(cl.totalSpent) - num(t.priceDzd));
        cl.updatedAt = Date.now();
        if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
        if (num(cl.unpaid) > 0 && ds) cl.debtStartDate = ds;               // l'ancienneté de la dette restante ne repart pas à zéro
        if (typeof autoSave === 'function') autoSave();
      }
    } catch (e) { console.warn('FinanceCore delete', e); }
  });
  // d) Modification d'une vente : caisse demandée quand elle passe à « payée » ; une vente « problème » ne touche pas la dette
  var editSnap = null;
  X.wrap('saveEditTransaction', function () {
    var t = X.find(appState.transactions, val('editTxId')); if (!t) { editSnap = null; return; }
    var cl = X.find(appState.clients, t.clientId);
    if (!t.paid && t.paidAccount) t.paidAccount = null;               // état incohérent (non payée mais « avance ») : normalisé
    editSnap = { id: t.id, paid: !!t.paid, acc: t.paidAccount || null, status: t.status, unpaid: cl ? cl.unpaid : null, debtStart: cl ? cl.debtStartDate : null, clientId: t.clientId };
    var el = document.getElementById('editTxPaid');
    if (el && el.checked && !t.paid && t.status !== 'problem') {
      var sel = val('editTxPaidAccount'), price = num(val('editTxPrice') || t.priceDzd);
      if (!sel) { X.toast('Choisissez dans quelle caisse l\'argent est entré (ou « Déjà réglée par un paiement / avance »)', 'warning'); return false; }
      if (sel !== 'avance' && cl && num(cl.unpaid) < num(t.priceDzd) - 0.5 &&
        !confirm('Attention : la dette actuelle de ' + cl.name + ' (' + X.fmt(cl.unpaid) + ') est inférieure au prix de cette vente (' + X.fmt(t.priceDzd) + ').\n\nCette vente a peut-être DÉJÀ été réglée par un paiement enregistré. Si c\'est le cas, choisissez « Déjà réglée par un paiement / avance », sinon l\'argent sera compté deux fois.\n\nEnregistrer quand même une NOUVELLE entrée de ' + X.fmt(price) + ' en caisse ?')) return false;
      if (sel === 'avance' && cl && -num(cl.unpaid) < num(t.priceDzd) - 0.5 && num(cl.unpaid) < num(t.priceDzd) - 0.5) { /* cas couvert par le paiement déjà saisi : rien à demander */ }
    }
  }, function () {
    try {
      var s = editSnap; editSnap = null; if (!s) return;
      var t = X.find(appState.transactions, s.id); if (!t) return;
      if (s.status === 'problem') {                                   // une vente « problème » ne compte pas : on annule l'effet sur la dette
        var cl = X.find(appState.clients, s.clientId); if (cl) { cl.unpaid = s.unpaid; cl.debtStartDate = s.debtStart; }
      }
      var selA = val('editTxPaidAccount');
      if (t.paid && !s.paid) {
        t.paidAt = Date.now();
        if (selA === 'avance') {                                   // déjà réglée par un paiement : pas de nouvelle entrée d'argent, la dette ne baisse pas une 2e fois
          t.paidAccount = 'avance';
          var cl2 = X.find(appState.clients, s.clientId); if (cl2 && s.status !== 'problem') { cl2.unpaid = Math.round((num(cl2.unpaid) + num(t.priceDzd)) * 100) / 100; if (num(cl2.unpaid) > 0 && s.debtStart) cl2.debtStartDate = s.debtStart; }
        } else t.paidAccount = cashAccount(selA || 'liquide');
      }
      else if (!t.paid) t.paidAccount = null;
      else if (t.paid && s.paid) t.paidAccount = s.acc;
      var cl3 = X.find(appState.clients, s.clientId);
      if (cl3 && num(s.unpaid) > 0 && num(cl3.unpaid) > 0 && s.debtStart) cl3.debtStartDate = s.debtStart;   // l'ancienneté de la dette ne repart pas à zéro
      if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
      if (typeof autoSave === 'function') autoSave();
    } catch (e) { console.warn('FinanceCore edit', e); }
  });

  // e) Un client qui a une dette, une avance ou un historique ne peut pas être supprimé (sa créance disparaîtrait)
  X.wrap('deleteClient', function (id) {
    var cl = X.find(appState.clients, id); if (!cl) return;
    var refs = (appState.transactions || []).some(function (t) { return t && t.clientId === id; }) || (appState.payments || []).some(function (p) { return p && p.clientId === id; }) || (appState.todoTransactions || []).some(function (t) { return t && t.clientId === id; });
    if (Math.abs(num(cl.unpaid)) > 0.5 || refs) { X.toast(cl.name + ' a ' + (Math.abs(num(cl.unpaid)) > 0.5 ? (num(cl.unpaid) > 0 ? 'une dette de ' + X.fmt(cl.unpaid) : 'une avance de ' + X.fmt(-num(cl.unpaid))) : 'des ventes ou des paiements') + ' : il ne peut pas être supprimé. S\'il s\'agit d\'un doublon, fusionnez-le (CRM › Doublons).', 'error'); return false; }
  });
  // f) Une tâche (ou vente en problème) déjà PAYÉE ne se supprime pas : l'argent reçu est en caisse
  X.wrap('deleteTodoTransaction', function (id, type) {
    var arr = type === 'problem' ? appState.transactions : appState.todoTransactions, t = X.find(arr, id);
    if (t && t.paid && t.paidAccount !== 'avance') { X.toast('Cette tâche est marquée payée : l\'argent est compté en caisse. Décochez d\'abord « Payé » (si l\'argent a été rendu), puis supprimez-la.', 'error'); return false; }
  });
  // g) « Payée par l'avance du client » alors que son avance ne suffit pas : on prévient (le reste devient une dette)
  function avanceWarn(clientId, price) {
    var cl = X.find(appState.clients, clientId); if (!cl) return true;
    var avail = -num(cl.unpaid);
    if (avail >= price - 0.5) return true;
    return confirm(cl.name + (avail > 0 ? ' n\'a que ' + X.fmt(avail) + ' d\'avance' : ' n\'a aucune avance') + ' pour une vente de ' + X.fmt(price) + '.\n\nLe reste (' + X.fmt(price - Math.max(0, avail)) + ') deviendra une DETTE.\n\nContinuer ?');
  }
  X.wrap('handleNewTodoSubmit', function () {
    var paid = document.getElementById('todoPaid');
    if (paid && paid.checked && val('todoPaidAccount') === 'avance' && !avanceWarn(val('todoClientId'), num(val('todoPrice')))) return false;
  });
  X.wrap('confirmPaidAccount', function (id, type, account) {
    var arr = type === 'problem' ? appState.transactions : appState.todoTransactions, t = X.find(arr, id);
    if (t && account === 'avance' && !avanceWarn(t.clientId, num(t.priceDzd))) { var m = document.getElementById('paidAccountModal'); if (m) m.remove(); return false; }
  }, function (id, type) {
    var arr = type === 'problem' ? appState.transactions : appState.todoTransactions, t = X.find(arr, id);
    if (t && t.paid) { t.paidAt = Date.now(); t.updatedAt = Date.now(); }
  });

  // ------------------------------------------------------------------ champs ajoutés aux formulaires existants (sans toucher au HTML)
  function injectFields() {
    try {
      var src = document.getElementById('usdSource');
      if (src && !document.getElementById('usdDzdAccount')) {
        var s = document.createElement('select');
        s.id = 'usdDzdAccount';
        s.className = src.className;
        s.innerHTML = '<option value="liquide">Payé avec : Liquide (espèces)</option><option value="baridimob">Payé avec : BaridiMob / CCP</option>';
        src.parentNode.insertBefore(s, src.nextSibling);
      }
      var paid = document.getElementById('editTxPaid');
      if (paid && !document.getElementById('editTxPaidAccount')) {
        var box = paid.closest('div') || paid.parentNode, s2 = document.createElement('select');
        s2.id = 'editTxPaidAccount';
        s2.className = 'p-2 border rounded-xl bg-white text-sm font-bold';
        s2.title = 'Caisse où l\'argent est entré (si vous cochez « Payé »)';
        s2.innerHTML = '<option value="">Caisse ?</option><option value="liquide">Liquide</option><option value="baridimob">BaridiMob / CCP</option><option value="usdt">USDT</option><option value="avance">Déjà réglée par un paiement / avance</option>';
        box.appendChild(s2);
      }
    } catch (e) {}
  }
  X.wrap('editTransaction', null, function (id) {
    injectFields();
    var t = X.find(appState.transactions, id), s = document.getElementById('editTxPaidAccount');
    if (s) s.value = t && t.paid && t.paidAccount ? (t.paidAccount === 'avance' ? 'avance' : cashAccount(t.paidAccount)) : '';
  });

  // ------------------------------------------------------------------ contrôle « zéro erreur »
  // Vérifie que chaque écran donne le même chiffre et que les dettes clients suivent exactement les mouvements.
  function selfCheck() {
    var out = [], th = theoretical(), man = appState.manualBalances || {}, bal = appState.balances || {};
    if (typeof recalculateFinanceBalances === 'function') { recalculateFinanceBalances(); bal = appState.balances || {}; }
    ACC.forEach(function (a) {
      var expect = th[a] + num(man[a]), shown = num(bal[a]);
      out.push({ ok: Math.abs(expect - shown) < 0.01, label: 'Solde ' + LABEL[a] + ' affiché = somme des mouvements + ajustements', detail: (a === 'usdt' ? X.usd(shown) : X.fmt(shown)) });
      var L = ledger()[a], run = num(man[a]); L.forEach(function (m) { run += m.inn - m.out; });
      out.push({ ok: Math.abs(run - shown) < 0.01, label: 'Livre de caisse ' + LABEL[a] + ' = solde affiché', detail: (a === 'usdt' ? X.usd(run) : X.fmt(run)) });
    });
    var gaps = clientGaps();
    out.push({ ok: gaps.length === 0, label: 'Dette de chaque client = solde au départ + ventes non payées − paiements depuis le départ', detail: gaps.length ? gaps.length + ' client(s) en écart' : 'tous les clients' });
    var bad = 0;
    movements().forEach(function (m) { if (!isFinite(m.inn) || !isFinite(m.out) || m.inn < 0 || m.out < 0) bad++; });
    out.push({ ok: bad === 0, label: 'Aucun mouvement négatif ou invalide', detail: bad ? bad + ' ligne(s)' : 'OK' });
    return out;
  }

  // ------------------------------------------------------------------ activation / annulation
  window.fcStart = function () {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    if (active()) return X.toast('Le nouveau départ est déjà actif', 'info');
    var date = val('fcDate') || X.today();
    if (!X.isYmd(date)) return X.toast('Date invalide', 'error');
    if (date > X.today()) return X.toast('La date de départ ne peut pas être dans le futur', 'error');
    var debts = 0, adv = 0, n = 0;
    (appState.clients || []).forEach(function (c) { var u = num(c.unpaid); if (u > 0) { debts += u; n++; } else if (u < 0) { adv += -u; n++; } });
    if (!confirm('NOUVEAU DÉPART COMPTABLE au ' + X.fmtDate(date) + '\n\n' +
      (date < X.today() ? '• Caisses recalculées à partir de 0 au ' + X.fmtDate(date) + ' : les mouvements datés depuis cette date (jusqu\'à aujourd\'hui inclus) seront comptés\n' : '• Caisses remises à 0 : Liquide 0 DA, BaridiMob 0 DA, USDT 0\n') +
      '• Soldes clients CONSERVÉS : ' + X.fmt(debts) + ' de dettes et ' + X.fmt(adv) + ' d\'avances (' + n + ' clients)\n' +
      '• Rien n\'est supprimé : ventes, campagnes, factures, primes et historique restent intacts\n' +
      '• Les lignes d\'argent d\'avant cette date seront figées\n' +
      '• Une sauvegarde complète est faite juste avant ; vous pourrez annuler\n\nConfirmer ?')) return;
    var apply = function () {
      var at = Date.now(), atDay = X.today(), tmp = { date: date, at: at, atDay: atDay };
      S.set('ledgerStart', tmp, true);                                // provisoire (sans sauvegarde) : pour calculer ce qui est déjà dans la nouvelle période
      var d = clientDeltas(), op = {};
      (appState.clients || []).forEach(function (c) { var o = num(c.unpaid) - num(d[c.id]); if (Math.abs(o) > 0.004) op[c.id] = o; });
      var prev = Object.assign({ liquide: 0, baridimob: 0, usdt: 0 }, appState.manualBalances || {});
      S.set('ledgerStart', { date: date, at: at, atDay: atDay, opening: { liquide: 0, baridimob: 0, usdt: 0 }, clientOpening: op, prevManual: prev, by: X.actor(), debts: debts, advances: adv });
      appState.manualBalances = { liquide: 0, baridimob: 0, usdt: 0 };
      if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
      X.log('Nouveau départ comptable', 'Au ' + X.fmtDate(date) + ' — caisses à 0, soldes clients conservés (' + X.fmt(debts) + ' de dettes, ' + X.fmt(adv) + ' d\'avances)');
      X.save(); X.toast('Nouveau départ comptable activé', 'success'); X.rerender();
    };
    if (window.BackupCore && BackupCore.createSnapshot) BackupCore.createSnapshot('pre-restore', 'Avant le nouveau départ comptable').then(apply, function () { if (confirm('La sauvegarde de sécurité a échoué. Continuer quand même ?')) apply(); });
    else apply();
  };
  window.fcUndo = function () {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var c = cfg(); if (!c) return;
    if (!confirm('Annuler le nouveau départ comptable du ' + X.fmtDate(c.date) + ' ?\n\nLes caisses seront de nouveau calculées sur tout l\'historique (avec les anciennes erreurs). Les ventes et paiements saisis depuis restent enregistrés. Les soldes clients restent tels qu\'ils sont aujourd\'hui (corrections de départ comprises).')) return;
    var pm = c.prevManual || {}, cur = appState.manualBalances || {};   // ajustements d'avant + ceux faits pendant le départ
    appState.manualBalances = { liquide: num(pm.liquide) + num(cur.liquide), baridimob: num(pm.baridimob) + num(cur.baridimob), usdt: num(pm.usdt) + num(cur.usdt) };
    S.set('ledgerStart', null);
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    X.log('Nouveau départ comptable annulé', 'Départ du ' + X.fmtDate(c.date)); X.save(); X.toast('Nouveau départ annulé', 'info'); X.rerender();
  };

  // ------------------------------------------------------------------ écran
  function render(c) {
    if (!X.isAdmin()) { c.innerHTML = '<p class="text-center py-8 text-gray-500">Réservé à l\'administrateur</p>'; return; }
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    var st = cfg(), b = appState.balances || {}, h = '';
    h += '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-flag-checkered text-indigo-600 mr-2"></i>Nouveau départ comptable</h2>' +
      '<p class="text-xs text-gray-500 mt-1">Repartir de zéro en comptabilité, sans rien supprimer : les primes, les campagnes, les factures et l\'historique restent intacts.</p></div>';
    if (!st) {
      var debts = 0, adv = 0, n = 0;
      (appState.clients || []).forEach(function (cl) { var u = num(cl.unpaid); if (u > 0) { debts += u; n++; } else if (u < 0) { adv += -u; n++; } });
      h += X.card('Ce qui va se passer', 'fa-circle-info',
        '<ul class="text-sm space-y-2 text-gray-700 dark:text-gray-300 list-disc pl-5">' +
        '<li>Les caisses repartent à <b>0</b> : Liquide, BaridiMob/CCP et stock USDT.</li>' +
        '<li>Les soldes clients sont <b>conservés</b> : ' + X.fmt(debts) + ' de dettes et ' + X.fmt(adv) + ' d\'avances (' + n + ' clients). Juste après, vous pourrez corriger le solde de départ de chaque client.</li>' +
        '<li>Ensuite, la dette de chaque client est <b>calculée automatiquement</b> (solde de départ + ventes non payées − paiements) : elle ne peut plus dériver.</li>' +
        '<li>Ensuite, seuls les mouvements datés à partir du départ (ou saisis après) comptent dans les caisses.</li>' +
        '<li>Les lignes d\'argent plus anciennes sont figées : plus de modification ni de suppression possible, pour que rien ne bouge en arrière.</li>' +
        '<li>Une sauvegarde complète est faite juste avant. Vous pouvez annuler à tout moment.</li></ul>' +
        (ro() ? '' : '<div class="flex flex-wrap items-end gap-3 mt-5"><label class="text-xs font-bold text-gray-600">Date du départ<input id="fcDate" type="date" value="' + X.today() + '" class="' + X.input + ' mt-1 block"></label>' +
        X.btn('Démarrer la nouvelle comptabilité', 'fcStart()', 'bg-indigo-600 text-white hover:bg-indigo-700', 'fa-flag-checkered') + '</div>'));
    } else {
      h += '<div class="p-4 rounded-2xl bg-green-50 border border-green-200 text-green-800 text-sm font-bold mb-4"><i class="fas fa-circle-check mr-1"></i>Nouveau départ actif depuis le ' + E(X.fmtDate(st.date)) + ' (par ' + E(st.by || '—') + '). Soldes clients conservés au départ : ' + X.fmt(st.debts || 0) + ' de dettes, ' + X.fmt(st.advances || 0) + ' d\'avances.</div>';
      h += '<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">' + X.kpi('Liquide', X.fmt(b.liquide || 0), num(b.liquide) < 0 ? 'text-red-600' : '', 'fa-money-bill') + X.kpi('BaridiMob / CCP', X.fmt(b.baridimob || 0), num(b.baridimob) < 0 ? 'text-red-600' : '', 'fa-building-columns') + X.kpi('Stock USDT', X.usd(b.usdt || 0), num(b.usdt) < 0 ? 'text-red-600' : '', 'fa-coins') + '</div>';
      var chk = selfCheck(), allOk = chk.every(function (r) { return r.ok; });
      h += X.card('Contrôle zéro erreur', allOk ? 'fa-shield-halved' : 'fa-triangle-exclamation',
        '<p class="text-sm mb-3 font-bold ' + (allOk ? 'text-green-700' : 'text-red-700') + '">' + (allOk ? 'Tout concorde : chaque écran affiche les mêmes chiffres.' : 'Écart détecté : voir les lignes en rouge.') + '</p>' +
        X.table([['Vérification'], ['Résultat', 'r'], ['', 'c']], chk.map(function (r) { return '<tr><td class="p-3 text-sm">' + E(r.label) + '</td><td class="p-3 text-right text-sm font-mono">' + E(r.detail) + '</td><td class="p-3 text-center">' + (r.ok ? '<span class="text-green-600 font-black">✓</span>' : '<span class="text-red-600 font-black">✗</span>') + '</td></tr>'; }).join('')));
      var negs = ACC.filter(function (a) { return num(b[a]) < 0; });
      if (negs.length) h += '<div class="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold mb-4">' + negs.map(function (a) { return LABEL[a]; }).join(', ') + ' négatif : un mouvement d\'entrée n\'a pas été saisi (achat USD, paiement…) ou une sortie est en trop.</div>';
      h += clientsCard();
      if (!ro()) h += '<div class="mt-2">' + X.btn('Annuler le nouveau départ', 'fcUndo()', 'bg-gray-200 text-gray-700 hover:bg-gray-300', 'fa-rotate-left') + '</div>';
    }
    c.innerHTML = h;
  }
  X.registerTab('freshstart', { nav: { group: 'compta', groupLabel: 'Comptabilité', groupIcon: 'fa-calculator', label: 'Nouveau départ', icon: 'fa-flag-checkered' }, render: render });

  window.FinanceCore = { active: active, config: cfg, inLedger: inLedger, movements: movements, ledger: ledger, theoretical: theoretical, payAccount: payAccount,
    received: received, cashFlow: cashFlow, transferOpening: transferOpening, consumesUsdt: consumesUsdt,
    clientDeltas: clientDeltas, expectedUnpaid: expectedUnpaid, clientGaps: clientGaps, selfCheck: selfCheck, syncClientBalances: syncClientBalances, timeline: timeline, historyBalance: historyBalance };
  function boot() { injectFields(); if (X.installTabs) X.installTabs(); if (typeof recalculateFinanceBalances === 'function') try { recalculateFinanceBalances(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
