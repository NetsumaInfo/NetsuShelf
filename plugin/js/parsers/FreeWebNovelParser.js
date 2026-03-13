"use strict";

parserFactory.register("freewebnovel.com", () => new FreeWebNovelComParser());
parserFactory.register("bednovel.com", () => new FreeWebNovelParser());
parserFactory.register("innnovel.com", () => new FreeWebNovelParser());
parserFactory.register("libread.com", () => new FreeWebNovelParser());
parserFactory.register("novellive.com", () => new NovelliveParser());
parserFactory.register("novellive.app", () => new NovelliveParser());
parserFactory.register("novellive.net", () => new NovelliveParser());
parserFactory.register("readwn.org", () => new NovelliveParser());

class FreeWebNovelParser extends Parser {

    constructor() {
        super();
        this.minimumThrottle = 1000;
    }

    async getChapterUrls(dom) {
        let menu = dom.querySelector("ul#idData");
        return util.hyperlinksToChapterList(menu);
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1.tit");
    }

    extractAuthor(dom) {
        return dom.querySelector("[title=Author]").parentNode.querySelector("a").textContent;
    }

    extractSubject(dom) {
        let tags = [...dom.querySelector("[title=Genre]").parentNode.querySelectorAll("a")];
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.pic");
    }

    findChapterTitle(dom) {
        return dom.querySelector("span.chapter");
    }

    findContent(dom) {
        return dom.querySelector("div.txt");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.inner")];
    }
}

class NovelliveParser extends FreeWebNovelParser {

    constructor() {
        super();
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        dom = await this.getTocDom(dom);
        return this.getChapterUrlsFromMultipleTocPages(dom,
            this.extractPartialChapterList.bind(this),
            this.getUrlsOfTocPages.bind(this),
            chapterUrlsUI
        );
    }

    async getTocDom(dom) {
        let tocUrl = this.findTocUrl(dom);
        if (util.isNullOrEmpty(tocUrl)
            || (util.normalizeUrlForCompare(tocUrl) === util.normalizeUrlForCompare(dom.baseURI))) {
            return dom;
        }

        await this.rateLimitDelay();
        return (await HttpClient.wrapFetch(tocUrl)).responseXML;
    }

    findTocUrl(dom) {
        let inferredTocUrl = this.inferTocUrlFromUrl(dom?.baseURI);
        let linkedTocUrl = [...dom.querySelectorAll("a[href]")]
            .map((link) => this.normalizeTocUrl(link.href))
            .find((href) => !util.isNullOrEmpty(href) && (href === inferredTocUrl));
        return linkedTocUrl ?? inferredTocUrl ?? dom?.baseURI;
    }

    normalizeTocUrl(url) {
        if (util.isNullOrEmpty(url) || !util.isUrl(url)) {
            return null;
        }

        let parsed = new URL(url);
        let pathSegments = parsed.pathname
            .replace(/\/+$/, "")
            .split("/")
            .filter(Boolean);
        if ((pathSegments[0] !== "book") || (pathSegments.length < 2)) {
            return null;
        }

        parsed.pathname = `/${pathSegments[0]}/${pathSegments[1]}`;
        parsed.search = "";
        parsed.hash = "";
        return parsed.href;
    }

    inferTocUrlFromUrl(url) {
        return this.normalizeTocUrl(url);
    }

    getUrlsOfTocPages(dom) {
        let tocUrl = this.findTocUrl(dom);
        if (util.isNullOrEmpty(tocUrl)) {
            return [];
        }

        let currentPageNumber = this.getCurrentTocPageNumber(dom.baseURI);
        let lastIndex = Math.max(
            1,
            ...[...dom.querySelectorAll(".page a.index-container-btn, .page a[href]")]
                .map((link) => this.getCurrentTocPageNumber(link.href))
                .filter((pageNumber) => 0 < pageNumber)
        );
        let urls = [];
        for (let i = 1; i <= lastIndex; ++i) {
            if (i !== currentPageNumber) {
                urls.push(this.buildTocPageUrl(tocUrl, i));
            }
        }
        return urls;
    }

    buildTocPageUrl(tocUrl, pageNumber) {
        let parsed = new URL(tocUrl);
        let normalizedPath = parsed.pathname.replace(/\/+$/, "");
        parsed.pathname = (pageNumber <= 1) ? normalizedPath : `${normalizedPath}/${pageNumber}`;
        parsed.search = "";
        parsed.hash = "";
        return parsed.href;
    }

    getCurrentTocPageNumber(url) {
        if (util.isNullOrEmpty(url) || !util.isUrl(url)) {
            return 1;
        }

        let pathSegments = new URL(url).pathname
            .replace(/\/+$/, "")
            .split("/")
            .filter(Boolean);
        let pageNumber = parseInt(pathSegments[2], 10);
        return Number.isFinite(pageNumber) && (pageNumber > 0) ? pageNumber : 1;
    }

    extractPartialChapterList(dom) {
        let tocUrl = this.findTocUrl(dom);
        let chapterLinks = this.findBestChapterLinks(dom, tocUrl);
        return chapterLinks.map(link => util.hyperLinkToChapter(link));
    }

    findBestChapterLinks(dom, tocUrl) {
        let headingScopes = [...dom.querySelectorAll("h1, h2, h3, h4, h5, h6, .tit")]
            .filter((heading) => /chapter list/i.test(heading.textContent ?? ""))
            .map((heading) => heading.closest("section, article, div") ?? heading.parentElement)
            .filter((scope) => scope != null);

        let bestScopedLinks = headingScopes
            .map((scope) => this.collectChapterLinks(scope.querySelectorAll("a[href]"), tocUrl))
            .sort((left, right) => right.length - left.length)
            .find((links) => 0 < links.length);
        if (bestScopedLinks != null) {
            return bestScopedLinks;
        }

        return [...dom.querySelectorAll("ul, ol, .m-newest2")]
            .map((container) => this.collectChapterLinks(container.querySelectorAll("a[href]"), tocUrl))
            .sort((left, right) => right.length - left.length)
            .find((links) => 0 < links.length) ?? [];
    }

    collectChapterLinks(linkElements, tocUrl) {
        let foundUrls = new Set();
        return [...linkElements].filter((link) => {
            if (!this.isChapterLinkForBook(link, tocUrl)) {
                return false;
            }

            let normalizedUrl = util.normalizeUrlForCompare(link.href);
            if (foundUrls.has(normalizedUrl)) {
                return false;
            }
            foundUrls.add(normalizedUrl);
            return true;
        });
    }

    isChapterLinkForBook(link, tocUrl) {
        if ((link == null) || util.isNullOrEmpty(tocUrl) || !util.isUrl(link.href)) {
            return false;
        }

        let normalizedBookUrl = this.normalizeTocUrl(tocUrl);
        let normalizedLinkBookUrl = this.normalizeTocUrl(link.href);
        if (util.isNullOrEmpty(normalizedBookUrl) || (normalizedLinkBookUrl !== normalizedBookUrl)) {
            return false;
        }

        let pathSegments = new URL(link.href).pathname
            .replace(/\/+$/, "")
            .split("/")
            .filter(Boolean);
        let chapterPath = pathSegments.slice(2).join("/");
        if (util.isNullOrEmpty(chapterPath) || /^\d+$/.test(chapterPath)) {
            return false;
        }

        return /\bchapter\b/i.test(chapterPath)
            || (util.extractChapterNumber({title: link.textContent, sourceUrl: link.href}) != null);
    }
}

class FreeWebNovelComParser extends FreeWebNovelParser {
    constructor() {
        super();
    }
    removeUnwantedElementsFromContentElement(content) {
        util.removeChildElementsMatchingSelector(content, "p sub");
        super.removeUnwantedElementsFromContentElement(content);
    }
}
