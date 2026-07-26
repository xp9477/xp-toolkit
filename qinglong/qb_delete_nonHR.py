"""
name: qBittorrent 删除非 CHDBits HR 种子
cron: 0 * * * *
description: 删除已整理标签中不包含 chdbits tracker 的种子

env:
- `qb_delete_nonHR`: JSON 对象或 JSON 数组，字段 `url`, `api_key` (可选: `cookiecloud_url`, `cookiecloud_uuid`, `cookiecloud_password`, `chdbits_userid`)
"""

import base64
import hashlib
import json
import os
import re
from datetime import datetime

import httpx
import notify
from common import require_fields, run_account_scripts


def get_cookiecloud_cookies(url, uuid, password, target_domain="ptchdbits.co"):
    try:
        req_url = f"{url.rstrip('/')}/get/{uuid}"
        # 发送包含 password 参数，部分服务端会自动解密，如果未自动解密则本地解密
        response = httpx.get(req_url, params={"password": password}, timeout=30)
        if response.status_code != 200:
            print(f"❌ 请求 CookieCloud 失败，状态码: {response.status_code}")
            return None
        
        data = response.json()
        
        # 提取 cookie 列表
        cookie_list = []
        if "encrypted" in data:
            encrypted_data_b64 = data["encrypted"]
            hash_str = hashlib.md5(f"{uuid}-{password}".encode()).hexdigest()
            key = hash_str[:16].encode()
            encrypted_data = base64.b64decode(encrypted_data_b64)
            
            decrypted_data = None
            
            # Helper function to try different decryption libraries
            def decrypt_aes_cbc(key, iv, data):
                # 1. 尝试 cryptography (青龙通常内置)
                try:
                    from cryptography.hazmat.backends import default_backend
                    from cryptography.hazmat.primitives import padding
                    from cryptography.hazmat.primitives.ciphers import (
                        Cipher,
                        algorithms,
                        modes,
                    )
                    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
                    decryptor = cipher.decryptor()
                    padded_data = decryptor.update(data) + decryptor.finalize()
                    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
                    return unpadder.update(padded_data) + unpadder.finalize()
                except ImportError:
                    pass
                
                # 2. 尝试 pyaes (纯 Python 库)
                try:
                    import pyaes
                    decrypter = pyaes.Decrypter(pyaes.AESModeOfOperationCBC(key, iv=iv))
                    decrypted = decrypter.feed(data)
                    decrypted += decrypter.feed()
                    return decrypted
                except ImportError:
                    pass
                
                # 3. 尝试 pycryptodome
                try:
                    from Crypto.Cipher import AES
                    from Crypto.Util.Padding import unpad
                    cipher = AES.new(key, AES.MODE_CBC, iv=iv)
                    return unpad(cipher.decrypt(data), AES.block_size)
                except ImportError:
                    pass
                
                raise RuntimeError("未找到任何可用的 AES 库，请安装 cryptography 或 pyaes")

            try:
                if encrypted_data.startswith(b"Salted__"):
                    # 尝试 CryptoJS (动态IV / Salted__) 格式
                    salt = encrypted_data[8:16]
                    ciphertext = encrypted_data[16:]
                    
                    key_iv = b""
                    prev = b""
                    while len(key_iv) < 48:
                        prev = hashlib.md5(prev + key + salt).digest()
                        key_iv += prev
                    
                    real_key = key_iv[:32]
                    real_iv = key_iv[32:48]
                    
                    decrypted_data = decrypt_aes_cbc(real_key, real_iv, ciphertext)
                else:
                    # 尝试标准固定 IV
                    try:
                        decrypted_data = decrypt_aes_cbc(key, b'\x00' * 16, encrypted_data)
                    except Exception:
                        # 尝试前 16 字节作为 IV
                        iv = encrypted_data[:16]
                        decrypted_data = decrypt_aes_cbc(key, iv, encrypted_data[16:])
                        
                json_data = json.loads(decrypted_data.decode('utf-8'))
            except Exception as e:
                print(f"❌ 解密 CookieCloud 数据失败: {e}")
                return None
                    
            cookie_list = json_data.get("cookie_data", [])
        elif "cookie_data" in data:
            cookie_list = data["cookie_data"]
        else:
            print("❌ CookieCloud 响应缺少 cookie_data 字段")
            return None
            
        cookies_dict = {}
        if isinstance(cookie_list, dict):
            for domain, cookies in cookie_list.items():
                if target_domain in domain:
                    for c in cookies:
                        cookies_dict[c['name']] = c['value']
        else:
            for c in cookie_list:
                if target_domain in c.get('domain', ''):
                    cookies_dict[c['name']] = c['value']
        return cookies_dict
    except Exception as e:
        print(f"❌ 获取 CookieCloud 异常: {e}")
        return None


class QBittorrentClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = httpx.Client(
            base_url=self.base_url,
            verify=False,
            timeout=30,
            headers={'Authorization': f'Bearer {self.api_key}'}
        )

    def login(self):
        """验证 API Key 是否有效"""
        try:
            response = self.session.get('/api/v2/app/version')
            if response.status_code == 200:
                print("✅ API Key 验证成功")
                return True
            else:
                print(f"❌ API Key 验证失败，状态码: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ API Key 验证异常: {e}")
            return False

    def get_torrents(self):
        """获取种子列表"""
        try:
            response = self.session.get('/api/v2/torrents/info')
            return response.json()
        except Exception as e:
            print(f"❌ 获取种子列表失败: {e}")
            return []

    def get_torrent_trackers(self, hash_value):
        """获取种子的 tracker 列表"""
        try:
            response = self.session.get('/api/v2/torrents/trackers', params={'hash': hash_value})
            return response.json()
        except Exception as e:
            print(f"❌ 获取种子 {hash_value} 的 tracker 失败: {e}")
            return []

    def delete_torrent(self, hash_value):
        """删除种子及其下载的文件"""
        try:
            # 使用 data 发送 POST 请求
            data = {
                'hashes': hash_value,
                'deleteFiles': 'true'
            }
            response = self.session.post('/api/v2/torrents/delete', data=data)
            print(f"🔍 删除响应状态: {response.status_code}")
            print(f"🔍 删除响应内容: '{response.text}'")
            
            # qBittorrent API 成功时通常返回空响应或 'Ok.'
            if response.status_code == 200:
                if response.text == '' or response.text == 'Ok.':
                    return True
                else:
                    print(f"⚠️  删除响应内容异常: '{response.text}'")
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
        self.url = account.get("url", "")
        self.api_key = account.get("api_key", "")
        require_fields(account, "url", "api_key")
        self.client = None
    
    def get_chdbits_userdetails(self, userid, cookies_dict):
        # NexusPHP 的正在做种列表通常通过 AJAX 异步加载，直接访问 userdetails.php 获取不到列表HTML
        url = f"https://ptchdbits.co/getusertorrentlistajax.php?userid={userid}&type=seeding"
        try:
            response = httpx.get(url, cookies=cookies_dict, timeout=30, verify=False)
            if response.status_code == 200:
                return response.text
            else:
                print(f"❌ 访问 CHDBits userdetails 失败, 状态码: {response.status_code}")
                return None
        except Exception as e:
            print(f"❌ 访问 CHDBits 异常: {e}")
            return None
    
    def run(self):
        """执行脚本逻辑"""
        print("🚀 开始执行 qBittorrent 种子清理任务")
        print(f"📅 执行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 创建客户端
        self.client = QBittorrentClient(self.url, self.api_key)
        
        cookiecloud_url = os.environ.get("cookiecloud_url") or self.account.get("cookiecloud_url")
        cookiecloud_uuid = os.environ.get("cookiecloud_uuid") or self.account.get("cookiecloud_uuid")
        cookiecloud_password = os.environ.get("cookiecloud_password") or self.account.get("cookiecloud_password")
        chdbits_userid = os.environ.get("chdbits_userid") or self.account.get("chdbits_userid")
        
        chdbits_html = None
        chdbits_cookies = None
        cookiecloud_failed = False
        chdbits_parsed_torrents = None
        
        try:
            # 登录
            if not self.client.login():
                print("❌ 登录失败，任务终止")
                return False
            
            # 获取种子列表
            print("📥 正在获取种子列表...")
            torrents = self.client.get_torrents()
            if not torrents:
                print("✅ 当前没有种子，无需处理")
                return True
            
            print(f"📊 共找到 {len(torrents)} 个种子")
            
            # 筛选符合条件的种子
            target_torrents = []
            for torrent in torrents:
                # 检查标签是否包含"已整理"
                tags = [tag.strip() for tag in torrent.get('tags', '').split(',')]
                if '已整理' in tags:
                    target_torrents.append(torrent)
            print(f"🎯 找到 {len(target_torrents)} 个标签含'已整理'的种子")
            
            if not target_torrents:
                print("✅ 没有需要处理的种子")
                return True
            
            # 检查每个种子的 tracker 并删除不符合条件的
            deleted_count = 0
            deleted_torrents = []
            
            for torrent in target_torrents:
                hash_value = torrent['hash']
                name = torrent['name']
                
                print(f"🔍 检查种子: {name}")
                
                # 获取 tracker 列表
                trackers = self.client.get_torrent_trackers(hash_value)
                if not trackers:
                    print(f"⚠️  无法获取种子 {name} 的 tracker 信息，跳过")
                    continue
                
                # 检查是否包含 chdbits
                has_chdbits = False
                for tracker in trackers:
                    url = tracker.get('url', '').lower()
                    if 'chdbits' in url:
                        has_chdbits = True
                        break
                
                if not has_chdbits:
                    print(f"🗑️  种子 {name} 的 tracker 不包含 chdbits，准备删除")
                    print(f"🔍 种子哈希: {hash_value}")
                    if self.client.delete_torrent(hash_value):
                        deleted_count += 1
                        deleted_torrents.append(name)
                        print(f"✅ 已删除种子: {name}")
                    else:
                        print(f"❌ 删除种子失败: {name}")
                        # 尝试强制删除（不删除文件）
                        print("🔄 尝试强制删除种子（保留文件）...")
                        try:
                            force_data = {
                                'hashes': hash_value,
                                'deleteFiles': 'false'
                            }
                            force_response = self.client.session.post('/api/v2/torrents/delete', data=force_data)
                            print(f"🔍 强制删除响应: {force_response.status_code} - '{force_response.text}'")
                            
                            if force_response.status_code == 200 and (force_response.text == '' or force_response.text == 'Ok.'):
                                deleted_count += 1
                                deleted_torrents.append(name)
                                print(f"✅ 强制删除成功（保留文件）: {name}")
                            else:
                                print(f"❌ 强制删除也失败: {name}")
                        except Exception as e:
                            print(f"❌ 强制删除时出错: {e}")
                else:
                    print(f"🔍 种子 {name} 包含 chdbits tracker，检查 HR 标签...")
                    if not chdbits_userid:
                        print("⚠️  未配置 chdbits_userid，跳过 HR 检查，保留种子")
                        continue
                        
                    if chdbits_html is None:
                        if not cookiecloud_url or not cookiecloud_uuid or not cookiecloud_password:
                            print("⚠️  未配置 CookieCloud 信息，无法获取 Cookie，跳过 HR 检查，保留种子")
                            continue
                        
                        if chdbits_cookies is None and not cookiecloud_failed:
                            print("📥 正在从 CookieCloud 获取 ptchdbits.co 的 Cookie...")
                            chdbits_cookies = get_cookiecloud_cookies(cookiecloud_url, cookiecloud_uuid, cookiecloud_password)
                            if not chdbits_cookies:
                                cookiecloud_failed = True
                        
                        if cookiecloud_failed or not chdbits_cookies:
                            print("⚠️  获取 CHDBits Cookie 失败，跳过 HR 检查，保留种子")
                            continue
                            
                        print("📥 正在获取 CHDBits userdetails 页面...")
                        chdbits_html = self.get_chdbits_userdetails(chdbits_userid, chdbits_cookies)
                        
                    if not chdbits_html:
                        print("⚠️  无法获取 CHDBits userdetails，跳过 HR 检查，保留种子")
                        continue
                        
                    if chdbits_parsed_torrents is None:
                        chdbits_parsed_torrents = []
                        chunks = re.split(r'(?i)<tr', chdbits_html)
                        for chunk in chunks:
                            if 'details.php?id=' in chunk:
                                # 确保匹配的是包含详情链接的 a 标签中的 title，而不是前面的分类 img 的 title
                                title_match = re.search(r'href="details\.php[^>]+title="([^"]+)"', chunk, re.IGNORECASE)
                                if not title_match:
                                    title_match = re.search(r'href="details\.php[^>]+>(?:<b>)?([^<]+)(?:</b>)?</a>', chunk, re.IGNORECASE)
                                    
                                if title_match:
                                    html_title = title_match.group(1)
                                    html_title_clean = re.sub(r'[\W_]+', '', html_title).lower()
                                    has_hr = 'class="circle-text">HR<' in chunk or 'class="circle">HR<' in chunk or '>HR</div>' in chunk
                                    chdbits_parsed_torrents.append((html_title_clean, has_hr, html_title))
                        
                        if not chdbits_parsed_torrents:
                            print(f"🐛 警告: 网页解析失败，提取到 0 个做种记录！请检查网页结构。HTML前段: {chdbits_html[:300]}")
                        else:
                            print(f"🐛 从网页提取了 {len(chdbits_parsed_torrents)} 个正在做种的种子")

                    qb_name_clean = re.sub(r'[\W_]+', '', name).lower()
                    matched_hr = None
                    matched_html_title = None
                    
                    for html_title_clean, has_hr, html_title in chdbits_parsed_torrents:
                        if len(html_title_clean) > 5 and (html_title_clean in qb_name_clean or qb_name_clean in html_title_clean):
                            matched_hr = has_hr
                            matched_html_title = html_title
                            break

                    if matched_hr is not None:
                        print(f"🔍 网页匹配成功: {matched_html_title} (HR: {matched_hr})")
                        if matched_hr:
                            print(f"✅ 种子 {name} 带有 HR 标签，保留")
                        else:
                            print(f"🗑️  种子 {name} 没有 HR 标签，准备删除")
                            print(f"🔍 种子哈希: {hash_value}")
                            if self.client.delete_torrent(hash_value):
                                deleted_count += 1
                                deleted_torrents.append(name)
                                print(f"✅ 已删除种子: {name}")
                            else:
                                print(f"❌ 删除种子失败: {name}")
                                # 尝试强制删除（不删除文件）
                                print("🔄 尝试强制删除种子（保留文件）...")
                                try:
                                    force_data = {
                                        'hashes': hash_value,
                                        'deleteFiles': 'false'
                                    }
                                    force_response = self.client.session.post('/api/v2/torrents/delete', data=force_data)
                                    print(f"🔍 强制删除响应: {force_response.status_code} - '{force_response.text}'")
                                    
                                    if force_response.status_code == 200 and (force_response.text == '' or force_response.text == 'Ok.'):
                                        deleted_count += 1
                                        deleted_torrents.append(name)
                                        print(f"✅ 强制删除成功（保留文件）: {name}")
                                    else:
                                        print(f"❌ 强制删除也失败: {name}")
                                except Exception as e:
                                    print(f"❌ 强制删除时出错: {e}")
                    else:
                        print(f"⚠️  在当前做种列表中未找到种子名，跳过 HR 检查，保留: {name}")
            
            # 输出结果
            print("\n📊 任务完成统计:")
            print(f"   检查种子数量: {len(target_torrents)}")
            print(f"   删除种子数量: {deleted_count}")
            
            if deleted_torrents:
                print("\n🗑️  已删除的种子列表:")
                for i, name in enumerate(deleted_torrents, 1):
                    print(f"   {i}. {name}")
            
            return True
            
        except Exception as e:
            print(f"❌ 执行过程中发生异常: {e}")
            return False
        finally:
            if self.client:
                self.client.close()


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
