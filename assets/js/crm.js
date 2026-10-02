// =====================================================================
//  CRM.JS — onglet « CRM » (phase 4)
//  Prospects (pipeline + sources d'acquisition) · Fiche client complète · Doublons & fusion sûre
//  Les prospects et métadonnées sont stockés dans ExtStore ; les clients restent dans la collection
//  existante. La fusion crée d'abord une sauvegarde de sécurité.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;

  function ui() { if (!appState.ui) appState.ui = {}; if (!appState.ui.crm) appState.ui.crm = {}; var u = appState.ui.crm; if (!u.sub) u.sub = 'pipeline'; return u; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  var SOURCES = ['Instagram', 'Facebook', 'WhatsApp', 'TikTok', 'Recommandation', 'Autre'];
  var STAGES = [['new', 'Nouveau', 'bg-gray-100 text-gray-700'], ['contacted', 'Contacté', 'bg-blue-100 text-blue-700'], ['quote', 'Devis envoyé', 'bg-amber-100 text-amber-700'], ['won', 'Gagné', 'bg-green-100 text-green-700'], ['lost', 'Perdu', 'bg-red-100 text-red-700']];
  function stageInfo(k) { return STAGES.filter(function (s) { return s[0] === k; })[0] || STAGES[0]; }
  function srcOpts(cur) { return '<option value="">—</option>' + SOURCES.map(function (s) { return '<option' + (s === cur ? ' selected' : '') + '>' + E(s) + '</option>'; }).join(''); }
  function clientStats(c) {
    var tx = (appState.transactions || []).filter(function (t) { return t && t.clientId === c.id && X.valid(t); }), rev = 0, cost = 0, last = '', first = '';
    tx.forEach(function (t) { rev += Number(t.priceDzd || 0); cost += X.txCost(t); if (!last || t.date > last) last = t.date; if (!first || t.date < first) first = t.date; });
    return { n: tx.length, rev: rev, margin: rev - cost, last: last, first: first, debt: Number(c.unpaid || 0) };
  }

  // =====================================================================
  //  PROSPECTS
  // =====================================================================
  function renderPipeline() {
    var list = S.list('prospects'), f = ui().stageFilter || 'open';
    var shown = list.filter(function (p) { return f === 'all' ? true : (f === 'open' ? (p.stage !== 'won' && p.stage !== 'lost') : p.stage === f); }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var today = X.today(), due = list.filter(function (p) { return p.nextFollowUp && p.nextFollowUp <= today && p.stage !== 'won' && p.stage !== 'lost'; }).length;
    var bySrc = {}; list.forEach(function (p) { var s = p.source || 'Non renseignée', r = bySrc[s] || (bySrc[s] = { n: 0, won: 0 }); r.n++; if (p.stage === 'won') r.won++; });
    var srcRows = Object.keys(bySrc).sort(function (a, b) { return bySrc[b].n - bySrc[a].n; }).map(function (s) { var r = bySrc[s]; return '<tr><td class="p-3 font-bold">' + E(s) + '</td><td class="p-3 text-right">' + r.n + '</td><td class="p-3 text-right text-green-600 font-bold">' + r.won + '</td><td class="p-3 text-right">' + (r.n ? Math.round(r.won / r.n * 100) : 0) + ' %</td></tr>'; }).join('');
    var chips = [['open', 'En cours'], ['new', 'Nouveaux'], ['contacted', 'Contactés'], ['quote', 'Devis'], ['won', 'Gagnés'], ['lost', 'Perdus'], ['all', 'Tous']].map(function (k) { return '<button onclick="crmStage(\'' + k[0] + '\')" class="px-3 py-2 rounded-xl text-xs font-bold ' + (k[0] === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200') + '">' + k[1] + '</button>'; }).join(' ');
    var rows = shown.map(function (p) {
      var id = X.js(p.id), st = stageInfo(p.stage), late = p.nextFollowUp && p.nextFollowUp <= today && p.stage !== 'won' && p.stage !== 'lost';
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(p.name) + '<div class="text-[11px] font-normal text-gray-400">' + E(p.phone || '') + (p.instagram ? ' · @' + E(p.instagram) : '') + '</div></td><td class="p-3 text-xs">' + E(p.source || '—') + '</td>' +
        '<td class="p-3 text-center"><select onchange="crmProspectStage(\'' + id + '\', this.value)" class="' + X.input + ' text-xs">' + STAGES.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === p.stage ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></td>' +
        '<td class="p-3 text-right font-mono text-xs">' + (p.value ? X.fmt(p.value) : '—') + '</td><td class="p-3 text-xs ' + (late ? 'text-red-600 font-black' : '') + '">' + (p.nextFollowUp ? X.fmtDate(p.nextFollowUp) + (late ? ' ⚠' : '') : '—') + '</td><td class="p-3 text-xs text-gray-500 max-w-[200px] truncate" title="' + E(p.notes || '') + '">' + E(p.notes || '') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button onclick="crmProspectWa(\'' + id + '\')" class="px-2 py-1 text-green-600 hover:bg-green-50 rounded-lg" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>' +
        (p.stage === 'won' && p.clientId ? '<span class="px-2 text-[10px] font-black text-green-600">Client créé</span>' : '<button onclick="crmProspectConvert(\'' + id + '\')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Convertir en client"><i class="fas fa-user-plus"></i></button>') +
        '<button onclick="crmProspectEdit(\'' + id + '\')" class="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded-lg" title="Modifier"><i class="fas fa-pen"></i></button><button onclick="crmProspectDelete(\'' + id + '\')" class="px-2 py-1 text-red-400 hover:bg-red-50 rounded-lg" title="Supprimer"><i class="fas fa-trash-alt"></i></button></td></tr>';
    }).join('');
    var i = X.input + ' w-full';
    var form = '<div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3"><input id="pr-name" class="' + i + '" placeholder="Nom / page *"><input id="pr-phone" class="' + i + '" placeholder="WhatsApp"><input id="pr-ig" class="' + i + '" placeholder="Instagram (sans @)"><select id="pr-src" class="' + i + '">' + srcOpts('') + '</select><input id="pr-value" type="number" class="' + i + '" placeholder="Valeur estimée (DA)"><input id="pr-next" type="date" class="' + i + '" title="Prochaine relance"><input id="pr-notes" class="' + i + ' md:col-span-2" placeholder="Notes"></div>' + X.btn('Ajouter le prospect', 'crmProspectAdd()', null, 'fa-plus');
    return X.card('Nouveau prospect', 'fa-user-plus', form) +
      X.card('Pipeline des prospects', 'fa-filter', '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Prospects', String(list.length), '', 'fa-users') + X.kpi('Gagnés', String(list.filter(function (p) { return p.stage === 'won'; }).length), 'text-green-600', 'fa-trophy') + X.kpi('Taux de conversion', list.length ? Math.round(list.filter(function (p) { return p.stage === 'won'; }).length / list.length * 100) + ' %' : '—', 'text-indigo-600', 'fa-percent') + X.kpi('Relances dues', String(due), due ? 'text-red-600' : '', 'fa-bell') + '</div><div class="flex flex-wrap gap-2 mb-4">' + chips + '</div>' +
        X.table([['Prospect'], ['Source'], ['Étape', 'c'], ['Valeur', 'r'], ['Relance'], ['Notes'], ['', 'r']], rows, { empty: 'Aucun prospect dans cette vue' })) +
      X.card('Sources d\'acquisition', 'fa-bullseye', X.table([['Source'], ['Prospects', 'r'], ['Gagnés', 'r'], ['Conversion', 'r']], srcRows, { empty: 'Pas encore de données' }));
  }
  window.crmStage = function (f) { ui().stageFilter = f; X.rerender(); };
  window.crmProspectAdd = function () {
    var name = val('pr-name').trim(); if (!name) return X.toast('Nom requis', 'error');
    S.list('prospects').push({ id: X.uid('prs'), name: name, phone: val('pr-phone').trim(), instagram: val('pr-ig').trim().replace(/^@+/, ''), source: val('pr-src'), value: Number(val('pr-value')) || 0, nextFollowUp: val('pr-next'), notes: val('pr-notes').trim(), stage: 'new', createdAt: Date.now(), by: X.actor() });
    X.log('Prospect ajouté', name); X.save(); X.toast('Prospect ajouté', 'success'); X.rerender();
  };
  window.crmProspectStage = function (id, st) { var p = X.find(S.list('prospects'), id); if (!p) return; p.stage = st; p.updatedAt = Date.now(); X.log('Prospect : étape « ' + stageInfo(st)[1] + ' »', p.name); X.save(); X.rerender(); };
  window.crmProspectDelete = function (id) { var l = S.list('prospects'), p = X.find(l, id); if (!p || !confirm('Supprimer le prospect « ' + p.name + ' » ?')) return; l.splice(l.indexOf(p), 1); X.log('Prospect supprimé', p.name); X.save(); X.rerender(); };
  window.crmProspectWa = function (id) { var p = X.find(S.list('prospects'), id); if (!p) return; var P = getCompanyProfile(); X.openUrl(X.waLink(p.phone, 'Bonjour ' + p.name + ',\nMerci pour votre intérêt. Je suis de ' + P.name + ' — comment puis-je vous aider pour vos campagnes publicitaires ?')); if (p.stage === 'new') { p.stage = 'contacted'; X.save(); X.rerender(); } };
  window.crmProspectEdit = function (id) {
    var p = X.find(S.list('prospects'), id); if (!p) return;
    var n = prompt('Nom :', p.name); if (n === null) return; var note = prompt('Notes :', p.notes || ''); if (note === null) return; var nx = prompt('Prochaine relance (AAAA-MM-JJ, vide = aucune) :', p.nextFollowUp || ''); if (nx === null) return;
    if (nx && !X.isYmd(nx)) return X.toast('Date invalide (format AAAA-MM-JJ)', 'error');
    p.name = n.trim() || p.name; p.notes = note.trim(); p.nextFollowUp = nx; p.updatedAt = Date.now(); X.save(); X.rerender();
  };
  window.crmProspectConvert = function (id) {
    var p = X.find(S.list('prospects'), id); if (!p) return;
    if (!X.isAdmin() && !(appState.session && appState.session.type === 'employee')) return;
    var key = String(p.name).toLowerCase().trim();
    if ((appState.clients || []).some(function (c) { return String(c.name || '').toLowerCase().trim() === key; })) return X.toast('Un client portant ce nom existe déjà', 'warning');
    var ig = String(p.instagram || '').replace(/^@+/, '');
    var client = { id: X.uid('client'), name: p.name, phone: p.phone || '', instagram: ig, contact: p.phone || ig || '', notes: p.notes || '', totalSpent: 0, unpaid: 0, updatedAt: Date.now(), social: { instagram: ig ? [ig] : [], facebook: [] } };
    if (!appState.clients) appState.clients = []; appState.clients.push(client);
    if (p.source) X.setMeta(client.id, { source: p.source });
    p.stage = 'won'; p.clientId = client.id; p.updatedAt = Date.now();
    X.log('Prospect converti en client', p.name); X.save(); X.toast('Client créé : ' + p.name, 'success'); X.rerender();
  };

  // =====================================================================
  //  CLIENTS (liste enrichie) + FICHE
  // =====================================================================
  function renderClients() {
    var q = (ui().q || '').toLowerCase(), list = (appState.clients || []).filter(function (c) { return !q || (String(c.name || '') + ' ' + String(c.phone || '') + ' ' + String(c.instagram || '')).toLowerCase().indexOf(q) !== -1; }).map(function (c) { return { c: c, s: clientStats(c), m: X.meta(c.id) }; }).sort(function (a, b) { return b.s.rev - a.s.rev; });
    var rows = list.slice(0, 150).map(function (x) {
      var id = X.js(x.c.id), tags = (x.m.tags || []).map(function (t) { return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 mr-1">' + E(t) + '</span>'; }).join('');
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.c.name) + '<div class="mt-1">' + tags + '</div></td><td class="p-3"><select onchange="crmClientSource(\'' + id + '\', this.value)" class="' + X.input + ' text-xs">' + srcOpts(x.m.source) + '</select></td><td class="p-3 text-right">' + x.s.n + '</td><td class="p-3 text-right font-mono">' + X.fmt(x.s.rev) + '</td><td class="p-3 text-right font-mono text-green-600">' + X.fmt(x.s.margin) + '</td><td class="p-3 text-right font-mono ' + (x.s.debt ? 'text-red-600 font-black' : 'text-gray-400') + '">' + (x.s.debt ? X.fmt(x.s.debt) : '—') + '</td><td class="p-3 text-xs">' + (x.s.last ? X.fmtDate(x.s.last) : '—') + '</td><td class="p-3 text-right"><button onclick="openClientProfile(\'' + id + '\')" class="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100"><i class="fas fa-id-card mr-1"></i>Fiche</button></td></tr>';
    }).join('');
    var bySrc = {}; (appState.clients || []).forEach(function (c) { var s = X.meta(c.id).source || 'Non renseignée'; bySrc[s] = (bySrc[s] || 0) + 1; });
    return X.card('Clients', 'fa-users', '<div class="flex flex-wrap items-center gap-3 mb-4"><input id="crmQ" value="' + E(ui().q || '') + '" oninput="crmSearch(this.value)" placeholder="Rechercher un client…" class="' + X.input + ' w-72"><span class="text-xs text-gray-500">' + Object.keys(bySrc).map(function (s) { return E(s) + ' : <b>' + bySrc[s] + '</b>'; }).join(' · ') + '</span></div>' +
      X.table([['Client'], ['Source'], ['Ventes', 'r'], ['CA', 'r'], ['Marge', 'r'], ['Dette', 'r'], ['Dernier achat'], ['', 'r']], rows, { empty: 'Aucun client' }));
  }
  window.crmSearch = function (v) { ui().q = v; X.rerender(); setTimeout(function () { var i = document.getElementById('crmQ'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 0); };
  window.crmClientSource = function (id, v) { X.setMeta(id, { source: v }); X.log('Source du client modifiée', X.clientName(id) + ' → ' + (v || '—')); };

  window.openClientProfile = function (id) {
    var c = X.find(appState.clients, id); if (!c) return; var s = clientStats(c), m = X.meta(id), old = document.getElementById('clientProfileModal'); if (old) old.remove();
    var ev = [];
    (appState.transactions || []).forEach(function (t) { if (t.clientId === id) ev.push({ d: t.date, ts: t.createdAt || 0, l: 'Vente — ' + (t.offerName || '') + (t.status === 'problem' ? ' (problème)' : ''), a: Number(t.priceDzd || 0), cls: t.paid ? 'text-gray-700' : 'text-red-600', tag: t.paid ? 'payée' : 'impayée' }); });
    (appState.payments || []).forEach(function (p) { if (p.clientId === id) ev.push({ d: p.date, ts: p.createdAt || 0, l: 'Paiement reçu (' + (p.method || '') + ')', a: Number(p.amount || 0), cls: 'text-green-600', tag: 'encaissé' }); });
    (appState.todoTransactions || []).forEach(function (t) { if (t.clientId === id) ev.push({ d: t.date, ts: t.createdAt || 0, l: 'To-Do — ' + (t.offerName || ''), a: Number(t.priceDzd || 0), cls: 'text-amber-600', tag: 'en attente' }); });
    ev.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)) || (b.ts - a.ts); });
    var tl = ev.slice(0, 15).map(function (e) { return '<div class="flex justify-between items-center py-2 border-b dark:border-gray-700 text-sm"><div><span class="text-xs text-gray-400 mr-2">' + X.fmtDate(e.d) + '</span>' + E(e.l) + ' <span class="text-[10px] text-gray-400">(' + E(e.tag) + ')</span></div><div class="font-mono font-bold ' + e.cls + '">' + X.fmt(e.a) + '</div></div>'; }).join('') || '<p class="text-sm text-gray-400 italic py-4">Aucune opération</p>';
    var el = document.createElement('div'); el.id = 'clientProfileModal'; el.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-2 md:p-6'; el.style.zIndex = '60';
    var i = X.input + ' w-full', l = 'block text-xs font-bold text-gray-500 mb-1', cid = X.js(id);
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-3xl flex flex-col border dark:border-gray-700" style="max-height:94vh"><div class="flex items-start justify-between gap-3 p-5 border-b dark:border-gray-700"><div><h3 class="text-2xl font-bold text-gray-800 dark:text-white">' + E(c.name) + '</h3><p class="text-xs text-gray-500 mt-1">' + E(c.phone || c.contact || '') + (c.instagram ? ' · @' + E(String(c.instagram).replace(/^@/, '')) : '') + (s.first ? ' · client depuis le ' + X.fmtDate(s.first) : '') + '</p></div><button onclick="document.getElementById(\'clientProfileModal\').remove()" class="text-3xl text-gray-400 hover:text-gray-600 leading-none">×</button></div>' +
      '<div class="p-5 overflow-y-auto space-y-5"><div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + X.kpi('Chiffre d\'affaires', X.fmt(s.rev), '', 'fa-sack-dollar') + X.kpi('Marge', X.fmt(s.margin), 'text-green-600', 'fa-chart-line') + X.kpi('Campagnes', String(s.n), '', 'fa-bullhorn') + X.kpi('Dette', X.fmt(s.debt), s.debt ? 'text-red-600' : 'text-green-600', 'fa-user-clock') + '</div>' +
      '<div class="flex flex-wrap gap-2">' + X.btn('WhatsApp', 'crmProfileWa(\'' + cid + '\')', 'bg-green-600 hover:bg-green-700 text-white', 'fa-whatsapp') + X.btn('Relevé de compte', 'crmProfileStatement(\'' + cid + '\')', null, 'fa-file-lines') + X.btn('Nouvelle To-Do', 'crmProfileTodo(\'' + cid + '\')', 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200', 'fa-list-check') + X.btn('Dette / plafond', 'document.getElementById(\'clientProfileModal\').remove();opsDebtForm(\'' + cid + '\')', 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200', 'fa-user-clock') + '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="' + l + '">Source d\'acquisition</label><select id="cp-src" class="' + i + '">' + srcOpts(m.source) + '</select></div><div><label class="' + l + '">Étiquettes (séparées par des virgules)</label><input id="cp-tags" value="' + E((m.tags || []).join(', ')) + '" placeholder="VIP, mauvais payeur…" class="' + i + '"></div></div>' +
      '<div><label class="' + l + '">Lien de la discussion Instagram</label><input id="cp-dm" value="' + E(c.instagramDm || '') + '" placeholder="https://www.instagram.com/direct/t/102963774431486/" class="' + i + '"></div>' +
      '<div><label class="' + l + '">Notes internes</label><textarea id="cp-notes" rows="3" class="' + i + '">' + E(m.notes || '') + '</textarea></div>' + X.btn('Enregistrer la fiche', 'crmProfileSave(\'' + cid + '\')', null, 'fa-check') +
      '<div><h4 class="font-bold text-gray-800 dark:text-white mb-1">Historique (15 dernières opérations)</h4>' + tl + '</div></div></div>';
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); }); document.body.appendChild(el);
  };
  window.crmProfileSave = function (id) {
    var dmRaw = val('cp-dm').trim(), cl = X.find(appState.clients, id);
    if (dmRaw) { var dm = (typeof normalizeInstagramThread === 'function') ? normalizeInstagramThread(dmRaw) : ''; if (!dm) return X.toast('Lien Instagram invalide (attendu : https://www.instagram.com/direct/t/…)', 'error'); if (cl) { cl.instagramDm = dm; cl.updatedAt = Date.now(); } }
    else if (cl && cl.instagramDm) { cl.instagramDm = ''; cl.updatedAt = Date.now(); }
    var tags = val('cp-tags').split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 12);
    X.setMeta(id, { source: val('cp-src'), tags: tags, notes: val('cp-notes').trim() }); X.log('Fiche client modifiée', X.clientName(id)); X.toast('Fiche enregistrée', 'success'); var el = document.getElementById('clientProfileModal'); if (el) el.remove(); X.rerender();
  };
  window.crmProfileWa = function (id) { var c = X.find(appState.clients, id); if (!c) return; X.openUrl(X.waLink(c.phone || c.contact, 'Bonjour ' + (c.name || '') + ',')); };
  window.crmProfileStatement = function (id) { var el = document.getElementById('clientProfileModal'); if (el) el.remove(); if (!appState.ui) appState.ui = {}; if (!appState.ui.accounting) appState.ui.accounting = {}; appState.ui.accounting.sub = 'statement'; appState.ui.accounting.stClient = id; if (typeof showTab === 'function') showTab('accounting'); };
  window.crmProfileTodo = function (id) { var el = document.getElementById('clientProfileModal'); if (el) el.remove(); if (typeof showTab === 'function') showTab('todo'); setTimeout(function () { var o = document.querySelector('.client-option[data-id="' + String(id).replace(/"/g, '') + '"]'); if (o && typeof selectClient === 'function') selectClient(o); }, 150); };

  // Bouton « Fiche » ajouté sur le tableau Clients existant (sans modifier cet écran)
  X.wrap('renderClientsTable', null, function (container) {
    try {
      (container || document).querySelectorAll('tbody tr').forEach(function (tr) {
        var b = tr.querySelector('button[onclick^="editClient("]'); if (!b || tr.querySelector('.crm-fiche-btn')) return;
        var m = String(b.getAttribute('onclick')).match(/editClient\('([^']+)'\)/); if (!m) return;
        var n = document.createElement('button'); n.type = 'button'; n.className = 'crm-fiche-btn p-2 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100'; n.title = 'Fiche client'; n.innerHTML = '<i class="fas fa-id-card"></i>';
        n.setAttribute('onclick', "openClientProfile('" + m[1] + "')"); b.parentNode.insertBefore(n, b);
      });
    } catch (e) {}
  });

  // =====================================================================
  //  DOUBLONS & FUSION
  // =====================================================================
  function normName(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function normPhone(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; }
  function normIg(s) { return String(s || '').toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._]/g, ''); }
  function findDuplicates() {
    var cl = (appState.clients || []).filter(function (c) { return c && c.id; }), parent = {};
    cl.forEach(function (c) { parent[c.id] = c.id; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    var idx = {}, reasons = {};
    cl.forEach(function (c) {
      [['tél.', normPhone(c.phone || c.contact)], ['Instagram', normIg(c.instagram || c.username)], ['nom', normName(c.name).length >= 3 ? normName(c.name) : '']].forEach(function (k) {
        if (!k[1]) return; var key = k[0] + ':' + k[1];
        if (idx[key]) { union(idx[key], c.id); reasons[key] = true; } else idx[key] = c.id;
      });
    });
    var groups = {}; cl.forEach(function (c) { var r = find(c.id); (groups[r] = groups[r] || []).push(c); });
    return Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; }).map(function (g) {
      var why = {}; g.forEach(function (c) { if (normPhone(c.phone || c.contact)) why['même téléphone'] = (why['même téléphone'] || 0) + 1; });
      var ph = {}, ig = {}, nm = {}; g.forEach(function (c) { ph[normPhone(c.phone || c.contact)] = (ph[normPhone(c.phone || c.contact)] || 0) + 1; ig[normIg(c.instagram || c.username)] = (ig[normIg(c.instagram || c.username)] || 0) + 1; nm[normName(c.name)] = (nm[normName(c.name)] || 0) + 1; });
      var rs = []; if (Object.keys(ph).some(function (k) { return k && ph[k] > 1; })) rs.push('même téléphone'); if (Object.keys(ig).some(function (k) { return k && ig[k] > 1; })) rs.push('même Instagram'); if (Object.keys(nm).some(function (k) { return k.length >= 3 && nm[k] > 1; })) rs.push('même nom');
      return { clients: g, reasons: rs };
    });
  }
  window.CrmDuplicates = findDuplicates;
  function countRefs(id) {
    var n = function (arr, f) { return (arr || []).filter(function (x) { return x && x[f || 'clientId'] === id; }).length; };
    return { tx: n(appState.transactions), todo: n(appState.todoTransactions), pay: n(appState.payments), req: n(appState.clientRequests) };
  }
  function renderDups() {
    var groups = findDuplicates(), html = groups.map(function (g, gi) {
      var best = g.clients.slice().sort(function (a, b) { return countRefs(b.id).tx - countRefs(a.id).tx; })[0];
      return '<div class="rounded-2xl border dark:border-gray-700 p-4 mb-4"><div class="flex flex-wrap items-center justify-between gap-2 mb-3"><div class="text-sm font-bold text-gray-800 dark:text-white">Groupe ' + (gi + 1) + ' <span class="text-xs font-normal text-amber-600">(' + E(g.reasons.join(', ') || 'similaire') + ')</span></div>' + X.btn('Fusionner ce groupe', 'crmMerge(' + gi + ')', 'bg-amber-500 hover:bg-amber-600 text-white', 'fa-code-merge') + '</div>' +
        g.clients.map(function (c) { var r = countRefs(c.id); return '<label class="flex items-center gap-3 py-2 border-b last:border-0 dark:border-gray-700 cursor-pointer"><input type="radio" name="dup-' + gi + '" value="' + E(c.id) + '"' + (c.id === best.id ? ' checked' : '') + '><div class="flex-1"><div class="font-bold text-gray-800 dark:text-white">' + E(c.name) + '</div><div class="text-[11px] text-gray-400">' + E(c.phone || c.contact || '—') + (c.instagram ? ' · @' + E(String(c.instagram).replace(/^@/, '')) : '') + '</div></div><div class="text-xs text-gray-500 text-right">' + r.tx + ' vente(s) · ' + r.todo + ' to-do · ' + r.pay + ' paiement(s)<br><b class="' + (Number(c.unpaid) > 0 ? 'text-red-600' : '') + '">dette ' + X.fmt(c.unpaid || 0) + '</b></div><span class="text-[10px] font-black text-indigo-600">GARDER</span></label>'; }).join('') + '</div>';
    }).join('');
    return X.card('Doublons détectés', 'fa-clone', (groups.length ? '<p class="text-sm text-gray-500 mb-4">Clients ayant le même téléphone, le même compte Instagram ou le même nom. Choisissez celui à <b>garder</b> : les autres lui seront fusionnés (ventes, to-do, paiements, demandes et dettes sont rattachés au client gardé). Une <b>sauvegarde de sécurité</b> est faite avant.</p>' + html : '<p class="text-sm text-green-600 font-bold"><i class="fas fa-circle-check mr-2"></i>Aucun doublon détecté.</p>'));
  }
  window.crmMerge = function (gi) {
    if (!X.isAdmin()) return X.toast('Réservé à l\'administrateur', 'error');
    var g = findDuplicates()[gi]; if (!g) return;
    var radio = document.querySelector('input[name="dup-' + gi + '"]:checked'), keepId = radio ? radio.value : g.clients[0].id, keep = X.find(appState.clients, keepId), others = g.clients.filter(function (c) { return c.id !== keepId; });
    if (!keep || !others.length) return;
    var total = others.reduce(function (s, c) { var r = countRefs(c.id); return s + r.tx + r.todo + r.pay + r.req; }, 0), debt = others.reduce(function (s, c) { return s + Number(c.unpaid || 0); }, 0);
    if (!confirm('Fusionner ' + others.map(function (c) { return '« ' + c.name + ' »'; }).join(', ') + ' dans « ' + keep.name + ' » ?\n\n' + total + ' enregistrement(s) seront rattachés à « ' + keep.name + ' », dettes cumulées (+ ' + X.fmt(debt) + ').\nUne sauvegarde de sécurité est créée avant. Cette opération supprime les fiches fusionnées.')) return;
    var doMerge = function () {
      var pend = (appState.sync = appState.sync || {}).pendingDeletions = (appState.sync.pendingDeletions || []);
      others.forEach(function (o) {
        ['transactions', 'todoTransactions', 'payments', 'clientRequests'].forEach(function (col) { (appState[col] || []).forEach(function (r) { if (r && r.clientId === o.id) { r.clientId = keep.id; if (r.clientName !== undefined) r.clientName = keep.name; r.updatedAt = Date.now(); } }); });
        ['quotes', 'creditNotes'].forEach(function (k) { S.list(k).forEach(function (r) { if (r.clientId === o.id) { r.clientId = keep.id; r.clientName = keep.name; } }); });
        keep.totalSpent = Number(keep.totalSpent || 0) + Number(o.totalSpent || 0);
        keep.unpaid = Number(keep.unpaid || 0) + Number(o.unpaid || 0);
        if (o.debtStartDate && (!keep.debtStartDate || o.debtStartDate < keep.debtStartDate)) keep.debtStartDate = o.debtStartDate;
        ['phone', 'instagram', 'contact', 'email', 'username'].forEach(function (f) { if (!keep[f] && o[f]) keep[f] = o[f]; });
        if (o.notes && keep.notes !== o.notes) keep.notes = (keep.notes ? keep.notes + ' | ' : '') + o.notes;
        keep.social = keep.social || { instagram: [], facebook: [] };
        ['instagram', 'facebook'].forEach(function (k) { var a = (keep.social[k] = keep.social[k] || []); ((o.social && o.social[k]) || []).forEach(function (v) { if (a.indexOf(v) === -1) a.push(v); }); });
        var mo = X.meta(o.id), mk = X.meta(keep.id), patch = {}; Object.keys(mo).forEach(function (k) { if (k !== 'updatedAt' && (mk[k] === undefined || mk[k] === '' || mk[k] === 0)) patch[k] = mo[k]; }); if (Object.keys(patch).length) X.setMeta(keep.id, patch);
        delete S.map('clientMeta')[o.id];
        appState.clients = appState.clients.filter(function (c) { return c.id !== o.id; });
        pend.push({ col: 'clients', id: o.id });
      });
      keep.updatedAt = Date.now();
      X.log('Clients fusionnés', others.map(function (c) { return c.name; }).join(', ') + ' → ' + keep.name + ' (' + total + ' enregistrements)');
      if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances(); X.save(); X.toast('Fusion terminée', 'success'); X.rerender();
    };
    if (window.BackupCore && typeof BackupCore.createSnapshot === 'function') { BackupCore.createSnapshot('pre-restore', 'Avant fusion de clients').then(doMerge, function () { if (confirm('La sauvegarde de sécurité a échoué. Fusionner quand même ?')) doMerge(); }); } else doMerge();
  };

  // =====================================================================
  //  ONGLET
  // =====================================================================
  var SUBS = [['pipeline', 'Prospects', 'fa-filter'], ['clients', 'Clients & fiches', 'fa-users'], ['dups', 'Doublons', 'fa-clone']];
  window.crmSub = function (s) { ui().sub = s; X.rerender(); };
  X.registerTab('crm', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'CRM', icon: 'fa-address-book' },
    render: function (c) {
      var sub = ui().sub, fn = { pipeline: renderPipeline, clients: renderClients, dups: renderDups }[sub] || renderPipeline;
      c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-address-book text-indigo-600 mr-2"></i>CRM</h2><p class="text-xs text-gray-500 mt-1">Prospects, sources d\'acquisition, fiches clients et nettoyage des doublons.</p></div>' + X.pills(SUBS, sub, 'crmSub') + fn();
    }
  });
})();
