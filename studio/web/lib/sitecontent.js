// Contenu du site client choisi par l'équipe (page Équipe → « Site client ») :
// photos affichées, textes dans les 3 langues, catalogues en carrousel.
// Tout est dans Firestore : publicSettings/site, et une photo par document siteMedia/{id}.

/** Emplacements de photos sur la page d'accueil. */
export const SLOTS = [
  ["hero", "Grand visuel du haut"],
  ["product", "Carte « Shooting produit »"],
  ["editing", "Carte « Montage »"],
  ["video", "Carte « Vidéo »"],
  ["ad", "Carte « Pub »"],
];

/** Textes modifiables (clé du dictionnaire, libellé pour l'équipe). */
export const TEXTS = [
  ["vTitle1", "Grand titre — ligne 1"],
  ["vTitle2", "Grand titre — ligne 2 (en couleur)"],
  ["vLead", "Phrase sous le grand titre"],
  ["vCta", "Bouton principal du haut"],
  ["vCta2", "Second bouton du haut"],
  ["vSvcTitle", "Titre « Nos services »"],
  ["vSvcLead", "Phrase sous « Nos services »"],
  ["tab_product", "Shooting produit — nom"],
  ["tabd_product", "Shooting produit — description"],
  ["tab_editing", "Montage — nom"],
  ["tabd_editing", "Montage — description"],
  ["tab_video", "Vidéo — nom"],
  ["tabd_video", "Vidéo — description"],
  ["tab_ad", "Pub — nom"],
  ["tabd_ad", "Pub — description"],
  ["tab_studio", "Location studio — nom"],
  ["tabd_studio", "Location studio — description"],
  ["vCarTitle", "Titre des catalogues"],
  ["vCarLead", "Phrase sous le titre des catalogues"],
  ["vFab", "Bouton flottant (location du studio)"],
  ["vFabSub", "Bouton flottant — petite ligne"],
  ["vBookTitle", "Titre « Réserver »"],
  ["intro", "Phrase d'introduction de la réservation"],
];

export const MAX_CAROUSELS = 30;
export const MAX_SLIDES = 20;
const MAX_B64 = 900000; // un document Firestore fait au plus 1 Mo

export const mediaSrc = (m) => `data:${m.type};base64,${m.data}`;

/** Texte d'un champ { fr, ar, en } dans la langue voulue, avec repli sur les autres langues. */
export const pick = (o, lang) => (o && (o[lang] || o.fr || o.en || o.ar)) || "";

/**
 * Réduit une photo dans le navigateur (1600 px au plus, JPEG) pour qu'elle tienne
 * dans un document Firestore. Renvoie { type, data (base64), w, h }.
 */
export async function shrinkImage(file, max = 1600) {
  if (!file.type.startsWith("image/")) throw new Error(`« ${file.name} » n'est pas une image.`);
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const url = c.toDataURL("image/jpeg", q);
      const data = url.slice(url.indexOf(",") + 1);
      if (data.length <= MAX_B64) { bmp.close?.(); return { type: "image/jpeg", data, w, h }; }
    }
    scale *= 0.8;
  }
  bmp.close?.();
  throw new Error(`« ${file.name} » est trop lourde, même réduite.`);
}

/** Lecture des photos avec cache (une lecture par photo). */
export function mediaLoader(db, { doc, getDoc }) {
  const cache = new Map();
  return (id) => {
    if (!id) return Promise.resolve(null);
    if (!cache.has(id)) {
      cache.set(id, getDoc(doc(db, "siteMedia", id)).then((s) => (s.exists() ? mediaSrc(s.data()) : null)).catch(() => null));
    }
    return cache.get(id);
  };
}
