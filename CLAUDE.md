# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend only (hot reload, no native shell)
npm run dev

# Full desktop app with hot reload
npm run tauri dev

# Type-check + production build (frontend only)
npm run build

# Production Tauri build (produces installable binary)
npm run tauri build
```

There are no tests or linters configured.

## Architecture

Tomo is a frameless, always-on-top desktop overlay built with **Tauri v2** (Rust backend) + **React/TypeScript** frontend. The window is transparent, 620×118px by default, and expands to 480px when the chat panel opens.

### Invocation flow

The global hotkey (double-tap Shift on macOS via `CGEventTap`, double-tap Shift on Windows/Linux via `rdev`) is handled entirely in Rust (`src-tauri/src/lib.rs`). When triggered, Rust emits Tauri events (`window-show-requested` / `window-hide-requested`) that the frontend listens for via `@tauri-apps/api/event`.

### Window show/hide state machine

`App.tsx` owns a `windowState: "entering" | "idle" | "exiting"` state that drives CSS opacity/transform transitions. The sequence:
1. Rust calls `window.show()` then emits `window-show-requested`
2. Frontend sets state `entering` (opacity 0) → double RAF → `idle` (opacity 1, 186ms transition)
3. On hide: frontend sets `exiting` → after 186ms calls `complete_hide_main_window` Tauri command → Rust hides window

The transition lock (`WINDOW_TRANSITION_LOCK` mutex in Rust, `isTransitioningRef` in React) prevents overlapping show/hide calls.

### Chat panel expansion

When a message is sent, the panel expands from 118px to 480px:
1. `chatBarRef` (direct DOM ref on `<section.chat-bar>`) is set to `height: EXPANDED_CHAT_H` with `transition: none`, plus a `clip-path` that visually pins it to the collapsed size
2. `setSize(620, 480)` is fired via Tauri IPC (not awaited — window is transparent so the resize is invisible)
3. Double RAF removes `transition: none` and sets `clip-path` to `inset(0)` → GPU-composited clip-path animation plays
4. Collapse reverses: clip-path animates back, then after `EXPAND_MS` (300ms) the window shrinks and state resets

Clip-path is used instead of height animation because it's GPU-composited and never triggers layout recalculation.

### Key constants (App.tsx)

| Constant | Value | Purpose |
|---|---|---|
| `WINDOW_TRANSITION_MS` | 186ms | Show/hide opacity animation |
| `COLLAPSED_HEIGHT` | 118px | Default window height |
| `EXPANDED_HEIGHT` | 480px | Chat panel window height |
| `EXPAND_MS` | 300ms | Clip-path animation duration |

### Tauri capabilities

Window resize requires `core:window:allow-set-size` in `src-tauri/capabilities/default.json`. The window is `resizable: true` in `tauri.conf.json` to allow programmatic resize (users cannot drag-resize since there are no resize handles).

### macOS specifics

- Uses `CGEventTap` for global key listening (requires Accessibility permission)
- Window level set to `NSFloatingWindowLevel` via `objc2_app_kit` to stay above all windows
- `macOSPrivateApi: true` in `tauri.conf.json` enables the vibrancy/transparency APIs
- Double-tap hotkey is **Shift** (left or right, must be different sides), with 250ms window and 220ms max hold time
