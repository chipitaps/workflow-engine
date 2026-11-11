import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Workflow Engine", template: "%s · Workflow Engine" },
  description: "A small workflow automation engine: triggers, steps, retries and a durable queue on Postgres.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body className="min-h-dvh">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
              workflow-engine
            </Link>
            <nav className="flex gap-4 text-sm text-ink-2" aria-label="Main">
              <Link href="/" className="hover:text-ink">
                Workflows
              </Link>
              <Link href="/runs" className="hover:text-ink">
                Runs
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
