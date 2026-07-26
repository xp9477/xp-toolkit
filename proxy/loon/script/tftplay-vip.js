var body = $response.body;

// 拦截主配置接口 - 伪装VIP会员
if ($request.url.indexOf('/config/info/') !== -1) {
    try {
        var json = JSON.parse(body);
        if (json.data && json.data.userResult && json.data.userResult.user) {
            json.data.userResult.user.vip = true;
        }
        if (json.data) {
            json.data.payStatus = true;
            json.data.adTypeShow = "";
            json.data.adShowTime = "0";
        }
        body = JSON.stringify(json);
    } catch {}
}

$done({ body });
