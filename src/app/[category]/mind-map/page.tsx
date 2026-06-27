import { getCategory } from "@/data";
import { notFound } from "next/navigation";
import { CategoryMindMap } from "@/components/knowledge/category-mind-map";

export default async function MindMapPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categoryId } = await params;
  const category = getCategory(categoryId);
  if (!category) notFound();

  return <CategoryMindMap category={category} />;
}
