import { CATEGORIES, getAllChapters } from "@/data";
import { GraphClient } from "./graph-client";

export default function GraphPage() {
  const allItems = getAllChapters();

  return (
    <div className="space-y-6 pb-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">全局知识图谱</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          5 大知识领域、25 个章节的知识关联网络，点击节点查看详情
        </p>
      </div>

      <GraphClient categories={CATEGORIES} chapters={allItems} />
    </div>
  );
}
