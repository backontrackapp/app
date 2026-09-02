<?php

declare(strict_types=1);

return [
    'version' => '202609020001',
    'name' => 'task_schedule_times',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(tasks)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('scheduled_times', $columns, true)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN scheduled_times JSON NOT NULL DEFAULT '[]'");
        }

        $tasks = $pdo->query(
            "SELECT id, scheduled_time FROM tasks
             WHERE schedule_mode = 'time_based' AND scheduled_time <> ''",
        )->fetchAll(\PDO::FETCH_ASSOC);
        $update = $pdo->prepare('UPDATE tasks SET scheduled_times = :scheduled_times WHERE id = :id');
        foreach ($tasks as $task) {
            $update->execute([
                'scheduled_times' => json_encode([(string) $task['scheduled_time']], JSON_THROW_ON_ERROR),
                'id' => $task['id'],
            ]);
        }
    },
];
