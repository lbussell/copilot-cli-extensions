# Copilot CLI Extensions

Small collection of GitHub Copilot CLI extensions and helpers.

## Contents

- `.github/extensions/git-status` - adds a `/status` command that prints `git status`.
- `.github/extensions/git-commit` - adds a `/git-commit` command for staging and committing changes.
- `.github/extensions/gh-pull-request` - adds a `/gh-pull-request` command for creating pull requests with `gh`.
- `.github/extensions/session-data` - adds a `/session-data` command to open the current session data directory in VS Code.
- `.github/extensions/questions-demo` - demonstrates extension UI prompts and forms.
- `statusline.ts` - Bun script for a Git/GitHub-aware Copilot CLI statusline.

## Requirements

- GitHub Copilot CLI
- `git` and `gh` for GitHub-related commands
- Bun for `statusline.ts`

## Usage

Copilot CLI loads project extensions from `.github/extensions/`. See the [Copilot CLI extensions documentation](https://unpkg.com/@github/copilot-sdk@latest/docs/extensions.md) for discovery and authoring details.

`statusline.ts` is intended to be configured as a Copilot CLI status line script, not run standalone. See the [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#slash-commands-in-the-interactive-interface) for `/statusline`.
