'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { CATEGORIES } from '@/lib/categories'

export default function CategoryNav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <header className="sticky top-0 z-50 border-b border-surface-border bg-surface/90 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-8">
        {/* Masthead */}
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/MyDailyClippings/logo.png" alt="My Daily Clippings" width={140} height={40} className="h-10 w-auto self-center" priority />
          <span className="font-serif-display text-lg font-bold leading-none tracking-tight text-white md:text-xl self-center">My Daily Clippings</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 md:flex">
          <Link
            href="/"
            className={`text-sm transition-colors hover:text-white ${
              pathname === '/' ? 'text-white' : 'text-gray-400'
            }`}
          >
            Home
          </Link>

          {/* Categories dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
            >
              Categories
              <svg className={`h-3 w-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 min-w-[180px] rounded-lg border border-surface-border bg-surface-card p-2 shadow-xl">
                {CATEGORIES.map((cat) => (
                  <Link
                    key={cat.slug}
                    href={`/${cat.slug}`}
                    onClick={() => setDropdownOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    {cat.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link
            href="/listen"
            className={`text-sm transition-colors hover:text-white ${
              pathname === '/listen' || pathname === '/listen/' ? 'text-white' : 'text-gray-400'
            }`}
          >
            Listen
          </Link>

          <Link
            href="/about"
            className={`text-sm transition-colors hover:text-white ${
              pathname === '/about' ? 'text-white' : 'text-gray-400'
            }`}
          >
            About
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex flex-col gap-1.5 md:hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <span className={`block h-0.5 w-5 bg-gray-300 transition-transform ${menuOpen ? 'translate-y-2 rotate-45' : ''}`} />
          <span className={`block h-0.5 w-5 bg-gray-300 transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
          <span className={`block h-0.5 w-5 bg-gray-300 transition-transform ${menuOpen ? '-translate-y-2 -rotate-45' : ''}`} />
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-surface-border bg-surface-card px-4 py-4 md:hidden">
          <Link href="/" className="block py-2 text-sm text-gray-300 hover:text-white" onClick={() => setMenuOpen(false)}>
            Home
          </Link>
          <div className="mt-2 border-t border-surface-border pt-2">
            <p className="mb-1 text-xs uppercase tracking-widest text-gray-500">Categories</p>
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.slug}
                href={`/${cat.slug}`}
                className="block py-2 text-sm text-gray-300 hover:text-white"
                onClick={() => setMenuOpen(false)}
              >
                {cat.label}
              </Link>
            ))}
          </div>
          <Link href="/listen" className="mt-2 block border-t border-surface-border pt-2 text-sm text-gray-300 hover:text-white" onClick={() => setMenuOpen(false)}>
            Listen
          </Link>
          <Link href="/about" className="mt-2 block border-t border-surface-border pt-2 text-sm text-gray-300 hover:text-white" onClick={() => setMenuOpen(false)}>
            About
          </Link>
        </div>
      )}
    </header>
  )
}
