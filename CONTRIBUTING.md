# Contributing

[简体中文](https://github.com/chchaoo/gpt-notebook/wiki/参与开发) · [Build and code map](https://github.com/chchaoo/gpt-notebook/wiki/Build-from-Source)

Use fictional samples for bug reports and screenshots. Never commit personal exports, credentials, machine configuration or installed dependency caches.

1. Verify a fresh checkout, then restore locked development dependencies.
2. Make focused changes. Build, run the regression suite and review the diff.
3. Maintain the manual directly in the separate Wiki Git repository, with English and Chinese pages kept separate. Screenshots must use the public fictional samples.
4. Explain the resulting behavior, verification and relevant limits in the pull request.

Preserve unknown imported fields, numeric tokens and unchanged source content. Reading and history previews must not write files or mark a draft dirty. Reading positions stay in browser local storage. Restore changes a draft first; history cleanup must not silently save it. Preserve storage protocol compatibility and valid history chains.

Bind interface strings explicitly in all eleven locales. Do not translate user text or execute exported conversation code. Do not add network requests or telemetry incidentally.

See [validation](https://github.com/chchaoo/gpt-notebook/wiki/Validation) for what automated checks do and do not cover, and [publishing](https://github.com/chchaoo/gpt-notebook/wiki/Publishing) for release preparation.
