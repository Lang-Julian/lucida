/**
 * Whiteboard — the full-window Excalidraw canvas.
 *
 * Two AI-enhanced behaviors live here:
 *   1. Beautify: a freehand stroke released with autoBeautify on is passed to
 *      the recognizer and, above threshold, replaced by a clean primitive.
 *   2. Ghost suggestions: the App asks for suggest()/accept()/dismiss() via the
 *      imperative handle; pending suggestions render as dashed, low-opacity
 *      "ghost" elements until accepted or dismissed.
 *
 * Ownership: this file only drives the canvas. Recognition lives in
 * ../lib/recognizer, the AI round-trip in ../lib/ai; we talk to both purely
 * through the shared contracts in ../lib/types.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawFreeDrawElement,
  Ordered,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { recognizeStroke } from "../lib/recognizer";
import { summarizeScene, suggestNext, suggestionsToSkeletons } from "../lib/ai";
import { GHOST_OPACITY } from "../lib/config";
import type { AiConfig, WhiteboardHandle, SuggestResult, Point } from "../lib/types";

export interface WhiteboardProps {
  aiConfig: AiConfig;
  autoBeautify: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/** Style carried over from the source freehand stroke onto the clean shape. */
interface StrokeStyle {
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  roughness: number;
}

/**
 * Build a "line" skeleton with local points. Confines the single necessary
 * cast to one place: skeleton points are typed as branded LocalPoint, but the
 * public convert API accepts plain [number, number] tuples at runtime.
 */
function lineSkeleton(
  x: number,
  y: number,
  points: Point[],
  style: StrokeStyle,
): ExcalidrawElementSkeleton {
  return { type: "line", x, y, points, ...style } as ExcalidrawElementSkeleton;
}

const Whiteboard = forwardRef<WhiteboardHandle, WhiteboardProps>(
  ({ aiConfig, autoBeautify, onBusyChange }, ref) => {
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

    // Mirror autoBeautify into a ref so the stable onPointerUp closure reads the
    // latest value rather than the one captured at first render.
    const autoBeautifyRef = useRef(autoBeautify);
    useEffect(() => {
      autoBeautifyRef.current = autoBeautify;
    }, [autoBeautify]);

    // In-flight guard so a second suggest() can't race the first. Pending ghost
    // suggestions are marked on the elements themselves (customData.lucidaGhost)
    // rather than a separate id set, so undo/redo can never desync the two.
    const inFlight = useRef(false);

    // Mirror aiConfig into a ref so suggest() always uses the latest base URL /
    // model — these resolve from ai_status after the sidecar reports its port.
    const aiConfigRef = useRef(aiConfig);
    useEffect(() => {
      aiConfigRef.current = aiConfig;
    }, [aiConfig]);

    /** Replace a just-drawn freehand stroke with a recognized clean primitive. */
    const handlePointerUp = (
      activeTool: { type: string },
      _pointerDownState: unknown,
    ) => {
      if (activeTool.type !== "freedraw" || !autoBeautifyRef.current) return;
      const api = apiRef.current;
      if (!api) return;

      const freedraws = api
        .getSceneElements()
        .filter(
          (e): e is Ordered<ExcalidrawFreeDrawElement> => e.type === "freedraw",
        );
      if (freedraws.length === 0) return;

      // Freshest stroke wins — that's the one the user just finished.
      let el = freedraws[0];
      for (const f of freedraws) if (f.updated > el.updated) el = f;

      const absPts: Point[] = el.points.map(
        (p): Point => [el.x + p[0], el.y + p[1]],
      );
      const shape = recognizeStroke(absPts, { minConfidence: 0.55 });
      if (!shape) return;

      const style = {
        strokeColor: el.strokeColor,
        strokeWidth: el.strokeWidth,
        backgroundColor: el.backgroundColor,
        roughness: el.roughness,
      };

      let skeleton: ExcalidrawElementSkeleton;
      switch (shape.type) {
        case "rectangle":
        case "ellipse":
        case "diamond":
          skeleton = {
            type: shape.type,
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
            ...style,
          };
          break;
        case "line": {
          const pts = shape.points;
          if (!pts || pts.length < 2) return;
          const [p0, p1] = pts;
          const localPoints: Point[] = [
            [0, 0],
            [p1[0] - p0[0], p1[1] - p0[1]],
          ];
          skeleton = lineSkeleton(p0[0], p0[1], localPoints, style);
          break;
        }
        case "triangle": {
          const pts = shape.points;
          if (!pts || pts.length < 3) return;
          const [v0, v1, v2] = pts;
          const localPoints: Point[] = [
            [0, 0],
            [v1[0] - v0[0], v1[1] - v0[1]],
            [v2[0] - v0[0], v2[1] - v0[1]],
            [0, 0],
          ];
          skeleton = lineSkeleton(v0[0], v0[1], localPoints, style);
          break;
        }
        default:
          // "arrow" is not produced from a single beautify stroke.
          return;
      }

      const created = convertToExcalidrawElements([skeleton], {
        regenerateIds: true,
      });
      const next = api
        .getSceneElements()
        .filter((e) => e.id !== el.id)
        .concat(created);
      api.updateScene({
        elements: next as any,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    };

    useImperativeHandle(
      ref,
      (): WhiteboardHandle => ({
        async suggest(intent?: string): Promise<SuggestResult> {
          const api = apiRef.current;
          if (!api) return { count: 0, error: "canvas not ready" };
          if (inFlight.current) return { count: 0 };

          inFlight.current = true;
          onBusyChange?.(true);
          try {
            // Summarize only the real scene — exclude any still-pending ghosts.
            const real = api
              .getSceneElements()
              .filter((e) => !e.customData?.lucidaGhost);
            const summary = summarizeScene(real, intent);
            const suggestions = await suggestNext(summary, aiConfigRef.current);
            const skeletons = suggestionsToSkeletons(suggestions, summary);
            const created = convertToExcalidrawElements(skeletons, {
              regenerateIds: true,
            });
            const ghosts = created.map((e) => ({
              ...e,
              opacity: GHOST_OPACITY,
              strokeStyle: "dashed",
              customData: { ...(e.customData ?? {}), lucidaGhost: true },
            }));
            api.updateScene({
              elements: [...api.getSceneElements(), ...ghosts] as any,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            try {
              api.scrollToContent(ghosts as any, {
                fitToContent: true,
                animate: true,
              });
            } catch {
              // scrollToContent is best-effort cosmetic; ignore failures.
            }
            return { count: ghosts.length };
          } catch (err) {
            if (import.meta.env.DEV) console.warn("suggest failed:", err);
            return { count: 0, error: String(err) };
          } finally {
            inFlight.current = false;
            onBusyChange?.(false);
          }
        },

        acceptSuggestions(): void {
          const api = apiRef.current;
          if (!api) return;
          const next = api.getSceneElements().map((e) =>
            e.customData?.lucidaGhost
              ? {
                  ...e,
                  opacity: 100,
                  strokeStyle: "solid",
                  customData: { ...e.customData, lucidaGhost: false },
                }
              : e,
          );
          api.updateScene({
            elements: next as any,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        },

        dismissSuggestions(): void {
          const api = apiRef.current;
          if (!api) return;
          const next = api
            .getSceneElements()
            .filter((e) => !e.customData?.lucidaGhost);
          api.updateScene({
            elements: next as any,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        },

        hasPendingSuggestions(): boolean {
          const api = apiRef.current;
          return api
            ? api.getSceneElements().some((e) => e.customData?.lucidaGhost)
            : false;
        },
      }),
      [aiConfig, onBusyChange],
    );

    return (
      <div style={{ width: "100%", height: "100%" }}>
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          onPointerUp={handlePointerUp}
        />
      </div>
    );
  },
);

Whiteboard.displayName = "Whiteboard";

export default Whiteboard;
