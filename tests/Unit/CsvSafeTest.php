<?php

test('prefixes text that a spreadsheet would read as a formula', function (string $value) {
    expect(csv_safe($value))->toBe("'" . $value);
})->with(['=HYPERLINK("https://example.com","x")', '+cmd', '-cmd', '@SUM(A1)', "\t=1", "\r=1"]);

test('leaves numbers and ordinary text alone', function (mixed $value) {
    expect(csv_safe($value))->toBe($value);
})->with([42, 4.5, -3, '-5', '-1.5', '+3', '/guides', 'kale', '', '2026-10-26 10:00:00']);
