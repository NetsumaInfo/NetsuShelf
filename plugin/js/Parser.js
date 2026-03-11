/*
  Base class that all parsers build from.
*/
"use strict";

/**
 * For sites that have multiple chapters per web page, this can minimize HTTP calls
 */
class FetchCache { // eslint-disable-line no-unused-vars
    constructor() {
        this.path = null;
        this.dom = null;
    }

    async fetch(url) {
        if  (!this.inCache(url)) {
            this.dom = (await HttpClient.wrapFetch(url)).responseXML;
            this.path = new URL(url).pathname;
        }
        return this.dom.cloneNode(true);
    }

    inCache(url) {
        return (((new URL(url).pathname) === this.path) 
        && (this.dom !== null));
    }
}

/**
 * A Parser's state variables
*/
class ParserState {
    constructor() {
        this.webPages = new Map();
        this.chapterListUrl = null;
        this.nativeChapterGroups = [];
        this.referenceChapterGroups = [];
        this.referenceSourceGroups = [];
        this.referenceChapterGroupSource = null;
        this.chapterUrlsUI = null;
    }

    setPagesToFetch(urls) {
        let nextPrevChapters = new Set();
        this.webPages = new Map();
        for (let i = 0; i < urls.length; ++i) {
            let page = urls[i];
            if (i < urls.length - 1) {
                nextPrevChapters.add(util.normalizeUrlForCompare(urls[i + 1].sourceUrl));
            }
            page.nextPrevChapters = nextPrevChapters;
            this.webPages.set(page.sourceUrl, page);
            nextPrevChapters = new Set();
            nextPrevChapters.add(util.normalizeUrlForCompare(page.sourceUrl));
        }
        this.nativeChapterGroups = util.buildChapterGroups(urls);
        this.referenceChapterGroups = util.mapReferenceChapterGroupsToChapters(this.referenceSourceGroups, urls);
    }

    setReferenceChapterGroups(referenceGroups, source, urls) {
        this.referenceSourceGroups = Array.isArray(referenceGroups) ? referenceGroups : [];
        this.referenceChapterGroupSource = source ?? null;
        this.referenceChapterGroups = util.mapReferenceChapterGroupsToChapters(
            this.referenceSourceGroups,
            urls ?? [...this.webPages.values()]
        );
    }

    clearReferenceChapterGroups() {
        this.referenceSourceGroups = [];
        this.referenceChapterGroupSource = null;
        this.referenceChapterGroups = [];
    }
}

class Parser {    
    constructor(imageCollector) {
        this.minimumThrottle = 500;
        this.maxSimultanousFetchSize = 1;
        this.state = new ParserState();
        this.imageCollector = imageCollector || new ImageCollector();
        this.userPreferences = null;
    }

    copyState(otherParser) {
        this.state = otherParser.state;
        this.imageCollector.copyState(otherParser.imageCollector);
        this.userPreferences = otherParser.userPreferences;
    }

    setPagesToFetch(urls) {
        this.state.setPagesToFetch(urls);
    }

    getPagesToFetch() {
        return this.state.webPages;
    }

    getChapterGroups() {
        return (0 < (this.state.referenceChapterGroups?.length ?? 0))
            ? this.state.referenceChapterGroups
            : (this.state.nativeChapterGroups ?? []);
    }

    getNativeChapterGroups() {
        return this.state.nativeChapterGroups ?? [];
    }

    getReferenceChapterGroups() {
        return this.state.referenceChapterGroups ?? [];
    }

    getReferenceChapterGroupSource() {
        return this.state.referenceChapterGroupSource ?? null;
    }

    setReferenceChapterGroups(referenceGroups, source) {
        this.state.setReferenceChapterGroups(referenceGroups, source, [...this.getPagesToFetch().values()]);
        this.refreshChapterGroupingUi();
    }

    clearReferenceChapterGroups() {
        this.state.clearReferenceChapterGroups();
        this.refreshChapterGroupingUi();
    }

    setChapterUrlsUI(chapterUrlsUI) {
        this.state.chapterUrlsUI = chapterUrlsUI;
    }

    refreshChapterGroupingUi() {
        this.state.chapterUrlsUI?.refreshChapterGroupControls?.([...this.getPagesToFetch().values()]);
    }
    
    //Use this option if the parser isn't sending the correct HTTP header
    isCustomError(response) {  // eslint-disable-line no-unused-vars
        return false;
    }

    setCustomErrorResponse(url, wrapOptions, checkedresponse) {
        //example
        let ret = {};
        ret.url = url;
        ret.wrapOptions = wrapOptions;
        ret.response = {};
        //URL that's get opened on 'Open URL for Captcha' click
        ret.response.url = checkedresponse.response.url;
        ret.response.status = 403;
        //How often should it be retried and with how much delay in between
        ret.response.retryDelay = [80,40,20,10,5];
        ret.errorMessage = "This is a custom error message that will be displayed should all retries fail";
        //return empty to throw error
        return {};
    }

    onUserPreferencesUpdate(userPreferences) {
        this.userPreferences = userPreferences;
        this.imageCollector.onUserPreferencesUpdate(userPreferences);
    }

    isWebPagePackable(webPage) {
        return ((webPage.isIncludeable)
         && ((webPage.rawDom != null) || (webPage.error != null)));
    }

    convertRawDomToContent(webPage) {
        let content = this.findContent(webPage.rawDom);
        this.customRawDomToContentStep(webPage, content);
        util.decodeCloudflareProtectedEmails(content);
        if (this.userPreferences.removeNextAndPreviousChapterHyperlinks.value) {
            this.removeNextAndPreviousChapterHyperlinks(webPage, content);
        }
        this.removeUnwantedElementsFromContentElement(content);
        this.replaceWpBlockSpacersWithHR(content);
        this.addTitleToContent(webPage, content);
        util.fixBlockTagsNestedInInlineTags(content);
        this.imageCollector.replaceImageTags(content);
        util.removeUnusedHeadingLevels(content);
        util.makeHyperlinksRelative(webPage.rawDom.baseURI, content);
        util.setStyleToDefault(content);
        util.prepForConvertToXhtml(content);
        util.removeEmptyAttributes(content);
        util.removeSpansWithNoAttributes(content);
        util.removeEmptyDivElements(content);
        util.removeTrailingWhiteSpace(content);
        if (util.isElementWhiteSpace(content)) {
            let errorMsg = UIText.Warning.warningNoVisibleContent(webPage.sourceUrl);
            ErrorLog.showErrorMessage(errorMsg);
        }
        return content;
    }

    addTitleToContent(webPage, content) {
        let title = this.findChapterTitle(webPage.rawDom, webPage);
        if (title != null) {
            if (title instanceof HTMLElement) {
                title = title.textContent;
            }
            if (webPage.title == "[placeholder]") {
                webPage.title = title.trim();
            }
            if (!this.titleAlreadyPresent(title, content)) {
                let titleElement = webPage.rawDom.createElement("h1");
                titleElement.appendChild(webPage.rawDom.createTextNode(title.trim()));
                content.insertBefore(titleElement, content.firstChild);
            }
        } else {
            if (webPage.title == "[placeholder]") {
                webPage.title = webPage.rawDom.title;
            }
        }
    }

    titleAlreadyPresent(title, content) {
        let existingTitle = content.querySelector("h1, h2, h3, h4, h5, h6");
        return (existingTitle != null)
            && (title.trim() === existingTitle.textContent.trim());
    }

    /**
     * Element with title of an individual chapter
     * Override when chapter title not in content element
    */
    findChapterTitle(dom) {   // eslint-disable-line no-unused-vars
        return null;
    }

    replaceWpBlockSpacersWithHR(content) {
        [...content.querySelectorAll("div.wp-block-spacer")].forEach(
            e => e.replaceWith(content.ownerDocument.createElement("hr"))
        );
    }

    removeUnwantedElementsFromContentElement(element) {
        util.removeScriptableElements(element);
        util.removeComments(element);
        util.removeElements(element.querySelectorAll("noscript, input"));
        util.removeUnwantedWordpressElements(element);
        util.removeMicrosoftWordCrapElements(element);
        util.removeShareLinkElements(element);
        util.removeLeadingWhiteSpace(element);
    }

    customRawDomToContentStep(chapter, content) { // eslint-disable-line no-unused-vars
        // override for any custom processing
    }

    populateUI(dom) {
        CoverImageUI.showCoverImageUrlInput(true);
        let coverUrl = this.findCoverImageUrl(dom);
        CoverImageUI.setCoverImageUrl(coverUrl);
        this.populateUIImpl();
    }

    populateUIImpl() {
        // default implementation is do nothing more
    }

    /**
     * Default implementation, take first image in content section
    */
    findCoverImageUrl(dom) {
        if (dom != null) {
            let content = this.findContent(dom);
            if (content != null) {
                let cover = content.querySelector("img");
                if (cover != null) {
                    return cover.src;
                }
            }
        }
        return null;
    }

    removeNextAndPreviousChapterHyperlinks(webPage, element) {
        let elementToRemove = (this.findParentNodeOfChapterLinkToRemoveAt != null) ?
            this.findParentNodeOfChapterLinkToRemoveAt.bind(this)
            : (element) => element;

        let chapterLinks = [...element.querySelectorAll("a")]
            .filter(link => webPage.nextPrevChapters.has(util.normalizeUrlForCompare(link.href)))
            .map(link => elementToRemove(link));
        util.removeElements(chapterLinks);
    }

    /**
    * default implementation turns each webPage into single epub item
    */
    webPageToEpubItems(webPage, epubItemIndex) {
        let content = this.convertRawDomToContent(webPage);
        let items = [];
        if (content != null) {
            items.push(new ChapterEpubItem(webPage, content, epubItemIndex));
        }
        return items;
    }

    makePlaceholderEpubItem(webPage, epubItemIndex) {
        let temp = Parser.makeEmptyDocForContent(webPage.sourceUrl);
        temp.content.textContent = UIText.Default.chapterPlaceholderMessage(webPage.sourceUrl, webPage.error);
        util.convertPreTagToPTags(temp.dom, temp.content);
        return [new ChapterEpubItem(webPage, temp.content, epubItemIndex)];
    }

    /**
    * default implementation
    */
    static extractTitleDefault(dom) {
        let title = dom.querySelector("meta[property='og:title']");
        return (title === null) ? dom.title : title.getAttribute("content");
    }

    extractTitleImpl(dom) {
        return Parser.extractTitleDefault(dom);
    }

    extractTitle(dom) {
        let title = this.extractTitleImpl(dom);
        if (title == null) {
            title = Parser.extractTitleDefault(dom);
        }
        if (title.textContent !== undefined) {
            title = title.textContent;
        }
        return title.trim();
    }

    /**
    * default implementation
    */
    extractAuthor(dom) {  // eslint-disable-line no-unused-vars
        return "<unknown>";
    }

    /**
    * default implementation, 
    * if not available, default to English
    */
    extractLanguage(dom) {
        // try jetpack tag
        let locale = dom.querySelector("meta[property='og:locale']");
        if (locale !== null) {
            return locale.getAttribute("content");
        }

        // try <html>'s lang attribute
        locale = dom.querySelector("html").getAttribute("lang") ?? "en";
        return locale.split("-")[0];
    }

    /**
    * default implementation, 
    * if not available, return ''
    */
    extractSubject(dom) {   // eslint-disable-line no-unused-vars
        return "";
    }

    extractDescription(dom) {
        let infoDiv = document.createElement("div");
        if (this.getInformationEpubItemChildNodes !== undefined)
        {
            this.populateInfoDiv(infoDiv, dom);
        }
        return infoDiv.textContent;
    }

    /**
    * default implementation, Derived classes will override
    */
    extractSeriesInfo(dom, metaInfo) {  // eslint-disable-line no-unused-vars
    }

    async loadEpubMetaInfo(dom) {  // eslint-disable-line no-unused-vars
        return;
    }

    getEpubMetaInfo(dom, useFullTitle) {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = dom.baseURI;
        try {
            metaInfo.title = this.extractTitle(dom);
        }
        catch (err) {
            metaInfo.title = "";
        }
        try {
            metaInfo.author = this.extractAuthor(dom).trim();
        }
        catch (err) {
            metaInfo.author = "";
        }
        try {
            metaInfo.language = this.extractLanguage(dom);
        }
        catch (err) {
            metaInfo.language = "";
        }
        try {
            metaInfo.fileName = this.makeSaveAsFileNameWithoutExtension(metaInfo.title, useFullTitle);
        }
        catch (err) {
            metaInfo.fileName = "web.epub";
        }
        try {
            metaInfo.subject = this.extractSubject(dom);
        }
        catch (err) {
            metaInfo.subject = "";
        }
        try {
            metaInfo.description = this.extractDescription(dom);
        }
        catch (err) {
            metaInfo.description = "";
        }
        this.extractSeriesInfo(dom, metaInfo);
        return metaInfo;
    }

    singleChapterStory(baseUrl, dom) {
        return [{
            sourceUrl: baseUrl,
            title: this.extractTitle(dom)
        }];
    }

    getBaseUrl(dom) {
        return Array.from(dom.getElementsByTagName("base"))[0].href;
    }

    makeSaveAsFileNameWithoutExtension(title, useFullTitle) {
        let maxFileNameLength = useFullTitle ? 512 : 20;
        let fileName = (title == null)  ? "web" : util.safeForFileName(title, maxFileNameLength);
        if (util.isStringWhiteSpace(fileName)) {
            // title is probably not English, so just use it as is
            fileName = title;
        }
        return fileName;
    }

    epubItemSupplier() {
        let epubItems = this.webPagesToEpubItems([...this.state.webPages.values()]);
        this.fixupHyperlinksInEpubItems(epubItems);
        return new EpubItemSupplier(this, epubItems, this.imageCollector);
    }

    webPagesToEpubItems(webPages) {
        let epubItems = [];
        let index = 0;

        if (this.userPreferences.addInformationPage.value &&
            this.getInformationEpubItemChildNodes !== undefined) {
            epubItems.push(this.makeInformationEpubItem(this.state.firstPageDom));
            ++index;
        }

        for (let webPage of webPages.filter(c => this.isWebPagePackable(c))) {
            let newItems = (webPage.error == null)
                ? webPage.parser.webPageToEpubItems(webPage, index)
                : this.makePlaceholderEpubItem(webPage, index);
            epubItems = epubItems.concat(newItems);
            index += newItems.length;
            delete(webPage.rawDom);
        }
        return epubItems;
    }

    makeInformationEpubItem(dom) {
        let titleText = UIText.Default.informationPageTitle;
        let title = document.createElement("h1");
        title.appendChild(document.createTextNode(titleText));
        let div = document.createElement("div");
        let urlElement = document.createElement("p");
        let bold = document.createElement("b");
        bold.textContent = UIText.Default.tableOfContentsUrl;
        urlElement.appendChild(bold);
        urlElement.appendChild(document.createTextNode(this.state.chapterListUrl));
        div.appendChild(urlElement);
        let infoDiv = document.createElement("div");
        this.populateInfoDiv(infoDiv, dom);    
        let childNodes = [title, div, infoDiv];
        let chapter = {
            sourceUrl: this.state.chapterListUrl,
            title: titleText,
            newArch: null
        };
        return new ChapterEpubItem(chapter, {childNodes: childNodes}, 0);
    }

    populateInfoDiv(infoDiv, dom) {
        for (let n of this.getInformationEpubItemChildNodes(dom).filter(n => n != null)) {
            let clone = util.sanitizeNode(n);
            if (clone) {
                this.cleanInformationNode(clone);
            }
            if (clone != null) {
                infoDiv.appendChild(clone);
            }
        }
        // this "page" doesn't go through image collector, so strip images
        util.removeChildElementsMatchingSelector(infoDiv, "img");
    }

    cleanInformationNode(node) {     // eslint-disable-line no-unused-vars
        // do nothing, derived class overrides as required
    }

    // called when plugin has obtained the first web page
    async onLoadFirstPage(url, firstPageDom) {
        this.state.firstPageDom = firstPageDom;
        this.state.chapterListUrl = url;
        let chapterUrlsUI = new ChapterUrlsUI(this);
        this.setChapterUrlsUI(chapterUrlsUI);
        this.userPreferences.setReadingListCheckbox(url);

        try {
            let chapters = await this.getChapterUrls(firstPageDom, chapterUrlsUI);
            chapters = await this.expandChapterListFromCurrentPage(url, firstPageDom, chapters, chapterUrlsUI);
            if (this.userPreferences.chaptersPageInChapterList.value) {
                chapters = this.addFirstPageUrlToWebPages(url, firstPageDom, chapters);
            }
            chapters = this.cleanWebPageUrls(chapters);
            chapters?.forEach(chapter => chapter.title = chapter.title?.trim());
            await this.tryDeselectOldChapters(url, chapters);
            this.preselectCurrentChapter(url, firstPageDom, chapters);
            this.state.setPagesToFetch(chapters);
            chapterUrlsUI.populateChapterUrlsTable(chapters);
            let currentChapter = this.findChapterByUrl(url, chapters);
            if (currentChapter != null) {
                currentChapter.rawDom = firstPageDom;
                this.updateLoadState(currentChapter);
            }
            if (0 < chapters.length) {
                ProgressBar.setValue(0);
            }
            chapterUrlsUI.connectButtonHandlers();
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    async tryDeselectOldChapters(url, chapters) {
        if (this.userPreferences?.readingList == null) {
            return;
        }

        try {
            await Promise.race([
                this.userPreferences.readingList.deselectOldChapters(url, chapters),
                util.sleep(750)
            ]);
        } catch {
            // Best-effort only. Never block initial chapter rendering on reading list state.
        }
    }

    async expandChapterListFromCurrentPage(url, firstPageDom, chapters, chapterUrlsUI) {
        if (!this.shouldAutoExpandChapterList(url, firstPageDom, chapters)) {
            return chapters;
        }

        let discoveredChapters = new Map();
        let pendingPages = [{ url: url, dom: firstPageDom }];
        let visitedUrls = new Set();

        while (pendingPages.length !== 0) {
            let pending = pendingPages.shift();
            let normalizedUrl = util.normalizeUrlForCompare(pending.url);
            if (visitedUrls.has(normalizedUrl)) {
                continue;
            }
            visitedUrls.add(normalizedUrl);

            let pageDom = pending.dom;
            if (pageDom == null) {
                await this.rateLimitDelay();
                pageDom = (await HttpClient.wrapFetch(pending.url)).responseXML;
            }

            let partialChapters = await this.getChapterUrls(pageDom, chapterUrlsUI);
            partialChapters = this.ensureCurrentPageIncludedInChapterList(pending.url, pageDom, partialChapters);
            partialChapters = this.cleanWebPageUrls(partialChapters);
            partialChapters.forEach((chapter) => this.mergeDiscoveredChapter(discoveredChapters, chapter));

            let adjacentUrls = this.findAdjacentChapterUrls(pageDom, pending.url);
            adjacentUrls.forEach((adjacentUrl) => {
                let adjacentKey = util.normalizeUrlForCompare(adjacentUrl);
                if (!visitedUrls.has(adjacentKey)) {
                    pendingPages.push({ url: adjacentUrl, dom: null });
                }
            });
        }

        if (discoveredChapters.size === 0) {
            return chapters;
        }
        return this.sortAutoDiscoveredChapters([...discoveredChapters.values()]);
    }

    shouldAutoExpandChapterList(url, firstPageDom, chapters = []) {
        if (util.isNullOrEmpty(url)) {
            return false;
        }
        if (!Array.isArray(chapters)) {
            return true;
        }
        let currentChapter = this.findChapterByUrl(url, chapters);
        if (currentChapter == null) {
            return this.findAdjacentChapterUrls(firstPageDom, url).length !== 0;
        }
        return chapters.length <= 3;
    }

    sortAutoDiscoveredChapters(chapters = []) {
        let chapterNumbers = chapters.map(chapter => util.extractChapterNumber(chapter));
        let canSortByChapterNumber = (0 < chapterNumbers.length) && chapterNumbers.every(number => number != null);
        if (!canSortByChapterNumber) {
            return chapters;
        }
        return chapters.sort((left, right) => {
            let leftNumber = util.extractChapterNumber(left);
            let rightNumber = util.extractChapterNumber(right);
            if (leftNumber !== rightNumber) {
                return leftNumber - rightNumber;
            }
            return (left.title ?? "").localeCompare(right.title ?? "");
        });
    }

    ensureCurrentPageIncludedInChapterList(url, dom, chapters = []) {
        let currentChapter = this.findChapterByUrl(url, chapters);
        if (currentChapter != null) {
            return chapters;
        }
        return [{
            sourceUrl: url,
            title: this.extractTitle(dom)
        }].concat(chapters ?? []);
    }

    mergeDiscoveredChapter(discoveredChapters, chapter) {
        if ((chapter == null) || util.isNullOrEmpty(chapter.sourceUrl)) {
            return;
        }
        let key = util.normalizeUrlForCompare(chapter.sourceUrl);
        let existingChapter = discoveredChapters.get(key);
        if (existingChapter == null) {
            discoveredChapters.set(key, chapter);
            return;
        }

        let mergedChapter = {
            ...existingChapter,
            ...chapter
        };
        if (util.isNullOrEmpty(mergedChapter.title)) {
            mergedChapter.title = existingChapter.title ?? chapter.title ?? "";
        }
        mergedChapter.isIncludeable = existingChapter.isIncludeable ?? chapter.isIncludeable;
        discoveredChapters.set(key, mergedChapter);
    }

    findChapterByUrl(url, chapters = []) {
        let normalizedUrl = util.normalizeUrlForCompare(url);
        return chapters.find(chapter => util.normalizeUrlForCompare(chapter.sourceUrl) === normalizedUrl) ?? null;
    }

    preselectCurrentChapter(url, firstPageDom, chapters = []) {
        let currentChapter = this.findChapterByUrl(url, chapters);
        if ((currentChapter == null) || !this.shouldPreselectCurrentChapter(firstPageDom, currentChapter, chapters)) {
            return;
        }

        chapters.forEach((chapter) => {
            chapter.isIncludeable = util.normalizeUrlForCompare(chapter.sourceUrl)
                === util.normalizeUrlForCompare(currentChapter.sourceUrl);
        });
    }

    shouldPreselectCurrentChapter(firstPageDom, currentChapter, chapters = []) {
        if ((currentChapter == null) || (chapters.length <= 1)) {
            return false;
        }
        if (this.findAdjacentChapterUrls(firstPageDom, currentChapter.sourceUrl).length !== 0) {
            return true;
        }
        return util.extractChapterNumber(currentChapter) != null;
    }

    findAdjacentChapterUrls(dom, currentUrl) {
        if (dom == null) {
            return [];
        }

        let currentKey = util.normalizeUrlForCompare(currentUrl);
        let matches = new Map();
        let directionMatchers = [
            {
                direction: "previous",
                rel: "prev",
                patterns: [/\bprev(?:ious)?\b/i, /\bolder\b/i, /\bprecedent\b/i, /\bpr[eé]c[eé]dent\b/i, /\bchapitre pr[eé]c[eé]dent\b/i]
            },
            {
                direction: "next",
                rel: "next",
                patterns: [/\bnext\b/i, /\bnewer\b/i, /\bsuivant\b/i, /\bchapitre suivant\b/i]
            }
        ];

        for (let link of dom.querySelectorAll("a[href]")) {
            let normalizedHref = util.normalizeUrlForCompare(link.href);
            if ((normalizedHref === currentKey) || !util.isUrl(link.href)) {
                continue;
            }

            let text = [
                link.textContent ?? "",
                link.getAttribute("rel") ?? "",
                link.getAttribute("aria-label") ?? "",
                link.getAttribute("title") ?? "",
                link.className ?? "",
                link.id ?? "",
                link.parentElement?.className ?? ""
            ].join(" ").replace(/\s+/g, " ").trim();

            for (let matcher of directionMatchers) {
                let score = 0;
                let hasDirectionSignal = false;
                if ((link.getAttribute("rel") || "").toLowerCase().includes(matcher.rel)) {
                    score += 100;
                    hasDirectionSignal = true;
                }
                if (matcher.patterns.some(pattern => pattern.test(text))) {
                    score += 50;
                    hasDirectionSignal = true;
                }
                if (hasDirectionSignal && (util.extractChapterNumber({ title: text, sourceUrl: link.href }) != null)) {
                    score += 10;
                }
                if (!hasDirectionSignal || (score === 0)) {
                    continue;
                }

                let existing = matches.get(matcher.direction);
                if ((existing == null) || (existing.score < score)) {
                    matches.set(matcher.direction, { url: link.href, score: score });
                }
            }
        }

        return [...matches.values()].map(match => match.url);
    }

    cleanWebPageUrls(webPages) {
        let foundUrls = new Set();
        let isUnique = function(webPage) {
            let unique = !foundUrls.has(webPage.sourceUrl);
            if (unique) {
                foundUrls.add(webPage.sourceUrl);
            }
            return unique;
        };

        return webPages
            .map(this.fixupImgurGalleryUrl)
            .filter(p => util.isUrl(p.sourceUrl))
            .filter(isUnique);
    }

    fixupImgurGalleryUrl(webPage) {
        webPage.sourceUrl = Imgur.fixupImgurGalleryUrl(webPage.sourceUrl);
        return webPage;
    }

    addFirstPageUrlToWebPages(url, firstPageDom, webPages) {
        let present = webPages.find(e => e.sourceUrl === url);
        if (present)
        {
            return webPages;
        } else {
            return [{
                sourceUrl:  url,
                title: this.extractTitle(firstPageDom)
            }].concat(webPages);
        }
    }

    onFetchChaptersClicked() {
        if (0 == this.state.webPages.size) {
            ErrorLog.showErrorMessage(UIText.Error.noChaptersFoundAndFetchClicked);
        } else {
            this.fetchWebPages();
        }
    }

    fetchContent() {
        return this.fetchWebPages();
    }

    setUiToShowLoadingProgress(length, loadedCount = 0) {
        main.getPackEpubButton().disabled = true;
        ProgressBar.setMax(Math.max(length, 1));
        ProgressBar.setValue(Math.min(loadedCount, length));
    }

    async fetchWebPages() {
        let allIncludedPages = [...this.state.webPages.values()].filter(c => c.isIncludeable);
        if (allIncludedPages.length === 0) {
            return Promise.reject(new Error("No chapters found."));
        }

        let pagesToFetch = allIncludedPages.filter(c => (c.rawDom == null) && (c.error == null));
        let loadedCount = allIncludedPages.length - pagesToFetch.length;
        this.setUiToShowLoadingProgress(allIncludedPages.length, loadedCount);

        if (loadedCount === 0) {
            this.imageCollector.reset();
            this.imageCollector.setCoverImageUrl(CoverImageUI.getCoverImageUrl());
        }

        if (pagesToFetch.length === 0) {
            return;
        }

        await this.addParsersToPages(pagesToFetch);
        let index = 0;
        try
        {
            let group = this.groupPagesToFetch(pagesToFetch, index);
            while (0 < group.length) {
                await Promise.all(group.map(async (webPage) => this.fetchWebPageContent(webPage)));
                index += group.length;
                group = this.groupPagesToFetch(pagesToFetch, index);
                if (util.sleepController.signal.aborted) {
                    break;
                }
            }
        }
        catch (err)
        {
            if (!util.isAbortError(err)) {
                ErrorLog.log(err);
            }
        }
    }

    async addParsersToPages(pagesToFetch) {
        parserFactory.addParsersToPages(this, pagesToFetch);
    }

    groupPagesToFetch(webPages, index) {
        return webPages.slice(index, index + this.maxSimultanousFetchSize);
    }

    async fetchWebPageContent(webPage) {
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_SLEEPING);
        await this.rateLimitDelay();
        if (util.sleepController.signal.aborted) {
            throw new DOMException("The user aborted a request.", "AbortError");
        }
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_DOWNLOADING);
        let pageParser = webPage.parser;
        try {
            let webPageDom = await pageParser.fetchChapter(webPage.sourceUrl);
            if (util.sleepController.signal.aborted) {
                throw new DOMException("The user aborted a request.", "AbortError");
            }
            delete webPage.error;
            webPage.rawDom = webPageDom;
            pageParser.preprocessRawDom(webPageDom);
            pageParser.removeUnusedElementsToReduceMemoryConsumption(webPageDom);
            let content = pageParser.findContent(webPage.rawDom);
            if (content == null) {
                let errorMsg = UIText.Error.errorContentNotFound(webPage.sourceUrl);
                throw new Error(errorMsg);
            }
            return pageParser.fetchImagesUsedInDocument(content, webPage);
        } catch (error) {
            if (util.isAbortError(error)) {
                throw error;
            }
            if (this.userPreferences.skipChaptersThatFailFetch.value) {
                ErrorLog.log(error);
                webPage.error = error;
            } else {
                webPage.isIncludeable = false;
                throw error;
            }
        }
    }

    async fetchImagesUsedInDocument(content, webPage) {
        let revisedContent = await this.imageCollector.preprocessImageTags(content, webPage.sourceUrl);
        this.imageCollector.findImagesUsedInDocument(revisedContent);
        await this.imageCollector.fetchImages(() => { }, webPage.sourceUrl);
        this.updateLoadState(webPage);
    }

    /**
    * default implementation
    * derived classes override if need to do something to fetched DOM before
    * normal processing steps
    */
    preprocessRawDom(webPageDom) { // eslint-disable-line no-unused-vars
    }

    removeUnusedElementsToReduceMemoryConsumption(webPageDom) {
        util.removeElements(webPageDom.querySelectorAll("select, iframe"));
    }

    // Hook if need to chase hyperlinks in page to get all chapter content
    async fetchChapter(url) {
        return (await HttpClient.wrapFetch(url)).responseXML;
    }

    updateReadingList() {
        this.userPreferences.readingList.update(
            this.state.chapterListUrl,
            [...this.state.webPages.values()]
        );
    }

    updateLoadState(webPage) {
        ChapterUrlsUI.showDownloadState(webPage.row, ChapterUrlsUI.DOWNLOAD_STATE_LOADED);
        ProgressBar.updateValue(1);
    }

    // Hook point, when need to do something when "Pack EPUB" pressed
    onStartCollecting() {
    }    

    fixupHyperlinksInEpubItems(epubItems) {
        let targets = this.sourceUrlToEpubItemUrl(epubItems);
        for (let item of epubItems) {
            for (let link of item.getHyperlinks().filter(this.isUnresolvedHyperlink)) {
                if (!this.hyperlinkToEpubItemUrl(link, targets)) {
                    this.makeHyperlinkAbsolute(link);
                }
            }
        }
    }

    sourceUrlToEpubItemUrl(epubItems) {
        let targets = new Map();
        for (let item of epubItems) {
            let key = util.normalizeUrlForCompare(item.sourceUrl);
            
            // Some source URLs may generate multiple epub items.
            // In that case, want FIRST epub item
            if (!targets.has(key)) {
                targets.set(key, util.makeRelative(item.getZipHref()));
            }
        }
        return targets;
    }

    isUnresolvedHyperlink(link) {
        let href = link.getAttribute("href");
        if (href == null) {
            return false;
        }
        return !href.startsWith("#") &&
            !href.startsWith("../Text/");
    }

    hyperlinkToEpubItemUrl(link, targets) {
        let key = util.normalizeUrlForCompare(link.href);
        let targetInEpub = targets.has(key);
        if (targetInEpub) {
            link.href = targets.get(key) + link.hash;
        }
        return targetInEpub;
    }

    makeHyperlinkAbsolute(link) {
        if (link.href !== link.getAttribute("href")) {
            link.href = link.href;       // eslint-disable-line no-self-assign
        }
    }

    disabled() {
        return null;
    }

    tagAuthorNotes(elements) {
        for (let e of elements) {
            e.classList.add("webToEpub-author-note");
        }
    }

    tagAuthorNotesBySelector(element, selector) {
        let notes = element.querySelectorAll(selector);
        if (this.userPreferences.removeAuthorNotes.value) {
            util.removeElements(notes);
        } else {
            this.tagAuthorNotes(notes);
        }
    }

    static makeEmptyDocForContent(baseUrl) {
        let dom = document.implementation.createHTMLDocument("");
        if (baseUrl != null) {
            util.setBaseTag(baseUrl, dom);        
        }
        let content = dom.createElement("div");
        content.className = Parser.WEB_TO_EPUB_CLASS_NAME;
        dom.body.appendChild(content);
        return {
            dom: dom,
            content: content 
        };
    }

    static findConstrutedContent(dom) {
        return dom.querySelector("div." + Parser.WEB_TO_EPUB_CLASS_NAME);
    }

    static addTextToChapterContent(newDoc, contentText) {
        let lines = contentText
            .replace(/\r/g, "\n")
            .replace(/\n\n/g, "\n")
            .split("\n")
            .filter(s => !util.isNullOrEmpty(s));
        for (let line of lines) {
            let pnode = newDoc.dom.createElement("p");
            pnode.textContent = line;
            newDoc.content.appendChild(pnode);
        }
    }

    async getChapterUrlsFromMultipleTocPages(dom, extractPartialChapterList, getUrlsOfTocPages, chapterUrlsUI)  {
        let chapters = extractPartialChapterList(dom);
        let urlsOfTocPages = getUrlsOfTocPages(dom);
        return await this.getChaptersFromAllTocPages(chapters, extractPartialChapterList, urlsOfTocPages, chapterUrlsUI);
    }

    getRateLimit()
    {
        let manualDelayPerChapterValue = (!isNaN(parseInt(this.userPreferences.manualDelayPerChapter.value)))?parseInt(this.userPreferences.manualDelayPerChapter.value):this.minimumThrottle;
        if (!this.userPreferences.overrideMinimumDelay.value)
        {
            return Math.max(this.minimumThrottle, manualDelayPerChapterValue);
        }
        return manualDelayPerChapterValue;
    }

    async rateLimitDelay() {
        let manualDelayPerChapterValue = this.getRateLimit();
        await util.sleep(manualDelayPerChapterValue);
    }

    async getChaptersFromAllTocPages(chapters, extractPartialChapterList, urlsOfTocPages, chapterUrlsUI, wrapOptions)  {
        if (0 < chapters.length) {
            chapterUrlsUI.showTocProgress(chapters);
        }
        for (let url of urlsOfTocPages) {
            await this.rateLimitDelay();
            let newDom = (await HttpClient.wrapFetch(url, wrapOptions)).responseXML;
            let partialList = extractPartialChapterList(newDom);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
        }
        return chapters;
    }

    async walkTocPages(dom, chaptersFromDom, nextTocPageUrl, chapterUrlsUI) {
        let chapters = chaptersFromDom(dom);
        chapterUrlsUI.showTocProgress(chapters);
        let url = nextTocPageUrl(dom, chapters, chapters);
        while (url != null) {
            await this.rateLimitDelay();
            dom = (await HttpClient.wrapFetch(url)).responseXML;
            let partialList = chaptersFromDom(dom);
            chapterUrlsUI.showTocProgress(partialList);
            chapters = chapters.concat(partialList);
            url = nextTocPageUrl(dom, chapters, partialList);
        }
        return chapters;
    }

    moveFootnotes(dom, content, footnotes) {
        if (0 < footnotes.length) {
            let list = dom.createElement("ol");
            for (let f of footnotes) {
                let item = dom.createElement("li");
                f.removeAttribute("style");
                item.appendChild(f);
                list.appendChild(item);
            }
            let header = dom.createElement("h2");
            header.appendChild(dom.createTextNode("Footnotes"));
            content.appendChild(header);
            content.appendChild(list);
        }
    }

    async walkPagesOfChapter(url, moreChapterTextUrl) {
        let dom = (await HttpClient.wrapFetch(url)).responseXML;
        let count = 2;
        let nextUrl = moreChapterTextUrl(dom, url, count);
        let oldContent = this.findContent(dom);
        while (nextUrl != null) {
            await this.rateLimitDelay();
            let nextDom = (await HttpClient.wrapFetch(nextUrl)).responseXML;
            let newContent = this.findContent(nextDom);
            nextUrl = moreChapterTextUrl(nextDom, url, ++count);
            oldContent.appendChild(dom.createElement("br"));
            util.moveChildElements(newContent, oldContent);
        }
        return dom;
    }    
}

Parser.WEB_TO_EPUB_CLASS_NAME = "webToEpubContent";
