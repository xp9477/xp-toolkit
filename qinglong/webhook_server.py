import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer


class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 当收到指定路径的请求时触发
        if self.path.startswith('/check_ip'):
            self.send_response(200)
            self.send_header('Content-type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b"IP check triggered successfully.")
            
            # 使用青龙原生的 task 命令执行脚本，这样会在青龙面板自动生成标准的任务日志
            script_dir = os.path.dirname(os.path.abspath(__file__))
            script_path = os.path.join(script_dir, "check_ip.py")
            print(f"Triggering script via ql task: {script_path}")
            
            # 使用 task 命令，青龙会自动将日志放在 /ql/data/log/项目名_check_ip/ 下面
            subprocess.Popen(["task", script_path])
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

    def do_POST(self):
        # 兼容 POST 请求
        self.do_GET()

def run(port=8001):
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, WebhookHandler)
    print(f"Webhook server is running on 0.0.0.0:{port}")
    print(f"Webhook URL: http://<你的青龙IP>:{port}/check_ip")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()

if __name__ == '__main__':
    # 默认使用 8001 端口，如果被占用可以修改这里
    run(port=8001)
