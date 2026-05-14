import { CATEGORIES } from "@/data";
import { CategoryCard } from "@/components/knowledge/category-card";
import { ArrowRight, Network } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16 pb-16">
      {/* Hero */}
      <section className="flex flex-col items-center px-2 pt-12 text-center sm:pt-24">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Zane's Knowledge Graph
        </h1>
        <p className="mt-4 max-w-2xl text-base text-[var(--color-text-secondary)] sm:text-xl">
          小陈的知识图谱 — 从 Java 起步，持续拓展知识边界
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href={`/${CATEGORIES[0]?.id || "java-basics"}`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            开始学习 <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/graph"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--color-border)] px-6 py-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          >
            <Network className="h-4 w-4" />
            查看知识图谱
          </Link>
        </div>
      </section>

      {/* Categories Grid */}
      <section className="mx-auto w-full max-w-5xl px-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              chapterCount={cat.chapters.length}
            />
          ))}
        </div>
      </section>

      {/* Learning Path */}
      <section className="mx-auto w-full max-w-3xl px-4">
        <h2 className="text-center text-lg font-semibold">学习路径建议</h2>
        <div className="mt-6 space-y-0">
          {[
            { step: "1", label: "夯实基础", desc: "从 L1 基础开始，建立知识体系", color: "bg-blue-500" },
            { step: "2", label: "进阶深入", desc: "L2-L3 深入学习核心原理", color: "bg-emerald-500" },
            { step: "3", label: "高级拓展", desc: "L4-L5 掌握高级主题与实战", color: "bg-amber-500" },
            { step: "4", label: "综合练习", desc: "跨领域串联知识点，形成知识网络", color: "bg-red-500" },
          ].map((item, i) => (
            <div key={item.step} className="flex gap-4 pb-8 last:pb-0">
              <div className="flex flex-col items-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${item.color} text-xs font-bold text-white`}>
                  {item.step}
                </div>
                {i < 3 && <div className="mt-1 h-full w-px bg-[var(--color-border)]" />}
              </div>
              <div className="pt-1">
                <h3 className="text-sm font-semibold">{item.label}</h3>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
