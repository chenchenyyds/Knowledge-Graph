"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { HeadingItem } from "@/lib/utils";

interface SidebarHeadingValue {
  headings: HeadingItem[];
  setHeadings: (h: HeadingItem[]) => void;
  hasActiveChapter: boolean;
  setHasActiveChapter: (v: boolean) => void;
}

const SidebarHeadingContext = createContext<SidebarHeadingValue>({
  headings: [],
  setHeadings: () => {},
  hasActiveChapter: false,
  setHasActiveChapter: () => {},
});

export function SidebarHeadingProvider({ children }: { children: ReactNode }) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [hasActiveChapter, setHasActiveChapter] = useState(false);

  return (
    <SidebarHeadingContext.Provider
      value={{ headings, setHeadings, hasActiveChapter, setHasActiveChapter }}
    >
      {children}
    </SidebarHeadingContext.Provider>
  );
}

export function useSidebarHeadings() {
  return useContext(SidebarHeadingContext);
}
