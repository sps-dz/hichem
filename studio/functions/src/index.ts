/**
 * Point d'entrée des Cloud Functions du studio (phases 2 et 3).
 *
 * Appelables (depuis le tableau de bord, connecté) :
 *   staffBootstrapAdmin  — le premier admin (e-mail vérifié listé dans ADMIN_EMAILS)
 *   staffCreate          — l'admin crée un compte employé / comptable / admin
 *   staffSetRole         — l'admin change un rôle
 *   staffSetDisabled     — l'admin désactive ou réactive un compte
 *   catalogSeedDefaults  — l'admin publie les tarifs provisoires (premier démarrage)
 *   catalogPublish       — l'admin publie une nouvelle version du catalogue
 *   catalogUpdateStudioRates — l'admin modifie la grille de tarifs du studio
 *
 * Appelable publique (site client, sans connexion) :
 *   pricingQuote         — calcule le prix d'un panier sur le serveur
 *
 * Planifiées :
 *   releaseExpiredSlotHolds — toutes les 5 min, libère les blocages de 60 min expirés
 *   dailyFirestoreBackup    — chaque nuit à 03:00 (Alger), export complet de la base
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { v1 } from "@google-cloud/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

import { toHttps } from "./lib/callable";
import { callerFromToken } from "./lib/roles";
import { releaseExpiredHolds } from "./lib/slots";
import { STUDIO_TZ } from "./lib/time";
import { AuthPort, Deps, parseEmailList, bootstrapAdmin, createStaff, setStaffDisabled, setStaffRole } from "./staff";
import { runDailyBackup } from "./backup";
import { publishCatalog, quote, seedDefaultCatalog, updateStudioRates } from "./catalogAdmin";

initializeApp();
const db = getFirestore();

/** Région proche de l'Algérie. Doit correspondre à celle de la base Firestore. */
const REGION = "europe-west1";
setGlobalOptions({ region: REGION, maxInstances: 10 });

const ADMIN_EMAILS = defineString("ADMIN_EMAILS", {
  description: "E-mails (vérifiés) autorisés à devenir administrateur, séparés par des virgules.",
});
const BACKUP_BUCKET = defineString("BACKUP_BUCKET", {
  description: "Nom du bucket Cloud Storage privé qui reçoit les sauvegardes quotidiennes.",
});

const auth = getAuth();
const authPort: AuthPort = {
  createUser: (p) => auth.createUser(p),
  setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
  updateUser: (uid, p) => auth.updateUser(uid, p),
  revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
  generatePasswordResetLink: (email) => auth.generatePasswordResetLink(email),
  deleteUser: (uid) => auth.deleteUser(uid),
};

const deps: Deps = {
  db,
  auth: authPort,
  now: () => Timestamp.now(),
  adminEmails: () => parseEmailList(ADMIN_EMAILS.value()),
};

// enforceAppCheck sera activé en phase 4, quand le site client existera.
const callOpts = { cors: true };

export const staffBootstrapAdmin = onCall(callOpts, (req) =>
  toHttps("staffBootstrapAdmin", () => bootstrapAdmin(deps, callerFromToken(req.auth))),
);

export const staffCreate = onCall(callOpts, (req) =>
  toHttps("staffCreate", () => createStaff(deps, callerFromToken(req.auth), (req.data ?? {}) as Record<string, unknown>)),
);

export const staffSetRole = onCall(callOpts, (req) =>
  toHttps("staffSetRole", () => setStaffRole(deps, callerFromToken(req.auth), (req.data ?? {}) as Record<string, unknown>)),
);

export const staffSetDisabled = onCall(callOpts, (req) =>
  toHttps("staffSetDisabled", () => setStaffDisabled(deps, callerFromToken(req.auth), (req.data ?? {}) as Record<string, unknown>)),
);

export const catalogSeedDefaults = onCall(callOpts, (req) =>
  toHttps("catalogSeedDefaults", () => seedDefaultCatalog(deps, callerFromToken(req.auth))),
);

export const catalogPublish = onCall(callOpts, (req) =>
  toHttps("catalogPublish", () => publishCatalog(deps, callerFromToken(req.auth), (req.data ?? {}) as Record<string, unknown>)),
);

export const catalogUpdateStudioRates = onCall(callOpts, (req) =>
  toHttps("catalogUpdateStudioRates", () => updateStudioRates(deps, callerFromToken(req.auth), (req.data ?? {}) as Record<string, unknown>)),
);

export const pricingQuote = onCall({ ...callOpts, maxInstances: 20 }, (req) =>
  toHttps("pricingQuote", () => quote(db, (req.data ?? {}) as Record<string, unknown>, Timestamp.now())),
);

export const releaseExpiredSlotHolds = onSchedule({ schedule: "every 5 minutes", timeZone: STUDIO_TZ }, async () => {
  const released = await releaseExpiredHolds(db, Timestamp.now());
  if (released) logger.info(`Blocages expirés libérés : ${released} tranche(s).`);
});

export const dailyFirestoreBackup = onSchedule({ schedule: "0 3 * * *", timeZone: STUDIO_TZ, timeoutSeconds: 300 }, async () => {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const client = new v1.FirestoreAdminClient();
  const res = await runDailyBackup(
    db,
    {
      exportDocuments: async (r) => {
        const [operation] = await client.exportDocuments(r);
        return { operationName: operation.name ?? "" };
      },
    },
    { projectId, bucket: BACKUP_BUCKET.value(), now: Timestamp.now() },
  );
  logger.info(`Sauvegarde lancée vers ${res.outputUriPrefix}`);
});
