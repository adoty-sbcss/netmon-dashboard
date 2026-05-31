/**
 * Database client (postgres-js + Drizzle). Import { db } from "@/db".
 *
 * The client is created LAZILY on first query — not at import time. This matters
 * because `next build` evaluates the module graph while collecting page data; if
 * we opened a connection (or threw on a missing DATABASE_URL) at import, the build
 * would fail in any environment without a live DB (e.g. the ACR image build). The
 * exported `db` is a Proxy that materializes the real Drizzle instance on first
 * property access, so merely importing it is side-effect free.
 *
 * The underlying postgres client + Drizzle instance are memoized on globalThis so
 * Next.js dev hot-reloads don't open a new connection pool on every change.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
  _db?: Db;
};

function getDb(): Db {
  if (globalForDb._db) return globalForDb._db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = globalForDb._pgClient ?? postgres(connectionString, { max: 10 });
  globalForDb._pgClient = client;

  const instance = drizzle(client, { schema });
  globalForDb._db = instance;
  return instance;
}

// Lazy proxy: defers getDb() (and thus the DATABASE_URL check + connection) until
// the first actual use, keeping module import side-effect free for `next build`.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export { schema };
