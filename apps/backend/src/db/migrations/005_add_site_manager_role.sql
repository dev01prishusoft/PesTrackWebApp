-- Migration 005: Add site_manager role documentation
-- In PostgreSQL users.role is VARCHAR(50) DEFAULT 'engineer', so 'site_manager' is directly supported.
-- This migration updates the column comment to document all valid roles according to RFQ Quote B.

COMMENT ON COLUMN users.role IS 'Valid roles: admin, site_manager, engineer, client_viewer';