import { test, expect } from "@playwright/test";

for (const source of [{ name: "ultrawide", width: 2560, height: 1080 }, { name: "portrait", width: 1080, height: 1920 }]) {
  test(`screen sharing keeps all edges of a ${source.name} source in grid and focus view`, async ({ page }, testInfo) => {
    await page.route("http://localhost:1420/", (route) => route.fulfill({
      contentType: "text/html",
      body: '<html><head><link rel="stylesheet" href="/src/styles/app.css"></head><body><div id="stream-test" style="width:900px;height:650px"></div></body></html>',
    }));
    await page.goto("/");
    await page.evaluate(async ({ width, height }) => {
      const capturePath = "/src/lib/screenCapture.ts";
      const gridPath = "/src/components/VideoGrid.ts";
      const { captureScreen } = await import(capturePath);
      const { createVideoGrid } = await import(gridPath);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#223344";
      ctx.fillRect(0, 0, width, height);
      for (const [color, x, y] of [["red", 0, 0], ["lime", width - 100, 0], ["blue", 0, height - 100], ["yellow", width - 100, height - 100]] as const) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 100, 100);
      }
      const sourceStream = canvas.captureStream(5);
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { configurable: true, value: async () => sourceStream });
      const { tracks } = await captureScreen({ resolution: { width: 0, height: 0 } });
      const grid = createVideoGrid();
      grid.mount(document.querySelector("#stream-test")!);
      grid.addStream(1_000_001, "Ваш экран", new MediaStream([tracks[0].mediaStreamTrack]),
        { isSelf: true, audioUserId: 1, isScreenshare: true });
      const focus = document.createElement("button");
      focus.textContent = "Развернуть трансляцию";
      focus.onclick = () => grid.setFocusedTile(1_000_001);
      document.body.append(focus);
    }, source);
    const video = page.locator(".video-cell.screenshare video");
    await expect(video).toHaveJSProperty("videoWidth", source.width);
    await expect(video).toHaveJSProperty("videoHeight", source.height);
    await expect(video).toHaveCSS("object-fit", "contain");
    await expect(video).toHaveJSProperty("muted", true);
    await expect(page.locator(".tile-mute-btn")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${source.name}-grid.png`) });
    await page.getByRole("button", { name: "Развернуть трансляцию" }).click();
    await expect(page.locator(".video-cell.focused")).toBeVisible();
    await expect(video).toHaveCSS("object-fit", "contain");
    await page.screenshot({ path: testInfo.outputPath(`${source.name}-focus.png`) });
  });
}
