"""
name: 滴滴打车
cron: 1 1 1 1 1
description: 滴滴活动合集脚本

env:
- `dddc`: 每行一个 JSON 对象，字段 `username`, `uid`, `token`
- `DDDC_LAT`: 可选，纬度，默认上海市中心
- `DDDC_LNG`: 可选，经度，默认上海市中心
"""

import time

import notify
import requests
from common import get_env, require_fields, run_account_scripts

appversion = '6.6.20'
lat = get_env('DDDC_LAT', '31.23')  #纬度
lng = get_env('DDDC_LNG', '121.47')  #经度
didifl = 'true'

#设置api
fuli ='https://ut.xiaojukeji.com/ut/welfare/api/action/dailySign'
youhui = 'https://union.didi.cn/api/v1.0/reward/receive'
guafen1 = 'https://ut.xiaojukeji.com/ut/welfare/api/home/divideData'
guafen2 = 'https://ut.xiaojukeji.com/ut/welfare/api/action/joinDivide'
guafen3 = 'https://ut.xiaojukeji.com/ut/welfare/api/action/event/report'
ttfuli = 'https://ut.xiaojukeji.com/ut/janitor/api/home/sign/index'
ttfuli1 = 'https://ut.xiaojukeji.com/ut/janitor/api/action/sign/do'
yao = 'https://api.didi.cn/webx/chapter/product/init'
#查询未领取福利金
fulijingchax = 'https://ut.xiaojukeji.com/ut/welfare/api/home/getBubble'
#接上面领取
liqu = 'https://ut.xiaojukeji.com/ut/welfare/api/action/clickBubble'
#养券大师
#判断过期
yanquan1 = 'https://game.xiaojukeji.com/api/game/coaster/expireConfirm'
#签到
yanquan2 = 'https://game.xiaojukeji.com/api/game/coaster/sign'
#任务
yanquan3 = 'https://game.xiaojukeji.com/api/game/mission/get?xbiz=240301&prod_key=ut-coupon-master&xpsid=&dchn=BnGadK5&xoid=&xenv=wxmp&xspm_from=welfare-center.none.c1324.none&xpsid_root=&xpsid_from=&xpsid_share=&game_id=30&platform=1&token='
#做任务
yanquan4 = 'https://game.xiaojukeji.com/api/game/mission/update'
#领取
yanquan5 = 'https://game.xiaojukeji.com/api/game/mission/award'
#抽奖
yanquan6 = 'https://game.xiaojukeji.com/api/game/coaster/draw'
#升级轮盘
yanquan7 = 'https://game.xiaojukeji.com/api/game/coaster/wheelUpgrade'
#详细
yanquan8 = 'https://game.xiaojukeji.com/api/game/coaster/hall'
#学生优惠
xuesyhui1 = 'https://ut.xiaojukeji.com/ut/active_brick/api/v1/wyc/identity/index'
xuesyhui2 = 'https://ut.xiaojukeji.com/ut/active_brick/api/v1/wyc/identity/award/user_do_group_all'


def run_for_account(uid, token):
    print(f'正在执行账号：{uid}')
    chaxun(uid,token)
    if didifl == 'true':
        bdfulijing(uid,token)
    try:
        diyi(uid,token)
    except Exception as e:
        print(e)
    #guafen(uid,token)

# def dcdj(uid,token):
#     data = {"xbiz":"240101","prod_key":"ut-dunion-coupon-bag","xpsid":"","dchn":"YoZ591b","xoid":"","xenv":"wxmp","xspm_from":"none.none.none.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","env":{"dchn":"YoZ591b","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"4","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":3964},"req_env":"wx","dsi":"","source_id":"","product_type":"didi","lng":lng,"lat":lat,"token":token,"uid":"","phone":"","city_id":4}
#     tijiao = requests.post(url=youhui, json=data).json()
#     if tijiao['errmsg'] == 'success':
#         for yh in tijiao['data']['rewards']:
#             print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
#     else:
#         print(tijiao['errmsg'])


def diyi(uid,token):
    print('--------领取优惠券--------')
    yq(uid,token)
    #data = {"lang":"zh-CN","token":token,"access_key_id":9,"appversion":appversion,"channel":1100000009,"_ds":"","xpsid":"","xpsid_root":"","dsi":"","source_id":"","product_type":"didi","city_id":4,"lng":"","lat":"","source_.from":"","env":{"dchn":"r2mda3z","newTicket":token,"latitude":"","longitude":"","model":"2201122C","fromChannel":"2","newAppid":"35009","openId":"","openIdType":"1","sceneId":"1037","isHitButton":True,"isOpenWeb":False,"timeCost":19908,"cityId":"4","xAxes":"167.60003662109375","yAxes":"480.0857849121094"},"req_env":"wx","dunion_callback":""}
    data = {"env":{"dchn":"YQwoRwR","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":1645},"funnel_key":r"{\"from_xenv\":\"wxmp\",\"promotion_type\":1,\"xenv\":\"wxmp\"}","req_env":"wx","dsi":"","source_id":"","dchn":"YQwoRwR","product_type":"didi","lng":lng,"lat":lat,"lang":"zh-CN","token":token,"uid":"","phone":"","xoid":"","city_id":33,"receive_mode":"manual"}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])

    data = {"env":{"dchn":"onX67WR","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":1986},"funnel_key":r"{\"from_xenv\":\"wxmp\",\"promotion_type\":1,\"xenv\":\"wxmp\"}","req_env":"wx","dsi":"","source_id":"","dchn":"onX67WR","product_type":"didi","lng":lng,"lat":lat,"lang":"zh-CN","token":token,"uid":"","phone":"","xoid":"","city_id":33,"receive_mode":"manual"}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])
    data = {"env":{"dchn":"YRBvlwe","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":12237},"funnel_key":r"{\"from_xenv\":\"wxmp\",\"promotion_type\":1,\"xenv\":\"wxmp\"}","req_env":"wx","dsi":"","source_id":"","dchn":"YRBvlwe","product_type":"didi","lng":lng,"lat":lat,"lang":"zh-CN","token":token,"uid":"","phone":"","xoid":"","city_id":33,"receive_mode":"manual"}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])
    data = {"env":{"dchn":"ZkJXzn1","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":4263},"funnel_key":r"{\"from_xenv\":\"wxmp\",\"promotion_type\":1,\"xenv\":\"wxmp\"}","req_env":"wx","dsi":"","source_id":"","dchn":"ZkJXzn1","product_type":"didi","lng":lng,"lat":lat,"lang":"zh-CN","token":token,"uid":"","phone":"","xoid":"","city_id":33,"receive_mode":"manual"}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])    
    # try:
    #     print('------------')
    #     dcdj(uid,token)
    # except Exception as e:
    #     print('小错误')
    try:
        didiyouc(uid,token)
    except Exception:
        print('小错误')
    """
    try:
        didish(uid,token)
    except Exception:
        print('小错误')
    try:
        didiqc(uid,token)
    except Exception:
        print('小错误')
    """
    try:
        yanquan(uid,token)
    except Exception:
        print('小错误')

    # try:
    #     xuesyhui(uid,token)
    # except Exception as e:
    #     print('小错误')

    print('--------福利中心签到------')
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}',
    'dchn' : 'W0dzOxO'
    }
    #print(data)
    tijiao = requests.post(url=fuli, json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"签到成功：获得 {tijiao['data']['subsidy_state']['subsidy_amount']} 福利金")
    else:
        print(tijiao['errmsg'])
        
    try:
        fuliwei(uid,token)
    except Exception:
        print('小错误')
    print('--------天天领券签到------')
    headers = {'didi-ticket': token,'content-type':'application/json'}
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'xpsid': '',
    'xpsid_root': '',
    'city_id': 4,
    'env': {'isHitButton': True,'newAppid': 35009,'userAgent': '','openId': '','model': '2201122C','wifi': 2,'timeCost': 222318}
    }
    #print(data)
    tijiao = requests.post(url=ttfuli, json=data, headers=headers).json()
    if tijiao['errmsg'] == 'success':
        print(f"获取id成功：{tijiao['data']['activity_id']},{tijiao['data']['instance_id']}")
    else:
        print(tijiao['errmsg'])
    
    #print(tijiao)
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'xpsid': '',
    'xpsid_root': '',
    'activity_id': tijiao['data']['activity_id'],
    'instance_id': tijiao['data']['instance_id'],
    'city_id': 4,
    'env': {'isHitButton': True,'newAppid': 35009,'userAgent': '','openId': '','model': '2201122C','wifi': 2}
    }
    #print(data)
    tijiao = requests.post(url=ttfuli1, json=data, headers=headers).json()
    if tijiao['errmsg'] == 'success':
        print(f"天天领券签到：{tijiao['errmsg']}")
    else:
        print(tijiao['errmsg'])
        
   #天天领券限时抢
    print('----领点券使使----')
    data = {"lang":"zh-CN","access_key_id":9,"appversion":appversion,"channel":1100000002,"_ds":"","xpsid":"","xpsid_root":"","root_xpsid":"","f_xpsid":"","xbiz":"240000","prod_key":"ut-coupon-center","dchn":"wE7poOA","xoid":"","xenv":"wxmp","xpsid_from":"","xpsid_share":"","xspm_from":"ut-aggre-homepage.none.c460.none","xpos_from":{"pk":"ut-aggre-homepage"},"args":[{"dchn":"kkXgpzO","prod_key":"ut-limited-seckill","runtime_args":{"token":token,"lat":lat,"lng":lng,"env":{"dchn":"wE7poOA","newTicket":token,"model":"2201122C","fromChannel":"2","newAppid":"35009","openId":"","openIdType":"1","sceneId":"1089","isHitButton":False,"isOpenWeb":False,"timeCost":70665,"latitude":lat,"longitude":lng,"cityId":"","fromPage":"ut-coupon-center/views/index/index","xAxes":"","yAxes":""},"content-type":"application/json","Didi-Ticket":token,"ptf":"mp","city_id":4,"platform":"mp","x_test_user":{"key":281475120025923}}},{"dchn":"gL3E8qZ","prod_key":"ut-support-coupon","runtime_args":{"token":token,"lat":lat,"lng":lng,"env":{"dchn":"wE7poOA","newTicket":token,"model":"2201122C","fromChannel":"2","newAppid":"35009","openId":"","openIdType":"1","sceneId":"1089","isHitButton":False,"isOpenWeb":False,"timeCost":70666,"latitude":lat,"longitude":lng,"cityId":"","fromPage":"ut-coupon-center/views/index/index","xAxes":"","yAxes":""},"content-type":"application/json","Didi-Ticket":token,"ptf":"mp","city_id":4,"platform":"mp","x_test_user":{"key": 281475120025923}}}]}
    tijiao = requests.post(url="https://api.didi.cn/webx/chapter/page/batch/config", json=data, headers=headers).json()
    if tijiao['errmsg'] == 'success':
        for xuju in tijiao['data']['conf'][0]['strategy_data']['data']['seckill']:
            for xu in xuju['coupons']:
                activity_id = xu['activity_id']
                group_id = xu['group_id']
                group_date = xu['group_date']
                coupon_conf_id = xu['coupon_conf_id']
                data = {"lang":"zh-CN","token":token,"access_key_id":9,"appversion":appversion,"channel":1100000002,"_ds":"","xpsid":"","xpsid_root":"","activity_id":activity_id,"group_id":group_id,"group_date":group_date,"coupon_conf_id":coupon_conf_id,"dchn":"wE7poOA","platform":"mp","city_id":4,"env":{"isHitButton":True,"newAppid":35009,"userAgent":"","openId":"","model":"2201122C","wifi":2,"timeCost":""}}
                ju = requests.post(url="https://ut.xiaojukeji.com/ut/janitor/api/action/coupon/bind", json=data, headers=headers).json()
                
                if ju['errmsg'] == 'success':
                    print(f"{xu['name']}（{xu['threshold_desc']}）：{ju['errmsg']}")
                elif ju['errmsg'] == '领券失败请重试':
                    pass
                else:
                    print(f"{xu['name']}（{xu['threshold_desc']}）：{ju['errmsg']}")
                time.sleep(1)
    print('------------------')
    
def guafen(uid,token):
    print('--------瓜瓜乐打卡--------')
    """
    #没用的
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}',
    'type': 'navigation_click',
    'data': {'navigation_type': 'divide'}
    }
    tijiao = requests.post(url=guafen3, json=data,headers=headers).json()
    """
    #获取数据
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}'
    }
    shuju = requests.post(url=guafen1, json=data).json()
    #print(shuju)
    rqi = list(shuju['data']['divide_data']['divide'])
    zs = len(rqi) - 1
    activity_id = shuju['data']['divide_data']['divide'][rqi[zs]]['activity_id']
    task_id = shuju['data']['divide_data']['divide'][rqi[zs]]['task_id']
    print(f'获取到日期数据：{rqi}\n需要的日期：{rqi[zs]}\n报名瓜分activity_id数据：{activity_id}')
    #报名瓜分
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}',
    'activity_id' : activity_id,
    'count' : 1,
    'type' : 'ut_bonus'
    }
    tijiao = requests.post(url=guafen2, json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"报名瓜分：{tijiao['errmsg']}")
    else:
        print(tijiao['errmsg'])
    #参加瓜分
    
    activity_id = shuju['data']['divide_data']['divide'][rqi[0]]['activity_id']
    task_id = shuju['data']['divide_data']['divide'][rqi[0]]['task_id']
    print(f'获取到日期数据：{rqi}\n需要的日期：{rqi[0]}\n参加瓜分activity_id数据：{activity_id}')
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}',
    'activity_id' : activity_id,
    'task_id' : task_id
    }
    tijiao = requests.post(url='https://ut.xiaojukeji.com/ut/welfare/api/action/divideReward', json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"参加瓜分：{tijiao['errmsg']}")
    else:
        print(tijiao['errmsg'])
    #print(tijiao)
    #获取数据
    data = {
    'lang' : 'zh-CN',
    'token' : token,
    'access_key_id' : 9,
    'appversion' : appversion,
    'channel' : 1100000002,
    '_ds' : '',
    'lat' : lat,
    'lng' : lng,
    'platform' : 'mp',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30012\",\"fromChannel\":\"2\",\"wxScene\":1089,\"sceneId\":1089,\"openId\":\"\"}'
    }
    shuju = requests.post(url=guafen1, json=data).json()
    #print(shuju)
    print('------')
    if '14点自动开奖' == shuju['data']['divide_data']['divide'][rqi[0]]['button']['text'] or '发奖了' == shuju['data']['divide_data']['divide'][rqi[0]]['button']['text']:
        print(f"参加今日瓜分状态：成功-{shuju['data']['divide_data']['divide'][rqi[0]]['button']['text']}")
    else:
        print("参加今日瓜分状态：失败")

    if '明天14点前访问' == shuju['data']['divide_data']['divide'][rqi[zs]]['button']['text']:
        print(f"参加今日瓜分状态：成功-{shuju['data']['divide_data']['divide'][rqi[zs]]['button']['text']}")
    else:
        print("参加明日瓜分状态：失败")
    print('------')
    
    
def chaxun(uid,token):
    print('--------福利金查询--------')
    cx = requests.get(url=f'https://rewards.xiaojukeji.com/loyalty_credit/bonus/getWelfareUsage4Wallet?token={token}&city_id=0').json()
    if '成功' == cx['errmsg']:
        print(f"账号{uid}现在有福利金：{cx['data']['worth']}（可抵扣{cx['data']['worth']/100}元）\n{cx['data']['recent_expire_time']}过期福利金：{cx['data']['recent_expire_amount']}")
    else:
        print('查询失败')

def fuliwei(uid,token):
    print('--------福利中心未领取查询------')
    data = {
    'xbiz' : 240000,
    'prod_key': 'welfare-center',
    'xpsid':'',
    'dchn' : 'QXeobao',
    'xoid':'',
    'xenv' : 'passenger',
    'xpsid_root' : '',
    'xpsid_from':'',
    'xpsid_share':'',
    'token' : token,
    'access_key_id' : 9,
    'lat' : lat,
    'lng' : lng,
    'platform' : 'na',
    'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30004\",\"fromChannel\":\"1\",\"deviceId\":\"\",\"ddfp\":\"\",\"appVersion\":\"6.7.4\",\"userAgent\":\"Mozilla/5.0 (Linux; Android 14; 2201122C Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 didi.passenger/6.7.4 FusionKit/2.0.0  OffMode/0\"}'
    }
    #print(data)
    tijiao = requests.post(url=fulijingchax, json=data).json()
    print(f"存在{len(tijiao['data']['bubble_list'])}个未领取")
    if len(tijiao['data']['bubble_list']) > 0:
        print('进行领取')
        for lin in tijiao['data']['bubble_list']:
            data = {
            'xbiz' : 240000,
            'prod_key': 'welfare-center',
            'xpsid':'',
            'dchn' : 'QXeobao',
            'xoid':'',
            'xenv' : 'passenger',
            'xpsid_root' : '',
            'xpsid_from':'',
            'xpsid_share':'',
            'token' : token,
            'lat' : lat,
            'lng' : lng,
            'platform' : 'na',
            'env' : r'{\"cityId\":\"4\",\"token\":\"\",\"longitude\":\"\",\"latitude\":\"\",\"appid\":\"30004\",\"fromChannel\":\"1\",\"deviceId\":\"\",\"ddfp\":\"\",\"appVersion\":\"6.7.4\",\"userAgent\":\"Mozilla/5.0 (Linux; Android 14; 2201122C Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 didi.passenger/6.7.4 FusionKit/2.0.0  OffMode/0\"}',
            'cycle_id' : lin['cycle_id'],
            'bubble_type' : 'yangliu_sign'}
            tijiao1 = requests.post(url=liqu, json=data).json()
            if tijiao1['errmsg'] == 'success':
                print(f"领取{tijiao1['errmsg']}")
            else:
                print('领取失败')


def didiyouc(uid,token):
    print('--------领取代驾、洗车优惠券--------')
    data = {"env":{"dchn":"YRBvlwe","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":5508},"funnel_key":r"{\"from_xenv\":\"wxmp\",\"promotion_type\":1,\"xenv\":\"wxmp\"}","req_env":"wx","dsi":"","source_id":"","dchn":"YRBvlwe","product_type":"didi","lng":lng,"lat":lat,"lang":"zh-CN","token":token,"uid":"","phone":"","xoid":"","city_id":33,"receive_mode":"manual"}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])
    print('--------------')
    data = {"env":{"dchn":"Bew6qD2","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"33","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":1452},"req_env":"wx","dsi":"","source_id":"","dchn":"Bew6qD2","product_type":"didi","lng":lng,"lat":lat,"token":token,"uid":"","phone":"","xoid":"","city_id":33}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])


def didiqc(uid,token):
    print('--------滴滴打车新城活动--------')
    data = {"xbiz":"240101","prod_key":"ut-dunion-wyc","xpsid":"","dchn":"o2vw2nM","xoid":"","xenv":"wxmp","xspm_from":"none.none.none.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","env":{"dchn":"o2vw2nM","newTicket":token,"latitude":lat,"longitude":lng,"userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":7047},"req_env":"wx","dsi":"","source_id":"","product_type":"didi","lng":lng,"lat":lat,"token":token,"uid":"","phone":""}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])

def didish(uid,token):
    print('--------领取滴滴送货优惠券--------')
    data = {"xbiz":"240101","prod_key":"ut-dunion-freight","xpsid":"","dchn":"b8Ml9nz","xoid":"","xenv":"h5","xspm_from":"","xpsid_root":"","xpsid_from":"","xpsid_share":"","env":{"dchn":"b8Ml9nz","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"4","userAgent":"","fromChannel":"8","newAppid":"30004","isHitButton":False,"isOpenWeb":True,"timeCost":9479},"req_env":"h5","dsi":"","source_id":"","product_type":"didi","lng":lng,"lat":lat,"token":token,"phone":"","uid":"","city_id":4}
    tijiao = requests.post(url=youhui, json=data).json()
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])
    print('----------------')
    data = {"xbiz":"240401","prod_key":"ut-dunion-freight","xpsid":"","dchn":"Yo7XkgO","xoid":"","xenv":"wxmp","xspm_from":"none.none.none.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","env":{"dchn":"Yo7XkgO","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"161","userAgent":"","fromChannel":"2","newAppid":"30012","openId":"","openIdType":"1","isHitButton":False,"isOpenWeb":True,"timeCost":20628},"req_env":"wx","dsi":"","source_id":"","product_type":"didi","lng":lng,"lat":lat,"token":token,"uid":"","phone":"","city_id":161}
    tijiao = requests.post(url=youhui, json=data).json()
    #print(tijiao)
    if tijiao['errmsg'] == 'success':
        for yh in tijiao['data']['rewards']:
            print(f"获取到{yh['coupon']['max_benefit_capacity']['value']}{yh['coupon']['max_benefit_capacity']['unit']} {yh['coupon']['name']} {yh['coupon']['remark']}")
    else:
        print(tijiao['errmsg'])
    


def yq(uid,token):
    headers = {'content-type':'application/json'}
    data = {"lang": "zh-CN","access_key_id": 9,"appversion": appversion,"channel": 1100000005,"_ds": "","xpsid": "","xpsid_root": "","root_xpsid": "","f_xpsid": "","xbiz": "110105","prod_key": "wyc-cpc-v-three","dchn": "kaxm7er","xoid": "","xenv": "wxmp","xpsid_share": "","xspm_from": "none.none.none.none","args": {"invoke_key": "default","key": 299073592885446,"runtime_args": {"scene": 1037,"token": token,"lat": lat,"lng": lng,"env": {"dchn": "kaxm7er","newTicket": token,"model": "2201122C","fromChannel": "2","newAppid": "35009","openId": "","openIdType": "1","sceneId": "1007","isHitButton": False,"isOpenWeb": False,"timeCost": 199,"latitude": lat,"longitude": lng,"cityId": "","fromPage": "wyc-cpc-v-three/views/index/index","xAxes": "","yAxes": ""},"dsi": "","ncc": True,"x_test_user": {"key": 299073592885446}}},"need_page_config": True,"need_share_config": True,"xpsid_from": ""}
    requests.post(url=yao, json=data, headers=headers).json()
    data = {"lang":"zh-CN","access_key_id":9,"appversion":"6.7.48","channel":1100000005,"_ds":"","xpsid":"","xpsid_root":"","root_xpsid":"","f_xpsid":"","xbiz":"110105","prod_key":"wyc-student-cpc","dchn":"B818Zj2","xoid":"","xenv":"wxmp","xpsid_share":"","xspm_from":"none.none.none.none","args":{"invoke_key":"default","key":299073592885446,"runtime_args":{"xak":"wyc-student-cpc-pUUCvFx9Rf47","scene":1042,"prod_key":"wyc-student-cpc","token":token,"lat":lat,"lng":lng,"env":{"openId":"","newTicket":token,"latitude":lat,"longitude":lng,"cityId":"","fromPage":"wyc-student-cpc/views/index/index","isHitButton":False,"xAxes":"","yAxes":"","timeCost":34},"dsi":"","ncc":True,"xenv":"wxmp","x_test_user":{"key":299073592885446}}},"need_page_config":True,"need_share_config":True,"xpsid_from":""}
    requests.post(url='https://api.didi.cn/webx/chapter/product/init', json=data, headers=headers).json()


#养券大师
def yanquan(uid,token):
    print('--------养券大师--------')
    data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","platform":1,"token":token}
    tijiao = requests.post(url=yanquan1, json=data).json()
    print(tijiao['errmsg'])
    data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","platform":1,"token":token}
    tijiao = requests.post(url=yanquan2, json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"{tijiao['data']['rewards'][0]}")
    else:
        print(tijiao['errmsg'])
    tijiao = requests.get(url=f'{yanquan3}{token}').json()
    if tijiao['errmsg'] == 'success':
        for rw in tijiao['data']['missions']:
            data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","mission_id":rw['id'],"game_id":30,"platform":1,"token":token}
            requests.post(url=yanquan4, json=data).json()
            requests.post(url=yanquan5, json=data).json()
    else:
        print(tijiao['errmsg'])
    try:
        yanquancj(uid,token)
    except Exception:
        print('--------抽奖结束--------')
    data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","platform":1,"token":token}
    tijiao = requests.post(url=yanquan7, json=data).json()
    print(f"升级：{tijiao['errmsg']}")
    data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","token":token,"platform":1}
    tijiao = requests.post(url=yanquan8, json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"金币：{tijiao['data']['coin']}")
        print(f"优惠券：满{tijiao['data']['coupon']['available']/100}抵扣{tijiao['data']['coupon']['amount']/100}元")
    else:
        print(tijiao['errmsg'])

#养券大师
def yanquancj(uid,token):
    print('--------养券大师抽奖--------')
    data = {"xbiz":"240301","prod_key":"ut-coupon-master","xpsid":"","dchn":"BnGadK5","xoid":"","xenv":"wxmp","xspm_from":"welfare-center.none.c1324.none","xpsid_root":"","xpsid_from":"","xpsid_share":"","platform":1,"token":token}
    tijiao = requests.post(url=yanquan6, json=data).json()
    if tijiao['errmsg'] == 'success':
        print(f"存在抽奖次数：{tijiao['data']['power']}")
        for x in range(tijiao['data']['power']):
            xx = x + 1
            print(f"正在执行第{xx}次抽奖")
            time.sleep(3)
            requests.post(url=yanquan6, json=data).json()
    print('--------抽奖结束--------')

def xuesyhui(uid,token):
    print('--------这周学生优惠--------')
    data = {"lang":"zh-CN","token":token,"access_key_id":"9","appversion":appversion,"channel":"1100000002","_ds":"","xpsid":"","xpsid_root":"","lat":lat,"lng":lng,"city_id":"4","platform":"wxmp"}
    tijiao = requests.post(url=xuesyhui1, data=data).json()
    if tijiao['errmsg'] == 'ok':
        data = {'lang':'zh-CN','token':token,'access_key_id':9,'appversion':appversion,'channel':'1100000002','_ds':'','xpsid':'','xpsid_root':'','params':[{'group_id':tijiao['data']['week_award_data']['details'][0]['group_id'],'env':r'{\"dchn\":\"kjneo3J\",\"newTicket\":\"\",\"model\":\"2201122C\",\"fromChannel\":\"2\",\"newAppid\":\"35009\",\"openId\":\"\",\"openIdType\":\"\",\"sceneId\":\"1089\",\"isHitButton\":false,\"isOpenWeb\":false,\"timeCost\":1,\"latitude\":\"\",\"longitude\":\"\"}','prod_key':tijiao['data']['week_award_data']['base_info']['prod_key'],'xak':tijiao['data']['week_award_data']['base_info']['xak'],'xid':tijiao['data']['week_award_data']['base_info']['xid']}],'city_id':4,'lat':lat,'lng':lng,'platform':'wxmp'}
        tijiao1 = requests.post(url=xuesyhui2, json=data).json()
        if tijiao1['errmsg'] == 'ok':
            if tijiao1['data']['reward_data'][0]['code_msg'] == 'ok':
                for oo in tijiao1['data']['reward_data'][0]['base_info']['details'][0]['rewards']:
                    print(f"{oo[0]['info'][0]['reward_name']}-{oo[0]['info'][0]['coupon_name']}-{oo[0]['info'][0]['status']}-{oo[0]['info'][0]['expire_time_desc']}")
            else:
                print(tijiao1['data']['reward_data'][0]['code_msg'])

#判断福利金是否开启低于500抵扣
def bdfulijing(uid,token):
    url = f"https://pay.diditaxi.com.cn/phoenix_asset/common/app/query/auto/deduct?token={token}&asset_type=14"
    tijiao = requests.get(url=url).json()
    if tijiao['errmsg'] == '成功':
        if tijiao['data']['status'] == 1:
            print("福利金抵扣： 已开启")
        else:
            url = f"https://pay.diditaxi.com.cn/phoenix_asset/common/app/set/up/auto/deduct?token={token}&status=1&asset_type=14"
            requests.get(url=url).json()
            print("福利金抵扣： 已开启")


class Script:
    def __init__(self, account):
        require_fields(account, "uid", "token")
        self.account = account
        self.username = account.get("username") or account.get("uid", "")
        self.uid = account["uid"]
        self.token = account["token"]

    def run(self):
        print("==================================")
        print(f"\n账号 [{self.username}]")
        time.sleep(6)
        run_for_account(self.uid, self.token)
        print("============📣结束📣============")
        print("==================================")
        return True


def main() -> int:
    summary = run_account_scripts(__file__, Script, notify_module=notify)
    return summary.exit_code


if __name__ == '__main__':
    raise SystemExit(main())
