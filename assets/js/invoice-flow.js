// =====================================================================
//  INVOICE-FLOW.JS — envoi de la facture au client après « Sponsor Direct »
//  • Après « Sponsor Direct », une fenêtre propose d'envoyer la facture (WhatsApp / Instagram / PDF).
//  • Pour la plupart des employés l'envoi est OBLIGATOIRE : la fenêtre ne se ferme qu'une fois la
//    facture envoyée (ou déclarée envoyée autrement). Pour les employés « facture facultative »
//    (ex : Wissem) et pour l'administrateur, l'envoi est seulement proposé.
//  • Le réglage est par employé : Paramètres > employé > « Envoi de facture facultatif ».
//    Par défaut, un employé dont le nom contient « wissem » est facultatif (réglage enregistré au 1er usage).
//  • Une facture obligatoire non envoyée reste signalée (pastille rouge dans l'historique + notification)
//    jusqu'à son envoi, même si la page est fermée.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc;

  function findTx(id) {
    return (appState.transactions || []).find(function (t) { return t && t.id === id; }) ||
           (appState.todoTransactions || []).find(function (t) { return t && t.id === id; }) || null;
  }
  function empById(id) { return (appState.employees || []).find(function (e) { return e && e.id === id; }); }
  function launcherOf(tx) {
    if (tx && tx.launchedById) { var e = empById(tx.launchedById); if (e) return { id: e.id, name: e.name || e.login || 'Employé', isAdmin: false }; }
    return { id: null, name: (tx && tx.launchedByName) || 'Admin', isAdmin: !(tx && tx.launchedById) };
  }

  // Règle : facultatif pour l'administrateur et les employés marqués « facture facultative » ; obligatoire pour les autres.
  window.invoiceOptionalFor = function (launcher) {
    if (!launcher || launcher.isAdmin || !launcher.id) return true;
    var emp = empById(launcher.id);
    if (!emp) return false;
    var perm = emp.permissions && emp.permissions.invoiceOptional;
    if (perm === undefined && /wissem/i.test((emp.name || '') + ' ' + (emp.login || ''))) {
      if (!emp.permissions || typeof emp.permissions !== 'object') emp.permissions = {};
      emp.permissions.invoiceOptional = true; emp.updatedAt = Date.now();
      X.log('Envoi de facture facultatif (réglage par défaut)', emp.name || emp.login); X.save();
      perm = true;
    }
    return perm === true;
  };

  // ------------------------------------------------------------------ suivi des envois
  function stampNumber(tx) {
    try { if (tx && !tx.invoiceNo && typeof buildInvoiceHtml === 'function') { var r = buildInvoiceHtml(tx); if (r && r.invNumber) tx.invoiceNo = r.invNumber; } } catch (e) {}
  }
  var _cur = null;      // { id, required }

  window.markInvoiceSent = function (txId, via) {
    var tx = findTx(txId); if (!tx) return;
    if (!tx.invoiceSentAt) { tx.invoiceSentAt = Date.now(); tx.invoiceSentVia = via || ''; tx.invoiceSentBy = X.actor(); }
    tx.invoiceSkipped = false; stampNumber(tx); tx.updatedAt = Date.now();
    X.save(); refresh();
    if (typeof window.NotificationsRefresh === 'function') window.NotificationsRefresh();
  };

  function pending() {
    var s = appState.session, mine = s && s.type === 'employee' ? s.employeeId : null;
    return (appState.transactions || []).filter(function (t) {
      return t && t.invoiceRequired === true && !t.invoiceSentAt && (!mine || t.launchedById === mine);
    });
  }

  // ------------------------------------------------------------------ fenêtre d'envoi
  var VIA = { whatsapp: 'WhatsApp', instagram: 'Instagram', pdf: 'PDF partagé', manuel: 'envoyée autrement' };
  function refresh() {
    var el = document.getElementById('invoiceSendDialog'); if (!el || !_cur) return;
    var tx = findTx(_cur.id); if (!tx) return;
    var sent = !!tx.invoiceSentAt, st = el.querySelector('#ifStatus'), done = el.querySelector('#ifDone');
    if (st) { st.className = 'text-sm font-bold rounded-xl p-3 ' + (sent ? 'bg-green-50 text-green-700 border border-green-200' : 'hidden'); st.textContent = sent ? ('Facture envoyée ✓ (' + (VIA[tx.invoiceSentVia] || tx.invoiceSentVia || '') + ')') : ''; }
    if (done) { done.disabled = !sent; done.className = 'flex-1 px-4 py-3 rounded-xl font-bold ' + (sent ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'); }
  }
  function closeDialog() { var el = document.getElementById('invoiceSendDialog'); if (el) el.remove(); _cur = null; }

  window.promptInvoiceSend = function (txId, launcher) {
    var tx = findTx(txId); if (!tx) return;
    launcher = launcher || launcherOf(tx);
    var optional = invoiceOptionalFor(launcher), required = !optional;
    tx.invoiceRequired = required; stampNumber(tx); X.save();
    closeDialog(); _cur = { id: txId, required: required };
    var client = (appState.clients || []).find(function (c) { return c.id === tx.clientId; }) || {};
    var inp = 'w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm';
    var el = document.createElement('div'); el.id = 'invoiceSendDialog';
    el.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-3'; el.style.zIndex = '40';
    el.innerHTML =
      '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg border dark:border-gray-700 flex flex-col" style="max-height:94vh">' +
        '<div class="p-5 border-b dark:border-gray-700"><h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-file-invoice text-blue-600 mr-2"></i>Facture du client</h3>' +
        '<p class="text-sm text-gray-500 mt-1"><b>' + E(tx.clientName) + '</b> — ' + E(tx.offerName) + ' — ' + E(typeof formatCurrency === 'function' ? formatCurrency(tx.priceDzd) : tx.priceDzd) + ' <span class="text-xs text-gray-400">· n° ' + E(tx.invoiceNo || '') + '</span></p></div>' +
        '<div class="p-5 overflow-y-auto space-y-4">' +
          (required
            ? '<div class="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold"><i class="fas fa-triangle-exclamation mr-2"></i>Facture obligatoire : envoyez-la au client pour continuer (' + E(launcher.name) + ').</div>'
            : '<div class="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-bold"><i class="fas fa-circle-info mr-2"></i>Envoi facultatif pour ' + E(launcher.name) + ' : vous pouvez envoyer la facture ou non.</div>') +
          '<div class="grid grid-cols-1 gap-2"><div><label class="block text-xs font-bold text-gray-500 mb-1">Numéro WhatsApp du client</label><input id="ifPhone" value="' + E(client.phone || client.contact || '') + '" placeholder="0555 12 34 56" class="' + inp + '"></div>' +
          '<div><label class="block text-xs font-bold text-gray-500 mb-1">Lien de la discussion Instagram <span class="font-normal text-gray-400">(enregistré une seule fois)</span></label><input id="ifDm" value="' + E(client.instagramDm || '') + '" placeholder="https://www.instagram.com/direct/t/102963774431486/" class="' + inp + '"><p class="text-[11px] text-gray-400 mt-1">Ouvrez la discussion avec le client sur Instagram et copiez l\'adresse de la barre du navigateur.</p></div></div>' +
          '<div class="grid grid-cols-2 gap-2">' +
            '<button type="button" onclick="invoiceFlowSend(\'whatsapp\')" class="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm"><i class="fab fa-whatsapp mr-1"></i> WhatsApp</button>' +
            '<button type="button" onclick="invoiceFlowSend(\'instagram\')" class="px-4 py-3 text-white rounded-xl font-bold text-sm hover:opacity-90" style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888)"><i class="fab fa-instagram mr-1"></i> Instagram</button>' +
            '<button type="button" onclick="invoiceFlowSend(\'pdf\')" class="px-4 py-3 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-sm"><i class="fas fa-share-nodes mr-1"></i> Envoyer le PDF</button>' +
            '<button type="button" onclick="invoiceFlowPreview()" class="px-4 py-3 border dark:border-gray-600 rounded-xl font-bold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"><i class="fas fa-eye mr-1"></i> Aperçu / PDF</button></div>' +
          '<div id="ifStatus" class="hidden"></div></div>' +
        '<div class="flex gap-3 p-5 border-t dark:border-gray-700">' +
          (required
            ? '<button type="button" onclick="invoiceFlowManual()" class="flex-1 px-4 py-3 rounded-xl font-bold text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border dark:border-gray-600">Déjà envoyée autrement</button>'
            : '<button type="button" onclick="invoiceFlowSkip()" class="flex-1 px-4 py-3 rounded-xl font-bold text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border dark:border-gray-600">Ne pas envoyer</button>') +
          '<button type="button" id="ifDone" onclick="invoiceFlowDone()" disabled class="flex-1 px-4 py-3 rounded-xl font-bold bg-gray-200 text-gray-400 cursor-not-allowed">Terminer</button></div></div>';
    document.body.appendChild(el);
    refresh();
  };

  // Enregistre les coordonnées saisies dans la fenêtre sur la fiche du client
  function applyContact() {
    var tx = _cur && findTx(_cur.id); if (!tx) return false;
    var client = (appState.clients || []).find(function (c) { return c.id === tx.clientId; });
    var phone = (document.getElementById('ifPhone') || {}).value, dmRaw = ((document.getElementById('ifDm') || {}).value || '').trim();
    if (dmRaw) {
      var dm = (typeof normalizeInstagramThread === 'function') ? normalizeInstagramThread(dmRaw) : '';
      if (!dm) { X.toast('Lien Instagram invalide : il doit ressembler à https://www.instagram.com/direct/t/102963774431486/', 'error'); return false; }
      if (client && client.instagramDm !== dm) { client.instagramDm = dm; client.updatedAt = Date.now(); }
    }
    if (client && phone && phone.trim() && phone.trim() !== (client.phone || '')) { client.phone = phone.trim(); if (!client.contact) client.contact = phone.trim(); client.updatedAt = Date.now(); }
    X.save();
    return true;
  }
  window.invoiceFlowSend = function (kind) {
    if (!_cur || !applyContact()) return;
    window._invoicePreviewTxId = _cur.id;
    if (kind === 'whatsapp') sendInvoiceWhatsApp();
    else if (kind === 'instagram') sendInvoiceInstagram({ noAsk: true });
    else if (kind === 'pdf') shareInvoicePdf();
  };
  window.invoiceFlowPreview = function () { if (_cur) generateInvoicePdf(_cur.id); };
  window.invoiceFlowManual = function () {
    if (!_cur) return;
    if (!confirm('Confirmez-vous avoir déjà envoyé cette facture au client (par un autre moyen) ?')) return;
    X.log('Facture déclarée envoyée autrement', ((findTx(_cur.id) || {}).clientName || '') + ' — ' + X.actor());
    markInvoiceSent(_cur.id, 'manuel');
  };
  window.invoiceFlowSkip = function () {
    if (!_cur) return; var tx = findTx(_cur.id);
    if (tx) { tx.invoiceSkipped = true; tx.invoiceSkippedAt = Date.now(); tx.updatedAt = Date.now(); X.save(); X.log('Facture non envoyée (facultative)', (tx.clientName || '') + ' — ' + (tx.invoiceNo || '')); }
    closeDialog();
  };
  window.invoiceFlowDone = function () { if (!_cur) return; var tx = findTx(_cur.id); if (tx && tx.invoiceSentAt) closeDialog(); };

  // ------------------------------------------------------------------ factures obligatoires en attente
  window.openPendingInvoices = function () {
    var list = pending(); var old = document.getElementById('pendingInvoicesDialog'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'pendingInvoicesDialog'; el.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-3'; el.style.zIndex = '45';
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-xl border dark:border-gray-700 flex flex-col" style="max-height:90vh"><div class="flex items-center justify-between p-5 border-b dark:border-gray-700"><h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-file-invoice text-red-500 mr-2"></i>Factures à envoyer (' + list.length + ')</h3><button onclick="document.getElementById(\'pendingInvoicesDialog\').remove()" class="text-3xl text-gray-400 hover:text-gray-600 leading-none">×</button></div><div class="p-5 overflow-y-auto space-y-2">' +
      (list.length ? list.map(function (t) {
        return '<div class="flex items-center justify-between gap-3 p-3 rounded-2xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900"><div class="min-w-0"><div class="font-bold text-gray-800 dark:text-white truncate">' + E(t.clientName) + '</div><div class="text-xs text-gray-500">' + E(t.offerName) + ' · ' + E(typeof formatCurrency === 'function' ? formatCurrency(t.priceDzd) : t.priceDzd) + ' · ' + E(t.launchedByName || 'Admin') + '</div></div><button onclick="document.getElementById(\'pendingInvoicesDialog\').remove();promptInvoiceSend(\'' + X.js(t.id) + '\')" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs whitespace-nowrap">Envoyer</button></div>';
      }).join('') : '<p class="text-center text-green-600 font-bold py-8"><i class="fas fa-circle-check mr-2"></i>Toutes les factures obligatoires sont envoyées.</p>') + '</div></div>';
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); }); document.body.appendChild(el);
  };

  // Pastille rouge sur le bouton facture des lignes d'historique dont l'envoi est obligatoire et non fait
  X.wrap('renderTransactionsTable', null, function (container) {
    try {
      var ids = {}; pending().forEach(function (t) { ids[t.id] = true; });
      (container || document).querySelectorAll('button[onclick^="generateInvoicePdf("]').forEach(function (b) {
        var m = String(b.getAttribute('onclick')).match(/generateInvoicePdf\('([^']+)'\)/);
        if (!m || !ids[m[1]] || b.querySelector('.inv-dot')) return;
        b.title = 'Facture obligatoire non envoyée'; b.style.position = 'relative';
        var d = document.createElement('span'); d.className = 'inv-dot'; d.style.cssText = 'position:absolute;top:-2px;right:-2px;width:9px;height:9px;border-radius:50%;background:#ef4444;border:2px solid #fff';
        b.appendChild(d);
      });
    } catch (e) {}
  });

  window.InvoiceFlow = { pending: pending, optionalFor: window.invoiceOptionalFor, launcherOf: launcherOf };
})();
