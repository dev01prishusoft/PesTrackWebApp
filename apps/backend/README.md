# PesTrack Backend

Node/Express + PostgreSQL backend for the PesTrack multi-site findings dashboard.
This first slice covers the **database migration** and the **admin panel** (auth, user management, site management, audit-log viewer).

## Setup

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
npm install
```

## Database

```bash
npm run migrate    # creates all tables + indexes (idempotent, tracked in schema_migrations)
npm run seed       # seeds El Gouna site, 44 parcels, reference data, bcrypt admin
```

The seed creates the default admin from `.env` (`ADMIN_USERNAME` / `ADMIN_EMAIL` /
`ADMIN_PASSWORD`, default `admin` / `Admin@123`) and assigns it to the El Gouna site
via `user_sites`.

## Run

```bash
npm run dev        # nodemon, http://localhost:5000
npm start          # production
```

Admin panel: **http://localhost:5000/admin.html** — log in with the admin credentials.

## Admin API (implemented in this slice)

| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| POST | `/api/auth/login` | public | Login → JWT |
| GET  | `/api/auth/me` | any | Current user + assigned sites |
| POST | `/api/auth/logout` | any | Client drops token |
| GET  | `/api/users` | admin | List users (with sites) |
| POST | `/api/users` | admin | Create user + site assignments |
| GET  | `/api/users/:id` | admin | Get user |
| PUT  | `/api/users/:id` | admin | Update user / reassign sites / activate |
| DELETE | `/api/users/:id` | admin | Deactivate (soft) |
| POST | `/api/users/:id/reset-password` | admin | Reset password |
| GET  | `/api/sites` | any | List sites (scoped to assignments for non-admins) |
| POST | `/api/sites` | admin | Create site |
| PUT  | `/api/sites/:id` | admin | Update site |
| DELETE | `/api/sites/:id` | admin | Deactivate site |
| POST | `/api/sites/:id/users` | admin | Assign user to site |
| DELETE | `/api/sites/:id/users/:userId` | admin | Remove user from site |
| GET  | `/api/audit` | admin | Audit log (filters: `action`, `from`, `to`, `userId`) |

All admin mutations write an audit row (who / what / when / IP).

## Tests

```bash
npm test           # jest — roleCheck / site-access unit tests
```

## Still to build (later slices)
Locations/visits/zones/parcels CRUD, photo upload to S3, findings audit,
JSON import→DB (admin), and the frontend dashboard integration.
