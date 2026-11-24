# Agent Pets / PetDeck

Windows 优先的 Agent 桌面宠物：通过本机 bridge 观察本地 Agent 会话，编排任务并验收交付，以透明桌宠展示状态；观察会话可通过复制交接包回到对应工具。会话内容与缓存默认留在本机。

## 从哪个目录开始

应用源码位于 **`petdeck/`**，仓库根目录没有 `package.json`。开发与运行入口：

```bash
cd petdeck
npm ci
npm run tauri:dev
```

桌面安装包自带 Node.js 24 运行时，只需 Windows 10/11 与 WebView2，装完即可使用；源码开发需要 Node.js 24+，开发构建还需要 Rust 和 Visual Studio MSVC 工具链。NSIS 安装包约 30 MB，安装后主占用约 107 MB（含约 88 MB 的 Node 运行时）。完整环境说明见 [petdeck/README.md](petdeck/README.md)，安装与日常使用见 [用户手册](docs/用户手册.md)。

## 文档入口

- [文档索引](docs/README.md)：现行文档、技术勘察、历史资料的定位与维护规则。
- [统一路线图](docs/ROADMAP.md)：当前唯一开发计划；历史 Phase 计划不再并行维护。
- [变更历史](CHANGELOG.md)：版本事实与发布记录。
- [真机实测矩阵](docs/真机实测矩阵.md)：区分自动化测试、合成测试与真实环境验证。

## 仓库分区

| 路径 | 定位 |
| --- | --- |
| `petdeck/` | 当前应用、bridge、Tauri 桌面壳及开发说明 |
| `docs/` | 当前用户/运维文档、技术勘察与统一路线图 |
| `petdeck/docs/` | 宠物美术与皮肤规范，不放项目开发计划 |
| `docs/superpowers/` | 已完成 Phase 的历史设计与实施计划，仅作追溯 |
| `archive/` | 阶段快照及恢复说明 |
| `spark-output/`、`spike/` | 早期设计链产物和技术验证，不代表当前实现状态 |

当前代码与文档以 `master` 为基线；`.superpowers/worktrees/` 是历史工作区，不是另一套现行源码或计划。

## 质量检查

以下命令可直接从仓库根目录运行：

```bash
npm --prefix petdeck run docs:check
npm --prefix petdeck run typecheck
npm --prefix petdeck test
npm --prefix petdeck run lint
npm --prefix petdeck run build
cargo fmt --check --manifest-path petdeck/src-tauri/Cargo.toml
cargo test --manifest-path petdeck/src-tauri/Cargo.toml
```

发布、签名与应用内更新见 [自动更新与签名](docs/自动更新与签名.md)。
