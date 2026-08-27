<?php

declare(strict_types=1);

return [
    'version' => '202608270002',
    'name' => 'interval_template_icons',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(interval_templates)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('icon', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_templates ADD COLUMN icon VARCHAR(64) NOT NULL DEFAULT ''",
            );
        }
    },
];
