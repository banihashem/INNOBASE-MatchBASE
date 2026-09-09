import { expect, test } from "@playwright/test";
import { overflowingElements } from "./accessibility-matrix.mjs";

test("reflow inspection excludes clipped screen-reader text but detects clipped controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.setContent(`
    <p style="position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)">Accessible status</p>
    <main style="width:100px;overflow:hidden"><button style="width:500px">Clipped control</button></main>
  `);
  const overflow = await overflowingElements(page);
  expect(overflow).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tag: "BUTTON", text: "Clipped control" }),
    ]),
  );
  expect(overflow.some((item) => item.text === "Accessible status")).toBe(
    false,
  );
});
