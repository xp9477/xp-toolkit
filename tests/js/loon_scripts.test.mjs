import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const tftSource = readFileSync(
  new URL("../../proxy/loon/script/tftplay-vip.js", import.meta.url),
  "utf8"
);

function runTftScript(url) {
  let result;
  const context = vm.createContext({
    $request: { url },
    $response: {
      body: JSON.stringify({
        data: {
          userResult: { user: { vip: false } },
          payStatus: false,
          adTypeShow: "banner",
          adShowTime: "5",
        },
      }),
    },
    $done(value) {
      result = value;
    },
  });
  vm.runInContext(tftSource, context);
  return JSON.parse(result.body);
}

for (const url of [
  "https://jcc.tftplay.com/config/info",
  "https://jcc.tftplay.com/config/info/",
  "https://jcc.tftplay.com/config/info?platform=ios",
]) {
  test(`TFT modifier handles ${url}`, () => {
    const response = runTftScript(url);
    assert.equal(response.data.userResult.user.vip, true);
    assert.equal(response.data.payStatus, true);
    assert.equal(response.data.adTypeShow, "");
    assert.equal(response.data.adShowTime, "0");
  });
}

test("TFT modifier ignores unrelated endpoints", () => {
  const response = runTftScript("https://jcc.tftplay.com/config/information");
  assert.equal(response.data.userResult.user.vip, false);
  assert.equal(response.data.payStatus, false);
});
