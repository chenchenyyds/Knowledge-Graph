"use client";

import { useEffect, useState } from "react";
import { Menu, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { CATEGORIES } from "@/data";

export function Header() {
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const theme = localStorage.getItem("theme");
    if (theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link className="text-lg font-bold" href="/">
          Java 知识体系
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              href={`/${cat.id}`}
              className="text-sm font-medium transition-colors hover:text-zinc-900 dark:hover:text-white text-zinc-500 dark:text-zinc-400"
            >
              {cat.title}
            </Link>
          ))}
          <Link
            href="/graph"
            className="text-sm font-medium transition-colors hover:text-zinc-900 dark:hover:text-white text-zinc-500 dark:text-zinc-400"
          >
            知识图谱
          </Link>
          <button
            onClick={toggleDark}
            className="rounded-md p-1.5 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </nav>

        <button
          onClick={() => setMobileMenu(!mobileMenu)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {mobileMenu && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/${cat.id}`}
                onClick={() => setMobileMenu(false)}
                className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              >
                {cat.title}
              </Link>
            ))}
            <Link
              href="/graph"
              onClick={() => setMobileMenu(false)}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              知识图谱
            </Link>
            <button
              onClick={toggleDark}
              className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {dark ? "浅色模式" : "深色模式"}
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
