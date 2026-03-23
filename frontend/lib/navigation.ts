import { Bot, Boxes, Database, Layers, LayoutDashboard, PlayCircle, TableProperties, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AppNavPlacement = 'primary' | 'workspace';

export type AppNavItem = {
  href: string;
  label: string;
  navLabel: string;
  icon: LucideIcon;
  description: string;
  placement: AppNavPlacement;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    href: '/indexing/overview',
    label: 'Index Overview',
    navLabel: 'Overview',
    icon: LayoutDashboard,
    description: 'Protocol health, metrics, and operational snapshot.',
    placement: 'primary',
  },
  {
    href: '/indexing/runs',
    label: 'Index Runs',
    navLabel: 'Runs',
    icon: PlayCircle,
    description: 'Control sync and polling cycles and monitor activity.',
    placement: 'primary',
  },
  {
    href: '/indexing/contracts',
    label: 'Contracts',
    navLabel: 'Contracts',
    icon: Boxes,
    description: 'Contract progress and recent indexed records.',
    placement: 'primary',
  },
  {
    href: '/modeling/studio',
    label: 'Model Studio',
    navLabel: 'Studio',
    icon: Layers,
    description: 'Inspect SQLite schema and generate Cube models.',
    placement: 'primary',
  },
  {
    href: '/modeling/query',
    label: 'Query Lab',
    navLabel: 'Query',
    icon: Database,
    description: 'Run Cube semantic queries and SQL queries.',
    placement: 'primary',
  },
  {
    href: '/modeling/api',
    label: 'API Builder',
    navLabel: 'API',
    icon: Waypoints,
    description: 'Create reusable API endpoints for custom Cube queries.',
    placement: 'primary',
  },
  {
    href: '/derived/pipelines',
    label: 'Derived Tables',
    navLabel: 'Derived',
    icon: TableProperties,
    description: 'Create derived subtables, enrichment joins, and runtime jobs.',
    placement: 'primary',
  },
  {
    href: '/agents',
    label: 'Agents',
    navLabel: 'Agents',
    icon: Bot,
    description: 'Agent manager workspace for Hedera and ElizaOS runtimes.',
    placement: 'primary',
  },
];

export const PRIMARY_NAV_ITEMS = APP_NAV_ITEMS.filter((item) => item.placement === 'primary');
export const WORKSPACE_NAV_ITEMS = APP_NAV_ITEMS.filter((item) => item.placement === 'workspace');

export function resolveNavItem(pathname: string) {
  return APP_NAV_ITEMS.find((entry) => pathname.startsWith(entry.href));
}
