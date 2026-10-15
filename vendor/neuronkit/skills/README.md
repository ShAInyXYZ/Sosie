# The NeuronKit skill

`neuronkit/` is a skill for coding agents (Claude Code, Codex, anything that reads `SKILL.md` folders). It teaches the agent the whole kit: how to load it, the identity rules, every component class, token, behaviour, Svelte wrapper and icon, and the pitfalls already paid for.

| File | What it holds |
|---|---|
| `neuronkit/SKILL.md` | The instructions: loading, identity rules, tokens, corners, themes, behaviours, dynamic buttons, Svelte 5, composing screens, changing the kit, pitfalls. |
| `neuronkit/reference.md` | Every component, token, behaviour, Svelte prop and icon, generated from the kit by `tools/skill-reference.py`. Don't edit it by hand. |

The skill refers to the rest of this repository (`css/`, `js/`, `svelte/`, `icons/`, the catalogue pages), so install the whole repository and **link** the skill rather than copying it: a `git pull` then updates both.

## Claude Code

```bash
git clone https://github.com/ShAInyXYZ/NeuronKit.git ~/NeuronKit
mkdir -p ~/.claude/skills
ln -s ~/NeuronKit/skills/neuronkit ~/.claude/skills/neuronkit
```

For one project only, link it into the project's `.claude/skills/` instead. With the npm package installed, the skill is at `node_modules/neuronkit/skills/neuronkit`:

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/neuronkit/skills/neuronkit .claude/skills/neuronkit
```

## Codex

Link it into the folder your Codex version loads skills from, usually `~/.codex/skills/` (some versions read `~/.agents/skills/`):

```bash
mkdir -p ~/.codex/skills
ln -s ~/NeuronKit/skills/neuronkit ~/.codex/skills/neuronkit
```

[The skill page](https://shainyxyz.github.io/NeuronKit/skill.html) also has a prompt that has Codex install it itself.

## Other agents

- **Agents with rules or instruction files** (Cursor, Windsurf, Copilot…): add a rule saying "For any interface work, read `<path>/skills/neuronkit/SKILL.md` and follow it; look up classes in `reference.md` beside it."
- **Chat assistants:** attach `SKILL.md` and `reference.md` to the conversation.

## Changing the kit

After changing components, tokens or behaviours, run `python3 tools/skill-reference.py` to regenerate `reference.md`, and `python3 tools/corners.py --check`.
