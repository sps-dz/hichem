// =====================================================================
//  TEAM.JS — hiérarchie, points d'équipe et primes d'encadrement
//  Règle d'or comptable : UNE tâche = UNE ligne dans les statistiques globales.
//    • Tâche de l'employé X  → comptée dans les tâches PERSONNELLES de X
//                              + « créditée » à chacun de ses responsables (points d'équipe)
//    • Les crédits d'équipe ne sont JAMAIS additionnés dans les totaux société :
//      total société = somme des tâches personnelles (chaque transaction une seule fois).
//  Données : employees[].title / employees[].managerId (collection employees déjà synchronisée),
//  réglages dans ExtStore('team'). Rien d'existant n'est modifié ; le comportement par défaut
//  (prime d'équipe désactivée) est identique à avant.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;

  var TITLES = ['Directeur', 'Responsable d\'équipe', 'Chef d\'équipe', 'Media buyer senior', 'Media buyer', 'Assistant', 'Stagiaire'];

  function emps() { return (window.appState && appState.employees) || []; }
  function byId(id) { return emps().find(function (e) { return e && e.id === id; }); }
  function can() { var s = appState.session; return !s || s.type !== 'employee' || !!(s.permissions && s.permissions.payroll === true); }
  function cfg() {
    var c = S.get('team', {}) || {};
    return { enabled: !!c.enabled, leadRate: Number(c.leadRate) || 0, scale: Array.isArray(c.scale) ? c.scale.filter(function (r) { return Number(r.min) > 0 && Number(r.bonus) >= 0; }) : [], targetBonus: Number(c.targetBonus) || 0 };
  }

  // ------------------------------------------------------------------ hiérarchie
  function directReports(id) { return emps().filter(function (e) { return e && e.managerId === id && e.id !== id; }); }
  function descendants(id) {                                      // tous les niveaux, protégé contre les cycles
    var seen = {}, out = [], queue = [id]; seen[id] = true;
    while (queue.length) { var cur = queue.shift(); directReports(cur).forEach(function (e) { if (!seen[e.id]) { seen[e.id] = true; out.push(e.id); queue.push(e.id); } }); }
    return out;
  }
  function managersOf(id) {                                       // chaîne de responsables (du plus proche au plus haut)
    var out = [], seen = {}; seen[id] = true; var cur = byId(id);
    while (cur && cur.managerId && !seen[cur.managerId]) { seen[cur.managerId] = true; var m = byId(cur.managerId); if (!m) break; out.push(m.id); cur = m; }
    return out;
  }
  function wouldCycle(empId, newManagerId) { return !!newManagerId && (newManagerId === empId || descendants(empId).indexOf(newManagerId) !== -1); }
  function titleOf(e) { return (e && e.title) ? String(e.title) : ''; }

  // ------------------------------------------------------------------ comptage (une transaction = une fois)
  function inRange(t, from, to) { return t && X.isYmd(t.date) && t.date >= from && t.date <= to; }
  function countFor(ids, from, to) {
    var set = {}; ids.forEach(function (i) { set[i] = true; }); var n = 0;
    (appState.transactions || []).forEach(function (t) { if (t && t.employeeId && set[t.employeeId] && inRange(t, from, to)) n++; });
    return n;
  }
  function ownTasks(id, from, to) { return countFor([id], from, to); }
  function teamTasks(id, from, to) { var d = descendants(id); return d.length ? countFor(d, from, to) : 0; }
  function pointsOf(id, from, to) { return ownTasks(id, from, to) + teamTasks(id, from, to); }

  // ------------------------------------------------------------------ prime d'encadrement (mensuelle)
  function teamBonus(id, month) {
    var c = cfg(), zero = { enabled: c.enabled, members: 0, teamTasks: 0, rateBonus: 0, scaleBonus: 0, targetBonus: 0, targetAim: 0, total: 0 };
    if (!c.enabled) return zero;
    var members = descendants(id); if (!members.length) return zero;
    var r = X.monthRange(month), tt = countFor(members, r.from, r.to), goals = S.map('goals'), aim = members.reduce(function (s, m) { return s + (Number(goals[m]) || 0); }, 0);
    var rateBonus = tt * c.leadRate, sc = 0, scale = c.scale.slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < scale.length; i++) if (tt >= Number(scale[i].min)) { sc = Number(scale[i].bonus) || 0; break; }
    var tb = (c.targetBonus > 0 && aim > 0 && tt >= aim) ? c.targetBonus : 0;
    return { enabled: true, members: members.length, teamTasks: tt, rateBonus: rateBonus, scaleBonus: sc, targetBonus: tb, targetAim: aim, total: Math.round(rateBonus + sc + tb) };
  }

  // ------------------------------------------------------------------ rapprochement : aucun double comptage
  function reconcile(from, to) {
    var all = (appState.transactions || []).filter(function (t) { return inRange(t, from, to); }), ids = {}; emps().forEach(function (e) { ids[e.id] = true; });
    var total = all.length, none = 0, orphan = 0, personal = 0;
    all.forEach(function (t) { if (!t.employeeId) none++; else if (!ids[t.employeeId]) orphan++; else personal++; });
    var perEmpSum = emps().reduce(function (s, e) { return s + ownTasks(e.id, from, to); }, 0);
    var credits = 0; emps().forEach(function (e) { credits += teamTasks(e.id, from, to); });
    return { total: total, personal: personal, none: none, orphan: orphan, perEmpSum: perEmpSum, credits: credits, ok: perEmpSum === personal && (personal + none + orphan === total) };
  }

  window.TeamOrg = { directReports: directReports, descendants: descendants, managersOf: managersOf, ownTasks: ownTasks, teamTasks: teamTasks, pointsOf: pointsOf, teamBonus: teamBonus, reconcile: reconcile, config: cfg, titleOf: titleOf, wouldCycle: wouldCycle };

  // ------------------------------------------------------------------ actions
  function after() { X.save(); if (typeof window.refreshPayroll === 'function') window.refreshPayroll(); if (typeof renderCurrentTab === 'function' && appState.currentTab === 'performance') renderCurrentTab(); }
  window.teamSetTitle = function (id, v) {
    if (!can()) return X.toast('Accès refusé', 'error'); var e = byId(id); if (!e) return;
    var t = String(v || '').trim().slice(0, 60); if ((e.title || '') === t) return;
    var old = e.title || '—'; e.title = t; e.updatedAt = Date.now(); X.log('Poste modifié', (e.name || e.login) + ' : ' + old + ' → ' + (t || '—')); after();
  };
  window.teamSetManager = function (id, mid) {
    if (!can()) return X.toast('Accès refusé', 'error'); var e = byId(id); if (!e) return;
    if (wouldCycle(id, mid)) { X.toast('Impossible : cela créerait une boucle hiérarchique', 'error'); return window.refreshPayroll && window.refreshPayroll(); }
    if ((e.managerId || '') === (mid || '')) return;
    var oldM = byId(e.managerId), newM = byId(mid);
    e.managerId = mid || ''; e.updatedAt = Date.now();
    X.log('Responsable modifié', (e.name || e.login) + ' : ' + (oldM ? (oldM.name || oldM.login) : '—') + ' → ' + (newM ? (newM.name || newM.login) : '—'));
    X.toast('Hiérarchie mise à jour (les mois figés ne changent pas)', 'success'); after();
  };
  window.teamSaveSettings = function () {
    if (!can()) return X.toast('Accès refusé', 'error');
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; }, scale = [];
    for (var i = 0; i < 3; i++) { var mn = Number(g('tm-min' + i)), bn = Number(g('tm-bonus' + i)); if (mn > 0 && g('tm-bonus' + i) !== '' && bn >= 0) scale.push({ min: mn, bonus: bn }); }
    var c = { enabled: document.getElementById('tm-enabled').checked, leadRate: Math.max(0, Number(g('tm-rate')) || 0), scale: scale, targetBonus: Math.max(0, Number(g('tm-target')) || 0) };
    S.set('team', c, true);
    X.log('Règles de prime d\'équipe modifiées', (c.enabled ? 'activées' : 'désactivées') + ' — ' + X.fmt(c.leadRate) + ' / tâche d\'équipe, ' + scale.length + ' palier(s), prime objectif ' + X.fmt(c.targetBonus));
    X.toast('Règles enregistrées', 'success'); after();
  };

  // ------------------------------------------------------------------ interface (insérée dans la section Paie)
  function chart(parentId, depth, seen) {
    var kids = parentId === null ? emps().filter(function (e) { return !e.managerId || !byId(e.managerId) || e.managerId === e.id; }) : directReports(parentId);
    if (!kids.length) return '';
    return '<ul class="' + (depth ? 'ml-5 pl-3 border-l-2 border-indigo-100 dark:border-gray-700' : '') + ' space-y-1">' + kids.filter(function (e) { return !seen[e.id]; }).map(function (e) {
      seen[e.id] = true; var n = descendants(e.id).length;
      return '<li><div class="flex items-center gap-2 py-1"><span class="w-7 h-7 rounded-full ' + (n ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-200') + ' text-xs font-black flex items-center justify-center">' + E(String(e.name || e.login || '?').charAt(0).toUpperCase()) + '</span><span class="font-bold text-gray-800 dark:text-white text-sm">' + E(e.name || e.login) + '</span>' + (e.title ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700">' + E(e.title) + '</span>' : '') + (n ? '<span class="text-[10px] text-gray-400">' + n + ' dans l\'équipe</span>' : '') + (e.active === false ? '<span class="text-[10px] text-red-400">inactif</span>' : '') + '</div>' + chart(e.id, depth + 1, seen) + '</li>';
    }).join('') + '</ul>';
  }
  window.TeamOrg.html = function (month) {
    var r = X.monthRange(month), c = cfg(), inp = X.input, list = emps().slice().sort(function (a, b) { return String(a.name || a.login).localeCompare(String(b.name || b.login)); });
    var rows = list.map(function (e) {
      var own = ownTasks(e.id, r.from, r.to), tt = teamTasks(e.id, r.from, r.to), tb = teamBonus(e.id, month), blocked = {}; descendants(e.id).forEach(function (d) { blocked[d] = true; }); blocked[e.id] = true;
      var opts = '<option value="">— Aucun (direction) —</option>' + list.filter(function (m) { return !blocked[m.id]; }).map(function (m) { return '<option value="' + E(m.id) + '"' + (m.id === e.managerId ? ' selected' : '') + '>' + E(m.name || m.login) + '</option>'; }).join('');
      var perf = (window.getPrimeForGain ? getPrimeForGain(own * ((window.getPerformanceConfig ? getPerformanceConfig().ratePerTask : 1700) || 1700)) : 0);
      return '<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/40"><td class="p-3 font-bold text-gray-800 dark:text-white whitespace-nowrap">' + E(e.name || e.login) + (e.active === false ? ' <span class="text-[10px] text-red-400">inactif</span>' : '') + '</td>' +
        '<td class="p-3"><input list="team-titles" value="' + E(e.title || '') + '" placeholder="Poste…" onchange="teamSetTitle(\'' + X.js(e.id) + '\', this.value)" class="' + inp + ' w-44"></td>' +
        '<td class="p-3"><select onchange="teamSetManager(\'' + X.js(e.id) + '\', this.value)" class="' + inp + ' w-44">' + opts + '</select></td>' +
        '<td class="p-3 text-right">' + directReports(e.id).length + '</td><td class="p-3 text-right font-bold text-indigo-600">' + own + '</td><td class="p-3 text-right font-bold ' + (tt ? 'text-purple-600' : 'text-gray-300') + '">' + (tt || '—') + '</td>' +
        '<td class="p-3 text-right font-black">' + (own + tt) + '</td><td class="p-3 text-right font-mono text-green-700">' + (perf ? '+' + X.nf(perf) : '—') + '</td><td class="p-3 text-right font-mono ' + (tb.total ? 'text-purple-700 font-bold' : 'text-gray-300') + '">' + (tb.total ? '+' + X.nf(tb.total) : '—') + '</td></tr>';
    }).join('');
    var rec = reconcile(r.from, r.to);
    var scale = c.scale.slice().sort(function (a, b) { return a.min - b.min; }); while (scale.length < 3) scale.push({ min: '', bonus: '' });
    var s3 = scale.slice(0, 3).map(function (t, i) { return '<div class="flex gap-2 mb-2"><input id="tm-min' + i + '" type="number" placeholder="équipe ≥ (tâches)" value="' + E(t.min) + '" class="' + inp + ' w-1/2"><input id="tm-bonus' + i + '" type="number" placeholder="prime (DA)" value="' + E(t.bonus) + '" class="' + inp + ' w-1/2"></div>'; }).join('');
    var chartHtml = chart(null, 0, {}) || '<p class="text-sm text-gray-400 italic">Aucun salarié.</p>';
    return '<div class="mt-8 rounded-3xl border dark:border-gray-700 p-5"><div class="flex flex-wrap items-center justify-between gap-2 mb-1"><h3 class="text-xl font-bold text-gray-800 dark:text-white"><i class="fas fa-sitemap text-indigo-600 mr-2"></i>Organisation & primes d\'équipe</h3><span class="text-xs font-bold text-gray-400">' + E(X.monthLabel(month)) + '</span></div>' +
      '<p class="text-xs text-gray-500 mb-4">Chaque tâche reste comptée <b>une seule fois</b> dans les statistiques globales ; elle est attribuée à son auteur et <b>créditée</b> à son(ses) responsable(s) comme « points d\'équipe ».</p>' +
      '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4"><div class="lg:col-span-2 overflow-x-auto rounded-2xl border dark:border-gray-700"><datalist id="team-titles">' + TITLES.map(function (t) { return '<option value="' + E(t) + '">'; }).join('') + '</datalist><table class="w-full text-sm"><thead><tr class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-[11px] font-black uppercase"><th class="p-3 text-left">Salarié</th><th class="p-3 text-left">Poste</th><th class="p-3 text-left">Responsable</th><th class="p-3 text-right">Équipe</th><th class="p-3 text-right">Tâches perso</th><th class="p-3 text-right">Tâches équipe</th><th class="p-3 text-right">Points</th><th class="p-3 text-right">Prime perso</th><th class="p-3 text-right">Prime équipe</th></tr></thead><tbody class="divide-y dark:divide-gray-700">' + (rows || '<tr><td colspan="9" class="p-6 text-center text-gray-400 italic">Aucun salarié</td></tr>') + '</tbody></table></div>' +
      '<div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-2 text-sm"><i class="fas fa-diagram-project text-indigo-500 mr-2"></i>Organigramme</h4>' + chartHtml + '</div></div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-1 text-sm"><i class="fas fa-award text-indigo-500 mr-2"></i>Règles de prime d\'encadrement</h4><p class="text-[11px] text-gray-400 mb-3">Appliquées au responsable sur les tâches de TOUTE son équipe (tous niveaux) pour le mois. Désactivé par défaut.</p>' +
        '<label class="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200 mb-3"><input type="checkbox" id="tm-enabled" ' + (c.enabled ? 'checked' : '') + '> Activer la prime d\'équipe</label>' +
        '<label class="text-xs font-bold text-gray-500">Commission par tâche d\'équipe (DA)</label><input id="tm-rate" type="number" min="0" value="' + E(c.leadRate || '') + '" placeholder="ex : 300" class="' + inp + ' w-full mb-3">' +
        '<div class="text-xs font-bold text-gray-500 mb-1">Paliers d\'équipe : tâches de l\'équipe ≥ seuil → prime</div>' + s3 +
        '<label class="text-xs font-bold text-gray-500">Prime « objectif d\'équipe atteint » (DA)</label><input id="tm-target" type="number" min="0" value="' + E(c.targetBonus || '') + '" placeholder="versée si tâches équipe ≥ somme des objectifs (Pilotage)" class="' + inp + ' w-full mb-3">' +
        '<button onclick="teamSaveSettings()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm">Enregistrer les règles</button></div>' +
      '<div class="rounded-2xl border dark:border-gray-700 p-4"><h4 class="font-bold text-gray-800 dark:text-white mb-2 text-sm"><i class="fas fa-scale-balanced text-indigo-500 mr-2"></i>Contrôle anti-double comptage</h4>' +
        '<table class="w-full text-sm"><tbody class="divide-y dark:divide-gray-700"><tr><td class="py-2 text-gray-600 dark:text-gray-300">Tâches uniques du mois (statistique globale)</td><td class="py-2 text-right font-black">' + rec.total + '</td></tr>' +
        '<tr><td class="py-2 text-gray-600 dark:text-gray-300">dont attribuées à un salarié</td><td class="py-2 text-right">' + rec.personal + '</td></tr><tr><td class="py-2 text-gray-600 dark:text-gray-300">dont non attribuées / salarié supprimé</td><td class="py-2 text-right">' + (rec.none + rec.orphan) + '</td></tr>' +
        '<tr><td class="py-2 text-gray-600 dark:text-gray-300">Somme des tâches personnelles</td><td class="py-2 text-right">' + rec.perEmpSum + '</td></tr><tr><td class="py-2 text-purple-700">Crédits d\'équipe (non additionnés au total)</td><td class="py-2 text-right text-purple-700 font-bold">' + rec.credits + '</td></tr></tbody></table>' +
        '<div class="mt-3 p-3 rounded-xl text-sm font-bold ' + (rec.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200') + '">' + (rec.ok ? '<i class="fas fa-circle-check mr-2"></i>Aucun double comptage : total = somme des tâches personnelles' : '<i class="fas fa-triangle-exclamation mr-2"></i>Écart détecté — vérifiez les attributions') + '</div></div></div></div>';
  };
})();
