# Release Notes Index

Append-only narrative release notes for `@luutuankiet/looker-mcp-shim`.

## Authoring

- **One file per release.** Name: `vX.Y.Z.md`. No overwrites.
- **Audience:** human first, then agents picking up context six months later.
- **Structure:** TL;DR → Why → Highlights table → Mermaid diagram (when there's a flow) → Before/After example → Config → Upgrade notes → Files changed.
- **Voice:** pitch, not changelog. If a line could be a commit subject, cut it.
- **Diagrams:** Mermaid only — GitHub renders it natively in release bodies.
- **Promotion boundary:** anything that lands in `releases/` is world-readable. Private reasoning belongs in `gsd-lite/` (gitignored).

## Publishing

The `publish.yml` workflow reads `releases/${{ github.ref_name }}.md` via `gh release create --notes-file` when a tag is pushed. If the file is missing, the workflow fails loudly — no `--generate-notes` fallback, because empty stubs defeat the point.

## Index

| Version | Date | Theme |
|---|---|---|
| [v0.6.0](./v0.6.0.md) | 2026-05-27 | HTTP Streamable transport: remote agents without a sidecar |
| [v0.5.0](./v0.5.0.md) | 2026-04-13 | Visual preview: render dashboards and tiles, debug envelopes |
| [v0.4.4](./v0.4.4.md) | 2026-04-11 | structuredContent for shim and upstream bridged tools |
| [v0.4.3](./v0.4.3.md) | 2026-04-11 | Narrative release notes pattern adoption |

*Earlier releases (v0.4.2 and prior) predate this pattern — see [GitHub Releases](https://github.com/luutuankiet/looker-mcp-shim/releases) for auto-generated changelogs.*
