import type { Metadata } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import './globals.css'
import CategoryNav from '@/components/CategoryNav'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s · My Daily Clippings',
    default: 'My Daily Clippings',
  },
  description: 'Personally curated daily news across Physics, AI, Geopolitics, and Astronomy, drafted fresh every morning.',
  icons: {
    icon: '/mydailyclippings/logo.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body>
        <CategoryNav />
        <main className="min-h-screen">{children}</main>
        <footer className="mt-16 border-t border-surface-border py-8">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="flex flex-col items-center justify-between gap-3 text-xs text-gray-600 sm:flex-row">
              <span className="font-serif-display text-sm text-gray-500">My Daily Clippings</span>
              <span>Generated daily by AI · Curated for curious minds</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
