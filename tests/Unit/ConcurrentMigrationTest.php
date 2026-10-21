<?php

// Forge health checks from several regions hit a fresh release at once. The
// requests that did not run the migration failed with "database is locked"
// (503) instead of waiting for it to finish.
test('requests arriving during a migration wait for it instead of failing', function () {
    $dir = sys_get_temp_dir() . '/puls-race-' . uniqid();
    mkdir($dir);
    register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
    $path = $dir . '/puls.sqlite';

    // A database one migration behind, big enough that the migration takes a moment
    $db = get_db($path);
    $db->exec('DROP TABLE salts');
    $db->exec('PRAGMA user_version = 21');
    $db->beginTransaction();
    $insert = $db->prepare("INSERT INTO pageviews (site, path, visitor_hash, created_at) VALUES ('s', '/', ?, '2026-01-01')");
    for ($i = 0; $i < 60000; $i++) $insert->execute([hash('sha256', (string) intdiv($i, 3))]);
    $db->commit();
    $db = null;

    $script = $dir . '/open.php';
    file_put_contents($script, '<?php require ' . var_export(__DIR__ . '/../bootstrap.php', true) . ';
        try { get_db(' . var_export($path, true) . '); echo "ok"; } catch (Throwable $e) { echo $e->getMessage(); }');

    $procs = [];
    for ($i = 0; $i < 4; $i++) {
        $procs[] = proc_open(['php', $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes[$i]);
    }
    $results = [];
    foreach ($procs as $i => $proc) {
        $results[] = stream_get_contents($pipes[$i][1]);
        proc_close($proc);
    }

    expect($results)->each->toBe('ok');
    $check = new PDO('sqlite:' . $path);
    preg_match('/\$currentVersion = (\d+);/', file_get_contents(__DIR__ . '/../../public/index.php'), $m);
    expect((int) $check->query('PRAGMA user_version')->fetchColumn())->toBe((int) $m[1])
        ->and((int) $check->query('SELECT COUNT(DISTINCT visitor_hash) FROM pageviews')->fetchColumn())->toBe(20000);
});
