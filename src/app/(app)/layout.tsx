"use client";

import { useEffect } from "react";
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
import { prewarmSearchWorker } from "@/lib/search/prewarm-search-worker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isGamePage = pathname?.includes("/game/");

  // Pre-warm the Orama worker index during idle time so the first
  // deck-builder query does not pay 200–600ms of indexing latency (issue
  // #1576). The helper is SSR-safe (`schedule()` is a no-op when window is
  // undefined) and idempotent — React 19 StrictMode double-mount or HMR will
  // not duplicate the work. Fire-and-forget: readiness is observable via
  // `searchWorkerClient.getStatus()` and `searchWorkerPrewarm.subscribe`.
  useEffect(() => {
    prewarmSearchWorker();
  }, []);

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
