import type { Page } from 'playwright';

export interface ViewportSpec {
  label: string;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { label: '360px', width: 360, height: 800 },
  { label: '375px', width: 375, height: 812 },
  { label: '390px', width: 390, height: 844 },
  { label: '412px', width: 412, height: 915 },
  { label: '1440px', width: 1440, height: 900 },
];

export interface GuardrailBreach {
  check: 'document-overflow' | 'element-overflow' | 'pill-clip' | 'header-flush' | 'inner-container';
  viewport?: string;
  selector?: string;
  message: string;
}

export interface OverflowAuditResult {
  clientWidth: number;
  scrollWidth: number;
  bodyScrollWidth: number;
  breaches: GuardrailBreach[];
}

export interface PillAuditOptions {
  selector?: string;
  skipHorizontallyScrollableAncestors?: boolean;
}

export interface HeaderFlushOptions {
  headerSelector?: string;
  brandSelector?: string;
  ctaSelector?: string;
  containerSelector?: string;
  tolerancePx?: number;
  minGapPx?: number;
}

export interface InnerContainerOptions {
  inspectSelector?: string;
  tolerancePx?: number;
}

/**
 * Checks document-level horizontal overflow and walks visible DOM elements
 * (respecting ancestor overflow-x clipping) to detect viewport breaches.
 */
export async function auditViewportOverflow(page: Page, viewportLabel?: string): Promise<OverflowAuditResult> {
  const result = await page.evaluate(() => {
    const docEl = document.documentElement;
    const clientWidth = docEl.clientWidth;
    const scrollWidth = docEl.scrollWidth;
    const bodyScrollWidth = document.body ? document.body.scrollWidth : scrollWidth;
    const elementBreaches: Array<{ selector: string; visLeft: number; visRight: number; clientWidth: number }> = [];

    const allEls = Array.from(document.querySelectorAll('body *'));
    for (const el of allEls) {
      if (el.closest('dialog:not([open])')) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      if (cs.pointerEvents === 'none') continue;
      if (el.classList.contains('sr-only')) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;

      let visLeft = r.left;
      let visRight = r.right;
      let cur = el.parentElement;
      while (cur && cur !== document.body && cur !== docEl) {
        const pcs = window.getComputedStyle(cur);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(pcs.overflowX)) {
          const pr = cur.getBoundingClientRect();
          visLeft = Math.max(visLeft, pr.left);
          visRight = Math.min(visRight, pr.right);
        }
        cur = cur.parentElement;
      }

      if (visLeft < visRight && (visRight > clientWidth + 1 || visLeft < -1)) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
            : '';
        elementBreaches.push({
          selector: `${tag}${id}${cls}`,
          visLeft: Math.round(visLeft * 10) / 10,
          visRight: Math.round(visRight * 10) / 10,
          clientWidth,
        });
      }
    }

    return { clientWidth, scrollWidth, bodyScrollWidth, elementBreaches };
  });

  const breaches: GuardrailBreach[] = [];
  if (result.scrollWidth > result.clientWidth || result.bodyScrollWidth > result.clientWidth) {
    breaches.push({
      check: 'document-overflow',
      viewport: viewportLabel,
      message: `Document horizontal overflow (scrollWidth=${result.scrollWidth}, bodyScrollWidth=${result.bodyScrollWidth}, clientWidth=${result.clientWidth})`,
    });
  }

  for (const item of result.elementBreaches) {
    breaches.push({
      check: 'element-overflow',
      viewport: viewportLabel,
      selector: item.selector,
      message: `Element ${item.selector} overflows viewport [${item.visLeft}..${item.visRight}] > clientWidth=${item.clientWidth}`,
    });
  }

  return {
    clientWidth: result.clientWidth,
    scrollWidth: result.scrollWidth,
    bodyScrollWidth: result.bodyScrollWidth,
    breaches,
  };
}

/**
 * Audits visible buttons, links, and pill elements for viewport breaches,
 * ancestor overflow-x clipping, and internal scrollWidth truncation.
 */
export async function auditPillAndButtonBounds(
  page: Page,
  options: PillAuditOptions = {},
  viewportLabel?: string
): Promise<GuardrailBreach[]> {
  const selector = options.selector ?? 'a, button, [class*="rounded-full"], [class*="rounded-xl"]';
  const skipScrollable = options.skipHorizontallyScrollableAncestors ?? true;

  const rawBreaches = await page.evaluate(
    ({ sel, skipScroll }) => {
      const docEl = document.documentElement;
      const clientWidth = docEl.clientWidth;
      const findings: Array<{ selector: string; message: string }> = [];

      const fmtEl = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof (el as HTMLElement).className === 'string' && (el as HTMLElement).className.trim()
            ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join('.')
            : '';
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        return `${tag}${id}${cls}${txt ? ` ("${txt}")` : ''}`;
      };

      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        if (el.closest('dialog:not([open])')) continue;
        if (skipScroll && el.parentElement?.closest('.overflow-x-auto, .overflow-x-scroll')) continue;

        let hiddenAncestor = false;
        let curVis: Element | null = el;
        while (curVis && curVis !== docEl) {
          const vcs = window.getComputedStyle(curVis);
          if (
            vcs.display === 'none' ||
            vcs.visibility === 'hidden' ||
            parseFloat(vcs.opacity) === 0 ||
            curVis.classList.contains('sr-only')
          ) {
            hiddenAncestor = true;
            break;
          }
          curVis = curVis.parentElement;
        }
        if (hiddenAncestor) continue;

        const cs = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue;

        if (r.left < 0 || r.right > clientWidth) {
          findings.push({
            selector: fmtEl(el),
            message: `Element breaches viewport [0..${clientWidth}]: [${Math.round(r.left * 10) / 10}..${Math.round(r.right * 10) / 10}]`,
          });
          continue;
        }

        let anc = el.parentElement;
        while (anc && anc !== document.body && anc !== docEl) {
          if (skipScroll && (anc.classList.contains('overflow-x-auto') || anc.classList.contains('overflow-x-scroll'))) {
            break;
          }
          const acs = window.getComputedStyle(anc);
          if (acs.overflowX === 'hidden' || acs.overflowX === 'clip') {
            const ar = anc.getBoundingClientRect();
            const abl = parseFloat(acs.borderLeftWidth || '0');
            const abr = parseFloat(acs.borderRightWidth || '0');
            if (r.left < ar.left + abl - 1.5 || r.right > ar.right - abr + 1.5) {
              findings.push({
                selector: fmtEl(el),
                message: `Clipped by ancestor ${fmtEl(anc)} [${Math.round((ar.left + abl) * 10) / 10}..${Math.round((ar.right - abr) * 10) / 10}]`,
              });
              break;
            }
          }
          anc = anc.parentElement;
        }

        if (
          (cs.overflowX === 'hidden' || cs.overflowX === 'clip') &&
          el.scrollWidth > el.clientWidth + 1
        ) {
          findings.push({
            selector: fmtEl(el),
            message: `Internal text/content overflow: scrollWidth=${el.scrollWidth} > clientWidth=${el.clientWidth}`,
          });
        }
      }

      return findings;
    },
    { sel: selector, skipScroll: skipScrollable }
  );

  return rawBreaches.map((b) => ({
    check: 'pill-clip',
    viewport: viewportLabel,
    selector: b.selector,
    message: b.message,
  }));
}

/**
 * Verifies 0px (or tolerancePx) edge-flush alignment between the header's leading
 * brand element and trailing CTA against a reference container, plus minimum gap.
 */
export async function auditHeaderEdgeFlush(
  page: Page,
  options: HeaderFlushOptions = {},
  viewportLabel?: string
): Promise<GuardrailBreach[]> {
  const headerSelector = options.headerSelector ?? 'header';
  const brandSelector = options.brandSelector ?? '.brand-link, a';
  const ctaSelector = options.ctaSelector ?? 'a:last-of-type, button:last-of-type';
  const containerSelector = options.containerSelector ?? 'main > section, .gate-card, main';
  const tolerancePx = options.tolerancePx ?? 1;
  const minGapPx = options.minGapPx ?? 12;

  const issues = await page.evaluate(
    ({ hSel, bSel, cSel, boxSel, tol, minGap }) => {
      const msgs: string[] = [];
      const header = document.querySelector(hSel);
      const container = document.querySelector(boxSel);
      if (!header || !container) return msgs;

      const brand = header.querySelector(bSel);
      const cta = header.querySelector(cSel);
      if (!brand || !cta || brand === cta) return msgs;

      const brandRect = brand.getBoundingClientRect();
      const ctaRect = cta.getBoundingClientRect();
      const boxRect = container.getBoundingClientRect();

      const leftDelta = Math.round(Math.abs(brandRect.left - boxRect.left) * 10) / 10;
      const rightDelta = Math.round(Math.abs(ctaRect.right - boxRect.right) * 10) / 10;
      const gap = Math.round((ctaRect.left - brandRect.right) * 10) / 10;

      if (leftDelta > tol) {
        msgs.push(`Header left edge delta=${leftDelta}px (expected <= ${tol}px)`);
      }
      if (rightDelta > tol) {
        msgs.push(`Header right edge delta=${rightDelta}px (expected <= ${tol}px)`);
      }
      if (gap < minGap) {
        msgs.push(`Header brand-to-CTA gap too tight: ${gap}px (expected >= ${minGap}px)`);
      }
      return msgs;
    },
    {
      hSel: headerSelector,
      bSel: brandSelector,
      cSel: ctaSelector,
      boxSel: containerSelector,
      tol: tolerancePx,
      minGap: minGapPx,
    }
  );

  return issues.map((message) => ({
    check: 'header-flush',
    viewport: viewportLabel,
    selector: headerSelector,
    message,
  }));
}

/**
 * Verifies all visible interactive/content elements inside a container stay
 * within its inner border box.
 */
export async function auditInnerContainerBounds(
  page: Page,
  containerSelector: string,
  options: InnerContainerOptions = {},
  viewportLabel?: string
): Promise<GuardrailBreach[]> {
  const inspectSelector = options.inspectSelector ?? 'a, button, input, select, textarea, h1, h2, p, span';
  const tolerancePx = options.tolerancePx ?? 1.5;

  const raw = await page.evaluate(
    ({ cSel, iSel, tol }) => {
      const container = document.querySelector(cSel);
      if (!container) return [];
      const cs = window.getComputedStyle(container);
      const cr = container.getBoundingClientRect();
      const innerLeft = cr.left + parseFloat(cs.borderLeftWidth || '0');
      const innerRight = cr.right - parseFloat(cs.borderRightWidth || '0');
      const breaches: Array<{ selector: string; message: string }> = [];

      const els = Array.from(container.querySelectorAll(iSel));
      for (const el of els) {
        const ecs = window.getComputedStyle(el);
        if (ecs.display === 'none' || ecs.visibility === 'hidden' || parseFloat(ecs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue;
        if (r.left < innerLeft - tol || r.right > innerRight + tol) {
          const tag = el.tagName.toLowerCase();
          breaches.push({
            selector: tag,
            message: `Element <${tag}> crosses ${cSel} inner box [${Math.round(innerLeft * 10) / 10}..${Math.round(innerRight * 10) / 10}]: [${Math.round(r.left * 10) / 10}..${Math.round(r.right * 10) / 10}]`,
          });
        }
      }
      return breaches;
    },
    { cSel: containerSelector, iSel: inspectSelector, tol: tolerancePx }
  );

  return raw.map((b) => ({
    check: 'inner-container',
    viewport: viewportLabel,
    selector: b.selector,
    message: b.message,
  }));
}

export interface RunGuardrailsOptions {
  viewports?: ViewportSpec[];
  checkPills?: boolean | PillAuditOptions;
  headerFlush?: HeaderFlushOptions;
  innerContainers?: string[];
}

export interface RunGuardrailsReport {
  passed: boolean;
  viewportsChecked: number;
  breaches: GuardrailBreach[];
}

/**
 * Runs the full multi-viewport guardrail suite across the specified viewports.
 */
export async function runViewportGuardrails(
  page: Page,
  options: RunGuardrailsOptions = {}
): Promise<RunGuardrailsReport> {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const breaches: GuardrailBreach[] = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const overflow = await auditViewportOverflow(page, vp.label);
    breaches.push(...overflow.breaches);

    if (options.checkPills !== false) {
      const pillOpts = typeof options.checkPills === 'object' ? options.checkPills : {};
      breaches.push(...(await auditPillAndButtonBounds(page, pillOpts, vp.label)));
    }

    if (options.headerFlush) {
      breaches.push(...(await auditHeaderEdgeFlush(page, options.headerFlush, vp.label)));
    }

    if (options.innerContainers) {
      for (const containerSel of options.innerContainers) {
        breaches.push(...(await auditInnerContainerBounds(page, containerSel, {}, vp.label)));
      }
    }
  }

  return {
    passed: breaches.length === 0,
    viewportsChecked: viewports.length,
    breaches,
  };
}
