<?php

// Load config.php from a copy in its own directory, so its .env is the test's
function loadConfigWithEnv(string $env): string
{
    $dir = sys_get_temp_dir() . '/puls-config-' . uniqid();
    mkdir($dir);
    register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
    copy(__DIR__ . '/../../config.php', $dir . '/config.php');
    file_put_contents($dir . '/.env', $env);
    $code = '$c = require ' . var_export($dir . '/config.php', true) . '; echo $c["app_name"];';
    return (string) shell_exec('env -u APP_KEY -u APP_NAME php -r ' . escapeshellarg($code) . ' 2>&1');
}

test('config loads from a .env without APP_KEY', function () {
    expect(loadConfigWithEnv("APP_NAME=Test Puls\n"))->toBe('Test Puls');
});

test('a leftover APP_KEY in .env is ignored', function () {
    expect(loadConfigWithEnv("APP_KEY=base64:abc\nAPP_NAME=Test Puls\n"))->toBe('Test Puls');
});

test('the footer credit is on unless FOOTER_CREDIT turns it off', function () {
    $credit = function (string $env): string {
        $dir = sys_get_temp_dir() . '/puls-config-' . uniqid();
        mkdir($dir);
        register_shutdown_function(fn () => exec('rm -rf ' . escapeshellarg($dir)));
        copy(__DIR__ . '/../../config.php', $dir . '/config.php');
        file_put_contents($dir . '/.env', $env);
        $code = '$c = require ' . var_export($dir . '/config.php', true) . '; echo json_encode($c["footer_credit"]);';
        return (string) shell_exec('env -u FOOTER_CREDIT php -r ' . escapeshellarg($code) . ' 2>&1');
    };
    expect($credit(''))->toBe('true')
        ->and($credit("FOOTER_CREDIT=false\n"))->toBe('false')
        ->and($credit("FOOTER_CREDIT=0\n"))->toBe('false')
        ->and($credit("FOOTER_CREDIT=true\n"))->toBe('true');
});
