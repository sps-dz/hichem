// === EMPLOYEE PERMISSIONS CONTROLLER ===
window.updateEmployeePermission = function(empId, tabId, hasAccess) {
  if (!appState.employees) return;
  const emp = appState.employees.find(e => e.id === empId);
  if (!emp) return;
  if (!emp.permissions) emp.permissions = {};
  emp.permissions[tabId] = !!hasAccess;
  emp.updatedAt = Date.now();
  
  // Update the session permissions if this is the currently logged in employee
  if (appState.session && appState.session.type === 'employee' && appState.session.employeeId === empId) {
    appState.session.permissions = emp.permissions;
  }
  
  if (typeof autoSave === 'function') autoSave();
  if (typeof updateNavButtonsVisibility === 'function') updateNavButtonsVisibility();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Permissions mises à jour', 'success');
};

window.toggleSidebar = function(open) {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;
  const shouldOpen = (open === true || open === false) ? open : !sidebar.classList.contains('sidebar-open');
  sidebar.classList.toggle('sidebar-open', shouldOpen);
  if (overlay) overlay.classList.toggle('sidebar-overlay-visible', shouldOpen);
};

window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (modalId === 'paymentModal') populatePaymentClientDropdown();
  if (modalId === 'expenseModal') {
    const d = document.getElementById('expenseDate');
    if (d && !d.value && typeof getLocalDateString === 'function') d.value = getLocalDateString();
  }
  if (modalId === 'balancesModal') populateBalancesModal();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.setListPage = function(key, page) {
  if (!appState.ui) appState.ui = {};
  if (!appState.ui.pages) appState.ui.pages = {};
  const p = Number(page);
  appState.ui.pages[key] = Number.isFinite(p) ? p : 1;
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.setListFilter = function(key, value) {
  if (!appState.ui) appState.ui = {};
  if (!appState.ui.filters) appState.ui.filters = {};
  if (!appState.ui.pages) appState.ui.pages = {};
  appState.ui.filters[key] = (value || '').toString();
  appState.ui.pages[key] = 1;
  if (typeof renderCurrentTab === 'function') {
    renderCurrentTab();
    setTimeout(() => {
      const input = document.getElementById(`searchInput_${key}`);
      if (input) {
        input.focus();
        const val = input.value;
        input.value = '';
        input.value = val;
      }
    }, 0);
  }
};

window.applyProfitRange = function() {
  const from = document.getElementById('profitFrom')?.value || '';
  const to = document.getElementById('profitTo')?.value || '';
  if (!from || !to) {
    showToast('Choisis une date de début et une date de fin', 'error');
    return;
  }
  if (!appState.ui) appState.ui = {};
  appState.ui.profitRange = { from, to };
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

// === Vue comptable (Finance) : sélecteur de période pour le compte de résultat ===
window.setFinanceRangePreset = function(preset) {
  if (!appState.ui) appState.ui = {};
  const ranges = (typeof getDefaultProfitRanges === 'function') ? getDefaultProfitRanges() : null;
  if (!ranges) return;
  const map = { today: ranges.today, week: ranges.week, month: ranges.month };
  appState.ui.financeRangePreset = preset;
  if (map[preset]) {
    appState.ui.financeRange = { from: map[preset].from, to: map[preset].to };
  }
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.applyFinanceRange = function() {
  const from = document.getElementById('financeRangeFrom')?.value || '';
  const to = document.getElementById('financeRangeTo')?.value || '';
  if (!from || !to) {
    showToast('Choisis une date de début et une date de fin', 'error');
    return;
  }
  if (!appState.ui) appState.ui = {};
  appState.ui.financeRangePreset = 'custom';
  appState.ui.financeRange = { from, to };
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (modalId === 'clientModal') {
    // Fix: reset le formulaire + l'état d'édition à chaque fermeture (save, annuler, X)
    // pour éviter que les anciennes valeurs / l'édition en cours ne polluent le prochain ajout.
    window.editingClientId = null;
    ['newClientName', 'newClientPhone', 'newClientInstagram', 'newClientFacebook', 'newClientNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const t = document.getElementById('clientModalTitle');
    if (t) t.innerHTML = '<i class="fas fa-user-plus text-blue-600"></i> Nouveau Client';
  }
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

function populatePaymentClientDropdown() {
  const dropdown = document.getElementById('paymentClientDropdown');
  const search = document.getElementById('paymentClientSearch');
  const hidden = document.getElementById('paymentClientId');
  if (!dropdown) return;
  const clients = appState.clients || [];
  dropdown.innerHTML = clients.map(c => `
    <div class="p-3 hover:bg-orange-50 cursor-pointer payment-client-option" data-id="${c.id}" data-name="${escapeHtml(c.name)}">
      ${escapeHtml(c.name)} <span class="text-xs text-gray-400">(Dette: ${formatCurrency(c.unpaid || 0)})</span>
    </div>
  `).join('');
  dropdown.querySelectorAll('.payment-client-option').forEach(opt => {
    opt.addEventListener('click', () => {
      if (hidden) hidden.value = opt.dataset.id;
      if (search) search.value = opt.dataset.name;
      dropdown.style.display = 'none';
    });
  });
  if (search) search.value = '';
  if (hidden) hidden.value = '';
}

window.filterPaymentClientOptions = function(query) {
  const dropdown = document.getElementById('paymentClientDropdown');
  if (!dropdown) return;
  const q = (query || '').toLowerCase();
  let visibleCount = 0;
  dropdown.querySelectorAll('.payment-client-option').forEach(opt => {
    const name = (opt.dataset.name || '').toLowerCase();
    const show = q === '' || name.includes(q);
    opt.style.display = show ? 'block' : 'none';
    if (show) visibleCount++;
  });
  dropdown.style.display = visibleCount > 0 ? 'block' : 'none';
  // Si l'utilisateur retape à la main, on invalide la sélection précédente
  const hidden = document.getElementById('paymentClientId');
  if (hidden) hidden.value = '';
};

document.addEventListener('click', function(e) {
  const search = document.getElementById('paymentClientSearch');
  const dropdown = document.getElementById('paymentClientDropdown');
  if (search && dropdown && !search.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

function populateBalancesModal() {
  if (typeof calculateTheoreticalBalance !== 'function') return;
  const theo = calculateTheoreticalBalance();
  const manual = appState.manualBalances || { liquide: 0, baridimob: 0, usdt: 0 };
  const current = {
    liquide: Number(theo.liquide || 0) + Number(manual.liquide || 0),
    baridimob: Number(theo.baridimob || 0) + Number(manual.baridimob || 0),
    usdt: Number(theo.usdt || 0) + Number(manual.usdt || 0)
  };

  const liq = document.getElementById('balanceLiquideDesired');
  const bar = document.getElementById('balanceBaridiDesired');
  const usdt = document.getElementById('balanceUsdtDesired');
  if (liq) liq.value = Math.round(current.liquide);
  if (bar) bar.value = Math.round(current.baridimob);
  if (usdt) usdt.value = Number(current.usdt || 0).toFixed(2);

  const liqTheo = document.getElementById('balanceLiquideTheo');
  const barTheo = document.getElementById('balanceBaridiTheo');
  const usdtTheo = document.getElementById('balanceUsdtTheo');
  if (liqTheo) liqTheo.textContent = `Théorique: ${formatCurrency(theo.liquide)} • Ajustement: ${formatCurrency(manual.liquide || 0)}`;
  if (barTheo) barTheo.textContent = `Théorique: ${formatCurrency(theo.baridimob)} • Ajustement: ${formatCurrency(manual.baridimob || 0)}`;
  if (usdtTheo) usdtTheo.textContent = `Théorique: ${safeToFixed(theo.usdt, 2)} USDT • Ajustement: ${safeToFixed(manual.usdt || 0, 2)} USDT`;
}

window.saveBalancesAdjustments = function() {
  if (typeof calculateTheoreticalBalance !== 'function') return;
  const theo = calculateTheoreticalBalance();

  const desiredLiquide = Number(document.getElementById('balanceLiquideDesired')?.value || 0);
  const desiredBaridi = Number(document.getElementById('balanceBaridiDesired')?.value || 0);
  const desiredUsdt = Number(document.getElementById('balanceUsdtDesired')?.value || 0);

  if (!Number.isFinite(desiredLiquide) || !Number.isFinite(desiredBaridi) || !Number.isFinite(desiredUsdt)) {
    showToast('Valeurs invalides', 'error');
    return;
  }

  appState.manualBalances = {
    liquide: desiredLiquide - Number(theo.liquide || 0),
    baridimob: desiredBaridi - Number(theo.baridimob || 0),
    usdt: desiredUsdt - Number(theo.usdt || 0)
  };
  if (typeof logActivity === 'function') logActivity('Ajustement manuel des soldes', `Liquide: ${formatCurrency(desiredLiquide)} | BaridiMob: ${formatCurrency(desiredBaridi)} | USDT: ${safeToFixed(desiredUsdt,2)} $`);

  if (typeof autoSave === 'function') autoSave();
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  closeModal('balancesModal');
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Soldes mis à jour', 'success');
};

window.handleLoginClick = async function() {
  const emailEl = document.getElementById('loginEmail');
  const passwordEl = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const email = (emailEl?.value || '').trim();
  const password = passwordEl?.value || '';

  if (errorEl) errorEl.textContent = '';

  if (!email || !password) {
    const msg = 'Veuillez remplir tous les champs.';
    if (errorEl) errorEl.textContent = msg;
    showToast(msg, 'error');
    return;
  }

  // Intercept Demo Mode activation
  if (email.toLowerCase() === 'demo') {
      if (typeof injectDemoData === 'function') {
          injectDemoData();
          return;
      }
  }

  try {
    // 1. Check if it's an Employee first (Seamless routing)
    let employees = appState.employees || [];
    if (employees.length === 0 && window.firebase) {
      const db = firebase.firestore();
      // Fetch all employees to allow Javascript case-insensitive search
      const snap = await db.collection('employees').get().catch(() => ({ empty: true }));
      if (!snap.empty) employees = snap.docs.map(d => d.data());
    }

    const emp = employees.find(e => (e.active !== false) && ((e.login || '').toLowerCase() === email.toLowerCase() || (e.email || '').toLowerCase() === email.toLowerCase()));
    
    if (emp) {
      const check = await verifyAccountPassword(emp, password);
      if (!check.ok) {
        throw new Error('Mot de passe employé incorrect');
      }

      // Migration transparente : compte encore en mot de passe clair (créé
      // avant la mise à jour sécurité) → on le hash immédiatement.
      if (check.needsMigration) {
        const salt = generateSalt();
        emp.passwordHash = await hashPassword(password, salt);
        emp.passwordSalt = salt;
        delete emp.password;
        const idx = (appState.employees || []).findIndex(e => e.id === emp.id);
        if (idx > -1) appState.employees[idx] = emp;
        if (typeof autoSave === 'function') autoSave();
      }
      
      appState.adminUid = emp.uid; 
      appState.session = { type: 'employee', employeeId: emp.id, name: emp.name, login: emp.login, permissions: emp.permissions || {}, loginAt: Date.now() };
      
      if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
      showToast('Connexion employé réussie', 'success');
      if (typeof updateAuthUI === 'function') updateAuthUI(null);
      if (typeof loadFromCloud === 'function') await loadFromCloud();
      if (typeof renderTables === 'function') renderTables();
      return;
    }

    // 2. If not an employee, route to Firebase Admin Auth
    if (typeof loginWithEmailPassword === 'function') {
      await loginWithEmailPassword(email, password);
    } else if (window.auth && typeof auth.signInWithEmailAndPassword === 'function') {
      await auth.signInWithEmailAndPassword(email, password);
      showToast('Connexion Admin réussie', 'success');
      if (typeof updateAuthUI === 'function') updateAuthUI(auth.currentUser);
      if (typeof loadFromCloud === 'function') await loadFromCloud();
      if (typeof renderTables === 'function') renderTables();
    } else {
      throw new Error('Authentification indisponible');
    }
  } catch (error) {
    console.error(error);
    const msg = (typeof firebaseErrorMessage === 'function')
      ? firebaseErrorMessage(error)
      : (error?.message || 'Erreur de connexion');
    if (errorEl) errorEl.textContent = msg;
    showToast(msg, 'error');
  }
};

window.forceCloudSave = function() {
  window.isManualSave = true;
  showToast('Sauvegarde en cours...', 'info');
  if (typeof saveToCloud === 'function') saveToCloud();
  else showToast('Fonction de sauvegarde indisponible', 'error');
};

window.exportPDF = function() {
  const element = document.getElementById('tabContentContainer');
  if (!element) return;
  if (typeof html2pdf !== 'function') {
    showToast('Export PDF indisponible (librairie non chargée)', 'error');
    return;
  }
  showToast('Génération du PDF...', 'info');
  const opt = {
    margin: [10, 10],
    filename: `Sponsor_Manager_Export_${new Date().toISOString().slice(0, 10)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save().then(() => {
    showToast('PDF généré avec succès !', 'success');
  }).catch(err => {
    console.error(err);
    showToast('Erreur lors de la génération du PDF', 'error');
  });
};

// === FACTURE : aperçu direct (sans téléchargement automatique) ===

// Nombre -> lettres en français (ex: 7000 -> "sept mille")
window.numberToFrenchWords = function(num) {
  let n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'zéro';
  const u = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize'];
  const t = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
  const below100 = (x) => {
    if (x < 17) return u[x];
    if (x < 20) return 'dix-' + u[x - 10];
    if (x < 70) {
      const d = Math.floor(x / 10), r = x % 10;
      if (r === 0) return t[d];
      if (r === 1) return t[d] + ' et un';
      return t[d] + '-' + u[r];
    }
    if (x < 80) {
      const r = x - 60;
      return r === 11 ? 'soixante et onze' : 'soixante-' + below100(r);
    }
    if (x === 80) return 'quatre-vingts';
    return 'quatre-vingt-' + below100(x - 80);
  };
  // final = false quand le nombre est suivi de "mille" (vingts/cents restent invariables)
  const below1000 = (x, final) => {
    const h = Math.floor(x / 100), r = x % 100;
    let out = '';
    if (h > 0) {
      out = h === 1 ? 'cent' : u[h] + ' cent';
      if (r === 0 && h > 1 && final) out += 's';
    }
    if (r > 0) {
      let w = below100(r);
      if (!final && w === 'quatre-vingts') w = 'quatre-vingt';
      out += (out ? ' ' : '') + w;
    }
    return out;
  };
  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions > 0) parts.push(below1000(millions, true) + (millions > 1 ? ' millions' : ' million'));
  if (thousands > 0) parts.push(thousands === 1 ? 'mille' : below1000(thousands, false) + ' mille');
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(' ');
};

window.amountToFrenchDinars = function(amount) {
  const n = Math.round(Math.abs(Number(amount) || 0));
  let words = numberToFrenchWords(n);
  let unit = n > 1 ? 'dinars algériens' : 'dinar algérien';
  if (n >= 1000000 && n % 1000000 === 0) unit = 'de dinars algériens';
  words = words.charAt(0).toUpperCase() + words.slice(1);
  return `${words} ${unit}`;
};

window.buildInvoiceHtml = function(tx) {
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDA = (v) => `${Math.round(Number(v) || 0).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} DA`;
  const fmtDay = (d) => {
    try { return new Date(d).toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Algiers' }); }
    catch (e) { return ''; }
  };

  const baseDate = tx.date || getLocalDateString();
  const legacyInvNumber = `INV-${String(baseDate).split('-').join('')}-${String(tx.id).slice(-6)}`;
  // Numérotation : identique à l'ancienne par défaut ; séquentielle (FAC-AAAA-0001) si activée dans Comptabilité > Profil
  const invNumber = (typeof getInvoiceNumber === 'function') ? getInvoiceNumber(tx, legacyInvNumber) : legacyInvNumber;
  // Profil entreprise (valeurs par défaut = celles qui étaient écrites en dur auparavant)
  const PF = (typeof getCompanyProfile === 'function') ? getCompanyProfile() : { name: 'Hichem Sponsor', tagline: 'Agence de Marketing Digital', email: 'contact.hichemsps@gmail.com', address1: 'Ouled Fayet, Cité Verte', address2: 'Alger, Algérie' };
  const pfWords = String(PF.name || 'Hichem Sponsor').split(' ');
  const pfFirst = esc(pfWords.shift() || ''), pfRest = esc(pfWords.join(' '));
  const client = esc(tx.clientName || 'Client');
  const dateLabel = esc(fmtDay(baseDate) || baseDate);
  const usd = safeToFixed(tx.amount, 2);
  const total = fmtDA(tx.priceDzd);
  const paid = !!tx.paid;

  // Durée : "7 jours" + période (du ... au ...) — le dernier jour = début + (durée - 1)
  const daysNum = Number(String(tx.duration || tx.customDurationDays || '').trim());
  const hasDays = Number.isFinite(daysNum) && daysNum > 0;
  let durationMain = 'N/A', durationRange = '';
  if (hasDays) {
    durationMain = `${daysNum} jour${daysNum > 1 ? 's' : ''}`;
    const start = new Date(baseDate);
    if (!isNaN(start.getTime())) {
      const end = new Date(start.getTime());
      end.setDate(end.getDate() + daysNum - 1);
      durationRange = `(du ${fmtDay(start)} au ${fmtDay(end)})`;
    }
  } else if (tx.duration) {
    durationMain = String(tx.duration);
  }

  const clientInfo = (appState.clients || []).find(c => c.id === tx.clientId);
  const contactLabel = esc(clientInfo ? (clientInfo.phone || clientInfo.instagram || clientInfo.contact || '-') : '-');
  const amountWords = esc(amountToFrenchDinars(tx.priceDzd));

  const navy = '#0f2a52', blue = '#1d6fe8', soft = '#eef4fd', line = '#dbe5f3';
  const icon = window.INVOICE_LOGO_ICON || '';
  const iconWhite = window.INVOICE_LOGO_ICON_WHITE || '';
  const svgCheck = (c, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

  const infoLines = [];
  if (hasDays) infoLines.push(`La durée de la prestation est de ${daysNum} jour${daysNum > 1 ? 's' : ''} à partir de la date de lancement.`);
  infoLines.push(paid ? 'Le montant est 100% réglé.' : `Le montant reste à régler : ${total}.`);
  infoLines.push('Merci de votre confiance.');
  if (PF.showPayment && PF.paymentNote) infoLines.push('Règlement : ' + PF.paymentNote);
  const legalBits = [PF.nif && ('NIF : ' + PF.nif), PF.rc && ('RC : ' + PF.rc), PF.nis && ('NIS : ' + PF.nis), PF.ai && ('AI : ' + PF.ai), PF.legalNote].filter(Boolean).join(' — ');
  if (legalBits) infoLines.push(legalBits);

  const statusPill = paid
    ? `<span style="display:inline-flex;align-items:center;gap:6px;background:#16b364;color:#fff;font-weight:800;font-size:15px;padding:5px 18px 5px 12px;border-radius:999px;">${svgCheck('#fff', 14)} PAYÉ</span>`
    : `<span style="display:inline-flex;align-items:center;gap:6px;background:#ef4444;color:#fff;font-weight:800;font-size:15px;padding:5px 18px;border-radius:999px;">IMPAYÉ</span>`;

  const inner = `
  <div class="inv" style="position:relative;width:794px;height:1122px;box-sizing:border-box;overflow:hidden;background:#fbfdfe;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:${navy};">

    <!-- coin décoratif -->
    <svg width="110" height="110" viewBox="0 0 110 110" style="position:absolute;top:0;left:0;"><polygon points="0,0 80,0 0,100" fill="#2f7cf0"/><polygon points="0,0 46,0 0,58" fill="#1555c0"/></svg>

    <div style="padding:46px 40px 0 40px;">
      <!-- En-tête -->
      <div style="display:flex;align-items:center;justify-content:space-between;height:112px;">
        <div style="display:flex;align-items:center;gap:14px;">
          ${icon ? `<img src="${icon}" alt="" style="height:78px;width:auto;display:block;">` : ''}
          <div>
            <div style="font-size:38px;font-weight:800;letter-spacing:-1px;line-height:1;"><span style="color:${navy};">${pfFirst}</span> <span style="color:${blue};">${pfRest}</span></div>
            <div style="font-size:11px;letter-spacing:3.4px;color:#4b5b75;margin-top:8px;font-weight:600;">${esc(String(PF.tagline || '').toUpperCase())}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <span style="display:inline-block;width:26px;height:2px;background:${blue};"></span>
              <span style="font-size:11px;font-style:italic;letter-spacing:1px;color:#4b5b75;">Votre croissance, notre priorité</span>
              <span style="display:inline-block;width:26px;height:2px;background:${blue};"></span>
            </div>
          </div>
        </div>
        <div style="border-left:2px solid ${line};padding-left:20px;font-size:12.5px;line-height:1.45;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${blue}"><path d="M2 5h20v14H2z" opacity=".15"/><path d="M3 6.5l9 6.5 9-6.5V5H3z"/><path d="M3 8.2V19h18V8.2l-9 6.3z"/></svg>
            <span>${esc(PF.email)}</span>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${blue}"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
            <span>${esc(PF.address1)}<br><span style="color:#6b7a90;font-size:11.5px;">${esc(PF.address2)}</span></span>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${blue}" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
            <span>Date de lancement :<br><b>${dateLabel}</b></span>
          </div>
        </div>
      </div>

      <div style="height:1px;background:${line};margin:22px 0 28px;"></div>

      <!-- Titre + infos facture -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="padding-top:2px;">
          <div style="font-size:54px;font-weight:900;letter-spacing:-1px;line-height:1;">FACTURE</div>
          <div style="font-size:16px;color:#4b5b75;margin-top:8px;">Prestation de service – Sponsoring Publicitaire</div>
        </div>
        <div style="width:300px;">
          <div style="background:#e1ecfc;border-radius:10px;padding:10px 20px;">
            <div style="font-size:12.5px;letter-spacing:1px;color:#2b4a7c;">N° FACTURE</div>
            <div style="font-size:19px;font-weight:800;color:${navy};margin-top:2px;">${invNumber}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:${soft};border-radius:10px;padding:9px 20px;margin-top:10px;font-size:13.5px;">
            <span style="color:#4b5b75;">Date d'émission</span>
            <span style="display:flex;align-items:center;gap:8px;font-weight:600;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${navy}" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${dateLabel}
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:${soft};border-radius:10px;padding:7px 20px;margin-top:8px;font-size:13.5px;">
            <span style="color:#4b5b75;">Statut</span>${statusPill}
          </div>
        </div>
      </div>

      <div style="height:1px;background:${line};margin:24px 0 20px;"></div>

      <!-- Client -->
      <div style="display:flex;align-items:flex-start;gap:14px;background:${soft};border:1px solid ${line};border-radius:10px;padding:16px 20px;">
        <svg width="34" height="34" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${blue}"/><circle cx="12" cy="9.5" r="3.6" fill="#fff"/><path d="M5.5 19c.8-3.4 3.5-5 6.5-5s5.7 1.6 6.5 5z" fill="#fff"/></svg>
        <div>
          <div style="font-size:14px;font-weight:800;color:${blue};letter-spacing:.5px;">CLIENT</div>
          <div style="font-size:24px;font-weight:800;line-height:1.2;margin-top:2px;">${client}</div>
          <div style="font-size:14.5px;color:#34445f;margin-top:2px;">Contact : ${contactLabel}</div>
        </div>
      </div>

      <!-- Tableau -->
      <div style="margin-top:28px;border:1px solid ${line};border-radius:10px;overflow:hidden;">
        <div style="display:flex;background:${navy};color:#fff;font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap;">
          <div style="flex:0 0 41%;box-sizing:border-box;padding:15px 24px;">Description de l'offre</div>
          <div style="flex:0 0 19%;box-sizing:border-box;padding:15px 4px;text-align:center;">Durée</div>
          <div style="flex:0 0 16%;box-sizing:border-box;padding:15px 4px;text-align:center;">Budget (USD)</div>
          <div style="flex:1;padding:15px 4px;text-align:center;">Montant (DZD)</div>
        </div>
        <div style="display:flex;align-items:stretch;background:#f6f9fe;">
          <div style="flex:0 0 41%;box-sizing:border-box;padding:18px 24px;display:flex;align-items:center;gap:14px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="${blue}"><path d="M3 10v4a1 1 0 0 0 1 1h2l2 5h2.2l-1.6-5H11l7 4V5l-7 4H4a1 1 0 0 0-1 1z"/><path d="M19.5 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="${blue}" stroke-width="1.6" stroke-linecap="round"/></svg>
            <div>
              <div style="font-size:17px;font-weight:800;line-height:1.15;white-space:nowrap;">Sponsoring Publicitaire</div>
              <div style="font-size:14px;color:#4b5b75;margin-top:3px;">${esc(tx.offerName || 'Service Standard')}</div>
            </div>
          </div>
          <div style="flex:0 0 19%;box-sizing:border-box;border-left:1px solid ${line};padding:12px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
            <div style="font-size:15px;font-weight:600;">${esc(durationMain)}</div>
            ${durationRange ? `<div style="font-size:10.5px;color:#4b5b75;margin-top:4px;">${esc(durationRange)}</div>` : ''}
          </div>
          <div style="flex:0 0 16%;box-sizing:border-box;border-left:1px solid ${line};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;">${usd} $</div>
          <div style="flex:1;border-left:1px solid ${line};display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;color:${blue};white-space:nowrap;">${total}</div>
        </div>
      </div>

      <!-- Totaux + infos -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;gap:24px;">
        <div style="flex:1;min-width:0;">
          <div style="height:1px;background:${line};margin-bottom:18px;"></div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <span style="display:inline-flex;width:36px;height:36px;border-radius:50%;background:${blue};align-items:center;justify-content:center;">${svgCheck('#fff', 20)}</span>
            <span style="font-size:15px;font-weight:800;color:${blue};letter-spacing:.3px;">INFORMATIONS IMPORTANTES</span>
          </div>
          ${infoLines.map(l => `<div style="display:flex;align-items:flex-start;gap:12px;font-size:13.5px;color:#25375a;margin:8px 0 8px 12px;">${svgCheck(blue, 15)}<span>${esc(l)}</span></div>`).join('')}
        </div>
        <div style="flex:0 0 330px;background:${soft};border:1px solid ${line};border-radius:12px;padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px 12px;font-size:17px;">
            <span>Sous-total</span><b style="font-size:19px;">${total}</b>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:${blue};color:#fff;border-radius:10px;padding:13px 18px;">
            <span style="font-size:20px;font-weight:800;">TOTAL</span><span style="font-size:25px;font-weight:900;">${total}</span>
          </div>
          <div style="display:flex;align-items:flex-start;gap:8px;padding:12px 6px 2px;font-size:12px;color:#34445f;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${blue}" style="flex:0 0 16px;margin-top:1px;"><ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 8.5v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-3c-1.4 1.1-3.6 1.7-6 1.7S4.4 9.6 3 8.5z"/><path d="M3 13.5v2.5c0 1.7 2.7 3 6 3s6-1.3 6-3v-2.5c-1.4 1.1-3.6 1.7-6 1.7s-4.6-.6-6-1.7z"/></svg>
            <span>Montant en lettres : <i>${amountWords}</i></span>
          </div>
        </div>
      </div>

      <!-- Mot de fin + signature -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;">
        <div>
          <div style="font-family:'Brush Script MT','Segoe Script','Lucida Handwriting',cursive;font-style:italic;font-size:22px;color:${navy};">À très bientôt pour de nouveaux projets !</div>
          <div style="width:94px;height:2px;background:${blue};margin-top:12px;"></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:14px;font-weight:800;">L'équipe ${esc(PF.name)}</div>
          <svg width="130" height="52" viewBox="0 0 130 52" fill="none" stroke="${navy}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 44C20 40 30 8 40 8c6 0 2 26-6 34 10-6 20-22 28-22 5 0 0 16-3 20 12-4 22-14 40-17"/></svg>
        </div>
      </div>
    </div>

    <!-- Pied de page -->
    <div style="position:absolute;left:0;right:0;bottom:0;height:104px;">
      <svg width="794" height="26" viewBox="0 0 794 26" preserveAspectRatio="none" style="position:absolute;top:-8px;left:0;"><path d="M0 22 C220 0 520 4 794 14 L794 26 L0 26Z" fill="#2f7cf0" opacity=".55"/></svg>
      <div style="position:absolute;top:10px;left:0;right:0;bottom:0;background:${navy};display:flex;align-items:center;justify-content:space-between;padding:0 40px;color:#fff;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${iconWhite ? `<img src="${iconWhite}" alt="" style="height:46px;width:auto;">` : ''}
          <div>
            <div style="font-size:18px;font-weight:800;line-height:1.1;">${esc(PF.name)}</div>
            <div style="font-size:11px;color:#c9d6ee;margin-top:2px;">${esc(PF.tagline)}</div>
          </div>
        </div>
        <div style="font-size:14px;letter-spacing:.5px;color:#e6eefb;border-left:1px solid #34527f;border-right:1px solid #34527f;padding:6px 26px;">Publicité &nbsp;•&nbsp; Stratégie &nbsp;•&nbsp; <i>Résultats</i></div>
        <div style="display:flex;align-items:center;gap:12px;">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#6fa8ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c3.5-.5 6 0 6 0s.5 2.5 0 6c-1 2-3 4-5 5l-4-4c1-2 1.5-5 3-7z"/><path d="M9 11l-4 1 2 2M13 15l-1 4-2-2M7.5 16.5c-1.5.3-2.5 1.5-3 3.5 2-.5 3.2-1.5 3.5-3z"/><circle cx="15.5" cy="8.5" r="1.3"/></svg>
          <div style="font-size:14px;font-style:italic;line-height:1.25;">Ensemble vers<br>plus de ventes</div>
        </div>
      </div>
    </div>
  </div>`;
  return { inner, invNumber };
};

// Ouvre l'aperçu de la facture directement à l'écran (aucun téléchargement automatique).
window.generateInvoicePdf = function(txId) {
  const tx = (appState.transactions || []).find(t => t.id === txId);
  if (!tx) {
    showToast('Transaction introuvable', 'error');
    return;
  }
  const { inner, invNumber } = buildInvoiceHtml(tx);
  window._invoicePreviewTxId = txId;

  let modal = document.getElementById('invoicePreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invoicePreviewModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-60 hidden items-center justify-center z-50 p-2 md:p-6';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style="height:94vh;">
        <div class="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4 border-b">
          <div class="font-black text-gray-800 flex items-center gap-2">
            <i class="fas fa-file-invoice text-blue-600"></i>
            <span id="invoicePreviewTitle">Aperçu facture</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" onclick="sendInvoiceWhatsApp()" class="px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700" title="Ouvre WhatsApp avec le message de la facture prêt à envoyer">
              <i class="fab fa-whatsapp mr-1"></i> WhatsApp
            </button>
            <button type="button" onclick="sendInvoiceInstagram()" class="px-4 py-2 text-white rounded-xl font-bold text-sm hover:opacity-90" style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);" title="Copie le message et ouvre la conversation Instagram du client">
              <i class="fab fa-instagram mr-1"></i> Instagram
            </button>
            <button type="button" onclick="shareInvoicePdf()" class="px-4 py-2 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-black" title="Partage le fichier PDF (WhatsApp, Instagram, e-mail…)">
              <i class="fas fa-share-nodes mr-1"></i> Envoyer le PDF
            </button>
            <button type="button" onclick="downloadInvoicePdf()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700">
              <i class="fas fa-download mr-1"></i> Télécharger PDF
            </button>
            <button type="button" onclick="printInvoicePreview()" class="px-4 py-2 border rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-50">
              <i class="fas fa-print mr-1"></i> Imprimer
            </button>
            <button type="button" onclick="closeInvoicePreview()" class="px-4 py-2 bg-gray-100 rounded-xl font-bold text-sm text-gray-700 hover:bg-gray-200">
              <i class="fas fa-times mr-1"></i> Fermer
            </button>
          </div>
        </div>
        <iframe id="invoicePreviewFrame" title="Aperçu facture" class="flex-1 w-full rounded-b-2xl" style="border:0; background:#e5e7eb;"></iframe>
      </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeInvoicePreview(); });
    document.body.appendChild(modal);
  }

  const title = document.getElementById('invoicePreviewTitle');
  if (title) title.textContent = `Facture ${invNumber}`;
  const frame = document.getElementById('invoicePreviewFrame');
  // La feuille A4 (794px) est réduite automatiquement pour tenir dans la largeur de l'écran.
  frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @page{size:A4;margin:0;}
      html,body{margin:0;background:#e5e7eb;}
      #wrap{width:794px;margin:12px auto;box-shadow:0 2px 14px rgba(0,0,0,.2);transform-origin:top left;}
      @media print{html,body{background:#fff;}#wrap{margin:0;box-shadow:none;transform:none !important;}}
    </style></head><body><div id="wrap">${inner}</div>
    <script>
      function fit(){
        var w=document.getElementById('wrap');
        var s=Math.min(1,(window.innerWidth-16)/794);
        w.style.transform='scale('+s+')';
        w.style.margin=(12)+'px '+Math.max(8,(window.innerWidth-794*s)/2)+'px';
        document.body.style.height=(1122*s+24)+'px';
      }
      fit(); window.addEventListener('resize',fit);
    <\/script></body></html>`;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeInvoicePreview = function() {
  const modal = document.getElementById('invoicePreviewModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  const frame = document.getElementById('invoicePreviewFrame');
  if (frame) frame.srcdoc = '';
  window._invoicePreviewTxId = null;
};

window.printInvoicePreview = function() {
  const frame = document.getElementById('invoicePreviewFrame');
  if (!frame || !frame.contentWindow) return;
  frame.contentWindow.focus();
  frame.contentWindow.print();
};

// === ENVOI DE LA FACTURE AU CLIENT (WhatsApp / Instagram / partage du PDF) ===
// Contexte : transaction affichée dans l'aperçu + coordonnées du client + message prêt à envoyer.
window.getInvoiceSendContext = function() {
  const tx = (appState.transactions || []).find(t => t.id === window._invoicePreviewTxId);
  if (!tx) return null;
  const client = (appState.clients || []).find(c => c.id === tx.clientId)
    || (appState.clients || []).find(c => (c.name || '').trim().toLowerCase() === String(tx.clientName || '').trim().toLowerCase())
    || null;
  const { invNumber } = buildInvoiceHtml(tx);
  const PF = (typeof getCompanyProfile === 'function') ? getCompanyProfile() : { name: 'Hichem Sponsor' };
  const total = formatCurrency(tx.priceDzd);
  const endYmd = (typeof getTransactionEndYmd === 'function') ? getTransactionEndYmd(tx) : '';
  const lines = [
    `Bonjour ${tx.clientName || (client && client.name) || ''},`,
    '',
    `Voici votre facture ${invNumber} — ${tx.offerName || 'Sponsoring Publicitaire'} :`,
    `• Montant : ${total}`
  ];
  if (endYmd) lines.push(`• Période : du ${formatDate(tx.date)} au ${formatDate(endYmd)}`);
  lines.push(tx.paid ? '• Statut : Payé ✓' : `• Statut : Reste à payer ${total}`);
  lines.push('', 'Merci de votre confiance !', PF.name || 'Hichem Sponsor');
  const igRaw = client ? (client.instagram || client.username || (client.social && Array.isArray(client.social.instagram) && client.social.instagram[0]) || '') : '';
  return {
    tx, client, invNumber, message: lines.join('\n'),
    phone: client ? normalizePhoneForWhatsApp(client.phone || client.contact) : '',
    ig: String(igRaw || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '')
  };
};

window.sendInvoiceWhatsApp = function() {
  const c = getInvoiceSendContext();
  if (!c) return showToast('Facture introuvable', 'error');
  if (!c.phone) return showToast('Numéro WhatsApp absent ou invalide pour ce client (à renseigner dans la fiche client)', 'error');
  // Ouvre l'application WhatsApp installée (PC / téléphone) avec le message prêt ; WhatsApp Web en secours
  if (typeof openWhatsApp === 'function') openWhatsApp(c.phone, c.message);
  else window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(c.message)}`, '_blank');
  if (typeof logActivity === 'function') logActivity('Facture envoyée (WhatsApp)', `${c.invNumber} — ${c.tx.clientName || ''}`);
};

// Image PNG de la facture (Instagram n'accepte pas les PDF dans les messages, mais accepte les images).
window._invoiceImageBlob = function(c) {
  const { inner } = buildInvoiceHtml(c.tx);
  const node = document.createElement('div');
  node.style.width = '794px';
  node.innerHTML = inner;
  return new Promise((resolve, reject) => {
    html2pdf().set({ html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 } })
      .from(node).toCanvas().get('canvas')
      .then(canvas => canvas.toBlob(b => b ? resolve(b) : reject(new Error('image vide')), 'image/png'))
      .catch(reject);
  });
};

// Instagram : la facture est envoyée comme IMAGE (les PDF ne passent pas dans les messages Instagram).
//  • Téléphone : menu de partage → choisir Instagram.
//  • PC : l'image est copiée, la conversation s'ouvre, il suffit de faire Ctrl+V puis Entrée.
//    (si la copie est impossible, l'image est téléchargée à glisser dans la conversation)
window.sendInvoiceInstagram = function() {
  const c = getInvoiceSendContext();
  if (!c) return showToast('Facture introuvable', 'error');
  if (!c.ig) return showToast('Compte Instagram absent pour ce client (à renseigner dans la fiche client)', 'error');
  const dm = `https://ig.me/m/${c.ig}`;
  const openDm = () => window.open(dm, '_blank');
  const log = () => { if (typeof logActivity === 'function') logActivity('Facture envoyée (Instagram)', `${c.invNumber} — ${c.tx.clientName || ''}`); };
  if (typeof html2pdf !== 'function') {            // secours : ancien comportement (texte copié)
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c.message).then(() => { showToast('Message copié : collez-le dans la conversation Instagram', 'success'); openDm(); }).catch(openDm);
    else openDm();
    return log();
  }
  const name = `${c.invNumber}.png`;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const blobP = window._invoiceImageBlob(c);
  blobP.catch(() => {});
  showToast("Préparation de l'image de la facture...", 'info');
  const downloadAndOpen = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Image téléchargée (${name}) : glissez-la dans la conversation Instagram`, 'info');
    openDm(); log();
  };
  const fail = (err) => { console.error(err); showToast("Impossible de créer l'image de la facture", 'error'); };

  if (isMobile && navigator.share && navigator.canShare) {
    blobP.then(blob => {
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: `Facture ${c.invNumber}` }).then(log)
          .catch(err => { if (!err || err.name !== 'AbortError') { console.error(err); showToast('Partage impossible', 'error'); } });
      }
      downloadAndOpen(blob);
    }).catch(fail);
    return;
  }
  if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
    // La copie est lancée tout de suite (geste de l'utilisateur) ; l'image se termine de se générer pendant l'écriture.
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]).then(() => {
      showToast("Image de la facture copiée : dans la conversation Instagram, faites Ctrl+V (Cmd+V sur Mac) puis Entrée", 'success');
      openDm(); log();
    }).catch(() => blobP.then(downloadAndOpen).catch(fail));
  } else {
    blobP.then(downloadAndOpen).catch(fail);
  }
};

// Partage du FICHIER PDF (menu de partage du téléphone : WhatsApp, Instagram, e-mail…).
// Si l'appareil ne sait pas partager un fichier, le PDF est téléchargé pour être joint à la main.
window.shareInvoicePdf = function() {
  if (typeof html2pdf !== 'function') return showToast('PDF indisponible (librairie non chargée)', 'error');
  const c = getInvoiceSendContext();
  if (!c) return showToast('Facture introuvable', 'error');
  const { inner } = buildInvoiceHtml(c.tx);
  const node = document.createElement('div');
  node.style.width = '794px';
  node.innerHTML = inner;
  const opt = {
    margin: 0,
    filename: `${c.invNumber}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: [] }
  };
  showToast('Préparation du PDF...', 'info');
  html2pdf().set(opt).from(node).toPdf().get('pdf').then(pdf => {
    while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages());
    const blob = pdf.output('blob');
    const file = new File([blob], `${c.invNumber}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      return navigator.share({ files: [file], title: `Facture ${c.invNumber}`, text: c.message })
        .then(() => { if (typeof logActivity === 'function') logActivity('Facture partagée (PDF)', `${c.invNumber} — ${c.tx.clientName || ''}`); })
        .catch(err => { if (!err || err.name !== 'AbortError') { console.error(err); showToast('Partage impossible', 'error'); } });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${c.invNumber}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Partage direct indisponible sur cet appareil : PDF téléchargé, joignez-le dans WhatsApp / Instagram', 'info');
  }).catch(err => { console.error(err); showToast('Erreur lors de la génération du PDF', 'error'); });
};

// Téléchargement PDF uniquement quand l'utilisateur clique sur le bouton de l'aperçu.
window.downloadInvoicePdf = function() {
  if (typeof html2pdf !== 'function') {
    showToast('PDF indisponible (librairie non chargée)', 'error');
    return;
  }
  const tx = (appState.transactions || []).find(t => t.id === window._invoicePreviewTxId);
  if (!tx) {
    showToast('Transaction introuvable', 'error');
    return;
  }
  const { inner, invNumber } = buildInvoiceHtml(tx);
  const node = document.createElement('div');
  node.style.width = '794px';
  node.innerHTML = inner;

  const opt = {
    margin: 0,
    filename: `${invNumber}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: [] }
  };
  showToast('Génération du PDF...', 'info');
  html2pdf().set(opt).from(node).toPdf().get('pdf').then(pdf => {
    // La facture tient sur une seule page A4 : on retire toute page vide en trop.
    while (pdf.getNumberOfPages() > 1) pdf.deletePage(pdf.getNumberOfPages());
  }).save().then(() => {
    showToast('Facture téléchargée', 'success');
  }).catch(err => {
    console.error(err);
    showToast('Erreur lors de la génération', 'error');
  });
};

// === EXPORT CSV de l'historique des transactions ===
window.exportTransactions = function() {
  const list = [...(appState.transactions || [])].sort((a, b) => (toTs ? toTs(b) - toTs(a) : 0));
  const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const rows = [['Date', 'Client', 'Offre', 'Compte Pub', 'Montant USD', 'Prix DZD', 'Lancé par', 'Statut', 'Payé'].join(',')];
  list.forEach(t => {
    const ad = t.adAccountId ? ((appState.adAccounts || []).find(a => a.id === t.adAccountId)?.name || 'Inconnu') : 'Organique';
    rows.push([
      q(t.date), q(t.clientName), q(t.offerName), q(ad), q(t.amount), q(t.priceDzd),
      q(t.launchedByName || t.employeeName || 'Admin'), q(t.status === 'problem' ? 'PROBLÈME' : 'VALIDÉ'), q(t.paid ? 'Oui' : 'Non')
    ].join(','));
  });
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV réussi', 'success');
};

// === RAPPORT FINANCIER PDF ===
window.exportFinancialReportPdf = function() {
  if (typeof html2pdf !== 'function') {
    showToast('Export PDF indisponible (librairie non chargée)', 'error');
    return;
  }
  if (typeof calculateTheoreticalBalance !== 'function' || typeof getProfitSummaryYmd !== 'function') {
    showToast('Données financières indisponibles', 'error');
    return;
  }

  const b = calculateTheoreticalBalance();
  const redotpayRate = (typeof getRedotpayRate === 'function') ? getRedotpayRate() : 250;
  const netWorthDzd = (b.liquide || 0) + (b.baridimob || 0) + (b.usdt || 0) * redotpayRate;

  const today = new Date(); today.setHours(0,0,0,0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const pMonth = getProfitSummaryYmd(toYmd(monthStart), toYmd(today));

  const clients = appState.clients || [];
  const debtors = clients.filter(c => Number(c.unpaid || 0) > 0).sort((a,b2) => (b2.unpaid||0) - (a.unpaid||0));
  const totalDettes = debtors.reduce((s,c) => s + Number(c.unpaid||0), 0);

  const recurringList = appState.recurringExpenses || [];
  const recurringTotal = recurringList.reduce((s,r) => s + Number(r.amount||0), 0);

  // Dépenses du mois par catégorie
  const monthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const catTotals = {};
  (appState.expenses || []).forEach(e => {
    if (!e || !e.date || !String(e.date).startsWith(monthKey)) return;
    const cat = e.category || 'Autre';
    catTotals[cat] = (catTotals[cat] || 0) + Number(e.amount || 0);
  });
  const catRows = Object.entries(catTotals).sort((a,b2) => b2[1]-a[1]);

  const genDate = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Algiers' });

  const node = document.createElement('div');
  node.style.padding = '40px';
  node.style.fontFamily = 'Arial, sans-serif';
  node.style.color = '#374151';
  node.style.backgroundColor = '#ffffff';
  node.style.maxWidth = '800px';
  node.style.margin = '0 auto';

  const rowsHtml = (rows, labelKey, valFmt) => rows.length === 0
    ? `<tr><td colspan="2" style="padding:12px; color:#9ca3af; font-style:italic; text-align:center;">Aucune donnée</td></tr>`
    : rows.map(r => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px; font-size:13px; color:#374151;">${r[0]}</td>
        <td style="padding:10px 12px; font-size:13px; color:#111827; font-weight:700; text-align:right;">${valFmt(r[1])}</td>
      </tr>`).join('');

  node.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:30px; border-bottom:2px solid #f3f4f6; padding-bottom:20px;">
      <div>
        <h1 style="font-size:28px; font-weight:900; color:#111827; margin:0;">Hichem Sponsor</h1>
        <p style="font-size:13px; color:#6b7280; margin:4px 0 0 0;">Rapport Financier</p>
      </div>
      <div style="text-align:right; font-size:12px; color:#6b7280;">Généré le<br><b style="color:#111827;">${genDate}</b></div>
    </div>

    <h3 style="font-size:13px; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px 0;">Trésorerie</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:25px;">
      <tr style="background:#f9fafb;"><td style="padding:10px 12px; font-size:13px;">Liquide</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${formatCurrency(b.liquide||0)}</td></tr>
      <tr><td style="padding:10px 12px; font-size:13px;">BaridiMob</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${formatCurrency(b.baridimob||0)}</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:10px 12px; font-size:13px;">USDT</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${safeToFixed(b.usdt||0,2)} $ (≈ ${formatCurrency((b.usdt||0)*redotpayRate)})</td></tr>
      <tr style="border-top:2px solid #e5e7eb;"><td style="padding:12px; font-size:15px; font-weight:900;">TOTAL TRÉSORERIE</td><td style="padding:12px; text-align:right; font-size:16px; font-weight:900; color:#4f46e5;">${formatCurrency(netWorthDzd)}</td></tr>
    </table>

    <h3 style="font-size:13px; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px 0;">Performance du mois en cours</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:25px;">
      <tr style="background:#f9fafb;"><td style="padding:10px 12px; font-size:13px;">Revenus</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${formatCurrency(pMonth.revenue)}</td></tr>
      <tr><td style="padding:10px 12px; font-size:13px;">Coût (achats/transactions)</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${formatCurrency(pMonth.cost)}</td></tr>
      <tr style="background:#f9fafb;"><td style="padding:10px 12px; font-size:13px;">Dépenses & frais</td><td style="padding:10px 12px; text-align:right; font-weight:700;">${formatCurrency(pMonth.expenses + pMonth.usdtExpensesDzd)}</td></tr>
      <tr style="border-top:2px solid #e5e7eb;"><td style="padding:12px; font-size:15px; font-weight:900;">PROFIT NET</td><td style="padding:12px; text-align:right; font-size:16px; font-weight:900; color:${pMonth.netProfit>=0?'#059669':'#dc2626'};">${formatCurrency(pMonth.netProfit)}</td></tr>
    </table>

    <h3 style="font-size:13px; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px 0;">Dépenses du mois par catégorie</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:25px;">${rowsHtml(catRows, 'cat', formatCurrency)}</table>

    <h3 style="font-size:13px; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px 0;">Charges fixes mensuelles (${recurringList.length})</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">${rowsHtml(recurringList.map(r=>[r.label, r.amount]), 'rec', formatCurrency)}</table>
    <p style="text-align:right; font-size:13px; font-weight:800; margin:0 0 25px 0;">Total: ${formatCurrency(recurringTotal)}/mois</p>

    <h3 style="font-size:13px; color:#9ca3af; text-transform:uppercase; letter-spacing:1px; margin:0 0 10px 0;">Créances clients en attente (${debtors.length})</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">${rowsHtml(debtors.slice(0,15).map(c=>[c.name, c.unpaid]), 'debt', formatCurrency)}</table>
    <p style="text-align:right; font-size:14px; font-weight:900; color:#dc2626; margin:0;">Total créances: ${formatCurrency(totalDettes)}</p>

    <div style="margin-top:40px; padding-top:15px; border-top:1px solid #e5e7eb; text-align:center; font-size:11px; color:#9ca3af;">
      Rapport généré automatiquement par Sponsor Manager.
    </div>
  `;

  const opt = {
    margin: [10, 10],
    filename: `Rapport_Financier_${toYmd(today)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('Génération du rapport...', 'info');
  html2pdf().set(opt).from(node).save().then(() => {
    if (typeof logActivity === 'function') logActivity('Rapport financier exporté', `PDF généré le ${genDate}`);
    showToast('Rapport financier généré', 'success');
  }).catch(err => {
    console.error(err);
    showToast('Erreur lors de la génération du rapport', 'error');
  });
};

window.addClient = function() {
  const name = document.getElementById('newClientName')?.value?.trim();
  const phone = document.getElementById('newClientPhone')?.value?.trim();
  const instagram = document.getElementById('newClientInstagram')?.value?.trim();
  const facebook = document.getElementById('newClientFacebook')?.value?.trim();
  const notes = document.getElementById('newClientNotes')?.value?.trim();

  if (!name) return showToast('Nom du client requis', 'error');

  const igHandle = instagram ? instagram.replace(/^@+/, '').trim() : '';

  if (window.editingClientId) {
    const client = (appState.clients || []).find(c => c.id === window.editingClientId);
    if (!client) return;
    client.name = name;
    client.phone = phone || '';
    client.instagram = igHandle || '';
    client.contact = phone || instagram || facebook || '';
    client.notes = notes || '';
    client.username = igHandle || '';
    client.social = { instagram: igHandle ? [igHandle] : [], facebook: facebook ? [facebook.trim()] : [] };
    client.updatedAt = Date.now();
    window.editingClientId = null;
    showToast('Client modifié', 'success');
  } else {
    const cleanName = name.toLowerCase().trim();
    if ((appState.clients || []).some(c => (c.name || '').toLowerCase().trim() === cleanName)) {
      return showToast('Ce client existe déjà', 'warning');
    }
    const client = {
      id: generateId('client'),
      name,
      phone: phone || '',
      instagram: igHandle || '',
      contact: phone || instagram || facebook || '',
      notes: notes || '',
      totalSpent: 0,
      unpaid: 0,
      updatedAt: Date.now(),
      social: {
        instagram: igHandle ? [igHandle] : [],
        facebook: facebook ? [facebook.trim()] : []
      }
    };
    if (!appState.clients) appState.clients = [];
    appState.clients.push(client);
    showToast('Client ajouté', 'success');
  }

  closeModal('clientModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

// Ouvre le formulaire en mode CRÉATION : toujours vierge, jamais lié à un client modifié avant.
window.openNewClientModal = function() {
  window.editingClientId = null;
  ['newClientName', 'newClientPhone', 'newClientInstagram', 'newClientFacebook', 'newClientNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const t = document.getElementById('clientModalTitle');
  if (t) t.innerHTML = '<i class="fas fa-user-plus text-blue-600"></i> Nouveau Client';
  openModal('clientModal');
};

window.editClient = function(id) {
  const client = (appState.clients || []).find(c => c.id === id);
  if (!client) return;
  window.editingClientId = id;
  const modalTitle = document.getElementById('clientModalTitle');
  if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-user-pen text-blue-600"></i> Modifier le client';
  const ig = client.instagram || (client.social && Array.isArray(client.social.instagram) && client.social.instagram[0]) || client.username || '';
  const fb = (client.social && Array.isArray(client.social.facebook) && client.social.facebook[0]) || '';
  if (document.getElementById('newClientName')) document.getElementById('newClientName').value = client.name || '';
  if (document.getElementById('newClientPhone')) document.getElementById('newClientPhone').value = client.phone || '';
  if (document.getElementById('newClientInstagram')) document.getElementById('newClientInstagram').value = ig || '';
  if (document.getElementById('newClientFacebook')) document.getElementById('newClientFacebook').value = fb || '';
  if (document.getElementById('newClientNotes')) document.getElementById('newClientNotes').value = client.notes || '';
  openModal('clientModal');
};

window.updateClientDebtNote = function(id, note) {
  const client = (appState.clients || []).find(c => c.id === id);
  if (!client) return;
  client.debtNote = note;
  client.updatedAt = Date.now();
  if (typeof autoSave === 'function') autoSave();
};

window.openPaymentModalPrefilled = function(clientId) {
  openModal('paymentModal');
  setTimeout(() => {
    if (typeof populatePaymentClientDropdown === 'function') populatePaymentClientDropdown();
    const hidden = document.getElementById('paymentClientId');
    const search = document.getElementById('paymentClientSearch');
    const client = (appState.clients || []).find(c => c.id === clientId);
    if (hidden) hidden.value = clientId;
    if (search && client) search.value = client.name;
  }, 10);
};
window.deleteClient = function(id) {
  if (!confirm('Supprimer ce client ?')) return;
  const cl = (appState.clients || []).find(c => c.id === id);
  if (cl && typeof logActivity === 'function') logActivity('Client supprimé', `${cl.name || ''}${cl.unpaid > 0 ? ` (dette en cours: ${formatCurrency(cl.unpaid)})` : ''}`);
  appState.clients = (appState.clients || []).filter(c => c.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'clients', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.addOffer = function() {
  const name = document.getElementById('newOfferName')?.value?.trim();
  const description = document.getElementById('newOfferDesc')?.value?.trim();
  const priceDzd = Number(document.getElementById('newOfferPrice')?.value || 0);
  const costPerUnit = Number(document.getElementById('newOfferCostPerUnit')?.value || 0);
  const duration = document.getElementById('newOfferDuration')?.value?.trim();

  if (!name || !priceDzd) return showToast('Nom et prix requis', 'error');

  if (window.editingOfferId) {
    const offer = (appState.offers || []).find(o => o.id === window.editingOfferId);
    if (!offer) return;
    Object.assign(offer, { name, description: description || '', priceDzd, costPerUnit, duration: duration || '', updatedAt: Date.now() });
    window.editingOfferId = null;
    showToast('Offre modifiée', 'success');
  } else {
    if (!appState.offers) appState.offers = [];
    appState.offers.push({ id: generateId('offer'), name, description: description || '', priceDzd, costPerUnit, duration: duration || '', updatedAt: Date.now() });
    showToast('Offre ajoutée', 'success');
  }
  closeModal('offerModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.editOffer = function(id) {
  const offer = (appState.offers || []).find(o => o.id === id);
  if (!offer) return;
  window.editingOfferId = id;
  if (document.getElementById('newOfferName')) document.getElementById('newOfferName').value = offer.name || '';
  if (document.getElementById('newOfferDesc')) document.getElementById('newOfferDesc').value = offer.description || '';
  if (document.getElementById('newOfferPrice')) document.getElementById('newOfferPrice').value = offer.priceDzd || 0;
  if (document.getElementById('newOfferCostPerUnit')) document.getElementById('newOfferCostPerUnit').value = offer.costPerUnit || 0;
  if (document.getElementById('newOfferDuration')) document.getElementById('newOfferDuration').value = offer.duration || '';
  openModal('offerModal');
};

window.deleteOffer = function(id) {
  if (!confirm('Supprimer cette offre ?')) return;
  appState.offers = (appState.offers || []).filter(o => o.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'offers', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.handleNewTodoSubmit = function(actionMode, event) {
  if (event) event.preventDefault();
  const form = document.getElementById('newTodoForm');
  if (form && !form.checkValidity()) {
    form.reportValidity();
    return;
  }
  
  const clientId = document.getElementById('todoClientId')?.value;
  const offerId = document.getElementById('todoOfferId')?.value;
  const priceDzd = Number(document.getElementById('todoPrice')?.value || 0);
  const paid = !!document.getElementById('todoPaid')?.checked;
  const paidAccount = document.getElementById('todoPaidAccount')?.value || 'liquide';

  const client = (appState.clients || []).find(c => c.id === clientId);
  if (!client) return showToast('Client invalide', 'error');
  if (!offerId) return showToast('Offre invalide', 'error');
  if (!Number.isFinite(priceDzd) || priceDzd <= 0) return showToast('Prix DZD invalide', 'error');

  const isCustom = offerId === '__custom__';
  const offer = isCustom ? null : (appState.offers || []).find(o => o.id === offerId);
  if (!isCustom && !offer) return showToast('Offre introuvable', 'error');

  let finalOfferId = offerId;
  let finalOfferName = offer ? offer.name : 'Offre personnalisée';
  let amountUsd = offer ? Number(offer.costPerUnit || 0) : 0;
  let durationDays = offer ? Number(offer.duration || 0) : null;

  if (isCustom) {
    finalOfferId = generateId('custom_offer');
    const customName = (document.getElementById('todoCustomName')?.value || '').trim();
    const customUsd = Number(document.getElementById('todoCustomUsd')?.value || 0);
    const customDuration = Number(document.getElementById('todoCustomDuration')?.value || 0);
    if (customName) finalOfferName = customName;
    if (!Number.isFinite(customUsd) || customUsd <= 0) return showToast('Montant USD invalide', 'error');
    if (!Number.isFinite(customDuration) || customDuration <= 0) return showToast('Durée invalide', 'error');
    amountUsd = customUsd;
    durationDays = customDuration;
  }

    // "Lancé par" : employé choisi dans la liste (Admin si vide). Sans champ, on retombe sur la session.
    const launchedBy = (function() {
      const sel = document.getElementById('todoLaunchedBy');
      const sess = appState.session;
      if (sel) {
        const emp = sel.value ? (appState.employees || []).find(e => e.id === sel.value) : null;
        if (emp) return { id: emp.id, name: emp.name || emp.login || 'Employé', isAdmin: false };
        return { id: null, name: 'Admin', isAdmin: true };
      }
      if (sess && sess.type === 'employee') return { id: sess.employeeId || null, name: sess.name || 'Employé', isAdmin: false };
      return { id: null, name: 'Admin', isAdmin: true };
    })();

    const todoDateStr = document.getElementById('todoDate')?.value || getLocalDateString();
    const adAccountId = document.getElementById('todoAdAccountId')?.value || null;
    
    // Calculate endDate if a duration is specified
    let endDate = null;
    if (durationDays > 0) {
        const start = new Date(todoDateStr);
        if (!isNaN(start.getTime())) {
            start.setDate(start.getDate() + durationDays);
            endDate = start.getTime();
        }
    }
    
    const todo = {
    id: generateId('todo'),
    clientId: client.id,
    clientName: client.name,
    offerId: finalOfferId,
    offerName: finalOfferName,
    priceDzd,
    amount: amountUsd,
    paid,
    paidAccount: paid ? paidAccount : null,
    status: 'pending',
    date: todoDateStr,
    adAccountId: adAccountId,
    endDate: endDate,
    createdAt: Date.now(),
    customDurationDays: durationDays,
    employeeId: launchedBy.id,
    employeeName: launchedBy.isAdmin ? null : launchedBy.name,
    launchedById: launchedBy.id,
    launchedByName: launchedBy.name,
    // Taux d'achat USD figé à la date de la vente (la marge de cette vente ne bouge plus si le taux change)
    buyRate: (typeof getBuyRate === 'function') ? Number(getBuyRate()) || undefined : undefined
  };

  if (actionMode === 'direct') {
    if (!appState.transactions) appState.transactions = [];
    const tx = { ...todo, id: generateId('tx'), status: 'active', completedAt: Date.now() };
    appState.transactions.push(tx);
    client.totalSpent = (client.totalSpent || 0) + (todo.priceDzd || 0);
    if (!todo.paid) adjustClientUnpaid(client, todo.priceDzd || 0);
    client.updatedAt = Date.now();
    if (typeof autoSave === 'function') autoSave();
    showToast('Sponsor validé (direct)', 'success');
    if (typeof showTab === 'function') showTab('history');
    return;
  }

  if (!appState.todoTransactions) appState.todoTransactions = [];
  appState.todoTransactions.push(todo);
  if (typeof autoSave === 'function') autoSave();
  showToast('Tâche ajoutée à la To-Do List', 'success');
  if (typeof showTab === 'function') showTab('transactions');
};

window.updateTodoPrice = function() {
  const offerId = document.getElementById('todoOfferId')?.value;
  const offer = (appState.offers || []).find(o => o.id === offerId);
  const priceEl = document.getElementById('todoPrice');
  const customBox = document.getElementById('todoCustomOfferFields');
  const isCustom = offerId === '__custom__';

  if (customBox) {
    if (isCustom) customBox.classList.remove('hidden');
    else customBox.classList.add('hidden');
  }

  if (!priceEl) return;
  if (isCustom) {
    priceEl.readOnly = false;
    if (!priceEl.value) priceEl.value = '';
    return;
  }

  const v = offer ? (offer.priceDzd ?? offer.price ?? 0) : 0;
  priceEl.value = Number(v) || 0;
  priceEl.readOnly = true;
};

window.filterTodoOffers = function() {
  const searchEl = document.getElementById('todoOfferSearch');
  const select = document.getElementById('todoOfferId');
  const counter = document.getElementById('todoOfferMatchCount');
  if (!select) return;
  const query = (searchEl?.value || '').trim().toLowerCase();

  let visibleCount = 0;
  Array.from(select.options).forEach((opt, idx) => {
    if (idx === 0 || idx === 1) {
      opt.hidden = false;
      return;
    }
    const text = (opt.textContent || '').toLowerCase();
    const match = !query || text.includes(query);
    opt.hidden = !match;
    if (match) visibleCount += 1;
  });

  if (counter) {
    counter.textContent = query ? `${visibleCount} offre(s) trouvée(s)` : `${Math.max(0, select.options.length - 2)} offres`;
  }
};

window.clearTodoOfferSearch = function() {
  const searchEl = document.getElementById('todoOfferSearch');
  if (searchEl) searchEl.value = '';
  if (typeof filterTodoOffers === 'function') filterTodoOffers();
  if (searchEl) searchEl.focus();
};

window.changeTodoStatus = function(id, newStatus, currentType) {
  let sourceArray = currentType === 'problem' ? appState.transactions : appState.todoTransactions;
  if (!sourceArray) return;
  
  let itemIndex = sourceArray.findIndex(t => t.id === id);
  if (itemIndex === -1) return;
  let item = sourceArray[itemIndex];

  if (
    (currentType === 'todo' && newStatus === 'pending') ||
    (currentType === 'in_progress' && newStatus === 'in_progress') ||
    (currentType === 'problem' && newStatus === 'problem')
  ) return;

  const employeeId = (appState.session && appState.session.type === 'employee') ? appState.session.employeeId : (item.employeeId || null);
  const employeeName = (appState.session && appState.session.type === 'employee') ? (appState.session.name || '') : (item.employeeName || null);

  item.employeeId = employeeId;
  item.employeeName = employeeName;
  item.updatedAt = Date.now();

  if (newStatus === 'done' || newStatus === 'problem') {
    const destStatus = newStatus === 'done' ? 'active' : 'problem';
    if (currentType === 'problem') {
       if (destStatus === 'active') {
         item.status = 'active';
         item.completedAt = Date.now();
         if (!item.buyRate && typeof getBuyRate === 'function') item.buyRate = Number(getBuyRate()) || undefined;
         const client = (appState.clients || []).find(c => c.id === item.clientId);
         if (client) {
           client.totalSpent = (client.totalSpent || 0) + (item.priceDzd || 0);
           if (!item.paid) adjustClientUnpaid(client, item.priceDzd || 0);
           client.updatedAt = Date.now();
         }
         showToast('Problème résolu, transaction validée', 'success');
       }
    } else {
       if (!appState.transactions) appState.transactions = [];
       const newTx = { ...item, id: generateId('tx'), status: destStatus, buyRate: item.buyRate || ((typeof getBuyRate === 'function') ? Number(getBuyRate()) || undefined : undefined) };
       if (destStatus === 'active') {
         newTx.completedAt = Date.now();
         const client = (appState.clients || []).find(c => c.id === item.clientId);
         if (client) {
           client.totalSpent = (client.totalSpent || 0) + (item.priceDzd || 0);
           if (!item.paid) adjustClientUnpaid(client, item.priceDzd || 0);
           client.updatedAt = Date.now();
         }
       }
       appState.transactions.push(newTx);
       if (!appState.sync) appState.sync = {};
       if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
       appState.sync.pendingDeletions.push({ col: 'todoTransactions', id: item.id });
       sourceArray.splice(itemIndex, 1);
       showToast(destStatus === 'active' ? 'Transaction validée' : 'Signalé comme PROBLÈME', destStatus === 'active' ? 'success' : 'warning');
    }
  } else if (newStatus === 'pending' || newStatus === 'in_progress') {
    if (currentType === 'problem') {
      if (!appState.todoTransactions) appState.todoTransactions = [];
      const newTodo = { ...item, id: generateId('todo'), status: newStatus };
      appState.todoTransactions.push(newTodo);
      if (!appState.sync) appState.sync = {};
      if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
      appState.sync.pendingDeletions.push({ col: 'transactions', id: item.id });
      sourceArray.splice(itemIndex, 1);
      showToast(newStatus === 'pending' ? 'Remis en attente' : 'Marqué EN COURS', 'info');
    } else {
      item.status = newStatus;
      showToast(newStatus === 'pending' ? 'Remis en attente' : 'Marqué EN COURS', 'info');
    }
  }

  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.toggleTodoPayment = function(id, currentType) {
  let sourceArray = currentType === 'problem' ? appState.transactions : appState.todoTransactions;
  if (!sourceArray) return;
  const item = sourceArray.find(t => t.id === id);
  if (!item) return;

  if (!item.paid) {
    // Passage à "payé" : on demande dans quelle caisse l'argent entre.
    window.openPaidAccountModal(id, currentType);
    return;
  }

  // Passage à "non payé" : rien à demander.
  item.paid = false;
  item.paidAccount = null;
  if (typeof logActivity === 'function') logActivity('Paiement annulé', `${item.clientName || ''} — ${formatCurrency(item.priceDzd)}`);
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

// Petit modal pour choisir la caisse de destination quand on marque payé
window.openPaidAccountModal = function(id, currentType) {
  const modal = document.createElement('div');
  modal.id = 'paidAccountModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 p-6 rounded-3xl w-full max-w-sm shadow-2xl fade-in border dark:border-gray-700">
      <h3 class="text-lg font-bold mb-4 dark:text-white flex items-center gap-2">
        <i class="fas fa-cash-register text-indigo-600"></i> L'argent va dans quelle caisse ?
      </h3>
      <div class="space-y-2">
        <button onclick="confirmPaidAccount('${id}', '${currentType}', 'liquide')" class="w-full p-4 rounded-xl bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 font-bold flex items-center gap-3">💵 Liquide</button>
        <button onclick="confirmPaidAccount('${id}', '${currentType}', 'baridimob')" class="w-full p-4 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold flex items-center gap-3">🏦 BaridiMob</button>
        <button onclick="confirmPaidAccount('${id}', '${currentType}', 'usdt')" class="w-full p-4 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 font-bold flex items-center gap-3">🪙 USDT</button>
      </div>
      <button onclick="document.getElementById('paidAccountModal').remove()" class="mt-4 w-full py-2 text-gray-500 hover:text-gray-700 font-bold">Annuler</button>
    </div>
  `;
  document.body.appendChild(modal);
};

window.confirmPaidAccount = function(id, currentType, account) {
  let sourceArray = currentType === 'problem' ? appState.transactions : appState.todoTransactions;
  const item = sourceArray ? sourceArray.find(t => t.id === id) : null;
  if (item) {
    item.paid = true;
    item.paidAccount = account;
    if (typeof logActivity === 'function') logActivity('Paiement reçu (tâche)', `${item.clientName || ''} — ${formatCurrency(item.priceDzd)} (${account})`);
  }
  const modal = document.getElementById('paidAccountModal');
  if (modal) modal.remove();
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.deleteTodoTransaction = function(id, currentType) {
  if (!confirm('Supprimer cette tâche ?')) return;
  let col = currentType === 'problem' ? 'transactions' : 'todoTransactions';
  appState[col] = (appState[col] || []).filter(t => t.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: col, id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.addPayment = function() {
  const clientId = document.getElementById('paymentClientId')?.value;
  const amount = Number(document.getElementById('paymentAmount')?.value || 0);
  const method = document.getElementById('paymentMethod')?.value || 'Cash';
  const note = document.getElementById('paymentNote')?.value?.trim() || '';
  if (!clientId || !amount) return showToast('Client et montant requis', 'error');
  const client = (appState.clients || []).find(c => c.id === clientId);
  if (!client) return showToast('Client introuvable', 'error');

  const payment = { id: generateId('pay'), date: getLocalDateString(), clientId: client.id, clientName: client.name, amount, method, note, createdAt: Date.now() };
  if (!appState.payments) appState.payments = [];
  appState.payments.push(payment);
  adjustClientUnpaid(client, -amount);
  client.updatedAt = Date.now();
  if (typeof logActivity === 'function') logActivity('Paiement reçu', `${client.name} — ${formatCurrency(amount)} (${method})`);

  closeModal('paymentModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Paiement enregistré', 'success');
};

window.deletePayment = function(id) {
  if (!confirm('Supprimer ce paiement ? La dette du client sera réajustée.')) return;
  const pay = (appState.payments || []).find(p => p.id === id);
  if (pay) {
    const client = (appState.clients || []).find(c => c.id === pay.clientId);
    if (client) {
      adjustClientUnpaid(client, pay.amount || 0);
      client.updatedAt = Date.now();
    }
    if (typeof logActivity === 'function') logActivity('Paiement supprimé', `${pay.clientName || ''} — ${formatCurrency(pay.amount)}`);
  }
  appState.payments = (appState.payments || []).filter(p => p.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'payments', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.addExpense = function() {
  const date = document.getElementById('expenseDate')?.value || (typeof getLocalDateString === 'function' ? getLocalDateString() : '');
  const category = (document.getElementById('expenseCategory')?.value || '').trim();
  const account = document.getElementById('expenseAccount')?.value || 'liquide';
  const amount = Number(document.getElementById('expenseAmount')?.value || 0);
  const note = (document.getElementById('expenseNote')?.value || '').trim();

  if (!date) return showToast('Date requise', 'error');
  if (!category) return showToast('Catégorie requise', 'error');
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');

  const expense = {
    id: generateId('exp'),
    date,
    category,
    account,
    amount,
    note,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (!appState.expenses) appState.expenses = [];
  appState.expenses.push(expense);
  if (typeof logActivity === 'function') logActivity('Dépense ajoutée', `${category} — ${formatCurrency(amount)} (${account})`);

  closeModal('expenseModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Frais ajouté', 'success');
};

window.deleteExpense = function(id) {
  if (!confirm('Supprimer ce frais ?')) return;
  const exp = (appState.expenses || []).find(e => e.id === id);
  if (exp && typeof logActivity === 'function') logActivity('Dépense supprimée', `${exp.category || ''} — ${formatCurrency(exp.amount)}`);
  appState.expenses = (appState.expenses || []).filter(e => e.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'expenses', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Frais supprimé', 'info');
};

// === CHARGES FIXES RÉCURRENTES (mensuelles) ===
window.addRecurringExpense = function() {
  const label = (document.getElementById('recurringLabel')?.value || '').trim();
  const category = (document.getElementById('recurringCategory')?.value || '').trim() || 'Récurrent';
  const account = document.getElementById('recurringAccount')?.value || 'liquide';
  const amount = Number(document.getElementById('recurringAmount')?.value || 0);

  if (!label) return showToast('Nom de la charge requis', 'error');
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');

  const item = {
    id: generateId('rec'),
    label,
    category,
    account,
    amount,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (!appState.recurringExpenses) appState.recurringExpenses = [];
  appState.recurringExpenses.push(item);
  if (typeof logActivity === 'function') logActivity('Charge fixe ajoutée', `${label} — ${formatCurrency(amount)}/mois`);

  ['recurringLabel', 'recurringCategory', 'recurringAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Charge fixe ajoutée', 'success');
};

window.deleteRecurringExpense = function(id) {
  if (!confirm('Supprimer cette charge fixe ? Elle ne sera plus prélevée automatiquement chaque mois.')) return;
  const rec = (appState.recurringExpenses || []).find(e => e.id === id);
  if (rec && typeof logActivity === 'function') logActivity('Charge fixe supprimée', `${rec.label || ''} — ${formatCurrency(rec.amount)}/mois`);
  appState.recurringExpenses = (appState.recurringExpenses || []).filter(e => e.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'recurringExpenses', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Charge fixe supprimée', 'info');
};

// Force l'application immédiate des charges fixes du mois (au lieu d'attendre le check automatique)
window.applyRecurringExpensesNow = function() {
  if (!Array.isArray(appState.recurringExpenses) || appState.recurringExpenses.length === 0) {
    return showToast('Aucune charge fixe configurée', 'info');
  }
  const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  if ((appState.appliedRecurringMonths || []).includes(monthKey)) {
    return showToast('Les charges fixes du mois ont déjà été prélevées', 'info');
  }
  if (typeof applyRecurringExpensesForCurrentMonth === 'function') applyRecurringExpensesForCurrentMonth();
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof logActivity === 'function') logActivity('Charges fixes prélevées', `${(appState.recurringExpenses||[]).length} poste(s) pour le mois en cours`);
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Charges fixes du mois prélevées', 'success');
};

window.addUsdPurchase = function() {
  const amount = Number(document.getElementById('usdAmount')?.value || 0);
  const rate = Number(document.getElementById('usdRate')?.value || 0);
  const source = document.getElementById('usdSource')?.value?.trim() || '';
  if (!amount || !rate) return showToast('Montant et taux requis', 'error');
  const purchase = { id: generateId('usd'), date: getLocalDateString(), amount, rate, totalDzd: amount * rate, source, createdAt: Date.now() };
  if (!appState.usdPurchases) appState.usdPurchases = [];
  appState.usdPurchases.push(purchase);
  if (typeof logActivity === 'function') logActivity('Achat USD/USDT', `${amount} $ au taux ${rate} — ${formatCurrency(amount * rate)}`);
  closeModal('usdPurchaseModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Achat USD enregistré', 'success');
};

window.deleteUsdPurchase = function(id) {
  if (!confirm('Supprimer cet achat USD ?')) return;
  const p = (appState.usdPurchases || []).find(x => x.id === id);
  if (p && typeof logActivity === 'function') logActivity('Achat USD supprimé', `${p.amount} $ — ${formatCurrency(p.totalDzd)}`);
  appState.usdPurchases = (appState.usdPurchases || []).filter(p => p.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'usdPurchases', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.openRequestModal = function(id) {
  const req = (appState.clientRequests || []).find(r => r.id === id);
  if (!req) return;
  req.read = true;
  if (typeof autoSave === 'function') autoSave();
  alert(`Détails de la demande:\n\nClient: ${req.instagram || req.pageFacebook || ''}\nOffre: ${req.offer || ''}\nLien: ${req.pubLink || ''}`);
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.deleteRequest = function(id) {
  if (!confirm('Supprimer cette demande ?')) return;
  appState.clientRequests = (appState.clientRequests || []).filter(r => r.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'clientRequests', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.sendWhatsAppReminder = function(clientId) {
  const client = (appState.clients || []).find(c => c.id === clientId);
  if (!client || !client.unpaid) return;
  const phone = normalizePhoneForWhatsApp(client.phone || client.contact);
  if (!phone) return showToast('Numéro WhatsApp invalide ou absent', 'error');

  const message = encodeURIComponent(
    `Bonjour ${client.name},\n\n` +
    `C'est Hichem Sponsor. Sauf erreur de notre part, il reste un montant impayé de ${formatCurrency(client.unpaid)} concernant vos dernières transactions.\n\n` +
    `Pourriez-vous nous confirmer le règlement dès que possible ?\n\n` +
    `Merci de votre confiance !`
  );
  window.open(`https://wa.me/${phone}?text=${message}`, '_blank');   // intercepté par messaging.js → application WhatsApp
};

window.sendInstagramReminder = function(clientId) {
  const client = (appState.clients || []).find(c => c.id === clientId);
  if (!client || !client.unpaid) return;
  
  const igHandle = client.instagram ? client.instagram.replace('@', '').trim() : '';
  if (!igHandle) return showToast('Compte Instagram invalide ou absent', 'error');

  // Instagram does not support pre-filling messages via URL schemes on web reliably,
  // but we can copy the message to the clipboard and open the chat.
  const message = `Bonjour ${client.name},\n\n` +
    `C'est Hichem Sponsor. Sauf erreur de notre part, il reste un montant impayé de ${formatCurrency(client.unpaid)} concernant vos dernières transactions.\n\n` +
    `Pourriez-vous nous confirmer le règlement dès que possible ?\n\n` +
    `Merci de votre confiance !`;
    
  if (navigator.clipboard) {
    navigator.clipboard.writeText(message).then(() => {
      showToast('Message copié dans le presse-papier !', 'success');
      window.open(`https://ig.me/m/${igHandle}`, '_blank');
    }).catch(err => {
      console.error('Erreur copie presse-papier:', err);
      window.open(`https://ig.me/m/${igHandle}`, '_blank');
    });
  } else {
    window.open(`https://ig.me/m/${igHandle}`, '_blank');
  }
};

window.addAdAccount = function() {
  const name = document.getElementById('accName')?.value?.trim();
  const platform = document.getElementById('accPlatform')?.value || 'meta';
  const balance = Number(document.getElementById('accBalance')?.value || 0);
  if (!name) return showToast('Nom du compte requis', 'error');
  const account = { id: generateId('acc'), name, platform, balance, status: 'active', updatedAt: Date.now() };
  if (!appState.adAccounts) appState.adAccounts = [];
  appState.adAccounts.push(account);
  closeModal('adAccountModal');
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Compte publicitaire ajouté', 'success');
};

window.deleteAdAccount = function(id) {
  if (!confirm('Supprimer ce compte publicitaire ?')) return;
  appState.adAccounts = (appState.adAccounts || []).filter(a => a.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'adAccounts', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.rechargeAdAccount = function(id) {
  const amountStr = prompt('Montant de la recharge ($) :');
  if (amountStr === null) return;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return showToast('Montant invalide', 'error');
  const acc = (appState.adAccounts || []).find(a => a.id === id);
  if (!acc) return;
  acc.balance = Number(acc.balance || 0) + amount;
  acc.updatedAt = Date.now();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast(`Compte rechargé de ${amount}$`, 'success');
};

// === SÉCURITÉ : liste blanche des emails admin ===
window.addAdminEmail = function() {
  const el = document.getElementById('newAdminEmail');
  const email = (el?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return showToast('Email invalide', 'error');

  if (!appState.globalConfig) appState.globalConfig = {};
  if (!Array.isArray(appState.globalConfig.adminEmails)) appState.globalConfig.adminEmails = [];

  if (appState.globalConfig.adminEmails.includes(email) || email === 'hichem@sponsor.com') {
    return showToast('Cet email est déjà autorisé', 'warning');
  }

  appState.globalConfig.adminEmails.push(email);
  if (el) el.value = '';
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Email admin autorisé. N\'oubliez pas de créer ce compte dans Firebase Authentication.', 'success');
};

window.removeAdminEmail = function(idx) {
  if (!appState.globalConfig || !Array.isArray(appState.globalConfig.adminEmails)) return;
  if (!confirm('Retirer cet email de la liste des admins autorisés ?')) return;
  appState.globalConfig.adminEmails.splice(idx, 1);
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Email retiré', 'info');
};

// === JOURNAL D'ACTIVITÉ : modal de consultation ===
window.openActivityLogModal = function() {
  const modal = document.createElement('div');
  modal.id = 'activityLogModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

  const log = appState.activityLog || [];

  const actionIcon = (action) => {
    if (/supprim/i.test(action)) return 'fa-trash-alt text-red-500';
    if (/ajout|créé|reçu|prélevées/i.test(action)) return 'fa-plus-circle text-green-500';
    if (/ajustement/i.test(action)) return 'fa-sliders-h text-indigo-500';
    return 'fa-info-circle text-gray-400';
  };

  const rows = log.length === 0 ? `
      <p class="text-center py-8 text-gray-500 dark:text-gray-400 italic">Aucune activité enregistrée pour le moment.</p>
    ` : log.map(l => `
      <div class="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border dark:border-gray-700">
        <i class="fas ${actionIcon(l.action)} mt-1"></i>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-gray-800 dark:text-gray-200 text-sm">${escapeHtml(l.action)}</div>
          ${l.details ? `<div class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(l.details)}</div>` : ''}
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs font-bold text-indigo-500">${escapeHtml(l.actor)}</div>
          <div class="text-[10px] text-gray-400">${new Date(l.ts).toLocaleString('fr-FR', { timeZone: 'Africa/Algiers' })}</div>
        </div>
      </div>
    `).join('');

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-3xl w-full max-w-2xl shadow-2xl fade-in border dark:border-gray-700">
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold flex items-center gap-2 dark:text-white">
          <i class="fas fa-shield-alt text-indigo-600"></i> Journal d'activité
        </h3>
        <button onclick="document.getElementById('activityLogModal').remove()" class="text-gray-400 hover:text-gray-600 text-2xl">×</button>
      </div>
      <div class="space-y-2 max-h-[28rem] overflow-y-auto">${rows}</div>
      <div class="mt-6 flex justify-end">
        <button onclick="document.getElementById('activityLogModal').remove()" class="px-6 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-bold">Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.addEmployee = async function() {
  let name = (document.getElementById('employeeName')?.value || '').trim();
  const login = (document.getElementById('employeeLogin')?.value || '').trim();
  const password = (document.getElementById('employeePassword')?.value || '').trim();
  const salary = Number(document.getElementById('employeeSalary')?.value || 0);
  
  // Default values
  const active = document.getElementById('employeeActive') ? !!document.getElementById('employeeActive').checked : true;
  if (!name) name = login;

  if (!login || !password) return showToast('Nom d\'utilisateur et mot de passe requis', 'error');

  if (!appState.employees) appState.employees = [];
  const exists = appState.employees.some(e => (e.login || '').toLowerCase() === login.toLowerCase());
  if (exists) return showToast('Ce nom d\'utilisateur existe déjà', 'warning');

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  appState.employees.push({
    id: generateId('emp'),
    name,
    login,
    passwordHash,
    passwordSalt: salt,
    salary,
    active,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  if (document.getElementById('employeeName')) document.getElementById('employeeName').value = '';
  if (document.getElementById('employeeLogin')) document.getElementById('employeeLogin').value = '';
  if (document.getElementById('employeePassword')) document.getElementById('employeePassword').value = '';
  if (document.getElementById('employeeSalary')) document.getElementById('employeeSalary').value = '';
  if (document.getElementById('employeeActive')) document.getElementById('employeeActive').checked = true;

  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  if (typeof logActivity === 'function') logActivity('Employé créé', `${name} (${login})`);
  showToast('Employé ajouté', 'success');
};

window.updateEmployeeSalary = function(id) {
  const employee = appState.employees.find(e => e.id === id);
  if (!employee) return;
  const newSalary = Number(document.getElementById(`editSalary-${id}`)?.value || 0);
  employee.salary = newSalary;
  employee.updatedAt = Date.now();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Salaire mis à jour', 'success');
};

window.markAbsent = function(employeeId) {
  const today = getAlgeriaNow();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (!appState.absences) appState.absences = [];
  const existing = appState.absences.find(a => a.employeeId === employeeId && a.date === todayStr);
  if (existing) return;
  appState.absences.push({
    id: generateId('absence'),
    employeeId,
    date: todayStr,
    time: Date.now(),
    createdAt: Date.now()
  });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Absence enregistrée', 'success');
};

window.removeAbsence = function(employeeId) {
  const today = getAlgeriaNow();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (!appState.absences) appState.absences = [];
  appState.absences = appState.absences.filter(a => !(a.employeeId === employeeId && a.date === todayStr));
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Absence annulée', 'success');
};

window.openAbsenceHistoryModal = function() {
  const today = getAlgeriaNow();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  
  const modal = document.createElement('div');
  modal.id = 'absenceHistoryModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
  
  // Function to render the history
  const renderHistory = () => {
    const selectedMonth = document.getElementById('historyMonthFilter')?.value || currentMonth;
    const [year, month] = selectedMonth.split('-').map(Number);
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate().toString().padStart(2,'0')}`;
    
    const monthAbsences = (appState.absences || []).filter(a => {
      return a.date >= monthStart && a.date <= monthEnd;
    });
    
    // Group by employee
    const grouped = {};
    monthAbsences.forEach(a => {
      if (!grouped[a.employeeId]) grouped[a.employeeId] = [];
      grouped[a.employeeId].push(a);
    });
    
    const content = document.getElementById('absenceHistoryContent');
    if (content) {
      content.innerHTML = Object.keys(grouped).length === 0 ? `
        <p class="text-center py-8 text-gray-500 dark:text-gray-400 italic">
          Aucune absence pour ce mois
        </p>
      ` : Object.keys(grouped).map(empId => {
        const emp = appState.employees.find(e => e.id === empId);
        const absences = grouped[empId];
        return `
          <div class="p-4 border rounded-2xl bg-gray-50 dark:bg-gray-700 mb-4">
            <h4 class="font-bold text-gray-800 dark:text-white mb-2">
              ${emp ? escapeHtml(emp.name) : 'Employé inconnu'}
              <span class="text-sm font-normal text-gray-500 dark:text-gray-400">
                (${absences.length} absence${absences.length > 1 ? 's' : ''})
              </span>
            </h4>
            <div class="flex flex-wrap gap-2">
              ${absences.map(a => `
                <div class="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm flex items-center gap-2">
                  ${a.date}
                  <button onclick="deleteAbsence('${a.id}')" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
    }
  };
  
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-3xl w-full max-w-2xl shadow-2xl fade-in border dark:border-gray-700">
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-xl font-bold flex items-center gap-2 dark:text-white">
          <i class="fas fa-history text-indigo-600"></i> Historique des absences
        </h3>
        <button onclick="document.getElementById('absenceHistoryModal').remove()" class="text-gray-400 hover:text-gray-600 text-2xl">
          ×
        </button>
      </div>
      
      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Filtrer par mois</label>
        <input type="month" id="historyMonthFilter" value="${currentMonth}" class="w-full p-4 border dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900 dark:text-white">
      </div>
      
      <div id="absenceHistoryContent" class="max-h-96 overflow-y-auto">
        <!-- History will be rendered here -->
      </div>
      
      <div class="mt-6 flex justify-end">
        <button onclick="document.getElementById('absenceHistoryModal').remove()" class="px-6 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl font-bold">
          Fermer
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Set up event listener for month filter change
  const filter = document.getElementById('historyMonthFilter');
  if (filter) {
    filter.addEventListener('change', renderHistory);
  }
  
  // Render initial history
  renderHistory();
};

window.deleteAbsence = function(absenceId) {
  if (!appState.absences) appState.absences = [];
  appState.absences = appState.absences.filter(a => a.id !== absenceId);
  if (typeof autoSave === 'function') autoSave();
  // Re-render the history modal if it's open
  const modal = document.getElementById('absenceHistoryModal');
  if (modal) {
    document.getElementById('absenceHistoryModal').remove();
    openAbsenceHistoryModal();
  } else {
    renderCurrentTab();
  }
  showToast('Absence supprimée', 'success');
};

// Paiements des salariés : voir assets/js/payroll.js (openPayrollPaymentForm, savePayrollPayment, togglePaymentStatus...)

window.toggleEmployeeActive = function(id) {
  const emp = (appState.employees || []).find(e => e.id === id);
  if (!emp) return;
  emp.active = !(emp.active !== false);
  emp.updatedAt = Date.now();
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.deleteEmployee = function(id) {
  if (!confirm('Supprimer cet employé ?')) return;
  const emp = (appState.employees || []).find(e => e.id === id);
  if (emp && typeof logActivity === 'function') logActivity('Employé supprimé', emp.name || emp.login || '');
  appState.employees = (appState.employees || []).filter(e => e.id !== id);
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'employees', id: id });
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  showToast('Employé supprimé', 'info');
};

window.filterClients = function() {
  const search = (document.getElementById('clientSearch')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#clientsTableBody tr');
  rows.forEach(row => {
    row.style.display = row.innerText.toLowerCase().includes(search) ? '' : 'none';
  });
};

window.calculateRedotpayUsd = function() {
  const dzdInput = document.getElementById('redotpayDzdAmount');
  const usdDisplay = document.getElementById('redotpayUsdDisplay');
  if (!dzdInput || !usdDisplay) return;
  const dzd = parseFloat(dzdInput.value) || 0;
  const rate = window.getRedotpayRate ? window.getRedotpayRate() : 250;
  usdDisplay.textContent = `${(dzd / rate).toFixed(2)} $`;
};

window.previewFile = function(input) {
  const preview = document.getElementById('filePreview');
  if (!preview) return;
  if (input?.files && input.files[0]) {
    const file = input.files[0];
    preview.innerHTML = `<p class="text-green-600 font-bold">${escapeHtml(file.name)}</p>`;
  }
};

window.handleOrderSubmit = async function(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Envoi en cours...';
    btn.disabled = true;
  }

  try {
    const platform = document.getElementById('platformSelect')?.value || 'N/A';
    const paymentMethod = document.getElementById('paymentMethodSelect')?.value || 'N/A';
    const token = localStorage.getItem('clientToken') || generateId('client_token');
    if (!localStorage.getItem('clientToken')) localStorage.setItem('clientToken', token);

    const orderData = {
      id: 'REQ-' + Date.now(),
      date: getLocalDateString(),
      read: false,
      processed: false,
      platform,
      paymentMethod,
      paymentProof: null,
      status: 'pending',
      clientToken: token
    };

    if (platform === 'meta') {
      orderData.metaObjective = document.getElementById('metaObjective')?.value;
      const followersTarget = document.querySelector('input[name="metaFollowersTarget"]:checked');
      if (followersTarget) orderData.metaFollowersTarget = followersTarget.value;
      const messagesTarget = document.querySelectorAll('input[name="metaMsgTarget"]:checked');
      if (messagesTarget.length > 0) {
        orderData.metaMessagesTarget = Array.from(messagesTarget).map(cb => cb.value).join(', ');
      }
    } else if (platform === 'tiktok') {
      orderData.tiktokObjective = document.getElementById('tiktokObjective')?.value;
      const tiktokMsg = document.querySelector('input[name="tiktokMsgTarget"]:checked');
      if (tiktokMsg) orderData.tiktokMsgTarget = tiktokMsg.value;
    }

    orderData.instagram = document.getElementById('metaInstaName')?.value || '';
    orderData.pageFacebook = document.getElementById('metaFbName')?.value || '';
    orderData.offer = document.getElementById('orderOfferSelect')?.value || '';
    orderData.websiteUrl = document.getElementById('websiteUrl')?.value || '';
    orderData.pubLink = document.getElementById('pubLink')?.value || '';
    orderData.clientNote = document.getElementById('clientNote')?.value || '';

    const proofInput = document.getElementById('paymentProof');
    if (proofInput && proofInput.files && proofInput.files[0]) {
      const file = proofInput.files[0];
      if (file.size > 5 * 1024 * 1024) throw new Error("L'image est trop volumineuse (Max 5MB)");
      if (typeof readFileAsDataURL === 'function') orderData.paymentProof = await readFileAsDataURL(file);
    }

    if (paymentMethod === 'redotpay') {
      const dzdAmount = parseFloat(document.getElementById('redotpayDzdAmount')?.value || 0);
      orderData.paymentDetails = {
        method: 'RedotPay',
        dzdAmount,
        usdToSend: dzdAmount / (window.getRedotpayRate ? window.getRedotpayRate() : 250)
      };
    }

    if (!appState.clientRequests) appState.clientRequests = [];
    appState.clientRequests.push(orderData);
    if (typeof autoSave === 'function') autoSave();

    showToast('Commande envoyée avec succès !', 'success');
    e.target.reset();
    const filePreview = document.getElementById('filePreview');
    if (filePreview) filePreview.innerHTML = '';
  } catch (error) {
    console.error('Erreur commande:', error);
    showToast(error?.message || "Erreur lors de l'envoi de la commande", 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
};

// Local Backup Logic
window.exportLocalBackup = function() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href",     dataStr);
  downloadAnchorNode.setAttribute("download", "sponsor_hichem_backup_" + getLocalDateString() + ".json");
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  showToast('Sauvegarde locale téléchargée !', 'success');
};

window.importLocalBackup = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const result = JSON.parse(e.target.result);
      if (typeof result === 'object' && result !== null) {
        // Merge with current state or replace? Replace makes more sense for a backup restore
        // Ces clés décrivent la session / l'état technique de CET appareil : elles ne font pas partie des données
        const SKIP = new Set(['session', 'sync', 'ui', 'adminUid', 'currentTab', 'balances']);
        Object.keys(result).forEach(key => {
          if (SKIP.has(key)) return;
          appState[key] = Array.isArray(result[key]) && typeof filterSafeDocs === 'function' ? filterSafeDocs(result[key], key) : result[key];
        });
        if (typeof autoSave === 'function') autoSave();
        if (typeof renderTables === 'function') renderTables();
        showToast('Sauvegarde restaurée avec succès !', 'success');
      } else {
        throw new Error("Format JSON invalide");
      }
    } catch (err) {
      console.error("Erreur d'importation:", err);
      showToast('Erreur lors de la lecture du fichier', 'error');
    }
    // reset input
    event.target.value = '';
  };
  reader.readAsText(file);
};

window.deleteTransaction = function(id) {
  if(!confirm('Êtes-vous sûr de vouloir supprimer cette transaction ?')) return;
  const t = appState.transactions.find(x => x.id === id);
  if (t && t.clientId) {
      const client = appState.clients.find(c => c.id === t.clientId);
      if (client) client.updatedAt = Date.now();
  }
  if (!appState.sync) appState.sync = {};
  if (!appState.sync.pendingDeletions) appState.sync.pendingDeletions = [];
  appState.sync.pendingDeletions.push({ col: 'transactions', id: id });
  
  appState.transactions = appState.transactions.filter(tx => tx.id !== id);
  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof renderTables === 'function') renderTables();
  if (typeof autoSave === 'function') autoSave();
  showToast('Transaction supprimée', 'info');
};

window.editTransaction = function(id) {
  const t = appState.transactions.find(x => x.id === id);
  if (!t) { showToast('Transaction introuvable', 'error'); return; }
  
  document.getElementById('editTxId').value = id;
  document.getElementById('editTxDate').value = t.date || '';
  document.getElementById('editTxAmount').value = t.amount || 0;
  document.getElementById('editTxPrice').value = t.priceDzd || 0;
  document.getElementById('editTxDuration').value = t.duration || '';
  document.getElementById('editTxPaid').checked = !!t.paid;
  
  const adAccountSelect = document.getElementById('editTxAdAccountId');
  if (adAccountSelect) {
      adAccountSelect.innerHTML = '<option value="">-- Aucun compte (Organique) --</option>' + 
          (appState.adAccounts || []).map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.platform)})</option>`).join('');
      adAccountSelect.value = t.adAccountId || '';
  }
  
  openModal('editTransactionModal');
};

window.saveEditTransaction = function() {
  const id = document.getElementById('editTxId').value;
  const t = appState.transactions.find(x => x.id === id);
  if (!t) return;
  
  const amount = Number(document.getElementById('editTxAmount').value || 0);
  const priceDzd = Number(document.getElementById('editTxPrice').value || 0);
  const dateStr = document.getElementById('editTxDate').value || t.date;
  const durationStr = document.getElementById('editTxDuration').value || '';
  const paid = document.getElementById('editTxPaid').checked;
  const adAccountId = document.getElementById('editTxAdAccountId')?.value || null;

  if (!amount || !priceDzd) { showToast('Valeurs invalides', 'error'); return; }
  
  const oldPrice = t.priceDzd || 0;
  const oldPaid = !!t.paid;
  
  const buyRateGuess = t.buyRate || (t.amount ? (Number(t.totalDzd || 0) / Number(t.amount || 1)) : Number(document.getElementById('buyRate')?.value || 0));
  const totalDzd = amount * Number(buyRateGuess || 0);
  const profit = priceDzd - totalDzd;
  
  if (t.clientId) {
      const client = appState.clients.find(c => c.id === t.clientId);
      if (client) {
          client.totalSpent = (client.totalSpent || 0) - oldPrice + priceDzd;
          
          if (!oldPaid) adjustClientUnpaid(client, -oldPrice);
          if (!paid) adjustClientUnpaid(client, priceDzd);
          
          client.updatedAt = Date.now();
      }
  }

  Object.assign(t, { 
      amount, 
      priceDzd, 
      totalDzd, 
      profit, 
      date: dateStr,
      duration: durationStr, 
      paid,
      adAccountId,
      updatedAt: Date.now() 
  });

  if (typeof recalculateFinanceBalances === 'function') recalculateFinanceBalances();
  if (typeof renderTables === 'function') renderTables();
  if (typeof autoSave === 'function') autoSave();
  closeModal('editTransactionModal');
  showToast('Transaction mise à jour', 'success');
};

window.toggleUsdFilter = function(checked) {
  const ui = getUiState();
  ui.filters['expenses_usdOnly'] = checked;
  ui.pages['expenses'] = 1;
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
};

window.filterClientOptions = function(query) {
  const dropdown = document.getElementById('clientDropdown');
  if (!dropdown) return;
  const options = dropdown.querySelectorAll('.client-option');
  const q = query.toLowerCase();
  let visibleCount = 0;
  options.forEach(opt => {
    const name = (opt.dataset.name || '').toLowerCase();
    if (name.includes(q) || q === '') {
      opt.style.display = 'block';
      visibleCount++;
    } else {
      opt.style.display = 'none';
    }
  });
  if (visibleCount > 0) {
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
};

window.selectClient = function(el) {
  const id = el.dataset.id;
  const name = el.dataset.name;
  const hiddenInput = document.getElementById('todoClientId');
  const searchInput = document.getElementById('todoClientSearch');
  const dropdown = document.getElementById('clientDropdown');
  if (hiddenInput) hiddenInput.value = id;
  if (searchInput) searchInput.value = name;
  if (dropdown) dropdown.style.display = 'none';
  document.querySelectorAll('.client-option').forEach(o => o.classList.remove('selected'));
  if (el) el.classList.add('selected');
};

document.addEventListener('click', function(e) {
  const search = document.getElementById('todoClientSearch');
  const dropdown = document.getElementById('clientDropdown');
  if (search && dropdown) {
    if (!search.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  }
});

// ==========================================
// OCR NOTEBOOK SCANNER
// ==========================================

let pendingOcrSponsors = [];

window.openOcrCamera = function() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Camera non disponible', 'error');
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      const canvas = document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.top = '50%';
      canvas.style.left = '50%';
      canvas.style.transform = 'translate(-50%, -50%)';
      canvas.style.zIndex = '9999';
      canvas.style.borderRadius = '20px';
      canvas.style.boxShadow = '0 20px 60px rgba(0,0,0,0.5)';
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        setTimeout(() => {
          stream.getTracks().forEach(track => track.stop());
          document.body.removeChild(canvas);
          canvas.toBlob(blob => {
            const file = new File([blob], 'carnet.jpg', { type: 'image/jpeg' });
            handleOcrFileSelect({ files: [file], target: { value: '' } });
          });
        }, 1500);
      };
    })
    .catch(err => {
      console.error('Camera error:', err);
      showToast('Erreur camera', 'error');
    });
};

window.handleOcrFileSelect = function(input) {
  const file = input.files[0];
  if (!file) return;
  
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image trop grande (max 10MB)', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('ocrPreviewImage').src = e.target.result;
    document.getElementById('ocrUploadSection').classList.add('hidden');
    document.getElementById('ocrPreviewSection').classList.remove('hidden');
    document.getElementById('ocrResultsSection').classList.add('hidden');
    processOcrImage(e.target.result);
  };
  reader.readAsDataURL(file);
};

async function processOcrImage(imageSrc) {
  const progressSection = document.getElementById('ocrProgress');
  const progressBar = document.getElementById('ocrProgressBar');
  const progressText = document.getElementById('ocrProgressText');
  
  progressSection.classList.remove('hidden');
  progressText.textContent = 'Analyse OCR en cours...';
  progressBar.style.width = '10%';
  
  try {
    const result = await Tesseract.recognize(imageSrc, 'fra+ara', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const percent = Math.round(m.progress * 100);
          progressBar.style.width = percent + '%';
          progressText.textContent = `Analyse en cours... ${percent}%`;
        }
      },
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789àâäéèêëîïôöùûüçÿœæÀÂÄÉÈÊËÎÏÔÖÙÛÜÇŸŒÆ\' -,.✓✔☑✗VvWwXx',
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '3', // Auto page segmentation
      tessedit_ocr_engine_mode: '2' // LSTM engine only (better for modern text)
    });
    
    progressBar.style.width = '100%';
    progressText.textContent = 'Analyse terminée !';
    
    const text = result.data.text;
    
    // Afficher le texte brut OCR
    document.getElementById('ocrRawText').textContent = text || '(vide)';
    
    pendingOcrSponsors = parseNotebookText(text);
    
    setTimeout(() => {
      progressSection.classList.add('hidden');
      document.getElementById('ocrResultsSection').classList.remove('hidden');
      displayOcrResults(pendingOcrSponsors);
    }, 500);
    
  } catch (err) {
    console.error('OCR Error:', err);
    progressSection.classList.add('hidden');
    showToast('Erreur lors de l\'analyse de l\'image', 'error');
  }
}

function parseNotebookText(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const sponsors = [];
  const existingClients = appState.clients || [];
  const offers = appState.offers || [];
  
  // Pattern plus flexible pour les montants : 3-6 chiffres, avec ou sans séparateurs, avec ou sans DA/DZD
  const amountPattern = /(\d[\d\s,.]{2,8})\s*(?:da|dzd|dz|€|\$)?/i;
  
  for (const line of lines) {
    
    // Compte les checks (✓, ✔, ☑, et 'W' que Tesseract détecte souvent)
    let checkCount = 0;
    const checkChars = ['✓', '✔', '☑', '✗', 'W', 'w', 'V', 'v', 'X', 'x'];
    for (const char of line) {
      if (checkChars.includes(char)) {
        checkCount++;
      }
    }
    
    // Pas de restriction sur les checks pour l'instant (pour test)
    
    // Nettoyer la ligne en enlevant les checks et caractères spéciaux
    let cleanLine = line;
    for (const char of checkChars) {
      cleanLine = cleanLine.split(char).join('');
    }
    cleanLine = cleanLine.trim();
    
    const amountMatch = cleanLine.match(amountPattern);
    if (!amountMatch) {
      continue;
    }
    
    // Extraire le montant : enlever espaces, virgules, points
    let amountStr = amountMatch[1].replace(/[\s,.]/g, '');
    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount < 100) {
      continue;
    }
    
    let name = cleanLine.replace(amountPattern, '').trim();
    name = name.replace(/[^\p{L}\s\p{N}'-]/gu, '').trim();
    name = name.replace(/\s+/g, ' ').trim(); // Remplace multiples espaces par un seul
    
    if (!name || name.length < 2) {
      continue;
    }
    
    // Payé si 2 checks ou plus
    const paid = checkCount >= 2;
    
    // Recherche client améliorée
    let matchedClient = existingClients.find(c => {
      if (!c.name) return false;
      const cName = c.name.toLowerCase().trim();
      const nName = name.toLowerCase().trim();
      return cName.includes(nName) || nName.includes(cName);
    });
    
    let matchedOffer = offers.find(o => {
      if (!o.priceDzd && !o.price) return false;
      const price = o.priceDzd || o.price;
      return Math.abs(price - amount) < 100;
    });
    
    if (!matchedOffer && amount > 0) {
      const similarOffer = offers.find(o => {
        if (!o.priceDzd && !o.price) return false;
        const price = o.priceDzd || o.price;
        return Math.abs(price - amount) < 500;
      });
      if (similarOffer) matchedOffer = { ...similarOffer, custom: true };
    }
    
    sponsors.push({
      name,
      amount,
      paid,
      checkCount,
      clientId: matchedClient ? matchedClient.id : null,
      clientFound: !!matchedClient,
      offerId: matchedOffer ? matchedOffer.id : null,
      offer: matchedOffer,
      offerNeeded: !matchedOffer,
      needsNewClient: !matchedClient,
      needsNewOffer: !matchedOffer
    });
  }
  
  return sponsors;
}

function displayOcrResults(sponsors) {
  const container = document.getElementById('ocrDetectedSponsors');
  
  if (sponsors.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-search text-4xl mb-3"></i><p>Aucun sponsor détecté</p><p class="text-sm mt-2">Clique sur "Ajouter un sponsor manuellement" pour commencer</p></div>';
    return;
  }
  
  container.innerHTML = sponsors.map((s, i) => {
    const statusIcon = s.paid ? 'fa-check-circle text-green-500' : 'fa-clock text-yellow-500';
    const statusText = s.paid ? 'Payé' : 'Non payé';
    const clientBadge = s.clientFound ? '<span class="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full">Client existant</span>' : '<span class="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full">Nouveau client</span>';
    const offerBadge = s.offerNeeded ? '<span class="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-full">Offre personnalisée</span>' : '';
    const checksDisplay = s.checkCount ? `<span class="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">✓ x${s.checkCount}</span>` : '';
    
    return `
      <div class="p-4 border rounded-2xl ${s.needsNewClient || s.offerNeeded ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50'}">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas ${statusIcon}"></i>
              <span class="font-bold text-gray-800">${escapeHtml(s.name)}</span>
              <span class="font-bold text-indigo-600">${s.amount.toLocaleString()} DA</span>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              ${clientBadge}
              ${offerBadge}
              ${checksDisplay}
            </div>
            ${s.needsNewClient ? '<p class="text-xs text-red-600 mt-1"><i class="fas fa-exclamation-triangle mr-1"></i>Client non trouvé - À créer</p>' : ''}
            ${s.offerNeeded ? '<p class="text-xs text-orange-600 mt-1"><i class="fas fa-tag mr-1"></i>Offre non reconnue - À configurer</p>' : ''}
          </div>
          <div class="flex flex-col items-end gap-2">
            <span class="text-xs ${s.paid ? 'text-green-600' : 'text-yellow-600'} font-medium">${statusText}</span>
            <button onclick="deleteSponsorFromList(${i})" class="text-red-500 hover:text-red-700 text-sm">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.deleteSponsorFromList = function(index) {
  pendingOcrSponsors.splice(index, 1);
  displayOcrResults(pendingOcrSponsors);
  showToast('Sponsor supprimé', 'info');
};

window.resetOcrScanner = function() {
  document.getElementById('ocrUploadSection').classList.remove('hidden');
  document.getElementById('ocrPreviewSection').classList.add('hidden');
  document.getElementById('ocrResultsSection').classList.add('hidden');
  document.getElementById('ocrFileInput').value = '';
  document.getElementById('ocrPreviewImage').src = '';
  pendingOcrSponsors = [];
};

window.confirmOcrSponsors = async function() {
  const needsNewClient = pendingOcrSponsors.some(s => s.needsNewClient);
  const needsNewOffer = pendingOcrSponsors.some(s => s.offerNeeded);
  
  if (needsNewClient) {
    const firstNew = pendingOcrSponsors.find(s => s.needsNewClient);
    document.getElementById('ocrClientName').value = firstNew.name;
    document.getElementById('ocrNewClientName').value = firstNew.name;
    closeModal('ocrScannerModal');
    openModal('newClientFromOcrModal');
    return;
  }
  
  if (needsNewOffer) {
    const firstNewOffer = pendingOcrSponsors.find(s => s.offerNeeded);
    document.getElementById('ocrOfferIndex').value = pendingOcrSponsors.indexOf(firstNewOffer);
    document.getElementById('ocrCustomOfferName').value = '';
    document.getElementById('ocrCustomOfferPrice').value = firstNewOffer.amount;
    document.getElementById('ocrCustomOfferDuration').value = '';
    closeModal('ocrScannerModal');
    openModal('customOfferFromOcrModal');
    return;
  }
  
  await createOcrSponsorsDirect();
};

async function createOcrSponsorsDirect() {
  const today = new Date().toISOString().split('T')[0];
  const todosToCreate = [];
  const txToCreate = [];
  
  for (const sponsor of pendingOcrSponsors) {
    if (!sponsor.clientId || !sponsor.offerId) continue;
    
    todosToCreate.push({
      id: generateId('todo'),
      clientId: sponsor.clientId,
      offerId: sponsor.offerId,
      adAccountId: null,
      date: today,
      status: sponsor.paid ? 'completed' : 'pending',
      paid: sponsor.paid,
      priceDzd: sponsor.amount,
      notes: 'Créé via scanner carnet',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    
    txToCreate.push({
      id: generateId('tx'),
      clientId: sponsor.clientId,
      offerId: sponsor.offerId,
      adAccountId: null,
      amount: 1,
      priceDzd: sponsor.amount,
      duration: sponsor.offer?.duration || '',
      date: today,
      buyRate: (typeof getBuyRate === 'function') ? Number(getBuyRate()) || undefined : undefined,
      paid: sponsor.paid,
      offerName: sponsor.offer?.name || 'Offre custom',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  
  if (!appState.todoTransactions) appState.todoTransactions = [];
  if (!appState.transactions) appState.transactions = [];
  
  appState.todoTransactions.push(...todosToCreate);
  appState.transactions.push(...txToCreate);
  
  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();
  
  showToast(`${pendingOcrSponsors.length} sponsor(s) créé(s) !`, 'success');
  resetOcrScanner();
  closeModal('ocrScannerModal');
}

window.saveClientFromOcr = function() {
  const clientName = document.getElementById('ocrNewClientName').value.trim();
  const page = document.getElementById('ocrNewClientPage').value.trim();
  const whatsapp = document.getElementById('ocrNewClientWhatsapp').value.trim();
  const city = document.getElementById('ocrNewClientCity').value.trim();
  const platform = document.getElementById('ocrNewClientPlatform').value;
  
  if (!clientName) {
    showToast('Nom du client requis', 'error');
    return;
  }
  
  const newClient = {
    id: generateId('client'),
    name: clientName,
    page: page,
    whatsapp: whatsapp,
    city: city,
    platform: platform,
    paid: 0,
    unpaid: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  if (!appState.clients) appState.clients = [];
  appState.clients.push(newClient);
  
  const clientIndex = pendingOcrSponsors.findIndex(s => s.name.toLowerCase() === clientName.toLowerCase());
  if (clientIndex !== -1) {
    pendingOcrSponsors[clientIndex].clientId = newClient.id;
    pendingOcrSponsors[clientIndex].clientFound = true;
    pendingOcrSponsors[clientIndex].needsNewClient = false;
  }
  
  closeModal('newClientFromOcrModal');
  openModal('ocrScannerModal');
  displayOcrResults(pendingOcrSponsors);
  
  if (typeof autoSave === 'function') autoSave();
  showToast('Client créé !', 'success');
  
  const stillNeedsClient = pendingOcrSponsors.some(s => s.needsNewClient);
  const stillNeedsOffer = pendingOcrSponsors.some(s => s.offerNeeded);
  
  if (!stillNeedsClient && !stillNeedsOffer) {
    confirmOcrSponsors();
  } else if (stillNeedsClient) {
    const nextNew = pendingOcrSponsors.find(s => s.needsNewClient);
    document.getElementById('ocrClientName').value = nextNew.name;
    document.getElementById('ocrNewClientName').value = nextNew.name;
    closeModal('ocrScannerModal');
    openModal('newClientFromOcrModal');
  }
};

window.saveCustomOfferFromOcr = function() {
  const name = document.getElementById('ocrCustomOfferName').value.trim();
  const price = parseInt(document.getElementById('ocrCustomOfferPrice').value) || 0;
  const duration = document.getElementById('ocrCustomOfferDuration').value.trim();
  const desc = document.getElementById('ocrCustomOfferDesc').value.trim();
  
  if (!name || price <= 0) {
    showToast('Nom et prix de l\'offre requis', 'error');
    return;
  }
  
  const newOffer = {
    id: generateId('offer'),
    name: name,
    description: desc,
    priceDzd: price,
    costPerUnit: 0,
    duration: duration,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  if (!appState.offers) appState.offers = [];
  appState.offers.push(newOffer);
  
  const offerIdx = parseInt(document.getElementById('ocrOfferIndex').value);
  if (!isNaN(offerIdx) && pendingOcrSponsors[offerIdx]) {
    pendingOcrSponsors[offerIdx].offerId = newOffer.id;
    pendingOcrSponsors[offerIdx].offer = newOffer;
    pendingOcrSponsors[offerIdx].offerNeeded = false;
  }
  
  for (const sponsor of pendingOcrSponsors) {
    if (sponsor.offerNeeded && sponsor.amount === price) {
      sponsor.offerId = newOffer.id;
      sponsor.offer = newOffer;
      sponsor.offerNeeded = false;
      break;
    }
  }
  
  closeModal('customOfferFromOcrModal');
  openModal('ocrScannerModal');
  displayOcrResults(pendingOcrSponsors);
  
  if (typeof autoSave === 'function') autoSave();
  showToast('Offre créée !', 'success');
  
  const stillNeedsOffer = pendingOcrSponsors.some(s => s.offerNeeded);
  if (!stillNeedsOffer) {
    confirmOcrSponsors();
  }
};

window.addManualSponsor = function() {
  // Réinitialiser les champs
  document.getElementById('manualSponsorName').value = '';
  document.getElementById('manualSponsorAmount').value = '';
  document.getElementById('manualSponsorPaid').checked = false;
  
  closeModal('ocrScannerModal');
  openModal('manualSponsorModal');
};

window.saveManualSponsor = function() {
  const name = document.getElementById('manualSponsorName').value.trim();
  const amount = parseInt(document.getElementById('manualSponsorAmount').value) || 0;
  const paid = document.getElementById('manualSponsorPaid').checked;
  
  if (!name || amount <= 0) {
    showToast('Nom et montant requis', 'error');
    return;
  }
  
  const existingClients = appState.clients || [];
  const offers = appState.offers || [];
  
  // Recherche client
  let matchedClient = existingClients.find(c => {
    if (!c.name) return false;
    const cName = c.name.toLowerCase().trim();
    const nName = name.toLowerCase().trim();
    return cName.includes(nName) || nName.includes(cName);
  });
  
  // Recherche offre
  let matchedOffer = offers.find(o => {
    if (!o.priceDzd && !o.price) return false;
    const price = o.priceDzd || o.price;
    return Math.abs(price - amount) < 100;
  });
  
  if (!matchedOffer && amount > 0) {
    const similarOffer = offers.find(o => {
      if (!o.priceDzd && !o.price) return false;
      const price = o.priceDzd || o.price;
      return Math.abs(price - amount) < 500;
    });
    if (similarOffer) matchedOffer = { ...similarOffer, custom: true };
  }
  
  pendingOcrSponsors.push({
    name,
    amount,
    paid,
    checkCount: paid ? 2 : 1,
    clientId: matchedClient ? matchedClient.id : null,
    clientFound: !!matchedClient,
    offerId: matchedOffer ? matchedOffer.id : null,
    offer: matchedOffer,
    offerNeeded: !matchedOffer,
    needsNewClient: !matchedClient,
    needsNewOffer: !matchedOffer
  });
  
  closeModal('manualSponsorModal');
  openModal('ocrScannerModal');
  displayOcrResults(pendingOcrSponsors);
  
  showToast('Sponsor ajouté !', 'success');
};

// === HANDLERS PERFORMANCE SALARIÉS ===
window.addEmployeePerformance = function() {
  const employeeId = document.getElementById('perf-employee').value;
  const tasks = Number(document.getElementById('perf-tasks').value);
  const date = document.getElementById('perf-date').value;

  if (!employeeId || tasks <= 0 || !date) {
    showToast('Veuillez remplir tous les champs', 'error');
    return;
  }

  // Add tasks as individual transactions
  for (let i = 0; i < tasks; i++) {
    const txEntry = {
      id: 'tx-emp-' + Date.now() + '-' + i,
      date: date,
      employeeId: employeeId,
      createdAt: Date.now()
    };

    if (!appState.transactions) appState.transactions = [];
    appState.transactions.push(txEntry);
  }

  if (typeof autoSave === 'function') autoSave();
  if (typeof renderCurrentTab === 'function') renderCurrentTab();

  showToast(tasks + ' tâche(s) ajoutée(s) !', 'success');
};

window.exportPerformanceCSV = function() {
  const employees = appState.employees || [];
  const txs = appState.transactions || [];
  const config = (typeof getPerformanceConfig === 'function') ? getPerformanceConfig() : (appState.performanceConfig || {
    ratePerTask: 1700,
    fixedCosts: {
      salary: 40000,
      internet: 3000,
      pub: 20000,
      risque: 15000
    }
  });

  function calculPrime(gain) {
    if (typeof getPrimeForGain === 'function') return getPrimeForGain(gain);
    if (gain >= 350000) return 12000;
    if (gain >= 250000) return 8000;
    if (gain >= 150000) return 5000;
    return 0;
  }

  // Get counts by employee
  const counts = {};
  txs.forEach(tx => {
    const id = tx.employeeId || 'unassigned';
    counts[id] = (counts[id] || 0) + 1;
  });

  const rows = Object.keys(counts).map(id => {
    const emp = employees.find(e => e.id === id);
    const tasks = counts[id];
    const gain = tasks * config.ratePerTask;
    const share = gain * 0.3;
    const prime = calculPrime(gain);
    const net = gain
      - config.fixedCosts.salary
      - config.fixedCosts.internet
      - config.fixedCosts.pub
      - config.fixedCosts.risque
      - prime;

    return {
      name: emp ? emp.name : 'Non attribué',
      tasks,
      gain,
      share,
      prime,
      net
    };
  }).sort((a, b) => b.gain - a.gain);

  let csv = "Nom,Tâches,Gain Société,Valeur 30%,Prime,Bénéfice Net\n";
  rows.forEach(p => {
    csv += `${p.name},${p.tasks},${p.gain},${Math.round(p.share)},${p.prime},${p.net}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'performance_salaries.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('Export CSV terminé !', 'success');
};



