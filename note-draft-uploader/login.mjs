// ============================================================================
//  初回ログイン用スクリプト（あなたが最初に一度だけ実行）
//  ・ブラウザが開くので、いつも通り note に手でログインしてください
//  ・ログインできたら、ターミナルで Enter を押すと、その状態が保存されます
//  ・パスワードやCookieはコードには保存されません（ブラウザプロファイルとして
//    .note-user-data/ に入るだけ。Gitには上げません）
// ============================================================================
import readline from "node:readline";
import { launchContext, isLoggedIn } from "./lib/note.mjs";
import { config } from "./config.mjs";

function waitEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log("ブラウザを開きます。noteにログインしてください…");
  // ログインは必ず画面を表示して行う
  const context = await launchContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto("https://note.com/login", { waitUntil: "domcontentloaded" });

  await waitEnter(
    "\n▶ noteにログインし終えたら、このターミナルで Enter を押してください… "
  );

  const ok = await isLoggedIn(page);
  if (ok) {
    console.log("\n✅ ログイン状態を確認できました。セッションを保存しました。");
    console.log(`   保存先: ${config.userDataDir}`);
    console.log("   次は  npm run dry-run  で中身の確認、または  npm run one  で1本だけ下書き作成です。");
  } else {
    console.log(
      "\n⚠ まだログインが確認できませんでした。もう一度 `npm run login` を実行し、確実にログインしてから Enter を押してください。"
    );
  }

  await context.close();
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
