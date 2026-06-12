# Contributing

1. Run `npm install`.
2. Run `npm run build`.
3. Run `npm run validate:production` before submitting changes.
4. Add or update entries in `examples/manifest.json` for any demo example changes.
5. Do not add duplicate sample payloads; `npm run check:examples` enforces this.

Parser changes should be fail-closed: never silently draw guessed geometry for an unsupported opcode without diagnostics.

Contributions are accepted under AGPL-3.0-only.
