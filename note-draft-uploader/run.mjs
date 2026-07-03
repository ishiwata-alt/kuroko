// ============================================================================
//  メイン処理：HTMLフォルダを読み、noteに「下書き」として順に投入する
//
//  使い方（Macのターミナルで、このフォルダに入ってから）:
//    npm run dry-run              … 実際には投稿せず、抽出結果だけ確認（安全）
//    npm run one                  … 1本だけ下書き作成（まずこれで確認）
//    npm run all                  … 残り全部をまとめて下書き作成
//    node run.mjs --file 記事.html … 特定の1ファイルだけ
//    node run.mjs --all --limit 3 … 先頭3本だけ
//
//  失敗した記事はログに残してスキップし、全体は止めません。
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { extractFromHtml } from "./lib/extract.mjs";
import { launchContext, createDraft, isLoggedIn } from "./lib/note.mjs";

function parseArgs(argv) {
  const args = { dryRun: false, all: false, limit: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--all") args.all = true;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--file") args.file = argv[++i];
  }
  return args;
}

function listHtmlFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(
      `入力フォルダが見つかりません: ${dir}\n` +
        `  config.mjs の inputDir を直すか、環境変数 NOTE_HTML_DIR で指定してください。`
    );
  }
  return fs
    .readdirSync(dir)
    .filter((f) => config.filePattern.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function ts() {
  // 実行ごとに一意なフォルダ名を作るための簡易タイムスタンプ
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 対象ファイルを決める
  let files;
  if (args.file) {
    const p = path.isAbsolute(args.file)
      ? args.file
      : path.join(config.inputDir, args.file);
    files = [p];
  } else {
    files = listHtmlFiles(config.inputDir);
    if (!args.all && args.limit == null) {
      // 引数なしのときは安全側で1本だけ
      args.limit = 1;
    }
    if (args.limit != null) files = files.slice(0, args.limit);
  }

  if (files.length === 0) {
    console.log("対象のHTMLファイルがありませんでした。");
    return;
  }

  ensureDir(config.logDir);
  const runId = ts();
  const runLogPath = path.join(config.logDir, `run-${runId}.jsonl`);
  const shotDir = path.join(config.logDir, `shots-${runId}`);
  if (!args.dryRun) ensureDir(shotDir);

  console.log(`== note下書き投入 ==`);
  console.log(`入力フォルダ : ${config.inputDir}`);
  console.log(`対象本数     : ${files.length}`);
  console.log(`モード       : ${args.dryRun ? "DRY-RUN（投稿しない）" : "本番（下書き作成）"}`);
  console.log(`ログ         : ${runLogPath}`);
  console.log("");

  // DRY-RUN：ブラウザを起動せず、抽出結果だけ確認する
  if (args.dryRun) {
    const dryDir = path.join(config.logDir, `dry-${runId}`);
    ensureDir(dryDir);
    for (const file of files) {
      const name = path.basename(file);
      try {
        const html = fs.readFileSync(file, "utf8");
        const { title, bodyHtml, titleSource } = extractFromHtml(
          html,
          name.replace(config.filePattern, "")
        );
        fs.writeFileSync(
          path.join(dryDir, name + ".txt"),
          `【タイトル】(${titleSource})\n${title}\n\n【本文HTML（先頭2000字）】\n${bodyHtml.slice(0, 2000)}\n`
        );
        logLine(runLogPath, { file: name, status: "extracted", title, titleSource });
        console.log(`  ✓ ${name}\n      タイトル: 「${title}」  ← ${titleSource}`);
      } catch (e) {
        logLine(runLogPath, { file: name, status: "error", error: e.message });
        console.log(`  ✗ ${name}  抽出失敗: ${e.message}`);
      }
    }
    console.log(`\n抽出結果の全文は ${dryDir} に保存しました。タイトルがおかしければ config.mjs の titleSelector を調整してください。`);
    return;
  }

  // 本番：ログイン済みブラウザを1回だけ起動して順に処理
  const context = await launchContext();
  const page = context.pages()[0] || (await context.newPage());

  if (!(await isLoggedIn(page))) {
    console.error(
      "⚠ ログインが確認できません。先に `npm run login` を実行してください。"
    );
    await context.close();
    process.exit(1);
  }

  let ok = 0;
  let ng = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file);
    process.stdout.write(`[${i + 1}/${files.length}] ${name} … `);
    try {
      const html = fs.readFileSync(file, "utf8");
      const { title, bodyHtml, titleSource } = extractFromHtml(
        html,
        name.replace(config.filePattern, "")
      );
      if (!bodyHtml || bodyHtml.trim().length === 0) {
        throw new Error("本文が空です");
      }
      const shot = path.join(shotDir, name + ".png");
      const { url } = await createDraft(page, { title, bodyHtml }, { screenshotPath: shot });
      ok++;
      logLine(runLogPath, {
        file: name,
        status: "draft_created",
        title,
        titleSource,
        url,
        screenshot: shot,
      });
      console.log(`✅ 下書き作成（「${title}」）`);
    } catch (e) {
      ng++;
      logLine(runLogPath, { file: name, status: "error", error: e.message });
      console.log(`✗ 失敗 → スキップ: ${e.message}`);
    }

    // 次の記事まで少し待つ（連続作成でnoteに負荷をかけない）
    if (i < files.length - 1) await page.waitForTimeout(config.delayBetweenMs);
  }

  console.log(`\n== 完了 == 成功:${ok}本 / 失敗:${ng}本`);
  console.log(`ログ: ${runLogPath}`);
  console.log(`スクショ: ${shotDir}`);
  console.log(`\n▶ noteの下書き一覧で確認してください: ${config.note.draftListUrl}`);

  await context.close();
}

function logLine(logPath, obj) {
  fs.appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), ...obj }) + "\n");
}

main().catch((e) => {
  console.error("致命的エラー:", e.message);
  process.exit(1);
});
