"""
name: qBittorrent 删除非 CHDBits HR 种子
cron: 0 * * * *
description: 检查已整理标签中不包含 CHDBits tracker 或无 HR 的种子，自动清理种子及下载文件

env:
- `qb_delete_nonHR`: JSON 对象或 JSON 数组，必填 `url`, `api_key`
- 默认直接执行真实删除（含本地下载文件）；如需演练预览可显式设置 `dry_run=true`
- 如需保留下载文件仅从 qB 移除种子任务，可设置 `delete_files=false`
- 默认 `verify_tls=true`；qBittorrent 使用自签名证书时可显式关闭
- RFC1918/loopback/`.local` 等内网地址自动兼容 HTTP；公网 HTTP 需设置 `allow_insecure_http=true`
- 可选: `dry_run`, `delete_files`, `verify_tls`, `allow_insecure_http`, `strict_inspection`,
  `chdbits_tracker_hosts`, `cookiecloud_url`, `cookiecloud_uuid`,
  `cookiecloud_password`, `chdbits_userid`
"""

import base64
import hashlib
import html
import ipaddress
import json
import os
import re
from datetime import datetime
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
import notify
from common import (
    parse_bool,
    require_fields,
    run_account_scripts,
    validate_service_origin,
)

DEFAULT_CHDBITS_TRACKER_HOSTS = frozenset({"ptchdbits.co", "tracker.ptchdbits.co"})
VALID_TRACKER_SCHEMES = frozenset({"http", "https", "udp"})
VALID_TORRENT_HASH = re.compile(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\Z")
FILE_DELETE_APPROVAL_TAG = "允许删除文件"


def normalize_hostname(value):
    """将主机名规范化为可做精确比较的 ASCII 形式。"""
    if not isinstance(value, str):
        raise ValueError("tracker 主机名必须是字符串")
    hostname = value.strip().rstrip(".").lower()
    if not hostname or any(char in hostname for char in "/:@"):
        raise ValueError(f"无效的 tracker 主机名: {value!r}")
    try:
        hostname = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError(f"无效的 tracker 主机名: {value!r}") from exc
    if ".." in hostname or not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", hostname
    ):
        raise ValueError(f"无效的 tracker 主机名: {value!r}")
    return hostname


def parse_tracker_hosts(value):
    """读取精确 tracker allowlist，兼容逗号分隔字符串和字符串数组。"""
    if value is None:
        return DEFAULT_CHDBITS_TRACKER_HOSTS
    if isinstance(value, str):
        values = value.split(",")
    elif isinstance(value, (list, tuple, set, frozenset)):
        values = value
    else:
        raise ValueError("chdbits_tracker_hosts 必须是字符串或字符串数组")

    hosts = frozenset(normalize_hostname(item) for item in values if str(item).strip())
    if not hosts:
        raise ValueError("chdbits_tracker_hosts 不能为空")
    return hosts


def tracker_hostname(url):
    """仅从受支持的 tracker URL 中提取主机名。"""
    if not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url.strip())
        if parsed.scheme.lower() not in VALID_TRACKER_SCHEMES or not parsed.hostname:
            return None
        return normalize_hostname(parsed.hostname)
    except (ValueError, UnicodeError):
        return None


def is_private_http_origin(value) -> bool:
    """内网/本机 qBittorrent 常无 TLS，只对明确的本地地址自动兼容 HTTP。"""
    try:
        parsed = urlsplit(str(value or "").strip())
        if parsed.scheme != "http" or not parsed.hostname:
            return False
        hostname = parsed.hostname.rstrip(".").lower()
        if hostname == "localhost" or hostname.endswith(
            (".local", ".lan", ".home", ".internal", ".home.arpa")
        ):
            return True
        address = ipaddress.ip_address(hostname)
        return address.is_private or address.is_loopback or address.is_link_local
    except (ValueError, TypeError):
        return False


def tracker_hostnames(trackers):
    """返回可验证的 tracker 主机名集合。"""
    return {
        hostname
        for tracker in trackers
        if (hostname := tracker_hostname(tracker.get("url"))) is not None
    }


def normalize_torrent_name(value):
    if not isinstance(value, str):
        return ""
    val = html.unescape(value)
    return re.sub(r"[\W_]+", "", val).lower()


def strip_cjk_characters(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"[一-鿿぀-ヿ가-힯]+", "", value)


def parse_chdbits_torrents(page_html):
    """解析 CHDBits 做种页；结构不匹配时返回 None，而不是空列表。"""
    if not isinstance(page_html, str) or not page_html.strip():
        return None

    torrents = []
    for chunk in re.split(r"(?i)<tr", page_html):
        if "details.php?id=" not in chunk:
            continue
        # 匹配详情链接的 title，避免读到分类图片的 title。
        title_match = re.search(
            r'href="details\.php[^>]+title="([^"]+)"',
            chunk,
            re.IGNORECASE,
        )
        if not title_match:
            title_match = re.search(
                r'href="details\.php[^>]+>(?:<b>)?([^<]+)(?:</b>)?</a>',
                chunk,
                re.IGNORECASE,
            )
        if not title_match:
            continue

        html_title = title_match.group(1)
        html_title_clean = normalize_torrent_name(html_title)
        if not html_title_clean:
            continue
        has_hr = (
            'class="circle-text">HR<' in chunk
            or 'class="circle">HR<' in chunk
            or ">HR</div>" in chunk
            or 'title="Hit and Run"' in chunk
            or 'title="Hit & Run"' in chunk
            or 'title="Hit&Run"' in chunk
            or 'alt="Hit and Run"' in chunk
            or 'class="hitandrun"' in chunk
        )
        torrents.append((html_title_clean, has_hr, html_title))

    if torrents:
        return torrents

    if any(
        kw in page_html
        for kw in (
            "没有记录",
            "没有做种",
            "当前没有",
            "没有任何",
            "No torrents",
            "no torrents",
            "Nothing found",
        )
    ):
        return []

    return None


def find_unique_torrent_match(name, candidates):
    """
    返回唯一的 CHDBits 名称匹配。

    1. 优先接受去标点、大小写归一化后的唯一精确匹配。
    2. 兼容剥离站点前缀（如 chdbits / ptchdbits）后的精确匹配。
    3. 兼容中英文混合命名（如 qB 带中文片名前缀，站点为纯英文 release 名，或反之）在剔除 CJK 字符后的唯一精确匹配。
    """
    normalized_name = normalize_torrent_name(name)
    if len(normalized_name) <= 5:
        return None, "invalid"

    # 1. 直接精确匹配
    exact_matches = [item for item in candidates if item[0] == normalized_name]
    if len(exact_matches) == 1:
        return exact_matches[0], "matched"
    if len(exact_matches) > 1:
        return None, "ambiguous"

    # 2. 剥离站点前缀匹配
    stripped_name = re.sub(r"^(?:chdbits|ptchdbits)", "", normalized_name)
    if stripped_name != normalized_name and len(stripped_name) > 5:
        stripped_matches = [item for item in candidates if item[0] == stripped_name]
        if len(stripped_matches) == 1:
            return stripped_matches[0], "matched"
        if len(stripped_matches) > 1:
            return None, "ambiguous"

    # 3. 剔除 CJK 字符后的唯一英文章节精确匹配（如 特立独行.Keep.Real... 与 Keep.Real...）
    ascii_name = strip_cjk_characters(normalized_name)
    if len(ascii_name) >= 10:
        ascii_matches = [
            item for item in candidates if strip_cjk_characters(item[0]) == ascii_name
        ]
        if len(ascii_matches) == 1:
            return ascii_matches[0], "matched"
        if len(ascii_matches) > 1:
            return None, "ambiguous"

    return None, "not_found"


def validate_cookiecloud_base_url(value, *, allow_http=False):
    """校验 CookieCloud 根地址；允许官方 API_ROOT 子路径。"""
    raw = str(value or "").strip().rstrip("/")
    if not raw or any(character.isspace() for character in raw):
        raise ValueError("CookieCloud URL 无效")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ValueError("CookieCloud URL 必须是有效的 HTTP(S) 地址")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("CookieCloud URL 不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise ValueError("CookieCloud URL 不能包含查询参数或片段")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("CookieCloud URL 端口无效") from exc
    if parsed.scheme != "https" and not (allow_http or is_private_http_origin(raw)):
        raise ValueError("CookieCloud URL 必须使用 HTTPS")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def _decrypt_cookiecloud_payload(encrypted_data_b64, uuid, password):
    """使用唯一声明的 cryptography 实现解密 CookieCloud 数据。"""
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    key = hashlib.md5(f"{uuid}-{password}".encode()).hexdigest()[:16].encode()
    encrypted_data = base64.b64decode(encrypted_data_b64, validate=True)

    def decrypt_aes_cbc(aes_key, iv, data):
        cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv))
        decryptor = cipher.decryptor()
        padded_data = decryptor.update(data) + decryptor.finalize()
        unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
        return unpadder.update(padded_data) + unpadder.finalize()

    if encrypted_data.startswith(b"Salted__"):
        salt = encrypted_data[8:16]
        ciphertext = encrypted_data[16:]
        key_iv = b""
        previous = b""
        while len(key_iv) < 48:
            previous = hashlib.md5(previous + key + salt).digest()
            key_iv += previous
        decrypted_data = decrypt_aes_cbc(key_iv[:32], key_iv[32:48], ciphertext)
    else:
        decrypted_data = decrypt_aes_cbc(key, b"\x00" * 16, encrypted_data)

    decoded = json.loads(decrypted_data.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise ValueError("CookieCloud 解密结果必须是对象")
    return decoded


def get_cookiecloud_cookies(
    url,
    uuid,
    password,
    target_domain="ptchdbits.co",
    *,
    allow_insecure_http=False,
):
    try:
        base_url = validate_cookiecloud_base_url(
            url,
            allow_http=allow_insecure_http,
        )
        if not isinstance(uuid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,128}", uuid):
            raise ValueError("CookieCloud UUID 格式无效")
        req_url = f"{base_url}/get/{quote(uuid, safe='')}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        # 官方服务端在无 password 请求体时返回密文；密码只在本地参与解密，绝不进入 URL。
        response = httpx.get(
            req_url, headers=headers, timeout=30, follow_redirects=False
        )
        if response.status_code != 200:
            print(f"❌ 请求 CookieCloud 失败，状态码: {response.status_code}")
            return None

        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("CookieCloud 响应必须是对象")

        if "encrypted" in data:
            cookie_list = _decrypt_cookiecloud_payload(
                data["encrypted"],
                uuid,
                password,
            ).get("cookie_data", [])
        elif "cookie_data" in data:
            cookie_list = data["cookie_data"]
        else:
            print("❌ CookieCloud 响应缺少 cookie_data 字段")
            return None

        cookies_dict = {}
        target = normalize_hostname(target_domain)

        def add_cookie(cookie, domain):
            if not isinstance(cookie, dict) or not isinstance(domain, str):
                return
            try:
                cookie_domain = normalize_hostname(domain.lstrip("."))
            except ValueError:
                return
            if cookie_domain != target:
                return
            name = cookie.get("name")
            value = cookie.get("value")
            if isinstance(name, str) and name and isinstance(value, str):
                cookies_dict[name] = value

        if isinstance(cookie_list, dict):
            for domain, cookies in cookie_list.items():
                if isinstance(cookies, list):
                    for c in cookies:
                        add_cookie(c, domain)
        elif isinstance(cookie_list, list):
            for c in cookie_list:
                if isinstance(c, dict):
                    add_cookie(c, c.get("domain", ""))
        else:
            raise ValueError("cookie_data 必须是对象或数组")
        return cookies_dict
    except Exception as e:
        err_msg = str(e)
        if "Connection refused" in err_msg or "111" in err_msg:
            print(
                f"❌ 获取 CookieCloud 异常: {e} (提示: 若在青龙等 Docker 容器内运行，请勿使用 127.0.0.1/localhost，需使用宿主机内网 IP 或 Docker 网关 IP 172.17.0.1)"
            )
        else:
            print(f"❌ 获取 CookieCloud 异常: {e}")
        return None


class QBittorrentClient:
    def __init__(self, base_url, api_key, *, verify_tls=True):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Authorization": f"Bearer {self.api_key}",
            "X-Api-Key": self.api_key,
            "Referer": f"{self.base_url}/",
            "Origin": self.base_url,
        }
        self.session = httpx.Client(
            base_url=self.base_url,
            verify=verify_tls,
            timeout=30,
            headers=headers,
            cookies={"SID": self.api_key},
        )

    def login(self):
        """验证 API Key 是否有效，兼容 Bearer Token、SID Cookie 与 username:password"""
        try:
            response = self.session.get("/api/v2/app/version")
            if response.status_code == 200:
                print("✅ API Key 验证成功")
                return True

            if response.status_code in {401, 403} and ":" in self.api_key:
                username, password = self.api_key.split(":", 1)
                login_resp = self.session.post(
                    "/api/v2/auth/login",
                    data={"username": username, "password": password},
                )
                if login_resp.status_code == 200 and login_resp.text.strip() in {
                    "Ok.",
                    "",
                }:
                    verify_resp = self.session.get("/api/v2/app/version")
                    if verify_resp.status_code == 200:
                        print("✅ qBittorrent 账号密码登录成功")
                        return True

            print(f"❌ API Key 验证失败，状态码: {response.status_code}")
            return False
        except Exception as e:
            print(f"❌ API Key 验证异常: {e}")
            return False

    def get_torrents(self):
        """获取种子列表；请求或解析失败时返回 None。"""
        try:
            response = self.session.get("/api/v2/torrents/info")
            response.raise_for_status()
            torrents = response.json()
            if not isinstance(torrents, list) or not all(
                isinstance(item, dict) for item in torrents
            ):
                raise ValueError("种子 API 响应必须是对象数组")
            return torrents
        except Exception as e:
            print(f"❌ 获取种子列表失败: {e}")
            return None

    def get_torrent_trackers(self, hash_value):
        """获取种子的 tracker 列表；请求或解析失败时返回 None。"""
        try:
            response = self.session.get(
                "/api/v2/torrents/trackers", params={"hash": hash_value}
            )
            response.raise_for_status()
            trackers = response.json()
            if not isinstance(trackers, list) or not all(
                isinstance(item, dict) and isinstance(item.get("url"), str)
                for item in trackers
            ):
                raise ValueError("tracker API 响应必须是带 url 的对象数组")
            return trackers
        except Exception as e:
            print(f"❌ 获取种子 {hash_value} 的 tracker 失败: {e}")
            return None

    def delete_torrent(self, hash_value, *, delete_files=False):
        """删除种子；默认保留已下载文件。"""
        if not isinstance(hash_value, str) or not VALID_TORRENT_HASH.fullmatch(
            hash_value
        ):
            print("❌ 拒绝删除：种子哈希格式无效")
            return False
        try:
            # 使用 data 发送 POST 请求
            data = {
                "hashes": hash_value,
                "deleteFiles": "true" if delete_files else "false",
            }
            response = self.session.post("/api/v2/torrents/delete", data=data)
            print(f"🔍 删除响应状态: {response.status_code}")

            # qBittorrent API 成功时通常返回空响应或 'Ok.'
            if response.status_code == 200:
                if response.text.strip() in {"", "Ok."}:
                    return True
                else:
                    print("⚠️  删除响应内容异常")
                    return False
            else:
                print(f"❌ 删除请求失败，状态码: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ 删除种子 {hash_value} 失败: {e}")
            return False

    def close(self):
        """关闭会话"""
        if self.session:
            self.session.close()


class Script:
    """脚本类"""

    def __init__(self, account):
        self.account = account
        require_fields(account, "url", "api_key")
        self.dry_run = parse_bool(
            account.get("dry_run", account.get("dryRun")),
            default=False,
            field_name="dry_run",
        )
        self.delete_files = parse_bool(
            account.get("delete_files", account.get("deleteFiles")),
            default=True,
            field_name="delete_files",
        )
        self.verify_tls = parse_bool(
            account.get("verify_tls"),
            default=True,
            field_name="verify_tls",
        )
        self.allow_insecure_http = parse_bool(
            account.get("allow_insecure_http"),
            # 兼容已经使用 verify_tls=false 的旧内网配置。
            default=not self.verify_tls,
            field_name="allow_insecure_http",
        )
        self.cookiecloud_allow_insecure_http = parse_bool(
            account.get("cookiecloud_allow_insecure_http"),
            default=False,
            field_name="cookiecloud_allow_insecure_http",
        )
        self.url = validate_service_origin(
            account.get("url"),
            field_name="url",
            allow_http=(
                self.allow_insecure_http or is_private_http_origin(account.get("url"))
            ),
        )
        if self.url.startswith("http://"):
            print("⚠️ qBittorrent 使用内网 HTTP；API Key 将以明文在局域网传输")
        self.api_key = account.get("api_key")
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            raise ValueError("api_key 必须是非空字符串")
        self.allowed_tracker_hosts = parse_tracker_hosts(
            account.get("chdbits_tracker_hosts")
        )
        self.strict_inspection = parse_bool(
            account.get("strict_inspection"),
            default=False,
            field_name="strict_inspection",
        )
        self.client = None
        self.last_error = ""

    def delete_candidate(self, hash_value, name, tags=()):
        """根据配置执行真实删除或演练预览。"""
        if self.dry_run:
            file_action = "删除文件" if self.delete_files else "保留文件"
            print(f"🧪 [dry-run] 将删除种子（{file_action}）: {name}")
            return "planned"

        assert self.client is not None
        if self.client.delete_torrent(hash_value, delete_files=self.delete_files):
            file_action = "含文件" if self.delete_files else "保留文件"
            print(f"✅ 已删除种子（{file_action}）: {name}")
            return "deleted"
        print(f"❌ 删除种子失败: {name}")
        return "failed"

    def get_chdbits_userdetails(self, userid, cookies_dict):
        # NexusPHP 的正在做种列表通常通过 AJAX 异步加载，直接访问 userdetails.php 获取不到列表HTML
        url = f"https://ptchdbits.co/getusertorrentlistajax.php?userid={userid}&type=seeding"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://ptchdbits.co/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        try:
            response = httpx.get(
                url, cookies=cookies_dict, headers=headers, timeout=30
            )
            if response.status_code == 200:
                return response.text
            else:
                print(
                    f"❌ 访问 CHDBits userdetails 失败, 状态码: {response.status_code}"
                )
                return None
        except Exception as e:
            print(f"❌ 访问 CHDBits 异常: {e}")
            return None

    def run(self):
        """执行脚本逻辑"""
        print("🚀 开始执行 qBittorrent 种子清理任务")
        print(f"📅 执行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        if not self.verify_tls:
            print("⚠️  已显式关闭 qBittorrent TLS 校验，API Key 可能暴露")

        # 创建客户端
        self.client = QBittorrentClient(
            self.url,
            self.api_key,
            verify_tls=self.verify_tls,
        )

        cookiecloud_url = os.environ.get("cookiecloud_url") or self.account.get(
            "cookiecloud_url"
        )
        cookiecloud_uuid = os.environ.get("cookiecloud_uuid") or self.account.get(
            "cookiecloud_uuid"
        )
        cookiecloud_password = os.environ.get(
            "cookiecloud_password"
        ) or self.account.get("cookiecloud_password")
        chdbits_userid = os.environ.get("chdbits_userid") or self.account.get(
            "chdbits_userid"
        )

        chdbits_html = None
        chdbits_cookies = None
        cookiecloud_failed = False
        chdbits_parsed_torrents = None
        chdbits_parse_failed = False
        inspection_failed = False

        try:
            # 登录
            if not self.client.login():
                print("❌ 登录失败，任务终止")
                self.last_error = "qBittorrent 登录验证失败"
                return False

            # 获取种子列表
            print("📥 正在获取种子列表...")
            torrents = self.client.get_torrents()
            if torrents is None:
                print("❌ 种子列表不可用，任务终止")
                self.last_error = "获取 qBittorrent 种子列表失败"
                return False
            if not torrents:
                print("✅ 当前没有种子，无需处理")
                return True

            print(f"📊 共找到 {len(torrents)} 个种子")

            # 筛选符合条件的种子
            target_torrents = []
            for torrent in torrents:
                # 检查标签是否包含"已整理"
                tags_value = torrent.get("tags", "")
                if not isinstance(tags_value, str):
                    print("⚠️  种子标签格式无效，已跳过")
                    inspection_failed = True
                    continue
                tags = [tag.strip() for tag in tags_value.split(",")]
                if "已整理" in tags:
                    target_torrents.append(torrent)
            print(f"🎯 找到 {len(target_torrents)} 个标签含'已整理'的种子")

            if not target_torrents:
                print("✅ 没有需要处理的种子")
                return not inspection_failed

            # 检查每个种子的 tracker 并删除不符合条件的
            deleted_count = 0
            planned_count = 0
            deleted_torrents = []

            for torrent in target_torrents:
                hash_value = torrent.get("hash")
                name = torrent.get("name")
                if (
                    not isinstance(hash_value, str)
                    or not VALID_TORRENT_HASH.fullmatch(hash_value)
                    or not isinstance(name, str)
                    or not name.strip()
                ):
                    print("⚠️  种子缺少有效的 hash/name，已跳过")
                    inspection_failed = True
                    continue

                print(f"🔍 检查种子: {name}")
                torrent_tags = {
                    tag.strip()
                    for tag in torrent.get("tags", "").split(",")
                    if tag.strip()
                }

                # 获取 tracker 列表
                trackers = self.client.get_torrent_trackers(hash_value)
                if trackers is None:
                    print(f"⚠️  获取种子 {name} 的 tracker 失败，已保留")
                    inspection_failed = True
                    continue
                hosts = tracker_hostnames(trackers)
                if not hosts:
                    print(f"⚠️  种子 {name} 没有可验证的 tracker 主机名，已保留")
                    inspection_failed = True
                    continue

                # 主机名必须与 allowlist 完全一致，不接受子串或查询参数伪装。
                has_chdbits = bool(hosts & self.allowed_tracker_hosts)

                if not has_chdbits:
                    print(f"🗑️  种子 {name} 的 tracker 不在 CHDBits allowlist")
                    print(f"🔍 种子哈希: {hash_value}")
                    action = self.delete_candidate(hash_value, name, torrent_tags)
                    if action == "deleted":
                        deleted_count += 1
                        deleted_torrents.append(name)
                    elif action == "planned":
                        planned_count += 1
                    else:
                        inspection_failed = True
                else:
                    print(f"🔍 种子 {name} 包含 chdbits tracker，检查 HR 标签...")
                    if not chdbits_userid:
                        print("⚠️  未配置 chdbits_userid，跳过 HR 检查，保留种子")
                        continue

                    if chdbits_html is None:
                        if (
                            not cookiecloud_url
                            or not cookiecloud_uuid
                            or not cookiecloud_password
                        ):
                            print(
                                "⚠️  未配置 CookieCloud 信息，无法获取 Cookie，跳过 HR 检查，保留种子"
                            )
                            continue

                        if chdbits_cookies is None and not cookiecloud_failed:
                            print(
                                "📥 正在从 CookieCloud 获取 ptchdbits.co 的 Cookie..."
                            )
                            chdbits_cookies = get_cookiecloud_cookies(
                                cookiecloud_url,
                                cookiecloud_uuid,
                                cookiecloud_password,
                                allow_insecure_http=self.cookiecloud_allow_insecure_http,
                            )
                            if not chdbits_cookies:
                                cookiecloud_failed = True

                        if cookiecloud_failed or not chdbits_cookies:
                            print("⚠️  获取 CHDBits Cookie 失败，跳过 HR 检查，保留种子")
                            inspection_failed = True
                            continue

                        print("📥 正在获取 CHDBits userdetails 页面...")
                        chdbits_html = self.get_chdbits_userdetails(
                            chdbits_userid, chdbits_cookies
                        )

                    if not chdbits_html:
                        print("⚠️  无法获取 CHDBits userdetails，跳过 HR 检查，保留种子")
                        inspection_failed = True
                        continue

                    if chdbits_parse_failed:
                        inspection_failed = True
                        continue
                    if chdbits_parsed_torrents is None:
                        chdbits_parsed_torrents = parse_chdbits_torrents(chdbits_html)
                        if chdbits_parsed_torrents is None:
                            print("🐛 警告: 网页解析失败，提取到 0 个做种记录")
                            chdbits_parse_failed = True
                            inspection_failed = True
                            continue
                        print(
                            f"🐛 从网页提取了 {len(chdbits_parsed_torrents)} 个正在做种的种子"
                        )

                    match, match_status = find_unique_torrent_match(
                        name,
                        chdbits_parsed_torrents,
                    )
                    if match is None:
                        if match_status == "ambiguous":
                            print(f"⚠️  种子名存在多个精确匹配，已保留: {name}")
                        else:
                            print(
                                f"⚠️  在当前做种列表中未找到唯一精确匹配，已保留: {name}"
                            )
                        inspection_failed = True
                        continue

                    _, matched_hr, matched_html_title = match

                    print(f"🔍 网页唯一匹配: {matched_html_title} (HR: {matched_hr})")
                    if matched_hr:
                        print(f"✅ 种子 {name} 带有 HR 标签，保留")
                    else:
                        print(f"🗑️  种子 {name} 没有 HR 标签")
                        print(f"🔍 种子哈希: {hash_value}")
                        action = self.delete_candidate(hash_value, name, torrent_tags)
                        if action == "deleted":
                            deleted_count += 1
                            deleted_torrents.append(name)
                        elif action == "planned":
                            planned_count += 1
                        else:
                            inspection_failed = True

            # 输出结果
            print("\n📊 任务完成统计:")
            print(f"   检查种子数量: {len(target_torrents)}")
            print(f"   删除种子数量: {deleted_count}")
            print(f"   dry-run 计划删除数量: {planned_count}")

            if deleted_torrents:
                print("\n🗑️  已删除的种子列表:")
                for i, name in enumerate(deleted_torrents, 1):
                    print(f"   {i}. {name}")

            if inspection_failed:
                if self.strict_inspection and not self.dry_run:
                    print("❌ 部分种子因证据不完整或删除失败而保留")
                    self.last_error = "部分种子因证据不完整或删除失败而保留"
                    return False
                else:
                    print("⚠️  部分种子因证据不完整已安全保留（跳过删除）")
            return True

        except Exception as e:
            print(f"❌ 执行过程中发生异常: {e}")
            self.last_error = f"执行异常: {e}"
            return False
        finally:
            if self.client:
                self.client.close()


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
