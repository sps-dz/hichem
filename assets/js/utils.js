// === UTILS.JS ===

/**
 * Génère un ID unique avec un préfixe
 * @param {string} prefix 
 * @returns {string}
 */
window.generateId = function(prefix = 'id') {
  const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${uuid}`;
};

/**
 * === SÉCURITÉ : hachage des mots de passe (employés/clients) ===
 * Utilise SHA-256 (Web Crypto, natif navigateur, aucune dépendance) + un sel
 * unique par compte. Ce n'est pas destiné à remplacer une vraie authentification
 * serveur, mais évite de stocker et transmettre les mots de passe en clair.
 */
window.generateSalt = function() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

window.hashPassword = async function(password, salt) {
  const text = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.error('Erreur de hachage, fallback non sécurisé:', e);
    }
  }
  // Fallback (navigateurs très anciens / contexte non sécurisé) : ne devrait
  // normalement jamais être utilisé sur une app servie en HTTPS.
  let hash = 0;
  for (let i = 0; i < text.length; i++) { hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0; }
  return 'fallback_' + Math.abs(hash).toString(16);
};

/**
 * Vérifie un mot de passe saisi contre un compte (employé ou client) qui peut
 * être soit déjà migré (passwordHash + passwordSalt), soit encore en ancien
 * format (password en clair, comptes créés avant la mise à jour sécurité).
 * Retourne { ok, needsMigration } — needsMigration=true signifie qu'il faut
 * réenregistrer le compte avec un hash pour ne plus jamais stocker le clair.
 */
window.verifyAccountPassword = async function(account, password) {
  if (!account) return { ok: false, needsMigration: false };
  if (account.passwordHash && account.passwordSalt) {
    const computed = await hashPassword(password, account.passwordSalt);
    return { ok: computed === account.passwordHash, needsMigration: false };
  }
  // Ancien format en clair (compte créé avant la mise à jour sécurité)
  if (account.password !== undefined) {
    return { ok: account.password === password, needsMigration: account.password === password };
  }
  return { ok: false, needsMigration: false };
};

/**
 * === JOURNAL D'ACTIVITÉ (AUDIT LOG) ===
 * Trace les actions financières/administratives importantes : qui a fait
 * quoi et quand. Utile pour la responsabilisation quand plusieurs employés
 * ont accès à l'application.
 */
window.logActivity = function(action, details) {
  if (!appState.activityLog) appState.activityLog = [];

  let actor = 'Système';
  try {
    const role = (typeof getUserRole === 'function') ? getUserRole() : 'none';
    if (role === 'admin') {
      actor = (window.auth && auth.currentUser && auth.currentUser.email) || 'Admin';
    } else if (appState.session && appState.session.type === 'employee') {
      actor = appState.session.name || appState.session.login || 'Employé';
    } else if (appState.session && appState.session.type === 'client') {
      actor = `Client: ${appState.session.name || appState.session.username || ''}`;
    }
  } catch (e) {}

  appState.activityLog.unshift({
    id: generateId('log'),
    ts: Date.now(),
    actor,
    action,
    details: details || ''
  });

  // On garde un historique raisonnable (évite de faire gonfler le document
  // de réglages synchronisé sur Firestore).
  if (appState.activityLog.length > 500) appState.activityLog.length = 500;
};

/**
 * Formate un montant en monnaie (DZD)
 * @param {number} amount 
 * @returns {string}
 */
window.formatCurrency = function(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0
  }).format(num);
};

/**
 * Formate un nombre avec un nombre fixe de décimales en toute sécurité
 * @param {any} value 
 * @param {number} digits 
 * @returns {string}
 */
window.safeToFixed = function(value, digits = 2) {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return (0).toFixed(digits);
  return num.toFixed(digits);
};

/**
 * Normalise un numéro de téléphone pour WhatsApp (Algérie)
 * @param {string} phone 
 * @returns {string}
 */
window.normalizePhoneForWhatsApp = function(phone) {
  let digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('213') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '213' + digits.slice(1);
  if (digits.length === 9) return '213' + digits;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
  return digits;
};

/**
 * Construit un lien WhatsApp pour un client
 * @param {object} client 
 * @returns {string}
 */
window.buildClientWhatsAppLink = function(client) {
  const phone = client.phone || client.contact || '';
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return '';
  const msg = encodeURIComponent('Bonjour ' + (client.name || '') + ' ');
  return 'https://wa.me/' + normalized + '?text=' + msg;
};

/**
 * Construit un lien Instagram pour un client
 * @param {object} client 
 * @returns {string}
 */
window.buildClientInstagramLink = function(client) {
  let handle = client.username;
  if (!handle && client.social && Array.isArray(client.social.instagram) && client.social.instagram.length > 0) {
    handle = client.social.instagram[0];
  }
  if (!handle) return '';
  handle = String(handle).trim().replace(/^@+/, '');
  if (!handle) return '';
  return 'https://instagram.com/' + handle;
};

/**
 * Retourne la date/heure actuelle, calée sur le fuseau horaire de l'Algérie
 * (Africa/Algiers, UTC+1 toute l'année, pas d'heure d'été). À utiliser à la
 * place de `new Date()` partout où on calcule "aujourd'hui" / "maintenant",
 * pour que l'app reste cohérente même si l'appareil qui l'affiche est réglé
 * sur un autre fuseau horaire.
 */
window.getAlgeriaNow = function() {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Algiers' }));
  } catch (e) {
    return new Date();
  }
};

/**
 * Formate une date au format fr-FR
 * @param {any} date 
 * @returns {string}
 */
window.formatDate = function(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Africa/Algiers'
  });
};

/**
 * Retourne la date locale (Algérie) au format YYYY-MM-DD
 * @param {Date} date 
 * @returns {string}
 */
window.getLocalDateString = function(date = getAlgeriaNow()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};

/**
 * Ajuste le montant impayé (dette) d'un client et maintient la date de
 * début de la dette en cours à jour (utile pour l'affichage "Depuis le...").
 * À utiliser à la place d'une modification directe de `client.unpaid`
 * partout dans le code, pour que le suivi Dettes & Relances reste exact.
 * @param {object} client 
 * @param {number} delta - montant à ajouter (positif) ou retirer (négatif)
 */
window.adjustClientUnpaid = function(client, delta) {
  if (!client) return;
  const before = Number(client.unpaid || 0);
  const after = before + Number(delta || 0);
  client.unpaid = after;

  if (before <= 0 && after > 0) {
    // Nouvelle période de dette qui démarre : on marque la date de début.
    client.debtStartDate = getLocalDateString();
  } else if (after <= 0) {
    // La dette est soldée : on efface la date de début en cours.
    client.debtStartDate = null;
  }
};

/**
 * Calcule les statistiques de dette d'un client pour la section
 * "Gestion des Dettes & Relances" :
 * - le nombre de fois où le client a été mis en dette (= le nombre de
 *   tâches/sponsors créés comme impayés pour ce client, quel que soit
 *   leur statut de paiement actuel — chaque lancement marqué "impayé"
 *   compte une fois, calculé directement à partir des transactions/
 *   tâches existantes, pas d'un compteur stocké qui pourrait désynchroniser)
 * - la date de début de la dette en cours
 * - le pourcentage de ses lancements (tâches/sponsors) payés vs impayés
 * @param {object} client 
 * @returns {{debtCount:number, debtStartDate:(string|null), totalLaunches:number, unpaidLaunches:number, paidLaunches:number, unpaidPercent:number, paidPercent:number}}
 */
window.getClientDebtStats = function(client) {
  const empty = { debtCount: 0, debtStartDate: null, totalLaunches: 0, unpaidLaunches: 0, paidLaunches: 0, unpaidPercent: 0, paidPercent: 0 };
  if (!client) return empty;

  const all = [
    ...((appState && appState.todoTransactions) || []),
    ...((appState && appState.transactions) || [])
  ].filter(t => t && t.clientId === client.id);

  const totalLaunches = all.length;
  const unpaidLaunches = all.filter(t => !t.paid).length;
  const paidLaunches = totalLaunches - unpaidLaunches;
  const unpaidPercent = totalLaunches > 0 ? Math.round((unpaidLaunches / totalLaunches) * 100) : 0;
  const paidPercent = totalLaunches > 0 ? (100 - unpaidPercent) : 0;

  return {
    debtCount: unpaidLaunches,
    debtStartDate: client.debtStartDate || null,
    totalLaunches,
    unpaidLaunches,
    paidLaunches,
    unpaidPercent,
    paidPercent
  };
};

/**
 * Affiche un toast de notification moderne et non bloquant
 * @param {string} message 
 * @param {string} type 'success' | 'error' | 'info' | 'warning'
 */
window.showToast = function(message, type = 'info') {
  // Créer le conteneur de toasts s'il n'existe pas
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col gap-2';
    document.body.appendChild(container);
  }

  // Définir les styles selon le type
  const styles = {
    success: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white',
    warning: 'bg-yellow-500 text-white'
  };

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle'
  };

  // Créer l'élément toast
  const toast = document.createElement('div');
  toast.className = `${styles[type] || styles.info} px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 min-w-[300px] transform transition-all duration-300 translate-y-10 opacity-0`;
  // Le message est affiché comme TEXTE (jamais interprété comme HTML) : un nom de client
  // contenant du code ne peut donc pas s'exécuter via une notification.
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info} text-xl"></i>
    <span class="font-bold text-sm">${escapeHtml(message)}</span>
  `;

  // Ajouter au DOM
  container.appendChild(toast);

  // Animation d'entrée
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
  });

  // Suppression automatique
  setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 4000);
};

/**
 * Copie du texte dans le presse-papier
 * @param {string} text 
 */
window.copyToClipboard = function(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => { showToast('Copié'); }).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copié'); } catch (e) {}
    document.body.removeChild(ta);
  }
};

/**
 * Vérifie si la session actuelle est Admin
 * @returns {boolean}
 */
window.isAdminSession = function() {
  return !!auth.currentUser;
};

/**
 * Vérifie si la session actuelle est Admin OU Employé (accès espace pro)
 * @returns {boolean}
 */
window.isStaffSession = function() {
  return !!auth.currentUser || (appState.session && (appState.session.type === 'employee' || appState.session.type === 'admin'));
};

/**
 * Lit un fichier en tant que Data URL (Base64)
 * @param {File} file 
 * @returns {Promise<string>}
 */
window.readFileAsDataURL = function(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
