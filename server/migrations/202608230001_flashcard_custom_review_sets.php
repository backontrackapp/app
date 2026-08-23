<?php

declare(strict_types=1);

return [
    'version' => '202608230001',
    'name' => 'flashcard_custom_review_sets',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sets)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('selection_mode', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets
                 ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'tags'",
            );
        }
        if (!in_array('included_cards', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets
                 ADD COLUMN included_cards JSON NOT NULL DEFAULT '[]'",
            );
        }

        $changedAt = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        $pdo->exec(
            "DROP TRIGGER IF EXISTS sync_accessible_review_set_update;
             DROP TRIGGER IF EXISTS sync_review_set_share_insert;
             DROP TRIGGER IF EXISTS sync_review_set_share_update;
             DROP TRIGGER IF EXISTS sync_shared_card_insert;
             DROP TRIGGER IF EXISTS sync_shared_card_update;
             DROP TRIGGER IF EXISTS sync_shared_card_delete;

             CREATE TRIGGER sync_accessible_review_set_update AFTER UPDATE ON flashcard_review_sets BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.owner, 'accessible_flashcard_review_sets', NEW.id, 'upsert', {$changedAt});
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT recipient, 'accessible_flashcard_review_sets', NEW.id, 'upsert', {$changedAt}
                FROM flashcard_review_set_shares
                WHERE review_set = NEW.id AND recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', OLD.id || ':' || cards.id, 'delete', {$changedAt}
                FROM flashcard_review_set_shares AS shares
                JOIN flashcards AS cards ON cards.owner = OLD.owner
                WHERE shares.review_set = OLD.id AND shares.recipient <> ''
                  AND (
                    (OLD.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(OLD.included_cards) WHERE value = cards.id
                    ))
                    OR (OLD.selection_mode <> 'cards' AND (
                        json_array_length(OLD.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(OLD.tags) AS wanted
                            JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', NEW.id || ':' || cards.id, 'upsert', {$changedAt}
                FROM flashcard_review_set_shares AS shares
                JOIN flashcards AS cards ON cards.owner = NEW.owner
                WHERE shares.review_set = NEW.id AND shares.recipient <> ''
                  AND (
                    (NEW.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(NEW.included_cards) WHERE value = cards.id
                    ))
                    OR (NEW.selection_mode <> 'cards' AND (
                        json_array_length(NEW.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(NEW.tags) AS wanted
                            JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;

             CREATE TRIGGER sync_review_set_share_insert AFTER INSERT ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$changedAt}
                WHERE NEW.recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'review_set_cards', sets.id || ':' || cards.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcards AS cards ON cards.owner = sets.owner
                WHERE sets.id = NEW.review_set AND NEW.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = cards.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;

             CREATE TRIGGER sync_review_set_share_update AFTER UPDATE ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'accessible_flashcard_review_sets', OLD.review_set, 'delete', {$changedAt}
                WHERE OLD.recipient <> ''
                  AND (OLD.recipient <> NEW.recipient OR OLD.review_set <> NEW.review_set);
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'review_set_cards', OLD.review_set || ':' || cards.id, 'delete', {$changedAt}
                FROM flashcards AS cards
                JOIN flashcard_review_sets AS sets ON sets.id = OLD.review_set
                WHERE OLD.recipient <> ''
                  AND (OLD.recipient <> NEW.recipient OR OLD.review_set <> NEW.review_set)
                  AND cards.owner = sets.owner;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$changedAt}
                WHERE NEW.recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'review_set_cards', sets.id || ':' || cards.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcards AS cards ON cards.owner = sets.owner
                WHERE sets.id = NEW.review_set AND NEW.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = cards.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;

             CREATE TRIGGER sync_shared_card_insert AFTER INSERT ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || NEW.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = NEW.owner AND shares.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = NEW.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(NEW.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;

             CREATE TRIGGER sync_shared_card_update AFTER UPDATE ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || OLD.id, 'delete', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = OLD.owner AND shares.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = OLD.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(OLD.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || NEW.id, 'upsert', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = NEW.owner AND shares.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = NEW.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(NEW.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;

             CREATE TRIGGER sync_shared_card_delete AFTER DELETE ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || OLD.id, 'delete', {$changedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = OLD.owner AND shares.recipient <> ''
                  AND (
                    (sets.selection_mode = 'cards' AND EXISTS (
                        SELECT 1 FROM json_each(sets.included_cards) WHERE value = OLD.id
                    ))
                    OR (sets.selection_mode <> 'cards' AND (
                        json_array_length(sets.tags) = 0 OR EXISTS (
                            SELECT 1 FROM json_each(sets.tags) AS wanted
                            JOIN json_each(OLD.tags) AS assigned ON assigned.value = wanted.value
                        )
                    ))
                  );
             END;",
        );
    },
];
