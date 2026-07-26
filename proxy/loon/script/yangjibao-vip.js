var body = $response.body;

if ($request.url.indexOf('/users/v1/account') !== -1) {
    try {
        var json = JSON.parse(body);
        if (json.data) {
            json.data.vip_label = true;
            json.data.is_pay = true;
            json.data.vip_expiry_date = "2099-12-31";
            json.data.subscribe_status = 1;
        }
        body = JSON.stringify(json);
    } catch {}
}

$done({ body });
