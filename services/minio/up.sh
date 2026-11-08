#!/usr/bin/env bash
# 启动 MinIO 服务。
# 关键：管理员凭据（ADMIN_USER / ADMIN_PASS）是网站级配置，存放在仓库根目录 .env，
# 通过 --env-file 引用，不在 services/minio/.env 内重复定义。
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file ../../.env up -d "$@"
