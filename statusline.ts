#!/usr/bin/env bun
import { $ } from "bun";

const input = await Bun.stdin.text();
const data = JSON.parse(input);
const model = data.model.display_name;
const percent = Math.floor(data.context_window?.used_percentage || 0);
const width = terminalWidth();
const bar = progressBar(percent, 10);
const left = `[${model}]`;
const right = `${percent}% ${bar} `;

console.log(layoutStatusline(left, right, width));
console.log(`terminal width: ${width}`);

function terminalWidth() {
  const envColumns = Number(process.env.COLUMNS);
  const columns = ttyWidth() ?? process.stderr.columns ?? process.stdout.columns ?? envColumns;

  return Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
}

function ttyWidth() {
  const result = Bun.spawnSync({
    cmd: ['/bin/sh', '-c', 'stty size < /dev/tty 2>/dev/null'],
    stdout: 'pipe',
    stderr: 'ignore',
  });

  if (!result.success) {
    return undefined;
  }

  const [, columns] = new TextDecoder().decode(result.stdout).trim().split(/\s+/).map(Number);
  return columns;
}

function visibleLength(value: string) {
  return value.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function layoutStatusline(left: string, right: string, width: number) {
  const spaces = ' '.repeat(Math.max(
    1,
    width - visibleLength(left) - visibleLength(right),
  ));

  return `${left}${spaces}${right}`;
}

function progressBar(percent: number, width: number) {
  const partialBlocks = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const emptyBackground = '\x1b[48;5;238m';
  const reset = '\x1b[0m';
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

  return cells.length ? `${emptyBackground}${cells.join('')}${reset}` : '';
}
