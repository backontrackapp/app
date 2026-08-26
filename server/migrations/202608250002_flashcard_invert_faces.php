<?php

declare(strict_types=1);

return [
    'version' => '202608250002',
    'name' => 'flashcard_invert_faces',
    'up' => static function (\PDO $pdo): void {
        foreach ([
            'flashcard_review_sets' => 'invert_faces',
            'flashcard_review_set_preferences' => 'invert_faces',
            'flashcard_review_sessions' => 'invert_faces_snapshot',
        ] as $table => $column) {
            $columns = $pdo->query("PRAGMA table_info({$table})")
                ->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} INTEGER NOT NULL DEFAULT 0",
                );
            }
        }
    },
];
