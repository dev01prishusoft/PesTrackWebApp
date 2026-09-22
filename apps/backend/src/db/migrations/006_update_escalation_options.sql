-- Migration 006: Update escalation options (Quote C2)
-- 1. Rename 'Client QA' to 'Client Super' in escalation_options
-- Any visits referencing this record's UUID (escalated_to_id) will automatically reflect 'Client Super'
UPDATE escalation_options 
SET label = 'Client Super' 
WHERE label = 'Client QA';

-- 2. Adjust sort_orders: make sure 'Other' is 9 and 'Client Senior Management' is 7
UPDATE escalation_options 
SET sort_order = 9 
WHERE label = 'Other';

UPDATE escalation_options 
SET sort_order = 7 
WHERE label = 'Client Senior Management';

-- 3. Insert 'Client Other' with sort_order = 8
INSERT INTO escalation_options (label, sort_order)
VALUES ('Client Other', 8)
ON CONFLICT (label) DO UPDATE SET sort_order = EXCLUDED.sort_order;
