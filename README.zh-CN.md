# dsh-markdown-live

[English](README.md) · [简体中文](README.zh-CN.md)

在 DSH 输入框内实时渲染 Markdown —— 不替换输入框、不改变尺寸、不影响 `@` 提及与 `/` 命令。

## 渲染内容

| Markdown | 输入框中的表现 |
| --- | --- |
| `**粗体**`、`*斜体*`、`~~删除线~~` | 加粗、双下划线、删除线 |
| `` `代码` `` | 收起反引号，等宽底纹 |
| `[文字](url)` | 链接色与下划线 |
| `#` … `#####` | 收起井号、整行放大（不加粗） |
| `- 项` | 敲出 `- ` 立刻变成圆点 |
| `1. 项` | 序号保留、文字紧跟其后；Shift+Enter 续号，空项再换行退出列表，序号恒为 `1..n` |
| `> 引用` | 该行写完后收起 `>` |
| ` ``` ` 代码块 | 代码底色、等宽字体、按 token 着色（字符串/数字/关键字/调用/注释） |
| 粘贴内容 | 自动拆成真实行并渲染 |

已写完的行才渲染；正在编辑的那一行显示字面 Markdown，点回已渲染行会恢复标记。粘贴同样生效：整段内容会先落在一个文本节点里，插件当场把它拆成行。标记后的空格半角、不换行、全角都识别（`#　标题` 也算）。

## 安装

插件市场 —— **设置 → DSH 插件市场**，搜索 *Markdown composer*，安装后刷新页面。

命令行：

```sh
dsh plugin --profile web add dsh-markdown-live
dsh plugin --profile web add github:YouYou-lj/dsh-markdown-live
dsh plugin --profile web add link:/插件目录绝对路径
```

安装后刷新页面，可在 **设置 → 插件** 中开关。

## 说明

- Chromium 的 `::highlight()` 不能改字重与字形，因此粗体用零模糊字影、斜体用双下划线表示。
- 标题最多五级；`######` 及以上按普通文本显示。
- 序号不做列对齐：`1.` 与 `10.` 的文字起点相差一个字符位；折行后行首贴左边距（输入框把整篇草稿放在同一个段落里）。
- `---` 保持原样，不画横线。

## 开发

```sh
node scripts/build.mjs          # 由 src/client/*.cjs 生成 client.js
node tests/run-tests.mjs        # 语法、分词、列表、行切分、bundle、manifest
node tests/markdown-matrix.mjs  # 每种渲染语法一行
```

另有一套真实 Lexical 0.49 的无头测试，位于同级目录 `../dsh-md-harness/tests/lexical-harness.mjs`。

## 许可证

MIT
