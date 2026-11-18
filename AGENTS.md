# Zotero TabFlow 仓库工程规范

本仓库遵循根目录 [AGENTS.md](../../AGENTS.md) 的全部长期工程铁律，并补充以下项目级约束：

1. **品牌与兼容边界**：
   - 显示名称：`Zotero TabFlow`；扩展 ID：`zotero-tabflow@groele`；首选项前缀：`extensions.zotero.tabflow.`。
   - 宿主兼容范围锁定为 Zotero `10.0` ~ `12.*`（Gecko 153+ / Firefox 140+）。
2. **构建与源码唯一权威**：
   - 唯一可编辑源码目录为 `src/`（严格 TypeScript + ES Modules），禁止手改编译产物 `zoterotabflow.js` 与 `zoterotabflow_prefs.js`。
   - 任何单文件不得超过 `360` 行；执行 `npm test` 必须同时通过 `tsc --noEmit`、esbuild 打包、架构守卫 (`scripts/architecture-guard.mjs`)、语法校验与单元测试。
3. **设置面板规范**：
   - 遵循 40px 黄金对齐基准线与 Fluent `data-l10n-id` 全本地化，所有核心功能均在 `prefs.xhtml` 提供独立开关。
