# Pricing and costs model

Source for `docs/reports/2026-10-26-pricing-and-fee-structure.pdf`: what the
game costs to run as players grow, when each free limit runs out, and the
recommended prices.

- `model.py`: the usage assumptions (`A`) and vendor prices. Edit the
  assumptions with real numbers from the admin dashboard, then run it. It
  writes `model.json`.
- `build.py`: turns `model.json` and `template.html` into `report.html`
  (tables and charts).
- `pdf.cjs`: prints `report.html` to a PDF with Playwright.

```
cd docs/reports/pricing-model
python3 model.py && python3 build.py && node pdf.cjs "$PWD/report.html" "$PWD/report.pdf"
```

The report uses the game's Atkinson Hyperlegible and Cinzel fonts if the
`.woff2` files are copied next to `template.html`; otherwise it falls back to
Arial and Georgia. Prices were checked on October 26, 2026; check them again
before relying on new numbers.
