"use strict";

parserFactory.register("lightnovelfr.com", () => new LightnovelfrParser());

class LightnovelfrParser extends Parser {
    constructor() {
        super();
        this.seriesContextByUrl = new Map();
        this.chapterListByCategory = new Map();
        this.postSitemapUrlsPromise = null;
        this.chapterListByStorySlug = new Map();
    }

    async getChapterUrls(dom) {
        let chaptersFromCurrentDom = this.extractChapterUrlsFromDom(dom);
        if (chaptersFromCurrentDom.length !== 0) {
            return chaptersFromCurrentDom;
        }

        let chaptersFromNavigation = this.extractChapterUrlsFromNavigation(dom);
        if (chaptersFromNavigation.length !== 0) {
            return chaptersFromNavigation;
        }

        let domSeriesContext = this.createSeriesContextFromDom(dom);
        let seriesContext = null;
        try {
            seriesContext = await this.getSeriesContext(dom);
        } catch {
            seriesContext = null;
        }
        seriesContext ??= domSeriesContext;

        let storyPageUrl = seriesContext?.storyPageUrl ?? domSeriesContext?.storyPageUrl ?? null;
        if (!util.isNullOrEmpty(storyPageUrl)) {
            try {
                let chaptersFromStoryPage = await this.fetchChapterListFromStoryPage(storyPageUrl);
                if (chaptersFromStoryPage.length !== 0) {
                    return chaptersFromStoryPage;
                }
            } catch {
                // continue with API fallback
            }
        }

        let storySlug = this.extractStorySlugFromContext(seriesContext, dom);
        if (!util.isNullOrEmpty(storySlug)) {
            try {
                let chaptersFromSitemaps = await this.fetchChapterListFromSitemaps(new URL(dom.baseURI).origin, storySlug);
                if (chaptersFromSitemaps.length !== 0) {
                    return chaptersFromSitemaps;
                }
            } catch {
                // continue with API fallback
            }
        }

        if (seriesContext?.categoryId != null) {
            try {
                let chaptersFromApi = await this.fetchChapterListFromCategory(seriesContext.apiBaseUrl, seriesContext.categoryId);
                if (chaptersFromApi.length !== 0) {
                    return chaptersFromApi;
                }
            } catch {
                // fall through to empty result
            }
        }

        return chaptersFromCurrentDom;
    }

    shouldAutoExpandChapterList(url, firstPageDom, chapters = []) {
        if (this.extractChapterUrlsFromDom(firstPageDom).length === 0) {
            return false;
        }
        return super.shouldAutoExpandChapterList(url, firstPageDom, chapters);
    }

    linkToChapter(link) {
        return ({
            sourceUrl:  link.href,
            title: this.extractLinkTitle(link)
        });
    }

    findContent(dom) {
        return dom.querySelector(".entry-content")
            || dom.querySelector(".postbody");
    }

    extractTitleImpl(dom) {
        return this.extractSeriesTitleFromDom(dom) ?? super.extractTitleImpl(dom);
    }

    findChapterTitle(dom) {
        return dom.querySelector(".epheader h1")
            || dom.querySelector(".epheader .entry-title")
            || dom.querySelector("h1");
    }

    findCoverImageUrl(dom) {
        return util.getFirstImgSrc(dom, ".sertothumb");
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll(".sersys")];
    }

    extractChapterUrlsFromDom(dom) {
        let links = [...dom.querySelectorAll(".postbody .bixbox .listupd article.bs a[itemprop='url'][href], .postbody .bixbox .listupd .bsx a[itemprop='url'][href]")];
        if (links.length === 0) {
            links = [...dom.querySelectorAll(".eplister a[href]")];
        }
        if (links.length === 0) {
            links = [...dom.querySelectorAll(".listupd .bsx a[itemprop='url'][href], .bixbox .bsx a[itemprop='url'][href]")];
        }

        let seenUrls = new Set();
        let chapters = links
            .map(link => this.linkToChapter(link))
            .filter(chapter => !util.isNullOrEmpty(chapter?.sourceUrl))
            .filter(chapter => {
                let key = util.normalizeUrlForCompare(chapter.sourceUrl);
                if (seenUrls.has(key)) {
                    return false;
                }
                seenUrls.add(key);
                return true;
            });

        return this.sortChapters(chapters);
    }

    extractChapterUrlsFromNavigation(dom) {
        if (dom == null || util.isNullOrEmpty(dom.baseURI)) {
            return [];
        }

        let currentChapter = {
            sourceUrl: dom.baseURI,
            title: this.findChapterTitle(dom)?.textContent?.trim() ?? this.extractSeriesTitleFromDom(dom) ?? ""
        };

        let adjacentChapters = this.findAdjacentChapterUrls(dom, dom.baseURI)
            .map(url => ({
                sourceUrl: url,
                title: this.decodeChapterTitleFromUrl(url, this.extractStorySlugFromChapterSlug(this.extractSlugFromUrl(new URL(dom.baseURI))) ?? "")
            }));

        return this.sortChapters(this.deduplicateChapters([currentChapter, ...adjacentChapters]));
    }

    extractLinkTitle(link) {
        let chapterNumber = link.querySelector(".epl-num")?.textContent?.trim();
        let chapterTitle = link.querySelector(".epl-title")?.textContent?.trim();
        let combined = [chapterNumber, chapterTitle]
            .filter(text => !util.isNullOrEmpty(text))
            .join(" ")
            .trim();
        if (!util.isNullOrEmpty(combined)) {
            return combined;
        }

        return (link.getAttribute("title") || link.textContent || "").trim();
    }

    extractSeriesTitleFromDom(dom) {
        let categoryTitle = dom.querySelector("meta[property='article:section']")?.getAttribute("content")?.trim();
        if (!util.isNullOrEmpty(categoryTitle)) {
            return categoryTitle;
        }

        let pageTitle = dom.querySelector(".releases h1 span, .releases h1");
        if (!util.isNullOrEmpty(pageTitle?.textContent)) {
            return pageTitle.textContent.trim();
        }

        let schemaTitle = this.extractSeriesTitleFromSchema(dom);
        if (!util.isNullOrEmpty(schemaTitle)) {
            return schemaTitle;
        }

        return null;
    }

    extractSeriesTitleFromSchema(dom) {
        let schemas = [...dom.querySelectorAll("script[type='application/ld+json']")];
        for (let schema of schemas) {
            let rawText = schema.textContent?.trim();
            if (util.isNullOrEmpty(rawText)) {
                continue;
            }

            try {
                let json = JSON.parse(rawText);
                let graph = Array.isArray(json?.["@graph"]) ? json["@graph"] : [json];
                for (let node of graph) {
                    let title = node?.articleSection?.trim?.();
                    if (!util.isNullOrEmpty(title)) {
                        return title;
                    }
                }
            } catch {
                // ignore invalid schema payloads
            }
        }
        return null;
    }

    async getSeriesContext(dom) {
        let pageUrl = dom?.baseURI;
        if (util.isNullOrEmpty(pageUrl)) {
            return null;
        }

        let key = util.normalizeUrlForCompare(pageUrl);
        if (!this.seriesContextByUrl.has(key)) {
            this.seriesContextByUrl.set(key, this.resolveSeriesContext(dom));
        }
        return this.seriesContextByUrl.get(key);
    }

    async resolveSeriesContext(dom) {
        let pageUrl = new URL(dom.baseURI);
        let domSeriesContext = this.createSeriesContextFromDom(dom);
        let jsonApiUrl = this.extractJsonApiUrl(dom);
        if (!util.isNullOrEmpty(jsonApiUrl)) {
            if (jsonApiUrl.includes("/wp-json/wp/v2/posts/")) {
                let postContext = await this.fetchSeriesContextFromPostApiUrl(jsonApiUrl);
                if (postContext != null) {
                    return this.mergeSeriesContext(domSeriesContext, postContext);
                }
            }
            if (jsonApiUrl.includes("/wp-json/wp/v2/categories/")) {
                let categoryContext = await this.fetchSeriesContextFromCategoryApiUrl(jsonApiUrl);
                if (categoryContext != null) {
                    return this.mergeSeriesContext(domSeriesContext, categoryContext);
                }
            }
        }

        let slug = this.extractSlugFromUrl(pageUrl);
        if (util.isNullOrEmpty(slug)) {
            return domSeriesContext;
        }
        let postContext = await this.fetchSeriesContextFromPostSlug(pageUrl.origin, slug);
        if (postContext != null) {
            return this.mergeSeriesContext(domSeriesContext, postContext);
        }

        let categoryContext = await this.fetchSeriesContextFromCategorySlug(pageUrl.origin, slug);
        return this.mergeSeriesContext(domSeriesContext, categoryContext);
    }

    createSeriesContextFromDom(dom) {
        let pageUrl = new URL(dom.baseURI);
        let title = this.extractSeriesTitleFromDom(dom);
        let storyPageUrl = this.inferStoryPageUrl(pageUrl, title);
        if (util.isNullOrEmpty(title) && util.isNullOrEmpty(storyPageUrl)) {
            return null;
        }

        return {
            apiBaseUrl: pageUrl.origin,
            categoryId: null,
            title: title,
            storyPageUrl: storyPageUrl
        };
    }

    mergeSeriesContext(domSeriesContext, fetchedContext) {
        if (domSeriesContext == null) {
            return fetchedContext;
        }
        if (fetchedContext == null) {
            return domSeriesContext;
        }

        return {
            apiBaseUrl: fetchedContext.apiBaseUrl ?? domSeriesContext.apiBaseUrl,
            categoryId: fetchedContext.categoryId ?? domSeriesContext.categoryId,
            title: fetchedContext.title ?? domSeriesContext.title,
            storyPageUrl: fetchedContext.storyPageUrl ?? domSeriesContext.storyPageUrl
        };
    }

    extractJsonApiUrl(dom) {
        return dom.querySelector("link[rel='alternate'][title='JSON'][href*='/wp-json/wp/v2/']")?.href ?? null;
    }

    extractSlugFromUrl(url) {
        return url.pathname.split("/").filter(segment => segment !== "").pop() ?? null;
    }

    async fetchSeriesContextFromPostApiUrl(apiUrl) {
        let response = await HttpClient.fetchJson(`${apiUrl}?_embed=1`);
        let post = response.json;
        if (post == null) {
            return null;
        }

        let category = this.extractEmbeddedCategory(post);
        let categoryId = category?.id ?? post.categories?.[0] ?? null;
        if (categoryId == null) {
            return null;
        }

        return {
            apiBaseUrl: new URL(apiUrl).origin,
            categoryId: categoryId,
            title: category?.name ?? this.decodeHtml(post.title?.rendered),
            storyPageUrl: category?.link ?? this.buildStoryPageUrl(new URL(apiUrl).origin, category?.slug ?? category?.name)
        };
    }

    async fetchSeriesContextFromPostSlug(apiBaseUrl, slug) {
        let apiUrl = `${apiBaseUrl}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`;
        let response = await HttpClient.fetchJson(apiUrl);
        let post = response.json?.[0];
        if (post == null) {
            return null;
        }

        let category = this.extractEmbeddedCategory(post);
        let categoryId = category?.id ?? post.categories?.[0] ?? null;
        if (categoryId == null) {
            return null;
        }

        return {
            apiBaseUrl: apiBaseUrl,
            categoryId: categoryId,
            title: category?.name ?? this.decodeHtml(post.title?.rendered),
            storyPageUrl: category?.link ?? this.buildStoryPageUrl(apiBaseUrl, category?.slug ?? category?.name)
        };
    }

    async fetchSeriesContextFromCategorySlug(apiBaseUrl, slug) {
        let apiUrl = `${apiBaseUrl}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`;
        let response = await HttpClient.fetchJson(apiUrl);
        let category = response.json?.[0];
        if (category == null) {
            return null;
        }

        return {
            apiBaseUrl: apiBaseUrl,
            categoryId: category.id,
            title: category.name,
            storyPageUrl: category.link ?? this.buildStoryPageUrl(apiBaseUrl, category.slug ?? category.name)
        };
    }

    async fetchSeriesContextFromCategoryApiUrl(apiUrl) {
        let response = await HttpClient.fetchJson(apiUrl);
        let category = response.json;
        if (category == null) {
            return null;
        }

        return {
            apiBaseUrl: new URL(apiUrl).origin,
            categoryId: category.id,
            title: category.name,
            storyPageUrl: category.link ?? this.buildStoryPageUrl(new URL(apiUrl).origin, category.slug ?? category.name)
        };
    }

    async fetchChapterListFromStoryPage(storyPageUrl) {
        await this.rateLimitDelay();
        let storyDom = (await HttpClient.wrapFetch(storyPageUrl)).responseXML;
        return this.extractChapterUrlsFromDom(storyDom);
    }

    buildStoryPageUrl(apiBaseUrl, slugOrTitle) {
        if (util.isNullOrEmpty(slugOrTitle)) {
            return null;
        }
        let slug = this.slugify(slugOrTitle);
        if (util.isNullOrEmpty(slug)) {
            return null;
        }
        return `${apiBaseUrl}/${slug}/`;
    }

    inferStoryPageUrl(pageUrl, seriesTitle) {
        let storySlug = this.extractStorySlugFromChapterSlug(this.extractSlugFromUrl(pageUrl));
        if (!util.isNullOrEmpty(storySlug)) {
            return `${pageUrl.origin}/${storySlug}/`;
        }

        if (!util.isNullOrEmpty(seriesTitle)) {
            return this.buildStoryPageUrl(pageUrl.origin, seriesTitle);
        }

        return null;
    }

    extractStorySlugFromChapterSlug(chapterSlug) {
        if (util.isNullOrEmpty(chapterSlug)) {
            return null;
        }

        let strippedSlug = chapterSlug
            .replace(/-(chapitre|chapter)-?\d+(?:-[a-z]{2,4})?$/i, "")
            .replace(/-\d+(?:-[a-z]{2,4})?$/i, "");

        if (util.isNullOrEmpty(strippedSlug) || strippedSlug === chapterSlug) {
            return null;
        }

        return strippedSlug;
    }

    slugify(text) {
        return text
            .toString()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    extractStorySlugFromContext(seriesContext, dom) {
        let fromStoryPage = this.extractStorySlugFromStoryPageUrl(seriesContext?.storyPageUrl);
        if (!util.isNullOrEmpty(fromStoryPage)) {
            return fromStoryPage;
        }

        let pageUrl = dom?.baseURI ? new URL(dom.baseURI) : null;
        let fromChapterUrl = pageUrl == null ? null : this.extractStorySlugFromChapterSlug(this.extractSlugFromUrl(pageUrl));
        if (!util.isNullOrEmpty(fromChapterUrl)) {
            return fromChapterUrl;
        }

        if (!util.isNullOrEmpty(seriesContext?.title)) {
            return this.slugify(seriesContext.title);
        }

        return null;
    }

    extractStorySlugFromStoryPageUrl(storyPageUrl) {
        if (util.isNullOrEmpty(storyPageUrl)) {
            return null;
        }
        let pathname = new URL(storyPageUrl).pathname;
        return pathname.split("/").filter(segment => segment !== "").pop() ?? null;
    }

    async fetchChapterListFromSitemaps(apiBaseUrl, storySlug) {
        let cacheKey = `${apiBaseUrl}|${storySlug}`;
        if (!this.chapterListByStorySlug.has(cacheKey)) {
            this.chapterListByStorySlug.set(cacheKey, this.loadChapterListFromSitemaps(apiBaseUrl, storySlug));
        }
        return this.chapterListByStorySlug.get(cacheKey);
    }

    async loadChapterListFromSitemaps(apiBaseUrl, storySlug) {
        let sitemapUrls = await this.getPostSitemapUrls(apiBaseUrl);
        if (sitemapUrls.length === 0) {
            return [];
        }

        let chapterUrlPattern = new RegExp(`/${storySlug}(?:-|/)`, "i");
        let chapters = [];
        for (let sitemapUrl of sitemapUrls) {
            let sitemapText = await HttpClient.fetchText(sitemapUrl);
            let sitemapDom = new DOMParser().parseFromString(sitemapText, "application/xml");
            let urls = [...sitemapDom.querySelectorAll("url > loc")]
                .map(node => node.textContent?.trim())
                .filter(url => !util.isNullOrEmpty(url))
                .filter(url => chapterUrlPattern.test(new URL(url).pathname))
                .filter(url => !new URL(url).pathname.endsWith(`/${storySlug}/`));

            chapters.push(...urls.map(url => ({
                sourceUrl: url,
                title: this.decodeChapterTitleFromUrl(url, storySlug)
            })));

            if (chapters.length !== 0) {
                break;
            }
        }

        return this.sortChapters(this.deduplicateChapters(chapters));
    }

    async getPostSitemapUrls(apiBaseUrl) {
        if (this.postSitemapUrlsPromise == null) {
            this.postSitemapUrlsPromise = this.loadPostSitemapUrls(apiBaseUrl);
        }
        return this.postSitemapUrlsPromise;
    }

    async loadPostSitemapUrls(apiBaseUrl) {
        let sitemapText = await HttpClient.fetchText(`${apiBaseUrl}/wp-sitemap.xml`);
        let sitemapDom = new DOMParser().parseFromString(sitemapText, "application/xml");
        return [...sitemapDom.querySelectorAll("sitemap > loc")]
            .map(node => node.textContent?.trim())
            .filter(url => !util.isNullOrEmpty(url))
            .filter(url => /\/post-sitemap\d*\.xml$/i.test(url));
    }

    decodeChapterTitleFromUrl(url, storySlug) {
        let slug = this.extractSlugFromUrl(new URL(url)) ?? "";
        let suffix = slug.replace(new RegExp(`^${storySlug}-?`, "i"), "");
        if (util.isNullOrEmpty(suffix)) {
            return slug;
        }

        return suffix
            .replace(/-/g, " ")
            .replace(/\bfr\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    extractEmbeddedCategory(post) {
        let termGroups = post?._embedded?.["wp:term"] ?? [];
        for (let termGroup of termGroups) {
            let category = termGroup.find(term => term?.taxonomy === "category");
            if (category != null) {
                return category;
            }
        }
        return null;
    }

    async fetchChapterListFromCategory(apiBaseUrl, categoryId) {
        let cacheKey = `${apiBaseUrl}|${categoryId}`;
        if (!this.chapterListByCategory.has(cacheKey)) {
            this.chapterListByCategory.set(
                cacheKey,
                this.loadChapterListFromCategory(apiBaseUrl, categoryId)
            );
        }
        return this.chapterListByCategory.get(cacheKey);
    }

    async loadChapterListFromCategory(apiBaseUrl, categoryId) {
        let chapters = [];
        let totalPages = 1;

        for (let page = 1; page <= totalPages; page += 1) {
            let apiUrl = `${apiBaseUrl}/wp-json/wp/v2/posts?categories=${categoryId}&per_page=100&page=${page}&order=asc&orderby=date`;
            let response = await HttpClient.fetchJson(apiUrl);
            let pageItems = Array.isArray(response.json) ? response.json : [];
            chapters.push(...pageItems.map(post => this.postToChapter(post)));

            let headerValue = response.response?.headers?.get("X-WP-TotalPages");
            let parsedTotalPages = parseInt(headerValue, 10);
            if (Number.isFinite(parsedTotalPages) && (0 < parsedTotalPages)) {
                totalPages = parsedTotalPages;
            } else if (pageItems.length < 100) {
                totalPages = page;
            } else {
                totalPages = page + 1;
            }

            if (page < totalPages) {
                await this.rateLimitDelay();
            }
        }

        return this.sortChapters(this.deduplicateChapters(chapters));
    }

    postToChapter(post) {
        return {
            sourceUrl: post?.link,
            title: this.decodeHtml(post?.title?.rendered)
        };
    }

    deduplicateChapters(chapters) {
        let seenUrls = new Set();
        return chapters.filter(chapter => {
            let key = util.normalizeUrlForCompare(chapter?.sourceUrl);
            if (util.isNullOrEmpty(key) || seenUrls.has(key)) {
                return false;
            }
            seenUrls.add(key);
            return true;
        });
    }

    sortChapters(chapters) {
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
            return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" });
        });
    }

    decodeHtml(text) {
        if (util.isNullOrEmpty(text)) {
            return "";
        }

        let parsed = new DOMParser().parseFromString(text, "text/html");
        return parsed.documentElement.textContent.trim();
    }
}
