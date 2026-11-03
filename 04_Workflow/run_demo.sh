#!/usr/bin/env bash
# Same as ./penny demo, then shows the register.  Usage:  ./run_demo.sh [path to Hillpointe_AP_Technical_Screen]
set -euo pipefail
cd "$(dirname "$0")"
if [ -n "${1:-}" ]; then ./penny demo --package "$1"; else ./penny demo; fi
echo
echo "Register after all runs:"; ./penny status
