/**
 * Publication du catalogue (admin) et calcul de prix (public).
 *
 * Le catalogue en vigueur est `publicSettings/catalog` (lisible par le site
 * client). Chaque version publiée est aussi gardée dans `catalogVersions/` :
 * une commande garde la version de son instantané, et l'historique montre
 * quel tarif était en vigueur à quelle date.
 */
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "./lib/audit";
import { AppError, invalid } from "./lib/errors";
import { Caller, staffActor } from "./lib/roles";
import { runTx } from "./lib/tx";
import { Catalog, DEFAULT_CATALOG, assertCatalog } from "./pricing/catalog";
import { Pricing, priceCart } from "./pricing/engine";
import { studioFromGrid } from "./pricing/studioGrid";
import { utcMsToAlgiers } from "./lib/time";
import { Deps, requireActiveRole } from "./staff";

export const CATALOG_DOC = "publicSettings/catalog";

export async function loadCatalog(db: Firestore): Promise<Catalog> {
  const snap = await db.doc(CATALOG_DOC).get();
  if (!snap.exists) throw new AppError("failed-precondition", "Le catalogue n'est pas encore publié.");
  return snap.get("catalog") as Catalog;
}

export async function publishCatalog(
  deps: Deps,
  callerIn: Caller | null,
  data: { catalog?: unknown },
): Promise<{ version: string }> {
  const caller = await requireActiveRole(deps, callerIn, ["admin"]);
  const catalog = assertCatalog(data.catalog);
  const now = deps.now();
  await runTx(deps.db, async (tx) => {
    const ref = deps.db.doc(CATALOG_DOC);
    const versionRef = deps.db.collection("catalogVersions").doc(catalog.version);
    const [cur, existing] = await tx.getAll(ref, versionRef);
    if (existing.exists) throw new AppError("already-exists", "Cette version existe déjà : changez le nom de version.");
    const before = cur.exists ? (cur.get("catalog") as Catalog).version : null;
    tx.set(ref, { catalog, publishedAt: now, publishedBy: caller.uid });
    tx.create(versionRef, { catalog, publishedAt: now, publishedBy: caller.uid, replaced: before });
    writeAudit(deps.db, tx, {
      actor: staffActor(caller),
      action: "catalog.publish",
      entity: "publicSettings",
      entityId: "catalog",
      before: { version: before },
      after: { version: catalog.version, provisional: catalog.provisional },
    });
  });
  return { version: catalog.version };
}

/** Premier démarrage : publie les tarifs provisoires si aucun catalogue n'existe. */
export async function seedDefaultCatalog(deps: Deps, callerIn: Caller | null): Promise<{ version: string }> {
  await requireActiveRole(deps, callerIn, ["admin"]);
  const snap = await deps.db.doc(CATALOG_DOC).get();
  if (snap.exists) throw new AppError("already-exists", "Un catalogue est déjà publié.");
  return publishCatalog(deps, callerIn, { catalog: DEFAULT_CATALOG });
}

/**
 * L'admin modifie la grille de tarifs du studio (jours × tranches horaires,
 * options, durée minimale…) depuis la page d'administration. Les autres
 * services du catalogue ne changent pas. Publie une nouvelle version datée.
 */
export async function updateStudioRates(
  deps: Deps,
  callerIn: Caller | null,
  data: { grid?: unknown; provisional?: unknown },
): Promise<{ version: string }> {
  await requireActiveRole(deps, callerIn, ["admin"]);
  if (typeof data.provisional !== "boolean") invalid("Indiquez si les tarifs sont provisoires.");
  const snap = await deps.db.doc(CATALOG_DOC).get();
  const current: Catalog = snap.exists ? (snap.get("catalog") as Catalog) : DEFAULT_CATALOG;
  const studio = studioFromGrid(data.grid, current.studio);
  const t = utcMsToAlgiers(deps.now().toMillis());
  const version = `studio-${t.date}-${t.hm}-${deps.now().toMillis() % 100000}`;
  const next = assertCatalog({ ...current, version, provisional: data.provisional, studio });
  return publishCatalog(deps, callerIn, { catalog: next });
}

/** Estimation de prix pour le site client (aucune connexion requise). */
export async function quote(db: Firestore, data: { cart?: unknown }, now: Timestamp): Promise<Pricing> {
  if (data === null || typeof data !== "object") invalid("Requête invalide.");
  const catalog = await loadCatalog(db);
  return priceCart(catalog, data.cart, now.toMillis());
}
