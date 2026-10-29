import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Grace AI — Think clearly.", template: "%s · Grace AI" },
  description: "A thoughtful AI workspace for ideas, writing, research, code, and everyday questions.",
  applicationName: "Grace AI",
  metadataBase: new URL("https://graceai.app"),
  appleWebApp: { capable: true, title: "Grace AI", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0c0b11",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const geist = Geist({ display: "swap", subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ display: "swap", subsets: ["latin"], variable: "--font-geist-mono" });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange enableSystem>
          <SessionProvider basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}>
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
