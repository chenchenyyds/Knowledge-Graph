"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import type { Category, Chapter } from "@/data";
import { LEVEL_LABELS } from "@/data";

// ── Layout constants ──────────────────────────────────────────────
const SVG_W = 960;
const PAD_TOP = 70;
const PAD_BOT = 70;
const ROW_GAP = 162;
const COL_X = [140, 340, 550, 790]; // centre X: root, level, chapter, keypoints

// ── Node dimensions ───────────────────────────────────────────────
const ROOT_W = 210;
const ROOT_H = 60;
const LEVEL_W = 110;
const LEVEL_H = 34;
const CHAPTER_W = 198;
const CHAPTER_H = 46;
const KP_W = 166;
const KP_H = 22;
const KP_GAP = 6;
const KP_COUNT = 5;

// ── Helpers ───────────────────────────────────────────────────────
const NUMS = ["①", "②", "③", "④", "⑤"];
const FREQ: Record<string, string> = { high: "高频", medium: "中频", low: "低频" };

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function hBez(x1: number, y1: number, x2: number, y2: number) {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

// ── Layout node type ──────────────────────────────────────────────
interface MindNode {
  id: string;
  type: "root" | "level" | "chapter" | "keypoint";
  x: number;
  y: number;
  label: string;
  full?: string;
  desc?: string;
  chapter?: Chapter;
  row: number;
}

interface MindEdge {
  from: MindNode;
  to: MindNode;
}

// ── Layout engine ─────────────────────────────────────────────────
function computeLayout(category: Category) {
  const chapters = [...category.chapters].sort((a, b) => a.level - b.level);
  const n = chapters.length;
  const svgH = PAD_TOP + PAD_BOT + (n - 1) * ROW_GAP;

  const nodes: MindNode[] = [];
  const edges: MindEdge[] = [];

  // Root — centred vertically
  const root: MindNode = {
    id: "root",
    type: "root",
    x: COL_X[0],
    y: svgH / 2,
    label: category.title,
    desc: category.description,
    row: -1,
  };
  nodes.push(root);

  chapters.forEach((chapter, i) => {
    const rowY = PAD_TOP + i * ROW_GAP;

    // Level label
    const lvl: MindNode = {
      id: `lv-${chapter.level}`,
      type: "level",
      x: COL_X[1],
      y: rowY,
      label: LEVEL_LABELS[chapter.level],
      row: i,
    };
    nodes.push(lvl);
    edges.push({ from: root, to: lvl });

    // Chapter
    const ch: MindNode = {
      id: chapter.id,
      type: "chapter",
      x: COL_X[2],
      y: rowY,
      label: clip(chapter.title, 11),
      full: chapter.title,
      desc: chapter.description,
      chapter,
      row: i,
    };
    nodes.push(ch);
    edges.push({ from: lvl, to: ch });

    // Key points — stacked vertically, centred on rowY
    const kpSpan = KP_COUNT * KP_H + (KP_COUNT - 1) * KP_GAP;
    const kpStart = rowY - kpSpan / 2 + KP_H / 2;

    for (let j = 0; j < Math.min(KP_COUNT, chapter.keyPoints.length); j++) {
      const kp: MindNode = {
        id: `${chapter.id}-kp${j}`,
        type: "keypoint",
        x: COL_X[3],
        y: kpStart + j * (KP_H + KP_GAP),
        label: clip(`${NUMS[j]}${chapter.keyPoints[j]}`, 15),
        full: `${NUMS[j]}${chapter.keyPoints[j]}`,
        row: i,
      };
      nodes.push(kp);
      edges.push({ from: ch, to: kp });
    }
  });

  return { nodes, edges, svgH };
}

// ── Edge SVG path helper ──────────────────────────────────────────
function edgeD(from: MindNode, to: MindNode) {
  // Right edge of source
  const x1 =
    from.x +
    (from.type === "root"
      ? ROOT_W / 2
      : from.type === "level"
        ? LEVEL_W / 2
        : CHAPTER_W / 2);
  // Left edge of target
  const x2 =
    to.x - (to.type === "chapter" ? CHAPTER_W / 2 : to.type === "keypoint" ? KP_W / 2 : LEVEL_W / 2);

  if (from.type === "chapter" && to.type === "keypoint") {
    // Elbow connector: horizontal stub → vertical spine → horizontal stub
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${from.y} L ${mx} ${from.y} L ${mx} ${to.y} L ${x2} ${to.y}`;
  }

  return hBez(x1, from.y, x2, to.y);
}

// ── Component ─────────────────────────────────────────────────────
export function CategoryMindMap({ category }: { category: Category }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<MindNode | null>(null);
  const [tooltipXY, setTooltipXY] = useState({ x: 0, y: 0 });

  const { nodes, edges, svgH } = computeLayout(category);

  const onChapterEnter = (
    node: MindNode,
    e: React.MouseEvent,
  ) => {
    if (node.type !== "chapter") return;
    setHovered(node);
    const svg = (e.target as Element).closest("svg");
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const sx = r.width / SVG_W;
    const sy = r.height / svgH;
    const rawX = r.left + (node.x + CHAPTER_W / 2 + 14) * sx;
    const rawY = r.top + (node.y - 30) * sy;
    // Clamp tooltip inside viewport — use 1024 as SSR-safe fallback
    const maxW = typeof window === "undefined" ? 1024 : window.innerWidth;
    setTooltipXY({
      x: Math.min(rawX, maxW - 280),
      y: Math.max(8, rawY),
    });
  };

  const onChapterLeave = () => setHovered(null);

  const onClick = (
    node: MindNode,
  ) => {
    if (node.type === "chapter" && node.chapter) {
      router.push(`/${category.id}/${node.chapter.id}`);
    }
  };

  // Stagger variants
  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.035, delayChildren: 0.08 } },
  };
  const item = {
    hidden: { opacity: 0, filter: "blur(2px)" },
    visible: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.4 } },
  };

  const palette = {
    chapterFill: "var(--color-bg, #fff)",
    chapterText: "var(--color-text, #18181b)",
    kpText: "var(--color-text-secondary, #52525b)",
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 py-4">
      {/* ── Header ──────────────────────────────────── */}
      <header className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${category.color}15` }}
        >
          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color }} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {category.title}
            <span className="ml-1.5 text-sm font-normal text-[var(--color-text-secondary)]">
              · 思维导图
            </span>
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {category.chapters.length} 个章节 ·{" "}
            {category.chapters.reduce((s, c) => s + c.keyPoints.length, 0)} 个关键知识点
          </p>
        </div>
      </header>

      {/* ── SVG ─────────────────────────────────────── */}
      <div className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
        <motion.svg
          viewBox={`0 0 ${SVG_W} ${svgH}`}
          className="w-full"
          style={{ minHeight: 420 }}
          variants={container}
          initial="hidden"
          animate="visible"
        >
          {/* Edges */}
          {edges.map((e, ei) => (
            <motion.path
              key={`e${ei}`}
              d={edgeD(e.from, e.to)}
              stroke={category.color}
              strokeWidth={e.from.type === "chapter" ? 1 : 1.4}
              strokeOpacity={0.18}
              fill="none"
              variants={item}
            />
          ))}

          {/* Nodes */}
          {nodes.map((node) => (
            <motion.g
              key={node.id}
              variants={item}
              onMouseEnter={(e) => onChapterEnter(node, e)}
              onMouseLeave={onChapterLeave}
              onClick={() => onClick(node)}
              style={{ cursor: node.type === "chapter" ? "pointer" : "default" }}
            >
              {/* ── root ────────────────────── */}
              {node.type === "root" && (
                <>
                  <rect
                    x={node.x - ROOT_W / 2}
                    y={node.y - ROOT_H / 2}
                    width={ROOT_W}
                    height={ROOT_H}
                    rx={12}
                    fill={category.color}
                  />
                  <text
                    x={node.x}
                    y={node.y - 7}
                    textAnchor="middle"
                    dy=".35em"
                    fill="#fff"
                    fontSize={16}
                    fontWeight={700}
                  >
                    {node.label}
                  </text>
                  {node.desc && (
                    <text
                      x={node.x}
                      y={node.y + 17}
                      textAnchor="middle"
                      dy=".35em"
                      fill="rgba(255,255,255,0.78)"
                      fontSize={11}
                    >
                      {clip(node.desc, 16)}
                    </text>
                  )}
                </>
              )}

              {/* ── level ───────────────────── */}
              {node.type === "level" && (
                <>
                  <rect
                    x={node.x - LEVEL_W / 2}
                    y={node.y - LEVEL_H / 2}
                    width={LEVEL_W}
                    height={LEVEL_H}
                    rx={7}
                    fill={`${category.color}14`}
                    stroke={category.color}
                    strokeWidth={1.4}
                  />
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dy=".35em"
                    fill={category.color}
                    fontSize={12}
                    fontWeight={700}
                  >
                    {node.label}
                  </text>
                </>
              )}

              {/* ── chapter ────────────────── */}
              {node.type === "chapter" && (
                <>
                  <rect
                    x={node.x - CHAPTER_W / 2}
                    y={node.y - CHAPTER_H / 2}
                    width={CHAPTER_W}
                    height={CHAPTER_H}
                    rx={8}
                    className="dark:fill-zinc-900"
                    fill={hovered?.id === node.id ? `${category.color}15` : palette.chapterFill}
                    stroke={category.color}
                    strokeWidth={hovered?.id === node.id ? 2 : 1.3}
                  />
                  <text
                    x={node.x}
                    y={node.y - 2}
                    textAnchor="middle"
                    dy=".35em"
                    fill={palette.chapterText}
                    fontSize={13}
                    fontWeight={600}
                  >
                    {node.label}
                  </text>
                  {node.chapter && (
                    <rect
                      x={node.x + CHAPTER_W / 2 - 36}
                      y={node.y + CHAPTER_H / 2 - 14}
                      width={28}
                      height={14}
                      rx={4}
                      fill={`${category.color}20`}
                    />
                  )}
                  {node.chapter && (
                    <text
                      x={node.x + CHAPTER_W / 2 - 22}
                      y={node.y + CHAPTER_H / 2 - 7}
                      textAnchor="middle"
                      dy=".35em"
                      fill={category.color}
                      fontSize={8.5}
                      fontWeight={600}
                    >
                      {FREQ[node.chapter.interviewFrequency]}
                    </text>
                  )}
                </>
              )}

              {/* ── keypoint ───────────────── */}
              {node.type === "keypoint" && (
                <>
                  <rect
                    x={node.x - KP_W / 2}
                    y={node.y - KP_H / 2}
                    width={KP_W}
                    height={KP_H}
                    rx={5}
                    fill={`${category.color}0A`}
                    stroke={`${category.color}28`}
                    strokeWidth={0.8}
                  />
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dy=".35em"
                    fill={palette.kpText}
                    fontSize={11}
                  >
                    {node.label}
                  </text>
                </>
              )}
            </motion.g>
          ))}
        </motion.svg>

        {/* ── Tooltip ───────────────────────────────── */}
        <AnimatePresence>
          {hovered && hovered.chapter && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute z-10 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5 shadow-lg"
              style={{
                left: tooltipXY.x,
                top: tooltipXY.y,
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <span className="text-sm font-semibold">{hovered.full}</span>
                <span className="text-[10px] text-zinc-400">L{hovered.chapter.level}</span>
              </div>
              <p className="mb-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {hovered.desc}
              </p>
              <div className="space-y-1">
                {hovered.chapter.keyPoints.map((kp, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]"
                  >
                    <span className="mt-0.5 shrink-0 text-[10px]" style={{ color: category.color }}>
                      {NUMS[i]}
                    </span>
                    <span>{kp}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Legend ─────────────────────────────────── */}
        <div className="absolute bottom-3 right-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">
          <span>点击章节节点可跳转详情</span>
        </div>
      </div>
    </div>
  );
}
