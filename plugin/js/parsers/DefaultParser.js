/*
  Parser used when can't match a parser for the document
*/
"use strict";

parserFactory.registerManualSelect(
    "Default", 
    () => new DefaultParser()
);

class DefaultParser extends Parser {
    constructor() {
        super();
        this.siteConfigs = new DefaultParserSiteSettings();
        this.logic = null;
    }

    getChapterUrls(dom) {
        let chapters = util.hyperlinksToChapterList(dom.body);
        return Promise.resolve(this.ensurePotentialChapterOneIsIncluded(dom, chapters));
    }

    findContent(dom) {
        let hostName = util.extractHostName(dom.baseURI);
        this.logic = this.siteConfigs.constructFindContentLogicForSite(hostName);
        return this.logic.findContent(dom); 
    }

    populateUI(dom) {
        super.populateUI(dom);
        let hostname = util.extractHostName(dom.baseURI);
        DefaultParserUI.setupDefaultParserUI(hostname, this, dom);
    }

    // override default (keep nearly everything, may be wanted)
    removeUnwantedElementsFromContentElement(element) {
        util.removeElements(element.querySelectorAll("script[src], iframe"));
        util.removeComments(element);
        util.removeUnwantedWordpressElements(element);
        util.removeMicrosoftWordCrapElements(element);
        this.logic.removeUnwanted(element);
    }

    findChapterTitle(dom) {
        return this.logic.findChapterTitle(dom);
    }

    ensurePotentialChapterOneIsIncluded(dom, chapters) {
        if ((chapters == null) || (chapters.length === 0)) {
            return chapters;
        }

        let pageUrl = util.normalizeUrlForCompare(dom.baseURI);
        let alreadyHasCurrentPage = chapters.some(chapter =>
            util.normalizeUrlForCompare(chapter.sourceUrl) === pageUrl
        );
        if (alreadyHasCurrentPage) {
            return chapters;
        }

        let minChapterNumber = this.findMinimumChapterNumber(chapters);
        if (minChapterNumber !== 2) {
            return chapters;
        }

        return [{
            sourceUrl: dom.baseURI,
            title: this.extractTitle(dom)
        }].concat(chapters);
    }

    findMinimumChapterNumber(chapters) {
        let numbers = chapters
            .map(chapter => this.extractChapterNumber(chapter))
            .filter(number => Number.isFinite(number));
        return (numbers.length === 0) ? null : Math.min(...numbers);
    }

    extractChapterNumber(chapter) {
        let chapterMatchers = [
            /(?:chapter|chapitre|cap[ií]tulo|episode|ep|ch)\s*#?\s*(\d{1,5})/i,
            /(?:chapter|chapitre|cap[ií]tulo|episode|ep|ch)[-_/](\d{1,5})/i,
            /\/(\d{1,5})(?:[/?#]|$)/i
        ];
        let candidates = [chapter.title || "", chapter.sourceUrl || ""];
        for (let candidate of candidates) {
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
