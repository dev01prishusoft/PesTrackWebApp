-- Migration 004: Update category label 'Structural' to 'Standing water - Other'
UPDATE categories
SET label = 'Standing water - Other'
WHERE label = 'Structural';
