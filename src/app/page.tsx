export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          NetMon Dashboard
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Network visibility &amp; sensor management console for NetMon.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-5 text-sm leading-relaxed dark:border-gray-800">
        <p className="font-medium">Milestone 1 — Foundation (in progress)</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-gray-600 dark:text-gray-400">
          <li>Next.js + TypeScript scaffold ✓</li>
          <li>Drizzle ORM + Postgres schema ✓</li>
          <li>Nightly bundle ingestion — Milestone 2</li>
          <li>Auth &amp; permissions — Milestone 3</li>
          <li>Drill-down dashboard &amp; network maps — Milestone 4</li>
        </ul>
        <p className="mt-4 text-xs text-gray-400">
          See <code>docs/DESIGN.md</code> for the full architecture and plan.
        </p>
      </div>
    </main>
  );
}
