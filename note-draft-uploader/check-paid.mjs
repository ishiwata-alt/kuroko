// ============================================================================
//  有料判定チェッカー（読み取り専用 / noteには一切触れません）
//
//  Macのローカルにある元原稿(.md)とHTMLをスキャンして、
//  「どの記事に “有料” の目印があるか」を一覧＋CSVで出します。
//
//  使い方（このフォルダで）:
//    node check-paid.mjs                 … 既定の2フォルダをスキャン
//    NOTE_MD_DIR=/path node check-paid.mjs
//
//  ※「いつ有料化したか」はnote側に履歴が残らないため取得できません。
//    ここで分かるのは「元原稿に有料の目印があるか」です。
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.mjs";

// スキャン対象フォルダ（md原稿とHTML。環境変数で上書き可）
const MD_DIR =
  process.env.NOTE_MD_DIR ||
  path.join(os.homedir(), "Documents", "note記事");
const HTML_DIR = process.env.NOTE_HTML_DIR || config.inputDir;

// ---- 有料の“目印”の候補 ----------------------------------------------------
//   実際の原稿での書き方が分かったら、ここに1行足すだけで精度が上がります。
const STRONG = [
  // frontmatter / メタ情報での指定（例:  paid: true /  有料: yes /  price: 500）
  { name: "メタ:paid", re: /^\s*(paid|is_paid|有料|有料設定)\s*[:=]\s*(true|yes|on|1|有料|する)\b/im },
  { name: "メタ:price", re: /^\s*(price|価格|値段|金額|定価)\s*[:=]\s*[¥\\￥]?\s*([1-9]\d{2,})/im },
  // 本文中の有料ライン（noteの有料区切り）
  { name: "有料ライン", re: /(ここから(先は)?有料|ここから下は有料|有料エリア|有料ライン|有料部分|有料ゾーン|paywall|<!--\s*有料\s*-->)/i },
  // 見出し等での明示（——— 有料 ——— のような区切り）
  { name: "有料区切り", re: /[-—―=＝*※\s]{2,}\s*有料\s*[-—―=＝*※\s]{2,}/i },
];
// 弱い手がかり（本文に“有料”の語がある等。誤検知しやすいので「かも」判定）
const WEAK = [
  { name: "本文に「有料」", re: /有料/ },
  { name: "ファイル名", re: /(有料|paid)/i, target: "filename" },
];

// 価格らしき数字を拾う（表示用）
function findPrice(text) {
  const m =
    text.match(/[¥\\￥]\s*([1-9]\d{2,})/) ||
    text.match(/(?:price|価格|値段|金額|定価)\s*[:=]\s*[¥\\￥]?\s*([1-9]\d{2,})/i) ||
    text.match(/([1-9]\d{2,})\s*円/);
  return m ? m[1] : "";
}

function scanFile(file) {
  const name = path.basename(file);
  const text = fs.readFileSync(file, "utf8");
  const hits = [];
  let verdict = "無料"; // 無料 / 有料 / 有料かも

  for (const p of STRONG) {
    const hay = p.target === "filename" ? name : text;
    const m = hay.match(p.re);
    if (m) {
      hits.push(`${p.name}「${(m[0] || "").trim().slice(0, 40)}」`);
      verdict = "有料";
    }
  }
  if (verdict !== "有料") {
    for (const p of WEAK) {
      const hay = p.target === "filename" ? name : text;
      const m = hay.match(p.re);
      if (m) {
        hits.push(`${p.name}`);
        verdict = "有料かも";
      }
    }
  }
  return { name, verdict, price: findPrice(text), evidence: hits.join(" / ") };
}

function listFiles(dir, re) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function main() {
  const mdFiles = listFiles(MD_DIR, /\.md$/i);
  const htmlFiles = listFiles(HTML_DIR, /\.html?$/i);

  console.log("== 有料判定チェック（読み取り専用・noteには触れません）==");
  console.log(`md原稿 : ${MD_DIR}  (${mdFiles.length}件)`);
  console.log(`HTML   : ${HTML_DIR}  (${htmlFiles.length}件)`);
  console.log("");

  if (mdFiles.length === 0 && htmlFiles.length === 0) {
    console.log("対象ファイルが見つかりませんでした。フォルダの場所を確認してください。");
    console.log("  NOTE_MD_DIR=... / NOTE_HTML_DIR=... で指定できます。");
    return;
  }

  const rows = [];
  const scanGroup = (files, kind) => {
    if (files.length === 0) return;
    console.log(`--- ${kind} ---`);
    for (const f of files) {
      const r = scanFile(f);
      rows.push({ kind, ...r });
      const mark = r.verdict === "有料" ? "💰有料" : r.verdict === "有料かも" ? "❓有料かも" : "・無料";
      console.log(
        `  ${mark}  ${r.name}${r.price ? `  (¥${r.price})` : ""}` +
          (r.evidence ? `\n        根拠: ${r.evidence}` : "")
      );
    }
    console.log("");
  };
  scanGroup(mdFiles, "md原稿");
  scanGroup(htmlFiles, "HTML");

  // 集計
  const paid = rows.filter((r) => r.verdict === "有料");
  const maybe = rows.filter((r) => r.verdict === "有料かも");
  console.log(`== 集計 ==  有料:${paid.length}件 / 有料かも:${maybe.length}件 / 無料:${rows.length - paid.length - maybe.length}件（合計 ${rows.length}件）`);

  // CSV出力
  fs.mkdirSync(config.logDir, { recursive: true });
  const csvPath = path.join(config.logDir, "paid-check.csv");
  const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  const csv =
    "種別,ファイル,判定,価格,根拠\n" +
    rows.map((r) => [r.kind, r.name, r.verdict, r.price, r.evidence].map(esc).join(",")).join("\n");
  fs.writeFileSync(csvPath, "﻿" + csv); // BOM付きでExcelでも文字化けしない
  console.log(`\nCSVを書き出しました（Excelで開けます）: ${csvPath}`);
  console.log("※ 目印が拾えていなければ、有料の記事を1本だけ教えてください。判定ルールを合わせます。");
}

main();
