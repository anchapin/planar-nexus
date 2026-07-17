import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { LandingFooter } from "@/components/landing-footer";
import { SkipLink } from "@/components/skip-link";
import { AchievementNotificationToast } from "@/components/achievement-notification";
import { DesktopUpdateBanner } from "@/components/desktop-update-banner";
import { TauriDevFallback } from "@/components/tauri-dev-fallback";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export const metadata: Metadata = {
  title: "Planar Nexus",
  description:
    "A Magic: The Gathering Commander/EDH digital tabletop experience.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Planar Nexus",
  },
  openGraph: {
    type: "website",
    title: "Planar Nexus",
    description:
      "A Magic: The Gathering Commander/EDH digital tabletop experience",
    siteName: "Planar Nexus",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#4f46e5",
  userScalable: true,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="font-body antialiased" suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SkipLink targetId="main-content" />
          <ServiceWorkerRegistration />
          {/*
            Tauri dev/test IPC shim (issue #1433). No-op in production and
            whenever NEXT_PUBLIC_TAURI_FALLBACK is unset; see
            src/lib/tauri-mock.ts. Mounted once here so the desktop code
            paths engage against the dev server for the Tauri E2E spec.
          */}
          <TauriDevFallback />
          {children}
          <LandingFooter />
          <Toaster />
          <AchievementNotificationToast />
          <DesktopUpdateBanner />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
