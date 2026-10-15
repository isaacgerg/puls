<?php

test('uses REMOTE_ADDR and ignores forwarded headers without trusted proxies', function () {
    $server = ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '198.51.100.1', 'HTTP_X_REAL_IP' => '198.51.100.2'];
    expect(client_ip($server, []))->toBe('203.0.113.9');
});

test('ignores forwarded headers when the request does not come from a trusted proxy', function () {
    $server = ['REMOTE_ADDR' => '203.0.113.9', 'HTTP_X_FORWARDED_FOR' => '198.51.100.1'];
    expect(client_ip($server, ['10.0.0.0/8']))->toBe('203.0.113.9');
});

test('takes the visitor from X-Forwarded-For behind a trusted proxy', function () {
    $server = ['REMOTE_ADDR' => '10.0.0.2', 'HTTP_X_FORWARDED_FOR' => '198.51.100.1'];
    expect(client_ip($server, ['10.0.0.0/8']))->toBe('198.51.100.1');
});

test('walks X-Forwarded-For from the right and skips every trusted hop', function () {
    // The visitor sent a forged header; each proxy appended the address it saw
    $server = ['REMOTE_ADDR' => '10.0.0.2', 'HTTP_X_FORWARDED_FOR' => '1.1.1.1, 198.51.100.1, 172.70.1.5'];
    expect(client_ip($server, ['10.0.0.0/8', '172.64.0.0/13']))->toBe('198.51.100.1');
});

test('falls back to X-Real-IP, then to REMOTE_ADDR, behind a trusted proxy', function () {
    expect(client_ip(['REMOTE_ADDR' => '10.0.0.2', 'HTTP_X_REAL_IP' => '198.51.100.7'], ['10.0.0.0/8']))->toBe('198.51.100.7');
    expect(client_ip(['REMOTE_ADDR' => '10.0.0.2'], ['10.0.0.0/8']))->toBe('10.0.0.2');
});

test('stops at an entry that is not an IP address', function () {
    $server = ['REMOTE_ADDR' => '10.0.0.2', 'HTTP_X_FORWARDED_FOR' => '198.51.100.1, garbage'];
    expect(client_ip($server, ['10.0.0.0/8']))->toBe('10.0.0.2');
});

test('handles IPv6 visitors and proxies', function () {
    $server = ['REMOTE_ADDR' => 'fd00::2', 'HTTP_X_FORWARDED_FOR' => '2001:db8::42'];
    expect(client_ip($server, ['fd00::/8']))->toBe('2001:db8::42');
});
