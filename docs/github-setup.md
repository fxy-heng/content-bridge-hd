# GitHub 仓库创建与推送

本机当前没有检测到 GitHub CLI (`gh`)。建议在 GitHub 网页端创建空仓库后执行以下命令。

假设仓库名为 `content-bridge`：

```bash
git remote add origin https://github.com/fxy-heng/content-bridge.git
git push -u origin main
```

如远程仓库已存在且 origin 配置错误：

```bash
git remote set-url origin https://github.com/fxy-heng/content-bridge.git
git push -u origin main
```

## 推荐 PR 顺序

为了满足持续交付要求，后续不要直接把所有代码一次性推到主分支。更推荐的方式：

1. 保留当前 `main` 作为可运行基线。
2. 后续每个功能从 `main` 创建分支。
3. 每个分支只做一件事，并使用 `.github/pull_request_template.md` 填写描述。
4. PR 合并后立即确认 `npm test` 通过。

## 当前本地提交

当前本地已有多个提交，可作为开发过程起点：

- `feat: scaffold content bridge mvp`
- `feat: enhance publishing workspace workflow`
- `docs: add architecture and demo materials`

