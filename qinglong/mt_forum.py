"""
name: MT论坛签到
cron: 0 8 * * *
description: MT论坛每日账号密码登录签到 (bbs.binmt.cc)

env:
- `mt_forum`: 每行一个 JSON 对象，字段包括 `username` 和 `password`
"""

from __future__ import annotations

import re
import sys
import time
from urllib.parse import unquote, urlparse

import notify
import requests
from common import require_fields, run_account_scripts


def _is_acw_challenge(text: str) -> bool:
    return "var arg1='" in text and "acw_sc__v2" in text


def _js_parse_int(value: str) -> int | None:
    match = re.match(r"\s*([+-]?\d+)", value)
    if not match:
        return None
    return int(match.group(1))


def _obfuscator_b64(data: str) -> str:
    """解码 javascript-obfuscator 的自定义 Base64 字符串表。"""
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="
    chars: list[str] = []
    accumulator = 0
    count = 0
    for char in data:
        index = alphabet.find(char)
        if index < 0:
            continue
        if count % 4:
            accumulator = accumulator * 64 + index
        else:
            accumulator = index
        count += 1
        if (count - 1) % 4:
            chars.append(chr(0xFF & (accumulator >> ((-2 * count) & 6))))
    escaped = "".join(f"%{ord(char):02x}" for char in chars)
    return unquote(escaped)


def _js_single_quoted(blob: str) -> list[str]:
    values: list[str] = []
    cursor = 0
    while cursor < len(blob):
        if blob[cursor] != "'":
            cursor += 1
            continue
        cursor += 1
        chars: list[str] = []
        while cursor < len(blob):
            char = blob[cursor]
            if char == "\\":
                if cursor + 1 >= len(blob):
                    break
                escaped = blob[cursor + 1]
                chars.append(
                    {"'": "'", "\\": "\\", "n": "\n", "r": "\r", "t": "\t"}.get(
                        escaped, escaped
                    )
                )
                cursor += 2
                continue
            if char == "'":
                cursor += 1
                break
            chars.append(char)
            cursor += 1
        values.append("".join(chars))
    return values


def _acw_string_table(text: str) -> tuple[list[str], int, int]:
    table_match = re.search(
        r"function (\w+)\(\)\{var \w+=\[(.*?)\];\1=function",
        text,
        re.DOTALL,
    )
    offset_match = re.search(r"d=d-(0x[0-9a-fA-F]+)", text)
    target_match = re.search(
        r"\(\w+\s*,\s*(0x[0-9a-fA-F]+)\)\s*,\s*!\(function",
        text,
    )
    if not table_match or not offset_match or not target_match:
        raise ValueError("校验脚本结构无法识别")
    strings = _js_single_quoted(table_match.group(2))
    if not strings:
        raise ValueError("校验字符串表为空")
    return strings, int(offset_match.group(1), 16), int(target_match.group(1), 16)


def _acw_mask(text: str) -> str:
    strings, offset, target = _acw_string_table(text)
    indexes = (
        0x117,
        0x111,
        0xFB,
        0x10E,
        0x101,
        0xFD,
        0x102,
        0x122,
        0x112,
        0x11D,
        0x11C,
        0x114,
    )

    def decode_at(table: list[str], index: int) -> str:
        position = index - offset
        if position < 0 or position >= len(table):
            raise ValueError("校验字符串下标越界")
        return _obfuscator_b64(table[position])

    for _ in range(len(strings)):
        try:
            values = {
                index: _js_parse_int(decode_at(strings, index)) for index in indexes
            }
        except ValueError:
            values = {}
        if values and all(value is not None for value in values.values()):
            checksum = (
                -values[0x117] / 1 * (values[0x111] / 2)
                + -values[0xFB] / 3 * (values[0x10E] / 4)
                + -values[0x101] / 5 * (-values[0xFD] / 6)
                + -values[0x102] / 7 * (values[0x122] / 8)
                + values[0x112] / 9
                + values[0x11D] / 10 * (values[0x11C] / 11)
                + values[0x114] / 12
            )
            if checksum == target:
                mask = decode_at(strings, 0x115)
                if re.fullmatch(r"[0-9a-fA-F]+", mask) and len(mask) % 2 == 0:
                    return mask
        strings.append(strings.pop(0))
    raise ValueError("校验和未命中")


def acw_sc_v2_cookie(text: str) -> str:
    """根据阿里云 ESA 的 acw_sc__v2 挑战页计算 cookie，不执行页面脚本。"""
    arg1_match = re.search(r"var arg1='([0-9A-Fa-f]+)'", text)
    order_match = re.search(
        r"\[((?:0x[0-9a-fA-F]+,){39}0x[0-9a-fA-F]+)\]",
        text,
    )
    if not arg1_match or not order_match:
        raise ValueError("缺少 arg1 或置换表")
    arg1 = arg1_match.group(1)
    order = [int(item, 16) for item in order_match.group(1).split(",")]
    if len(order) != len(arg1):
        raise ValueError("置换表长度与 arg1 不一致")
    mask = _acw_mask(text)
    if len(mask) < len(arg1):
        raise ValueError("校验掩码长度不足")

    unsboxed = [""] * len(order)
    for index, char in enumerate(arg1):
        for slot, position in enumerate(order):
            if position == index + 1:
                unsboxed[slot] = char
    scrambled = "".join(unsboxed)
    if len(scrambled) != len(arg1):
        raise ValueError("置换后长度不正确")
    return "".join(
        f"{int(scrambled[index : index + 2], 16) ^ int(mask[index : index + 2], 16):02x}"
        for index in range(0, len(arg1), 2)
    )


class Script:
    """MT论坛自动签到脚本（账号密码模式）。"""

    def __init__(self, account: dict):
        self.account = account
        self.username = account.get("username", "")
        self.password = account.get("password", "")
        require_fields(account, "username", "password")
        self.session = requests.Session()
        self.base_url = "https://bbs.binmt.cc"
        default_delay = 0.0 if "unittest" in sys.modules else 2.0
        self.retry_delay = float(account.get("retry_delay", default_delay))
        self.max_retries = int(account.get("max_retries", 3))

    @staticmethod
    def _signed_page(text: str) -> bool:
        return any(
            marker in text
            for marker in (
                "您的签到排名",
                "今日已签",
                "已累计签到",
                "已经签到",
                "今日已经签到",
                "btnvisted",
            )
        )

    @staticmethod
    def _formhash(text: str) -> str | None:
        patterns = (
            r"formhash=([a-zA-Z0-9]+)",
            r"""name=["']formhash["'][^>]*value=["']([^"']+)["']""",
            r"""value=["']([^"']+)["'][^>]*name=["']formhash["']""",
        )
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)
        return None

    @staticmethod
    def _fail(message: str):
        print(message)
        raise RuntimeError(message)

    def _raw_get(self, url: str, **kwargs):
        response = self.session.get(url, **kwargs)
        response.raise_for_status()
        response.encoding = "utf-8"
        return response

    def _get_through_waf(self, url: str, **kwargs):
        response = self._raw_get(url, **kwargs)
        if not _is_acw_challenge(response.text):
            return response
        try:
            token = acw_sc_v2_cookie(response.text)
        except ValueError as exc:
            raise ValueError(f"无法解析阿里云 ESA 校验: {exc}") from exc
        host = urlparse(url).hostname or urlparse(self.base_url).hostname
        self.session.cookies.set("acw_sc__v2", token, domain=host, path="/")
        print("已计算阿里云 ESA 校验")
        response = self._raw_get(url, **kwargs)
        if _is_acw_challenge(response.text):
            raise ValueError("阿里云 ESA 校验未通过")
        return response

    def run(self) -> bool:
        print(f"开始执行MT论坛签到 - 用户: {self.username}")

        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": f"{self.base_url}/forum.php",
            }
        )

        # 1. 访问登录页面获取 pre-login formhash
        try:
            r1 = self._get_through_waf(
                f"{self.base_url}/member.php?mod=logging&action=login", timeout=15
            )
        except Exception as e:
            self._fail(f"访问登录页面失败: {e}")

        formhash = self._formhash(r1.text)
        if not formhash:
            self._fail("登录页面未找到 formhash")
        loginhash_match = re.search(r"loginhash=([A-Za-z0-9]+)", r1.text)
        login_url = f"{self.base_url}/member.php?mod=logging&action=login&loginsubmit=yes&inajax=1"
        if loginhash_match:
            login_url += f"&loginhash={loginhash_match.group(1)}"

        # 2. 提交登录表单
        payload = {
            "formhash": formhash,
            "referer": f"{self.base_url}/forum.php",
            "loginfield": "username",
            "username": self.username,
            "password": self.password,
            "questionid": "0",
            "answer": "",
            "cookietime": "2592000",
        }

        try:
            r2 = self.session.post(
                login_url,
                data=payload,
                timeout=15,
            )
            r2.raise_for_status()
            r2.encoding = "utf-8"
        except Exception as e:
            self._fail(f"提交登录失败: {e}")

        # Discuz 各版本登录成功文案不一致，只在出现明确失败文案时中止。
        login_failures = (
            "密码错误",
            "密码不正确",
            "用户不存在",
            "用户名不存在",
            "登录失败",
        )
        if any(marker in r2.text for marker in login_failures):
            cdata_match = re.search(r"<!\[CDATA\[(.*?)\]\]>", r2.text, re.DOTALL)
            msg_raw = cdata_match.group(1) if cdata_match else "未知原因"
            msg_no_html = re.sub(
                r"<script.*?>.*?</script>", "", msg_raw, flags=re.DOTALL
            )
            msg_no_html = re.sub(r"<.*?>", "", msg_no_html)
            login_lines = [
                line.strip()
                for line in msg_no_html.splitlines()
                if line.strip() and not line.strip().isdigit()
            ]
            msg = " | ".join(login_lines) if login_lines else "未知原因"
            self._fail(f"登录失败: {msg}")

        print("登录请求已提交")

        # 3. 访问签到页获取当前 Session 的新 formhash，并判断是否已签到
        try:
            r3 = self._get_through_waf(
                f"{self.base_url}/plugin.php?id=k_misign:sign", timeout=15
            )
        except Exception as e:
            self._fail(f"访问签到页面失败: {e}")

        if self._signed_page(r3.text):
            print("登录成功")
            print("今天已经签到过了")
            return True

        sign_formhash = self._formhash(r3.text)
        if not sign_formhash:
            self._fail("签到页面未找到 formhash")
        print("登录成功")

        # 4. 执行签到 AJAX 请求（带重试与频控防护）
        params = {
            "id": "k_misign:sign",
            "operation": "qiandao",
            "format": "button",
            "formhash": sign_formhash,
            "inajax": "1",
            "ajaxtarget": "midaben_sign",
        }
        sign_headers = {
            "Referer": f"{self.base_url}/plugin.php?id=k_misign:sign",
            "X-Requested-With": "XMLHttpRequest",
        }

        # 模拟真人正常浏览停顿，避免两步请求过于紧凑触发论坛防刷机制
        if self.retry_delay > 0:
            time.sleep(self.retry_delay)

        last_sign_msg = "未知结果"
        retry_markers = ("请稍后再试", "系统繁忙", "过于频繁", "请稍后")

        for attempt in range(self.max_retries):
            if attempt > 0:
                print(
                    f"签到触发临时限制（{last_sign_msg}），等待重试 ({attempt + 1}/{self.max_retries})..."
                )
                if self.retry_delay > 0:
                    time.sleep(self.retry_delay)

            try:
                r4 = self._get_through_waf(
                    f"{self.base_url}/plugin.php",
                    params=params,
                    headers=sign_headers,
                    timeout=15,
                )
            except Exception as e:
                if attempt == self.max_retries - 1:
                    self._fail(f"发送签到请求失败: {e}")
                print(f"发送签到请求异常: {e}，准备重试...")
                continue

            # 提取并美化签到提示信息
            sign_cdata = re.search(r"<!\[CDATA\[(.*?)\]\]>", r4.text, re.DOTALL)
            sign_msg_raw = sign_cdata.group(1) if sign_cdata else ""
            sign_msg_no_html = re.sub(
                r"<script.*?>.*?</script>", "", sign_msg_raw, flags=re.DOTALL
            )
            sign_msg_no_html = re.sub(r"<.*?>", "", sign_msg_no_html)

            lines = []
            for line in sign_msg_no_html.splitlines():
                line_str = line.strip()
                # 过滤空行、纯数字、以及形如 "2195人" 的签到排名信息
                if not line_str or line_str.isdigit() or re.match(r"^\d+人$", line_str):
                    continue
                line_str = re.sub(r"和\s*。", "。", line_str)
                lines.append(line_str)

            sign_msg = " | ".join(lines) if lines else "未知结果"
            last_sign_msg = sign_msg

            success_markers = ("签到成功", "今日已签", "已经签到", "已签到")
            if any(marker in r4.text for marker in success_markers):
                print(f"签到成功！提示: {sign_msg}")
                return True

            # Discuz 插件版本的 AJAX 成功文案并不统一；用登录后的签到页状态做最终确认。
            try:
                verify = self._get_through_waf(
                    f"{self.base_url}/plugin.php?id=k_misign:sign", timeout=15
                )
            except Exception as e:
                if attempt == self.max_retries - 1:
                    self._fail(f"签到结果不明确且复核失败: {e}")
                print(f"签到复核异常: {e}，准备重试...")
                continue

            if self._signed_page(verify.text):
                print(f"签到成功（页面复核）；提示: {sign_msg}")
                return True

            # 若遇到明确的临时繁忙/请稍后再试标记，且还有重试次数，则继续下一次尝试
            if not any(marker in r4.text for marker in retry_markers):
                break

        self._fail(f"签到失败: {last_sign_msg}")


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
