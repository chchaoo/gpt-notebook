<div align="center">

<img src="src/notebook-logo.svg" width="80" height="80" alt="GPT Notebook">

# GPT Notebook

**用一个 HTML，在本地阅读、编辑和导出 ChatGPT 聊天记录。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform: Chrome | Edge](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge-0078D6)](https://github.com/chchaoo/gpt-notebook/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/chchaoo/gpt-notebook?label=release)](https://github.com/chchaoo/gpt-notebook/releases/latest)

**[下载 HTML](https://github.com/chchaoo/gpt-notebook/releases/latest)** · **[在线试用](https://chchaoo.github.io/gpt-notebook/)** · **[English](README.md)**

[使用手册](https://github.com/chchaoo/gpt-notebook/wiki/中文手册) · [从源码构建](https://github.com/chchaoo/gpt-notebook/wiki/从源码构建)

</div>

## 可以做什么

| 功能 | 能做什么 | 详细说明 |
| --- | --- | --- |
| **转 Markdown／HTML** | 导出带媒体的 Markdown，或可直接打开的独立 HTML。 | [导出格式](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#导出需要的内容) |
| **转 PDF／打印** | 打印所选聊天，或在浏览器中另存为 PDF。 | [PDF 与打印](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#pdf-与打印) |
| **Obsidian 知识库** | 生成带索引、公式和本地附件的独立聊天笔记。 | [导出到 Obsidian](https://github.com/chchaoo/gpt-notebook/wiki/导出到Obsidian) |
| **拆分与合并** | 把所选聊天拆成多个资料包，或向另一份资料增量导入。 | [拆分与合并资料](https://github.com/chchaoo/gpt-notebook/wiki/拆分与合并资料) |
| **阅读与搜索** | 打开目录或 ZIP，搜索全文，切换聊天分支。 | [阅读与搜索](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#阅读与查找) |
| **编辑与整理** | 开启编辑模式后修改文字、星标、手动排序或撤销。 | [编辑与星标](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#编辑草稿) |
| **保存与恢复** | 保存到资料，查看历史差异并恢复增量备份。 | [保存与历史](https://github.com/chchaoo/gpt-notebook/wiki/保存与历史) |
| **JSON 与资料副本** | 导出原始结构 JSON、资料文件夹或 ZIP，并带相关附件。 | [导出格式](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#导出需要的内容) |

**还没有 ChatGPT 导出包？** 在 ChatGPT 打开「设置 → 数据控制 → 导出数据」。[查看带截图的导出教程](https://github.com/chchaoo/gpt-notebook/wiki/从ChatGPT导出记录)。


<div align="center">

<img src="docs/images/zh-CN/reading.png" width="820" alt="GPT Notebook 阅读虚构样例">

*真实运行界面。图中全部聊天均为[虚构样例](examples/zh-CN/sample-archive.zip)。*

</div>

## 界面一览

### 编辑时对照预览

<div align="center">

<img src="docs/images/zh-CN/editing.png" width="760" alt="Markdown 编辑与预览">

</div>

先暂存编辑，确定后再保存。[阅读与编辑说明](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出)。

### 恢复前查看历史差异

<div align="center">

<img src="docs/images/zh-CN/history.png" width="760" alt="只读历史对照">

</div>

先查看变化，再将所需版本恢复为草稿。[保存与历史说明](https://github.com/chchaoo/gpt-notebook/wiki/保存与历史)。

<details>
<summary>查看导出选项</summary>

<div align="center">

<img src="docs/images/zh-CN/export.png" width="760" alt="导出设置">

</div>

选择范围及格式，导出可包含当前草稿。[导出说明](https://github.com/chchaoo/gpt-notebook/wiki/阅读编辑与导出#导出需要的内容)。

</details>

## 开始使用

1. 下载 **gpt-notebook.html**，用较新的桌面 Chrome 或 Edge 打开。
2. 如还没有资料，先按[图文教程导出 ChatGPT 记录](https://github.com/chchaoo/gpt-notebook/wiki/从ChatGPT导出记录)，再打开 ZIP 或解压文件夹。
3. 选择聊天，开始阅读、编辑草稿、保存或导出。

无需安装、服务器、账号或 API 密钥。可以先下载[样例 ZIP](examples/zh-CN/sample-archive.zip)体验。[详细步骤](https://github.com/chchaoo/gpt-notebook/wiki/开始使用)。

## 构建

Python 3.12+ 配合仓库保留的运行资产即可构建空白 HTML：

```sh
python tools/project.py verify
python tools/project.py build
```

运行测试还需 Node.js 24 和 pnpm 11.25.0。[完整构建方法及源码目录说明](https://github.com/chchaoo/gpt-notebook/wiki/从源码构建)。

## 隐私与范围

资料在本地处理，应用不上传聊天，也不生成 AI 新回答。包含聊天的导出文件仍是私人资料；主动点击外部来源会访问对应网站。浏览器支持时，保存会修改当前资料，初次使用建议打开副本。[常见问题](https://github.com/chchaoo/gpt-notebook/wiki/常见问题)。

## 许可证

采用 [MIT](LICENSE)。沿用代码及运行组件的版权声明保留在[来源说明](https://github.com/chchaoo/gpt-notebook/wiki/来源说明)与[第三方说明](https://github.com/chchaoo/gpt-notebook/wiki/第三方组件说明)中。本项目与 OpenAI 无隶属关系。
