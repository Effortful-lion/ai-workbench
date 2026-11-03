#!/usr/bin/env bash
# AI Workbench 后端守护脚本（macOS/Linux）
#   ./scripts/server.sh start    # 幂等启动
#   ./scripts/server.sh stop     # 优雅关闭 → 强杀
#   ./scripts/server.sh restart  # stop + start
#   ./scripts/server.sh status   # 端口 + PID 双通道判活
#   ./scripts/server.sh logs     # tail -f 日志
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/server"
PORT="${PORT:-8700}"
PID_DIR="$ROOT/.run"
PID_FILE="$PID_DIR/server.pid"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/server.log"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── 工具 ──

pick_port_pid() {
  # lsof 在 macOS/Linux 通用，优先取 LISTEN 状态
  lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -1 || true
}

pick_pid_file_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  # 进程是否真的存在
  kill -0 "$pid" 2>/dev/null && echo "$pid" || return 1
}

is_up() {
  curl -sf "$HEALTH_URL" >/dev/null 2>&1
}

wait_for_up() {
  local deadline=$(( SECONDS + 30 ))
  while (( SECONDS < deadline )); do
    if is_up; then return 0; fi
    sleep 1
  done
  return 1
}

# ── 子命令 ──

cmd_start() {
  # 1) 已在跑（health 通）→ 直接返回
  if is_up; then
    local pid
    pid="$(pick_port_pid || true)"
    echo "▶ 后端已在运行  pid=${pid:-"-"}  port=${PORT}"
    [[ -n "$pid" ]] && echo "$pid" > "$PID_FILE"
    return 0
  fi
  # 2) PID 文件残留但端口没监听 → 清理
  if local stale_pid; stale_pid="$(pick_pid_file_pid)" && [[ -n "$stale_pid" ]]; then
    echo "⚠ PID 文件残留（port 未监听），清理 pid=${stale_pid}"
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"

  # 3) 启动
  echo "▶ 启动后端  port=${PORT}"
  cd "$APP"
  nohup node dist/main.js >> "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  disown "$pid" 2>/dev/null || true

  # 4) 等 health
  if wait_for_up; then
    echo "✓ 后端就绪  pid=${pid}  port=${PORT}  log=${LOG_FILE}"
    return 0
  fi

  echo "✗ 启动超时，最后 15 行日志："
  tail -n 15 "$LOG_FILE" || true
  rm -f "$PID_FILE"
  return 1
}

cmd_stop() {
  local pid=""
  pid="$(pick_port_pid || true)"
  [[ -z "$pid" ]] && pid="$(pick_pid_file_pid || true)"

  if [[ -z "$pid" ]]; then
    echo "▶ 后端未在运行"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "▶ 停止后端  pid=${pid}"
  kill -TERM "$pid" 2>/dev/null || true
  local deadline=$(( SECONDS + 10 ))
  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "⚠ 优雅关闭超时，强杀"
    kill -KILL "$pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
  echo "✓ 已停止"
}

cmd_status() {
  local port_pid=""
  port_pid="$(pick_port_pid || true)"
  local file_pid=""
  file_pid="$(pick_pid_file_pid || true)"

  echo "port  ${PORT}  pid_by_lsof=${port_pid:-"-"}  pid_by_file=${file_pid:-"-"}"
  if is_up; then
    echo "✓ health OK"
  elif [[ -n "$port_pid" || -n "$file_pid" ]]; then
    echo "⚠ 进程存在但 health 未通过"
  else
    echo "✗ 后端未在运行"
  fi
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "✗ 日志不存在：$LOG_FILE（后端可能未启动）"
    return 1
  fi
  tail -n 50 -f "$LOG_FILE"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
