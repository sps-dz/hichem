// =====================================================================
//  GESTION DE LA PAIE DES SALARIÉS  (section "Performance Salariés")
//  - Journal de paie mensuel (base + prime performance + primes - absences)
//  - Historique complet des paiements (filtres, cumul, export CSV, relevé)
//  - Bulletin de paie et reçu de paiement (aperçu A4, impression, PDF)
//  Les données restent dans appState.employeePayments (mêmes anciens champs :
//  id, employeeId, description, amount, date, paid, createdAt) + champs optionnels
//  ajoutés : type, period, method, receiptNo, note, paidAt, createdBy, updatedAt.
// =====================================================================
(function () {
  'use strict';

  // ------------------------------------------------------------------ constantes
  var TYPES = {
    salaire: { label: 'Salaire',                 salary: true  },
    acompte: { label: 'Acompte / Avance',        salary: true  },
    prime:   { label: 'Prime / Bonus',           salary: true  },
    frais:   { label: 'Remboursement de frais',  salary: false },
    autre:   { label: 'Autre (hors salaire)',    salary: false }
  };
  var METHODS = {
    liquide:   'Liquide',
    baridimob: 'BaridiMob',
    virement:  'Virement / CCP',
    usdt:      'USDT',
    autre:     'Autre'
  };
  var NAVY = '#0f2a52', BLUE = '#1d6fe8', SOFT = '#eef4fd', LINE = '#dbe5f3';

  // ------------------------------------------------------------------ utilitaires
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nf(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f/g, '\u00a0'); }
  function fmt(n) { return nf(n) + '\u00a0DA'; }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function fmtDate(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : (s ? String(s) : '—');
  }
  function fmtTs(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleDateString('fr-FR', { timeZone: 'Africa/Algiers' }); } catch (e) { return '—'; }
  }
  function monthLabel(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(ym || '');
    var s = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function todayYmd() {
    var d = (typeof getAlgeriaNow === 'function') ? getAlgeriaNow() : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function currentMonth() { return todayYmd().slice(0, 7); }
  function shiftMonth(ym, delta) {
    var m = String(ym).match(/^(\d{4})-(\d{2})$/);
    var d = m ? new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'info'); }
  function save() { if (typeof autoSave === 'function') autoSave(); }
  function words(n) { return (typeof amountToFrenchDinars === 'function') ? amountToFrenchDinars(n) : (nf(n) + ' DA'); }

  function canManage() {
    var s = appState.session;
    if (!s || s.type !== 'employee') return true;               // admin
    return !!(s.permissions && s.permissions.payroll === true);  // employé autorisé explicitement
  }
  function actorName() {
    var s = appState.session;
    if (s && s.type === 'employee') return s.name || s.login || 'Employé';
    try { if (window.auth && auth.currentUser && auth.currentUser.email) return auth.currentUser.email; } catch (e) {}
    return 'Admin';
  }
  function log(action, details) { if (typeof logActivity === 'function') { try { logActivity(action, details); } catch (e) {} } }

  function payments() { if (!appState.employeePayments) appState.employeePayments = []; return appState.employeePayments; }
  function payType(p) { return TYPES[p && p.type] ? p.type : 'salaire'; }
  function payPeriod(p) { return (p && /^\d{4}-\d{2}$/.test(p.period || '')) ? p.period : String((p && p.date) || '').slice(0, 7); }
  function payMethod(p) { return METHODS[p && p.method] || (p && p.method ? String(p.method) : '—'); }
  function empById(id) { return (appState.employees || []).find(function (e) { return e.id === id; }); }
  function empName(id) { var e = empById(id); return e ? (e.name || e.login || 'Employé') : 'Employé supprimé'; }
  function receiptNumber(p) {
    if (p.receiptNo) return p.receiptNo;
    return 'PAY-' + payPeriod(p).replace('-', '') + '-' + String(p.id || '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  }
  function nextReceiptNo(period) {
    var prefix = 'PAY-' + period.replace('-', '') + '-';
    var max = 0;
    payments().forEach(function (p) {
      if (p.receiptNo && p.receiptNo.indexOf(prefix) === 0) {
        var n = parseInt(p.receiptNo.slice(prefix.length), 10);
        if (n > max) max = n;
      }
    });
    return prefix + String(max + 1).padStart(3, '0');
  }
  // Même barème que le tableau "Classement Salariés"
  function perfPrimeFor(gain) {
    if (gain >= 350000) return 12000;
    if (gain >= 250000) return 8000;
    if (gain >= 150000) return 5000;
    return 0;
  }


  // =====================================================================
  //  PARAMÈTRES DE PAIE · ABSENCES JUSTIFIÉES · AVANCES SUR SALAIRE
  // =====================================================================
  function extrasHtml(month, rows) {
    var inp = 'p-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm';
    var cfg = (typeof getPerformanceConfig === 'function') ? getPerformanceConfig() : { ratePerTask: 1700, primeScale: [] };
    var scale = (cfg.primeScale || []).slice().sort(function (a, b) { return a.min - b.min; });
    while (scale.length < 4) scale.unshift({ min: '', bonus: '' });
    scale = scale.slice(-4);
    var ameta = window.ExtStore ? ExtStore.map('absenceMeta') : {};
    var absList = (appState.absences || []).filter(function (a) { return a && String(a.date || '').slice(0, 7) === month; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var absHtml = absList.length ? absList.map(function (a) {
      var j = !!(ameta[a.id] && ameta[a.id].justified);
      return '<div class="flex items-center justify-between p-2 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm"><span><b>' + esc(empName(a.employeeId)) + '</b> <span class="text-gray-500">— ' + fmtDate(a.date) + '</span></span>' +
        '<button onclick="payrollAbsenceToggle(\'' + esc(a.id) + '\')" class="px-3 py-1 text-xs font-bold rounded-lg ' + (j ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') + '">' + (j ? 'Justifiée (non retenue)' : 'Non justifiée (retenue)') + '</button></div>';
    }).join('') : '<p class="text-sm text-gray-400 italic">Aucune absence ce mois.</p>';
    var advs = (window.ExtStore ? ExtStore.list('advances') : []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    var advHtml = advs.length ? advs.map(function (a) {
      var done = 0; for (var i = 0; i < a.months; i++) if (shiftMonth(a.startMonth, i) <= currentMonth()) done++;
      return '<div class="flex items-center justify-between p-2 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm"><span><b>' + esc(empName(a.employeeId)) + '</b> — ' + fmt(a.amount) + ' sur ' + a.months + ' mois (' + fmt(a.amount / a.months) + '/mois) dès ' + esc(monthLabel(a.startMonth)) + ' <span class="text-xs text-gray-400">· ' + Math.min(done, a.months) + '/' + a.months + ' retenues</span></span><button onclick="payrollAdvanceDelete(\'' + esc(a.id) + '\')" class="px-2 py-1 text-red-400 hover:bg-red-50 rounded-lg" title="Supprimer l\'avance (les retenues futures s\'arrêtent)"><i class="fas fa-trash-alt"></i></button></div>';
    }).join('') : '<p class="text-sm text-gray-400 italic">Aucune avance en cours.</p>';
    var emps = (appState.employees || []).filter(function (e) { return e.active !== false; });
    var empOpts = emps.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name || e.login) + '</option>'; }).join('');
    return '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-8">' +
      '<div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-sliders text-indigo-500 mr-2"></i>Paramètres de paie</h4><p class="text-[11px] text-gray-400 mb-3">Tarif par tâche et barème des primes de performance (valable pour tout le projet).</p>' +
        '<label class="text-xs font-bold text-gray-500">Tarif par tâche (DA)</label><input id="ps-rate" type="number" value="' + esc(cfg.ratePerTask) + '" class="' + inp + ' w-full mb-3">' +
        '<div class="text-xs font-bold text-gray-500 mb-1">Barème : gain ≥ seuil → prime</div>' + scale.map(function (t, i) { return '<div class="flex gap-2 mb-2"><input id="ps-min' + i + '" type="number" placeholder="seuil (DA)" value="' + esc(t.min) + '" class="' + inp + ' w-1/2"><input id="ps-bonus' + i + '" type="number" placeholder="prime (DA)" value="' + esc(t.bonus) + '" class="' + inp + ' w-1/2"></div>'; }).join('') +
        '<div class="flex gap-2 mt-2"><button onclick="payrollSaveSettings()" class="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm">Enregistrer</button><button onclick="payrollResetSettings()" class="px-3 py-2 border dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300">Défaut</button></div></div>' +
      '<div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-user-clock text-indigo-500 mr-2"></i>Absences de ' + esc(monthLabel(month)) + '</h4><p class="text-[11px] text-gray-400 mb-3">Une absence justifiée n\'est pas retenue sur le salaire.</p><div class="space-y-2">' + absHtml + '</div></div>' +
      '<div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-hand-holding-dollar text-indigo-500 mr-2"></i>Avances sur salaire</h4><p class="text-[11px] text-gray-400 mb-3">Avance versée maintenant, remboursée par retenue mensuelle.</p>' +
        '<div class="grid grid-cols-2 gap-2 mb-2"><select id="av-emp" class="' + inp + ' col-span-2"><option value="">Salarié…</option>' + empOpts + '</select><input id="av-amount" type="number" placeholder="Montant (DA)" class="' + inp + '"><input id="av-months" type="number" min="1" max="24" value="3" class="' + inp + '" title="Nombre de mois"><input id="av-start" type="month" value="' + esc(month) + '" class="' + inp + '"><select id="av-method" class="' + inp + '">' + Object.keys(METHODS).map(function (k) { return '<option value="' + k + '">' + METHODS[k] + '</option>'; }).join('') + '</select></div>' +
        '<button onclick="savePayrollAdvance()" class="w-full px-3 py-2 bg-green-600 text-white rounded-xl font-bold text-sm mb-3">Verser l\'avance</button><div class="space-y-2">' + advHtml + '</div></div></div>';
  }
  window.payrollSaveSettings = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var rate = Number(document.getElementById('ps-rate').value), scale = [];
    for (var i = 0; i < 4; i++) { var mn = Number(document.getElementById('ps-min' + i).value), bn = Number(document.getElementById('ps-bonus' + i).value); if (mn > 0 && bn >= 0 && document.getElementById('ps-bonus' + i).value !== '') scale.push({ min: mn, bonus: bn }); }
    if (!(rate > 0)) return toast('Tarif par tâche invalide', 'error');
    ExtStore.set('perf', { ratePerTask: rate, primeScale: scale.length ? scale : undefined }, true);
    log('Paramètres de paie modifiés', 'tarif ' + fmt(rate) + ' / tâche, ' + scale.length + ' palier(s) de prime'); save(); toast('Paramètres enregistrés', 'success'); window.refreshPayroll();
    if (typeof renderCurrentTab === 'function' && appState.currentTab === 'performance') renderCurrentTab();
  };
  window.payrollResetSettings = function () { if (!canManage() || !confirm('Revenir au tarif et au barème par défaut ?')) return; ExtStore.set('perf', {}, true); log('Paramètres de paie réinitialisés', ''); save(); window.refreshPayroll(); if (typeof renderCurrentTab === 'function') renderCurrentTab(); };
  window.payrollAbsenceToggle = function (id) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var m = ExtStore.map('absenceMeta'), cur = !!(m[id] && m[id].justified); m[id] = { justified: !cur, by: actorName(), ts: Date.now() };
    var a = (appState.absences || []).find(function (x) { return x.id === id; });
    log(cur ? 'Absence marquée non justifiée' : 'Absence justifiée', a ? empName(a.employeeId) + ' — ' + fmtDate(a.date) : ''); save(); window.refreshPayroll();
  };
  window.savePayrollAdvance = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var emp = empById(document.getElementById('av-emp').value), amount = Number(document.getElementById('av-amount').value), months = Math.round(Number(document.getElementById('av-months').value)), start = document.getElementById('av-start').value, method = document.getElementById('av-method').value;
    if (!emp) return toast('Choisissez un salarié', 'error'); if (!(amount > 0)) return toast('Montant invalide', 'error'); if (!(months >= 1 && months <= 24)) return toast('Durée : 1 à 24 mois', 'error'); if (!/^\d{4}-\d{2}$/.test(start)) return toast('Mois de début invalide', 'error');
    if (!confirm('Verser une avance de ' + fmt(amount) + ' à ' + (emp.name || emp.login) + ', remboursée sur ' + months + ' mois (' + fmt(amount / months) + '/mois) ?')) return;
    var adv = { id: 'adv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5), employeeId: emp.id, amount: amount, months: months, startMonth: start, date: todayYmd(), method: method, ts: Date.now(), by: actorName() };
    ExtStore.list('advances').push(adv);
    var pid = 'payment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    payments().push({ id: pid, employeeId: emp.id, description: 'Avance sur salaire (remboursable sur ' + months + ' mois)', amount: amount, date: todayYmd(), paid: true, type: 'autre', period: currentMonth(), method: method, note: 'avance ' + adv.id, receiptNo: nextReceiptNo(currentMonth()), paidAt: Date.now(), createdBy: actorName(), createdAt: Date.now(), updatedAt: Date.now() });
    syncLinkedExpense(pid);
    log('Avance sur salaire versée', empName(emp.id) + ' — ' + fmt(amount) + ' sur ' + months + ' mois'); save(); toast('Avance enregistrée', 'success'); window.refreshPayroll();
  };
  window.payrollAdvanceDelete = function (id) {
    if (!canManage()) return; var l = ExtStore.list('advances'), a = l.find(function (x) { return x.id === id; }); if (!a || !confirm('Supprimer cette avance ? Les retenues futures s\'arrêtent (le versement initial reste dans l\'historique des paiements).')) return;
    l.splice(l.indexOf(a), 1); log('Avance supprimée', empName(a.employeeId) + ' — ' + fmt(a.amount)); save(); window.refreshPayroll();
  };

  // Lien optionnel paie ↔ caisses (activé dans Comptabilité > Profil & réglages) : un salaire payé = un frais
  function syncLinkedExpense(pid) {
    try {
      if (!(window.ExtStore && ExtStore.get('payrollLink', false))) return;
      var p = payments().find(function (x) { return x.id === pid; }), eid = 'exp_pay_' + pid;
      var list = appState.expenses || (appState.expenses = []), ex = list.find(function (x) { return x.id === eid; });
      if (p && p.paid && p.method !== 'usdt' && Number(p.amount) > 0) {
        var acc = (p.method === 'baridimob' || p.method === 'virement') ? 'baridimob' : 'liquide';
        var data = { date: p.date, category: TYPES[payType(p)].salary ? 'Salaires' : 'Frais salariés', account: acc, amount: Number(p.amount), note: 'Paie — ' + empName(p.employeeId) + ' — ' + monthLabel(payPeriod(p)), updatedAt: Date.now() };
        if (ex) Object.assign(ex, data); else list.push(Object.assign({ id: eid, payrollPaymentId: pid, createdAt: Date.now() }, data));
      } else if (ex) {
        appState.expenses = list.filter(function (x) { return x.id !== eid; });
        if (!appState.sync) appState.sync = {}; if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
        appState.sync.pendingDeletions.push({ col: 'expenses', id: eid });
      }
      if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    } catch (e) { console.warn('Lien paie↔caisses', e); }
  }

  // ------------------------------------------------------------------ calcul de la paie
  function computePayrollLive(emp, month, excludePaymentId) {
    var cfg = (typeof getPerformanceConfig === 'function') ? getPerformanceConfig() : (appState.performanceConfig || {});
    var rate = Number(cfg.ratePerTask) || 1700;
    var base = Number(emp.salary) || 0;

    var tasks = 0;
    (appState.transactions || []).forEach(function (t) {
      if (t && t.employeeId === emp.id && isYmd(t.date) && String(t.date).slice(0, 7) === month) tasks++;
    });
    var perfGain = tasks * rate;
    var perfPrime = (typeof getPrimeForGain === 'function') ? getPrimeForGain(perfGain) : perfPrimeFor(perfGain);

    var pays = payments().filter(function (p) {
      return p && p.employeeId === emp.id && payPeriod(p) === month && p.id !== excludePaymentId;
    });
    var bonus = 0, paid = 0, pending = 0, extraPaid = 0;
    pays.forEach(function (p) {
      var t = payType(p), a = Number(p.amount) || 0;
      if (!TYPES[t].salary) { if (p.paid) extraPaid += a; return; }
      if (t === 'prime') bonus += a;
      if (p.paid) paid += a; else pending += a;
    });

    var ameta = (window.ExtStore ? ExtStore.map('absenceMeta') : {});
    var monthAbs = (appState.absences || []).filter(function (a) {
      return a && a.employeeId === emp.id && String(a.date || '').slice(0, 7) === month;
    });
    var justified = monthAbs.filter(function (a) { return ameta[a.id] && ameta[a.id].justified; }).length;
    var absDays = monthAbs.length - justified;                       // seules les absences NON justifiées sont retenues
    var absDeduction = (base / 30) * absDays;
    var advDeduction = 0, advList = [];
    (window.ExtStore ? ExtStore.list('advances') : []).forEach(function (av) {
      if (av && av.employeeId === emp.id && month >= av.startMonth && month <= shiftMonth(av.startMonth, Math.max(1, av.months) - 1)) { advDeduction += Number(av.amount) / Math.max(1, av.months); advList.push(av); }
    });

    // Prime d'encadrement : calculée sur les tâches de l'équipe (désactivée par défaut) — jamais additionnée aux tâches globales
    var lead = (window.TeamOrg && TeamOrg.teamBonus) ? TeamOrg.teamBonus(emp.id, month) : { total: 0, teamTasks: 0 };
    var leadBonus = Number(lead.total) || 0;
    var gross = base + perfPrime + leadBonus + bonus;
    var net = Math.max(0, gross - absDeduction - advDeduction);
    var remaining = net - paid;

    var status;
    if (net <= 0.5 && paid <= 0.5) status = 'none';
    else if (paid <= 0.5) status = 'unpaid';
    else if (remaining > 0.5) status = 'partial';
    else if (remaining < -0.5) status = 'over';
    else status = 'settled';

    return {
      emp: emp, month: month, base: base, tasks: tasks, rate: rate, perfGain: perfGain, perfPrime: perfPrime,
      bonus: bonus, leadBonus: leadBonus, lead: lead, title: emp.title || '', managerId: emp.managerId || '', gross: gross, absDays: absDays, justified: justified, absDeduction: absDeduction, advDeduction: advDeduction, advList: advList, daily: base / 30,
      net: net, paid: paid, pending: pending, extraPaid: extraPaid, remaining: remaining,
      status: status, pays: pays
    };
  }

  // ------------------------------------------------------------------ paie figée (clôture de la paie d'un mois)
  function lockOf(month) { return window.ExtStore ? ExtStore.map('payrollLocks')[month] : null; }
  function statusOf(net, paid, remaining) {
    if (net <= 0.5 && paid <= 0.5) return 'none'; if (paid <= 0.5) return 'unpaid'; if (remaining > 0.5) return 'partial'; if (remaining < -0.5) return 'over'; return 'settled';
  }
  // Un mois figé garde ses chiffres (salaire de base, tâches, primes, retenues) même si le salaire,
  // le barème ou la hiérarchie changent ensuite ; les paiements restent, eux, toujours en direct.
  function computePayroll(emp, month, excludePaymentId) {
    var r = computePayrollLive(emp, month, excludePaymentId), lock = lockOf(month), f = lock && lock.rows && lock.rows[emp.id];
    if (!f) return r;
    ['base', 'tasks', 'rate', 'perfGain', 'perfPrime', 'leadBonus', 'lead', 'absDays', 'justified', 'absDeduction', 'advDeduction', 'advList', 'title', 'managerId'].forEach(function (k) { if (f[k] !== undefined) r[k] = f[k]; });
    r.daily = r.base / 30; r.gross = r.base + r.perfPrime + r.leadBonus + r.bonus; r.net = Math.max(0, r.gross - r.absDeduction - r.advDeduction);
    r.remaining = r.net - r.paid; r.status = statusOf(r.net, r.paid, r.remaining); r.locked = true; r.lockedAt = lock.lockedAt;
    return r;
  }
  window.payrollLockMonth = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var m = ui().month; if (lockOf(m) && lockOf(m).rows) return;
    var warn = m >= currentMonth() ? "\n\n⚠ Ce mois n'est pas terminé : les tâches et absences à venir ne seront pas prises en compte." : '';
    if (!confirm('Figer la paie de ' + monthLabel(m) + " ?\n\nLes salaires de base, tâches, primes (dont primes d'équipe) et retenues de ce mois seront conservés tels quels, même si les salaires, le barème ou la hiérarchie changent ensuite." + warn)) return;
    var rows = {};
    payrollEmployees(m).forEach(function (e) {
      var r = computePayrollLive(e, m);
      rows[e.id] = { base: r.base, tasks: r.tasks, rate: r.rate, perfGain: r.perfGain, perfPrime: r.perfPrime, leadBonus: r.leadBonus, lead: r.lead, absDays: r.absDays, justified: r.justified, absDeduction: r.absDeduction, advDeduction: r.advDeduction, advList: r.advList, title: r.title, managerId: r.managerId };
    });
    ExtStore.map('payrollLocks')[m] = { lockedAt: Date.now(), by: actorName(), rows: rows };
    log('Paie figée', monthLabel(m) + ' — ' + Object.keys(rows).length + ' salarié(s)'); save(); toast('Paie figée', 'success'); window.refreshPayroll();
  };
  window.payrollUnlockMonth = function () {
    if (!canManage()) return toast('Accès refusé', 'error'); var m = ui().month, l = lockOf(m); if (!l) return;
    var reason = prompt('Motif de la réouverture de la paie de ' + monthLabel(m) + ' :'); if (reason === null) return;
    delete ExtStore.map('payrollLocks')[m]; log('Paie rouverte', monthLabel(m) + ' — ' + reason); save(); toast('Paie rouverte (recalculée en direct)', 'info'); window.refreshPayroll();
  };

  function payrollEmployees(month) {
    var list = (appState.employees || []).filter(function (e) { return e.active !== false; });
    var ids = {}; list.forEach(function (e) { ids[e.id] = true; });
    // un salarié désactivé reste visible s'il a des paiements sur la période
    (appState.employees || []).forEach(function (e) {
      if (ids[e.id]) return;
      var has = payments().some(function (p) { return p.employeeId === e.id && payPeriod(p) === month; });
      if (has) { list.push(e); ids[e.id] = true; }
    });
    return list;
  }

  function statusBadge(st) {
    var map = {
      settled: ['Soldé', 'bg-green-100 text-green-700'],
      partial: ['Partiel', 'bg-amber-100 text-amber-700'],
      unpaid:  ['Non payé', 'bg-red-100 text-red-700'],
      over:    ['Trop-perçu', 'bg-purple-100 text-purple-700'],
      none:    ['Sans salaire', 'bg-gray-100 text-gray-500']
    };
    var m = map[st] || map.none;
    return '<span class="px-2 py-1 rounded-full text-[10px] font-black whitespace-nowrap ' + m[1] + '">' + m[0] + '</span>';
  }
  function paidBadge(p) {
    return p.paid
      ? '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-green-100 text-green-700 whitespace-nowrap">Payé</span>'
      : '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700 whitespace-nowrap">En attente</span>';
  }

  function ui() {
    if (!appState.ui) appState.ui = {};
    if (!appState.ui.payroll) appState.ui.payroll = {};
    if (!/^\d{4}-\d{2}$/.test(appState.ui.payroll.month || '')) appState.ui.payroll.month = currentMonth();
    return appState.ui.payroll;
  }

  // =====================================================================
  //  SECTION PRINCIPALE : journal de paie
  // =====================================================================
  window.renderPayrollSection = function (container) {
    if (!container) return;
    if (!canManage()) {
      container.innerHTML =
        '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8 border dark:border-gray-700 mt-8 text-center">' +
        '<i class="fas fa-lock text-3xl text-gray-300 mb-3"></i>' +
        '<h2 class="text-xl font-bold text-gray-800 dark:text-white">Gestion de la paie</h2>' +
        '<p class="text-sm text-gray-500 mt-2">Cette section est réservée à l\'administrateur.</p></div>';
      return;
    }

    var month = ui().month;
    var emps = payrollEmployees(month);
    var rows = emps.map(function (e) { return computePayroll(e, month); });
    rows.sort(function (a, b) { return String(a.emp.name || a.emp.login || '').localeCompare(String(b.emp.name || b.emp.login || '')); });

    var T = { base: 0, perf: 0, lead: 0, bonus: 0, abs: 0, net: 0, paid: 0, rem: 0, pending: 0 };
    var settledCount = 0;
    rows.forEach(function (r) {
      T.base += r.base; T.perf += r.perfPrime; T.lead += r.leadBonus; T.bonus += r.bonus; T.abs += r.absDeduction + r.advDeduction;
      T.net += r.net; T.paid += r.paid; T.rem += Math.max(0, r.remaining); T.pending += r.pending;
      if (r.status === 'settled' || r.status === 'over') settledCount++;
    });
    var pct = T.net > 0 ? Math.min(100, Math.round((Math.min(T.paid, T.net) / T.net) * 100)) : 0;

    var alerts = [];
    rows.forEach(function (r) {
      var n = esc(r.emp.name || r.emp.login);
      if (r.base <= 0) alerts.push('<b>' + n + '</b> : salaire de base non défini (modifiable dans la section Employés).');
      if (r.status === 'over') alerts.push('<b>' + n + '</b> : trop-perçu de ' + fmt(-r.remaining) + ' sur la période.');
    });

    var monthPays = payments().filter(function (p) { return payPeriod(p) === month; })
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || ((b.createdAt || 0) - (a.createdAt || 0)); });

    var kpi = function (label, value, cls, icon) {
      return '<div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow border dark:border-gray-700">' +
        '<p class="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"><i class="fas ' + icon + ' mr-1"></i>' + label + '</p>' +
        '<p class="text-xl font-black ' + cls + '">' + value + '</p></div>';
    };

    container.innerHTML =
      '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-6 border dark:border-gray-700 mt-8 fade-in">' +
        // ---- en-tête
        '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">' +
          '<div>' +
            '<h2 class="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2"><i class="fas fa-file-invoice-dollar text-indigo-600"></i> Gestion de la paie</h2>' +
            '<p class="text-xs text-gray-500 mt-1">Journal de paie mensuel : salaire de base + prime de performance + primes − absences.</p>' +
          '</div>' +
          '<div class="flex flex-wrap gap-2">' +
            '<button onclick="openPayrollHistory()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow text-sm"><i class="fas fa-clock-rotate-left mr-2"></i>Historique des paiements</button>' +
            '<button onclick="openPayrollPaymentForm()" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow text-sm"><i class="fas fa-plus mr-2"></i>Nouveau paiement</button>' +
            '<button onclick="exportPayrollCSV()" class="px-4 py-2 border dark:border-gray-600 text-gray-700 dark:text-gray-200 font-bold rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700"><i class="fas fa-file-csv mr-2"></i>Exporter la paie</button>' +
          '</div>' +
        '</div>' +
        // ---- navigation de période
        '<div class="flex items-center justify-center gap-3 mb-6">' +
          '<button onclick="payrollShiftMonth(-1)" class="w-10 h-10 rounded-xl border dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-200" title="Mois précédent"><i class="fas fa-chevron-left"></i></button>' +
          '<div class="text-center"><div class="text-[11px] font-bold uppercase tracking-widest text-gray-400">Période de paie</div>' +
          '<div class="text-xl font-black text-gray-800 dark:text-white">' + esc(monthLabel(month)) + '</div>' +
          '<input type="month" value="' + esc(month) + '" onchange="payrollSetMonth(this.value)" class="mt-1 text-xs p-1 border dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white"></div>' +
          '<button onclick="payrollShiftMonth(1)" class="w-10 h-10 rounded-xl border dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-200" title="Mois suivant"><i class="fas fa-chevron-right"></i></button>' +
          (month !== currentMonth() ? '<button onclick="payrollSetMonth(\'' + currentMonth() + '\')" class="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200">Mois en cours</button>' : '') +
          (lockOf(month) && lockOf(month).rows ? '<span class="px-3 py-2 text-xs font-black rounded-xl bg-gray-800 text-white"><i class="fas fa-lock mr-1"></i>Paie figée le ' + esc(fmtTs(lockOf(month).lockedAt)) + '</span><button onclick="payrollUnlockMonth()" class="px-3 py-2 text-xs font-bold rounded-xl bg-amber-100 text-amber-800 hover:bg-amber-200">Rouvrir</button>' : '<button onclick="payrollLockMonth()" class="px-3 py-2 text-xs font-bold rounded-xl bg-gray-800 text-white hover:bg-black"><i class="fas fa-lock mr-1"></i>Figer la paie</button>') +
        '</div>' +
        // ---- KPI
        '<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">' +
          kpi('Masse salariale brute', fmt(T.base + T.perf + T.lead + T.bonus), 'text-gray-800 dark:text-white', 'fa-users') +
          kpi('Retenues (absences + avances)', '− ' + fmt(T.abs), 'text-red-600', 'fa-user-clock') +
          kpi('Net à payer', fmt(T.net), 'text-indigo-600', 'fa-scale-balanced') +
          kpi('Déjà payé', fmt(T.paid), 'text-green-600', 'fa-circle-check') +
          kpi('Reste à payer', fmt(T.rem), T.rem > 0 ? 'text-red-600' : 'text-green-600', 'fa-hourglass-half') +
        '</div>' +
        '<div class="mb-6">' +
          '<div class="flex justify-between text-xs font-bold text-gray-500 mb-1"><span>Avancement de la paie — ' + settledCount + ' / ' + rows.length + ' salarié(s) soldé(s)</span><span>' + pct + '%</span></div>' +
          '<div class="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"><div class="h-full ' + (pct >= 100 ? 'bg-green-500' : 'bg-indigo-500') + '" style="width:' + pct + '%"></div></div>' +
          (T.pending > 0 ? '<div class="text-xs text-amber-600 font-semibold mt-2"><i class="fas fa-clock mr-1"></i>' + fmt(T.pending) + ' de paiement(s) planifié(s) en attente (non comptés comme payés).</div>' : '') +
        '</div>' +
        (alerts.length ? '<div class="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-800 space-y-1">' +
          alerts.map(function (a) { return '<div><i class="fas fa-triangle-exclamation mr-2"></i>' + a + '</div>'; }).join('') + '</div>' : '') +
        // ---- journal de paie
        '<div class="overflow-x-auto rounded-2xl border dark:border-gray-700">' +
          '<table class="w-full text-sm">' +
            '<thead><tr class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-[11px] font-black uppercase">' +
              '<th class="p-3 text-left">Salarié</th><th class="p-3 text-right">Base</th><th class="p-3 text-right">Prime perf.</th><th class="p-3 text-right">Prime équipe</th>' +
              '<th class="p-3 text-right">Primes</th><th class="p-3 text-right">Retenues</th><th class="p-3 text-right">Net à payer</th>' +
              '<th class="p-3 text-right">Payé</th><th class="p-3 text-right">Reste</th><th class="p-3 text-center">Statut</th><th class="p-3 text-center">Actions</th>' +
            '</tr></thead><tbody class="divide-y dark:divide-gray-700">' +
            (rows.length === 0 ? '<tr><td colspan="11" class="p-8 text-center text-gray-400 italic">Aucun salarié actif</td></tr>' :
              rows.map(function (r) {
                var id = esc(r.emp.id);
                return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40">' +
                  '<td class="p-3"><div class="font-bold text-gray-800 dark:text-white">' + esc(r.emp.name || r.emp.login) + '</div>' +
                    '<div class="text-[11px] text-gray-400">' + (r.title ? esc(r.title) + ' · ' : '') + r.tasks + ' tâche(s)' + (r.emp.active === false ? ' · inactif' : '') + (r.locked ? ' · <i class="fas fa-lock"></i> figée' : '') + '</div></td>' +
                  '<td class="p-3 text-right font-mono text-gray-700 dark:text-gray-300">' + nf(r.base) + '</td>' +
                  '<td class="p-3 text-right font-mono text-green-700">' + (r.perfPrime ? '+' + nf(r.perfPrime) : '—') + '</td>' +
                  '<td class="p-3 text-right font-mono text-purple-700">' + (r.leadBonus ? '+' + nf(r.leadBonus) + ' <span class="text-[10px] text-gray-400">(' + (r.lead && r.lead.teamTasks || 0) + ' t.)</span>' : '—') + '</td>' +
                  '<td class="p-3 text-right font-mono text-green-700">' + (r.bonus ? '+' + nf(r.bonus) : '—') + '</td>' +
                  '<td class="p-3 text-right font-mono text-red-600">' + ((r.absDeduction + r.advDeduction) ? '−' + nf(r.absDeduction + r.advDeduction) + ' <span class="text-[10px] text-gray-400">(' + (r.absDays ? r.absDays + ' j abs.' : '') + (r.absDays && r.advDeduction ? ' + ' : '') + (r.advDeduction ? 'avance' : '') + (r.justified ? ' · ' + r.justified + ' justifiée(s)' : '') + ')</span>' : (r.justified ? '<span class="text-[10px] text-gray-400">' + r.justified + ' abs. justifiée(s)</span>' : '—')) + '</td>' +
                  '<td class="p-3 text-right font-mono font-black text-indigo-600">' + nf(r.net) + '</td>' +
                  '<td class="p-3 text-right font-mono text-green-700">' + nf(r.paid) + '</td>' +
                  '<td class="p-3 text-right font-mono font-bold ' + (r.remaining > 0.5 ? 'text-red-600' : 'text-gray-500') + '">' + nf(Math.max(0, r.remaining)) + '</td>' +
                  '<td class="p-3 text-center">' + statusBadge(r.status) + '</td>' +
                  '<td class="p-3 text-center whitespace-nowrap">' +
                    '<button onclick="openPayrollPaymentForm(\'' + id + '\')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Enregistrer un paiement"><i class="fas fa-hand-holding-dollar"></i></button>' +
                    '<button onclick="openPayslip(\'' + id + '\',\'' + esc(month) + '\')" class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-lg" title="Bulletin de paie"><i class="fas fa-file-lines"></i></button>' +
                    '<button onclick="openPayrollHistory(\'' + id + '\')" class="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded-lg" title="Historique de ce salarié"><i class="fas fa-clock-rotate-left"></i></button>' +
                  '</td></tr>';
              }).join('')) +
            '</tbody>' +
            (rows.length ? '<tfoot><tr class="bg-gray-50 dark:bg-gray-900 font-black text-gray-800 dark:text-white">' +
              '<td class="p-3 text-left uppercase text-xs">Total</td>' +
              '<td class="p-3 text-right font-mono">' + nf(T.base) + '</td><td class="p-3 text-right font-mono">' + nf(T.perf) + '</td>' +
              '<td class="p-3 text-right font-mono">' + nf(T.lead) + '</td><td class="p-3 text-right font-mono">' + nf(T.bonus) + '</td><td class="p-3 text-right font-mono text-red-600">−' + nf(T.abs) + '</td>' +
              '<td class="p-3 text-right font-mono text-indigo-600">' + nf(T.net) + '</td><td class="p-3 text-right font-mono text-green-700">' + nf(T.paid) + '</td>' +
              '<td class="p-3 text-right font-mono ' + (T.rem > 0 ? 'text-red-600' : '') + '">' + nf(T.rem) + '</td><td colspan="2"></td></tr></tfoot>' : '') +
          '</table>' +
        '</div>' +
        '<p class="text-[11px] text-gray-400 mt-2">Montants en DA. Absence = salaire de base ÷ 30 par jour d\'absence. Seuls les paiements marqués « Payé » sont comptés.</p>' +
        (window.TeamOrg ? TeamOrg.html(month) : '') +
        extrasHtml(month, rows) +
        // ---- paiements de la période
        '<div class="mt-8">' +
          '<div class="flex items-center justify-between mb-3"><h3 class="font-bold text-gray-800 dark:text-white"><i class="fas fa-receipt text-indigo-500 mr-2"></i>Paiements de ' + esc(monthLabel(month)) + ' (' + monthPays.length + ')</h3>' +
          '<button onclick="openPayrollHistory(\'\',\'' + esc(month) + '\')" class="text-xs font-bold text-indigo-600 hover:underline">Voir tout l\'historique →</button></div>' +
          (monthPays.length === 0 ? '<p class="text-sm text-gray-400 italic">Aucun paiement enregistré pour cette période.</p>' :
            '<div class="space-y-2">' + monthPays.slice(0, 8).map(function (p) {
              return '<div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900">' +
                '<div><div class="text-sm font-bold text-gray-800 dark:text-white">' + esc(empName(p.employeeId)) + ' <span class="font-normal text-gray-500">— ' + esc(p.description || TYPES[payType(p)].label) + '</span></div>' +
                '<div class="text-[11px] text-gray-400">' + fmtDate(p.date) + ' · ' + esc(TYPES[payType(p)].label) + ' · ' + esc(payMethod(p)) + ' · ' + esc(receiptNumber(p)) + '</div></div>' +
                '<div class="flex items-center gap-2"><span class="font-black ' + (p.paid ? 'text-green-600' : 'text-amber-600') + '">' + fmt(p.amount) + '</span>' + paidBadge(p) +
                '<button onclick="togglePaymentStatus(\'' + esc(p.id) + '\')" class="px-2 py-1 text-xs font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700" title="Changer le statut">' + (p.paid ? 'Annuler' : 'Marquer payé') + '</button>' +
                '<button onclick="openPaymentReceipt(\'' + esc(p.id) + '\')" class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-lg" title="Reçu"><i class="fas fa-receipt"></i></button></div></div>';
            }).join('') + '</div>') +
        '</div>' +
      '</div>';
  };

  window.refreshPayroll = function () {
    var c = document.getElementById('payrollSection');
    if (c) window.renderPayrollSection(c);
    var h = document.getElementById('payrollHistoryModal');
    if (h && h.classList.contains('flex')) renderHistoryBody();
  };
  window.payrollShiftMonth = function (d) { ui().month = shiftMonth(ui().month, d); window.refreshPayroll(); };
  window.payrollSetMonth = function (v) { if (/^\d{4}-\d{2}$/.test(v || '')) { ui().month = v; window.refreshPayroll(); } };

  // =====================================================================
  //  PAIEMENTS : formulaire, statut, suppression
  // =====================================================================
  function removeEl(id) { var el = document.getElementById(id); if (el) el.remove(); }

  window.openPayrollPaymentForm = function (employeeId, paymentId, presetPeriod) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var editing = paymentId ? payments().find(function (p) { return p.id === paymentId; }) : null;
    if (paymentId && !editing) return toast('Paiement introuvable', 'error');

    var emps = (appState.employees || []).filter(function (e) { return e.active !== false || (editing && editing.employeeId === e.id); });
    if (!emps.length) return toast('Aucun employé actif', 'warning');

    var selEmp = editing ? editing.employeeId : (employeeId || '');
    var period = editing ? payPeriod(editing) : (presetPeriod || ui().month);
    var type = editing ? payType(editing) : 'salaire';
    var method = editing && METHODS[editing.method] ? editing.method : 'liquide';
    var date = editing ? (editing.date || todayYmd()) : todayYmd();
    var isPaid = editing ? !!editing.paid : true;

    removeEl('payrollPaymentModal');
    var modal = document.createElement('div');
    modal.id = 'payrollPaymentModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-3';
    modal.style.zIndex = '60';
    var input = 'w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white';
    var lbl = 'block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1';
    modal.innerHTML =
      '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg border dark:border-gray-700 flex flex-col" style="max-height:94vh">' +
        '<div class="flex items-center justify-between p-5 border-b dark:border-gray-700">' +
          '<h3 class="text-lg font-bold text-gray-800 dark:text-white"><i class="fas fa-money-check-dollar text-indigo-600 mr-2"></i>' + (editing ? 'Modifier le paiement' : 'Nouveau paiement') + '</h3>' +
          '<button type="button" onclick="closePayrollPaymentForm()" class="text-2xl text-gray-400 hover:text-gray-600">×</button></div>' +
        '<div class="p-5 overflow-y-auto space-y-3">' +
          '<div><label class="' + lbl + '">Salarié</label><select id="ppEmp" class="' + input + '" onchange="payrollFormRecalc()">' +
            '<option value="">-- Choisir --</option>' +
            emps.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === selEmp ? ' selected' : '') + '>' + esc(e.name || e.login) + '</option>'; }).join('') + '</select></div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="' + lbl + '">Type</label><select id="ppType" class="' + input + '" onchange="payrollFormRecalc()">' +
              Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + TYPES[k].label + '</option>'; }).join('') + '</select></div>' +
            '<div><label class="' + lbl + '">Période concernée</label><input type="month" id="ppPeriod" value="' + esc(period) + '" class="' + input + '" onchange="payrollFormRecalc()"></div>' +
          '</div>' +
          '<div id="ppHint" class="text-xs p-3 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-100"></div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="' + lbl + '">Montant (DA)</label><input type="number" id="ppAmount" min="0" step="1" value="' + (editing ? esc(editing.amount) : '') + '" class="' + input + '" placeholder="0"></div>' +
            '<div><label class="' + lbl + '">Date du paiement</label><input type="date" id="ppDate" value="' + esc(date) + '" class="' + input + '"></div>' +
          '</div>' +
          '<button type="button" id="ppSettle" onclick="payrollFormSettle()" class="text-xs font-bold text-indigo-600 hover:underline hidden">Solder le reste à payer</button>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="' + lbl + '">Mode de paiement</label><select id="ppMethod" class="' + input + '">' +
              Object.keys(METHODS).map(function (k) { return '<option value="' + k + '"' + (k === method ? ' selected' : '') + '>' + METHODS[k] + '</option>'; }).join('') + '</select></div>' +
            '<div><label class="' + lbl + '">Description</label><input type="text" id="ppDesc" value="' + esc(editing ? (editing.description || '') : '') + '" class="' + input + '" placeholder="Auto : type + période"></div>' +
          '</div>' +
          '<div><label class="' + lbl + '">Note interne (optionnel)</label><input type="text" id="ppNote" value="' + esc(editing ? (editing.note || '') : '') + '" class="' + input + '"></div>' +
          '<label class="flex items-center gap-2 p-3 rounded-xl border dark:border-gray-700 cursor-pointer"><input type="checkbox" id="ppPaid" ' + (isPaid ? 'checked' : '') + ' class="w-5 h-5">' +
            '<span class="text-sm font-bold text-gray-700 dark:text-gray-200">Paiement effectué (décocher = planifié / en attente)</span></label>' +
        '</div>' +
        '<div class="flex gap-3 p-5 border-t dark:border-gray-700">' +
          '<button type="button" onclick="closePayrollPaymentForm()" class="flex-1 px-4 py-3 rounded-xl font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">Annuler</button>' +
          '<button type="button" onclick="savePayrollPayment(\'' + (editing ? esc(editing.id) : '') + '\')" class="flex-1 px-4 py-3 rounded-xl font-bold bg-green-600 hover:bg-green-700 text-white shadow">Enregistrer</button>' +
        '</div></div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) closePayrollPaymentForm(); });
    document.body.appendChild(modal);
    window._payrollEditingId = editing ? editing.id : null;
    window.payrollFormRecalc();
    // préremplir le montant avec le reste à payer (nouveau paiement uniquement)
    if (!editing) {
      var r = payrollFormInfo();
      var amt = document.getElementById('ppAmount');
      if (r && amt && !amt.value && TYPES[document.getElementById('ppType').value].salary && r.remaining > 0.5) amt.value = Math.round(r.remaining);
    }
  };

  window.closePayrollPaymentForm = function () { removeEl('payrollPaymentModal'); window._payrollEditingId = null; };

  function payrollFormInfo() {
    var empId = (document.getElementById('ppEmp') || {}).value;
    var period = (document.getElementById('ppPeriod') || {}).value;
    var emp = empById(empId);
    if (!emp || !/^\d{4}-\d{2}$/.test(period || '')) return null;
    return computePayroll(emp, period, window._payrollEditingId || undefined);
  }
  window.payrollFormRecalc = function () {
    var hint = document.getElementById('ppHint'); if (!hint) return;
    var settle = document.getElementById('ppSettle');
    var typeEl = document.getElementById('ppType');
    var r = payrollFormInfo();
    if (!r) { hint.innerHTML = 'Choisissez un salarié et une période pour voir le solde.'; if (settle) settle.classList.add('hidden'); return; }
    var salaryType = TYPES[typeEl.value].salary;
    hint.innerHTML = '<b>' + esc(monthLabel(r.month)) + '</b> — Net à payer : <b>' + fmt(r.net) + '</b> · Déjà payé : <b>' + fmt(r.paid) + '</b> · Reste : <b>' + fmt(Math.max(0, r.remaining)) + '</b>' +
      (r.base <= 0 ? '<br><span class="text-amber-700">⚠ Salaire de base non défini pour ce salarié.</span>' : '');
    if (settle) settle.classList.toggle('hidden', !(salaryType && r.remaining > 0.5));
  };
  window.payrollFormSettle = function () {
    var r = payrollFormInfo(); var a = document.getElementById('ppAmount');
    if (r && a && r.remaining > 0) a.value = Math.round(r.remaining);
  };

  window.savePayrollPayment = function (paymentId) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var empId = document.getElementById('ppEmp').value;
    var type = document.getElementById('ppType').value;
    var period = document.getElementById('ppPeriod').value;
    var amount = Number(document.getElementById('ppAmount').value);
    var date = document.getElementById('ppDate').value;
    var method = document.getElementById('ppMethod').value;
    var desc = document.getElementById('ppDesc').value.trim();
    var note = document.getElementById('ppNote').value.trim();
    var paid = document.getElementById('ppPaid').checked;

    if (!empById(empId)) return toast('Choisissez un salarié', 'error');
    if (!/^\d{4}-\d{2}$/.test(period)) return toast('Période invalide', 'error');
    if (!isYmd(date)) return toast('Date invalide', 'error');
    if (!(amount > 0)) return toast('Montant invalide', 'error');

    // contrôle : paiement supérieur au net restant
    if (paid && TYPES[type].salary && type !== 'prime') {
      var info = computePayroll(empById(empId), period, paymentId || undefined);
      if (info.paid + amount > info.net + 0.5) {
        var ok = confirm('Ce paiement (' + fmt(amount) + ') dépasse le reste à payer (' + fmt(Math.max(0, info.remaining)) + ') pour ' + monthLabel(period) + '.\nEnregistrer quand même ?');
        if (!ok) return;
      }
    }
    if (!desc) desc = TYPES[type].label + ' ' + monthLabel(period).toLowerCase();

    var list = payments();
    if (paymentId) {
      var p = list.find(function (x) { return x.id === paymentId; });
      if (!p) return toast('Paiement introuvable', 'error');
      var wasPaid = !!p.paid;
      Object.assign(p, { employeeId: empId, type: type, period: period, amount: amount, date: date, method: method, description: desc, note: note, paid: paid, updatedAt: Date.now() });
      if (paid && !wasPaid) p.paidAt = Date.now();
      if (!paid) p.paidAt = null;
      if (!p.receiptNo) p.receiptNo = nextReceiptNo(period);
      log('Paiement salarié modifié', empName(empId) + ' — ' + fmt(amount) + ' (' + monthLabel(period) + ')');
      toast('Paiement modifié', 'success');
    } else {
      var np = {
        id: 'payment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        employeeId: empId, description: desc, amount: amount, date: date, paid: paid,
        type: type, period: period, method: method, note: note,
        receiptNo: nextReceiptNo(period),
        paidAt: paid ? Date.now() : null,
        createdBy: actorName(), createdAt: Date.now(), updatedAt: Date.now()
      };
      list.push(np);
      log('Paiement salarié enregistré', empName(empId) + ' — ' + fmt(amount) + ' (' + TYPES[type].label + ', ' + monthLabel(period) + ')' + (paid ? '' : ' [en attente]'));
      toast(paid ? 'Paiement enregistré' : 'Paiement planifié', 'success');
    }
    closePayrollPaymentForm();
    syncLinkedExpense(paymentId || (payments()[payments().length - 1] || {}).id);
    save();
    window.refreshPayroll();
  };

  window.togglePaymentStatus = function (paymentId) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var p = payments().find(function (x) { return x.id === paymentId; });
    if (!p) return;
    p.paid = !p.paid;
    p.paidAt = p.paid ? Date.now() : null;
    p.updatedAt = Date.now();
    log(p.paid ? 'Paiement salarié marqué payé' : 'Paiement salarié remis en attente', empName(p.employeeId) + ' — ' + fmt(p.amount));
    syncLinkedExpense(paymentId);
    save();
    window.refreshPayroll();
    toast(p.paid ? 'Paiement marqué payé' : 'Paiement remis en attente', 'success');
  };

  window.deleteEmployeePayment = function (paymentId) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var p = payments().find(function (x) { return x.id === paymentId; });
    if (!p) return;
    if (!confirm('Supprimer définitivement ce paiement de ' + fmt(p.amount) + ' pour ' + empName(p.employeeId) + ' ?')) return;
    appState.employeePayments = payments().filter(function (x) { return x.id !== paymentId; });
    syncLinkedExpense(paymentId);
    if (!appState.sync) appState.sync = {};
    if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
    appState.sync.pendingDeletions.push({ col: 'employeePayments', id: paymentId });
    log('Paiement salarié supprimé', empName(p.employeeId) + ' — ' + fmt(p.amount) + ' (' + monthLabel(payPeriod(p)) + ')');
    save();
    window.refreshPayroll();
    toast('Paiement supprimé', 'info');
  };

  // Compatibilité avec l'ancien bouton "Ajouter paiement"
  window.openAddPaymentModal = function (employeeId) { window.openPayrollPaymentForm(employeeId); };

  // =====================================================================
  //  HISTORIQUE DES PAIEMENTS
  // =====================================================================
  var HIST = { emp: '', month: '', type: '', status: '', method: '', q: '', limit: 60 };

  function filteredPayments() {
    var q = HIST.q.trim().toLowerCase();
    return payments().filter(function (p) {
      if (!p) return false;
      if (HIST.emp && p.employeeId !== HIST.emp) return false;
      if (HIST.month && payPeriod(p) !== HIST.month) return false;
      if (HIST.type && payType(p) !== HIST.type) return false;
      if (HIST.status === 'paid' && !p.paid) return false;
      if (HIST.status === 'pending' && p.paid) return false;
      if (HIST.method && (p.method || '') !== HIST.method) return false;
      if (q) {
        var hay = (empName(p.employeeId) + ' ' + (p.description || '') + ' ' + (p.note || '') + ' ' + receiptNumber(p) + ' ' + TYPES[payType(p)].label).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || ((b.createdAt || 0) - (a.createdAt || 0));
    });
  }

  window.openPayrollHistory = function (employeeId, month) {
    if (!canManage()) return toast('Accès refusé', 'error');
    HIST = { emp: employeeId || '', month: month || '', type: '', status: '', method: '', q: '', limit: 60 };
    var modal = document.getElementById('payrollHistoryModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'payrollHistoryModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-60 hidden items-center justify-center p-2 md:p-6';
    modal.style.zIndex = '55';
    var input = 'p-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm w-full';
    modal.innerHTML =
      '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-6xl flex flex-col border dark:border-gray-700" style="max-height:94vh">' +
        '<div class="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5 border-b dark:border-gray-700">' +
          '<h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-clock-rotate-left text-indigo-600 mr-2"></i>Historique des paiements</h3>' +
          '<div class="flex flex-wrap gap-2">' +
            '<button onclick="openPayrollPaymentForm(HISTEMP())" class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm"><i class="fas fa-plus mr-1"></i>Nouveau</button>' +
            '<button onclick="exportPayrollHistoryCSV()" class="px-3 py-2 border dark:border-gray-600 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><i class="fas fa-file-csv mr-1"></i>CSV</button>' +
            '<button onclick="printPayrollStatement()" class="px-3 py-2 border dark:border-gray-600 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><i class="fas fa-print mr-1"></i>Relevé / PDF</button>' +
            '<button onclick="closePayrollHistory()" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200"><i class="fas fa-times mr-1"></i>Fermer</button>' +
          '</div></div>' +
        '<div class="p-4 md:px-5 border-b dark:border-gray-700 grid grid-cols-2 md:grid-cols-6 gap-2">' +
          '<select id="payHistEmp" class="' + input + '" onchange="payHistSet()"></select>' +
          '<div class="flex gap-1"><input type="month" id="payHistMonth" class="' + input + '" onchange="payHistSet()" title="Période (vide = toutes)"></div>' +
          '<select id="payHistType" class="' + input + '" onchange="payHistSet()"><option value="">Tous les types</option>' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k].label + '</option>'; }).join('') + '</select>' +
          '<select id="payHistStatus" class="' + input + '" onchange="payHistSet()"><option value="">Tous statuts</option><option value="paid">Payés</option><option value="pending">En attente</option></select>' +
          '<select id="payHistMethod" class="' + input + '" onchange="payHistSet()"><option value="">Tous modes</option>' + Object.keys(METHODS).map(function (k) { return '<option value="' + k + '">' + METHODS[k] + '</option>'; }).join('') + '</select>' +
          '<input type="text" id="payHistQ" class="' + input + '" placeholder="Rechercher..." oninput="payHistSet(true)">' +
        '</div>' +
        '<div id="payHistSummary" class="px-4 md:px-5 pt-4"></div>' +
        '<div id="payHistBody" class="p-4 md:p-5 overflow-auto flex-1"></div>' +
      '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) closePayrollHistory(); });
    document.body.appendChild(modal);

    // remplir les filtres
    var empSel = document.getElementById('payHistEmp');
    empSel.innerHTML = '<option value="">Tous les salariés</option>' + (appState.employees || []).map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.name || e.login) + '</option>';
    }).join('');
    empSel.value = HIST.emp;
    document.getElementById('payHistMonth').value = HIST.month;
    modal.classList.remove('hidden'); modal.classList.add('flex');
    renderHistoryBody();
  };
  window.HISTEMP = function () { return HIST.emp || ''; };
  window.closePayrollHistory = function () {
    var m = document.getElementById('payrollHistoryModal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  };
  window.payHistSet = function (keepFocus) {
    HIST.emp = document.getElementById('payHistEmp').value;
    HIST.month = document.getElementById('payHistMonth').value;
    HIST.type = document.getElementById('payHistType').value;
    HIST.status = document.getElementById('payHistStatus').value;
    HIST.method = document.getElementById('payHistMethod').value;
    HIST.q = document.getElementById('payHistQ').value;
    HIST.limit = 60;
    renderHistoryBody();
  };
  window.payHistMore = function () { HIST.limit += 60; renderHistoryBody(); };
  window.payHistClearMonth = function () { document.getElementById('payHistMonth').value = ''; window.payHistSet(); };

  function renderHistoryBody() {
    var body = document.getElementById('payHistBody');
    var sum = document.getElementById('payHistSummary');
    if (!body || !sum) return;
    var list = filteredPayments();

    var paidTotal = 0, pendingTotal = 0, salaryPaid = 0, extraPaid = 0;
    var byEmp = {};
    list.forEach(function (p) {
      var a = Number(p.amount) || 0;
      if (p.paid) { paidTotal += a; if (TYPES[payType(p)].salary) salaryPaid += a; else extraPaid += a; } else pendingTotal += a;
      var b = byEmp[p.employeeId] || (byEmp[p.employeeId] = { n: 0, paid: 0, pending: 0 });
      b.n++; if (p.paid) b.paid += a; else b.pending += a;
    });

    var card = function (l, v, c) {
      return '<div class="p-3 rounded-2xl bg-gray-50 dark:bg-gray-900 border dark:border-gray-700"><div class="text-[11px] font-bold uppercase text-gray-500">' + l + '</div><div class="text-lg font-black ' + c + '">' + v + '</div></div>';
    };
    sum.innerHTML = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
      card('Paiements', String(list.length), 'text-gray-800 dark:text-white') +
      card('Total payé', fmt(paidTotal), 'text-green-600') +
      card('dont salaires / primes', fmt(salaryPaid), 'text-indigo-600') +
      card('En attente', fmt(pendingTotal), 'text-amber-600') + '</div>' +
      (HIST.month ? '<div class="text-xs text-gray-500 mt-2">Période filtrée : <b>' + esc(monthLabel(HIST.month)) + '</b> <button onclick="payHistClearMonth()" class="text-indigo-600 font-bold hover:underline ml-1">Toutes les périodes</button></div>' : '') +
      (extraPaid > 0 ? '<div class="text-[11px] text-gray-400 mt-1">Hors salaire (frais, autres) : ' + fmt(extraPaid) + '</div>' : '');

    var shown = list.slice(0, HIST.limit);
    var html = '<div class="overflow-x-auto rounded-2xl border dark:border-gray-700"><table class="w-full text-sm">' +
      '<thead><tr class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-[11px] font-black uppercase">' +
      '<th class="p-3 text-left">Date</th><th class="p-3 text-left">N° reçu</th><th class="p-3 text-left">Salarié</th><th class="p-3 text-left">Période</th>' +
      '<th class="p-3 text-left">Type</th><th class="p-3 text-left">Description</th><th class="p-3 text-left">Mode</th>' +
      '<th class="p-3 text-right">Montant</th><th class="p-3 text-center">Statut</th><th class="p-3 text-center">Actions</th></tr></thead><tbody class="divide-y dark:divide-gray-700">';
    if (!shown.length) {
      html += '<tr><td colspan="10" class="p-10 text-center text-gray-400 italic">Aucun paiement ne correspond aux filtres.</td></tr>';
    } else {
      shown.forEach(function (p) {
        var id = esc(p.id);
        html += '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40">' +
          '<td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">' + fmtDate(p.date) + '</td>' +
          '<td class="p-3 font-mono text-xs text-gray-500 whitespace-nowrap">' + esc(receiptNumber(p)) + '</td>' +
          '<td class="p-3 font-bold text-gray-800 dark:text-white">' + esc(empName(p.employeeId)) + '</td>' +
          '<td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">' + esc(monthLabel(payPeriod(p))) + '</td>' +
          '<td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">' + esc(TYPES[payType(p)].label) + '</td>' +
          '<td class="p-3 text-gray-600 dark:text-gray-300 max-w-[220px] truncate" title="' + esc((p.description || '') + (p.note ? ' — ' + p.note : '')) + '">' + esc(p.description || '—') + '</td>' +
          '<td class="p-3 whitespace-nowrap text-gray-600 dark:text-gray-300">' + esc(payMethod(p)) + '</td>' +
          '<td class="p-3 text-right font-mono font-black ' + (p.paid ? 'text-green-600' : 'text-amber-600') + ' whitespace-nowrap">' + nf(p.amount) + '</td>' +
          '<td class="p-3 text-center">' + paidBadge(p) + (p.paid && p.paidAt ? '<div class="text-[10px] text-gray-400 mt-1">' + fmtTs(p.paidAt) + '</div>' : '') + '</td>' +
          '<td class="p-3 text-center whitespace-nowrap">' +
            '<button onclick="togglePaymentStatus(\'' + id + '\')" class="px-2 py-1 rounded-lg hover:bg-gray-100 ' + (p.paid ? 'text-amber-600' : 'text-green-600') + '" title="' + (p.paid ? 'Remettre en attente' : 'Marquer payé') + '"><i class="fas ' + (p.paid ? 'fa-rotate-left' : 'fa-circle-check') + '"></i></button>' +
            '<button onclick="openPaymentReceipt(\'' + id + '\')" class="px-2 py-1 rounded-lg hover:bg-blue-50 text-blue-600" title="Reçu"><i class="fas fa-receipt"></i></button>' +
            '<button onclick="openPayrollPaymentForm(\'\',\'' + id + '\')" class="px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-600" title="Modifier"><i class="fas fa-pen"></i></button>' +
            '<button onclick="deleteEmployeePayment(\'' + id + '\')" class="px-2 py-1 rounded-lg hover:bg-red-50 text-red-500" title="Supprimer"><i class="fas fa-trash-alt"></i></button>' +
          '</td></tr>';
      });
    }
    html += '</tbody>' + (shown.length ? '<tfoot><tr class="bg-gray-50 dark:bg-gray-900 font-black"><td colspan="7" class="p-3 text-right uppercase text-xs">Total payé (filtres)</td><td class="p-3 text-right font-mono text-green-600">' + nf(paidTotal) + '</td><td colspan="2"></td></tr></tfoot>' : '') + '</table></div>';
    if (list.length > shown.length) html += '<div class="text-center mt-3"><button onclick="payHistMore()" class="px-4 py-2 text-sm font-bold text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50">Afficher plus (' + (list.length - shown.length) + ' restants)</button></div>';

    // cumul par salarié
    var ids = Object.keys(byEmp).sort(function (a, b) { return byEmp[b].paid - byEmp[a].paid; });
    if (ids.length > 1) {
      html += '<h4 class="font-bold text-gray-800 dark:text-white mt-6 mb-2"><i class="fas fa-layer-group text-indigo-500 mr-2"></i>Cumul par salarié (selon les filtres)</h4>' +
        '<div class="overflow-x-auto rounded-2xl border dark:border-gray-700"><table class="w-full text-sm"><thead><tr class="bg-gray-100 dark:bg-gray-700 text-[11px] font-black uppercase text-gray-600 dark:text-gray-200">' +
        '<th class="p-3 text-left">Salarié</th><th class="p-3 text-right">Paiements</th><th class="p-3 text-right">Payé</th><th class="p-3 text-right">En attente</th></tr></thead><tbody class="divide-y dark:divide-gray-700">' +
        ids.map(function (id) {
          var b = byEmp[id];
          return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + esc(empName(id)) + '</td><td class="p-3 text-right">' + b.n + '</td><td class="p-3 text-right font-mono text-green-600">' + nf(b.paid) + '</td><td class="p-3 text-right font-mono text-amber-600">' + nf(b.pending) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    body.innerHTML = html;
  }

  // =====================================================================
  //  EXPORTS CSV
  // =====================================================================
  function downloadCsv(rows, filename) {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = rows.map(function (r) { return r.map(q).join(';'); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Export CSV réussi', 'success');
  }

  window.exportPayrollCSV = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var month = ui().month;
    var rows = [['Période', 'Salarié', 'Salaire de base', 'Tâches', 'Prime performance', 'Prime équipe', 'Primes', 'Jours d\'absence', 'Retenue absences', 'Retenue avances', 'Net à payer', 'Payé', 'Reste à payer', 'En attente', 'Statut']];
    var labels = { settled: 'Soldé', partial: 'Partiel', unpaid: 'Non payé', over: 'Trop-perçu', none: 'Sans salaire' };
    payrollEmployees(month).forEach(function (e) {
      var r = computePayroll(e, month);
      rows.push([month, e.name || e.login, Math.round(r.base), r.tasks, Math.round(r.perfPrime), Math.round(r.leadBonus), Math.round(r.bonus), r.absDays,
        Math.round(r.absDeduction), Math.round(r.advDeduction), Math.round(r.net), Math.round(r.paid), Math.round(Math.max(0, r.remaining)), Math.round(r.pending), labels[r.status]]);
    });
    downloadCsv(rows, 'paie_' + month + '.csv');
  };

  window.exportPayrollHistoryCSV = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var rows = [['Date', 'N° reçu', 'Salarié', 'Période', 'Type', 'Description', 'Mode', 'Montant (DA)', 'Statut', 'Date de paiement', 'Note', 'Saisi par']];
    filteredPayments().forEach(function (p) {
      rows.push([p.date || '', receiptNumber(p), empName(p.employeeId), payPeriod(p), TYPES[payType(p)].label, p.description || '', payMethod(p),
        Math.round(Number(p.amount) || 0), p.paid ? 'Payé' : 'En attente', p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : '', p.note || '', p.createdBy || '']);
    });
    downloadCsv(rows, 'historique_paiements_' + todayYmd() + '.csv');
  };

  // =====================================================================
  //  DOCUMENTS (bulletin de paie, reçu, relevé) : aperçu A4 / impression / PDF
  // =====================================================================
  function logoImg(h) {
    var i = window.INVOICE_LOGO_ICON;
    return i ? '<img src="' + i + '" alt="" style="height:' + h + 'px;width:auto;display:block">' : '';
  }
  function brand(h, size) {
    return '<div style="display:flex;align-items:center;gap:12px">' + logoImg(h) +
      '<div><div style="font-size:' + size + 'px;font-weight:800;letter-spacing:-1px;line-height:1"><span style="color:' + NAVY + '">Hichem</span> <span style="color:' + BLUE + '">Sponsor</span></div>' +
      '<div style="font-size:9.5px;letter-spacing:2.6px;color:#4b5b75;margin-top:6px;font-weight:600">AGENCE DE MARKETING DIGITAL</div></div></div>';
  }
  var COMPANY_LINES = 'Ouled Fayet, Cité Verte — Alger, Algérie<br>contact.hichemsps@gmail.com';
  var FONT = "'Segoe UI',Arial,Helvetica,sans-serif";

  function openDoc(opts) {
    var modal = document.getElementById('payrollDocModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'payrollDocModal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-60 hidden items-center justify-center p-2 md:p-6';
      modal.style.zIndex = '70';
      modal.innerHTML =
        '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style="height:94vh">' +
          '<div class="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4 border-b">' +
            '<div class="font-black text-gray-800 flex items-center gap-2"><i class="fas fa-file-lines text-blue-600"></i><span id="payrollDocTitle"></span></div>' +
            '<div class="flex flex-wrap gap-2">' +
              '<button type="button" onclick="payrollDocDownload()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700"><i class="fas fa-download mr-1"></i>Télécharger PDF</button>' +
              '<button type="button" onclick="payrollDocPrint()" class="px-4 py-2 border rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-50"><i class="fas fa-print mr-1"></i>Imprimer</button>' +
              '<button type="button" onclick="payrollDocClose()" class="px-4 py-2 bg-gray-100 rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-200"><i class="fas fa-times mr-1"></i>Fermer</button>' +
            '</div></div>' +
          '<iframe id="payrollDocFrame" title="Aperçu" class="flex-1 w-full rounded-b-2xl" style="border:0;background:#e5e7eb"></iframe></div>';
      modal.addEventListener('click', function (e) { if (e.target === modal) window.payrollDocClose(); });
      document.body.appendChild(modal);
    }
    window._payrollDoc = opts;
    document.getElementById('payrollDocTitle').textContent = opts.title;
    var page = opts.fixed ? '@page{size:A4;margin:0}' : '@page{size:A4;margin:12mm}';
    document.getElementById('payrollDocFrame').srcdoc =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + page +
      'html,body{margin:0;background:#e5e7eb}#wrap{width:794px;margin:12px auto;box-shadow:0 2px 14px rgba(0,0,0,.2);transform-origin:top left;background:#fff}' +
      'tr{page-break-inside:avoid}' +
      '@media print{html,body{background:#fff}#wrap{margin:0!important;box-shadow:none;transform:none!important}}</style></head><body><div id="wrap">' + opts.inner + '</div>' +
      '<script>function fit(){var w=document.getElementById("wrap");var s=Math.min(1,(innerWidth-16)/794);w.style.transform="scale("+s+")";' +
      'w.style.margin="12px "+Math.max(8,(innerWidth-794*s)/2)+"px";document.body.style.height=(w.offsetHeight*s+24)+"px"}' +
      'fit();addEventListener("resize",fit);<\/script></body></html>';
    modal.classList.remove('hidden'); modal.classList.add('flex');
  }
  window.payrollDocClose = function () {
    var m = document.getElementById('payrollDocModal');
    if (!m) return;
    m.classList.add('hidden'); m.classList.remove('flex');
    var f = document.getElementById('payrollDocFrame'); if (f) f.srcdoc = '';
  };
  window.payrollDocPrint = function () {
    var f = document.getElementById('payrollDocFrame');
    if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); }
  };
  window.payrollDocDownload = function () {
    var d = window._payrollDoc;
    if (!d) return;
    if (typeof html2pdf !== 'function') return toast('PDF indisponible (librairie non chargée)', 'error');
    var node = document.createElement('div');
    node.style.width = '794px';
    node.innerHTML = d.inner;
    var opt = {
      margin: d.fixed ? 0 : [8, 0, 8, 0],
      filename: d.filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: d.fixed ? { mode: [] } : { mode: ['css', 'legacy'], avoid: 'tr' }
    };
    toast('Génération du PDF...', 'info');
    var job = html2pdf().set(opt).from(node).toPdf().get('pdf').then(function (pdf) {
      if (d.fixed) { while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages()); }
    }).save();
    job.then(function () { toast('PDF téléchargé', 'success'); }).catch(function (err) { console.error(err); toast('Erreur lors de la génération', 'error'); });
  };

  // ---------------------------------------------------------------- bulletin de paie
  window.openPayslip = function (employeeId, month) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var emp = empById(employeeId);
    if (!emp) return toast('Salarié introuvable', 'error');
    month = month || ui().month;
    var r = computePayroll(emp, month);
    var num = 'BP-' + month.replace('-', '') + '-' + String(emp.id).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
    var today = fmtDate(todayYmd());

    var line = function (label, detail, gain, ret, strong) {
      return '<tr style="border-bottom:1px solid ' + LINE + ';' + (strong ? 'background:' + SOFT + ';font-weight:800' : '') + '">' +
        '<td style="padding:9px 14px;font-size:13px">' + label + '</td>' +
        '<td style="padding:9px 8px;font-size:11.5px;color:#4b5b75">' + detail + '</td>' +
        '<td style="padding:9px 14px;text-align:right;font-size:13px;color:#0e7a4b">' + (gain || '') + '</td>' +
        '<td style="padding:9px 14px;text-align:right;font-size:13px;color:#c2272d">' + (ret || '') + '</td></tr>';
    };
    var bonusList = r.pays.filter(function (p) { return payType(p) === 'prime'; });
    var lines = line('Salaire de base', 'Mensuel (30 jours)', nf(r.base), '');
    lines += line('Prime de performance', r.tasks + ' tâche(s) × ' + nf(r.rate) + ' = ' + fmt(r.perfGain), r.perfPrime ? nf(r.perfPrime) : '—', '');
    lines += line("Prime d'encadrement d'équipe", r.lead && r.lead.teamTasks ? r.lead.teamTasks + " tâche(s) d'équipe" + (r.lead.rateBonus ? ' × commission' : '') + (r.lead.scaleBonus ? ' + palier' : '') + (r.lead.targetBonus ? ' + objectif atteint' : '') : '—', r.leadBonus ? nf(r.leadBonus) : '—', '');
    lines += line('Primes exceptionnelles', bonusList.length ? bonusList.map(function (p) { return esc(p.description || 'Prime'); }).join(', ') : '—', r.bonus ? nf(r.bonus) : '—', '');
    lines += line('Retenue pour absences', r.absDays + ' jour(s) × ' + nf(r.daily) + ' DA' + (r.justified ? ' (' + r.justified + ' justifiée(s) non retenue(s))' : ''), '', r.absDeduction ? nf(r.absDeduction) : '—');
    lines += line('Retenue avance sur salaire', r.advList.length ? r.advList.map(function (a) { return 'remboursement sur ' + a.months + ' mois'; }).join(', ') : '—', '', r.advDeduction ? nf(r.advDeduction) : '—');
    lines += line('TOTAL', '', nf(r.gross), (r.absDeduction + r.advDeduction) ? nf(r.absDeduction + r.advDeduction) : '—', true);

    var shown = r.pays.slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
    var more = shown.length > 7 ? shown.length - 7 : 0;
    if (more) shown = shown.slice(0, 7);
    var payRows = shown.length ? shown.map(function (p) {
      return '<tr style="border-bottom:1px solid ' + LINE + '"><td style="padding:6px 14px;font-size:12px">' + fmtDate(p.date) + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;font-family:monospace;color:#4b5b75">' + esc(receiptNumber(p)) + '</td>' +
        '<td style="padding:6px 8px;font-size:12px">' + esc(TYPES[payType(p)].label) + '</td><td style="padding:6px 8px;font-size:12px">' + esc(payMethod(p)) + '</td>' +
        '<td style="padding:6px 8px;font-size:12px;text-align:center;color:' + (p.paid ? '#0e7a4b' : '#b7791f') + ';font-weight:700">' + (p.paid ? 'Payé' : 'En attente') + '</td>' +
        '<td style="padding:6px 14px;font-size:12.5px;text-align:right;font-weight:700">' + nf(p.amount) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="padding:14px;text-align:center;color:#8a97ab;font-size:12px;font-style:italic">Aucun paiement enregistré sur cette période</td></tr>';

    var resteLabel = r.status === 'over' ? 'Trop-perçu' : 'Reste à payer';
    var resteVal = r.status === 'over' ? -r.remaining : Math.max(0, r.remaining);

    var inner =
      '<div style="position:relative;width:794px;height:1122px;box-sizing:border-box;overflow:hidden;background:#fbfdfe;font-family:' + FONT + ';color:' + NAVY + '">' +
        '<svg width="90" height="90" viewBox="0 0 110 110" style="position:absolute;top:0;left:0"><polygon points="0,0 80,0 0,100" fill="#2f7cf0"/><polygon points="0,0 46,0 0,58" fill="#1555c0"/></svg>' +
        '<div style="padding:40px 40px 0">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;height:80px;padding-left:34px">' + brand(54, 28) +
            '<div style="text-align:right"><div style="font-size:30px;font-weight:900;letter-spacing:-.5px">BULLETIN DE PAIE</div>' +
            '<div style="font-size:13px;color:#4b5b75;margin-top:4px">Période : <b style="color:' + NAVY + '">' + esc(monthLabel(month)) + '</b></div>' +
            '<div style="font-size:11px;color:#8a97ab;margin-top:2px">N° ' + esc(num) + ' · Édité le ' + today + '</div></div></div>' +
          '<div style="height:1px;background:' + LINE + ';margin:18px 0 20px"></div>' +
          '<div style="display:flex;gap:16px">' +
            '<div style="flex:1;background:' + SOFT + ';border:1px solid ' + LINE + ';border-radius:10px;padding:14px 18px"><div style="font-size:11px;font-weight:800;color:' + BLUE + ';letter-spacing:1px">EMPLOYEUR</div>' +
              '<div style="font-size:16px;font-weight:800;margin-top:4px">Hichem Sponsor</div><div style="font-size:11.5px;color:#4b5b75;margin-top:3px;line-height:1.5">' + COMPANY_LINES + '</div></div>' +
            '<div style="flex:1;background:' + SOFT + ';border:1px solid ' + LINE + ';border-radius:10px;padding:14px 18px"><div style="font-size:11px;font-weight:800;color:' + BLUE + ';letter-spacing:1px">SALARIÉ</div>' +
              '<div style="font-size:16px;font-weight:800;margin-top:4px">' + esc(emp.name || emp.login) + '</div><div style="font-size:11.5px;color:#4b5b75;margin-top:3px;line-height:1.5">Identifiant : ' + esc(emp.login || '—') + '<br>' + (r.title ? 'Poste : <b>' + esc(r.title) + '</b>' + (r.managerId && empById(r.managerId) ? ' · Responsable : ' + esc(empName(r.managerId)) : '') + '<br>' : '') + 'Salaire mensuel de base : <b>' + fmt(r.base) + '</b></div></div>' +
          '</div>' +
          '<div style="margin-top:22px;border:1px solid ' + LINE + ';border-radius:10px;overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:' + NAVY + ';color:#fff;font-size:11.5px;letter-spacing:.5px;text-transform:uppercase">' +
              '<th style="padding:11px 14px;text-align:left">Désignation</th><th style="padding:11px 8px;text-align:left">Détail</th><th style="padding:11px 14px;text-align:right">Gains (DA)</th><th style="padding:11px 14px;text-align:right">Retenues (DA)</th></tr></thead>' +
              '<tbody>' + lines + '</tbody></table></div>' +
          '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;background:' + BLUE + ';color:#fff;border-radius:10px;padding:14px 22px">' +
            '<div><div style="font-size:12px;letter-spacing:1px;opacity:.85">NET À PAYER</div><div style="font-size:11px;opacity:.85;margin-top:2px;font-style:italic">' + esc(words(r.net)) + '</div></div>' +
            '<div style="font-size:30px;font-weight:900">' + fmt(r.net) + '</div></div>' +
          '<div style="margin-top:22px;font-size:13px;font-weight:800;color:' + BLUE + ';letter-spacing:.5px">PAIEMENTS EFFECTUÉS SUR LA PÉRIODE</div>' +
          '<div style="margin-top:8px;border:1px solid ' + LINE + ';border-radius:10px;overflow:hidden"><table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="background:' + SOFT + ';font-size:10.5px;text-transform:uppercase;color:#4b5b75"><th style="padding:8px 14px;text-align:left">Date</th><th style="padding:8px;text-align:left">N° reçu</th><th style="padding:8px;text-align:left">Type</th><th style="padding:8px;text-align:left">Mode</th><th style="padding:8px;text-align:center">Statut</th><th style="padding:8px 14px;text-align:right">Montant</th></tr></thead>' +
            '<tbody>' + payRows + '</tbody></table></div>' +
          (more ? '<div style="font-size:11px;color:#8a97ab;margin-top:4px;text-align:right">… et ' + more + ' autre(s) paiement(s) — voir l\'historique</div>' : '') +
          '<div style="display:flex;justify-content:flex-end;gap:14px;margin-top:12px">' +
            '<div style="background:#e9f8f0;color:#0e7a4b;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:800">Total payé : ' + fmt(r.paid) + '</div>' +
            '<div style="background:' + (resteVal > 0.5 ? '#fdecec' : '#e9f8f0') + ';color:' + (resteVal > 0.5 ? '#c2272d' : '#0e7a4b') + ';border-radius:8px;padding:8px 16px;font-size:13px;font-weight:800">' + (resteVal > 0.5 ? resteLabel + ' : ' + fmt(resteVal) : 'Solde : soldé ✓') + '</div></div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:26px;gap:40px">' +
            '<div style="flex:1;text-align:center"><div style="font-size:12px;font-weight:800">Signature de l\'employeur</div><div style="height:58px;border-bottom:1px dashed #9fb0c9;margin-top:6px"></div></div>' +
            '<div style="flex:1;text-align:center"><div style="font-size:12px;font-weight:800">Signature du salarié <span style="font-weight:400;color:#6b7a90">(lu et approuvé)</span></div><div style="height:58px;border-bottom:1px dashed #9fb0c9;margin-top:6px"></div></div></div>' +
        '</div>' +
        '<div style="position:absolute;left:0;right:0;bottom:0;height:52px;background:' + NAVY + ';color:#c9d6ee;display:flex;align-items:center;justify-content:space-between;padding:0 40px;font-size:11px">' +
          '<span style="font-weight:800;color:#fff;font-size:13px">Hichem Sponsor</span><span>Document confidentiel — usage interne et salarié</span><span style="font-style:italic">Ensemble vers plus de ventes</span></div>' +
      '</div>';

    openDoc({ title: 'Bulletin de paie — ' + (emp.name || emp.login) + ' — ' + monthLabel(month), filename: num + '.pdf', inner: inner, fixed: true });
  };

  // ---------------------------------------------------------------- reçu de paiement
  window.openPaymentReceipt = function (paymentId) {
    if (!canManage()) return toast('Accès refusé', 'error');
    var p = payments().find(function (x) { return x.id === paymentId; });
    if (!p) return toast('Paiement introuvable', 'error');
    var emp = empById(p.employeeId);
    var no = receiptNumber(p);

    var block = function (copy) {
      return '<div style="position:relative;height:540px;box-sizing:border-box;padding:30px 44px 0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' + brand(46, 24) +
          '<div style="text-align:right"><div style="font-size:26px;font-weight:900">REÇU DE PAIEMENT</div><div style="font-size:11px;color:#8a97ab;letter-spacing:1px;margin-top:2px;text-transform:uppercase">' + copy + '</div></div></div>' +
        '<div style="height:1px;background:' + LINE + ';margin:16px 0"></div>' +
        '<div style="display:flex;gap:14px">' +
          '<div style="flex:1;background:' + SOFT + ';border:1px solid ' + LINE + ';border-radius:10px;padding:10px 16px"><div style="font-size:10.5px;color:#4b5b75">N° du reçu</div><div style="font-size:15px;font-weight:800;font-family:monospace">' + esc(no) + '</div></div>' +
          '<div style="flex:1;background:' + SOFT + ';border:1px solid ' + LINE + ';border-radius:10px;padding:10px 16px"><div style="font-size:10.5px;color:#4b5b75">Date du paiement</div><div style="font-size:15px;font-weight:800">' + fmtDate(p.date) + '</div></div>' +
          '<div style="flex:1;background:' + SOFT + ';border:1px solid ' + LINE + ';border-radius:10px;padding:10px 16px"><div style="font-size:10.5px;color:#4b5b75">Statut</div><div style="font-size:15px;font-weight:800;color:' + (p.paid ? '#0e7a4b' : '#b7791f') + '">' + (p.paid ? 'PAYÉ' : 'EN ATTENTE') + '</div></div></div>' +
        '<div style="margin-top:16px;font-size:14px;line-height:1.9">Reçu de <b>Hichem Sponsor</b> au profit de <b>' + esc(emp ? (emp.name || emp.login) : 'Employé') + '</b> :<br>' +
          '<span style="color:#4b5b75">Nature :</span> <b>' + esc(TYPES[payType(p)].label) + '</b> — ' + esc(p.description || '') + '<br>' +
          '<span style="color:#4b5b75">Période concernée :</span> <b>' + esc(monthLabel(payPeriod(p))) + '</b> &nbsp;·&nbsp; <span style="color:#4b5b75">Mode :</span> <b>' + esc(payMethod(p)) + '</b></div>' +
        '<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;background:' + BLUE + ';color:#fff;border-radius:10px;padding:14px 22px">' +
          '<div style="font-size:12px;letter-spacing:1px">MONTANT</div><div style="font-size:28px;font-weight:900">' + fmt(p.amount) + '</div></div>' +
        '<div style="font-size:12px;color:#34445f;margin-top:8px">Arrêté le présent reçu à la somme de : <i>' + esc(words(p.amount)) + '</i></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:20px;gap:40px">' +
          '<div style="flex:1;text-align:center"><div style="font-size:12px;font-weight:800">Signature de l\'employeur</div><div style="height:44px;border-bottom:1px dashed #9fb0c9;margin-top:4px"></div></div>' +
          '<div style="flex:1;text-align:center"><div style="font-size:12px;font-weight:800">Signature du salarié <span style="font-weight:400;color:#6b7a90">(bon pour réception)</span></div><div style="height:44px;border-bottom:1px dashed #9fb0c9;margin-top:4px"></div></div></div>' +
      '</div>';
    };
    var inner = '<div style="width:794px;height:1122px;box-sizing:border-box;overflow:hidden;background:#fbfdfe;font-family:' + FONT + ';color:' + NAVY + '">' +
      block('Exemplaire salarié') +
      '<div style="border-top:2px dashed #9fb0c9;margin:0 30px;position:relative"><span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#fbfdfe;padding:0 10px;font-size:12px;color:#8a97ab">✂</span></div>' +
      block('Exemplaire employeur') + '</div>';
    openDoc({ title: 'Reçu ' + no + ' — ' + (emp ? (emp.name || emp.login) : ''), filename: no + '.pdf', inner: inner, fixed: true });
  };

  // ---------------------------------------------------------------- relevé (liste filtrée)
  window.printPayrollStatement = function () {
    if (!canManage()) return toast('Accès refusé', 'error');
    var list = filteredPayments();
    if (!list.length) return toast('Aucun paiement à imprimer', 'warning');
    var paid = 0, pending = 0;
    list.forEach(function (p) { var a = Number(p.amount) || 0; if (p.paid) paid += a; else pending += a; });
    var crit = [];
    if (HIST.emp) crit.push('Salarié : ' + empName(HIST.emp));
    if (HIST.month) crit.push('Période : ' + monthLabel(HIST.month));
    if (HIST.type) crit.push('Type : ' + TYPES[HIST.type].label);
    if (HIST.status) crit.push('Statut : ' + (HIST.status === 'paid' ? 'Payés' : 'En attente'));
    if (HIST.method) crit.push('Mode : ' + (METHODS[HIST.method] || HIST.method));
    if (HIST.q) crit.push('Recherche : « ' + HIST.q + ' »');

    var rows = list.map(function (p) {
      return '<tr style="border-bottom:1px solid ' + LINE + '">' +
        '<td style="padding:7px 8px;font-size:11px;white-space:nowrap">' + fmtDate(p.date) + '</td>' +
        '<td style="padding:7px 6px;font-size:10px;font-family:monospace;color:#4b5b75;white-space:nowrap">' + esc(receiptNumber(p)) + '</td>' +
        '<td style="padding:7px 6px;font-size:11.5px;font-weight:700">' + esc(empName(p.employeeId)) + '</td>' +
        '<td style="padding:7px 6px;font-size:11px;white-space:nowrap">' + esc(monthLabel(payPeriod(p))) + '</td>' +
        '<td style="padding:7px 6px;font-size:11px">' + esc(TYPES[payType(p)].label) + '</td>' +
        '<td style="padding:7px 6px;font-size:11px">' + esc(payMethod(p)) + '</td>' +
        '<td style="padding:7px 6px;font-size:10.5px;text-align:center;font-weight:700;color:' + (p.paid ? '#0e7a4b' : '#b7791f') + '">' + (p.paid ? 'Payé' : 'Attente') + '</td>' +
        '<td style="padding:7px 8px;font-size:11.5px;text-align:right;font-weight:800;white-space:nowrap">' + nf(p.amount) + '</td></tr>';
    }).join('');

    var inner =
      '<div style="width:794px;box-sizing:border-box;padding:34px 36px 30px;background:#fff;font-family:' + FONT + ';color:' + NAVY + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' + brand(48, 24) +
          '<div style="text-align:right"><div style="font-size:24px;font-weight:900">RELEVÉ DES PAIEMENTS</div><div style="font-size:11px;color:#8a97ab;margin-top:3px">Édité le ' + fmtDate(todayYmd()) + ' par ' + esc(actorName()) + '</div></div></div>' +
        '<div style="height:1px;background:' + LINE + ';margin:14px 0"></div>' +
        '<div style="font-size:11.5px;color:#4b5b75;margin-bottom:10px">' + (crit.length ? 'Filtres : ' + esc(crit.join(' · ')) : 'Tous les paiements') + ' — ' + list.length + ' ligne(s)</div>' +
        '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:' + NAVY + ';color:#fff;font-size:10px;letter-spacing:.4px;text-transform:uppercase">' +
          '<th style="padding:9px 8px;text-align:left">Date</th><th style="padding:9px 6px;text-align:left">N° reçu</th><th style="padding:9px 6px;text-align:left">Salarié</th><th style="padding:9px 6px;text-align:left">Période</th>' +
          '<th style="padding:9px 6px;text-align:left">Type</th><th style="padding:9px 6px;text-align:left">Mode</th><th style="padding:9px 6px;text-align:center">Statut</th><th style="padding:9px 8px;text-align:right">Montant (DA)</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>' +
        '<div style="display:flex;justify-content:flex-end;gap:12px;margin-top:14px">' +
          '<div style="background:#e9f8f0;color:#0e7a4b;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:800">Total payé : ' + fmt(paid) + '</div>' +
          '<div style="background:#fff6e5;color:#b7791f;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:800">En attente : ' + fmt(pending) + '</div></div>' +
      '</div>';
    openDoc({ title: 'Relevé des paiements', filename: 'releve_paiements_' + todayYmd() + '.pdf', inner: inner, fixed: false });
  };

  // exposés pour les tests / usage externe
  window.PayrollCore = { computePayroll: computePayroll, perfPrimeFor: perfPrimeFor, payPeriod: payPeriod, payType: payType, receiptNumber: receiptNumber };
})();
