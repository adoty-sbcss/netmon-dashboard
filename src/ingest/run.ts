/**
 * CLI: ingest one extracted NetMon bundle into the dashboard DB.
 *
 *   npm run ingest -- --path "<bundle-dir>" [--district x] [--school y] [--device z] [--force]
 *
 * --path        path to an EXTRACTED bundle directory (contains scans/)
 * --district    override district slug (else scan.json slugs, else "unknown")
 * --school      override school slug
 * --device      override device/sensor slug (else derived from folder name)
 * --force       re-ingest even if this bundle was already parsed
 *
 * DATABASE_URL is loaded from .env (dotenv). Must run before importing the DB.
 */
import "dotenv/config";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const path = typeof args.path === "string" ? args.path : "";
  if (!path) {
    console.error(
      'usage: npm run ingest -- --path "<bundle-dir>" [--district x --school y --device z] [--force]',
    );
    process.exit(1);
  }

  // Imported after dotenv so DATABASE_URL is set when ../db evaluates.
  const { ingestBundle } = await import("./ingest");

  const res = await ingestBundle(path, {
    district: typeof args.district === "string" ? args.district : undefined,
    school: typeof args.school === "string" ? args.school : undefined,
    device: typeof args.device === "string" ? args.device : undefined,
    force: Boolean(args.force),
  });

  if (res.skipped) {
    console.log(
      `Bundle "${res.bundle}" already ingested (parsed). Use --force to re-ingest.`,
    );
  } else {
    console.log(
      `Ingested "${res.bundle}" -> ${res.district}/${res.school}/${res.device} (${res.scans} scan(s))`,
    );
    console.table(res.counts);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
