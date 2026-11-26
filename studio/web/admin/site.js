// Page Équipe → « Site client » (admin) : photos affichées, textes dans les 3 langues,
// catalogues en carrousel. Rien n'est visible des clients avant « Enregistrer et publier ».
import { doc, getDoc, setDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { SLOTS, TEXTS, MAX_CAROUSELS, MAX_SLIDES, shrinkImage, mediaLoader } from "../lib/sitecontent.js";
import { defaultText } from "../lib/i18n.js";
import { randomId } from "../lib/studio-core.js";
import { PHOTOS } from "../lib/vitrine.js";

const LANGS = [["fr", "Français"], ["ar", "العربية"], ["en", "English"]];
const empty = () => ({ photos: {}, texts: { fr: {}, ar: {}, en: {} }, carousels: [] });
const clone = (o) => JSON.parse(JSON.stringify(o));

export function initSitePanel({ db, me, audit, show, busy, $, el }) {
  const media = mediaLoader(db, { doc, getDoc });
  let saved = empty();   // ce qui est publié
  let state = empty();   // ce qui est en cours de modification
  const uploaded = new Set(); // photos envoyées pendant cette visite

  const thumb = (id, cls = "sthumb") => {
    const img = el("img", { className: cls, alt: "" });
    media(id).then((src) => { if (src) img.src = src; });
    return img;
  };

  async function upload(file) {
    const m = await shrinkImage(file);
    const id = randomId(20);
    await setDoc(doc(db, "siteMedia", id), { ...m, createdAt: serverTimestamp(), createdBy: me.uid });
    uploaded.add(id);
    return id;
  }
  const filePicker = (multiple, onFiles) => {
    const input = el("input", { type: "file", accept: "image/*", multiple, hidden: true });
    input.onchange = () => { const files = [...input.files]; input.value = ""; if (files.length) onFiles(files); };
    return input;
  };

  // ---------- Photos ----------
  function renderPhotos() {
    $("sPhotos").replaceChildren(...SLOTS.map(([slot, label]) => {
      const id = state.photos[slot];
      const box = el("div", { className: "sslot" }, el("b", { textContent: label }));
      // Sans choix : la photo par défaut du site (fichier img/), ou l'image dessinée.
      const def = PHOTOS[slot] ? el("img", { className: "sthumb big", alt: "", src: "../" + PHOTOS[slot] }) : el("div", { className: "sthumb big", textContent: "Image dessinée" });
      box.append(id ? thumb(id, "sthumb big") : def, el("span", { className: "mute small", textContent: id ? "Photo choisie" : "Photo par défaut" }));
      const pick = filePicker(false, ([f]) => busy(change, async () => { state.photos[slot] = await upload(f); renderPhotos(); }));
      const change = el("button", { textContent: id ? "Changer la photo" : "Choisir une photo" });
      change.onclick = () => pick.click();
      box.append(el("div", { className: "inline" }, change, pick));
      if (id) {
        const reset = el("button", { className: "link", textContent: "Remettre la photo par défaut" });
        reset.onclick = () => { delete state.photos[slot]; renderPhotos(); };
        box.lastChild.append(reset);
      }
      return box;
    }));
  }

  // ---------- Textes ----------
  function renderTexts() {
    const head = el("tr", {}, el("th", { textContent: "Texte" }), ...LANGS.map(([, l]) => el("th", { textContent: l })));
    const rows = TEXTS.map(([key, label]) => el("tr", {}, el("td", { textContent: label }), ...LANGS.map(([lg]) => {
      const long = defaultText(lg, key).length > 60;
      const input = el(long ? "textarea" : "input", { value: state.texts[lg][key] || "", placeholder: defaultText(lg, key), rows: 2, maxLength: 300 });
      if (lg === "ar") input.dir = "rtl";
      input.oninput = () => { const v = input.value.trim(); if (v) state.texts[lg][key] = input.value; else delete state.texts[lg][key]; };
      return el("td", {}, input);
    })));
    $("sTexts").replaceChildren(el("table", { className: "stexts" }, el("thead", {}, head), el("tbody", {}, ...rows)));
  }

  // ---------- Catalogues (carrousels) ----------
  const langInputs = (obj, tag, ph) => el("div", { className: "slangs" }, ...LANGS.map(([lg, l]) => {
    const input = el(tag, { value: obj[lg] || "", placeholder: `${ph} (${l})`, maxLength: tag === "input" ? 80 : 300, rows: 2 });
    if (lg === "ar") input.dir = "rtl";
    input.oninput = () => { obj[lg] = input.value; };
    return input;
  }));
  function renderCars() {
    const list = state.carousels;
    $("sCars").replaceChildren(...list.map((car, i) => {
      const box = el("div", { className: "scar" });
      const move = (d) => { list.splice(i + d, 0, list.splice(i, 1)[0]); renderCars(); };
      const tools = el("div", { className: "inline" });
      if (i > 0) tools.append(Object.assign(el("button", { textContent: "↑ Monter" }), { onclick: () => move(-1) }));
      if (i < list.length - 1) tools.append(Object.assign(el("button", { textContent: "↓ Descendre" }), { onclick: () => move(1) }));
      tools.append(Object.assign(el("button", { className: "link", textContent: "Supprimer ce catalogue" }), {
        onclick: () => { if (confirm("Supprimer ce catalogue et ses photos (après « Enregistrer et publier ») ?")) { list.splice(i, 1); renderCars(); } },
      }));
      box.append(el("b", { textContent: `Catalogue ${i + 1}` }), tools, langInputs(car.title, "input", "Titre"), langInputs(car.caption, "textarea", "Description"));
      const strip = el("div", { className: "sstrip" }, ...car.media.map((id, j) => {
        const cell = el("div", { className: "scell" }, thumb(id));
        const bar = el("div", { className: "sbar" });
        const mv = (d) => { car.media.splice(j + d, 0, car.media.splice(j, 1)[0]); renderCars(); };
        if (j > 0) bar.append(Object.assign(el("button", { textContent: "←", title: "Avant" }), { onclick: () => mv(-1) }));
        if (j < car.media.length - 1) bar.append(Object.assign(el("button", { textContent: "→", title: "Après" }), { onclick: () => mv(1) }));
        bar.append(Object.assign(el("button", { textContent: "✕", title: "Retirer" }), { onclick: () => { car.media.splice(j, 1); renderCars(); } }));
        cell.append(bar);
        return cell;
      }));
      const add = el("button", { textContent: "+ Ajouter des photos" });
      const pick = filePicker(true, (files) => busy(add, async () => {
        const room = MAX_SLIDES - car.media.length;
        if (files.length > room) show(`Au plus ${MAX_SLIDES} photos par catalogue : ${Math.max(0, room)} ajoutée(s).`, true);
        for (const f of files.slice(0, Math.max(0, room))) { car.media.push(await upload(f)); renderCars(); }
      }));
      add.onclick = () => pick.click();
      box.append(strip, el("div", { className: "inline" }, add, pick, el("span", { className: "mute small", textContent: `${car.media.length} / ${MAX_SLIDES} photos — faites glisser côté client, comme un carrousel Instagram.` })));
      return box;
    }));
  }
  $("sAddCar").onclick = () => {
    if (state.carousels.length >= MAX_CAROUSELS) return show(`Au plus ${MAX_CAROUSELS} catalogues.`, true);
    state.carousels.push({ id: randomId(8), title: { fr: "", ar: "", en: "" }, caption: { fr: "", ar: "", en: "" }, media: [] });
    renderCars();
  };

  function renderAll() { renderPhotos(); renderTexts(); renderCars(); }

  const used = (s) => new Set([...Object.values(s.photos).filter(Boolean), ...s.carousels.flatMap((c) => c.media)]);

  $("sSave").onclick = (e) => busy(e.target, async () => {
    const empties = state.carousels.filter((c) => !c.media.length).length;
    if (empties && !confirm(`${empties} catalogue(s) sans photo ne seront pas affichés. Enregistrer quand même ?`)) return;
    const after = used(state);
    // Photos qui ne servent plus : supprimées en même temps (place libérée dans la base).
    const drop = [...new Set([...used(saved), ...uploaded])].filter((id) => !after.has(id));
    const w = writeBatch(db);
    const auditId = audit(w, "site.save", "publicSettings", "site", null, { photos: Object.keys(state.photos).length, texts: Object.values(state.texts).reduce((n, o) => n + Object.keys(o).length, 0), carousels: state.carousels.length, removedMedia: drop.length });
    w.set(doc(db, "publicSettings", "site"), { ...clone(state), updatedAt: serverTimestamp(), auditId });
    for (const id of drop) w.delete(doc(db, "siteMedia", id));
    await w.commit();
    drop.forEach((id) => uploaded.delete(id));
    saved = clone(state);
    show("Site client publié : les clients voient les nouvelles photos, les textes et les catalogues.");
  });
  $("sReset").onclick = () => { state = clone(saved); renderAll(); show("Modifications annulées."); };

  return async function load() {
    const s = await getDoc(doc(db, "publicSettings", "site"));
    const d = s.exists() ? s.data() : {};
    saved = { photos: d.photos || {}, texts: { fr: {}, ar: {}, en: {}, ...(d.texts || {}) }, carousels: d.carousels || [] };
    state = clone(saved);
    renderAll();
  };
}
