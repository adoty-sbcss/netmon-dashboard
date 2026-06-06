"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/**
 * Screenshot block. Renders the image when present; if the file hasn't been
 * captured yet (404), shows a labeled placeholder so the article still reads
 * cleanly. Drop the PNG at the referenced /public/help path to fill it in.
 */
export function HelpImage({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  const [errored, setErrored] = useState(false);

  return (
    <figure className="my-4">
      {errored ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 px-6 py-8 text-center text-sm text-muted-foreground">
          <ImageOff className="size-5" />
          <span>Screenshot pending: {caption ?? alt}</span>
          <code className="text-[11px]">{src}</code>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setErrored(true)}
          className="max-w-full rounded-lg border"
        />
      )}
      {caption && (
        <figcaption className="mt-1 text-center text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
