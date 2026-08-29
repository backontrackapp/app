<?php

declare(strict_types=1);

return [
    'version' => '202608290001',
    'name' => 'flashcard_speech_rate',
    'up' => static function (\PDO $pdo): void {
        $tables = [
            'flashcard_review_sets' => 'back_speech_rate',
            'flashcard_review_set_preferences' => 'back_speech_rate',
            'flashcard_review_sessions' => 'back_speech_rate_snapshot',
        ];

        foreach ($tables as $table => $column) {
            $columns = $pdo->query("PRAGMA table_info($table)")
                ->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE $table ADD COLUMN $column REAL NOT NULL DEFAULT 1.0",
                );
            }
        }
    },
];
