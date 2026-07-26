"""
mitmproxy addon：自动保存响应内容到文件
用法：mitmdump -s save_responses.py

保存位置：当前目录下的 mitm_responses/ 文件夹
"""
import json
import os
import time

from mitmproxy import http

# 保存目录
SAVE_DIR = "mitm_responses"

class ResponseSaver:
    def __init__(self):
        self.save_dir = SAVE_DIR
        os.makedirs(self.save_dir, exist_ok=True)
        self.counter = 0
    
    def response(self, flow: http.HTTPFlow):
        # 只保存有响应体的请求
        if not flow.response or not flow.response.content:
            return
        
        self.counter += 1
        
        # 构建文件名
        host = flow.request.host
        path = flow.request.path.split("?")[0].replace("/", "_")
        path = path.removeprefix("_")
        timestamp = int(time.time())
        filename = f"{timestamp}_{self.counter}_{host}_{path[:50]}.json"
        
        # 构建保存内容
        data = {
            "id": flow.id,
            "method": flow.request.method,
            "host": flow.request.host,
            "path": flow.request.path,
            "url": flow.request.url,
            "status_code": flow.response.status_code,
            "content_length": len(flow.response.content),
            "content_type": flow.response.headers.get("content-type", ""),
            "timestamp": timestamp,
            "request_headers": dict(flow.request.headers),
            "response_headers": dict(flow.response.headers),
        }
        
        # 尝试解析响应体
        content = flow.response.content
        try:
            data["body"] = json.loads(content.decode("utf-8"))
        except Exception:
            try:
                data["body"] = content.decode("utf-8")
            except Exception:
                data["body"] = f"<binary data, {len(content)} bytes>"
        
        # 保存到文件
        filepath = os.path.join(self.save_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"[Saved] {host}{flow.request.path[:60]} -> {filename}")

addons = [ResponseSaver()]
