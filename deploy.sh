#!/bin/bash
# GuestFlow Production Deployment Script for Raspberry Pi
# Usage: ./deploy.sh <raspberry_user> <release_name>
# Example: ./deploy.sh pi guestflow-1.0.0

set -e

RASPI_IP="192.168.0.196"
RASPI_USER="${1:-pi}"
RELEASE_NAME="${2:-guestflow-release}"
RASPI_HOST="${RASPI_USER}@${RASPI_IP}"
RASPI_DEPLOY_DIR="/home/${RASPI_USER}/guestflow"

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== GuestFlow Production Deployment ===${NC}"
echo "Target: ${RASPI_HOST}"
echo "Deploy dir: ${RASPI_DEPLOY_DIR}"
echo "Release: ${RELEASE_NAME}"
echo ""

# Step 1: Build the React client
echo -e "${BLUE}Step 1: Building React client...${NC}"
cd client
npm run build
cd ..
echo -e "${GREEN}✓ Client built${NC}"
echo ""

# Step 2: Create release archive
echo -e "${BLUE}Step 2: Creating release archive...${NC}"
./release.sh "${RELEASE_NAME}"
echo -e "${GREEN}✓ Release archive created: ${RELEASE_NAME}.zip${NC}"
echo ""

# Step 3: Test connection to Raspberry
# echo -e "${BLUE}Step 3: Testing connection to Raspberry...${NC}"
# if ! ssh "${RASPI_HOST}" "echo 'Connection successful'" > /dev/null 2>&1; then
#   echo -e "${RED}✗ Cannot connect to ${RASPI_HOST}${NC}"
#   echo "Make sure the Raspberry Pi is on and SSH is enabled"
#   exit 1
# fi
# echo -e "${GREEN}✓ Connection successful${NC}"
# echo ""

# Step 4: Transfer archive to Raspberry
echo -e "${BLUE}Step 4: Transferring archive to Raspberry...${NC}"
echo "Archive name: ${RELEASE_NAME}.zip"
echo "Raspberry host: ${RASPI_HOST}"
scp "${RELEASE_NAME}.zip" "${RASPI_HOST}:~"
echo -e "${GREEN}✓ Archive transferred${NC}"
echo ""

# Step 5: Deploy on Raspberry
echo -e "${BLUE}Step 5: Deploying on Raspberry...${NC}"
ssh "${RASPI_HOST}" << EOF
set -e
RASPI_USER=\$(whoami)
RASPI_DEPLOY_DIR="/home/\${RASPI_USER}/guestflow"
RELEASE_NAME="${RELEASE_NAME}"

# Ensure npm is available
if command -v npm &> /dev/null; then
  echo "npm found: \$(npm -v), updating..."
  sudo npm install -g npm@latest || true
else
  echo "npm not found, installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Create deploy directory if it doesn't exist
mkdir -p "${RASPI_DEPLOY_DIR}"
cd "${RASPI_DEPLOY_DIR}"

# Stop running service
echo "Stopping existing service..."
pm2 stop guestflow 2>/dev/null || true
pm2 delete guestflow 2>/dev/null || true

# Backup current version if exists
if [ -d "current" ]; then
  echo "Backing up current version..."
  mv current "backup-$(date +%Y%m%d-%H%M%S)"
fi

# Create current directory to ensure it exists
mkdir -p current

# Extract new release
echo "Extracting release..."
mv ../"${RELEASE_NAME}.zip" .
echo "Unzipping archive..."
unzip -q "${RELEASE_NAME}.zip"

# Cleanup
rm "${RELEASE_NAME}.zip"

echo "Move extracted release to 'current' directory..."
echo "Contents of extracted release directory: ${RELEASE_NAME}"
mv "${RELEASE_NAME}"/* current
rm -r "${RELEASE_NAME}"

# Install dependencies
echo "Checking server dependencies..."
DEPS_HASH_FILE="${RASPI_DEPLOY_DIR}/.server-deps.sha256"

cd current/server
DEPS_HASH_INPUT="package.json"
if [ -f package-lock.json ]; then
  DEPS_HASH_INPUT="${DEPS_HASH_INPUT} package-lock.json"
fi
NEW_DEPS_HASH=$(cat ${DEPS_HASH_INPUT} | sha256sum | awk '{print $1}')
OLD_DEPS_HASH=""
if [ -f "${DEPS_HASH_FILE}" ]; then
  OLD_DEPS_HASH=$(cat "${DEPS_HASH_FILE}")
fi

if [ ! -d node_modules ] || [ "${NEW_DEPS_HASH}" != "${OLD_DEPS_HASH}" ]; then
  echo "Dependencies changed (or missing). Installing..."
  if [ -f package-lock.json ]; then
    npm ci --omit=dev || npm install --omit=dev
  else
    npm install --omit=dev
  fi
  echo "${NEW_DEPS_HASH}" > "${DEPS_HASH_FILE}"
else
  echo "Dependencies unchanged. Skipping install."
fi
cd ../..

# Install or update PM2
echo "Installing/updating pm2..."
sudo npm install -g pm2@latest --silent

# Start with PM2
echo "Starting service with PM2..."
NODE_ENV=production pm2 start current/server/src/index.js --name guestflow --update-env
pm2 save
pm2 startup systemd -u "${RASPI_USER}" --hp "/home/${RASPI_USER}" || true


echo "Deployment complete!"
EOF
echo -e "${GREEN}✓ Deployment successful${NC}"
echo ""

# Step 6: Display status
echo -e "${BLUE}Step 6: Checking service status...${NC}"
ssh "${RASPI_HOST}" "pm2 status" | grep guestflow || true
echo ""

echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo "Application is running on ${RASPI_HOST}:4000"
echo ""
echo "Useful commands:"
echo "  ssh ${RASPI_HOST} 'pm2 logs guestflow'     # View logs"
echo "  ssh ${RASPI_HOST} 'pm2 status'              # Check status"
echo "  ssh ${RASPI_HOST} 'pm2 restart guestflow'  # Restart service"
