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
│           └── finance.js
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
│           └── FinancePage.js
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

### 3. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT`   | Express server port | `4000` |
| `REACT_APP_API_URL` | API URL (client build) | `/api` |

### 4. Deployment with a Process Manager (Optional)

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

## License

See the [LICENSE](LICENSE) file.
