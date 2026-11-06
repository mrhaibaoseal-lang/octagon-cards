# Octagon Cards

Personal UFC card-fighting game for iPhone. Self-use only.

The project is being rebuilt: gameplay is proven first in a browser prototype, then ported back to native Swift.

## Layout
- `prototype/web/` current work: playable browser prototype, JSON rules, balance simulator
- `docs/GAME_DESIGN.md` the game spec, `docs/TASKS.md` the roadmap, `RULES.md` project rules
- `docs/archive/` the previous design direction (no longer valid)
- `App/`, `Packages/OctagonCore` the previous native sandbox, kept until the port replaces it (tag `legacy-v0.6.1`)
- `pipeline/` Python scraper, ratings and sprite tools
- `.github/workflows` free CI and unsigned IPA build

## Play the prototype
```bash
node prototype/web/serve.js
```
Then open http://localhost:5173 in a browser, or the LAN address it prints on a phone (landscape).

## Build an IPA (free)
1. Tag and push: `git tag v0.0.1 && git push origin v0.0.1` (or run the workflow manually)
2. Download the `OctagonCards-unsigned-ipa` artifact: `gh run download <run-id>`
3. Sign and install with FlareStore on the iPhone. Signing files never go in this repo.
