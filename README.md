# CampusHub - Venues Booking System

> A web-based venue booking system for colleges. Committees request a venue, the admin approves it, and everyone sees one live calendar of free and booked slots - no more paper registers, phone calls or double bookings.

Developed by **Aaryankumar Singh**

**Tech:** Node.js - Express - MySQL - plain JavaScript front end (no framework, no CDN)

---

## Table of contents
1. [What is this project?](#1-what-is-this-project)
2. [Why was it made?](#2-why-was-it-made)
3. [Who uses it (roles)](#3-who-uses-it-roles)
4. [Features](#4-features)
5. [Booking rules](#5-booking-rules)
6. [Booking ID format](#6-booking-id-format)
7. [Calendar colours](#7-calendar-colours)
8. [Reports, slip and export](#8-reports-slip-and-export)
9. [Backup and restore](#9-backup-and-restore)
10. [Technology used](#10-technology-used)
11. [Project structure](#11-project-structure)
12. [Database design](#12-database-design)
13. [Installation and first run](#13-installation-and-first-run)
14. [Configuration](#14-configuration)
15. [Hosting on a server](#15-hosting-on-a-server)
16. [Security](#16-security)
17. [Tests](#17-tests)
18. [Third-party components and licences](#18-third-party-components-and-licences)
19. [Author and licence](#19-author-and-licence)

---

## 1. What is this project?
CampusHub is a complete **venue (hall / classroom / lab / ground) booking system**.

- A **committee** (department, club, society or outside organisation) creates an account, picks a venue, date and time, chooses the resources it needs (mic, projector, chairs ...) and sends a booking request.
- An **admin** sees the request together with clashes and closures, then **approves or rejects** it (a reason is required for rejection).
- Everybody can open a **calendar** and see which days are free, partly booked, full or closed.
- The approved booking gets a printable **booking slip (PDF)**, and the admin can download **reports (PDF / CSV)** and a **full backup (JSON)** of the whole software.

It runs as one small Node.js server with a MySQL database. Users only need a web browser.

## 2. Why was it made?
In many colleges venues are booked on paper, on WhatsApp or by walking to the office. This causes:

- two committees booking the same hall at the same time,
- no clear record of who booked what, who approved it and when it was cancelled,
- admins not knowing which slots are free or when a venue is closed,
- lost slips and no reports at the end of the month or year.

CampusHub solves this with one place where the rules are checked automatically, every action is recorded, and reports can be printed at any time.

> *Add your own story here (for example: "I built this as my college project / for my college office") - it makes the repository more personal.*

## 3. Who uses it (roles)

| Role | Who | What they can do |
|---|---|---|
| **Committee** | A department, club or society (account approved by the admin) | Request bookings, see own history, print slips, cancel own events, view calendar, chat with admin, edit own profile, delete own account |
| **Admin** | College office staff | Approve / reject requests, add bookings directly, manage venues, closures, committees, reports, settings |
| **Main admin** | The very first admin who registers | Everything an admin can do, plus: approve new admins, reset committee passwords, download / restore the full backup, factory reset |
| **External** | A person or organisation outside the college | Has no login. An admin books on their behalf and the name shows as *Name (External)* |

## 4. Features

### Committee side
- Sign up (needs admin approval) and sign in; **forgot password** request goes to the main admin.
- **Dashboard** with upcoming approved events.
- **Book Venue**: venue cards with search, custom date and time pickers, attendees check against capacity, resources with quantity.
- **My History**: every booking with its status; click a booking to see *Venue detail, Booking detail and History* (requested, approved, cancelled / rejected with date and time).
- **Print Slip** for approved / completed bookings, **Cancel** before the event starts.
- **Calendar View** of every venue.
- **Chat with Admin** and **Notifications**.
- **My Profile** (in-charge name, phone, password) and **Delete my account** (2-step confirmation).

### Admin side
- **Overview**: today's events, completed / remaining, requests today, pending, and a filterable schedule.
- **Manual Booking** for a committee or for an external person (approved at once).
- **Venues**: add / edit / delete, opening and closing time, capacity, location, resources, photo upload. A venue without a photo automatically gets a **name-based thumbnail** drawn by the code.
- **Pending Approvals** (new committee accounts) and **Booking Requests** (approve shows clashes, closures and other bookings of the day first).
- **All Bookings**: totals, filters (text / ID, date range, committee, venue, status) and cancel with reason.
- **Committees**: block / unblock (blocking cancels upcoming bookings and signs the committee out).
- **Master Calendar**: close a venue for a full day or for time ranges.
- **Messages** and **Notifications**.
- **Settings**: event categories, committee types, create committee accounts, admin list, my account, deleted-account records, export / reports, backup / restore, factory reset.

## 5. Booking rules
All rules are checked on the **server**, not only in the browser.

- End time must be after start time; the booking must be inside the venue's opening hours.
- Past dates and times cannot be booked.
- A closed venue (full day or time range) cannot be booked.
- A slot that overlaps a *Pending* or *Approved* booking is refused.
- Attendees cannot be more than the venue capacity; resource quantity cannot be more than what the venue has.
- Committee requests start as **Pending**; bookings added by an admin are **Approved** immediately.
- Status flow: `Pending -> Approved -> Completed` (completed automatically when the event ends), or `Rejected` / `Cancelled`.
- A committee can cancel only its own booking and only before it starts. An admin must give a reason to cancel or reject.
- Changing venue timings, closing a venue or deleting a venue first **asks the admin to confirm** and lists the affected bookings; those bookings are rejected / cancelled with a clear reason and the committees are notified.
- Bookings are **history**: deleting an account or a venue never deletes a booking (names are saved as a snapshot inside each booking).

## 6. Booking ID format
Every booking gets an ID like **`CH-101026-01`**

| Part | Meaning |
|---|---|
| `CH` | Fixed - short for CampusHub |
| `101026` | Date of the **event** in `DDMMYY` (10 October 2026) |
| `01` | Running number of bookings. +1 for every new booking, **never restarts and has no limit** (01 ... 99, 100, 101 ...) |

Example: first booking for 10 Oct 2026 = `CH-101026-01`; the next booking, for 15 Oct 2026, = `CH-151026-02`.
Bookings made by older versions (random IDs) are converted to this format automatically when the server starts and after a restore. The same ID is shown on screens, the booking slip, the CSV and the PDF report.

## 7. Calendar colours

| Colour | Meaning |
|---|---|
| Green | All Available, Some Slots Booked (shows the count, e.g. *Some Slots Booked (1)*) |
| Yellow | Partly Closed (shows the closed hours, e.g. *Closed 2:00 PM-4:00 PM*) |
| Red | Full Booked, Closed all day (striped) |
| Gray | Past date |

## 8. Reports, slip and export
- **Booking slip (PDF)**: one A4 page. If the data is very long, only the data text is made smaller so it always fits on **one page**. Shows Booking ID, Booked By, Booked For, Category, Venue, Date, Time, Attendees, Resources and signature lines.
- **PDF report**: choose a **date range** or click **Full Report** (first booking date to last booking date). Contains total / completed / cancelled / rejected boxes, bookings by venue, bookings by committee (external names marked *(External)*) and a detailed table with Booking ID.
- **CSV**: the booking list for Excel, with the same Booking ID as on screen.
- PDFs open the browser print window - choose **Save as PDF**.

## 9. Backup and restore
- **Settings -> Full Backup (JSON)** (main admin only) downloads **one JSON file** with all data: venues and photos, committees, admins (password hashes), bookings (including old and cancelled), closures, messages, notifications, logs, deleted-account history and settings.
- **Restore from backup file** accepts **only a `.json` file made by this software**. The admin enters the password and types `RESTORE`; all current data is replaced by the file's data, and everyone is signed out.
- Keep the backup file private - it contains password hashes.
- Use it to keep a safe copy or to move the software to a new server.

## 10. Technology used

| Layer | Technology |
|---|---|
| Server | Node.js 18+, Express 4 |
| Database | MySQL 8 / MariaDB 10.4+ (InnoDB, utf8mb4) through `mysql2` |
| Front end | Plain HTML, CSS and JavaScript (no React / Vue); compiled Tailwind CSS |
| Icons and fonts | Font Awesome Free icons (local SVG files), Inter, Cinzel, Playfair Display fonts (local) |
| Printing | Browser print (Save as PDF), no PDF library |

Only **two npm packages** are used: `express` and `mysql2`. There is **no CDN and no external link** - fonts, icons and CSS are inside `public/`.

## 11. Project structure
```
campushub-mysql/
|-- config/config.js        MySQL settings, port, time zone, session time, starting lists
|-- database/campushub.sql  Plain SQL copy of the tables (optional, tables are created automatically)
|-- server/
|   |-- app.js              Express server, /api endpoint, login rate limit, static files
|   |-- actions.js          Every action and all booking rules
|   |-- db.js               MySQL helper (transactions, write lock, auto table creation)
|   |-- schema.js           Table design
|   `-- util.js             Helpers (password hashing, time functions, validation)
|-- public/
|   |-- index.html          Single page app
|   |-- js/                 Views (admin, user, shared, settings), router, API bridge, booking extras, splash
|   |-- css/                app.css, print.css, splash.css, tailwind.css, fonts, icons
|   `-- assets/             Logos, icons, fonts
|-- scripts/make-schema.js  Builds database/campushub.sql from schema.js
|-- tests/                  Automated checks (in-memory database, no MySQL needed)
`-- uploads/                Uploaded venue photos
```

## 12. Database design
Tables are **created automatically** on first start from `server/schema.js` (missing columns are added to old databases). Main tables:

`Settings`, `Users` (committees), `Admins`, `DeletedAccounts`, `Venues`, `Closures`, `Bookings`, `Chats`, `Notifications`, `Logs`, `Sessions`, `Verifications`.

Important design rule: **`Bookings` has no foreign keys.** Each booking stores a snapshot of the organiser, in-charge, admin and venue names, so the history stays correct after an account or venue is deleted. A deleted account is moved to `DeletedAccounts` (its password is removed).

## 13. Installation and first run

**Requirements:** Node.js 18 or newer, and MySQL 8 / MariaDB 10.4+.

1. Create an empty MySQL database:
   ```sql
   CREATE DATABASE campushub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. Open `config/config.js` and set your MySQL `host`, `port`, `user`, `password` and `database`.
3. In the project folder run:
   ```bash
   npm install
   npm start
   ```
4. The terminal shows `CampusHub is running on port 3000`. Open **http://localhost:3000**.
5. On the login page click **Administrator Login -> Register Admin**. The **first admin becomes the main admin** automatically. Later admins need the main admin's approval.
6. Sign in as admin, add venues (**Venues -> Add Venue**), then committees can register and start booking.

## 14. Configuration
Everything is in `config/config.js`:

| Setting | Meaning |
|---|---|
| `mysql` | host, port, user, password, database |
| `uploadDir` | Folder for venue photos. Empty = the `uploads` folder inside the project. Set a permanent folder on hosting so photos are not lost on update |
| `port` | Port of the website (default 3000; the `PORT` environment variable is also used) |
| `timezone` | Time zone used to check booking times (default `Asia/Kolkata`) |
| `sessionHours` | How long a login lasts (default 12) |
| `refreshSeconds` | How often open pages check for new messages and updates (default 30) |
| `seed` | Starting lists of event categories and committee types; copied to the database only on first start and after a factory reset |

**Welcome screen time:** `public/js/splash.js` (`setTimeout(close, 6700)`, in milliseconds) and the bar animation in `public/css/splash.css`.

## 15. Hosting on a server
1. The host must support **Node.js 18+** and **MySQL / MariaDB** (plain PHP-only shared hosting will not work).
2. Upload the project (without `node_modules`), create the database, and change only the `mysql` block (and `port` if the host gives one) in `config/config.js`.
3. Run `npm install` and `npm start` (or use the host's Node.js app manager / PM2).
4. Put the site behind HTTPS (the host or a reverse proxy usually does this).
5. Keep photos in a permanent folder (`uploadDir`) and take a **Full Backup (JSON)** regularly.
6. To move from your computer: download the backup, install on the server, open the site, and use **Restore from backup file**.

## 16. Security
- Passwords are stored as **scrypt hashes with a random salt**, never as plain text.
- Login uses random **session tokens** that expire (12 hours by default).
- Login / sign-up attempts are **rate limited** (20 tries per 10 minutes per address).
- All writes run **one at a time** through a database lock, so two people can never take the same slot.
- Every rule is checked on the server; admin-only actions are refused for committees.
- Account deletion needs **two steps** (password, then a code and the word `DELETE`); restore and factory reset need the admin password and a typed word.
- All text shown on screen is escaped to prevent script injection.
- **Before publishing the code (for example on GitHub) change the MySQL password in `config/config.js`.** Never upload a backup file or real venue photos.

## 17. Tests
```bash
npm test
```
Runs the booking rules (clashes, closures, capacity, resources, cancellation, blocking, account deletion, booking ID format and conversion, backup and restore) on an in-memory database. No MySQL is needed.

## 18. Third-party components and licences
The project makes no network calls to outside services. These files are included locally:

| Component | Where | Licence |
|---|---|---|
| Tailwind CSS (compiled) | `public/css/tailwind.css` | MIT |
| Font Awesome Free icons | `public/assets/icons/`, `public/css/fontawesome.css` | CC BY 4.0 (credit line kept in the file) |
| Inter, Cinzel, Playfair Display fonts | `public/assets/fonts/` | SIL Open Font License |
| express, mysql2 | npm packages | MIT |

Please keep the licence notices in these files.

## 19. Author and licence
**Aaryankumar Singh** - KSD's Model College

The college and software logos in `public/assets/images/` belong to their owners.
Licence of the project code: *add your choice here* (for example MIT, or "All rights reserved"). `package.json` currently says `UNLICENSED`.
