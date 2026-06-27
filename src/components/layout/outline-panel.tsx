"use client";

import { useSidebarHeadings } from "./sidebar-heading-context";
import { cn } from "@/lib/utils";

export function OutlinePanel() {
  const { headings, hasActiveChapter } = useSidebarHeadings();

  if (!hasActiveChapter || headings.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-zinc-400 dark:text-zinc-500">
        <p>请选择一个章节查看大纲</p>
      </div>
    );
  }

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav className="space-y-0.5">
      {headings.map((h, i) => {
        // Determine indent class based on heading level
        const indentClass =
          h.level >= 4
            ? "pl-10 text-xs text-zinc-400 dark:text-zinc-500"
            : h.level === 3
              ? "pl-7 text-xs text-zinc-500 dark:text-zinc-400"
              : "text-sm";

        return (
          <button
            key={`${h.id}-${i}`}
            onClick={() => handleClick(h.id)}
            className={cn(
              "w-full text-left rounded-md px-2.5 py-1.5 transition-colors",
              "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700",
              "dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300",
              indentClass,
            )}
          >
            {h.text}
          </button>
        );
      })}
    </nav>
  );
}
