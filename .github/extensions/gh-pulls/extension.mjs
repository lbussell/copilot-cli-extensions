import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = "50";

let currentCwd = process.cwd();

function rememberCwd(input) {
    if (typeof input?.cwd === "string" && input.cwd.length > 0) {
        currentCwd = input.cwd;
    }
}

async function runGh(args) {
    try {
        const result = await execFileAsync("gh", args, {
            cwd: currentCwd,
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

function commandOutput(result) {
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function codeBlock(text) {
    const longestBacktickRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(longestBacktickRun + 1);
    const output = text.endsWith("\n") ? text : `${text}\n`;

    return `${fence}text\n${output}${fence}`;
}

function buildPrListArgs(searchFilters) {
    const args = ["pr", "list", "--state", "open", "--limit", DEFAULT_LIMIT];

    if (searchFilters) {
        args.push("--search", searchFilters);
    }

    return args;
}

async function listOpenPullRequests(session, context) {
    const searchFilters = context.args.trim();
    const result = await runGh(buildPrListArgs(searchFilters));
    const output = commandOutput(result);

    if (!result.ok) {
        await session.log(`Unable to list pull requests: ${output || result.message}`, { level: "error" });
        return;
    }

    const heading = searchFilters
        ? `Open pull requests matching \`${searchFilters}\`:`
        : "Open pull requests:";

    await session.log(output ? `${heading}\n\n${codeBlock(output)}` : `${heading}\n\nNo open pull requests found.`);
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
            name: "gh-pulls",
            description: "List open pull requests. Pass GitHub search filters as arguments, for example: author:@me label:bug.",
            handler: async (context) => {
                await listOpenPullRequests(session, context);
            },
        },
    ],
});

session.on("session.context_changed", (event) => {
    rememberCwd(event.data);
});
