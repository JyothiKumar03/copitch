import type { TChildrenProps } from "@/types/layout";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "copitch — An AI presenter you brief by voice", template: "%s · copitch" },
  description: "Brief copitch on your topic and goal. Prepare a researched deck for your next presentation.",
};

const RootLayout = ({ children }: TChildrenProps) => (
  <html lang="en" data-type="software">
    <body><Providers>{children}</Providers></body>
  </html>
);

export default RootLayout;
