import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import EasterEggProvider from "@/EasterEgg/EasterEggProvider";
import AppNavWrapper from "@/components/AppNavWrapper";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

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
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CLIaaS",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
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
        <AppNavWrapper />
        <EasterEggProvider>{children}</EasterEggProvider>
        <ServiceWorkerRegistration />
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
