import { Sidebar } from "@/components/layout/sidebar";
import { SidebarHeadingProvider } from "@/components/layout/sidebar-heading-context";

export default function CategoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarHeadingProvider>
      <div className="flex gap-8">
        <Sidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </SidebarHeadingProvider>
  );
}
