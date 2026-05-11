#!/usr/bin/env bun
import { $ } from "bun";

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const input = await Bun.stdin.text();
const data = JSON.parse(input);
const percent = Math.floor(
  data.context_window?.current_context_used_percentage
  ?? data.context_window?.used_percentage
  ?? 0,
);
const cwd = data.cwd ?? data.workspace?.current_dir ?? process.cwd();
const contextUsage = progressBar(percent, 17);
const left = await gitStatus(cwd);
const github = await githubStatus(cwd);

console.log([contextUsage, left].filter(Boolean).join(' '));
if (github) {
  console.log(github);
}

async function gitStatus(cwd: string) {
  const [branch, upstream, counts] = await Promise.all([
    gitBranch(cwd),
    gitUpstream(cwd),
    gitCounts(cwd),
  ]);
  const branchText = styled(branch, ansi.bold, ansi.cyan);
  const upstreamText = upstream ? styled(`→ ${remoteName(upstream)}`, ansi.dim) : '';
  const metrics = [
    styledMetric(`↑${counts.ahead}`, counts.ahead, ansi.yellow),
    styledMetric(`↓${counts.behind}`, counts.behind, ansi.yellow),
    styledMetric(`U${counts.untracked}`, counts.untracked, ansi.green),
    styledMetric(`+${counts.additions}`, counts.additions, ansi.green),
    styledMetric(`-${counts.deletions}`, counts.deletions, ansi.red),
  ].filter(Boolean);

  return [branchText, upstreamText, ...metrics].filter(Boolean).join(' ');
}

function styled(value: string, ...styles: string[]) {
  return `${styles.join('')}${value}${ansi.reset}`;
}

function styledMetric(value: string, count: number, color: string) {
  return count ? styled(value, color) : '';
}

function remoteName(upstream: string) {
  return upstream.split('/', 1)[0];
}

async function gitBranch(cwd: string) {
  const branch = await shellText($`git -C ${cwd} branch --show-current`);
  if (branch) {
    return branch;
  }

  const sha = await shellText($`git -C ${cwd} rev-parse --short HEAD`);
  return sha ? `detached:${sha}` : 'no git';
}

async function gitUpstream(cwd: string) {
  return shellText($`git -C ${cwd} rev-parse --abbrev-ref --symbolic-full-name @{upstream}`);
}

async function gitCounts(cwd: string) {
  const upstream = await gitUpstream(cwd);
  const [aheadBehind, status, stagedDiff, unstagedDiff] = await Promise.all([
    upstream ? shellText($`git -C ${cwd} rev-list --left-right --count ${upstream}...HEAD`) : '',
    shellOutput($`git -C ${cwd} status --porcelain`),
    shellOutput($`git -C ${cwd} diff --numstat --cached`),
    shellOutput($`git -C ${cwd} diff --numstat`),
  ]);
  const [behind = 0, ahead = 0] = aheadBehind.split(/\s+/).map(Number);
  const untracked = status.split('\n').filter((line) => line.startsWith('??')).length;
  const { additions, deletions } = diffStats(`${stagedDiff}\n${unstagedDiff}`);

  return { ahead, behind, untracked, additions, deletions };
}

function diffStats(output: string) {
  return output.split('\n').reduce(
    (totals, line) => {
      const [additions, deletions] = line.split(/\s+/, 2).map((value) => Number(value));

      return {
        additions: totals.additions + (Number.isFinite(additions) ? additions : 0),
        deletions: totals.deletions + (Number.isFinite(deletions) ? deletions : 0),
      };
    },
    { additions: 0, deletions: 0 },
  );
}

async function currentPullRequest(cwd: string) {
  const output = await shellText($`gh pr view --json number,title,state,isDraft`.cwd(cwd));
  if (!output) {
    return undefined;
  }

  return JSON.parse(output) as { number: number; title: string; state: string; isDraft: boolean };
}

async function githubStatus(cwd: string) {
  const [repo, pullRequest] = await Promise.all([
    shellText($`gh repo view --json nameWithOwner --jq .nameWithOwner`.cwd(cwd)),
    currentPullRequest(cwd),
  ]);

  if (!repo || !pullRequest) {
    return undefined;
  }

  return `${styled(`#${pullRequest.number}`, ansi.bold, pullRequestColor(pullRequest))} ${pullRequest.title}`;
}

function pullRequestColor(pullRequest: { state: string; isDraft: boolean }) {
  if (pullRequest.isDraft) {
    return ansi.gray;
  }

  switch (pullRequest.state) {
    case 'MERGED':
      return ansi.magenta;
    case 'CLOSED':
      return ansi.red;
    default:
      return ansi.green;
  }
}

async function shellText(command: ReturnType<typeof $>) {
  return (await shellOutput(command)).trim();
}

async function shellOutput(command: ReturnType<typeof $>) {
  return command.quiet().nothrow().text();
}

function progressBar(percent: number, width: number) {
  const partialBlocks = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const percentText = `${percent}%`;
  const visibleWidth = Math.max(percentText.length, Math.floor(width));
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const totalEighths = Math.round(clampedPercent * visibleWidth * 8 / 100);
  const filled = Math.floor(totalEighths / 8);
  const partialBlock = partialBlocks[totalEighths % 8];
  const color = progressBarColor(clampedPercent);
  const cells = Array.from({ length: visibleWidth }, (_, index) => {
    if (index < filled) {
      return '█';
    }

    if (index === filled && partialBlock) {
      return partialBlock;
    }

    return ' ';
  });
  const percentStart = Math.floor((visibleWidth - percentText.length) / 2);
  cells.splice(percentStart, percentText.length, ...percentText);

  return cells.length ? `[${styled(cells.join(''), color)}]` : '[]';
}

function progressBarColor(percent: number) {
  if (percent > 70) {
    return ansi.red;
  }

  if (percent > 50) {
    return ansi.yellow;
  }

  return ansi.dim;
}
