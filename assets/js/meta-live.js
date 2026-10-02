(() => {
  const LS_TOKEN = 'sponsor_meta_access_token_v1';
  // Version de l'API Meta : centralisée ici (modifiable depuis le panneau, sans toucher au code).
  // v25.0 = version actuellement prise en charge par l'API Marketing (la v19.0 a expiré en 2025).
  const DEFAULT_API_VER = 'v25.0';
  const LS_API_VER = 'sponsor_meta_api_version';
  function _apiVer() {
    try {
      const v = String(localStorage.getItem(LS_API_VER) || '').trim();
      if (/^v\d{2}\.\d$/.test(v)) return v;
    } catch (e) {}
    return DEFAULT_API_VER;
  }
  window.getMetaApiVersion = _apiVer;
  window.setMetaApiVersion = function (v) {
    const val = String(v || '').trim();
    if (val === '') { try { localStorage.removeItem(LS_API_VER); } catch (e) {} } else if (/^v\d{2}\.\d$/.test(val)) { try { localStorage.setItem(LS_API_VER, val); } catch (e) {} } else {
      if (typeof showToast === 'function') showToast('Format attendu : v25.0', 'error');
      return false;
    }
    const lbl = document.getElementById('meta-live-apiver');
    if (lbl) lbl.textContent = _apiVer();
    if (typeof showToast === 'function') showToast('Version API Meta : ' + _apiVer(), 'success');
    return true;
  };
  let _cachedAdAccounts = [];

  function $(id) { return document.getElementById(id); }
  function _fmt(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '0';
    return v.toLocaleString('fr-DZ');
  }
  function _iso(d) { return new Date(d).toISOString().slice(0, 10); }
  function _todayIso() { return _iso(Date.now()); }
  function _daysAgoIso(n) { return _iso(Date.now() - (n * 24 * 60 * 60 * 1000)); }

  function _status(text, tone) {
    const el = $('meta-live-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'px-4 py-3 rounded-2xl border font-bold text-sm ' + (
      tone === 'bad' ? 'bg-red-100 border-red-200 text-red-700' :
      tone === 'ok' ? 'bg-green-100 border-green-200 text-green-700' :
      'bg-white border-gray-200 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-200'
    );
  }

  function _identity(text, tone) {
    const el = $('meta-live-identity');
    if (!el) return;
    el.textContent = text;
    el.className = 'text-xs font-bold mt-2 ' + (
      tone === 'bad' ? 'text-red-700' :
      tone === 'ok' ? 'text-green-700' :
      'text-gray-600 dark:text-gray-300'
    );
  }

  function _getToken() {
    const inEl = $('meta-live-token');
    const typed = inEl ? String(inEl.value || '').trim() : '';
    if (typed) return typed;
    try { return String(localStorage.getItem(LS_TOKEN) || '').trim(); } catch (e) { return ''; }
  }

  function _saveToken() {
    const t = _getToken();
    if (!t) return false;
    try { localStorage.setItem(LS_TOKEN, t); } catch (e) {}
    _identity('Token enregistré.', 'ok');
    return true;
  }

  function _clearToken() {
    try { localStorage.removeItem(LS_TOKEN); } catch (e) {}
    const inEl = $('meta-live-token');
    if (inEl) inEl.value = '';
    _identity('Token effacé.', 'neutral');
  }

  async function _metaFetch(path, params) {
    const token = _getToken();
    if (!token) throw new Error('token_missing');
    const u = new URL(`https://graph.facebook.com/${_apiVer()}/` + path.replace(/^\//, ''));
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      u.searchParams.set(k, String(v));
    });
    u.searchParams.set('access_token', token);
    const res = await fetch(u.toString(), { method: 'GET' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json && json.error)) {
      const msg = json && json.error && json.error.message ? json.error.message : `HTTP_${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function _verifyToken() {
    const me = await _metaFetch('/me', { fields: 'id,name' });
    _identity(`Connecté: ${me.name} (${me.id})`, 'ok');
    return me;
  }

  async function _getPages() {
    const out = [];
    let after = null;
    for (let i = 0; i < 6; i++) {
      const json = await _metaFetch('/me/accounts', { fields: 'id,name', limit: 100, after: after || '' });
      (json.data || []).forEach(p => out.push(p));
      after = json.paging && json.paging.cursors ? json.paging.cursors.after : null;
      if (!after) break;
    }
    return out;
  }

  async function _getAdAccounts() {
    const out = [];
    let after = null;
    for (let i = 0; i < 6; i++) {
      const json = await _metaFetch('/me/adaccounts', { fields: 'id,name,account_status,currency', limit: 100, after: after || '' });
      (json.data || []).forEach(a => out.push(a));
      after = json.paging && json.paging.cursors ? json.paging.cursors.after : null;
      if (!after) break;
    }
    return out;
  }

  function _renderAdAccounts(adAccounts) {
    _cachedAdAccounts = Array.isArray(adAccounts) ? adAccounts : [];
    const sel = document.getElementById('meta-live-adaccount');
    if (sel) {
      const current = String(sel.value || '');
      sel.innerHTML = `<option value="">— Sélectionne —</option>` + _cachedAdAccounts.map(a => {
        const id = String(a.id || '').replace(/[^\w.:\-]/g, '');
        const name = escapeHtml(String(a.name || id));
        const cur = a.currency ? ` (${escapeHtml(String(a.currency))})` : '';
        return `<option value="${id}">${name}${cur}</option>`;
      }).join('');
      sel.value = current;
    }
  }

  async function _loadAdAccounts() {
    _status('Chargement ad accounts…', 'neutral');
    const adAccounts = await _getAdAccounts();
    _renderAdAccounts(adAccounts);
    try {
      const sel = document.getElementById('meta-live-adaccount');
      if (sel && !sel.value && _cachedAdAccounts.length) sel.value = String(_cachedAdAccounts[0].id || '');
    } catch (e) {}
    _status(adAccounts.length ? `Ad accounts: ${adAccounts.length}` : 'Aucun ad account', adAccounts.length ? 'ok' : 'bad');
    return adAccounts;
  }

  let _cachedCampaigns = [];
  let _selectedCampaignId = '';
  let _lastKpis = null;

  function _pickResult(actions) {
    const a = Array.isArray(actions) ? actions : [];
    const pri = ['offsite_conversion.purchase', 'omni_purchase', 'purchase', 'lead', 'omni_lead', 'link_click'];
    for (const t of pri) {
      const row = a.find(x => x && x.action_type === t);
      if (row && row.value !== undefined) return { type: t, value: Number(row.value || 0) };
    }
    const first = a.find(x => x && x.value !== undefined);
    return first ? { type: String(first.action_type || 'result'), value: Number(first.value || 0) } : { type: 'result', value: 0 };
  }

  function _resultLabel(type) {
    const t = String(type || '');
    if (t.includes('messaging') || t.includes('message')) return 'Messages';
    if (t.includes('offsite_conversion') && t.includes('purchase')) return 'Achats (Site)';
    if (t.includes('omni_purchase')) return 'Achats (Meta)';
    if (t.includes('purchase')) return 'Achats';
    if (t.includes('lead')) return 'Leads';
    if (t.includes('landing_page_view')) return 'Visites (Landing Page)';
    if (t.includes('view_content') || t.includes('page_view')) return 'Visites (Site)';
    if (t.includes('link_click') || t.includes('outbound_click')) return 'Clics';
    return 'Résultat';
  }

  function _pickResultByObjective(actions, objective) {
    const a = Array.isArray(actions) ? actions : [];
    let obj = String(objective || '').toUpperCase();
    if (obj.startsWith('OUTCOME_')) {
      if (obj.includes('TRAFFIC')) obj = 'TRAFFIC';
      else if (obj.includes('SALES')) obj = 'PURCHASE';
      else if (obj.includes('LEADS')) obj = 'LEAD';
      else if (obj.includes('ENGAGEMENT')) obj = 'MESSAGE';
      else if (obj.includes('AWARENESS')) obj = 'AWARENESS';
    }

    const findExact = (types) => {
      for (const t of types) {
        const row = a.find(x => x && String(x.action_type || '') === t);
        if (row && row.value !== undefined) return { type: t, value: Number(row.value || 0) };
      }
      return null;
    };
    const pickMetric = (label, types) => {
      const hit = findExact(types);
      if (hit) return { type: hit.type, value: hit.value, label };
      return { type: String(types[0] || 'result'), value: 0, label };
    };

    const msgTypes = [
      'onsite_conversion.messaging_conversation_started',
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.messaging_conversation_started_1d',
      'messaging_conversation_started',
      'messaging_conversation_started_7d',
      'messaging_conversation_started_1d',
      'onsite_conversion.messaging_first_reply',
      'messaging_first_reply'
    ];
    const purchaseTypes = [
      'offsite_conversion.purchase',
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
      'purchase'
    ];
    const trafficTypes = [
      'landing_page_view',
      'omni_landing_page_view',
      'view_content',
      'page_view',
      'outbound_click',
      'link_click'
    ];
    const leadTypes = ['lead', 'omni_lead'];

    if (obj.includes('MESSAGE') || obj.includes('MESSAG') || obj.includes('CONVERS')) {
      return pickMetric('Messages', msgTypes);
    }
    if (obj.includes('SALE') || obj.includes('PURCHASE') || obj.includes('CONVERSION')) {
      return pickMetric('Achats', purchaseTypes);
    }
    if (obj.includes('TRAFFIC') || obj.includes('VISIT')) {
      return pickMetric('Visites', trafficTypes);
    }
    if (obj.includes('LEAD')) {
      return pickMetric('Leads', leadTypes);
    }
    const fallback = _pickResult(actions);
    return { type: fallback.type, value: fallback.value, label: _resultLabel(fallback.type) };
  }

  async function _getCampaigns(adAccountId) {
    const out = [];
    let after = null;
    for (let i = 0; i < 3; i++) {
      const json = await _metaFetch(`/${adAccountId}/campaigns`, {
        fields: 'id,name,effective_status,status,stop_time,objective',
        limit: 200,
        after: after || ''
      });
      (json.data || []).forEach(c => out.push(c));
      after = json.paging && json.paging.cursors ? json.paging.cursors.after : null;
      if (!after) break;
    }
    return out;
  }

  async function _getActiveCampaignIdsFromAds(adAccountId) {
    const out = new Set();
    let after = null;
    for (let i = 0; i < 3; i++) {
      const json = await _metaFetch(`/${adAccountId}/ads`, {
        fields: 'id,campaign_id,effective_status',
        effective_status: '["ACTIVE"]',
        limit: 500,
        after: after || ''
      });
      (json.data || []).forEach(a => {
        const cid = String(a && a.campaign_id ? a.campaign_id : '').trim();
        if (cid) out.add(cid);
      });
      after = json.paging && json.paging.cursors ? json.paging.cursors.after : null;
      if (!after) break;
    }
    return out;
  }

  function _extractPageIdFromStorySpec(spec) {
    const s = spec && typeof spec === 'object' ? spec : null;
    if (!s) return '';
    if (s.page_id) return String(s.page_id || '');
    if (s.link_data && s.link_data.page_id) return String(s.link_data.page_id || '');
    if (s.video_data && s.video_data.page_id) return String(s.video_data.page_id || '');
    if (s.photo_data && s.photo_data.page_id) return String(s.photo_data.page_id || '');
    return '';
  }

  async function _getCampaignPageName(campaignId) {
    const c = _cachedCampaigns.find(x => x && String(x.id) === String(campaignId));
    if (c && c.pageName) return String(c.pageName || '');
    const ads = await _metaFetch(`/${campaignId}/ads`, { fields: 'id,creative{object_story_spec}', limit: 5 });
    const first = (ads.data || []).find(a => a && a.creative && a.creative.object_story_spec);
    const pageId = first ? _extractPageIdFromStorySpec(first.creative.object_story_spec) : '';
    if (!pageId) return '';
    const page = await _metaFetch(`/${pageId}`, { fields: 'name' });
    return String(page && page.name ? page.name : '');
  }

  async function _enrichCampaignPages(limit) {
    const max = Math.max(0, Number(limit || 0)) || 25;
    const list = _cachedCampaigns.slice(0, max);
    for (const c of list) {
      if (!c || c.pageName) continue;
      try {
        const name = await _getCampaignPageName(c.id);
        c.pageName = name || '';
        _renderCampaignsList();
      } catch (e) {}
    }
  }

  async function _getCampaignInsights(campaignId, since, until) {
    const json = await _metaFetch(`/${campaignId}/insights`, {
      fields: 'spend,actions,cost_per_action_type,impressions',
      'time_range[since]': since,
      'time_range[until]': until,
      limit: 1
    });
    const row = (json.data && json.data[0]) ? json.data[0] : null;
    if (!row) return { spend: 0, actions: [], costs: [], impressions: 0 };
    return {
      spend: Number(row.spend || 0),
      actions: Array.isArray(row.actions) ? row.actions : [],
      costs: Array.isArray(row.cost_per_action_type) ? row.cost_per_action_type : [],
      impressions: Number(row.impressions || 0)
    };
  }

  function _pickCostForAction(costs, actionType) {
    const a = Array.isArray(costs) ? costs : [];
    const t = String(actionType || '');
    if (!t) return null;
    const exact = a.find(x => x && String(x.action_type || '') === t && x.value !== undefined);
    if (exact) return Number(exact.value || 0);
    const loose = a.find(x => x && String(x.action_type || '').includes(t) && x.value !== undefined);
    if (loose) return Number(loose.value || 0);
    return null;
  }

  function _renderCampaignsList() {
    const box = document.getElementById('meta-live-campaigns-list');
    if (!box) return;
    const qCamp = String((document.getElementById('meta-live-filter-campaign') && document.getElementById('meta-live-filter-campaign').value) || '').trim().toLowerCase();
    const qPage = String((document.getElementById('meta-live-filter-page') && document.getElementById('meta-live-filter-page').value) || '').trim().toLowerCase();
    const cb = document.getElementById('meta-live-only-active');
    const onlyActive = cb ? !!cb.checked : true;

    const items = _cachedCampaigns
      .filter(c => c && c.id)
      .filter(c => {
        if (!onlyActive) return true;
        return String(c.diffusionStatus || '') === 'Active';
      })
      .filter(c => qCamp ? String(c.name || '').toLowerCase().includes(qCamp) : true)
      .filter(c => qPage ? String(c.pageName || '').toLowerCase().includes(qPage) : true)
      .slice(0, 120);

    try {
      const countEl = document.getElementById('meta-live-campaigns-count');
      if (countEl) {
        const total = _cachedCampaigns.length;
        countEl.textContent = total ? `${items.length}/${total}` : '';
      }
    } catch (e) {}

    if (!items.length) { box.textContent = 'Aucune campagne.'; return; }
    box.innerHTML = `<div class="space-y-2">` + items.map(c => {
      const id = String(c.id || '').replace(/[^\w.:\-]/g, '');
      const name = escapeHtml(String(c.name || id));
      const page = c.pageName ? escapeHtml(String(c.pageName)) : '—';
      const stop = c.stop_time ? escapeHtml(String(c.stop_time).slice(0, 10)) : '—';
      const active = id === _selectedCampaignId;
      const check = active ? '<span class="px-2 py-1 rounded-xl bg-red-600 text-white text-[10px] font-black">Sélectionnée</span>' : '';
      const ds = String(c.diffusionStatus || '');
      const badge = ds === 'Active'
        ? '<span class="px-2 py-1 rounded-xl bg-green-100 text-green-700 border border-green-200 text-[10px] font-black">Active</span>'
        : (ds === 'Terminé'
          ? '<span class="px-2 py-1 rounded-xl bg-gray-100 text-gray-700 border border-gray-200 text-[10px] font-black">Terminé</span>'
          : '<span class="px-2 py-1 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black">Désactivé</span>');
      return `<button type="button" onclick="window.selectMetaLiveCampaign && window.selectMetaLiveCampaign('${id}'); return false;" class="w-full text-left border rounded-2xl px-3 py-2 ${active ? 'bg-red-100 border-red-200 dark:bg-red-900/30 dark:border-red-900/40' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-black text-gray-900 dark:text-white truncate">${name}</div>
            <div class="text-[11px] font-black text-gray-400 truncate">${page}</div>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            ${check}
            ${badge}
            <span class="text-[11px] font-black text-gray-500">Fin: ${stop}</span>
            <button type="button" onclick="window.quickMetaLiveCampaignResults && window.quickMetaLiveCampaignResults('${id}'); return false;" class="px-3 py-2 rounded-xl bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 font-black text-[10px] border border-gray-200 dark:border-gray-700 shadow-sm">
              Résultats
            </button>
          </div>
        </div>
      </button>`;
    }).join('') + `</div>`;
  }

  window.getMetaLiveLastKpis = function () { return _lastKpis; };

  function _renderKpis(k) {
    _lastKpis = k || null;
    const box = document.getElementById('meta-live-kpis');
    if (!box) return;
    if (!k) { box.textContent = 'Aucun KPI.'; return; }
    box.innerHTML = `
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Campagne</div>
          <div class="text-sm font-black text-gray-900 dark:text-white">${escapeHtml(k.campaignName) || '—'}</div>
        </div>
        <button type="button" onclick="const el=document.getElementById('meta-live-client-search'); if(el){ el.focus(); el.scrollIntoView({behavior:'smooth', block:'center'});} return false;" class="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black text-xs shadow-sm">
          Envoyer KPIs
        </button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Résultat</div>
          <div class="text-xl font-black text-gray-900 dark:text-white">${_fmt(k.results)} <span class="text-[11px] font-black text-gray-400">${k.resultLabel}</span></div>
        </div>
        <div class="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Coût / Résultat</div>
          <div class="text-xl font-black text-gray-900 dark:text-white">${k.cprFinite ? _fmt(k.costPerResult) : '—'} <span class="text-[11px] font-black text-gray-400">${escapeHtml(k.currency)}</span></div>
        </div>
        <div class="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Impressions</div>
          <div class="text-xl font-black text-gray-900 dark:text-white">${_fmt(k.impressions)}</div>
        </div>
        <div class="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 md:col-span-2">
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Budget consommé</div>
          <div class="text-xl font-black text-gray-900 dark:text-white">${_fmt(k.spend)} <span class="text-[11px] font-black text-gray-400">${escapeHtml(k.currency)}</span></div>
        </div>
        <div class="p-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div class="text-[10px] font-black text-gray-500 dark:text-gray-300 uppercase tracking-widest">Date de fin</div>
          <div class="text-xl font-black text-gray-900 dark:text-white">${k.stopDate || '—'}</div>
        </div>
      </div>
      <div class="mt-3"><button type="button" onclick="openMetaReportPdf && openMetaReportPdf(); return false;" class="px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white font-black text-xs"><i class="fas fa-file-pdf mr-1"></i> Rapport PDF client</button></div>
    `;
  }

  function _validateDateRange(since, until) {
    try {
      const s = new Date(since + 'T00:00:00').getTime();
      const u = new Date(until + 'T23:59:59').getTime();
      const days = Math.ceil((u - s) / (24 * 60 * 60 * 1000));
      if (!Number.isFinite(days) || days <= 0) return { ok: false, msg: 'Plage de dates invalide.' };
      if (days > 31) return { ok: false, msg: 'Plage trop grande. Mets 31 jours max.' };
      return { ok: true, msg: '' };
    } catch (e) {
      return { ok: false, msg: 'Plage de dates invalide.' };
    }
  }

  async function loadCampaigns() {
    const sel = document.getElementById('meta-live-adaccount');
    const adAccountId = sel ? String(sel.value || '').trim() : '';
    if (!adAccountId) { _status('Sélectionne un ad account.', 'bad'); return; }

    _status('Chargement campagnes…', 'neutral');
    _selectedCampaignId = '';
    _cachedCampaigns = [];
    _renderKpis(null);
    const box = document.getElementById('meta-live-campaigns-list');
    if (box) box.textContent = 'Chargement…';

    const [camps, activeCampaignIds] = await Promise.all([
      _getCampaigns(adAccountId),
      _getActiveCampaignIdsFromAds(adAccountId)
    ]);
    _cachedCampaigns = camps.map(c => ({
      id: String(c.id || ''),
      name: String(c.name || ''),
      stop_time: c.stop_time || '',
      status: String(c.status || ''),
      effective_status: String(c.effective_status || ''),
      objective: String(c.objective || ''),
      pageName: '',
      hasActiveAds: false,
      diffusionStatus: ''
    })).filter(c => c.id);

    const now = Date.now();
    _cachedCampaigns.forEach(c => {
      c.hasActiveAds = activeCampaignIds.has(String(c.id));
      const st = String(c.effective_status || c.status || '').toUpperCase();
      const stop = c.stop_time ? Date.parse(String(c.stop_time)) : NaN;
      const ended = Number.isFinite(stop) && stop > 0 && stop < now;
      if (c.hasActiveAds) c.diffusionStatus = 'Active';
      else if (ended || st === 'ARCHIVED' || st === 'COMPLETED' || st === 'DELETED') c.diffusionStatus = 'Terminé';
      else c.diffusionStatus = 'Publicité désactivé';
    });

    const activeCount = _cachedCampaigns.filter(c => c.diffusionStatus === 'Active').length;
    const endedCount = _cachedCampaigns.filter(c => c.diffusionStatus === 'Terminé').length;
    const offCount = _cachedCampaigns.filter(c => c.diffusionStatus === 'Publicité désactivé').length;
    _status(_cachedCampaigns.length ? `Campagnes: ${_cachedCampaigns.length} • Active: ${activeCount} • Terminé: ${endedCount} • Désactivé: ${offCount}` : 'Aucune campagne.', _cachedCampaigns.length ? 'ok' : 'bad');
    _renderCampaignsList();
    _enrichCampaignPages(25);
  }

  async function showResults() {
    const since = String((document.getElementById('meta-live-since') && document.getElementById('meta-live-since').value) || '').trim();
    const until = String((document.getElementById('meta-live-until') && document.getElementById('meta-live-until').value) || '').trim();
    if (!since || !until) { _status('Dates requises.', 'bad'); return; }
    const vr = _validateDateRange(since, until);
    if (!vr.ok) { _status(vr.msg, 'bad'); return; }
    if (!_selectedCampaignId) { _status('Sélectionne une campagne.', 'bad'); return; }

    const campaign = _cachedCampaigns.find(c => String(c.id) === String(_selectedCampaignId));
    const objective = campaign && campaign.objective ? String(campaign.objective || '') : '';
    const selAcc = document.getElementById('meta-live-adaccount');
    const accId = selAcc ? String(selAcc.value || '') : '';
    const acc = _cachedAdAccounts.find(a => String(a.id) === accId);
    const currency = acc && acc.currency ? String(acc.currency) : '';

    _status('Chargement KPIs…', 'neutral');
    const ins = await _getCampaignInsights(_selectedCampaignId, since, until);
    const res = _pickResultByObjective(ins.actions, objective);
    const spend = Number(ins.spend || 0);
    const results = Number(res.value || 0);
    const pickedCost = _pickCostForAction(ins.costs, res.type);
    const costPerResult = Number.isFinite(pickedCost) && pickedCost > 0 ? pickedCost : (results > 0 ? (spend / results) : 0);

    _renderKpis({
      campaignName: campaign ? String(campaign.name || '') : '',
      spend,
      results,
      resultLabel: String(res.label || _resultLabel(res.type)),
      actionType: String(res.type || ''),
      costPerResult,
      cprFinite: (results > 0),
      impressions: Number(ins.impressions || 0),
      stopDate: campaign && campaign.stop_time ? String(campaign.stop_time).slice(0, 10) : '',
      currency
    });
    _status('OK', 'ok');
  }

  function _openUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    const desk = window.DesktopSpy;
    if (desk && typeof desk.open === 'function') { desk.open(u); return true; }
    const cap = window.Capacitor;
    const internal = cap && cap.Plugins && cap.Plugins.InternalBrowser ? cap.Plugins.InternalBrowser : null;
    if (internal && typeof internal.open === 'function') { internal.open({ url: u }); return true; }
    try { window.open(u, '_blank', 'noopener'); } catch (e) { try { window.location.href = u; } catch (e2) {} }
    return true;
  }

  function _normalizeDZPhone(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/[^\d+]/g, '');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('213')) return s;
    if (s.startsWith('0') && s.length === 10) return '213' + s.slice(1);
    if ((s.startsWith('5') || s.startsWith('6') || s.startsWith('7')) && (s.length === 9)) return '213' + s;
    return s;
  }

  function _composeClientMessage() {
    const k = _lastKpis;
    if (!k) return '';
    const lines = [
      `Rapport Meta — ${k.campaignName || ''}`.trim(),
      `Résultat: ${_fmt(k.results)} (${k.resultLabel})`,
      `Coût/Résultat: ${k.cprFinite ? _fmt(k.costPerResult) : '—'} ${k.currency}`,
      `Impressions: ${_fmt(k.impressions)}`,
      `Budget consommé: ${_fmt(k.spend)} ${k.currency}`,
      `Date de fin: ${k.stopDate || '—'}`
    ];
    return lines.filter(Boolean).join('\n');
  }

  function _renderClientSuggest(q) {
    const box = document.getElementById('meta-live-client-suggest');
    if (!box) return;
    const query = String(q || '').trim().toLowerCase();
    if (!query) { box.innerHTML = ''; return; }
    const clients = (window.appState && Array.isArray(window.appState.clients)) ? window.appState.clients : [];
    const hits = clients
      .map(c => ({
        name: String(c && (c.name || c.clientName || '') ? (c.name || c.clientName) : ''),
        phone: String(c && (c.phone || c.tel || '') ? (c.phone || c.tel) : '').trim(),
        instagram: String(c && (c.instagram || c.ig || c.insta || '') ? (c.instagram || c.ig || c.insta) : '').trim()
      }))
      .filter(c => c.phone || c.name)
      .filter(c => `${c.name} ${c.phone} ${c.instagram}`.toLowerCase().includes(query))
      .slice(0, 6);
    if (!hits.length) { box.innerHTML = ''; return; }
    box.innerHTML = hits.map(c => {
      const safeName = escapeJsAttr(c.name);
      const safePhone = escapeJsAttr(c.phone);
      const safeIg = escapeJsAttr(c.instagram);
      return `<button type="button" onclick="window.selectMetaLiveClient && window.selectMetaLiveClient('${safeName}','${safePhone}','${safeIg}'); return false;" class="w-full text-left border border-gray-200 dark:border-gray-700 rounded-2xl px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800">
        <div class="font-black text-gray-900 dark:text-white">${escapeHtml(c.name) || 'Client'}</div>
        <div class="text-[11px] font-black text-gray-400">${escapeHtml(c.phone)}${c.instagram ? ` • ${escapeHtml(c.instagram)}` : ''}</div>
      </button>`;
    }).join('');
  }

  window.selectMetaLiveCampaign = function (id) {
    _selectedCampaignId = String(id || '');
    _renderCampaignsList();
    return false;
  };
  window.quickMetaLiveCampaignResults = async function (id) {
    try {
      window.selectMetaLiveCampaign && window.selectMetaLiveCampaign(id);
      await showResults();
    } catch (e) {
      _status(String(e && e.message ? e.message : e), 'bad');
    }
    return false;
  };
  window.selectMetaLiveClient = function (name, phone, instagram) {
    const s = document.getElementById('meta-live-client-search');
    const p = document.getElementById('meta-live-client-phone');
    const ig = document.getElementById('meta-live-client-ig');
    if (s) s.value = String(name || '');
    if (p) p.value = String(phone || '');
    if (ig && instagram) ig.value = String(instagram || '');
    const box = document.getElementById('meta-live-client-suggest');
    if (box) box.innerHTML = '';
    return false;
  };


  window.initMetaAdsLive = function () {
    const tok = $('meta-live-token');
    if (tok) {
      try { tok.value = String(localStorage.getItem(LS_TOKEN) || ''); } catch (e) {}
    }
    const verLbl = $('meta-live-apiver');
    if (verLbl) verLbl.textContent = _apiVer();
    const verIn = $('meta-live-apiver-input');
    if (verIn) { try { verIn.value = String(localStorage.getItem(LS_API_VER) || ''); } catch (e) {} }
    const since = $('meta-live-since');
    const until = $('meta-live-until');
    if (since && !since.value) since.value = _daysAgoIso(7);
    if (until && !until.value) until.value = _todayIso();

    const save = $('meta-live-save');
    const clear = $('meta-live-clear');
    const load = document.getElementById('meta-live-load-accounts');
    const loadCampaignsBtn = document.getElementById('meta-live-load-campaigns');
    const resultsBtn = document.getElementById('meta-live-btn-results');
    const fCamp = document.getElementById('meta-live-filter-campaign');
    const fPage = document.getElementById('meta-live-filter-page');
    const onlyActive = document.getElementById('meta-live-only-active');
    const cSearch = document.getElementById('meta-live-client-search');
    const btnWa = document.getElementById('meta-live-send-wa');
    const btnIg = document.getElementById('meta-live-send-ig');
    const btnCopy = document.getElementById('meta-live-copy-msg');

    if (save) save.onclick = () => { _saveToken(); return false; };
    if (clear) clear.onclick = () => { _clearToken(); return false; };
    if (load) load.onclick = async () => {
      try { await _verifyToken(); await _loadAdAccounts(); } catch (e) { _status(String(e && e.message ? e.message : e), 'bad'); }
      return false;
    };
    if (loadCampaignsBtn) loadCampaignsBtn.onclick = async () => {
      try { await _verifyToken(); if (!_cachedAdAccounts.length) await _loadAdAccounts(); await loadCampaigns(); } catch (e) { _status(String(e && e.message ? e.message : e), 'bad'); }
      return false;
    };
    if (resultsBtn) resultsBtn.onclick = async () => { try { await showResults(); } catch (e) { _status(String(e && e.message ? e.message : e), 'bad'); } return false; };
    if (fCamp) fCamp.oninput = () => { _renderCampaignsList(); };
    if (fPage) fPage.oninput = () => { _renderCampaignsList(); };
    if (onlyActive) onlyActive.onchange = () => { try { _renderCampaignsList(); } catch (e) { _status(String(e && e.message ? e.message : e), 'bad'); } return false; };
    if (cSearch) cSearch.oninput = () => { _renderClientSuggest(cSearch.value); };
    if (btnCopy) btnCopy.onclick = async () => {
      const msg = _composeClientMessage();
      if (!msg) { _status('Aucun KPI à envoyer.', 'bad'); return false; }
      try { await navigator.clipboard.writeText(msg); _status('Message copié.', 'ok'); } catch (e) { _status('Impossible de copier.', 'bad'); }
      return false;
    };
    if (btnWa) btnWa.onclick = () => {
      const msg = _composeClientMessage();
      if (!msg) { _status('Aucun KPI à envoyer.', 'bad'); return false; }
      const raw = String((document.getElementById('meta-live-client-phone') && document.getElementById('meta-live-client-phone').value) || '');
      const phone = _normalizeDZPhone(raw);
      if (!phone) { _status('Téléphone WhatsApp requis.', 'bad'); return false; }
      _openUrl(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`);
      return false;
    };
    if (btnIg) btnIg.onclick = () => {
      const msg = _composeClientMessage();
      if (!msg) { _status('Aucun KPI à envoyer.', 'bad'); return false; }
      const ig = String((document.getElementById('meta-live-client-ig') && document.getElementById('meta-live-client-ig').value) || '').trim().replace(/^@/, '');
      if (!ig) { _status('Username Instagram requis.', 'bad'); return false; }
      _openUrl(`https://www.instagram.com/${encodeURIComponent(ig)}/`);
      return false;
    };

    _identity('Token local.', 'neutral');
    _status('Prêt.', 'neutral');
    _renderCampaignsList();
    _renderKpis(null);
  };
})();
