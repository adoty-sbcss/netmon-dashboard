import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getBranding } from "@/lib/branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: {
      default: `${b.appName} — ${b.tagline}`,
      template: `%s · ${b.appName}`,
    },
    description: b.description,
    applicationName: b.appName,
    // Custom favicon only when uploaded; otherwise Next serves the static default.
    icons: b.hasFavicon ? { icon: `/branding/icon?v=${b.version}` } : undefined,
  };
}

/** Accept only a safe hex color (defense-in-depth for the injected <style>). */
function hex(c: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const b = await getBranding();
  const primary = hex(b.primaryColor, "#2563eb");
  const brandA = hex(b.logoColorA, "#FDB813");
  const brandB = hex(b.logoColorB, "#0093D0");
  // Override only the brand accent + star colors, in both light and dark — the
  // rest of the tuned palette in globals.css is untouched.
  const brandCss =
    `:root{--primary:${primary};--ring:${primary};--brand-a:${brandA};--brand-b:${brandB};}` +
    `.dark{--primary:${primary};--ring:${primary};}`;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <style id="brand-vars" dangerouslySetInnerHTML={{ __html: brandCss }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
