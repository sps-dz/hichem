// === CLIENT-SPACE.JS ===
// Toutes les fonctions de l'espace client extraites de main.js

// === UTILITAIRES LOCAUX ===
function setLanguage(lang) {
  const isAr = lang === 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = isAr ? 'rtl' : 'ltr';
  const t = (window.TRANSLATIONS || {})[lang] || (window.TRANSLATIONS || {}).fr || {};
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) {
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && key.startsWith('ph_')) {
        el.placeholder = t[key];
      } else {
        el.textContent = t[key];
      }
    }
  });
}
window.setLanguage = setLanguage;

function ensureInitialData() {
  if (!appState.settings) appState.settings = {};
  if (!appState.settings.storageMode) appState.settings.storageMode = 'cloud';
  if (appState.settings.seedDefaults && (!Array.isArray(appState.offers) || appState.offers.length === 0)) {
    appState.offers = [
      { id: generateId('offer'), name: 'USD Standard', description: 'Achat standard de dollars', price: 30000, costPerUnit: 88, duration: 'N/A' },
      { id: generateId('offer'), name: 'Pack 500$', description: 'Pack pour 500 dollars', price: 150000, costPerUnit: 441, duration: 'N/A' },
      { id: generateId('offer'), name: 'Service Premium', description: 'Service premium pour clients VIP', price: 50000, costPerUnit: 147, duration: '30 jours' },
    ];
  }
  if (!Array.isArray(appState.clients)) appState.clients = [];
  if (!Array.isArray(appState.transactions)) appState.transactions = [];
  if (!Array.isArray(appState.payments)) appState.payments = [];
  if (!Array.isArray(appState.usdPurchases)) appState.usdPurchases = [];
  if (!Array.isArray(appState.employees)) appState.employees = [];
  if (!appState.settings.workMethodSections) appState.settings.workMethodSections = [];
  if (!appState.manualBalances) appState.manualBalances = { liquide: 0, baridimob: 0, usdt: 0 };
  if (!appState.customSection) appState.customSection = { title: 'Nos Réalisations', categories: [] };
}
window.ensureInitialData = ensureInitialData;

function ensureClientToken() {
  if (!localStorage.getItem('clientToken')) {
    localStorage.setItem('clientToken', 'CT-' + Math.random().toString(36).slice(2) + Date.now());
  }
}
function getClientToken() {
  ensureClientToken();
  return localStorage.getItem('clientToken');
}

// === NAVIGATION CLIENT ===
window.showClientSpace = function () {
  const appContainer = document.getElementById('appContainer');
  const loginContainer = document.getElementById('loginContainer');
  const clientSpace = document.getElementById('clientSpaceContainer');
  if (appContainer) appContainer.style.display = 'none';
  if (loginContainer) loginContainer.style.display = 'none';
  if (clientSpace) clientSpace.style.display = 'block';

  ensureInitialData();
  populateClientOrderOffers();
  renderClientOffers();
  renderClientAccountInfo();

  const userLang = (navigator.language && navigator.language.startsWith('ar')) ? 'ar' : 'fr';
  setLanguage(userLang);

  showClientTab('client-infos');
};

window.showClientTab = function (tabId) {
  document.querySelectorAll('.client-tab-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(tabId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.client-tab-btn').forEach(btn => {
    btn.classList.remove('bg-blue-100', 'text-blue-700', 'active-client-tab');
    btn.classList.add('text-gray-600', 'hover:bg-gray-100');
    if (btn.dataset.tab === tabId) {
      btn.classList.remove('text-gray-600', 'hover:bg-gray-100');
      btn.classList.add('bg-blue-100', 'text-blue-700', 'active-client-tab');
    }
  });

  if (tabId === 'client-offres') {
    populateClientOrderOffers();
    renderClientOffers();
  }
  if (tabId === 'client-method') {
    const content = document.getElementById('clientMethodContent');
    if (content) {
      content.innerHTML = (appState.settings && appState.settings.workMethodText) || '<p class="text-gray-500">Information non disponible.</p>';
      content.querySelectorAll('img').forEach(img => {
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => openImagePreview(img.src));
      });
    }
  }
  if (tabId === 'client-custom') renderCustomSectionClient();
  if (tabId === 'client-requests') renderClientRequests();
  if (tabId === 'client-order') populateClientOrderOffers();
};

window.logoutClient = function () {
  if (typeof appState !== 'undefined') {
    appState.session = null;
    try { saveToLocalStorage(); } catch (e) {}
  }
  if (typeof updateAuthUI === 'function') updateAuthUI(null);
  showToast('Déconnecté', 'success');
  const loginContainer = document.getElementById('loginContainer');
  const clientSpace = document.getElementById('clientSpaceContainer');
  if (clientSpace) clientSpace.style.display = 'none';
  if (loginContainer) loginContainer.style.display = 'flex';
};

// === AUTH CLIENT ===
window.signupClient = async function () {
  const nameEl = document.getElementById('signupClientName');
  const userEl = document.getElementById('signupClientUsername');
  const phoneEl = document.getElementById('signupClientPhone');
  const emailEl = document.getElementById('signupClientEmail');
  const passEl = document.getElementById('signupClientPassword');
  const name = nameEl ? nameEl.value.trim() : '';
  const username = userEl ? userEl.value.trim() : '';
  const phone = phoneEl ? phoneEl.value.trim() : '';
  const email = emailEl ? emailEl.value.trim() : '';
  const password = passEl ? passEl.value.trim() : '';

  if (!name) { showToast('Nom requis', 'error'); return; }
  if (!username) { showToast("Nom d'utilisateur requis", 'error'); return; }
  if (!phone) { showToast('Téléphone requis', 'error'); return; }
  if (!password) { showToast('Mot de passe requis', 'error'); return; }

  ensureInitialData();
  const exists = (appState.clients || []).find(c =>
    (email && c.email && c.email.toLowerCase() === email.toLowerCase()) ||
    (username && c.username && c.username.toLowerCase() === username.toLowerCase())
  );
  if (exists) { showToast('Ce compte existe déjà', 'error'); return; }

  const newClientSalt = generateSalt();
  const newClientPasswordHash = await hashPassword(password, newClientSalt);
  const newClient = {
    id: generateId('client'),
    name, email, username, phone,
    passwordHash: newClientPasswordHash,
    passwordSalt: newClientSalt,
    contact: email || phone || username,
    social: { instagram: [], facebook: [] },
    createdAt: Date.now(),
    notes: 'Compte client créé',
    totalSpent: 0, transactionsCount: 0, unpaid: 0
  };

  if (!appState.clients) appState.clients = [];
  appState.clients.push(newClient);
  appState.session = { type: 'client', id: newClient.id, name: newClient.name, username: newClient.username, phone: newClient.phone };
  try { saveToLocalStorage(); } catch (e) {}

  window.showClientSpace();
  showToast('Compte créé avec succès !', 'success');

  try {
    await syncClientAccount(newClient);
  } catch (e) { console.warn('Sync error', e); }

  if (nameEl) nameEl.value = '';
  if (userEl) userEl.value = '';
  if (phoneEl) phoneEl.value = '';
  if (emailEl) emailEl.value = '';
  if (passEl) passEl.value = '';
};

window.loginClientQuick = async function () {
  const idEl = document.getElementById('clientQuickId');
  const passEl = document.getElementById('clientQuickPass');
  const ident = idEl ? idEl.value.trim().toLowerCase() : '';
  const password = passEl ? passEl.value : '';
  if (!ident) { showToast('Entrez téléphone ou utilisateur', 'error'); return; }
  if (!password) { showToast('Mot de passe requis', 'error'); return; }

  ensureInitialData();
  let c = (appState.clients || []).find(x =>
    (x.phone || '').toLowerCase() === ident ||
    (x.username || '').toLowerCase() === ident ||
    (x.email || '').toLowerCase() === ident
  );

  // Try cloud fetch if not found locally
  if (!c && typeof firebase !== 'undefined') {
    try {
      const db = firebase.firestore();
      let q = await db.collection('clients').where('email', '==', ident).limit(1).get();
      if (q.empty) q = await db.collection('clients').where('username', '==', ident).limit(1).get();
      if (q.empty) q = await db.collection('clients').where('phone', '==', ident).limit(1).get();
      if (!q.empty) {
        c = q.docs[0].data();
        if (!appState.clients) appState.clients = [];
        appState.clients.push(c);
        saveToLocalStorage();
      }
    } catch (e) { console.warn('Client fetch error:', e); }
  }

  if (!c) { showToast('Client introuvable', 'error'); return; }

  const check = await verifyAccountPassword(c, password);
  if (!check.ok) { showToast('Mot de passe incorrect', 'error'); return; }

  // Migration transparente : si le compte utilisait encore un mot de passe en
  // clair (créé avant la mise à jour sécurité), on le remplace par un hash.
  if (check.needsMigration) {
    const salt = generateSalt();
    c.passwordHash = await hashPassword(password, salt);
    c.passwordSalt = salt;
    delete c.password;
    try { await syncClientAccount(c); } catch (e) { console.warn('Migration sync error', e); }
  }

  appState.session = { type: 'client', id: c.id, name: c.name, username: c.username || '', phone: c.phone || '' };
  try { saveToLocalStorage(); } catch (e) {}
  if (passEl) passEl.value = '';
  window.showClientSpace();
};

// === COMPTE CLIENT INFO ===
function currentClient() {
  if (!(appState.session && appState.session.type === 'client')) return null;
  const id = appState.session.id;
  return (appState.clients || []).find(c => c.id === id) || null;
}

function renderClientAccountInfo() {
  const c = currentClient();
  const nameEl = document.getElementById('clientAccName');
  const userEl = document.getElementById('clientAccUser');
  const phoneEl = document.getElementById('clientAccPhone');
  const emailEl = document.getElementById('clientAccEmail');
  if (!c) {
    if (nameEl) nameEl.value = '';
    if (userEl) userEl.value = '';
    if (phoneEl) phoneEl.value = '';
    if (emailEl) emailEl.value = '';
    return;
  }
  if (nameEl) nameEl.value = c.name || '';
  if (userEl) userEl.value = c.username || '';
  if (phoneEl) phoneEl.value = c.phone || '';
  if (emailEl) emailEl.value = c.email || '';
  renderClientSocialLists(c);
}
window.renderClientAccountInfo = renderClientAccountInfo;

function renderClientSocialLists(c) {
  const igWrap = document.getElementById('clientInstagramList');
  const fbWrap = document.getElementById('clientFacebookList');
  if (igWrap) {
    igWrap.innerHTML = '';
    const arr = (c.social && Array.isArray(c.social.instagram)) ? c.social.instagram : [];
    arr.forEach((acc, idx) => {
      const chip = document.createElement('div');
      chip.className = 'px-3 py-1 bg-pink-100 text-pink-700 rounded-full text-sm flex items-center gap-2';
      chip.innerHTML = '<span>' + escapeHtml(acc) + '</span><button class="text-pink-700" onclick="removeClientInstagram(' + idx + ')"><i class="fas fa-times"></i></button>';
      igWrap.appendChild(chip);
    });
  }
  if (fbWrap) {
    fbWrap.innerHTML = '';
    const arr = (c.social && Array.isArray(c.social.facebook)) ? c.social.facebook : [];
    arr.forEach((acc, idx) => {
      const chip = document.createElement('div');
      chip.className = 'px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-2';
      chip.innerHTML = '<span>' + escapeHtml(acc) + '</span><button class="text-blue-700" onclick="removeClientFacebook(' + idx + ')"><i class="fas fa-times"></i></button>';
      fbWrap.appendChild(chip);
    });
  }
}

window.saveClientIdentifiers = async function () {
  const c = currentClient();
  if (!c) { showToast('Aucun client', 'error'); return; }
  c.name = document.getElementById('clientAccName')?.value.trim() || c.name;
  c.username = document.getElementById('clientAccUser')?.value.trim() || '';
  c.phone = document.getElementById('clientAccPhone')?.value.trim() || '';
  c.email = document.getElementById('clientAccEmail')?.value.trim() || '';
  c.contact = c.email || c.phone || c.username || c.contact;
  try { saveToLocalStorage(); } catch (e) {}
  await syncClientAccount(c);
  showToast('Profil mis à jour', 'success');
  renderClientAccountInfo();
};

window.addClientInstagram = async function () {
  const c = currentClient();
  if (!c) { showToast('Aucun client', 'error'); return; }
  const val = document.getElementById('clientAddInstagram')?.value.trim();
  if (!val) return;
  if (!c.social) c.social = { instagram: [], facebook: [] };
  if (!Array.isArray(c.social.instagram)) c.social.instagram = [];
  if (!c.social.instagram.includes(val)) c.social.instagram.push(val);
  document.getElementById('clientAddInstagram').value = '';
  try { saveToLocalStorage(); } catch (e) {}
  await syncClientAccount(c);
  renderClientAccountInfo();
};

window.addClientFacebook = async function () {
  const c = currentClient();
  if (!c) { showToast('Aucun client', 'error'); return; }
  const val = document.getElementById('clientAddFacebook')?.value.trim();
  if (!val) return;
  if (!c.social) c.social = { instagram: [], facebook: [] };
  if (!Array.isArray(c.social.facebook)) c.social.facebook = [];
  if (!c.social.facebook.includes(val)) c.social.facebook.push(val);
  document.getElementById('clientAddFacebook').value = '';
  try { saveToLocalStorage(); } catch (e) {}
  await syncClientAccount(c);
  renderClientAccountInfo();
};

window.removeClientInstagram = async function (idx) {
  const c = currentClient();
  if (!c || !c.social || !Array.isArray(c.social.instagram)) return;
  c.social.instagram.splice(idx, 1);
  try { saveToLocalStorage(); } catch (e) {}
  await syncClientAccount(c);
  renderClientAccountInfo();
};

window.removeClientFacebook = async function (idx) {
  const c = currentClient();
  if (!c || !c.social || !Array.isArray(c.social.facebook)) return;
  c.social.facebook.splice(idx, 1);
  try { saveToLocalStorage(); } catch (e) {}
  await syncClientAccount(c);
  renderClientAccountInfo();
};

// === OFFRES CLIENT ===
function renderClientOffers() {
  const container = document.querySelector('#client-offres .grid');
  if (!container) return;
  const offers = (appState && appState.offers) || [];
  if (offers.length === 0) {
    container.innerHTML = '<p class="text-gray-500 col-span-2 text-center py-8">Aucune offre disponible pour le moment.</p>';
    return;
  }
  container.innerHTML = '';
  offers.forEach(offer => {
    const div = document.createElement('div');
    div.className = 'border border-gray-200 rounded-2xl p-5 hover:shadow-lg transition-all cursor-pointer bg-white flex flex-col justify-between';
    div.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-3">
          <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">Offre</span>
          <span class="text-lg font-bold text-gray-800">${escapeHtml(offer.name)}</span>
        </div>
        <p class="text-gray-600 text-sm mb-4 leading-relaxed">${escapeHtml(offer.description) || 'Aucune description'}</p>
        ${offer.priceDzd ? `<div class="text-xl font-bold text-blue-600 mb-4">${formatCurrency(offer.priceDzd)}</div>` : ''}
      </div>
      <button onclick="selectClientOffer('${offer.id}')" class="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">
        <i class="fas fa-shopping-cart mr-2"></i> Commander
      </button>
    `;
    container.appendChild(div);
  });
}

function populateClientOrderOffers() {
  const select = document.getElementById('orderOfferSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Choisir une offre --</option>';
  const offers = (appState && appState.offers) || [];
  offers.forEach(offer => {
    const opt = document.createElement('option');
    opt.value = offer.name;
    opt.textContent = `${offer.name}${offer.priceDzd ? ' — ' + formatCurrency(offer.priceDzd) : ''}`;
    select.appendChild(opt);
  });
}

window.selectClientOffer = function (offerId) {
  showClientTab('client-order');
  const offer = (appState.offers || []).find(o => o.id === offerId);
  if (offer) {
    const select = document.getElementById('orderOfferSelect');
    if (select) select.value = offer.name;
  }
};

// === FORMULAIRE DE COMMANDE ===
window.updateFormLogic = function () {
  const platform = document.getElementById('platformSelect')?.value;
  const metaSection = document.getElementById('metaSection');
  const tiktokSection = document.getElementById('tiktokSection');
  const commonFields = document.getElementById('commonFields');
  const websiteSection = document.getElementById('websiteLinkSection');

  if (metaSection) metaSection.classList.add('hidden');
  if (tiktokSection) tiktokSection.classList.add('hidden');
  if (commonFields) commonFields.classList.add('hidden');
  if (websiteSection) websiteSection.classList.add('hidden');

  if (platform === 'meta') {
    if (metaSection) metaSection.classList.remove('hidden');
    if (commonFields) commonFields.classList.remove('hidden');
    updateMetaLogic();
  } else if (platform === 'tiktok') {
    if (tiktokSection) tiktokSection.classList.remove('hidden');
    if (commonFields) commonFields.classList.remove('hidden');
    updateTikTokLogic();
  }
};

function updateMetaLogic() {
  const objective = document.getElementById('metaObjective')?.value;
  const followersOpts = document.getElementById('metaFollowersOptions');
  const messagesOpts = document.getElementById('metaMessagesOptions');
  const websiteSection = document.getElementById('websiteLinkSection');
  if (followersOpts) followersOpts.classList.add('hidden');
  if (messagesOpts) messagesOpts.classList.add('hidden');
  if (websiteSection) websiteSection.classList.add('hidden');
  if (objective === 'followers' && followersOpts) followersOpts.classList.remove('hidden');
  else if (objective === 'messages' && messagesOpts) messagesOpts.classList.remove('hidden');
  else if (objective === 'conversion' && websiteSection) websiteSection.classList.remove('hidden');
}
window.updateMetaLogic = updateMetaLogic;

function updateTikTokLogic() {
  const objective = document.getElementById('tiktokObjective')?.value;
  const messagesOpts = document.getElementById('tiktokMessagesOptions');
  const websiteSection = document.getElementById('websiteLinkSection');
  if (messagesOpts) messagesOpts.classList.add('hidden');
  if (websiteSection) websiteSection.classList.add('hidden');
  if (objective === 'messages' && messagesOpts) messagesOpts.classList.remove('hidden');
  else if (objective === 'conversion' && websiteSection) websiteSection.classList.remove('hidden');
}
window.updateTikTokLogic = updateTikTokLogic;

window.toggleRedotpayCalculator = function () {
  const select = document.getElementById('paymentMethodSelect');
  const calc = document.getElementById('redotpayCalculator');
  const ccp = document.getElementById('ccpInfo');
  const baridi = document.getElementById('baridimobInfo');
  if (!select) return;
  if (calc) calc.classList.add('hidden');
  if (ccp) ccp.classList.add('hidden');
  if (baridi) baridi.classList.add('hidden');
  if (select.value === 'redotpay' && calc) calc.classList.remove('hidden');
  else if (select.value === 'ccp' && ccp) ccp.classList.remove('hidden');
  else if (select.value === 'baridimob' && baridi) baridi.classList.remove('hidden');
};

window.calculateRedotpayUsd = function () {
  const dzdInput = document.getElementById('redotpayDzdAmount');
  const usdDisplay = document.getElementById('redotpayUsdDisplay');
  if (!dzdInput || !usdDisplay) return;
  const dzd = parseFloat(dzdInput.value);
  usdDisplay.textContent = (!isNaN(dzd) && dzd > 0) ? (dzd / 250).toFixed(2) + ' $' : '0.00 $';
};

// === IMAGE PREVIEW ===
function openImagePreview(src) {
  const clientVisible = document.getElementById('clientSpaceContainer')?.style.display !== 'none';
  if (clientVisible) {
    const modal = document.getElementById('clientImagePreviewModal');
    const img = document.getElementById('clientImagePreviewContent');
    if (modal && img) { img.src = src; modal.classList.remove('hidden'); }
  } else {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('imagePreviewContent');
    if (modal && img) { img.src = src; modal.classList.remove('hidden'); }
  }
}
window.openImagePreview = openImagePreview;

// === SYNC CLOUD ===
async function syncClientAccount(clientData) {
  try {
    if (!clientData || !clientData.id) return;
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      await firebase.firestore().collection('clients').doc(clientData.id).set(clientData, { merge: true });
    }
  } catch (e) { console.warn('Erreur synchro client:', e); }
}

async function syncClientRequest(orderData) {
  try {
    const docId = orderData.id || 'REQ-' + Date.now();
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      await firebase.firestore().collection('requests').doc(docId).set(orderData, { merge: true });
    }
  } catch (e) { console.warn('Erreur synchro demande:', e); }
}

// === DEMANDES CLIENT ===
async function renderClientRequests() {
  const list = document.getElementById('clientRequestsList');
  if (!list) return;

  const token = getClientToken();
  const sessionId = (appState.session && appState.session.type === 'client') ? appState.session.id : null;
  let clientContact = null;

  if (sessionId) {
    const client = (appState.clients || []).find(c => c.id === sessionId);
    if (client) clientContact = client.contact;

    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const snaps = await firebase.firestore().collection('requests').where('clientId', '==', sessionId).get();
        snaps.forEach(doc => {
          const d = doc.data();
          if (!appState.clientRequests) appState.clientRequests = [];
          if (isSafeDocId(d.id) && !appState.clientRequests.some(r => r.id === d.id)) appState.clientRequests.push(d);
        });
      } catch (e) { console.warn('Sync requests error:', e); }
    }
  }

  const items = (appState.clientRequests || []).filter(r => {
    if (r.clientToken && r.clientToken === token) return true;
    if (sessionId && r.clientId === sessionId) return true;
    if (clientContact) {
      if (r.instagram && r.instagram.toLowerCase() === clientContact.toLowerCase()) return true;
      if (r.pageFacebook && r.pageFacebook.toLowerCase() === clientContact.toLowerCase()) return true;
    }
    return false;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-inbox text-3xl mb-3 text-gray-300"></i><p>Aucune demande pour le moment.</p></div>';
    return;
  }

  const statusMap = {
    pending: { text: 'En attente', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    in_progress: { text: 'En cours', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
    problematic: { text: 'Problématique', cls: 'bg-red-100 text-red-800 border-red-200' },
    processed: { text: 'Traité', cls: 'bg-green-100 text-green-800 border-green-200' }
  };

  items.forEach(req => {
    const s = statusMap[req.status || 'pending'] || statusMap.pending;
    const div = document.createElement('div');
    div.className = 'border border-gray-200 rounded-xl p-4 bg-white flex items-center justify-between hover:shadow-sm transition-all';
    div.innerHTML = `
      <div>
        <div class="font-bold text-gray-800">${escapeHtml(req.offer) || 'Offre'}</div>
        <div class="text-xs text-gray-500 mt-1"><i class="far fa-clock mr-1"></i> ${new Date(req.date).toLocaleDateString('fr-FR', { timeZone: 'Africa/Algiers' })}</div>
        ${req.pubLink ? `<div class="text-xs mt-1"><a class="text-blue-600 hover:underline" target="_blank" href="${safeUrl(req.pubLink)}"><i class="fas fa-link mr-1"></i> Lien Pub</a></div>` : ''}
        ${req.instagram ? `<div class="text-xs text-gray-400 mt-0.5">@${escapeHtml(req.instagram)}</div>` : ''}
      </div>
      <span class="px-3 py-1 rounded-full border text-xs font-semibold ${s.cls}">${s.text}</span>
    `;
    list.appendChild(div);
  });
}

// === POPUP NOUVEAU CLIENT ===
function showNewClientPopup() {
  const userLang = navigator.language.startsWith('ar') ? 'ar' : 'fr';
  const t = (window.TRANSLATIONS || {})[userLang] || {};
  const html = `
    <div id="newClientModal" class="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center relative">
        <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
          <i class="fas fa-check"></i>
        </div>
        <h3 class="text-2xl font-bold text-gray-800 mb-2">${escapeHtml(t.popup_new_client_title || 'Bienvenue !')}</h3>
        <p class="text-gray-600 mb-6">${escapeHtml(t.popup_new_client_msg || 'Nous avons bien reçu votre première commande.')}</p>
        <button onclick="closeNewClientPopupAndRedirect()" class="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">
          <i class="fas fa-book-open mr-2"></i> ${escapeHtml(t.btn_go_method || 'Voir la Méthode de Travail')}
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

window.closeNewClientPopupAndRedirect = function () {
  const modal = document.getElementById('newClientModal');
  if (modal) modal.remove();
  showClientTab('client-method');
};

// === SOUMISSION COMMANDE ===
window.handleOrderSubmit = async function (e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]') || e.target.querySelector('button');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Envoi en cours...'; btn.disabled = true; }

  const platform = document.getElementById('platformSelect')?.value || '';
  const paymentMethod = document.getElementById('paymentMethodSelect')?.value || '';
  const offerName = document.getElementById('orderOfferSelect')?.value || '';

  const orderData = {
    id: 'REQ-' + Date.now(),
    date: getLocalDateString ? getLocalDateString() : new Date().toISOString().slice(0, 10),
    read: false, processed: false,
    platform, paymentMethod, offer: offerName,
    paymentProof: null, status: 'pending',
    clientToken: getClientToken()
  };

  if (platform === 'meta') {
    orderData.metaObjective = document.getElementById('metaObjective')?.value;
    const followersTarget = document.querySelector('input[name="metaFollowersTarget"]:checked');
    if (followersTarget) orderData.metaFollowersTarget = followersTarget.value;
    const messagesTargets = document.querySelectorAll('input[name="metaMsgTarget"]:checked');
    if (messagesTargets.length) orderData.metaMessagesTarget = Array.from(messagesTargets).map(cb => cb.value).join(', ');
  } else if (platform === 'tiktok') {
    orderData.tiktokObjective = document.getElementById('tiktokObjective')?.value;
    const tiktokMsg = document.querySelector('input[name="tiktokMsgTarget"]:checked');
    if (tiktokMsg) orderData.tiktokMsgTarget = tiktokMsg.value;
  }

  orderData.instagram = document.getElementById('metaInstaName')?.value || '';
  orderData.pageFacebook = document.getElementById('metaFbName')?.value || '';
  orderData.websiteUrl = document.getElementById('websiteUrl')?.value || '';
  orderData.pubLink = document.getElementById('pubLink')?.value || '';
  orderData.clientNote = document.getElementById('clientNote')?.value || '';

  // Preuve de paiement
  const proofInput = document.getElementById('paymentProof');
  if (proofInput && proofInput.files && proofInput.files[0]) {
    try {
      orderData.paymentProof = await readFileAsBase64(proofInput.files[0]);
    } catch (err) { console.warn('Erreur preuve:', err); }
  }

  if (appState.session && appState.session.type === 'client') {
    orderData.clientId = appState.session.id;
  }

  if (!appState.clientRequests) appState.clientRequests = [];
  appState.clientRequests.push(orderData);

  try { saveToLocalStorage(); } catch (e) {}
  await syncClientRequest(orderData);

  // Badge de demandes
  const badge = document.getElementById('requestsBadge');
  if (badge) {
    const unread = (appState.clientRequests || []).filter(r => !r.read).length;
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);
  }

  showToast('Commande envoyée avec succès !', 'success');
  showNewClientPopup();

  if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
  e.target.reset();
  window.updateFormLogic();
  const preview = document.getElementById('filePreview');
  if (preview) preview.innerHTML = '<i class="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i><p class="text-gray-500">Cliquez ou déposez votre reçu ici</p>';
  document.querySelectorAll('#redotpayCalculator, #ccpInfo, #baridimobInfo').forEach(el => el.classList.add('hidden'));
};

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.previewFile = function (input) {
  const preview = document.getElementById('filePreview');
  if (input.files && input.files[0] && preview) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<img src="${e.target.result}" class="h-32 mx-auto rounded-lg object-contain shadow-md">`;
    };
    reader.readAsDataURL(input.files[0]);
  }
};

// === SECTION PERSONNALISÉE ===
function renderCustomSectionClient() {
  const container = document.getElementById('clientCustomContent');
  const title = document.getElementById('clientCustomTitle');
  const tabTitle = document.getElementById('clientCustomTabTitle');

  if (appState.customSection) {
    if (title) title.textContent = appState.customSection.title || 'Nos Réalisations';
    if (tabTitle) tabTitle.textContent = appState.customSection.title || 'Nos Réalisations';
  }

  if (!container || !appState.customSection) return;
  container.innerHTML = '';

  const cats = appState.customSection.categories || [];
  if (cats.length === 0) {
    container.innerHTML = '<p class="text-gray-500 col-span-3 text-center py-8">Bientôt disponible...</p>';
    return;
  }

  cats.forEach(cat => {
    if (!Array.isArray(cat.photos)) cat.photos = cat.image ? [cat.image] : [];
    const cover = cat.photos[0] || 'https://via.placeholder.com/400x300?text=No+Image';
    const gallery = cat.photos.length > 1
      ? `<div class="p-4 pt-0 grid grid-cols-3 gap-2">${cat.photos.slice(1).map(p => `<img src="${safeUrl(p)}" loading="lazy" class="w-full h-24 object-cover rounded-lg border cursor-pointer" onclick="openImagePreview('${escapeJsAttr(safeUrlRaw(p))}')">`).join('')}</div>`
      : '';
    const div = document.createElement('div');
    div.className = 'bg-white rounded-2xl shadow-md overflow-hidden border hover:shadow-xl transition-all';
    div.innerHTML = `
      <div class="h-48 bg-gray-200 overflow-hidden">
        <img src="${safeUrl(cover)}" loading="lazy" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500 cursor-pointer" onclick="openImagePreview('${escapeJsAttr(safeUrlRaw(cover))}')">
      </div>
      <div class="p-5">
        <h3 class="text-lg font-bold text-gray-800 mb-1">${escapeHtml(cat.title) || ''}</h3>
        <p class="text-gray-600 text-sm leading-relaxed">${escapeHtml(cat.desc) || ''}</p>
      </div>
      ${gallery}
    `;
    container.appendChild(div);
  });
}
window.renderCustomSectionClient = renderCustomSectionClient;

// === INITIALISATION ESPACE CLIENT ===
// Appelée depuis app.js au moment approprié
window.initClientSpaceListeners = function () {
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const onEnter = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (typeof window.handleLoginClick === 'function') window.handleLoginClick(); }
  };
  if (loginEmail) loginEmail.addEventListener('keydown', onEnter);
  if (loginPassword) loginPassword.addEventListener('keydown', onEnter);

  const userLang = (navigator.language && navigator.language.startsWith('ar')) ? 'ar' : 'fr';
  setLanguage(userLang);
};
