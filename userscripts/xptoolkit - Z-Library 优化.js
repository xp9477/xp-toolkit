// ==UserScript==
// @name         xptoolkit - Z-Library 优化
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      1.0
// @description  隐藏 Z-Library 页面中不必要的内容，添加 Anna's Archive 搜索按钮，以及完美的 Send to Kindle 按钮
// @author       xp9477
// @match        /^https:\/\/(.*\.)?(zlib|z-lib|zlibrary|z-library)\.\w+\/.*/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=z-library.sk
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 通用隐藏函数
    function hideElement(selector) {
        document.querySelectorAll(selector).forEach(el => {
            el.style.display = 'none';
        });
    }

    function removeUnwantedElements() {
        if (location.href.includes('/book/')) {
            hideElement('div.book-details-button.read-online');

            document.querySelectorAll('div.book-details-button').forEach(el => {
                if (el.innerText.includes('添加到我的图书馆') || el.innerText.includes('Add to My Library')) {
                    el.style.display = 'none';
                }
            });

            hideElement('z-dropdown');
            hideElement('.details-buttons-container__divider');
            hideElement('div.navigation-element.donate-element');
            hideElement('div.book-paperback');
            hideElement('div.bookmarks');
            hideElement('z-social-sharing.social-share');
            hideElement('.books-mosaic');
            hideElement('h2.color1');
            hideElement('div.termsCloud');
            hideElement('div[style*="height:2px"][style*="background: var(--primary-color)"]');
            hideElement('.related-booklists-lazy');
            hideElement('#footer');
            hideElement('div.books-tags-wrap');

            // 动态加载时尝试添加 Kindle 按钮
            addKindleButton();
        }
    }

    // ✅ 新增：添加符合原生样式的 Kindle 按钮
    function addKindleButton() {
        if (document.getElementById('custom-kindle-wrapper')) return;

        const downloadLink = document.querySelector('a.addDownloadedBook');
        const container = document.querySelector('.book-actions-buttons') || document.querySelector('.details-buttons-container');

        if (downloadLink && container) {
            // 1. 创建最外层包裹 (匹配原生结构)
            const wrapper = document.createElement('div');
            wrapper.className = 'book-details-button';
            wrapper.id = 'custom-kindle-wrapper';

            // 2. 创建 btn-group
            const btnGroup = document.createElement('div');
            btnGroup.className = 'btn-group';

            // 3. 创建实际按钮 (使用原生 btn-default 样式)
            const kindleBtn = document.createElement('a');
            kindleBtn.className = 'btn btn-default';
            kindleBtn.href = 'javascript:void(0);';

            // 使用 Z-lib 原生的亚马逊图标
            kindleBtn.innerHTML = '<i class="zlibicon-Amazon" style="font-size: 14px; margin-right: 6px;"></i>Send to Kindle';

            // 点击事件
            kindleBtn.onclick = function (e) {
                e.preventDefault();
                downloadLink.click();
                setTimeout(() => {
                    const win = window.open('https://www.amazon.com/sendtokindle', '_blank');
                    if (win) {
                        win.focus();
                    } else {
                        alert('请允许浏览器弹出窗口以打开 Amazon 页面');
                    }
                }, 500);
            };

            // 组装 DOM
            btnGroup.appendChild(kindleBtn);
            wrapper.appendChild(btnGroup);

            // 4. 将按钮插入到“下载”按钮的后面
            const dlWrapper = downloadLink.closest('.book-details-button');
            if (dlWrapper && dlWrapper.nextSibling) {
                dlWrapper.parentNode.insertBefore(wrapper, dlWrapper.nextSibling);
            } else {
                container.appendChild(wrapper);
            }
        }
    }

    // 原功能：在搜索页面添加“Anna”按钮
    function addAnnaButton() {
        const input = document.querySelector('#searchFieldx');
        const searchForm = document.querySelector('.b-search-form');

        if (!input || !searchForm || document.querySelector('#annaButton')) return;

        const annaBtn = document.createElement('button');
        annaBtn.id = 'annaButton';
        annaBtn.textContent = "Search in Anna's Archive";
        annaBtn.style.backgroundColor = '#4CAF50';
        annaBtn.style.color = '#fff';
        annaBtn.style.border = 'none';
        annaBtn.style.borderRadius = '4px';
        annaBtn.style.padding = '8px 16px';
        annaBtn.style.cursor = 'pointer';
        annaBtn.style.fontSize = '14px';
        annaBtn.style.marginBottom = '10px';
        annaBtn.onclick = (e) => {
            e.preventDefault();
            const keyword = input.value.trim();
            if (keyword) {
                window.open(`https://zh.annas-archive.org/search?q=${encodeURIComponent(keyword)}`, '_blank');
            } else {
                alert('请输入关键词');
            }
        };

        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '10px';
        wrapper.appendChild(annaBtn);
        searchForm.parentNode.insertBefore(wrapper, searchForm.nextSibling);
    }

    removeUnwantedElements();
    if (location.href.includes('/s/')) {
        addAnnaButton();
    }

    const observer = new MutationObserver(() => {
        removeUnwantedElements();
        if (location.href.includes('/s/')) {
            addAnnaButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();