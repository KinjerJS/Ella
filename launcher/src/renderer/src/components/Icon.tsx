/**
 * Inline SVG icons.
 *
 * Inline rather than an icon font or image files: they inherit `currentColor`, so a
 * disabled or accented button carries its icon along without a second set of assets, and
 * nothing is fetched at runtime.
 *
 * The set is deliberately small. An icon earns its place when it helps you find a control
 * you already know is there — the navigation, the destructive actions, the one primary
 * button per panel. Decorating every button would flatten exactly that distinction.
 */

export type IconName =
  | 'home'
  | 'versions'
  | 'project'
  | 'editor'
  | 'logs'
  | 'export'
  | 'settings'
  | 'play'
  | 'stop'
  | 'plus'
  | 'trash'
  | 'image'
  | 'sparkle'
  | 'external'
  | 'folder'
  | 'refresh'
  | 'block'
  | 'item'
  | 'check'
  | 'arrow'
  | 'info'
  | 'alert'
  | 'close'
  | 'brush'
  | 'download'
  | 'bolt';

/** 24×24 viewBox, stroked, so every glyph scales and tints the same way. */
const PATHS: Record<IconName, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M9.5 21v-6h5v6',
  // A cube, drawn as a hexagon outline plus the three edges meeting at the front corner.
  versions: 'M12 2 21 7v10l-9 5-9-5V7z M12 12 21 7 M12 12v10 M12 12 3 7',
  block: 'M12 2 21 7v10l-9 5-9-5V7z M12 12 21 7 M12 12v10 M12 12 3 7',
  project: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  // Sliders: three tracks, each with a handle drawn as a bar across it. Dots would be
  // shorter to write but a zero-length segment renders as nothing at small sizes.
  editor: 'M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4',
  logs: 'M4 5h16v14H4z M7 9l3 3-3 3 M13 15h4',
  export: 'M12 3v12 M8 11l4 4 4-4 M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  play: 'M7 4.5v15l13-7.5z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13 M10 11v6 M14 11v6',
  image: 'M3 5h18v14H3z M3 15l5-4 4 3 3-2 6 5',
  // Particles: a large spark and two small ones.
  sparkle: 'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z M18 16l.7 1.8L20.5 18.5l-1.8.7L18 21l-.7-1.8L15.5 18.5l1.8-.7z M6 3l.5 1.3L7.8 4.8l-1.3.5L6 6.6l-.5-1.3L4.2 4.8l1.3-.5z',
  external: 'M14 4h6v6 M20 4l-8 8 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v4h-4',
  item: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
  check: 'M5 12.5 10 17.5 19 7',
  arrow: 'M5 12h13 M12.5 6l6 6-6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8v0',
  alert: 'M12 3.5 22 20H2z M12 10v4 M12 17v0',
  close: 'M6 6l12 12 M18 6 6 18',
  // A brush, standing for Blockbench — the tool Ella hands the model over to.
  brush: 'M15.5 3.5 20.5 8.5 11 18l-5-5z M6 13l-2.5 6.5L10 17 M14 5l5 5',
  download: 'M12 3v12 M7.5 10.5 12 15l4.5-4.5 M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
};

/** Glyphs whose shape reads better filled than stroked. */
const FILLED: ReadonlySet<IconName> = new Set(['play', 'stop', 'bolt']);

interface Props {
  name: IconName;
  size?: number;
  /** Extra spacing when the icon sits before a label. */
  className?: string;
}

export function Icon({ name, size = 16, className }: Props) {
  const filled = FILLED.has(name);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the adjacent label already names the control, so announcing the icon
      // too would just repeat it.
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
