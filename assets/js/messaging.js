// =====================================================================
//  MESSAGING.JS — ouverture de WhatsApp dans l'APPLICATION (PC) au lieu de WhatsApp Web
//  Problème : les liens https://wa.me/... ouvrent le navigateur (WhatsApp Web) même quand
//  l'application WhatsApp est installée sur l'ordinateur.
//  Solution : pour l'équipe (admin / employés), tout lien WhatsApp est ouvert avec le protocole
//  whatsapp://send?... qui lance directement l'application installée. Si rien ne s'ouvre, une
//  petite bulle propose « WhatsApp Web » (ou de le choisir définitivement sur cet appareil).
//  • Téléphone : le lien classique wa.me est conservé (le téléphone ouvre déjà l'application).
//  • Espace client public (visiteurs / clients) : aucun changement.
//  • Réglage par appareil : setWhatsAppMode('app' | 'web').
// =====================================================================
(function () {
  'use strict';

  var LS_KEY = 'sponsor_wa_mode';
  var _origOpen = window.open ? window.open.bind(window) : null;
  var IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  function role() { try { return typeof getUserRole === 'function' ? getUserRole() : 'none'; } catch (e) { return 'none'; } }
  function isStaff() { var r = role(); return r === 'admin' || r === 'employee'; }

  window.getWhatsAppMode = function () {
    try { var v = localStorage.getItem(LS_KEY); if (v === 'app' || v === 'web') return v; } catch (e) {}
    return IS_MOBILE ? 'web' : 'app';           // PC : application ; téléphone : lien wa.me (ouvre l'app nativement)
  };
  window.setWhatsAppMode = function (m) {
    try { if (m === 'app' || m === 'web') localStorage.setItem(LS_KEY, m); else localStorage.removeItem(LS_KEY); } catch (e) {}
    if (typeof showToast === 'function') showToast(m === 'web' ? 'WhatsApp : WhatsApp Web sur cet appareil' : 'WhatsApp : application installée sur cet appareil', 'success');
  };

  function digitsOf(phone) {
    var n = (typeof normalizePhoneForWhatsApp === 'function') ? normalizePhoneForWhatsApp(phone) : String(phone || '').replace(/\D/g, '');
    return String(n || '').replace(/\D/g, '');
  }
  function webUrl(d, text) { return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : ''); }
  function appUrl(d, text) { return 'whatsapp://send?phone=' + d + (text ? '&text=' + encodeURIComponent(text) : ''); }

  function launchProtocol(url) {
    var a = document.createElement('a');
    a.href = url; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { a.remove(); } catch (e) {} }, 800);
  }

  // Petite bulle d'aide (affichée quelques secondes après l'ouverture de l'application)
  function showHint(d, text) {
    var old = document.getElementById('waHint'); if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'waHint';
    box.className = 'fixed bottom-4 right-4 max-w-xs bg-gray-900 text-white rounded-2xl shadow-2xl p-4 text-sm';
    box.style.zIndex = '9996';
    var t = document.createElement('div'); t.className = 'font-bold mb-1'; t.textContent = 'WhatsApp s\'ouvre dans l\'application…';
    var s = document.createElement('div'); s.className = 'text-xs text-gray-300 mb-3'; s.textContent = 'Rien ne s\'est ouvert ? Autorisez l\'ouverture de WhatsApp dans la fenêtre du navigateur, ou utilisez WhatsApp Web.';
    var row = document.createElement('div'); row.className = 'flex flex-wrap gap-2';
    var b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 font-bold text-xs'; b1.textContent = 'WhatsApp Web';
    b1.onclick = function () { if (_origOpen) _origOpen(webUrl(d, text), '_blank', 'noopener'); box.remove(); };
    var b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 font-bold text-xs'; b2.textContent = 'Toujours le Web sur cet appareil';
    b2.onclick = function () { window.setWhatsAppMode('web'); if (_origOpen) _origOpen(webUrl(d, text), '_blank', 'noopener'); box.remove(); };
    var b3 = document.createElement('button'); b3.type = 'button'; b3.className = 'px-2 py-1 rounded-lg text-gray-400 hover:text-white text-xs'; b3.textContent = 'OK';
    b3.onclick = function () { box.remove(); };
    row.appendChild(b1); row.appendChild(b2); row.appendChild(b3);
    box.appendChild(t); box.appendChild(s); box.appendChild(row);
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.remove(); }, 12000);
  }

  // Point d'entrée unique : ouvre une conversation WhatsApp (numéro + message optionnel)
  window.openWhatsApp = function (phone, text) {
    var d = digitsOf(phone);
    if (!d) { if (typeof showToast === 'function') showToast('Numéro WhatsApp invalide ou absent', 'error'); return false; }
    if (window.getWhatsAppMode() === 'app') {
      launchProtocol(appUrl(d, text));
      showHint(d, text);
    } else if (_origOpen) {
      _origOpen(webUrl(d, text), '_blank', 'noopener');
    }
    return true;
  };

  // --- Interception de TOUS les liens WhatsApp existants de l'application (boutons, tableaux, Meta Live…) ---
  function parseWaUrl(u) {
    var m = String(u || '').match(/^https:\/\/wa\.me\/(\d+)(?:\?(.*))?$/i);
    if (!m) return null;
    var text = '';
    if (m[2]) { try { text = new URLSearchParams(m[2]).get('text') || ''; } catch (e) {} }
    return { phone: m[1], text: text };
  }
  function shouldIntercept() { return isStaff() && window.getWhatsAppMode() === 'app'; }

  if (_origOpen) {
    window.open = function (url) {
      try {
        var w = parseWaUrl(url);
        if (w && shouldIntercept()) { window.openWhatsApp(w.phone, w.text); return null; }
      } catch (e) {}
      return _origOpen.apply(window, arguments);
    };
  }
  document.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="https://wa.me/"]') : null;
      if (!a) return;
      var w = parseWaUrl(a.getAttribute('href'));
      if (!w || !shouldIntercept()) return;
      e.preventDefault(); e.stopPropagation();
      window.openWhatsApp(w.phone, w.text);
    } catch (err) {}
  }, true);

  // --- Instagram : lien de DISCUSSION (https://www.instagram.com/direct/t/102963774431486/) ---
  // Le lien « ig.me/m/pseudo » provoque une erreur chez Instagram : on utilise le lien de discussion enregistré
  // sur la fiche client, sinon la page du profil (bouton « Message »).
  window.normalizeInstagramThread = function (u) {
    var m = String(u || '').trim().match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/direct\/t\/(\d+)/i);
    return m ? 'https://www.instagram.com/direct/t/' + m[1] + '/' : '';
  };
  window.isInstagramThreadUrl = function (u) { return !!window.normalizeInstagramThread(u); };
  window.getInstagramHandle = function (client) {
    if (!client) return '';
    var raw = client.instagram || client.username || (client.social && Array.isArray(client.social.instagram) && client.social.instagram[0]) || '';
    return String(raw || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
  };
  window.getInstagramChatUrl = function (client) {
    var t = window.normalizeInstagramThread(client && client.instagramDm);
    if (t) return t;
    var h = window.getInstagramHandle(client);
    return h ? 'https://www.instagram.com/' + h + '/' : '';
  };

  window.MessagingCore = { parseWaUrl: parseWaUrl, appUrl: appUrl, webUrl: webUrl };
})();
