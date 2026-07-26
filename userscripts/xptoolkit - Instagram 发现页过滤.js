// ==UserScript==
// @name         xptoolkit - Instagram 发现页过滤
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Instagram 发现页过滤
// @author       xp9477
// @match        https://www.instagram.com/explore/
// @match        https://instagram.com/explore/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nstagram.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .ig-filter-container {
            position: fixed;
            top: 70px;
            right: 20px;
            z-index: 9999;
            background: white;
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .ig-filter-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            background: #f0f0f0;
            cursor: pointer;
        }
        .ig-filter-btn.active {
            background: #0095f6;
            color: white;
        }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.className = 'ig-filter-container';
    const btnLabels = ['不过滤', '只看图片', '只看视频'];
    const filters = ['none', 'image', 'video'];
    const buttons = [];

    let currentFilter = 'none';

    btnLabels.forEach((label, i) => {
        const btn = document.createElement('button');
        btn.className = 'ig-filter-btn';
        btn.textContent = label;
        btn.onclick = () => setFilter(filters[i]);
        container.appendChild(btn);
        buttons.push(btn);
    });
    document.body.appendChild(container);

    function setFilter(filter) {
        currentFilter = filter;
        buttons.forEach(btn => btn.classList.remove('active'));
        buttons[filters.indexOf(filter)].classList.add('active');
        applyFilter();
    }

    function applyFilter() {
        const links = document.querySelectorAll('a[href^="/p/"]');

        links.forEach(link => {
            const card = findPostContainer(link);
            if (!card) return;

            const isVideo = link.querySelector('svg[aria-label="播放"], svg[aria-label="Reels"]');
            const hasImage = link.querySelector('img');

            let shouldHide = false;
            if (currentFilter === 'image') {
                shouldHide = (!hasImage || isVideo);
            } else if (currentFilter === 'video') {
                shouldHide = !isVideo;
            }

            if (shouldHide) {
                card.style.display = 'none';
                card.setAttribute('data-ig-hidden', 'true');
            } else {
                card.style.display = '';
                card.removeAttribute('data-ig-hidden');
            }
        });
    }


    function findPostContainer(el) {
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
            if (node.tagName === 'DIV' && node.querySelector('a[href^="/p/"]') === el) return node;
            node = node.parentElement;
        }
        return null;
    }

    const observer = new MutationObserver(() => setTimeout(applyFilter, 300));
    observer.observe(document.body, { childList: true, subtree: true });

    setFilter('none');
})();
