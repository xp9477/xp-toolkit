---
name: traffic-capture
description: 按需开关家里 iStoreOS 上的全量 HTTPS 抓包节点。用户说打开抓包、关闭抓包、抓包状态、全量抓包，或要临时查看自己手机 Loon 经过 192.168.0.20:8898 的流量时使用。拿到所需结果后立刻关闭，不要等用户来关。
---

# 家用按需抓包

只操作用户自己的 iStoreOS。节点地址是 `192.168.0.20:8898`，Tailscale 备用地址是 `100.113.76.65:8898`。账号口令放在路由器 `/etc/mitmproxy-capture/conf/proxy-auth`，不要写进仓库、日志或回复。

## 命令

在仓库根目录执行：

```bash
skills/traffic-capture/scripts/capture.sh start
skills/traffic-capture/scripts/capture.sh status
skills/traffic-capture/scripts/capture.sh stop
```

- `start`：启动一次性全量抓包。容器重启策略是 `no`，路由重启后不会自己起来。
- `status`：只报告是否在监听、会话文件名和字节数。
- `stop`：停止并删除本次容器，保留会话文件。

Loon 需要先切到该 HTTP 节点，并已安装信任 `http://mitm.it` 的证书。不用 Loon 自带解密时，关闭 Loon 的 Mitm。打开期间经过节点的流量都会写入路由器上的会话文件。

## 结束

拿到本次需要的字段或确认目标请求已经出现后，立刻执行 `stop`。不要等用户说「抓包已经关了」，也不要为了让用户先切换 Loon 而把节点留着。关完再通知用户：路由器上的抓包已关闭，请把 Loon 切回规则模式，不要继续选择抓包节点。

## 回复限制

不要输出 Cookie、令牌、密码、请求正文或完整 URL 查询串。用户要求查看结果时，只先列出主机名和时间范围；展开某条记录前先说明其中可能含有登录态。任务结束后执行 `stop`，不要把节点留在运行状态。
