import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import EasterEggProvider from "@/EasterEgg/EasterEggProvider";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CLIaaS | Command-Line Native SaaS",
  description:
    "CLIaaS is a command-line-native SaaS skeleton with import/export interoperability.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <EasterEggProvider>{children}</EasterEggProvider>
      </body>
    </html>
  );
}
