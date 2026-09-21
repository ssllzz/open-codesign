# CLAUDE.md（中文译本）

> 本文件是 `CLAUDE.md` 的中文翻译，方便中文读者阅读。若中英内容有出入，以英文原版 `CLAUDE.md` 为准。

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指引。

`AGENTS.md` 是所有 AI 编程代理的公共事实来源；保持本文件与它同步。

## 本项目是什么

open-codesign 是一个 Electron 桌面应用，把自然语言提示词变成设计成品（HTML 原型、PDF、PPTX 演示文稿、营销素材）。它是 Claude Design 的开源对位产品，通过 `pi-ai` 支持多提供者模型，并采用本地优先的存储模型。

产品模型（v0.2）：**一个 `Design` 拥有一个工作区，且等于一个 pi 会话**。代理在该工作区中编辑设计源文件（默认源文件入口是 `App.jsx`；`index.html` 用于独立导出/遗留场景）；运行时在沙箱预览中渲染这些源文件；导出器把它们变成 HTML/PDF/PPTX/ZIP/Markdown。会话历史以 pi JSONL 形式存于应用用户数据目录下；工作区文件系统是产物的事实来源。

当本地存在内部文档时，完整愿景和已锁定的决策见 `docs/VISION.md`。公共检出可能没有 `docs/`；此时使用 `AGENTS.md`、公开 issue/PR 和 README 上下文即可，不要因此阻塞。

> 注：`docs/` 已被 gitignore——内部团队材料（研究、路线图、交接文档）放在那里，但不属于公共仓库。除非该文件存在于公共检出中，否则不要在公共 PR 评审评论中引用 `docs/**`。

## 硬性约束（不可违反）

这些是项目级承诺，不是偏好：

1. **不捆绑模型运行时。** 安装包里不带 Ollama、llama.cpp、Python 或浏览器二进制。使用系统安装或按需懒下载。
2. **仅 BYOK（自带密钥）。** 默认无代理 API 调用、无云账户、无遥测。用户凭据保存在 `~/.config/open-codesign/config.toml`（明文，文件权限 0600——与 Claude Code / Codex / gh CLI 惯例一致）。
3. **本地优先存储。** v0.2 设计状态是 pi JSONL 会话加真实工作区文件。既有 v0.1 SQLite 数据可以迁移，但不要新增 SQLite 支持的会话/设计功能状态。
4. **每个设计都有工作区。** 没有"密封/开放"之分。v0.2 不要引入 `project` 作为产品抽象；侧边栏列出的是会话。
5. **随产品发布的依赖须宽松协议。** 随应用/运行时发布的依赖、捆绑素材、脚手架、技能、品牌参考和复制的代码必须 MIT 兼容宽松。仅工作流用途的 CI/发布工具在未被 vendor/捆绑/链接/复制进产品时可用 copyleft 协议；要记录原因。
6. **重功能懒加载。** PPTX 导出、网页抓取、脚手架、技能、品牌参考和图片生成必须在首次使用时动态导入，而非应用启动时。
7. **优先复用 pi 原语。** 会话、内置工具、bash 执行、事件流和模型注册表归 `pi-coding-agent` / `pi-agent-core` 所有，除非有设计特有的需求证明例外。
8. **品牌数值是数据，不是模型记忆。** 使用 `DESIGN.md`、用户文件、官方 CSS/SVG/截图或品牌 URL。永远不要凭记忆编造品牌十六进制色值。
9. **兼容、可升级、不臃肿、优雅**——PRINCIPLES §5b 的四项检查。每个 PR 描述必须把四项全部标绿。

## 架构（跨多文件的部分）

```
renderer (apps/desktop/src/renderer)   React + Zustand — store.ts 是状态枢纽
   │  经 preload 桥接做 IPC
main process (apps/desktop/src/main)   *-ipc.ts 处理器：工作区、权限、
   │                                   生成、导出、诊断、配置
@open-codesign/core                    agent.ts 包装 pi-agent-core 的 `Agent`；设计
   │                                   工具在 src/tools/；系统提示词分节
   │                                   在 src/prompts/sections/*.md
@mariozechner/pi-ai + @open-codesign/providers
   │                                   提供者兼容垫片（claude-code
   │                                   身份、gemini、网关），重试/错误类
工作区文件 (App.jsx …)  →  runtime（沙箱 iframe srcdoc 预览，内置
                          React/Babel 在设备上编译 JSX）→  exporters
                          （PDF 经系统 Chrome/puppeteer-core，PPTX、ZIP；懒加载）
```

- **pi-agent-core 的怪癖**（记录在 `packages/core/src/agent.ts` 顶部）：`Agent` 的 `model`/`systemPrompt`/`tools` 通过 `options.initialState` 传入，不是顶层参数；没有 `agent.run()`——调用 `agent.prompt()` 并在结算完成后读取状态；增量事件是 `message_update`，其 `assistantMessageEvent.type === 'text_delta'`。
- **提示词分节构建步骤**：`packages/core/src/prompts/sections/*.md` 由 `electron.vite.config.ts` 中的 `copyPromptSections` 插件平铺复制到 `apps/desktop/out/main/*.md`，运行时通过 `readFileSync` 读取。编辑某个分节不需要改加载器，但测试/CI 依赖这一复制步骤。
- **设计工具**在 `packages/core/src/tools/`（`ask`、`scaffold`、`skill`、`preview`、`tweaks`、`done`、`generate_image_asset`、`set_todos`、`set_title`、`text_editor`、`inspect_workspace`、`decompose-to-ui-kit`、`verify-ui-kit-parity`…）。一切经由 pi `tool_call` 钩子 + 权限 UI 把关。不要重新引入验证子代理或自定义 bash/列文件工具。
- **捆绑资源**在 `apps/desktop/resources/templates/`——四种不同类型，别混淆：`skills/*.md` 是方法论规则（不复制进工作区）；`brand-refs/*/DESIGN.md` 是只读品牌参考，以 `skill("brand:<slug>")` 加载；`scaffolds/**` 是由 `scaffold()` 复制的具体起步素材；`design-skills/*.jsx` 是通过虚拟文件系统暴露的可复制 JSX 片段。把它们都当产品代码对待：对照清单审查内容，保持扩展名名副其实（`.html` = 完整文档，`.jsx` = React 起步模板），不留 CDN 脚本或 "Page content" 之类的占位填充。
- **工作区设置**：`<workspace>/.codesign/settings.json`（带 schema 版本）；`settings.local.json` 是个人配置且被 gitignore。
- **权限模型分层**：T0 工作区本地读取/简单命令静默运行；T1 安装/构建/非本地网络问一次 + 白名单；T2 发布/推送/sudo 每次都问；T3 破坏性系统命令封锁。永远不要隐藏被封的工具调用——展示命令、路径、层级、原因。
- **`DESIGN.md`**（Google 规范）是设计体系交接棒：既是输入也是输出。一旦出现在工作区中它就是权威的；生成的工作必须保留/修复它，而不是当作预设。工作区设置/配置带 `schemaVersion`——所有落盘的东西都要有版本（IPC 载荷、导出包也一样）。

## 技术栈与约定

- **包管理器**：仅 `pnpm`。永远不用 `npm` 或 `yarn`。workspace 在 `pnpm-workspace.yaml` 中声明（`apps/*`、`packages/*`、`website`）。
- **构建编排**：Turborepo（`test`/`typecheck` 依赖 `^build`——turbo 先构建包依赖）。
- **代码检查与格式化**：Biome（单一工具，不用 ESLint + Prettier）。`pnpm lint:fix` 应用修复；不要手动调格式。
- **测试**：全部用 Vitest；测试规格与源码同目录（`*.test.ts` 放在文件旁边）。没有 Playwright E2E 设置——"浏览器测试"是 Vitest 规格（`.browser.test.ts`），通过 `puppeteer-core` 启动系统 Chrome，Chrome 不存在时用 `describe.skipIf` 跳过。Windows 上 Vitest 限制最多 2 个 worker，避免拖垮主机。
- **TypeScript**：`strict: true`、`verbatimModuleSyntax: true`、`moduleResolution: "bundler"`。禁用 `any`。
- **提交**：Conventional Commits，由 commitlint 强制。分支命名：`<type>/<短标识>`（如 `fix/cjk-pptx-wrap`）。
- **版本管理**：Changesets。不要手改 `CHANGELOG.md`。用户可见的改动需要 `pnpm changeset`。
- **Node**：22 LTS（由 `.nvmrc` + `engines` 锁定）。pnpm 10.x 由 `packageManager` 锁定（使用 Corepack）。
- **模型层**：所有 LLM 调用走 `@mariozechner/pi-ai`。不要在应用代码中直接导入提供者 SDK；若 pi-ai 缺某功能，以薄扩展的形式加到 `packages/providers`。

### 前端技术栈（已锁定）

- **UI 框架**：React 19 + Vite（渲染器经 electron-vite 构建）
- **样式**：Tailwind v4 + CSS 变量（token 在 `packages/ui`）
- **状态**：Zustand（不要引入 Redux / Recoil / MobX）
- **路由**：先用原生 `useState` 视图切换；路由数 > 5 时才用 TanStack Router
- **组件**：Radix UI 原语 + `packages/ui` 中的自定义 shadcn 风格封装
- **图标**：仅 `lucide-react`
- **表单**：原生 `<form>` + `FormData`（不要引入 react-hook-form / formik）
- **动画**：Tailwind transition（不要引入 framer-motion / motion）
- **沙箱渲染器**：Electron iframe `srcdoc`；App.jsx 源码由运行时包装后用于预览/导出，导出的 `index.html` 是独立交付物
- **Electron 版本**：39.x——绝不用 41.x（跨源隔离回归问题）
- **存储**：文件/会话支撑的设计状态；配置用 TOML 文件（不用 electron-store 大杂烩）

## 仓库布局

```
apps/desktop/         # Electron 应用外壳：src/main、src/preload、src/renderer
                      # resources/templates = 捆绑的 skills/brand-refs/scaffolds/design-skills
packages/
  core/               # 代理编排：agent.ts、tools/、prompts/、security/
  providers/          # pi-ai 适配器 + 兼容垫片（claude-code 身份、gemini、网关）
  runtime/            # 沙箱预览运行时（iframe 错误、覆盖层、tweaks 桥）
  ui/                 # 共享的应用 UI token 与组件（与 open-cowork 对齐）
  artifacts/          # 产物模式（HTML / React / SVG / PPTX）
  exporters/          # PDF / PPTX / ZIP 导出器（懒加载）
  templates/          # 内置演示提示词与起步模板
  shared/             # 跨包契约：类型、错误、DESIGN.md 校验、tweak-source
  i18n/               # 英文 + 简体中文语言包及错误码消息
website/              # VitePress 文档站（opencoworkai.github.io）
scripts/              # smoke-models.ts — 真实模型冒烟测试（pnpm smoke）
docs/                 # 内部愿景/计划/研究（gitignored——仅团队可见）
examples/             # Claude Design 公开演示的复现
```

## 在此仓库做事

- **非平凡改动先读 `docs/VISION.md`**（如果存在）。其他内部文档（`docs/PRINCIPLES.md`、`docs/v0.2-plan.md`、`docs/plans/`、`docs/research/`）本地可能存在——用作上下文；公共贡献者没有这些。
- **超过 5 次工具调用或超过 3 个文件的任务使用 planning-with-files 工作流。** 计划放在 `.claude/workspace/`。小型修复不要制造计划文件折腾。
- **并行工作使用 git worktree。** 绝不在同一检出里跑两个无关的功能分支。
- **尊重精简预算**（生产依赖 < 30 个）。新增随产品发布的依赖前，PR 必须说明：安装体积（`pnpm why <pkg>`）、MIT 兼容许可、为何不用替代品、能否作为 peer dep。
- **UI 必须使用 `packages/ui` 的 token。** 不要在应用代码中硬编码颜色、字体或间距（生成的设计源文件/导出物可以定义自己的视觉体系）。缺 token 就先加到 `packages/ui`。
- **不做"为未来设计"的抽象。** 三行相似代码没问题。除非已有两个真实调用方，不要引入工厂、插件系统或配置驱动分发。
- **不写解释代码做什么的注释。** 命名应该说明一切。只在"原因出人意料"时注释 *为什么*。
- **新功能要有 Vitest 覆盖。** 改迁移、权限、工具钩子或共享契约时要扩充测试。
- **保持改动聚焦。** 一个 PR 只管一件事；实质性改动超过约 400 行应拆分或预先讨论。提 PR 前跑 `pnpm lint && pnpm typecheck && pnpm test`。

## 要避免的事

- ❌ 把 `node_modules`、构建产物、`.env*` 文件或生成的发布产物加进 git
- ❌ 在应用代码中导入提供者 SDK（`@anthropic-ai/sdk`、`openai`、`@google/genai`）
- ❌ 写在 SDK 层 mock LLM 的测试——应在 `core`/pi 边界 mock
- ❌ 未经明确 opt-in UX 添加追踪、分析、账户流程、云同步或自动更新
- ❌ 硬编码任何路径；尊重 XDG 基础目录 / Electron `app.getPath()` / 工作区根目录
- ❌ 主进程中做同步 I/O
- ❌ 在 `apps/desktop/src/main/**`、`packages/core/**`、`packages/providers/**`、`packages/exporters/**`、`packages/shared/**` 中使用 `console.*`——用 `getLogger()`（主进程）或注入的 `CoreLogger`（core/providers/exporters）。Biome 强制检查。
- ❌ v0.2 不做会话分支 UI、撤销/版本回滚、MCP 支持或社区技能安装（除非计划改变）

## 常用命令

```bash
pnpm i                          # 安装依赖（Corepack 锁定的 pnpm 10.x）
pnpm dev                        # turbo dev：Electron 应用 + VitePress 文档站一起跑
pnpm --filter @open-codesign/desktop dev   # 仅桌面应用
pnpm test                       # turbo test → 每个 workspace 包里跑 vitest run
pnpm -C packages/core exec vitest run src/agent.test.ts   # 跑单个测试文件
pnpm -C packages/core exec vitest src/agent.test.ts       # 单文件，watch 模式
pnpm lint                       # biome 检查
pnpm lint:fix                   # biome check --write
pnpm typecheck                  # 全 workspace 跑 tsc --noEmit
pnpm build                      # turbo build（打包；electron-builder 装包另算）
pnpm -C apps/desktop package    # 构建 + electron-builder 安装包
pnpm smoke                      # scripts/smoke-models.ts — 真实提供者/模型冒烟测试
pnpm docs:dev                   # 仅 VitePress 文档站
pnpm changeset                  # 记录一次值得发布的改动
```

渲染器在 Electron 窗口中打开；在普通浏览器里打开它的 Vite URL 拿不到桌面 IPC API。CI（`.github/workflows/ci.yml`）仅在 ubuntu 上跑 lint → typecheck → test → electron-vite 构建冒烟；跨平台安装包在 tag 发布时经 `release.yml` 构建。

## 待解问题 / 进行中的研究

触碰沙箱 / 行内评论 / tweaks / PPTX / pi-ai 能力之前，若 `docs/research/` 和 `docs/plans/` 存在则先查——研究可能仍在进行、决策未定。不要提前给仍在调查中的问题锁死答案。
