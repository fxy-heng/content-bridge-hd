# 贡献规范

## 分支

- `feature/<name>`：新增功能。
- `fix/<name>`：修复问题。
- `docs/<name>`：文档更新。

## PR 要求

每个 PR 只做一件事，并填写：

- 功能描述
- 实现思路
- 测试方式
- 备注

如引用第三方库、参考代码或复用历史代码，必须在 PR 描述中说明。

## 本地检查

提交前运行：

```bash
npm run check
npm test
npm run smoke
```

## Commit 建议

使用清晰的提交信息，例如：

- `feat: add custom platform adapter`
- `fix: handle empty draft import`
- `docs: update demo script`

