import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plate Reserver",
  description: "Schedule and monitor DLT vehicle plate reservations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Plate Reserver</Link>
          <Link href="/reservations/new" className="button primary">New reservation</Link>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
