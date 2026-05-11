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
const contextUsage = contextStatus(percent);
const left = await gitStatus(cwd);
const github = await githubStatus(cwd);

console.log(statusLine([contextUsage, left]));
if (github) {
  console.log(statusLine([github]));
}

async function gitStatus(cwd: string) {
  const [branch, upstream, counts] = await Promise.all([
    gitBranch(cwd),
    gitUpstream(cwd),
    gitCounts(cwd),
  ]);
  const label = styled('git', ansi.dim);
  const branchText = styled(branch, ansi.bold, ansi.cyan);
  const upstreamText = upstream ? `${styled('→', ansi.dim)} ${styled(remoteName(upstream), ansi.dim)}` : '';
  const metrics = [
    styledMetric(`↑${counts.ahead}`, counts.ahead, ansi.yellow),
    styledMetric(`↓${counts.behind}`, counts.behind, ansi.yellow),
    styledMetric(`U${counts.untracked}`, counts.untracked, ansi.green),
    styledMetric(`+${counts.additions}`, counts.additions, ansi.green),
    styledMetric(`-${counts.deletions}`, counts.deletions, ansi.red),
  ].filter(Boolean);
  const changesText = metrics.length ? `${styled('Δ', ansi.dim)} ${metrics.join(' ')}` : '';

  return [label, branchText, upstreamText, changesText].filter(Boolean).join(' ');
}

function statusLine(segments: string[]) {
  return segments.filter(Boolean).join(styled(' │ ', ansi.dim));
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

  const state = pullRequestState(pullRequest);

  return [
    styled(repo, ansi.dim),
    styled(`#${pullRequest.number}`, ansi.bold, pullRequestColor(pullRequest)),
    state,
    pullRequest.title,
  ].filter(Boolean).join(' ');
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

function pullRequestState(pullRequest: { state: string; isDraft: boolean }) {
  if (pullRequest.isDraft) {
    return styled('draft', ansi.yellow);
  }

  switch (pullRequest.state) {
    case 'MERGED':
      return styled('merged', ansi.magenta);
    case 'CLOSED':
      return styled('closed', ansi.red);
    default:
      return '';
  }
}

async function shellText(command: ReturnType<typeof $>) {
  return (await shellOutput(command)).trim();
}

async function shellOutput(command: ReturnType<typeof $>) {
  return command.quiet().nothrow().text();
}

function contextStatus(percent: number) {
  const clampedPercent = clampPercent(percent);

  return `${progressBar(clampedPercent, 19)}`;
}

function progressBar(percent: number, width: number) {
  const partialBlocks = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const percentText = `${percent}%`;
  const visibleWidth = Math.max(percentText.length, Math.floor(width));
  const totalEighths = Math.round(percent * visibleWidth * 8 / 100);
  const filled = Math.floor(totalEighths / 8);
  const partialBlock = partialBlocks[totalEighths % 8];
  const color = progressBarColor(percent);
  const cells = Array.from({ length: visibleWidth }, (_, index) => {
    if (index < filled) {
      return '█';
    }

    if (index === filled && partialBlock) {
      return partialBlock;
    }

    return '·';
  });
  const percentStart = Math.floor((visibleWidth - percentText.length) / 2);
  const beforeText = cells.slice(0, percentStart).join('');
  const afterText = cells.slice(percentStart + percentText.length).join('');

  return cells.length
    ? `[${styled(beforeText, color)}${styled(percentText, ansi.bold)}${styled(afterText, color)}]`
    : '[]';
}

function clampPercent(percent: number) {
  return Math.max(0, Math.min(100, percent));
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
