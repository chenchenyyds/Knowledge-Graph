"use client";

import { type Chapter, type Category, LEVEL_LABELS } from "@/data";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

interface ChapterCardProps {
  chapter: Chapter;
  category: Category;
  index: number;
}

export function ChapterCard({ chapter, category, index }: ChapterCardProps) {
  return (
    <Link
      href={`/${category.id}/${chapter.id}`}
      className="group block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 transition-all hover:shadow-sm hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        {/* Level indicator */}
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
          style={{
            backgroundColor: `${category.color}15`,
            color: category.color,
          }}
        >
          {chapter.level}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">
              {chapter.title}
            </h4>
            {chapter.interviewFrequency === "high" && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                高频
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] line-clamp-2">
            {chapter.description}
          </p>

          {/* Key points preview */}
          <div className="mt-2 flex flex-wrap gap-1">
            {chapter.keyPoints.slice(0, 3).map((kp) => (
              <span
                key={kp}
                className="rounded-md bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
              >
                {kp}
              </span>
            ))}
            {chapter.keyPoints.length > 3 && (
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                +{chapter.keyPoints.length - 3}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-secondary)] opacity-0 transition-all group-hover:opacity-100" />
      </div>
    </Link>
  );
}
