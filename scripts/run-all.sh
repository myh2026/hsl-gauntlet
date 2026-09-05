#!/bin/bash
# hsl-gauntlet 全流水线：check 前置 + Gauntlet topo/lint/run/mutate + 报告
set -e
cd "$(dirname "$0")/.."
echo "== 0) SUT 静态检查（S/G/P/N 规则） =="
bun vendor/dhv-ts/src/main.ts check subject/vigil/vigil.hsl
echo "== 1) Gauntlet 全流水线 =="
bun gauntlet/cli.ts all
