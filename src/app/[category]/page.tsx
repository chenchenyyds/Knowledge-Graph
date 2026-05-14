import { getCategory, LEVEL_LABELS } from "@/data";
import { ChapterCard } from "@/components/knowledge/chapter-card";
import { notFound } from "next/navigation";
import { Coffee, Database, Zap, Leaf, Settings, GraduationCap, Book, Globe, Code, Cpu, Shield, Server, Network, Box, Cloud, Terminal } from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Coffee: Coffee as React.ComponentType<{ className?: string }>,
  Database: Database as React.ComponentType<{ className?: string }>,
  Zap: Zap as React.ComponentType<{ className?: string }>,
  Leaf: Leaf as React.ComponentType<{ className?: string }>,
  Settings: Settings as React.ComponentType<{ className?: string }>,
  Book: Book as React.ComponentType<{ className?: string }>,
  Globe: Globe as React.ComponentType<{ className?: string }>,
  Code: Code as React.ComponentType<{ className?: string }>,
  Cpu: Cpu as React.ComponentType<{ className?: string }>,
  Shield: Shield as React.ComponentType<{ className?: string }>,
  Server: Server as React.ComponentType<{ className?: string }>,
  Network: Network as React.ComponentType<{ className?: string }>,
  Box: Box as React.ComponentType<{ className?: string }>,
  Cloud: Cloud as React.ComponentType<{ className?: string }>,
  Terminal: Terminal as React.ComponentType<{ className?: string }>,
};

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categoryId } = await params;
  const category = getCategory(categoryId);
  if (!category) notFound();

  const Icon = ICON_MAP[category.icon] || GraduationCap;

  // Group chapters by level
  const byLevel = [1, 2, 3, 4, 5].map((level) => ({
    level,
    label: LEVEL_LABELS[level],
    chapters: category.chapters.filter((ch) => ch.level === level),
  })).filter((g) => g.chapters.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${category.color}15` }}
          >
            <div style={{ color: category.color }}><Icon className="h-5 w-5" /></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
              <h1 className="text-2xl font-bold sm:text-3xl">{category.title}</h1>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${category.color}15`,
                  color: category.color,
                }}
              >
                {category.chapters.length} 章节
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {category.description}
            </p>
          </div>
        </div>
      </header>

      {/* Chapters by level */}
      <div className="space-y-8">
        {byLevel.map((group) => (
          <div key={group.level}>
            <div className="flex items-center gap-2 pb-3">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {group.label}
              </span>
              <span className="text-xs text-zinc-300 dark:text-zinc-600">
                ({group.chapters.length} 个章节)
              </span>
            </div>
            <div className="space-y-2">
              {group.chapters.map((ch, i) => (
                <ChapterCard key={ch.id} chapter={ch} category={category} index={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
