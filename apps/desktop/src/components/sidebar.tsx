import { Activity, ArrowRight, Eye, Gauge, ScanSearch, Search, Settings, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { BrandMark } from '@/components/brand-mark';
import ResourceChip from '@/components/ResourceChip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  description: string;
  match?: string[];
}

interface SidebarProps {
  onSearch: () => void;
}

const contextNavItems: NavItem[] = [
  {
    label: 'Usage',
    href: '/',
    icon: <Activity size={17} />,
    description: 'AI usage, cost, and activity',
  },
  {
    label: 'Repo Unpack',
    href: '/unpack',
    icon: <ScanSearch size={17} />,
    description: 'Intel, history, graph, and ownership',
    match: ['/unpack', '/intel'],
  },
];

const workflowNavItems: NavItem[] = [
  {
    label: 'Review',
    href: '/review',
    icon: <Zap size={17} />,
    description: 'Inspect the change and identify evidence gaps',
  },
  {
    label: 'Testing',
    href: '/trex',
    icon: <Eye size={17} />,
    description: 'Run executable checks and inspect receipts',
  },
  {
    label: 'Performance',
    href: '/performance',
    icon: <Gauge size={17} />,
    description: 'Measure one flow and verify an improvement',
  },
];

const settingsNavItem: NavItem = {
  label: 'Settings',
  href: '/settings',
  icon: <Settings size={17} />,
  description: 'Providers and preferences',
};

const productNavItems = [...contextNavItems, ...workflowNavItems];
const navItems = [...productNavItems, settingsNavItem];

export default function Sidebar({ onSearch }: SidebarProps) {
  const { pathname } = useLocation();

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    const item = navItems.find((navItem) => navItem.href === href);
    return (item?.match ?? [href]).some((prefix) => pathname.startsWith(prefix));
  }

  function renderNavItem(item: NavItem) {
    const active = isActive(item.href);
    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>
          <Link
            to={item.href}
            data-nav-destination={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-[14px] transition-[background-color,color,box-shadow] duration-150',
              active
                ? 'bg-amber-300/[0.1] text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]'
                : 'text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100'
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150',
                active
                  ? 'bg-amber-300/[0.1] text-amber-200'
                  : 'text-zinc-500 group-hover:text-zinc-200'
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-52 text-[11px]">
          {item.description}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <nav
        aria-label="Primary navigation"
        className="no-drag relative z-40 hidden h-full w-64 shrink-0 flex-col overflow-hidden border-r border-white/[0.075] bg-[#0a0b0d]/96 shadow-[16px_0_48px_-42px_rgba(0,0,0,0.95)] backdrop-blur-2xl md:flex"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_20%_0%,rgba(243,173,61,0.11),transparent_62%)]"
          aria-hidden="true"
        />

        <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-3 pt-4">
          <div className="flex h-11 items-center gap-2.5 px-2">
            <BrandMark className="h-8 w-8 shadow-[0_8px_24px_-14px_rgba(243,173,61,0.85)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold tracking-[-0.015em] text-zinc-100">
                CodeVetter
              </div>
              <div className="text-[11px] text-zinc-400/75">Evidence workbench</div>
            </div>
          </div>

          <Link
            to="/review"
            data-testid="check-change-action"
            className="group mt-3 flex min-h-12 items-center gap-3 rounded-xl bg-[var(--cv-accent)] px-3 text-[#090a0c] shadow-[0_10px_28px_-18px_rgba(243,173,61,0.85)] transition-[background-color,box-shadow] duration-150 hover:bg-amber-300 hover:shadow-[0_12px_30px_-16px_rgba(243,173,61,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0d]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/10">
              <Zap size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Check a change</span>
              <span className="block truncate text-[10px] font-medium text-black/60">
                Review · run · decide
              </span>
            </span>
            <ArrowRight
              size={15}
              className="transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>

          <button
            type="button"
            onClick={onSearch}
            className="mt-2 flex h-[40px] w-full items-center gap-2.5 rounded-xl border border-white/[0.075] bg-white/[0.035] px-3 text-left text-[13px] text-zinc-400/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-[border-color,background-color,color] duration-150 hover:border-white/[0.13] hover:bg-white/[0.055] hover:text-zinc-200"
            aria-label="Search commands"
          >
            <Search size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Search commands</span>
          </button>

          <div className="mt-6 min-h-0 overflow-y-auto">
            <NavGroup label="Signals">{contextNavItems.map(renderNavItem)}</NavGroup>
            <NavGroup label="Workbench" className="mt-5">
              {workflowNavItems.map(renderNavItem)}
            </NavGroup>
          </div>
        </div>

        <div className="relative border-t border-white/[0.065] px-3 py-3">
          <div className="mb-2 px-1">
            <ResourceChip placement="sidebar" />
          </div>
          {renderNavItem(settingsNavItem)}
        </div>
      </nav>
    </TooltipProvider>
  );
}

function NavGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className} aria-labelledby={`sidebar-${label.toLowerCase()}`}>
      <h2
        id={`sidebar-${label.toLowerCase()}`}
        className="mb-1.5 px-3 text-[11px] font-medium text-zinc-400/75"
      >
        {label}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
