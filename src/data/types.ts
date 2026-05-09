export interface Chapter {
  id: string;
  title: string;
  level: number;
  description: string;
  content: string;
  keyPoints: string[];
  relatedChapters: string[];
  interviewFrequency: "high" | "medium" | "low";
}

export interface Category {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  chapters: Chapter[];
}