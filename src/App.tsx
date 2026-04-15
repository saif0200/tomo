import "./App.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import type { PointerEvent } from "react";

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
  const handleDragStripPointerDown = async (_event: PointerEvent<HTMLDivElement>) => {
    await getCurrentWindow().startDragging();
  };
  const [placeholder] = useState(getNextPlaceholder);

  return (
    <main className="app-shell">
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
