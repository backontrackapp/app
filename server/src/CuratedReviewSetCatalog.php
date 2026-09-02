<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

final class CuratedReviewSetCatalog
{
    private const MAX_FILE_BYTES = 2500000;
    private const MAX_ROWS = 500;

    public function __construct(private readonly Config $config)
    {
    }

    /** @return array<int, array<string, mixed>> */
    public function list(): array
    {
        $catalog = $this->catalogRows();
        $items = [];
        foreach ($catalog as $row) {
            try {
                $detail = $this->detailFromRow($row);
                $items[] = [
                    'slug' => $detail['slug'],
                    'name' => $detail['name'],
                    'description' => $detail['description'],
                    'category' => $detail['category'],
                    'keywords' => $detail['keywords'],
                    'cardCount' => count($detail['rows']),
                    'frontLanguages' => $detail['frontLanguages'],
                    'backLanguages' => $detail['backLanguages'],
                    'defaultFrontLanguage' => $detail['defaultFrontLanguage'],
                    'defaultBackLanguage' => $detail['defaultBackLanguage'],
                    'thumbnail' => $detail['thumbnail'],
                    'previews' => array_slice(array_values(array_filter(array_map(
                        static fn (array $card): ?array => $card['image'] === '' ? null : [
                            'front' => (string) ($card['mappedFront'] ?? ''),
                            'image' => $card['image'],
                        ],
                        $detail['rows'],
                    ))), 0, 5),
                ];
            } catch (\Throwable $exception) {
                error_log('[curated-review-sets] ' . $exception->getMessage());
            }
        }
        return $items;
    }

    /** @return array<string, mixed> */
    public function detail(string $slug): array
    {
        $detail = $this->detailWithPrivateSources($slug);
        unset($detail['thumbnailSource']);
        $detail['rows'] = array_map(static function (array $row): array {
            unset($row['imageSource']);
            return $row;
        }, $detail['rows']);
        return $detail;
    }

    /** @return array<string, mixed> */
    private function detailWithPrivateSources(string $slug): array
    {
        foreach ($this->catalogRows() as $row) {
            if (hash_equals((string) ($row['slug'] ?? ''), $slug)) {
                return $this->detailFromRow($row);
            }
        }
        throw new ApiException(404, 'Curated Review set not found.');
    }

    public function serveImage(string $slug, int $rowIndex): never
    {
        $detail = $this->detailWithPrivateSources($slug);
        $row = $detail['rows'][$rowIndex] ?? null;
        $source = is_array($row) ? (string) ($row['imageSource'] ?? '') : '';
        if ($source === '' || str_starts_with($source, 'https://')) {
            throw new ApiException(404, 'Curated image not found.');
        }
        $this->servePrivateImage($source);
    }

    public function serveThumbnail(string $slug): never
    {
        $detail = $this->detailWithPrivateSources($slug);
        $source = (string) ($detail['thumbnailSource'] ?? '');
        if ($source === '' || str_starts_with($source, 'https://')) {
            throw new ApiException(404, 'Curated thumbnail not found.');
        }
        $this->servePrivateImage($source);
    }

    private function servePrivateImage(string $source): never
    {
        $path = $this->privatePath($source);
        $contents = file_get_contents($path);
        $details = $contents === false ? false : @getimagesizefromstring($contents);
        $mime = is_array($details) ? (string) ($details['mime'] ?? '') : '';
        if ($contents === false || !in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new ApiException(404, 'Curated image not found.');
        }
        header('Content-Type: ' . $mime);
        header('Cache-Control: public, max-age=3600, stale-while-revalidate=86400');
        header('Content-Length: ' . strlen($contents));
        header('Content-Disposition: inline');
        header('ETag: "' . hash('sha256', $contents) . '"');
        echo $contents;
        exit;
    }

    /** @return array<int, array<string, string>> */
    private function catalogRows(): array
    {
        $path = $this->root() . DIRECTORY_SEPARATOR . 'catalog.csv';
        if (!is_file($path)) {
            return [];
        }
        return $this->associativeCsv($path, 1000);
    }

    /** @param array<string, string> $catalog */
    private function detailFromRow(array $catalog): array
    {
        $slug = trim((string) ($catalog['slug'] ?? ''));
        if (preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug) !== 1) {
            throw new ApiException(500, 'A curated Review set slug is invalid.');
        }
        $name = trim((string) ($catalog['name'] ?? ''));
        $category = trim((string) ($catalog['category'] ?? ''));
        if ($name === '' || mb_strlen($name) > 160 || $category === '') {
            throw new ApiException(500, "Curated Review set {$slug} has invalid metadata.");
        }
        $file = trim((string) ($catalog['file'] ?? ''));
        if ($file === '' || strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'csv') {
            throw new ApiException(500, "Curated Review set {$slug} has an invalid CSV path.");
        }
        $path = $this->privatePath($file);
        $records = $this->associativeCsv($path, self::MAX_ROWS);
        if ($records === []) {
            throw new ApiException(500, "Curated Review set {$slug} has no cards.");
        }
        $headers = array_keys($records[0]);
        $columns = ['front' => [], 'back' => [], 'transliteration' => [], 'notes' => []];
        foreach ($headers as $header) {
            if ($header === 'image') {
                continue;
            }
            if (preg_match('/^(front|back|transliteration|notes)(?:_([A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*))?$/', $header, $matches) !== 1) {
                throw new ApiException(500, "Curated Review set {$slug} has an unknown column: {$header}.");
            }
            $field = $matches[1];
            $locale = $matches[2] ?? '';
            $columns[$field][] = ['value' => $locale, 'title' => $locale === '' ? 'Default' : $locale, 'header' => $header];
        }
        foreach (['front', 'back'] as $field) {
            $columns[$field] = array_values(array_filter(
                $columns[$field],
                static fn (array $column): bool => array_reduce(
                    $records,
                    static fn (bool $valid, array $record): bool => $valid && trim((string) ($record[$column['header']] ?? '')) !== '',
                    true,
                ),
            ));
            if ($columns[$field] === []) {
                throw new ApiException(500, "Curated Review set {$slug} needs a complete {$field} column.");
            }
        }
        $defaultFront = $this->defaultLanguage($catalog, 'default_front_language', $columns['front']);
        $defaultBack = $this->defaultLanguage($catalog, 'default_back_language', $columns['back']);
        $frontHeader = $this->columnHeader($columns['front'], $defaultFront);
        $thumbnailSource = trim((string) ($catalog['thumbnail'] ?? ''));
        $thumbnail = '';
        if ($thumbnailSource !== '') {
            if (str_starts_with($thumbnailSource, 'https://')) {
                if (filter_var($thumbnailSource, FILTER_VALIDATE_URL) === false) {
                    throw new ApiException(500, "Curated Review set {$slug} has an invalid thumbnail URL.");
                }
                $thumbnail = $thumbnailSource;
            } else {
                $this->privatePath($thumbnailSource);
                $thumbnail = '/curated-review-sets/' . rawurlencode($slug) . '/thumbnail';
            }
        }
        $rows = [];
        foreach ($records as $index => $record) {
            $imageSource = trim((string) ($record['image'] ?? ''));
            $image = '';
            if ($imageSource !== '') {
                if (str_starts_with($imageSource, 'https://')) {
                    if (filter_var($imageSource, FILTER_VALIDATE_URL) === false) {
                        throw new ApiException(500, "Curated Review set {$slug} has an invalid image URL.");
                    }
                    $image = $imageSource;
                } else {
                    $this->privatePath($imageSource);
                    $image = '/curated-review-sets/' . rawurlencode($slug) . '/images/' . $index;
                }
            }
            $rows[] = [
                'id' => $slug . '-' . ($index + 1),
                'values' => $record,
                'mappedFront' => trim((string) ($record[$frontHeader] ?? '')),
                'image' => $image,
                'imageSource' => $imageSource,
            ];
        }
        return [
            'slug' => $slug,
            'name' => $name,
            'description' => trim((string) ($catalog['description'] ?? '')),
            'category' => $category,
            'keywords' => $this->pipeValues((string) ($catalog['keywords'] ?? '')),
            'frontLanguages' => $this->publicColumns($columns['front'], $defaultFront),
            'backLanguages' => $this->publicColumns($columns['back'], $defaultBack),
            'defaultFrontLanguage' => $defaultFront,
            'defaultBackLanguage' => $defaultBack,
            'thumbnail' => $thumbnail,
            'thumbnailSource' => $thumbnailSource,
            'rows' => $rows,
            'settings' => $this->settings($catalog),
        ];
    }

    /** @param array<int, array{value: string, title: string, header: string}> $columns */
    private function defaultLanguage(array $catalog, string $key, array $columns): string
    {
        $requested = trim((string) ($catalog[$key] ?? ''));
        if ($requested === 'default') {
            $requested = '';
        }
        foreach ($columns as $column) {
            if ($column['value'] === $requested) {
                return $requested;
            }
        }
        if (
            $requested !== ''
            && preg_match('/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/', $requested) === 1
            && array_reduce(
                $columns,
                static fn (bool $found, array $column): bool => $found || $column['value'] === '',
                false,
            )
        ) {
            return $requested;
        }
        return (string) $columns[0]['value'];
    }

    /** @param array<int, array{value: string, title: string, header: string}> $columns */
    private function columnHeader(array $columns, string $value): string
    {
        foreach ($columns as $column) {
            if ($column['value'] === $value) {
                return $column['header'];
            }
        }
        foreach ($columns as $column) {
            if ($column['value'] === '') {
                return $column['header'];
            }
        }
        throw new ApiException(500, 'A curated language mapping is invalid.');
    }

    /** @param array<int, array{value: string, title: string, header: string}> $columns */
    private function publicColumns(array $columns, string $defaultLanguage): array
    {
        $defaultHasDedicatedColumn = array_reduce(
            $columns,
            static fn (bool $found, array $column): bool => $found
                || $column['value'] === $defaultLanguage,
            false,
        );
        return array_map(
            static fn (array $column): array => [
                'value' => !$defaultHasDedicatedColumn && $column['value'] === ''
                    ? $defaultLanguage
                    : $column['value'],
                'title' => !$defaultHasDedicatedColumn && $column['value'] === ''
                    ? $defaultLanguage
                    : $column['title'],
            ],
            $columns,
        );
    }

    /** @param array<string, string> $row */
    private function settings(array $row): array
    {
        $mode = in_array($row['mode'] ?? '', ['manual', 'passive'], true) ? $row['mode'] : 'manual';
        $boolean = static fn (string $key, bool $default): bool => array_key_exists($key, $row)
            && trim($row[$key]) !== ''
                ? in_array(strtolower(trim($row[$key])), ['1', 'true', 'yes'], true)
                : $default;
        $integer = static fn (string $key, int $default): int => array_key_exists($key, $row)
            && trim($row[$key]) !== '' ? (int) $row[$key] : $default;
        $number = static fn (string $key, float $default): float => array_key_exists($key, $row)
            && trim($row[$key]) !== '' && is_numeric($row[$key]) ? (float) $row[$key] : $default;
        $timeLimitSeconds = max(0, min(86340, $integer('time_limit_seconds', 0)));
        $timeLimitSeconds = intdiv($timeLimitSeconds, 60) * 60;
        return [
            'mode' => $mode,
            'cardSides' => in_array($row['card_sides'] ?? '', ['both', 'front', 'back'], true) ? $row['card_sides'] : 'both',
            'invertFaces' => $boolean('invert_faces', false),
            'indefinite' => $mode === 'passive' && $boolean('indefinite', false),
            'timeLimitSeconds' => $mode === 'passive' ? $timeLimitSeconds : 0,
            'maxCards' => max(1, min(100, $integer('max_cards', 12))),
            'ejectBehavior' => in_array($row['eject_behavior'] ?? '', ['remove', 'replace', 'exclude', 'replace_exclude'], true) ? $row['eject_behavior'] : 'replace_exclude',
            'ejectExcludeAfter' => max(1, min(20, $integer('eject_exclude_after', 3))),
            'frontSeconds' => max(1, min(10, $integer('front_seconds', 5))),
            'backSeconds' => max(1, min(10, $integer('back_seconds', 5))),
            'backSpeechRepeatCount' => max(1, min(5, $integer('back_speech_repeat_count', 1))),
            'frontDisplay' => in_array(
                $row['front_display'] ?? '',
                ['front', 'back', 'transliteration', 'note', 'image', 'empty'],
                true,
            ) ? $row['front_display'] : 'front',
            'backDisplay' => in_array(
                $row['back_display'] ?? '',
                ['front', 'back', 'transliteration', 'note', 'image', 'empty'],
                true,
            ) ? $row['back_display'] : 'back',
            'speechEnabled' => $boolean('speech_enabled', false),
            'backSpeechRate' => max(
                0.25,
                min(1.0, round($number('back_speech_rate', 1.0) * 4) / 4),
            ),
            'frontLanguage' => '',
            'backLanguage' => '',
            'sortMode' => in_array($row['sort_mode'] ?? '', ['difficult', 'easiest', 'never_reviewed', 'least_recent', 'recently_added', 'random'], true) ? $row['sort_mode'] : 'difficult',
            'sortDirection' => ($row['sort_direction'] ?? '') === 'desc' ? 'desc' : 'asc',
        ];
    }

    /** @return array<int, array<string, string>> */
    private function associativeCsv(string $path, int $maximumRows): array
    {
        if (!is_file($path) || !is_readable($path) || (filesize($path) ?: 0) > self::MAX_FILE_BYTES) {
            throw new ApiException(500, 'A curated CSV file is unavailable or too large.');
        }
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new ApiException(500, 'A curated CSV file could not be opened.');
        }
        try {
            $header = fgetcsv($handle, 0, ',', '"', '');
            if (!is_array($header)) {
                return [];
            }
            $header = array_map(static function (mixed $value): string {
                $normalized = trim((string) $value);
                return preg_replace('/^\xEF\xBB\xBF/', '', $normalized) ?? $normalized;
            }, $header);
            if (count($header) !== count(array_unique($header)) || in_array('', $header, true)) {
                throw new ApiException(500, 'A curated CSV file has duplicate or empty headers.');
            }
            $rows = [];
            while (($values = fgetcsv($handle, 0, ',', '"', '')) !== false) {
                if (count($values) === 1 && trim((string) $values[0]) === '') {
                    continue;
                }
                if (count($values) > count($header)) {
                    throw new ApiException(500, 'A curated CSV row contains more values than headers.');
                }
                $values = array_pad($values, count($header), '');
                $rows[] = array_combine($header, array_map(static fn (mixed $value): string => trim((string) $value), $values));
                if (count($rows) > $maximumRows) {
                    throw new ApiException(500, "A curated CSV file exceeds {$maximumRows} rows.");
                }
            }
            return $rows;
        } finally {
            fclose($handle);
        }
    }

    private function privatePath(string $relative): string
    {
        if ($relative === '' || str_contains($relative, "\0") || str_starts_with($relative, '/') || preg_match('#(^|[\\/])\.\.([\\/]|$)#', $relative) === 1) {
            throw new ApiException(500, 'A curated file path is invalid.');
        }
        $candidate = realpath($this->root() . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relative));
        $root = realpath($this->root());
        if ($candidate === false || $root === false || !str_starts_with($candidate, $root . DIRECTORY_SEPARATOR) || !is_file($candidate)) {
            throw new ApiException(500, 'A curated file could not be found.');
        }
        return $candidate;
    }

    private function root(): string
    {
        return dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'curated-review-sets';
    }

    /** @return string[] */
    private function pipeValues(string $value): array
    {
        return array_values(array_unique(array_filter(array_map('trim', explode('|', $value)))));
    }
}
