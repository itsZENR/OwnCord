import { test, expect } from "@playwright/test";
import { mockTauriFullSessionWithVoice, navigateToMainPage } from "./helpers";

test("repeated voice channel clicks open its chat without leaving the call", async ({ page }) => {
  await mockTauriFullSessionWithVoice(page);
  await page.goto("/");
  await navigateToMainPage(page);

  const voiceChannel = page.getByTestId("channel-10");
  const voiceWidget = page.locator(".voice-widget.visible");
  await expect(voiceWidget).toBeVisible();

  await voiceChannel.click();
  await expect(page.getByTestId("chat-header-name")).toHaveText("Voice Chat");
  await expect(page.getByTestId("chat-area")).toBeVisible();
  await expect(voiceWidget).toBeVisible();

  await page.getByTestId("achievements-tab").click();
  await expect(page.getByTestId("chat-area")).toBeHidden();

  await voiceChannel.click();
  await expect(page.getByTestId("chat-area")).toBeVisible();
  await expect(page.getByTestId("chat-header-name")).toHaveText("Voice Chat");
  await expect(voiceWidget).toBeVisible();
});

test("chat buttons let a caller read other channels without changing voice membership", async ({ page }) => {
  await mockTauriFullSessionWithVoice(page);
  await page.goto("/");
  await navigateToMainPage(page);

  const voiceWidget = page.locator(".voice-widget.visible");
  await expect(voiceWidget).toBeVisible();
  await expect(voiceWidget.locator(".vw-channel")).toHaveText("Voice Chat");

  await page.getByTestId("channel-chat-11").click();
  await expect(page.getByTestId("chat-header-name")).toHaveText("Music");
  await expect(page.getByTestId("chat-area")).toBeVisible();
  await expect(voiceWidget.locator(".vw-channel")).toHaveText("Voice Chat");

  await page.getByTestId("achievements-tab").click();
  await expect(page.getByTestId("chat-area")).toBeHidden();
  await page.getByTestId("channel-chat-1").click();
  await expect(page.getByTestId("chat-header-name")).toHaveText("general");
  await expect(page.getByTestId("chat-area")).toBeVisible();
  await expect(voiceWidget.locator(".vw-channel")).toHaveText("Voice Chat");
});
