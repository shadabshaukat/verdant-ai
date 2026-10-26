#!/bin/sh
set -eu
project_dir="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_dir"
command_name="${1:-help}"
case "$command_name" in
  start)
    ./scripts/prepare-secrets.sh
    docker compose up -d --build --wait
    printf '\nVerdant DBA: http://127.0.0.1:%s\n' "${APP_PORT:-8090}"
    ;;
  stop)
    docker compose down
    printf 'Stopped the stack. All three database volumes remain intact.\n'
    ;;
  status)
    docker compose ps
    ;;
  logs)
    docker compose logs --tail=100 -f app worker
    ;;
  test)
    npm test
    node test/integration.mjs
    ;;
  doctor)
    docker info >/dev/null
    docker compose version
    curl -fsS http://127.0.0.1:11434/api/tags | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log('Host Ollama models:',p.models.map(m=>m.name).join(', '))})"
    ;;
  *)
    printf 'Usage: ./scripts/demo.sh start|stop|status|logs|test|doctor\n'
    ;;
esac
