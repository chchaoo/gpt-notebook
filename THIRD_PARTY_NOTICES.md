# Third-party notices

[简体中文](https://github.com/chchaoo/gpt-notebook/wiki/第三方组件说明)

The project MIT grant does not replace component licenses. Retain the following runtime assets and license files when redistributing source or rebuilding the HTML:

| Component | Retained notice |
|---|---|
| Original incorporated project code | [LICENSE](LICENSE), [src/LICENSE](src/LICENSE), [provenance](NOTICE.md) |
| marked | Copyright/license header in [src/marked.min.js](src/marked.min.js) |
| KaTeX and bundled fonts | [src/vendor/katex/LICENSE](src/vendor/katex/LICENSE) |
| Toast UI Editor | [src/vendor/toast-editor/LICENSE](src/vendor/toast-editor/LICENSE) |
| ProseMirror, DOMPurify and editor dependencies | [src/vendor/toast-editor/licenses](src/vendor/toast-editor/licenses) |
| JSZip | [src/vendor/jszip/LICENSE.markdown](src/vendor/jszip/LICENSE.markdown) |
| RE2JS | [src/vendor/re2js/LICENSE](src/vendor/re2js/LICENSE) |
| pinyin-pro | [src/vendor/pinyin-pro/LICENSE](src/vendor/pinyin-pro/LICENSE) |

Development dependency versions are locked in pnpm-lock.yaml. Tests and editor rebuild tooling use those packages; a dependency being listed does not mean its full engine is shipped in the HTML. In particular, PDF uses browser printing, not a new embedded PDF engine. Gyroflow was consulted historically for UI design; its GPL QML implementation is not bundled.

The [GitHub Corners](https://github.com/tholman/github-corners) Octocat artwork is by Tim Holman under the MIT license. The full notice is embedded next to the SVG in the template and the standalone HTML.
