"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CATEGORIES, type Category, LEVEL_LABELS } from "@/data";
import { cn } from "@/lib/utils";
import { BookOpen, BrainCircuit, ChevronRight, Circle, ListTree } from "lucide-react";
import { OutlinePanel } from "./outline-panel";

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams();
  const categoryId = params?.category as string;
  const chapterId = params?.chapter as string;
  const currentCategory = CATEGORIES.find((c) => c.id === categoryId);
  const [activeTab, setActiveTab] = useState<"library" | "outline">("library");

  return (
    <nav className="hidden w-72 shrink-0 md:block">
      <div className="sticky top-[calc(3.5rem+2rem)] max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
        {/* Tab bar — sticky inside sidebar */}
        <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-4 bg-[var(--color-bg)] px-2 pb-1 pt-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
          <button
            onClick={() => setActiveTab("library")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "library"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            知识库
          </button>
          <button
            onClick={() => setActiveTab("outline")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "outline"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            )}
          >
            <ListTree className="h-3.5 w-3.5" />
            大纲
          </button>
        </div>
      </div>

      {activeTab === "library" ? (
          <div className="space-y-6">
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
            {/* Mind map link */}
            <Link
              href={`/${cat.id}/mind-map`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors mb-1",
                pathname === `/${cat.id}/mind-map`
                  ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
              )}
            >
              <BrainCircuit className="h-3 w-3 shrink-0" />
              思维导图
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
      ) : (
        <OutlinePanel />
      )}
    </div>
    </nav>
  );
}
