<?php

declare(strict_types=1);

return [
    'version' => '202608250001',
    'name' => 'archive_content',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE flashcards
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE interval_templates
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE flashcard_review_sets
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE tracking_trackers
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE journal_entries
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;

            CREATE INDEX idx_flashcards_owner_archived_created
                ON flashcards (owner, archived, created_at DESC);
            CREATE INDEX idx_interval_templates_owner_archived_order
                ON interval_templates (owner, archived, sort_order);
            CREATE INDEX idx_flashcard_review_sets_owner_archived_order
                ON flashcard_review_sets (owner, archived, sort_order, name);
            CREATE INDEX idx_tracking_trackers_owner_archived_order
                ON tracking_trackers (owner, archived, sort_order);
            CREATE INDEX idx_journal_entries_owner_archived_date
                ON journal_entries (owner, archived, local_date, occurred_at DESC);
            SQL);
    },
];
