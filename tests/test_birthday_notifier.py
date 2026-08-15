from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

QINGLONG_DIR = Path(__file__).resolve().parents[1] / "qinglong"
if str(QINGLONG_DIR) not in sys.path:
    sys.path.insert(0, str(QINGLONG_DIR))

import birthday_notifier


class BirthdayNotificationTests(unittest.TestCase):
    @mock.patch.object(birthday_notifier.notify, "send", return_value=True)
    def test_confirmed_delivery_succeeds(self, send):
        birthday_notifier.send_notification("title", "body")

        send.assert_called_once_with("title", "body")

    @mock.patch.object(birthday_notifier.notify, "send", return_value=False)
    def test_failed_delivery_fails_the_task(self, send):
        with self.assertRaisesRegex(RuntimeError, "通知发送失败"):
            birthday_notifier.send_notification("title", "body")

        send.assert_called_once_with("title", "body")


if __name__ == "__main__":
    unittest.main()
