"use client";

import { type Category } from "@/data";
import { cn } from "@/lib/utils";
import { Coffee, Database, Zap, Leaf, Settings, Book, Globe, Code, Cpu, Shield, Server, Network, Box, Cloud, Terminal } from "lucide-react";
import Link from "next/link";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Coffee,
  Database,
  Zap,
  Leaf,
  Settings,
  Book,
  Globe,
  Code,
  Cpu,
  Shield,
  Server,
  Network,
  Box,
  Cloud,
  Terminal,
};

interface CategoryCardProps {
  category: Category;
  chapterCount: number;
}

export function CategoryCard({ category, chapterCount }: CategoryCardProps) {
  const Icon = ICON_MAP[category.icon] || Book;

  return (
    <Link
      href={`/${category.id}`}
      className="group block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 transition-all hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
          style={{ backgroundColor: `${category.color}15` }}
        >
          <span style={{ color: category.color }}><Icon className="h-5 w-5" /></span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              {category.title}
            </h3>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)] line-clamp-2">
            {category.description}
          </p>
          <div className="mt-3 flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span>{chapterCount} 个章节</span>
            <span
              className="inline-flex items-center gap-1 font-medium transition-colors group-hover:underline"
              style={{ color: category.color }}
            >
              开始学习 &rarr;
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
