# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the public source of truth for all AI coding agents; keep this file in sync with it.

## What this project is

open-codesign is an Electron desktop app that turns natural-language prompts into design artifacts (HTML prototypes, PDFs, PPTX decks, marketing assets). It's the open-source counterpart to Claude Design, with multi-provider model support via `pi-ai` and a local-first storage model.

Product model (v0.2): **a `Design` owns a workspace and equals a pi session**. The agent edits design source files in that workspace (default source entry is `App.jsx`; `index.html` is for standalone exports/legacy); the runtime renders those sources in a sandboxed preview; exporters turn them into HTML/PDF/PPTX/ZIP/Markdown. Session history lives as pi JSONL under app user data; the workspace filesystem is the source of truth for artifacts.

The full vision and locked decisions live in `docs/VISION.md` when the internal docs are present locally. Public checkouts may not have `docs/`; in that case use `AGENTS.md`, public issues/PRs, and README context instead of blocking.

> Note: `docs/` is gitignored — internal team materials (research, roadmaps, handoffs) live there but are not part of the public repo. Do not cite `docs/**` in public PR review comments unless the file exists in the public checkout.

## Hard constraints (do not violate)

These are project-level commitments, not preferences:

1. **No bundled model runtimes.** No Ollama, llama.cpp, Python, or browser binaries shipped in the installer. Use system installs or lazy-download on demand.
2. **BYOK only.** No proxied API calls, no cloud account, no telemetry by default. User credentials stay in `~/.config/open-codesign/config.toml` (plaintext, file mode 0600 — matching Claude Code / Codex / gh CLI conventions).
3. **Local-first storage.** v0.2 design state is pi JSONL sessions plus real workspace files. Existing v0.1 SQLite data may be migrated, but do not add new SQLite-backed session/design feature state.
4. **Every design has a workspace.** No sealed/open split. Do not introduce `project` as a product abstraction in v0.2; the sidebar lists sessions.
5. **Permissive shipped dependencies.** Shipped app/runtime dependencies, bundled assets, scaffolds, skills, brand refs, and copied code must be MIT-compatible permissive. Workflow-only CI/release tools may use copyleft licenses when they are not vendored, bundled, linked, or copied into the product; document the reason.
6. **Lazy-load heavy features.** PPTX export, web capture, scaffolds, skills, brand refs, and image generation must dynamic-import on first use, not at app start.
7. **Reuse pi primitives first.** `pi-coding-agent` / `pi-agent-core` own sessions, built-in tools, bash execution, event streaming, and the model registry unless a design-specific need proves otherwise.
8. **Brand values are data, not model memory.** Use `DESIGN.md`, user files, official CSS/SVG/screenshots, or brand URLs. Never invent brand hex values from memory.
9. **Compatibility, upgradeability, no bloat, elegance** — the four PRINCIPLES §5b checks. Every PR description must mark all four green.

## Architecture (the part that spans many files)

```
renderer (apps/desktop/src/renderer)   React + Zustand — store.ts is the state hub
   │  IPC via preload bridge
main process (apps/desktop/src/main)   *-ipc.ts handlers: workspace, permissions,
   │                                   generation, exports, diagnostics, config
@open-codesign/core                    agent.ts wraps pi-agent-core `Agent`; design
   │                                   tools in src/tools/; system-prompt sections
   │                                   in src/prompts/sections/*.md
@mariozechner/pi-ai + @open-codesign/providers
   │                                   provider compat shims (claude-code
   │                                   identity, gemini, gateway), retry/error classes
workspace files (App.jsx …)  →  runtime (sandboxed iframe srcdoc preview, vendored
                                React/Babel compile JSX on-device)  →  exporters
                                (PDF via system Chrome/puppeteer-core, PPTX, ZIP; lazy)
```

- **pi-agent-core quirks** (documented at the top of `packages/core/src/agent.ts`): `Agent` takes `model`/`systemPrompt`/`tools` via `options.initialState`, not top-level args; there is no `agent.run()` — call `agent.prompt()` and read state after settlement; the delta event is `message_update` with `assistantMessageEvent.type === 'text_delta'`.
- **Prompt sections build step**: `packages/core/src/prompts/sections/*.md` are copied flat into `apps/desktop/out/main/*.md` by the `copyPromptSections` plugin in `electron.vite.config.ts` and read via `readFileSync` at runtime. Editing a section requires no loader change, but tests/CI rely on this copy.
- **Design tools** live in `packages/core/src/tools/` (`ask`, `scaffold`, `skill`, `preview`, `tweaks`, `done`, `generate_image_asset`, `set_todos`, `set_title`, `text_editor`, `inspect_workspace`, `decompose-to-ui-kit`, `verify-ui-kit-parity`…). Gate everything through the pi `tool_call` hook + the permission UI. Do not reintroduce a verifier subagent or custom bash/list-files tools.
- **Bundled resources** in `apps/desktop/resources/templates/` — four distinct kinds, don't blur them: `skills/*.md` are method rules (not copied into workspaces); `brand-refs/*/DESIGN.md` are read-only brand references loaded as `skill("brand:<slug>")`; `scaffolds/**` are concrete starter assets copied by `scaffold()`; `design-skills/*.jsx` are copyable JSX snippets exposed via a virtual filesystem. Treat all of them as product code: audit content vs manifest, keep extensions truthful (`.html` = full documents, `.jsx` = React starters), no CDN scripts or placeholder filler like "Page content".
- **Workspace settings**: `<workspace>/.codesign/settings.json` (schema-versioned); `settings.local.json` is personal and gitignored.
- **Permission model tiers**: T0 workspace-local reads/simple commands run silently; T1 installs/build/non-local network ask once + allowlist; T2 publish/push/sudo ask every time; T3 destructive system commands blocked. Never hide a blocked tool call — show command, path, tier, reason.
- **`DESIGN.md`** (Google spec) is the design-system baton: input and output. It is authoritative once present in a workspace; generated work must preserve/repair it rather than treat it as a preset. Workspace settings/config carry `schemaVersion` — version everything that lives on disk (IPC payloads, exported bundles too).

## Stack & conventions

- **Package manager**: `pnpm` only. Never use `npm` or `yarn`. Workspace declared in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `website`).
- **Build orchestration**: Turborepo (`test`/`typecheck` depend on `^build` — turbo builds package deps first).
- **Lint + format**: Biome (single tool, no ESLint + Prettier). `pnpm lint:fix` applies fixes; don't hand-format.
- **Tests**: Vitest everywhere; specs are colocated with source (`*.test.ts` next to the file). There is no Playwright E2E setup — "browser tests" are Vitest specs (`.browser.test.ts`) that launch system Chrome via `puppeteer-core` and `describe.skipIf` when Chrome is absent. Vitest caps at 2 workers on Windows to avoid exhausting the host.
- **TypeScript**: `strict: true`, `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`. No `any`.
- **Commits**: Conventional Commits, enforced by commitlint. Branches: `<type>/<short-slug>` (e.g. `fix/cjk-pptx-wrap`).
- **Versioning**: Changesets. Don't hand-edit `CHANGELOG.md`. User-visible changes need `pnpm changeset`.
- **Node**: 22 LTS (pinned via `.nvmrc` + `engines`). pnpm 10.x pinned via `packageManager` (use Corepack).
- **Model layer**: All LLM calls go through `@mariozechner/pi-ai`. Don't import provider SDKs directly in app code; if pi-ai lacks a feature, add it to `packages/providers` as a thin extension.

### Frontend stack (locked)

- **UI framework**: React 19 + Vite (renderer built via electron-vite)
- **Styles**: Tailwind v4 + CSS variables (tokens in `packages/ui`)
- **State**: Zustand (do not introduce Redux / Recoil / MobX)
- **Routing**: native `useState` view switching at first; TanStack Router only when route count > 5
- **Components**: Radix UI primitives + custom shadcn-style wrappers in `packages/ui`
- **Icons**: `lucide-react` (only)
- **Forms**: native `<form>` + `FormData` (do not introduce react-hook-form / formik)
- **Animations**: Tailwind transitions (do not introduce framer-motion / motion)
- **Sandbox renderer**: Electron iframe `srcdoc`; App.jsx source is wrapped by the runtime for preview/export, exported `index.html` is the standalone deliverable
- **Electron version**: 39.x — never 41.x (cross-origin isolation regression)
- **Storage**: file/session-backed design state; TOML files for config (no electron-store blob)

## Repository layout

```
apps/desktop/         # Electron app shell: src/main, src/preload, src/renderer
                      # resources/templates = bundled skills/brand-refs/scaffolds/design-skills
packages/
  core/               # Agent orchestration: agent.ts, tools/, prompts/, security/
  providers/          # pi-ai adapter + compat shims (claude-code identity, gemini, gateway)
  runtime/            # Sandbox preview runtime (iframe errors, overlay, tweaks bridge)
  ui/                 # Shared app UI tokens and components (aligned with open-cowork)
  artifacts/          # Artifact schema (HTML / React / SVG / PPTX)
  exporters/          # PDF / PPTX / ZIP exporters (lazy-loaded)
  templates/          # Built-in demo prompts and starter templates
  shared/             # Cross-package contracts: types, errors, DESIGN.md validation, tweak-source
  i18n/               # EN + 简体中文 locales and error-code messages
website/              # VitePress docs site (opencoworkai.github.io)
scripts/              # smoke-models.ts — live model smoke test (pnpm smoke)
docs/                 # Internal vision/plans/research (gitignored — team only)
examples/             # Reproductions of Claude Design public demos
```

## Doing tasks here

- **Read `docs/VISION.md` when available** for non-trivial change. Other internal docs (`docs/PRINCIPLES.md`, `docs/v0.2-plan.md`, `docs/plans/`, `docs/research/`) may exist locally — use them as context; public contributors won't have them.
- **Use the planning-with-files workflow** for any task spanning > 5 tool calls or > 3 files. Plans live in `.claude/workspace/`. Don't create planning churn for small fixes.
- **Use git worktrees for parallel work.** Never run two unrelated feature branches in the same checkout.
- **Respect the lean budget** (< 30 prod deps). Before adding a shipped dependency, the PR must cover: install size (`pnpm why <pkg>`), MIT-compatible license, why not alternatives, and whether it can be a peer dep.
- **UI must use `packages/ui` tokens.** Don't hard-code colors, fonts, or spacing in app code (generated design sources/exports may define their own visual system). If a token is missing, add it to `packages/ui` first.
- **No "design for the future" abstractions.** Three similar lines is fine. Don't introduce factories, plugin systems, or config-driven dispatch unless we have two real callers.
- **No comments explaining what code does.** Names should do that. Only comment the *why* when it's surprising.
- **New features need Vitest coverage.** Broaden tests when changing migrations, permissions, tool hooks, or shared contracts.
- **Keep edits scoped.** One concern per PR; anything over ~400 LOC of substantive change should be split or pre-discussed. Run `pnpm lint && pnpm typecheck && pnpm test` before a PR.

## Things to avoid

- ❌ Adding `node_modules`, build outputs, `.env*` files, or generated release artifacts to git
- ❌ Importing from a provider SDK (`@anthropic-ai/sdk`, `openai`, `@google/genai`) in app code
- ❌ Writing tests that mock the LLM at the SDK level — mock at the `core`/pi boundary instead
- ❌ Adding tracking, analytics, account flows, cloud sync, or auto-update without explicit opt-in UX
- ❌ Hard-coding any path; respect XDG base dirs / Electron `app.getPath()` / workspace roots
- ❌ Synchronous I/O in the main process
- ❌ `console.*` in `apps/desktop/src/main/**`, `packages/core/**`, `packages/providers/**`, `packages/exporters/**`, `packages/shared/**` — use `getLogger()` (main) or the injected `CoreLogger` (core/providers/exporters). Biome enforces this.
- ❌ Session branching UI, undo/version rollback, MCP support, or community skill installation in v0.2 unless the plan changes

## Useful commands

```bash
pnpm i                          # install (Corepack-pinned pnpm 10.x)
pnpm dev                        # turbo dev: Electron app + VitePress docs site together
pnpm --filter @open-codesign/desktop dev   # desktop app only
pnpm test                       # turbo test → vitest run in every workspace package
pnpm -C packages/core exec vitest run src/agent.test.ts   # single test file
pnpm -C packages/core exec vitest src/agent.test.ts       # single file, watch mode
pnpm lint                       # biome check
pnpm lint:fix                   # biome check --write
pnpm typecheck                  # tsc --noEmit across workspace
pnpm build                      # turbo build (bundles; electron-builder packaging is separate)
pnpm --filter @open-codesign/desktop start # launch the built app; run pnpm build first
pnpm -C apps/desktop package    # build + electron-builder installers
pnpm smoke                      # scripts/smoke-models.ts — live provider/model smoke test
pnpm docs:dev                   # VitePress website only
pnpm changeset                  # record a release-worthy change
```

The renderer opens in the Electron window; opening its Vite URL in a plain browser does not provide the desktop IPC APIs. CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → electron-vite build smoke on ubuntu only; cross-platform installers build on tag releases via `release.yml`.

## Open questions / pending research

Check `docs/research/` and `docs/plans/` when present before touching sandbox / inline-comment / tweaks / PPTX / pi-ai capabilities — research may still be pending and decisions unresolved. Don't prematurely lock in answers to questions still under investigation.
