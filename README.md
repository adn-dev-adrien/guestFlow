# GuestFlow

A web application for managing tourist accommodations: property booking and financial tracking.

## Features

### Client Management
- Create, edit, delete clients (last name, first name, address, phone, email, notes)
- Instant search across the client database

### Property Management
- Property profiles with photo, capacity (adults, children, babies)
- Per-night pricing, configurable by season (pricing rules with date ranges)
- Default check-in/check-out times and cleaning duration between stays
- Deposit settings (percentage, days before stay) and balance due date
- Document uploads (contract templates, house rules, etc.) attached to properties
- Per-property option availability

### Stay Options
- Create options with title, description, and price
- Pricing types: per stay, per person, per night, per person per night, per hour
- Enable/disable per property

### Calendar-Based Booking
- Visual calendar per property with monthly navigation
- Click-and-drag date selection → opens a booking form
- Search and select an existing client or create one on the fly
- Guest count input (adults, children, babies)
- Booking platform selection (Airbnb, GreenGo, Abritel, Abracadaroom, Booking, direct)
- Check-in/check-out time selection (pre-filled from property settings)
- Automatic price calculation, percentage discount or manual price override
- Add-on option selection with automatic price computation
- Automatic deposit and balance proposals (amount and date), manually adjustable
- Calendar visualization:
  - Color-coded fill per booking platform
  - 135° diagonal gradient proportional to check-in/check-out times (8 AM–9 PM window)
  - Red cleaning block immediately following check-out

### Financial Tracking
- Period-based view: total revenue, collected amount, pending amount
- Charts (bar and pie) showing revenue per booking
- Projection at a given date: collected and expected amounts
- Detailed reservation table with payment status

### Dashboard
- Combined calendar of all properties for the next 30 days
- Key indicators: number of properties, upcoming bookings, outstanding balance
- Pending payments list with checkboxes to mark payments as received

### Google Calendar Integration
- Sync all reservations to a Google Calendar automatically
- Event titles include property name and guest name for easy identification
- Event descriptions contain guest count, bed allocations, and selected options
- Manage credentials via Settings page (Paramètres) in the application UI
- Automatic event creation/update with deterministic IDs for duplicate prevention

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend  | React 18, Material UI 5, Recharts, React Router 6 |
| Backend   | Node.js, Express 4 |
| Database  | SQLite (via better-sqlite3) |
| File uploads | Multer |

## Prerequisites

- **Node.js LTS** ≥ 20.x or 22.x (recommended: v22.22.2)
  - ⚠️ Not compatible with Node.js v25+ (incompatibility with better-sqlite3 C++ compilation)
- **npm** ≥ 10.x

No external database required: SQLite is embedded and the `.db` file is created automatically on first launch.

### Installing Node.js

On macOS with Homebrew:

```bash
# Install Node.js 22 LTS
brew install node@22
brew link node@22

# Verify installation
node --version  # Should output v22.x.x
npm --version   # Should output 10.x.x
```

## Project Structure

```
guestFlow/
├── package.json              # Root scripts (dev, build, install:all)
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js           # Express entry point (port 4000)
│       ├── database.js        # SQLite schema + migrations
│       └── routes/
│           ├── clients.js
│           ├── properties.js
│           ├── options.js
│           ├── reservations.js
│           ├── finance.js
│           ├── settings.js
│           └── googleCalendar.js
├── client/
│   ├── package.json
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── index.js
│       ├── App.js             # Layout + router
│       ├── api.js             # HTTP client for the API
│       ├── theme.js           # Material UI theme
│       └── pages/
│           ├── Dashboard.js
│           ├── ClientsPage.js
│           ├── PropertiesPage.js
│           ├── PropertyDetail.js
│           ├── OptionsPage.js
│           ├── CalendarPage.js
│           ├── FinancePage.js
│           ├── ReservationPage.js
│           └── SettingsPage.js
└── server/uploads/            # Uploaded documents and photos
```

## Development

### Installing Dependencies

```bash
# From the project root
npm install                  # installs concurrently (root)
cd server && npm install     # installs server dependencies
cd ../client && npm install  # installs client dependencies
```

Or in a single command:

```bash
npm install && npm run install:all
```

### Stopping Running Instances

If you have a GuestFlow instance running in the background, stop it first:

```bash
# macOS: Kill processes on both ports 3000 and 4000
kill -9 $(lsof -t -i :3000) $(lsof -t -i :4000) 2>/dev/null || true

# Linux: Kill processes on both ports 3000 and 4000
fuser -k 3000/tcp 4000/tcp 2>/dev/null || true

# Or kill all Node.js processes running GuestFlow
pkill -f "node src/index.js" || true
```

### Running in Development Mode

```bash
# Start both server and client simultaneously (from root)
npm run dev
```

This starts:
- **API** at `http://localhost:4000` (with hot-reload via `node --watch`)
- **React client** at `http://localhost:3000` (with hot-reload via react-scripts)

The client automatically proxies `/api/*` requests to port 4000.

You can also run them separately in two terminals:

```bash
# Terminal 1 — Server
npm run dev:server

# Terminal 2 — Client
npm run dev:client
```

### Running Unit Tests

Unit tests are currently implemented on the server side using Node's built-in test runner.

Run all unit tests:

```bash
# From project root
cd server
npm test
```

Equivalent one-liner from the root folder:

```bash
npm --prefix server test
```

Run a specific test file:

```bash
cd server
node --test src/tests/finance.unit.test.js
node --test src/tests/properties-ical.unit.test.js
```

Notes:
- Test files are located in `server/src/tests/`.
- The `npm test` script in `server/package.json` runs `node --test "src/tests/**/*.test.js"`.

### Database

The `server/guestflow.db` file is created automatically on first launch. It is ignored by Git.

To start with a fresh database, simply delete the file:

```bash
rm server/guestflow.db
```

Migrations (adding new columns) run automatically on startup in `server/src/database.js`.

### Authentication

GuestFlow requires a login. On the **first launch**, a default admin account is created:

| Email | Password |
|---|---|
| `admin@guestflow.local` | `ChangeMe!2026` |

This default password **only unlocks the "set your password" screen** — you cannot use the app until
you change it. **Change it immediately on first login**, ideally before exposing the instance publicly.

Secrets are auto-generated into `server/.env.local` on first run (`GUESTFLOW_ENCRYPTION_KEY` for
credential encryption at rest, `GUESTFLOW_SESSION_SECRET` for sessions). This file is git-ignored and
must never be committed or shared. Google service-account credentials are encrypted (AES-256-GCM) at
rest using that key.

The admin password persists across restarts. If you ever lose it, recover access without touching the
database by hand — run, on the server:

```bash
cd server && npm run reset-admin
```

This restores the default admin (`admin@guestflow.local` / `ChangeMe!2026`) with a forced password
change on next login, and invalidates existing sessions. (Requires filesystem/SSH access to the server.)

### Security configuration

The API sends HTTP security headers (helmet) including a Content-Security-Policy, and is rate-limited
per IP (login: 10 failed attempts / 15 min; global API: 300 requests / 15 min — both `429` when
exceeded). The public iCal export feed is exempt from the global limit.

Optional environment variables (sensible defaults otherwise):

| Variable | Purpose | Default |
|---|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins (credentialed). Prod is same-origin, so usually unneeded. | `http://localhost:3000` |
| `LOGIN_RATELIMIT_MAX` / `LOGIN_RATELIMIT_WINDOW_MS` | Login rate limit | `10` / `900000` |
| `API_RATELIMIT_MAX` / `API_RATELIMIT_WINDOW_MS` | Global API rate limit | `300` / `900000` |

The production build is created with `INLINE_RUNTIME_CHUNK=false` (already wired into
`client` `npm run build`) so the CSP can keep `script-src 'self'`.

## Production Deployment
## Release Packaging

### 1. Generate a release (full archive)

A script is provided to create an archive containing everything needed (client build, server, uploads, etc.).

**Prerequisites:**
- Build the client (`cd client && npm run build`)
- Install all dependencies (`npm install && npm run install:all`)

**Release generation:**

```bash
# From the project root
./release.sh guestflow-1.0.0
# This creates guestflow-1.0.0.zip
```

The script includes:
- The server (without node_modules or temporary files)
- The client build (client/build)
- The uploads folder (photos, documents)
- The root package.json

### 2. Install the release on the target (e.g. Raspberry Pi)

1. **Transfer the archive** vadky9-jabmib-zazZij  vqrdky(6

   ```bash
   scp guestflow-1.0.0.zip pi@raspberrypi:~/guestflow/
   ```

2. **Unzip and install dependencies**

   ```bash
   unzip guestflow-1.0.0.zip
   cd guestflow-1.0.0/server
   npm install --production
   cd ../client/build # (nothing to install here, these are static files)
   cd ../..
   ```

3. **Start the server**

   ```bash
   cd server
   NODE_ENV=production node src/index.js
   ```

   Or with PM2 to run as a background service:

   ```bash
   npm install -g pm2
   pm2 start src/index.js --name guestflow
   pm2 save
   pm2 startup
   ```

The application will be available on port 4000 by default.

**Note:**
The SQLite database file (`guestflow.db`) will be created automatically on first launch. If you want to migrate an existing database, copy it into `server/` before starting.

### 1. Build the React Client

```bash
cd client
npm run build
```

This generates a `client/build/` folder containing optimized static files.

### 2. Serve the Application

In production, you can serve the static files directly from Express. Add the following to `server/src/index.js` (before `app.listen`):

```js
const path = require('path');
app.use(express.static(path.join(__dirname, '..', '..', 'client', 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'client', 'build', 'index.html'));
});
```

Then start the server only:

```bash
cd server
NODE_ENV=production node src/index.js
```

The full application is then available at `http://localhost:4000`.

### 3. Configuring Google Calendar Integration

GuestFlow can sync all reservations to a Google Calendar automatically. This is useful for seeing your bookings across all platforms in a single calendar view.

#### Setting up Google Calendar

1. **Create a Google Service Account**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project (or select an existing one)
   - Go to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **Service Account**
   - Fill in the service account details and click **Create**
   - Under **Keys**, click **Add Key** → **Create new key** → **JSON**
   - Save the downloaded JSON file (you'll need this)

2. **Share Your Google Calendar**
   - Open your Google Calendar
   - Copy your **Calendar ID** from settings (usually ends with `@gmail.com` or similar)
   - Go back to Google Cloud Console and note the service account email
   - In your Google Calendar settings, share the calendar with the service account email (with "Make changes to events" permission)

3. **Enter Credentials in GuestFlow**
   - Open GuestFlow and navigate to **Paramètres** (Settings) in the menu
   - Fill in the three fields:
     - **Calendar ID**: Your Google Calendar ID
     - **Service Account Email**: From the service account JSON file
     - **Private Key**: From the service account JSON file (the entire `private_key` value)
   - Click **Save Settings**
   - Settings are persisted and survive server restarts

4. **Sync Reservations**
   - Go to the **Réservations** (Reservations) page
   - Click the **Sync Google** button to sync all reservations to your calendar
   - Events will be created with:
     - **Title**: Property name − Guest name (e.g., "Villa Sunset − Jean Dupont")
     - **Description**: Guest count, bed allocations, and selected options
     - **Time**: Based on check-in and check-out times

#### Environment Variables (Optional)

For production deployments or automated setups, you can configure Google Calendar via environment variables instead of the Settings page. The application checks environment variables as a fallback if Settings are not configured in the database.

| Variable | Description |
|----------|-------------|
| `GOOGLE_CALENDAR_ID` | Google Calendar target ID for reservation sync |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email used to write events |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account private key (use `\n` for line breaks) |

**Priority:** Database settings (via Settings page) take precedence over environment variables. This allows you to update credentials without restarting the server.

#### Security: Automatic Encryption of Sensitive Data

**All Google Calendar credentials are encrypted before storage in the SQLite database.** This provides protection against database compromise.

- **Automatic encryption key generation:**
  - On first startup, GuestFlow automatically generates a strong encryption key
  - The key is saved to `server/.env.local` (automatically added to `.gitignore`)
  - On subsequent startups, the key is automatically loaded and reused
  - **No manual setup required** — encryption is transparent and automatic

- **How it works:**
  - Sensitive fields (`googleCalendarId`, `googleServiceAccountEmail`, `googleServiceAccountPrivateKey`) are encrypted using AES-256-GCM
  - Each field has its own random initialization vector (IV) and authentication tag
  - Data is automatically decrypted when retrieved by the application
  - Even if the database file (`guestflow.db`) is compromised, the encrypted credentials cannot be read without the encryption key

- **For development (recommended):**
  ```bash
  # Just start normally - encryption key is auto-generated on first run
  npm run dev
  # or
  npm run dev:server
  ```

- **For production deployments:**
  
  If deploying to a new server or environment, you have two options:
  
  **Option A: Use auto-generated key (recommended)**
  ```bash
  # Start the app - it generates and saves the key to .env.local
  NODE_ENV=production node src/index.js
  ```
  
  **Option B: Provide a custom encryption key**
  ```bash
  # For multi-instance deployments, provide the same key on all instances
  export ENCRYPTION_KEY="your-secure-key-here"
  NODE_ENV=production node src/index.js
  ```

- **With PM2:**
  ```bash
  # Auto-generated key (recommended)
  pm2 start src/index.js --name guestflow
  pm2 save
  
  # Or with custom key for consistency across deployments
  export ENCRYPTION_KEY="your-secure-key"
  pm2 start src/index.js --name guestflow
  pm2 save
  ```

- **⚠️ Important notes:**
  - **`.env.local` file:** The auto-generated key is stored here. Keep it safe and never commit it to git (it's automatically in `.gitignore`)
  - **Recovery:** If `.env.local` is lost, the stored credentials become unreadable. You can re-enter them via the Settings page with a new key
  - **Multi-instance deployments:** If running GuestFlow on multiple servers, either:
    - Copy the `.env.local` from the first instance to others, **OR**
    - Set the same `ENCRYPTION_KEY` environment variable on all instances

### 4. Environment Variables

| Variable | Description | Default |
|----------|-------------|----------|
| `PORT`   | Express server port | `4000` |
| `REACT_APP_API_URL` | API URL (client build) | `/api` |

### 5. Deployment with a Process Manager (Optional)

For a robust production setup, use PM2:

```bash
npm install -g pm2
cd server
pm2 start src/index.js --name guestflow
pm2 save
pm2 startup
```

## Deployment using GitHub runner

On GitHub side there is a runner enabled.
In the project I have created .github/workflows/deploy.yml to handle automatic deployment in case of pushing new commit on release branch.

### See runner log
```bash
systemctl status actions.runner.computingify-guestFlow.guestflow.service
```

### See application logs
As the application GuestFlow is managed by PM2, all logs are inside PM2:

#### To see live logs
```bash
pm2 logs guestflow
```

#### Only the latest line
```bash
pm2 logs guestflow --lines 100 --nostream
```

### Check if the application is running
```bash
pm2 status
pm2 describe guestflow
```
As the output we should have:
status: online
script path
cwd
pm_out_log_path
pm_err_log_path

## Install wordpress

### Step 1: Prepare Raspberry PI
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

### Step 2: Create wordpress docker instance

Create a directory in home to install the docker wordpress
Then create a file named docker-compose.yml with this content:
```bash
services:
  db:
    image: mariadb:11
    container_name: wp_db
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wpuser
      MYSQL_PASSWORD: change_me_wp_pass
      MYSQL_ROOT_PASSWORD: change_me_root_pass
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    volumes:
      - db_data:/var/lib/mysql

  wordpress:
    image: wordpress:6-apache
    container_name: wp_app
    restart: unless-stopped
    depends_on:
      - db
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DB_USER: wpuser
      WORDPRESS_DB_PASSWORD: change_me_wp_pass
    volumes:
      - wp_data:/var/www/html

volumes:
  db_data:
  wp_data:
```
BECAREFUL to update passwords

### Step 3: Start wordpress

```bash
docker compose up -d
docker ps
```

Wordpress is now available at http://RPI_IP:8080

### Step 4: wordpress configuration in CLI

```bash
docker run --rm --network host \
  -v wp_data:/var/www/html \
  --user 33:33 \
  wordpress:cli \
  wp core install \
  --url="http://IP_DU_PI:8080" \
  --title="Mon Site" \
  --admin_user="admin" \
  --admin_password="MotDePasseFort!" \
  --admin_email="toi@domaine.com" \
  --path=/var/www/html
```

## License

See the [LICENSE](LICENSE) file.
