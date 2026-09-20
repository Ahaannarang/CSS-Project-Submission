import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Berth — dock scheduling',
  description: 'Berth booking for a harbor facility, with conflict and fit checks enforced by the database.',
}

const nav = [
  { href: '/', label: 'Timeline' },
  { href: '/availability', label: 'Find a slot' },
  { href: '/audit', label: 'Audit' },
  { href: '/berths', label: 'Berths & vessels' },
  { href: '/stats', label: 'Stats' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">
        <header className="bg-hull text-white">
          <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Berth</span>
              <span className="text-xs text-white/60">Harborview Marine Research Center</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href}
                  className="rounded px-3 py-1.5 text-white/75 transition hover:bg-white/10 hover:text-white">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
      </body>
    </html>
  )
}
