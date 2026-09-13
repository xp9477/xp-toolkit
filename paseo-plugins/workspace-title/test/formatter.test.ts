import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMMDD,
  isValidType,
  cleanTopic,
  isFormattedTitle,
  parseFormattedTitle,
  buildTitle,
} from "../shared/formatter";

test("formatMMDD handles Asia/Shanghai midnight rollover accurately", () => {
  // UTC 15:59:59.999Z -> 23:59:59.999 in Shanghai -> 0912
  assert.equal(formatMMDD("2026-09-12T15:59:59.999Z"), "0912");

  // UTC 16:00:00.000Z -> 00:00:00 in Shanghai -> 0913 (midnight crossover)
  assert.equal(formatMMDD("2026-09-12T16:00:00.000Z"), "0913");

  // UTC 16:00:01.000Z -> 00:00:01 in Shanghai -> 0913
  assert.equal(formatMMDD("2026-09-12T16:00:01.000Z"), "0913");

  // Year-end rollover: UTC 2026-12-31 15:59:59 -> 1231
  assert.equal(formatMMDD("2026-12-31T15:59:59.999Z"), "1231");

  // Year-end rollover: UTC 2026-12-31 16:00:00 -> 0101 next year
  assert.equal(formatMMDD("2026-12-31T16:00:00.000Z"), "0101");

  // Leap year: UTC 2028-02-28 16:00:00 -> 0229
  assert.equal(formatMMDD("2028-02-28T16:00:00.000Z"), "0229");
});

test("formatMMDD returns null for missing or invalid dates", () => {
  assert.equal(formatMMDD(null), null);
  assert.equal(formatMMDD(undefined), null);
  assert.equal(formatMMDD(""), null);
  assert.equal(formatMMDD("not-a-date"), null);
});

test("isValidType strictly allows only the 8 permitted types", () => {
  const allowed = ["功能", "设计", "修复", "优化", "发布", "探索", "文档", "研究"];
  for (const t of allowed) {
    assert.equal(isValidType(t), true);
  }
  const disallowed = ["feature", "bug", "开发", "测试", "重构", "其他", "", "功能1"];
  for (const t of disallowed) {
    assert.equal(isValidType(t), false);
  }
});

test("cleanTopic strips markdown, extra whitespaces and redundant project names", () => {
  assert.equal(
    cleanTopic("xp-toolkit: 实现工作区自动命名插件", "xp-toolkit"),
    "实现工作区自动命名插件"
  );
  assert.equal(
    cleanTopic("【xp-toolkit】 优化卡片排版", "xp9477/xp-toolkit"),
    "优化卡片排版"
  );
  assert.equal(
    cleanTopic("在 talk 中排查摘要失败原因", "talk"),
    "排查摘要失败原因"
  );
  assert.equal(
    cleanTopic("`**代码格式化**` 与   规范检查"),
    "代码格式化 与 规范检查"
  );
});

test("isFormattedTitle correctly detects standard compliant titles", () => {
  assert.equal(isFormattedTitle("0913 | 功能 | 实现工作区自动命名插件"), true);
  assert.equal(isFormattedTitle("0912 | 修复 | AI-Quota多账号平均"), true);
  assert.equal(isFormattedTitle("0909 | 优化 | 资产卡片排版与视觉配色调优"), true);

  // Missing spaces around pipe
  assert.equal(isFormattedTitle("0913|功能|实现工作区自动命名插件"), false);
  // Invalid type
  assert.equal(isFormattedTitle("0913 | 开发 | 实现工作区自动命名插件"), false);
  // Invalid date format
  assert.equal(isFormattedTitle("20260913 | 功能 | 插件"), false);
  assert.equal(isFormattedTitle("913 | 功能 | 插件"), false);
  // Non-formatted titles
  assert.equal(isFormattedTitle("talk"), false);
  assert.equal(isFormattedTitle("main"), false);
  assert.equal(isFormattedTitle(null), false);
});

test("parseFormattedTitle parses valid formatted titles", () => {
  const parsed = parseFormattedTitle("0913 | 功能 | 工作区自动命名插件");
  assert.deepEqual(parsed, {
    mmdd: "0913",
    type: "功能",
    topic: "工作区自动命名插件",
  });
  assert.equal(parseFormattedTitle("random title"), null);
});

test("buildTitle generates correct string or null on invalid inputs", () => {
  assert.equal(
    buildTitle(
      "2026-09-13T07:10:43.065Z",
      "功能",
      "实现工作区自动命名插件",
      "xp-toolkit"
    ),
    "0913 | 功能 | 实现工作区自动命名插件"
  );

  // Missing date -> null
  assert.equal(buildTitle(null, "功能", "插件"), null);

  // Invalid type -> null
  assert.equal(buildTitle("2026-09-13T07:10:43.065Z", "非法类型", "插件"), null);

  // Empty topic -> null
  assert.equal(buildTitle("2026-09-13T07:10:43.065Z", "功能", "   "), null);
});
