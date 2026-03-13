"use strict";

module("UtestEmpirenovelParser");

QUnit.test("findChapterTitle uses reader page heading", function (assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.empirenovel.com/novel/becoming-a-monster/15\"></head><body>" +
        "<h1>Becoming a Monster</h1>" +
        "<div id=\"read-novel\"><h3>Chapter 15: Wake Up</h3></div>" +
        "</body></html>",
        "text/html"
    );

    let parser = new EmpirenovelParser();
    assert.equal(parser.extractChapterTitleText(dom), "Chapter 15: Wake Up");
});

QUnit.test("getChapterUrls from reader page can enrich current chapter title", function (assert) {
    let done = assert.async();
    let chapterDom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.empirenovel.com/novel/becoming-a-monster/15\"></head>" +
        "<body>" +
        "<a href=\"https://www.empirenovel.com/novel/becoming-a-monster\">Table of Contents</a>" +
        "<h1>Becoming a Monster</h1>" +
        "<div id=\"read-novel\"><h3>Chapter 15: Wake Up</h3></div>" +
        "</body></html>",
        "text/html"
    );

    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        assert.equal(url, "https://www.empirenovel.com/novel/becoming-a-monster");
        let responseXML = new DOMParser().parseFromString(
            "<html><body>" +
            "<a class=\"chapter_link\" href=\"https://www.empirenovel.com/novel/becoming-a-monster/16\">Chapter 16<span class=\"small\">1 hour ago</span></a>" +
            "<a class=\"chapter_link\" href=\"https://www.empirenovel.com/novel/becoming-a-monster/15\">Chapter 15<span class=\"small\">2 hours ago</span></a>" +
            "</body></html>",
            "text/html"
        );
        util.setBaseTag(url, responseXML);
        return Promise.resolve({responseXML});
    };

    let parser = new EmpirenovelParser();
    parser.rateLimitDelay = async function() {};
    parser.getChapterUrls(chapterDom, { showTocProgress() {} }).then(function(chapters) {
        let currentChapter = chapters.find(chapter => chapter.sourceUrl === "https://www.empirenovel.com/novel/becoming-a-monster/15");
        let nextChapter = chapters.find(chapter => chapter.sourceUrl === "https://www.empirenovel.com/novel/becoming-a-monster/16");

        assert.equal(currentChapter.title, "Chapter 15");
        assert.equal(currentChapter.chapterNumber, 15);
        assert.equal(nextChapter.title, "Chapter 16");
        assert.ok(parser.updateChapterTitleFromDom(currentChapter, chapterDom));
        assert.equal(currentChapter.title, "Chapter 15: Wake Up");

        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});

QUnit.test("enrichChapterTitlesInBackground fetches detailed titles for generic chapters", function (assert) {
    let done = assert.async();
    let currentUrl = "https://www.empirenovel.com/novel/becoming-a-monster/15";
    let currentDom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.empirenovel.com/novel/becoming-a-monster/15\"></head>" +
        "<body><h1>Becoming a Monster</h1><div id=\"read-novel\"><h3>Chapter 15 Steroids</h3></div></body></html>",
        "text/html"
    );

    let parser = new EmpirenovelParser();
    parser.state.chapterListUrl = currentUrl;
    parser.titleEnrichmentRunId = 1;
    parser.titleFetchBatchSize = 2;
    parser.titleFetchDelayMs = 0;

    let chapters = [
        { sourceUrl: currentUrl, title: "Chapter 15" },
        { sourceUrl: "https://www.empirenovel.com/novel/becoming-a-monster/16", title: "Chapter 16" },
        { sourceUrl: "https://www.empirenovel.com/novel/becoming-a-monster/17", title: "Chapter 17" }
    ];
    parser.setPagesToFetch(chapters);

    let refreshCount = 0;
    parser.refreshChapterGroupingUi = function() {
        refreshCount += 1;
    };

    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        let chapterNumber = url.split("/").pop();
        let responseXML = new DOMParser().parseFromString(
            "<html><body>" +
            `<h1>Becoming a Monster</h1><div id="read-novel"><h3>Chapter ${chapterNumber} Detailed Title</h3></div>` +
            "</body></html>",
            "text/html"
        );
        util.setBaseTag(url, responseXML);
        return Promise.resolve({responseXML});
    };

    parser.enrichChapterTitlesInBackground(currentUrl, currentDom, 1).then(function() {
        assert.equal(chapters[0].title, "Chapter 15 Steroids");
        assert.equal(chapters[1].title, "Chapter 16 Detailed Title");
        assert.equal(chapters[2].title, "Chapter 17 Detailed Title");
        assert.equal(refreshCount, 1);
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});
