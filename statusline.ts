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
};

const input = await Bun.stdin.text();
const data = JSON.parse(input);
const percent = Math.floor(data.context_window?.used_percentage || 0);
const cwd = data.cwd ?? data.workspace?.current_dir ?? process.cwd();
const width = await terminalWidth();
const bar = progressBar(percent, 10);
const left = await gitStatus(cwd);
const right = `${percent}% ${bar}`;

console.log(layoutStatusline(left, right, width, 1));

async function terminalWidth() {
  const envColumns = Number(process.env.COLUMNS);
  const columns = await ttyWidth() ?? process.stderr.columns ?? process.stdout.columns ?? envColumns;

  return Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
}

async function ttyWidth() {
  const output = await $`/bin/sh -c ${'stty size < /dev/tty'}`.quiet().nothrow().text();
  const [, columns] = output.trim().split(/\s+/).map(Number);
  return columns;
}

function visibleLength(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function layoutStatusline(left: string, right: string, width: number, padding: number) {
  const outerPadding = Math.max(0, Math.floor(padding));
  const leftPadding = ' '.repeat(outerPadding);
  const rightPadding = ' '.repeat(outerPadding);
  const spaces = ' '.repeat(Math.max(
    1,
    width - outerPadding * 2 - visibleLength(left) - visibleLength(right),
  ));

  return `${leftPadding}${left}${spaces}${right}${rightPadding}`;
}

async function gitStatus(cwd: string) {
  const [branch, upstream, counts, pullRequest] = await Promise.all([
    gitBranch(cwd),
    gitUpstream(cwd),
    gitCounts(cwd),
    pullRequestNumber(cwd),
  ]);
  const branchText = styled(branch, ansi.bold, ansi.cyan);
  const upstreamText = upstream ? styled(`→ ${upstream}`, ansi.dim) : '';
  const pullRequestText = pullRequest ? styled(`#${pullRequest}`, ansi.bold, ansi.magenta) : '';
  const metrics = [
    styledMetric(`↑${counts.ahead}`, counts.ahead, ansi.green),
    styledMetric(`↓${counts.behind}`, counts.behind, ansi.red),
    styledMetric(`U${counts.untracked}`, counts.untracked, ansi.yellow),
    styledMetric(`+${counts.additions}`, counts.additions, ansi.green),
    styledMetric(`-${counts.deletions}`, counts.deletions, ansi.red),
  ].filter(Boolean);

  return [branchText, upstreamText, pullRequestText, ...metrics].filter(Boolean).join(' ');
}

function styled(value: string, ...styles: string[]) {
  return `${styles.join('')}${value}${ansi.reset}`;
}

function styledMetric(value: string, count: number, color: string) {
  return count ? styled(value, color) : '';
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

async function pullRequestNumber(cwd: string) {
  return shellText($`gh pr view --json number --jq .number`.cwd(cwd));
}

async function shellText(command: ReturnType<typeof $>) {
  return (await shellOutput(command)).trim();
}

async function shellOutput(command: ReturnType<typeof $>) {
  return command.quiet().nothrow().text();
}

function progressBar(percent: number, width: number) {
  const partialBlocks = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const emptyBackground = '\x1b[48;5;238m';
  const visibleWidth = Math.max(0, Math.floor(width));
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const totalEighths = Math.round(clampedPercent * visibleWidth * 8 / 100);
  const filled = Math.floor(totalEighths / 8);
  const partialBlock = partialBlocks[totalEighths % 8];
  const cells = Array.from({ length: visibleWidth }, (_, index) => {
    if (index < filled) {
      return '█';
    }

    if (index === filled && partialBlock) {
      return partialBlock;
    }

    return ' ';
  });

  return cells.length ? `${emptyBackground}${cells.join('')}${ansi.reset}` : '';
}
