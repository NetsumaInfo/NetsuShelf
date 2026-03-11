"use strict";

/** Keep track of how to user tells us to parse different sites */
class DefaultParserSiteSettings {
    constructor() {
        this.loadSiteConfigs();
    }

    /** @private */
    loadSiteConfigs() {
        let config = window.localStorage.getItem(DefaultParserSiteSettings.storageName);
        this.configs = new Map();
        if (config != null) {
            for (let e of JSON.parse(config)) {
                let selectors = e[1];
                if (DefaultParserSiteSettings.isConfigValid(selectors)) {
                    this.configs.set(e[0], selectors);
                }
            }
        }
    }

    static isConfigValid(selectors) {
        return (selectors.contentCss !== undefined)
            && !util.isNullOrEmpty(selectors.contentCss);
    }

    saveSiteConfig(hostname, contentCss, titleCss, removeCss, testUrl) {
        if (this.isConfigChanged(hostname, contentCss, titleCss, removeCss, testUrl)) {
            this.configs.set(
                hostname, { 
                    contentCss: contentCss, 
                    titleCss: titleCss, 
                    removeCss: removeCss,
                    testUrl: testUrl 
                }
            );
            let serialized = JSON.stringify(Array.from(this.configs.entries()));
            window.localStorage.setItem(DefaultParserSiteSettings.storageName, serialized);
        }
    }

    /** @private */
    isConfigChanged(hostname, contentCss, titleCss, removeCss, testUrl) {
        let config = this.configs.get(hostname);
        return (config === undefined) || 
            (contentCss !== config.contentCss) ||
            (titleCss !== config.titleCss) || 
            (removeCss !== config.removeCss) ||
            (testUrl !== config.testUrl);
    }

    getConfigForSite(hostname) {
        return this.configs.get(hostname);
    }

    constructFindContentLogicForSite(hostname) {
        let logic = {
            findContent: dom => dom.querySelector("body"),
            findChapterTitle: () => null,
            removeUnwanted: () => null
        };
        let config = this.getConfigForSite(hostname);
        if (config != null) {
            logic.findContent = dom => dom.querySelector(config.contentCss);
            if (!util.isNullOrEmpty(config.titleCss))
            {
                logic.findChapterTitle = dom => dom.querySelector(config.titleCss);
            }
            if (!util.isNullOrEmpty(config.removeCss))
            {
                logic.removeUnwanted = (element) => {
                    for (let e of element.querySelectorAll(config.removeCss)) {
                        e.remove();
                    }
                };
            }
        }
        return logic;
    }
}
DefaultParserSiteSettings.storageName = "DefaultParserConfigs";

/** Class that handles UI for configuring the Default Parser */
class DefaultParserUI { // eslint-disable-line no-unused-vars
    constructor() {
    }

    static setupDefaultParserUI(hostname, parser, sourceDom) {
        DefaultParserUI.copyInstructions();
        DefaultParserUI.setDefaultParserUiVisibility(true);
        DefaultParserUI.populateDefaultParserUI(hostname, parser);
        document.getElementById("autoDetectDefaultParserButton").onclick =
            () => DefaultParserUI.onAutoDetectClicked(parser, sourceDom, false);
        document.getElementById("testDefaultParserButton").onclick = DefaultParserUI.testDefaultParser.bind(null, parser);
        document.getElementById("finisheddefaultParserButton").onclick = DefaultParserUI.onFinishedClicked.bind(null, parser);
        DefaultParserUI.autoDetectIfNeeded(parser, sourceDom);
    }

    static onFinishedClicked(parser) {
        DefaultParserUI.AddConfiguration(parser);
        DefaultParserUI.setDefaultParserUiVisibility(false);
    }

    static AddConfiguration(parser) {
        let hostname = DefaultParserUI.getDefaultParserHostnameInput().value;
        let contentCss = DefaultParserUI.getContentCssInput().value;
        let titleCss = DefaultParserUI.getChapterTitleCssInput().value;
        let removeCss = DefaultParserUI.getUnwantedElementsCssInput().value.trim();
        let testUrl = DefaultParserUI.getTestChapterUrlInput().value.trim();

        parser.siteConfigs.saveSiteConfig(hostname, contentCss, titleCss, removeCss, testUrl);
    }

    static populateDefaultParserUI(hostname, parser) {
        DefaultParserUI.getDefaultParserHostnameInput().value = hostname;

        DefaultParserUI.getContentCssInput().value = "body";
        DefaultParserUI.getChapterTitleCssInput().value = "";
        DefaultParserUI.getUnwantedElementsCssInput().value = "";
        DefaultParserUI.getTestChapterUrlInput().value = "";

        let config = parser.siteConfigs.getConfigForSite(hostname);
        if (config != null) {
            DefaultParserUI.getContentCssInput().value = config.contentCss;
            DefaultParserUI.getChapterTitleCssInput().value = config.titleCss;
            DefaultParserUI.getUnwantedElementsCssInput().value = config.removeCss;
            DefaultParserUI.getTestChapterUrlInput().value = config.testUrl;
        }
    }

    static autoDetectIfNeeded(parser, sourceDom) {
        let hostname = DefaultParserUI.getDefaultParserHostnameInput().value;
        let config = parser.siteConfigs.getConfigForSite(hostname);
        if ((config == null)
            || util.isNullOrEmpty(config.contentCss)
            || (config.contentCss === "body")) {
            DefaultParserUI.onAutoDetectClicked(parser, sourceDom, true);
        }
    }

    static async onAutoDetectClicked(parser, sourceDom, fromSetup) {
        let autoButton = document.getElementById("autoDetectDefaultParserButton");
        let originalText = autoButton.textContent;
        autoButton.disabled = true;
        autoButton.textContent = "Detecting...";
        try {
            let testUrl = DefaultParserUI.ensureTestUrl(parser, sourceDom);
            if (util.isNullOrEmpty(testUrl)) {
                if (!fromSetup) {
                    alert(UIText.Warning.warningNoChapterUrl);
                }
                return;
            }
            let xhr = await HttpClient.wrapFetch(testUrl);
            let dom = util.sanitize(xhr.responseXML.querySelector("*"));
            let detected = DefaultParserUI.detectSelectors(dom);
            DefaultParserUI.getContentCssInput().value = detected.contentCss;
            DefaultParserUI.getChapterTitleCssInput().value = detected.titleCss;
            DefaultParserUI.getUnwantedElementsCssInput().value = detected.removeCss;
            DefaultParserUI.getTestChapterUrlInput().value = testUrl;
            DefaultParserUI.AddConfiguration(parser);
            await DefaultParserUI.testDefaultParser(parser);
        } catch (err) {
            if (!fromSetup) {
                ErrorLog.showErrorMessage(err);
            }
        } finally {
            autoButton.textContent = originalText;
            autoButton.disabled = false;
        }
    }

    static ensureTestUrl(parser, sourceDom) {
        let input = DefaultParserUI.getTestChapterUrlInput();
        let testUrl = input.value.trim();
        if (!util.isNullOrEmpty(testUrl)) {
            return testUrl;
        }

        let firstChapter = parser.getPagesToFetch().values().next();
        if (!firstChapter.done && !util.isNullOrEmpty(firstChapter.value.sourceUrl)) {
            testUrl = firstChapter.value.sourceUrl;
        } else if ((sourceDom != null) && !util.isNullOrEmpty(sourceDom.baseURI)) {
            testUrl = sourceDom.baseURI;
        } else if (!util.isNullOrEmpty(parser.state.chapterListUrl)) {
            testUrl = parser.state.chapterListUrl;
        }

        input.value = testUrl;
        return testUrl;
    }

    static detectSelectors(dom) {
        let contentElement = DefaultParserUI.findBestContentElement(dom);
        let titleElement = DefaultParserUI.findBestTitleElement(dom, contentElement);
        let removeCss = DefaultParserUI.detectRemoveCss(contentElement);

        return {
            contentCss: DefaultParserUI.uniqueSelector(dom, contentElement),
            titleCss: (titleElement === null) ? "" : DefaultParserUI.uniqueSelector(dom, titleElement),
            removeCss: removeCss
        };
    }

    static findBestContentElement(dom) {
        let preferredSelectors = [
            "article",
            "main article",
            "main",
            "[itemprop='articleBody']",
            ".entry-content",
            ".post-content",
            ".chapter-content",
            ".chapter",
            ".content",
            "#content",
            "#chapter",
            "#chapter-content"
        ];
        let candidates = [];
        for (let selector of preferredSelectors) {
            for (let element of dom.querySelectorAll(selector)) {
                candidates.push(element);
            }
        }
        for (let element of [...dom.body.querySelectorAll("article, main, section, div")].slice(0, 3000)) {
            candidates.push(element);
        }

        let seen = new Set();
        let uniqueCandidates = [];
        for (let element of candidates) {
            if (!seen.has(element)) {
                seen.add(element);
                uniqueCandidates.push(element);
            }
        }

        let bestElement = dom.body;
        let bestScore = -Infinity;
        for (let element of uniqueCandidates) {
            let score = DefaultParserUI.scoreContentCandidate(element);
            if (score > bestScore) {
                bestElement = element;
                bestScore = score;
            }
        }
        return bestElement;
    }

    static scoreContentCandidate(element) {
        let text = (element.textContent || "").replace(/\s+/g, " ").trim();
        let textLength = text.length;
        if (textLength < 200) {
            return -100000;
        }
        let linkTextLength = [...element.querySelectorAll("a")]
            .map(a => (a.textContent || "").trim().length)
            .reduce((acc, value) => acc + value, 0);
        let paragraphCount = element.querySelectorAll("p").length;
        let headingCount = element.querySelectorAll("h1, h2, h3").length;
        let noisyChildren = element.querySelectorAll(
            "nav, aside, footer, form, .comments, #comments, .share, .social, .ads, .advert, .related"
        ).length;
        let linkDensity = linkTextLength / Math.max(textLength, 1);
        let score = textLength
            + (paragraphCount * 90)
            + (headingCount * 45)
            - (linkDensity * 850)
            - (noisyChildren * 100);

        if (DefaultParserUI.hasNoisyClassOrId(element)) {
            score -= 400;
        }
        if (element.tagName.toLowerCase() === "body") {
            score -= 250;
        }
        return score;
    }

    static hasNoisyClassOrId(element) {
        let text = ((element.className || "") + " " + (element.id || "")).toLowerCase();
        return /(header|footer|nav|menu|sidebar|comment|share|social|advert|ads|related|popup|cookie)/.test(text);
    }

    static findBestTitleElement(dom, contentElement) {
        if (contentElement == null) {
            return null;
        }

        let selectors = [
            "h1",
            "h2",
            ".chapter-title",
            ".entry-title",
            ".post-title",
            ".title"
        ];

        for (let selector of selectors) {
            let found = contentElement.querySelector(selector);
            if (DefaultParserUI.isValidTitleElement(found)) {
                return found;
            }
        }
        for (let selector of selectors) {
            let found = dom.querySelector(selector);
            if (DefaultParserUI.isValidTitleElement(found)) {
                return found;
            }
        }
        return null;
    }

    static isValidTitleElement(element) {
        if (element == null) {
            return false;
        }
        let textLength = (element.textContent || "").trim().length;
        return (4 <= textLength) && (textLength <= 180);
    }

    static detectRemoveCss(contentElement) {
        let defaults = ["script[src]", "iframe", "noscript"];
        if (contentElement == null) {
            return defaults.join(", ");
        }

        let optional = [
            "header",
            "footer",
            "nav",
            "aside",
            ".comments",
            "#comments",
            ".share",
            ".social",
            ".ads",
            ".advert",
            ".related",
            ".post-navigation",
            ".pagination"
        ];
        let selectors = [...defaults];
        optional.forEach((selector) => {
            if (contentElement.querySelector(selector) != null) {
                selectors.push(selector);
            }
        });
        return [...new Set(selectors)].join(", ");
    }

    static uniqueSelector(dom, element) {
        if ((element == null) || (element.nodeType !== 1)) {
            return "body";
        }

        if (!util.isNullOrEmpty(element.id)) {
            let byId = "#" + DefaultParserUI.escapeCss(element.id);
            if (DefaultParserUI.selectorIsUnique(dom, byId)) {
                return byId;
            }
        }

        let tag = element.tagName.toLowerCase();
        let classes = [...element.classList]
            .filter(DefaultParserUI.isUsefulClassName)
            .slice(0, 2)
            .map(DefaultParserUI.escapeCss);
        if (0 < classes.length) {
            let byClass = tag + "." + classes.join(".");
            if (DefaultParserUI.selectorIsUnique(dom, byClass)) {
                return byClass;
            }
        }

        let parts = [];
        let node = element;
        while ((node != null) && (node.nodeType === 1) && (node.tagName.toLowerCase() !== "html")) {
            let part = node.tagName.toLowerCase();
            if (!util.isNullOrEmpty(node.id)) {
                part += "#" + DefaultParserUI.escapeCss(node.id);
                parts.unshift(part);
                break;
            }
            let usefulClass = [...node.classList].filter(DefaultParserUI.isUsefulClassName)[0];
            if (!util.isNullOrEmpty(usefulClass)) {
                part += "." + DefaultParserUI.escapeCss(usefulClass);
            }
            if (node.parentElement != null) {
                let sameTagSiblings = [...node.parentElement.children].filter(child => child.tagName === node.tagName);
                if (1 < sameTagSiblings.length) {
                    part += ":nth-of-type(" + (sameTagSiblings.indexOf(node) + 1) + ")";
                }
            }
            parts.unshift(part);
            let selector = parts.join(" > ");
            if (DefaultParserUI.selectorIsUnique(dom, selector)) {
                return selector;
            }
            node = node.parentElement;
        }
        return parts.join(" > ");
    }

    static selectorIsUnique(dom, selector) {
        try {
            return dom.querySelectorAll(selector).length === 1;
        } catch (e) {
            return false;
        }
    }

    static isUsefulClassName(className) {
        if (util.isNullOrEmpty(className)) {
            return false;
        }
        if (className.length > 48) {
            return false;
        }
        if (/^\d+$/.test(className)) {
            return false;
        }
        return !/(header|footer|nav|menu|sidebar|comment|share|social|advert|ads|related|hidden)/i.test(className);
    }

    static escapeCss(value) {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
            return CSS.escape(value);
        }
        return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
    }

    static setDefaultParserUiVisibility(isVisible) {
        // toggle mode
        ChapterUrlsUI.setVisibleUI(!isVisible);
        if (isVisible) {
            ChapterUrlsUI.getEditChaptersUrlsInput().hidden = true;
            ChapterUrlsUI.modifyApplyChangesButtons(button => button.hidden = true);
            document.getElementById("editURLsHint").hidden = true;
        }
        document.getElementById("defaultParserSection").hidden = !isVisible;
    }

    static async testDefaultParser(parser) {
        DefaultParserUI.AddConfiguration(parser);
        let hostname = DefaultParserUI.getDefaultParserHostnameInput().value;
        let config = parser.siteConfigs.getConfigForSite(hostname);
        if (util.isNullOrEmpty(config.testUrl))
        {
            alert(UIText.Warning.warningNoChapterUrl);
            return;
        }
        try {
            let xhr = await HttpClient.wrapFetch(config.testUrl);
            let webPage = { rawDom: util.sanitize(xhr.responseXML.querySelector("*")) };
            let content = parser.findContent(webPage.rawDom);
            if (content === null) {
                let errorMsg = UIText.Error.errorContentNotFound(config.testUrl);
                throw new Error(errorMsg);
            }
            parser.removeUnwantedElementsFromContentElement(content);
            parser.addTitleToContent(webPage, content);
            DefaultParserUI.showResult(content);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    static cleanResults() {
        let resultElement = DefaultParserUI.getResultViewElement();
        let children = resultElement.childNodes;
        while (0 < children.length) {
            children[children.length - 1].remove();
        }
    }

    static copyInstructions() {
        let content = document.getElementById("defaultParserInstructions");
        DefaultParserUI.showResult(content);
    }

    static showResult(content) {
        DefaultParserUI.cleanResults();
        if (content != null) {
            let resultElement = DefaultParserUI.getResultViewElement();
            util.moveChildElements(content, resultElement);
        }
    }

    static getDefaultParserHostnameInput() {
        return document.getElementById("defaultParserHostName");
    }

    static getContentCssInput() {
        return document.getElementById("defaultParserContentCss");
    }

    static getChapterTitleCssInput() {
        return document.getElementById("defaultParserChapterTitleCss");
    }

    static getUnwantedElementsCssInput() {
        return document.getElementById("defaultParserUnwantedElementsCss");
    }

    static getTestChapterUrlInput() {
        return document.getElementById("defaultParserTestChapterUrl");
    }

    static getResultViewElement() {
        return document.getElementById("defaultParserVewResult");
    }
}

