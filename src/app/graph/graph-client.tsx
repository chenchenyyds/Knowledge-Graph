"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { CATEGORIES, type Category, type Chapter } from "@/data";
import { X } from "lucide-react";

const GRAPH_W = 900;
const GRAPH_H = 700;

interface Props {
  categories: typeof CATEGORIES;
  chapters: { category: Category; chapter: Chapter }[];
}

interface LayoutNode {
  id: string;
  label: string;
  categoryId: string;
  color: string;
  level: number;
  x: number;
  y: number;
  radius: number;
  href: string;
}

interface LayoutEdge {
  from: string;
  to: string;
}

function computeLayout(categories: typeof CATEGORIES, chapters: { category: Category; chapter: Chapter }[]): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
} {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const nodeMap = new Map<string, LayoutNode>();

  // Layout: categories arranged in a circle, chapters arranged around their category
  const cx = GRAPH_W / 2;
  const cy = GRAPH_H / 2;
  const catRadius = 220;
  const chapterRadius = 100;

  categories.forEach((cat, catIdx) => {
    const catAngle = (catIdx / categories.length) * Math.PI * 2 - Math.PI / 2;
    const catX = cx + catRadius * Math.cos(catAngle);
    const catY = cy + catRadius * Math.sin(catAngle);

    const catNode: LayoutNode = {
      id: cat.id,
      label: cat.title,
      categoryId: cat.id,
      color: cat.color,
      level: 0,
      x: catX,
      y: catY,
      radius: 28,
      href: `/${cat.id}`,
    };
    nodes.push(catNode);
    nodeMap.set(cat.id, catNode);

    const catChapters = chapters.filter((c) => c.category.id === cat.id);
    catChapters.forEach(({ chapter }, chIdx) => {
      const spread = catChapters.length > 1 ? (chIdx / (catChapters.length - 1) - 0.5) : 0;
      const angle = catAngle + spread * 0.8;
      const chX = catX + chapterRadius * Math.cos(angle);
      const chY = catY + chapterRadius * Math.sin(angle);

      const chNode: LayoutNode = {
        id: chapter.id,
        label: chapter.title,
        categoryId: cat.id,
        color: cat.color,
        level: chapter.level,
        x: chX,
        y: chY,
        radius: 12 + (5 - chapter.level) * 2,
        href: `/${cat.id}/${chapter.id}`,
      };
      nodes.push(chNode);
      nodeMap.set(chapter.id, chNode);

      // Edge: category -> chapter
      edges.push({ from: cat.id, to: chapter.id });

      // Edges: related chapters
      for (const relId of chapter.relatedChapters) {
        if (nodeMap.has(relId)) {
          edges.push({ from: chapter.id, to: relId });
        }
      }
    });
  });

  return { nodes, edges };
}

export function GraphClient({ categories, chapters }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes, edges } = computeLayout(categories, chapters);
  const selectedNode = selected ? nodes.find((n) => n.id === selected) : null;

  // Find connected nodes for highlighting
  const connectedNodes = new Set<string>();
  if (hovered) {
    connectedNodes.add(hovered);
    for (const edge of edges) {
      if (edge.from === hovered) connectedNodes.add(edge.to);
      if (edge.to === hovered) connectedNodes.add(edge.from);
    }
  }
  if (selected) {
    connectedNodes.add(selected);
    for (const edge of edges) {
      if (edge.from === selected) connectedNodes.add(edge.to);
      if (edge.to === selected) connectedNodes.add(edge.from);
    }
  }

  const palette = {
    bg: "var(--color-bg-secondary, #f4f4f5)",
    edgeStroke: "var(--color-border, #e4e4e7)",
    activeEdgeStroke: "#3b82f6",
    nodeFill: "var(--color-bg, #ffffff)",
    nodeStroke: "var(--color-border, #d4d4d7)",
    activeNodeFill: "#eef2ff",
    activeNodeStroke: "#3b82f6",
    text: "var(--color-text-secondary, #71717a)",
    activeText: "#09090b",
  };

  return (
    <div className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        className="w-full rounded-xl"
        style={{ minHeight: 400 }}
      >
        {/* Edges */}
        {edges.map((edge) => {
          const fromNode = nodes.find((n) => n.id === edge.from);
          const toNode = nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const isActive = connectedNodes.has(edge.from) && connectedNodes.has(edge.to);
          const isSelectedRel = selected && (edge.from === selected || edge.to === selected);

          return (
            <motion.line
              key={`${edge.from}-${edge.to}`}
              x1={fromNode.x}
              y1={fromNode.y}
              x2={toNode.x}
              y2={toNode.y}
              stroke={isActive ? fromNode.color : palette.edgeStroke}
              strokeWidth={isActive ? 2 : 0.8}
              strokeOpacity={isActive ? 0.8 : 0.3}
              animate={{
                stroke: isActive ? fromNode.color : palette.edgeStroke,
                strokeWidth: isActive ? 2 : 0.8,
                strokeOpacity: isActive ? 0.8 : 0.3,
              }}
              transition={{ duration: 0.3 }}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isCategory = node.level === 0;
          const isSelected = selected === node.id;
          const isHovered = hovered === node.id;
          const isConnected = connectedNodes.has(node.id);
          const isDimmed = (hovered || selected) && !isConnected;

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected(node.id === selected ? null : node.id)}
              style={{ cursor: "pointer" }}
              className="transition-opacity"
              opacity={isDimmed ? 0.25 : 1}
            >
              {isCategory ? (
                // Category: large circle
                <>
                  {isSelected && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 6}
                      fill="none"
                      stroke={node.color}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                    />
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={`${node.color}15`}
                    stroke={node.color}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={700}
                    fill={node.color}
                  >
                    {node.label.slice(0, 4)}
                  </text>
                </>
              ) : (
                // Chapter: small circle
                <>
                  {isSelected && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 5}
                      fill="none"
                      stroke={node.color}
                      strokeWidth={2}
                      strokeDasharray="3 2"
                    />
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={isHovered ? `${node.color}30` : "#fff"}
                    stroke={node.color}
                    strokeWidth={isHovered ? 2 : 1}
                    className="dark:fill-zinc-900"
                  />
                  <text
                    x={node.x}
                    y={node.y + node.radius + 12}
                    textAnchor="middle"
                    fontSize={8}
                    fill={isHovered ? node.color : palette.text}
                    fontWeight={isHovered ? 600 : 400}
                  >
                    {node.label.length > 8 ? node.label.slice(0, 8) + "…" : node.label}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Selected node popup */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-lg"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selectedNode.color }}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{selectedNode.label}</span>
                  {selectedNode.level > 0 && (
                    <span className="text-[10px] text-zinc-400">L{selectedNode.level}</span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  点击查看详情
                </p>
              </div>
              <Link
                href={selectedNode.href}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                前往
              </Link>
              <button
                onClick={(e) => { e.stopPropagation(); setSelected(null); }}
                className="rounded-md p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="absolute top-4 right-4 space-y-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs">
        <div className="font-semibold mb-2">图例</div>
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color }} />
            <span className="text-[var(--color-text-secondary)]">{cat.title}</span>
          </div>
        ))}
        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full border border-dashed border-zinc-400" />
            <span className="text-[var(--color-text-secondary)]">点击选中节点</span>
          </div>
        </div>
      </div>
    </div>
  );
}
