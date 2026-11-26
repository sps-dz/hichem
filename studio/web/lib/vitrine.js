// Animations de la page d'accueil « Plateau » : projecteur qui suit la souris,
// titre qui monte mot à mot, halo sur les cartes, images.

// Vraies photos du studio : mettre le fichier dans web/img/ et son nom ici
// (par exemple hero: "img/hero.jpg"). Tant qu'une photo manque, une image
// d'attente dessinée est affichée à sa place.
export const PHOTOS = {
  // Photos d'exemple en attendant celles du studio : à remplacer par vos propres photos.
  hero: "img/hero.jpg",       // grand visuel du haut (portrait ou plateau éclairé)
  product: "img/product.jpg", // shooting produit
  editing: "img/editing.jpg", // montage
  video: "img/video.jpg",     // vidéo / reels
  ad: null,       // pub
};

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Image d'attente : lumière chaude sur fond sombre, avec un sujet simple.
function placeholder(kind) {
  const c = document.createElement("canvas"); const w = 800, h = 1000; c.width = w; c.height = h;
  const g = c.getContext("2d");
  const pal = { bg1: "#5a3a1f", bg2: "#0d0a08", fig: "#22170f", key: "#ffb760", floor: "rgba(0,0,0,.7)" };
  const gr = g.createRadialGradient(w * .62, h * .35, 20, w * .5, h * .5, h * .8);
  gr.addColorStop(0, pal.bg1); gr.addColorStop(1, pal.bg2); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const floor = g.createLinearGradient(0, h * .68, 0, h); floor.addColorStop(0, "rgba(0,0,0,0)"); floor.addColorStop(1, pal.floor);
  g.fillStyle = floor; g.fillRect(0, h * .6, w, h * .4);
  if (kind === "portrait") {
    g.save(); g.filter = "blur(1.5px)";
    const fig = g.createLinearGradient(w * .3, 0, w * .75, 0); fig.addColorStop(0, pal.fig); fig.addColorStop(.75, pal.fig); fig.addColorStop(1, pal.key);
    g.fillStyle = fig;
    g.beginPath(); g.ellipse(w * .6, h * .36, 104, 130, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(w * .22, h); g.bezierCurveTo(w * .26, h * .62, w * .44, h * .56, w * .6, h * .55); g.bezierCurveTo(w * .78, h * .56, w * .94, h * .62, w * .98, h); g.closePath(); g.fill();
    g.fillRect(w * .55, h * .44, w * .1, h * .14);
    g.restore();
    g.globalCompositeOperation = "screen"; g.strokeStyle = pal.key; g.globalAlpha = .55; g.lineWidth = 6; g.filter = "blur(4px)";
    g.beginPath(); g.ellipse(w * .6, h * .36, 104, 130, 0, -1.2, .9); g.stroke();
  } else if (kind === "bottle") {
    g.save(); g.filter = "blur(18px)"; g.fillStyle = "rgba(0,0,0,.45)"; g.beginPath(); g.ellipse(w * .5, h * .8, 200, 34, 0, 0, Math.PI * 2); g.fill(); g.restore();
    const body = g.createLinearGradient(w * .34, 0, w * .66, 0);
    body.addColorStop(0, pal.fig); body.addColorStop(.18, pal.key); body.addColorStop(.3, pal.fig); body.addColorStop(.8, pal.fig); body.addColorStop(.92, "rgba(255,255,255,.7)"); body.addColorStop(1, pal.fig);
    g.fillStyle = body; g.globalAlpha = .95;
    g.beginPath(); g.roundRect(w * .33, h * .36, w * .34, h * .44, 30); g.fill();
    g.fillStyle = pal.fig; g.beginPath(); g.roundRect(w * .44, h * .28, w * .12, h * .09, 6); g.fill();
    const cap = g.createLinearGradient(w * .4, 0, w * .6, 0); cap.addColorStop(0, "#222"); cap.addColorStop(.4, "#bbb"); cap.addColorStop(1, "#111");
    g.fillStyle = cap; g.beginPath(); g.roundRect(w * .41, h * .2, w * .18, h * .09, 8); g.fill();
  } else if (kind === "timeline") {
    // Montage : pistes d'une timeline éclairées.
    const rows = [[.2, .62, .42], [.5, .3, .7], [.35, .55, .78], [.15, .4, .6]];
    rows.forEach(([a, b, c2], i) => {
      const y = h * (.32 + i * .1);
      g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(w * .08, y, w * .84, h * .065);
      g.fillStyle = i % 2 ? pal.key : "#d98a3a"; g.globalAlpha = .85;
      g.beginPath(); g.roundRect(w * a, y + 4, w * (b - a + .12), h * .065 - 8, 6); g.fill();
      g.beginPath(); g.roundRect(w * c2, y + 4, w * .12, h * .065 - 8, 6); g.fill();
      g.globalAlpha = 1;
    });
    g.fillStyle = "#fff"; g.fillRect(w * .58, h * .26, 4, h * .46);
    g.beginPath(); g.moveTo(w * .58 - 14, h * .26); g.lineTo(w * .58 + 18, h * .26); g.lineTo(w * .58 + 2, h * .29); g.fill();
  } else if (kind === "reel") {
    // Vidéo : un téléphone vertical en lumière.
    g.save(); g.shadowColor = pal.key; g.shadowBlur = 80;
    g.fillStyle = "#18110b"; g.beginPath(); g.roundRect(w * .34, h * .18, w * .32, h * .62, 36); g.fill(); g.restore();
    const scr = g.createLinearGradient(0, h * .2, 0, h * .78); scr.addColorStop(0, "#ffcf8a"); scr.addColorStop(1, "#7a3d12");
    g.fillStyle = scr; g.beginPath(); g.roundRect(w * .355, h * .2, w * .29, h * .58, 26); g.fill();
    g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.moveTo(w * .47, h * .43); g.lineTo(w * .56, h * .49); g.lineTo(w * .47, h * .55); g.fill();
  } else {
    // Pub / plateau : projecteur, pied et table.
    g.save(); g.shadowColor = pal.key; g.shadowBlur = 90; g.fillStyle = pal.key; g.globalAlpha = .95;
    g.beginPath(); g.moveTo(w * .18, h * .2); g.lineTo(w * .42, h * .16); g.lineTo(w * .44, h * .42); g.lineTo(w * .2, h * .44); g.closePath(); g.fill(); g.restore();
    g.strokeStyle = pal.fig; g.lineWidth = 7; g.beginPath(); g.moveTo(w * .31, h * .44); g.lineTo(w * .31, h * .82); g.lineTo(w * .22, h * .9); g.moveTo(w * .31, h * .82); g.lineTo(w * .4, h * .9); g.stroke();
    g.fillStyle = pal.fig; g.globalAlpha = .9; g.beginPath(); g.roundRect(w * .58, h * .6, w * .18, h * .05, 4); g.fill(); g.fillRect(w * .6, h * .65, 8, h * .2); g.fillRect(w * .72, h * .65, 8, h * .2);
  }
  return c.toDataURL("image/jpeg", .82);
}

const SHOT = { hero: "portrait", product: "bottle", editing: "timeline", video: "reel", ad: "set" };
export function fillPhotos(root = document) {
  root.querySelectorAll("img[data-photo]").forEach((img) => {
    const k = img.dataset.photo;
    img.src = PHOTOS[k] || placeholder(SHOT[k] || "set");
  });
}

/** Titre qui monte mot à mot ; la 2e ligne est « allumée ». */
export function riseTitle(el, line1, line2) {
  let i = 0;
  const words = (s, hot) => s.split(/\s+/).filter(Boolean).map((w) => {
    const outer = document.createElement("span"); outer.className = "w";
    const inner = document.createElement("span"); inner.textContent = w; inner.style.animationDelay = (i++ * .09) + "s";
    if (hot) inner.className = "hot";
    outer.append(inner);
    return [outer, " "];
  }).flat();
  el.replaceChildren(...words(line1, false), document.createElement("br"), ...words(line2, true));
}

/** Le projecteur suit la souris ou le doigt ; sans geste, il balaie doucement tout seul. */
export function beam(hero) {
  const set = (x, y) => { hero.style.setProperty("--x", x + "%"); hero.style.setProperty("--y", y + "%"); };
  let moved = false;
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect(); moved = true;
    set(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  hero.addEventListener("pointerleave", () => (moved = false));
  if (reduce) return;
  const t0 = performance.now();
  const tick = (now) => {
    if (!moved && hero.isConnected) { const s = (now - t0) / 1000; set(58 + Math.sin(s * .5) * 22, 38 + Math.sin(s * .8) * 12); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Halo de lumière qui suit la souris sur une carte. */
export function glow(card) {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--ox", e.clientX - r.left + "px"); card.style.setProperty("--oy", e.clientY - r.top + "px");
  });
}
