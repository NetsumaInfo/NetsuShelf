/*
   parses Qidian International site
*/
"use strict";

parserFactory.register("webnovel.com", () => new QidianParser());

class QidianParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 50; //Minimal delay to reduce frequency of 445 errors.
        this.ChacheChapterTitle = new Map();
    }

    async getChapterUrls(dom) {
        if (!dom.baseURI.match(new RegExp("/catalog$"))) {
            let newURL = dom.baseURI;
            let regex = new RegExp("(/book/(?:.*?_)?\\d+\\b).*");
            newURL = newURL.replace(regex, "$1/catalog");
            regex = new RegExp("(/comic/(?:.*?_)?\\d+\\b).*");
            newURL = newURL.replace(regex, "$1/catalog");
            dom = (await HttpClient.wrapFetch(newURL)).responseXML;
        }
        let links = Array.from(dom.querySelectorAll("ul.content-list a"));
        if (links.length === 0) {
            let volumeItems = Array.from(dom.querySelectorAll("div.volume-item"));
            if (0 < volumeItems.length) {
                return QidianParser.linksFromVolumeItems(volumeItems);
            }
            links = Array.from(dom.querySelectorAll("div.volume-item ol a"));
        }
        return links.map(QidianParser.linkToChapter);
    }

    static isLinkLocked(link) {
        let img = link.querySelector("svg > use");
        return (img != null)
            && (img.getAttribute("xlink:href") === "#i-lock");
    }

    static linkToChapter(link) {
        let isSelectable = !QidianParser.isLinkLocked(link);
        let title = link.textContent;
        let element = link.querySelector("strong");
        if (element !== null) {
            title = element.textContent.trim();
            if (!document.getElementById("removeChapterNumberCheckbox").checked) {
                element = link.querySelector("i");
                if (element !== null) {
                    title = element.textContent + ": " + title;
                }
            }
        }
        return {sourceUrl: link.href, title: title, 
            isIncludeable: isSelectable,
            isSelectable: isSelectable
        };
    }

    static linksFromVolumeItems(volumeItems) {
        let chapters = [];
        volumeItems.forEach((volumeItem, index) => {
            let volumeInfo = QidianParser.extractVolumeInfo(volumeItem, index + 1);
            let links = Array.from(volumeItem.querySelectorAll("ol a"));
            links.forEach((link, linkIndex) => {
                let chapter = QidianParser.linkToChapter(link);
                chapter.groupType = "volume";
                chapter.groupIndex = volumeInfo.index;
                chapter.groupTitle = volumeInfo.title;
                chapter.groupLabel = volumeInfo.label;
                chapter.groupKey = volumeInfo.key;
                chapter.groupSource = "native_toc";
                chapter.groupCoverUrl = volumeInfo.coverUrl;
                if (linkIndex === 0) {
                    chapter.newArc = volumeInfo.displayTitle;
                }
                chapters.push(chapter);
            });
        });
        return chapters;
    }

    static extractVolumeInfo(volumeItem, fallbackIndex) {
        let headerNodes = [];
        for (let child of volumeItem.children) {
            if (child.tagName === "OL") {
                continue;
            }
            if (!util.isNullOrEmpty(child.textContent)) {
                headerNodes.push(child);
            }
            headerNodes = headerNodes.concat(
                [...child.querySelectorAll("h1, h2, h3, h4, h5, h6, .volume-name, .title, .tit")]
                    .filter(node => node.closest("ol") === null)
            );
        }

        let rawTitle = headerNodes
            .map(node => node.textContent?.trim())
            .find(text => !util.isNullOrEmpty(text))
            ?? `Volume ${fallbackIndex}`;

        let type = "volume";
        let index = String(fallbackIndex);
        let label = `Volume ${index}`;
        let title = null;

        let titleMatch = rawTitle.match(/\b(?:vol(?:ume)?|book)\s*([0-9]+(?:\.[0-9]+)?|[ivxlcdm]+)\b[\s:._-]*(.*)$/i);
        if ((titleMatch != null) && (2 < titleMatch.length)) {
            index = titleMatch[1].toUpperCase();
            label = `Volume ${index}`;
            title = titleMatch[2]?.trim() || null;
        } else if (!util.isNullOrEmpty(rawTitle)) {
            title = rawTitle.trim();
        }

        let displayTitle = title == null
            ? label
            : (label.toLowerCase() === title.toLowerCase() ? title : `${label} - ${title}`);
        let coverUrl = volumeItem.querySelector("img[src]")?.src ?? null;

        return {
            type: type,
            index: index,
            label: label,
            title: title,
            key: `volume:${index}`,
            displayTitle: displayTitle,
            coverUrl: coverUrl
        };
    }

    findContent(dom) {
        return dom.querySelector("div.chapter_content");
    }

    preprocessRawDom(webPage) {
        if (this.ChacheChapterTitle.size == 0) {
            let pagesToFetch = [...this.state.webPages.values()].filter(c => c.isIncludeable);
            pagesToFetch.map(a => (this.ChacheChapterTitle.set(a.sourceUrl, a.title)));
        }
        let content = this.findContent(webPage);
        if (content !== null) {
            content = this.cleanRawDom(content);
            return;
        }
        let json = this.findChapterContentJson(webPage);
        if (json === null) {
            return;
        }
        content = webPage.createElement("div");
        content.className = "chapter_content";
        webPage.body.appendChild(content);
        this.addHeader(webPage, content, json.chapterInfo.chapterName);
        for (let c of json.chapterInfo?.contents?json.chapterInfo.contents:[]) {
            this.addParagraph(webPage, content, c.content);
        }
        for (let c of json.chapterInfo?.chapterPage?json.chapterInfo.chapterPage:[]) {
            this.addComicPage(webPage, content, c.url);
        }
        if (!this.userPreferences.removeAuthorNotes.value) {
            let notes = json.chapterInfo.notes?.note ?? null;
            if (!util.isNullOrEmpty(notes)) {
                let container = this.addNoteContainer(webPage, content);
                this.addHeader(webPage, container, "Notes");
                this.addParagraph(webPage, container, notes);
            }
        }
        for (let e of [...webPage.querySelectorAll("div.j_bottom_comment_area, div.user-links-wrap, div.g_ad_ph")]) {
            e.remove();
        }
    }

    cleanRawDom(content)
    {
        //Remove repeating & unused metadata from document. Approximately halves body length.
        content.querySelectorAll("i.para-comment_num, i.para-comment").forEach(i => i.remove());
        content.querySelectorAll("div.db").forEach(i => i.removeAttribute("data-ejs"));
        let tmptitle = this.ChacheChapterTitle.get(content.baseURI);
        let newtitlenode = document.createElement("h1");
        if (tmptitle == undefined || tmptitle == "[placeholder]") {
            let titleEl = content.querySelector("div.chapter_content h1");
            let titleDupChapRegex = new RegExp("(\\w+[\\s\\-]+\\d+):\\s*\\1:?(.*)", "i").exec(titleEl.textContent);
            if (titleDupChapRegex && titleDupChapRegex.length > 2) {
                let newtitleText = document.createTextNode(titleDupChapRegex[1] + titleDupChapRegex[2]);
                newtitlenode.appendChild(newtitleText);
                titleEl.replaceWith(newtitlenode);
            }
        } else {
            let newtitleText = document.createTextNode(tmptitle);
            newtitlenode.appendChild(newtitleText);
            content.querySelector("div.chapter_content h1").replaceWith(newtitlenode);
        }
        return content;
    }

    findChapterContentJson(dom) {
        const searchString = "var chapInfo=";
        return [...dom.querySelectorAll("script")]
            .map(s => s.textContent)
            .filter(s => s.startsWith(searchString))
            .map(s => util.locateAndExtractJson(this.fixExcaping(s), searchString))[0];
    } 

    fixExcaping(s) {
        return this.stripBackslash(s)
            .replace(/\n|\r|<\/?p>/g, "");
    }

    addHeader(webPage, content, text) {
        this.addElement(webPage, content, "h3", text);
    }

    addParagraph(webPage, content, text) {
        this.addElement(webPage, content, "p", text);
    }

    addComicPage(webPage, content, text) {
        let t = webPage.createElement("img");
        t.src = text;
        content.appendChild(t);
        return t;
    }

    addNoteContainer(webPage, content) {
        let container = this.addElement(webPage, content, "div", "");
        this.tagAuthorNotes([container]);
        return container;
    }

    addElement(webPage, content, tag, text) {
        let t = webPage.createElement(tag);
        t.textContent = text;
        content.appendChild(t);
        return t;
    }

    stripBackslash(s) {
        const singleEscapeChars = "\"\\";
        const stripChars = "bfnrtv";
        let temp = "";
        let i = 0;
        while (i < (s.length)) {
            if (s[i] === "\\") {
                ++i;
                if (stripChars.includes(s[i])) {
                    temp += " ";
                }
                else { 
                    if (singleEscapeChars.includes(s[i])) {
                        temp += "\\";
                    }
                    temp += s[i];
                }
            }
            else {
                temp += s[i];
            }
            ++i;
        }
        return temp;
    }

    populateUIImpl() {
        document.getElementById("removeAuthorNotesRow").hidden = false; 
        document.getElementById("removeChapterNumberRow").hidden = false; 
    }

    // title of the story
    extractTitleImpl(dom) {
        let title = dom.querySelector("div.chapter_content h1");
        return title;
    }

    extractAuthor(dom) {
        return dom.querySelector("a.c_primary")?.textContent ?? super.extractAuthor(dom);
    }
 
    removeUnwantedElementsFromContentElement(content) {
        util.removeChildElementsMatchingSelector(content, "form.cha-score, div.cha-bts, pirate, div.cha-content div.user-links-wrap, div.tac");
        this.tagAuthorNotesBySelector(content, "div.m-thou");
        super.removeUnwantedElementsFromContentElement(content);
    }

    findCoverImageUrl(dom) {
        let imgs = [...dom.querySelectorAll("div.det-hd i.g_thumb img")];
        return 0 === imgs.length 
            ? util.getFirstImgSrc(dom, "div.det-hd")
            : imgs.pop().src;
    }

    getInformationEpubItemChildNodes(dom) {
        return [...dom.querySelectorAll("div._mn, div.det-abt")];
    }

    cleanInformationNode(node) {
        util.removeChildElementsMatchingSelector(node, "div._ft, span.g_star");
    }

    extractSubject(dom) {
        let tags = ([...dom.querySelectorAll("div.m-tags a")]);
        return tags.map(e => e.textContent.replace(" # ", "").trim()).join(", ");
    }

    extractDescription(dom) {
        return dom.querySelector("div.det-abt p.c_000").textContent.trim();
    }
}
