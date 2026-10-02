// =====================================================================
//  EXT.JS — socle commun des modules ajoutés (comptabilité, pilotage, CRM, notifications)
//  - ExtStore : stockage des nouvelles données dans appState.globalConfig.ext
//    (déjà synchronisé dans le cloud par l'application : AUCUNE nouvelle collection Firestore).
//  - Ajout d'onglets / entrées de menu sans modifier le HTML ni showTab/renderCurrentTab existants.
//  - Visionneuse de documents A4 (aperçu, impression, PDF) réutilisable.
//  - Correctif : les absences n'étaient pas sauvegardées dans le cloud → persistées via ExtStore.
//  - Paramètres de performance (taux par tâche, barème des primes) modifiables.
//  - Profil entreprise + numérotation séquentielle des factures (optionnelle).
//  Rien d'existant n'est supprimé : les fonctions existantes sont seulement "enveloppées".
// =====================================================================
(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  var X = {};
  X.esc = function (v) { return window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  X.js = function (v) { return window.escapeJsAttr ? window.escapeJsAttr(v) : String(v == null ? '' : v).replace(/[^\w\- ]/g, ''); };
  X.nf = function (n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f/g, '\u00a0'); };
  X.fmt = function (n) { return X.nf(n) + '\u00a0DA'; };
  X.usd = function (n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f/g, '\u00a0') + '\u00a0$'; };
  X.isYmd = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); };
  X.fmtDate = function (s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s ? String(s) : '—'); };
  X.fmtTs = function (ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString('fr-FR', { timeZone: 'Africa/Algiers' }); } catch (e) { return '—'; } };
  X.now = function () { return (typeof getAlgeriaNow === 'function') ? getAlgeriaNow() : new Date(); };
  X.ymdOf = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  X.today = function () { return X.ymdOf(X.now()); };
  X.month = function () { return X.today().slice(0, 7); };
  X.addDays = function (ymd, n) { var d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return X.ymdOf(d); };
  X.daysBetween = function (a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); };
  X.shiftMonth = function (ym, delta) { var m = String(ym).match(/^(\d{4})-(\d{2})$/); var d = m ? new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1) : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  X.monthLabel = function (ym) { var m = String(ym || '').match(/^(\d{4})-(\d{2})$/); if (!m) return String(ym || ''); var s = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  X.monthRange = function (ym) { var m = String(ym).match(/^(\d{4})-(\d{2})$/); var last = new Date(Number(m[1]), Number(m[2]), 0).getDate(); return { from: ym + '-01', to: ym + '-' + String(last).padStart(2, '0') }; };
  X.toast = function (m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  X.save = function () { if (typeof autoSave === 'function') autoSave(); };
  X.log = function (a, d) { if (typeof logActivity === 'function') { try { logActivity(a, d); } catch (e) {} } };
  X.isAdmin = function () { try { return typeof getUserRole === 'function' && getUserRole() === 'admin'; } catch (e) { return false; } };
  X.actor = function () {
    var s = window.appState && appState.session;
    if (s && s.type === 'employee') return s.name || s.login || 'Employé';
    try { if (window.auth && auth.currentUser && auth.currentUser.email) return auth.currentUser.email; } catch (e) {}
    return 'Admin';
  };
  X.find = function (arr, id) { return (arr || []).find(function (x) { return x && x.id === id; }); };
  X.uid = function (p) { return (typeof generateId === 'function') ? generateId(p || 'x') : (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  X.clientName = function (id) { var c = X.find(appState.clients, id); return c ? (c.name || 'Client') : 'Client supprimé'; };
  X.txRate = function (t) { return (typeof getTransactionBuyRate === 'function') ? getTransactionBuyRate(t) : (typeof getBuyRate === 'function' ? getBuyRate() : 255); };
  X.txCost = function (t) { return (Number(t && t.amount) || 0) * X.txRate(t); };
  X.valid = function (t) { return t && t.status !== 'problem'; };

  // ------------------------------------------------------------------ ExtStore
  var ExtStore = {
    root: function () {
      if (!window.appState) return {};
      if (!appState.globalConfig || typeof appState.globalConfig !== 'object') appState.globalConfig = {};
      if (!appState.globalConfig.ext || typeof appState.globalConfig.ext !== 'object') appState.globalConfig.ext = {};
      return appState.globalConfig.ext;
    },
    get: function (key, def) { var r = ExtStore.root(); return (r[key] === undefined || r[key] === null) ? def : r[key]; },
    set: function (key, val, noSave) { ExtStore.root()[key] = val; if (!noSave) X.save(); return val; },
    list: function (key) { var r = ExtStore.root(); if (!Array.isArray(r[key])) r[key] = []; return r[key]; },
    map: function (key) { var r = ExtStore.root(); if (!r[key] || typeof r[key] !== 'object' || Array.isArray(r[key])) r[key] = {}; return r[key]; }
  };
  X.store = ExtStore;

  // ------------------------------------------------------------------ absences : persistance (correctif)
  var _absDirty = false;
  function mirrorAbsences() {
    if (!window.appState) return;
    if (_absDirty || ExtStore.get('absences', null) === null) {
      ExtStore.root().absences = JSON.parse(JSON.stringify(Array.isArray(appState.absences) ? appState.absences : []));
      _absDirty = false;
    }
  }
  function restoreAbsences() {
    var a = ExtStore.get('absences', null);
    if (Array.isArray(a) && !_absDirty) appState.absences = JSON.parse(JSON.stringify(a));
  }
  function wrapFn(name, pre, post) {
    var orig = window[name];
    // Les enveloppes se CHAÎNENT (chacune appelle la précédente) : plusieurs modules peuvent protéger/tracer la même fonction.
    if (typeof orig !== 'function') return false;
    var fn = function () {
      if (pre) { var stop = pre.apply(this, arguments); if (stop === false) return; }
      var r = orig.apply(this, arguments);
      if (post) { try { post.apply(this, arguments); } catch (e) {} }
      return r;
    };
    fn._extWrapped = true; fn._orig = orig;
    window[name] = fn;
    return true;
  }
  X.wrap = wrapFn;
  ['markAbsent', 'removeAbsence', 'deleteAbsence'].forEach(function (n) { wrapFn(n, function () { _absDirty = true; }); });
  wrapFn('saveToCloud', function () { try { mirrorAbsences(); } catch (e) {} });
  wrapFn('normalizeAppState', null, function () { try { restoreAbsences(); } catch (e) {} });

  // ------------------------------------------------------------------ paramètres de performance
  var DEFAULT_SCALE = [{ min: 350000, bonus: 12000 }, { min: 250000, bonus: 8000 }, { min: 150000, bonus: 5000 }];
  window.getPerformanceConfig = function () {
    var base = (window.appState && appState.performanceConfig) || { ratePerTask: 1700, fixedCosts: { salary: 40000, internet: 3000, pub: 20000, risque: 15000 } };
    var ov = ExtStore.get('perf', {}) || {};
    var out = Object.assign({}, base);
    if (Number(ov.ratePerTask) > 0) out.ratePerTask = Number(ov.ratePerTask);
    out.primeScale = (Array.isArray(ov.primeScale) && ov.primeScale.length) ? ov.primeScale : DEFAULT_SCALE;
    return out;
  };
  window.getPrimeForGain = function (gain) {
    var scale = (getPerformanceConfig().primeScale || DEFAULT_SCALE).slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < scale.length; i++) if (gain >= Number(scale[i].min)) return Number(scale[i].bonus) || 0;
    return 0;
  };

  // ------------------------------------------------------------------ profil entreprise
  var PROFILE_DEFAULT = {
    name: 'Hichem Sponsor', tagline: 'Agence de Marketing Digital', email: 'contact.hichemsps@gmail.com',
    address1: 'Ouled Fayet, Cité Verte', address2: 'Alger, Algérie', phone: '',
    nif: '', rc: '', nis: '', ai: '', legalNote: '', showPayment: false, paymentNote: '',
    invoiceNumbering: 'legacy'
  };
  window.getCompanyProfile = function () { return Object.assign({}, PROFILE_DEFAULT, ExtStore.get('profile', {}) || {}); };

  // Numérotation : 'legacy' (par défaut, inchangée) ou 'sequential' (FAC-AAAA-0001, figée sur la vente)
  window.getInvoiceNumber = function (tx, legacyNumber) {
    try {
      var P = getCompanyProfile();
      if (P.invoiceNumbering !== 'sequential' || !tx) return legacyNumber;
      if (tx.invoiceNo) return tx.invoiceNo;
      var year = String(tx.date || X.today()).slice(0, 4), prefix = 'FAC-' + year + '-', max = 0;
      (appState.transactions || []).forEach(function (t) {
        if (t && t.invoiceNo && String(t.invoiceNo).indexOf(prefix) === 0) { var n = parseInt(String(t.invoiceNo).slice(prefix.length), 10); if (n > max) max = n; }
      });
      tx.invoiceNo = prefix + String(max + 1).padStart(4, '0');
      tx.invoiceIssuedAt = Date.now();
      tx.updatedAt = Date.now();
      X.save();
      return tx.invoiceNo;
    } catch (e) { return legacyNumber; }
  };

  // ------------------------------------------------------------------ onglets & menu
  var TABS = {};
  X.registerTab = function (id, def) { TABS[id] = def; };
  X.tabs = TABS;

  function ensureGroup(groupName, label, icon) {
    var nav = document.querySelector('#appSidebar .sidebar-nav');
    if (!nav) return null;
    var g = nav.querySelector('.nav-group[data-group="' + groupName + '"]');
    if (g) return g.querySelector('.nav-group-panel-inner');
    g = document.createElement('div');
    g.className = 'nav-group'; g.setAttribute('data-group', groupName);
    g.innerHTML =
      '<button type="button" class="nav-group-toggle" onclick="toggleNavGroup(\'' + groupName + '\')" aria-expanded="false">' +
        '<span class="nav-group-toggle-icon"><i class="fas ' + icon + '"></i></span>' +
        '<span class="nav-group-toggle-label">' + X.esc(label) + '</span><i class="fas fa-chevron-down nav-group-chevron"></i></button>' +
      '<div class="nav-group-panel" id="navGroupPanel-' + groupName + '"><div class="nav-group-panel-inner"></div></div>';
    var systeme = nav.querySelector('.nav-group[data-group="systeme"]');
    if (systeme) nav.insertBefore(g, systeme); else nav.appendChild(g);
    return g.querySelector('.nav-group-panel-inner');
  }
  X.addNavItem = function (groupName, groupLabel, groupIcon, tabId, label, icon) {
    var inner = ensureGroup(groupName, groupLabel, groupIcon);
    if (!inner || document.querySelector('button[onclick="showTab(\'' + tabId + '\')"]')) return;
    var b = document.createElement('button');
    b.id = 'tabBtn-' + tabId;
    b.setAttribute('onclick', "showTab('" + tabId + "')");
    b.className = 'tab-btn nav-item bg-gray-100 text-gray-700 font-bold';
    b.innerHTML = '<i class="fas ' + icon + ' nav-item-icon"></i><span>' + X.esc(label) + '</span>';
    inner.appendChild(b);
  };
  function installTabs() {
    Object.keys(TABS).forEach(function (id) {
      var t = TABS[id];
      if (t.nav) X.addNavItem(t.nav.group, t.nav.groupLabel, t.nav.groupIcon, id, t.nav.label, t.nav.icon);
    });
    if (typeof updateNavButtonsVisibility === 'function') { try { updateNavButtonsVisibility(); } catch (e) {} }
  }
  X.installTabs = installTabs;
  X.rerender = function () { if (typeof renderCurrentTab === 'function') renderCurrentTab(); };

  // renderCurrentTab : l'original s'exécute puis on dessine nos onglets (ne gère que SES onglets)
  (function hookRender() {
    var orig = window.renderCurrentTab;
    if (typeof orig !== 'function' || orig._extWrapped) return;
    var fn = function () {
      var r = orig.apply(this, arguments);
      try {
        var tab = window.appState && appState.currentTab;
        var def = TABS[tab];
        var c = document.getElementById('tabContentContainer');
        if (def && c) {
          c.innerHTML = '';
          if (typeof hasTabAccess === 'function' && !hasTabAccess(tab)) c.innerHTML = '<p class="text-center py-8 text-gray-500">Accès refusé</p>';
          else def.render(c);
        }
        document.dispatchEvent(new CustomEvent('ext:rendered', { detail: { tab: tab } }));
      } catch (e) { console.error('Erreur onglet', e); }
      return r;
    };
    fn._extWrapped = true;
    window.renderCurrentTab = fn;
  })();

  // ------------------------------------------------------------------ pastilles + cartes
  X.pills = function (items, current, fnName) {
    return '<div class="flex flex-wrap gap-2 mb-6">' + items.map(function (it) {
      var on = it[0] === current;
      return '<button onclick="' + fnName + '(\'' + X.js(it[0]) + '\')" class="px-4 py-2 rounded-xl text-sm font-bold transition-all ' +
        (on ? 'bg-indigo-600 text-white shadow' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700') + '">' +
        (it[2] ? '<i class="fas ' + it[2] + ' mr-2"></i>' : '') + X.esc(it[1]) + '</button>';
    }).join('') + '</div>';
  };
  X.card = function (title, icon, body, right) {
    return '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-6 border dark:border-gray-700 mb-6 fade-in">' +
      '<div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h3 class="text-xl font-bold text-gray-800 dark:text-white">' +
      (icon ? '<i class="fas ' + icon + ' text-indigo-600 mr-2"></i>' : '') + X.esc(title) + '</h3>' + (right || '') + '</div>' + body + '</div>';
  };
  X.kpi = function (label, value, cls, icon) {
    return '<div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4 border dark:border-gray-700"><p class="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">' +
      (icon ? '<i class="fas ' + icon + ' mr-1"></i>' : '') + X.esc(label) + '</p><p class="text-xl font-black ' + (cls || 'text-gray-800 dark:text-white') + '">' + value + '</p></div>';
  };
  X.table = function (heads, rowsHtml, opts) {
    opts = opts || {};
    return '<div class="overflow-x-auto rounded-2xl border dark:border-gray-700"><table class="w-full text-sm"><thead><tr class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-[11px] font-black uppercase">' +
      heads.map(function (h) { var al = h[1] === 'r' ? 'text-right' : (h[1] === 'c' ? 'text-center' : 'text-left'); return '<th class="p-3 ' + al + '">' + X.esc(h[0]) + '</th>'; }).join('') +
      '</tr></thead><tbody class="divide-y dark:divide-gray-700">' + (rowsHtml || '<tr><td colspan="' + heads.length + '" class="p-8 text-center text-gray-400 italic">' + X.esc(opts.empty || 'Aucune donnée') + '</td></tr>') + '</tbody>' + (opts.foot || '') + '</table></div>';
  };
  X.input = 'p-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm';
  X.btn = function (label, onclick, cls, icon) {
    return '<button onclick="' + onclick + '" class="px-3 py-2 rounded-xl font-bold text-sm ' + (cls || 'bg-indigo-600 hover:bg-indigo-700 text-white shadow') + '">' + (icon ? '<i class="fas ' + icon + ' mr-1"></i>' : '') + X.esc(label) + '</button>';
  };

  // ------------------------------------------------------------------ CSV
  X.csv = function (rows, filename) {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var blob = new Blob(['\uFEFF' + rows.map(function (r) { return r.map(q).join(';'); }).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    X.toast('Export CSV réussi', 'success');
  };

  // ------------------------------------------------------------------ visionneuse de documents A4
  var NAVY = '#0f2a52', BLUE = '#1d6fe8', SOFT = '#eef4fd', LINE = '#dbe5f3';
  X.C = { NAVY: NAVY, BLUE: BLUE, SOFT: SOFT, LINE: LINE };
  X.docHeader = function (title, subtitle) {
    var P = getCompanyProfile(), icon = window.INVOICE_LOGO_ICON || '', parts = String(P.name || '').split(' ');
    var first = X.esc(parts.shift() || ''), rest = X.esc(parts.join(' '));
    return '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div style="display:flex;align-items:center;gap:12px">' + (icon ? '<img src="' + icon + '" alt="" style="height:46px;width:auto">' : '') +
      '<div><div style="font-size:24px;font-weight:800;letter-spacing:-1px;line-height:1"><span style="color:' + NAVY + '">' + first + '</span> <span style="color:' + BLUE + '">' + rest + '</span></div>' +
      '<div style="font-size:9.5px;letter-spacing:2.6px;color:#4b5b75;margin-top:6px;font-weight:600">' + X.esc(String(P.tagline || '').toUpperCase()) + '</div></div></div>' +
      '<div style="text-align:right"><div style="font-size:24px;font-weight:900;color:' + NAVY + '">' + X.esc(title) + '</div>' +
      (subtitle ? '<div style="font-size:11px;color:#8a97ab;margin-top:3px">' + X.esc(subtitle) + '</div>' : '') + '</div></div>' +
      '<div style="height:1px;background:' + LINE + ';margin:14px 0"></div>';
  };
  X.docFooter = function () {
    var P = getCompanyProfile();
    var bits = [P.address1, P.address2, P.email, P.phone].filter(Boolean).map(X.esc).join(' · ');
    var legal = [P.nif && ('NIF : ' + P.nif), P.rc && ('RC : ' + P.rc), P.nis && ('NIS : ' + P.nis), P.ai && ('AI : ' + P.ai)].filter(Boolean).map(X.esc).join(' · ');
    return '<div style="margin-top:22px;padding-top:10px;border-top:1px solid ' + LINE + ';font-size:10px;color:#6b7a90;text-align:center;line-height:1.6">' + bits + (legal ? '<br>' + legal : '') + (P.legalNote ? '<br>' + X.esc(P.legalNote) : '') + '</div>';
  };
  X.openDoc = function (opts) {
    var modal = document.getElementById('extDocModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'extDocModal';
      modal.className = 'fixed inset-0 bg-black bg-opacity-60 hidden items-center justify-center p-2 md:p-6';
      modal.style.zIndex = '80';
      modal.innerHTML =
        '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style="height:94vh">' +
          '<div class="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4 border-b"><div class="font-black text-gray-800 flex items-center gap-2"><i class="fas fa-file-lines text-blue-600"></i><span id="extDocTitle"></span></div>' +
          '<div class="flex flex-wrap gap-2">' +
            '<button type="button" onclick="extDocDownload()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700"><i class="fas fa-download mr-1"></i>Télécharger PDF</button>' +
            '<button type="button" onclick="extDocPrint()" class="px-4 py-2 border rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-50"><i class="fas fa-print mr-1"></i>Imprimer</button>' +
            '<button type="button" onclick="extDocClose()" class="px-4 py-2 bg-gray-100 rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-200"><i class="fas fa-times mr-1"></i>Fermer</button></div></div>' +
          '<iframe id="extDocFrame" title="Aperçu" class="flex-1 w-full rounded-b-2xl" style="border:0;background:#e5e7eb"></iframe></div>';
      modal.addEventListener('click', function (e) { if (e.target === modal) window.extDocClose(); });
      document.body.appendChild(modal);
    }
    window._extDoc = opts;
    document.getElementById('extDocTitle').textContent = opts.title;
    document.getElementById('extDocFrame').srcdoc =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@page{size:A4;margin:' + (opts.fixed ? '0' : '12mm') + '}' +
      'html,body{margin:0;background:#e5e7eb}#wrap{width:794px;margin:12px auto;box-shadow:0 2px 14px rgba(0,0,0,.2);transform-origin:top left;background:#fff}tr{page-break-inside:avoid}' +
      '@media print{html,body{background:#fff}#wrap{margin:0!important;box-shadow:none;transform:none!important}}</style></head><body><div id="wrap">' + opts.inner + '</div>' +
      '<script>function fit(){var w=document.getElementById("wrap");var s=Math.min(1,(innerWidth-16)/794);w.style.transform="scale("+s+")";w.style.margin="12px "+Math.max(8,(innerWidth-794*s)/2)+"px";document.body.style.height=(w.offsetHeight*s+24)+"px"}fit();addEventListener("resize",fit);<\/script></body></html>';
    modal.classList.remove('hidden'); modal.classList.add('flex');
  };
  window.extDocClose = function () { var m = document.getElementById('extDocModal'); if (!m) return; m.classList.add('hidden'); m.classList.remove('flex'); var f = document.getElementById('extDocFrame'); if (f) f.srcdoc = ''; };
  window.extDocPrint = function () { var f = document.getElementById('extDocFrame'); if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); } };
  window.extDocDownload = function () {
    var d = window._extDoc; if (!d) return;
    if (typeof html2pdf !== 'function') return X.toast('PDF indisponible (librairie non chargée)', 'error');
    var node = document.createElement('div'); node.style.width = '794px'; node.innerHTML = d.inner;
    var opt = { margin: d.fixed ? 0 : [8, 0, 8, 0], filename: d.filename || 'document.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: d.fixed ? { mode: [] } : { mode: ['css', 'legacy'], avoid: 'tr' } };
    X.toast('Génération du PDF...', 'info');
    html2pdf().set(opt).from(node).toPdf().get('pdf').then(function (pdf) { if (d.fixed) { while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages()); } }).save()
      .then(function () { X.toast('PDF téléchargé', 'success'); }).catch(function (e) { console.error(e); X.toast('Erreur lors de la génération', 'error'); });
  };

  // ------------------------------------------------------------------ WhatsApp
  X.waLink = function (phone, text) {
    var n = (typeof normalizePhoneForWhatsApp === 'function') ? normalizePhoneForWhatsApp(phone) : String(phone || '').replace(/\D/g, '');
    if (!n) return '';
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || '');
  };
  X.openUrl = function (u) { if (!u) return X.toast('Numéro WhatsApp manquant pour ce client', 'warning'); try { window.open(u, '_blank', 'noopener'); } catch (e) {} };

  // ------------------------------------------------------------------ méta clients (CRM / dettes)
  X.meta = function (clientId) { return ExtStore.map('clientMeta')[clientId] || {}; };
  X.setMeta = function (clientId, patch) {
    var m = ExtStore.map('clientMeta');
    m[clientId] = Object.assign({}, m[clientId] || {}, patch, { updatedAt: Date.now() });
    X.save();
  };

  window.Ext = X;
  window.ExtStore = ExtStore;

  // installation différée : le DOM complet de la sidebar doit exister
  function boot() { installTabs(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  window.addEventListener('load', function () { setTimeout(installTabs, 400); });
})();
