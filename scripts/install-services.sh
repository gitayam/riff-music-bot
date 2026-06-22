#!/usr/bin/env bash
# install-services.sh — install/uninstall the three launchd agents for THIS machine.
#
# launchd plists need ABSOLUTE paths, so committing them with a fixed path isn't portable.
# This generates correct plists from wherever the repo lives (and your $HOME), writes them
# to ~/Library/LaunchAgents/, and (re)loads them. Re-run after moving/cloning the repo.
#
#   ./scripts/install-services.sh                 # install + start all three
#   ./scripts/install-services.sh --uninstall     # stop + remove all three
#   ./scripts/install-services.sh --generate DIR  # just write the plists to DIR (no load) — for inspection
#
# Services: com.zeroclaw.hermes (bot daemon), .strudel-watch (voice-message delivery),
#           .music-api (HTTP prompt→music). Verify after install with ./scripts/strudel-doctor.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
LA="$HOME/Library/LaunchAgents"
U="$(id -u)"
names=(hermes strudel-watch music-api)

plist() {  # $1=name  $2=script(rel to repo)  $3=arg(optional)  $4=logfile
  local name="$1" script="$2" arg="${3:-}" log="$4"
  local extra=""; [ -n "$arg" ] && extra="
        <string>$arg</string>"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.zeroclaw.$name</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$DIR/$script</string>$extra
    </array>
    <key>WorkingDirectory</key><string>$DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>$HOME</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$DIR/$log</string>
    <key>StandardErrorPath</key><string>$DIR/$log</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
EOF
}

emit() {  # write all three plists into $1
  plist hermes        run.sh                 daemon  daemon.log        > "$1/com.zeroclaw.hermes.plist"
  plist strudel-watch scripts/watch.sh       ""      strudel-watch.log > "$1/com.zeroclaw.strudel-watch.plist"
  plist music-api     scripts/api-server.sh  ""      music-api.log     > "$1/com.zeroclaw.music-api.plist"
}

case "${1:-install}" in
  --generate) gen="${2:?usage: --generate DIR}"; mkdir -p "$gen"; emit "$gen"
              echo "wrote 3 plists to $gen (paths rooted at $DIR)";;
  --uninstall) for n in "${names[@]}"; do
                 launchctl bootout "gui/$U/com.zeroclaw.$n" 2>/dev/null || true
                 rm -f "$LA/com.zeroclaw.$n.plist"
               done; echo "uninstalled 3 services";;
  install) mkdir -p "$LA"; emit "$LA"
           for n in "${names[@]}"; do
             launchctl bootout "gui/$U/com.zeroclaw.$n" 2>/dev/null || true
             launchctl bootstrap "gui/$U" "$LA/com.zeroclaw.$n.plist"
           done
           echo "installed + started: com.zeroclaw.{${names[*]// /,}}"
           echo "verify: ./scripts/strudel-doctor.sh  (set MUSIC_API_TOKEN + MISTRAL/OPENAI/DISCORD keys in .env first)";;
  *) echo "usage: install-services.sh [install | --uninstall | --generate DIR]"; exit 1;;
esac
