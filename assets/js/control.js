// =====================================================================
//  CONTROL.JS — centre de notifications + rôle « Lecture seule » (comptable)
//  • Cloche en haut à droite : toutes les alertes importantes au même endroit.
//  • Rôle lecture seule : coche « 🔒 Lecture seule (comptable) » dans les permissions d'un employé ;
//    il peut consulter ses onglets autorisés sans rien pouvoir modifier.
//    ⚠ Protection au niveau de l'application. Pour une protection côté serveur, il faut aussi les règles
//    Firestore (voir le rapport).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;

  // =====================================================================
  //  LECTURE SEULE
  // =====================================================================
  function isReadOnly() { var s = window.appState && appState.session; return !!(s && s.type === 'employee' && s.permissions && s.permissions.readonly === true); }
  window.isReadOnlySession = isReadOnly;
  var MUTATORS = ['addClient', 'deleteClient', 'updateClientDebtNote', 'addOffer', 'deleteOffer', 'handleNewTodoSubmit', 'changeTodoStatus', 'toggleTodoPayment', 'confirmPaidAccount', 'deleteTodoTransaction',
    'addPayment', 'deletePayment', 'addExpense', 'deleteExpense', 'addRecurringExpense', 'deleteRecurringExpense', 'applyRecurringExpensesNow', 'addUsdPurchase', 'deleteUsdPurchase', 'deleteRequest',
    'addAdAccount', 'deleteAdAccount', 'rechargeAdAccount', 'addAdminEmail', 'removeAdminEmail', 'addEmployee', 'updateEmployeeSalary', 'updateEmployeePermission', 'markAbsent', 'removeAbsence', 'deleteAbsence',
    'toggleEmployeeActive', 'deleteEmployee', 'importLocalBackup', 'deleteTransaction', 'saveEditTransaction', 'saveBalancesAdjustments', 'addEmployeePerformance', 'confirmOcrSponsors', 'saveClientFromOcr',
    'saveCustomOfferFromOcr', 'saveManualSponsor', 'savePayrollPayment', 'togglePaymentStatus', 'deleteEmployeePayment', 'savePayrollAdvance', 'payrollAdvanceDelete', 'payrollSaveSettings', 'payrollResetSettings', 'payrollAbsenceToggle',
    'accClose', 'accReopen', 'accReconSave', 'accBudgetSet', 'accProfileSave', 'accQuoteCreate', 'accQuoteStatus', 'accQuoteDelete', 'accQuoteConvert', 'accCreditCreate', 'accCreditDelete',
    'opsRenewSet', 'opsRenewWa', 'opsDebtSave', 'opsDebtWa', 'opsAdThreshold', 'opsGoalSet', 'crmProspectAdd', 'crmProspectStage', 'crmProspectDelete', 'crmProspectConvert', 'crmProspectEdit', 'crmProfileSave', 'crmClientSource', 'crmMerge',
    'teamSetTitle', 'teamSetManager', 'teamSaveSettings', 'payrollLockMonth', 'payrollUnlockMonth', 'backupRestoreAll', 'backupRecoverMissing', 'backupNow', 'backupDelete', 'setMetaApiVersion', 'openNewClientModal'];
  var _blockedToast = 0;
  function blocked() { if (Date.now() - _blockedToast > 1500) { X.toast('Mode lecture seule : modification impossible', 'warning'); _blockedToast = Date.now(); } return false; }
  MUTATORS.forEach(function (n) { X.wrap(n, function () { if (isReadOnly()) return blocked(); }); });
  // filet de sécurité : aucune sauvegarde pour une session lecture seule
  X.wrap('autoSave', function () { if (isReadOnly()) return false; });
  X.wrap('saveToCloud', function () { if (isReadOnly()) return false; });

  function banner() {
    var id = 'readonlyBanner', el = document.getElementById(id);
    if (!isReadOnly()) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'fixed bottom-3 left-3 px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold shadow-lg'; el.style.zIndex = '9990'; el.innerHTML = '<i class="fas fa-lock mr-2"></i>Lecture seule'; document.body.appendChild(el); }
  }

  // =====================================================================
  //  NOTIFICATIONS
  // =====================================================================
  var _lastBackup = null, _backupChecked = 0;
  function checkBackupAge() {
    if (Date.now() - _backupChecked < 5 * 60 * 1000) return; _backupChecked = Date.now();
    try { if (window.BackupCore) BackupCore.getAll().then(function (all) { var t = all.filter(function (r) { return r.kind === 'auto'; }).map(function (r) { return r.ts; }); _lastBackup = t.length ? Math.max.apply(null, t) : 0; refresh(); }).catch(function () {}); } catch (e) {}
  }
  function collect() {
    var out = [], today = X.today(), admin = X.isAdmin();
    function add(level, icon, title, detail, tab, n, action) { out.push({ level: level, icon: icon, title: title, detail: detail, tab: tab, n: n || 1, action: action || '' }); }
    try {
      if (window.OpsDebtors) {
        var d = OpsDebtors(), old = d.filter(function (x) { return x.bucket === 2; }), late = d.filter(function (x) { return x.promiseLate; }), fu = d.filter(function (x) { return x.meta.nextFollowUp && x.meta.nextFollowUp <= today; });
        if (old.length) add('danger', 'fa-user-clock', old.length + ' client(s) en dette depuis plus de 30 jours', X.fmt(old.reduce(function (s, x) { return s + Number(x.c.unpaid || 0); }, 0)) + ' à recouvrer', 'reminders', old.length);
        if (late.length) add('danger', 'fa-calendar-xmark', late.length + ' promesse(s) de paiement dépassée(s)', late.map(function (x) { return x.c.name; }).slice(0, 3).join(', '), 'pilotage', late.length);
        if (fu.length) add('warn', 'fa-bell', fu.length + ' relance(s) de dette prévue(s) aujourd\'hui ou en retard', fu.map(function (x) { return x.c.name; }).slice(0, 3).join(', '), 'pilotage', fu.length);
      }
      if (window.OpsCampaigns) {
        var cs = OpsCampaigns(), ren = S.map('renewals'), ending = cs.filter(function (c) { return c.status === 'running' && c.left <= 2; }), toRenew = cs.filter(function (c) { return c.status === 'ended' && c.sinceEnd <= 14 && !ren[c.t.id]; });
        if (ending.length) add('warn', 'fa-hourglass-end', ending.length + ' campagne(s) se termine(nt) dans 2 jours ou moins', ending.map(function (c) { return c.t.clientName; }).slice(0, 3).join(', '), 'pilotage', ending.length);
        if (toRenew.length) add('info', 'fa-rotate', toRenew.length + ' campagne(s) terminée(s) à relancer pour renouvellement', toRenew.map(function (c) { return c.t.clientName; }).slice(0, 3).join(', '), 'pilotage', toRenew.length);
      }
      var b = appState.balances || {};
      if (admin && typeof b.usdt === 'number' && b.usdt < 150) add('warn', 'fa-coins', 'Stock USDT bas', X.usd(b.usdt) + ' restant', 'achats');
      var th = Number(S.get('adThreshold', 20)), lowAds = (appState.adAccounts || []).filter(function (a) { return a && Number(a.balance || 0) < th; });
      if (lowAds.length) add('warn', 'fa-rectangle-ad', lowAds.length + ' compte(s) pub à solde bas (< ' + th + ' $)', lowAds.map(function (a) { return a.name; }).slice(0, 3).join(', '), 'ad-accounts', lowAds.length);
      if (window.InvoiceFlow) { var pinv = InvoiceFlow.pending(); if (pinv.length) add('danger', 'fa-file-invoice', pinv.length + ' facture(s) obligatoire(s) à envoyer', pinv.map(function (t) { return t.clientName; }).slice(0, 3).join(', '), 'history', pinv.length, 'invoices'); }
      var unread = (appState.clientRequests || []).filter(function (r) { return r && !r.read; }).length;
      if (unread) add('info', 'fa-inbox', unread + ' demande(s) client non lue(s)', '', 'requests', unread);
      var pros = S.list('prospects').filter(function (p) { return p.nextFollowUp && p.nextFollowUp <= today && p.stage !== 'won' && p.stage !== 'lost'; });
      if (pros.length) add('info', 'fa-filter', pros.length + ' prospect(s) à relancer', pros.map(function (p) { return p.name; }).slice(0, 3).join(', '), 'crm', pros.length);
      if (admin) {
        var prev = X.shiftMonth(X.month(), -1);
        if (X.today().slice(8, 10) >= '05' && !(window.isMonthLocked && isMonthLocked(prev)) && ((appState.transactions || []).length)) add('info', 'fa-lock', X.monthLabel(prev) + ' n\'est pas encore clôturé', 'Figez les chiffres du mois', 'accounting');
        if (window.PayrollCore) {
          var rem = 0, n = 0; (appState.employees || []).filter(function (e) { return e.active !== false; }).forEach(function (e) { try { var r = PayrollCore.computePayroll(e, prev); if (r.remaining > 0.5 && r.net > 0) { rem += r.remaining; n++; } } catch (er) {} });
          if (n) add('warn', 'fa-users', 'Salaires de ' + X.monthLabel(prev) + ' non soldés (' + n + ' salarié(s))', X.fmt(rem) + ' restant', 'performance', n);
        }
        var recs = S.list('reconciliations'), lastRec = recs.length ? Math.max.apply(null, recs.map(function (r) { return r.ts || 0; })) : 0;
        if ((appState.transactions || []).length && Date.now() - lastRec > 30 * 86400000) add('info', 'fa-scale-balanced', 'Aucun rapprochement de caisse depuis 30 jours', 'Comptez vos caisses', 'accounting');
        checkBackupAge();
        if (_lastBackup !== null && (appState.transactions || []).length && (Date.now() - _lastBackup > 3 * 86400000)) add('warn', 'fa-database', 'Dernière sauvegarde automatique ancienne', _lastBackup ? 'il y a ' + Math.floor((Date.now() - _lastBackup) / 86400000) + ' jours' : 'aucune sauvegarde', 'settings');
      }
    } catch (e) { console.warn('Notifications', e); }
    return out.filter(function (a) { return typeof hasTabAccess !== 'function' || hasTabAccess(a.tab); });
  }
  window.NotificationsCollect = collect;

  function ensureBell() {
    var bar = document.querySelector('header.app-topbar .flex.gap-2'); if (!bar) return null;
    var btn = document.getElementById('notifBell');
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'notifBell'; btn.type = 'button'; btn.title = 'Notifications';
      btn.className = 'relative w-10 h-10 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl font-bold flex items-center justify-center hover:bg-gray-200 transition-all';
      btn.innerHTML = '<i class="fas fa-bell"></i><span id="notifBadge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">0</span>';
      btn.setAttribute('onclick', 'openNotifications()'); bar.insertBefore(btn, bar.firstChild);
    }
    return btn;
  }
  function refresh() {
    try {
      if (!ensureBell()) return;
      var list = collect(), n = list.reduce(function (s, a) { return s + (a.level === 'info' ? 0 : 1); }, 0) + list.filter(function (a) { return a.level === 'info'; }).length, b = document.getElementById('notifBadge');
      if (b) { b.textContent = list.length > 99 ? '99+' : String(list.length); b.classList.toggle('hidden', list.length === 0); b.classList.toggle('bg-red-500', list.some(function (a) { return a.level === 'danger'; })); b.classList.toggle('bg-amber-500', !list.some(function (a) { return a.level === 'danger'; })); }
      var panel = document.getElementById('notifPanel'); if (panel) renderPanel(panel, list);
      banner();
    } catch (e) {}
  }
  function renderPanel(el, list) {
    var col = { danger: 'bg-red-50 border-red-200 text-red-700', warn: 'bg-amber-50 border-amber-200 text-amber-700', info: 'bg-blue-50 border-blue-200 text-blue-700' };
    el.querySelector('#notifList').innerHTML = list.length ? list.map(function (a) {
      return '<button onclick="notifGo(\'' + X.js(a.tab) + '\',\'' + X.js(a.action || '') + '\')" class="w-full text-left flex items-start gap-3 p-3 rounded-2xl border ' + col[a.level] + ' hover:shadow transition-all mb-2"><i class="fas ' + a.icon + ' mt-1"></i><div class="flex-1 min-w-0"><div class="font-bold text-sm">' + E(a.title) + '</div>' + (a.detail ? '<div class="text-xs opacity-80 truncate">' + E(a.detail) + '</div>' : '') + '</div><i class="fas fa-chevron-right text-xs mt-1 opacity-60"></i></button>';
    }).join('') : '<div class="text-center py-10 text-gray-400"><i class="fas fa-circle-check text-4xl text-green-400 mb-3"></i><p class="font-bold">Tout est à jour 🎉</p></div>';
  }
  window.openNotifications = function () {
    var old = document.getElementById('notifPanel'); if (old) { old.remove(); return; }
    var el = document.createElement('div'); el.id = 'notifPanel'; el.className = 'fixed inset-0 bg-black bg-opacity-40 flex justify-end'; el.style.zIndex = '70';
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 w-full max-w-md h-full shadow-2xl flex flex-col border-l dark:border-gray-700"><div class="flex items-center justify-between p-5 border-b dark:border-gray-700"><h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-bell text-indigo-600 mr-2"></i>Notifications</h3><button onclick="document.getElementById(\'notifPanel\').remove()" class="text-3xl text-gray-400 hover:text-gray-600 leading-none">×</button></div><div id="notifList" class="p-4 overflow-y-auto flex-1"></div></div>';
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); }); document.body.appendChild(el); renderPanel(el, collect());
  };
  window.notifGo = function (tab, action) { var p = document.getElementById('notifPanel'); if (p) p.remove(); if (action === 'invoices' && typeof openPendingInvoices === 'function') return openPendingInvoices(); if (typeof showTab === 'function') showTab(tab); };

  document.addEventListener('ext:rendered', refresh);
  setInterval(refresh, 60000);
  setTimeout(refresh, 1500);
  window.addEventListener('load', function () { setTimeout(refresh, 800); });
  window.NotificationsRefresh = refresh;
})();
