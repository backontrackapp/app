<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use DateInterval;
use DateTimeImmutable;
use PDO;

final class AnalyticsService
{
    private const EVENT_NAMES = ['session_started', 'session_ended', 'screen_viewed', 'action_completed'];
    private const SCREENS = [
        'tasks', 'task_editor', 'task_timer', 'program_runner',
        'intervals', 'interval_editor', 'interval_runner',
        'flashcards', 'card_library', 'card_editor', 'review_set_editor',
        'review_runner', 'curated_sets', 'curated_set',
        'tracking', 'tracking_editor', 'tracking_insights',
        'journal', 'journal_editor', 'account', 'settings',
    ];
    private const ACTIONS = [
        'task_editor_opened', 'task_created', 'task_progress_logged', 'task_completed',
        'interval_created', 'interval_started', 'interval_completed',
        'flashcard_created', 'review_set_created', 'review_started', 'review_completed',
        'tracking_logged', 'journal_created',
        'assistant_opened', 'assistant_request_sent',
        'review_set_shared', 'curated_set_cloned',
    ];
    private const EVENT_FIELDS = ['id', 'clientId', 'sessionId', 'name', 'screen', 'action', 'occurredAt', 'durationMs'];

    public function __construct(private readonly Database $database)
    {
    }

    public function ingest(array $user, array $body): array
    {
        if (!$this->enabled($user['settings'] ?? '{}')) {
            $this->deleteForAccount((string) $user['id']);
            return ['accepted' => 0, 'duplicates' => 0, 'disabled' => true];
        }
        if (array_is_list($body) || array_diff(array_keys($body), ['events', 'platform', 'appVersion']) !== []) {
            throw new ApiException(422, 'The analytics batch contains an unsupported field.');
        }
        $events = $body['events'] ?? null;
        if (!is_array($events) || !array_is_list($events) || $events === [] || count($events) > 50) {
            throw new ApiException(422, 'Provide between 1 and 50 analytics events.');
        }
        $platform = $this->shortText($body['platform'] ?? '', 20, 'platform');
        if (!in_array($platform, ['web', 'android', 'ios', 'unknown'], true)) {
            throw new ApiException(422, 'The analytics platform is invalid.');
        }
        $appVersion = $this->shortText($body['appVersion'] ?? '', 40, 'appVersion');
        $now = new DateTimeImmutable('now');
        $oldest = $now->sub(new DateInterval('P13M'));
        $newest = $now->add(new DateInterval('PT5M'));
        $normalized = [];
        foreach ($events as $event) {
            if (!is_array($event) || array_is_list($event)) {
                throw new ApiException(422, 'An analytics event is invalid.');
            }
            if (array_diff(array_keys($event), self::EVENT_FIELDS) !== []) {
                throw new ApiException(422, 'An analytics event contains an unsupported field.');
            }
            $id = $this->identifier($event['id'] ?? null, 'event id');
            $clientId = $this->identifier($event['clientId'] ?? null, 'client id');
            $sessionId = $this->identifier($event['sessionId'] ?? null, 'session id');
            $name = $this->shortText($event['name'] ?? '', 40, 'event name');
            $screen = $this->shortText($event['screen'] ?? '', 40, 'screen');
            $action = $this->shortText($event['action'] ?? '', 50, 'action');
            if (!in_array($name, self::EVENT_NAMES, true)) {
                throw new ApiException(422, 'The analytics event name is not allowed.');
            }
            if ($screen !== '' && !in_array($screen, self::SCREENS, true)) {
                throw new ApiException(422, 'The analytics screen is not allowed.');
            }
            if ($action !== '' && !in_array($action, self::ACTIONS, true)) {
                throw new ApiException(422, 'The analytics action is not allowed.');
            }
            if (($name === 'screen_viewed' && $screen === '') || ($name !== 'screen_viewed' && $screen !== '')) {
                throw new ApiException(422, 'The analytics screen does not match the event.');
            }
            if (($name === 'action_completed' && $action === '') || ($name !== 'action_completed' && $action !== '')) {
                throw new ApiException(422, 'The analytics action does not match the event.');
            }
            $occurredAtValue = $this->shortText($event['occurredAt'] ?? '', 40, 'occurredAt');
            try {
                $occurredAt = new DateTimeImmutable($occurredAtValue);
            } catch (\Throwable) {
                throw new ApiException(422, 'An analytics timestamp is invalid.');
            }
            if ($occurredAt < $oldest || $occurredAt > $newest) {
                throw new ApiException(422, 'An analytics timestamp is outside the retention window.');
            }
            $duration = $event['durationMs'] ?? 0;
            if (!is_int($duration) || $duration < 0 || $duration > 86400000) {
                throw new ApiException(422, 'The analytics duration is invalid.');
            }
            if ($name !== 'session_ended' && $duration !== 0) {
                throw new ApiException(422, 'Only completed sessions may include a duration.');
            }
            $normalized[] = compact('id', 'clientId', 'sessionId', 'name', 'screen', 'action', 'occurredAt', 'duration');
        }

        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM analytics_events WHERE received_at < :cutoff')
                ->execute(['cutoff' => $oldest->format('Y-m-d\TH:i:s.v\Z')]);
            $insert = $pdo->prepare(
                'INSERT OR IGNORE INTO analytics_events (
                    id, account_id, client_id, session_id, event_name, screen, action,
                    occurred_at, received_at, duration_ms, platform, app_version
                 ) VALUES (
                    :id, :account_id, :client_id, :session_id, :event_name, :screen, :action,
                    :occurred_at, :received_at, :duration_ms, :platform, :app_version
                 )',
            );
            $accepted = 0;
            $receivedAt = $now->format('Y-m-d\TH:i:s.v\Z');
            foreach ($normalized as $event) {
                $insert->execute([
                    'id' => $event['id'], 'account_id' => $user['id'],
                    'client_id' => $event['clientId'], 'session_id' => $event['sessionId'],
                    'event_name' => $event['name'], 'screen' => $event['screen'], 'action' => $event['action'],
                    'occurred_at' => $event['occurredAt']->format('Y-m-d\TH:i:s.v\Z'),
                    'received_at' => $receivedAt, 'duration_ms' => $event['duration'],
                    'platform' => $platform, 'app_version' => $appVersion,
                ]);
                $accepted += $insert->rowCount();
            }
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
        return ['accepted' => $accepted, 'duplicates' => count($normalized) - $accepted, 'disabled' => false];
    }

    public function deleteForAccount(string $account): void
    {
        $this->database->pdo->prepare('DELETE FROM analytics_events WHERE account_id = :account')
            ->execute(['account' => $account]);
    }

    public function enabled(mixed $settings): bool
    {
        if (is_string($settings)) $settings = json_decode($settings, true);
        return !is_array($settings) || ($settings['productAnalyticsEnabled'] ?? true) !== false;
    }

    private function identifier(mixed $value, string $field): string
    {
        if (!is_string($value) || preg_match('/^[A-Za-z0-9_-]{12,64}$/D', $value) !== 1) {
            throw new ApiException(422, "The analytics {$field} is invalid.");
        }
        return $value;
    }

    private function shortText(mixed $value, int $maximum, string $field): string
    {
        if (!is_string($value) || strlen($value) > $maximum || preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            throw new ApiException(422, "The analytics {$field} is invalid.");
        }
        return $value;
    }
}
