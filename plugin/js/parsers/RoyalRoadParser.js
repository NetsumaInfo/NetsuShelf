/*
  Parses files on www.royalroadl.com
*/
"use strict";

parserFactory.register("royalroadl.com", () => new RoyalRoadParser());
parserFactory.register("royalroad.com", () => new RoyalRoadParser());

class RoyalRoadParser extends Parser {
    constructor() {
        super();
        this.metaInfoDom = null;
    }

    async getChapterUrls(dom) {
        let chapters = this.getChapterUrlsFromDom(dom);
        let chapterListUrl = this.findChapterListUrl(dom);
        if (chapterListUrl == null) {
            return chapters;
        }

        try {
            let tocHtml = (await HttpClient.wrapFetch(chapterListUrl)).responseXML;
            let fetchedChapters = this.getChapterUrlsFromDom(tocHtml);
            return (fetchedChapters.length > chapters.length) ? fetchedChapters : chapters;
        } catch {
            return chapters;
        }
    }

    getChapterUrlsFromDom(dom) {
        let chapterRows = [...dom.querySelectorAll("tr.chapter-row")];
        if (0 < chapterRows.length) {
            return chapterRows
                .map((row, index) => this.chapterRowToChapter(row, index))
                .filter((chapter) => chapter != null);
        }

        let table = dom.querySelector("table#chapters, #chapters");
        return util.hyperlinksToChapterList(table)
            .map((chapter, index) => this.normalizeChapter(chapter, index));
    }

    chapterRowToChapter(row, index) {
        let titleLink = row.querySelector("td:first-child a[href]");
        if (titleLink == null) {
            return null;
        }

        return this.normalizeChapter({
            sourceUrl: titleLink.href,
            title: titleLink.textContent.trim(),
            chapterNumber: index + 1,
            newArc: null
        }, index);
    }

    normalizeChapter(chapter, index) {
        if (chapter == null) {
            return null;
        }

        let chapterNumber = index + 1;
        let title = chapter.title ?? "";
        if (util.extractChapterNumber({
            title,
            sourceUrl: chapter.sourceUrl
        }) == null) {
            title = `${chapterNumber}. ${title}`;
        }

        return {
            ...chapter,
            title,
            chapterNumber
        };
    }

    findChapterListUrl(dom) {
        let pageUrl = dom?.baseURI ?? "";
        if (this.isFictionUrl(pageUrl)) {
            return pageUrl;
        }

        let fictionLink = [...dom.querySelectorAll("a[href]")]
            .map((link) => link.href)
            .find((url) => this.isFictionUrl(url));
        return fictionLink ?? null;
    }

    isFictionUrl(url) {
        if (!util.isUrl(url)) {
            return false;
        }
        return /^\/fiction\/\d+\/[^/]+\/?$/i.test(new URL(url).pathname);
    }

    async loadEpubMetaInfo(dom) {
        this.metaInfoDom = dom;
        let chapterListUrl = this.findChapterListUrl(dom);
        if ((chapterListUrl == null) || this.isFictionUrl(dom?.baseURI ?? "")) {
            return;
        }

        try {
            this.metaInfoDom = (await HttpClient.wrapFetch(chapterListUrl)).responseXML;
        } catch {
            this.metaInfoDom = dom;
        }
    }

    getMetaInfoDom(dom) {
        return this.metaInfoDom ?? dom;
    }

    findStoryTitleElement(dom) {
        return dom?.querySelector("div.fic-header div.col h1")
            ?? dom?.querySelector("div.fic-header a[href*='/fiction/'] > h2");
    }

    shouldAutoExpandChapterList(url, firstPageDom, chapters = []) {
        if (this.isFictionUrl(url)) {
            return false;
        }
        return super.shouldAutoExpandChapterList(url, firstPageDom, chapters);
    }

    ensureCurrentPageIncludedInChapterList(url, dom, chapters = []) {
        if (this.isFictionUrl(url)) {
            return chapters;
        }
        return super.ensureCurrentPageIncludedInChapterList(url, dom, chapters);
    }

    addFirstPageUrlToWebPages(url, firstPageDom, webPages) {
        if (this.isFictionUrl(url)) {
            return webPages;
        }
        return super.addFirstPageUrlToWebPages(url, firstPageDom, webPages);
    }

    // find the node(s) holding the story content
    findContent(dom) {
        let content = util.getElement(dom, "div", 
            e => (e.className === "portlet-body") &&
            (e.querySelector("div.chapter-inner") !== null)
        );

        // fix embeded image links 
        content.querySelector(".author-note")?.querySelectorAll("a")?.forEach((e) => 
        {
            let img = e.querySelector("img");
            if (img !== null) 
            {
                e.href = img.src;
            }
        });
        return content || dom.querySelector(".page-content-wrapper");
    }

    populateUIImpl() {
        document.getElementById("removeAuthorNotesRow").hidden = false; 
    }

    preprocessRawDom(webPageDom) { 
        this.removeWatermarks(webPageDom);
        this.removeImgTagsWithNoSrc(webPageDom);
        this.tagAuthorNotesBySelector(webPageDom, "div.author-note-portlet");

        let re_cnRandomClass = new RegExp("^cn[A-Z][a-zA-Z0-9]{41}$");
        webPageDom.querySelectorAll("p").forEach(element =>
        {
            let className = Array.from(element.classList).filter(item => re_cnRandomClass.test(item))[0];
            if (className)
            {
                element.classList.remove(className);
            }
        }
        );
    }

    //watermarks are regular <p> elements set to "display: none" by internal css
    removeWatermarks(webPageDom) {
        let internalStyles = [...webPageDom.querySelectorAll("style")]
            .map(style => style.sheet?.rules);
        let allCssRules = [];
        for (let ruleList of internalStyles) {
            for (let rule of ruleList) {
                allCssRules.push(rule);
            }
        }
        for (let rule of allCssRules.filter(s => s.style?.display == "none")) {
            webPageDom.querySelector(rule.selectorText)?.remove();
        }        
    }

    removeUnwantedElementsFromContentElement(content) {
        // only keep the <div class="chapter-inner" elements of content
        for (let i = content.childElementCount - 1; 0 <= i; --i) {
            let child = content.children[i];
            if (!this.isWantedElement(child)) {
                child.remove();
            }
        }
        this.makeHiddenElementsVisible(content);

        super.removeUnwantedElementsFromContentElement(content);
    }

    isWantedElement(element) {
        let tagName = element.tagName.toLowerCase();
        let className = element.className;
        return (tagName === "h1") || 
            ((tagName === "div") && 
                (className.startsWith("chapter-inner") ||
                className.includes("author-note-portlet") ||
                className.includes("page-content"))
            );
    }

    makeHiddenElementsVisible(content) {
        [...content.querySelectorAll("div")]
            .filter(e => (e.style.display === "none"))
            .forEach(e => e.removeAttribute("style"));
    }

    removeNextAndPreviousChapterHyperlinks(webPage, content) {
        util.removeElements(content.querySelectorAll("a[href*='www.royalroadl.com']"));
        RoyalRoadParser.removeOlderChapterNavJunk(content);
    }

    extractTitleImpl(dom) {
        let metaInfoDom = this.getMetaInfoDom(dom);
        return this.findStoryTitleElement(metaInfoDom)
            ?? this.findStoryTitleElement(dom);
    }

    extractAuthor(dom) {
        let metaInfoDom = this.getMetaInfoDom(dom);
        let author = metaInfoDom.querySelector("div.fic-header h4 span a")
            ?? metaInfoDom.querySelector("div.fic-header h3 a[href*='/profile/']")
            ?? dom.querySelector("div.fic-header h4 span a")
            ?? dom.querySelector("div.fic-header h3 a[href*='/profile/']");
        return author?.textContent?.trim() ?? super.extractAuthor(dom);
    }

    extractSubject(dom) {
        let metaInfoDom = this.getMetaInfoDom(dom);
        let tags = ([...metaInfoDom.querySelectorAll("div.fiction-info span.tags .label")]);
        return tags.map(e => e.textContent.trim()).join(", ");
    }

    extractDescription(dom) {
        let metaInfoDom = this.getMetaInfoDom(dom);
        return metaInfoDom.querySelector("div.fiction-info div.description")?.textContent?.trim()
            ?? super.extractDescription(dom);
    }

    findChapterTitle(dom) {
        return dom.querySelector("h1") ||
            dom.querySelector("h2");
    }

    static removeOlderChapterNavJunk(content) {
        // some older chapters have next chapter & previous chapter links seperated by string "<-->"
        for (let node of util.iterateElements(content, 
            n => (n.textContent.trim() === "<-->"),
            NodeFilter.SHOW_TEXT)) {
            node.remove();
        }
    }

    findCoverImageUrl(dom) {
        let metaInfoDom = this.getMetaInfoDom(dom);
        return metaInfoDom.querySelector("img.thumbnail, img[data-type='cover']")?.src ?? null;
    }

    removeImgTagsWithNoSrc(webPageDom) {
        [...webPageDom.querySelectorAll("img")]
            .filter(i => util.isNullOrEmpty(i.src))
            .forEach(i => i.remove());
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div.fic-title, div.fiction-info div.portlet.row")];
    }
}
