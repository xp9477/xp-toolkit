"""mitmproxy addon: 安全多项目 HTTP 请求凭据捕获插件。

核心安全特性：
1. 严格域名白名单（精准匹配 + 严格通配符，杜绝域名后缀伪造如 evil-163.com、163.com.evil.com）。
2. 严格路径与方法过滤，未命中项目全部纯净透传。
3. 严格字段白名单（仅从 flow.request 提取明确允许的 Header / Cookie，丢弃其余一切字段）。
4. 严格长度与字节限制（超限截断与超大记录拦截，防御 DoS / 膨胀）。
5. 零明文落盘：配置 Fernet/AES-GCM 密钥时强加密存入受限文件（0600 权限），未配置时默认仅保存脱敏元数据。
6. 零敏感外泄：严禁在 stdout、日志、URL、Bark 推送中输出任何 Token、Cookie 或敏感明文。
7. 多项目配置支持与热重载：仅需修改 config.json，无需重启容器即可长期扩展多项目。
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import stat
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

# 可选导入 cryptography
try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:
    Fernet = None
    InvalidToken = Exception

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    AESGCM = None

LOGGER = logging.getLogger("CaptureAddon")


def normalize_host(host: str) -> str:
    """标准化 Host，剔除端口、空白及结尾点，过滤非法字符。"""
    if not host or not isinstance(host, str):
        return ""
    # 若包含端口号，仅取主机名部分
    candidate = host.split(":")[0].strip().casefold().rstrip(".")
    # 拒绝包含路径字符、反斜杠、空格及控制字符的异常 Host
    if any(char.isspace() or char in "/\\?#@" for char in candidate):
        return ""
    return candidate


def is_domain_allowed(host: str, patterns: list[str]) -> bool:
    """严格判定域名是否在白名单内。

    杜绝域名后缀伪造漏洞：
    - 精确匹配：act.you.163.com 仅匹配 act.you.163.com，绝不匹配 fakeact.you.163.com 或 act.you.163.com.evil.com。
    - 通配符匹配：*.163.com 必须以 .163.com 为后缀且前缀非空，绝不匹配 evil163.com 或 163.com。
    """
    clean_host = normalize_host(host)
    if not clean_host:
        return False

    for pat in patterns:
        clean_pat = normalize_host(pat)
        if not clean_pat:
            continue

        if clean_pat.startswith("*."):
            suffix = clean_pat[2:]
            # 必须以 .suffix 结尾，且 clean_host 长度大于 .suffix 长度
            if clean_host.endswith("." + suffix) and len(clean_host) > len(suffix) + 1:
                return True
        else:
            if clean_host == clean_pat:
                return True

    return False


def normalize_path(raw_path: str) -> str:
    """提取纯净 URL 路径（剔除 Query 参数与 Fragment）。"""
    if not raw_path or not isinstance(raw_path, str):
        return "/"
    parsed = urlsplit(raw_path)
    path = parsed.path if parsed.path else "/"
    if not path.startswith("/"):
        path = "/" + path
    return path


def is_path_allowed(raw_path: str, patterns: list[str]) -> bool:
    """严格判定请求路径是否在白名单内。

    杜绝路径前缀伪造：
    - /act/list 仅精确匹配 /act/list 或 /act/list/，绝不匹配 /act/list_evil。
    - 若配置通配符 /api/*，则匹配 /api 及 /api/...，不匹配 /api_evil。
    """
    clean_path = normalize_path(raw_path)

    for pat in patterns:
        if not pat or not isinstance(pat, str):
            continue
        p = pat.strip()
        if p.endswith("/*"):
            prefix = p[:-2]
            if clean_path == prefix or clean_path.startswith(prefix + "/"):
                return True
        elif p.endswith("/"):
            if clean_path == p or clean_path.startswith(p):
                return True
        else:
            if clean_path == p or clean_path == (p + "/"):
                return True

    return False


def is_method_allowed(method: str, allowed_methods: list[str] | None) -> bool:
    """检查 HTTP 请求方法是否受支持。"""
    if not allowed_methods:
        return True
    return method.strip().upper() in [m.strip().upper() for m in allowed_methods]


def parse_cookie_header(header_val: str) -> dict[str, str]:
    """解析 Cookie 请求头文本为键值字典。"""
    cookies: dict[str, str] = {}
    if not header_val or not isinstance(header_val, str):
        return cookies

    for part in header_val.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, val = part.split("=", 1)
        name = name.strip()
        val = val.strip()
        if name and name not in cookies:
            cookies[name] = val
    return cookies


class RecordEncryptor:
    """支持 Fernet 与 AES-256-GCM 的安全记录加密器。"""

    def __init__(self, key: str | bytes):
        if isinstance(key, str):
            key_str = key.strip()
            key_bytes = key_str.encode("utf-8")
        else:
            key_bytes = key.strip()
            key_str = key_bytes.decode("utf-8", errors="replace")

        self.algorithm = "fernet"
        self._fernet = None
        self._aesgcm = None

        # 尝试 Fernet (44 字符 urlsafe base64)
        if len(key_str) == 44 and Fernet is not None:
            try:
                base64.urlsafe_b64decode(key_str)
                self._fernet = Fernet(key_bytes)
                self.algorithm = "fernet"
                return
            except Exception:
                pass

        # 尝试 AESGCM (32 字节 hex 或 base64 或 raw)
        if AESGCM is not None:
            raw_key = None
            if len(key_str) == 64:
                try:
                    raw_key = bytes.fromhex(key_str)
                except ValueError:
                    pass
            elif len(key_str) in (43, 44):
                try:
                    raw_key = base64.b64decode(key_str)
                except Exception:
                    pass
            elif len(key_bytes) == 32:
                raw_key = key_bytes

            if raw_key and len(raw_key) == 32:
                self._aesgcm = AESGCM(raw_key)
                self.algorithm = "aes-gcm"
                return

        # 若依然无法初始化
        if Fernet is None and AESGCM is None:
            raise RuntimeError(
                "Python 环境中未安装 cryptography 库，无法启用加密功能。"
            )
        raise ValueError(
            "无效的加密密钥格式。请提供标准的 32 字节 Fernet 密钥 (base64) 或 32 字节 AES-GCM 密钥。"
        )

    def encrypt(self, plaintext: str) -> tuple[str, str]:
        """加密明文，返回 (密文文本, 算法名)。"""
        data = plaintext.encode("utf-8")
        if self._fernet is not None:
            token = self._fernet.encrypt(data).decode("ascii")
            return token, "fernet"
        if self._aesgcm is not None:
            nonce = os.urandom(12)
            ct = self._aesgcm.encrypt(nonce, data, None)
            token = base64.b64encode(nonce + ct).decode("ascii")
            return token, "aes-gcm"
        raise RuntimeError("加密器未正确初始化。")

    def decrypt(self, token: str, algorithm: str | None = None) -> str:
        """解密密文，返回明文文本。"""
        algo = (algorithm or self.algorithm).lower()
        if algo == "fernet":
            if self._fernet is None:
                raise RuntimeError("当前密钥不是 Fernet 密钥，无法解密 Fernet 密文。")
            pt = self._fernet.decrypt(token.strip().encode("ascii"))
            return pt.decode("utf-8")
        if algo == "aes-gcm":
            if self._aesgcm is None:
                raise RuntimeError("当前密钥不是 AES-GCM 密钥，无法解密 AES-GCM 密文。")
            raw = base64.b64decode(token.strip())
            if len(raw) < 28:
                raise ValueError("无效的 AES-GCM 密文长度。")
            nonce = raw[:12]
            ct = raw[12:]
            pt = self._aesgcm.decrypt(nonce, ct, None)
            return pt.decode("utf-8")
        raise ValueError(f"不支持的加密算法: {algo}")


class CaptureAddon:
    """mitmproxy 事件拦截与受限凭据安全捕获 Addon。"""

    def __init__(
        self,
        config_path: str | Path | None = None,
        encryption_key: str | None = None,
        output_file: str | Path | None = None,
    ):
        self.addon_dir = Path(__file__).resolve().parent
        env_config = os.getenv("CAPTURE_CONFIG_FILE")
        self.config_path = Path(
            config_path or env_config or (self.addon_dir / "config.json")
        ).resolve()

        self._last_config_mtime: float | None = None
        self.config: dict[str, Any] = {}
        self.projects: list[dict[str, Any]] = []
        self.settings: dict[str, Any] = {}

        # 确定加密密钥
        self.encryption_key = (
            encryption_key
            or os.getenv("CAPTURE_ENCRYPTION_KEY")
            or self._read_key_from_file()
        )
        self.encryptor: RecordEncryptor | None = None
        if self.encryption_key:
            try:
                self.encryptor = RecordEncryptor(self.encryption_key)
            except Exception as e:
                print(
                    f"[CaptureAddon Warning] 初始化加密器失败 ({e})，将回退至纯元数据脱敏模式（零明文落盘）。",
                    file=sys.stderr,
                )
                self.encryptor = None

        self._override_output_file = Path(output_file) if output_file else None
        self.load_config(force=True)

    def _read_key_from_file(self) -> str | None:
        """从受限密钥文件中读取 Key。"""
        key_file_path = os.getenv("CAPTURE_KEY_FILE")
        if not key_file_path:
            return None
        p = Path(key_file_path).resolve()
        if not p.is_file():
            return None

        # 检查文件权限是否符合 0600 (仅所有者可读写)
        try:
            mode = stat.S_IMODE(p.stat().st_mode)
            if mode & 0o077 != 0:
                print(
                    f"[CaptureAddon Warning] 密钥文件权限宽松 ({oct(mode)})，建议设为 0600: {p}",
                    file=sys.stderr,
                )
        except Exception:
            pass

        try:
            return p.read_text(encoding="utf-8").strip()
        except Exception as e:
            print(f"[CaptureAddon Warning] 读取密钥文件失败: {e}", file=sys.stderr)
            return None

    def load_config(self, force: bool = False) -> bool:
        """安全加载并热重载项目配置。"""
        if not self.config_path.is_file():
            if force:
                print(
                    f"[CaptureAddon] 配置文件不存在: {self.config_path}，当前无生效项目（全部透传）。"
                )
            self.projects = []
            return False

        try:
            mtime = self.config_path.stat().st_mtime
            if not force and self._last_config_mtime == mtime:
                return True

            data = json.loads(self.config_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("配置文件根对象必须是 JSON 字典")

            self.config = data
            self.settings = data.get("settings", {})
            raw_projects = data.get("projects", [])
            if not isinstance(raw_projects, list):
                raw_projects = []

            # 过滤并校验各项目基础结构
            valid_projects = []
            for item in raw_projects:
                if not isinstance(item, dict):
                    continue
                if not item.get("id"):
                    continue
                valid_projects.append(item)

            self.projects = valid_projects
            self._last_config_mtime = mtime
            return True
        except Exception as e:
            print(
                f"[CaptureAddon Error] 加载配置文件失败 ({e})，保留上次有效配置。",
                file=sys.stderr,
            )
            return False

    def get_output_file(self) -> Path:
        """计算目标输出文件路径。"""
        if self._override_output_file:
            return self._override_output_file

        env_out = os.getenv("CAPTURE_OUTPUT_FILE")
        if env_out:
            return Path(env_out).resolve()

        configured = self.settings.get("output_file", "captures/records.enc")
        p = Path(configured)
        if not p.is_absolute():
            p = self.addon_dir / p
        return p.resolve()

    def _ensure_private_file(self, target_file: Path) -> int:
        """确保目录 0700 且以 0600 独占安全权限创建/打开文件描述符。"""
        target_dir = target_file.parent
        target_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            target_dir.chmod(0o700)
        except Exception:
            pass

        fd = os.open(
            str(target_file),
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
            0o600,
        )
        try:
            os.chmod(target_file, 0o600)
        except Exception:
            pass
        return fd

    def request(self, flow: Any) -> None:
        """mitmproxy 请求钩子：按项目白名单匹配并受限截取凭据。"""
        # 尝试热重载检查
        self.load_config()

        if not self.projects:
            # 无任何配置项目，全量透明放行
            return

        req = getattr(flow, "request", None)
        if req is None:
            return

        req_host = getattr(req, "host", "")
        req_path = getattr(req, "path", "")
        req_method = getattr(req, "method", "GET")

        clean_host = normalize_host(req_host)
        clean_path = normalize_path(req_path)

        # 查找首个命中的有效项目
        matched_project = None
        for proj in self.projects:
            if not proj.get("enabled", False):
                continue
            domains = proj.get("domains", [])
            if not is_domain_allowed(clean_host, domains):
                continue
            paths = proj.get("paths", [])
            if not is_path_allowed(clean_path, paths):
                continue
            methods = proj.get("methods")
            if not is_method_allowed(req_method, methods):
                continue

            matched_project = proj
            break

        if matched_project is None:
            # 未命中任何白名单项目，100% 纯净透传，无额外开销与副作用
            return

        # 命中白名单项目，进入受限提取流程
        self._process_matched_request(flow, matched_project, clean_host, clean_path)

    def _process_matched_request(
        self,
        flow: Any,
        project: dict[str, Any],
        clean_host: str,
        clean_path: str,
    ) -> None:
        """从匹配成功的 flow.request 中提取白名单字段并执行安全落盘。"""
        req = flow.request
        proj_id = project["id"]

        max_val_bytes = int(
            project.get(
                "max_value_bytes",
                self.settings.get("default_max_value_bytes", 1024),
            )
        )
        max_record_bytes = int(
            project.get(
                "max_record_bytes",
                self.settings.get("default_max_record_bytes", 16384),
            )
        )

        # 1. 严格白名单提取 Headers
        target_headers = [h.strip() for h in project.get("capture_headers", []) if h]
        captured_headers: dict[str, str] = {}
        flow_headers = getattr(req, "headers", {})

        for target in target_headers:
            # 大小写不敏感查找
            val = None
            if hasattr(flow_headers, "get"):
                val = flow_headers.get(target)
            elif hasattr(flow_headers, "items"):
                target_cf = target.casefold()
                for hk, hv in flow_headers.items():
                    if str(hk).casefold() == target_cf:
                        val = str(hv)
                        break

            if val is not None:
                val_str = str(val)
                if len(val_str.encode("utf-8")) > max_val_bytes:
                    val_str = val_str[:max_val_bytes]
                captured_headers[target] = val_str

        # 2. 严格白名单提取 Cookies
        target_cookies = [c.strip() for c in project.get("capture_cookies", []) if c]
        captured_cookies: dict[str, str] = {}

        # 综合考虑 flow.request.cookies 和 Cookie 请求头
        all_cookies: dict[str, str] = {}
        if hasattr(req, "cookies") and req.cookies:
            try:
                for ck, cv in req.cookies.items():
                    all_cookies[str(ck)] = str(cv)
            except Exception:
                pass

        cookie_hdr = ""
        if hasattr(flow_headers, "get"):
            cookie_hdr = flow_headers.get("cookie", "") or flow_headers.get(
                "Cookie", ""
            )
        if cookie_hdr:
            parsed_hdr = parse_cookie_header(str(cookie_hdr))
            for pk, pv in parsed_hdr.items():
                if pk not in all_cookies:
                    all_cookies[pk] = pv

        for target in target_cookies:
            if target in all_cookies:
                cval = str(all_cookies[target])
                if len(cval.encode("utf-8")) > max_val_bytes:
                    cval = cval[:max_val_bytes]
                captured_cookies[target] = cval

        # 若未捕获到任何目标字段，跳过写入
        if not captured_headers and not captured_cookies:
            return

        # 3. 总体字节数限制检查
        raw_payload = json.dumps(
            {"headers": captured_headers, "cookies": captured_cookies},
            ensure_ascii=False,
        )
        if len(raw_payload.encode("utf-8")) > max_record_bytes:
            print(
                f"[CaptureAddon] 警告: 项目 '{proj_id}' 捕获数据超过最大字节限制 ({max_record_bytes})，已安全丢弃。",
                file=sys.stderr,
            )
            return

        # 4. 构建记录对象与零明文落盘保护
        timestamp = int(time.time())
        record: dict[str, Any] = {
            "timestamp": timestamp,
            "project_id": proj_id,
            "host": clean_host,
            "path": clean_path,
            "method": getattr(req, "method", "GET"),
            "matched_header_keys": list(captured_headers.keys()),
            "matched_cookie_keys": list(captured_cookies.keys()),
        }

        if self.encryptor is not None:
            # 加密模式：密文落盘，零明文泄露
            ciphertext, algo = self.encryptor.encrypt(raw_payload)
            record["status"] = "encrypted"
            record["algorithm"] = algo
            record["ciphertext"] = ciphertext
        else:
            # 零密钥脱敏模式：绝对不落盘任何敏感凭据明文，仅保留元数据与字段长度
            record["status"] = "metadata_only_no_encryption_key"
            record["value_lengths"] = {
                k: len(v) for k, v in {**captured_headers, **captured_cookies}.items()
            }

        # 5. 安全写入受限权限文件
        dest_file = self.get_output_file()
        fd = self._ensure_private_file(dest_file)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        # 6. 安全无敏感信息审计日志（严禁打印 Token、Cookie、URL Query、Bark）
        print(
            f"[CaptureAddon] 捕获成功: project='{proj_id}' host='{clean_host}' "
            f"path='{clean_path}' (status={record['status']}, "
            f"headers={len(captured_headers)}, cookies={len(captured_cookies)})",
            file=sys.stdout,
        )


# mitmproxy 自动识别的顶级插件列表
addons = [CaptureAddon()]


def _cli():
    """本地管理与解密 CLI 工具。"""
    parser = argparse.ArgumentParser(
        description="mitmproxy 凭据捕获插件管理与离线解密工具"
    )
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    # gen-key
    subparsers.add_parser("gen-key", help="生成全新的 Fernet 加密密钥")

    # decrypt
    decrypt_parser = subparsers.add_parser("decrypt", help="解密已捕获的加密记录文件")
    decrypt_parser.add_argument(
        "--key", required=True, help="加密密钥 (Fernet base64 或 AES-GCM hex)"
    )
    decrypt_parser.add_argument(
        "--file", default="captures/records.enc", help="加密记录文件路径"
    )

    # validate-config
    validate_parser = subparsers.add_parser("validate-config", help="校验 config.json")
    validate_parser.add_argument("--config", default="config.json", help="配置文件路径")

    args = parser.parse_args()

    if args.cmd == "gen-key":
        if Fernet is None:
            print(
                "错误: cryptography 未安装，请先执行 pip install cryptography",
                file=sys.stderr,
            )
            sys.exit(1)
        k = Fernet.generate_key().decode("ascii")
        print(f"生成的 Fernet 密钥:\n{k}")

    elif args.cmd == "decrypt":
        p = Path(args.file).resolve()
        if not p.is_file():
            print(f"文件不存在: {p}", file=sys.stderr)
            sys.exit(1)
        encryptor = RecordEncryptor(args.key)
        with p.open("r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("status") == "encrypted":
                        ct = record.get("ciphertext")
                        algo = record.get("algorithm", "fernet")
                        decrypted = encryptor.decrypt(ct, algo)
                        print(
                            f"--- Record #{line_idx} [{record.get('project_id')}] ---"
                        )
                        print(decrypted)
                    else:
                        print(
                            f"--- Record #{line_idx} [{record.get('project_id')} (非加密记录)] ---"
                        )
                        print(json.dumps(record, ensure_ascii=False, indent=2))
                except Exception as e:
                    print(f"Line {line_idx} 解密失败: {e}", file=sys.stderr)

    elif args.cmd == "validate-config":
        p = Path(args.config).resolve()
        if not p.is_file():
            print(f"配置文件不存在: {p}", file=sys.stderr)
            sys.exit(1)
        data = json.loads(p.read_text(encoding="utf-8"))
        projects = data.get("projects", [])
        print(
            f"配置文件合法，包含 {len(projects)} 个项目定义。各项目 ID: {[pr.get('id') for pr in projects]}"
        )


if __name__ == "__main__":
    _cli()
