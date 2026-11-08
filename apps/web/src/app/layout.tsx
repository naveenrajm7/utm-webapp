import type { Metadata, Viewport } from "next";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "UTM Web",
  description: "Control UTM virtual machines on this Mac from a browser.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e8e7" },
    { media: "(prefers-color-scheme: dark)", color: "#30302f" },
  ],
};

/**
 * Deliberately thin: the console routes (/vnc, /terminal) fill the window on
 * their own, so the VM manager chrome lives in the page that needs it.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
