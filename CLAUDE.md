# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
```

## Project Overview

Personal knowledge graph / learning platform ("Zane's Knowledge Graph") — a Next.js 16.2 App Router site organizing Java backend knowledge into categories and level-based chapters, with a force-directed knowledge graph visualization.

**Tech stack:** Next.js 16.2 (App Router), React 19.2, TypeScript 5, Tailwind CSS v4, framer-motion, lucide-react.

## Architecture

### Routes
- `/` — Homepage with category cards grid and learning path guide
- `/[category]` — Category detail page, chapters grouped by level (1-5)
- `/[category]/[chapter]` — Chapter content page with prev/next nav and related chapters
- `/graph` — SVG knowledge graph visualization (client-side interactive)

### Data Layer
- `src/data/categories/*.ts` — Default exports defining Category metadata (id, title, color, icon, chapters[])
- `src/data/types.ts` — `Category` and `Chapter` interfaces
- `src/data/index.ts` — Aggregator: exports `CATEGORIES` array, lookup helpers (`getCategory`, `getChapter`, etc.), level color/style constants
- `src/data/content/{categoryId}/{chapterId}.md` — Markdown files loaded at request time via `fs.readFileSync` in the chapter page
- Chapter `content` field in category files serves as fallback when no .md file exists

### Styling
- Custom CSS variables for theming (`--color-bg`, `--color-text`, etc.), toggled via `.dark` class on `<html>`
- Dark mode uses JS + localStorage, not Tailwind `dark:` prefix (see inline script in layout.tsx)
- `.prose-custom` class handles all knowledge content typography in globals.css

**Important:** This project uses a custom `markdownToHtml()` in `src/lib/utils.ts` — NOT remark/rehype. When modifying markdown rendering, edit that function.

### Key Patterns
- Category pages are server components (async `page.tsx`) — no `"use client"`
- Chapter content loaded from disk at request time via `fs.readFileSync`
- Path alias `@/*` → `./src/*`
- All SVG rendering in `/graph` is custom (no D3.js dependency)
- AGENTS.md contains a warning about Next.js 16 having breaking changes — consult `node_modules/next/dist/docs/` before writing code against unfamiliar APIs
