import { MessagingProvider } from "@/providers/messaging-provider";
import { PricingProvider } from "@/providers/pricing-provider";
import { fetchFeeConfig } from "@/lib/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSplash } from "@/components/brand/splash";
import { AuthProvider } from "@/providers/auth-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/providers/toast-provider";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Sacramento } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const sacramento = Sacramento({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-sacramento",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Sheree — book beauty and wellness professionals",
    template: "%s · Sheree",
  },
  description:
    "Find, compare and book trusted hair, beauty, wellness and grooming professionals near you. See real work, real prices and real availability before you book.",
  applicationName: "Sheree",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sheree" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Sheree",
    title: "Sheree — book beauty and wellness professionals",
    description: "See real work, real prices and real availability before you book.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Keeps the layout clear of the notch and the home indicator.
  viewportFit: "cover",
  themeColor: "#FCFAF8",
};

/**
 * Resolves the appearance preference before first paint. Without it, anyone on
 * a dark device sees one ivory frame before React applies the class.
 *
 * Light is the default: dark is only applied when someone has chosen it, or has
 * chosen to follow their device and the device is dark. Must stay in step with
 * `ThemeProvider`, which reads the same key with the same rule.
 */
const themeBootScript = `(function(){try{var s=localStorage.getItem("sheree:appearance");var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var d=s==="dark"||(s==="system"&&m);document.documentElement.classList.toggle("dark",d);var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",d?"#211B20":"#FCFAF8")}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await fetchFeeConfig(await createSupabaseServerClient());
  return (
    <html lang="en" className={`${jakarta.variable} ${sacramento.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh bg-background text-ink">
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <MessagingProvider>
              <PricingProvider initialConfig={config}>
              <AppSplash />
              {children}
              </PricingProvider>
              </MessagingProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
