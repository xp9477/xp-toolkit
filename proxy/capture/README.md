# mitmproxy 安全多项目凭据捕获套件 (Docker & iStoreOS)

本组件为基于 mitmproxy 的安全 HTTP 请求凭据捕获 Addon，专为个人家庭网络与远程抓包设计。结合 iPhone Loon 的 HTTP 代理接入及 iStoreOS 的 Tailscale 虚拟局域网，实现安全、隔离、无敏感信息泄露的多项目自动化凭据捕获。

---

## 1. 整体架构与网络链路

```text
[ iPhone (Loon) ]
       │  (HTTP Proxy 协议: 100.x.y.z:8080)
       ▼  (通过 Tailscale 内网加密通道)
[ iStoreOS (Tailscale 节点) ]
       │  (端口转发或 Docker 主机网络)
       ▼
[ mitmproxy (Docker Regular 模式) + CaptureAddon ]
       │
       ├─► [非白名单请求]: 100% 纯净透传，无解密/无落盘
       │
       └─► [白名单匹配请求]: 严格提取配置字段 -> 强加密/元数据落盘
       │
       ▼  (出站流量使用 iStoreOS 路由器既有默认策略 / 规则)
[ 互联网目标服务器 (如网易严选) ]  *(注意：出站直连或按路由表分流，绝不串联韩国 x-ui 等第三方代理)*
```

### 为什么选择 Regular 模式？
- **Loon 代理直连**：Loon 在节点中配置 HTTP 代理类型，直接通过 `CONNECT domain:443` 与 mitmproxy 建立通道。
- **免旁路劫持与透明代理污染**：不需要复杂的 iptables/nftables REDIRECT 规则，不需要改动全局 DNS，仅目标 App 流量或通过 Loon 规则选中的流量才会转发至代理。
- **出站走路由器既有策略**：mitmproxy 容器默认使用宿主机（iStoreOS）的网络栈发包，走路由器既有的出口路由策略与分流规则，绝不串接韩国 x-ui 等敏感外部节点。

---

## 2. 核心安全防护设计

1. **严格域名匹配（杜绝域名后缀伪造）**：
   - 传统包含匹配（如 `in host`）极易被伪造域名绕过（如 `fakeact.you.163.com`、`act.you.163.com.evil.com` 或 `evil-163.com`）。
   - 本插件对 Host 剥离端口、去空白与大小写归一化后执行严格匹配：
     - **精确匹配**：`act.you.163.com` 仅匹配目标域名自身，不匹配任何子域名或后缀伪装。
     - **通配符匹配**：`*.163.com` 必须具备 `.` 分隔符且有子域前缀，拒绝 `evil163.com`。
2. **严格路径与方法边界**：
   - 仅匹配 `paths` 列表中定义的精确路径（剥离 Query 和 Fragment），杜绝 `/act/list_evil` 类似前缀绕过。
   - 仅对匹配 `methods`（如 GET/POST）的请求生效，其余操作立即透传。
3. **严格字段白名单提取（从 flow.request）**：
   - 仅从请求中提取 `capture_headers` 与 `capture_cookies` 列明的必要键值。
   - 其余所有 Header、Cookie、Body 全部物理丢弃，绝不全量 dump。
4. **单字段截断与最大字节数限制**：
   - 每个提取字段限制最大字节数（`max_value_bytes`，默认 1024 字节），防止特制 Payload 引起内存暴涨。
   - 单条记录总字节数限制（`max_record_bytes`，默认 16384 字节），超限安全拒绝。
5. **零明文落盘 (Zero-Plaintext on Disk)**：
   - **配置密钥时**：使用标准 Fernet（AES-128-CBC + HMAC-SHA256）或 AES-256-GCM 强加密后落盘。存储文件创建时即强制 `0600` 权限，上级目录强制 `0700`。
   - **未配置密钥时**：默认**绝不保存任何凭据明文**，仅记录请求时间戳、项目 ID、Host、Path、匹配到的键名及字段长度等脱敏元数据。
6. **零敏感日志与零外发 (Zero Leak)**：
   - 控制台标准输出 `stdout`、错误日志、URL Query、Bark 推送中**绝不打印任何 Token、Cookie 或敏感明文**。
   - 审计日志仅打印脱敏概要，例如：
     ```text
     [CaptureAddon] 捕获成功: project='yanxuan' host='act.you.163.com' path='/act-attendance/task/list' (status=encrypted, headers=1, cookies=3)
     ```

---

## 3. 多项目配置说明 (`config.json`)

配置文件路径默认为同目录下的 `config.json`，亦可通过环境变量 `CAPTURE_CONFIG_FILE` 自定义。
**插件支持热重载**：修改 JSON 保存后，下次请求到达时将自动比对文件 mtime 并重新加载，**无需重启 Docker 容器**。

### 示例配置结构

```json
{
  "version": 1,
  "settings": {
    "output_file": "captures/records.enc",
    "default_max_value_bytes": 1024,
    "default_max_record_bytes": 16384,
    "log_level": "INFO"
  },
  "projects": [
    {
      "id": "yanxuan",
      "name": "网易严选每日签到",
      "enabled": false,
      "description": "默认禁用。确认已授权并配置加密密钥后，将 enabled 改为 true",
      "domains": [
        "act.you.163.com"
      ],
      "paths": [
        "/act-attendance/task/list",
        "/act-attendance/att/v4/index",
        "/act-attendance/att/v3/sign"
      ],
      "methods": [
        "GET",
        "POST"
      ],
      "capture_headers": [
        "User-Agent",
        "X-Requested-With"
      ],
      "capture_cookies": [
        "yx_csrf",
        "yx_new_sid",
        "yx_sid",
        "NTES_YD_SESS"
      ],
      "max_value_bytes": 1024,
      "max_record_bytes": 8192
    }
  ]
}
```

### 字段说明
- `enabled`: 是否启用该项目捕获。默认示例为 `false`，明确可禁用。
- `domains`: 允许的主机列表，支持精确域名（`act.you.163.com`）与安全通配符（`*.163.com`）。
- `paths`: 允许的路径列表，支持精确路径（`/path/to`）与目录通配符（`/api/*`）。
- `methods`: 允许的 HTTP 方法，如 `["GET", "POST"]`。
- `capture_headers`: 白名单请求头名称（不区分大小写匹配）。
- `capture_cookies`: 白名单 Cookie 键名。
- `max_value_bytes`: 单个字段最大字节数截断限制。
- `max_record_bytes`: 单条记录加密前的最大允许总字节数。

---

## 4. 密钥管理与安全规范

> **安全红线**：加密密钥严禁 Commit 到 Git 仓库！

### 1) 生成强加密密钥
在本地终端执行：
```bash
python3 proxy/capture/addon.py gen-key
```
或直接使用 Python：
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2) 密钥注入方式（任选其一）
- **环境变量（推荐）**：
  设置容器环境变量 `CAPTURE_ENCRYPTION_KEY=<你的密钥>`。
- **受限密钥文件**：
  在路由器宿主机创建 `/etc/mitmproxy/capture.key`，将密钥写入并限定权限为 `chmod 600 /etc/mitmproxy/capture.key`，设置容器环境变量 `CAPTURE_KEY_FILE=/etc/mitmproxy/capture.key`。

---

## 5. Docker 部署运行指南 (iStoreOS)

### 方案 A：Docker Compose 部署（推荐）

在 iStoreOS 上创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  mitmproxy-capture:
    image: mitmproxy/mitmproxy:latest
    container_name: mitmproxy-capture
    restart: unless-stopped
    # 绑定在 Tailscale IP 或内网端口，避免暴露公网
    ports:
      - "8080:8080"
    environment:
      - CAPTURE_ENCRYPTION_KEY=kepmjpEQKIkHBKKNphcAvNgiIaZAgias5GAmazmjOPY=
      - CAPTURE_CONFIG_FILE=/home/mitmproxy/capture/config.json
      - CAPTURE_OUTPUT_FILE=/home/mitmproxy/capture/captures/records.enc
    volumes:
      - ./proxy/capture:/home/mitmproxy/capture:rw
      - ./mitmproxy_certs:/home/mitmproxy/.mitmproxy:rw
    command: >
      mitmdump
      -p 8080
      --set block_global=false
      -s /home/mitmproxy/capture/addon.py
```

### 方案 B：Docker 单行命令

```bash
docker run -d \
  --name mitmproxy-capture \
  --restart unless-stopped \
  -p 8080:8080 \
  -e CAPTURE_ENCRYPTION_KEY="<你的 Fernet 密钥>" \
  -v $(pwd)/proxy/capture:/home/mitmproxy/capture:rw \
  -v mitmproxy_data:/home/mitmproxy/.mitmproxy \
  mitmproxy/mitmproxy:latest \
  mitmdump -p 8080 --set block_global=false -s /home/mitmproxy/capture/addon.py
```

---

## 6. iPhone Loon 客户端配置流程

1. **安装并信任 mitmproxy 根证书**：
   - 首次启动 mitmproxy 后，在 `mitmproxy_certs/` 目录下生成 `mitmproxy-ca-cert.pem`。
   - 将证书传送至 iPhone，在「设置」->「通用」->「VPN 与设备管理」中安装描述文件。
   - 在「设置」->「通用」->「关于本机」->「证书信任设置」中开启针对 mitmproxy 证书的完全信任。
2. **Loon 节点配置**：
   - 新建节点 -> 协议选择 `HTTP`。
   - 节点地址填写 iStoreOS 的 **Tailscale IP**（例如 `100.101.102.103`）。
   - 端口填写 `8080`。
3. **分流策略**：
   - 建议在 Loon 中配置分流规则，仅将目标域名（如 `act.you.163.com`）分流指向该 HTTP 代理节点，其余所有流量保持正常直连或原有分流，最大限度保证性能与隐私。

---

## 7. 离线解密与凭据查看

当抓取到加密记录后，可在本地使用 CLI 解密读取：

```bash
# 解密 captures/records.enc 中的所有记录
python3 proxy/capture/addon.py decrypt \
  --key "kepmjpEQKIkHBKKNphcAvNgiIaZAgias5GAmazmjOPY=" \
  --file proxy/capture/captures/records.enc
```

解密输出样例：
```json
--- Record #1 [yanxuan] ---
{
  "headers": {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)...",
    "X-Requested-With": "com.netease.yanxuan"
  },
  "cookies": {
    "yx_csrf": "a1b2c3d4e5f6...",
    "yx_sid": "s_123456789...",
    "NTES_YD_SESS": "sess_987654321..."
  }
}
```

提取后的 Cookie 可便捷填入青龙面板的 `yanxuan_daily_sign` 环境变量中。
