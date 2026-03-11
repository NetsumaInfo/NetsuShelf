/*
  Parser for chireads.com category/story pages.
*/
"use strict";

parserFactory.register("chireads.com", () => new ChireadsParser());

class ChireadsParser extends WordpressBaseParser {
    constructor() {
        super();
    }

    static findChireadsContentElement(dom) {
        return dom.querySelector("div#content.article-font")
            || dom.querySelector("div#content")
            || dom.querySelector("article div#content")
            || dom.querySelector("div.article-font");
    }

    findContent(dom) {
        return ChireadsParser.findChireadsContentElement(dom) || super.findContent(dom);
    }

    findChapterTitle(dom) {
        return dom.querySelector("div.article-title")
            || dom.querySelector("h1.article-title")
            || super.findChapterTitle(dom);
    }

    extractTitleImpl(dom) {
        return this.extractStoryTitle(dom) ?? super.extractTitleImpl(dom);
    }

    async getChapterUrls(dom) {
        let groupedSections = this.extractGroupedChapterSections(dom);
        let chapterLinks = groupedSections.flatMap(section => section.links);
        let groupInfoByLink = new Map();
        groupedSections.forEach(section => section.links.forEach(link => groupInfoByLink.set(link, section.groupInfo)));
        if (chapterLinks.length === 0) {
            chapterLinks = [...dom.querySelectorAll(".chapitre-table a[href]")];
        }
        if (chapterLinks.length === 0) {
            let storyMenuUrl = this.findStoryMenuUrl(dom);
            if (!util.isNullOrEmpty(storyMenuUrl)) {
                await this.rateLimitDelay();
                let storyDom = (await HttpClient.wrapFetch(storyMenuUrl)).responseXML;
                groupedSections = this.extractGroupedChapterSections(storyDom);
                chapterLinks = groupedSections.flatMap(section => section.links);
                groupInfoByLink = new Map();
                groupedSections.forEach(section => section.links.forEach(link => groupInfoByLink.set(link, section.groupInfo)));
                if (chapterLinks.length === 0) {
                    chapterLinks = [...storyDom.querySelectorAll(".chapitre-table a[href]")];
                }
            }
        }
        if (chapterLinks.length === 0) {
            return super.getChapterUrls(dom);
        }

        let seenUrls = new Set();
        let chapters = chapterLinks
            .map(link => this.linkToChapter(link, groupInfoByLink.get(link)))
            .filter(chapter => chapter != null)
            .filter(chapter => this.isLikelyChapter(chapter))
            .filter(chapter => {
                let key = util.normalizeUrlForCompare(chapter.sourceUrl);
                if (seenUrls.has(key)) {
                    return false;
                }
                seenUrls.add(key);
                return true;
            });

        chapters = this.ensureCurrentChapterIncludedIfMissing(dom, chapters);
        chapters.forEach((chapter, index) => chapter.originalOrderIndex = index);
        chapters.sort((left, right) => this.compareChapterNumber(left, right));
        chapters.forEach(chapter => delete chapter.originalOrderIndex);
        return chapters;
    }

    extractStoryTitle(dom) {
        let storyLink = this.findStoryMenuLink(dom);
        if (!util.isNullOrEmpty(storyLink?.textContent)) {
            return storyLink.textContent.trim();
        }

        let metaTitle = dom.querySelector("meta[property='og:title']")?.getAttribute("content");
        if (!util.isNullOrEmpty(metaTitle)) {
            return metaTitle
                .replace(/\s+français\s*$/i, "")
                .replace(/\s*归档\s*$/u, "")
                .trim();
        }

        let trackingTitle = dom.querySelector("script")?.textContent;
        let trackingMatch = trackingTitle?.match(/content_group1'\s*:\s*'([^']+)'/);
        if (!util.isNullOrEmpty(trackingMatch?.[1])) {
            return trackingMatch[1].trim();
        }

        return null;
    }

    findStoryMenuUrl(dom) {
        return this.findStoryMenuLink(dom)?.href ?? null;
    }

    findStoryMenuLink(dom) {
        return dom.querySelector(".article-book-txt a[href*='/category/translatedtales/']")
            || [...dom.querySelectorAll(".article-function a[href], .newestchapitre a[href]")]
                .find(link => /menu|dernier chapitre/i.test(link.textContent || "") || /\/category\/translatedtales\//i.test(link.href))
            || dom.querySelector("a[href*='/category/translatedtales/']");
    }

    extractGroupedChapterSections(dom) {
        return [...dom.querySelectorAll(".segment-header")]
            .map((header, index) => this.extractSectionGroup(header, index))
            .filter(section => 0 < section.links.length);
    }

    extractSectionGroup(header, index) {
        let content = header?.nextElementSibling;
        let links = [...(content?.querySelectorAll(".chapitre-table a[href]") ?? [])];
        let title = this.extractSectionTitle(header, index);
        return {
            groupInfo: {
                type: "section",
                index: index + 1,
                title: title,
                label: "Section",
                key: `section:${title.toLowerCase()}`,
                source: "native_section"
            },
            links: links
        };
    }

    extractSectionTitle(header, index) {
        let rawTitle = (header?.textContent || "")
            .replace(/\s+/g, " ")
            .replace(/^[>\-+\s]+/, "")
            .replace(/\[\s*\d+\s*\]/g, "")
            .replace(/[−+-]+\s*$/u, "")
            .trim();
        if (util.isNullOrEmpty(rawTitle)) {
            return `Section ${index + 1}`;
        }
        return rawTitle;
    }

    extractAuthor(dom) {
        let infoNode = dom.querySelector(".inform-inform-data h6")
            || dom.querySelector(".inform-inform-data");
        if (infoNode != null) {
            let infoText = (infoNode.textContent ?? "")
                .replace(/&nbsp;/gi, " ")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            let authorMatch = infoText.match(
                /(?:Auteur|Author)\s*:\s*(.+?)(?=\s*(?:Traducteur|Translator|Statut|Status)\s*:|$)/i
            );
            let author = authorMatch?.[1]?.trim();
            if (!util.isNullOrEmpty(author)) {
                return author;
            }
        }
        return super.extractAuthor(dom);
    }

    linkToChapter(link, groupInfo = null) {
        if ((link == null) || util.isNullOrEmpty(link.href)) {
            return null;
        }
        let title = (link.getAttribute("title") || link.textContent || "").trim();
        if (util.isNullOrEmpty(title)) {
            return null;
        }
        let chapter = {
            sourceUrl: link.href,
            title: title
        };
        if (groupInfo != null) {
            chapter.groupType = groupInfo.type;
            chapter.groupIndex = groupInfo.index;
            chapter.groupTitle = groupInfo.title;
            chapter.groupLabel = groupInfo.label;
            chapter.groupKey = groupInfo.key;
            chapter.groupSource = groupInfo.source;
        }
        return chapter;
    }

    ensureCurrentChapterIncludedIfMissing(dom, chapters) {
        if ((dom == null) || util.isNullOrEmpty(dom.baseURI)) {
            return chapters;
        }

        let currentUrl = util.normalizeUrlForCompare(dom.baseURI);
        let chapterUrls = chapters.map(chapter => util.normalizeUrlForCompare(chapter.sourceUrl));
        if (chapterUrls.includes(currentUrl)) {
            return chapters;
        }

        let currentChapter = {
            sourceUrl: dom.baseURI,
            title: this.extractCurrentPageChapterTitle(dom)
        };
        let currentChapterNumber = this.extractChapterNumber(currentChapter);
        if (currentChapterNumber == null) {
            return chapters;
        }

        let knownChapterNumbers = chapters
            .map(chapter => this.extractChapterNumber(chapter))
            .filter(chapterNumber => chapterNumber != null);
        if (knownChapterNumbers.includes(currentChapterNumber)) {
            return chapters;
        }

        return [currentChapter].concat(chapters);
    }

    extractCurrentPageChapterTitle(dom) {
        let chapterTitle = this.findChapterTitle(dom);
        if ((chapterTitle != null) && !util.isNullOrEmpty(chapterTitle.textContent)) {
            return chapterTitle.textContent.trim();
        }
        return this.extractTitle(dom);
    }

    isLikelyChapter(chapter) {
        let lowerTitle = (chapter.title || "").toLowerCase();
        let lowerUrl = (chapter.sourceUrl || "").toLowerCase();

        if (/\/(tag|category|author|news|comments?)\//i.test(lowerUrl)) {
            return false;
        }
        if (/tipeee|patreon|paypal|discord|facebook|twitter|instagram/i.test(lowerUrl + " " + lowerTitle)) {
            return false;
        }
        if (/(annexe|appendix|map|carte|entretien|interview)/i.test(lowerTitle)) {
            return false;
        }
        return this.extractChapterNumber(chapter) != null;
    }

    compareChapterNumber(left, right) {
        let leftNumber = this.extractChapterNumber(left);
        let rightNumber = this.extractChapterNumber(right);
        if ((leftNumber == null) && (rightNumber == null)) {
            return left.originalOrderIndex - right.originalOrderIndex;
        }
        if (leftNumber == null) {
            return 1;
        }
        if (rightNumber == null) {
            return -1;
        }
        if (leftNumber !== rightNumber) {
            return leftNumber - rightNumber;
        }
        return left.originalOrderIndex - right.originalOrderIndex;
    }

    extractChapterNumber(chapter) {
        let chapterMatchers = [
            /(?:chapter|chapitre|ch|ep|episode)\s*[#:–—\-\s]*?(\d{1,5})/i,
            /(?:chapter|chapitre|ch|ep|episode)[-_](\d{1,5})/i,
            /\/(?:chapter|chapitre|ch)-?(\d{1,5})(?:[/?#]|-|$)/i
        ];
        let candidates = [chapter.title, chapter.sourceUrl];
        for (let candidate of candidates) {
            if (util.isNullOrEmpty(candidate)) {
                continue;
            }
            for (let matcher of chapterMatchers) {
                let match = candidate.match(matcher);
                if ((match != null) && (1 < match.length)) {
                    return parseInt(match[1], 10);
                }
            }
        }
        return null;
    }
}
