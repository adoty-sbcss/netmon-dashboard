"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileUp, Upload } from "lucide-react";

import {
  previewRegistryCsvAction,
  commitRegistryCsvAction,
  type ImportPreview,
  type ImportResult,
  type DuplicateStrategy,
} from "@/lib/registry/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const selectCls =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function RegistryImport({
  districtId,
  schoolId,
  basePath,
}: {
  districtId: number;
  schoolId: number | null;
  basePath: string;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setResult(null);
    setPreview(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsv(text);
      start(async () => {
        const res = await previewRegistryCsvAction({ districtId, csv: text });
        if ("error" in res) setError(res.error);
        else setPreview(res);
      });
    };
    reader.readAsText(file);
  }

  function doImport() {
    if (!csv) return;
    setError(null);
    start(async () => {
      const res = await commitRegistryCsvAction({ districtId, schoolId, basePath, csv, strategy });
      if ("error" in res) setError(res.error);
      else setResult(res);
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`${basePath}/registry/template`}>Download template (.csv)</Link>
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
          <FileUp className="size-4" />
          {filename ?? "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" /> {error}
        </p>
      )}

      {result ? (
        <div className="rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
          <p className="flex items-center gap-2 font-medium text-[var(--success)]">
            <CheckCircle2 className="size-4" /> Import complete
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.created} created · {result.updated} updated · {result.skipped} skipped · {result.errors} errors
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link href={`${basePath}/registry`}>Back to registry</Link>
          </Button>
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline" className="border-[var(--success)]/40 text-[var(--success)]">{preview.newCount} new</Badge>
            <Badge variant="outline" className="border-[var(--warning)]/40 text-[var(--warning)]">{preview.dupCount} duplicate</Badge>
            {preview.errorCount > 0 && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">{preview.errorCount} error</Badge>
            )}
          </div>

          {preview.dupCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Duplicates (matched by MAC/IP):</span>
              <select className={selectCls} value={strategy} onChange={(e) => setStrategy(e.target.value as DuplicateStrategy)}>
                <option value="skip">Skip — keep existing</option>
                <option value="merge">Merge — fill only blank fields</option>
                <option value="overwrite">Overwrite — replace with CSV</option>
              </select>
            </div>
          )}

          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">Row</th>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">IP / MAC</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index} className="border-b last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground">{r.index + 1}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{r.ip ?? "—"} {r.mac ?? ""}</td>
                    <td className="px-3 py-1.5">
                      {r.status === "new" && <span className="text-[var(--success)]">new</span>}
                      {r.status === "duplicate" && (
                        <span className="text-[var(--warning)]">duplicate → {r.matchName}</span>
                      )}
                      {r.status === "error" && <span className="text-destructive">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <Button onClick={doImport} disabled={pending || preview.newCount + preview.dupCount === 0}>
              <Upload className="size-4" /> {pending ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Download the template, fill it in, and choose the file. We&apos;ll show a preview and flag duplicates before anything is written.
        </p>
      )}
    </div>
  );
}
