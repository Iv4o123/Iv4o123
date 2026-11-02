# FE Booking

Job booking and tracking for field engineers doing network installs. Office staff book jobs and assign them to engineers. Engineers open the job on their phone, check in on site, photograph the rack, tick off the checklist, record serial numbers and get a sign-off. The office then approves the job or sends it back.

## What it does

**Office (dispatcher / admin, browser)**
- Create jobs with site, rack, ticket ref, priority, time slot and checklist
- Assign engineers, with a warning when a booking overlaps another job
- Weekly calendar per engineer; tap an empty slot to book
- Review queue: see photos, notes, serials and signature, then **Approve** or **Send back** with a reason
- Search by job ref, site, rack, ticket or equipment serial number
- Manage sites (address, contact, access notes) and the team (admin only)

**Field engineer (phone)**
- Today's jobs, with **Navigate** (Google/Apple Maps) and **Call site** buttons
- **Start travel** → **Check in** (records time + GPS) → **Complete**
- One-tap photo buttons: rack front, rack rear, cabling, labels, equipment. The camera opens directly and photos are compressed on the phone before upload
- Checklist, equipment serial numbers (barcode scanning on Android Chrome), notes
- Customer signature on screen
- **Works offline.** Jobs are saved on the phone; check-ins, photos and notes made without signal are queued and upload automatically when the phone is back online, with no duplicates

A job can't be completed without at least one photo and a finished checklist.

## Job statuses

```
unassigned → assigned → en_route → on_site → completed → approved
                 ↑                     ↑          │
                 └──── returned ◄──────┴──────────┘ (sent back by office)
Office can cancel any open job.
```

## Run it locally

Needs **Node.js 22.13 or newer** (uses the built-in SQLite module). Check your version with `node -v`.

### Try the demo

Run these in a terminal (Command Prompt, PowerShell or a Mac/Linux terminal):

```bash
cd fe-booking
npm install
npm run seed:demo
npm start
```

Open **http://localhost:3000** and sign in with any of these. They all use the password **`demo1234`**:

| Role | Email |
|---|---|
| Admin | admin@example.com |
| Dispatcher | dispatch@example.com |
| Engineer | georgi@example.com |
| Engineer | maria@example.com |

Running `npm run seed:demo` again at any time resets these accounts to `demo1234`.

### Set up for real use

1. Copy `.env.example` to `.env` (Windows: `copy .env.example .env`, Mac/Linux: `cp .env.example .env`).
2. In `.env`, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 8 characters).
3. Run `npm run seed`. This creates only your admin account; sign in with the email and password from `.env`. Then add your engineers under **Team**.

Run the tests with `npm test`.

### Can't sign in?

- **"Wrong email or password"**: for the demo accounts, run `npm run seed:demo` again (this resets them to `demo1234`), then try again.
- **"Too many attempts"**: after 10 failed tries, an account is locked for 15 minutes. Restarting the server clears this.
- **HTTPS message, or you land back on the sign-in page**: `COOKIE_SECURE=1` only works over `https://`. For local testing, set `COOKIE_SECURE=0` in `.env`.
- When the server starts, it prints the data folder it uses and how many users it has. `0 active users` means the database is empty, so run one of the seed commands.

## Deploy

Everything lives in one folder (`DATA_DIR`): the SQLite database plus uploaded photos. **Back that folder up.**

The app **must be served over HTTPS** in production. Phones only allow camera access, GPS and offline mode on secure sites. Set `COOKIE_SECURE=1`.

### Docker (any VPS, or the company's own server)

```bash
docker build -t fe-booking .
docker run -d --name fe-booking -p 3000:3000 -v fe-data:/data \
  -e COOKIE_SECURE=1 -e ADMIN_EMAIL=you@company.com -e ADMIN_PASSWORD='a-long-password' \
  fe-booking
docker exec fe-booking npm run seed     # first time only
```

Put it behind a reverse proxy that handles HTTPS, such as Caddy (automatic certificates):

```
fe.yourcompany.com {
  reverse_proxy localhost:3000
}
```

Hosted platforms with a persistent disk (Render, Railway, Fly.io) also work: mount the disk at `/data`.

### Installing on phones

Open the site on the phone. Then:
- **Android (Chrome):** tap ⋮ → **Install app**.
- **iPhone (Safari):** tap Share → **Add to Home Screen**.

## Project layout

```
src/
  app.js            Express app, security headers, error handling
  db.js             SQLite schema + migrations
  auth.js           Password hashing, sessions, roles, CSRF guard
  workflow.js       Job statuses and allowed transitions
  storage.js        Photo storage (local disk; swap for S3 here)
  routes/           auth, users, sites, jobs (+ photos, checklist, assets, notes)
public/
  index.html, sw.js, manifest.webmanifest
  js/api.js         API client + offline upload queue
  js/store.js       IndexedDB (offline cache + queue)
  js/views/         Screens
test/               API tests (node:test)
```

## Possible next steps

- Email or push notifications when a job is assigned or sent back
- PDF job report for customers (photos + checklist + signature)
- Move photos to S3/R2 (implement `save/open/remove` in `src/storage.js`)
- PostgreSQL for larger teams
- Customer portal (read-only access to their sites' jobs)
