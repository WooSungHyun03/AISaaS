import { describe, expect, it } from "vitest";
import { htmlToText, stripHtml, toSafeParagraphHtml } from "./html";

describe("htmlToText", () => {
  it("keeps paragraphs as blank-line separated blocks", () => {
    expect(htmlToText("<p>첫 문단입니다.</p><p>둘째 &amp; 셋째</p>")).toBe("첫 문단입니다.\n\n둘째 & 셋째");
  });

  it("turns <br> into a line break and drops script/style content", () => {
    expect(htmlToText("<p>한 줄<br>두 줄</p><script>alert(1)</script><style>p{}</style>")).toBe("한 줄\n두 줄");
  });

  it("stripHtml still flattens everything to one line", () => {
    expect(stripHtml("<p>a</p><p>b</p>")).toBe("a b");
  });
});

describe("toSafeParagraphHtml", () => {
  it("rebuilds only <p> paragraphs and escapes everything else", () => {
    const html = toSafeParagraphHtml('<p onclick="x()">안녕</p><script>alert(1)</script><iframe src="https://evil.example"></iframe><p>두 번째 <a href="javascript:alert(1)">링크</a></p>');
    expect(html).toBe("<p>안녕</p>\n<p>두 번째 링크</p>");
    expect(html).not.toMatch(/script|iframe|onclick|javascript|href/i);
  });

  it("escapes angle brackets that survive as text", () => {
    expect(toSafeParagraphHtml("<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>")).toBe("<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>");
  });

  it("returns an empty string when nothing is left", () => {
    expect(toSafeParagraphHtml("<script>x</script>")).toBe("");
  });
});
