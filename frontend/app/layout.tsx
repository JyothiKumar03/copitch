import type { TChildrenProps } from "@/types/layout";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "copitch — AI presentation studio", template: "%s · copitch" },
  other: { "page-type": "software", "site-kind": "software" },
  description: "Brief copitch on your topic and goal. Prepare a researched deck for your next presentation.",
};

const restoreTheme = `try {
  if (localStorage.getItem("copitch:theme") === "light") document.documentElement.dataset.theme = "light";
} catch {}`;

const RootLayout = ({ children }: TChildrenProps) => (
  <html lang="en" data-type="software" data-radius="soft" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: restoreTheme }} /></head>
    <body><Providers>{children}</Providers></body>
  </html>
);

export default RootLayout;
