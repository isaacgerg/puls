<?php

test('matches a single IPv4 address exactly', function () {
    expect(ip_in_range('81.2.3.4', '81.2.3.4'))->toBeTrue();
    expect(ip_in_range('81.2.3.5', '81.2.3.4'))->toBeFalse();
});

test('matches IPv4 CIDR ranges, including prefixes that split a byte', function () {
    expect(ip_in_range('81.2.3.200', '81.2.3.0/24'))->toBeTrue();
    expect(ip_in_range('81.2.4.1', '81.2.3.0/24'))->toBeFalse();
    expect(ip_in_range('10.0.0.15', '10.0.0.0/28'))->toBeTrue();
    expect(ip_in_range('10.0.0.16', '10.0.0.0/28'))->toBeFalse();
    expect(ip_in_range('1.2.3.4', '0.0.0.0/0'))->toBeTrue();
});

test('matches IPv6 addresses and prefixes', function () {
    expect(ip_in_range('2001:db8:1:2::abcd', '2001:db8:1::/48'))->toBeTrue();
    expect(ip_in_range('2001:db8:2::1', '2001:db8:1::/48'))->toBeFalse();
    expect(ip_in_range('::1', '::1'))->toBeTrue();
});

test('matches an IPv4-mapped IPv6 address against IPv4 ranges', function () {
    expect(ip_in_range('::ffff:81.2.3.4', '81.2.3.0/24'))->toBeTrue();
});

test('never matches across families or invalid input', function () {
    expect(ip_in_range('81.2.3.4', '2001:db8::/32'))->toBeFalse();
    expect(ip_in_range('2001:db8::1', '81.2.3.0/24'))->toBeFalse();
    expect(ip_in_range('', '81.2.3.0/24'))->toBeFalse();
    expect(ip_in_range('81.2.3.4', 'not-an-ip'))->toBeFalse();
});
