// =====================================================================
//  STAMPS.JS — Heure et auteur des paiements / transactions
//  - Enregistre QUI a saisi chaque nouveau paiement (champs ajoutés : createdByName / createdById)
//  - Enregistre QUI a validé chaque nouvelle transaction (validatedByName / validatedById)
//  - Fournit les petits outils d'affichage (heure d'Alger) utilisés par l'historique et les paiements
//  Ajout non destructif : les anciennes données restent inchangées (auteur affiché « — »).
// =====================================================================
(function () {
  'use strict';
  var TZ = 'Africa/Algiers';

  window.formatTimeHM = function (ts) {
    var n = Number(ts); if (!n || !isFinite(n)) return '';
    try { return new Date(n).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }); } catch (e) { return ''; }
  };
  window.formatDateTimeFR = function (ts) {
    var n = Number(ts); if (!n || !isFinite(n)) return '';
    try { return new Date(n).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) + ' à ' + window.formatTimeHM(n); } catch (e) { return ''; }
  };

  // Qui est connecté (même logique que le journal d'activité, mais avec « Admin » plutôt que l'e-mail)
  window.currentActorStamp = function () {
    var s = window.appState && appState.session;
    try {
      if (s && s.type === 'employee') return { id: s.employeeId || s.id || '', name: s.name || s.login || 'Employé' };
      if (s && s.type === 'client') return { id: '', name: 'Client' };
    } catch (e) {}
    return { id: '', name: 'Admin' };
  };

  if (!window.Ext) return;
  function resave() { if (typeof autoSave === 'function') autoSave(); }   // le champ « auteur » est ajouté après la 1re sauvegarde : on re-sauvegarde

  // Nouveau paiement → on note l'auteur sur le paiement créé
  Ext.wrap('addPayment', function () { window.__stampPayCount = ((appState.payments || []).length); }, function () {
    try {
      var list = appState.payments || [];
      if (list.length > (window.__stampPayCount || 0)) {
        var p = list[list.length - 1], a = window.currentActorStamp();
        if (p && !p.createdByName) { p.createdByName = a.name; p.createdById = a.id; p.updatedAt = Date.now(); resave(); }
      }
    } catch (e) { console.warn('stamps addPayment', e); }
  });

  // Validation d'une transaction (To-Do → Historique, ou problème résolu) → on note qui a validé
  Ext.wrap('changeTodoStatus', function () { window.__stampT0 = Date.now() - 50; }, function () {
    try {
      var a = window.currentActorStamp(), t0 = window.__stampT0 || 0;
      var ch = false;
      (appState.transactions || []).forEach(function (t) {
        if (t && t.status === 'active' && Number(t.completedAt || 0) >= t0 && !t.validatedByName) { t.validatedByName = a.name; t.validatedById = a.id; t.updatedAt = Date.now(); ch = true; }
      });
      if (ch) resave();
    } catch (e) { console.warn('stamps changeTodoStatus', e); }
  });
  // Vente « Sponsor Direct » : créée et validée par la même personne (celle qui lance)
  Ext.wrap('handleNewTodoSubmit', function () { window.__stampH0 = Date.now() - 50; }, function () {
    try {
      var a = window.currentActorStamp(), t0 = window.__stampH0 || 0;
      var ch = false;
      (appState.transactions || []).forEach(function (t) {
        if (t && t.status === 'active' && Number(t.completedAt || 0) >= t0 && !t.validatedByName) { t.validatedByName = t.launchedByName || a.name; t.validatedById = t.launchedById || a.id; t.updatedAt = Date.now(); ch = true; }
      });
      if (ch) resave();
    } catch (e) { console.warn('stamps handleNewTodoSubmit', e); }
  });
})();
