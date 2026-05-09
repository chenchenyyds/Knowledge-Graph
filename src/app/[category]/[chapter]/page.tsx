import { getCategory, getChapter, getRelatedChapters, LEVEL_LABELS, type Category, type Chapter } from "@/data";
import { markdownToHtml, cn } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import { readFileSync } from "fs";
import { join } from "path";

function loadChapterContent(categoryId: string, chapterId: string, fallback: string): string {
  try {
    return readFileSync(
      join(process.cwd(), "src", "data", "content", categoryId, `${chapterId}.md`),
      "utf-8",
    );
  } catch {
    return fallback;
  }
}

function FrequencyBadge({ freq }: { freq: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "面试高频", class: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    medium: { label: "面试中频", class: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    low: { label: "面试低频", class: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300" },
  };
  const { label, class: cls } = map[freq];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

function getNavChapters(category: Category, chapter: Chapter) {
  const idx = category.chapters.findIndex((ch) => ch.id === chapter.id);
  const prev = idx > 0 ? category.chapters[idx - 1] : null;
  const next = idx < category.chapters.length - 1 ? category.chapters[idx + 1] : null;
  return { prev, next };
}

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ category: string; chapter: string }>;
}) {
  const { category: categoryId, chapter: chapterId } = await params;
  const category = getCategory(categoryId);
  if (!category) notFound();
  const chapter = getChapter(categoryId, chapterId);
  if (!chapter) notFound();

  const { prev, next } = getNavChapters(category, chapter);
  const related = getRelatedChapters(chapter);
  const markdown = loadChapterContent(categoryId, chapterId, chapter.content);
  const htmlContent = markdownToHtml(markdown);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/${category.id}`}
            className="rounded-lg px-3 py-1 text-xs font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            style={{
              backgroundColor: `${category.color}15`,
              color: category.color,
            }}
          >
            {category.title}
          </Link>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${category.color}15`,
              color: category.color,
            }}
          >
            {LEVEL_LABELS[chapter.level]}
          </span>
          <FrequencyBadge freq={chapter.interviewFrequency} />
        </div>

        <h1 className="text-2xl font-bold sm:text-3xl">{chapter.title}</h1>

        <p className="text-sm text-[var(--color-text-secondary)]">
          {chapter.description}
        </p>
      </header>

      {/* Content */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
        <div className="prose-custom" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>

      {/* Key Points */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <h3 className="text-sm font-semibold mb-3">核心要点</h3>
        <ul className="space-y-1.5">
          {chapter.keyPoints.map((kp) => (
            <li key={kp} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              {kp}
            </li>
          ))}
        </ul>
      </div>

      {/* Related Chapters */}
      {related.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <h3 className="text-sm font-semibold mb-3">关联知识点</h3>
          <div className="flex flex-wrap gap-2">
            {related.map(({ category: cat, chapter: ch }) => (
              <Link
                key={ch.id}
                href={`/${cat.id}/${ch.id}`}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700"
                style={{
                  backgroundColor: `${cat.color}10`,
                  color: cat.color,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                {ch.title}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex items-center justify-between border-t border-[var(--color-border)] pt-6">
        <div>
          {prev && (
            <Link
              href={`/${category.id}/${prev.id}`}
              className="group flex items-center gap-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
            >
              <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              <div>
                <div className="text-xs text-zinc-400">上一节</div>
                <div className="font-medium">{prev.title}</div>
              </div>
            </Link>
          )}
        </div>
        <div>
          {next && (
            <Link
              href={`/${category.id}/${next.id}`}
              className="group flex items-center gap-2 text-right text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
            >
              <div>
                <div className="text-xs text-zinc-400">下一节</div>
                <div className="font-medium">{next.title}</div>
              </div>
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          )}
        </div>
      </nav>
    </div>
  );
}
