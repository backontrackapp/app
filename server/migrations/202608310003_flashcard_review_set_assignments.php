<?php

declare(strict_types=1);

return [
    'version' => '202608310003',
    'name' => 'flashcard_review_set_assignments',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(flashcard_review_sets)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('assigned_cards', $columns, true)) {
            $pdo->exec("ALTER TABLE flashcard_review_sets ADD COLUMN assigned_cards JSON NOT NULL DEFAULT '[]'");
        }

        $sets = $pdo->query(
            'SELECT id, selection_mode, included_cards FROM flashcard_review_sets',
        )->fetchAll(\PDO::FETCH_ASSOC);
        $update = $pdo->prepare(
            'UPDATE flashcard_review_sets
             SET assigned_cards = :assigned_cards, selection_mode = \'cards\', included_cards = :included_cards
             WHERE id = :id',
        );
        foreach ($sets as $set) {
            $included = (string) ($set['selection_mode'] ?? 'tags') === 'cards'
                ? json_decode((string) ($set['included_cards'] ?? '[]'), true)
                : [];
            $included = is_array($included) ? array_values(array_filter($included, 'is_string')) : [];
            $encoded = json_encode($included, JSON_THROW_ON_ERROR);
            $update->execute([
                'assigned_cards' => $encoded,
                'included_cards' => $encoded,
                'id' => $set['id'],
            ]);
        }

        // Keep legacy sync triggers correct until their table rebuild removes the retired columns.
        // Membership remains defined solely by assigned_cards; the legacy fields are mirrors.
        $pdo->exec(
            "DROP TRIGGER IF EXISTS normalize_review_set_assignments_insert;
             DROP TRIGGER IF EXISTS normalize_review_set_assignments_update;
             CREATE TRIGGER normalize_review_set_assignments_insert
             AFTER INSERT ON flashcard_review_sets BEGIN
                UPDATE flashcard_review_sets
                SET selection_mode = 'cards', included_cards = NEW.assigned_cards
                WHERE id = NEW.id;
             END;
             CREATE TRIGGER normalize_review_set_assignments_update
             AFTER UPDATE OF assigned_cards ON flashcard_review_sets BEGIN
                UPDATE flashcard_review_sets
                SET selection_mode = 'cards', included_cards = NEW.assigned_cards
                WHERE id = NEW.id;
             END;",
        );
    },
];
