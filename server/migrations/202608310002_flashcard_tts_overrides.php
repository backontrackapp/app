<?php

declare(strict_types=1);

return [
    'version' => '202608310002',
    'name' => 'flashcard_tts_overrides',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(flashcards)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        foreach (['tts_front', 'tts_back'] as $column) {
            if (!in_array($column, $columns, true)) {
                $pdo->exec("ALTER TABLE flashcards ADD COLUMN {$column} TEXT NOT NULL DEFAULT ''");
            }
        }
    },
];
