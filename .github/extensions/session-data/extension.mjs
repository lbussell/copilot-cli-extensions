import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function openInVsCode(path) {
    if (process.platform === "win32") {
        return await execFileAsync("cmd.exe", ["/c", "code", path]);
    }

    return await execFileAsync("code", [path]);
}

async function openSessionData(session) {
    const sessionDataPath = session.workspacePath;

    if (!sessionDataPath) {
        await session.log("Current session data directory is not available.", { level: "warning" });
        return;
    }

    try {
        await openInVsCode(sessionDataPath);
        await session.log(`Opened session data directory in VS Code:\n\n\`\`\`text\n${sessionDataPath}\n\`\`\``);
    } catch (error) {
        await session.log(`Unable to open session data directory in VS Code: ${error instanceof Error ? error.message : String(error)}`, {
            level: "error",
        });
    }
}

const session = await joinSession({
    commands: [
        {
            name: "session-data",
            description: "Open the current session data directory in VS Code.",
            handler: async () => {
                await openSessionData(session);
            },
        },
    ],
});
