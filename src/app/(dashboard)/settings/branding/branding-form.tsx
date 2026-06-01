"use client";

import { useActionState, useState, type CSSProperties } from "react";
import { CheckCircle2, AlertCircle, Upload, Trash2 } from "lucide-react";

import {
  saveBrandingTextAction,
  uploadBrandingAssetAction,
  clearBrandingAssetAction,
  type BrandingActionState,
} from "@/lib/branding-actions";
import type { BrandingView } from "@/lib/branding";
import { BrandLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const labelCls = "text-sm font-medium";
const fieldCls = "flex flex-col gap-1.5";

function Notice({ state }: { state: BrandingActionState }) {
  if (state.error) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {state.message}
      </p>
    );
  }
  return null;
}

function ColorField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={fieldCls}>
      <label className={labelCls}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <Input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[8rem] font-mono"
        />
      </div>
    </div>
  );
}

export function BrandingForm({ branding }: { branding: BrandingView }) {
  const [appName, setAppName] = useState(branding.appName);
  const [primary, setPrimary] = useState(branding.primaryColor);
  const [colorA, setColorA] = useState(branding.logoColorA);
  const [colorB, setColorB] = useState(branding.logoColorB);

  const [textState, textAction, savingText] = useActionState<BrandingActionState, FormData>(
    saveBrandingTextAction,
    {},
  );
  const [logoState, logoAction, uploadingLogo] = useActionState<BrandingActionState, FormData>(
    uploadBrandingAssetAction,
    {},
  );
  const [favState, favAction, uploadingFav] = useActionState<BrandingActionState, FormData>(
    uploadBrandingAssetAction,
    {},
  );
  const [clearState, clearAction] = useActionState<BrandingActionState, FormData>(
    clearBrandingAssetAction,
    {},
  );

  // Live preview reflects the in-form color edits before saving.
  const previewStyle = {
    "--brand-a": colorA,
    "--brand-b": colorB,
  } as CSSProperties;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* ---- Identity & colors ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity &amp; colors</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* live preview */}
          <div
            style={previewStyle}
            className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
          >
            {branding.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/branding/logo?v=${branding.version}`}
                alt={appName}
                className="size-10 object-contain"
              />
            ) : (
              <BrandLogo className="size-10" />
            )}
            <div className="leading-tight">
              <p className="font-semibold">{appName || "App name"}</p>
              <p className="text-xs text-muted-foreground">Preview</p>
            </div>
            <span
              className="ml-auto inline-flex h-7 items-center rounded-md px-3 text-xs font-medium text-white"
              style={{ backgroundColor: primary }}
            >
              Primary
            </span>
          </div>

          <form action={textAction} className="flex flex-col gap-4">
            <div className={fieldCls}>
              <label htmlFor="appName" className={labelCls}>
                App name
              </label>
              <Input
                id="appName"
                name="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="NetMon"
                className="max-w-xs"
              />
            </div>
            <div className={fieldCls}>
              <label htmlFor="tagline" className={labelCls}>
                Tagline / org line
              </label>
              <Input
                id="tagline"
                name="tagline"
                defaultValue={branding.tagline}
                placeholder="SBCSS Network Dashboard"
              />
            </div>
            <div className={fieldCls}>
              <label htmlFor="description" className={labelCls}>
                Description (meta)
              </label>
              <Input
                id="description"
                name="description"
                defaultValue={branding.description}
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <ColorField name="primaryColor" label="Primary / accent" value={primary} onChange={setPrimary} />
              <ColorField name="logoColorA" label="Logo color A" value={colorA} onChange={setColorA} />
              <ColorField name="logoColorB" label="Logo color B" value={colorB} onChange={setColorB} />
            </div>
            <p className="text-xs text-muted-foreground">
              Logo colors apply to the built-in star mark (ignored when a custom logo is uploaded).
            </p>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={savingText}>
                {savingText ? "Saving…" : "Save"}
              </Button>
              <Notice state={textState} />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Logo ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            SVG or PNG, max 512 KB. Square works best. Leave empty to use the built-in star.
          </p>
          <form action={logoAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="kind" value="logo" />
            <input
              type="file"
              name="file"
              accept="image/svg+xml,image/png,image/jpeg,image/webp"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm"
            />
            <Button type="submit" variant="outline" disabled={uploadingLogo}>
              <Upload /> {uploadingLogo ? "Uploading…" : "Upload logo"}
            </Button>
            <Notice state={logoState} />
          </form>
          {branding.hasLogo && (
            <form action={clearAction}>
              <input type="hidden" name="kind" value="logo" />
              <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                <Trash2 /> Remove logo
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ---- Favicon ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Favicon</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            ICO, PNG, or SVG, max 512 KB. Leave empty to use the default icon.
          </p>
          <form action={favAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="kind" value="favicon" />
            <input
              type="file"
              name="file"
              accept="image/x-icon,image/vnd.microsoft.icon,.ico,image/png,image/svg+xml"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm"
            />
            <Button type="submit" variant="outline" disabled={uploadingFav}>
              <Upload /> {uploadingFav ? "Uploading…" : "Upload favicon"}
            </Button>
            <Notice state={favState} />
          </form>
          {branding.hasFavicon && (
            <form action={clearAction}>
              <input type="hidden" name="kind" value="favicon" />
              <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                <Trash2 /> Remove favicon
              </Button>
            </form>
          )}
          <Notice state={clearState} />
        </CardContent>
      </Card>
    </div>
  );
}
