import { Sidebar } from "@/components/layout/sidebar";
import { notFound } from "next/navigation";
import { CATEGORIES } from "@/data";

export default function CategoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ category: string }>;
}) {
  // Validate category exists
  // This is a layout component - validation happens at page level too
  return (
    <div className="flex gap-8">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
