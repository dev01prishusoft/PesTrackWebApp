-- Migration 006: Update escalation options (Quote C2)
-- 1. Rename 'Client QA' to 'Client Super' in escalation_options
-- Any visits referencing this record's UUID (escalated_to_id) will automatically reflect 'Client Super'
UPDATE escalation_options 
SET label = 'Client Super' 
WHERE label = 'Client QA';

-- 2. Adjust sort_orders to make room for 'Client Other' right after 'Client Subcontractor Other' (sort_order 6)
UPDATE escalation_options 
SET sort_order = sort_order + 1 
WHERE sort_order >= 7;

-- 3. Insert 'Client Other' with sort_order = 7
INSERT INTO escalation_options (label, sort_order)
VALUES ('Client Other', 7)
ON CONFLICT (label) DO UPDATE SET sort_order = EXCLUDED.sort_order;
