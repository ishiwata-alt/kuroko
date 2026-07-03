// ============================================================================
//  HTMLから「タイトル」と「本文HTML」を取り出す
// ============================================================================
import { load } from "cheerio";
import { config } from "../config.mjs";

/**
 * @param {string} html   HTMLファイルの中身
 * @param {string} fallbackTitle  何も取れなかったときに使う名前（ファイル名など）
 * @returns {{ title: string, bodyHtml: string, titleSource: string }}
 */
export function extractFromHtml(html, fallbackTitle) {
  const $ = load(html, { decodeEntities: false });

  // ---- タイトル ----------------------------------------------------------
  let title = "";
  let titleSource = "";

  // (1) 設定で明示されたセレクタが最優先
  if (config.titleSelector) {
    title = clean($(config.titleSelector).first().text());
    if (title) titleSource = `titleSelector(${config.titleSelector})`;
  }

  // (2) 「案内ボックスっぽい」要素を自動で探す
  if (!title) {
    const box = findNoticeBox($);
    if (box && box.length) {
      // ボックス内の見出し/強調を優先。なければボックス内の最初の1行。
      const inner = clean(
        box.find("h1,h2,h3,strong,b").first().text()
      ) || firstLine(clean(box.text()));
      if (inner) {
        title = inner;
        titleSource = "案内ボックス(自動検出)";
      }
    }
  }

  // (3) 最初の見出し → <title> → ファイル名 の順でフォールバック
  if (!title) {
    title = clean($("h1").first().text());
    if (title) titleSource = "最初のh1";
  }
  if (!title) {
    title = clean($("h2").first().text());
    if (title) titleSource = "最初のh2";
  }
  if (!title) {
    title = clean($("title").first().text());
    if (title) titleSource = "<title>タグ";
  }
  if (!title) {
    title = fallbackTitle;
    titleSource = "ファイル名(フォールバック)";
  }

  if (title.length > config.titleMaxLength) {
    title = title.slice(0, config.titleMaxLength);
  }

  // ---- 本文 --------------------------------------------------------------
  // 不要タグを丸ごと除去
  for (const tag of config.stripTags) $(tag).remove();

  let $content = config.contentSelector
    ? $(config.contentSelector).first()
    : $("body");
  if (!$content || $content.length === 0) $content = $("body");
  if (!$content || $content.length === 0) $content = $.root();

  const bodyHtml = ($content.html() || "").trim();

  return { title, bodyHtml, titleSource };
}

// 「案内ボックス」らしき要素を、class/id のヒント語から探す
function findNoticeBox($) {
  const hints = config.titleBoxHints.map((h) => h.toLowerCase());
  let found = null;
  $("div,section,aside,header,p").each((_, el) => {
    if (found) return;
    const cls = ($(el).attr("class") || "").toLowerCase();
    const id = ($(el).attr("id") || "").toLowerCase();
    const hay = cls + " " + id;
    if (hints.some((h) => hay.includes(h))) {
      const text = clean($(el).text());
      if (text) found = $(el);
    }
  });
  return found;
}

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function firstLine(s) {
  return clean((s || "").split(/[。\n]/)[0]);
}
