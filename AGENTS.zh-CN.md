# AGENTS.md - Open CoDesign（中文译本）

> 本文件是 `AGENTS.md` 的中文翻译，方便中文读者阅读。若中英内容有出入，以英文原版 `AGENTS.md` 为准。

给 Codex 及其他在本仓库工作的 AI 编程代理的指令。做任何改动前先读完本文件。

`CLAUDE.md` 可能落后于当前计划。对 Codex 的工作而言，本文件是公共事实来源。如果本地存在 `docs/VISION.md`、`docs/PRINCIPLES.md`、`docs/v0.2-plan.md` 等内部文档，将其作为补充上下文使用；若不存在，不要因此阻塞公共贡献者的工作。

## 本项目是什么

Open CoDesign 是一个开源的桌面设计代理。它把提示词、本地文件、技能（skills）、脚手架（scaffolds）、品牌体系和模型输出，变成用户自己电脑上的设计成品。

v0.2 的方向不再是"单次提示生成器"。每个设计（Design）都是一个长时运行的 pi 会话，带有一个真实的工作区（workspace）。代理可以读写文件、执行经过权限控制的命令、提出结构化问题、预览成品、暴露可调节控件（tweaks）、在所配置模型支持时生成图片，并产出 `DESIGN.md` 设计体系产物。

最初的灵感来自 Claude Design。如今产品边界更清晰了：Open CoDesign 借用经过验证的编码代理机制，再加上设计专用工具和本地优先的工作区模型。

产品模型：一个 `Design` 拥有一个工作区。代理在工作区中编辑设计源文件；预览运行时把这些源文件渲染成网页文档；导出器把渲染后的（或源）文档转成标准产出，如 HTML、PDF、PPTX、ZIP 或 Markdown。v0.2 中默认的源文件入口是 `App.jsx`；`index.html` 保留给独立导出或遗留工作区文件。

`docs/` 已被 gitignore。维护者本地可能有内部计划、交接文档和研究资料；公共贡献者没有。除非该文件存在于公共检出中，否则不要在公共 PR 评审评论中引用 `docs/**`。

## 硬性约束

这些是项目承诺，不是可商量的偏好：

1. 不捆绑模型运行时。不要在安装包里塞 Ollama、llama.cpp、Python、浏览器二进制或模型权重。使用系统安装，或在用户可见、知情同意的前提下按需懒下载。
2. 仅 BYOK（自带密钥）。默认没有托管账户、代理 API 或遥测。用户凭据保存在人类可读的本地配置中。
3. 本地优先存储。v0.2 使用 pi JSONL 会话加真实工作区文件。既有 v0.1 SQLite 数据可以迁移，但不要为会话、聊天历史、评论、快照或设计文件新增 SQLite 表。
4. 每个设计都有工作区。v0.2 没有"密封/开放"之分。工作区文件系统是产物和素材的事实来源。
5. 随应用/运行时发布的依赖、捆绑素材、脚手架、技能、品牌参考和复制的代码必须是 MIT 兼容的宽松协议。凡是捆绑、链接、被应用代码导入或分发给用户的东西，拒绝 GPL、AGPL、SSPL、专有依赖及来源不明的复制素材。仅用于工作流的 CI/发布工具，在未被 vendor/捆绑/链接/复制进产品时可以使用 copyleft 协议；要记录原因，且其输出仅限普通元数据或清单。
6. 重功能懒加载。PPTX 导出、网页抓取、脚手架、技能、品牌参考和图片生成必须按需加载，而不是应用启动时加载。
7. 优先复用 pi 原语。会话、内置工具、bash 执行、事件流、模型注册表、提供者注册和能力数据归 `pi-coding-agent` 所有，除非有设计特有的需求证明例外。
8. 品牌数值是数据，不是模型记忆。使用 `DESIGN.md`、用户文件、官方 CSS/SVG/截图或品牌 URL。不要凭记忆编造品牌十六进制色值。
9. PR 应保持兼容、可升级、精简、优雅。若本地存在 `docs/PRINCIPLES.md`，用其中"原则 5b"的表述作为详细检查清单。

## 网页工作的 AI 可见性

构建或更新任何网站、项目主页、产品页、个人站点、文档站、博客或公开项目页时，除非用户明确退出，默认交付范围要包含 AI 可见性：

- 添加 `/llms.txt`：包含站点简介、作者或组织、关键页面、项目/产品的规范描述，以及机器可读资源链接的简明 Markdown 概览。
- 当站点有足够实质性公开内容时，添加 `/llms-full.txt` 作为更完整的 AI 可读上下文文件。
- 慎重配置 `robots.txt`：允许帮助 AI 系统引用或检索公开内容的搜索与抓取爬虫；把训练类爬虫当作单独的策略决策。
- 维护 `sitemap.xml` 并确保覆盖重要公开页面。相关时提及 Google Search Console 和 Bing 站长工具提交。
- 在有用的地方添加适当的 JSON-LD 结构化数据，如 `Person`、`Organization`、`WebSite`、`BlogPosting`、`SoftwareApplication`、`FAQPage`、`CreativeWork`。
- 对重要实体（个人资料、项目、文章、文档、发布、FAQ、产品事实）优先提供干净的 Markdown 或 JSON 机器可读端点。
- 保持内容真实、有据可查、不灌水。目标是帮助 AI 系统准确理解和引用既有真实内容，而不是制造低质量 SEO 填充。

## 当前架构方向

### 代理运行时

- 使用 `pi-coding-agent` 和 `pi-ai`。
- `read`、`write`、`edit`、`bash`、`grep`、`find`、`ls` 使用 pi 内置工具。
- 所有工具经由 pi `tool_call` 钩子和 Open CoDesign 权限 UI 把关。
- 从 pi `Model<T>` 字段读取能力，如 `input`、`reasoning`、`cost`、`contextWindow`、`maxTokens`。
- 通过 `pi.registerProvider()` 注册自定义提供者。不要另建一套平行的提供者 SDK 层。
- 所有 LLM 调用走 `pi-ai`；不要在应用代码中直接导入提供者 SDK。

### 存储

- 设计即 pi 会话。
- 会话历史以 pi JSONL 形式存于应用用户数据目录下。
- 设计源文件、生成的 JSX/HTML/CSS、素材、导出物、`AGENTS.md` 和 `DESIGN.md` 存于用户工作区。
- 工作区设置存于 `.codesign/settings.json`，带 `schemaVersion`。
- `settings.local.json` 是个人配置，应保持 gitignore。
- v0.1 SQLite 是待迁移的遗留数据，不是 v0.2 的存储模型。

### 工具

v0.2 的工具面是 pi 的七个内置工具加上 Open CoDesign 的设计工具：

- `ask(questions)` 渲染结构化问题并等待用户。
- `scaffold(kind, path)` 把精选的起步模板复制进工作区。
- `skill(name)` 从清单懒加载技能文本。
- `preview(path)` 渲染产物并返回控制台错误、素材错误、DOM 大纲、指标和截图（供视觉模型使用）。
- `gen_image(prompt, path)` 在能力和提供者配置允许时，把生成的图片写入磁盘。
- `tweaks(blocks)` 跨文件声明可编辑控件。
- `todos(items)` 在复杂回合中展示任务状态。
- `done(path)` 在预览自检后结束回合。

除非计划改变，v0.2 不要重新引入验证子代理、snip 工具、自定义 bash 工具、自定义列文件工具，或由代理自己写的工作记忆。

### 设计系统

- `DESIGN.md` 遵循 Google 规范，既可作为输入也可作为输出。
- 代理生成的多屏工作应随着 token 的出现而更新 `DESIGN.md`，以保持视觉一致性。
- 内置品牌参考必须包含署名、来源、许可元数据，以及"无隶属关系"说明。
- 内置技能使用 agentskills 风格的 `SKILL.md` 格式。
- 技能和脚手架清单应携带许可和来源元数据。

### 资源边界

- `apps/desktop/resources/templates/skills/*.md` 中的 Markdown 技能是方法论规则。它们告诉代理怎么干活；不往工作区复制文件。
- `apps/desktop/resources/templates/brand-refs/*/DESIGN.md` 中的品牌参考是只读设计体系，以 `skill("brand:<slug>")` 方式加载。不要为某个项目去改它们；把采纳的选择"翻译"进工作区自己的 `DESIGN.md`。
- `apps/desktop/resources/templates/scaffolds/**` 中的脚手架是具体的起步/源素材，由 `scaffold(kind, destPath)` 复制。只要清单描述准确，可以是 JSX、HTML、CSS、Markdown 或其他文本格式。
- `apps/desktop/resources/templates/design-skills/*.jsx` 中的设计技能片段是可复制的 JSX 组件模式，通过虚拟文件系统以 `skills/<file>.jsx` 暴露。它们是源码片段，不是 Markdown 技能，也不是品牌权威。
- 工作区的 `DESIGN.md` 是项目特定的设计体系交接棒。一旦出现在工作区中，它对当前设计就是权威的；生成的工作应保留或修复它，而不是把它当成又一个预设。

### 内置起步模板与脚手架

- 把起步/脚手架素材当作产品代码，不是提示词填充物。改动或新增预设前，除清单外还要审查实际文件内容。
- 保持源码格式与文件扩展名一致。完整 HTML 文档必须是 `.html`，JSX/React 起步模板是 `.jsx`，CSS 片段是 `.css`。`scaffold()` 工具复制时应保留源扩展名，但预设素材本身也应命名和描述正确。
- 内置 HTML 起步模板应自包含、能在当前运行时中预览。不要给脚手架素材加 Reveal.js、React、Babel、Chart.js 等 CDN/运行时脚本。若起步模板需要运行时行为，用本地纯 HTML/CSS/JS，或应用提供的/懒加载的依赖，且有清晰的许可路径。
- 避免弱占位文案，如 "Deck title"、"Page content"、"Replace this"、"Point one"。使用中性、可直接使用的示例内容；JSX 起步模板通过 `TWEAK_DEFAULTS` 暴露明显的替换点。
- 清单描述应说明起步模板是 HTML 还是 CSS，并标注对扩展名敏感的素材，尤其是代理可能误复制进 `_starters/*.jsx` 的文件。
- 改动 `apps/desktop/resources/templates/scaffolds/**` 时，审查扩展名/内容不匹配、外部网络 URL、过时占位文案和清单漂移。当改动影响复制路径、预览分类或工具细节时，添加或更新聚焦的脚手架/运行时测试。

## 技术栈与约定

- 包管理器：仅 `pnpm`。永远不用 `npm` 或 `yarn`。
- 构建编排：Turborepo。
- 代码检查与格式化：Biome。
- 测试：全部用 Vitest；测试规格与源码同目录（`*.test.ts` 放在文件旁边）。没有 Playwright E2E 设置——"浏览器测试"是 Vitest 规格（`.browser.test.ts`），通过 `puppeteer-core` 启动系统 Chrome，Chrome 不存在时用 `describe.skipIf` 跳过。
- TypeScript：strict 模式、`verbatimModuleSyntax`、bundler 解析、禁用 `any`。
- 提交信息：Conventional Commits。
- 版本管理：Changesets。不要手改 `CHANGELOG.md`。
- Node：22 LTS，由 `.nvmrc` 和 `engines` 锁定。
- 确切包版本以 `package.json`、各 workspace 清单和 `pnpm-lock.yaml` 为准。读这些文件，别信过时的文档。

### 前端

- React + Vite + Tailwind v4 + CSS 变量。
- 状态用 Zustand。不要引入 Redux、Recoil 或 MobX。
- 组件用 Radix 原语加 `packages/ui` 中的自定义 shadcn 风格封装。
- 图标用 `lucide-react`。
- 表单用原生 `<form>` 和 `FormData`。
- 动画用 Tailwind transition。不要引入 framer-motion 或 motion。
- 应用外壳必须使用 `packages/ui` 的 token。生成的设计源文件和导出物可以定义自己的视觉体系。
- 沙箱预览保持 Electron iframe `srcdoc` 加运行时工具。`App.jsx` 的 JSX 源码由运行时包装后用于预览/导出；导出的 `index.html` 是独立交付物。

## 仓库布局

```
apps/
  desktop/           # Electron 应用外壳、主进程、渲染器
packages/
  core/              # 代理编排、提示词、设计工具
  providers/         # pi 集成与提供者兼容垫片
  runtime/           # 沙箱渲染器与预览运行时
  ui/                # 共享的应用 UI token 与组件
  artifacts/         # 产物模式与打包格式
  exporters/         # PDF / PPTX / ZIP 导出器，懒加载
  templates/         # 内置示例与起步模板
  shared/            # 共享类型、工具、模式
docs/                # 内部愿景、计划、原则、研究；gitignored
examples/            # 公开演示复现
```

## 在此仓库做事

- 对非平凡的架构或产品工作，当本地存在 `docs/VISION.md`、`docs/PRINCIPLES.md`、`docs/v0.2-plan.md` 时先读它们。公共检出可能没有 `docs/`；此时依赖本文件、公开 issue/PR 和 README 上下文。
- 对超过五次工具调用或超过三个文件的任务，当持久化的本地计划确有帮助时，使用 `.Codex/workspace/` 中的计划文件。小型直接修复不要制造计划文件折腾。
- 并行或无关的功能工作使用 git worktree。不要在同一检出里混两个无关分支。
- 当本地存在 `docs/RESEARCH_QUEUE.md` 时，触碰沙箱、行内评论、tweaks、PPTX、pi 能力、脚手架、技能或品牌参考之前先查它。
- 保持改动聚焦。避免顺手重构。
- 新增随应用发布/运行时的依赖前，检查许可、安装体积、替代方案，以及能否作为 peer dep。仅工作流用途的工具要记录为何不捆绑、其输出是否影响分发产物。
- 为功能工作添加或更新 Vitest 覆盖。改迁移、权限、工具钩子或共享契约时要扩充测试。
- 在有两个真实调用方需要更多之前，优先清单和 switch 逻辑，而不是注册表。
- 只在"原因会让下一位维护者意外"时才写注释。

## 权限模型

Open CoDesign 使用单一分层权限模型：

- Tier 0：工作区本地读写、简单文件命令、只读 git——可不打断直接运行。
- Tier 1：安装、构建命令、非本地网络请求、工作区外命令——询问一次，可加白名单。
- Tier 2：发布、推送、sudo、高影响面命令——每次都询问。
- Tier 3：破坏性系统命令、`curl | sh`、系统目录写入——直接封锁，不可覆盖。

不要隐藏被封的工具调用。展示命令、路径、层级和原因。

## 要避免的事

- 把 `node_modules`、构建产物、`.env*`、生成的发布产物或私有本地文件加进 git。
- 在应用代码中导入 `@anthropic-ai/sdk`、`openai`、`@google/genai` 等提供者 SDK。
- 写在 SDK 层 mock LLM 的测试。在 core 或 pi 边界 mock。
- 未经明确的 opt-in UX 就添加追踪、分析、账户流程、云同步或自动更新。
- 硬编码用户路径。尊重 XDG、Electron `app.getPath()` 和工作区根目录。
- 为 v0.2 会话/设计数据新增 SQLite 支持的功能状态。
- 在 v0.2 引入 `project` 作为产品抽象。多个会话可共享工作区，但侧边栏列出的是会话。
- 除非计划改变，v0.2 不暴露会话分支 UI、撤销/版本回滚、MCP 支持或社区技能安装。
- 在 `apps/desktop/src/main/**`、`packages/core/**`、`packages/providers/**`、`packages/exporters/**`、`packages/shared/**` 中使用 `console.*`。使用项目日志器。

## 常用命令

```bash
pnpm i
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm changeset
```
