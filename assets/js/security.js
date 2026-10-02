// =====================================================================
//  SECURITY.JS — protection contre l'injection de code (XSS)
//  Les noms de clients, notes, descriptions, etc. sont saisis par des utilisateurs
//  (dont des clients non connectés). Avant d'être affichés dans une page, ils doivent
//  être "neutralisés" pour qu'un texte comme  <img onerror=...>  s'affiche comme du
//  texte au lieu de s'exécuter.
//
//  Fonctions exposées (toutes pures, sans effet sur les données) :
//    escapeHtml(v)     texte -> HTML sûr (contenu d'une balise ou d'un attribut)
//    escapeJsAttr(v)   texte placé dans une chaîne JS d'un attribut onclick="f('...')"
//    safeUrl(v)        URL -> http(s)/mailto/tel/relative/image data: uniquement
//    isSafeDocId(id)   identifiant de document sans caractères dangereux
//    filterSafeDocs(l) retire d'une liste les documents dont l'id est dangereux
// =====================================================================
(function () {
  'use strict';

  var HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  window.escapeHtml = function (v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"'`]/g, function (ch) { return HTML_MAP[ch]; });
  };

  // Valeur insérée dans une chaîne JavaScript écrite dans un attribut HTML :
  //   onclick="selectClient('${...}')"
  // 1) on échappe pour JavaScript, 2) on échappe pour l'attribut HTML.
  window.escapeJsAttr = function (v) {
    if (v === null || v === undefined) return '';
    var js = String(v).replace(/[\\'"<>&`\r\n\u2028\u2029]/g, function (ch) {
      var code = ch.charCodeAt(0).toString(16).toUpperCase();
      return '\\u' + ('0000' + code).slice(-4);
    });
    return window.escapeHtml(js);
  };

  var URL_OK = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|\.\/|\.\.\/|#|blob:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
  window.safeUrl = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim().replace(/[\u0000-\u001F\u007F]/g, '');
    if (!s) return '';
    // URL relative simple (ex: assets/img/a.png) : acceptée si elle ne contient pas de schéma
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(s) && s.indexOf('//') !== 0) return window.escapeHtml(s);
    return URL_OK.test(s) ? window.escapeHtml(s) : '';
  };

  // Même contrôle que safeUrl mais renvoie l'URL brute (non échappée) : à utiliser avant
  // escapeJsAttr() quand l'URL est placée dans une chaîne JavaScript (onclick="f('...')").
  window.safeUrlRaw = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim().replace(/[\u0000-\u001F\u007F]/g, '');
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(s) && s.indexOf('//') !== 0) return s;
    return URL_OK.test(s) ? s : '';
  };

  // Identifiants de documents : ceux générés par l'application ne contiennent que lettres,
  // chiffres, _ et -. On refuse seulement les caractères capables de "sortir" d'un attribut
  // ou d'une chaîne JavaScript (quotes, <, >, `, \, &, retours à la ligne).
  var UNSAFE_ID = /['"<>`\\&\r\n]/;
  window.isSafeDocId = function (id) {
    if (id === null || id === undefined) return true;           // sans id : l'app en génère un
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    return !UNSAFE_ID.test(String(id));
  };
  window.filterSafeDocs = function (list, label) {
    if (!Array.isArray(list)) return list;
    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d && typeof d === 'object' && !window.isSafeDocId(d.id)) {
        try { console.warn('[sécurité] document ignoré (identifiant dangereux)' + (label ? ' dans ' + label : '')); } catch (e) {}
        continue;
      }
      kept.push(d);
    }
    return kept;
  };
})();
