// =====================================================================
//  STUDIO-PLATFORM.JS — onglet « Plateforme en ligne » du groupe Studio
//  Relie le CRM à la nouvelle plateforme du studio (dossier studio/ du dépôt).
//  La plateforme a sa propre base Firebase, fermée et vérifiée côté serveur :
//  cet onglet ne lit ni n'écrit rien dans les données du CRM.
//  Les onglets « Rendez-vous studio » et « Shooting produits » restent inchangés.
// =====================================================================
(function () {
  'use strict';
  var X = window.Ext;
  if (!X || !X.registerTab) return;
  var S = window.ExtStore;

  var DEFAULT_URL = 'studio/web/admin/';

  function platformUrl() {
    var u = S && S.get ? S.get('studioPlatformUrl', '') : '';
    return (typeof u === 'string' && u.trim()) ? u.trim() : DEFAULT_URL;
  }
  // Seulement une adresse relative au site ou une adresse https.
  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^[A-Za-z0-9_./-]+$/.test(u) && u.indexOf('..') === -1 && u.charAt(0) !== '/') return u;
    return DEFAULT_URL;
  }

  var PHASES = [
    ['Audit et architecture', 'done'],
    ['Base de données et comptes', 'done'],
    ['Catalogue et moteur de prix', 'next'],
    ['Site client et configurateur', ''],
    ['Panier et promotions', ''],
    ['Réservations et disponibilités', ''],
    ['WhatsApp et notifications', ''],
    ['Acomptes et paiements', ''],
    ['Tableau de bord admin', ''],
    ['Finance', ''],
    ['Tests, sécurité, mise en production', '']
  ];

  window.stpOpen = function () {
    window.open(safeUrl(platformUrl()), '_blank', 'noopener');
  };
  window.stpSaveUrl = function () {
    if (!X.isAdmin()) return X.toast('Réservé à l\'administrateur', 'warning');
    var el = document.getElementById('stpUrl');
    var v = el ? el.value.trim() : '';
    if (v && safeUrl(v) !== v) return X.toast('Adresse refusée : utilisez une adresse https:// ou un chemin du site', 'warning');
    S.set('studioPlatformUrl', v);
    X.log('Plateforme studio', 'Adresse modifiée : ' + (v || DEFAULT_URL));
    X.toast('Adresse enregistrée', 'success');
    X.rerender();
  };
  window.stpToggleFrame = function () {
    var f = document.getElementById('stpFrameWrap');
    if (!f) return;
    if (!f.firstChild) {
      var ifr = document.createElement('iframe');
      ifr.src = safeUrl(platformUrl());
      ifr.title = 'Plateforme studio — Équipe';
      ifr.style.cssText = 'width:100%;height:75vh;border:0;border-radius:16px;background:#fff';
      f.appendChild(ifr);
    } else {
      f.innerHTML = '';
    }
  };

  function render(c) {
    var E = X.esc;
    var url = safeUrl(platformUrl());
    var done = PHASES.filter(function (p) { return p[1] === 'done'; }).length;
    var phases = PHASES.map(function (p, i) {
      var st = p[1] === 'done' ? '<span class="text-green-600 font-bold"><i class="fas fa-circle-check mr-1"></i>Livrée</span>'
        : p[1] === 'next' ? '<span class="text-indigo-600 font-bold"><i class="fas fa-hourglass-half mr-1"></i>Prochaine</span>'
        : '<span class="text-gray-400">À venir</span>';
      return '<tr><td class="p-3 text-gray-500">' + (i + 1) + '</td><td class="p-3 font-bold">' + E(p[0]) + '</td><td class="p-3 text-right">' + st + '</td></tr>';
    }).join('');

    var settings = X.isAdmin()
      ? '<details class="mt-4"><summary class="cursor-pointer text-sm font-bold text-gray-600 dark:text-gray-300"><i class="fas fa-gear mr-1"></i>Adresse de la plateforme</summary>' +
        '<div class="flex flex-wrap gap-2 items-end mt-3"><label class="text-xs font-bold text-gray-600 flex-1 min-w-[240px]">Adresse (vide = ' + E(DEFAULT_URL) + ')' +
        '<input id="stpUrl" type="text" value="' + E(S.get('studioPlatformUrl', '')) + '" placeholder="https://studio-hichem.web.app/admin/" class="' + X.input + ' w-full mt-1"></label>' +
        X.btn('Enregistrer', 'stpSaveUrl()', 'bg-gray-800 text-white', 'fa-floppy-disk') + '</div>' +
        '<p class="text-[11px] text-gray-400 mt-2">Par défaut, la page Équipe du dossier studio/ de ce site. Après la mise en ligne sur Firebase Hosting, vous pouvez mettre son adresse https.</p></details>'
      : '';

    c.innerHTML =
      '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-globe text-indigo-600 mr-2"></i>Plateforme studio en ligne</h2>' +
      '<p class="text-xs text-gray-500 mt-1">Réservations, prix et paiements du studio en ligne. Sa base de données est séparée et protégée : rien ici ne modifie les données du CRM.</p></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">' +
        X.kpi('Phases livrées', done + ' / ' + PHASES.length, 'text-indigo-600', 'fa-list-check') +
        X.kpi('Prochaine étape', 'Prix', '', 'fa-tags') +
        X.kpi('Mise en ligne', 'Projet Firebase à créer', 'text-amber-600', 'fa-cloud') +
      '</div>' +
      X.card('Espace Équipe', 'fa-users-gear',
        '<p class="text-sm text-gray-600 dark:text-gray-300 mb-3">Devenir administrateur de la plateforme, créer les comptes employé et comptable, changer un rôle ou désactiver un compte. Connexion avec votre compte Google.</p>' +
        '<div class="flex flex-wrap gap-2">' + X.btn('Ouvrir dans un nouvel onglet', 'stpOpen()', null, 'fa-arrow-up-right-from-square') +
        X.btn('Afficher ici', 'stpToggleFrame()', 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100', 'fa-window-maximize') + '</div>' +
        '<p class="text-[11px] text-gray-400 mt-2">Adresse : ' + E(url) + '</p>' +
        '<div id="stpFrameWrap" class="mt-4"></div>' + settings) +
      X.card('Avancement', 'fa-road', X.table([['#', 'l'], ['Phase', 'l'], ['État', 'r']], phases)) +
      X.card('Mise en place', 'fa-screwdriver-wrench',
        '<ol class="list-decimal pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">' +
        '<li>Créer le projet Firebase du studio au forfait Blaze, avec un plafond de dépenses.</li>' +
        '<li>Suivre le guide <b>studio/README.md</b> (10 étapes) et coller la configuration dans <b>studio/web/admin/index.html</b>.</li>' +
        '<li>Dans Firebase → Authentication → Paramètres → Domaines autorisés, ajouter <b>' + E(location.hostname) + '</b>.</li>' +
        '<li>Ouvrir l\'espace Équipe et cliquer « Devenir administrateur ».</li></ol>');
  }

  X.registerTab('studioPlatform', {
    nav: { group: 'studio', groupLabel: 'Studio', groupIcon: 'fa-camera', label: 'Plateforme en ligne', icon: 'fa-globe' },
    render: render
  });
  function boot() { if (X.installTabs) X.installTabs(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
