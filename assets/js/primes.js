// =====================================================================
//  PRIMES.JS — primes d'équipe : un barème en POINTS pour le chargé d'équipe, et 50 % à 80 % de sa prime pour chaque salarié de son équipe
//  MODE « Équipe » (par défaut) :
//    • Points d'une équipe pour un mois = tâches du chargé d'équipe + tâches de ses salariés. Les tâches NON ATTRIBUÉES
//      (sans salarié) → ainsi TOUS les points saisis sont comptés, chacun une seule fois (non attribués : à la Direction — Hichem, directeur —, sans prime).
//    • Prime du chargé d'équipe = barème en points (minimum et maximum calqués sur l'ancien barème : 5 000 → 15 000 DA).
//    • Chaque salarié de l'équipe reçoit entre « minimum % » (50 %) et « maximum % » (80 %) de la prime de son chargé :
//      50 % de base, jusqu'à 80 % selon l'atteinte de son objectif mensuel (Pilotage › objectifs). Sans objectif : le minimum.
//    • La prime d'encadrement avancée n'est pas ajoutée (pas de double comptage).
//  MODE « Classique » : comportement d'avant, strictement identique.
//  Les mois figés gardent leurs chiffres ; les primes exceptionnelles manuelles ne changent pas.
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;
  var DEFAULT_SCALE = [{ min: 130, bonus: 5000 }, { min: 200, bonus: 8000 }, { min: 300, bonus: 12000 }, { min: 400, bonus: 15000 }];
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : (d || 0); }
  function emps() { return (appState.employees || []).filter(Boolean); }
  function byId(id) { return emps().find(function (e) { return e.id === id; }); }
  function cfg() {
    var c = S.get('primeRules', {}) || {};
    var sc = Array.isArray(c.scale) ? c.scale.filter(function (r) { return num(r.min) > 0 && num(r.bonus) >= 0; }).map(function (r) { return { min: num(r.min), bonus: num(r.bonus) }; }) : [];
    var mn = Math.min(100, Math.max(0, num(c.minPct, 50))), mx = Math.min(100, Math.max(mn, num(c.maxPct, 80)));
    return { mode: c.mode === 'classic' ? 'classic' : 'lead', minPct: mn, maxPct: mx, scale: sc.length ? sc : DEFAULT_SCALE, defaultLead: c.defaultLead || '', directorName: String(c.directorName || 'Hichem') };
  }
  function mode() { return cfg().mode; }
  function reports(id) { return window.TeamOrg ? TeamOrg.directReports(id) : []; }
  function isLead(id) { return !!(id && id !== 'unassigned' && byId(id) && reports(id).length > 0); }
  function leads() { return emps().filter(function (e) { return e.active !== false && isLead(e.id); }); }
  // '' = les points non attribués vont à la Direction (Hichem, directeur : pas de prime) ; sinon l'id d'un chargé d'équipe choisi
  function defaultLeadId() { var c = cfg(); return c.defaultLead && leads().some(function (e) { return e.id === c.defaultLead; }) ? c.defaultLead : ''; }
  function directorLabel() { return cfg().directorName + ' (Directeur)'; }
  function covered() { var set = {}; leads().forEach(function (e) { set[e.id] = true; TeamOrg.descendants(e.id).forEach(function (d) { set[d] = true; }); }); return set; }
  function inRange(t, from, to) { return t && X.isYmd(t.date) && t.date >= from && t.date <= to; }
  function orphanCount(from, to) { var cov = covered(); var n = 0; (appState.transactions || []).forEach(function (t) { if (inRange(t, from, to) && (!t.employeeId || !cov[t.employeeId])) n++; }); return n; }
  function scalePrime(points) { var s = cfg().scale.slice().sort(function (a, b) { return b.min - a.min; }); for (var i = 0; i < s.length; i++) if (points >= s[i].min) return s[i].bonus; return 0; }
  function oldScale(g) { return typeof window.getPrimeForGain === 'function' ? getPrimeForGain(g) : 0; }
  function canManage() { var s = appState.session; return !s || s.type !== 'employee' || !!(s.permissions && s.permissions.payroll === true); }

  function leadResult(id, from, to) {
    var own = TeamOrg.ownTasks(id, from, to), team = TeamOrg.teamTasks(id, from, to), orph = id === defaultLeadId() ? orphanCount(from, to) : 0, pts = own + team + orph;
    return { role: 'lead', lead: true, own: own, team: team, orphans: orph, tasks: pts, teamTasks: team + orph, prime: scalePrime(pts) };
  }
  // résultat de prime d'un salarié pour une période (un mois en général)
  function forRange(id, from, to, rate) {
    rate = num(rate);
    var own = TeamOrg ? TeamOrg.ownTasks(id, from, to) : 0, c = cfg();
    if (c.mode === 'classic') return { role: 'classic', lead: isLead(id), tasks: own, teamTasks: 0, gain: own * rate, prime: oldScale(own * rate) };
    if (isLead(id)) { var L = leadResult(id, from, to); L.gain = L.tasks * rate; return L; }
    var chain = TeamOrg && byId(id) ? TeamOrg.managersOf(id) : [], leadId = chain.filter(isLead)[0];
    if (!leadId) return { role: 'none', lead: false, tasks: own, teamTasks: 0, gain: own * rate, prime: 0 };
    var lp = leadResult(leadId, from, to).prime, goal = num((S.map('goals') || {})[id]), factor = goal > 0 ? Math.min(1, own / goal) : 0;
    var pct = c.minPct + (c.maxPct - c.minPct) * factor, lead = byId(leadId);
    return { role: 'member', lead: false, tasks: own, teamTasks: 0, gain: own * rate, prime: Math.round(lp * pct / 100), pct: Math.round(pct * 10) / 10, leadId: leadId, leadName: lead ? (lead.name || lead.login) : '', leadPrime: lp, goal: goal };
  }
  function useTeamBonus() { return mode() === 'classic'; }

  // ------------------------------------------------------------------ réglages
  window.primeSetMode = function (m) {
    if (!canManage()) return X.toast('Réservé à l\'administrateur', 'error');
    var c = S.get('primeRules', {}) || {}; c.mode = m === 'classic' ? 'classic' : 'lead'; S.set('primeRules', c, true);
    X.log('Règle de prime modifiée', c.mode === 'lead' ? 'mode équipe (chargé d\'équipe + part des salariés)' : 'mode classique'); X.save(); X.toast('Règle de prime enregistrée', 'success'); refresh();
  };
  window.primeSaveSettings = function () {
    if (!canManage()) return X.toast('Réservé à l\'administrateur', 'error');
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var scale = []; for (var i = 0; i < 4; i++) { var mn = Number(g('pr-min' + i)), bn = Number(g('pr-bonus' + i)); if (mn > 0 && g('pr-bonus' + i) !== '' && bn >= 0) scale.push({ min: mn, bonus: bn }); }
    var lo = Math.min(100, Math.max(0, Number(g('pr-lo')) || 0)), hi = Math.min(100, Math.max(lo, Number(g('pr-hi')) || 0));
    var c = S.get('primeRules', {}) || {}; c.scale = scale.length ? scale : undefined; c.minPct = lo; c.maxPct = hi; c.defaultLead = g('pr-lead') || '';
    S.set('primeRules', c, true); X.log('Barème de prime d\'équipe modifié', scale.length + ' palier(s), salariés ' + lo + '–' + hi + ' %'); X.save(); X.toast('Barème enregistré', 'success'); refresh();
  };
  window.primeResetSettings = function () {
    if (!canManage() || !confirm('Revenir au barème et aux pourcentages par défaut ?')) return;
    var c = S.get('primeRules', {}) || {}; S.set('primeRules', { mode: c.mode }, true); X.log('Barème de prime d\'équipe réinitialisé', ''); X.save(); refresh();
  };
  function refresh() { if (typeof window.refreshPayroll === 'function') window.refreshPayroll(); else X.rerender(); }


  // ------------------------------------------------------------------ simulateur (utilise les valeurs saisies dans le formulaire, même non enregistrées)
  window.primeSim = function () {
    var out = document.getElementById('pr-sim-out'); if (!out) return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var pts = Math.max(0, Number(g('pr-sim-pts')) || 0), obj = Math.min(100, Math.max(0, Number(g('pr-sim-obj')) || 0));
    var scale = []; for (var i = 0; i < 4; i++) { var mn = Number(g('pr-min' + i)), bn = Number(g('pr-bonus' + i)); if (mn > 0 && g('pr-bonus' + i) !== '' && bn >= 0) scale.push({ min: mn, bonus: bn }); }
    if (!scale.length) scale = DEFAULT_SCALE; scale.sort(function (a, b) { return b.min - a.min; });
    var lead = 0; for (var k = 0; k < scale.length; k++) if (pts >= scale[k].min) { lead = scale[k].bonus; break; }
    var lo = Math.min(100, Math.max(0, Number(g('pr-lo')) || 0)), hi = Math.min(100, Math.max(lo, Number(g('pr-hi')) || 0));
    var pct = lo + (hi - lo) * obj / 100, one = Math.round(lead * pct / 100), min = Math.round(lead * lo / 100), max = Math.round(lead * hi / 100);
    var n = emps().filter(function (e) { return e.active !== false && !isLead(e.id) && TeamOrg.managersOf(e.id).some(isLead); }).length;
    out.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">' +
      '<div class="p-3 rounded-xl bg-indigo-50 border border-indigo-200"><div class="text-[11px] font-bold text-indigo-700">Prime du chargé d\'équipe</div><div class="text-lg font-black text-indigo-700">' + X.fmt(lead) + '</div></div>' +
      '<div class="p-3 rounded-xl bg-purple-50 border border-purple-200"><div class="text-[11px] font-bold text-purple-700">Prime de chaque salarié (objectif ' + obj + ' %)</div><div class="text-lg font-black text-purple-700">' + X.fmt(one) + '</div><div class="text-[10px] text-purple-600">de ' + X.fmt(min) + ' (' + lo + ' %) à ' + X.fmt(max) + ' (' + hi + ' %)</div></div>' +
      '<div class="p-3 rounded-xl bg-gray-50 border"><div class="text-[11px] font-bold text-gray-600">Coût total (' + n + ' salarié' + (n > 1 ? 's' : '') + ')</div><div class="text-lg font-black text-gray-800">' + X.fmt(lead + one * n) + '</div><div class="text-[10px] text-gray-500">de ' + X.fmt(lead + min * n) + ' à ' + X.fmt(lead + max * n) + '</div></div></div>';
  };

  // ------------------------------------------------------------------ panneau de réglage
  function panel() {
    setTimeout(function () { try { window.primeSim(); } catch (e) {} }, 0);   // le simulateur se remplit dès l'affichage
    var c = cfg(), m = c.mode, L = leads(), inp = X.input, sc = c.scale.slice().sort(function (a, b) { return a.min - b.min; });
    while (sc.length < 4) sc.push({ min: '', bonus: '' }); sc = sc.slice(0, 4);
    var who = L.length ? L.map(function (e) { return '<b>' + E(e.name || e.login) + '</b> (' + reports(e.id).length + ' dans l\'équipe)'; }).join(', ') : '<span class="text-amber-600 font-bold">aucun — définissez un « Responsable » dans Organisation</span>';
    function opt(v, title, text) { return '<label class="flex items-start gap-3 p-3 rounded-xl border dark:border-gray-700 cursor-pointer ' + (m === v ? 'bg-indigo-50 border-indigo-300' : 'bg-gray-50 dark:bg-gray-900') + '"><input type="radio" name="primeMode" ' + (m === v ? 'checked' : '') + ' onchange="primeSetMode(\'' + v + '\')" class="mt-1"><span class="text-sm"><b>' + title + '</b><br><span class="text-[11px] text-gray-500">' + text + '</span></span></label>'; }
    var leadOpts = '<option value=""' + (!c.defaultLead ? ' selected' : '') + '>' + E(directorLabel()) + ' — sans prime (recommandé)</option>' + L.map(function (e) { return '<option value="' + E(e.id) + '"' + (c.defaultLead === e.id ? ' selected' : '') + '>' + E(e.name || e.login) + ' (chargé d\'équipe)</option>'; }).join('');
    return '<div class="rounded-2xl border dark:border-gray-700 p-4 lg:col-span-3"><h4 class="font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-award text-indigo-500 mr-2"></i>Primes d\'équipe</h4>' +
      '<p class="text-[11px] text-gray-400 mb-3">Chargé(s) d\'équipe : ' + who + '</p><div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="space-y-2">' +
      opt('lead', 'Mode équipe (recommandé)', 'Tous les points saisis sont comptés pour l\'équipe. Le chargé d\'équipe a une prime selon le barème en points ; chaque salarié reçoit ' + c.minPct + ' % à ' + c.maxPct + ' % de cette prime.') +
      opt('classic', 'Classique (ancien mode)', 'Prime individuelle selon les tâches de chacun (ancien barème en DA) + prime d\'équipe avancée si activée dans Organisation.') + '</div>' +
      '<div><div class="text-xs font-bold text-gray-500 mb-1">Barème de l\'équipe : points du mois ≥ seuil → prime du chargé d\'équipe</div>' +
      sc.map(function (t, i) { return '<div class="flex gap-2 mb-2"><input id="pr-min' + i + '" type="number" placeholder="points ≥" value="' + E(t.min) + '" class="' + inp + ' w-1/2"><input id="pr-bonus' + i + '" type="number" placeholder="prime (DA)" value="' + E(t.bonus) + '" class="' + inp + ' w-1/2"></div>'; }).join('') +
      '<div class="flex gap-2 mb-2 items-center text-xs font-bold text-gray-500">Part des salariés : <input id="pr-lo" type="number" value="' + c.minPct + '" class="' + inp + ' w-20"> % à <input id="pr-hi" type="number" value="' + c.maxPct + '" class="' + inp + ' w-20"> % de la prime du chargé</div>' +
      '<label class="text-xs font-bold text-gray-500">Points non attribués (saisis sans salarié) comptés chez :</label><select id="pr-lead" class="' + inp + ' w-full mb-2">' + leadOpts + '</select>' +
      '<div class="flex gap-2"><button onclick="primeSaveSettings()" class="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm">Enregistrer</button><button onclick="primeResetSettings()" class="px-3 py-2 border dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300">Défaut</button></div>' +
      '<div class="mt-4 p-3 rounded-2xl border border-dashed border-indigo-300"><div class="text-xs font-black text-indigo-700 mb-2"><i class="fas fa-calculator mr-1"></i>Simulateur</div><div class="flex flex-wrap gap-2 items-center text-xs font-bold text-gray-500 mb-2">Si l\'équipe fait <input id="pr-sim-pts" type="number" min="0" value="300" oninput="primeSim()" class="' + inp + ' w-24"> points, et que le salarié atteint <input id="pr-sim-obj" type="number" min="0" max="100" value="0" oninput="primeSim()" class="' + inp + ' w-20"> % de son objectif :</div><div id="pr-sim-out"></div></div>' +
      '<p class="text-[11px] text-gray-400 mt-2">Le salarié monte de ' + c.minPct + ' % vers ' + c.maxPct + ' % selon son objectif mensuel (Pilotage › objectifs) ; sans objectif défini, il reçoit ' + c.minPct + ' %.</p></div></div></div>';
  }

  // ------------------------------------------------------------------ historique : points saisis ↔ primes, mois par mois
  function history(nMonths) {
    var months = {}, cur = X.month(); (appState.transactions || []).forEach(function (t) { if (t && X.isYmd(t.date) && t.date >= '2020-01-01' && t.date.slice(0, 7) <= cur) months[t.date.slice(0, 7)] = 1; });
    var list = Object.keys(months).sort().slice(-(nMonths || 12)).reverse(), c = cfg(), L = leads(), cov = covered(), rate = (window.getPerformanceConfig ? getPerformanceConfig().ratePerTask : 0);
    var rows = list.map(function (m) {
      var r = X.monthRange(m), total = 0, counted = 0, orphans = 0;
      (appState.transactions || []).forEach(function (t) { if (!inRange(t, r.from, r.to)) return; total++; if (!t.employeeId || !cov[t.employeeId]) orphans++; });
      var defId = defaultLeadId(), leadPrime = 0, leadPts = 0, memberMin = null, memberMax = 0, memberSum = 0, members = 0;
      L.forEach(function (e) { var x = leadResult(e.id, r.from, r.to); leadPrime += x.prime; leadPts += x.tasks; });
      emps().filter(function (e) { return e.active !== false && !isLead(e.id); }).forEach(function (e) { var x = forRange(e.id, r.from, r.to, rate); if (x.role === 'member') { members++; memberSum += x.prime; memberMin = memberMin === null ? x.prime : Math.min(memberMin, x.prime); memberMax = Math.max(memberMax, x.prime); } });
      counted = L.length ? total : 0;                           // tout est compté : chez le chargé d'équipe, chez la Direction ou chez le chargé choisi
      return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white whitespace-nowrap">' + E(X.monthLabel(m)) + (m === cur ? ' <span class="text-[10px] text-gray-400">(en cours)</span>' : '') + '</td>' +
        '<td class="p-3 text-right font-mono">' + total + '</td>' +
        '<td class="p-3 text-right font-mono ' + (counted === total ? 'text-green-600' : 'text-red-600') + '">' + counted + (counted === total ? ' ✔' : '') + '<div class="text-[10px] text-gray-400 font-normal">dont ' + orphans + ' non attribué(s) → ' + E(defId ? ((byId(defId) || {}).name || 'chargé') : directorLabel()) + '</div></td>' +
        '<td class="p-3 text-right font-mono text-indigo-700">' + (leadPrime ? X.nf(leadPrime) : '—') + '<div class="text-[10px] text-gray-400 font-normal">' + leadPts + ' pts d\'équipe</div></td>' +
        '<td class="p-3 text-right font-mono text-purple-700">' + (members ? (memberMin === memberMax ? X.nf(memberMax) : X.nf(memberMin) + ' – ' + X.nf(memberMax)) : '—') + '</td>' +
        '<td class="p-3 text-right font-mono font-black">' + X.nf(leadPrime + memberSum) + '</td></tr>';
    }).join('');
    return '<div class="rounded-2xl border dark:border-gray-700 p-4 lg:col-span-3"><h4 class="font-bold text-gray-800 dark:text-white mb-1"><i class="fas fa-clock-rotate-left text-indigo-500 mr-2"></i>Historique des primes d\'équipe</h4>' +
      '<p class="text-[11px] text-gray-400 mb-3">Mois par mois : points saisis, points comptés pour l\'équipe (✔ = tout est compté, une seule fois) et primes que donnerait le barème actuel avec l\'organisation actuelle. Les mois déjà figés dans la paie gardent leurs chiffres.</p>' +
      (c.mode === 'classic' ? '<p class="text-xs text-amber-600 font-bold mb-2">Mode classique actif : ce tableau montre ce que donnerait le mode équipe.</p>' : '') +
      '<div class="overflow-x-auto rounded-xl border dark:border-gray-700"><table class="w-full text-sm"><thead><tr class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 text-[11px] font-black uppercase"><th class="p-3 text-left">Mois</th><th class="p-3 text-right">Points saisis</th><th class="p-3 text-right">Points comptés</th><th class="p-3 text-right">Prime chargé</th><th class="p-3 text-right">Prime / salarié</th><th class="p-3 text-right">Total primes</th></tr></thead><tbody class="divide-y dark:divide-gray-700">' + (rows || '<tr><td colspan="6" class="p-6 text-center text-gray-400 italic">Aucune donnée</td></tr>') + '</tbody></table></div></div>';
  }

  document.addEventListener('ext:rendered', function () { try { window.primeSim(); } catch (e) {} });
  window.PrimeRules = { mode: mode, isLead: isLead, forRange: forRange, useTeamBonus: useTeamBonus, panel: panel, history: history, config: cfg, defaultLeadId: defaultLeadId, directorLabel: directorLabel };
})();
