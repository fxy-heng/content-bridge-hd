# PR 与 Commit 计划

> 注意：所有 commit 时间戳必须落在所选批次的开始与截止时间之内。不要使用不在批次内的历史代码提交，也不要最后一天一次性导入代码。

## 1. 分支策略

- 主分支：`main`
- 功能分支命名：`feature/<short-name>`
- 修复分支命名：`fix/<short-name>`
- 文档分支命名：`docs/<short-name>`

每个功能通过 PR 合入 `main`，每个 PR 只做一件事。PR 合并后，`main` 必须能启动并展示已有功能。

## 2. PR 模板

每个 PR 描述必须包含：

```md
## 功能描述
说明本 PR 新增或修改了什么，用户如何使用。

## 实现思路
说明技术选型、主要文件、核心逻辑。

## 测试方式
说明如何启动项目、如何验证功能正常。

## 备注
如复用旧代码、参考资料、第三方库，需要在这里说明。
```

## 3. 推荐 PR 拆分

### PR 01: 初始化仓库和文档骨架

- 内容：创建 README、项目计划、PR 模板、基础目录。
- Commit 建议：
  - `docs: add project overview and submission checklist`
  - `chore: add pull request template`
- 验证方式：检查文档完整性和目录结构。

### PR 02: 初始化前端项目

- 内容：创建 React + TypeScript + Vite 前端工程。
- Commit 建议：
  - `chore: scaffold frontend app`
  - `chore: configure lint and formatting`
- 验证方式：`npm install` 后 `npm run dev` 可启动。

### PR 03: 搭建基础页面布局

- 内容：实现内容编辑区、平台选择区、预览区的静态布局。
- Commit 建议：
  - `feat: add publishing workspace layout`
  - `feat: add platform selection panel`
- 验证方式：浏览器可看到主要工作台界面，移动端不明显错位。

### PR 04: 实现内容输入模型与状态管理

- 内容：标题、正文、标签、封面图等输入状态。
- Commit 建议：
  - `feat: add source content editor`
  - `feat: add draft state management`
- 验证方式：输入内容后预览区能读取当前草稿。

### PR 05: 实现平台适配器接口

- 内容：定义 SourceContent、AdaptedContent、PlatformAdapter、ValidationResult。
- Commit 建议：
  - `feat: define platform adapter contracts`
  - `test: cover adapter contract helpers`
- 验证方式：单元测试通过，接口可被各平台实现复用。

### PR 06: 实现公众号和知乎适配

- 内容：公众号长文结构、知乎观点结构。
- Commit 建议：
  - `feat: add wechat article adapter`
  - `feat: add zhihu content adapter`
  - `test: cover wechat and zhihu adapters`
- 验证方式：输入同一内容可生成两种不同平台风格。

### PR 07: 实现 B站和小红书适配

- 内容：B站视频简介风格、小红书短段落和话题风格。
- Commit 建议：
  - `feat: add bilibili description adapter`
  - `feat: add rednote content adapter`
  - `test: cover bilibili and rednote adapters`
- 验证方式：四个平台均可生成适配内容。

### PR 08: 实现平台限制校验

- 内容：标题长度、标签数量、正文为空、封面缺失等检查。
- Commit 建议：
  - `feat: add platform validation rules`
  - `test: cover validation warnings`
- 验证方式：构造超长标题和过多标签，页面显示警告。

### PR 09: 实现多平台预览

- 内容：按平台 Tab 或分栏展示适配结果。
- Commit 建议：
  - `feat: add platform preview tabs`
  - `feat: add editable adapted content preview`
- 验证方式：可切换平台，适配结果可复制或编辑。

### PR 10: 实现模拟发布流程

- 内容：发布器接口、模拟发布器、批量发布工作流。
- Commit 建议：
  - `feat: add publisher contracts`
  - `feat: add simulated publish workflow`
  - `test: cover publish status transitions`
- 验证方式：点击一键发布后能看到各平台成功或失败状态。

### PR 11: 实现发布日志

- 内容：展示历史发布记录、状态、失败原因、时间。
- Commit 建议：
  - `feat: add publish history log`
  - `feat: persist local publish records`
- 验证方式：刷新页面后仍能看到最近发布记录，或 README 中说明仅会话内保存。

### PR 12: 增加导出功能

- 内容：导出 JSON 或 Markdown。
- Commit 建议：
  - `feat: export adapted content as markdown`
  - `feat: export publish package as json`
- 验证方式：下载文件内容与预览一致。

### PR 13: 完善架构文档

- 内容：补充可扩展平台设计、适配器流程图、真实发布接入方案。
- Commit 建议：
  - `docs: document platform adapter architecture`
  - `docs: add real publishing extension guide`
- 验证方式：评委能根据文档理解如何扩展平台。

### PR 14: 完善 README 和 demo 脚本

- 内容：启动方式、依赖说明、原创功能、demo 视频脚本。
- Commit 建议：
  - `docs: update setup and dependency notes`
  - `docs: add demo walkthrough script`
- 验证方式：新用户按 README 可启动并复现演示。

### PR 15: 最终演示与质量收尾

- 内容：修复 UI 细节、补充测试、添加 demo 视频链接。
- Commit 建议：
  - `fix: polish responsive publishing workspace`
  - `test: add integration coverage for publish flow`
  - `docs: add demo video link`
- 验证方式：从干净环境安装、启动、完成一遍演示流程。

## 4. Commit 分布建议

- 每天至少 1 到 3 个有意义 commit。
- 每个 PR 建议 1 到 4 个 commit。
- 不要出现大段无意义提交，例如 `update`、`fix bug`、`test`。
- 每次 commit 应能说明一个清晰变更点。
- 文档、前端、适配器、测试应分布在整个周期内，不要集中在最后一天。

## 5. 每个 PR 的质量检查

合并前检查：

- PR 标题是否清楚。
- PR 描述是否包含功能描述、实现思路、测试方式。
- 是否只做了一件事。
- 是否能在本地启动。
- 是否更新了 README 或架构文档中的相关说明。
- 如使用第三方依赖，README 是否列明。
- 如参考或复用历史代码，PR 描述是否说明来源。

