import "server-only";
import { createCatalogDatabase } from "./postgres";
import { CatalogStore } from "./store";

let store: CatalogStore | undefined;

/** The feature is opt-in until migrations and encryption are configured. */
export function getRuntimeCatalog(): CatalogStore | null {
  if (process.env.GRACE_CATALOG_ENABLED !== "1") {
    return null;
  }
  if (!(process.env.POSTGRES_URL && process.env.GRACE_ENCRYPTION_KEY)) {
    throw new Error("Catalog configuration is incomplete");
  }
  if (!store) {
    const { database } = createCatalogDatabase(process.env.POSTGRES_URL);
    store = new CatalogStore(database, process.env.GRACE_ENCRYPTION_KEY);
  }
  return store;
}
