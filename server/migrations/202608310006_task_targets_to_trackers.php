<?php

declare(strict_types=1);

return [
    'version' => '202608310006',
    'name' => 'task_targets_to_trackers',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tracking_trackers ADD COLUMN target_value NUMERIC NOT NULL DEFAULT 0;
            ALTER TABLE tracking_trackers ADD COLUMN target_operator TEXT NOT NULL DEFAULT 'gte';
            ALTER TABLE tracking_trackers ADD COLUMN tracking_window TEXT NOT NULL DEFAULT 'occurrence';
            ALTER TABLE tracking_trackers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
            ALTER TABLE tracking_entries ADD COLUMN source_type TEXT NOT NULL DEFAULT '';
            ALTER TABLE tracking_entries ADD COLUMN source_session TEXT NOT NULL DEFAULT '';
            SQL);

        $tasks = $pdo->query(
            "SELECT * FROM tasks WHERE type IN ('duration', 'daily_total', 'step_counter') ORDER BY sort_order, id",
        )->fetchAll(\PDO::FETCH_ASSOC);
        if ($tasks === []) {
            return;
        }

        $insertTracker = $pdo->prepare(
            'INSERT INTO tracking_trackers (
                id, owner, name, description, role, kind, category, unit,
                target_value, target_operator, tracking_window, source,
                scale_min, scale_max, favorable_direction, daily_aggregation,
                active, archived, sort_order, color, icon
            ) VALUES (
                :id, :owner, :name, :description, :role, :kind, :category, :unit,
                :target_value, :target_operator, :tracking_window, :source,
                0, 0, :favorable_direction, :daily_aggregation,
                :active, :archived, :sort_order, :color, :icon
            )',
        );
        $insertEntry = $pdo->prepare(
            'INSERT INTO tracking_entries (
                owner, tracker, occurred_at, local_date, timezone_offset, value, note,
                source_type, source_session
            ) VALUES (
                :owner, :tracker, :occurred_at, :local_date, 0, :value, :note,
                :source_type, :source_session
            )',
        );
        $taskEntries = $pdo->prepare(
            'SELECT entry_date, created_at, value, note, label, source_type, source_session
             FROM entries WHERE owner = :owner AND task = :task AND program_step = \'\'',
        );
        $updateTask = $pdo->prepare(
            "UPDATE tasks
             SET type = 'tracking', tracking_trackers = :tracking_trackers,
                 target_value = 0, target_operator = '', unit = '', custom_unit = '', goal_period = '',
                 icon = :icon
             WHERE id = :id AND owner = :owner",
        );

        foreach ($tasks as $task) {
            $type = (string) $task['type'];
            $isDuration = $type === 'duration';
            $isSteps = $type === 'step_counter';
            $trackerId = 'r' . bin2hex(random_bytes(7));
            $targetValue = (float) ($task['target_value'] ?? 0);
            if ($isDuration) {
                $targetValue *= 3600;
            }
            $unit = $isDuration
                ? 'seconds'
                : ($isSteps ? 'steps' : (string) ($task['custom_unit'] ?: $task['unit'] ?: ''));
            $trackingWindow = ($task['goal_period'] ?? '') === 'week' ? 'week' : 'occurrence';
            $icon = (string) ($task['icon'] ?? '');
            if ($icon === '') {
                $icon = $isDuration
                    ? 'mdi-timer-outline'
                    : ($isSteps ? 'mdi-shoe-print' : 'mdi-chart-donut');
            }
            $insertTracker->execute([
                'id' => $trackerId,
                'owner' => $task['owner'],
                'name' => $task['name'],
                'description' => $task['description'],
                'role' => 'factor',
                'kind' => $isDuration ? 'duration' : 'number',
                'category' => $isSteps ? 'activity' : 'other',
                'unit' => $unit,
                'target_value' => $targetValue,
                'target_operator' => $task['target_operator'] ?: 'gte',
                'tracking_window' => $trackingWindow,
                'source' => $isSteps ? 'health_connect_steps' : 'manual',
                'favorable_direction' => 'neutral',
                'daily_aggregation' => 'sum',
                'active' => $task['active'],
                'archived' => $task['archived'],
                'sort_order' => $task['sort_order'],
                'color' => $task['color'] ?: '#C7F464',
                'icon' => $icon,
            ]);

            $taskEntries->execute(['owner' => $task['owner'], 'task' => $task['id']]);
            foreach ($taskEntries->fetchAll(\PDO::FETCH_ASSOC) as $entry) {
                $date = (string) $entry['entry_date'];
                $occurredAt = (string) ($entry['created_at'] ?: "{$date}T12:00:00.000Z");
                $value = (float) $entry['value'];
                if ($isDuration) {
                    $value *= 3600;
                }
                $sourceSession = (string) ($entry['source_session'] ?? '');
                $isHealthConnect = $isSteps && (
                    (string) ($entry['source_type'] ?? '') === 'health_connect'
                    || str_starts_with($sourceSession, 'health-connect:')
                );
                $insertEntry->execute([
                    'owner' => $task['owner'],
                    'tracker' => $trackerId,
                    'occurred_at' => $occurredAt,
                    'local_date' => $date,
                    'value' => $value,
                    'note' => (string) ($entry['label'] ?: $entry['note'] ?: ''),
                    'source_type' => $isHealthConnect ? 'health_connect' : '',
                    'source_session' => $isHealthConnect
                        ? ($sourceSession ?: "health-connect:{$date}")
                        : '',
                ]);
            }

            $updateTask->execute([
                'tracking_trackers' => json_encode([$trackerId], JSON_THROW_ON_ERROR),
                'icon' => $icon,
                'id' => $task['id'],
                'owner' => $task['owner'],
            ]);
        }
    },
];
