#!/bin/bash
# hsl-gauntlet 长程看门狗：每 15 分钟
#   1) 健康检查（run-all 全流水线）→ results/watchdog.log
#   2) 重试 git push（token 恢复则自动把两仓推上 GitHub）
cd /home/z/my-project/hsl-gauntlet
LOG=results/watchdog.log
while true; do
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if bash scripts/run-all.sh > /tmp/watchdog-run.log 2>&1; then
    summary=$(rg "场景套件|Edge Coverage|变异杀死率" /tmp/watchdog-run.log | tr '\n' ' ')
    echo "$ts GREEN | $summary" >> $LOG
  else
    echo "$ts RED — 见 /tmp/watchdog-run.log" >> $LOG
  fi
  # push 重试（token 失效时会静默失败）
  if timeout 60 git push origin main > /tmp/watchdog-push.log 2>&1; then
    echo "$ts PUSHED hsl-gauntlet" >> $LOG
  fi
  (cd /home/z/my-project/hsl-src && timeout 60 git push origin gauntlet/host-fixture-v2 > /tmp/watchdog-push2.log 2>&1 && echo "$ts PUSHED hsl-src branch" >> /home/z/my-project/hsl-gauntlet/$LOG)
  # 日志封顶（保留最近 200 行）
  tail -200 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
  sleep 900
done
