#!/bin/bash
# Stream Civ7 UI logs filtered to [TOT-VF] mod output.
# Civ7 on macOS writes Coherent GT console output to its log file.

LOG_FILE="$HOME/Library/Application Support/Civilization VII/Logs/Civ7_UI.log"

if [ ! -f "$LOG_FILE" ]; then
	echo "Log file not found: $LOG_FILE"
	echo "Make sure Civ7 has been launched at least once."
	exit 1
fi

echo "=== Streaming [TOT-VF] log output (Ctrl-C to stop) ==="
tail -f "$LOG_FILE" | grep --line-buffered '\[TOT-VF\]'
