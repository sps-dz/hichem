// === CALCULATIONS.JS ===

/**
 * Calcule le solde théorique basé sur l'historique
 */
window.calculateTheoreticalBalance = function() {
  let liq = 0;
  let bar = 0;
  let usdt = 0;

  // 1. Entrées (Paiements explicites)
  (appState.payments || []).forEach(p => {
      const amt = Number(p.amount || 0);
      const method = (p.method || '').toLowerCase();
      const account = p.account || (method === 'baridimob' ? 'baridimob' : (method === 'usdt' ? 'usdt' : 'liquide'));
      
      if (account === 'baridimob') bar += amt;
      else if (account === 'usdt') {
          const rate = getRedotpayRate();
          usdt += (amt / rate);
      }
      else liq += amt;
  });

  // 1.5. Entrées implicites (Transactions marquées 'Payée' directement lors de la création)
  (appState.transactions || []).forEach(t => {
      // Les transactions "Problème" ne sont pas comptées
      if (t.status === 'problem') return;
      
      if (t.paid && t.paidAccount !== 'avance') {   // « avance du client » : l'argent est déjà dans la caisse via le paiement
          // L'argent d'une transaction marquée payée va dans le compte choisi
          // (liquide par défaut si non précisé, pour compatibilité avec les
          // anciennes transactions créées avant l'ajout de cette option).
          const acc = t.paidAccount || 'liquide';
          const amt = Number(t.priceDzd || 0);
          if (acc === 'baridimob') bar += amt;
          else if (acc === 'usdt') {
              const rate = getRedotpayRate();
              usdt += (amt / rate);
          } else {
              liq += amt;
          }
      }
  });

  // 2. Sorties (Dépenses)
  (appState.expenses || []).forEach(e => {
      const amt = Number(e.amount || 0);
      const account = e.account || 'liquide';
      
      if (account === 'baridimob') bar -= amt;
      else if (account === 'usdt') {
          const rate = getRedotpayRate();
          usdt -= (amt / rate);
      }
      else liq -= amt;
  });

  // 3. Achats USD (DZD -> USDT)
  (appState.usdPurchases || []).forEach(u => {
      const dzdAmt = Number(u.totalDzd || 0);
      const usdtAmt = Number(u.amount || 0);
      const dzdAccount = u.dzdAccount || 'liquide';
      
      if (dzdAccount === 'baridimob') bar -= dzdAmt;
      else liq -= dzdAmt;
      
      usdt += usdtAmt;
  });

  // 4. Ventes USD (Transactions) - Diminue le stock USDT global
  (appState.transactions || []).forEach(t => {
      // Les transactions validées consomment toujours de l'USD (du compte de facturation général ou spécifique)
      if (t.status === 'active' || !t.status) { // Include normal past transactions that didn't have 'status'
        const usdtAmt = Number(t.amount || 0);
        usdt -= usdtAmt;
        // NB : le total dépensé par compte pub (adAcc.spent) n'est plus modifié ici. Cette fonction est
        // appelée très souvent ; y cumuler 'spent' le faisait dériver et provoquait des écritures cloud
        // inutiles. L'écran « Comptes Pub » le recalcule lui-même à chaque affichage.
      }
  });

  // 5. Dépenses USDT
  (appState.usdtExpenses || []).forEach(e => {
      const usdtAmt = Number(e.amount || 0);
      usdt -= usdtAmt;
  });

  return { liquide: liq, baridimob: bar, usdt: usdt };
};

/**
 * Recalcule les soldes finaux (Théorique + Ajustements manuels)
 */
window.recalculateFinanceBalances = function() {
  const manual = appState.manualBalances || { liquide: 0, baridimob: 0, usdt: 0 };
  const theoretical = calculateTheoreticalBalance();

  const balances = { 
    liquide: theoretical.liquide + Number(manual.liquide || 0), 
    baridimob: theoretical.baridimob + Number(manual.baridimob || 0), 
    usdt: theoretical.usdt + Number(manual.usdt || 0) 
  };

  appState.balances = balances;
};

/**
 * Calcule le profit d'une transaction
 */
// Taux d'achat USD applicable à une vente : le taux figé au moment de la vente s'il existe
// (nouvelles ventes), sinon le taux global actuel (anciennes ventes : comportement inchangé).
window.getTransactionBuyRate = function(t) {
  const own = Number(t && t.buyRate);
  if (Number.isFinite(own) && own > 0) return own;
  return getLegacyBuyRate();
};
// Taux appliqué aux anciennes ventes enregistrées sans taux : figé une fois pour toutes (au premier calcul après chargement
// des réglages), pour qu'un changement du taux du jour ne modifie plus les bénéfices des mois passés.
window.getLegacyBuyRate = function() {
  try {
    if (window.ExtStore && appState && appState.globalConfig && appState.globalConfig.rates) {
      let lr = Number(ExtStore.get('legacyBuyRate', 0));
      if (!(lr > 0)) { lr = Number(getBuyRate()) || 255; ExtStore.set('legacyBuyRate', lr, true); }
      return lr;
    }
  } catch (e) {}
  return typeof getBuyRate === 'function' ? getBuyRate() : 255;
};

window.calculateTransactionProfit = function(amount, priceDzd, buyRate) {
  const costDzd = amount * buyRate;
  return priceDzd - costDzd;
};

function parseYmd(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function inRangeYmd(ymd, start, end) {
  const d = parseYmd(ymd);
  if (!d) return false;
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  x.setDate(x.getDate() - day); // subtract day to get to Sunday
  return x;
}

function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return e;
}

function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(0, 0, 0, 0);
  return x;
}


// ---------------------------------------------------------------------------------------------
// Éléments du résultat d'une période — UNE seule définition partagée par tous les écrans
// (tableau de bord, Ma finance, Comptabilité, Clôtures, Pilotage, PDF).
//  • CA = ventes validées (hors « problème », hors tâches de Performance) + versements studio / shooting reçus
//  • Coût = dollars de chaque vente × son taux d'achat figé
//  • Frais = frais saisis (dont salaires liés à la paie) + salaires payés sans frais lié (jamais deux fois)
//  • Dépenses USDT = coût enregistré (costDzd) sinon dollars × taux d'achat figé de la dépense ; rattachées à leur mois
// ---------------------------------------------------------------------------------------------
function _isSaleRow(t) { return t && t.date && t.status !== 'problem' && !/^tx-emp-/.test(String(t.id || '')); }
function _profitParts(start, end, splitRecurring) {
  const legacy = (typeof getLegacyBuyRate === 'function') ? getLegacyBuyRate() : 255;
  let revenue = 0, cost = 0, txCount = 0, studioRevenue = 0, expenses = 0, oneTime = 0, recurringPaid = 0, salariesUnlinked = 0, usdtExpensesDzd = 0;
  (appState.transactions || []).forEach(t => {
    if (!_isSaleRow(t) || !inRangeYmd(t.date, start, end)) return;
    const price = Number(t.priceDzd || 0), amt = Number(t.amount || 0);
    revenue += Number.isFinite(price) ? price : 0;
    cost += (Number.isFinite(amt) ? amt : 0) * getTransactionBuyRate(t);
    if (price > 0) txCount += 1;
  });
  const S = window.ExtStore;
  if (S) ['studioBookings', 'productShoots'].forEach(k => (S.list(k) || []).forEach(r => (r && r.payments || []).forEach(p => {
    if (p && inRangeYmd(p.date, start, end)) studioRevenue += Number(p.amount || 0) || 0;
  })));
  revenue += studioRevenue;
  const linked = {};
  (appState.expenses || []).forEach(e => {
    if (!e) return;
    if (e.payrollPaymentId) linked[e.payrollPaymentId] = 1;
    if (/^exp_pay_/.test(String(e.id || ''))) linked[String(e.id).slice(8)] = 1;
    if (!e.date || !inRangeYmd(e.date, start, end)) return;
    const amt = Number.isFinite(Number(e.amount)) ? Number(e.amount) : 0;
    expenses += amt;
    if (e.recurringGenerated) recurringPaid += amt; else oneTime += amt;
  });
  (appState.employeePayments || []).forEach(p => {
    if (!p || !p.paid || linked[p.id] || !(Number(p.amount) > 0) || !p.date || !inRangeYmd(p.date, start, end)) return;
    salariesUnlinked += Number(p.amount);
  });
  expenses += salariesUnlinked; oneTime += salariesUnlinked;
  (appState.usdtExpenses || []).forEach(e => {
    if (!e) return;
    const when = /^\d{4}-\d{2}$/.test(String(e.month || '')) ? e.month + '-01' : e.date;   // rattachée au mois concerné
    if (!when || !inRangeYmd(when, start, end)) return;
    const c = Number(e.costDzd);
    usdtExpensesDzd += (Number.isFinite(c) && c > 0) ? c : (Number(e.amount || 0) || 0) * (Number(e.buyRate) > 0 ? Number(e.buyRate) : legacy);
  });
  return { revenue, cost, txCount, studioRevenue, expenses, oneTime, recurringPaid, salariesUnlinked, usdtExpensesDzd };
}

window.getProfitSummaryYmd = function(fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return null;
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;

  const P = _profitParts(start, end);
  const revenue = P.revenue, cost = P.cost, expenses = P.expenses, usdtExpensesDzd = P.usdtExpensesDzd, txCount = P.txCount, studioRevenue = P.studioRevenue;
  const grossProfit = revenue - cost;
  const netProfit = grossProfit - expenses - usdtExpensesDzd;

  return { revenue, cost, expenses, usdtExpensesDzd, grossProfit, netProfit, txCount, studioRevenue, fromYmd, toYmd };
};

/**
 * Nombre de jours (inclusif) couverts par une période Ymd -> Ymd.
 */
function daysBetweenYmdInclusive(fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return 0;
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Résumé de rentabilité "comptable" (comptabilité d'engagement / accrual) sur une période.
 *
 * Différence avec getProfitSummaryYmd (vue caisse) :
 * - Le CA et le coût des ventes sont déjà reconnus au jour de la vente dans les deux vues (pas de changement).
 * - Les charges ponctuelles (frais isolés, achats USD dépensés, etc.) restent comptées le jour où elles sont
 *   engagées, comme en caisse.
 * - Les CHARGES FIXES RÉCURRENTES (salaires, loyer, internet...) ne sont plus comptées en bloc le jour du
 *   prélèvement : elles sont étalées au prorata sur les jours de la période demandée. C'est ce qui évite
 *   qu'une seule journée de paiement écrase artificiellement le profit de ce jour-là, et donne une image
 *   plus fidèle de la rentabilité réelle du business.
 *
 * Ne modifie et ne remplace rien : calculateTheoreticalBalance / recalculateFinanceBalances (soldes réels)
 * et getProfitSummaryYmd (profit caisse, utilisé pour les soldes/trésorerie) restent inchangés.
 */
window.getAccrualProfitSummaryYmd = function(fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return null;
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;

  const days = daysBetweenYmdInclusive(fromYmd, toYmd) || 1;
  const P = _profitParts(start, end);
  const revenue = P.revenue, cost = P.cost, txCount = P.txCount, oneTimeExpenses = P.oneTime, recurringPaidThisPeriod = P.recurringPaid, usdtExpensesDzd = P.usdtExpensesDzd;

  // Charges fixes étalées au prorata des jours RÉELS de chaque mois (février = 28/29 jours, pas 30)
  const recurringMonthlyTotal = (appState.recurringExpenses || []).reduce((s, r) => s + Number(r && r.amount || 0), 0);
  let accruedRecurring = 0;
  if (recurringMonthlyTotal > 0) {
    const d = new Date(start);
    while (d.getTime() <= end.getTime()) {
      accruedRecurring += recurringMonthlyTotal / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(d.getDate() + 1);
    }
  }

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - oneTimeExpenses - usdtExpensesDzd - accruedRecurring;

  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : null;

  return {
    revenue, cost, grossProfit, oneTimeExpenses, usdtExpensesDzd,
    accruedRecurring, recurringMonthlyTotal, recurringPaidThisPeriod,
    netProfit, txCount, days, grossMarginPct, netMarginPct, fromYmd, toYmd
  };
};

window.getDefaultProfitRanges = function() {
  const now = (typeof getAlgeriaNow === 'function') ? getAlgeriaNow() : new Date();
  now.setHours(0, 0, 0, 0);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    today: { from: toYmd(today), to: toYmd(today) },
    yesterday: { from: toYmd(yesterday), to: toYmd(yesterday) },
    week: { from: toYmd(weekStart), to: toYmd(weekEnd) },
    month: { from: toYmd(monthStart), to: toYmd(monthEnd) }
  };
};
