import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JARVIS MARK 7",
  description: "JARVIS MARK 7 holographic AI assistant",
  applicationName: "JARVIS",
  appleWebApp: { capable: true, title: "JARVIS", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-jarvis-privacy-mode={process.env.JARVIS_PRIVACY_MODE?.trim().toLowerCase() === "local_only" ? "local_only" : "standard"}>
      <body>{children}</body>
    </html>
  );
}
