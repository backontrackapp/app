<?php

declare(strict_types=1);

return [
    'version' => '202609020002',
    'name' => 'occurrence_schedule_times',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE occurrences
                ADD COLUMN scheduled_time TEXT NOT NULL DEFAULT '';
            ALTER TABLE interval_sessions
                ADD COLUMN task_scheduled_time TEXT NOT NULL DEFAULT '';
            ALTER TABLE flashcard_review_sessions
                ADD COLUMN task_scheduled_time TEXT NOT NULL DEFAULT '';

            UPDATE occurrences
            SET scheduled_time = COALESCE(
                (
                    SELECT CASE
                        WHEN json_valid(tasks.scheduled_times)
                        THEN json_extract(tasks.scheduled_times, '$[0]')
                        ELSE tasks.scheduled_time
                    END
                    FROM tasks
                    WHERE tasks.id = occurrences.task
                      AND tasks.schedule_mode = 'time_based'
                ),
                ''
            );

            UPDATE interval_sessions
            SET task_scheduled_time = COALESCE(
                (
                    SELECT CASE
                        WHEN json_valid(tasks.scheduled_times)
                        THEN json_extract(tasks.scheduled_times, '$[0]')
                        ELSE tasks.scheduled_time
                    END
                    FROM tasks
                    WHERE tasks.id = interval_sessions.task
                      AND tasks.schedule_mode = 'time_based'
                ),
                ''
            )
            WHERE task <> '';

            UPDATE flashcard_review_sessions
            SET task_scheduled_time = COALESCE(
                (
                    SELECT CASE
                        WHEN json_valid(tasks.scheduled_times)
                        THEN json_extract(tasks.scheduled_times, '$[0]')
                        ELSE tasks.scheduled_time
                    END
                    FROM tasks
                    WHERE tasks.id = flashcard_review_sessions.task
                      AND tasks.schedule_mode = 'time_based'
                ),
                ''
            )
            WHERE task <> '';

            DROP INDEX idx_occurrences_unique;
            CREATE UNIQUE INDEX idx_occurrences_unique
                ON occurrences (task, program_step, scheduled_date, scheduled_time);
            SQL);
    },
];
