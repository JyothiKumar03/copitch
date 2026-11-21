import type { TChildrenProps } from "@/types/layout";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "copitch — An AI presenter you brief by voice", template: "%s · copitch" },
  description: "Brief copitch on your audience and message. Prepare a researched pitch, speaking notes, and a deck for your next review or product pitch.",
};

const RootLayout = ({ children }: TChildrenProps) => (
  <html lang="en" data-type="software">
    <body><Providers>{children}</Providers></body>
  </html>
);

export default RootLayout;
