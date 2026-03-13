"use strict";

parserFactory.register("empirenovel.com", () => new EmpirenovelParser());

class EmpirenovelParser extends Parser { // eslint-disable-line no-unused-vars
    constructor() {
        super();
        this.tocFetchBatchSize = 4;
        this.titleFetchBatchSize = 8;
        this.titleFetchDelayMs = 100;
        this.titleEnrichmentRunId = 0;
    }

    async onLoadFirstPage(url, firstPageDom) {
        await super.onLoadFirstPage(url, firstPageDom);
        let runId = ++this.titleEnrichmentRunId;
        this.enrichChapterTitlesInBackground(url, firstPageDom, runId).catch((error) => {
            if (!util.isAbortError(error)) {
                ErrorLog.log(error);
            }
        });
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
                let title = this.extractChapterTitleFromLink(link);
                return ({
                    sourceUrl: link.href,
                    title: title,
                    chapterNumber: util.extractChapterNumber({title, sourceUrl: link.href})
                });
            });
    }

    extractChapterTitleFromLink(link) {
        let explicitTitle = [
            link.getAttribute("data-title"),
            link.title
        ].find(title => !util.isNullOrEmpty(title?.trim()));
        if (!util.isNullOrEmpty(explicitTitle)) {
            return explicitTitle.trim();
        }

        let copy = link.cloneNode(true);
        copy.querySelectorAll(".small").forEach(element => element.remove());
        return copy.textContent.trim();
    }

    shouldEnrichChapterTitle(chapter, currentUrl) {
        if ((chapter == null) || !this.isGenericChapterTitle(chapter.title)) {
            return false;
        }
        if (util.isNullOrEmpty(currentUrl)) {
            return true;
        }
        return util.normalizeUrlForCompare(chapter.sourceUrl) !== util.normalizeUrlForCompare(currentUrl);
    }

    async enrichChapterTitlesInBackground(url, firstPageDom, runId = this.titleEnrichmentRunId) {
        let chapters = [...this.getPagesToFetch().values()];
        if (chapters.length === 0) {
            return;
        }

        let titlesUpdated = false;
        let currentChapter = this.findChapterByUrl(url, chapters);
        if ((currentChapter != null) && this.updateChapterTitleFromDom(currentChapter, firstPageDom)) {
            titlesUpdated = true;
        }

        let chaptersToEnrich = chapters.filter(chapter => this.shouldEnrichChapterTitle(chapter, url));
        for (let i = 0; i < chaptersToEnrich.length; i += this.titleFetchBatchSize) {
            if ((runId !== this.titleEnrichmentRunId)
                || (this.state.chapterListUrl !== url)
                || util.sleepController.signal.aborted) {
                return;
            }

            let batch = chaptersToEnrich.slice(i, i + this.titleFetchBatchSize);
            let batchResults = await Promise.all(batch.map(async (chapter) => {
                try {
                    return {
                        chapter: chapter,
                        dom: (await HttpClient.wrapFetch(chapter.sourceUrl)).responseXML
                    };
                } catch {
                    return {
                        chapter: chapter,
                        dom: null
                    };
                }
            }));

            batchResults.forEach(({ chapter, dom }) => {
                if ((dom != null) && this.updateChapterTitleFromDom(chapter, dom)) {
                    titlesUpdated = true;
                }
            });

            if ((i + this.titleFetchBatchSize < chaptersToEnrich.length) && (0 < this.titleFetchDelayMs)) {
                await util.sleep(this.titleFetchDelayMs);
            }
        }

        if (titlesUpdated) {
            this.refreshChapterGroupingUi();
        }
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

    findChapterTitle(dom) {
        if (!this.isChapterPageUrl(dom?.baseURI)) {
            return null;
        }
        return dom.querySelector("#read-novel h3, #read-novel h4, h3, h4");
    }

    isChapterPageUrl(url) {
        if (util.isNullOrEmpty(url) || !util.isUrl(url)) {
            return false;
        }
        return /^https?:\/\/[^/]+\/novel\/[^/]+\/\d+\/?$/i.test(url);
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
