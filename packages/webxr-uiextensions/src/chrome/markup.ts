/**
 * Window chrome conventions.
 *
 * Windows are authored in UIKitML like any other IWSDK panel — the chrome is
 * plain markup discovered by well-known element ids, not a parallel widget
 * tree. Copy `WINDOW_CHROME_SNIPPET` into a `.uikitml` file and put the
 * window body inside the `uix-content` element.
 */
export const WINDOW_CHROME_IDS = {
  /** Root container of the window. */
  window: 'uix-window',
  /** Drag surface; also focuses the window on press. */
  titlebar: 'uix-titlebar',
  /** Text element receiving `UIWindow.title`. */
  title: 'uix-title',
  /** Toggles body-follow ⇄ world-locked; label auto-syncs to PIN/UNPIN. */
  pin: 'uix-pin',
  /** Returns the window to its home (spawn region or original placement). */
  dock: 'uix-dock',
  /** Minimize/restore toggle. */
  minimize: 'uix-minimize',
  /** Closes (destroys) the window. */
  close: 'uix-close',
  /** Collapsed while minimized. */
  content: 'uix-content',
} as const;

/**
 * Reference chrome markup. The styles are intentionally minimal — restyle
 * freely, only the element ids are contractual.
 *
 * Notes:
 * - The placeholder "." in `uix-title`: UIKitML only creates a Text node for
 *   elements with a literal string child, so dynamic text needs one.
 * - The chrome buttons are `<div>`s on purpose: when an app registers a
 *   component kit (e.g. `@pmndrs/uikit-horizon`), lowercase `<button>` tags
 *   resolve to the kit's Button component, whose intrinsic sizing fights
 *   compact title-bar chrome. Plain containers stay fully styleable and
 *   still receive click events.
 */
export const WINDOW_CHROME_SNIPPET = `
<div id="uix-window" class="uix-window">
  <div id="uix-titlebar" class="uix-titlebar">
    <span id="uix-title" class="uix-title">.</span>
    <div class="uix-titlebar-buttons">
      <div id="uix-pin" class="uix-titlebar-button">PIN</div>
      <div id="uix-dock" class="uix-titlebar-button">DOCK</div>
      <div id="uix-minimize" class="uix-titlebar-button">MIN</div>
      <div id="uix-close" class="uix-titlebar-button">X</div>
    </div>
  </div>
  <div id="uix-content" class="uix-content">
    <!-- window body goes here -->
  </div>
</div>
`;
