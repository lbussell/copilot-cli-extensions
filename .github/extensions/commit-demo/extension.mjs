import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let currentCwd = process.cwd();

function rememberCwd(input) {
    if (typeof input?.cwd === "string" && input.cwd.length > 0) {
        currentCwd = input.cwd;
    }
}

async function runGit(args) {
    try {
        const result = await execFileAsync("git", ["-C", currentCwd, ...args], {
            maxBuffer: 1024 * 1024,
            timeout: 120_000,
        });

        return {
            ok: true,
            stdout: result.stdout,
            stderr: result.stderr,
        };
    } catch (error) {
        return {
            ok: false,
            stdout: typeof error?.stdout === "string" ? error.stdout : "",
            stderr: typeof error?.stderr === "string" ? error.stderr : "",
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

function parseStatus(status) {
    const lines = status.split("\n").filter(Boolean);

    return {
        hasChanges: lines.length > 0,
        hasStagedChanges: lines.some((line) => line[0] !== " " && line[0] !== "?"),
        hasUnstagedOrUntrackedChanges: lines.some((line) => line.startsWith("??") || line[1] !== " "),
    };
}

function commandOutput(result) {
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function codeBlock(text) {
    const longestBacktickRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(longestBacktickRun + 1);
    const output = text.endsWith("\n") ? text : `${text}\n`;

    return `${fence}text\n${output}${fence}`;
}

async function getStatus() {
    return await runGit(["--no-advice", "status", "--porcelain=v1", "--untracked-files=all"]);
}

async function showGitStatus(session) {
    const status = await runGit(["--no-advice", "status"]);

    if (!status.ok) {
        await session.log((status.stderr || status.message).trim(), { level: "error" });
        return false;
    }

    await session.log(codeBlock(status.stdout));
    return true;
}

async function ensureRepository(session) {
    const root = await runGit(["rev-parse", "--show-toplevel"]);

    if (!root.ok) {
        await session.log(`Not a git repository: ${currentCwd}`, { level: "warning" });
        return false;
    }

    return true;
}

async function askForCommitMessage(session) {
    const message = await session.ui.input("Enter the commit message", {
        title: "Commit message",
        description: "This will be passed to git commit with -m.",
        minLength: 1,
    });

    const trimmed = message?.trim();

    if (!trimmed) {
        await session.log("Commit cancelled: no commit message provided.");
        return null;
    }

    return trimmed;
}

async function maybeStageAllChanges(session, statusText) {
    const status = parseStatus(statusText);

    if (!status.hasChanges) {
        await session.log("Nothing to commit.");
        return false;
    }

    if (!status.hasUnstagedOrUntrackedChanges) {
        return status.hasStagedChanges;
    }

    const stageAll = await session.ui.confirm("There are unstaged or untracked files. Stage and commit all changes?");

    if (!stageAll) {
        if (status.hasStagedChanges) {
            await session.log("Continuing with currently staged changes only.");
            return true;
        }

        await session.log("Commit cancelled: no staged changes to commit.");
        return false;
    }

    const add = await runGit(["add", "-A"]);

    if (!add.ok) {
        await session.log(`Unable to stage changes: ${commandOutput(add) || add.message}`, { level: "error" });
        return false;
    }

    const refreshedStatus = await getStatus();

    if (!refreshedStatus.ok) {
        await session.log(`Unable to inspect staged changes: ${commandOutput(refreshedStatus) || refreshedStatus.message}`, { level: "error" });
        return false;
    }

    if (!parseStatus(refreshedStatus.stdout).hasStagedChanges) {
        await session.log("Nothing to commit after staging changes.");
        return false;
    }

    return true;
}

async function commitChanges(session) {
    if (!session.capabilities.ui?.elicitation) {
        await session.log("This Copilot CLI host does not support extension UI questions.", { level: "warning" });
        return;
    }

    if (!(await ensureRepository(session))) {
        return;
    }

    if (!(await showGitStatus(session))) {
        return;
    }

    const message = await askForCommitMessage(session);

    if (!message) {
        return;
    }

    const status = await getStatus();

    if (!status.ok) {
        await session.log(`Unable to read git status: ${commandOutput(status) || status.message}`, { level: "error" });
        return;
    }

    const shouldCommit = await maybeStageAllChanges(session, status.stdout);

    if (!shouldCommit) {
        return;
    }

    const commit = await runGit(["commit", "-m", message]);

    if (!commit.ok) {
        await session.log(`Commit failed: ${commandOutput(commit) || commit.message}`, { level: "error" });
        return;
    }

    await session.log(`Committed changes:\n\n\`\`\`text\n${commandOutput(commit)}\n\`\`\``);
}

const session = await joinSession({
    hooks: {
        onSessionStart: rememberCwd,
        onUserPromptSubmitted: rememberCwd,
        onPreToolUse: rememberCwd,
        onPostToolUse: rememberCwd,
        onErrorOccurred: rememberCwd,
    },
    commands: [
        {
            name: "commit-demo",
            description: "Ask for a commit message, optionally stage all changes, and commit.",
            handler: async () => {
                await commitChanges(session);
            },
        },
    ],
});

session.on("session.context_changed", (event) => {
    rememberCwd(event.data);
});
