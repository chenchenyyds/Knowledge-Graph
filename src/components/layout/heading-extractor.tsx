"use client";

import { useEffect } from "react";
import { useSidebarHeadings } from "./sidebar-heading-context";
import type { HeadingItem } from "@/lib/utils";

interface HeadingExtractorProps {
  headings: HeadingItem[];
}

export function HeadingExtractor({ headings }: HeadingExtractorProps) {
  const { setHeadings, setHasActiveChapter } = useSidebarHeadings();

  useEffect(() => {
    setHeadings(headings);
    setHasActiveChapter(true);

    return () => {
      setHeadings([]);
      setHasActiveChapter(false);
    };
  }, [headings, setHeadings, setHasActiveChapter]);

  return null;
}
