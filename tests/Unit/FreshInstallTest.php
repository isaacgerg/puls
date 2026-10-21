<?php

test('a fresh database has every table and the current schema version', function () {
    $dir = sys_get_temp_dir() . '/puls-fresh-' . uniqid();
    register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
    $db = get_db($dir . '/puls.sqlite');

    $tables = $db->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(PDO::FETCH_COLUMN);
    expect($tables)->toContain('pageviews', 'events', 'goals', 'share_tokens', 'app_versions', 'breakdowns', 'annotations', 'excluded_ips', 'salts');

    $pvCols = array_column($db->query('PRAGMA table_info(pageviews)')->fetchAll(PDO::FETCH_ASSOC), 'name');
    expect($pvCols)->toContain('app_version');
    $bdCols = array_column($db->query('PRAGMA table_info(breakdowns)')->fetchAll(PDO::FETCH_ASSOC), 'name');
    expect($bdCols)->toContain('position');
    $goalCols = array_column($db->query('PRAGMA table_info(goals)')->fetchAll(PDO::FETCH_ASSOC), 'name');
    expect($goalCols)->toContain('target', 'target_period');

    // Same version a migrated database ends on, so the first request does not re-run migrations
    preg_match('/\$currentVersion = (\d+);/', file_get_contents(__DIR__ . '/../../public/index.php'), $m);
    expect((int) $db->query('PRAGMA user_version')->fetchColumn())->toBe((int) $m[1]);
});

test('migration v23 gives saved cards a position, existing ones at 0 in their old order', function () {
    $dir = sys_get_temp_dir() . '/puls-v23-' . uniqid();
    register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
    $db = get_db($dir . '/puls.sqlite');
    $db->exec('ALTER TABLE breakdowns DROP COLUMN position');
    $db->exec("INSERT INTO breakdowns (site, label, event_name, group_key, created_at) VALUES ('s', '', 'b', 'k', '2026-01-02'), ('s', '', 'a', 'k', '2026-01-01')");
    $db->exec('PRAGMA user_version = 22');

    run_migrations($db);
    expect($db->query('SELECT event_name, position FROM breakdowns ORDER BY position, created_at, id')->fetchAll(PDO::FETCH_NUM))
        ->toBe([['a', 0], ['b', 0]]);
});

test('migration v24 adds an optional target to goals', function () {
    $dir = sys_get_temp_dir() . '/puls-v24-' . uniqid();
    register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
    $db = get_db($dir . '/puls.sqlite');
    $db->exec('ALTER TABLE goals DROP COLUMN target');
    $db->exec('ALTER TABLE goals DROP COLUMN target_period');
    $db->exec("INSERT INTO goals (site, path, label, type, created_at) VALUES ('s', '/thanks', '', 'page', '2026-01-01')");
    $db->exec('PRAGMA user_version = 23');

    run_migrations($db);
    expect($db->query('SELECT path, target, target_period FROM goals')->fetchAll(PDO::FETCH_NUM))->toBe([['/thanks', null, null]]);
});
