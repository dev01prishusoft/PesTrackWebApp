-- Migration 007: Consolidate 'SOTAICOs' to 'SOTAICO' in escalation_options
DO $$
DECLARE
    sotaico_id UUID;
    sotaicos_id UUID;
BEGIN
    SELECT id INTO sotaico_id FROM escalation_options WHERE label = 'SOTAICO';
    SELECT id INTO sotaicos_id FROM escalation_options WHERE label = 'SOTAICOs';

    IF sotaicos_id IS NOT NULL THEN
        IF sotaico_id IS NOT NULL THEN
            -- Both exist: point any visits referencing SOTAICOs to SOTAICO, then remove SOTAICOs
            UPDATE visits SET escalated_to_id = sotaico_id WHERE escalated_to_id = sotaicos_id;
            DELETE FROM escalation_options WHERE id = sotaicos_id;
        ELSE
            -- Only SOTAICOs exists: rename it to SOTAICO
            UPDATE escalation_options SET label = 'SOTAICO' WHERE id = sotaicos_id;
        END IF;
    END IF;
END $$;
