/**
 * The window Ella shows while it starts.
 *
 * Startup is not instant — the data layout is checked, the IPC server binds a port, the
 * last project is reopened and its pack is regenerated — and until the main window is
 * ready to paint there is nothing on screen at all. A launcher that shows nothing for a
 * second after its icon is clicked reads as one that failed to launch, and gets clicked
 * again.
 *
 * The markup is a template string loaded as a `data:` URL rather than a file. It needs no
 * bundler entry, nothing to copy at packaging time, and cannot fail to resolve a path
 * inside an asar. Everything it draws is inline CSS and SVG: no fonts, no images, no
 * scripts, so it paints on the first frame.
 */

import { BrowserWindow } from 'electron';

/**
 * Shortest time the splash stays up.
 *
 * The cube takes about this long to assemble, and a splash that vanishes mid-animation is
 * worse than no splash. Startup usually outruns it anyway, so in practice this only
 * matters on a warm second launch.
 */
export const MIN_SPLASH_MS = 1500;

const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    height: 100%;
    background: transparent;
    overflow: hidden;
    /* The whole window is a drag handle: it has no frame to grab. */
    -webkit-app-region: drag;
    user-select: none;
  }

  .card {
    position: absolute;
    inset: 0;
    border-radius: 16px;
    border: 1px solid #2b2b38;
    background:
      radial-gradient(420px 200px at 50% 8%, rgba(139, 123, 255, 0.20), transparent 70%),
      linear-gradient(160deg, #16161d 0%, #101015 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    color: #eeeef3;
    animation: card-in 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }

  @keyframes card-in {
    from { opacity: 0; transform: scale(0.96); }
  }

  /* The glow sits behind the cube and breathes, so the window is never fully static even
     once the assembly finishes. */
  .glow {
    position: absolute;
    top: 46px;
    width: 150px;
    height: 150px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(139, 123, 255, 0.34), transparent 68%);
    filter: blur(6px);
    animation: breathe 3s ease-in-out infinite;
  }

  @keyframes breathe {
    0%, 100% { opacity: 0.55; transform: scale(1); }
    50%      { opacity: 1;    transform: scale(1.12); }
  }

  .cube {
    position: relative;
    animation: float 3s ease-in-out infinite;
    animation-delay: 900ms;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-6px); }
  }

  /*
   * The three faces arrive along their own axes — the top drops in, the sides slide out
   * from the centre — so the cube reads as being built rather than as a picture fading up.
   */
  .face {
    opacity: 0;
    animation: face-in 620ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  }
  .top   { animation-delay: 120ms; --dx: 0px;    --dy: -26px; }
  .left  { animation-delay: 320ms; --dx: -22px;  --dy: 12px; }
  .right { animation-delay: 470ms; --dx: 22px;   --dy: 12px; }

  @keyframes face-in {
    from { opacity: 0; transform: translate(var(--dx), var(--dy)); }
    to   { opacity: 1; transform: translate(0, 0); }
  }

  .wordmark {
    font-size: 25px;
    font-weight: 650;
    letter-spacing: 0.4px;
    opacity: 0;
    animation: rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 620ms forwards;
  }
  .wordmark span { color: #a99bff; }

  .tagline {
    margin-top: -12px;
    font-size: 12px;
    color: #6e6e84;
    opacity: 0;
    animation: rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 760ms forwards;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(7px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Indeterminate on purpose: startup has no measurable total, and a bar that pretends
     otherwise is a lie that always finishes at the wrong moment. */
  .track {
    width: 168px;
    height: 3px;
    border-radius: 999px;
    background: #23232f;
    overflow: hidden;
    opacity: 0;
    animation: rise 400ms ease 900ms forwards;
  }

  .track i {
    display: block;
    width: 40%;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #6a58e8, #a99bff);
    animation: sweep 1.25s cubic-bezier(0.55, 0.1, 0.45, 0.9) infinite;
  }

  @keyframes sweep {
    from { transform: translateX(-110%); }
    to   { transform: translateX(360%); }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
    .face, .wordmark, .tagline, .track { opacity: 1; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="glow"></div>

    <!-- Same isometric cube as the app icon, at 2:1, so the splash and the taskbar icon
         are recognisably one thing. -->
    <svg class="cube" width="120" height="134" viewBox="0 0 120 134" fill="none">
      <polygon class="face top"   points="60,4 114,35 60,66 6,35"    fill="#9d90ff" />
      <polygon class="face left"  points="6,35 60,66 60,130 6,99"    fill="#7c6cf5" />
      <polygon class="face right" points="114,35 60,66 60,130 114,99" fill="#4f43b4" />
    </svg>

    <div class="wordmark">Ell<span>a</span></div>
    <div class="tagline">__TAGLINE__</div>
    <div class="track"><i></i></div>
  </div>
</body>
</html>`;

/**
 * Opens the splash window.
 *
 * Transparent and frameless so the card can round its own corners, and `skipTaskbar` so
 * Ella never shows up twice in the taskbar during startup.
 */
export function createSplash(tagline: string): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // No preload and no Node: this window renders one static page and talks to nothing.
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = HTML.replace('__TAGLINE__', escapeHtml(tagline));
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splash.once('ready-to-show', () => splash.show());

  return splash;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return '&quot;';
    }
  });
