"use client";

import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppFooter } from "@/components/app-footer";
import { IndexedDBMigration } from "@/components/indexeddb-migration";
import { OnboardingTour } from "@/components/onboarding-tour";
import { RouteAnnouncer } from "@/components/route-announcer";
import { usePathname } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isGamePage = pathname?.includes("/game/");

  return (
    <SidebarProvider>
      <RouteAnnouncer />
      <IndexedDBMigration />
      <OnboardingTour />
      <Sidebar collapsible="icon">
        <AppSidebar />
      </Sidebar>
      <SidebarInset>
        <div className="h-svh flex flex-col overflow-hidden">
          <main className="flex-1 min-h-0 overflow-auto">{children}</main>
          {!isGamePage && <AppFooter />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
