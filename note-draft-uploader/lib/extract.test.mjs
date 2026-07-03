// 抽出ロジックの簡易テスト:  node lib/extract.test.mjs
import { extractFromHtml } from "./extract.mjs";

const sample = `<!DOCTYPE html>
<html lang="ja"><head><title>ページタイトルは無視されるはず</title>
<style>.x{color:red}</style></head>
<body>
  <div class="notice-box"><strong>桜まつり2025 スタッフ募集のご案内</strong>
    <p>この記事は…</p></div>
  <h1>本文の見出し</h1>
  <p>これは<b>太字</b>と<em>斜体</em>の段落です。</p>
  <ul><li>項目1</li><li>項目2</li></ul>
  <pre><code>console.log("hi")</code></pre>
  <script>alert('should be removed')</script>
</body></html>`;

const { title, bodyHtml, titleSource } = extractFromHtml(sample, "fallback-name");
console.log("title       :", title);
console.log("titleSource :", titleSource);
console.log("has <script>:", /<script/i.test(bodyHtml));
console.log("has <ul>    :", /<ul>/i.test(bodyHtml));
console.log("has <b>     :", /<b>/i.test(bodyHtml));
console.log("---- body head ----");
console.log(bodyHtml.slice(0, 200));

// 期待:
//  title == "桜まつり2025 スタッフ募集のご案内"（案内ボックスのstrongから）
//  has <script> == false / <ul>,<b> == true
const pass =
  title === "桜まつり2025 スタッフ募集のご案内" &&
  /<ul>/i.test(bodyHtml) &&
  /<b>/i.test(bodyHtml) &&
  !/<script/i.test(bodyHtml);
console.log("\nRESULT:", pass ? "PASS ✅" : "FAIL ❌");
process.exit(pass ? 0 : 1);
