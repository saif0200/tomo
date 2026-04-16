import "./App.css";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

const WINDOW_TRANSITION_MS = 186;
const SHOW_WINDOW_EVENT = "window-show-requested";
const HIDE_WINDOW_EVENT = "window-hide-requested";

const BASE_PLACEHOLDER_LINES = [
  "Ask anything.",
  "What are you working on?",
  "Start with the question.",
  "Another tab can wait.",
  "Ask the part you haven’t phrased yet.",
  "Start simple.",
  "Keep it brief.",
  "The short version usually helps.",
  "Ask what’s still unclear.",
  "Or just type a fragment.",
];

const TIME_PLACEHOLDER_LINES = {
  morning: [
    "Morning. Start with the useful part.",
    "Coffee first. Then the question.",
    "A quiet start is usually enough.",
  ],
  afternoon: [
    "Still going. Ask the next thing.",
    "Afternoon. Keep it moving.",
    "Use the shorter version.",
  ],
  evening: [
    "Evening. Trim the question down.",
    "You made it this far. Ask the rest.",
    "Late enough to keep it simple.",
  ],
  night: [
    "Night owl hours. Keep it brief.",
    "Late enough to keep it simple.",
    "For the after-hours question.",
  ],
} as const;

const PLACEHOLDER_STORAGE_PREFIX = "tomo.placeholder.sequence";

type TimeBucket = keyof typeof TIME_PLACEHOLDER_LINES;
type WindowState = "entering" | "idle" | "exiting";

function shuffleLines(lines: string[]) {
  const next = [...lines];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function getTimeBucket(date = new Date()): TimeBucket {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";

  return "night";
}

function getNextPlaceholder() {
  try {
    const bucket = getTimeBucket();
    const pool = [...BASE_PLACEHOLDER_LINES, ...TIME_PLACEHOLDER_LINES[bucket]];
    const storageKey = `${PLACEHOLDER_STORAGE_PREFIX}.${bucket}`;
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as { order: string[]; index: number }) : null;
    const validOrder =
      parsed?.order && parsed.order.length === pool.length ? parsed.order : shuffleLines(pool);
    const currentIndex = parsed?.index ?? 0;
    const nextIndex = currentIndex % validOrder.length;
    const placeholder = validOrder[nextIndex];

    localStorage.setItem(storageKey, JSON.stringify({ order: validOrder, index: nextIndex + 1 }));

    return placeholder;
  } catch {
    const bucket = getTimeBucket();
    return [...BASE_PLACEHOLDER_LINES, ...TIME_PLACEHOLDER_LINES[bucket]][0];
  }
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 6.5 8 11l4.5-4.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="plus-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 5v10" />
      <path d="M5 10h10" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg className="dots-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="16" cy="10" r="1.2" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className="mic-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12 6a2 2 0 1 0-4 0v4a2 2 0 1 0 4 0V6Z" />
      <path d="M5 10a5 5 0 0 0 10 0M10 15v3M8 18h4" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg className="send-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.75v9.5" />
      <path d="M6.5 8.25 10 4.75l3.5 3.5" />
    </svg>
  );
}

function App() {
  const [placeholder] = useState(getNextPlaceholder);
  const [windowState, setWindowState] = useState<WindowState>("entering");
  const isTransitioningRef = useRef(false);
  const enterTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const enterAnimationFrameRef = useRef<number | null>(null);

  const handleDragStripPointerDown = async (_event: PointerEvent<HTMLDivElement>) => {
    await getCurrentWindow().startDragging();
  };

  useEffect(() => {
    const clearTransitionTimers = () => {
      if (enterTimerRef.current !== null) {
        window.clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }

      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }

      if (enterAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(enterAnimationFrameRef.current);
        enterAnimationFrameRef.current = null;
      }
    };

    const startEnter = (notifyBackend: boolean) => {
      clearTransitionTimers();
      isTransitioningRef.current = true;
      setWindowState("entering");

      enterAnimationFrameRef.current = window.requestAnimationFrame(() => {
        enterAnimationFrameRef.current = window.requestAnimationFrame(() => {
          setWindowState("idle");

          enterTimerRef.current = window.setTimeout(() => {
            isTransitioningRef.current = false;
            enterTimerRef.current = null;

            if (notifyBackend) {
              void invoke("finish_window_transition");
            }
          }, WINDOW_TRANSITION_MS);
        });
      });
    };

    const startExit = async (skipBegin: boolean) => {
      if (isTransitioningRef.current) {
        return;
      }

      if (!skipBegin) {
        const didBegin = await invoke<boolean>("begin_hide_main_window");

        if (!didBegin) {
          return;
        }
      }

      clearTransitionTimers();
      isTransitioningRef.current = true;
      setWindowState("exiting");

      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        void invoke("complete_hide_main_window");
      }, WINDOW_TRANSITION_MS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const isTyping =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.isContentEditable;

      if (isTyping) {
        activeElement?.blur();
      }

      event.preventDefault();
      void startExit(false);
    };

    let isMounted = true;
    let unlistenShow: (() => void) | null = null;
    let unlistenHide: (() => void) | null = null;

    const registerListeners = async () => {
      const [showUnlisten, hideUnlisten] = await Promise.all([
        listen(SHOW_WINDOW_EVENT, () => {
          startEnter(true);
        }),
        listen(HIDE_WINDOW_EVENT, () => {
          void startExit(true);
        }),
      ]);

      if (!isMounted) {
        showUnlisten();
        hideUnlisten();
        return;
      }

      unlistenShow = showUnlisten;
      unlistenHide = hideUnlisten;
    };

    startEnter(false);
    document.addEventListener("keydown", handleKeyDown, true);
    void registerListeners();

    return () => {
      isMounted = false;
      clearTransitionTimers();
      document.removeEventListener("keydown", handleKeyDown, true);
      unlistenShow?.();
      unlistenHide?.();
    };
  }, []);

  return (
    <main className={`app-shell app-shell--${windowState}`}>
      <section className="chat-bar" data-tauri-drag-region>
        <div
          className="drag-strip"
          data-tauri-drag-region
          aria-hidden="true"
          onPointerDown={handleDragStripPointerDown}
        />
        <div className="top-row">
          <input
            className="chat-input"
            type="text"
            placeholder={placeholder}
            aria-label="Chat input"
          />
        </div>
        <div className="chat-controls">
          <button className="control-btn" type="button" aria-label="Attach">
            <PlusIcon />
          </button>
          <button className="label-btn" type="button" aria-label="Model">
            <span>Tomo Local</span>
            <ChevronDown />
          </button>
          <button className="label-btn" type="button" aria-label="Reasoning">
            <span>Medium</span>
            <ChevronDown />
          </button>
          <button className="control-btn" type="button" aria-label="More">
            <DotsIcon />
          </button>
          <button className="control-btn" type="button" aria-label="Voice">
            <MicIcon />
          </button>
          <button className="send-btn" type="button" aria-label="Send">
            <ArrowUpIcon />
          </button>
          <div className="controls-drag-space" data-tauri-drag-region aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}

export default App;
