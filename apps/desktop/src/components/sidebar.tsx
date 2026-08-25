import { Activity, Eye, Gauge, ScanSearch, Settings, Zap } from 'lucide-react';
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

export default function Sidebar() {
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
              'group relative flex min-h-[42px] items-center gap-3 rounded-lg px-3 text-[13.5px] transition-[background-color,color] duration-150',
              active
                ? 'bg-white/[0.07] text-zinc-50'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center transition-colors duration-150',
                active ? 'text-amber-200' : 'text-zinc-500 group-hover:text-zinc-200'
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium tracking-[-0.005em]">
              {item.label}
            </span>
            {active && (
              <span
                className="absolute inset-y-2 left-0 w-px rounded-full bg-amber-200"
                aria-hidden="true"
              />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-52 text-[12px]">
          {item.description}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <nav
        aria-label="Primary navigation"
        className="no-drag relative z-40 hidden h-full w-[232px] shrink-0 flex-col overflow-hidden border-r border-white/[0.075] bg-[#090a0b] md:flex"
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-white/[0.065] px-4">
          <BrandMark className="h-7 w-7" />
          <div className="truncate text-[14px] font-semibold tracking-[-0.015em] text-zinc-100">
            CodeVetter
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-3 pt-5">
          <div className="min-h-0 overflow-y-auto">
            <NavGroup label="Workspace">{contextNavItems.map(renderNavItem)}</NavGroup>
            <NavGroup label="Verification" className="mt-6">
              {workflowNavItems.map(renderNavItem)}
            </NavGroup>
          </div>
        </div>

        <div className="border-t border-white/[0.065] px-3 py-3">
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
        className="mb-2 px-3 text-[12px] font-semibold tracking-[-0.005em] text-zinc-400"
      >
        {label}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
