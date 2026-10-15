# Agents

Sosie films a lip-synced talking-head facecam of a face saying a script in a voice, on local GPUs.

- **MCP:** `server/mcp.ts` (stdio) bridges to the running Sosie API (`scripts/start.sh`). Claude Code picks it up from
  `.mcp.json`; Codex: `codex mcp add sosie -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/server/mcp.ts"` from this
  folder. Read `sosie://guide` first. Set `SOSIE_API_URL` when the API is not on the configured port.
- **Scripts:** one breath per line with `[note; pace …; pause …]`, see `docs/VOICE_PROMPTING.md`.
- **Day recap** (Sosie + MOceanX): `.claude/skills/day-recap/SKILL.md`.
- **Code:** `README.md` (setup, use), `docs/ARCHITECTURE.md` (layout), `docs/API.md` (HTTP API), `docs/NOTES.md`
  (measured facts and decisions). Tests: `npm test`, `npm run test:ui`, `npm run test:mcp`.

Filming someone needs their consent (photo and voice imports require it). Keep the "AI-generated (Sosie)" tag.
