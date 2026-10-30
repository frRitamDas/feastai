import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

/** Optional browser smoke test; provide a local Chromium executable via env. */
export async function exerciseBrowser(base: string) {
  const executablePath = process.env.GRACE_BROWSER_EXECUTABLE;
  assert.ok(executablePath, "Chromium executable is required");
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
  });
  try {
    // Failure to provision a guest must never block access to account pages.
    const noIpContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const noIpPage = await noIpContext.newPage();
    const signup = await noIpPage.goto(`${base}/register`);
    assert.equal(signup?.status(), 200);
    await noIpPage.getByRole("heading", { name: "Create account" }).waitFor();
    await noIpPage.getByLabel("Email").fill("no-ip@example.com");
    await noIpPage.getByLabel("Password").fill("correct-password");
    await noIpPage.getByRole("button", { name: "Sign up" }).click();
    await noIpPage
      .getByRole("alert")
      .getByText(/couldn't create/)
      .waitFor();
    assert.equal(
      await noIpPage.getByLabel("Email").inputValue(),
      "no-ip@example.com"
    );
    assert.equal(
      await noIpPage.getByLabel("Password").inputValue(),
      "correct-password"
    );
    await noIpPage.goto(`${base}/`);
    await noIpPage.waitForURL(`${base}/login?guest=unavailable`);
    await noIpPage
      .getByRole("alert")
      .getByText(/Guest access/)
      .waitFor();
    await noIpContext.close();

    // With a trusted client IP and working database, real guest provisioning
    // should issue a session and open the chat rather than the fallback page.
    const guestContext = await browser.newContext({
      extraHTTPHeaders: { "x-real-ip": "203.0.113.11" },
      ignoreHTTPSErrors: true,
    });
    const guestPage = await guestContext.newPage();
    await guestPage.goto(`${base}/`);
    await guestPage.getByTestId("multimodal-input").waitFor();
    await guestContext.close();

    // A real browser submission must display verification failures without
    // erasing entered fields, then create and sign in the account. Only the
    // external Turnstile response is stubbed by the isolated test process.
    const registrationContext = await browser.newContext({
      extraHTTPHeaders: { "x-real-ip": "203.0.113.12" },
      ignoreHTTPSErrors: true,
    });
    const registrationPage = await registrationContext.newPage();
    await registrationPage.goto(`${base}/register`);
    await registrationPage.getByLabel("Email").fill("new-person@example.com");
    await registrationPage.getByLabel("Password").fill("correct-password");
    await registrationPage.getByRole("button", { name: "Sign up" }).click();
    try {
      await registrationPage
        .getByRole("alert")
        .getByText(/Browser verification failed/)
        .waitFor({ timeout: 10_000 });
    } catch (error) {
      console.error(
        "Registration page:",
        await registrationPage.locator("body").innerText()
      );
      throw error;
    }
    assert.equal(
      await registrationPage.getByLabel("Email").inputValue(),
      "new-person@example.com"
    );
    assert.equal(
      await registrationPage.getByLabel("Password").inputValue(),
      "correct-password"
    );
    await registrationPage.locator("form").evaluate((form) => {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "cf-turnstile-response";
      field.value = "integration-valid-challenge";
      form.append(field);
    });
    await registrationPage.getByRole("button", { name: "Sign up" }).click();
    await registrationPage.waitForURL(`${base}/`, { timeout: 30_000 });
    await registrationPage.getByTestId("multimodal-input").waitFor();
    const registeredSession = await registrationPage.request.get(
      `${base}/api/auth/session`
    );
    assert.equal(
      (await registeredSession.json()).user.email,
      "new-person@example.com"
    );
    await registrationContext.close();

    const context = await browser.newContext({
      extraHTTPHeaders: { "x-real-ip": "203.0.113.10" },
      ignoreHTTPSErrors: true,
      viewport: { height: 900, width: 1440 },
    });
    // The isolated browser cannot reach Vercel's real BotID challenge service.
    // Only this test stubs its challenge; the app itself is unchanged.
    await context.route("**/a-4-a/c.js?*", (route) =>
      route.fulfill({
        body: "window.V_C.push({b:1,d:0});",
        contentType: "application/javascript",
        status: 200,
      })
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/login`);
    await page.getByLabel("Email").fill("person@example.com");
    await page.getByLabel("Password").fill("incorrect-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page
      .getByRole("alert")
      .getByText(/couldn't sign you in/)
      .waitFor();
    assert.equal(
      await page.getByLabel("Email").inputValue(),
      "person@example.com"
    );
    assert.equal(
      await page.getByLabel("Password").inputValue(),
      "incorrect-password"
    );
    await page.getByLabel("Password").fill("correct-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${base}/`, { timeout: 30_000 });
    await page.getByTestId("multimodal-input").waitFor();
    await page.getByText("Hello, what’s on your mind?").waitFor();
    assert.equal(
      await page.getByTestId("attachments-button").isVisible(),
      true
    );
    if (process.env.GRACE_BROWSER_SCREENSHOT_DIR) {
      await page.screenshot({
        animations: "disabled",
        path: `${process.env.GRACE_BROWSER_SCREENSHOT_DIR}/grace-desktop.png`,
      });
    }

    // Real private upload, followed by a file-only submission. The browser-only
    // response mock isolates rendering; HTTP integration covers server streaming.
    const uploaded = page.waitForResponse("**/api/files/upload");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        buffer: Buffer.from("A private browser smoke-test note"),
        mimeType: "text/plain",
        name: "note.txt",
      });
    const uploadResponse = await uploaded;
    assert.equal(uploadResponse.status(), 200, await uploadResponse.text());
    await page.getByTestId("input-attachment-preview").waitFor();
    await page
      .getByTestId("input-attachment-loader")
      .waitFor({ state: "hidden" });
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>(
        "[data-testid='send-button']"
      );
      return button !== null && !button.disabled;
    });
    let sentAttachment = false;
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON();
      sentAttachment =
        body.message?.parts?.some(
          (part: { type: string }) => part.type === "file"
        ) === true;
      const chunks = [
        { messageId: "browser-response", type: "start" },
        { type: "start-step" },
        { id: "t1", type: "text-start" },
        { delta: "Browser smoke response", id: "t1", type: "text-delta" },
        { id: "t1", type: "text-end" },
        { type: "finish-step" },
        { type: "finish" },
      ];
      await route.fulfill({
        body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        status: 200,
      });
    });
    await page.getByTestId("send-button").click();
    await page
      .getByTestId("message-assistant")
      .last()
      .waitFor({ timeout: 30_000 });
    assert.equal(sentAttachment, true);

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`${base}/`);
    await page.getByTestId("multimodal-input").waitFor();
    await page.getByText("Hello, what’s on your mind?").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      true,
      "mobile layout must not overflow horizontally"
    );
    if (process.env.GRACE_BROWSER_SCREENSHOT_DIR) {
      await page.screenshot({
        animations: "disabled",
        path: `${process.env.GRACE_BROWSER_SCREENSHOT_DIR}/grace-mobile.png`,
      });
    }
    await page.goto(`${base}/administrator`);
    await page
      .getByRole("heading", { name: "Administrator verification" })
      .waitFor();
    assert.deepEqual(errors, [], `browser exceptions: ${errors.join("; ")}`);
    await context.close();
    console.log(
      "Browser smoke passed: login, desktop/mobile chat, attachment-only rendering and admin verification"
    );
  } finally {
    await browser.close();
  }
}
