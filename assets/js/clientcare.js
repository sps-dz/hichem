// =====================================================================
//  CLIENTCARE.JS — « Relation client » : relances, messages types, suivi de commandes, reçus,
//  avis clients, rapport client, tableau de bord employé + garde-fous à la saisie (doublon, marge).
//  S'appuie sur l'existant (dettes/plafonds d'operations.js, équipe de team.js, liens Instagram) :
//  AUCUNE donnée existante n'est modifiée, les nouveautés sont stockées dans ExtStore ou en champs
//  supplémentaires sur les objets (receiptNo, proofRef, csat…).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;
  var ui = { sub: 'relances', rq: '', empId: '', repClient: '', repDays: '30', repNote: '' };

  function ro() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function clients() { return (window.appState && appState.clients) || []; }
  function byId(id) { return clients().filter(function (c) { return c.id === id; })[0]; }
  function nowTs() { return Date.now(); }

  // ------------------------------------------------------------------ réglages
  var DEF = { dormantDays: 30, pingGapDays: 14, hoursPending: 12, hoursProgress: 48, minMarginPct: 10, dupMinutes: 15 };
  function cfg() { return Object.assign({}, DEF, S.get('careSettings', {}) || {}); }
  window.careSaveSettings = function () {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var g = function (id, d) { var v = Number((document.getElementById(id) || {}).value); return isFinite(v) && v >= 0 ? v : d; };
    S.set('careSettings', { dormantDays: g('cs-dormant', DEF.dormantDays), pingGapDays: g('cs-gap', DEF.pingGapDays), hoursPending: g('cs-hp', DEF.hoursPending), hoursProgress: g('cs-hg', DEF.hoursProgress), minMarginPct: g('cs-margin', DEF.minMarginPct), dupMinutes: g('cs-dup', DEF.dupMinutes) });
    X.log('Réglages relation client', 'modifiés'); X.toast('Réglages enregistrés', 'success'); X.rerender();
  };

  // ------------------------------------------------------------------ messages types
  var TPL = {
    relance_douce: ['Relance douce (0–7 j)', 'Bonjour {client},\nPetit rappel amical : il reste {montant} à régler pour vos dernières campagnes.\nMerci de votre confiance — {agence}'],
    relance_ferme: ['Relance ferme (8–30 j)', 'Bonjour {client},\nSauf erreur de notre part, {montant} reste impayé depuis {jours} jours.\nPouvez-vous régulariser cette semaine ? Merci — {agence}'],
    relance_urgente: ['Relance urgente (+30 j)', 'Bonjour {client},\nVotre solde de {montant} est impayé depuis plus de {jours} jours. Merci de régulariser rapidement afin d\'éviter la suspension de vos prochaines campagnes.\n{agence}'],
    dormant: ['Client qui s\'éloigne', 'Bonjour {client},\nÇa fait {jours} jours que nous n\'avons pas travaillé ensemble. Souhaitez-vous relancer une campagne cette semaine ? Dites-moi votre objectif et je vous propose l\'offre adaptée.\n{agence}'],
    confirmation: ['Confirmation de commande', 'Bonjour {client},\nVotre commande « {offre} » ({montant}) est bien reçue. Nous la lançons très vite et vous prévenons dès qu\'elle est active.\n{agence}'],
    facture: ['Facture envoyée', 'Bonjour {client},\nVoici votre facture n° {facture} d\'un montant de {montant}. Merci de votre confiance !\n{agence}'],
    livree: ['Recharge / campagne lancée', 'Bonjour {client},\nBonne nouvelle : « {offre} » est lancée ✅. Vous pouvez suivre vos résultats dès maintenant, je reste disponible pour toute question.\n{agence}'],
    recu: ['Reçu de paiement', 'Bonjour {client},\nNous confirmons la réception de votre paiement de {montant} le {date} (reçu n° {recu}). Reste à payer : {solde}.\nMerci ! — {agence}'],
    satisfaction: ['Demande d\'avis', 'Bonjour {client},\nVotre avis compte beaucoup pour nous : sur une échelle de 1 à 5, quelle note donnez-vous à « {offre} » ? Une phrase pour nous dire ce qu\'on peut améliorer nous aide énormément. Merci ! — {agence}'],
    rapport: ['Rapport de performance', 'Bonjour {client},\nVoici votre point {periode} :\n{resume}\nN\'hésitez pas si vous voulez qu\'on optimise ensemble. — {agence}']
  };
  function tplText(key) { var o = S.map('msgTemplates'); return (o[key] && String(o[key]).trim()) ? o[key] : (TPL[key] ? TPL[key][1] : ''); }
  function fill(text, ctx) { return String(text || '').replace(/\{(\w+)\}/g, function (m, k) { return ctx[k] === undefined || ctx[k] === null ? '' : String(ctx[k]); }); }
  function render(key, ctx) { return fill(tplText(key), ctx); }
  function ctxOf(c, extra) {
    var P = getCompanyProfile();
    return Object.assign({ client: (c && c.name) || '', agence: P.name || '', montant: c ? X.fmt(c.unpaid || 0) : '', solde: c ? X.fmt(c.unpaid || 0) : '', date: X.fmtDate(X.today()), jours: '', offre: '', facture: '', recu: '', periode: '', resume: '' }, extra || {});
  }
  window.CareMessages = { render: render, template: tplText, context: ctxOf, keys: Object.keys(TPL) };

  window.careTplSave = function (key) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var v = (document.getElementById('tpl-' + key) || {}).value || '';
    if (v.trim() === TPL[key][1].trim()) delete S.map('msgTemplates')[key]; else S.map('msgTemplates')[key] = v;
    X.save(); X.toast('Message enregistré', 'success');
  };
  window.careTplReset = function (key) { if (ro()) return; delete S.map('msgTemplates')[key]; X.save(); X.toast('Message par défaut rétabli', 'success'); X.rerender(); };

  // ------------------------------------------------------------------ envoi (WhatsApp / Instagram)
  function sendWa(c, text) {
    var p = c && (c.phone || c.contact);
    if (!p) { X.toast('Numéro WhatsApp manquant pour ce client', 'warning'); return false; }
    var u = X.waLink(p, text); if (!u) { X.toast('Numéro WhatsApp invalide', 'warning'); return false; }
    X.openUrl(u); return true;
  }
  function sendIg(c, text) {
    var u = typeof getInstagramChatUrl === 'function' ? getInstagramChatUrl(c) : '';
    if (!u) { X.toast('Aucun pseudo ni lien Instagram pour ce client', 'warning'); return false; }
    var done = function () { X.toast('Message copié : collez-le (Ctrl+V) dans la discussion', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('Copiez le message :', text); });
    else prompt('Copiez le message :', text);
    window.open(u, '_blank', 'noopener'); return true;
  }
  function sendVia(ch, c, text) { return ch === 'ig' ? sendIg(c, text) : sendWa(c, text); }

  // ------------------------------------------------------------------ clients : dettes & dormants
  function debtorList() { return typeof window.OpsDebtors === 'function' ? OpsDebtors() : []; }
  function lastPurchase(c) {
    var d = '';
    (appState.transactions || []).forEach(function (t) { if (t && t.clientId === c.id && X.valid(t) && X.isYmd(t.date) && Number(t.priceDzd) > 0 && t.date > d) d = t.date; });
    return d;
  }
  function dormantList() {
    var s = cfg(), today = X.today(), out = [];
    clients().forEach(function (c) {
      var lp = lastPurchase(c); if (!lp) return;
      var days = X.daysBetween(lp, today); if (days < s.dormantDays) return;
      var m = X.meta(c.id), ping = m.lastDormantPing ? X.daysBetween(String(m.lastDormantPing).slice(0, 10), today) : null;
      out.push({ c: c, last: lp, days: days, ping: ping, value: Number(c.totalSpent || 0), recent: ping !== null && ping < s.pingGapDays });
    });
    return out.sort(function (a, b) { return b.value - a.value; });
  }
  function debtKey(age) { return age <= 7 ? 'relance_douce' : (age <= 30 ? 'relance_ferme' : 'relance_urgente'); }

  // ------------------------------------------------------------------ file de relance (« tout relancer en quelques minutes »)
  var Q = { items: [], i: 0 };
  function buildItem(it) {
    var c = byId(it.id); if (!c) return null;
    if (it.kind === 'debt') { var d = debtorList().filter(function (x) { return x.c.id === c.id; })[0]; if (!d) return null; return { c: c, kind: 'debt', key: debtKey(d.age), text: render(debtKey(d.age), ctxOf(c, { jours: d.age })), meta: d.age + ' j de retard · ' + X.fmt(c.unpaid) }; }
    var dm = dormantList().filter(function (x) { return x.c.id === c.id; })[0]; if (!dm) return null;
    return { c: c, kind: 'dormant', key: 'dormant', text: render('dormant', ctxOf(c, { jours: dm.days })), meta: dm.days + ' j sans commande · ' + X.fmt(dm.value) + ' dépensés' };
  }
  window.careQueueStart = function (kind) {
    var items = kind === 'debt' ? debtorList().map(function (x) { return { kind: 'debt', id: x.c.id }; }) : dormantList().filter(function (x) { return !x.recent; }).map(function (x) { return { kind: 'dormant', id: x.c.id }; });
    if (!items.length) return X.toast('Personne à relancer pour le moment 🎉', 'success');
    Q = { items: items, i: 0 }; showQ();
  };
  function showQ() {
    var old = document.getElementById('careQueue'); if (old) old.remove();
    while (Q.i < Q.items.length && !buildItem(Q.items[Q.i])) Q.i++;
    if (Q.i >= Q.items.length) { X.toast('File de relance terminée', 'success'); X.rerender(); return; }
    var it = buildItem(Q.items[Q.i]), el = document.createElement('div');
    el.id = 'careQueue'; el.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-3'; el.style.zIndex = '9992';
    var hasWa = !!(it.c.phone || it.c.contact), hasIg = typeof getInstagramChatUrl === 'function' && !!getInstagramChatUrl(it.c);
    el.innerHTML = '<div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg border dark:border-gray-700">' +
      '<div class="p-5 border-b dark:border-gray-700 flex items-start justify-between gap-3"><div><div class="text-[11px] font-black uppercase text-indigo-600">' + (it.kind === 'debt' ? 'Relance impayé' : 'Client qui s\'éloigne') + ' · ' + (Q.i + 1) + ' / ' + Q.items.length + '</div>' +
      '<h3 class="text-xl font-bold text-gray-800 dark:text-white">' + E(it.c.name) + '</h3><p class="text-sm text-gray-500">' + E(it.meta) + '</p></div><button type="button" onclick="careQClose()" class="text-gray-400 hover:text-gray-600 text-xl" aria-label="Fermer"><i class="fas fa-times"></i></button></div>' +
      '<div class="p-5"><label class="block text-xs font-bold text-gray-500 mb-1">Message (modifiable)</label><textarea id="cqText" rows="6" class="w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm">' + E(it.text) + '</textarea></div>' +
      '<div class="px-5 pb-5 grid grid-cols-2 gap-2">' +
      '<button type="button" onclick="careQSend(\'wa\')" ' + (hasWa ? '' : 'disabled title="Numéro manquant" ') + 'class="px-4 py-3 rounded-xl font-bold text-sm text-white ' + (hasWa ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-300 cursor-not-allowed') + '"><i class="fab fa-whatsapp mr-1"></i>WhatsApp</button>' +
      '<button type="button" onclick="careQSend(\'ig\')" ' + (hasIg ? '' : 'disabled title="Pseudo / lien manquant" ') + 'class="px-4 py-3 rounded-xl font-bold text-sm text-white ' + (hasIg ? '' : 'bg-gray-300 cursor-not-allowed') + '" ' + (hasIg ? 'style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888)"' : '') + '><i class="fab fa-instagram mr-1"></i>Instagram</button>' +
      '<button type="button" onclick="careQStep(-1)" class="px-4 py-2 rounded-xl text-sm font-bold border dark:border-gray-600 text-gray-600 dark:text-gray-300">Précédent</button>' +
      '<button type="button" onclick="careQStep(1)" class="px-4 py-2 rounded-xl text-sm font-bold border dark:border-gray-600 text-gray-600 dark:text-gray-300">Passer</button></div></div>';
    document.body.appendChild(el);
  }
  window.careQClose = function () { var el = document.getElementById('careQueue'); if (el) el.remove(); X.rerender(); };
  window.careQStep = function (d) { Q.i = Math.max(0, Q.i + d); showQ(); };
  window.careQSend = function (ch) {
    var it = Q.items[Q.i] && buildItem(Q.items[Q.i]); if (!it) return;
    var text = (document.getElementById('cqText') || {}).value || it.text;
    if (!sendVia(ch, it.c, text)) return;
    if (!ro()) {
      X.setMeta(it.c.id, it.kind === 'debt' ? { lastReminder: new Date().toISOString() } : { lastDormantPing: new Date().toISOString() });
      X.log(it.kind === 'debt' ? 'Relance de dette (' + (ch === 'ig' ? 'Instagram' : 'WhatsApp') + ')' : 'Relance client inactif (' + (ch === 'ig' ? 'Instagram' : 'WhatsApp') + ')', it.c.name);
    }
    Q.i++; setTimeout(showQ, 400);
  };
  window.careRelance = function (kind, id, ch) {
    var it = buildItem({ kind: kind, id: id }); if (!it) return;
    if (!sendVia(ch, it.c, it.text)) return;
    if (!ro()) { X.setMeta(id, kind === 'debt' ? { lastReminder: new Date().toISOString() } : { lastDormantPing: new Date().toISOString() }); X.log('Relance (' + (ch === 'ig' ? 'Instagram' : 'WhatsApp') + ')', it.c.name); }
    X.rerender();
  };

  // ------------------------------------------------------------------ onglet : relances
  function badgeAge(age) { var cl = age <= 7 ? 'bg-green-50 text-green-700' : (age <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'); return '<span class="px-2 py-1 rounded-full text-[10px] font-black ' + cl + '">' + age + ' j</span>'; }
  function chBtns(kind, id) {
    var c = byId(id), j = X.js(id);
    var hasIg = typeof getInstagramChatUrl === 'function' && !!getInstagramChatUrl(c), hasWa = !!(c && (c.phone || c.contact));
    return '<button type="button" ' + (hasWa ? '' : 'disabled ') + 'onclick="careRelance(\'' + kind + '\',\'' + j + '\',\'wa\')" class="px-2 py-1.5 rounded-lg ' + (hasWa ? 'text-green-600 hover:bg-green-50' : 'text-gray-300') + '" title="WhatsApp"><i class="fab fa-whatsapp"></i></button>' +
      '<button type="button" ' + (hasIg ? '' : 'disabled ') + 'onclick="careRelance(\'' + kind + '\',\'' + j + '\',\'ig\')" class="px-2 py-1.5 rounded-lg ' + (hasIg ? 'text-pink-600 hover:bg-pink-50' : 'text-gray-300') + '" title="Instagram (message copié)"><i class="fab fa-instagram"></i></button>';
  }
  function renderRelances() {
    var d = debtorList(), dm = dormantList(), totalDebt = d.reduce(function (s, x) { return s + Number(x.c.unpaid || 0); }, 0), today = X.today();
    var drows = d.slice(0, 150).map(function (x) {
      var last = x.meta.lastReminder ? X.daysBetween(String(x.meta.lastReminder).slice(0, 10), today) : null;
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.c.name) + '</td><td class="p-3 text-right font-mono font-black text-red-600">' + X.fmt(x.c.unpaid) + '</td><td class="p-3 text-center">' + badgeAge(x.age) + '</td>' +
        '<td class="p-3 text-xs text-gray-500">' + (last === null ? '<span class="text-amber-600 font-bold">jamais relancé</span>' : (last === 0 ? 'aujourd\'hui' : 'il y a ' + last + ' j')) + '</td><td class="p-3 text-right whitespace-nowrap">' + chBtns('debt', x.c.id) + '</td></tr>';
    }).join('');
    var mrows = dm.slice(0, 150).map(function (x) {
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.c.name) + '</td><td class="p-3 text-right text-xs">' + X.fmt(x.value) + '</td><td class="p-3 text-center">' + badgeAge(x.days).replace(/bg-\w+-50 text-\w+-700/, 'bg-indigo-50 text-indigo-700') + '</td>' +
        '<td class="p-3 text-xs text-gray-500">' + (x.ping === null ? '<span class="text-amber-600 font-bold">jamais contacté</span>' : 'contacté il y a ' + x.ping + ' j') + '</td><td class="p-3 text-right whitespace-nowrap">' + chBtns('dormant', x.c.id) + '</td></tr>';
    }).join('');
    return '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Clients en dette', String(d.length), d.length ? 'text-red-600' : 'text-green-600', 'fa-user-clock') + X.kpi('À recouvrer', X.fmt(totalDebt), 'text-red-600', 'fa-coins') +
      X.kpi('Plus de 30 jours', String(d.filter(function (x) { return x.bucket === 2; }).length), 'text-red-600', 'fa-triangle-exclamation') + X.kpi('Clients qui s\'éloignent', String(dm.length), dm.length ? 'text-amber-600' : 'text-green-600', 'fa-person-walking-arrow-right') + '</div>' +
      X.card('Impayés à relancer', 'fa-bullhorn', '<p class="text-xs text-gray-500 mb-3">Le message s\'adapte à l\'ancienneté de la dette. « Tout relancer » vous fait défiler les clients un par un : vérifiez, envoyez, suivant.</p>' + X.table([['Client'], ['Dette', 'r'], ['Retard', 'c'], ['Dernière relance'], ['', 'r']], drows, { empty: 'Aucune créance en cours 🎉' }),
        ro() ? '' : X.btn('Tout relancer (' + d.length + ')', "careQueueStart('debt')", 'bg-red-600 hover:bg-red-700 text-white shadow', 'fa-paper-plane')) +
      X.card('Clients qui s\'éloignent (sans commande depuis ' + cfg().dormantDays + ' jours ou plus)', 'fa-person-walking-arrow-right', X.table([['Client'], ['Total dépensé', 'r'], ['Inactivité', 'c'], ['Dernier contact'], ['', 'r']], mrows, { empty: 'Aucun client inactif 🎉' }),
        ro() ? '' : X.btn('Tout relancer (' + dm.filter(function (x) { return !x.recent; }).length + ')', "careQueueStart('dormant')", 'bg-indigo-600 hover:bg-indigo-700 text-white shadow', 'fa-paper-plane'));
  }

  // ------------------------------------------------------------------ suivi des commandes
  function hoursSince(ts) { return Math.max(0, (nowTs() - Number(ts || nowTs())) / 3600000); }
  function pendingOrders() {
    var s = cfg();
    return (appState.todoTransactions || []).filter(function (t) { return t && (t.status === 'pending' || t.status === 'in_progress'); }).map(function (t) {
      var prog = t.status === 'in_progress', since = prog ? (t.updatedAt || t.createdAt) : t.createdAt, target = prog ? s.hoursProgress : s.hoursPending, h = hoursSince(since);
      return { t: t, prog: prog, hours: h, target: target, late: target > 0 && h > target };
    }).sort(function (a, b) { return (b.late - a.late) || (b.hours - a.hours); });
  }
  function fmtH(h) { return h < 1 ? Math.round(h * 60) + ' min' : (h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' j'); }
  function orderCtx(t) { var c = byId(t.clientId) || { name: t.clientName }; return ctxOf(c, { offre: t.offerName || '', montant: X.fmt(t.priceDzd || 0), facture: t.invoiceNo || '' }); }
  window.careOrderMsg = function (id, key, ch) {
    var t = X.find(appState.todoTransactions, id) || X.find(appState.transactions, id); if (!t) return;
    var c = byId(t.clientId); if (!c) return X.toast('Client introuvable', 'warning');
    if (sendVia(ch, c, render(key, orderCtx(t)))) {
      if (!ro()) { if (key === 'satisfaction') { t.csatAskedAt = nowTs(); t.updatedAt = nowTs(); X.save(); } X.log('Message client (' + (TPL[key] ? TPL[key][0] : key) + ')', c.name); }
      if (key === 'satisfaction') X.rerender();
    }
  };
  window.careRate = function (id, n) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var t = X.find(appState.transactions, id); if (!t) return;
    t.csat = n; t.csatAt = nowTs(); t.updatedAt = nowTs(); X.log('Avis client', (t.clientName || '') + ' — ' + n + '/5'); X.save(); X.rerender();
  };
  function recentDelivered() {
    var lim = nowTs() - 14 * 86400000;
    return (appState.transactions || []).filter(function (t) { return t && t.status === 'active' && Number(t.completedAt || 0) > lim; }).sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
  }
  function stars(t) {
    if (t.csat) return '<span class="font-black ' + (t.csat <= 2 ? 'text-red-600' : (t.csat === 3 ? 'text-amber-600' : 'text-green-600')) + '">' + t.csat + '/5 ' + '★'.repeat(t.csat) + '</span>';
    return [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" onclick="careRate(\'' + X.js(t.id) + '\',' + n + ')" class="w-7 h-7 rounded-lg border dark:border-gray-600 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-yellow-100 mr-1">' + n + '</button>'; }).join('');
  }
  function renderOrders() {
    var o = pendingOrders(), late = o.filter(function (x) { return x.late; }), dl = recentDelivered(), s = cfg();
    var rows = o.slice(0, 100).map(function (x) {
      var t = x.t, j = X.js(t.id);
      return '<tr class="' + (x.late ? 'bg-red-50/60 dark:bg-red-900/10' : '') + '"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(t.clientName) + '<div class="text-[11px] font-normal text-gray-400">' + E(t.offerName) + ' · ' + X.fmt(t.priceDzd) + '</div></td>' +
        '<td class="p-3 text-center"><span class="px-2 py-1 rounded-full text-[10px] font-black ' + (x.prog ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600') + '">' + (x.prog ? 'EN COURS' : 'REÇUE') + '</span></td>' +
        '<td class="p-3 text-center text-xs">' + fmtH(x.hours) + ' <span class="text-gray-400">/ ' + (x.target ? x.target + ' h' : '—') + '</span></td>' +
        '<td class="p-3 text-center">' + (x.late ? '<span class="px-2 py-1 rounded-full text-[10px] font-black bg-red-600 text-white">EN RETARD +' + fmtH(x.hours - x.target) + '</span>' : '<span class="text-green-600 text-xs font-bold">dans les temps</span>') + '</td>' +
        '<td class="p-3 text-xs text-gray-500">' + E(t.launchedByName || t.employeeName || 'Admin') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="careOrderMsg(\'' + j + '\',\'' + (x.prog ? 'livree' : 'confirmation') + '\',\'wa\')" class="px-2 py-1.5 rounded-lg text-green-600 hover:bg-green-50" title="' + (x.prog ? 'Prévenir : campagne lancée' : 'Confirmer la réception') + ' (WhatsApp)"><i class="fab fa-whatsapp"></i></button>' +
        '<button type="button" onclick="careOrderMsg(\'' + j + '\',\'' + (x.prog ? 'livree' : 'confirmation') + '\',\'ig\')" class="px-2 py-1.5 rounded-lg text-pink-600 hover:bg-pink-50" title="Instagram"><i class="fab fa-instagram"></i></button></td></tr>';
    }).join('');
    var drows = dl.slice(0, 60).map(function (t) {
      var j = X.js(t.id);
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(t.clientName) + '<div class="text-[11px] font-normal text-gray-400">' + E(t.offerName) + ' · ' + X.fmtDate(t.date) + '</div></td><td class="p-3 text-center text-xs">' + (t.csatAskedAt ? '<span class="text-green-600 font-bold">demandé</span>' : '<span class="text-amber-600 font-bold">à demander</span>') + '</td>' +
        '<td class="p-3">' + stars(t) + '</td><td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="careOrderMsg(\'' + j + '\',\'satisfaction\',\'wa\')" class="px-2 py-1.5 rounded-lg text-green-600 hover:bg-green-50" title="Demander l\'avis (WhatsApp)"><i class="fab fa-whatsapp"></i></button>' +
        '<button type="button" onclick="careOrderMsg(\'' + j + '\',\'satisfaction\',\'ig\')" class="px-2 py-1.5 rounded-lg text-pink-600 hover:bg-pink-50" title="Instagram"><i class="fab fa-instagram"></i></button></td></tr>';
    }).join('');
    var bad = dl.filter(function (t) { return t.csat && t.csat <= 2; }).length;
    return '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Commandes ouvertes', String(o.length), '', 'fa-list-check') + X.kpi('En retard', String(late.length), late.length ? 'text-red-600' : 'text-green-600', 'fa-clock') +
      X.kpi('Livrées (14 j)', String(dl.length), '', 'fa-circle-check') + X.kpi('Avis ≤ 2/5', String(bad), bad ? 'text-red-600' : 'text-green-600', 'fa-face-frown') + '</div>' +
      X.card('Commandes en cours', 'fa-list-check', '<p class="text-xs text-gray-500 mb-3">Délais cibles : prise en charge ' + s.hoursPending + ' h, livraison ' + s.hoursProgress + ' h (modifiables dans « Messages & réglages »). Le statut se change dans la To-Do comme d\'habitude.</p>' +
        X.table([['Commande'], ['Statut', 'c'], ['Temps / cible', 'c'], ['Délai', 'c'], ['Lancé par'], ['Prévenir le client', 'r']], rows, { empty: 'Aucune commande en cours 🎉' })) +
      X.card('Avis clients après livraison', 'fa-star', '<p class="text-xs text-gray-500 mb-3">Demandez l\'avis puis notez la réponse du client. Une note de 1 ou 2 déclenche une alerte.</p>' + X.table([['Commande'], ['Avis', 'c'], ['Note'], ['', 'r']], drows, { empty: 'Aucune livraison récente' }));
  }

  // ------------------------------------------------------------------ reçus de paiement
  function nextReceiptNo(p) {
    if (p.receiptNo) return p.receiptNo;
    var y = String(p.date || X.today()).slice(0, 4), pre = 'REC-' + y + '-', max = 0;
    (appState.payments || []).forEach(function (q) { if (q && q.receiptNo && String(q.receiptNo).indexOf(pre) === 0) { var n = parseInt(String(q.receiptNo).slice(pre.length), 10); if (n > max) max = n; } });
    p.receiptNo = pre + String(max + 1).padStart(4, '0'); p.updatedAt = nowTs(); X.save();
    return p.receiptNo;
  }
  window.careReceipt = function (id) {
    var p = X.find(appState.payments, id); if (!p) return;
    var c = byId(p.clientId) || { name: p.clientName, unpaid: 0 }, no = ro() ? (p.receiptNo || 'REC-PROVISOIRE') : nextReceiptNo(p), C = X.C;
    var row = function (a, b) { return '<tr><td style="padding:10px 14px;color:#6b7a90;font-size:12px;border-bottom:1px solid ' + C.LINE + ';width:38%">' + E(a) + '</td><td style="padding:10px 14px;font-weight:700;color:' + C.NAVY + ';font-size:13px;border-bottom:1px solid ' + C.LINE + '">' + b + '</td></tr>'; };
    var inner = '<div style="padding:34px 40px;font-family:Segoe UI,Arial,sans-serif;color:#1f2d44">' + X.docHeader('REÇU DE PAIEMENT', 'N° ' + no + ' · ' + X.fmtDate(p.date)) +
      '<div style="margin:22px 0;padding:22px;background:' + C.SOFT + ';border-radius:14px;text-align:center"><div style="font-size:12px;color:#6b7a90;letter-spacing:2px">MONTANT REÇU</div><div style="font-size:34px;font-weight:900;color:' + C.NAVY + ';margin-top:4px">' + X.fmt(p.amount) + '</div></div>' +
      '<table style="width:100%;border-collapse:collapse;border:1px solid ' + C.LINE + ';border-radius:10px">' + row('Reçu de', E(c.name || p.clientName)) + row('Date du paiement', X.fmtDate(p.date)) + row('Mode de paiement', E(p.method || '—')) +
      (p.proofRef ? row('Référence de l\'opération', E(p.proofRef)) : '') + (p.note ? row('Note', E(p.note)) : '') + row('Reste à payer après ce paiement', '<span style="color:' + (Number(c.unpaid) > 0 ? '#c0392b' : '#1e8e3e') + '">' + X.fmt(c.unpaid || 0) + '</span>') + '</table>' +
      '<p style="margin-top:26px;font-size:12px;color:#6b7a90;text-align:center">Merci pour votre confiance. Ce reçu atteste du paiement indiqué ci-dessus.</p>' + X.docFooter() + '</div>';
    X.openDoc({ title: 'Reçu ' + no, filename: no + '.pdf', inner: inner, fixed: true });
  };
  window.careProofRef = function (id) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var p = X.find(appState.payments, id); if (!p) return;
    var v = prompt('Référence de l\'opération (n° CCP / BaridiMob / virement) :', p.proofRef || ''); if (v === null) return;
    p.proofRef = v.trim(); p.updatedAt = nowTs(); X.log('Référence de paiement', (p.clientName || '') + ' — ' + p.proofRef); X.save(); X.rerender();
  };
  window.careReceiptMsg = function (id, ch) {
    var p = X.find(appState.payments, id); if (!p) return; var c = byId(p.clientId); if (!c) return X.toast('Client introuvable', 'warning');
    var no = ro() ? (p.receiptNo || '') : nextReceiptNo(p);
    sendVia(ch, c, render('recu', ctxOf(c, { montant: X.fmt(p.amount), date: X.fmtDate(p.date), recu: no })));
  };
  function renderReceipts() {
    var q = (ui.rq || '').toLowerCase(), list = (appState.payments || []).filter(function (p) { return p && (!q || String(p.clientName || '').toLowerCase().indexOf(q) !== -1); }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var rows = list.slice(0, 80).map(function (p) {
      var j = X.js(p.id);
      return '<tr><td class="p-3 text-xs">' + X.fmtDate(p.date) + '</td><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(p.clientName) + '</td><td class="p-3 text-right font-mono font-black text-green-600">' + X.fmt(p.amount) + '</td><td class="p-3 text-xs">' + E(p.method || '') + '</td>' +
        '<td class="p-3 text-xs">' + (p.proofRef ? E(p.proofRef) : '<span class="text-gray-300">—</span>') + '</td><td class="p-3 text-xs font-mono">' + E(p.receiptNo || '—') + '</td>' +
        '<td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="careReceipt(\'' + j + '\')" class="px-2 py-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Voir / PDF"><i class="fas fa-file-pdf"></i></button>' +
        '<button type="button" onclick="careProofRef(\'' + j + '\')" class="px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100" title="Référence CCP / BaridiMob"><i class="fas fa-hashtag"></i></button>' +
        '<button type="button" onclick="careReceiptMsg(\'' + j + '\',\'wa\')" class="px-2 py-1.5 rounded-lg text-green-600 hover:bg-green-50" title="Envoyer (WhatsApp)"><i class="fab fa-whatsapp"></i></button>' +
        '<button type="button" onclick="careReceiptMsg(\'' + j + '\',\'ig\')" class="px-2 py-1.5 rounded-lg text-pink-600 hover:bg-pink-50" title="Envoyer (Instagram)"><i class="fab fa-instagram"></i></button></td></tr>';
    }).join('');
    return X.card('Reçus de paiement', 'fa-receipt', '<p class="text-xs text-gray-500 mb-3">Chaque paiement peut produire un reçu numéroté (REC-AAAA-0001). Ajoutez la référence de l\'opération (n° CCP / BaridiMob) pour garder une preuve en cas de litige.</p>' +
      '<input value="' + E(ui.rq) + '" oninput="careReceiptSearch(this.value)" placeholder="Rechercher un client…" class="w-full md:w-72 mb-3 p-2 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white text-sm">' +
      X.table([['Date'], ['Client'], ['Montant', 'r'], ['Mode'], ['Référence'], ['N° reçu'], ['', 'r']], rows, { empty: 'Aucun paiement enregistré' }));
  }
  window.careReceiptSearch = function (v) { ui.rq = v; clearTimeout(window._careT); window._careT = setTimeout(function () { X.rerender(); var el = document.querySelector('input[oninput^="careReceiptSearch"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300); };

  // ------------------------------------------------------------------ rapport client
  function reportData(c, days) {
    var to = X.today(), from = X.addDays(to, -(Number(days) || 30) + 1);
    var tx = (appState.transactions || []).filter(function (t) { return t && t.clientId === c.id && X.valid(t) && X.isYmd(t.date) && t.date >= from && t.date <= to; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var pays = (appState.payments || []).filter(function (p) { return p && p.clientId === c.id && X.isYmd(p.date) && p.date >= from && p.date <= to; });
    var spent = tx.reduce(function (s, t) { return s + Number(t.priceDzd || 0); }, 0), usd = tx.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0), paid = pays.reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
    return { from: from, to: to, tx: tx, pays: pays, spent: spent, usd: usd, paid: paid };
  }
  function reportSummary(c, r) {
    return '• ' + r.tx.length + ' campagne(s) / recharge(s) sur la période (' + X.usd(r.usd) + ' de budget média)\n• Montant facturé : ' + X.fmt(r.spent) + '\n• Paiements reçus : ' + X.fmt(r.paid) + '\n• Solde à régler : ' + X.fmt(c.unpaid || 0);
  }
  window.careReportSet = function (k, v) { ui[k] = v; };
  window.careReportDoc = function () {
    var c = byId(ui.repClient); if (!c) return X.toast('Choisissez un client', 'warning');
    var note = (document.getElementById('repNote') || {}).value || ''; ui.repNote = note;
    var r = reportData(c, ui.repDays), C = X.C, k = (typeof window.getMetaLiveLastKpis === 'function') ? getMetaLiveLastKpis() : null;
    var kpi = function (l, v) { return '<td style="padding:14px;background:' + C.SOFT + ';border-radius:10px;text-align:center;width:25%"><div style="font-size:10px;color:#6b7a90;letter-spacing:1px">' + E(l) + '</div><div style="font-size:18px;font-weight:900;color:' + C.NAVY + ';margin-top:4px">' + v + '</div></td>'; };
    var rows = r.tx.map(function (t) { return '<tr><td style="padding:8px 10px;border-bottom:1px solid ' + C.LINE + ';font-size:12px">' + X.fmtDate(t.date) + '</td><td style="padding:8px 10px;border-bottom:1px solid ' + C.LINE + ';font-size:12px;font-weight:600">' + E(t.offerName) + '</td><td style="padding:8px 10px;border-bottom:1px solid ' + C.LINE + ';font-size:12px;text-align:right">' + X.usd(t.amount) + '</td><td style="padding:8px 10px;border-bottom:1px solid ' + C.LINE + ';font-size:12px;text-align:right">' + X.fmt(t.priceDzd) + '</td><td style="padding:8px 10px;border-bottom:1px solid ' + C.LINE + ';font-size:12px;text-align:center">' + (t.paid ? 'Payé' : 'À régler') + '</td></tr>'; }).join('') || '<tr><td colspan="5" style="padding:16px;text-align:center;color:#8a97ab;font-size:12px">Aucune campagne sur la période</td></tr>';
    var meta = k ? '<div style="margin-top:18px;padding:14px;border:1px solid ' + C.LINE + ';border-radius:10px"><div style="font-weight:800;color:' + C.NAVY + ';font-size:13px;margin-bottom:6px">Dernière mesure Meta' + (k.campaignName ? ' — ' + E(k.campaignName) : '') + '</div><div style="font-size:12px;color:#1f2d44">Dépense : <b>' + E(Number(k.spend || 0).toFixed(2)) + ' ' + E(k.currency || '') + '</b> · ' + E(k.resultLabel || 'Résultats') + ' : <b>' + E(String(k.results || 0)) + '</b>' + (k.cprFinite ? ' · Coût par résultat : <b>' + E(Number(k.costPerResult || 0).toFixed(2)) + ' ' + E(k.currency || '') + '</b>' : '') + ' · Impressions : <b>' + E(String(k.impressions || 0)) + '</b></div></div>' : '';
    var inner = '<div style="padding:34px 40px;font-family:Segoe UI,Arial,sans-serif;color:#1f2d44">' + X.docHeader('RAPPORT CLIENT', E(c.name) + ' · ' + X.fmtDate(r.from) + ' → ' + X.fmtDate(r.to)) +
      '<table style="width:100%;border-spacing:8px;margin:6px -8px"><tr>' + kpi('CAMPAGNES', String(r.tx.length)) + kpi('BUDGET MÉDIA', X.usd(r.usd)) + kpi('FACTURÉ', X.fmt(r.spent)) + kpi('SOLDE DÛ', X.fmt(c.unpaid || 0)) + '</tr></table>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:10px"><thead><tr style="background:' + C.NAVY + ';color:#fff;font-size:11px"><th style="padding:9px 10px;text-align:left">Date</th><th style="padding:9px 10px;text-align:left">Campagne / offre</th><th style="padding:9px 10px;text-align:right">Budget</th><th style="padding:9px 10px;text-align:right">Montant</th><th style="padding:9px 10px">Statut</th></tr></thead><tbody>' + rows + '</tbody></table>' + meta +
      (note.trim() ? '<div style="margin-top:18px;padding:14px;background:' + C.SOFT + ';border-radius:10px"><div style="font-weight:800;color:' + C.NAVY + ';font-size:13px;margin-bottom:6px">Commentaire de votre conseiller</div><div style="font-size:12px;line-height:1.6;white-space:pre-wrap">' + E(note) + '</div></div>' : '') + X.docFooter() + '</div>';
    X.openDoc({ title: 'Rapport ' + c.name, filename: 'rapport-' + String(c.name).replace(/[^\w]+/g, '-') + '.pdf', inner: inner });
  };
  window.careReportMsg = function (ch) {
    var c = byId(ui.repClient); if (!c) return X.toast('Choisissez un client', 'warning');
    var r = reportData(c, ui.repDays), note = (document.getElementById('repNote') || {}).value || '';
    var text = render('rapport', ctxOf(c, { periode: 'des ' + ui.repDays + ' derniers jours', resume: reportSummary(c, r) + (note.trim() ? '\n\n' + note.trim() : '') }));
    sendVia(ch, c, text);
  };
  function renderReport() {
    var opts = clients().slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }).map(function (c) { return '<option value="' + E(c.id) + '"' + (c.id === ui.repClient ? ' selected' : '') + '>' + E(c.name) + '</option>'; }).join('');
    var k = (typeof window.getMetaLiveLastKpis === 'function') ? getMetaLiveLastKpis() : null, inp = 'w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm';
    return X.card('Rapport de performance client', 'fa-chart-line',
      '<p class="text-xs text-gray-500 mb-3">Génère en un clic un rapport PDF ou un message récapitulatif : campagnes de la période, budget, paiements et solde. Si vous avez chargé une campagne dans « Meta Live », ses derniers résultats (dépense, résultats, coût par résultat) y sont ajoutés.</p>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3"><div><label class="block text-xs font-bold text-gray-500 mb-1">Client</label><select class="' + inp + '" onchange="careReportSet(\'repClient\',this.value)"><option value="">— Choisir —</option>' + opts + '</select></div>' +
      '<div><label class="block text-xs font-bold text-gray-500 mb-1">Période</label><select class="' + inp + '" onchange="careReportSet(\'repDays\',this.value)">' + [['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '90 derniers jours']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.repDays === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<label class="block text-xs font-bold text-gray-500 mb-1">Commentaire pour le client (résultats, conseils…)</label><textarea id="repNote" rows="4" class="' + inp + ' mb-3" placeholder="Ex : Bon retour sur la campagne, nous conseillons d\'augmenter le budget de 20 %…">' + E(ui.repNote) + '</textarea>' +
      (k ? '<p class="text-[11px] text-indigo-600 mb-3"><i class="fas fa-plug mr-1"></i>Mesure Meta détectée : ' + E(k.campaignName || 'campagne') + ' — elle sera incluse dans le PDF.</p>' : '') +
      '<div class="flex flex-wrap gap-2"><button type="button" onclick="careReportDoc()" class="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-700 text-white"><i class="fas fa-file-pdf mr-1"></i>Aperçu / PDF</button>' +
      '<button type="button" onclick="careReportMsg(\'wa\')" class="px-4 py-2 rounded-xl font-bold text-sm bg-green-600 hover:bg-green-700 text-white"><i class="fab fa-whatsapp mr-1"></i>Message WhatsApp</button>' +
      '<button type="button" onclick="careReportMsg(\'ig\')" class="px-4 py-2 rounded-xl font-bold text-sm text-white" style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888)"><i class="fab fa-instagram mr-1"></i>Message Instagram</button></div>');
  }

  // ------------------------------------------------------------------ tableau de bord employé
  function myId() { var s = appState.session; return s && s.type === 'employee' ? (s.employeeId || '') : (ui.empId || ''); }
  window.careEmp = function (v) { ui.empId = v; X.rerender(); };
  function renderMe() {
    var s = appState.session, isEmp = s && s.type === 'employee', emps = (appState.employees || []).filter(function (e) { return e && e.active !== false; }), id = myId(), me = X.find(appState.employees, id);
    var picker = isEmp ? '' : '<div class="mb-4"><label class="block text-xs font-bold text-gray-500 mb-1">Employé</label><select onchange="careEmp(this.value)" class="p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"><option value="">— Choisir un employé —</option>' + emps.map(function (e) { return '<option value="' + E(e.id) + '"' + (e.id === id ? ' selected' : '') + '>' + E(e.name || e.login) + '</option>'; }).join('') + '</select></div>';
    if (!me) return X.card('Mon tableau de bord', 'fa-gauge-high', picker + '<p class="text-sm text-gray-500">' + (isEmp ? 'Votre fiche employé est introuvable.' : 'Choisissez un employé pour voir son tableau de bord.') + '</p>');
    var m = X.month(), rg = X.monthRange(m), td = X.today(), T = window.TeamOrg;
    var own = T ? T.ownTasks(id, rg.from, rg.to) : 0, team = T ? T.teamTasks(id, rg.from, rg.to) : 0, today = T ? T.ownTasks(id, td, td) : 0, goal = Number(S.map('goals')[id]) || 0;
    var mine = pendingOrders().filter(function (x) { return x.t.launchedById === id || x.t.employeeId === id; }), pool = pendingOrders(), pct = goal > 0 ? Math.min(100, Math.round(own / goal * 100)) : 0;
    var bonus = T && T.teamBonus ? T.teamBonus(id, m) : null;
    var rows = pool.slice(0, 30).map(function (x) { return '<tr class="' + (x.late ? 'bg-red-50/60 dark:bg-red-900/10' : '') + '"><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.t.clientName) + '<div class="text-[11px] font-normal text-gray-400">' + E(x.t.offerName) + '</div></td><td class="p-3 text-center text-xs">' + (x.prog ? 'En cours' : 'Reçue') + '</td><td class="p-3 text-center text-xs ' + (x.late ? 'text-red-600 font-black' : '') + '">' + fmtH(x.hours) + (x.late ? ' ⚠' : '') + '</td></tr>'; }).join('');
    return X.card('Tableau de bord — ' + (me.name || me.login), 'fa-gauge-high', picker +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + X.kpi('Tâches aujourd\'hui', String(today), '', 'fa-calendar-day') + X.kpi('Tâches du mois', String(own), '', 'fa-list-check') + X.kpi('Points d\'équipe', String(team), team ? 'text-indigo-600' : '', 'fa-people-group') + X.kpi('Mes commandes en retard', String(mine.filter(function (x) { return x.late; }).length), mine.some(function (x) { return x.late; }) ? 'text-red-600' : 'text-green-600', 'fa-clock') + '</div>' +
      (goal > 0 ? '<div class="mb-4"><div class="flex justify-between text-xs font-bold text-gray-500 mb-1"><span>Objectif du mois</span><span>' + own + ' / ' + goal + ' (' + pct + ' %)</span></div><div class="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden"><div class="h-3 rounded-full ' + (pct >= 100 ? 'bg-green-500' : 'bg-indigo-500') + '" style="width:' + pct + '%"></div></div></div>' : '') +
      (bonus && bonus.enabled && bonus.members ? '<p class="text-xs text-gray-500 mb-4">Prime d\'encadrement estimée ce mois : <b>' + X.fmt(bonus.total) + '</b> (' + bonus.members + ' membre(s), ' + bonus.teamTasks + ' tâche(s) d\'équipe)</p>' : '') +
      '<h4 class="text-sm font-black text-gray-700 dark:text-gray-200 mb-2">File de travail (commandes ouvertes)</h4>' + X.table([['Commande'], ['Statut', 'c'], ['Attente', 'c']], rows, { empty: 'Rien en attente 🎉' }));
  }

  // ------------------------------------------------------------------ messages & réglages
  function renderSettings() {
    var s = cfg(), inp = 'w-full p-2 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white text-sm', admin = X.isAdmin() && !ro();
    var f = function (id, label, v, hint) { return '<div><label class="block text-xs font-bold text-gray-500 mb-1">' + label + '</label><input id="' + id + '" type="number" min="0" value="' + v + '" class="' + inp + '"' + (admin ? '' : ' disabled') + '>' + (hint ? '<p class="text-[10px] text-gray-400 mt-1">' + hint + '</p>' : '') + '</div>'; };
    var set = X.card('Réglages', 'fa-sliders', '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">' +
      f('cs-dormant', 'Client « inactif » après (jours)', s.dormantDays) + f('cs-gap', 'Pas de nouvelle relance avant (jours)', s.pingGapDays) + f('cs-hp', 'Délai cible de prise en charge (h)', s.hoursPending, '0 = pas d\'alerte') +
      f('cs-hg', 'Délai cible de livraison (h)', s.hoursProgress, '0 = pas d\'alerte') + f('cs-margin', 'Marge minimale (%) à la saisie', s.minMarginPct, 'Avertissement en dessous') + f('cs-dup', 'Fenêtre anti-doublon (min)', s.dupMinutes) + '</div>' +
      (admin ? '<button type="button" onclick="careSaveSettings()" class="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-700 text-white">Enregistrer</button>' : '<p class="text-xs text-gray-400">Réservé à l\'administrateur.</p>'));
    var tpls = X.card('Bibliothèque de messages types', 'fa-comments', '<p class="text-xs text-gray-500 mb-3">Variables disponibles : <code>{client}</code> <code>{montant}</code> <code>{solde}</code> <code>{offre}</code> <code>{facture}</code> <code>{recu}</code> <code>{jours}</code> <code>{date}</code> <code>{agence}</code>. Les messages s\'utilisent partout dans « Relation client ».</p>' +
      Object.keys(TPL).map(function (k) {
        return '<div class="mb-4"><div class="flex items-center justify-between mb-1"><label class="text-xs font-black text-gray-600 dark:text-gray-300">' + E(TPL[k][0]) + '</label>' + (admin ? '<span><button type="button" onclick="careTplSave(\'' + k + '\')" class="text-xs font-bold text-indigo-600 mr-3">Enregistrer</button><button type="button" onclick="careTplReset(\'' + k + '\')" class="text-xs text-gray-400">Par défaut</button></span>' : '') + '</div>' +
          '<textarea id="tpl-' + k + '" rows="3" ' + (admin ? '' : 'readonly ') + 'class="w-full p-3 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white text-sm">' + E(tplText(k)) + '</textarea></div>';
      }).join(''));
    return set + tpls;
  }

  // ------------------------------------------------------------------ onglet
  var SUBS = [['relances', 'Relances', 'fa-bullhorn'], ['orders', 'Suivi commandes', 'fa-list-check'], ['receipts', 'Reçus', 'fa-receipt'], ['report', 'Rapport client', 'fa-chart-line'], ['me', 'Mon tableau', 'fa-gauge-high'], ['settings', 'Messages & réglages', 'fa-comments']];
  window.careSub = function (s) { ui.sub = s; X.rerender(); };
  X.registerTab('care', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'Relation client', icon: 'fa-handshake' },
    render: function (c) {
      var fn = { relances: renderRelances, orders: renderOrders, receipts: renderReceipts, report: renderReport, me: renderMe, settings: renderSettings }[ui.sub] || renderRelances;
      c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-handshake text-indigo-600 mr-2"></i>Relation client</h2><p class="text-xs text-gray-500 mt-1">Relances, suivi des commandes, reçus, avis et rapports : tout pour que vos clients se sentent suivis.</p></div>' + X.pills(SUBS, ui.sub, 'careSub') + fn();
    }
  });

  // ------------------------------------------------------------------ garde-fous à la saisie : doublon + marge
  X.wrap('handleNewTodoSubmit', function (mode, ev) {
    try {
      var form = document.getElementById('newTodoForm'); if (form && !form.checkValidity()) return;
      var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
      var clientId = v('todoClientId'), offerId = v('todoOfferId'), price = Number(v('todoPrice')) || 0; if (!clientId || !offerId || price <= 0) return;
      var s = cfg(), custom = offerId === '__custom__', offer = custom ? null : X.find(appState.offers, offerId), usd = custom ? Number(v('todoCustomUsd')) || 0 : Number(offer && offer.costPerUnit) || 0;
      var name = custom ? (v('todoCustomName') || '').trim() : (offer && offer.name) || '', msgs = [];
      if (s.dupMinutes > 0) {
        var lim = nowTs() - s.dupMinutes * 60000, dup = (appState.todoTransactions || []).concat(appState.transactions || []).filter(function (t) {
          return t && t.clientId === clientId && Number(t.priceDzd) === price && Number(t.createdAt || 0) > lim && (custom ? String(t.offerName || '') === (name || 'Offre personnalisée') : t.offerId === offerId);
        })[0];
        if (dup) msgs.push('⚠ DOUBLON POSSIBLE : une commande identique (« ' + (dup.offerName || name) + ' », ' + X.fmt(price) + ') a été créée pour ce client il y a ' + Math.max(1, Math.round((nowTs() - dup.createdAt) / 60000)) + ' min.');
      }
      var rate = typeof getBuyRate === 'function' ? Number(getBuyRate()) || 0 : 0;
      if (usd > 0 && rate > 0 && s.minMarginPct >= 0) {
        var cost = usd * rate, pct = (price - cost) / price * 100;
        if (pct < s.minMarginPct) msgs.push((pct < 0 ? '⚠ VENTE À PERTE' : '⚠ MARGE FAIBLE') + ' : prix ' + X.fmt(price) + ', coût estimé ' + X.fmt(cost) + ' (' + X.usd(usd) + ' × ' + rate + ') → marge ' + pct.toFixed(1) + ' % (minimum ' + s.minMarginPct + ' %).');
      }
      var paidEl = document.getElementById('todoPaid'), accEl = document.getElementById('todoPaidAccount');
      if (paidEl && paidEl.checked && accEl && accEl.value === 'avance') {
        var cl = byId(clientId), credit = cl ? Math.max(0, -Number(cl.unpaid || 0)) : 0;
        if (credit <= 0) msgs.push('⚠ AVANCE : ce client n\'a aucune avance enregistrée. La vente sera comptée entièrement comme dette (aucun argent n\'entre en caisse). Si le client paie maintenant, enregistrez d\'abord son paiement dans « Paiements ».');
        else if (credit < price) msgs.push('ℹ AVANCE : le client a ' + X.fmt(credit) + ' d\'avance pour une vente de ' + X.fmt(price) + '. Le reste (' + X.fmt(price - credit) + ') restera à payer.');
      }
      if (msgs.length && !confirm(msgs.join('\n\n') + '\n\nContinuer quand même ?')) { if (ev && ev.preventDefault) ev.preventDefault(); return false; }
    } catch (e) { console.warn('clientcare check', e); }
  });


  // affiche l'avance disponible du client dans le formulaire « Nouvelle To-Do »
  function refreshAdvanceLabel() {
    var sel = document.getElementById('todoPaidAccount'), cid = (document.getElementById('todoClientId') || {}).value;
    if (!sel) return; var opt = Array.prototype.filter.call(sel.options, function (o) { return o.value === 'avance'; })[0]; if (!opt) return;
    var c = cid ? byId(cid) : null, credit = c ? Math.max(0, -Number(c.unpaid || 0)) : 0;
    opt.textContent = '🧾 Avance du client' + (c ? ' (disponible : ' + X.fmt(credit) + ')' : ' (déjà encaissée)');
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'todoClientId') refreshAdvanceLabel(); });
  document.addEventListener('ext:rendered', refreshAdvanceLabel);

  // reçu proposé après un paiement
  X.wrap('addPayment', function () { window._careBefore = (appState.payments || []).length; }, function () {
    try {
      var l = appState.payments || [], p = l[l.length - 1];
      if (l.length > (window._careBefore || 0) && p && !ro()) { nextReceiptNo(p); setTimeout(function () { if (confirm('Paiement enregistré (reçu ' + p.receiptNo + ').\nVoir / envoyer le reçu au client ?')) careReceipt(p.id); }, 500); }
    } catch (e) {}
  });

  // ------------------------------------------------------------------ alertes (cloche) – branchées par control.js
  window.ClientCareAlerts = function (add) {
    var late = pendingOrders().filter(function (x) { return x.late; });
    if (late.length) add('danger', 'fa-clock', late.length + ' commande(s) en retard de traitement', late.map(function (x) { return x.t.clientName; }).slice(0, 3).join(', '), 'care', late.length);
    var bad = (appState.transactions || []).filter(function (t) { return t && t.csat && t.csat <= 2 && Number(t.csatAt || 0) > nowTs() - 14 * 86400000; });
    if (bad.length) add('danger', 'fa-face-frown', bad.length + ' avis client négatif(s) (≤ 2/5)', bad.map(function (t) { return t.clientName; }).slice(0, 3).join(', '), 'care', bad.length);
    if (window.Integrity && X.isAdmin()) { var ic = Integrity.count(); if (ic) add('warn', 'fa-shield-halved', ic + ' anomalie(s) financière(s) à vérifier', 'Lignes incomplètes ou soldes clients incohérents', 'integrity', ic); }
    var dm = dormantList().filter(function (x) { return !x.recent; });
    if (dm.length) add('info', 'fa-person-walking-arrow-right', dm.length + ' client(s) qui s\'éloignent à relancer', dm.slice(0, 3).map(function (x) { return x.c.name; }).join(', '), 'care', dm.length);
  };
  window.ClientCare = { cfg: cfg, pendingOrders: pendingOrders, dormantList: dormantList, render: render };
})();
