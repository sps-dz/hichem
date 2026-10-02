// === CORE.JS ===
// Fonctions critiques manquantes dans les autres fichiers JS

// === ADMIN VIEW / NAVIGATION ===
window.forceAdminView = function () {
  const app = document.getElementById('appContainer');
  const login = document.getElementById('loginContainer');
  const client = document.getElementById('clientSpaceContainer');
  if (app) app.style.display = 'block';
  if (login) login.style.display = 'none';
  if (client) client.style.display = 'none';

  const isEmployee = appState.session && appState.session.type === 'employee';
  if (isEmployee) {
    document.querySelectorAll('.employee-hidden').forEach(el => { el.style.display = 'none'; });
    if (typeof showTab === 'function') showTab('clients');
  } else {
    if (typeof showTab === 'function') showTab('dashboard');
  }
};

window.closeAllModals = function () {
  document.querySelectorAll('[id$="Modal"]').forEach(modal => {
    // Passe par closeModal() pour que le formulaire client soit réinitialisé aussi avec Échap
    if (typeof window.closeModal === 'function') {
      window.closeModal(modal.id);
    } else {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  });
  document.body.style.overflow = 'auto';
};

// === UI SAFETY ===
window.ensureVisibleUI = function () {
  const login = document.getElementById('loginContainer');
  const app = document.getElementById('appContainer');
  const client = document.getElementById('clientSpaceContainer');
  const anyVisible = [login, app, client].some(el => el && getComputedStyle(el).display !== 'none');
  if (!anyVisible && login) login.style.display = 'flex';
};

window.ensureAuthVisibility = function () {
  const user = (typeof auth !== 'undefined' && auth) ? auth.currentUser : null;
  const sess = window.appState && window.appState.session;
  if (user || (sess && (sess.type === 'employee' || sess.type === 'admin'))) {
    window.forceAdminView();
  } else if (sess && sess.type === 'client') {
    const app = document.getElementById('appContainer');
    const login = document.getElementById('loginContainer');
    const client = document.getElementById('clientSpaceContainer');
    if (app) app.style.display = 'none';
    if (login) login.style.display = 'none';
    if (client) client.style.display = 'block';
  }
};

window.visibilityWatchdog = function (durationMs) {
  const start = Date.now();
  const timer = setInterval(() => {
    const login = document.getElementById('loginContainer');
    const app = document.getElementById('appContainer');
    const client = document.getElementById('clientSpaceContainer');
    const anyVisible = [login, app, client].some(el => el && getComputedStyle(el).display !== 'none');
    if (anyVisible || (Date.now() - start) > (durationMs || 3000)) clearInterval(timer);
    else window.ensureVisibleUI();
  }, 500);
};

// === DASHBOARD UPDATE ===
window.updateDashboard = function () {
  if (typeof renderCurrentTab === 'function' && appState.currentTab === 'dashboard') {
    const container = document.getElementById('tabContentContainer');
    if (container && typeof renderDashboard === 'function') renderDashboard(container);
  }
};

// === ASYNC RENDER ===
window.renderTablesAsync = function () {
  requestAnimationFrame(() => {
    if (typeof renderTables === 'function') renderTables();
  });
};

// === DATA MIGRATIONS ===
window.backfillReadableIds = function () {
  // Add readable IDs to old records that might lack them
  let n = 1;
  (appState.transactions || []).forEach(t => {
    if (!t.readableId) t.readableId = 'TXN-' + String(n++).padStart(4, '0');
  });
};

// === FINANCE UI ===
window.updateFinanceUI = function () {
  const b = appState.balances || { liquide: 0, baridimob: 0, usdt: 0 };
  const isEmployee = (appState.session && appState.session.type === 'employee');
  const elLiq = document.getElementById('balanceLiquide');
  const elBar = document.getElementById('balanceBaridimob');
  const elUsdt = document.getElementById('balanceUsdt');
  if (isEmployee) {
    const masked = '<span class="text-gray-400 text-sm italic">Masqué</span>';
    if (elLiq) elLiq.innerHTML = masked;
    if (elBar) elBar.innerHTML = masked;
    if (elUsdt) elUsdt.innerHTML = masked;
  } else {
    if (elLiq) { elLiq.textContent = formatCurrency(b.liquide); elLiq.classList.toggle('text-red-600', b.liquide < 0); }
    if (elBar) { elBar.textContent = formatCurrency(b.baridimob); elBar.classList.toggle('text-red-600', b.baridimob < 0); }
    if (elUsdt) { elUsdt.textContent = `${(b.usdt || 0).toFixed(2)} USDT`; elUsdt.classList.toggle('text-red-600', b.usdt < 0); }
  }
};

// === EXPENSES ===
window.applyRecurringExpensesForCurrentMonth = function () {
  if (!Array.isArray(appState.recurringExpenses) || appState.recurringExpenses.length === 0) return;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!appState.appliedRecurringMonths) appState.appliedRecurringMonths = [];
  if (appState.appliedRecurringMonths.includes(monthKey)) return;

  const today = typeof getLocalDateString === 'function' ? getLocalDateString() : now.toISOString().slice(0, 10);
  appState.recurringExpenses.forEach(re => {
    if (!re || !re.amount || !re.label) return;
    const expense = {
      id: generateId('exp'),
      label: re.label,
      amount: Number(re.amount),
      date: today,
      category: re.category || 'Récurrent',
      account: re.account || 'liquide',
      note: 'Auto (mensuel)',
      recurringGenerated: true, // Marque cette dépense comme issue d'une charge fixe :
                                 // sert uniquement à la vue comptable (accrual) pour ne pas
                                 // compter cette charge deux fois (elle y est étalée par jour).
                                 // N'affecte ni les soldes, ni le profit "cash" existant.
      createdAt: Date.now()
    };
    if (!appState.expenses) appState.expenses = [];
    appState.expenses.push(expense);
  });

  appState.appliedRecurringMonths.push(monthKey);
  if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
};

// === BUY RATE ===
window.updateDefaultBuyRateFromLastPurchase = function () {
  if (!Array.isArray(appState.usdPurchases) || appState.usdPurchases.length === 0) return;
  const last = appState.usdPurchases[appState.usdPurchases.length - 1];
  if (last && last.rate) {
    if (!appState.settings) appState.settings = {};
    appState.settings.defaultBuyRate = Number(last.rate);
    const input = document.getElementById('buyRate');
    if (input) input.value = last.rate;
  }
};

// === OFFER SELECT (for todo form) ===
window.populateOfferSelect = function () {
  const select = document.getElementById('offerSelect');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">-- Choisir une offre --</option>';
  (appState.offers || []).forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = `${o.name}${o.priceDzd ? ' — ' + formatCurrency(o.priceDzd) : ''}`;
    select.appendChild(opt);
  });
  if (current) select.value = current;
};

// === CLIENT SEARCH SETUP ===
window.setupClientSearchListeners = function () {
  const input = document.getElementById('clientSearch');
  if (!input || input._listenerBound) return;
  input._listenerBound = true;
  input.addEventListener('input', () => {
    if (typeof filterClientOptions === 'function') filterClientOptions(input.value);
  });
};

// === EXPORT CSV ===
window.exportClientsCSV = function () {
  const rows = [['Nom', 'Contact', 'Téléphone', 'Statut', 'Date'].join(',')];
  (appState.clients || []).forEach(c => {
    rows.push([
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${(c.contact || '').replace(/"/g, '""')}"`,
      `"${(c.phone || '').replace(/"/g, '""')}"`,
      `"${(c.status || 'Actif').replace(/"/g, '""')}"`,
      `"${(c.joinedDate || '').replace(/"/g, '""')}"`
    ].join(','));
  });
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clients_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV réussi', 'success');
};

// === SYNC INDICATOR ===
window.updateSyncIndicator = function () {
  const el = document.getElementById('syncIndicator');
  const txt = document.getElementById('syncIndicatorText');
  if (!el || !txt) return;
  const user = (typeof auth !== 'undefined' && auth) ? auth.currentUser : null;
  const isCloud = appState.settings && appState.settings.storageMode === 'cloud' && !!user;
  if (!isCloud) { el.classList.add('hidden'); return; }
  const hasError = !!(appState.sync && appState.sync.pendingCloudSave);
  el.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'border-red-200', 'bg-blue-50', 'text-blue-700', 'border-blue-200', 'bg-gray-50', 'text-gray-700', 'border-gray-200');
  if (hasError) {
    txt.textContent = 'Erreur de synchronisation';
    el.classList.add('bg-red-50', 'text-red-700', 'border-red-200');
  } else {
    txt.textContent = 'Synchronisé';
    el.classList.add('bg-gray-50', 'text-gray-700', 'border-gray-200');
  }
};

// === REQUESTS BADGE ===
window.updateRequestsBadge = function () {
  const badge = document.getElementById('requestsBadge');
  if (!badge) return;
  const unread = (appState.clientRequests || []).filter(r => !r.read).length;
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
};

// === EMPLOYEE GUARD ===
window.setEmployeeGuardEnabled = function (enabled) {
  if (enabled) {
    document.body.classList.add('employee-mode');
  } else {
    document.body.classList.remove('employee-mode');
  }
};

// === ADS TABLE (stub if not defined) ===
if (typeof window.renderAdsTable === 'undefined') {
  window.renderAdsTable = function () {
    // Handled by renderCurrentTab -> renderAdAccountsTable in ui-render.js
    if (typeof renderCurrentTab === 'function' && appState.currentTab === 'ad-accounts') {
      renderCurrentTab();
    }
  };
}

// === HANDLE LOGIN CLICK (if not already defined by ui-handlers.js) ===
if (typeof window.handleLoginClick === 'undefined') {
  window.handleLoginClick = async function () {
    const emailEl = document.getElementById('loginEmail');
    const passEl = document.getElementById('loginPassword');
    const btn = document.getElementById('loginButton');
    const box = document.getElementById('loginError');
    const emailOrUser = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value.trim() : '';
    if (box) box.textContent = '';
    if (!emailOrUser || !password) { showToast('Identifiants requis', 'error'); return; }
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-not-allowed'); }
    try {
      if (typeof loginWithEmailPassword === 'function') await loginWithEmailPassword(emailOrUser, password);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-not-allowed'); }
    }
  };
}

// === ESC TO CLOSE MODALS ===
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && typeof window.closeAllModals === 'function') window.closeAllModals();
});
