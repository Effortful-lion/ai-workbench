# =============================================================================
# AI-WORKBENCH · Makefile
# 统一启动 / 停止 / 构建 / 数据库 / 清理 命令
# =============================================================================
# 用法：make help  查看全部命令
# =============================================================================

SHELL := /bin/zsh

# ---- 端口 ------------------------------------------------------------------
SERVER_PORT := 8700
WEB_PORT    := 8701
QDRANT_PORT := 6333

# ---- 路径 ------------------------------------------------------------------
ROOT        := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PID_DIR     := $(ROOT)/.pids
LOG_DIR     := $(ROOT)/.logs
DATA_DIR    := $(ROOT)/data
DB_FILE     := $(DATA_DIR)/workbench.db

# ---- 工具 ------------------------------------------------------------------
PNPM        := pnpm
NODE        := node
NPM         := npm

# ---- 颜色 ------------------------------------------------------------------
GREEN       := $(shell printf "\033[32m")
YELLOW      := $(shell printf "\033[33m")
RED         := $(shell printf "\033[31m")
CYAN        := $(shell printf "\033[36m")
RESET       := $(shell printf "\033[0m")

# =============================================================================
# 默认目标：help
# =============================================================================
.DEFAULT_GOAL := help

help: ## 显示全部命令
	@echo "$(CYAN)AI-WORKBENCH$(RESET) · Makefile 命令速查"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-18s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)提示$(RESET)：make 后跟目标名，如 $(CYAN)make dev$(RESET)"

# =============================================================================
# 初始化
# =============================================================================

.PHONY: init install prepare

prepare: ## 创建运行所需的目录（.pids / .logs / data）
	@mkdir -p $(PID_DIR) $(LOG_DIR) $(DATA_DIR)
	@echo "$(GREEN)✓$(RESET) 目录就绪"

install: prepare ## 安装依赖（首次 / 依赖变更后）
	@echo "$(YELLOW)→ 安装依赖...$(RESET)"
	@$(PNPM) install
	@echo "$(GREEN)✓$(RESET) 依赖安装完成"

init: install build db-push ## 一键初始化：依赖 + 构建 + 建表

# =============================================================================
# 开发模式
# =============================================================================

.PHONY: dev dev-server dev-web

dev: prepare ## 同时启动 server + web（开发模式，watch + HMR）
	@echo "$(YELLOW)→ 启动 server :$(SERVER_PORT) + web :$(WEB_PORT)$(RESET)"
	@$(PNPM) run dev

dev-server: prepare ## 仅启动 server（nest start --watch）
	@echo "$(YELLOW)→ 启动 server :$(SERVER_PORT)$(RESET)"
	@$(PNPM) run dev:server

dev-web: prepare ## 仅启动 web（vite dev）
	@echo "$(YELLOW)→ 启动 web :$(WEB_PORT)$(RESET)"
	@$(PNPM) run dev:web

# =============================================================================
# 生产模式（后台运行，写 PID + 日志）
# =============================================================================

.PHONY: start start-server start-web stop restart status

start: prepare build start-server ## 构建并后台启动 server（生产模式）

start-server: prepare
	@if [ -f $(PID_DIR)/server.pid ] && kill -0 $$(cat $(PID_DIR)/server.pid) 2>/dev/null; then \
		echo "$(YELLOW)server 已在运行 PID=$$(cat $(PID_DIR)/server.pid)$(RESET)"; \
	else \
		echo "$(YELLOW)→ 后台启动 server :$(SERVER_PORT)$(RESET)"; \
		cd $(ROOT) && nohup $(NODE) apps/server/dist/main.js \
			> $(LOG_DIR)/server.log 2>&1 & \
		echo $$! > $(PID_DIR)/server.pid; \
		sleep 2; \
		if kill -0 $$(cat $(PID_DIR)/server.pid) 2>/dev/null; then \
			echo "$(GREEN)✓$(RESET) server PID=$$(cat $(PID_DIR)/server.pid)"; \
			echo "$(CYAN)  日志：$(LOG_DIR)/server.log$(RESET)"; \
			echo "$(CYAN)  健康：curl http://localhost:$(SERVER_PORT)/api/health$(RESET)"; \
		else \
			echo "$(RED)✗$(RESET) server 启动失败，查看 $(LOG_DIR)/server.log"; \
			rm -f $(PID_DIR)/server.pid; \
			exit 1; \
		fi; \
	fi

stop: ## 停止所有后台进程
	@stopped=0; \
	for svc in server web; do \
		pidfile=$(PID_DIR)/$$svc.pid; \
		if [ -f $$pidfile ]; then \
			pid=$$(cat $$pidfile); \
			if kill -0 $$pid 2>/dev/null; then \
				kill $$pid 2>/dev/null; \
				echo "$(GREEN)✓$(RESET) 已停止 $$svc PID=$$pid"; \
				stopped=1; \
			fi; \
			rm -f $$pidfile; \
		fi; \
	done; \
	\
	# 兜底：按端口清理（PID 文件丢失时）
	for port in $(SERVER_PORT) $(WEB_PORT); do \
		pids=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			kill $$pids 2>/dev/null; \
			echo "$(YELLOW)⚠$(RESET) 端口 $$port 上仍有进程，已强制终止"; \
			stopped=1; \
		fi; \
	done; \
	\
	if [ $$stopped -eq 0 ]; then \
		echo "$(CYAN)无后台进程运行$(RESET)"; \
	fi

restart: stop start ## 重启 server（生产模式）

status: ## 查看运行状态
	@echo "$(CYAN)── 进程 ──$(RESET)"
	@for svc in server web; do \
		pidfile=$(PID_DIR)/$$svc.pid; \
		if [ -f $$pidfile ] && kill -0 $$(cat $$pidfile) 2>/dev/null; then \
			echo "  $(GREEN)●$(RESET) $$svc  PID=$$(cat $$pidfile)"; \
		else \
			echo "  $(RED)○$(RESET) $$svc  未运行"; \
		fi; \
	done
	@echo ""
	@echo "$(CYAN)── 端口 ──$(RESET)"
	@for port in $(SERVER_PORT) $(WEB_PORT) $(QDRANT_PORT); do \
		name="web"; \
		[ $$port = $(SERVER_PORT) ] && name="server"; \
		[ $$port = $(QDRANT_PORT) ] && name="qdrant"; \
		if lsof -ti :$$port >/dev/null 2>&1; then \
			echo "  $(GREEN)●$(RESET) :$$port ($$name)  占用中"; \
		else \
			echo "  $(RED)○$(RESET) :$$port ($$name)  空闲"; \
		fi; \
	done
	@echo ""
	@echo "$(CYAN)── 数据 ──$(RESET)"
	@if [ -f $(DB_FILE) ]; then \
		size=$$(du -h $(DB_FILE) | cut -f1); \
		tables=$$(sqlite3 $(DB_FILE) "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"); \
		echo "  $(GREEN)✓$(RESET) workbench.db  $$size  ($$tables tables)"; \
	else \
		echo "  $(RED)✗$(RESET) workbench.db  不存在"; \
	fi

# =============================================================================
# 构建
# =============================================================================

.PHONY: build build-shared build-server build-web rebuild clean

build: build-shared build-server build-web ## 构建全部

build-shared: ## 仅构建 shared 包
	@echo "$(YELLOW)→ 构建 shared...$(RESET)"
	@$(PNPM) --filter @aiwb/shared build

build-server: build-shared ## 仅构建 server
	@echo "$(YELLOW)→ 构建 server...$(RESET)"
	@$(PNPM) --filter @aiwb/server build

build-web: build-shared ## 仅构建 web
	@echo "$(YELLOW)→ 构建 web...$(RESET)"
	@$(PNPM) --filter @aiwb/web build

rebuild: clean build ## 清理后重新构建

clean: ## 清理构建产物 + PID
	@echo "$(YELLOW)→ 清理 dist / .pids / .logs...$(RESET)"
	@rm -rf packages/shared/dist apps/server/dist apps/web/dist $(PID_DIR) $(LOG_DIR)
	@echo "$(GREEN)✓$(RESET) 清理完成"

# =============================================================================
# 数据库
# =============================================================================

.PHONY: db-push db-reset db-seed db-console

db-push: ## 推送 schema 到 SQLite（drizzle-kit push）
	@echo "$(YELLOW)→ 推送 schema...$(RESET)"
	@$(PNPM) --filter @aiwb/server db:push
	@echo "$(GREEN)✓$(RESET) schema 已同步"

db-reset: stop ## 删除 workbench.db（⚠ 清空全部数据）
	@echo "$(RED)⚠  这将删除全部数据！$(RESET)"
	@read -p "确认？输入 yes: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		rm -f $(DB_FILE) $(DB_FILE)-wal $(DB_FILE)-shm; \
		echo "$(GREEN)✓$(RESET) 数据库已删除"; \
		echo "$(YELLOW)→ 重新启动 server 后会自动建表 + 创建 admin 种子...$(RESET)"; \
	else \
		echo "$(CYAN)已取消$(RESET)"; \
	fi

db-console: ## 打开 SQLite 交互式命令行
	@if [ -f $(DB_FILE) ]; then \
		sqlite3 $(DB_FILE); \
	else \
		echo "$(RED)✗$(RESET) $(DB_FILE) 不存在"; \
		echo "$(YELLOW)请先运行 $(CYAN)make start$(RESET) 启动 server 自动建表"; \
	fi

# =============================================================================
# 开发辅助
# =============================================================================

.PHONY: test lint typecheck log-tail

typecheck: ## 全量 TypeScript 类型检查
	@echo "$(YELLOW)→ server tsc...$(RESET)"
	@cd apps/server && npx tsc --noEmit
	@echo "$(GREEN)✓$(RESET) server OK"
	@echo "$(YELLOW)→ web tsc...$(RESET)"
	@cd apps/web && npx tsc --noEmit
	@echo "$(GREEN)✓$(RESET) web OK"

log-tail: ## 实时追踪 server 日志
	@if [ -f $(LOG_DIR)/server.log ]; then \
		tail -f $(LOG_DIR)/server.log; \
	else \
		echo "$(RED)✗$(RESET) 日志文件不存在（server 未后台运行？）"; \
	fi

# =============================================================================
# 快捷访问
# =============================================================================

.PHONY: open-web open-db open-api

open-web: ## 浏览器打开 web 开发服务器
	@echo "$(YELLOW)→ http://localhost:$(WEB_PORT)$(RESET)"
	@open http://localhost:$(WEB_PORT)

open-api: ## 浏览器打开 health 检查
	@echo "$(YELLOW)→ http://localhost:$(SERVER_PORT)/api/health$(RESET)"
	@open http://localhost:$(SERVER_PORT)/api/health

open-db: ## 用 sqlite3 列出全部表
	@if [ -f $(DB_FILE) ]; then \
		sqlite3 -header -column $(DB_FILE) ".tables"; \
		echo ""; \
		echo "$(CYAN)数据行数：$(RESET)"; \
		for t in $$(sqlite3 $(DB_FILE) ".tables"); do \
			printf "  %-22s %d\n" "$$t" $$(sqlite3 $(DB_FILE) "SELECT COUNT(*) FROM $$t;"); \
		done; \
	else \
		echo "$(RED)✗$(RESET) $(DB_FILE) 不存在"; \
	fi

# =============================================================================
# 演示数据
# =============================================================================

.PHONY: seed seed-all

# 调用后端 crm.seed / commerce.seed（需要 server 正在运行）
seed-all: ## 生成 CRM / 商业化演示数据（调用各模块 POST /seed）
	@echo "$(YELLOW)→ 生成演示数据...$(RESET)"
	@curl -s -X POST http://localhost:$(SERVER_PORT)/api/crm/seed   -H 'content-type: application/json' -d '{}' | head -c 200; echo
	@curl -s -X POST http://localhost:$(SERVER_PORT)/api/commerce/seed -H 'content-type: application/json' -d '{}' | head -c 200; echo
	@echo "$(GREEN)✓$(RESET) 演示数据已生成"
