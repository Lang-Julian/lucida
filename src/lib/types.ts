/**
 * Shared contracts for Lucida — an AI-enhanced "smart whiteboard".
 *
 * Every feature module (recognizer, AI engine, canvas component, UI shell,
 * Rust sidecar bridge) is written against the types in this file. Keep it the
 * single source of truth: change a contract here, not in the consumers.
 */
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

/** A plain [x, y] point in scene (canvas) coordinates. */
export type Point = [number, number];

/* ───────────────────────────  Shape beautify (recognizer)  ─────────────────────────── */

export type PrimitiveType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "line"
  | "arrow";

export interface RecognizedShape {
  type: PrimitiveType;
  /** 0..1 — the caller only beautifies above its threshold. */
  confidence: number;
  /** Axis-aligned bounding box, ABSOLUTE scene coords. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * For "line" | "arrow" | "triangle": ordered vertices in ABSOLUTE scene
   * coords (the cleaned polyline; triangle is closed implicitly). Omitted for
   * rectangle/ellipse/diamond, which are fully described by the bounding box.
   */
  points?: Point[];
}

export interface RecognizerOptions {
  /** Minimum confidence to return a shape at all (default 0.55). */
  minConfidence?: number;
  /** Closed-path gap tolerance as a fraction of the bbox diagonal (default 0.2). */
  closeTolerance?: number;
}

/* ───────────────────────────  AI suggestions  ─────────────────────────── */

export interface NodeInfo {
  id: string;
  /** excalidraw element type, e.g. "rectangle" | "ellipse" | "text" … */
  type: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeInfo {
  /** source node id */
  from: string;
  /** target node id */
  to: string;
  /** the arrow's bound label, if any (e.g. "approves", "yes") */
  label?: string;
}

export interface SceneSummary {
  nodes: NodeInfo[];
  edges: EdgeInfo[];
  /** optional free-text intent typed by the user ("a CI/CD pipeline"). */
  intent?: string;
}

export type SuggestionKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow";

export interface Suggestion {
  kind: SuggestionKind;
  text?: string;
  /** absolute scene coords; optional — the builder auto-places when omitted. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /**
   * For arrows: ids of the endpoints. Either an existing NodeInfo.id, or
   * "new:<index>" referencing another suggestion in the same batch.
   */
  from?: string;
  to?: string;
  /** short human-readable reason; may be surfaced on hover, never required. */
  rationale?: string;
}

export interface AiConfig {
  /** e.g. "http://127.0.0.1:8765" */
  baseUrl: string;
  /** mlx model id, e.g. "mlx-community/Qwen2.5-3B-Instruct-4bit" */
  model: string;
}

/* ───────────────────────────  Tauri AI sidecar bridge  ─────────────────────────── */

export interface AiStatus {
  /** sidecar process spawned & alive */
  running: boolean;
  /** server answering on /v1/models (model loaded) — filled in by the client probe */
  ready: boolean;
  port: number;
  model: string;
}

/* ───────────────────────────  Canvas imperative handle  ─────────────────────────── */

export interface SuggestResult {
  count: number;
  error?: string;
}

/** Imperative handle the App uses to drive the canvas. */
export interface WhiteboardHandle {
  /** Run AI suggestion; renders ghost elements. Returns how many were added. */
  suggest: (intent?: string) => Promise<SuggestResult>;
  /** Solidify the pending ghost suggestions into real elements. */
  acceptSuggestions: () => void;
  /** Remove the pending ghost suggestions. */
  dismissSuggestions: () => void;
  /** Whether ghost suggestions are currently pending. */
  hasPendingSuggestions: () => boolean;
}

export type { ExcalidrawElementSkeleton };
