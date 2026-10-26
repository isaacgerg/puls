<?php

// PULS_VERSION shows in the dashboard footer; bump it with the CHANGELOG heading in a release
test('PULS_VERSION matches the latest released version in the changelog', function () {
    preg_match("/const PULS_VERSION = '([^']+)';/", file_get_contents(__DIR__ . '/../../public/index.php'), $constant);
    preg_match('/^## \[(\d+\.\d+\.\d+)\]/m', file_get_contents(__DIR__ . '/../../CHANGELOG.md'), $released);
    expect($constant[1] ?? null)->toBe($released[1]);
});
