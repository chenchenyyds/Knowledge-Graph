---
name: knowledge-extender
description: Extend the Java Knowledge Graph with new categories (knowledge domains) and chapters. Use this skill when the user asks to "add a new knowledge category", "create a new chapter", "add knowledge point", "add X category", "add a new chapter to X", "add a knowledge domain", or any request involving adding new educational content to a Next.js knowledge graph project. This skill covers the full workflow: understanding the user's request, creating category metadata files, writing markdown content with code examples/tables/ASCII diagrams, and registering everything in the data layer.
---

# Knowledge Extender

## Overview

This skill guides adding new knowledge content to a Next.js + Tailwind knowledge graph project (`java-knowledge-graph`). The project uses a pattern of **TypeScript category metadata** files + **Markdown content** files.

## Architecture

```
src/data/
├── index.ts                  # Barrel file: aggregates all categories
├── types.ts                  # Category, Chapter type definitions
├── categories/               # Category metadata (one file per domain)
│   ├── java-basics.ts
│   ├── database.ts
│   ├── redis.ts
│   ├── spring.ts
│   ├── system-design.ts
│   └── rag.ts                # ← Example of a non-Java category
└── content/                  # Chapter content (one .md file per chapter)
    ├── java-basics/
    ├── database/
    ├── redis/
    ├── spring/
    ├── system-design/
    └── rag/
```

## Workflow

When the user requests to add knowledge, first determine which type:

1. **New Category** — a whole new knowledge domain (e.g., "操作系统", "Docker")
2. **New Chapter** — a new chapter to an existing category

### 1. New Category

#### 1a. Create Category Metadata

Create `src/data/categories/{id}.ts`:

TypeScript format (5 chapters, L1-L5):
```typescript
const category = {
    id: "category-id",          // kebab-case, used in URLs
    title: "分类标题",           // Display name, e.g. "RAG"
    description: "一句话描述",
    color: "#HEX",              // One of: #3B82F6, #10B981, #F59E0B, #8B5CF6, #EF4444, or any hex
    icon: "IconName",           // PascalCase — see available icons below
    chapters: [
      {
        id: "chapter-id",
        title: "章节标题",
        level: 1,               // 1-5 (L1 基础 → L5 实战)
        description: "章节描述",
        content: "",            // Always empty — content is in .md files
        keyPoints: [
          "要点 1",
          "要点 2",
          "要点 3",
          "要点 4",
          "要点 5",
        ],
        relatedChapters: ["other-chapter-id"],  // Cross-category references
        interviewFrequency: "high",  // "high" | "medium" | "low"
      },
      // ... up to 5 chapters
    ],
  };
  export default category;
```

**Available icons:** `Coffee`, `Database`, `Zap`, `Leaf`, `Settings`, `Book`, `Globe`, `Code`, `Cpu`, `Shield`, `Server`, `Network`, `Box`, `Cloud`, `Terminal`

#### 1b. Create Content MD Files

Create one file per chapter at `src/data/content/{category-id}/{chapter-id}.md`.

**Content style guidelines:**
- Use `##` for section titles (H2)
- Use `###` for subsections (H3)
- Use markdown tables with `|` syntax for comparisons
- Use fenced code blocks ```language for code examples
- Use ``` (no language) for ASCII diagrams
- Use `>` for blockquotes
- Use `**bold**` for emphasis
- Use `-` for unordered lists

**Cover these aspects in each chapter:**
- Core concepts / introductions
- Tables comparing options/approaches
- Code examples (Python for AI topics, Java for backend, etc.)
- ASCII diagrams for architecture/flow
- Practical tips or best practices

#### 1c. Register in `src/data/index.ts`

```typescript
import newCategory from "./categories/{id}";

export const CATEGORIES: Category[] = [
  // ... existing ...
  newCategory as Category,
];
```

### 2. New Chapter to Existing Category

1. Open `src/data/categories/{category-id}.ts`
2. Add a new chapter object to the `chapters` array (place at appropriate level)
3. Create `src/data/content/{category-id}/{chapter-id}.md` with full content
4. No changes needed in `index.ts`

## Quality Checklist

Before finishing, verify:
- [ ] `npx next build` passes (no TypeScript errors)
- [ ] Category appears on homepage (`/`)
- [ ] Chapter list renders at `/{category-id}`
- [ ] Each chapter's content renders correctly at `/{category-id}/{chapter-id}`
- [ ] Code blocks format properly with language badges
- [ ] Tables render with correct columns
- [ ] ASCII diagrams are left-aligned without language badges
- [ ] Dark mode works for all new pages
