/**
 * SBCSS-style mark: a five-point star split gold (left) / blue (right) — the San
 * Bernardino County Superintendent of Schools colors. Pure SVG (no hooks) so it
 * renders in server and client components alike and scales to a favicon.
 *
 * To use the exact official asset instead, drop it at public/logo.svg and point
 * <img> here; the geometry below is a clean brand-faithful stand-in.
 */
export const SBCSS_GOLD = "#FDB813";
export const SBCSS_BLUE = "#0093D0";

const STAR_PATH =
  "M50 3 L61.2 36.6 L96.6 36.9 L68.1 57.9 L78.8 91.6 L50 71 L21.2 91.6 L31.9 57.9 L3.4 36.9 L38.8 36.6 Z";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="NetMon — San Bernardino County Superintendent of Schools"
    >
      <defs>
        <linearGradient id="sbcssStarGrad" x1="0" y1="0" x2="1" y2="0">
          {/* Driven by the branding config (injected --brand-a/--brand-b),
              falling back to the SBCSS gold/blue. */}
          <stop offset="50%" stopColor={`var(--brand-a, ${SBCSS_GOLD})`} />
          <stop offset="50%" stopColor={`var(--brand-b, ${SBCSS_BLUE})`} />
        </linearGradient>
      </defs>
      <path d={STAR_PATH} fill="url(#sbcssStarGrad)" />
    </svg>
  );
}
