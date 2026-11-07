import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegistration from "../components/ServiceWorkerRegistration";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import PreferencesProvider from "../components/PreferencesProvider";
import Dropdowns from "../components/Dropdowns";
import SiteActivity from "../components/SiteActivity";
import { accountPreferences } from "../lib/server/preferences.ts";

export const metadata: Metadata = {
  title: "meemai",
  applicationName: "meemai",
  description:
    "Your personal library of manga, light novels and every volume in between.",
  appleWebApp: {
    capable: true,
    title: "meemai",
    statusBarStyle: "default",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#181b22" },
  ],
};
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId, preferences } = await accountPreferences();
  return (
    <html
      lang={preferences.locale}
      data-account-theme={userId === null ? undefined : preferences.theme}
      data-theme={
        preferences.theme === "system" ? undefined : preferences.theme
      }
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <PreferencesProvider userId={userId} initial={preferences}>
          <SiteActivity />
          {children}
        </PreferencesProvider>
        <Dropdowns />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
