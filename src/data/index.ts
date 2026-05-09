import type { Category, Chapter } from "./types";
import javaBasics from "./categories/java-basics";
import database from "./categories/database";
import redis from "./categories/redis";
import spring from "./categories/spring";
import systemDesign from "./categories/system-design";

export type { Chapter, Category } from "./types";
export type { default as CategoryData } from "./categories/java-basics";

export const CATEGORIES: Category[] = [
  javaBasics as Category,
  database as Category,
  redis as Category,
  spring as Category,
  systemDesign as Category,
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function getChapter(categoryId: string, chapterId: string) {
  const category = getCategory(categoryId);
  return category?.chapters.find((ch) => ch.id === chapterId);
}

export function getRelatedChapters(chapter: { relatedChapters: string[] }) {
  const result: { category: Category; chapter: Chapter }[] = [];
  for (const relatedId of chapter.relatedChapters) {
    for (const category of CATEGORIES) {
      const found = category.chapters.find((ch) => ch.id === relatedId);
      if (found) {
        result.push({ category, chapter: found });
      }
    }
  }
  return result;
}

export function getAllChapters() {
  const result: { category: Category; chapter: typeof CATEGORIES[0]["chapters"][0] }[] = [];
  for (const category of CATEGORIES) {
    for (const chapter of category.chapters) {
      result.push({ category, chapter });
    }
  }
  return result;
}

export const LEVEL_COLORS = [
  "",
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
];

export const LEVEL_LABELS = ["", "L1 基础", "L2 进阶", "L3 深入", "L4 高级", "L5 实战"];
