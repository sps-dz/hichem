// =====================================================================
//  DAILY.JS — « Clôture de caisse » et « Tableau du matin »
//  • Clôture : chaque soir, vous saisissez l'argent réellement compté ; le site affiche l'écart avec le solde théorique
//    et garde l'historique. Rien n'est ajusté automatiquement (aucun solde n'est modifié).
//  • Tableau du matin : une page qui résume la caisse, hier, et ce qu'il faut faire aujourd'hui.
//  Nouvelles données : appState.globalConfig.ext.cashClosings (synchronisé comme les autres modules).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function ro() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function isTask(t) { return t && /^tx-emp-/.test(String(t.id || '')); }
  function bal() { var b = appState.balances || {}; return { liquide: num(b.liquide), baridimob: num(b.baridimob) }; }
  function closings() { return S.list('cashClosings'); }
  function gapCls(g) { return Math.abs(g) < 1 ? 'text-green-600' : 'text-red-600'; }
  function gapTxt(g) { return Math.abs(g) < 1 ? 'Aucun écart ✔' : (g > 0 ? 'Il y a ' + X.fmt(g) + ' de PLUS que prévu' : 'Il MANQUE ' + X.fmt(-g)); }

  // =====================================================================
  //  CLÔTURE DE CAISSE
  // =====================================================================
  window.closingCalc = function () {
    var t = bal(), box = document.getElementById('clGap'); if (!box) return;
    var l = document.getElementById('clLiq').value, b = document.getElementById('clBar').value;
    function row(label, counted, theo) {
      if (counted === '') return '<div class="p-3 rounded-2xl bg-gray-50 border text-sm text-gray-400">' + E(label) + ' : saisissez le montant compté</div>';
      var g = num(counted) - theo;
      return '<div class="p-3 rounded-2xl bg-gray-50 border text-sm"><b>' + E(label) + '</b> : site ' + X.fmt(theo) + ' · compté ' + X.fmt(num(counted)) + ' → <b class="' + gapCls(g) + '">' + gapTxt(g) + '</b></div>';
    }
    box.innerHTML = row('Liquide', l, t.liquide) + row('BaridiMob / CCP', b, t.baridimob);
  };
  window.closingSave = function () {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var l = document.getElementById('clLiq').value, b = document.getElementById('clBar').value;
    if (l === '' || b === '') return X.toast('Saisissez les deux montants comptés (mettez 0 si vide)', 'warning');
    var t = bal(), note = (document.getElementById('clNote').value || '').trim();
    var rec = { id: X.uid('clo'), date: X.today(), ts: Date.now(), by: X.actor(), note: note,
      theo: { liquide: t.liquide, baridimob: t.baridimob }, counted: { liquide: num(l), baridimob: num(b) },
      gap: { liquide: num(l) - t.liquide, baridimob: num(b) - t.baridimob } };
    closings().unshift(rec); if (closings().length > 400) closings().length = 400;
    S.set('cashClosings', closings());
    X.log('Clôture de caisse', 'Écart liquide ' + X.fmt(rec.gap.liquide) + ' · BaridiMob ' + X.fmt(rec.gap.baridimob));
    X.toast('Clôture enregistrée', 'success'); X.rerender();
  };
  window.closingDelete = function (id) {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    if (!confirm('Supprimer cette clôture de l\'historique ? (aucun solde n\'est modifié)')) return;
    S.set('cashClosings', closings().filter(function (r) { return r.id !== id; })); X.rerender();
  };
  function renderClosing(c) {
    var t = bal(), list = closings(), today = X.today(), doneToday = list.some(function (r) { return r.date === today; });
    var rows = list.slice(0, 30).map(function (r) {
      return '<tr><td class="p-3 text-xs whitespace-nowrap">' + X.fmtDate(r.date) + '<div class="text-[11px] text-gray-400">' + E(X.fmtTs(r.ts).split(' ').slice(-1)[0] || '') + ' · ' + E(r.by || '') + '</div></td>' +
        '<td class="p-3 text-right font-mono text-xs">' + X.fmt(r.counted.liquide) + '<div class="font-black ' + gapCls(r.gap.liquide) + '">' + (Math.abs(r.gap.liquide) < 1 ? 'OK' : (r.gap.liquide > 0 ? '+' : '') + X.fmt(r.gap.liquide)) + '</div></td>' +
        '<td class="p-3 text-right font-mono text-xs">' + X.fmt(r.counted.baridimob) + '<div class="font-black ' + gapCls(r.gap.baridimob) + '">' + (Math.abs(r.gap.baridimob) < 1 ? 'OK' : (r.gap.baridimob > 0 ? '+' : '') + X.fmt(r.gap.baridimob)) + '</div></td>' +
        '<td class="p-3 text-xs text-gray-500">' + E(r.note || '') + '</td><td class="p-3 text-right">' + (X.isAdmin() && !ro() ? '<button type="button" data-id="' + E(r.id) + '" onclick="closingDelete(this.dataset.id)" class="px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg"><i class="fas fa-trash"></i></button>' : '') + '</td></tr>';
    }).join('');
    c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-lock text-indigo-600 mr-2"></i>Clôture de caisse</h2><p class="text-xs text-gray-500 mt-1">Chaque soir : comptez votre argent, saisissez-le ici, et le site vous dit s\'il y a un écart avec ses calculs.</p></div>' +
      '<div class="p-4 mb-4 rounded-2xl ' + (doneToday ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-amber-50 border border-amber-200 text-amber-800') + ' text-sm font-bold"><i class="fas ' + (doneToday ? 'fa-circle-check' : 'fa-clock') + ' mr-2"></i>' + (doneToday ? 'La caisse a déjà été clôturée aujourd\'hui.' : 'La caisse n\'a pas encore été clôturée aujourd\'hui.') + '</div>' +
      X.card('Compter la caisse', 'fa-calculator',
        '<p class="text-xs text-gray-500 mb-3">Le site pense que vous avez : <b>' + X.fmt(t.liquide) + '</b> en liquide et <b>' + X.fmt(t.baridimob) + '</b> sur BaridiMob/CCP. Comptez vos billets et regardez le solde de votre compte, puis saisissez ce que vous avez <b>vraiment</b>.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3"><label class="text-xs font-bold text-gray-600">Liquide compté (DA)<input id="clLiq" type="number" oninput="closingCalc()" class="' + X.input + ' w-full mt-1" placeholder="ex. 150000"></label>' +
        '<label class="text-xs font-bold text-gray-600">Solde BaridiMob / CCP réel (DA)<input id="clBar" type="number" oninput="closingCalc()" class="' + X.input + ' w-full mt-1" placeholder="ex. 800000"></label></div>' +
        '<input id="clNote" type="text" class="' + X.input + ' w-full mb-3" placeholder="Note (optionnel) : pourquoi un écart ?">' +
        '<div id="clGap" class="space-y-2 mb-3"></div>' + (ro() ? '' : X.btn('Enregistrer la clôture', 'closingSave()', 'bg-indigo-600 text-white hover:bg-indigo-700', 'fa-lock')) +
        '<p class="text-[11px] text-gray-400 mt-3">Enregistrer une clôture ne modifie aucun solde : cela garde seulement une trace datée. En cas d\'écart, cherchez l\'erreur (paiement oublié, frais non saisi) plutôt que d\'ajuster.</p>') +
      X.card('Historique des clôtures', 'fa-clock-rotate-left', X.table([['Date'], ['Liquide', 'r'], ['BaridiMob / CCP', 'r'], ['Note'], ['', 'r']], rows, { empty: 'Aucune clôture pour le moment' }));
    window.closingCalc();
  }
  X.registerTab('closing', {
    nav: { group: 'compta', groupLabel: 'Comptabilité', groupIcon: 'fa-calculator', label: 'Clôture de caisse', icon: 'fa-lock' },
    render: renderClosing
  });

  // =====================================================================
  //  TABLEAU DU MATIN
  // =====================================================================
  window.mornGo = function (tab) { try { if (typeof showTab === 'function') showTab(tab); } catch (e) {} };
  window.mornWaInvoice = function (on) { try { localStorage.setItem('crm_wa_invoice_off', on ? '' : '1'); } catch (e) {} X.toast(on ? 'Proposition de facture WhatsApp activée' : 'Proposition de facture WhatsApp désactivée', 'info'); };
  var _backupTs = null;
  function loadBackup() { try { if (window.BackupCore) BackupCore.getAll().then(function (all) { var t = all.map(function (r) { return r.ts; }); _backupTs = t.length ? Math.max.apply(null, t) : 0; if (X.tabs.morning && appState.currentTab === 'morning') X.rerender(); }).catch(function () {}); } catch (e) {} }
  function endOf(t) { try { return typeof getTransactionEndYmd === 'function' ? getTransactionEndYmd(t) : ''; } catch (e) { return ''; } }
  function renderMorning(c) {
    var today = X.today(), yday = X.addDays(today, -1), tomo = X.addDays(today, 1), b = appState.balances || {};
    var ySales = 0, yN = 0, yPay = 0, ending = [];
    (appState.transactions || []).forEach(function (t) {
      if (!t || isTask(t) || (t.status !== 'active' && t.status)) return;
      if (t.date === yday) { yN++; ySales += num(t.priceDzd); }
      var e = endOf(t); if (e && e >= today && e <= tomo) ending.push({ t: t, e: e });
    });
    (appState.payments || []).forEach(function (p) { if (p && p.date === yday) yPay += num(p.amount); });
    var owe = (appState.clients || []).filter(function (cl) { return num(cl.unpaid) > 0; }).sort(function (a, b2) { return num(b2.unpaid) - num(a.unpaid); });
    var oweTot = owe.reduce(function (s, cl) { return s + num(cl.unpaid); }, 0);
    var last = closings()[0], doneToday = last && last.date === today;
    var warn = 0; try { if (window.Integrity) warn = Integrity.count(); } catch (e) {}
    var backupAge = _backupTs === null ? null : (_backupTs ? Math.floor((Date.now() - _backupTs) / 86400000) : -1);
    function big(l, v, h, cls) { return '<div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4 border dark:border-gray-700"><p class="text-xs font-bold text-gray-500 mb-1">' + E(l) + '</p><p class="text-xl font-black ' + (cls || 'text-gray-800 dark:text-white') + '">' + v + '</p><p class="text-[11px] text-gray-500 mt-1 leading-snug">' + h + '</p></div>'; }
    function todo(ok, text, tab, label) { return '<li class="flex items-start gap-3 p-3 rounded-2xl border ' + (ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-900') + '"><i class="fas ' + (ok ? 'fa-circle-check' : 'fa-circle-exclamation') + ' mt-0.5"></i><span class="flex-1 text-sm font-semibold">' + text + '</span>' + (!ok && tab ? '<button type="button" onclick="mornGo(\'' + tab + '\')" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border">' + E(label) + '</button>' : '') + '</li>'; }
    var endRows = ending.slice(0, 8).map(function (x) { return '<tr><td class="p-3 font-bold text-gray-800 dark:text-white">' + E(x.t.clientName || '—') + '</td><td class="p-3 text-xs text-gray-500">' + E(x.t.offerName || '') + '</td><td class="p-3 text-xs whitespace-nowrap">' + (x.e === today ? '<b class="text-red-600">Aujourd\'hui</b>' : 'Demain') + '</td></tr>'; }).join('');
    var offOn = true; try { offOn = localStorage.getItem('crm_wa_invoice_off') !== '1'; } catch (e) {}
    c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-sun text-amber-500 mr-2"></i>Tableau du matin</h2><p class="text-xs text-gray-500 mt-1">' + E(X.fmtDate(today)) + ' — ce qu\'il faut savoir et faire aujourd\'hui.</p></div>' +
      X.card('À faire aujourd\'hui', 'fa-list-check', '<ul class="space-y-2">' +
        todo(!!doneToday, doneToday ? 'La caisse est clôturée aujourd\'hui.' : 'Clôturer la caisse (comptez l\'argent et saisissez-le).', 'closing', 'Clôturer') +
        todo(owe.length === 0, owe.length ? owe.length + ' client(s) vous doivent ' + X.fmt(oweTot) + ' : relancez les plus gros.' : 'Aucun impayé client.', 'care', 'Relancer') +
        todo(ending.length === 0, ending.length ? ending.length + ' campagne(s) se terminent aujourd\'hui ou demain : proposez le renouvellement.' : 'Aucune campagne ne se termine aujourd\'hui ou demain.', 'pilotage', 'Voir') +
        todo(warn === 0, warn ? warn + ' point(s) à vérifier dans vos chiffres (erreurs de saisie possibles).' : 'Vos chiffres sont cohérents.', 'integrity', 'Vérifier') +
        todo(backupAge === null || (backupAge >= 0 && backupAge <= 7), backupAge === null ? 'Sauvegarde : vérification en cours…' : (backupAge === -1 ? 'Aucune sauvegarde trouvée : faites-en une.' : (backupAge > 7 ? 'La dernière sauvegarde date de ' + backupAge + ' jours : faites-en une.' : 'Sauvegarde à jour (il y a ' + backupAge + ' jour(s)).')), 'settings', 'Sauvegarder') +
        '</ul>') +
      X.card('Ma caisse', 'fa-vault', '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        big('Liquide', X.fmt(b.liquide), 'Billets en main', num(b.liquide) < 0 ? 'text-red-600' : '') + big('BaridiMob / CCP', X.fmt(b.baridimob), 'Comptes en ligne', num(b.baridimob) < 0 ? 'text-red-600' : '') + big('Stock de dollars', X.usd(b.usdt), 'À revendre aux clients', num(b.usdt) < 0 ? 'text-red-600' : '') + '</div>' +
        '<p class="text-xs text-gray-500 mt-3">' + (last ? 'Dernière clôture : ' + X.fmtDate(last.date) + ' — liquide ' + (Math.abs(last.gap.liquide) < 1 ? 'OK' : 'écart ' + X.fmt(last.gap.liquide)) + ', BaridiMob ' + (Math.abs(last.gap.baridimob) < 1 ? 'OK' : 'écart ' + X.fmt(last.gap.baridimob)) + '.' : 'Aucune clôture de caisse enregistrée pour le moment.') + '</p>') +
      X.card('Hier (' + X.fmtDate(yday) + ')', 'fa-calendar-day', '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + big('Ventes', X.fmt(ySales), yN + ' vente(s) validée(s)', 'text-indigo-600') + big('Paiements reçus', X.fmt(yPay), 'Argent encaissé des clients', 'text-green-600') + '</div>') +
      (ending.length ? X.card('Campagnes qui se terminent', 'fa-flag-checkered', X.table([['Client'], ['Offre'], ['Fin']], endRows, {})) : '') +
      '<label class="flex items-center gap-2 text-xs text-gray-500 mt-2"><input type="checkbox" ' + (offOn ? 'checked' : '') + ' onchange="mornWaInvoice(this.checked)"> Me proposer d\'envoyer la facture par WhatsApp après chaque vente validée</label>';
  }
  X.registerTab('morning', {
    nav: { group: 'pilotage', groupLabel: 'Pilotage & CRM', groupIcon: 'fa-compass', label: 'Tableau du matin', icon: 'fa-sun' },
    render: function (c) { if (_backupTs === null) loadBackup(); renderMorning(c); }
  });
})();
