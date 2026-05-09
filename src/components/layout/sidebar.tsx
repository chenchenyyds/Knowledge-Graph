"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CATEGORIES, type Category, LEVEL_LABELS } from "@/data";
import { cn } from "@/lib/utils";
import { ChevronRight, Circle } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams();
  const categoryId = params?.category as string;
  const chapterId = params?.chapter as string;
  const currentCategory = CATEGORIES.find((c) => c.id === categoryId);

  return (
    <nav className="hidden w-72 shrink-0 md:block">
      <div className="sticky top-[calc(3.5rem+2rem)] max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pr-2">
        {CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <Link
              href={`/${cat.id}`}
              className={cn(
                "flex items-center gap-1.5 pb-2 transition-opacity",
                categoryId === cat.id ? "opacity-100" : "opacity-60 hover:opacity-100"
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {cat.title}
              </span>
            </Link>
            <ul className="space-y-0.5">
              {cat.chapters.map((ch) => {
                const isActive = chapterId === ch.id;
                return (
                  <li key={ch.id}>
                    <Link
                      href={`/${cat.id}/${ch.id}`}
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white"
                          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          isActive ? "opacity-100" : "opacity-30 group-hover:opacity-60"
                        )}
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-mono text-xs text-zinc-400">L{ch.level}</span>
                      <span className="truncate">{ch.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Knowledge Graph link */}
        <Link
          href="/graph"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/graph"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
          )}
        >
          <Circle className="h-3.5 w-3.5" />
          全局知识图谱
          <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" />
        </Link>
      </div>
    </nav>
  );
}
