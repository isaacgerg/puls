<?php

test('contrast ratio follows WCAG', function () {
    expect(round(contrast_ratio('#ffffff', '#000000'), 1))->toBe(21.0)
        ->and(round(contrast_ratio('#f16272', '#f16272'), 1))->toBe(1.0)
        ->and(round(contrast_ratio('#f16272', '#ffffff'), 1))->toBe(3.1)
        ->and(round(contrast_ratio('#be123c', '#ffffff'), 1))->toBeGreaterThanOrEqual(4.5)
        ->and(round(contrast_ratio('#fff', '#000'), 1))->toBe(21.0);
});

test('the default coral keeps the kit text colours', function () {
    expect(accent_text_colours('#f16272'))->toBe(['light' => '#be123c', 'dark' => '#fb7185'])
        ->and(accent_text_colours('#F16272'))->toBe(['light' => '#be123c', 'dark' => '#fb7185']);
});

test('a custom accent is used for text only where it is readable', function () {
    // Deep blue: readable on white, too dark on the dark surface
    expect(accent_text_colours('#1d4ed8'))->toBe(['light' => '#1d4ed8', 'dark' => '#fb7185'])
        // Pale yellow: readable on the dark surface, not on white
        ->and(accent_text_colours('#fde047'))->toBe(['light' => '#be123c', 'dark' => '#fde047'])
        // Not a colour: the defaults
        ->and(accent_text_colours('tomato'))->toBe(['light' => '#be123c', 'dark' => '#fb7185']);
});
