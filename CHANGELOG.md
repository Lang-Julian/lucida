# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-15

Initial public release.

### Added

- **Beautify** — freehand strokes snap to clean shapes (rectangle, ellipse,
  diamond, triangle, line) on pen-up, via a pure-geometry recognizer. Works
  fully offline.
- **Suggest next** — a local MLX LLM (`Qwen2.5-3B-Instruct-4bit` by default)
  proposes the next 1–3 diagram elements, rendered as editable "ghost" elements
  you accept or dismiss.
- Tauri v2 shell that manages the `mlx_lm.server` sidecar (spawn / adopt an
  existing server / stop) and exposes `ai_start` / `ai_stop` / `ai_status`.
- Glassmorphic UI with light & dark themes, a status pill, a welcome hint, an
  error toast, and keyboard shortcuts (⌘↵ suggest/accept, Esc dismiss, ⌘B beautify).
- GitHub Actions CI (build + sanity tests + Rust fmt/clippy/build), a custom
  icon + favicon, and full documentation.

[Unreleased]: https://github.com/Lang-Julian/lucida/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Lang-Julian/lucida/releases/tag/v0.1.0
