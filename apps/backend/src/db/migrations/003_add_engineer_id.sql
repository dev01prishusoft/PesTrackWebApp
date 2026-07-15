-- Add engineer_id to visits table
ALTER TABLE visits ADD COLUMN engineer_id UUID REFERENCES users(id);

-- Backfill existing data using created_by
UPDATE visits SET engineer_id = created_by WHERE engineer_id IS NULL;
