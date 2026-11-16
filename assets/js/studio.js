// =====================================================================
//  STUDIO.JS — deux sections : « Rendez-vous studio » et « Shooting produits »
//  • Rendez-vous : date + heure + durée, versement (acompte / payé en totalité), et BLOCAGE des chevauchements :
//    deux rendez-vous ne peuvent pas se superposer le même jour (option : un seul rendez-vous par jour).
//  • Shooting produits : une fiche par produit (contact du client, date de remise du fichier final, versements, statut).
//  • Alertes dans la cloche : rendez-vous du jour/demain, solde à encaisser, remises en retard ou proches.
//  Nouvelles données : appState.globalConfig.ext.studioBookings / productShoots / studioSettings
//  (synchronisées comme les autres modules ; AUCUNE donnée existante n'est touchée).
// =====================================================================
(function () {
  'use strict';
  if (!window.Ext) return;
  var X = Ext, E = X.esc, S = ExtStore;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function ro() { return typeof window.isReadOnlySession === 'function' && window.isReadOnlySession(); }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }

  // ---------------------------------------------------------------- données
  function bookings() { return S.list('studioBookings'); }
  function shoots() { return S.list('productShoots'); }
  function cfg() {
    var c = S.get('studioSettings', {}) || {};
    return { open: c.open || '09:00', close: c.close || '19:00', defaultMin: num(c.defaultMin) > 0 ? num(c.defaultMin) : 120, onePerDay: !!c.onePerDay };
  }
  var ST = { month: null, day: '', editB: '', editS: '', shFilter: 'open' };

  function toMin(hhmm) { var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
  function toHM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  function endOf(b) { return toMin(b.start) + (num(b.durationMin) || cfg().defaultMin); }
  function paidOf(r) { return (r.payments || []).reduce(function (s, p) { return s + num(p.amount); }, 0); }
  function payInfo(r) {
    var price = num(r.price), paid = paidOf(r), rest = Math.max(0, price - paid);
    if (price > 0 && paid >= price) return { k: 'full', label: 'Payé en totalité', cls: 'bg-green-100 text-green-700', rest: 0, paid: paid };
    if (paid > 0) return { k: 'part', label: 'Acompte versé', cls: 'bg-amber-100 text-amber-700', rest: rest, paid: paid };
    return { k: 'none', label: 'Rien versé', cls: 'bg-red-100 text-red-700', rest: rest, paid: 0 };
  }
  function dayName(ymd) { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return ymd; } }
  function waLink(phone) {
    var d = String(phone || '').replace(/\D/g, ''); if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2); else if (d.charAt(0) === '0') d = '213' + d.slice(1);
    return 'https://wa.me/' + d;
  }
  function clientByName(n) { var k = String(n || '').trim().toLowerCase(); if (!k) return null; return (appState.clients || []).find(function (c) { return String(c.name || '').trim().toLowerCase() === k; }) || null; }
  function clientsDatalist(id) { return '<datalist id="' + id + '">' + (appState.clients || []).slice(0, 2000).map(function (c) { return '<option value="' + E(c.name || '') + '">'; }).join('') + '</datalist>'; }
  function contactBtns(r) {
    var w = waLink(r.phone), out = '';
    if (r.phone) out += '<a href="tel:' + E(String(r.phone).replace(/[^\d+]/g, '')) + '" class="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-bold hover:bg-gray-200"><i class="fas fa-phone mr-1"></i>' + E(r.phone) + '</a> ';
    if (w) out += '<a href="' + E(w) + '" target="_blank" rel="noopener" class="px-2 py-1 rounded-lg bg-green-100 text-green-700 text-[11px] font-bold hover:bg-green-200"><i class="fab fa-whatsapp mr-1"></i>WhatsApp</a>';
    return out || '<span class="text-[11px] text-gray-400">Pas de contact</span>';
  }

  // ---------------------------------------------------------------- conflits (cœur de la règle)
  // Retourne le rendez-vous en conflit (ou null). Les rendez-vous annulés ne bloquent jamais.
  function findConflict(date, start, durMin, ignoreId) {
    var s = toMin(start), e = s + durMin, one = cfg().onePerDay;
    return bookings().find(function (b) {
      if (b.id === ignoreId || b.status === 'annule' || b.date !== date) return false;
      if (one) return true;
      return s < endOf(b) && toMin(b.start) < e;
    }) || null;
  }
  function freeSlots(date, durMin, ignoreId) {
    var c = cfg(), o = toMin(c.open), cl = toMin(c.close), out = [];
    for (var t = o; t + durMin <= cl && out.length < 8; t += 30) if (!findConflict(date, toHM(t), durMin, ignoreId)) out.push(toHM(t));
    return out;
  }

  // ================================================================ RENDEZ-VOUS STUDIO
  window.stuClientPick = function (nameId, phoneId) {
    var c = clientByName(val(nameId)), p = $(phoneId);
    if (c && p && !p.value) p.value = c.phone || c.contact || '';
  };
  window.stuSlotHint = function () {
    var box = $('stuHint'); if (!box) return;
    var d = val('stuDate'), st = val('stuStart'), dur = Math.round(num(val('stuDur')) * 60) || cfg().defaultMin;
    if (!d) { box.innerHTML = ''; return; }
    var c = st ? findConflict(d, st, dur, ST.editB) : null;
    var fs = freeSlots(d, dur, ST.editB);
    box.innerHTML = (c ? '<div class="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold mb-2"><i class="fas fa-ban mr-1"></i>Créneau déjà pris : ' + E(c.clientName) + ' de ' + E(c.start) + ' à ' + E(toHM(endOf(c))) + '</div>' : '') +
      '<div class="text-xs text-gray-500">Créneaux libres le ' + E(X.fmtDate(d)) + ' : ' + (fs.length ? fs.map(function (h) { return '<button type="button" data-h="' + h + '" onclick="document.getElementById(\'stuStart\').value=this.dataset.h;stuSlotHint()" class="px-2 py-1 m-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100">' + h + '</button>'; }).join('') : '<b class="text-red-600">aucun créneau libre ce jour-là</b>') + '</div>';
  };
  window.stuSave = function () {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var name = val('stuName'), date = val('stuDate'), start = val('stuStart'), durH = num(val('stuDur'));
    if (!name) return X.toast('Indiquez le nom du client', 'warning');
    if (!X.isYmd(date)) return X.toast('Choisissez la date', 'warning');
    if (isNaN(toMin(start))) return X.toast('Choisissez l\'heure de début', 'warning');
    var dur = Math.round((durH > 0 ? durH : cfg().defaultMin / 60) * 60);
    var cf = findConflict(date, start, dur, ST.editB);
    if (cf) {
      X.toast('Impossible : ' + (cfg().onePerDay ? 'il y a déjà un rendez-vous ce jour-là' : 'créneau déjà pris') + ' (' + cf.clientName + ' ' + cf.start + '-' + toHM(endOf(cf)) + ')', 'error');
      return window.stuSlotHint();
    }
    var price = num(val('stuPrice')), first = num(val('stuPaid'));
    if (first < 0 || price < 0) return X.toast('Montant invalide', 'warning');
    var cl = clientByName(name), rec = ST.editB ? X.find(bookings(), ST.editB) : null;
    if (rec) {
      rec.clientName = name; rec.clientId = cl ? cl.id : (rec.clientId || ''); rec.phone = val('stuPhone'); rec.date = date; rec.start = start; rec.durationMin = dur;
      rec.kind = val('stuKind'); rec.price = price; rec.note = val('stuNote'); rec.updatedAt = Date.now();
      X.log('Rendez-vous studio modifié', name + ' · ' + date + ' ' + start);
    } else {
      rec = { id: X.uid('stu'), clientName: name, clientId: cl ? cl.id : '', phone: val('stuPhone'), date: date, start: start, durationMin: dur, kind: val('stuKind'), price: price, payments: [], status: 'confirme', note: val('stuNote'), createdAt: Date.now(), by: X.actor() };
      if (first > 0) rec.payments.push({ date: X.today(), amount: first, by: X.actor() });
      bookings().push(rec);
      X.log('Rendez-vous studio créé', name + ' · ' + date + ' ' + start + ' · ' + X.fmt(price));
    }
    ST.editB = ''; ST.day = date; ST.month = date.slice(0, 7);
    S.set('studioBookings', bookings());
    X.toast('Rendez-vous enregistré', 'success'); X.rerender();
  };
  window.stuEdit = function (id) { ST.editB = id; X.rerender(); setTimeout(function () { var f = $('stuName'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); };
  window.stuCancelEdit = function () { ST.editB = ''; X.rerender(); };
  window.stuStatus = function (id, st) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var r = X.find(bookings(), id); if (!r) return;
    if (st === 'confirme') { var cf = findConflict(r.date, r.start, num(r.durationMin) || cfg().defaultMin, r.id); if (cf) return X.toast('Impossible de réactiver : le créneau est maintenant pris par ' + cf.clientName, 'error'); }
    if (st === 'annule' && !confirm('Annuler ce rendez-vous ? Le créneau redeviendra libre.')) return;
    r.status = st; r.updatedAt = Date.now(); S.set('studioBookings', bookings());
    X.log('Rendez-vous studio : ' + st, r.clientName + ' · ' + r.date); X.rerender();
  };
  window.stuDelete = function (id) {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var r = X.find(bookings(), id); if (!r || !confirm('Supprimer définitivement ce rendez-vous ?')) return;
    S.set('studioBookings', bookings().filter(function (b) { return b.id !== id; })); X.log('Rendez-vous studio supprimé', r.clientName + ' · ' + r.date); X.rerender();
  };
  window.stuPay = function (id) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var r = X.find(bookings(), id), a = num(val('stuPay_' + id)); if (!r) return;
    if (!(a > 0)) return X.toast('Saisissez le montant versé', 'warning');
    r.payments = r.payments || []; r.payments.push({ date: X.today(), amount: a, by: X.actor() }); r.updatedAt = Date.now();
    S.set('studioBookings', bookings()); X.log('Versement studio', r.clientName + ' · ' + X.fmt(a)); X.toast('Versement enregistré', 'success'); X.rerender();
  };
  window.stuPickDay = function (d) { ST.day = (ST.day === d) ? '' : d; if (ST.day) { var f = $('stuDate'); if (f && !ST.editB) f.value = d; } X.rerender(); };
  window.stuMonth = function (delta) { ST.month = X.shiftMonth(ST.month || X.month(), delta); ST.day = ''; X.rerender(); };
  window.stuSet = function () {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var o = val('stsOpen'), c = val('stsClose'), d = num(val('stsDur')) * 60;
    if (isNaN(toMin(o)) || isNaN(toMin(c)) || toMin(c) <= toMin(o)) return X.toast('Heures d\'ouverture invalides', 'warning');
    S.set('studioSettings', { open: o, close: c, defaultMin: d > 0 ? Math.round(d) : 120, onePerDay: !!($('stsOne') && $('stsOne').checked) });
    X.toast('Réglages enregistrés', 'success'); X.rerender();
  };

  function bookingRow(b) {
    var p = payInfo(b), cancelled = b.status === 'annule', done = b.status === 'termine', past = b.date < X.today() && b.status === 'confirme';
    var stBadge = cancelled ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-200 text-gray-600">Annulé</span>' : done ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-700">Terminé</span>' : past ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Date passée — à clôturer</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-700">Confirmé</span>';
    var acts = '';
    if (!ro()) {
      if (!cancelled && !done) acts += '<button type="button" data-id="' + E(b.id) + '" onclick="stuStatus(this.dataset.id,\'termine\')" class="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold">Terminé</button> ';
      if (cancelled) acts += '<button type="button" data-id="' + E(b.id) + '" onclick="stuStatus(this.dataset.id,\'confirme\')" class="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold">Réactiver</button> ';
      else if (!done) acts += '<button type="button" data-id="' + E(b.id) + '" onclick="stuStatus(this.dataset.id,\'annule\')" class="px-2 py-1 rounded-lg bg-red-50 text-red-700 text-[11px] font-bold">Annuler</button> ';
      acts += '<button type="button" data-id="' + E(b.id) + '" onclick="stuEdit(this.dataset.id)" class="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-bold">Modifier</button> ';
      if (X.isAdmin()) acts += '<button type="button" data-id="' + E(b.id) + '" onclick="stuDelete(this.dataset.id)" class="px-2 py-1 rounded-lg bg-red-50 text-red-600 text-[11px] font-bold">✕</button>';
    }
    var payBox = (!ro() && !cancelled && p.k !== 'full') ? '<div class="flex gap-1 mt-2"><input id="stuPay_' + E(b.id) + '" type="number" min="0" placeholder="Versement DA" class="' + X.input + ' w-32 !p-1 text-xs"><button type="button" data-id="' + E(b.id) + '" onclick="stuPay(this.dataset.id)" class="px-2 py-1 rounded-lg bg-green-600 text-white text-[11px] font-bold">+ Verser</button></div>' : '';
    return '<div class="p-4 rounded-2xl border dark:border-gray-700 ' + (cancelled ? 'opacity-60 bg-gray-50 dark:bg-gray-900' : 'bg-white dark:bg-gray-800') + ' mb-3">' +
      '<div class="flex flex-wrap items-start justify-between gap-2"><div><div class="font-black text-gray-800 dark:text-white">' + E(b.start) + ' – ' + E(toHM(endOf(b))) + ' · ' + E(b.clientName) + '</div>' +
      '<div class="text-xs text-gray-500">' + E(dayName(b.date)) + (b.kind ? ' · ' + E(b.kind) : '') + '</div></div><div>' + stBadge + '</div></div>' +
      '<div class="flex flex-wrap items-center gap-2 mt-2">' + contactBtns(b) + '<span class="px-2 py-1 rounded-lg text-[11px] font-black ' + p.cls + '">' + p.label + '</span>' +
      '<span class="text-xs text-gray-600 dark:text-gray-300">Prix ' + X.fmt(b.price) + ' · versé ' + X.fmt(p.paid) + (p.rest > 0 ? ' · <b class="text-red-600">reste ' + X.fmt(p.rest) + '</b>' : '') + '</span></div>' +
      (b.note ? '<div class="text-xs text-gray-500 mt-1">' + E(b.note) + '</div>' : '') + payBox + '<div class="mt-2">' + acts + '</div></div>';
  }

  function monthGrid(ym) {
    var m = String(ym).match(/^(\d{4})-(\d{2})$/), y = Number(m[1]), mo = Number(m[2]) - 1, first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0).getDate(), lead = (first.getDay() + 6) % 7, today = X.today(), cells = '';
    var count = {}; bookings().forEach(function (b) { if (b.status !== 'annule' && String(b.date).slice(0, 7) === ym) count[b.date] = (count[b.date] || 0) + 1; });
    for (var i = 0; i < lead; i++) cells += '<div></div>';
    for (var d = 1; d <= last; d++) {
      var ymd = ym + '-' + String(d).padStart(2, '0'), n = count[ymd] || 0, sel = ST.day === ymd;
      cells += '<button type="button" data-d="' + ymd + '" onclick="stuPickDay(this.dataset.d)" class="relative aspect-square rounded-xl text-xs font-bold border ' + (sel ? 'bg-indigo-600 text-white border-indigo-600' : n ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700') + (ymd === today ? ' ring-2 ring-amber-400' : '') + '">' + d + (n ? '<span class="absolute bottom-0.5 right-1 text-[9px] font-black">' + n + '</span>' : '') + '</button>';
    }
    return '<div class="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-gray-400 mb-1"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div><div class="grid grid-cols-7 gap-1">' + cells + '</div>';
  }

  function renderStudio(c) {
    var ym = ST.month || (ST.month = X.month()), today = X.today(), all = bookings(), live = all.filter(function (b) { return b.status !== 'annule'; });
    var edit = ST.editB ? X.find(all, ST.editB) : null, cf = cfg();
    var todayN = live.filter(function (b) { return b.date === today && b.status === 'confirme'; }).length;
    var upN = live.filter(function (b) { return b.date >= today && b.status === 'confirme'; }).length;
    var unpaid = live.filter(function (b) { return b.status !== 'termine' || true; }).filter(function (b) { return payInfo(b).rest > 0; });
    var rest = unpaid.reduce(function (s, b) { return s + payInfo(b).rest; }, 0);
    var inMonth = all.filter(function (b) { return ST.day ? b.date === ST.day : String(b.date).slice(0, 7) === ym; }).sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; });
    var listHtml = '', last = '';
    inMonth.forEach(function (b) { if (b.date !== last) { last = b.date; listHtml += '<div class="text-xs font-black uppercase text-gray-500 mt-3 mb-2">' + E(dayName(b.date)) + (b.date === today ? ' · aujourd\'hui' : '') + '</div>'; } listHtml += bookingRow(b); });
    var v = edit || { clientName: '', phone: '', date: ST.day || today, start: '', durationMin: cf.defaultMin, kind: '', price: '', note: '' };
    var form = ro() ? '<p class="text-xs text-gray-500">Mode lecture seule.</p>' :
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
      '<label class="text-xs font-bold text-gray-600">Client<input id="stuName" list="stuClients" value="' + E(v.clientName) + '" onchange="stuClientPick(\'stuName\',\'stuPhone\')" class="' + X.input + ' w-full mt-1" placeholder="Nom du client"></label>' +
      '<label class="text-xs font-bold text-gray-600">Téléphone<input id="stuPhone" value="' + E(v.phone) + '" class="' + X.input + ' w-full mt-1" placeholder="05 / 06 / 07 …"></label>' +
      '<label class="text-xs font-bold text-gray-600">Type de séance<input id="stuKind" value="' + E(v.kind) + '" class="' + X.input + ' w-full mt-1" placeholder="ex. Shooting mode, portrait…"></label>' +
      '<label class="text-xs font-bold text-gray-600">Date<input id="stuDate" type="date" value="' + E(v.date) + '" onchange="stuSlotHint()" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Heure de début<input id="stuStart" type="time" value="' + E(v.start) + '" onchange="stuSlotHint()" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Durée (heures)<input id="stuDur" type="number" step="0.5" min="0.5" value="' + E(String(num(v.durationMin) / 60)) + '" onchange="stuSlotHint()" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Prix de la réservation (DA)<input id="stuPrice" type="number" min="0" value="' + E(v.price) + '" class="' + X.input + ' w-full mt-1"></label>' +
      (edit ? '<div class="text-xs text-gray-500 self-end pb-2">Les versements se gèrent dans la liste ci-dessous.</div>' : '<label class="text-xs font-bold text-gray-600">Versé maintenant (DA)<input id="stuPaid" type="number" min="0" value="" class="' + X.input + ' w-full mt-1" placeholder="0 si rien"></label>') +
      '<label class="text-xs font-bold text-gray-600">Note<input id="stuNote" value="' + E(v.note) + '" class="' + X.input + ' w-full mt-1" placeholder="optionnel"></label></div>' +
      '<div id="stuHint" class="mt-3"></div><div class="mt-3 flex gap-2">' + X.btn(edit ? 'Enregistrer les modifications' : 'Réserver le créneau', 'stuSave()', 'bg-indigo-600 text-white hover:bg-indigo-700', 'fa-calendar-check') + (edit ? X.btn('Annuler la modification', 'stuCancelEdit()', 'bg-gray-200 text-gray-700', 'fa-xmark') : '') + '</div>' + clientsDatalist('stuClients');
    var settings = X.isAdmin() && !ro() ? '<details class="mt-2"><summary class="text-xs font-bold text-gray-500 cursor-pointer">Réglages du studio</summary><div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 items-end">' +
      '<label class="text-xs font-bold text-gray-600">Ouverture<input id="stsOpen" type="time" value="' + cf.open + '" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Fermeture<input id="stsClose" type="time" value="' + cf.close + '" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Durée par défaut (h)<input id="stsDur" type="number" step="0.5" value="' + (cf.defaultMin / 60) + '" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600 flex items-center gap-2 pb-2"><input id="stsOne" type="checkbox"' + (cf.onePerDay ? ' checked' : '') + '> Un seul rendez-vous par jour</label>' +
      X.btn('Enregistrer', 'stuSet()', 'bg-gray-800 text-white', 'fa-floppy-disk') + '</div><p class="text-[11px] text-gray-400 mt-2">Heures d\'ouverture : servent aux créneaux proposés. Par défaut, deux rendez-vous ne peuvent pas se chevaucher le même jour ; cochez « un seul par jour » pour bloquer toute la journée dès qu\'un rendez-vous existe.</p></details>' : '';
    c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-camera text-indigo-600 mr-2"></i>Rendez-vous studio</h2><p class="text-xs text-gray-500 mt-1">Réservez un créneau : le site refuse tout rendez-vous qui se superpose à un autre.</p></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">' + X.kpi('Aujourd\'hui', todayN, '', 'fa-calendar-day') + X.kpi('À venir', upN, '', 'fa-calendar') + X.kpi('Réservations avec solde', unpaid.length, unpaid.length ? 'text-amber-600' : 'text-green-600', 'fa-hourglass-half') + X.kpi('Reste à encaisser', X.fmt(rest), rest > 0 ? 'text-red-600' : 'text-green-600', 'fa-coins') + '</div>' +
      X.card(edit ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous', 'fa-plus', form + settings) +
      X.card('Planning', 'fa-calendar-days', '<div class="grid grid-cols-1 md:grid-cols-3 gap-6"><div><div class="flex items-center justify-between mb-2"><button type="button" onclick="stuMonth(-1)" class="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 font-bold">‹</button><b class="text-sm">' + E(X.monthLabel(ym)) + '</b><button type="button" onclick="stuMonth(1)" class="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 font-bold">›</button></div>' + monthGrid(ym) +
        '<p class="text-[11px] text-gray-400 mt-2">Cliquez un jour pour filtrer et préremplir la date. Re-cliquez pour tout voir.</p></div><div class="md:col-span-2">' +
        (ST.day ? '<div class="text-xs mb-2"><b>' + E(dayName(ST.day)) + '</b> · <button type="button" onclick="stuPickDay(\'' + ST.day + '\')" class="text-indigo-600 font-bold">voir tout le mois</button></div>' : '') +
        (listHtml || '<p class="text-center text-gray-400 italic py-8">Aucun rendez-vous ' + (ST.day ? 'ce jour-là' : 'ce mois-ci') + '</p>') + '</div></div>');
    window.stuSlotHint();
  }
  X.registerTab('studio', { nav: { group: 'studio', groupLabel: 'Studio', groupIcon: 'fa-camera', label: 'Rendez-vous studio', icon: 'fa-calendar-check' }, render: renderStudio });

  // ================================================================ SHOOTING PRODUITS
  var SH_ST = { todo: 'À faire', shot: 'Shooting fait', edit: 'En retouche', done: 'Livré' };
  window.shtSave = function () {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var prod = val('shtProduct'), name = val('shtName'), del = val('shtDelivery'), sd = val('shtShootDate');
    if (!prod) return X.toast('Indiquez le produit', 'warning');
    if (!name) return X.toast('Indiquez le nom du client', 'warning');
    if (!X.isYmd(del)) return X.toast('Choisissez la date de remise du fichier final', 'warning');
    if (sd && X.isYmd(sd) && sd > del) return X.toast('La remise doit être après (ou le même jour que) le shooting', 'warning');
    var price = num(val('shtPrice')), first = num(val('shtPaid'));
    if (price < 0 || first < 0) return X.toast('Montant invalide', 'warning');
    var cl = clientByName(name), rec = ST.editS ? X.find(shoots(), ST.editS) : null;
    if (rec) { rec.product = prod; rec.clientName = name; rec.clientId = cl ? cl.id : (rec.clientId || ''); rec.phone = val('shtPhone'); rec.shootDate = sd; rec.deliveryDate = del; rec.price = price; rec.note = val('shtNote'); rec.updatedAt = Date.now(); X.log('Fiche shooting modifiée', prod + ' · ' + name); }
    else {
      rec = { id: X.uid('sht'), product: prod, clientName: name, clientId: cl ? cl.id : '', phone: val('shtPhone'), shootDate: sd, deliveryDate: del, price: price, payments: [], status: 'todo', note: val('shtNote'), createdAt: Date.now(), by: X.actor() };
      if (first > 0) rec.payments.push({ date: X.today(), amount: first, by: X.actor() });
      shoots().push(rec); X.log('Fiche shooting créée', prod + ' · ' + name + ' · remise ' + del);
    }
    ST.editS = ''; S.set('productShoots', shoots()); X.toast('Fiche enregistrée', 'success'); X.rerender();
  };
  window.shtEdit = function (id) { ST.editS = id; X.rerender(); setTimeout(function () { var f = $('shtProduct'); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); };
  window.shtCancelEdit = function () { ST.editS = ''; X.rerender(); };
  window.shtStatus = function (id, st) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var r = X.find(shoots(), id); if (!r || !SH_ST[st]) return;
    r.status = st; r.updatedAt = Date.now(); if (st === 'done') r.deliveredAt = X.today();
    S.set('productShoots', shoots()); X.log('Shooting produit : ' + SH_ST[st], r.product + ' · ' + r.clientName); X.rerender();
  };
  window.shtDelete = function (id) {
    if (!X.isAdmin() || ro()) return X.toast('Réservé à l\'administrateur', 'error');
    var r = X.find(shoots(), id); if (!r || !confirm('Supprimer définitivement cette fiche ?')) return;
    S.set('productShoots', shoots().filter(function (b) { return b.id !== id; })); X.log('Fiche shooting supprimée', r.product + ' · ' + r.clientName); X.rerender();
  };
  window.shtPay = function (id) {
    if (ro()) return X.toast('Mode lecture seule : modification impossible', 'warning');
    var r = X.find(shoots(), id), a = num(val('shtPay_' + id)); if (!r) return;
    if (!(a > 0)) return X.toast('Saisissez le montant versé', 'warning');
    r.payments = r.payments || []; r.payments.push({ date: X.today(), amount: a, by: X.actor() }); r.updatedAt = Date.now();
    S.set('productShoots', shoots()); X.log('Versement shooting', r.product + ' · ' + X.fmt(a)); X.toast('Versement enregistré', 'success'); X.rerender();
  };
  window.shtFilter = function (f) { ST.shFilter = f; X.rerender(); };

  function dueBadge(r) {
    if (r.status === 'done') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-green-100 text-green-700">Livré' + (r.deliveredAt ? ' le ' + X.fmtDate(r.deliveredAt) : '') + '</span>';
    var d = X.daysBetween(X.today(), r.deliveryDate);
    if (d < 0) return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700">En retard de ' + (-d) + ' j</span>';
    if (d === 0) return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700">À remettre aujourd\'hui</span>';
    if (d <= 2) return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Dans ' + d + ' j</span>';
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-gray-100 text-gray-600">Dans ' + d + ' j</span>';
  }
  function shootCard(r) {
    var p = payInfo(r), acts = '';
    if (!ro()) {
      acts = Object.keys(SH_ST).filter(function (k) { return k !== r.status; }).map(function (k) { return '<button type="button" data-id="' + E(r.id) + '" onclick="shtStatus(this.dataset.id,\'' + k + '\')" class="px-2 py-1 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-bold">→ ' + SH_ST[k] + '</button>'; }).join(' ') +
        ' <button type="button" data-id="' + E(r.id) + '" onclick="shtEdit(this.dataset.id)" class="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold">Modifier</button>' +
        (X.isAdmin() ? ' <button type="button" data-id="' + E(r.id) + '" onclick="shtDelete(this.dataset.id)" class="px-2 py-1 rounded-lg bg-red-50 text-red-600 text-[11px] font-bold">✕</button>' : '');
    }
    var payBox = (!ro() && p.k !== 'full') ? '<div class="flex gap-1 mt-2"><input id="shtPay_' + E(r.id) + '" type="number" min="0" placeholder="Versement DA" class="' + X.input + ' w-32 !p-1 text-xs"><button type="button" data-id="' + E(r.id) + '" onclick="shtPay(this.dataset.id)" class="px-2 py-1 rounded-lg bg-green-600 text-white text-[11px] font-bold">+ Verser</button></div>' : '';
    return '<div class="p-4 rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-800">' +
      '<div class="flex items-start justify-between gap-2"><div><div class="font-black text-gray-800 dark:text-white"><i class="fas fa-box mr-1 text-indigo-500"></i>' + E(r.product) + '</div><div class="text-sm text-gray-600 dark:text-gray-300">' + E(r.clientName) + '</div></div><span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-700">' + E(SH_ST[r.status] || 'À faire') + '</span></div>' +
      '<div class="flex flex-wrap items-center gap-2 mt-2">' + contactBtns(r) + '</div>' +
      '<div class="grid grid-cols-2 gap-2 mt-3 text-xs"><div class="p-2 rounded-xl bg-gray-50 dark:bg-gray-900"><div class="text-gray-400 font-bold">Shooting</div><b>' + (r.shootDate ? E(X.fmtDate(r.shootDate)) : '—') + '</b></div>' +
      '<div class="p-2 rounded-xl bg-gray-50 dark:bg-gray-900"><div class="text-gray-400 font-bold">Remise fichier final</div><b>' + E(X.fmtDate(r.deliveryDate)) + '</b> ' + dueBadge(r) + '</div></div>' +
      '<div class="flex flex-wrap items-center gap-2 mt-3"><span class="px-2 py-1 rounded-lg text-[11px] font-black ' + p.cls + '">' + p.label + '</span><span class="text-xs text-gray-600 dark:text-gray-300">Prix ' + X.fmt(r.price) + ' · versé ' + X.fmt(p.paid) + (p.rest > 0 ? ' · <b class="text-red-600">reste ' + X.fmt(p.rest) + '</b>' : '') + '</span></div>' +
      (r.note ? '<div class="text-xs text-gray-500 mt-2">' + E(r.note) + '</div>' : '') + payBox + '<div class="mt-3 flex flex-wrap gap-1">' + acts + '</div></div>';
  }
  function renderShoots(c) {
    var all = shoots(), today = X.today(), edit = ST.editS ? X.find(all, ST.editS) : null, f = ST.shFilter;
    var open = all.filter(function (r) { return r.status !== 'done'; }), late = open.filter(function (r) { return r.deliveryDate < today; }), soon = open.filter(function (r) { var d = X.daysBetween(today, r.deliveryDate); return d >= 0 && d <= 2; });
    var rest = all.reduce(function (s, r) { return s + payInfo(r).rest; }, 0);
    var shown = all.filter(function (r) { return f === 'all' ? true : f === 'done' ? r.status === 'done' : f === 'unpaid' ? payInfo(r).rest > 0 : r.status !== 'done'; })
      .sort(function (a, b) { return a.status === 'done' && b.status !== 'done' ? 1 : b.status === 'done' && a.status !== 'done' ? -1 : String(a.deliveryDate) < String(b.deliveryDate) ? -1 : 1; });
    var v = edit || { product: '', clientName: '', phone: '', shootDate: '', deliveryDate: '', price: '', note: '' };
    var form = ro() ? '<p class="text-xs text-gray-500">Mode lecture seule.</p>' :
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
      '<label class="text-xs font-bold text-gray-600">Produit<input id="shtProduct" value="' + E(v.product) + '" class="' + X.input + ' w-full mt-1" placeholder="ex. Parfum, sac, robe…"></label>' +
      '<label class="text-xs font-bold text-gray-600">Client<input id="shtName" list="shtClients" value="' + E(v.clientName) + '" onchange="stuClientPick(\'shtName\',\'shtPhone\')" class="' + X.input + ' w-full mt-1" placeholder="Nom du client"></label>' +
      '<label class="text-xs font-bold text-gray-600">Contact (téléphone)<input id="shtPhone" value="' + E(v.phone) + '" class="' + X.input + ' w-full mt-1" placeholder="05 / 06 / 07 …"></label>' +
      '<label class="text-xs font-bold text-gray-600">Date du shooting<input id="shtShootDate" type="date" value="' + E(v.shootDate) + '" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Remise du fichier final<input id="shtDelivery" type="date" value="' + E(v.deliveryDate) + '" class="' + X.input + ' w-full mt-1"></label>' +
      '<label class="text-xs font-bold text-gray-600">Prix (DA)<input id="shtPrice" type="number" min="0" value="' + E(v.price) + '" class="' + X.input + ' w-full mt-1"></label>' +
      (edit ? '<div class="text-xs text-gray-500 self-end pb-2">Les versements se gèrent sur la fiche.</div>' : '<label class="text-xs font-bold text-gray-600">Versé maintenant (DA)<input id="shtPaid" type="number" min="0" class="' + X.input + ' w-full mt-1" placeholder="0 si rien"></label>') +
      '<label class="text-xs font-bold text-gray-600 md:col-span-2">Note<input id="shtNote" value="' + E(v.note) + '" class="' + X.input + ' w-full mt-1" placeholder="optionnel (consignes, nombre de photos…)"></label></div>' +
      '<div class="mt-3 flex gap-2">' + X.btn(edit ? 'Enregistrer les modifications' : 'Créer la fiche produit', 'shtSave()', 'bg-indigo-600 text-white hover:bg-indigo-700', 'fa-box') + (edit ? X.btn('Annuler la modification', 'shtCancelEdit()', 'bg-gray-200 text-gray-700', 'fa-xmark') : '') + '</div>' + clientsDatalist('shtClients');
    var tabs = [['open', 'En cours'], ['unpaid', 'Solde à encaisser'], ['done', 'Livrés'], ['all', 'Tous']].map(function (t) { return '<button type="button" onclick="shtFilter(\'' + t[0] + '\')" class="px-3 py-1.5 rounded-full text-xs font-bold ' + (f === t[0] ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700') + '">' + t[1] + '</button>'; }).join(' ');
    c.innerHTML = '<div class="mb-4"><h2 class="text-2xl font-bold text-gray-800 dark:text-white"><i class="fas fa-box-open text-indigo-600 mr-2"></i>Shooting produits</h2><p class="text-xs text-gray-500 mt-1">Une fiche par produit : contact du client, date de remise du fichier final, versements et statut.</p></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">' + X.kpi('En cours', open.length, '', 'fa-clapperboard') + X.kpi('Remises en retard', late.length, late.length ? 'text-red-600' : 'text-green-600', 'fa-triangle-exclamation') + X.kpi('À remettre sous 2 jours', soon.length, soon.length ? 'text-amber-600' : '', 'fa-clock') + X.kpi('Reste à encaisser', X.fmt(rest), rest > 0 ? 'text-red-600' : 'text-green-600', 'fa-coins') + '</div>' +
      X.card(edit ? 'Modifier la fiche' : 'Nouvelle fiche produit', 'fa-plus', form) +
      X.card('Fiches', 'fa-folder-open', '<div class="flex flex-wrap gap-2 mb-4">' + tabs + '</div>' + (shown.length ? '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + shown.map(shootCard).join('') + '</div>' : '<p class="text-center text-gray-400 italic py-8">Aucune fiche</p>'));
  }
  X.registerTab('shootings', { nav: { group: 'studio', groupLabel: 'Studio', groupIcon: 'fa-camera', label: 'Shooting produits', icon: 'fa-box-open' }, render: renderShoots });

  // ================================================================ alertes (cloche)
  var _prev = window.GuardsAlerts;
  window.GuardsAlerts = function (add, admin) {
    if (typeof _prev === 'function') { try { _prev(add, admin); } catch (e) {} }
    try {
      var today = X.today(), tomorrow = X.addDays(today, 1), bk = bookings().filter(function (b) { return b.status === 'confirme'; });
      var t = bk.filter(function (b) { return b.date === today; }), tm = bk.filter(function (b) { return b.date === tomorrow; });
      if (t.length) add('warn', 'fa-camera', t.length + ' rendez-vous studio aujourd\'hui', t.map(function (b) { return b.start + ' ' + b.clientName; }).slice(0, 3).join(', '), 'studio', t.length);
      if (tm.length) add('info', 'fa-camera', tm.length + ' rendez-vous studio demain', tm.map(function (b) { return b.start + ' ' + b.clientName; }).slice(0, 3).join(', '), 'studio', tm.length);
      var soonUnpaid = bk.filter(function (b) { return b.date >= today && b.date <= X.addDays(today, 2) && payInfo(b).rest > 0; });
      if (soonUnpaid.length) add('warn', 'fa-coins', soonUnpaid.length + ' rendez-vous proche(s) avec solde à encaisser', soonUnpaid.map(function (b) { return b.clientName + ' (' + X.fmt(payInfo(b).rest) + ')'; }).slice(0, 3).join(', '), 'studio', soonUnpaid.length);
      var late = shoots().filter(function (r) { return r.status !== 'done' && r.deliveryDate && r.deliveryDate < today; });
      if (late.length) add('danger', 'fa-box-open', late.length + ' remise(s) de fichier final en retard', late.map(function (r) { return r.product + ' (' + r.clientName + ')'; }).slice(0, 3).join(', '), 'shootings', late.length);
      var soon = shoots().filter(function (r) { var d = r.deliveryDate ? X.daysBetween(today, r.deliveryDate) : 99; return r.status !== 'done' && d >= 0 && d <= 2; });
      if (soon.length) add('warn', 'fa-box-open', soon.length + ' fichier(s) à remettre sous 2 jours', soon.map(function (r) { return r.product + ' (' + r.clientName + ')'; }).slice(0, 3).join(', '), 'shootings', soon.length);
    } catch (e) { console.warn('StudioAlerts', e); }
  };

  window.CrmStudio = { findConflict: findConflict, freeSlots: freeSlots, payInfo: payInfo };
  function boot() { if (X.installTabs) X.installTabs(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
