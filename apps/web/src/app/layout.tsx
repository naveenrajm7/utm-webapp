import type { Metadata } from "next";
import "./globals.css";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

export const metadata: Metadata = {
  title: "UTM Web",
  description: "A web UI for UTM, access UTM from anywhere within your browser.",
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
