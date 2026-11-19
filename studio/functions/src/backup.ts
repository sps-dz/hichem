/**
 * Sauvegarde quotidienne : export complet de Firestore vers un bucket Cloud
 * Storage privé (gs://BACKUP_BUCKET/firestore/AAAA-MM-JJ). Chaque exécution
 * est notée dans `systemJobs` pour que l'admin voie si la dernière a réussi.
 */
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { utcMsToAlgiers } from "./lib/time";

export interface ExportPort {
  exportDocuments(req: { name: string; outputUriPrefix: string; collectionIds: string[] }): Promise<{ operationName: string }>;
}

export async function runDailyBackup(
  db: Firestore,
  exporter: ExportPort,
  input: { projectId: string; bucket: string; now: Timestamp },
): Promise<{ outputUriPrefix: string; operationName: string }> {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(input.bucket)) throw new Error("BACKUP_BUCKET invalide.");
  const day = utcMsToAlgiers(input.now.toMillis()).date;
  const outputUriPrefix = `gs://${input.bucket}/firestore/${day}`;
  const jobRef = db.collection("systemJobs").doc(`backup-${day}`);
  try {
    const { operationName } = await exporter.exportDocuments({
      name: `projects/${input.projectId}/databases/(default)`,
      outputUriPrefix,
      collectionIds: [], // toutes les collections
    });
    await jobRef.set({ job: "backup", day, status: "started", outputUriPrefix, operationName, at: input.now });
    return { outputUriPrefix, operationName };
  } catch (e) {
    await jobRef.set({ job: "backup", day, status: "failed", error: String((e as Error).message ?? e), at: input.now });
    throw e;
  }
}
