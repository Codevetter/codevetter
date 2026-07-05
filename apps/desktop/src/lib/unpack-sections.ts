export type UnpackPhase = 'idle' | 'scanning' | 'generating' | 'asking' | 'ready' | 'error';

import type { LucideIcon } from 'lucide-react';
import { Activity, FileText, FolderTree, GitBranch, LayoutDashboard, Network } from 'lucide-react';

export type UnpackWorkspaceSection =
  | 'overview'
  | 'brief'
  | 'inventory'
  | 'intelligence'
  | 'delta'
  | 'snapshots';

export type UnpackSectionMeta = {
  id: UnpackWorkspaceSection;
  label: string;
  short: string;
  icon: LucideIcon;
  description: string;
  requiresInventory?: boolean;
  requiresReport?: boolean;
  requiresComparison?: boolean;
};

export const UNPACK_SECTIONS: UnpackSectionMeta[] = [
  {
    id: 'overview',
    label: 'Overview',
    short: 'Overview',
    icon: LayoutDashboard,
    description: 'Mission status, metric readout, and next actions.',
  },
  {
    id: 'brief',
    label: 'Analysis',
    short: 'AI',
    icon: FileText,
    description: 'Optional AI analysis attached to the selected local snapshot.',
    requiresInventory: true,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    short: 'Files',
    icon: FolderTree,
    description: 'Languages, directories, entrypoints, and scan stats.',
    requiresInventory: true,
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    short: 'Graph',
    icon: Network,
    description: 'QA posture, repo health, memory graph, deep graph index, and history.',
    requiresInventory: true,
  },
  {
    id: 'delta',
    label: 'Delta',
    short: 'Delta',
    icon: Activity,
    description: 'Snapshot diffs, commit range, verification leads, and calibration.',
    requiresInventory: true,
    requiresComparison: true,
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    short: 'History',
    icon: GitBranch,
    description: 'Stored unpack runs for this project.',
  },
];

export function visibleUnpackSections(input: {
  hasInventory: boolean;
  hasReport: boolean;
  hasComparison: boolean;
}): UnpackSectionMeta[] {
  return UNPACK_SECTIONS.filter((section) => {
    if (section.requiresInventory && !input.hasInventory) return false;
    if (section.requiresReport && !input.hasReport) return false;
    if (section.requiresComparison && !input.hasComparison) return false;
    return true;
  });
}

export function isUnpackSection(value: string | null): value is UnpackWorkspaceSection {
  return UNPACK_SECTIONS.some((s) => s.id === value);
}
