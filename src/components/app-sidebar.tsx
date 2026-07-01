"use client";

import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Bot,
  LayoutDashboard,
  Library,
  Swords,
  Users,
  Eye,
  Settings,
  Gem,
  BarChart3,
  Package,
  Save,
  MousePointer,
  Palette,
  GraduationCap,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { useTranslations } from "next-intl";

function resolveAriaCurrent(
  pathname: string | null,
  href: string,
): "page" | "true" | undefined {
  if (!pathname) return undefined;
  if (pathname === href) return "page";
  // Treat `/foo` as the parent of `/foo/anything` and `/foo?...` so that
  // nested routes (e.g. `/deck-builder/123`) still announce the section
  // as current for assistive technology. The trailing-slash guard prevents
  // `/deck-builder-other` from matching `/deck-builder`.
  if (pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`)) {
    return "true";
  }
  return undefined;
}

export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslations("sidebar");
  const tCommon = useTranslations("common");

  const menuItems = [
    { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
    {
      href: "/deck-builder",
      labelKey: "deckBuilder",
      icon: Library,
      tourId: "deck-builder",
    },
    { href: "/card-studio", labelKey: "cardStudio", icon: Palette },
    {
      href: "/collection",
      labelKey: "collection",
      icon: Package,
      tourId: "collection",
    },
    { href: "/draft-assistant", labelKey: "draftAssistant", icon: Gem },
    {
      href: "/deck-coach",
      labelKey: "aiDeckCoach",
      icon: Bot,
      tourId: "deck-coach",
    },
    { href: "/coach-report", labelKey: "coachReport", icon: GraduationCap },
    { href: "/meta", labelKey: "metaAnalysis", icon: TrendingUp },
    { href: "/game-analysis", labelKey: "gameAnalysis", icon: BarChart3 },
    { href: "/saved-games", labelKey: "savedGames", icon: Save },
    {
      href: "/single-player",
      labelKey: "singlePlayer",
      icon: Swords,
      tourId: "single-player",
    },
    {
      href: "/multiplayer",
      labelKey: "multiplayer",
      icon: Users,
      tourId: "multiplayer",
    },
    { href: "/game-board", labelKey: "gameBoardDemo", icon: Eye },
    {
      href: "/card-interactions-demo",
      labelKey: "cardInteractions",
      icon: MousePointer,
    },
    {
      href: "/settings",
      labelKey: "settings",
      icon: Settings,
      tourId: "settings",
    },
  ];

  return (
    <>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex w-full items-center gap-2 px-2 py-1">
          <Swords className="size-8 text-primary shrink-0" />
          <h1 className="font-headline text-lg md:text-xl font-bold text-foreground truncate group-data-[collapsible=icon]:hidden">
            {tCommon("appName")}
          </h1>
          <div className="grow" />
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {menuItems.map((item) => {
            const label = t(item.labelKey);
            const ariaCurrent = resolveAriaCurrent(pathname, item.href);
            const isActive = ariaCurrent !== undefined;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={{ children: label }}
                >
                  <Link
                    href={item.href}
                    data-tour={item.tourId}
                    aria-current={ariaCurrent}
                  >
                    <item.icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="mt-auto border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2 md:gap-3">
          <Avatar className="size-8 md:size-8 shrink-0">
            <AvatarImage
              src="https://picsum.photos/seed/avatar/40/40"
              data-ai-hint="abstract avatar"
            />
            <AvatarFallback>PN</AvatarFallback>
          </Avatar>
          <div className="flex flex-col text-xs md:text-sm min-w-0">
            <span className="font-semibold text-foreground truncate">
              {t("playerName")}
            </span>
            <span className="text-xs text-sidebar-foreground hidden md:block">
              {t("playerId")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7 shrink-0"
            aria-label={t("keyboardShortcuts")}
            title={t("keyboardShortcuts")}
          >
            <MousePointer className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7 shrink-0"
            aria-label={t("community")}
            title={t("community")}
          >
            <Users className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </>
  );
}
