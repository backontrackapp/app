<?php

declare(strict_types=1);

return [
    'version' => '202609030002',
    'name' => 'tracker_goal_versions',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tracking_trackers
                ADD COLUMN goal_versions JSON NOT NULL DEFAULT '[]';

            UPDATE tracking_trackers
            SET goal_versions = json_array(json_object(
                'effectiveDate', '0001-01-01',
                'targetValue', target_value,
                'targetOperator', CASE
                    WHEN target_operator IN ('gte', 'lte', 'eq') THEN target_operator
                    ELSE 'gte'
                END,
                'trackingWindow', CASE
                    WHEN tracking_window = 'week' THEN 'week'
                    ELSE 'occurrence'
                END
            ))
            WHERE target_value > 0;
            SQL);
    },
];
