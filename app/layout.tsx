import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "../lib/theme";

export const metadata: Metadata = {
  title: "Book Collection",
  description:
    "Your personal library of manga, light novels and every volume in between.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
