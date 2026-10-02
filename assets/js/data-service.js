// === DATA-SERVICE.JS ===

/**
 * Normalise l'état global de l'application
 */
window.normalizeAppState = function() {
  const currentUid = auth.currentUser ? auth.currentUser.uid : null;
  const now = Date.now();
  let changed = false;

  if (!appState.balances) {
    appState.balances = { liquide: 0, baridimob: 0, usdt: 0 };
    changed = true;
  }
  
  if (!appState.settings) {
    appState.settings = { storageMode: 'cloud', autoSaveEnabled: true };
    changed = true;
  }
  if (!appState.settings.storageMode) {
    appState.settings.storageMode = 'cloud';
    changed = true;
  }
  if (appState.settings.autoSaveEnabled === undefined) {
    appState.settings.autoSaveEnabled = true;
    changed = true;
  }
  
  if (!appState.sync) {
    appState.sync = { pendingCloudSave: false, retryDelayMs: 5000, itemSnapshots: {}, pendingDeletions: [] };
    changed = true;
  }

  const collections = ['clients', 'offers', 'transactions', 'todoTransactions', 'payments', 'usdPurchases', 'expenses', 'usdtExpenses', 'recurringExpenses', 'clientRequests', 'employees', 'adAccounts', 'products', 'employeePayments', 'employeePerformance'];
  
  // Initialiser performanceConfig si non existant
  if (!appState.performanceConfig) {
    appState.performanceConfig = {
      ratePerTask: 1700,
      fixedCosts: {
        salary: 40000,
        internet: 3000,
        pub: 20000,
        risque: 15000
      }
    };
    changed = true;
  }
  
  collections.forEach(col => {
    if (!Array.isArray(appState[col])) {
      appState[col] = [];
      changed = true;
    }
  });

  // Migration : pour les clients déjà en dette avant l'ajout du suivi
  // "Dettes & Relances", on initialise la date de début rétroactivement
  // afin qu'elle s'affiche correctement (le compteur "fois en dette",
  // lui, est toujours recalculé en direct à partir des transactions
  // réelles dans getClientDebtStats(), donc il n'a pas besoin de migration).
  if (Array.isArray(appState.clients)) {
    appState.clients.forEach(c => {
      if (!c || typeof c !== 'object') return;
      if (Number(c.unpaid || 0) > 0 && !c.debtStartDate) {
        c.debtStartDate = c.updatedAt ? getLocalDateString(new Date(c.updatedAt)) : getLocalDateString();
        changed = true;
      }
    });
  }

  if (Array.isArray(appState.offers)) {
    appState.offers.forEach(o => {
      if (!o || typeof o !== 'object') return;
      if (o.priceDzd == null && o.price != null) o.priceDzd = o.price;
      const p = Number(o.priceDzd || 0);
      o.priceDzd = Number.isFinite(p) ? p : 0;
      const c = Number(o.costPerUnit || 0);
      o.costPerUnit = Number.isFinite(c) ? c : 0;
      if (!o.name) o.name = 'Offre';
    });
  }

  if (changed) {
    saveToLocalStorage();
  }
};

/**
 * Sauvegarde locale (Session uniquement)
 */
window.saveToLocalStorage = function() {
  const sessionData = {
    session: appState.session || null,
    adminUid: appState.adminUid || null,
    // Suppressions pas encore confirmées par le cloud : conservées si l'onglet est fermé / coupure réseau
    pendingDeletions: (appState.sync && Array.isArray(appState.sync.pendingDeletions)) ? appState.sync.pendingDeletions : []
  };
  localStorage.setItem('hichemSponsorSession', JSON.stringify(sessionData));
};

/**
 * Chargement local (Session uniquement)
 */
window.loadFromLocalStorage = function() {
  try {
    const raw = localStorage.getItem('hichemSponsorSession');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.session) appState.session = parsed.session;
      if (parsed.adminUid) appState.adminUid = parsed.adminUid;
      if (Array.isArray(parsed.pendingDeletions) && parsed.pendingDeletions.length) {
        if (!appState.sync) appState.sync = {};
        if (!Array.isArray(appState.sync.pendingDeletions)) appState.sync.pendingDeletions = [];
        parsed.pendingDeletions.forEach(d => {
          if (d && d.col && d.id && !appState.sync.pendingDeletions.some(x => x.col === d.col && x.id === d.id)) appState.sync.pendingDeletions.push(d);
        });
      }
    }
  } catch(e) { console.error('Erreur lecture session locale', e); }
  
  // Suppression de l'ancienne version complète pour éviter les conflits ghost
  localStorage.removeItem('hichemSponsor');
};

/**
 * Sauvegarde Cloud (Firestore)
 */
window.saveToCloud = async function() {
  try {
    const uid = auth?.currentUser?.uid || appState?.adminUid;
    if (!uid) return;
    const db = firebase.firestore();
    
    appState.lastUpdated = Date.now();
    
    // On sauvegarde un snapshot des réglages
    const settings = JSON.parse(JSON.stringify({
      globalConfig: appState.globalConfig || null,
      settings: appState.settings || null,
      manualBalances: appState.manualBalances || null,
      activityLog: (appState.activityLog || []).slice(0, 500),
      lastUpdated: appState.lastUpdated || Date.now()
    }));
    
    await db.collection('users').doc(uid).set({ data: settings }, { merge: true });
    
    // Synchro granulaire des collections
    await syncGranularToCloud();
    
    // Process pending deletions
    if (appState.sync && appState.sync.pendingDeletions && appState.sync.pendingDeletions.length > 0) {
        // On ne retire de la file QUE les suppressions réellement réussies : une suppression qui échoue
        // (coupure réseau, droits) est conservée et retentée à la prochaine sauvegarde.
        const batch = appState.sync.pendingDeletions.slice();
        const results = await Promise.all(batch.map(del =>
            db.collection(del.col).doc(del.id).delete()
              .then(() => ({ del, ok: true }))
              .catch(e => { console.error("Del Err", e); return { del, ok: false }; })
        ));
        const done = new Set(results.filter(r => r.ok).map(r => r.del.col + ':' + r.del.id));
        results.filter(r => !r.ok).forEach(r => { r.del.tries = (r.del.tries || 0) + 1; });
        appState.sync.pendingDeletions = (appState.sync.pendingDeletions || []).filter(d =>
            !done.has(d.col + ':' + d.id) && (d.tries || 0) < 20);
        saveToLocalStorage();
    }
    
    appState.sync.pendingCloudSave = false;
    
    // Si c'est une sauvegarde manuelle, on notifie
    if (window.isManualSave) {
      showToast('Sauvegarde Cloud réussie !', 'success');
      window.isManualSave = false;
    }
  } catch (err) {
    console.error('Erreur sauvegarde cloud:', err);
    appState.sync.pendingCloudSave = true;
    showToast('Erreur de synchronisation Cloud. Vérifiez votre connexion.', 'error');
  }
};

/**
 * Synchronisation granulaire (Delta)
 */
async function syncGranularToCloud() {
  const db = firebase.firestore();
  const uid = auth?.currentUser?.uid || appState?.adminUid;
  if (!uid) return;

  const collections = ['clients', 'offers', 'transactions', 'todoTransactions', 'payments', 'usdPurchases', 'expenses', 'clientRequests', 'recurringExpenses', 'usdtExpenses', 'employees', 'adAccounts', 'products', 'employeePayments', 'employeePerformance'];
  
  const promises = [];
  
  if (!window.lastCloudState) window.lastCloudState = {};
  
  collections.forEach(colName => {
    const items = appState[colName];
    const oldItems = window.lastCloudState[colName] || [];
    
    // Build quick lookup map for deep comparison
    const oldMap = {};
    oldItems.forEach(o => { if (o && o.id) oldMap[o.id] = JSON.stringify(o); });
    
    if (Array.isArray(items)) {
        items.forEach(item => {
        if (!item.id) item.id = generateId();
        item.uid = uid;
        item.updatedAt = item.updatedAt || Date.now();
        
        const sanitizedItem = JSON.parse(JSON.stringify(item));
        const newStr = JSON.stringify(sanitizedItem);
        
        // Only write to Firebase if the document is new or mathematically different
        if (oldMap[item.id] !== newStr) {
            promises.push(db.collection(colName).doc(item.id).set(sanitizedItem, { merge: true }).then(() => {
                // Update local cloud clone to reflect the strict reality of the server
                if (!window.lastCloudState[colName]) window.lastCloudState[colName] = [];
                const existIdx = window.lastCloudState[colName].findIndex(x => x.id === item.id);
                if (existIdx > -1) {
                    window.lastCloudState[colName][existIdx] = JSON.parse(newStr);
                } else {
                    window.lastCloudState[colName].push(JSON.parse(newStr));
                }
            }));
        }
        });
    }
  });

  await Promise.all(promises);
}

/**
 * Chargement Cloud
 */
// Track unsubscribe functions
window.cloudListeners = [];

window.loadFromCloud = async function() {
  try {
    const uid = auth?.currentUser?.uid || appState?.adminUid;
    if (!uid) return;
    const db = firebase.firestore();
    
    // Cleanup previous listeners if any
    if (window.cloudListeners.length > 0) {
        window.cloudListeners.forEach(unsub => unsub());
        window.cloudListeners = [];
    }
    
    // Listen to user settings document
    const unsubSettings = db.collection('users').doc(uid).onSnapshot(doc => {
        if (doc.exists) {
            const cloudData = doc.data().data || {};
            Object.assign(appState, cloudData);
            normalizeAppState();
            if (typeof renderTables === 'function') renderTables();
        }
    });
    
    window.cloudListeners.push(unsubSettings);
    
    // Initiate granular listeners
    loadGranularFromCloud();
    
    showToast('Synchronisation Cloud en temps réel activée', 'success');
  } catch (err) {
    console.error('Erreur init cloud listeners:', err);
    showToast('Erreur de synchronisation Cloud', 'error');
  }
};

/**
 * Variables to prevent infinite loops during initial sync
 */
let initialLoadCount = 0;

function loadGranularFromCloud() {
  const db = firebase.firestore();
  const uid = auth?.currentUser?.uid || appState?.adminUid;
  if (!uid) return;

  const collections = ['clients', 'offers', 'transactions', 'todoTransactions', 'payments', 'usdPurchases', 'expenses', 'clientRequests', 'recurringExpenses', 'usdtExpenses', 'employees', 'adAccounts', 'products', 'employeePayments', 'employeePerformance'];
  const totalCollections = collections.length;
  initialLoadCount = 0;

  collections.forEach(colName => {
    const unsub = db.collection(colName).where('uid', '==', uid).onSnapshot(snapshot => {
      let data = snapshot.docs.map(d => d.data());
      // Sécurité : on ignore les documents dont l'identifiant contient des caractères dangereux
      if (typeof filterSafeDocs === 'function') data = filterSafeDocs(data, colName);
      // Un élément supprimé ici mais pas encore supprimé côté cloud ne doit pas réapparaître
      const pendingDel = (appState.sync && Array.isArray(appState.sync.pendingDeletions)) ? appState.sync.pendingDeletions.filter(d => d.col === colName) : [];
      if (pendingDel.length) data = data.filter(d => !pendingDel.some(x => x.id === d.id));
      appState[colName] = data;
      
      // Real-time Employee Session Validation
      if (colName === 'employees' && window.appState?.session?.type === 'employee') {
          const me = data.find(e => e.id === window.appState.session.employeeId);
          if (me) {
              if (me.active === false) {
                  showToast("Votre compte a été désactivé par l'administrateur.", 'error');
                  if (typeof logout === 'function') setTimeout(logout, 2000);
                  return;
              }
              if (me.permissions) {
                  window.appState.session.permissions = me.permissions;
                  if (typeof updateAuthUI === 'function') updateAuthUI(null);
              }
          }
      }
      
      // Update baseline cloud state to avoid redundant writes back to the server
      if (!window.lastCloudState) window.lastCloudState = {};
      window.lastCloudState[colName] = JSON.parse(JSON.stringify(data));
      
      initialLoadCount++;
      if (initialLoadCount >= totalCollections) {
          // Only render after everything is loaded initially, or on subsequent single-collection updates
          normalizeAppState();
          if (typeof renderTables === 'function') renderTables();
          if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
      }
    });
    
    window.cloudListeners.push(unsub);
  });
}

/**
 * Auto-sauvegarde déclenchée par les changements
 */
window.autoSave = function() {
  saveToLocalStorage();
  const uid = auth?.currentUser?.uid || appState?.adminUid;
  if (appState.settings?.autoSaveEnabled && uid) {
    saveToCloud();
  }
};
