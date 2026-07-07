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
      <SidebarInset
        id="main-content"
        tabIndex={-1}
        className="focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="h-svh flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">{children}</div>
          {!isGamePage && <AppFooter />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
