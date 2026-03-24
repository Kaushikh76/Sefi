'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Settings, HelpCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { APP_NAV_ITEMS, resolveNavItem, type AppNavItem } from '@/lib/navigation';
import { getAuthState, loginForFullAccess, type AuthStateResponse } from '@/lib/sefi-api';
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
  const [authState, setAuthState] = useState<AuthStateResponse | null>(null);
  const [showAccessPanel, setShowAccessPanel] = useState(false);
  const [accessPanelStep, setAccessPanelStep] = useState<'choice' | 'auth'>('choice');
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const sharedStatus = useSharedStatus();
  const status = sharedStatus.status;

  useEffect(() => {
    setMobileOpen(false);
    if (typeof window !== 'undefined' && pathname && !pathname.startsWith('/agents')) {
      window.sessionStorage.setItem('sefi:last-non-agent-path', pathname);
    }
  }, [pathname]);

  const refreshAuthState = useCallback(async () => {
    try {
      const nextState = await getAuthState();
      setAuthState(nextState);
      const shouldGate =
        Boolean(nextState.can_login) &&
        !nextState.full_access &&
        (nextState.demo_mode || nextState.auth_enabled || nextState.require_auth);
      setShowAccessPanel(shouldGate);
      setAccessPanelStep(nextState.require_auth ? 'auth' : 'choice');
      if (nextState.full_access) {
        setAccessKeyInput('');
        setAuthError(null);
        setAccessPanelStep('choice');
      }
      return true;
    } catch {
      // keep dashboard usable even if auth state endpoint is temporarily unavailable
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const pollTimer = setInterval(() => {
      void refreshAuthState();
    }, 20000);

    const runInitial = async () => {
      const ok = await refreshAuthState();
      if (!ok && !cancelled) {
        retryTimer = setTimeout(() => {
          void runInitial();
        }, 3000);
      }
    };

    void runInitial();

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [refreshAuthState]);

  const handleLogin = async () => {
    try {
      setAuthSubmitting(true);
      setAuthError(null);
      setAuthNotice(null);
      await loginForFullAccess(accessKeyInput.trim());
      setAuthNotice('Full access granted.');
      await refreshAuthState();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const openAdminAuthPanel = () => {
    setAuthError(null);
    setAuthNotice(null);
    setAccessPanelStep('auth');
    setShowAccessPanel(true);
  };

  const backendState = sharedStatus.backend;
  const cubeState = sharedStatus.cube;
  const dbState = status?.db_status || 'starting';
  const dbLatency = status?.db_last_read_duration_ms;
  const demoMode = Boolean(authState?.demo_mode);
  const fullAccess = Boolean(authState?.full_access);
  const authEnabled = Boolean(authState?.auth_enabled);
  const requireAuth = Boolean(authState?.require_auth);
  const accessGateTitle = requireAuth ? 'Authentication Required' : 'Secure Access';
  const accessInputLabel = requireAuth || authEnabled ? 'Access Token / Key' : 'Access Key';
  const loginButtonLabel = requireAuth || authEnabled ? 'Login' : 'Login for Full Access';
  const canContinueWithoutLogin = demoMode && !requireAuth;
  const showChoiceStep = canContinueWithoutLogin && accessPanelStep === 'choice';
  const showAuthStep = !showChoiceStep;

  const accessOverlay = showAccessPanel ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-3xl rounded-3xl border border-white/15 bg-gradient-to-b from-[#1f2024]/95 to-[#111216]/95 p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-xl border border-white/10 bg-white/5 p-2">
            <Sparkles className="h-5 w-5 text-[#b9f2d1]" />
          </div>
          <div>
            {showChoiceStep ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Demo Access</p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-100">GM Hedera &amp; Bonzo Judges</h2>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                  {requireAuth || authEnabled ? 'Access Control' : 'Admin Mode'}
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-100">
                  {requireAuth ? accessGateTitle : 'Admin Mode Access'}
                </h2>
              </>
            )}
          </div>
        </div>

        {showChoiceStep ? (
          <>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-300">
              As this is a live demo with <strong className="text-zinc-100">Millions</strong> of data points being processed,
              some features are disabled for safety.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              In demo mode you can <strong className="text-zinc-100">browse all pages</strong>, <strong className="text-zinc-100">send query</strong>, and <strong className="text-zinc-100">talk with agent</strong>.
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              For full access, kindly contact <a className="text-[#b9f2d1] underline underline-offset-4" href="mailto:connect@kaushikh.xyz">connect@kaushikh.xyz</a>.
            </p>
          </>
        ) : (
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-zinc-300">
            {requireAuth
              ? 'This deployment requires authentication before data access. Enter your access token or key to continue.'
              : 'Enter the admin token/access key to switch from demo mode to full admin mode.'}
          </p>
        )}

        {showAuthStep ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-zinc-500" htmlFor="demo-access-key">
              {accessInputLabel}
            </label>
            <input
              id="demo-access-key"
              type="password"
              value={accessKeyInput}
              onChange={(event) => setAccessKeyInput(event.target.value)}
              placeholder="Enter admin access key"
              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-[#b9f2d1]/60 focus:ring-2 focus:ring-[#b9f2d1]/20"
              autoComplete="off"
            />
            {authError ? <p className="mt-2 text-xs text-rose-300">{authError}</p> : null}
            {authNotice ? <p className="mt-2 text-xs text-emerald-300">{authNotice}</p> : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {showChoiceStep ? (
            <>
              <Button variant="secondary" onClick={() => setShowAccessPanel(false)} disabled={authSubmitting}>
                Continue to Demo
              </Button>
              <Button onClick={() => setAccessPanelStep('auth')} disabled={authSubmitting}>
                Access with Auth
              </Button>
            </>
          ) : (
            <>
              {canContinueWithoutLogin ? (
                <Button variant="secondary" onClick={() => setAccessPanelStep('choice')} disabled={authSubmitting}>
                  Back to Demo
                </Button>
              ) : null}
              <Button onClick={handleLogin} disabled={authSubmitting || accessKeyInput.trim().length === 0}>
                {authSubmitting ? 'Logging in...' : loginButtonLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;

  if (isAgentsRoute) {
    return (
      <div className="relative min-h-screen bg-[#0e0e0f] text-foreground overflow-hidden">
        <main className="p-4 sm:p-8 min-h-screen">
          <div className="page-enter">{children}</div>
        </main>
        {accessOverlay}
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
          {demoMode && !fullAccess ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                <ShieldAlert className="h-3 w-3" /> Demo mode
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={openAdminAuthPanel}
              >
                Switch to Admin
              </Button>
            </>
          ) : null}
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
      {accessOverlay}
    </div>
  );
}
