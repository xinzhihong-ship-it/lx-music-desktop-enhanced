# Windows CI 构建管线与可用性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 GitHub Actions 随时产出 Windows 安装包（NSIS Setup x64/arm64 + 7z 绿色包），并隐藏 Windows 上「可见但必坏」的 Audirvana 引擎选项。

**Architecture:** 复用仓库已有的 `.github/workflows/beta-pack.yml`（push 到 `beta` 分支触发，产物为 workflow artifacts，无需密钥），仅增加 `workflow_dispatch` 手动触发；原生模块（better-sqlite3）在 windows-latest runner 上由 `install-app-deps` 现场编译，qrc_decode 用仓库内预编译产物。

**Tech Stack:** GitHub Actions、electron-builder、NSIS、Vue 3。

**对应 Spec:** `docs/superpowers/specs/2026-07-17-windows-ci-build-pipeline-design.md`

## Global Constraints

- 仓库：`/Volumes/存储/Applications/洛雪改造/lx-music-desktop`（路径含中文和空格，shell 命令中目录要加引号）。remote 是 `https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced.git`，当前在 `main` 分支。
- 不改 `release.yml`（正式发布流程需要 `BT_TOKEN` 等密钥，本次不配置）。
- 不往仓库补 better-sqlite3 的 win32 预置二进制；不动 win7 兼容构建流程；不做代码签名。
- 除 `workflow_dispatch` 触发器外，不改 `beta-pack.yml` 的任何 job。
- 仓库**没有单元测试框架**：验证以 YAML 解析校验 + `npm run lint` + `npm run build` + CI 实际运行为准。
- 提交信息风格：中文 conventional commits。
- 每次 `git commit` / `git push` 前先向用户确认（本仓库的硬性规则）。

---

### Task 1: beta-pack.yml 增加 workflow_dispatch 触发器

**Files:**
- Modify: `.github/workflows/beta-pack.yml:3-6`

**Interfaces:**
- Consumes: 无。
- Produces: GitHub 网页 Actions →「Build Beta」→「Run workflow」按钮（Task 3 的可选触发方式）。

- [ ] **Step 1: 修改 `.github/workflows/beta-pack.yml` 头部**

第 3-6 行：

```yaml
on:
  push:
    branches:
      - beta
```

改为：

```yaml
on:
  workflow_dispatch:
  push:
    branches:
      - beta
```

- [ ] **Step 2: 校验 YAML 语法**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('.github/workflows/beta-pack.yml','utf8'));console.log('yaml ok')"
```
Expected: 输出 `yaml ok`（js-yaml 随 eslint 安装在 node_modules 中）。若报 `Cannot find module 'js-yaml'`，改用 `npx js-yaml .github/workflows/beta-pack.yml > /dev/null && echo "yaml ok"`。

- [ ] **Step 3: Commit（先经用户确认）**

```bash
git add .github/workflows/beta-pack.yml
git commit -m "ci: beta-pack 支持手动触发构建"
```

---

### Task 2: 非 mac 平台隐藏 Audirvana 引擎选项

**Files:**
- Modify: `src/renderer/views/Setting/components/SettingPlay.vue:104-108`

**Interfaces:**
- Consumes: `isMac`（文件第 95 行已导入：`import { isMac, log } from '@common/utils'`，无需新增导入）。
- Produces: Windows/Linux 的设置 → 播放页中，播放引擎列表只剩 electron / mpv 两项。

**背景:** `src/main/modules/winMain/audirvanaController.ts:28-30` 在非 mac 平台对 Audirvana 操作直接 reject；当前引擎列表（`SettingPlay.vue:104-108`）无平台过滤，Windows 上选中即坏。

- [ ] **Step 1: 修改 `src/renderer/views/Setting/components/SettingPlay.vue`**

第 104-108 行：

```ts
    const playEngineList = [
      { id: 'electron', label: t('setting__play_engine_electron') },
      { id: 'mpv', label: t('setting__play_engine_mpv') },
      { id: 'audirvana', label: t('setting__play_engine_audirvana') },
    ]
```

改为：

```ts
    // Audirvana 仅 macOS 可用（主进程在非 mac 平台直接 reject），其他平台不展示该选项
    const playEngineList = [
      { id: 'electron', label: t('setting__play_engine_electron') },
      { id: 'mpv', label: t('setting__play_engine_mpv') },
      ...(isMac ? [{ id: 'audirvana', label: t('setting__play_engine_audirvana') }] : []),
    ]
```

- [ ] **Step 2: 验证编译与 lint**

Run:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && npx eslint src/renderer/views/Setting/components/SettingPlay.vue && npm run build
```
Expected: eslint 无输出；webpack 编译成功（确认展开运算符的类型推断无 TS 报错）。

- [ ] **Step 3: Commit（先经用户确认）**

```bash
git add src/renderer/views/Setting/components/SettingPlay.vue
git commit -m "fix(设置): 非 mac 平台隐藏不可用的 Audirvana 播放引擎选项"
```

---

### Task 3: 推送并触发 CI 构建

**Files:**
- 无文件改动。

**Interfaces:**
- Consumes: Task 1/2 的提交（在 `main` 分支上）。
- Produces: 正在运行的「Build Beta」workflow。

- [ ] **Step 1: 推送 main 并触发构建（先经用户确认）**

把 `main` 推到远端，再把 `main` 的内容推到 `beta` 分支触发构建：

```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && git push origin main && git push origin main:beta
```
Expected: 两次 push 成功；推送到 `beta` 后「Build Beta」workflow 自动开始运行（push 触发，不依赖 Task 1 的 workflow_dispatch）。

注意：工作区还有一批未跟踪的调试/测试脚本（`scripts/test-*`、`cdp-listen*.js`、`test_*.mjs` 等），**不要** `git add` 它们。

- [ ] **Step 2: 观察 CI 运行状态**

Run（若本机 `gh` 已登录该仓库）:
```bash
cd "/Volumes/存储/Applications/洛雪改造/lx-music-desktop" && gh run list --workflow beta-pack.yml --limit 3
```
或让用户在 GitHub 网页 Actions 页观察。

Expected: 「Build Beta」运行中。完整构建（win + win7 + mac + linux 全 job）预计 30-60 分钟。关注 Windows job 的：
- `Build src code`（webpack）— 必须成功
- `Build Package Setup x64` / `Build Package 7z x64`（electron-builder，含 better-sqlite3 的 node-gyp 编译与 mpv 下载）— 必须成功

若 better-sqlite3 编译失败：查看日志确认是否缺 MSVC 组件（windows-latest 默认预装 VS 2022，正常不会失败）。
若 mpv 下载失败：打包会继续（`build-pack.js:76-79` 仅打印错误），产物可用但不含内置 mpv，记录为已知问题即可，不算构建失败。

- [ ] **Step 3: 确认 Windows 产物齐全**

CI 完成后确认以下 artifacts 存在（`gh run download` 或网页下载）：
- `lx-music-desktop-x64-Setup`（`build/*-x64-Setup.exe`）
- `lx-music-desktop-arm64-Setup`
- `lx-music-desktop-win_x64-green`（7z）
- `lx-music-desktop-win_arm64-green`

---

### Task 4: Windows 实机验收（用户执行）

**Files:**
- 无文件改动。

- [ ] **Step 1: 安装并验证账号码功能**

用户在 Windows 机器上安装 `*-x64-Setup.exe`，逐项验证：
1. 设置 → 账号：网易云 / QQ音乐 / 酷狗 三家扫码（或 cookie）登录成功。
2. 平台音乐 → 用户歌单加载；「每日推荐」tab 能加载歌曲。
3. QQ音乐歌曲的歌词正常显示（验证 qrc_decode 在 Windows 生效）。
4. 播放引擎切换 electron / mpv 均能出声；设置中**不再出现** Audirvana 选项。
5. 桌面歌词、全局快捷键等基础功能正常。

- [ ] **Step 2: 验证听歌识曲（依赖识曲计划落地后的包）**

若构建时已包含识曲计划的改动：
1. 侧边栏有「听歌识曲」入口。
2. 「系统音频」模式识别其他 App 播放的歌曲。
3. 无播放时系统音频模式提示「未采集到系统声音，请确认正在播放歌曲」。
4. 「麦克风」模式正常。

- [ ] **Step 3: 记录验收结果**

任何一项失败：收集失败现象 + `%APPDATA%/lx-music-desktop` 下的日志，回到对应模块排查，不要直接在 CI 上盲改。

## Self-Review 记录

- Spec 覆盖：组件 1（workflow_dispatch）→ Task 1；组件 2（依赖验证结论）→ Global Constraints 与 Task 3 的预期说明，无需改动代码；组件 3（隐藏 Audirvana）→ Task 2；组件 4（触发与产物）→ Task 3；验证 → Task 3/4。
- 无占位符：YAML 与 Vue 改动均为完整代码；命令含预期输出。
- 类型一致性：无跨任务接口。
