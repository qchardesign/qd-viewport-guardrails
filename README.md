# qd-viewport-guardrails

Playwright multi-viewport layout guardrails (`360px`–`1440px`) for catching horizontal overflow, clipped pills/buttons, inner-container box breaches, and header edge-flush misalignments.

## Assertions Included

- `auditViewportOverflow(page, label?)`: Verifies `documentElement.scrollWidth <= clientWidth` and walks visible DOM nodes (respecting ancestor `overflow-x` clipping) to catch overflowing elements.
- `auditPillAndButtonBounds(page, options?, label?)`: Verifies interactive pills, buttons, and links stay inside the viewport, are not clipped by `overflow-x: hidden|clip` ancestors, and do not truncate (`scrollWidth > clientWidth`).
- `auditHeaderEdgeFlush(page, options?, label?)`: Verifies `<= 1px` edge-flush alignment between header brand/CTA elements and a reference container, plus minimum brand-to-CTA spacing.
- `auditInnerContainerBounds(page, containerSelector, options?, label?)`: Verifies child elements stay within a container's inner border box.
- `runViewportGuardrails(page, options?)`: Runs all configured checks across `DEFAULT_VIEWPORTS` (`360px`, `375px`, `390px`, `412px`, `1440px`).

## Quick Start

```ts
import { chromium } from 'playwright';
import { runViewportGuardrails } from 'qd-viewport-guardrails';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4321', { waitUntil: 'networkidle' });

const report = await runViewportGuardrails(page, {
  headerFlush: { containerSelector: 'main > section' },
  innerContainers: ['.card'],
});

if (!report.passed) {
  console.error(report.breaches);
  process.exit(1);
}
await browser.close();
```

## License

[MIT](./LICENSE)
