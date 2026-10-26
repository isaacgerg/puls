<?php

test('reads the token from an Authorization: Bearer header', function (array $server) {
    expect(bearer_token($server))->toBe('abc123');
})->with([
    'header' => [['HTTP_AUTHORIZATION' => 'Bearer abc123']],
    'any case and spacing' => [['HTTP_AUTHORIZATION' => '  bearer   abc123 ']],
    'Apache rewrite' => [['REDIRECT_HTTP_AUTHORIZATION' => 'Bearer abc123']],
]);

test('ignores a missing or non-bearer Authorization header', function (array $server) {
    expect(bearer_token($server))->toBeNull();
})->with([
    'missing' => [[]],
    'basic auth' => [['HTTP_AUTHORIZATION' => 'Basic dXNlcjpwYXNz']],
    'empty bearer' => [['HTTP_AUTHORIZATION' => 'Bearer ']],
]);
