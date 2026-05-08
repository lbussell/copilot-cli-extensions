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
            timeout: 10_000,
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

function codeBlock(text) {
    const longestBacktickRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(longestBacktickRun + 1);
    const output = text.endsWith("\n") ? text : `${text}\n`;

    return `${fence}text\n${output}${fence}`;
}

async function showGitStatus(session) {
    const status = await runGit(["--no-advice", "status"]);

    if (!status.ok) {
        await session.log((status.stderr || status.message).trim(), { level: "error" });
        return;
    }

    await session.log(codeBlock(status.stdout));
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
            name: "status",
            description: "Show git status information in the timeline.",
            handler: async () => {
                await showGitStatus(session);
            },
        },
    ],
});

session.on("session.context_changed", (event) => {
    rememberCwd(event.data);
});
