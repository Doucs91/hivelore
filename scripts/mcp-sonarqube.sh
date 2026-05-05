#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/sonar-mcp.local.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy sonar-mcp.local.env.example to sonar-mcp.local.env and set SONARQUBE_URL and SONARQUBE_TOKEN." >&2
  exit 1
fi

CA_DIR="${ROOT}/sonar-mcp-ca"
DOCKER_EXTRA=()
if [[ -d "${CA_DIR}" ]]; then
  DOCKER_EXTRA=(-v "${CA_DIR}:/usr/local/share/ca-certificates:ro")
fi

exec docker run -i --rm --init --pull=always \
  "${DOCKER_EXTRA[@]}" \
  --env-file "${ENV_FILE}" \
  mcp/sonarqube
