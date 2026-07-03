// ============================================================================
//  Playwrightで note.com のエディタを操作する
//  ・ログイン済みセッション(persistent context)を再利用
//  ・タイトルと本文を入れて「下書き」として自動保存させる
//  ・公開・有料設定には絶対に進まない（安全装置つき）
// ============================================================================
import { chromium } from "playwright";
import { config, FORBIDDEN_CLICK_TEXTS } from "../config.mjs";

// ログイン済みブラウザを起動（初回ログインでも通常実行でも共通で使う）
export async function launchContext({ headless = config.headless } = {}) {
  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 900 },
  });
  // 貼り付け（クリップボード）を使うので権限を付与
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://note.com",
    });
  } catch {
    /* 権限付与に失敗しても後段でフォールバックする */
  }
  return context;
}

// ログイン状態かどうかを確認する
export async function isLoggedIn(page) {
  await page.goto(config.note.newDraftUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (page.url().includes(config.note.loginUrlHint)) return false;
  // タイトル欄が出ていればログイン済みとみなす
  const titleSel = config.note.titleSelectors.join(", ");
  const el = await page.$(titleSel);
  return !!el;
}

/**
 * 1本を「下書き」として作成する。
 * @returns {{ url: string }}
 * @throws  ログインしていない / エディタが見つからない 等
 */
export async function createDraft(page, { title, bodyHtml }, { screenshotPath }) {
  // 常に「新規作成」から始める
  await page.goto(config.note.newDraftUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  if (page.url().includes(config.note.loginUrlHint)) {
    throw new Error("NOT_LOGGED_IN: ログインが切れています。`npm run login` をやり直してください。");
  }

  // ---- タイトル入力欄 ----
  const titleSel = config.note.titleSelectors.join(", ");
  await page.waitForSelector(titleSel, { timeout: 30000 });
  const titleEl = page.locator(titleSel).first();
  await titleEl.click();
  await titleEl.fill(title);

  // ---- 本文エディタ ----
  const bodySel = config.note.bodySelectors.join(", ");
  await page.waitForSelector(bodySel, { timeout: 30000 });
  const bodyEl = page.locator(bodySel).first();
  await bodyEl.click();

  // 本文をHTMLごと「貼り付け」て、note側に装飾を変換させる
  await pasteHtml(page, bodyEl, bodyHtml);

  // ---- 自動保存(下書き)を待つ ----
  // noteは編集を始めると自動で下書きを作り、自動保存します。
  // ここでは公開ボタン等は一切押さず、保存されるのを待つだけ。
  await page.waitForTimeout(config.autosaveWaitMs);

  // 念のため安全確認：この瞬間に公開系の確認画面に居ないこと
  await assertNotOnPublishScreen(page);

  if (screenshotPath) {
    try {
      await page.screenshot({ path: screenshotPath });
    } catch {
      /* スクショ失敗は致命的ではない */
    }
  }

  return { url: page.url() };
}

// HTMLをクリップボード経由で貼り付ける（失敗時は合成pasteイベントにフォールバック）
async function pasteHtml(page, bodyEl, bodyHtml) {
  const plain = bodyHtml.replace(/<[^>]+>/g, "");
  let clipboardOk = false;
  try {
    await page.evaluate(
      async ({ html, text }) => {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      },
      { html: bodyHtml, text: plain }
    );
    clipboardOk = true;
  } catch {
    clipboardOk = false;
  }

  if (clipboardOk) {
    await bodyEl.click();
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+V`);
    await page.waitForTimeout(1500);
    // 貼り付いたか軽く確認。空ならフォールバックへ。
    const len = (await bodyEl.innerText().catch(() => "")).trim().length;
    if (len > 0) return;
  }

  // フォールバック：contenteditable に paste イベントを直接発火
  await bodyEl.click();
  await page.evaluate(
    ({ sel, html, text }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      dt.setData("text/plain", text);
      const ev = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
    },
    { sel: config.note.bodySelectors[0], html: bodyHtml, text: plain }
  );
  await page.waitForTimeout(1500);
}

// 安全装置：公開系の画面/ボタンが前面に出ていたら止める
async function assertNotOnPublishScreen(page) {
  for (const word of FORBIDDEN_CLICK_TEXTS) {
    // "公開" を含む見出し・ダイアログが表示されていないか（可視要素のみ）
    const visible = await page
      .locator(`text=${word}`)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible && (word === "公開設定" || word === "公開に進む")) {
      throw new Error(
        `SAFETY_STOP: 公開系の画面(${word})が表示されました。安全のため処理を止めます。`
      );
    }
  }
}
