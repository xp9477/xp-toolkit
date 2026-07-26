/******************************

脚本功能：养基宝解锁vip
脚本作者：xp9477
更新时间：2024-12-12

*******************************

[rewrite_local]

^https?:\/\/.*yangjibao\.com\/(?:wxapi\/)?account|vip_info url script-response-body https://github.com/xp9477/Scripts/raw/main/rules/Loon/script/yangjibao.js
[mitm] 

hostname = *.yangjibao.com

*******************************/

var body = $response.body.replace(/vip_label":false/g, 'vip_label":true')
						 .replace(/vip_expiry_date":null/g, 'vip_expiry_date":"2099-12-31"')
						 .replace(/is_pay":false/g, 'is_pay":true');
$done({ body });