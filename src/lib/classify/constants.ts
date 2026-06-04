/**
 * Client-safe classification constants — NO imports, no `server-only` — so both the
 * server query layer (lib/inventory/queries) and the client Devices hub can share
 * them without pulling a server-only module into the client bundle.
 */

/** Auto-classifications at or above this confidence are settled; below → review/AI. */
export const CLASSIFY_REVIEW_THRESHOLD = 0.75;
