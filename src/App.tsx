import "./App.css";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

const WINDOW_ENTER_TRANSITION_MS = 220;
const WINDOW_EXIT_TRANSITION_MS = 132;
const COLLAPSED_HEIGHT = 118;
const EXPANDED_HEIGHT = 480;
const EXPAND_MS = 210;
const PANEL_TRANSITION_FRAMES = 2;
const SHOW_WINDOW_EVENT = "window-show-requested";
const HIDE_WINDOW_EVENT = "window-hide-requested";

const BASE_PLACEHOLDER_LINES = [
  "Ask anything.",
  "What are you working on?",
  "Start with the question.",
  "Another tab can wait.",
  "Ask the part you haven't phrased yet.",
  "Start simple.",
  "Keep it brief.",
  "The short version usually helps.",
  "Ask what's still unclear.",
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
type PanelMotionState = "idle" | "expanding" | "collapsing";
type Message = { id: string; role: "user" | "assistant"; content: string };

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

function ThinkingIndicator() {
  return (
    <div className="thinking-indicator" aria-label="Thinking">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </div>
  );
}

function App() {
  const [placeholder] = useState(getNextPlaceholder);
  const [windowState, setWindowState] = useState<WindowState>("entering");
  const [messages, setMessages] = useState<Message[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [panelMotion, setPanelMotion] = useState<PanelMotionState>("idle");
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const canSend = inputValue.trim().length > 0 && !isThinking;

  const isTransitioningRef = useRef(false);
  const enterTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const enterAnimationFrameRef = useRef<number | null>(null);
  const panelAnimationFrameRef = useRef<number | null>(null);
  const windowResizeFrameRef = useRef<number | null>(null);
  const expandedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thinkingTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const collapsedTextareaBaselineRef = useRef<number | null>(null);
  const windowHeightRef = useRef(COLLAPSED_HEIGHT);

  const handleDragStripPointerDown = async (_event: PointerEvent<HTMLDivElement>) => {
    await getCurrentWindow().startDragging();
  };

  const stopWindowResizeAnimation = () => {
    if (windowResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(windowResizeFrameRef.current);
      windowResizeFrameRef.current = null;
    }
  };

  const setWindowHeight = async (height: number) => {
    stopWindowResizeAnimation();

    if (windowHeightRef.current === height) {
      return;
    }

    windowHeightRef.current = height;
    await getCurrentWindow().setSize(new LogicalSize(620, height));
  };

  const animateWindowHeight = (targetHeight: number, duration = EXPAND_MS) => {
    stopWindowResizeAnimation();

    const startHeight = windowHeightRef.current;
    if (startHeight === targetHeight) {
      return;
    }

    const windowHandle = getCurrentWindow();
    const startAt = performance.now();

    const step = (now: number) => {
      const elapsed = now - startAt;
      const progress = Math.min(1, elapsed / duration);
      const nextHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);

      if (windowHeightRef.current !== nextHeight) {
        windowHeightRef.current = nextHeight;
        void windowHandle.setSize(new LogicalSize(620, nextHeight));
      }

      if (progress < 1) {
        windowResizeFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      windowResizeFrameRef.current = null;
      if (windowHeightRef.current !== targetHeight) {
        windowHeightRef.current = targetHeight;
        void windowHandle.setSize(new LogicalSize(620, targetHeight));
      }
    };

    windowResizeFrameRef.current = window.requestAnimationFrame(step);
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
    if (!expandedRef.current) {
      void setWindowHeight(COLLAPSED_HEIGHT);
    }
  };

  const collapseTextareaToBaseline = () => {
    const textarea = textareaRef.current;
    const baseline = collapsedTextareaBaselineRef.current;

    if (!textarea || baseline === null) {
      return;
    }

    textarea.style.height = `${baseline}px`;
    textarea.style.overflowY = "hidden";
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (expandedRef.current) {
      e.target.style.height = "auto";
      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    } else {
      e.target.style.height = "auto";
      const natural = e.target.scrollHeight;
      const COLLAPSED_TEXTAREA_CAP = 64;
      const capped = Math.min(natural, COLLAPSED_TEXTAREA_CAP);
      const baseline = collapsedTextareaBaselineRef.current ?? capped;

      collapsedTextareaBaselineRef.current = baseline;
      e.target.style.height = `${capped}px`;
      e.target.style.overflowY = natural > COLLAPSED_TEXTAREA_CAP ? "auto" : "hidden";
      void setWindowHeight(COLLAPSED_HEIGHT + Math.max(0, capped - baseline));
    }
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isThinking) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setInputValue("");
    resetTextareaHeight();

    if (!expandedRef.current) {
      expandedRef.current = true;
      animateWindowHeight(EXPANDED_HEIGHT, EXPAND_MS);
      setExpanded(true);
      setPanelMotion("expanding");
      if (panelAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(panelAnimationFrameRef.current);
        panelAnimationFrameRef.current = null;
      }

      let framesRemaining = PANEL_TRANSITION_FRAMES;
      const advancePanelMotion = () => {
        if (framesRemaining > 0) {
          framesRemaining -= 1;
          panelAnimationFrameRef.current = window.requestAnimationFrame(advancePanelMotion);
          return;
        }

        panelAnimationFrameRef.current = null;
        setPanelMotion("idle");
      };

      panelAnimationFrameRef.current = window.requestAnimationFrame(advancePanelMotion);
    }

    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    thinkingTimerRef.current = window.setTimeout(() => {
      thinkingTimerRef.current = null;
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I'm Tomo, your local AI assistant. Full model integration coming soon.",
        },
      ]);
    }, 1200);
  };

  const handleTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const collapsePanel = () => {
    if (thinkingTimerRef.current !== null) {
      window.clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (panelAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(panelAnimationFrameRef.current);
      panelAnimationFrameRef.current = null;
    }
    setPanelMotion("collapsing");
    collapseTextareaToBaseline();
    animateWindowHeight(COLLAPSED_HEIGHT, EXPAND_MS);
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      expandedRef.current = false;
      setExpanded(false);
      setPanelMotion("idle");
      setIsThinking(false);
    }, EXPAND_MS);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";

    const baseline = textarea.scrollHeight;

    collapsedTextareaBaselineRef.current = baseline;
    textarea.style.height = `${baseline}px`;
  }, []);

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

      if (panelAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(panelAnimationFrameRef.current);
        panelAnimationFrameRef.current = null;
      }

      stopWindowResizeAnimation();
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
          }, WINDOW_ENTER_TRANSITION_MS);
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
        void (async () => {
          await invoke("complete_hide_main_window");
        })();
      }, WINDOW_EXIT_TRANSITION_MS);
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

      if (expandedRef.current) {
        collapsePanel();
        return;
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={`app-shell app-shell--${windowState}`}>
      <section
        className={`chat-bar${expanded ? " chat-bar--expanded" : ""}${panelMotion !== "idle" ? ` chat-bar--${panelMotion}` : ""}`}
        data-tauri-drag-region
      >
        <div
          className="drag-strip"
          data-tauri-drag-region
          aria-hidden="true"
          onPointerDown={handleDragStripPointerDown}
        />

        {(expanded || panelMotion === "collapsing") && (
          <div className="messages-panel" role="log" aria-live="polite">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message--${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {isThinking && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}

        <div className="top-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={placeholder}
            aria-label="Chat input"
            rows={1}
            value={inputValue}
            onChange={handleTextareaInput}
            onKeyDown={handleTextareaKeyDown}
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
          <button
            className={`send-btn${canSend ? " send-btn--active" : ""}`}
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onClick={() => void handleSend()}
          >
            <ArrowUpIcon />
          </button>
          <div className="controls-drag-space" data-tauri-drag-region aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}

export default App;
