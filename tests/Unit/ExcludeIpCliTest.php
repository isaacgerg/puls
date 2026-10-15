<?php

/**
 * Tests for the exclude:add, exclude:list and exclude:remove CLI commands.
 */

require_once __DIR__ . '/../Support/helpers.php';

beforeEach(function () {
    $this->tmpDir = sys_get_temp_dir() . '/puls_exclude_test_' . uniqid();
    mkdir($this->tmpDir);
    $this->dbPath = $this->tmpDir . '/test.sqlite';
    file_put_contents($this->tmpDir . '/users.json', '{}');
    $db = createCliTestDb($this->dbPath);
    $db->exec("INSERT INTO pageviews (site, path) VALUES ('shop', '/')");
});

afterEach(function () {
    exec('rm -rf ' . escapeshellarg($this->tmpDir));
});

function excludedRows(string $dbPath): array
{
    $db = new PDO('sqlite:' . $dbPath);
    return $db->query('SELECT site, ip, label FROM excluded_ips ORDER BY site, ip')->fetchAll(PDO::FETCH_ASSOC);
}

it('exclude:add stores a normalized address or range with a label', function () {
    $result = runCli($this->tmpDir, 'exclude:add', ['shop', '81.2.3.4', '--label=Office']);
    expect($result['exit'])->toBe(0)
        ->and($result['output'])->toContain('Excluded 81.2.3.4 on shop');

    runCli($this->tmpDir, 'exclude:add', ['*', '2001:0db8:0001:0000::/48']);

    expect(excludedRows($this->dbPath))->toBe([
        ['site' => '*', 'ip' => '2001:db8:1::/48', 'label' => null],
        ['site' => 'shop', 'ip' => '81.2.3.4', 'label' => 'Office'],
    ]);
});

it('exclude:add rejects an invalid address or prefix', function () {
    foreach (['81.2.3', '81.2.3.0/33', '81.2.3.0/x', 'office'] as $bad) {
        $result = runCli($this->tmpDir, 'exclude:add', ['shop', $bad]);
        expect($result['exit'])->toBe(1)
            ->and($result['output'])->toContain('Invalid IP address or range');
    }
    expect(excludedRows($this->dbPath))->toBe([]);
});

it('exclude:add does not store the same range twice', function () {
    runCli($this->tmpDir, 'exclude:add', ['shop', '81.2.3.4']);
    $result = runCli($this->tmpDir, 'exclude:add', ['shop', '81.2.3.4']);

    expect($result['output'])->toContain('already excluded')
        ->and(excludedRows($this->dbPath))->toHaveCount(1);
});

it('exclude:add asks for site, address and label when called without args', function () {
    // 0 = all sites
    $result = runCli($this->tmpDir, 'exclude:add', [], "0\n81.2.3.0/24\nOffice");

    expect($result['output'])->toContain('All sites')
        ->and($result['output'])->toContain('shop')
        ->and(excludedRows($this->dbPath))->toBe([['site' => '*', 'ip' => '81.2.3.0/24', 'label' => 'Office']]);
});

it('exclude:list shows the site rows plus those for all sites', function () {
    runCli($this->tmpDir, 'exclude:add', ['shop', '81.2.3.4', '--label=Office']);
    runCli($this->tmpDir, 'exclude:add', ['*', '10.0.0.0/8']);
    runCli($this->tmpDir, 'exclude:add', ['blog', '5.6.7.8']);

    $result = runCli($this->tmpDir, 'exclude:list', ['shop']);

    expect($result['output'])->toContain('81.2.3.4')
        ->and($result['output'])->toContain('Office')
        ->and($result['output'])->toContain('all sites')
        ->and($result['output'])->not->toContain('5.6.7.8')
        ->and($result['output'])->toContain('2 excluded IP(s)');
});

it('exclude:remove deletes by site and address, or from a picker', function () {
    runCli($this->tmpDir, 'exclude:add', ['shop', '81.2.3.4']);
    runCli($this->tmpDir, 'exclude:add', ['shop', '5.6.7.8']);

    $result = runCli($this->tmpDir, 'exclude:remove', ['shop', '81.2.3.4']);
    expect($result['exit'])->toBe(0)
        ->and($result['output'])->toContain('counted again');

    $result = runCli($this->tmpDir, 'exclude:remove', ['shop', '81.2.3.4']);
    expect($result['exit'])->toBe(1)
        ->and($result['output'])->toContain('is not excluded');

    runCli($this->tmpDir, 'exclude:remove', [], '1');
    expect(excludedRows($this->dbPath))->toBe([]);
});
