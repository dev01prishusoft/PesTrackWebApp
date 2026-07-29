# PesTrack (Cloud App) — Deployment Instructions (V6.04 Release)

This document provides step-by-step deployment and operational instructions for deploying the **PesTrack V6.04 Cloud Release** to production (e.g. Render / Cloud App hosting).

---

## 1. Release Summary & What's Included

* **Category Label Updates**: `"Structural"` → `"Standing water - Other"`
* **PDF Report Enhancements**:
  * Added secondary alphabetical parcel sorting within each group.
  * Corrected PDF sort popup option: `"(grouped by source type)"`.
  * Added dark headers when sorting by Category, Escalated Person, or Quadrant.
* **Repeat Visit Defaults**: `"Assigned / Escalated to"` field auto-populates from the previous visit.
* **Admin Panel & Backend**:
  * Server-side sorting for the *"Sites"* column in the Admin Users table.
  * Invalidation of `admin_sites` and `admin_users` cache on user role/site assignment changes.
  * Support for multi-coordinate and DMS formatted parcel XLSX uploads.
* **GPS & Security**:
  * High-accuracy HTML5 Geolocation API (`enableHighAccuracy: true`, `timeout: 15000`).
  * 60-Minute inactivity session auto-logout.
  * Firefox and PWA favicon support.

---

## 2. Environment Variables & Prerequisites

Ensure the following environment variables are configured in your cloud dashboard (Render):

| Variable | Sample Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Production environment mode |
| `PORT` | `10000` | Application port |
| `DATABASE_URL` | `postgres://user:pass@host:5432/dbname` | PostgreSQL connection URI |
| `JWT_SECRET` | `<secure-random-32-char-key>` | JWT signing key |
| `S3_BUCKET_NAME` | `pestrack-photos` | AWS S3 / Cloud Object Storage bucket |
| `AWS_ACCESS_KEY_ID` | `<access-key>` | Object storage credentials |
| `AWS_SECRET_ACCESS_KEY`| `<secret-key>` | Object storage credentials |
| `AWS_REGION` | `us-east-1` | Object storage region |

---

## 3. Deployment Steps

### Step 1: Database Migrations & Seeds
Run database migrations to apply schema updates and category label migration (`004_update_category_label.sql`):
```bash
cd apps/backend
npm run migrate
```

*(Optional for new deployments)* Seed initial sites, categories, and reference data:
```bash
npm run seed
```

### Step 2: Build & Package Frontend
Build the Vite React frontend for production static serving:
```bash
cd apps/frontend
npm run build
```

### Step 3: Start Node/Express Server
Start the production server (which serves the API and static `PesTrack.html`):
```bash
cd apps/backend
npm start
```

---

## 4. Verification & Smoke Test Checklist

After deployment, perform a quick 5-minute smoke test:

1. **Category Label Check**:
   * Open `https://<your-app-domain>/PesTrack.html`.
   * Click **Add Finding** → verify category dropdown lists **`Standing water - Other`** (purple badge).

2. **Repeat Visit Default**:
   * Select a finding with an assigned person → click **"+ Add New Visit"**.
   * Verify *"Assigned / Escalated to"* defaults to the previous visit's assigned person.

3. **PDF Report Generation**:
   * Click **PDF Report** → generate PDFs using Category, Escalated Person, and Quadrant sort options.
   * Verify dark category headers render cleanly.

4. **Admin Panel Site Sorting**:
   * Log into `/admin/users` → click **Sites** column header → verify table sorts alphabetically.

5. **Session Expiry**:
   * Confirm session auto-logouts after 60 minutes of inactivity.
