import { Sidebar, SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { AppFooter } from '@/components/app-footer';
import { IndexedDBMigration } from '@/components/indexeddb-migration';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <IndexedDBMigration />
      <Sidebar>
        <AppSidebar />
      </Sidebar>
      <SidebarInset>
        <div className="min-h-svh flex flex-col">
          {children}
          <AppFooter />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
