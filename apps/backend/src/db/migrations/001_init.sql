-- ============================================
-- PesTrack initial schema
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. SITES
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    map_center_lat DECIMAL(10, 6),
    map_center_lng DECIMAL(10, 6),
    default_zoom INTEGER DEFAULT 15,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. USERS  (site assignment lives in user_sites, NOT here)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'engineer',   -- admin, engineer, client_viewer
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. USER_SITES  (many-to-many: users assigned to one or more sites)
CREATE TABLE IF NOT EXISTS user_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_user_sites_user_id ON user_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sites_site_id ON user_sites(site_id);

-- 4. REFERENCE TABLES (Created early for FK constraints)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(100) UNIQUE NOT NULL,
    color VARCHAR(7),
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(50) UNIQUE NOT NULL,
    color VARCHAR(7),
    emoji VARCHAR(10),
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS escalation_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(100) UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- 5. PARCELS  (must exist before locations, which references parcels(id))
CREATE TABLE IF NOT EXISTS parcels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID REFERENCES sites(id) NOT NULL,
    parcel_name VARCHAR(100) NOT NULL,
    coordinate VARCHAR(100),
    lat DECIMAL(10, 6),
    lng DECIMAL(10, 6),
    quadrant VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(site_id, parcel_name)
);
CREATE INDEX IF NOT EXISTS idx_parcels_site_id ON parcels(site_id);
CREATE INDEX IF NOT EXISTS idx_parcels_quadrant ON parcels(quadrant);

-- 6. LOCATIONS (findings)
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID REFERENCES sites(id) NOT NULL,
    lat DECIMAL(10, 6) NOT NULL,
    lng DECIMAL(10, 6) NOT NULL,
    parcel_id UUID REFERENCES parcels(id),
    ref_num VARCHAR(10),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_locations_site_id ON locations(site_id);
CREATE INDEX IF NOT EXISTS idx_locations_ref_num ON locations(ref_num);

-- 6. VISITS
CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    visit_date DATE NOT NULL,
    category_id UUID REFERENCES categories(id) NOT NULL,
    label VARCHAR(255),
    notes TEXT,
    escalated_to_id UUID REFERENCES escalation_options(id),
    status_id UUID REFERENCES statuses(id) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_location_id ON visits(location_id);
CREATE INDEX IF NOT EXISTS idx_visits_status_id ON visits(status_id);

-- 7. PHOTOS  (URL only; binary lives in file storage)
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    photo_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(50),
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photos_visit_id ON photos(visit_id);

-- 9. CONSTRUCTION ZONES (visual markers only)
CREATE TABLE IF NOT EXISTS construction_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID REFERENCES sites(id) NOT NULL,
    lat DECIMAL(10, 6) NOT NULL,
    lng DECIMAL(10, 6) NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_construction_zones_site_id ON construction_zones(site_id);

-- 10. AUDIT LOGS (immutable; who / what / when / IP mandatory)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    site_id UUID REFERENCES sites(id),
    action VARCHAR(20) NOT NULL,        -- CREATE / UPDATE / DELETE
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(255),
    old_values JSONB,                   -- optional field-level tracking
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
