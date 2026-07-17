# Codex Theme Studio

[English](README.md)

一个面向官方 Codex 桌面应用的交互式主题设计 Skill，用于引导生成、预览、应用、验证、导入、导出和安全恢复精致主题。

![Codex Theme Studio 预览](assets/readme-preview.png)

## 主要能力

- 四步交互式 HTML 主题工作台，不需要手写复杂配置。
- 支持浅色、深色，以及编辑部、极光、赛博和温暖工作室等设计方向。
- 自动协调语义配色、文字、圆角、边框、阴影和表面层次。
- 提供语义配色质量评分，自动修正模式不匹配的表面亮度、正文、强调色和辅助色。
- 应用前明确提示主题推荐的 Codex 浅色/深色外观，避免原生组件出现深浅混合。
- 支持本地 PNG、JPEG、WebP 背景图，可配置焦点位置和阅读遮罩。
- 支持 AI 背景图流程：工作台记录提示词，由 Codex 生图并将最终位图打包进主题。
- 提供受信任、不可点击的安全装饰模板和实时碰撞检测。
- 弹窗、紧凑窗口、结构锚点缺失或空间不足时自动隐藏装饰。
- 使用本地回环 CDP 可逆注入，不修改签名应用和 `app.asar`。
- 支持 `.codex-theme` 导入导出，并检查大小、路径和 CSS 安全性。
- 内置 `aurora-focus` 与深色迪迦 `tiga-light` 示例主题和背景图。
- 提供三种同步快捷切换入口：可视化网页主题库、软件内自动避让的 `◐` 选择器和命令行。
- 首次激活回环运行时后即可免重启热切换，并串行执行、失败自动回滚。

## 环境要求

- macOS 12 或更高版本。
- 官方 Codex 桌面应用，通常位于 `/Applications/ChatGPT.app` 或 `~/Applications/ChatGPT.app`。
- Node.js 22 或更高版本。
- 支持本地 Skills 的 Codex。

当前启动和恢复流程面向 macOS。主题编译器、主题包验证、HTML 工作台和测试本身不依赖平台；暂未内置 Windows 启动适配。

## 安装

直接克隆到 Codex Skills 目录：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
git clone https://github.com/Way-To-AGI/codex-theme-studio.git \
  "${CODEX_HOME:-$HOME/.codex}/skills/codex-theme-studio"
```

重启 Codex 后即可在 Skills 列表中看到该技能。

需要从 Finder 快速打开可视化主题库时，运行 `scripts/choose-theme.command`，也可以在桌面放置一个指向它的包装脚本。若 Codex 尚未开启回环 CDP，命令会先询问是否执行一次安全重启。

后续更新：

```bash
git -C "${CODEX_HOME:-$HOME/.codex}/skills/codex-theme-studio" pull --ff-only
```

## 启动交互式工作台

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/codex-theme-studio"
node scripts/studio-server.mjs --wait-for-submit
```

服务只监听 `127.0.0.1`，随后会打开本地工作台。`--wait-for-submit` 会让调用它的 Agent 保持等待，并在用户提交后收到 `briefPath`、主题 ID、背景模式以及可选的上传图片路径。用户依次选择：

1. 明暗模式和设计方向。
2. 配色、圆角和阴影体系。
3. 背景来源、构图位置和阅读遮罩。
4. 装饰密度和主题文案。

点击“提交设计并让 Agent 继续”后，工作台会原子保存 `brief.json` 并把结果交回 Agent。页面会明确提示无需再发送消息；Agent 必须继续生成背景、编译、应用、截图验证和迭代，不能停在 HTML 页面。

不带 `--wait-for-submit` 启动时是独立模式：页面只保存设计方案，并明确提示当前没有等待中的 Agent，不会自行编译或应用主题。

## 在 Codex 中使用

调用 Skill 并描述目标，例如：

```text
使用 $codex-theme-studio 创建一个浅色、雾山背景、装饰克制的主题。
```

如果需要 AI 背景图，Codex 会生成宽屏位图，让中央阅读列和输入框后方保持安静留白，然后使用 `--art` 编译主题。

## 命令行流程

快捷切换命令：

```bash
node scripts/theme.mjs list
node scripts/theme.mjs status
node scripts/theme.mjs use aurora-focus
node scripts/theme.mjs web
node scripts/theme.mjs native
node scripts/theme.mjs restore
node scripts/theme.mjs studio
```

网页主题库、软件内 `◐` 和这些命令共用同一个回环管理器及当前主题状态。`native` 只清除主题外观，保留快速切换能力；`restore` 会同时移除主题、软件内按钮、管理器和 watcher。

应用前检查推荐模式和配色质量：

```bash
node scripts/preflight-theme.mjs --theme aurora-focus
```

根据 JSON Brief 编译主题：

```bash
node scripts/compile-theme.mjs \
  --brief /absolute/path/theme-brief.json \
  --art /absolute/path/background.png
```

应用主题：

```bash
node scripts/start-theme.mjs --theme aurora-focus
```

如果 Codex 已经在未开启回环 CDP 的情况下运行，启动器会安全停止。可以先关闭 Codex，或者明确授权重启：

```bash
node scripts/start-theme.mjs --theme aurora-focus --restart-existing
```

验证并截图：

```bash
node scripts/runtime.mjs \
  --verify \
  --port 9335 \
  --theme aurora-focus \
  --screenshot /absolute/path/verification.png
```

恢复原生界面：

```bash
node scripts/restore-theme.mjs
```

## 导入和导出

导出可移植主题包：

```bash
node scripts/export-theme.mjs \
  --theme aurora-focus \
  --output /absolute/path/aurora-focus.codex-theme
```

安全导入外部主题包：

```bash
node scripts/import-theme.mjs --input /absolute/path/theme.codex-theme
```

替换已经存在的主题时必须显式增加 `--force`。

## 安全机制

- 不编辑、替换、重签名或接管官方应用目录。
- 只连接回环 CDP 暴露的 `app://` 渲染器。
- 拒绝远程 CSS 资源、可执行 CSS、危险资源路径和超过 30 MB 的主题包。
- Theme Brief 不接受任意 HTML、选择器、脚本、事件处理器和坐标。
- 所有装饰均为 `aria-hidden` 和 `pointer-events: none`。
- 根据原生控件实际位置测量安全空间，没有无碰撞位置时自动隐藏。
- 保持原生控件尺寸、交互层级、状态色、代码、Diff、终端、弹窗和输入框行为。
- 只停止命令行与本 Skill 匹配的主题守护进程。

## 验证

```bash
node scripts/self-test.mjs
node scripts/studio-protocol-test.mjs
node scripts/theme-control-test.mjs
```

安装为 Codex Skill 后，还可以执行：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" \
  "${CODEX_HOME:-$HOME/.codex}/skills/codex-theme-studio"
```

## 目录结构

```text
SKILL.md                 Agent 工作流与安全边界
agents/openai.yaml       Codex Skill 元数据
assets/studio/           交互式 HTML 工作台
assets/switcher/         可视化主题库
assets/renderer-inject.js 安全渲染适配器
assets/theme-switcher.js 软件内受信任主题选择器
references/              Schema、设计规范、运行时和 QA 契约
scripts/                 编译、运行、快捷切换、恢复和测试脚本
themes/aurora-focus/     内置示例主题
```

## 许可证与免责声明

项目采用 [MIT License](LICENSE)。内置极光背景图专为本仓库生成，使用相同许可证分发。

这是独立社区项目，与 OpenAI 不存在隶属或官方背书关系。Codex、OpenAI 及相关标识归各自权利人所有。分发自定义主题时，用户需要自行确认第三方图片、品牌、角色和人物肖像的使用及分发权利。
