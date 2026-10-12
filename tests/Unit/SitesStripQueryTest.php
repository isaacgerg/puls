<?php

/**
 * Tests for the sites:strip-query CLI command.
 *
 * Runs CLI as subprocess with env overrides for DB_PATH and USERS_FILE.
 */

function createStripQueryDb(string $path): PDO
{
    $db = new PDO('sqlite:' . $path);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $db->exec('CREATE TABLE pageviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        path TEXT NOT NULL,
        visitor_hash TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    $db->exec('CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        event_name TEXT NOT NULL,
        event_data TEXT,
        page_path TEXT,
        visitor_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    return $db;
}

function runStripQuery(string $tmpDir, array $args): array
{
    $puls = realpath(__DIR__ . '/../../puls');

    $wrapper = $tmpDir . '/run.php';
    file_put_contents($wrapper, "<?php\n"
        . "\$_ENV['DB_PATH'] = " . var_export($tmpDir . '/test.sqlite', true) . ";\n"
        . "\$_ENV['USERS_FILE'] = " . var_export($tmpDir . '/users.json', true) . ";\n"
        . "\$_ENV['APP_KEY'] = 'test-key';\n"
        . "\$argv = " . var_export(array_merge(['puls', 'sites:strip-query'], $args), true) . ";\n"
        . "\$argc = count(\$argv);\n"
        . "require " . var_export($puls, true) . ";\n"
    );

    exec('php ' . escapeshellarg($wrapper) . ' 2>&1', $output, $exitCode);
    @unlink($wrapper);

    return ['output' => implode("\n", $output), 'exit' => $exitCode];
}

function pathsFor(string $dbPath, string $site): array
{
    $db = new PDO('sqlite:' . $dbPath);
    $stmt = $db->prepare('SELECT path FROM pageviews WHERE site = ? ORDER BY id');
    $stmt->execute([$site]);
    return $stmt->fetchAll(PDO::FETCH_COLUMN);
}

beforeEach(function () {
    $this->tmpDir = sys_get_temp_dir() . '/puls_test_' . uniqid();
    mkdir($this->tmpDir);
    $this->dbPath = $this->tmpDir . '/test.sqlite';
    $this->usersFile = $this->tmpDir . '/users.json';
    file_put_contents($this->usersFile, '{}');
});

afterEach(function () {
    if (file_exists($this->dbPath)) @unlink($this->dbPath);
    if (file_exists($this->usersFile)) @unlink($this->usersFile);
    if (is_dir($this->tmpDir)) @rmdir($this->tmpDir);
});

it('strips query strings from pageviews and events of one site', function () {
    $db = createStripQueryDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/search?q=abc123&regnr=ABC123')");
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/about')");
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('other', '/search?q=keep')");
    $db->exec("INSERT INTO events (site, event_name, page_path, visitor_hash) VALUES ('intra', 'click', '/lead?seller=x', 'h')");

    $result = runStripQuery($this->tmpDir, ['intra']);

    expect($result['exit'])->toBe(0);
    expect($result['output'])->toContain('pageviews: 1 rows');
    expect($result['output'])->toContain('events: 1 rows');
    expect(pathsFor($this->dbPath, 'intra'))->toBe(['/search', '/about']);
    expect(pathsFor($this->dbPath, 'other'))->toBe(['/search?q=keep']);

    $db = new PDO('sqlite:' . $this->dbPath);
    expect($db->query("SELECT page_path FROM events")->fetchColumn())->toBe('/lead');
});

it('keeps only the parameters named in --keep', function () {
    $db = createStripQueryDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/list?page=2&q=secret&tab=open')");
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/list?q=secret')");

    $result = runStripQuery($this->tmpDir, ['intra', '--keep=page,tab']);

    expect($result['exit'])->toBe(0);
    expect(pathsFor($this->dbPath, 'intra'))->toBe(['/list?page=2&tab=open', '/list']);
});

it('changes nothing with --dry-run', function () {
    $db = createStripQueryDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/search?q=abc')");

    $result = runStripQuery($this->tmpDir, ['intra', '--dry-run']);

    expect($result['exit'])->toBe(0);
    expect($result['output'])->toContain('pageviews: 1 rows');
    expect($result['output'])->toContain('Dry run, nothing changed.');
    expect(pathsFor($this->dbPath, 'intra'))->toBe(['/search?q=abc']);
});

it('reports when there is nothing to strip', function () {
    $db = createStripQueryDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/about')");

    $result = runStripQuery($this->tmpDir, ['intra']);

    expect($result['exit'])->toBe(0);
    expect($result['output'])->toContain('Nothing to strip.');
});

it('fails for an unknown site', function () {
    $db = createStripQueryDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('intra', '/about')");

    $result = runStripQuery($this->tmpDir, ['nope']);

    expect($result['exit'])->toBe(1);
    expect($result['output'])->toContain("Site 'nope' not found in database.");
});
