"use strict";

parserFactory.register("empirenovel.com", () => new EmpirenovelParser());

class EmpirenovelParser extends Parser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
        this.tocFetchBatchSize = 4;
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        dom = await this.getTocDom(dom);
        let tocPages = this.getTocPages(dom);
        let chapters = [];

        for (let i = 0; i < tocPages.length; i += this.tocFetchBatchSize) {
            let batch = tocPages.slice(i, i + this.tocFetchBatchSize);
            let batchPages = await Promise.all(batch.map(async (page) => {
                if (page.dom != null) {
                    return page;
                }

                await this.rateLimitDelay();
                return {
                    ...page,
                    dom: (await HttpClient.wrapFetch(page.url)).responseXML
                };
            }));

            batchPages
                .sort((left, right) => left.pageNumber - right.pageNumber)
                .forEach((page) => {
                    let partialList = this.extractPartialChapterList(page.dom);
                    chapterUrlsUI.showTocProgress(partialList);
                    chapters = chapters.concat(partialList);
                });
        }

        return chapters.reverse();
    }

    async getTocDom(dom) {
        if (this.extractPartialChapterList(dom).length !== 0) {
            return dom;
        }

        let tocUrl = this.findTocUrl(dom);
        if (util.isNullOrEmpty(tocUrl) || (tocUrl === dom.baseURI)) {
            return dom;
        }

        await this.rateLimitDelay();
        return (await HttpClient.wrapFetch(tocUrl)).responseXML;
    }

    findTocUrl(dom) {
        let linkedTocUrl = [...dom.querySelectorAll("a[href]")]
            .map(link => link.href)
            .find((href) => this.isNovelTocUrl(href, dom.baseURI));
        if (!util.isNullOrEmpty(linkedTocUrl)) {
            return linkedTocUrl;
        }

        let inferredTocUrl = this.inferTocUrlFromChapterUrl(dom.baseURI);
        return inferredTocUrl ?? dom.baseURI;
    }

    isNovelTocUrl(candidateUrl, currentUrl) {
        if (!util.isUrl(candidateUrl)) {
            return false;
        }

        let candidate = new URL(candidateUrl);
        let current = new URL(currentUrl);
        if ((candidate.origin !== current.origin) || (candidate.pathname === current.pathname)) {
            return false;
        }

        if (!candidate.pathname.startsWith("/novel/")) {
            return false;
        }

        return !/\/\d+\/?$/.test(candidate.pathname);
    }

    inferTocUrlFromChapterUrl(url) {
        if (util.isNullOrEmpty(url)) {
            return null;
        }

        let parsed = new URL(url);
        let path = parsed.pathname.replace(/\/+$/, "");
        if (!path.startsWith("/novel/")) {
            return null;
        }

        let trimmedPath = path.replace(/\/\d+$/, "");
        if (trimmedPath === path) {
            parsed.searchParams.delete("page");
            return parsed.href;
        }

        parsed.pathname = trimmedPath;
        parsed.search = "";
        return parsed.href;
    }

    getTocPages(dom) {
        let currentPageNumber = this.getCurrentTocPageNumber(dom);
        let indices = [...dom.querySelectorAll(".pagination a[href]")]
            .map((item) => {
                let page = new URL(item.href, dom.baseURI).searchParams.get("page");
                return parseInt(page, 10);
            })
            .filter(Number.isFinite);

        let lastIndex = Math.max(currentPageNumber, ...indices);
        let baseUrl = new URL(dom.baseURI);
        baseUrl.searchParams.delete("page");

        let tocPages = [];
        for (let i = 1; i <= lastIndex; ++i) {
            let pageUrl = new URL(baseUrl.href);
            if (i !== 1) {
                pageUrl.searchParams.set("page", i);
            }

            tocPages.push({
                pageNumber: i,
                url: pageUrl.href,
                dom: (i === currentPageNumber) ? dom : null
            });
        }
        return tocPages;
    }

    getCurrentTocPageNumber(dom) {
        let page = new URL(dom.baseURI).searchParams.get("page");
        let pageNumber = parseInt(page, 10);
        return Number.isFinite(pageNumber) && (pageNumber > 0) ? pageNumber : 1;
    }

    extractPartialChapterList(dom) {
        return [...dom.querySelectorAll("a.chapter_link")]
            .map((link) => {
                link.querySelector(".small")?.remove();
                return ({
                    sourceUrl: link.href,
                    title: link.innerText.trim(),
                });
            });
    }

    shouldAutoExpandChapterList(url, firstPageDom, chapters = []) { // eslint-disable-line no-unused-vars
        if (firstPageDom?.querySelector("a.chapter_link, .pagination a[href]") != null) {
            return false;
        }
        return super.shouldAutoExpandChapterList(url, firstPageDom, chapters);
    }

    findContent(dom) {
        return dom.querySelector("#read-novel");
    }

    extractAuthor(dom) {
        let authorLabel = dom.querySelector("div:nth-child(2) > div > span > a");
        return (authorLabel === null) ? super.extractAuthor(dom) : authorLabel.textContent;
    }

    extractSubject(dom) {
        let tags = ([...dom.querySelectorAll("div:nth-child(1) > ul a")]);
        let regex = new RegExp("^#");
        return tags.map(e => e.textContent.trim().replace(regex, "")).join(", ");
    }

    extractTitleImpl(dom) {
        return dom.querySelector("h1:not(.show_title)");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, "div.cover");
    }

    getInformationEpubItemChildNodes(dom) {
        return [
            ...dom.querySelectorAll("div.col-sm.pe-sm-0 > div:nth-child(1)"),
            ...dom.querySelectorAll("div.bg_dark.p-3.my-2.rounded-3.show_details.max-sm-250.w-100")
        ];
    }
}
