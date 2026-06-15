## Summary

<!-- What does this change, and why? -->

## Checklist

- [ ] `npm run build` passes (tsc + vite)
- [ ] `npm test` passes (recognizer + AI engine sanity tests)
- [ ] If Rust changed: `cargo fmt --check` and `cargo clippy -- -D warnings` are clean
- [ ] Stays local-first — no telemetry, no secrets, no network calls beyond `127.0.0.1`
