<?php

declare(strict_types=1);

return [
    'version' => '202608270003',
    'name' => 'task_icons',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(tasks)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('icon', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE tasks ADD COLUMN icon VARCHAR(64) NOT NULL DEFAULT ''",
            );
        }
    },
];
