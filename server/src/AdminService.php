<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use DateInterval;
use DatePeriod;
use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use PDO;

final class AdminService
{
    private const LOGIN_CODE_TTL = 600;
    private const MAX_CODE_ATTEMPTS = 5;
    private const EVENT_RETENTION = '-13 months';
    private const FEATURE_ICONS = [
        'tasks' => 'mdi-checkbox-marked-circle-outline',
        'intervals' => 'mdi-timer-outline',
        'flashcards' => 'mdi-cards-outline',
        'tracking' => 'mdi-chart-box-outline',
        'journal' => 'mdi-book-open-variant-outline',
        'assistant' => 'mdi-auto-fix',
        'sharing' => 'mdi-account-multiple-plus-outline',
    ];

    public function __construct(
        private readonly Database $database,
        private readonly Config $config,
        private readonly Mailer $mailer,
    ) {
    }

    public function requestLogin(array $body, string $ip, string $userAgent): array
    {
        $email = strtolower(trim(is_string($body['email'] ?? null) ? $body['email'] : ''));
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        if ($email === '' || strlen($email) > 254 || strlen($password) > 128) {
            throw new ApiException(401, 'The administrator credentials are invalid.');
        }
        $this->rateLimit('admin-login-ip:' . $ip, 12, 900);
        $this->rateLimit('admin-login-email:' . hash('sha256', $email), 12, 900);

        $statement = $this->database->pdo->prepare(
            'SELECT * FROM users WHERE email = :email COLLATE NOCASE LIMIT 1',
        );
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();
        if (
            !is_array($user)
            || !(bool) $user['verified']
            || (string) ($user['admin_role'] ?? '') !== 'admin'
            || !password_verify($password, (string) $user['password'])
        ) {
            $this->audit(null, 'login_failed', null, $ip, $userAgent);
            throw new ApiException(401, 'The administrator credentials are invalid.');
        }

        $id = $this->base64UrlEncode(random_bytes(24));
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $now = time();
        $this->database->pdo->prepare(
            'DELETE FROM admin_login_challenges WHERE expires_at < :now OR user_id = :user_id',
        )->execute(['now' => $now, 'user_id' => $user['id']]);
        $this->database->pdo->prepare(
            'INSERT INTO admin_login_challenges (
                id, user_id, code_hash, attempts, expires_at, created_at
             ) VALUES (
                :id, :user_id, :code_hash, 0, :expires_at, :created_at
             )',
        )->execute([
            'id' => $id,
            'user_id' => $user['id'],
            'code_hash' => $this->challengeHash($id, $code),
            'expires_at' => $now + self::LOGIN_CODE_TTL,
            'created_at' => $now,
        ]);
        try {
            $this->mailer->sendAdminLoginCode((string) $user['email'], $code);
        } catch (\Throwable $exception) {
            $this->database->pdo->prepare('DELETE FROM admin_login_challenges WHERE id = :id')
                ->execute(['id' => $id]);
            throw $exception;
        }
        $this->audit((string) $user['id'], 'login_code_sent', null, $ip, $userAgent);
        return [
            'challengeId' => $id,
            'maskedEmail' => $this->maskedEmail((string) $user['email']),
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $now + self::LOGIN_CODE_TTL),
        ];
    }

    public function verifyLogin(array $body, string $ip, string $userAgent): array
    {
        $id = is_string($body['challengeId'] ?? null) ? $body['challengeId'] : '';
        $code = is_string($body['code'] ?? null) ? trim($body['code']) : '';
        if (preg_match('/^[A-Za-z0-9_-]{32}$/D', $id) !== 1 || preg_match('/^\d{6}$/D', $code) !== 1) {
            throw new ApiException(401, 'The verification code is invalid or expired.');
        }
        $this->rateLimit('admin-verify-ip:' . $ip, 20, 900);
        $statement = $this->database->pdo->prepare(
            'SELECT c.*, u.* FROM admin_login_challenges c
             INNER JOIN users u ON u.id = c.user_id
             WHERE c.id = :id LIMIT 1',
        );
        $statement->execute(['id' => $id]);
        $challenge = $statement->fetch();
        if (!is_array($challenge) || (int) $challenge['expires_at'] < time()) {
            $this->database->pdo->prepare('DELETE FROM admin_login_challenges WHERE id = :id')
                ->execute(['id' => $id]);
            throw new ApiException(401, 'The verification code is invalid or expired.');
        }
        if ((int) $challenge['attempts'] >= self::MAX_CODE_ATTEMPTS) {
            $this->database->pdo->prepare('DELETE FROM admin_login_challenges WHERE id = :id')
                ->execute(['id' => $id]);
            throw new ApiException(429, 'Too many verification attempts. Sign in again.');
        }
        if (!hash_equals((string) $challenge['code_hash'], $this->challengeHash($id, $code))) {
            $this->database->pdo->prepare(
                'UPDATE admin_login_challenges SET attempts = attempts + 1 WHERE id = :id',
            )->execute(['id' => $id]);
            $this->audit((string) $challenge['user_id'], 'login_code_failed', null, $ip, $userAgent);
            throw new ApiException(401, 'The verification code is invalid or expired.');
        }
        if (!(bool) $challenge['verified'] || (string) $challenge['admin_role'] !== 'admin') {
            throw new ApiException(403, 'Administrator access has been removed.');
        }
        $this->database->pdo->prepare('DELETE FROM admin_login_challenges WHERE id = :id')
            ->execute(['id' => $id]);
        $this->audit((string) $challenge['user_id'], 'login_succeeded', null, $ip, $userAgent);
        return [
            'token' => $this->createToken($challenge),
            'admin' => $this->adminRecord($challenge),
        ];
    }

    public function authenticate(string $authorization): array
    {
        if (!str_starts_with(trim($authorization), 'Bearer ')) {
            throw new ApiException(401, 'Administrator authentication is required.');
        }
        $token = trim(substr(trim($authorization), 7));
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new ApiException(401, 'The administrator token is invalid.');
        }
        [$encodedHeader, $encodedPayload, $providedSignature] = $parts;
        $expected = $this->base64UrlEncode(hash_hmac(
            'sha256',
            $encodedHeader . '.' . $encodedPayload,
            $this->config->secret,
            true,
        ));
        if (!hash_equals($expected, $providedSignature)) {
            throw new ApiException(401, 'The administrator token is invalid.');
        }
        try {
            $header = json_decode($this->base64UrlDecode($encodedHeader), true, flags: JSON_THROW_ON_ERROR);
            $payload = json_decode($this->base64UrlDecode($encodedPayload), true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(401, 'The administrator token is invalid.');
        }
        if (
            !is_array($header)
            || ($header['alg'] ?? null) !== 'HS256'
            || ($header['typ'] ?? null) !== 'JWT'
            || !is_array($payload)
            || ($payload['scope'] ?? null) !== 'admin'
            || !is_string($payload['sub'] ?? null)
            || !is_int($payload['exp'] ?? null)
            || $payload['exp'] < time()
            || !is_string($payload['ver'] ?? null)
        ) {
            throw new ApiException(401, 'The administrator token is invalid or expired.');
        }
        $statement = $this->database->pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $statement->execute(['id' => $payload['sub']]);
        $user = $statement->fetch();
        if (
            !is_array($user)
            || !(bool) $user['verified']
            || (string) ($user['admin_role'] ?? '') !== 'admin'
            || !hash_equals($this->tokenVersion((string) $user['token_key']), $payload['ver'])
        ) {
            throw new ApiException(401, 'Administrator access is no longer valid.');
        }
        return $user;
    }

    public function me(array $admin): array
    {
        return ['admin' => $this->adminRecord($admin)];
    }

    public function overview(array $query): array
    {
        $range = $this->dateRange($query);
        $previous = $this->previousRange($range);
        $totalUsers = $this->count('SELECT COUNT(*) FROM users');
        $newUsers = $this->countBetween('users', 'created', $range);
        $previousNewUsers = $this->countBetween('users', 'created', $previous);
        $activeUsers = $this->activeUsers($range);
        $previousActiveUsers = $this->activeUsers($previous);
        $activationRate = $this->activationRate($range);
        $previousActivationRate = $this->activationRate($previous);
        $retention = $this->fourWeekRetention($range);
        $errorFree = $this->errorFreeRate($range);
        $features = $this->featureMetrics($range, $activeUsers);

        return [
            'range' => $this->rangeResponse($range),
            'metrics' => [
                'totalUsers' => $this->metric($totalUsers),
                'newUsers' => $this->metric($newUsers, $previousNewUsers),
                'activeUsers' => $this->metric($activeUsers, $previousActiveUsers),
                'activationRate' => $this->metric($activationRate, $previousActivationRate, 'percent'),
                'fourWeekRetention' => $this->metric($retention, null, 'percent'),
                'errorFreeRate' => $this->metric($errorFree, null, 'percent'),
            ],
            'registrations' => $this->dailySeries(
                $this->rows('SELECT created AS occurred_at FROM users WHERE created >= :start AND created < :end', $this->rangeParams($range)),
                $range,
            ),
            'activity' => $this->dailySeries(
                $this->rows("SELECT account_id, occurred_at FROM analytics_events WHERE event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end", $this->rangeParams($range)),
                $range,
                true,
            ),
            'activation' => [
                ['label' => 'Registered', 'value' => $newUsers],
                ['label' => 'Opened the app', 'value' => $this->count(
                    "SELECT COUNT(DISTINCT u.id) FROM users u INNER JOIN analytics_events e ON e.account_id = u.id AND e.event_name = 'session_started' WHERE u.created >= :start AND u.created < :end",
                    $this->rangeParams($range),
                )],
                ['label' => 'Configured a feature', 'value' => $this->configuredUsers($range)],
                ['label' => 'Reached a meaningful outcome', 'value' => $this->activatedUsers($range)],
            ],
            'features' => $features,
        ];
    }

    public function engagement(array $query): array
    {
        $range = $this->dateRange($query);
        $end = $range['end'];
        $day = ['start' => $end->sub(new DateInterval('P1D')), 'end' => $end, 'timezone' => $range['timezone']];
        $week = ['start' => $end->sub(new DateInterval('P7D')), 'end' => $end, 'timezone' => $range['timezone']];
        $month = ['start' => $end->sub(new DateInterval('P30D')), 'end' => $end, 'timezone' => $range['timezone']];
        $dau = $this->activeUsers($day);
        $wau = $this->activeUsers($week);
        $mau = $this->activeUsers($month);
        $sessions = $this->count(
            "SELECT COUNT(*) FROM analytics_events WHERE event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end",
            $this->rangeParams($range),
        );
        $averageDuration = (float) $this->scalar(
            "SELECT COALESCE(AVG(duration_ms) / 60000.0, 0) FROM analytics_events WHERE event_name = 'session_ended' AND occurred_at >= :start AND occurred_at < :end AND duration_ms > 0",
            $this->rangeParams($range),
        );
        $activity = $this->rollingActivity($range);
        $screens = $this->rows(
            "SELECT screen AS name, COUNT(*) AS views, COUNT(DISTINCT account_id) AS users
             FROM analytics_events
             WHERE event_name = 'screen_viewed' AND occurred_at >= :start AND occurred_at < :end AND screen <> ''
             GROUP BY screen ORDER BY views DESC LIMIT 20",
            $this->rangeParams($range),
        );
        return [
            'range' => $this->rangeResponse($range),
            'metrics' => [
                'dau' => $this->metric($dau),
                'wau' => $this->metric($wau),
                'mau' => $this->metric($mau),
                'stickiness' => $this->metric($mau > 0 ? $dau / $mau * 100 : null, null, 'percent'),
                'sessions' => $this->metric($sessions),
                'averageSessionMinutes' => $this->metric($averageDuration, null, 'minutes'),
            ],
            'activity' => $activity,
            'screens' => array_map(static fn (array $row): array => [
                'name' => str_replace('_', ' ', (string) $row['name']),
                'views' => (int) $row['views'],
                'users' => (int) $row['users'],
            ], $screens),
            'cohorts' => $this->retentionCohorts($range),
        ];
    }

    public function features(array $query): array
    {
        $range = $this->dateRange($query);
        $activeUsers = $this->activeUsers($range);
        $actionCounts = $this->actionCounts($range);
        return [
            'range' => $this->rangeResponse($range),
            'activeUsers' => $activeUsers,
            'features' => $this->featureMetrics($range, $activeUsers),
            'funnels' => [
                ['name' => 'Task setup', 'steps' => $this->funnel($actionCounts, [
                    'task_editor_opened' => 'Editor opened', 'task_created' => 'Task created', 'task_completed' => 'Task completed',
                ])],
                ['name' => 'Interval session', 'steps' => $this->funnel($actionCounts, [
                    'interval_started' => 'Started', 'interval_completed' => 'Completed',
                ])],
                ['name' => 'Flashcard review', 'steps' => $this->funnel($actionCounts, [
                    'review_started' => 'Started', 'review_completed' => 'Completed',
                ])],
                ['name' => 'AI assistant', 'steps' => $this->funnel($actionCounts, [
                    'assistant_opened' => 'Opened', 'assistant_request_sent' => 'Request sent',
                ])],
            ],
        ];
    }

    public function reliability(array $query): array
    {
        $range = $this->dateRange($query);
        $parameters = $this->rangeParams($range);
        $active = $this->activeUsers($range);
        $affected = $this->count(
            'SELECT COUNT(DISTINCT account_id) FROM client_errors WHERE last_received_at >= :start AND last_received_at < :end',
            $parameters,
        );
        $errorOccurrences = $this->count(
            'SELECT COALESCE(SUM(occurrence_count), 0) FROM client_errors WHERE last_received_at >= :start AND last_received_at < :end',
            $parameters,
        );
        $errors = $this->errorRows($range);
        $platforms = $this->rows(
            'SELECT platform AS name, COUNT(DISTINCT account_id) AS users, COALESCE(SUM(occurrence_count), 0) AS errors
             FROM client_errors WHERE last_received_at >= :start AND last_received_at < :end
             GROUP BY platform ORDER BY errors DESC',
            $parameters,
        );
        return [
            'range' => $this->rangeResponse($range),
            'metrics' => [
                'errorOccurrences' => $this->metric($errorOccurrences),
                'affectedUsers' => $this->metric($affected),
                'errorFreeRate' => $this->metric($active > 0 ? max(0, $active - $affected) / $active * 100 : null, null, 'percent'),
                'clientsSeen24h' => $this->metric($this->count("SELECT COUNT(*) FROM sync_clients WHERE last_seen_at >= datetime('now', '-1 day')")),
                'clientsSeen7d' => $this->metric($this->count("SELECT COUNT(*) FROM sync_clients WHERE last_seen_at >= datetime('now', '-7 days')")),
                'staleClients' => $this->metric($this->count("SELECT COUNT(*) FROM sync_clients WHERE last_seen_at < datetime('now', '-30 days')")),
            ],
            'errors' => $errors,
            'platforms' => array_map(static fn (array $row): array => [
                'name' => (string) $row['name'], 'users' => (int) $row['users'], 'errors' => (int) $row['errors'],
            ], $platforms),
            'trend' => $this->dailySeries(
                $this->rows('SELECT last_received_at AS occurred_at FROM client_errors WHERE last_received_at >= :start AND last_received_at < :end', $parameters),
                $range,
            ),
        ];
    }

    public function users(array $query): array
    {
        $page = $this->positiveInteger($query['page'] ?? null, 1);
        $perPage = min(100, $this->positiveInteger($query['perPage'] ?? null, 30));
        $search = trim(is_string($query['search'] ?? null) ? $query['search'] : '');
        if (strlen($search) > 160) {
            throw new ApiException(422, 'The user search is too long.');
        }
        $status = is_string($query['status'] ?? null) ? $query['status'] : '';
        if (!in_array($status, ['', 'activated', 'not_activated', 'verified', 'unverified'], true)) {
            throw new ApiException(422, 'The account status filter is invalid.');
        }
        $sort = is_string($query['sort'] ?? null) ? $query['sort'] : '-last_active';
        $order = match ($sort) {
            'created' => 'u.created ASC',
            '-created' => 'u.created DESC',
            'name' => 'u.name COLLATE NOCASE ASC',
            '-name' => 'u.name COLLATE NOCASE DESC',
            'last_active' => 'last_active ASC',
            '-last_active' => 'last_active DESC',
            default => throw new ApiException(422, 'The user sort is invalid.'),
        };
        $activated = $this->activationExistsSql('u');
        $where = [];
        $parameters = [];
        if ($search !== '') {
            $where[] = '(u.name LIKE :search ESCAPE \'\\\' COLLATE NOCASE OR u.email LIKE :search ESCAPE \'\\\' COLLATE NOCASE)';
            $parameters['search'] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search) . '%';
        }
        if ($status === 'verified') $where[] = 'u.verified = 1';
        if ($status === 'unverified') $where[] = 'u.verified = 0';
        if ($status === 'activated') $where[] = $activated;
        if ($status === 'not_activated') $where[] = 'NOT ' . $activated;
        $whereSql = $where === [] ? '1 = 1' : implode(' AND ', $where);
        $total = $this->count("SELECT COUNT(*) FROM users u WHERE {$whereSql}", $parameters);
        $offset = ($page - 1) * $perPage;
        $statement = $this->database->pdo->prepare(
            "SELECT u.id, u.email, u.name, u.verified, u.settings, u.created,
                CASE WHEN {$activated} THEN 1 ELSE 0 END AS activated,
                COALESCE(
                    (SELECT MAX(e.occurred_at) FROM analytics_events e WHERE e.account_id = u.id),
                    (SELECT MAX(sc.last_seen_at) FROM sync_clients sc WHERE sc.account_id = u.id),
                    ''
                ) AS last_active,
                COALESCE((SELECT e.platform FROM analytics_events e WHERE e.account_id = u.id ORDER BY e.occurred_at DESC LIMIT 1), '') AS platform,
                COALESCE((SELECT e.app_version FROM analytics_events e WHERE e.account_id = u.id ORDER BY e.occurred_at DESC LIMIT 1), '') AS app_version,
                (SELECT COUNT(DISTINCT substr(e.occurred_at, 1, 10)) FROM analytics_events e WHERE e.account_id = u.id AND e.event_name = 'session_started' AND e.occurred_at >= datetime('now', '-30 days')) AS active_days
             FROM users u WHERE {$whereSql} ORDER BY {$order} LIMIT :limit OFFSET :offset",
        );
        foreach ($parameters as $key => $value) $statement->bindValue(':' . $key, $value);
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $items = array_map(fn (array $row): array => $this->userSummary($row), $statement->fetchAll());
        return [
            'items' => $items,
            'page' => $page,
            'perPage' => $perPage,
            'totalItems' => $total,
            'totalPages' => max(1, (int) ceil($total / $perPage)),
        ];
    }

    public function userDetail(string $id, array $query, array $admin, string $ip, string $userAgent): array
    {
        if (preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $id) !== 1) {
            throw new ApiException(404, 'User not found.');
        }
        $range = $this->dateRange($query);
        $activated = $this->activationExistsSql('u');
        $statement = $this->database->pdo->prepare(
            "SELECT u.id, u.email, u.name, u.verified, u.settings, u.created, u.timezone,
                u.assistant_token_usage, u.assistant_token_usage_day,
                CASE WHEN {$activated} THEN 1 ELSE 0 END AS activated,
                COALESCE(
                    (SELECT MAX(e.occurred_at) FROM analytics_events e WHERE e.account_id = u.id),
                    (SELECT MAX(sc.last_seen_at) FROM sync_clients sc WHERE sc.account_id = u.id),
                    ''
                ) AS last_active,
                COALESCE((SELECT e.platform FROM analytics_events e WHERE e.account_id = u.id ORDER BY e.occurred_at DESC LIMIT 1), '') AS platform,
                COALESCE((SELECT e.app_version FROM analytics_events e WHERE e.account_id = u.id ORDER BY e.occurred_at DESC LIMIT 1), '') AS app_version,
                (SELECT COUNT(DISTINCT substr(e.occurred_at, 1, 10)) FROM analytics_events e WHERE e.account_id = u.id AND e.event_name = 'session_started' AND e.occurred_at >= datetime('now', '-30 days')) AS active_days
             FROM users u WHERE u.id = :id LIMIT 1",
        );
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();
        if (!is_array($row)) {
            throw new ApiException(404, 'User not found.');
        }
        $summary = $this->userSummary($row) + [
            'timezone' => (string) $row['timezone'],
            'assistantTokenUsage' => (int) $row['assistant_token_usage'],
            'assistantTokenUsageDay' => (string) $row['assistant_token_usage_day'],
        ];
        $params = ['id' => $id, ...$this->rangeParams($range)];
        $counts = [
            'tasks' => $this->count('SELECT COUNT(*) FROM tasks WHERE owner = :id', ['id' => $id]),
            'intervals' => $this->count('SELECT COUNT(*) FROM interval_sessions WHERE owner = :id AND status = \'completed\'', ['id' => $id]),
            'reviews' => $this->count('SELECT COUNT(*) FROM flashcard_review_sessions WHERE owner = :id AND status = \'completed\'', ['id' => $id]),
            'trackingEntries' => $this->count('SELECT COUNT(*) FROM tracking_entries WHERE owner = :id', ['id' => $id]),
            'journalEntries' => $this->count('SELECT COUNT(*) FROM journal_entries WHERE owner = :id', ['id' => $id]),
            'clientErrors' => $this->count('SELECT COALESCE(SUM(occurrence_count), 0) FROM client_errors WHERE account_id = :id', ['id' => $id]),
        ];
        $namedContent = $this->rows(
            "SELECT 'Task' AS type, name, CASE WHEN active = 1 AND archived = 0 THEN 1 ELSE 0 END AS active FROM tasks WHERE owner = :id
             UNION ALL SELECT 'Interval', name, CASE WHEN archived = 0 THEN 1 ELSE 0 END FROM interval_templates WHERE owner = :id
             UNION ALL SELECT 'Review set', name, CASE WHEN archived = 0 THEN 1 ELSE 0 END FROM flashcard_review_sets WHERE owner = :id
             UNION ALL SELECT 'Tracker', name, CASE WHEN active = 1 AND archived = 0 THEN 1 ELSE 0 END FROM tracking_trackers WHERE owner = :id
             ORDER BY type, name COLLATE NOCASE LIMIT 200",
            ['id' => $id],
        );
        $devices = $this->rows(
            'SELECT client_id, protocol_version, last_seen_at FROM sync_clients WHERE account_id = :id ORDER BY last_seen_at DESC',
            ['id' => $id],
        );
        $events = $this->rows(
            'SELECT event_name, screen, action, occurred_at, duration_ms FROM analytics_events
             WHERE account_id = :id AND occurred_at >= :start AND occurred_at < :end
             ORDER BY occurred_at DESC LIMIT 50',
            $params,
        );
        $this->audit((string) $admin['id'], 'user_detail_viewed', $id, $ip, $userAgent);
        return [
            'user' => $summary,
            'counts' => $counts,
            'namedContent' => array_map(static fn (array $item): array => [
                'type' => (string) $item['type'], 'name' => (string) $item['name'], 'active' => (bool) $item['active'],
            ], $namedContent),
            'devices' => array_map(static fn (array $item): array => [
                'clientId' => (string) $item['client_id'], 'protocolVersion' => (int) $item['protocol_version'], 'lastSeenAt' => (string) $item['last_seen_at'],
            ], $devices),
            'activity' => $this->dailySeries(
                $this->rows("SELECT account_id, occurred_at FROM analytics_events WHERE account_id = :id AND event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end", $params),
                $range,
            ),
            'recentEvents' => array_map(static fn (array $item): array => [
                'event' => (string) $item['event_name'], 'screen' => (string) $item['screen'],
                'action' => (string) $item['action'], 'occurredAt' => (string) $item['occurred_at'],
                'durationSeconds' => (int) round((int) $item['duration_ms'] / 1000),
            ], $events),
            'errors' => $this->errorRows($range, $id),
        ];
    }

    public function auditLog(array $query): array
    {
        $page = $this->positiveInteger($query['page'] ?? null, 1);
        $perPage = min(100, $this->positiveInteger($query['perPage'] ?? null, 30));
        $total = $this->count('SELECT COUNT(*) FROM admin_audit_log');
        $statement = $this->database->pdo->prepare(
            'SELECT l.id, l.action, l.occurred_at, l.user_agent,
                a.name AS admin_name, a.email AS admin_email,
                t.name AS target_name, t.email AS target_email
             FROM admin_audit_log l
             LEFT JOIN users a ON a.id = l.admin_id
             LEFT JOIN users t ON t.id = l.target_user_id
             ORDER BY l.occurred_at DESC LIMIT :limit OFFSET :offset',
        );
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $statement->execute();
        return [
            'items' => array_map(static fn (array $row): array => [
                'id' => (string) $row['id'], 'adminName' => (string) ($row['admin_name'] ?? ''),
                'adminEmail' => (string) ($row['admin_email'] ?? ''), 'action' => (string) $row['action'],
                'targetName' => (string) ($row['target_name'] ?? ''), 'targetEmail' => (string) ($row['target_email'] ?? ''),
                'occurredAt' => (string) $row['occurred_at'], 'userAgent' => (string) $row['user_agent'],
            ], $statement->fetchAll()),
            'page' => $page, 'perPage' => $perPage, 'totalItems' => $total,
            'totalPages' => max(1, (int) ceil($total / $perPage)),
        ];
    }

    private function featureMetrics(array $range, int $activeUsers): array
    {
        $params = $this->rangeParams($range);
        $definitions = [
            'tasks' => [
                'name' => 'Tasks',
                'sql' => "SELECT owner, occurred_at FROM (
                    SELECT owner, created_at AS occurred_at FROM entries
                    UNION ALL SELECT owner, completed_at FROM occurrences WHERE status = 'completed'
                ) WHERE occurred_at >= :start AND occurred_at < :end",
            ],
            'intervals' => ['name' => 'Intervals', 'sql' => "SELECT owner, ended_at AS occurred_at FROM interval_sessions WHERE status = 'completed' AND ended_at >= :start AND ended_at < :end"],
            'flashcards' => ['name' => 'Flashcards', 'sql' => "SELECT owner, reviewed_at AS occurred_at FROM flashcard_review_events WHERE outcome IN ('success', 'error', 'ejected') AND reviewed_at >= :start AND reviewed_at < :end"],
            'tracking' => ['name' => 'Tracking', 'sql' => 'SELECT owner, occurred_at FROM tracking_entries WHERE occurred_at >= :start AND occurred_at < :end'],
            'journal' => ['name' => 'Journal', 'sql' => 'SELECT owner, occurred_at FROM journal_entries WHERE occurred_at >= :start AND occurred_at < :end'],
            'assistant' => ['name' => 'Assistant', 'sql' => "SELECT account_id AS owner, occurred_at FROM analytics_events WHERE action = 'assistant_request_sent' AND occurred_at >= :start AND occurred_at < :end"],
            'sharing' => ['name' => 'Review set sharing', 'sql' => 'SELECT r.owner, s.created_at AS occurred_at FROM flashcard_review_set_shares s INNER JOIN flashcard_review_sets r ON r.id = s.review_set WHERE s.created_at >= :start AND s.created_at < :end'],
        ];
        $result = [];
        foreach ($definitions as $key => $definition) {
            $rows = $this->rows($definition['sql'], $params);
            $users = count(array_unique(array_map(static fn (array $row): string => (string) $row['owner'], $rows)));
            $result[] = [
                'key' => $key,
                'name' => $definition['name'],
                'icon' => self::FEATURE_ICONS[$key],
                'users' => $users,
                'actions' => count($rows),
                'adoption' => $activeUsers > 0 ? $users / $activeUsers * 100 : 0.0,
            ];
        }
        return $result;
    }

    private function actionCounts(array $range): array
    {
        $rows = $this->rows(
            "SELECT action, COUNT(DISTINCT account_id) AS count
             FROM analytics_events WHERE event_name = 'action_completed'
             AND occurred_at >= :start AND occurred_at < :end AND action <> '' GROUP BY action",
            $this->rangeParams($range),
        );
        $counts = [];
        foreach ($rows as $row) $counts[(string) $row['action']] = (int) $row['count'];
        return $counts;
    }

    private function funnel(array $counts, array $steps): array
    {
        $result = [];
        foreach ($steps as $key => $label) $result[] = ['label' => $label, 'value' => $counts[$key] ?? 0];
        return $result;
    }

    private function rollingActivity(array $range): array
    {
        $lookback = [
            'start' => $range['start']->sub(new DateInterval('P29D')),
            'end' => $range['end'],
            'timezone' => $range['timezone'],
        ];
        $events = $this->rows(
            "SELECT account_id, occurred_at FROM analytics_events WHERE event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end",
            $this->rangeParams($lookback),
        );
        $byDay = [];
        foreach ($events as $event) {
            $day = $this->localDay((string) $event['occurred_at'], $range['timezone']);
            $byDay[$day][(string) $event['account_id']] = true;
        }
        $points = [];
        foreach ($this->days($range) as $date) {
            $day = $date->format('Y-m-d');
            $dau = count($byDay[$day] ?? []);
            $wauUsers = [];
            $mauUsers = [];
            for ($offset = 0; $offset < 30; $offset++) {
                $key = $date->sub(new DateInterval('P' . $offset . 'D'))->format('Y-m-d');
                foreach (array_keys($byDay[$key] ?? []) as $account) {
                    $mauUsers[$account] = true;
                    if ($offset < 7) $wauUsers[$account] = true;
                }
            }
            $points[] = ['date' => $day, 'value' => $dau, 'wau' => count($wauUsers), 'mau' => count($mauUsers)];
        }
        return $points;
    }

    private function retentionCohorts(array $range): array
    {
        $timezone = $range['timezone'];
        $start = $range['start']->setTimezone($timezone)->modify('monday this week')->sub(new DateInterval('P49D'));
        $users = $this->rows('SELECT id, created FROM users WHERE created >= :start AND created < :end', [
            'start' => $this->sqlTime($start), 'end' => $this->sqlTime($range['end']),
        ]);
        $events = $this->rows(
            "SELECT account_id, occurred_at FROM analytics_events WHERE event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end",
            ['start' => $this->sqlTime($start), 'end' => $this->sqlTime($range['end'])],
        );
        $eventWeeks = [];
        foreach ($events as $event) {
            $eventDate = new DateTimeImmutable((string) $event['occurred_at']);
            $week = $eventDate->setTimezone($timezone)->modify('monday this week')->format('Y-m-d');
            $eventWeeks[(string) $event['account_id']][$week] = true;
        }
        $cohorts = [];
        foreach ($users as $user) {
            $created = new DateTimeImmutable((string) $user['created']);
            $cohort = $created->setTimezone($timezone)->modify('monday this week')->format('Y-m-d');
            $cohorts[$cohort][] = (string) $user['id'];
        }
        ksort($cohorts);
        $result = [];
        foreach ($cohorts as $cohort => $accounts) {
            $cohortDate = new DateTimeImmutable($cohort, $timezone);
            $weeks = [];
            for ($index = 0; $index < 5; $index++) {
                $week = $cohortDate->add(new DateInterval('P' . ($index * 7) . 'D'));
                if ($week >= $range['end']->setTimezone($timezone)) {
                    $weeks[] = null;
                    continue;
                }
                $key = $week->format('Y-m-d');
                $active = count(array_filter($accounts, static fn (string $account): bool => isset($eventWeeks[$account][$key])));
                $weeks[] = count($accounts) > 0 ? $active / count($accounts) * 100 : null;
            }
            $result[] = ['cohort' => $cohortDate->format('M j'), 'users' => count($accounts), 'weeks' => $weeks];
        }
        return array_slice($result, -8);
    }

    private function errorRows(array $range, ?string $account = null): array
    {
        $where = 'last_received_at >= :start AND last_received_at < :end';
        $params = $this->rangeParams($range);
        if ($account !== null) {
            $where .= ' AND account_id = :account';
            $params['account'] = $account;
        }
        $rows = $this->rows(
            "SELECT fingerprint, type, message, source, method, status,
                SUM(occurrence_count) AS occurrences, COUNT(DISTINCT account_id) AS users,
                MAX(platform) AS platform, MAX(app_version) AS app_version,
                MAX(last_occurred_at) AS last_occurred_at
             FROM client_errors WHERE {$where}
             GROUP BY fingerprint, type, message, source, method, status
             ORDER BY occurrences DESC, last_occurred_at DESC LIMIT 50",
            $params,
        );
        return array_map(static fn (array $row): array => [
            'fingerprint' => (string) $row['fingerprint'], 'type' => (string) $row['type'],
            'message' => (string) $row['message'], 'source' => (string) $row['source'],
            'method' => (string) $row['method'], 'status' => $row['status'] === null ? null : (int) $row['status'],
            'occurrences' => (int) $row['occurrences'], 'users' => (int) $row['users'],
            'platform' => (string) $row['platform'], 'appVersion' => (string) $row['app_version'],
            'lastOccurredAt' => (string) $row['last_occurred_at'],
        ], $rows);
    }

    private function configuredUsers(array $range): int
    {
        return $this->count(
            "SELECT COUNT(DISTINCT owner) FROM (
                SELECT owner FROM tasks WHERE rowid IN (SELECT rowid FROM tasks) AND owner IN (SELECT id FROM users WHERE created >= :start AND created < :end)
                UNION SELECT owner FROM interval_templates WHERE owner IN (SELECT id FROM users WHERE created >= :start AND created < :end)
                UNION SELECT owner FROM flashcard_review_sets WHERE owner IN (SELECT id FROM users WHERE created >= :start AND created < :end)
                UNION SELECT owner FROM tracking_trackers WHERE owner IN (SELECT id FROM users WHERE created >= :start AND created < :end)
             )",
            $this->rangeParams($range),
        );
    }

    private function activatedUsers(array $range): int
    {
        return $this->count(
            'SELECT COUNT(*) FROM users u WHERE u.created >= :start AND u.created < :end AND ' . $this->activationExistsSql('u'),
            $this->rangeParams($range),
        );
    }

    private function activationRate(array $range): ?float
    {
        $newUsers = $this->countBetween('users', 'created', $range);
        return $newUsers > 0 ? $this->activatedUsers($range) / $newUsers * 100 : null;
    }

    private function fourWeekRetention(array $range): ?float
    {
        $end = $range['end'];
        $cohortStart = $end->sub(new DateInterval('P35D'));
        $cohortEnd = $end->sub(new DateInterval('P28D'));
        $total = $this->count('SELECT COUNT(*) FROM users WHERE created >= :start AND created < :end', [
            'start' => $this->sqlTime($cohortStart), 'end' => $this->sqlTime($cohortEnd),
        ]);
        if ($total === 0) return null;
        $retained = $this->count(
            "SELECT COUNT(*) FROM users u WHERE u.created >= :start AND u.created < :end
             AND EXISTS (SELECT 1 FROM analytics_events e WHERE e.account_id = u.id AND e.event_name = 'session_started'
                 AND e.occurred_at >= datetime(u.created, '+28 days') AND e.occurred_at < datetime(u.created, '+35 days'))",
            ['start' => $this->sqlTime($cohortStart), 'end' => $this->sqlTime($cohortEnd)],
        );
        return $retained / $total * 100;
    }

    private function errorFreeRate(array $range): ?float
    {
        $active = $this->activeUsers($range);
        if ($active === 0) return null;
        $affected = $this->count(
            'SELECT COUNT(DISTINCT account_id) FROM client_errors WHERE last_received_at >= :start AND last_received_at < :end',
            $this->rangeParams($range),
        );
        return max(0, $active - $affected) / $active * 100;
    }

    private function activationExistsSql(string $alias): string
    {
        return "(
            EXISTS (SELECT 1 FROM entries a WHERE a.owner = {$alias}.id AND a.created_at >= {$alias}.created AND a.created_at < datetime({$alias}.created, '+7 days'))
            OR EXISTS (SELECT 1 FROM occurrences a WHERE a.owner = {$alias}.id AND a.status = 'completed' AND a.completed_at >= {$alias}.created AND a.completed_at < datetime({$alias}.created, '+7 days'))
            OR EXISTS (SELECT 1 FROM interval_sessions a WHERE a.owner = {$alias}.id AND a.status = 'completed' AND a.ended_at >= {$alias}.created AND a.ended_at < datetime({$alias}.created, '+7 days'))
            OR EXISTS (SELECT 1 FROM flashcard_review_events a WHERE a.owner = {$alias}.id AND a.outcome IN ('success', 'error', 'ejected') AND a.reviewed_at >= {$alias}.created AND a.reviewed_at < datetime({$alias}.created, '+7 days'))
            OR EXISTS (SELECT 1 FROM tracking_entries a WHERE a.owner = {$alias}.id AND a.occurred_at >= {$alias}.created AND a.occurred_at < datetime({$alias}.created, '+7 days'))
            OR EXISTS (SELECT 1 FROM journal_entries a WHERE a.owner = {$alias}.id AND a.occurred_at >= {$alias}.created AND a.occurred_at < datetime({$alias}.created, '+7 days'))
        )";
    }

    private function userSummary(array $row): array
    {
        $settings = json_decode((string) ($row['settings'] ?? '{}'), true);
        $analyticsEnabled = !is_array($settings) || ($settings['productAnalyticsEnabled'] ?? true) !== false;
        return [
            'id' => (string) $row['id'],
            'email' => (string) $row['email'],
            'name' => (string) $row['name'],
            'verified' => (bool) $row['verified'],
            'activated' => (bool) $row['activated'],
            'analyticsEnabled' => $analyticsEnabled,
            'createdAt' => (string) $row['created'],
            'lastActiveAt' => (string) $row['last_active'],
            'platform' => (string) $row['platform'],
            'appVersion' => (string) $row['app_version'],
            'activeDays' => (int) $row['active_days'],
        ];
    }

    private function dailySeries(array $rows, array $range, bool $distinctAccounts = false): array
    {
        $counts = [];
        foreach ($rows as $row) {
            $day = $this->localDay((string) $row['occurred_at'], $range['timezone']);
            if ($distinctAccounts) {
                $counts[$day][(string) ($row['account_id'] ?? '')] = true;
            } else {
                $counts[$day] = ($counts[$day] ?? 0) + 1;
            }
        }
        $result = [];
        foreach ($this->days($range) as $date) {
            $day = $date->format('Y-m-d');
            $result[] = [
                'date' => $day,
                'value' => $distinctAccounts ? count($counts[$day] ?? []) : (int) ($counts[$day] ?? 0),
            ];
        }
        return $result;
    }

    private function days(array $range): array
    {
        $start = $range['start']->setTimezone($range['timezone'])->setTime(0, 0);
        $end = $range['end']->setTimezone($range['timezone'])->setTime(0, 0);
        return iterator_to_array(new DatePeriod($start, new DateInterval('P1D'), $end));
    }

    private function localDay(string $timestamp, DateTimeZone $timezone): string
    {
        try {
            return (new DateTimeImmutable($timestamp))->setTimezone($timezone)->format('Y-m-d');
        } catch (\Throwable) {
            return '';
        }
    }

    private function dateRange(array $query): array
    {
        $timezoneName = is_string($query['timezone'] ?? null) ? $query['timezone'] : 'UTC';
        try {
            $timezone = new DateTimeZone($timezoneName);
        } catch (\Throwable) {
            throw new ApiException(422, 'The analytics timezone is invalid.');
        }
        $today = new DateTimeImmutable('today', $timezone);
        $fromValue = is_string($query['from'] ?? null) ? $query['from'] : $today->sub(new DateInterval('P29D'))->format('Y-m-d');
        $toValue = is_string($query['to'] ?? null) ? $query['to'] : $today->format('Y-m-d');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $fromValue) !== 1 || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $toValue) !== 1) {
            throw new ApiException(422, 'Use YYYY-MM-DD analytics dates.');
        }
        $from = DateTimeImmutable::createFromFormat('!Y-m-d', $fromValue, $timezone);
        $to = DateTimeImmutable::createFromFormat('!Y-m-d', $toValue, $timezone);
        if (!$from || !$to || $from->format('Y-m-d') !== $fromValue || $to->format('Y-m-d') !== $toValue || $from > $to) {
            throw new ApiException(422, 'The analytics date range is invalid.');
        }
        $end = $to->add(new DateInterval('P1D'));
        if ($from->diff($end)->days > 366) {
            throw new ApiException(422, 'Analytics ranges cannot exceed 366 days.');
        }
        $utc = new DateTimeZone('UTC');
        return ['start' => $from->setTimezone($utc), 'end' => $end->setTimezone($utc), 'timezone' => $timezone];
    }

    private function previousRange(array $range): array
    {
        $seconds = $range['end']->getTimestamp() - $range['start']->getTimestamp();
        $previousEnd = $range['start'];
        return [
            'start' => $previousEnd->modify('-' . $seconds . ' seconds'),
            'end' => $previousEnd,
            'timezone' => $range['timezone'],
        ];
    }

    private function rangeResponse(array $range): array
    {
        $telemetryStart = $this->scalar('SELECT MIN(received_at) FROM analytics_events');
        return [
            'from' => $range['start']->setTimezone($range['timezone'])->format('Y-m-d'),
            'to' => $range['end']->setTimezone($range['timezone'])->sub(new DateInterval('P1D'))->format('Y-m-d'),
            'timezone' => $range['timezone']->getName(),
            'telemetryStartedAt' => is_string($telemetryStart) ? $telemetryStart : null,
        ];
    }

    private function rangeParams(array $range): array
    {
        return ['start' => $this->sqlTime($range['start']), 'end' => $this->sqlTime($range['end'])];
    }

    private function sqlTime(DateTimeImmutable $value): string
    {
        return $value->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    private function activeUsers(array $range): int
    {
        return $this->count(
            "SELECT COUNT(DISTINCT account_id) FROM analytics_events WHERE event_name = 'session_started' AND occurred_at >= :start AND occurred_at < :end",
            $this->rangeParams($range),
        );
    }

    private function countBetween(string $table, string $column, array $range): int
    {
        return $this->count(
            "SELECT COUNT(*) FROM {$table} WHERE {$column} >= :start AND {$column} < :end",
            $this->rangeParams($range),
        );
    }

    private function metric(int|float|null $value, int|float|null $previous = null, string $unit = 'count'): array
    {
        $change = $value !== null && $previous !== null && $previous != 0
            ? ($value - $previous) / abs($previous) * 100
            : null;
        return ['value' => $value, 'previous' => $previous, 'change' => $change, 'unit' => $unit];
    }

    private function count(string $sql, array $parameters = []): int
    {
        return (int) $this->scalar($sql, $parameters);
    }

    private function scalar(string $sql, array $parameters = []): mixed
    {
        $statement = $this->database->pdo->prepare($sql);
        $statement->execute($parameters);
        return $statement->fetchColumn();
    }

    private function rows(string $sql, array $parameters = []): array
    {
        $statement = $this->database->pdo->prepare($sql);
        $statement->execute($parameters);
        return $statement->fetchAll();
    }

    private function positiveInteger(mixed $value, int $default): int
    {
        if ($value === null || $value === '') return $default;
        $integer = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($integer === false) throw new ApiException(422, 'A pagination value is invalid.');
        return (int) $integer;
    }

    private function rateLimit(string $key, int $maximum, int $windowSeconds): void
    {
        $now = time();
        $cutoff = $now - $windowSeconds;
        $rateKey = hash_hmac('sha256', $key, $this->config->secret);
        $this->database->pdo->prepare(
            'INSERT INTO backontrack_rate_limits (rate_key, window_start, hits) VALUES (:key, :now, 1)
             ON CONFLICT(rate_key) DO UPDATE SET
                hits = CASE WHEN window_start <= :cutoff THEN 1 ELSE hits + 1 END,
                window_start = CASE WHEN window_start <= :cutoff THEN :now ELSE window_start END',
        )->execute(['key' => $rateKey, 'now' => $now, 'cutoff' => $cutoff]);
        $statement = $this->database->pdo->prepare('SELECT window_start, hits FROM backontrack_rate_limits WHERE rate_key = :key');
        $statement->execute(['key' => $rateKey]);
        $limit = $statement->fetch();
        if (is_array($limit) && (int) $limit['hits'] > $maximum) {
            throw new ApiException(429, 'Too many attempts. Try again later.');
        }
    }

    private function audit(?string $adminId, string $action, ?string $targetUserId, string $ip, string $userAgent): void
    {
        $this->database->pdo->prepare(
            'INSERT INTO admin_audit_log (id, admin_id, target_user_id, action, occurred_at, ip_hash, user_agent)
             VALUES (:id, :admin_id, :target_user_id, :action, :occurred_at, :ip_hash, :user_agent)',
        )->execute([
            'id' => 'r' . bin2hex(random_bytes(7)),
            'admin_id' => $adminId,
            'target_user_id' => $targetUserId,
            'action' => $action,
            'occurred_at' => (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z'),
            'ip_hash' => hash_hmac('sha256', $ip, $this->config->secret),
            'user_agent' => substr($userAgent, 0, 500),
        ]);
    }

    private function createToken(array $user): string
    {
        $header = $this->base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR));
        $payload = $this->base64UrlEncode(json_encode([
            'sub' => $user['user_id'] ?? $user['id'],
            'scope' => 'admin',
            'iat' => time(),
            'exp' => time() + $this->config->adminTokenTtl,
            'ver' => $this->tokenVersion((string) $user['token_key']),
        ], JSON_THROW_ON_ERROR));
        $signature = $this->base64UrlEncode(hash_hmac('sha256', $header . '.' . $payload, $this->config->secret, true));
        return $header . '.' . $payload . '.' . $signature;
    }

    private function adminRecord(array $user): array
    {
        return [
            'id' => (string) ($user['user_id'] ?? $user['id']),
            'email' => (string) $user['email'],
            'name' => (string) $user['name'],
        ];
    }

    private function challengeHash(string $id, string $code): string
    {
        return hash_hmac('sha256', $id . ':' . $code, $this->config->secret);
    }

    private function tokenVersion(string $tokenKey): string
    {
        return substr(hash_hmac('sha256', $tokenKey, $this->config->secret), 0, 24);
    }

    private function maskedEmail(string $email): string
    {
        [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');
        return substr($local, 0, 1) . str_repeat('•', max(2, min(8, strlen($local) - 1))) . '@' . $domain;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $padding = strlen($value) % 4;
        if ($padding !== 0) $value .= str_repeat('=', 4 - $padding);
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false) throw new ApiException(401, 'The administrator token is invalid.');
        return $decoded;
    }
}
