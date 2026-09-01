<?php

declare(strict_types=1);

return [
    'version' => '202609010001',
    'name' => 'remove_tracker_categories',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(tracking_trackers)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (in_array('category', $columns, true)) {
            $pdo->exec('ALTER TABLE tracking_trackers DROP COLUMN category');
        }

        $pdo->exec(<<<'SQL'
            UPDATE sync_record_versions
            SET field_clocks = json_remove(field_clocks, '$.category')
            WHERE resource = 'tracking_trackers'
            SQL);
    },
];
