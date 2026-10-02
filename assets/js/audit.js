// =====================================================================
//  AUDIT.JS — journal d'audit complet ("qui a fait quoi, quand")
//  - Ajoute la traçabilité des actions importantes qui n'étaient pas journalisées
//    (ventes, modifications, suppressions, salaires, permissions, admins, absences...).
//  - N'ALTÈRE AUCUNE FONCTION EXISTANTE : chaque fonction est simplement "enveloppée" ;
//    elle s'exécute exactement comme avant, puis une ligne est ajoutée au journal.
//  - Archive locale illimitée (IndexedDB) : le journal synchronisé dans le cloud est limité à
//    500 lignes ; cette archive garde tout l'historique vu sur cet appareil.
//  - Visionneuse filtrable + export CSV (remplace l'écran « Journal d'activité » ; l'ancien
//    reste disponible sous window._legacyOpenActivityLogModal).
// =====================================================================
(function () {
  'use strict';

  var DB_NAME = 'hichemSponsorAudit', STORE = 'entries';
  var _dbp = null;

  // ------------------------------------------------------------------ IndexedDB (archive)
  function openDb() {
    if (_dbp) return _dbp;
    _dbp = new Promise(function (resolve, reject) {
      try {
        if (!window.indexedDB) return reject(new Error('indexedDB indisponible'));
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    _dbp.catch(function () { _dbp = null; });
    return _dbp;
  }
  function archivePut(list) {
    if (!list || !list.length) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
        list.forEach(function (e) { if (e && e.id) st.put(e); });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }
  function archiveAll() {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var out = [], req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = function () { var c = req.result; if (c) { out.push(c.value); c.continue(); } else resolve(out); };
        req.onerror = function () { resolve(out); };
      });
    }).catch(function () { return []; });
  }
  var _timer = null;
  function scheduleArchive() {
    if (_timer) return;
    _timer = setTimeout(function () {
      _timer = null;
      archivePut((window.appState && appState.activityLog) || []);
    }, 1500);
  }

  // ------------------------------------------------------------------ enveloppe du logger existant
  // logActivity(action, details) existe déjà (utils.js). On le garde tel quel, on ajoute :
  //   - une limite de taille du détail (pour ne pas faire gonfler le document cloud)
  //   - la copie dans l'archive locale
  (function wrapLogger() {
    var orig = window.logActivity;
    if (typeof orig !== 'function' || orig._auditWrapped) return;
    var wrapped = function (action, details) {
      var d = details == null ? '' : String(details);
      if (d.length > 400) d = d.slice(0, 397) + '...';
      var r = orig.call(this, action, d);
      // archivage immédiat de la ligne qui vient d'être ajoutée (ne dépend pas du plafond de 500 en mémoire)
      try { var last = window.appState && appState.activityLog && appState.activityLog[0]; if (last) archivePut([last]); } catch (e) {}
      scheduleArchive();
      return r;
    };
    wrapped._auditWrapped = true;
    window.logActivity = wrapped;
  })();

  function audit(action, details) {
    try { if (typeof window.logActivity === 'function') window.logActivity(action, details); } catch (e) {}
  }
  function money(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ') + ' DA'; }
  function find(arr, id) { return (arr || []).find(function (x) { return x && x.id === id; }); }
  function count() { var s = window.appState || {}; return (s.transactions || []).length + '|' + (s.todoTransactions || []).length; }

  // ------------------------------------------------------------------ enveloppes par fonction
  function wrap(name, before, after) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig._auditWrapped) return;
    var fn = function () {
      var args = arguments, ctx = null;
      try { ctx = before ? before.apply(this, args) : null; } catch (e) { ctx = null; }
      var result = orig.apply(this, args);
      var done = function () { try { var e = after(ctx, args); if (e) audit(e[0], e[1]); } catch (err) {} };
      if (result && typeof result.then === 'function') return result.then(function (v) { done(); return v; });
      done();
      return result;
    };
    fn._auditWrapped = true;
    window[name] = fn;
  }
  function txLabel(t) { return (t.clientName || 'Client') + ' — ' + (t.offerName || 'Offre') + ' — ' + money(t.priceDzd) + (t.date ? ' (' + t.date + ')' : ''); }

  function installWrappers() {
    // Transactions
    wrap('deleteTransaction',
      function (id) { var t = find(appState.transactions, id); return t ? Object.assign({}, t) : null; },
      function (t, a) { if (t && !find(appState.transactions, a[0])) return ['Transaction supprimée', txLabel(t)]; });
    wrap('saveEditTransaction',
      function () { var id = (document.getElementById('editTxId') || {}).value; var t = find(appState.transactions, id); return t ? { id: id, snap: Object.assign({}, t) } : null; },
      function (c) {
        if (!c) return;
        var n = find(appState.transactions, c.id); if (!n) return;
        var ch = [];
        if (Number(c.snap.priceDzd) !== Number(n.priceDzd)) ch.push('prix ' + money(c.snap.priceDzd) + ' → ' + money(n.priceDzd));
        if (Number(c.snap.amount) !== Number(n.amount)) ch.push('USD ' + c.snap.amount + ' → ' + n.amount);
        if (String(c.snap.date) !== String(n.date)) ch.push('date ' + c.snap.date + ' → ' + n.date);
        if (!!c.snap.paid !== !!n.paid) ch.push(n.paid ? 'marquée payée' : 'marquée impayée');
        if (String(c.snap.duration || '') !== String(n.duration || '')) ch.push('durée ' + (c.snap.duration || '—') + ' → ' + (n.duration || '—'));
        if ((c.snap.adAccountId || '') !== (n.adAccountId || '')) ch.push('compte pub modifié');
        if (ch.length) return ['Transaction modifiée', (n.clientName || 'Client') + ' — ' + (n.offerName || '') + ' : ' + ch.join(', ')];
      });
    wrap('handleNewTodoSubmit',
      function () { return count(); },
      function (c) {
        if (c === count()) return;
        var s = appState, last = (s.todoTransactions || []).concat(s.transactions || []).filter(function (t) { return t && t.createdAt; }).sort(function (a, b) { return b.createdAt - a.createdAt; })[0];
        if (!last) return ['Vente / To-Do créée', ''];
        var direct = (s.transactions || []).indexOf(last) !== -1;
        return [direct ? 'Vente validée (directe)' : 'To-Do créée', txLabel(last) + (last.launchedByName ? ' — lancé par ' + last.launchedByName : '')];
      });
    wrap('changeTodoStatus',
      function (id, status, type) { var arr = type === 'problem' ? appState.transactions : appState.todoTransactions; var t = find(arr, id); return t ? { snap: Object.assign({}, t), status: status } : null; },
      function (c) {
        if (!c) return;
        var names = { done: 'validée', problem: 'passée en PROBLÈME', in_progress: 'passée EN COURS', pending: 'remise en attente' };
        return ['Tâche ' + (names[c.status] || c.status), txLabel(c.snap)];
      });
    wrap('deleteTodoTransaction',
      function (id, type) { var arr = type === 'problem' ? appState.transactions : appState.todoTransactions; var t = find(arr, id); return t ? { t: Object.assign({}, t), arr: type } : null; },
      function (c, a) { if (!c) return; var arr = c.arr === 'problem' ? appState.transactions : appState.todoTransactions; if (!find(arr, a[0])) return ['To-Do supprimée', txLabel(c.t)]; });

    // Clients / offres
    wrap('addClient',
      function () { return { n: (appState.clients || []).length, editing: window.editingClientId || null, snap: window.editingClientId ? Object.assign({}, find(appState.clients, window.editingClientId) || {}) : null }; },
      function (c) {
        var n = (appState.clients || []).length;
        if (n > c.n) { var cl = appState.clients[n - 1]; return ['Client créé', (cl && cl.name) || '']; }
        if (c.editing) { var cur = find(appState.clients, c.editing); if (cur) return ['Client modifié', cur.name + (c.snap && c.snap.name !== cur.name ? ' (ancien nom : ' + c.snap.name + ')' : '')]; }
      });
    wrap('addOffer',
      function () { return (appState.offers || []).length; },
      function (n) { var now = (appState.offers || []).length; var o = appState.offers[now - 1]; if (now > n && o) return ['Offre créée', o.name + ' — ' + money(o.priceDzd)]; return ['Offre modifiée', '']; });
    wrap('deleteOffer',
      function (id) { var o = find(appState.offers, id); return o ? Object.assign({}, o) : null; },
      function (o, a) { if (o && !find(appState.offers, a[0])) return ['Offre supprimée', o.name + ' — ' + money(o.priceDzd)]; });
    wrap('deleteRequest',
      function (id) { var r = find(appState.clientRequests, id); return r ? Object.assign({}, r) : null; },
      function (r, a) { if (r && !find(appState.clientRequests, a[0])) return ['Demande client supprimée', (r.clientName || r.name || '') + ' — ' + (r.offer || '')]; });

    // Équipe
    wrap('updateEmployeeSalary',
      function (id) { var e = find(appState.employees, id); return e ? { id: id, old: Number(e.salary) || 0 } : null; },
      function (c) { if (!c) return; var e = find(appState.employees, c.id); if (e && Number(e.salary) !== c.old) return ['Salaire modifié', (e.name || e.login) + ' : ' + money(c.old) + ' → ' + money(e.salary)]; });
    wrap('updateEmployeePermission',
      function (id, tab) { var e = find(appState.employees, id); return e ? { id: id, tab: tab, old: !!(e.permissions && e.permissions[tab]) } : null; },
      function (c) { if (!c) return; var e = find(appState.employees, c.id); var now = !!(e && e.permissions && e.permissions[c.tab]); if (e && now !== c.old) return ['Permission ' + (now ? 'accordée' : 'retirée'), (e.name || e.login) + ' — onglet « ' + c.tab + ' »']; });
    wrap('toggleEmployeeActive',
      function (id) { return id; },
      function (id) { var e = find(appState.employees, id); if (e) return ['Employé ' + (e.active === false ? 'désactivé' : 'réactivé'), e.name || e.login || '']; });
    wrap('markAbsent', function (id) { return id; }, function (id) { var e = find(appState.employees, id); return ['Absence enregistrée', (e && (e.name || e.login)) || id]; });
    wrap('removeAbsence', function (id) { return id; }, function (id) { var e = find(appState.employees, id); return ['Absence annulée', (e && (e.name || e.login)) || id]; });
    wrap('addAdminEmail',
      function () { return ((appState.globalConfig || {}).adminEmails || []).length; },
      function (n) { var l = ((appState.globalConfig || {}).adminEmails || []); if (l.length > n) return ['Administrateur autorisé', l[l.length - 1]]; });
    wrap('removeAdminEmail',
      function (idx) { var l = ((appState.globalConfig || {}).adminEmails || []); return { n: l.length, email: l[idx] }; },
      function (c) { var l = ((appState.globalConfig || {}).adminEmails || []); if (l.length < c.n) return ['Administrateur retiré', c.email || '']; });

    // Comptes pub
    wrap('addAdAccount', function () { return (appState.adAccounts || []).length; }, function (n) { var l = appState.adAccounts || []; if (l.length > n) return ['Compte pub créé', l[l.length - 1].name || '']; });
    wrap('deleteAdAccount',
      function (id) { var a = find(appState.adAccounts, id); return a ? Object.assign({}, a) : null; },
      function (a, args) { if (a && !find(appState.adAccounts, args[0])) return ['Compte pub supprimé', a.name || '']; });
    wrap('rechargeAdAccount', function (id) { var a = find(appState.adAccounts, id); return a ? { id: id, bal: Number(a.balance) || 0 } : null; },
      function (c) { if (!c) return; var a = find(appState.adAccounts, c.id); if (a && Number(a.balance) !== c.bal) return ['Compte pub rechargé', (a.name || '') + ' : ' + c.bal + ' → ' + a.balance]; });

    // Sauvegardes / exports
    wrap('exportLocalBackup', null, function () { return ['Sauvegarde exportée (fichier)', '']; });
    wrap('importLocalBackup', null, function () { return ['Import de sauvegarde lancé', 'Restauration depuis un fichier']; });
    wrap('exportPerformanceCSV', null, function () { return ['Export CSV performance salariés', '']; });
    wrap('exportTransactions', null, function () { return ['Export CSV historique des transactions', '']; });

    // Connexions
    wrap('handleLoginClick', function () { return JSON.stringify(appState.session || null); },
      function (before) { var now = JSON.stringify(appState.session || null); if (now !== before && appState.session && appState.session.type === 'employee') return ['Connexion employé', appState.session.name || appState.session.login || '']; });
    wrap('loginWithEmailPassword', function (email) { return email; },
      function (email) { try { if (window.auth && auth.currentUser && !auth.currentUser.isAnonymous) return ['Connexion administrateur', auth.currentUser.email || email || '']; } catch (e) {} });
  }

  // ------------------------------------------------------------------ visionneuse
  var F = { q: '', actor: '', cat: '', from: '', to: '' };
  var _all = [];
  function esc(v) { return window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmtTs(ts) { try { return new Date(ts).toLocaleString('fr-FR', { timeZone: 'Africa/Algiers' }); } catch (e) { return ''; } }
  function ymd(ts) { try { var d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'Africa/Algiers' })); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } catch (e) { return ''; } }
  function category(a) {
    a = String(a || '').toLowerCase();
    if (/supprim|retir|annul/.test(a)) return 'Suppressions';
    if (/connexion/.test(a)) return 'Connexions';
    if (/salaire|permission|employ|absence|admin|paiement salari/.test(a)) return 'Équipe & accès';
    if (/paiement|dépense|achat|charge|solde|vente|transaction|to-do|tâche|compte pub|recharg/.test(a)) return 'Finance & ventes';
    if (/sauvegarde|export|import|rapport/.test(a)) return 'Sauvegardes & exports';
    return 'Autres';
  }
  var CATS = ['Finance & ventes', 'Suppressions', 'Équipe & accès', 'Connexions', 'Sauvegardes & exports', 'Autres'];

  function filtered() {
    var q = F.q.trim().toLowerCase();
    return _all.filter(function (e) {
      if (F.actor && e.actor !== F.actor) return false;
      if (F.cat && category(e.action) !== F.cat) return false;
      var d = ymd(e.ts);
      if (F.from && d < F.from) return false;
      if (F.to && d > F.to) return false;
      if (q && (String(e.action) + ' ' + String(e.details) + ' ' + String(e.actor)).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function renderRows() {
    var body = document.getElementById('auditBody'), cnt = document.getElementById('auditCount');
    if (!body) return;
    var list = filtered(), shown = list.slice(0, 300);
    if (cnt) cnt.textContent = list.length + ' entrée(s)' + (list.length > shown.length ? ' (300 affichées — affinez les filtres ou exportez en CSV)' : '');
    body.innerHTML = shown.length ? shown.map(function (e) {
      var c = category(e.action);
      var col = c === 'Suppressions' ? 'bg-red-100 text-red-700' : (c === 'Finance & ventes' ? 'bg-green-100 text-green-700' : (c === 'Équipe & accès' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'));
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40">' +
        '<td class="p-3 whitespace-nowrap text-xs text-gray-500">' + esc(fmtTs(e.ts)) + '</td>' +
        '<td class="p-3 text-xs font-bold text-indigo-600 whitespace-nowrap">' + esc(e.actor) + '</td>' +
        '<td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-black ' + col + ' whitespace-nowrap">' + esc(c) + '</span></td>' +
        '<td class="p-3 text-sm font-bold text-gray-800 dark:text-gray-100">' + esc(e.action) + '</td>' +
        '<td class="p-3 text-xs text-gray-500 dark:text-gray-400">' + esc(e.details) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="p-8 text-center text-gray-400 italic">Aucune entrée.</td></tr>';
  }
  window.auditSetFilter = function () {
    F.q = document.getElementById('auditQ').value; F.actor = document.getElementById('auditActor').value; F.cat = document.getElementById('auditCat').value;
    F.from = document.getElementById('auditFrom').value; F.to = document.getElementById('auditTo').value; renderRows();
  };
  window.auditExportCsv = function () {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var rows = [['Date', 'Utilisateur', 'Catégorie', 'Action', 'Détails'].map(q).join(';')];
    filtered().forEach(function (e) { rows.push([fmtTs(e.ts), e.actor, category(e.action), e.action, e.details].map(q).join(';')); });
    var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'journal_audit_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    if (typeof showToast === 'function') showToast('Export du journal réussi', 'success');
  };
  window.openAuditLog = function () {
    var role = (typeof getUserRole === 'function') ? getUserRole() : 'none';
    if (role !== 'admin') { if (typeof showToast === 'function') showToast('Réservé à l\'administrateur', 'error'); return; }
    var old = document.getElementById('activityLogModal'); if (old) old.remove();
    F = { q: '', actor: '', cat: '', from: '', to: '' };
    var modal = document.createElement('div');
    modal.id = 'activityLogModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-2 md:p-6 z-50';
    var inp = 'p-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm w-full';
    modal.innerHTML =
      '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-6xl flex flex-col border dark:border-gray-700" style="max-height:94vh">' +
        '<div class="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5 border-b dark:border-gray-700">' +
          '<h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-shield-halved text-indigo-600 mr-2"></i>Journal d\'audit</h3>' +
          '<div class="flex gap-2"><button onclick="auditExportCsv()" class="px-3 py-2 border dark:border-gray-600 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><i class="fas fa-file-csv mr-1"></i>CSV</button>' +
          '<button onclick="document.getElementById(\'activityLogModal\').remove()" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-200"><i class="fas fa-times mr-1"></i>Fermer</button></div></div>' +
        '<div class="p-4 md:px-5 border-b dark:border-gray-700 grid grid-cols-2 md:grid-cols-5 gap-2">' +
          '<input id="auditQ" class="' + inp + '" placeholder="Rechercher..." oninput="auditSetFilter()">' +
          '<select id="auditActor" class="' + inp + '" onchange="auditSetFilter()"><option value="">Tous les utilisateurs</option></select>' +
          '<select id="auditCat" class="' + inp + '" onchange="auditSetFilter()"><option value="">Toutes catégories</option>' + CATS.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>' +
          '<input id="auditFrom" type="date" class="' + inp + '" onchange="auditSetFilter()" title="Du">' +
          '<input id="auditTo" type="date" class="' + inp + '" onchange="auditSetFilter()" title="Au">' +
        '</div>' +
        '<div class="px-5 pt-3 text-xs font-bold text-gray-500" id="auditCount">Chargement…</div>' +
        '<div class="p-4 md:p-5 overflow-auto flex-1"><div class="overflow-x-auto rounded-2xl border dark:border-gray-700"><table class="w-full">' +
          '<thead><tr class="bg-gray-100 dark:bg-gray-700 text-[11px] font-black uppercase text-gray-600 dark:text-gray-200"><th class="p-3 text-left">Date</th><th class="p-3 text-left">Utilisateur</th><th class="p-3 text-left">Catégorie</th><th class="p-3 text-left">Action</th><th class="p-3 text-left">Détails</th></tr></thead>' +
          '<tbody id="auditBody" class="divide-y dark:divide-gray-700"></tbody></table></div>' +
          '<p class="text-[11px] text-gray-400 mt-3">Le journal synchronisé garde les 500 dernières lignes ; l\'archive de cet appareil conserve tout ce qui a été vu ici.</p></div></div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    archivePut(appState.activityLog || []).then(archiveAll).then(function (arch) {
      var map = {};
      arch.concat(appState.activityLog || []).forEach(function (e) { if (e && e.id) map[e.id] = e; });
      _all = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      var actors = {}; _all.forEach(function (e) { if (e.actor) actors[e.actor] = 1; });
      var sel = document.getElementById('auditActor');
      if (sel) sel.innerHTML = '<option value="">Tous les utilisateurs</option>' + Object.keys(actors).sort().map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('');
      renderRows();
    });
  };

  // L'écran « Journal d'activité » existant est remplacé par la version complète (l'ancienne reste disponible)
  if (typeof window.openActivityLogModal === 'function' && !window._legacyOpenActivityLogModal) {
    window._legacyOpenActivityLogModal = window.openActivityLogModal;
    window.openActivityLogModal = function () { return window.openAuditLog(); };
  }

  installWrappers();
  // archive de départ : on sauvegarde ce qui est déjà dans le journal
  setTimeout(function () { archivePut((window.appState && appState.activityLog) || []); }, 6000);

  window.AuditCore = { audit: audit, category: category };
})();
