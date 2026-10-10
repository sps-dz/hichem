// =====================================================================
//  INSTAGRAM-LINKS.JS — lien de discussion Instagram « par défaut » pour chaque client
//  Instagram ne permet pas de deviner l'identifiant d'une discussion à partir du pseudo.
//  Ce module le capture UNE SEULE FOIS par client, puis il est utilisé automatiquement pour les factures :
//   1) Marque-page « Lier à Sponsor » : depuis une discussion Instagram (PC), 1 clic ouvre l'app,
//      choisit le client et enregistre le lien.
//   2) CRM › « Liens Instagram » : tableau de tous les clients (lien manquant / lié), bouton « Coller »,
//      import en masse.
//   3) Bouton « Coller » dans la fenêtre d'envoi de facture.
//  Ajout non destructif : stocke dans client.instagramDm (champ déjà utilisé par l'envoi de facture).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc;
  var st = { filter: 'missing', q: '', importOpen: false, importRows: null };

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function handleOf(c) { return typeof getInstagramHandle === 'function' ? getInstagramHandle(c) : String((c && c.instagram) || '').replace(/^@+/, ''); }
  function threadOf(v) { return typeof normalizeInstagramThread === 'function' ? normalizeInstagramThread(v) : ''; }
  function clients() { return (window.appState && appState.clients) || []; }
  function byId(id) { return clients().filter(function (c) { return c.id === id; })[0]; }
  function readOnly() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function appUrl() { return location.origin + location.pathname; }

  // ---- rapprochement nom / pseudo → clients ----
  function matchClients(label) {
    var q = norm(label), qh = String(label || '').toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._]/g, '');
    if (!q) return [];
    var qt = q.split(' ').filter(function (t) { return t.length > 1; });
    return clients().map(function (c) {
      var n = norm(c.name), h = handleOf(c).toLowerCase(), s = 0;
      if (n && n === q) s = 4;
      else if (h && qh && h === qh) s = 4;
      else if (n.length >= 3 && (n.indexOf(q) !== -1 || q.indexOf(n) !== -1)) s = 3;
      else if (h && qh.length >= 3 && (h.indexOf(qh) !== -1 || qh.indexOf(h) !== -1)) s = 2;
      else { var nt = n.split(' '); var common = qt.filter(function (t) { return nt.indexOf(t) !== -1; }).length; if (common) s = 1 + common / 10; }
      return { c: c, s: s };
    }).filter(function (m) { return m.s > 0; }).sort(function (a, b) { return b.s - a.s; });
  }

  // ---- enregistrement ----
  function saveLink(clientId, link, silent) {
    var c = byId(clientId), dm = threadOf(link);
    if (!c) return false;
    if (!dm) { if (!silent) X.toast('Lien invalide : il doit ressembler à https://www.instagram.com/direct/t/102963774431486/', 'error'); return false; }
    if (readOnly()) { X.toast('Mode lecture seule : modification impossible', 'warning'); return false; }
    var had = threadOf(c.instagramDm);
    c.instagramDm = dm; c.updatedAt = Date.now();
    X.log(had ? 'Lien Instagram modifié' : 'Lien Instagram enregistré', c.name + ' → ' + dm);
    X.save();
    return true;
  }

  // ---- presse-papiers ----
  window.igPasteInto = function (inputId, then) {
    var el = document.getElementById(inputId);
    if (!el) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) { X.toast('Collage automatique indisponible : utilisez Ctrl+V dans le champ', 'warning'); el.focus(); return; }
    navigator.clipboard.readText().then(function (t) {
      var dm = threadOf(t);
      if (!dm) { X.toast('Le presse-papiers ne contient pas de lien de discussion Instagram (copiez l\'adresse de la discussion)', 'warning'); return; }
      el.value = dm; if (then) then(dm);
    }, function () { X.toast('Autorisez l\'accès au presse-papiers ou collez avec Ctrl+V', 'warning'); el.focus(); });
  };

  // ---- marque-page (bookmarklet) ----
  function bookmarklet() {
    var js = "(function(){var m=location.pathname.match(/\\/direct\\/t\\/(\\d+)/);if(!m){alert('Ouvrez d\\'abord une discussion Instagram (adresse /direct/t/...)');return;}" +
      "var h=document.querySelector('main header h1,main header h2,main header span[dir=auto],main [role=heading]');var n=(h&&h.textContent)||document.title||'';" +
      "window.open('" + appUrl() + "?igthread='+m[1]+'&igname='+encodeURIComponent(n.replace(/\\s*[•·|].*$/,'').trim()),'_blank');})();";
    return 'javascript:' + encodeURIComponent(js).replace(/'/g, '%27');
  }
  window.igCopyBookmarklet = function () {
    var raw = decodeURIComponent(bookmarklet().slice(11));
    var done = function () { X.toast('Code copié. Créez un marque-page et collez-le dans « Adresse ».', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('javascript:' + raw).then(done, function () { prompt('Copiez ce code :', 'javascript:' + raw); });
    else prompt('Copiez ce code :', 'javascript:' + raw);
  };

  // ---- réception du lien venant du marque-page ----
  (function intake() {
    try {
      var p = new URLSearchParams(location.search), id = p.get('igthread');
      if (!id || !/^\d+$/.test(id)) return;
      sessionStorage.setItem('ig_pending_thread', JSON.stringify({ link: 'https://www.instagram.com/direct/t/' + id + '/', name: p.get('igname') || '' }));
      p.delete('igthread'); p.delete('igname');
      history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p.toString() : '') + location.hash);
    } catch (e) {}
  })();
  var _tries = 0;
  function processPending() {
    var raw; try { raw = sessionStorage.getItem('ig_pending_thread'); } catch (e) {}
    if (!raw) return;
    var s = window.appState && appState.session;
    if (!s || s.type === 'client' || !clients().length) { if (++_tries < 240) return setTimeout(processPending, 1000); return; }
    try { sessionStorage.removeItem('ig_pending_thread'); } catch (e) {}
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (readOnly()) return X.toast('Mode lecture seule : impossible d\'enregistrer le lien', 'warning');
    openAssociate(d.link, d.name);
  }

  function openAssociate(link, label) {
    var old = document.getElementById('igAssociateDialog'); if (old) old.remove();
    var ms = matchClients(label), best = ms[0] && ms[0].s >= 3 ? ms[0].c : null;
    var el = document.createElement('div'); el.id = 'igAssociateDialog'; el.dataset.link = link;
    el.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-3'; el.style.zIndex = '9995';
    var opts = clients().slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }).map(function (c) {
      return '<option value="' + E(c.id) + '"' + (best && best.id === c.id ? ' selected' : '') + '>' + E(c.name) + (handleOf(c) ? ' (@' + E(handleOf(c)) + ')' : '') + (threadOf(c.instagramDm) ? ' ✓' : '') + '</option>';
    }).join('');
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border dark:border-gray-700">' +
      '<h3 class="text-lg font-bold text-gray-800 dark:text-white mb-1"><i class="fab fa-instagram text-pink-600 mr-2"></i>Lier cette discussion à un client</h3>' +
      '<p class="text-xs text-gray-500 mb-3 break-all">Discussion détectée : <b>' + E(label || 'sans nom') + '</b><br>' + E(link) + '</p>' +
      '<input id="igAssocFilter" oninput="igAssocFilter()" placeholder="Rechercher un client…" class="w-full p-3 mb-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm">' +
      '<select id="igAssocSelect" size="6" class="w-full p-2 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm mb-3">' + opts + '</select>' +
      '<div class="flex gap-2"><button type="button" onclick="igAssocSave()" class="flex-1 px-4 py-3 rounded-xl font-bold bg-pink-600 hover:bg-pink-700 text-white">Enregistrer pour ce client</button>' +
      '<button type="button" onclick="document.getElementById(\'igAssociateDialog\').remove()" class="px-4 py-3 rounded-xl text-sm text-gray-500 border dark:border-gray-600">Annuler</button></div></div>';
    document.body.appendChild(el);
    var sel = el.querySelector('#igAssocSelect'); if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = -1;
  }
  window.igAssocFilter = function () {
    var q = norm((document.getElementById('igAssocFilter') || {}).value), sel = document.getElementById('igAssocSelect'); if (!sel) return;
    var first = null;
    Array.prototype.forEach.call(sel.options, function (o) { var show = !q || norm(o.textContent).indexOf(q) !== -1; o.hidden = !show; o.disabled = !show; if (show && !first) first = o; });
    if (first) first.selected = true;
  };
  window.igAssocSave = function () {
    var el = document.getElementById('igAssociateDialog'), sel = document.getElementById('igAssocSelect');
    if (!el || !sel || !sel.value) return X.toast('Choisissez un client', 'warning');
    var c = byId(sel.value); if (!c) return;
    if (threadOf(c.instagramDm) && threadOf(c.instagramDm) !== threadOf(el.dataset.link) && !confirm('« ' + c.name + ' » a déjà un lien. Le remplacer ?')) return;
    if (saveLink(c.id, el.dataset.link)) { el.remove(); X.toast('Lien Instagram enregistré pour ' + c.name, 'success'); X.rerender(); }
  };

  // ---- tableau CRM ----
  function counts() {
    var a = clients(), linked = a.filter(function (c) { return threadOf(c.instagramDm); }).length;
    return { total: a.length, linked: linked, missing: a.length - linked, nohandle: a.filter(function (c) { return !handleOf(c) && !threadOf(c.instagramDm); }).length };
  }
  function badge(c) {
    if (threadOf(c.instagramDm)) return '<span class="px-2 py-1 rounded-lg text-[10px] font-black bg-green-100 text-green-700">LIÉ</span>';
    return handleOf(c) ? '<span class="px-2 py-1 rounded-lg text-[10px] font-black bg-amber-100 text-amber-700">À LIER</span>' : '<span class="px-2 py-1 rounded-lg text-[10px] font-black bg-gray-100 text-gray-500">SANS INSTA</span>';
  }
  function rows() {
    var q = norm(st.q);
    return clients().filter(function (c) {
      var l = !!threadOf(c.instagramDm);
      if (st.filter === 'missing' && l) return false;
      if (st.filter === 'linked' && !l) return false;
      if (st.filter === 'nohandle' && (handleOf(c) || l)) return false;
      return !q || norm(c.name + ' ' + handleOf(c)).indexOf(q) !== -1;
    }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
  }
  window.CrmIgRender = function () {
    var k = counts(), list = rows(), ro = readOnly();
    var pills = [['missing', 'À lier (' + k.missing + ')'], ['linked', 'Liés (' + k.linked + ')'], ['nohandle', 'Sans Instagram (' + k.nohandle + ')'], ['all', 'Tous (' + k.total + ')']].map(function (p) {
      return '<button type="button" onclick="igFilter(\'' + p[0] + '\')" class="px-3 py-1.5 rounded-full text-xs font-bold ' + (st.filter === p[0] ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300') + '">' + p[1] + '</button>';
    }).join(' ');
    var body = list.slice(0, 300).map(function (c) {
      var id = E(c.id), dm = threadOf(c.instagramDm);
      return '<tr class="border-b dark:border-gray-700"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(c.name) + '<div class="text-[11px] font-normal text-gray-400">' + (handleOf(c) ? '@' + E(handleOf(c)) : '—') + '</div></td>' +
        '<td class="p-3"><input id="igl-' + id + '" value="' + E(dm) + '" placeholder="https://www.instagram.com/direct/t/…" ' + (ro ? 'readonly ' : '') + 'class="w-full min-w-[230px] p-2 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white text-xs"></td>' +
        '<td class="p-3 text-center" id="igs-' + id + '">' + badge(c) + '</td>' +
        '<td class="p-3 whitespace-nowrap text-right">' +
        (ro ? '' : '<button type="button" data-id="' + id + '" onclick="igLinkPaste(this.dataset.id)" class="px-2 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 mr-1" title="Coller depuis le presse-papiers"><i class="fas fa-paste"></i></button>' +
          '<button type="button" data-id="' + id + '" onclick="igLinkSet(this.dataset.id)" class="px-2 py-1.5 rounded-lg text-xs font-bold bg-pink-600 text-white mr-1" title="Enregistrer"><i class="fas fa-check"></i></button>') +
        '<button type="button" data-id="' + id + '" onclick="igLinkOpen(this.dataset.id)" class="px-2 py-1.5 rounded-lg text-xs font-bold bg-gray-900 text-white" title="Ouvrir sur Instagram"><i class="fab fa-instagram"></i></button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Aucun client dans cette liste</td></tr>';
    var guide = X.card('Comment récupérer les liens automatiquement', 'fa-wand-magic-sparkles',
      '<ol class="text-sm text-gray-600 dark:text-gray-300 list-decimal ml-5 space-y-1 mb-3">' +
      '<li>Cliquez sur <b>« Copier le code du marque-page »</b>, puis créez un marque-page dans votre navigateur (PC) et collez le code dans son champ « Adresse / URL ».</li>' +
      '<li>Sur Instagram, ouvrez la discussion d\'un client et cliquez sur ce marque-page : l\'application s\'ouvre et propose le bon client.</li>' +
      '<li>Confirmez : le lien est enregistré une seule fois et sera utilisé automatiquement pour toutes les prochaines factures.</li></ol>' +
      '<div class="flex flex-wrap gap-2"><button type="button" onclick="igCopyBookmarklet()" class="px-3 py-2 rounded-xl font-bold text-sm bg-pink-600 hover:bg-pink-700 text-white"><i class="fas fa-copy mr-1"></i>Copier le code du marque-page</button>' +
      '<a id="igBookmarklet" href="' + E(bookmarklet()) + '" onclick="return false" draggable="true" class="px-3 py-2 rounded-xl font-bold text-sm border border-dashed border-pink-400 text-pink-600 cursor-grab" title="Glissez-moi dans la barre de favoris"><i class="fas fa-link mr-1"></i>Lier à Sponsor</a>' +
      (ro ? '' : '<button type="button" onclick="igToggleImport()" class="px-3 py-2 rounded-xl font-bold text-sm border dark:border-gray-600 text-gray-700 dark:text-gray-200"><i class="fas fa-file-import mr-1"></i>Import en masse</button>') + '</div>' +
      '<p class="text-[11px] text-gray-400 mt-2">Astuce : vous pouvez glisser le bouton « Lier à Sponsor » directement dans votre barre de favoris.</p>');
    var imp = st.importOpen ? X.card('Import en masse', 'fa-file-import',
      '<p class="text-xs text-gray-500 mb-2">Une ligne par client : <b>nom ; lien</b> (ou <b>@pseudo lien</b>). Les clients sont reconnus par leur nom ou leur pseudo, vous validez avant d\'enregistrer.</p>' +
      '<textarea id="igImportText" rows="6" placeholder="Karim Benali ; https://www.instagram.com/direct/t/102963774431486/" class="w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-xs mb-2"></textarea>' +
      '<button type="button" onclick="igImportPreview()" class="px-3 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white">Analyser</button>' +
      '<div id="igImportResult" class="mt-3"></div>') : '';
    return '<div class="grid grid-cols-3 gap-3 mb-4">' + X.kpi('Clients', String(k.total), '', 'fa-users') + X.kpi('Liens enregistrés', String(k.linked), 'text-green-600', 'fa-link') + X.kpi('À lier', String(k.missing), k.missing ? 'text-amber-600' : 'text-green-600', 'fa-triangle-exclamation') + '</div>' +
      guide + imp +
      X.card('Liens de discussion Instagram', 'fa-link', '<div class="flex flex-wrap items-center gap-2 mb-3">' + pills + '<input value="' + E(st.q) + '" oninput="igSearch(this.value)" placeholder="Rechercher…" class="ml-auto p-2 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white text-xs"></div>' +
        '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-[11px] uppercase text-gray-400"><tr><th class="p-3 text-left">Client</th><th class="p-3 text-left">Lien de discussion</th><th class="p-3 text-center">Statut</th><th class="p-3"></th></tr></thead><tbody>' + body + '</tbody></table></div>' +
        (list.length > 300 ? '<p class="text-xs text-gray-400 mt-2">300 premiers résultats affichés : utilisez la recherche.</p>' : ''));
  };
  window.igFilter = function (f) { st.filter = f; X.rerender(); };
  window.igSearch = function (v) {
    st.q = v; var t = document.querySelector('#igSearchHold'); clearTimeout(window._igT);
    window._igT = setTimeout(function () { X.rerender(); var el = document.querySelector('input[oninput^="igSearch"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350);
  };
  window.igToggleImport = function () { st.importOpen = !st.importOpen; X.rerender(); };
  window.igLinkSet = function (id) {
    var inp = document.getElementById('igl-' + id), v = inp ? inp.value.trim() : '', c = byId(id); if (!c) return;
    if (!v) { if (threadOf(c.instagramDm) && confirm('Supprimer le lien enregistré pour « ' + c.name + ' » ?')) { c.instagramDm = ''; c.updatedAt = Date.now(); X.log('Lien Instagram supprimé', c.name); X.save(); var b = document.getElementById('igs-' + id); if (b) b.innerHTML = badge(c); } return; }
    if (saveLink(id, v)) { inp.value = threadOf(v); var s = document.getElementById('igs-' + id); if (s) s.innerHTML = badge(c); X.toast('Lien enregistré', 'success'); }
  };
  window.igLinkPaste = function (id) { igPasteInto('igl-' + id, function () { igLinkSet(id); }); };
  window.igLinkOpen = function (id) {
    var c = byId(id); if (!c) return;
    var u = typeof getInstagramChatUrl === 'function' ? getInstagramChatUrl(c) : '';
    if (!u) return X.toast('Aucun pseudo ni lien pour ce client', 'warning');
    window.open(u, '_blank', 'noopener');
  };

  // ---- import en masse ----
  function parseImport(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (line) {
      var m = line.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/direct\/t\/\d+\/?/i), link = m ? threadOf(m[0]) : '';
      var label = line.replace(m ? m[0] : '', '').replace(/[;,\t|]+/g, ' ').replace(/\s+/g, ' ').trim();
      var ms = link ? matchClients(label) : [];
      return { line: line, link: link, label: label, match: ms[0] && ms[0].s >= 2 ? ms[0].c : null, ok: !!(link && ms[0] && ms[0].s >= 2) };
    });
  }
  window.igImportPreview = function () {
    var rowsP = st.importRows = parseImport((document.getElementById('igImportText') || {}).value), box = document.getElementById('igImportResult');
    if (!box) return;
    if (!rowsP.length) { box.innerHTML = '<p class="text-xs text-gray-400">Rien à analyser.</p>'; return; }
    var ok = rowsP.filter(function (r) { return r.ok; }).length;
    box.innerHTML = '<div class="text-xs mb-2"><b class="text-green-600">' + ok + ' reconnu(s)</b> · <b class="text-amber-600">' + (rowsP.length - ok) + ' à vérifier (ignoré(s))</b></div>' +
      '<div class="max-h-56 overflow-y-auto border dark:border-gray-700 rounded-xl divide-y dark:divide-gray-700">' + rowsP.map(function (r) {
        return '<div class="p-2 text-xs flex items-center gap-2"><span class="' + (r.ok ? 'text-green-600' : 'text-amber-600') + '"><i class="fas ' + (r.ok ? 'fa-check' : 'fa-triangle-exclamation') + '"></i></span><span class="flex-1 truncate">' + E(r.label || '(sans nom)') + (r.match ? ' → <b>' + E(r.match.name) + '</b>' : (r.link ? ' → client introuvable' : ' → lien non reconnu')) + '</span></div>';
      }).join('') + '</div>' + (ok ? '<button type="button" onclick="igImportApply()" class="mt-3 px-3 py-2 rounded-xl font-bold text-sm bg-pink-600 text-white">Enregistrer les ' + ok + ' lien(s)</button>' : '');
  };
  window.igImportApply = function () {
    if (readOnly()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var n = 0; (st.importRows || []).forEach(function (r) {
      if (!r.ok) return; var c = r.match, had = threadOf(c.instagramDm);
      if (had && had !== r.link) return;
      if (had === r.link) return;
      c.instagramDm = r.link; c.updatedAt = Date.now(); n++;
    });
    if (n) { X.log('Import liens Instagram', n + ' lien(s)'); X.save(); }
    st.importRows = null; st.importOpen = false; X.toast(n + ' lien(s) enregistré(s)', n ? 'success' : 'warning'); X.rerender();
  };

  window.InstagramLinks = { matchClients: matchClients, saveLink: saveLink, bookmarklet: bookmarklet, openAssociate: openAssociate, parseImport: parseImport };
  setTimeout(processPending, 800);
})();
