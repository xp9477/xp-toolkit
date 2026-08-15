"""
name: 生日提醒
description: 生日与生日预告通知

env:
- `birthday_notifier`: 每行一个 JSON 对象，字段 `name`, `notify_type`, `month`, `day`, `year`
"""

from datetime import datetime, time

import notify
from common import load_accounts, run_single_script
from lunardate import LunarDate

DEFAULT_TARGET_INTERVALS = [0, 1, 3, 5]


def send_notification(title, message):
    if notify.send(title, message) is not True:
        raise RuntimeError("生日通知发送失败")


def load_birthdays():
    birthdays = load_accounts(__file__)
    return birthdays, DEFAULT_TARGET_INTERVALS


def check_birthdays():
    birthdays, target_intervals = load_birthdays()
    today = datetime.now()

    print(f"--- 生日提醒检查 ({today.strftime('%Y-%m-%d %H:%M')}) ---")

    for person in birthdays:
        name = person.get("name")
        n_type = person.get("notify_type", "solar")
        m, d, y = person["month"], person["day"], person.get("year")

        potential_dates = []
        display_month, display_day = m, d
        if n_type == "lunar":
            if y:
                birth_lunar = LunarDate.from_solar_date(y, m, d)
                display_month, display_day = birth_lunar.month, birth_lunar.day
                for check_year in [today.year - 1, today.year, today.year + 1]:
                    try:
                        solar_date = LunarDate(
                            check_year, display_month, display_day
                        ).to_solar_date()
                        potential_dates.append(datetime.combine(solar_date, time.min))
                    except ValueError:
                        continue
            else:
                continue
        else:
            for check_year in [today.year, today.year + 1]:
                potential_dates.append(datetime(check_year, m, d))

        diffs = []
        for b_date in potential_dates:
            delta = (b_date.date() - today.date()).days
            if delta >= 0:
                diffs.append((delta, b_date))

        if not diffs:
            continue

        diff, b_date = min(diffs, key=lambda x: x[0])

        type_str = "农历" if n_type == "lunar" else "阳历"
        print(f"[{name}] ({type_str}): 还有 {diff} 天")

        if diff in target_intervals:
            age_str = f" ({b_date.year - y}岁)" if y else ""
            type_label = "·农历" if n_type == "lunar" else ""

            if diff == 0:
                title = f"🎂 {name} 生日快乐！"
                message = (
                    f"今天（{display_month}月{display_day}日{type_label}）"
                    f"是 {name}{age_str} 的生日！"
                )
            else:
                title = f"🎁 生日预告：{diff}天后"
                message = (
                    f"{name}{age_str} 的生日快到啦！"
                    f"日期：{display_month}月{display_day}日{type_label}"
                )

            send_notification(title, message)
            print(f"  >>> 已发送推送通知 ({diff}天后)")


if __name__ == "__main__":
    raise SystemExit(
        run_single_script(__file__, check_birthdays, notify_module=notify).exit_code
    )
