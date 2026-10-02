// =====================================================================
//  BACKUP.JS — sauvegardes automatiques + restauration
//  - Une sauvegarde par jour (créée automatiquement à l'ouverture par l'admin), 14 jours conservés,
//    stockée dans le navigateur (IndexedDB) : indépendante de l'internet et du cloud.
//  - Sauvegarde manuelle à la demande + sauvegarde de sécurité automatique avant chaque restauration.
//  - Deux modes de restauration :
//      • « Récupérer les éléments supprimés » : AJOUTE ce qui manque, ne modifie rien d'existant (sûr)
//      • « Remplacer tout » : remet l'application dans l'état exact de la sauvegarde (double confirmation)
//  - Carte « Sauvegardes automatiques » ajoutée à la page Paramètres (sans toucher à l'existant).
//  L'export / import manuel de fichier existant (exportLocalBackup / importLocalBackup) reste inchangé.
// =====================================================================
(function () {
  'use strict';

  var DB_NAME = 'hichemSponsorBackups', STORE = 'snapshots';
  var COLLECTIONS = ['clients', 'offers', 'transactions', 'todoTransactions', 'payments', 'usdPurchases', 'expenses', 'usdtExpenses',
    'recurringExpenses', 'clientRequests', 'employees', 'adAccounts', 'products', 'employeePayments', 'employeePerformance', 'absences'];
  var OBJECTS = ['globalConfig', 'settings', 'manualBalances', 'performanceConfig', 'customSection', 'activityLog'];
  var KEEP = { auto: 14, manual: 10, 'pre-restore': 5 };
  var LABELS = { clients: 'clients', transactions: 'transactions', todoTransactions: 'to-do', payments: 'paiements', expenses: 'frais', employees: 'employés', offers: 'offres' };

  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
  function esc(v) { return window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v); }
  function isAdmin() { try { return typeof getUserRole === 'function' && getUserRole() === 'admin'; } catch (e) { return false; } }
  function ymd() {
    var d = (typeof getAlgeriaNow === 'function') ? getAlgeriaNow() : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ------------------------------------------------------------------ IndexedDB
  var _dbp = null;
  function openDb() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) return reject(new Error('indexedDB indisponible'));
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    _dbp.catch(function () { _dbp = null; });
    return _dbp;
  }
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { resolve(out && typeof out === 'object' && 'result' in out ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  function getAll() { return tx('readonly', function (st) { return st.getAll(); }); }
  function getOne(id) { return tx('readonly', function (st) { return st.get(id); }); }
  function putOne(rec) { return tx('readwrite', function (st) { return st.put(rec); }); }
  function delOne(id) { return tx('readwrite', function (st) { return st.delete(id); }); }

  // ------------------------------------------------------------------ création
  function buildData() {
    var s = window.appState || {}, data = {}, counts = {}, total = 0;
    COLLECTIONS.forEach(function (c) { var arr = Array.isArray(s[c]) ? s[c] : []; data[c] = JSON.parse(JSON.stringify(arr)); counts[c] = arr.length; total += arr.length; });
    OBJECTS.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) data[k] = JSON.parse(JSON.stringify(s[k])); });
    return { data: data, counts: counts, total: total };
  }

  function createSnapshot(kind, label) {
    var b = buildData();
    if (kind === 'auto' && b.total === 0) return Promise.resolve(null);     // ne jamais sauvegarder un état vide
    var id = kind === 'auto' ? ymd() : (kind + '-' + Date.now());
    return getOne(id).then(function (existing) {
      // protection : ne pas écraser la sauvegarde du jour par un état nettement plus petit (chargement partiel)
      if (kind === 'auto' && existing && existing.total > 20 && b.total < existing.total * 0.8) return null;
      var rec = { id: id, ts: Date.now(), kind: kind, label: label || '', counts: b.counts, total: b.total, size: JSON.stringify(b.data).length, data: b.data };
      return putOne(rec).then(function () { return prune(kind); }).then(function () { return rec; });
    });
  }
  function prune(kind) {
    return getAll().then(function (all) {
      var mine = all.filter(function (r) { return r.kind === kind; }).sort(function (a, b) { return b.ts - a.ts; });
      var extra = mine.slice(KEEP[kind] || 10);
      return Promise.all(extra.map(function (r) { return delOne(r.id); }));
    });
  }

  var _autoRunning = false;
  function tryAuto() {
    if (_autoRunning || !isAdmin()) return Promise.resolve();
    var s = window.appState || {};
    if (!((s.clients || []).length || (s.transactions || []).length)) return Promise.resolve();   // données pas encore chargées
    _autoRunning = true;
    return createSnapshot('auto', 'Sauvegarde automatique').catch(function (e) { console.warn('Sauvegarde auto impossible', e); }).then(function () { _autoRunning = false; });
  }

  // ------------------------------------------------------------------ restauration
  function pendingList() {
    if (!appState.sync) appState.sync = {};
    if (!Array.isArray(appState.sync.pendingDeletions)) appState.sync.pendingDeletions = [];
    return appState.sync.pendingDeletions;
  }
  function afterRestore() {
    if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
    if (typeof autoSave === 'function') autoSave();
    if (typeof renderCurrentTab === 'function') renderCurrentTab();
    if (typeof logActivity === 'function') { /* journalisé par l'appelant */ }
  }

  window.backupRecoverMissing = function (id) {
    if (!isAdmin()) return toast('Réservé à l\'administrateur', 'error');
    getOne(id).then(function (rec) {
      if (!rec) return toast('Sauvegarde introuvable', 'error');
      var plan = [], total = 0;
      COLLECTIONS.forEach(function (c) {
        var have = {}; (appState[c] || []).forEach(function (d) { if (d && d.id) have[d.id] = 1; });
        var missing = (rec.data[c] || []).filter(function (d) { return d && d.id && !have[d.id]; });
        if (typeof filterSafeDocs === 'function') missing = filterSafeDocs(missing, c);
        if (missing.length) { plan.push([c, missing]); total += missing.length; }
      });
      if (!total) return toast('Rien à récupérer : tous les éléments de cette sauvegarde existent déjà.', 'info');
      var txt = plan.map(function (p) { return p[1].length + ' ' + (LABELS[p[0]] || p[0]); }).join(', ');
      if (!confirm('Récupérer ' + total + ' élément(s) supprimés depuis la sauvegarde du ' + (rec.id.slice(0, 10)) + ' ?\n\n' + txt + '\n\nRien de ce qui existe déjà ne sera modifié.')) return;
      createSnapshot('pre-restore', 'Avant récupération').then(function () {
        var pend = pendingList();
        plan.forEach(function (p) {
          if (!Array.isArray(appState[p[0]])) appState[p[0]] = [];
          p[1].forEach(function (d) {
            appState[p[0]].push(d);
            for (var i = pend.length - 1; i >= 0; i--) if (pend[i].col === p[0] && pend[i].id === d.id) pend.splice(i, 1);
          });
        });
        if (typeof logActivity === 'function') logActivity('Sauvegarde : éléments récupérés', total + ' élément(s) depuis la sauvegarde du ' + rec.id.slice(0, 10) + ' (' + txt + ')');
        afterRestore(); renderCard();
        toast(total + ' élément(s) récupéré(s)', 'success');
      });
    }).catch(function () { toast('Erreur de lecture de la sauvegarde', 'error'); });
  };

  window.backupRestoreAll = function (id) {
    if (!isAdmin()) return toast('Réservé à l\'administrateur', 'error');
    getOne(id).then(function (rec) {
      if (!rec) return toast('Sauvegarde introuvable', 'error');
      var date = rec.id.slice(0, 10);
      if (!confirm('⚠ REMPLACER TOUTES LES DONNÉES par la sauvegarde du ' + date + ' (' + rec.total + ' éléments) ?\n\nTout ce qui a été créé ou modifié depuis sera perdu (une copie de sécurité de l\'état actuel est faite avant).')) return;
      if (!confirm('Dernière confirmation : remplacer l\'état actuel par celui du ' + date + ' ?')) return;
      createSnapshot('pre-restore', 'Avant remplacement complet').then(function () {
        var pend = pendingList();
        COLLECTIONS.forEach(function (c) {
          var snap = (typeof filterSafeDocs === 'function') ? filterSafeDocs(rec.data[c] || [], c) : (rec.data[c] || []);
          var keep = {}; snap.forEach(function (d) { if (d && d.id) keep[d.id] = 1; });
          (appState[c] || []).forEach(function (d) {
            if (d && d.id && !keep[d.id] && !pend.some(function (x) { return x.col === c && x.id === d.id; })) pend.push({ col: c, id: d.id });
          });
          for (var i = pend.length - 1; i >= 0; i--) if (pend[i].col === c && keep[pend[i].id]) pend.splice(i, 1);
          appState[c] = JSON.parse(JSON.stringify(snap));
        });
        OBJECTS.forEach(function (k) { if (rec.data[k] !== undefined) appState[k] = JSON.parse(JSON.stringify(rec.data[k])); });
        if (typeof logActivity === 'function') logActivity('Sauvegarde : restauration complète', 'État remplacé par la sauvegarde du ' + date + ' (' + rec.total + ' éléments)');
        afterRestore(); renderCard();
        toast('Restauration complète effectuée', 'success');
      });
    }).catch(function () { toast('Erreur de lecture de la sauvegarde', 'error'); });
  };

  window.backupDownload = function (id) {
    getOne(id).then(function (rec) {
      if (!rec) return;
      var blob = new Blob([JSON.stringify(rec.data)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'sponsor_hichem_backup_' + rec.id.slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  };
  window.backupNow = function () {
    if (!isAdmin()) return toast('Réservé à l\'administrateur', 'error');
    createSnapshot('manual', 'Sauvegarde manuelle').then(function (r) {
      if (typeof logActivity === 'function') logActivity('Sauvegarde manuelle créée', r ? r.total + ' éléments' : '');
      toast('Sauvegarde créée', 'success'); renderCard();
    }).catch(function () { toast('Sauvegarde impossible sur cet appareil', 'error'); });
  };
  window.backupDelete = function (id) {
    if (!confirm('Supprimer cette sauvegarde locale ?')) return;
    delOne(id).then(renderCard);
  };

  // ------------------------------------------------------------------ carte dans Paramètres
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko'; }
  function renderCard() {
    var box = document.getElementById('backupCard');
    if (!box) return;
    getAll().then(function (all) {
      all.sort(function (a, b) { return b.ts - a.ts; });
      var kindLbl = { auto: 'Automatique', manual: 'Manuelle', 'pre-restore': 'Avant restauration' };
      var rows = all.length ? all.map(function (r) {
        var id = esc(r.id).replace(/'/g, '');
        var det = ['clients', 'transactions', 'employees'].map(function (k) { return (r.counts[k] || 0) + ' ' + LABELS[k]; }).join(' · ');
        var when = new Date(r.ts).toLocaleString('fr-FR', { timeZone: 'Africa/Algiers' });
        return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40">' +
          '<td class="p-3 text-sm font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">' + esc(when) + '</td>' +
          '<td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-black ' + (r.kind === 'auto' ? 'bg-green-100 text-green-700' : (r.kind === 'manual' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700')) + '">' + esc(kindLbl[r.kind] || r.kind) + '</span></td>' +
          '<td class="p-3 text-xs text-gray-500">' + esc(det) + ' · ' + r.total + ' éléments · ' + fmtSize(r.size || 0) + '</td>' +
          '<td class="p-3 text-right whitespace-nowrap">' +
            '<button onclick="backupRecoverMissing(\'' + id + '\')" class="px-2 py-1 text-xs font-bold rounded-lg bg-green-100 text-green-700 hover:bg-green-200" title="Ajoute ce qui a été supprimé, ne modifie rien d\'existant">Récupérer les supprimés</button> ' +
            '<button onclick="backupDownload(\'' + id + '\')" class="px-2 py-1 text-xs font-bold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Télécharger</button> ' +
            '<button onclick="backupRestoreAll(\'' + id + '\')" class="px-2 py-1 text-xs font-bold rounded-lg bg-red-100 text-red-700 hover:bg-red-200">Remplacer tout</button> ' +
            '<button onclick="backupDelete(\'' + id + '\')" class="px-2 py-1 text-xs text-gray-400 hover:text-red-500" title="Supprimer"><i class="fas fa-trash-alt"></i></button></td></tr>';
      }).join('') : '<tr><td colspan="4" class="p-6 text-center text-gray-400 italic">Aucune sauvegarde pour le moment — la première est créée automatiquement.</td></tr>';
      box.innerHTML =
        '<div class="flex flex-wrap items-center justify-between gap-3 mb-4">' +
          '<div><h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-database text-indigo-600 mr-2"></i>Sauvegardes automatiques</h3>' +
          '<p class="text-xs text-gray-500 mt-1">Une sauvegarde par jour (14 jours conservés) sur cet appareil. Utile pour récupérer un élément supprimé par erreur.</p></div>' +
          '<button onclick="backupNow()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow text-sm"><i class="fas fa-plus mr-2"></i>Sauvegarder maintenant</button></div>' +
        '<div class="overflow-x-auto rounded-2xl border dark:border-gray-700"><table class="w-full"><thead><tr class="bg-gray-100 dark:bg-gray-700 text-[11px] font-black uppercase text-gray-600 dark:text-gray-200"><th class="p-3 text-left">Date</th><th class="p-3 text-left">Type</th><th class="p-3 text-left">Contenu</th><th class="p-3 text-right">Actions</th></tr></thead><tbody class="divide-y dark:divide-gray-700">' + rows + '</tbody></table></div>';
    }).catch(function () {
      box.innerHTML = '<p class="text-sm text-gray-500">Les sauvegardes automatiques ne sont pas disponibles dans ce navigateur (stockage local bloqué ou navigation privée).</p>';
    });
  }

  // La carte est ajoutée à la fin de la page Paramètres : on enveloppe renderSettingsAdmin (sans la modifier)
  (function hookSettings() {
    var orig = window.renderSettingsAdmin;
    if (typeof orig !== 'function' || orig._backupWrapped) return;
    var wrapped = function (container) {
      var r = orig.apply(this, arguments);
      try {
        if (container && isAdmin()) {
          var card = document.createElement('div');
          card.id = 'backupCard';
          card.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-6 border dark:border-gray-700 mt-8';
          container.appendChild(card);
          renderCard();
        }
      } catch (e) { console.warn('Carte sauvegardes non affichée', e); }
      return r;
    };
    wrapped._backupWrapped = true;
    window.renderSettingsAdmin = wrapped;
  })();

  // Sauvegarde automatique : 30 s après l'ouverture, puis toutes les 30 minutes (une seule par jour est conservée)
  setTimeout(tryAuto, 30000);
  setInterval(tryAuto, 30 * 60 * 1000);

  window.BackupCore = { createSnapshot: createSnapshot, getAll: getAll, tryAuto: tryAuto, buildData: buildData };
})();
