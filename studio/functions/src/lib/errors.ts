/**
 * Erreurs métier. Les fonctions appelables les convertissent en HttpsError
 * (voir src/lib/callable.ts) ; la bibliothèque reste testable sans Firebase.
 */
export type AppErrorCode =
  | "invalid-argument"
  | "permission-denied"
  | "unauthenticated"
  | "not-found"
  | "already-exists"
  | "failed-precondition"
  | "resource-exhausted";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Le créneau demandé chevauche une réservation ou un blocage actif. */
export class SlotConflictError extends AppError {
  constructor(public readonly conflicts: string[]) {
    super("already-exists", "Ce créneau n'est plus disponible.", { conflicts });
    this.name = "SlotConflictError";
  }
}

export function invalid(message: string, details?: Record<string, unknown>): never {
  throw new AppError("invalid-argument", message, details);
}
