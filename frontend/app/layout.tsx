import type { TChildrenProps } from "@/types/layout";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equal AI — Voice Assistant",
  description: "Voice and UI starter app powered by Bun, Next.js and Hono.",
};

export default function RootLayout({ children }: TChildrenProps) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
