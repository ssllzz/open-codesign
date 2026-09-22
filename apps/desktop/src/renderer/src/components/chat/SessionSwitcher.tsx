import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { Check, ChevronDown, MessagesSquare, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '../../lib/relativeTime';
import { workspacePathComparisonKey } from '../../lib/workspace-path';
import { useCodesignStore } from '../../store';

/** Sessions sharing the current design's workspace folder, newest first.
 *  A workspace-less design only ever fronts itself. */
export function sessionsInWorkspace(designs: Design[], currentId: string | null): Design[] {
  const current = designs.find((d) => d.id === currentId && d.deletedAt === null);
  if (!current) return [];
  if (current.workspacePath === null) return [current];
  const key = workspacePathComparisonKey(current.workspacePath);
  return designs
    .filter(
      (d) =>
        d.deletedAt === null &&
        d.workspacePath !== null &&
        workspacePathComparisonKey(d.workspacePath) === key,
    )
    .sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
}

export function SessionSwitcher() {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sessions = sessionsInWorkspace(designs, currentDesignId);
  const current = sessions.find((d) => d.id === currentDesignId) ?? null;

  // The shell must always render: the sidebar's bottom grid reserves the
  // first track for this switcher, and a null return would shift the model
  // picker into the wrong track on single-session designs.
  return (
    <div ref={wrapperRef} className="relative shrink-0">
      {sessions.length < 2 || current === null ? null : (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('sidebar.sessionSwitcher.menuLabel')}
            title={current.name}
            className="inline-flex min-h-[var(--space-6)] min-w-0 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[2px] text-[var(--text-sm)] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] cursor-pointer"
          >
            <MessagesSquare className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="max-w-[140px] truncate">{current.name}</span>
            <ChevronDown className="w-3 h-3 shrink-0" aria-hidden />
          </button>

          {open ? (
            <div
              role="menu"
              aria-label={t('sidebar.sessionSwitcher.menuLabel')}
              className="absolute bottom-full left-0 mb-[var(--space-2)] z-20 w-[280px] max-w-[calc(100vw-32px)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] p-[var(--space-1)]"
            >
              <div className="px-[var(--space-2)] pt-[var(--space-1)] pb-[var(--space-2)] text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium">
                {t('sidebar.sessionSwitcher.heading')}
              </div>
              <ul className="max-h-[280px] overflow-y-auto">
                {sessions.map((d) => (
                  <li key={d.id} className="group/item flex items-center gap-[var(--space-1)]">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        if (d.id !== currentDesignId) void switchDesign(d.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1_5)] text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <Check
                        className={`w-3.5 h-3.5 shrink-0 ${
                          d.id === currentDesignId
                            ? 'text-[var(--color-accent)]'
                            : 'text-transparent'
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--text-sm)] text-[var(--color-text-primary)]">
                          {d.name}
                        </span>
                        <span className="block truncate text-[var(--text-xs)] text-[var(--color-text-muted)]">
                          {relativeTime(d.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        requestRenameDesign(d);
                      }}
                      aria-label={`${t('projects.view.rename')} — ${d.name}`}
                      className="mr-[var(--space-1)] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] group-hover/item:opacity-100 focus-visible:opacity-100"
                    >
                      <Pencil className="w-3 h-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
