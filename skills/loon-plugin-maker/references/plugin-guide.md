# Loon插件开发参考

## Loon插件格式

```
#!name=插件名称
#!desc=插件描述
#!homepage=主页URL
#!author=作者
#!icon=图标URL

[Script]
http-response ^https?:\/\/example\.com\/api script-path=https://example.com/script.js, requires-body=true, timeout=10

[MITM]
hostname = example.com
```

## JS脚本模板

### 模板1：修改响应字段（推荐）

```javascript
let body = $response.body;
if (body) {
    try {
        let obj = JSON.parse(body);
        let target = obj.data || obj;
        
        // 修改目标字段
        target.vip_label = true;
        target.is_pay = true;
        
        body = JSON.stringify(obj);
    } catch (e) {
        console.log("Parse error: " + e.message);
    }
}
$done({ body });
```

### 模板2：删除特定字段

```javascript
const AD_KEYS = ["ad_config", "splash_ad", "banner_ad"];

let body = $response.body;
if (body) {
    try {
        let obj = JSON.parse(body);
        let target = obj.data || obj;
        
        for (let key of AD_KEYS) {
            delete target[key];
        }
        
        body = JSON.stringify(obj);
    } catch (e) {}
}
$done({ body });
```

### 模板3：返回空广告列表

```javascript
let body = $response.body;
if (body) {
    try {
        let obj = JSON.parse(body);
        let target = obj.data || obj;
        
        // 清空广告数组
        if (target.ads) target.ads = [];
        if (target.ad_list) target.ad_list = [];
        
        body = JSON.stringify(obj);
    } catch (e) {}
}
$done({ body });
```

### 模板4：拒绝返回空对象（安全）

```javascript
// 不需要JS脚本，直接在插件中使用
// http-response ^https?:\/\/example\.com\/api url reject-dict
```

## 拦截策略对比

| 策略 | 用法 | 安全性 | 适用场景 |
|------|------|--------|----------|
| `reject-dict` | 返回 `{}` | ⭐⭐⭐ | JSON API，最安全 |
| `reject` | TCP断开 | ⭐ | 非必要请求，最激进 |
| `script-response-body` | JS修改 | ⭐⭐⭐ | 需要保留部分数据 |
| `reject-200` | 返回空200 | ⭐⭐ | 旧版兼容，不推荐 |

## 常见广告SDK域名

### 穿山甲（字节跳动）
- `api-access.pangolin-sdk-toutiao.com`
- `pangolin-sdk-toutiao.com`
- `snssdk.com` / `*.snssdk.com`
- `applog.snssdk.com`

### 广点通（腾讯）
- `*.gdt.qq.com`
- `tmfmazu4.m.qq.com`
- `data.ab.qq.com`
- `mmgr.gtimg.com`

### 百度广告
- `mobads.baidu.com`
- `mobads-logs.baidu.com`
- `mobads-pre-config.cdn.bcebos.com`
- `feed-image.baidu.com`

### 快手广告
- `open.e.kuaishou.com`
- `gdfp.gifshow.com`

### 国际SDK
- `googleads.g.doubleclick.net`（AdMob）
- `pagead2.googlesyndication.com`（AdMob）
- `*.applovin.com`
- `*.mintegral.com`

## 字段修改模式

### 解锁VIP/会员
```json
{"data.user.vip": true, "data.payStatus": true, "data.vip_expiry_date": "2099-12-31"}
```

### 去除广告
```json
{"data.adShow": false, "data.adTypeShow": ""}
```

### 解除限制
```json
{"data.limitCount": 999999, "data.dailyLimit": 0}
```

### 修改数值
```json
{"data.coins": 999999, "data.level": 99}
```

## App图标获取

### App Store API
```
https://itunes.apple.com/search?term=<App名称>&country=cn&entity=software&limit=1
```

返回字段：
- `artworkUrl100` — 100x100图标
- `artworkUrl512` — 512x512高清图标

### GitHub托管
下载图标后放入仓库的 `icon/` 目录，使用raw URL：
```
https://github.com/<user>/<repo>/raw/main/icon/<filename>.png
```
