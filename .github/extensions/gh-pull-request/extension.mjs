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

function codeBlock(text) {
    const longestBacktickRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(longestBacktickRun + 1);
    const output = text.endsWith("\n") ? text : `${text}\n`;

    return `${fence}text\n${output}${fence}`;
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeList(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeString).filter(Boolean);
    }

    if (typeof value !== "string") {
        return [];
    }

    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function joinList(value) {
    return normalizeList(value).join(", ");
}

function parseBoolean(value, defaultValue) {
    return typeof value === "boolean" ? value : defaultValue;
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

function toInitialPullRequestDetails(args) {
    return {
        title: normalizeString(args?.title),
        body: normalizeString(args?.body),
        baseBranch: normalizeString(args?.baseBranch),
        headBranch: normalizeString(args?.headBranch),
        draft: parseBoolean(args?.draft, false),
        maintainerCanModify: parseBoolean(args?.maintainerCanModify, true),
        reviewers: joinList(args?.reviewers),
        assignees: joinList(args?.assignees),
        labels: joinList(args?.labels),
    };
}

async function reviewPullRequestDetails(session, details) {
    if (!session.capabilities.ui?.elicitation) {
        await session.log("This Copilot CLI host does not support extension UI forms.", { level: "warning" });
        return { action: "cancel" };
    }

    return await session.ui.elicitation({
        message: "Review and edit the pull request details before submitting",
        requestedSchema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    title: "Title",
                    description: "Pull request title.",
                    minLength: 1,
                    default: details.title,
                },
                body: {
                    type: "string",
                    title: "Body",
                    description: "Pull request description.",
                    minLength: 1,
                    default: details.body,
                },
                baseBranch: {
                    type: "string",
                    title: "Base branch",
                    description: "Branch the pull request should merge into.",
                    minLength: 1,
                    default: details.baseBranch,
                },
                headBranch: {
                    type: "string",
                    title: "Head branch",
                    description: "Source branch for the pull request. Leave blank to use the current branch.",
                    default: details.headBranch,
                },
                draft: {
                    type: "boolean",
                    title: "Create as draft",
                    default: details.draft,
                },
                maintainerCanModify: {
                    type: "boolean",
                    title: "Allow maintainer edits",
                    default: details.maintainerCanModify,
                },
                reviewers: {
                    type: "string",
                    title: "Reviewers",
                    description: "Comma-separated GitHub usernames or teams.",
                    default: details.reviewers,
                },
                assignees: {
                    type: "string",
                    title: "Assignees",
                    description: "Comma-separated GitHub usernames.",
                    default: details.assignees,
                },
                labels: {
                    type: "string",
                    title: "Labels",
                    description: "Comma-separated label names.",
                    default: details.labels,
                },
            },
            required: ["title", "body", "baseBranch"],
        },
    });
}

function toReviewedDetails(content) {
    return {
        title: normalizeString(content?.title),
        body: normalizeString(content?.body),
        baseBranch: normalizeString(content?.baseBranch),
        headBranch: normalizeString(content?.headBranch),
        draft: parseBoolean(content?.draft, false),
        maintainerCanModify: parseBoolean(content?.maintainerCanModify, true),
        reviewers: normalizeList(content?.reviewers),
        assignees: normalizeList(content?.assignees),
        labels: normalizeList(content?.labels),
    };
}

function buildGhPrCreateArgs(details) {
    const args = ["pr", "create", "--title", details.title, "--body", details.body, "--base", details.baseBranch];

    if (details.headBranch) {
        args.push("--head", details.headBranch);
    }

    if (details.draft) {
        args.push("--draft");
    }

    if (!details.maintainerCanModify) {
        args.push("--no-maintainer-edit");
    }

    for (const reviewer of details.reviewers) {
        args.push("--reviewer", reviewer);
    }

    for (const assignee of details.assignees) {
        args.push("--assignee", assignee);
    }

    for (const label of details.labels) {
        args.push("--label", label);
    }

    return args;
}

async function createPullRequest(args) {
    const initialDetails = toInitialPullRequestDetails(args);
    const review = await reviewPullRequestDetails(session, initialDetails);

    if (review.action !== "accept") {
        return {
            resultType: "rejected",
            textResultForLlm: "The user cancelled pull request creation.",
        };
    }

    const details = toReviewedDetails(review.content);
    const result = await runGh(buildGhPrCreateArgs(details));
    const output = commandOutput(result);

    if (!result.ok) {
        await session.log(`Pull request creation failed:\n\n${codeBlock(output || result.message)}`, { level: "error" });
        return {
            resultType: "failure",
            textResultForLlm: `Pull request creation failed: ${output || result.message}`,
        };
    }

    await session.log(`Created pull request:\n\n${codeBlock(output)}`);

    return {
        resultType: "success",
        textResultForLlm: `Created pull request:\n${output}`,
    };
}

async function requestPullRequestCreation(session) {
    await session.send({
        prompt: "Call the `create-pull-request` tool to create a pull request.",
    });
}

const session = await joinSession({
    hooks: {
        onSessionStart: rememberCwd,
        onUserPromptSubmitted: rememberCwd,
        onPreToolUse: rememberCwd,
        onPostToolUse: rememberCwd,
        onErrorOccurred: rememberCwd,
    },
    tools: [
        {
            name: "create-pull-request",
            description: "Create a GitHub pull request with gh after the user reviews and edits the proposed details in a form.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "Pull request title.",
                    },
                    body: {
                        type: "string",
                        description: "Pull request body/description.",
                    },
                    baseBranch: {
                        type: "string",
                        description: "Branch the pull request should merge into.",
                    },
                    headBranch: {
                        type: "string",
                        description: "Source branch for the pull request. Omit to use the current branch.",
                    },
                    draft: {
                        type: "boolean",
                        description: "Whether to create the pull request as a draft.",
                    },
                    maintainerCanModify: {
                        type: "boolean",
                        description: "Whether maintainers can edit the head branch.",
                    },
                    reviewers: {
                        type: "array",
                        description: "GitHub usernames or teams to request as reviewers.",
                        items: { type: "string" },
                    },
                    assignees: {
                        type: "array",
                        description: "GitHub usernames to assign.",
                        items: { type: "string" },
                    },
                    labels: {
                        type: "array",
                        description: "Labels to apply to the pull request.",
                        items: { type: "string" },
                    },
                },
                required: ["title", "body", "baseBranch"],
            },
            handler: createPullRequest,
        },
    ],
    commands: [
        {
            name: "gh-pull-request",
            description: "Ask Copilot to call create-pull-request for the current branch.",
            handler: async () => {
                await requestPullRequestCreation(session);
            },
        },
    ],
});

session.on("session.context_changed", (event) => {
    rememberCwd(event.data);
});
