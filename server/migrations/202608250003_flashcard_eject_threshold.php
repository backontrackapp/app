<?php

declare(strict_types=1);

return [
    'version' => '202608250003',
    'name' => 'flashcard_eject_threshold',
    'up' => static function (\PDO $pdo): void {
        $columns = [
            'flashcards' => [
                'eject_count' => "INTEGER NOT NULL DEFAULT 0",
            ],
            'flashcard_review_sets' => [
                'eject_exclude_after' => "INTEGER NOT NULL DEFAULT 3",
            ],
            'flashcard_review_set_preferences' => [
                'eject_exclude_after' => "INTEGER NOT NULL DEFAULT 3",
            ],
            'flashcard_review_card_stats' => [
                'eject_count' => "INTEGER NOT NULL DEFAULT 0",
            ],
            'flashcard_review_sessions' => [
                'eject_exclude_after_snapshot' => "INTEGER NOT NULL DEFAULT 3",
            ],
        ];
        foreach ($columns as $table => $definitions) {
            $existing = $pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
            foreach ($definitions as $column => $definition) {
                if (!in_array($column, $existing, true)) {
                    $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
                }
            }
        }
    },
];
