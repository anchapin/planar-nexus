'use client';

import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Bot, LayoutDashboard, Library, Swords, Users, Eye } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';

export function AppSidebar() {
  const pathname = usePathname();

  const menuItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/deck-builder', label: 'Deck Builder', icon: Library },
    { href: '/deck-coach', label: 'AI Deck Coach', icon: Bot },
    { href: '/single-player', label: 'Single Player', icon: Swords },
    { href: '/multiplayer', label: 'Multiplayer', icon: Users },
    { href: '/game-board', label: 'Game Board Demo', icon: Eye },
  ];

  return (
    <>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex w-full items-center gap-2">
          <Swords className="size-8 text-primary" />
          <h1 className="font-headline text-xl font-bold text-foreground">
            Planar Nexus
          </h1>
          <div className="grow" />
          <SidebarTrigger />
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                tooltip={{ children: item.label }}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="mt-auto border-t border-sidebar-border p-2">
        <div className="flex items-center gap-3">
            <Avatar className="size-8">
                <AvatarImage src="https://picsum.photos/seed/avatar/40/40" data-ai-hint="abstract avatar" />
                <AvatarFallback>PN</AvatarFallback>
            </Avatar>
            <div className="flex flex-col text-sm">
                <span className="font-semibold text-foreground">Player One</span>
                <span className="text-xs text-sidebar-foreground">#54321</span>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto size-7">
                <Users className="size-4" />
            </Button>
        </div>
      </SidebarFooter>
    </>
  );
}
