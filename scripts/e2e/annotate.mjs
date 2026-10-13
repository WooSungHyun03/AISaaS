// Draws numbered markers, highlight boxes and arrows over a live page before it is screenshotted,
// so the guide images point at the real controls. Nothing is stored in the page; it is removed after the capture.

const OVERLAY_ID = "__guide_overlay__";

async function measure(page, marks) {
  const boxes = [];
  for (const mark of marks) {
    const locator = mark.target.first();
    await locator.waitFor({ state: "visible", timeout: 10_000 });
    boxes.push({ n: mark.n, pad: mark.pad, arrow: mark.arrow, box: await locator.boundingBox() });
  }
  return boxes;
}

const isOutside = (item, viewport) => !item.box || item.box.y < 0 || item.box.y + Math.min(item.box.height, 40) > viewport.height;

export async function annotate(page, marks) {
  const viewport = page.viewportSize();
  let boxes = await measure(page, marks);
  if (boxes.some((item) => isOutside(item, viewport))) {
    // Bring the first marked control near the top so the rest, which follow it on the page, fit on the same screen.
    await marks[0].target.first().evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -90));
    await page.waitForTimeout(250);
    boxes = await measure(page, marks);
  }
  const missing = boxes.filter((item) => isOutside(item, viewport));
  if (missing.length > 0) throw new Error(`화면 밖에 있는 표시 대상: ${missing.map((item) => item.n).join(", ")}`);
  await page.evaluate(({ id, items, width, height }) => {
    document.getElementById(id)?.remove();
    const root = document.createElement("div");
    root.id = id;
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
    const COLOR = "#F59E0B";
    for (const item of items) {
      const pad = item.pad ?? 4;
      const x = Math.max(2, item.box.x - pad);
      const y = Math.max(2, item.box.y - pad);
      const w = Math.min(width - 4 - x, item.box.width + pad * 2);
      const h = Math.min(height - 4 - y, item.box.height + pad * 2);
      const frame = document.createElement("div");
      frame.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:3px solid ${COLOR};border-radius:12px;box-shadow:0 0 0 4px rgba(245,158,11,.25);`;
      root.appendChild(frame);
      const size = 28;
      const bx = Math.min(width - size - 4, Math.max(4, x - 10));
      const by = Math.min(height - size - 4, Math.max(4, y - 14));
      const badge = document.createElement("div");
      badge.textContent = String(item.n);
      badge.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${size}px;height:${size}px;border-radius:50%;background:${COLOR};color:#111827;font:800 15px/${size}px sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;box-sizing:border-box;`;
      root.appendChild(badge);
      if (item.arrow) {
        // An arrow coming in from the side with more room (right edge of the box when it is on the left half, else left edge).
        const fromLeft = x + w / 2 > width / 2;
        const ax = fromLeft ? x - 70 : x + w + 70;
        const ay = y + h / 2;
        const tipX = fromLeft ? x - 6 : x + w + 6;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.style.cssText = "position:absolute;left:0;top:0;";
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const dir = fromLeft ? 1 : -1;
        line.setAttribute("d", `M ${ax} ${ay - 30} Q ${ax + dir * 20} ${ay} ${tipX - dir * 6} ${ay}`);
        line.setAttribute("stroke", COLOR);
        line.setAttribute("stroke-width", "4");
        line.setAttribute("fill", "none");
        line.setAttribute("stroke-linecap", "round");
        const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
        head.setAttribute("d", `M ${tipX} ${ay} l ${-dir * 14} -9 l 0 18 z`);
        head.setAttribute("fill", COLOR);
        svg.append(line, head);
        root.appendChild(svg);
      }
    }
    document.body.appendChild(root);
  }, { id: OVERLAY_ID, items: boxes, width: viewport.width, height: viewport.height });
}

export async function clearAnnotations(page) {
  await page.evaluate((id) => document.getElementById(id)?.remove(), OVERLAY_ID);
}
