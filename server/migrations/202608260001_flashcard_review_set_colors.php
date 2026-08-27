<?php

declare(strict_types=1);

return [
    'version' => '202608260001',
    'name' => 'flashcard_review_set_colors',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(flashcard_review_sets)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('color', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets ADD COLUMN color VARCHAR(20) NOT NULL DEFAULT '#C7F464'",
            );
        }
    },
];
