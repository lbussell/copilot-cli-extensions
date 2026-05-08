#!/usr/bin/env bun
import { $ } from "bun";

const input = await Bun.stdin.text();
const data = JSON.parse(input);
const model = data.model.display_name;
const pct = Math.floor(data.context_window?.used_percentage || 0);
const filled = Math.floor(pct * 10 / 100);
const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);

console.log(`[${model}] ${bar} ${pct}%`);
