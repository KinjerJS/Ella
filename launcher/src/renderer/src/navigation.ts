/**
 * The view list, shared by App and by anything that needs to send the user somewhere.
 *
 * Kept out of App.tsx so the home view can navigate without importing its own parent.
 */

import type { IconName } from './components/Icon.tsx';

export type View = 'home' | 'versions' | 'project' | 'editor' | 'logs' | 'export' | 'settings';

export interface NavItem {
  id: View;
  labelKey: string;
  icon: IconName;
  /** Nothing on this view works without a project open. */
  needsProject?: boolean;
}

/*
 * Ordered as the work is done, not alphabetically or by importance: home, then the setup
 * (a version, a project), then the loop (editing, watching the log), then what comes at
 * the end (export) and what you rarely touch (settings).
 */
export const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: 'home' },
  { id: 'versions', labelKey: 'nav.versions', icon: 'versions' },
  { id: 'project', labelKey: 'nav.project', icon: 'project' },
  { id: 'editor', labelKey: 'nav.editor', icon: 'editor', needsProject: true },
  { id: 'logs', labelKey: 'nav.logs', icon: 'logs' },
  { id: 'export', labelKey: 'nav.export', icon: 'export', needsProject: true },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings' },
];
