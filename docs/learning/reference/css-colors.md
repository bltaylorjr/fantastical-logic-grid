# Reference: CSS colors

CSS is the page's look. A **rule** says *where* (the selector) and *what* (the settings).

```css
:root[data-world="action"] { --w1: #EF4444; --w2: #F59E0B; }
└────────────┬───────────┘   └──┬──┘ └──┬──┘
       selector: where        name     value    ; ends each setting
```

## Hex colors

`#RRGGBB`: red, green and blue, each from `00` (none) to `FF` (full).

| Color | Hex |
| --- | --- |
| Black | `#000000` |
| White | `#FFFFFF` |
| Pure red | `#FF0000` |
| The game's purple | `#5B3CC4` |
| Mid gray | `#808080` |

Pick colors with a picker such as [htmlcolorcodes.com](https://htmlcolorcodes.com/color-picker/) and copy the value that starts with `#`.

## Custom properties: named colors

`--w1: #EF4444;` creates a named color. Elsewhere the style sheet uses it with `var(--w1)`. Change the value once, and every place that uses it changes.

## Contrast (accessibility)

Text and icons must stand out from what is behind them. Check any pair at [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker/):

- Normal text: at least **4.5 : 1**.
- Large text, icons and graphics: at least **3 : 1**.

Your game has light, dark and high-contrast modes. Check your colors in light and dark (Settings).

## Rules that prevent most mistakes

1. Change the value after the colon; keep the name before it.
2. Keep the `#` and exactly six characters (0 to 9, A to F).
3. Each setting ends with `;`.
4. Don't remove the `{` or `}`.
