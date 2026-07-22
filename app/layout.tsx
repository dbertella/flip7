import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flip Seven — Neon Cabinet",
  description: "A neon arcade, one-device pass-and-play card game for 2–8 players.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
