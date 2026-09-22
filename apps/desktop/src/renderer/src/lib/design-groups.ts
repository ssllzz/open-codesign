import type { Design } from '@open-codesign/shared';
import { workspacePathComparisonKey } from './workspace-path';

export type DesignSortKey = 'createdAt' | 'updatedAt' | 'lastSessionAt';

export interface DesignGroup {
  key: string;
  /** Series name — the earliest-created design's name in the group. */
  title: string;
  designs: Design[];
}

function designGroupKey(design: Design): string {
  return design.workspacePath !== null
    ? workspacePathComparisonKey(design.workspacePath)
    : `design:${design.id}`;
}

function sortValue(design: Design, sortKey: DesignSortKey): string {
  if (sortKey === 'lastSessionAt') return design.lastSessionAt ?? '';
  return design[sortKey];
}

/** Newest first by the sort key, creation time as tie-break. Shared by the
 *  grouped and flat listings so both stay in lockstep. */
function compareBySortKey(a: Design, b: Design, sortKey: DesignSortKey): number {
  const byKey = sortValue(b, sortKey).localeCompare(sortValue(a, sortKey));
  return byKey !== 0 ? byKey : b.createdAt.localeCompare(a.createdAt);
}

/** Sort a flat design list (e.g. search results) by the same key the
 *  grouped views use. */
export function sortDesignsForList(designs: Design[], sortKey: DesignSortKey): Design[] {
  return [...designs].sort((a, b) => compareBySortKey(a, b, sortKey));
}

/** Front a workspace folder with a single card in aggregated views: the
 *  actively-generating member when present, else the top-sorted design,
 *  carrying the series name so the card reads as the folder. */
export function folderRepresentative(
  designs: Design[],
  title: string,
  isActive?: (design: Design) => boolean,
): Design | undefined {
  const rep = (isActive ? designs.find(isActive) : undefined) ?? designs[0];
  if (rep === undefined) return undefined;
  return rep.name === title ? rep : { ...rep, name: title };
}

export function groupDesignsByWorkspace(designs: Design[], sortKey: DesignSortKey): DesignGroup[] {
  const membersByKey = new Map<string, Design[]>();
  for (const design of designs) {
    const key = designGroupKey(design);
    const bucket = membersByKey.get(key);
    if (bucket === undefined) {
      membersByKey.set(key, [design]);
    } else {
      bucket.push(design);
    }
  }

  const groups = [...membersByKey.entries()].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => compareBySortKey(a, b, sortKey));
    const earliest = members.reduce((acc, cur) => (cur.createdAt < acc.createdAt ? cur : acc));
    return { key, title: earliest.name, designs: sorted };
  });

  // Newest activity first; an empty sort value (no session yet) sinks the group.
  return groups.sort((a, b) => {
    const aTop = a.designs[0];
    const bTop = b.designs[0];
    if (aTop === undefined || bTop === undefined) return 0;
    return compareBySortKey(aTop, bTop, sortKey);
  });
}
