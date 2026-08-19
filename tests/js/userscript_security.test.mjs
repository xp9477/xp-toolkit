import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function userscript(name) {
  return readFileSync(new URL(`../../userscripts/${name}`, import.meta.url), "utf8");
}

const captcha = userscript("xptoolkit - 验证码识别填写.js");
const fourKhd = userscript("xptoolkit - 4KHD 自动合并分页图片去懒加载.js");
const synapse = userscript("xptoolkit - Synapse usage log performance.js");
const ashare = userscript("xptoolkit - A股擂台最近成交置顶.js");

function captchaSecurityApi() {
  const start = captcha.indexOf("  function completionUrl(");
  const end = captcha.indexOf("  function cleanModelAnswer(", start);
  assert.ok(start >= 0 && end > start, "captcha URL helper block not found");
  const context = vm.createContext({ URL });
  vm.runInContext(
    `${captcha.slice(start, end)}\n` +
      "globalThis.testApi = { completionUrl, validateBackendUrl, selectCredentialPair };",
    context
  );
  return context.testApi;
}

test("captcha backend accepts explicit HTTP and HTTPS endpoints", () => {
  const api = captchaSecurityApi();
  assert.equal(
    api.completionUrl("https://vision.example/v1/"),
    "https://vision.example/v1/chat/completions"
  );
  assert.equal(
    api.completionUrl("http://127.0.0.1:8080/v1"),
    "http://127.0.0.1:8080/v1/chat/completions"
  );
  assert.equal(
    api.completionUrl("http://192.168.1.20:8080/v1"),
    "http://192.168.1.20:8080/v1/chat/completions"
  );
  assert.throws(() => api.completionUrl("https://user@vision.example/v1"), /不能包含/);
  assert.throws(() => api.completionUrl("https://vision.example/v1?target=evil"), /不能包含/);
});

test("captcha endpoint and API key move as an atomic credential pair", () => {
  const api = captchaSecurityApi();
  const current = { baseUrl: "https://trusted.example/v1", apiKey: "local-secret" };

  assert.deepEqual(
    { ...api.selectCredentialPair(current, { baseUrl: "https://evil.example/v1" }, true) },
    current
  );
  assert.deepEqual(
    { ...api.selectCredentialPair(
      current,
      { baseUrl: "https://remote.example/v1", apiKey: "remote-secret" },
      false
    ) },
    current
  );
  assert.deepEqual(
    { ...api.selectCredentialPair(
      current,
      { baseUrl: "https://remote.example/v1/", apiKey: " remote-secret " },
      true
    ) },
    { baseUrl: "https://remote.example/v1", apiKey: "remote-secret" }
  );
});

test("captcha settings never prefill stored secrets into page DOM", () => {
  assert.doesNotMatch(captcha, /values:\s*state\.sync\s*[,}]/);
  assert.doesNotMatch(captcha, /values:\s*current\s*[,}]/);
  assert.match(captcha, /values:\s*\{\s*\.\.\.state\.sync,\s*password:\s*''\s*}/);
  assert.match(captcha, /values:\s*\{\s*\.\.\.current,\s*apiKey:\s*''\s*}/);
  assert.match(captcha, /backend:\s*\{\s*\.\.\.state\.config\.backend,\s*apiKey:\s*''\s*}/);
});

test("4KHD sessions never fall back to page-readable localStorage", () => {
  assert.doesNotMatch(fourKhd, /localStorage\.(?:getItem|setItem|removeItem)\s*\(/);
});

test("Synapse keeps JSON parsing scoped and sanitizes cloned markup", () => {
  assert.doesNotMatch(synapse, /JSON\.parse\s*=/);
  assert.doesNotMatch(synapse, /wrapper\.innerHTML\s*=/);
  assert.match(synapse, /const allowedTags = new Set/);
  assert.match(synapse, /const allowedAttributes = new Set/);
});

test("A-share dashboard does not copy source markup into privileged panels", () => {
  assert.doesNotMatch(ashare, /viewBox\.innerHTML\s*=\s*view\.innerHTML/);
  assert.doesNotMatch(ashare, /dest\.innerHTML\s*=\s*src\.innerHTML/);
  assert.match(ashare, /cell\.textContent = sourceCell\.textContent/);
});
