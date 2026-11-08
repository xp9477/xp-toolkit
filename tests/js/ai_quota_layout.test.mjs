import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../scripting/ai-quota/widget.tsx", import.meta.url), "utf8");
const fillHeight = /frame=\{\{ maxWidth: "infinity", maxHeight: "infinity"/;

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing layout section: ${start}`);
  return source.slice(from, to);
}

test("home refresh button fills its host instead of shrinking to two services", () => {
  assert.match(section("function TapToRefresh(", "function homeFamily("), fillHeight);
  assert.match(section("function refreshingPlaceholder(", "// Widget lifecycle."), fillHeight);
});

test("small widget distributes available height between exactly two service rows", () => {
  const small = section('if (f === "systemSmall")', 'if (f === "systemLarge")');
  assert.match(small, fillHeight);
  assert.match(small, /spacing=\{8\}/);
  assert.equal((small.match(/<SmallServiceRow /g) || []).length, 2);
  assert.equal((small.match(/<Divider \/>/g) || []).length, 1);
  const row = section("function SmallServiceRow(", "function AccountRow(");
  assert.match(row, fillHeight);
  assert.match(row, /font=\{18\}/);
});

test("shared two-column layout cannot stretch vertically with its divider", () => {
  const columns = section("function ServiceColumns(", "function SmallServiceRow(");
  assert.match(columns, /fixedSize=\{\{ horizontal: false, vertical: true \}\}/);
  assert.equal((columns.match(/<ServiceColumn /g) || []).length, 2);
  assert.equal((columns.match(/<Divider \/>/g) || []).length, 1);
  const column = section("function ServiceColumn(", "function ServiceColumns(");
  assert.match(column, /frame=\{\{ maxWidth: "infinity", alignment: "topLeading" \}\}/);
});

test("medium centers natural-height columns while large leaves room for account details", () => {
  const medium = section("// Default: systemMedium", "function presentSnapshot(");
  assert.match(medium, fillHeight);
  assert.match(medium, /maxHeight: "infinity", alignment: "center"/);
  assert.match(medium, /<ServiceColumns data=\{data\} \/>/);
  const large = section('if (f === "systemLarge")', "// Default: systemMedium");
  assert.match(large, fillHeight);
  assert.match(large, /<ServiceColumns data=\{data\} \/>/);
  assert.match(large, /<\/VStack>\s*<Spacer \/>\s*<\/VStack>/);
});

test("lock-screen columns stay content-sized instead of inheriting home-widget height", () => {
  const accessory = section('if (f === "accessoryRectangular")', 'if (f === "systemSmall")');
  assert.match(accessory, /fixedSize=\{\{ horizontal: false, vertical: true \}\}/);
  assert.doesNotMatch(accessory, /maxHeight: "infinity"/);
});
