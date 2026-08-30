import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

export const wcag22Tags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export async function overflowingElements(page) {
  return page.locator("body *").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rectangle = element.getBoundingClientRect();
        if (
          rectangle.right <= document.documentElement.clientWidth + 0.5 &&
          rectangle.left >= -0.5
        )
          return false;
        for (
          let ancestor = element.parentElement;
          ancestor && ancestor !== document.body;
          ancestor = ancestor.parentElement
        ) {
          const overflow = getComputedStyle(ancestor).overflowX;
          if (["auto", "scroll"].includes(overflow)) return false;
        }
        return true;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.trim().slice(0, 80),
        bounds: element.getBoundingClientRect().toJSON(),
      })),
  );
}

export async function applyWcagTextSpacing(page) {
  await page.evaluate(() => {
    document.querySelector("[data-task072-text-spacing]")?.remove();
    const style = document.createElement("style");
    style.dataset.task072TextSpacing = "true";
    style.textContent = `
      html { font-size: 200% !important; }
      * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `;
    document.head.append(style);
  });
}

export async function removeWcagTextSpacing(page) {
  await page.evaluate(() => {
    document.querySelector("[data-task072-text-spacing]")?.remove();
  });
}

export async function expectAxeClean(page, state) {
  expect(
    (await new AxeBuilder({ page }).withTags(wcag22Tags).analyze()).violations,
    `${state}: Axe WCAG 2.0/2.1/2.2 A/AA violations`,
  ).toEqual([]);
}

export async function expectAccessibleState(
  page,
  state,
  { responsive = false } = {},
) {
  await expectAxeClean(page, state);
  if (!responsive) return;

  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 844 });
  await applyWcagTextSpacing(page);
  try {
    await expectAxeClean(page, `${state} at 320px with WCAG text spacing`);
    expect(
      await overflowingElements(page),
      `${state}: content overflow at 320px with WCAG text spacing`,
    ).toEqual([]);
  } finally {
    await removeWcagTextSpacing(page);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
