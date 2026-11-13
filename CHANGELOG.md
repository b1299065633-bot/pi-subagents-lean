# Changelog

## [0.25.0] - 2026-11-13

Re-pinned to upstream `@tintinweb/pi-subagents@0.25.0` (from 0.23.2). The facade (`index.ts`) is unchanged: all four upstream tool names and their schema dispatch remain compatible.

Upstream changes in 0.24.0–0.25.0 include nested-agent visibility and concurrency limits, improved `/agents` settings, finished-result timestamps, and a stale schedule-lock fix. The built-in `general-purpose` agent can now delegate to nested subagents; the default depth is 2 and nested concurrency is capped at 10.

Re-measured on Pi 1.5.2: lean 276 tokens, upstream 0.25.0 8,522 tokens — 8,246 saved (96.8%).

Verified before release: `npm run check` (TypeScript plus 14 tests, including routing against the real 0.25.0 upstream schemas) passes.

## [Unreleased]

- **`scripts/sync-upstream.mjs`** — bumps the upstream pin, re-measures both sides and rewrites `package.json` plus the numbers in both READMEs. It runs in two contexts: inside this repo (upstream installed into `node_modules`, so `--to` installs it) and inside a vendored install such as `~/.pi/agent/extensions/pi-subagents-lean` (upstream source copied into `upstream/`, so `--to` fetches into a temp directory and never touches pi's npm tree). Exposed as `npm run sync-upstream`. It never runs git.
- zh README: 节约 → 节省, matching the English wording.

## [0.23.2] - 2026-11-10

Re-pinned to upstream `@tintinweb/pi-subagents@0.23.2` (from 0.23.1). The facade (`index.ts`) is unchanged: 0.23.2 touches only the conversation viewer's key handling and adds README translations, so the four upstream tool names the facade dispatches on are untouched.

Upstream changes in 0.23.2:

- `fix(ui)`: conversation viewer jump keys now resolve through `tui.altScreen.top/bottom` (#438), plus 170 lines of keybinding tests.
- Added partial zh-CN / ja / ko README translations and `docs/translations.md`.

Re-measured on Pi 1.5.2: lean 276 tokens, upstream 0.23.2 8,522 tokens — 8,246 saved (96.8%). Same numbers as 0.23.1, as expected: no tool definitions changed.

Verified before release: `npm run check` (tsc + 14 tests, including routing against the real 0.23.2 upstream schemas) passes.

## [0.23.1] - 2026-11-09

Re-pinned to upstream `@tintinweb/pi-subagents@0.23.1` (from 0.22.1). The facade (`index.ts`) is unchanged: it looks upstream's tools up by name (`Agent`, `get_subagent_result`, `steer_subagent`, `SubagentWorkflow`), and 0.23.x kept those names.

Upstream changes that motivated the bump:

- Built-in `Explore` inherits the session's model instead of the hard-coded `anthropic/claude-haiku-4-5`.
- `get_subagent_result` and `resume` keep working after an agent record is evicted or after a reload (previously `Agent not found` about ten minutes after completion).
- `tools:` accepts Claude Code tool names (`Read`, `Glob`, `Bash`) and bare `mcp__<server>__<tool>` entries narrow MCP tools instead of being dropped.
- Workflow completion notifications count agents, not progress events.
- 0.23.1: the conversation viewer renders tool calls like pi's own transcript; `get_subagent_result` resolves a finished agent by handle after a reload.

Re-measured on Pi 1.5.0: lean 276 tokens, upstream 0.23.1 8,522 tokens — 8,246 saved (96.8%).

Verified before release: the extension loads in an isolated pi process and registers exactly one tool (`subagent`, 276 tokens); `op=help` dispatches to upstream; a real `op=run` spawn of a `general-purpose` agent returned its result.

## [0.22.5] and earlier

See the upstream project, [kunkun9527/pi-subagents-lean](https://github.com/kunkun9527/pi-subagents-lean).
