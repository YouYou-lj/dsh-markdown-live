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

这是一个 Web-UI 插件：它运行在浏览器侧的客户端，桌面端与 `dsh web` 服务渲染的是同一个客户端。要装进你实际使用的 profile——桌面端是 `desktop`，`dsh web` 服务是 `web`：

| 使用场景 | 命令 |
| --- | --- |
| 桌面端 | `dsh plugin --profile desktop add dsh-markdown-live` |
| `dsh web` 服务 | `dsh plugin --profile web add dsh-markdown-live` |
| 任意 profile，从 GitHub 安装 | `dsh plugin --profile <名称> add github:YouYou-lj/dsh-markdown-live` |
| 本地目录 | `dsh plugin --profile <名称> add link:/插件目录绝对路径` |

桌面端也可以完全不用命令行：**设置 → DSH 插件市场**（搜索 *Markdown composer*），或 **设置 → 插件 → 添加插件** 选择插件目录。安装后刷新页面，可在 **设置 → 插件** 中开关。

## 说明

- Chromium 的 `::highlight()` 不能改字重与字形，因此粗体用零模糊字影、斜体用双下划线表示。
- 标题最多五级；`######` 及以上按普通文本显示。
- 序号不做列对齐：`1.` 与 `10.` 的文字起点相差一个字符位；折行后行首贴左边距（输入框把整篇草稿放在同一个段落里）。
- `---` 保持原样，不画横线。

## 兼容性

面向 DSH 桌面端与 `dsh web` 服务。已实测：DSH 桌面端 `2.0.23-next`、运行时 `0.2.2-rc.3`、Lexical `0.49.0`；包内声明 `engines.dsh = ">=0.2.0-rc.1 <0.3.0-0"`，运行时超出该窗口会报告"不满足要求"，而不是之后静默失效。

所有宿主契约都做了特性探测，单个契约变化只关掉对应功能，输入框本身不受影响；更新后控制台会指出具体缺失项。契约清单、策略与每周漂移检查见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 开发

```sh
node scripts/build.mjs          # 由 src/client/*.cjs 生成 client.js
node tests/run-tests.mjs        # 语法、分词、列表、行切分、bundle、manifest
node tests/markdown-matrix.mjs  # 每种渲染语法一行
node tests/lexical-harness.mjs  # 面向编辑器的一层代码，跑真实 Lexical
```

`npm test` 会依次跑完这三套。无头测试的 `lexical` 版本来自 `devDependencies`，与 DSH 捆绑版本保持一致——升级它即等于验证新内核。

## 许可证

MIT
