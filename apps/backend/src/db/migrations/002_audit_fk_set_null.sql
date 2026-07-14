-- Change the foreign key constraints on audit_logs to ON DELETE SET NULL
-- so that if a site is deleted, the audit log entries related to it are
-- preserved (so we know who deleted it) but the DB does not block the deletion.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_site_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;
