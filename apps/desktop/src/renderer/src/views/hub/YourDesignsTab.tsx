import { useT } from '@open-codesign/i18n';
import { useMemo } from 'react';
import { SegmentedControl } from '../../components/settings/primitives';
import { type DesignSortKey, groupDesignsByWorkspace } from '../../lib/design-groups';
import { useCodesignStore } from '../../store';
import { DesignGrid } from './DesignGrid';

export function YourDesignsTab() {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const sortKey = useCodesignStore((s) => s.designsSortKey);
  const setDesignsSortKey = useCodesignStore((s) => s.setDesignsSortKey);

  const active = useMemo(() => designs.filter((d) => d.deletedAt === null), [designs]);
  const groups = useMemo(() => groupDesignsByWorkspace(active, sortKey), [active, sortKey]);

  if (active.length === 0) {
    return <DesignGrid designs={[]} emptyLabel={t('hub.your.empty')} />;
  }

  const sortOptions = [
    { value: 'createdAt' as DesignSortKey, label: t('hub.your.sortCreated') },
    { value: 'updatedAt' as DesignSortKey, label: t('hub.your.sortUpdated') },
    { value: 'lastSessionAt' as DesignSortKey, label: t('hub.your.sortSession') },
  ];

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex justify-end">
        <SegmentedControl options={sortOptions} value={sortKey} onChange={setDesignsSortKey} />
      </div>
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-[var(--space-3)]">
          <div className="flex items-baseline gap-[var(--space-2)] px-[2px]">
            <h3 className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
              {group.title}
            </h3>
            <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
              {t('hub.your.groupCount', { count: group.designs.length })}
            </span>
          </div>
          <DesignGrid designs={group.designs} emptyLabel={t('hub.your.empty')} />
        </section>
      ))}
    </div>
  );
}
