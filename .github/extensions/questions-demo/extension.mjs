import { joinSession } from "@github/copilot-sdk/extension";

function formatResult(value) {
    return JSON.stringify(value, null, 2);
}

async function runQuestionsDemo(session) {
    if (!session.capabilities.ui?.elicitation) {
        await session.log("This Copilot CLI host does not support extension UI questions.", { level: "warning" });
        return;
    }

    const shouldContinue = await session.ui.confirm("Run the extension questions demo?");

    if (!shouldContinue) {
        await session.log("Questions demo cancelled.");
        return;
    }

    const target = await session.ui.select("Pick a demo target", ["local", "staging", "production"]);
    const branch = await session.ui.input("Enter a branch name", {
        title: "Branch",
        description: "This value stays inside the extension unless the extension explicitly sends it elsewhere.",
        default: "main",
    });
    const form = await session.ui.elicitation({
        message: "Fill out a structured extension form",
        requestedSchema: {
            type: "object",
            properties: {
                changeType: {
                    type: "string",
                    title: "Change type",
                    description: "What kind of change are you demonstrating?",
                    enum: ["bugfix", "feature", "docs"],
                    default: "feature",
                },
                runChecks: {
                    type: "boolean",
                    title: "Run checks?",
                    description: "Boolean fields render as yes/no choices.",
                    default: true,
                },
            },
            required: ["changeType"],
        },
    });

    await session.log(
        [
            "**Questions demo result**",
            "",
            "```json",
            formatResult({
                target,
                branch,
                form,
            }),
            "```",
        ].join("\n"),
    );
}

const session = await joinSession({
    commands: [
        {
            name: "questions-demo",
            description: "Demonstrate extension prompts with confirm, select, input, and form dialogs.",
            handler: async () => {
                await runQuestionsDemo(session);
            },
        },
    ],
});
