/*
  Parses web novels from jadescrolls.com

  IMPLEMENTATION:

  1. JadeScrolls is a Next.js/React SPA site where content is rendered client-side.
     This parser uses the JadeScrolls API endpoints instead of HTML parsing.

  2. API Endpoints Used:
     - Novel data: https://api.jadescrolls.com/api/public/get-novel-by-slug
       → Gets novel metadata (title, author, cover, description, genre) and chapter list
     - Chapter data: https://api.jadescrolls.com/api/user/get-chapter-by-slug
       → Gets individual chapter title and content

  3. URL structure: /novel/{novel-slug}/{chapter-slug}
     Chapter slugs can be: episode-1, episode-2, chapter-1, chapter-217, etc.
     Example: /novel/how-to-survive-as-the-second-son-of-a-mage-family/episode-1

  4. Features:
     - Fetches chapter list from API with proper sorting by episode/chapter number
     - Retrieves chapter content directly from JSON API
     - Builds HTML DOM from API response
     - Caches novel metadata across parser instances using static variables
     - Extracts metadata (title, author, cover, description, genre) from API
     - Falls back to URL-based title extraction if metadata not loaded yet
     - 1.5-second throttle to prevent rate limiting

  5. Notes:
     - Chapter content is in JSON field: data.content (HTML format)
     - Novel metadata is in: data.title, data.OriginalNovelAuthor, data.coverImg, etc.
     - Metadata is cached by novel slug for efficient access across instances
     - If API structure changes, update buildDomFromChapterData() and getChapterUrls() methods
*/
"use strict";

parserFactory.register("jadescrolls.com", () => new JadeScrollsParser());

class JadeScrollsParser extends Parser {
    // Static cache for metadata (shared across all instances)
    static metadataCache = {};
    static metadataPromises = {};

    constructor() {
        super();
        // JadeScrolls uses API endpoints which can handle faster requests
        // Reduced from 3000ms based on testing
        this.minimumThrottle = 1500;
    }

    // Override getPageDOM to start metadata loading as early as possible
    async getPageDOM(url) {
        let dom = await super.getPageDOM(url);
        // Start loading metadata in the background (don't await)
        this.startMetadataLoad(dom);
        return dom;
    }

    // Start metadata loading without waiting (call this early)
    startMetadataLoad(dom) {
        let novelSlug = this.extractNovelSlug(dom.baseURI);
        if (!novelSlug) {
            return;
        }

        // Check if already loaded or loading
        if (JadeScrollsParser.metadataCache[novelSlug] || JadeScrollsParser.metadataPromises[novelSlug]) {
            return;
        }

        // Start the fetch but don't await it - store the promise
        JadeScrollsParser.metadataPromises[novelSlug] = (async () => {
            try {
                let apiUrl = `https://api.jadescrolls.com/api/public/get-novel-by-slug?slug=${novelSlug}&chapterSort=ASC`;
                let jsonResponse = await HttpClient.fetchJson(apiUrl);
                let novelData = await jsonResponse.json;
                JadeScrollsParser.metadataCache[novelSlug] = novelData.data;
            } catch (error) {
                console.error("Failed to fetch novel metadata:", error);
            }
        })();
    }

    // Override populateUI to ensure metadata is loaded before populating the UI
    async populateUI(dom) {
        // Wait for metadata to be loaded
        await this.ensureNovelMetadata(dom);
        // Call parent to populate the UI
        await super.populateUI(dom);
    }

    // Extract chapter URLs using the JadeScrolls API
    async getChapterUrls(dom, chapterUrlsUI) {
        let baseUrl = dom.baseURI;

        // Extract novel slug from URL
        let novelSlug = this.extractNovelSlug(baseUrl);
        if (!novelSlug) {
            throw new Error(`Could not extract novel slug from URL: ${baseUrl}`);
        }

        // Fetch novel data from API (includes chapter list)
        let apiUrl = `https://api.jadescrolls.com/api/public/get-novel-by-slug?slug=${novelSlug}&chapterSort=ASC`;

        try {
            let jsonResponse = await HttpClient.fetchJson(apiUrl);
            let novelData = await jsonResponse.json;

            // Store novel metadata in static cache for use by all instances
            JadeScrollsParser.metadataCache[novelSlug] = novelData.data;

            // Extract chapters from the API response
            let chapters = [];

            // JadeScrolls API returns chapters at data.chapter
            let chapterList = novelData.data?.chapter || novelData.chapters || novelData.data?.chapters;

            if (chapterList && Array.isArray(chapterList)) {
                chapters = chapterList.map(chapter => ({
                    sourceUrl: `https://jadescrolls.com/novel/${novelSlug}/${chapter.slug}`,
                    title: chapter.title || `Episode ${chapter.chapterNo}`
                }));
            } else {
                // Fallback: try to parse from the page DOM
                let links = [...dom.querySelectorAll("a[href*='/episode-']")];
                if (links.length > 0) {
                    chapters = util.hyperlinksToChapterList(links);
                } else if (baseUrl.includes("/episode-")) {
                    // Single chapter fallback
                    return [{
                        sourceUrl: baseUrl,
                        title: "Chapter"
                    }];
                }
            }

            // Sort by episode number to ensure correct order
            chapters.sort((a, b) => {
                let numA = this.extractEpisodeNumber(a.sourceUrl);
                let numB = this.extractEpisodeNumber(b.sourceUrl);
                return numA - numB;
            });

            return chapters;
        } catch (error) {
            // If API fails, fall back to DOM parsing
            console.error("JadeScrolls API fetch failed, falling back to DOM parsing:", error);
            let links = [...dom.querySelectorAll("a[href*='/episode-']")];
            return util.hyperlinksToChapterList(links);
        }
    }

    // Extract novel slug from URL
    extractNovelSlug(url) {
        let match = url.match(/\/novel\/([^/]+)/);
        return match ? match[1] : null;
    }

    // Extract the novel base URL from a chapter URL
    getNovelUrl(url) {
        // Convert /novel/{slug}/episode-{n} to /novel/{slug}
        let match = url.match(/(https?:\/\/[^/]+\/novel\/[^/]+)/);
        return match ? match[1] : url;
    }

    // Extract episode/chapter number from URL for sorting
    extractEpisodeNumber(url) {
        // Try episode-N format
        let match = url.match(/episode-(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }

        // Try chapter-N format
        match = url.match(/chapter-(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }

        // Fallback: extract any number from the slug
        match = url.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    // Extract the chapter title from the page
    extractChapterTitle(dom) {
        let titleElement = dom.querySelector(".chpt-title.fw-medium");
        return titleElement ? titleElement.textContent.trim() : null;
    }

    // Find the content element on the chapter page
    findContent(dom) {
        // Look for the main content container
        let content = dom.querySelector(".content-inner.listing-disc-styling");

        if (!content) {
            // Content not found - this happens when the site uses JS to load content
            // Try to find any content container that might exist
            content = dom.querySelector("div.content-inner") ||
                     dom.querySelector("div[class*='content']");
        }

        return content;
    }

    // Extract chapter title (called separately from content)
    findChapterTitle(dom) {
        let title = this.extractChapterTitle(dom);
        if (title) {
            return title;
        }

        // Fallback: try to get title from page title or h1
        let h1 = dom.querySelector("h1");
        if (h1) {
            return h1.textContent.trim();
        }

        // Last resort: extract from URL
        let episodeNum = this.extractEpisodeNumber(dom.baseURI);
        return episodeNum > 0 ? `Episode ${episodeNum}` : "Chapter";
    }

    // Get metadata for the current novel from cache
    getNovelMetadata(dom) {
        let novelSlug = this.extractNovelSlug(dom.baseURI);
        return novelSlug ? JadeScrollsParser.metadataCache[novelSlug] : null;
    }

    // Ensure novel metadata is loaded (lazy loading helper)
    async ensureNovelMetadata(dom) {
        let novelSlug = this.extractNovelSlug(dom.baseURI);
        if (!novelSlug) {
            return;
        }

        // If we already have metadata, no need to fetch again
        if (JadeScrollsParser.metadataCache[novelSlug]) {
            return;
        }

        // If there's a pending metadata fetch, wait for it
        if (JadeScrollsParser.metadataPromises[novelSlug]) {
            await JadeScrollsParser.metadataPromises[novelSlug];
            return;
        }

        // Start metadata loading if not already started
        this.startMetadataLoad(dom);
        if (JadeScrollsParser.metadataPromises[novelSlug]) {
            await JadeScrollsParser.metadataPromises[novelSlug];
        }
    }

    // Extract the novel title from API metadata or page
    extractTitleImpl(dom) {
        // First try to get from novel metadata (if already loaded by populateUI)
        let metadata = this.getNovelMetadata(dom);
        if (metadata?.title) {
            return metadata.title;
        }

        // If metadata is still loading, return URL-based title as best guess
        // (This provides a reasonable fallback while waiting for API)
        let match = dom.baseURI.match(/\/novel\/([^/]+)/);
        if (match && match[1]) {
            let urlTitle = match[1].split("-").map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(" ");
            return urlTitle;
        }

        return "Unknown Novel";
    }

    // Extract author from API metadata or DOM
    extractAuthor(dom) {
        // First try to get from novel metadata (if already loaded by populateUI)
        let metadata = this.getNovelMetadata(dom);
        if (metadata?.OriginalNovelAuthor) {
            return metadata.OriginalNovelAuthor;
        }
        if (metadata?.TranslateNovelAuthor) {
            return metadata.TranslateNovelAuthor;
        }

        // Metadata not loaded yet - will be available during EPUB packing
        return "JadeScrolls";
    }

    // Custom fetch for chapter pages using the JadeScrolls API
    async fetchChapter(url) {
        // Extract novel slug and chapter slug from URL
        // URL format: /novel/{novelSlug}/{chapterSlug}
        // Chapter slug can be: episode-1, chapter-217, etc.
        let match = url.match(/\/novel\/([^/]+)\/([^/?#]+)/);
        if (!match) {
            throw new Error(`Invalid JadeScrolls chapter URL format: ${url}`);
        }

        let [, novelSlug, chapterSlug] = match;

        // Build API URL
        let apiUrl = `https://api.jadescrolls.com/api/user/get-chapter-by-slug?novelSlug=${novelSlug}&chapterSlug=${chapterSlug}`;

        // Fetch JSON data from API
        let jsonResponse = await HttpClient.fetchJson(apiUrl);
        let chapterData = await jsonResponse.json;

        // Build HTML DOM from JSON data
        return this.buildDomFromChapterData(chapterData, url);
    }

    // Build a DOM document from the JSON chapter data
    buildDomFromChapterData(chapterData, sourceUrl) {
        // Create a new document
        let doc = new DOMParser().parseFromString(
            `<html><head><base href="${sourceUrl}"/></head><body></body></html>`,
            "text/html"
        );

        // JadeScrolls API wraps data in a 'data' object
        let data = chapterData.data || chapterData;

        // Add chapter title
        if (data.title) {
            let titleElement = doc.createElement("h1");
            titleElement.className = "chpt-title fw-medium";
            titleElement.textContent = data.title;
            doc.body.appendChild(titleElement);
        }

        // Add chapter content
        let contentDiv = doc.createElement("div");
        contentDiv.className = "content-inner listing-disc-styling";

        // The API returns HTML content in the 'content' field
        if (data.content) {
            contentDiv.innerHTML = data.content;
        } else if (data.body) {
            contentDiv.innerHTML = data.body;
        } else if (data.text) {
            // If it's plain text, wrap in paragraphs
            let paragraphs = data.text.split('\n\n');
            paragraphs.forEach(para => {
                if (para.trim()) {
                    let p = doc.createElement("p");
                    p.textContent = para.trim();
                    contentDiv.appendChild(p);
                }
            });
        }

        doc.body.appendChild(contentDiv);
        return doc;
    }

    // Clean up unwanted elements from the content
    removeUnwantedElementsFromContentElement(element) {
        // Remove scripts, iframes, ads, etc.
        util.removeChildElementsMatchingSelector(element, "script, iframe, .ad, .advertisement");

        // Remove navigation elements (next/previous chapter links)
        util.removeChildElementsMatchingSelector(element, "a[href*='/episode-']");

        // Call parent cleanup
        super.removeUnwantedElementsFromContentElement(element);
    }

    // Extract cover image from API metadata or DOM
    findCoverImageUrl(dom) {
        // First try to get from novel metadata (if already loaded)
        let metadata = this.getNovelMetadata(dom);
        if (metadata?.coverImg) {
            return metadata.coverImg;
        }

        // Fallback to DOM parsing
        let ogImage = dom.querySelector("meta[property='og:image']");
        if (ogImage) {
            return ogImage.getAttribute("content");
        }

        let coverImg = dom.querySelector(".cover-image, .novel-cover, img[class*='cover']");
        if (coverImg) {
            return util.getFirstImgSrc(coverImg);
        }

        return null;
    }

    // Extract description from API metadata or DOM
    extractDescription(dom) {
        // First try to get from novel metadata (if already loaded)
        let metadata = this.getNovelMetadata(dom);
        if (metadata?.description || metadata?.synopsis) {
            return metadata.description || metadata.synopsis;
        }

        // Fallback to DOM parsing
        let ogDesc = dom.querySelector("meta[property='og:description']");
        if (ogDesc) {
            return ogDesc.getAttribute("content");
        }

        let metaDesc = dom.querySelector("meta[name='description']");
        if (metaDesc) {
            return metaDesc.getAttribute("content");
        }

        let descElement = dom.querySelector(".synopsis, .description, .summary, [class*='description']");
        if (descElement) {
            return descElement.textContent.trim();
        }

        return "";
    }

    // Extract genre/subject tags from API metadata or DOM
    extractSubject(dom) {
        // First try to get from novel metadata (if already loaded)
        let metadata = this.getNovelMetadata(dom);
        if (metadata?.genre) {
            // API might return genre as array or string
            if (Array.isArray(metadata.genre)) {
                return metadata.genre.join(", ");
            }
            return metadata.genre;
        }

        // Fallback to DOM parsing
        let genreTags = [...dom.querySelectorAll(".genre, .tag, [class*='genre'], [class*='tag']")];
        if (genreTags.length > 0) {
            return genreTags.map(tag => tag.textContent.trim()).join(", ");
        }

        let keywords = dom.querySelector("meta[name='keywords']");
        if (keywords) {
            return keywords.getAttribute("content");
        }

        return "";
    }
}
