'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Settings, HelpCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_NAV_ITEMS, resolveNavItem, type AppNavItem } from '@/lib/navigation';
import { useSharedStatus } from '@/lib/status-store';
import { cn } from '@/lib/utils';

type DashboardShellProps = {
  children: React.ReactNode;
};

const SIDEBAR_NAV_ITEMS = APP_NAV_ITEMS.filter((item) =>
  ['primary', 'workspace'].includes(item.placement)
);

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href);
}

function SidebarNavLink({ item, pathname }: { item: AppNavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded text-sm font-medium transition-all duration-200',
        active
          ? 'text-[#b9f2d1] bg-[#1c1b1c] border-r-2 border-[#b9f2d1] font-semibold'
          : 'text-gray-500 hover:text-white hover:bg-[#2a2a2b]'
      )}
    >
      <item.icon className="h-5 w-5 flex-none" />
      <span>{item.navLabel}</span>
    </Link>
  );
}

function ServiceDot({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        state === 'up' && 'bg-[#b9f2d1]',
        state === 'degraded' && 'bg-yellow-400',
        state === 'down' && 'bg-red-400',
        state !== 'up' && state !== 'degraded' && state !== 'down' && 'bg-gray-500',
      )}
    />
  );
}

function formatUptime(seconds: number | null | undefined) {
  const parsed = Number(seconds || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return '--';
  const days = Math.floor(parsed / 86400);
  const hours = Math.floor((parsed % 86400) / 3600);
  const minutes = Math.floor((parsed % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const isAgentsRoute = pathname?.startsWith('/agents');
  const [mobileOpen, setMobileOpen] = useState(false);
  const sharedStatus = useSharedStatus();
  const status = sharedStatus.status;

  useEffect(() => {
    setMobileOpen(false);
    if (typeof window !== 'undefined' && pathname && !pathname.startsWith('/agents')) {
      window.sessionStorage.setItem('sefi:last-non-agent-path', pathname);
    }
  }, [pathname]);

  const backendState = sharedStatus.backend;
  const cubeState = sharedStatus.cube;
  const dbState = status?.db_status || 'starting';
  const dbLatency = status?.db_last_read_duration_ms;

  if (isAgentsRoute) {
    return (
      <div className="relative min-h-screen bg-[#0e0e0f] text-foreground overflow-hidden">
        <main className="p-4 sm:p-8 min-h-screen">
          <div className="page-enter">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#0e0e0f] text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden lg:flex h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-[#0e0e0f] font-display antialiased tracking-tight flex-col p-6 space-y-8 z-50">
        <Link href="/indexing/overview" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#b6efce] flex items-center justify-center">
            <svg className="w-5 h-5 text-[#002113]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter text-white">SeFi</h1>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Blockchain Indexer</p>
          </div>
        </Link>

        <nav className="flex-1 space-y-1">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <SidebarNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/[0.06] space-y-1">
          <a className="flex items-center gap-3 px-4 py-2 rounded text-gray-500 hover:text-white transition-colors text-sm" href="#">
            <Settings className="h-5 w-5" />
            <span>Settings</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-2 rounded text-gray-500 hover:text-white transition-colors text-sm" href="#">
            <HelpCircle className="h-5 w-5" />
            <span>Support</span>
          </a>
        </div>
      </aside>

      {/* Top header */}
      <header className="fixed top-0 right-0 left-0 lg:left-64 h-16 z-40 bg-[#131314]/80 backdrop-blur-xl flex justify-between items-center px-4 sm:px-8 border-b border-white/[0.04]">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-foreground lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Service status pills */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <ServiceDot state={backendState} />
              <span className="text-xs text-gray-400">Backend</span>
            </div>
            <div className="flex items-center gap-2">
              <ServiceDot state={dbState} />
              <span className="text-xs text-gray-400">DB</span>
            </div>
            <div className="flex items-center gap-2">
              <ServiceDot state={cubeState} />
              <span className="text-xs text-gray-400">Cube</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-400">
          {dbLatency != null && (
            <span>Latency: <span className="text-white">{dbLatency}ms</span></span>
          )}
          <span>Uptime: <span className="text-white">{formatUptime(status?.uptime_seconds)}</span></span>
        </div>
      </header>

      {/* Main content */}
      <main className="lg:ml-64 mt-16 p-4 sm:p-8 h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="page-enter">{children}</div>
      </main>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[280px] max-w-[88vw] bg-[#0e0e0f] p-6 space-y-8 flex flex-col">
            <div className="flex items-center justify-between">
              <Link href="/indexing/overview" className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-[#b6efce] flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#002113]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9z"/>
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tighter text-white">SeFi</h1>
                  <p className="text-[9px] uppercase tracking-widest text-gray-500">Blockchain Indexer</p>
                </div>
              </Link>
              <Button variant="ghost" size="sm" className="px-2 text-foreground" onClick={() => setMobileOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <nav className="flex-1 space-y-1">
              {SIDEBAR_NAV_ITEMS.map((item) => (
                <SidebarNavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}
