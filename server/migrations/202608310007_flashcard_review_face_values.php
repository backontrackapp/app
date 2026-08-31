<?php

declare(strict_types=1);

return [
    'version' => '202608310007',
    'name' => 'flashcard_review_face_values',
    'up' => static function (\PDO $pdo): void {
        foreach ([
            'flashcard_review_sets' => 'front_display',
            'flashcard_review_set_preferences' => 'front_display',
            'flashcard_review_sessions' => 'front_display_snapshot',
        ] as $table => $column) {
            $columns = $pdo->query("PRAGMA table_info({$table})")
                ->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} TEXT NOT NULL DEFAULT 'front'",
                );
            }
        }
    },
];
