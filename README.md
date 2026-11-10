<div align="center">

<img src="src/notebook-logo.svg" width="80" height="80" alt="GPT Notebook">

# GPT Notebook

**Read, edit and export your ChatGPT conversations — locally, in one HTML file.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform: Chrome | Edge](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge-0078D6)](https://github.com/chchaoo/gpt-notebook/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/chchaoo/gpt-notebook?label=release)](https://github.com/chchaoo/gpt-notebook/releases/latest)

**[Download HTML](https://github.com/chchaoo/gpt-notebook/releases/latest)** · **[Try the web demo](https://chchaoo.github.io/gpt-notebook/)** · **[简体中文](README.zh-CN.md)**

[User manual](https://github.com/chchaoo/gpt-notebook/wiki/English-Manual) · [Build from source](https://github.com/chchaoo/gpt-notebook/wiki/Build-from-Source)

</div>

<div align="center">

<img src="docs/images/en/reading.png" width="820" alt="GPT Notebook reading a fictional sample">

*Actual application screenshot. All conversations shown are fictional [samples](examples/en/sample-archive.zip).*

</div>

## Why GPT Notebook?

- **Read & find** — Conversation branches, full-text search, Markdown, code, formulas and local media
- **Edit** — Titles and messages, Markdown and visual modes, undo/redo
- **Save & revisit** — Save / Save as, incremental history, change summaries and version comparisons
- **Export** — HTML, Markdown, JSON, PDF/print, source-data folder or ZIP; current, selected or all chats
- **Make it yours** — Eleven interface languages, themes, font settings and remembered reading positions

## A closer look

### Edit with a live preview

<div align="center">

<img src="docs/images/en/editing.png" width="760" alt="Markdown editor and preview">

</div>

Stage an edit, then save when ready. [Editing guide](https://github.com/chchaoo/gpt-notebook/wiki/Read-Edit-Export).

### Compare saved versions

<div align="center">

<img src="docs/images/en/history.png" width="760" alt="Read-only history comparison">

</div>

Inspect changes before restoring a version to your draft. [Saving and history](https://github.com/chchaoo/gpt-notebook/wiki/Saving-and-History).

<details>
<summary>Export options</summary>

<div align="center">

<img src="docs/images/en/export.png" width="760" alt="Export settings">

</div>

Choose the range and format; exports include your current draft. [Export guide](https://github.com/chchaoo/gpt-notebook/wiki/Read-Edit-Export#export-what-you-need).

</details>

## Get started

1. Download **gpt-notebook.html** and open it in a recent desktop Chrome or Edge.
2. Open your ChatGPT export folder or ZIP, keeping JSON and attachments together.
3. Select a conversation. Read, edit a draft, save, or export what you need.

No installation, server, account or API key. Try the [sample ZIP](examples/en/sample-archive.zip) first. [Step-by-step guide](https://github.com/chchaoo/gpt-notebook/wiki/Get-Started).

## Build

Python 3.12+ builds the blank HTML using committed runtime assets:

```sh
python tools/project.py verify
python tools/project.py build
```

Tests additionally use Node.js 24 and pnpm 11.25.0. [Complete build instructions and repository map](https://github.com/chchaoo/gpt-notebook/wiki/Build-from-Source).

## Privacy and scope

Archives are processed locally. The application does not upload chats or generate new AI replies. Exports containing your chats remain private files; a clicked external source link can open its website. Save modifies the selected source when supported, so start with a copy. [FAQ](https://github.com/chchaoo/gpt-notebook/wiki/FAQ).

## License

[MIT](LICENSE). Incorporated code and runtime component notices are retained in [NOTICE](NOTICE.md) and [third-party notices](THIRD_PARTY_NOTICES.md). This project is not affiliated with OpenAI.
