// ==UserScript==
// @name         xptoolkit - Anna's Archive 净化
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  彻底清理Anna's Archive界面，移除所有非必要元素
// @author       xp9477
// @match        *://*.annas-archive.org/*
// @match        *://annas-archive.org/*
// @match        *://*.annas-archive.*/*
// @match        *://annas-archive.*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=annas-archive.org
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // === 1. 立即注入CSS样式（防止元素闪烁） ===
    const style = document.createElement('style');
    style.textContent = `
        /* 隐藏所有目标元素 */
        .js-fundraiser-banner,
        .js-top-banner,
        a[href="/donate"],
        h3:has(+ .js-fast-download-no-member-header),
        .js-fast-download-no-member-header,
        .mb-1\\.5 > div,
        .js-recent-downloads-container,
        a[href="#md5-tab-discussion"],
        footer.bg-black\\/5,
        .js-show-external-button,
        p:has(a[href="/faq#slow"]),
        li:has(a[href="/view"]),
        li:has(a[href*=".onion"]) {
            display: none !important;
        }

        /* 显示外部下载链接 */
        .js-show-external {
            display: block !important;
        }

        /* 布局优化 */
        main {
            margin-bottom: 0 !important;
        }

        /* 移除空行 */
        div:empty, p:empty, li:empty {
            display: none !important;
        }

        /* 保留下载建议区块但隐藏不需要的条目 */
        .mb-4.pt-4.border-dashed li:not(:has(a[href="https://www.amazon.com/sendtokindle"])) {
            display: none !important;
        }
        .mb-4.pt-4.border-dashed {
            border: none !important;
            padding-top: 0 !important;
            margin-bottom: 0 !important;
        }
    `;
    document.head.appendChild(style);

    // === 2. 等待DOM加载完成后执行DOM操作 ===
    const executeWhenReady = () => {
        // 1. 移除横幅和捐赠按钮
        document.querySelectorAll(`
            .js-fundraiser-banner,
            .js-top-banner,
            a[href="/donate"],
            p:has(a[href="/faq#slow"]),
            li:has(a[href="/view"]),
            li:has(a[href*=".onion"])
        `).forEach(el => el.remove());

        // 2. 移除快速下载区块
        const fastDownloadSection = document.querySelector('h3:has(+ .js-fast-download-no-member-header)')?.parentElement;
        if (fastDownloadSection) fastDownloadSection.remove();

        // 3. 移除宣传标语
        document.querySelectorAll('.mb-1\\.5 > div').forEach(el => el.remove());

        // 4. 移除"近期下载"区块
        document.querySelector('.js-recent-downloads-container')?.remove();

        // 5. 移除"反馈文件质量"链接
        document.querySelector('a[href="#md5-tab-discussion"]')?.parentElement?.remove();

        // 6. 处理下载建议区块 - 只保留"发送到Kindle"条目
        const downloadTips = document.querySelector('.mb-4.pt-4.border-dashed');
        if (downloadTips) {
            const listItems = downloadTips.querySelectorAll('li');
            listItems.forEach(li => {
                if (!li.querySelector('a[href="https://www.amazon.com/sendtokindle"]')) {
                    li.remove();
                }
            });
        }

        // 7. 移除整个页脚
        document.querySelector('footer.bg-black\\/5')?.remove();

        // 8. 自动处理外部下载链接
        const handleExternalDownloads = () => {
            document.querySelectorAll('.js-show-external-button').forEach(el => el.remove());
            document.querySelectorAll('.js-show-external').forEach(el => el.classList.remove('hidden'));
        };
        handleExternalDownloads();

        // 设置cookie防止横幅再次显示
        document.cookie = 'fundraiser_banner_hidden=2;path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT';
        document.cookie = 'top_banner_hidden=19;path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT';

        // 持续观察DOM变化（处理动态加载的内容）
        new MutationObserver(handleExternalDownloads).observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    // 根据页面状态决定执行时机
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', executeWhenReady);
    } else {
        executeWhenReady();
    }
})();