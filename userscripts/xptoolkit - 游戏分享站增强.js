// ==UserScript==
// @name         xptoolkit - 游戏分享站增强
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      1.0
// @description  游戏详情页快速 Steam 搜索, 下载页面自动填写密码，当前支持gamer520、咸鱼单机
// @author       xp9477
// @match        https://www.gamer520.com/*.html
// @match        https://www.xianyudanji.net/*.html
// @match        https://like.gamer520.com/*.html
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gamer520.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Steam 搜索功能 - gamer520
    if (window.location.hostname === 'www.gamer520.com') {
        // 获取<title>标签中的内容
        let fullTitle = document.title;
        // 提取第一个|前面的文本
        let gameTitle = fullTitle.split('|')[0].trim();

        // 创建按钮元素
        let button = document.createElement('button');
        button.innerHTML = 'Steam'; // 文本
        button.style.position = 'fixed'; // 位置固定
        button.style.bottom = '20px';
        button.style.left = '20px';
        button.style.padding = '10px 20px'; // 内边距
        button.style.backgroundColor = '#0078d7'; // 蓝色背景
        button.style.color = 'white'; // 白色文字
        button.style.border = 'none'; // 无边框
        button.style.borderRadius = '5px'; // 圆角
        button.style.cursor = 'pointer'; // 鼠标指针变"手指"
        button.style.zIndex = '9999'; // 处于页面顶层，避免遮挡

        // 按钮点击事件，跳转到Steam搜索页面
        button.onclick = function () {
            window.open('https://store.steampowered.com/search/?term=' + encodeURIComponent(gameTitle));
        };

        // 将按钮添加到页面上
        document.body.appendChild(button);
    }

    // Steam 搜索功能 - 咸鱼单机
    if (window.location.hostname === 'www.xianyudanji.net') {
        // 获取<title>标签中的内容
        let fullTitle = document.title;
        // 提取第一个|前面的文本
        let gameTitle = fullTitle.split('|')[0].trim().replace('下载', '');

        // 创建按钮元素
        let button = document.createElement('button');
        button.innerHTML = 'Steam'; // 文本
        button.style.position = 'fixed'; // 位置固定
        button.style.bottom = '20px';
        button.style.left = '20px';
        button.style.padding = '10px 20px'; // 内边距
        button.style.backgroundColor = '#0078d7'; // 蓝色背景
        button.style.color = 'white'; // 白色文字
        button.style.border = 'none'; // 无边框
        button.style.borderRadius = '5px'; // 圆角
        button.style.cursor = 'pointer'; // 鼠标指针变"手指"
        button.style.zIndex = '9999'; // 处于页面顶层，避免遮挡

        // 按钮点击事件，跳转到Steam搜索页面
        button.onclick = function () {
            window.open('https://store.steampowered.com/search/?term=' + encodeURIComponent(gameTitle));
        };

        // 将按钮添加到页面上
        document.body.appendChild(button);
    }

    // 自动填写密码功能
    if (window.location.hostname === 'like.gamer520.com') {
        document.addEventListener('DOMContentLoaded', () => {
            const titleElement = document.querySelector('.entry-title');
            let password = '';

            if (titleElement) {
                const match = titleElement.textContent.match(/密码保护：(\d+)/);
                if (match && match[1]) {
                    password = match[1];
                }
            }

            const passwordInput = document.querySelector('input[name="post_password"]');
            const submitButton = document.querySelector('input[type="submit"]');

            if (passwordInput && password) {
                passwordInput.value = password;
                if (submitButton) {
                    submitButton.click();
                }
            }
        });
    }
})();