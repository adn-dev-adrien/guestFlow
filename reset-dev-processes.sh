#!/usr/bin/env bash
set -e

# Nettoie les anciens process Node/watchers liés au projet
pkill -f "guestFlow.*node|node --watch src/index.js|react-scripts start|concurrently.*dev:server.*dev:client" || true

# Relance le backend proprement
cd /home/adrien/guestFlow/server
npm run dev

# Optionnel (dans un autre terminal):
# cd /home/adrien/guestFlow/client
# npm start
