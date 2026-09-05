#!/bin/bash
# hsl-gauntlet 长程看门狗：每 15 分钟
#   1) 健康检查（flock 串行化，防并发互踩）→ results/watchdog.log
#   2) 重试 git push（token 恢复则自动把两仓推上 GitHub）
cd /home/z/my-project/hsl-gauntlet
LOG=results/watchdog.log
touch $LOG
while true; do
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if flock -n /tmp/hsl-gauntlet.lock bash -c 'cd /home/z/my-project/hsl-gauntlet && bash scripts/run-all.sh' > /tmp/watchdog-run.log 2>&1; then
    summary=$(grep -E "场景套件|Edge Coverage|变异杀死率" /tmp/watchdog-run.log | tr '\n' ' ')
    echo "$ts GREEN | $summary" >> $LOG
  else
    echo "$ts RED (或与其他运行互斥跳过) — 见 /tmp/watchdog-run.log" >> $LOG
  fi
  if timeout 60 git push origin main > /tmp/watchdog-push.log 2>&1; then
    echo "$ts PUSHED hsl-gauntlet" >> $LOG
  fi
  (cd /home/z/my-project/hsl-src && timeout 60 git push origin gauntlet/host-fixture-v2 > /tmp/watchdog-push2.log 2>&1 && echo "$ts PUSHED hsl-src branch" >> /home/z/my-project/hsl-gauntlet/$LOG)
  tail -200 $LOG > $LOG.tmp && mv $LOG.tmp $LOG
  sleep 900
done
