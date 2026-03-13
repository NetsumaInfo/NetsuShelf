
"use strict";

module("UtestRoyalRoadParser");

QUnit.test("removeOlderChapterNavJunk", function (assert) {
    let dom = TestUtils.makeDomWithBody(
        "<h1 id=\"e1\">&lt;--&gt;</h1>" +
        "<div id=\"d1\"><p id=\"p1\">1</p><p id=\"p2\">2</p><p id=\"p2\">&lt;--&gt;</p></div>" +
        "<h2 id=\"e2\">&lt;--&gt;</h2>"
    );
    assert.equal(dom.body.textContent, "<-->12<--><-->");
    RoyalRoadParser.removeOlderChapterNavJunk(dom.body);
    assert.equal(dom.querySelector("h1").textContent, "");
    assert.equal(dom.querySelector("div").textContent, "12");
    assert.equal(dom.body.textContent, "12");
});

QUnit.test("makeHiddenElementsVisible", function (assert) {
    let dom = TestUtils.makeDomWithBody(
        "<div style=\"display: none;\">Spoiler</div>"
    );
    let div = dom.querySelector("div");
    new RoyalRoadParser().makeHiddenElementsVisible(dom.body);
    assert.equal(div.outerHTML, "<div>Spoiler</div>");
});

QUnit.test("getChapterUrls keeps most complete chapter list", function (assert) {
    let done = assert.async();
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.royalroad.com/fiction/21220/mother-of-learning\"></head>" +
        "<body>" +
        "<table id=\"chapters\">" +
        "<tbody>" +
        "<tr><td><a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother\">1. Good Morning Brother</a></td></tr>" +
        "</tbody>" +
        "</table>" +
        "</body></html>",
        "text/html"
    );
    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        assert.equal(url, "https://www.royalroad.com/fiction/21220/mother-of-learning");
        let responseXML = new DOMParser().parseFromString(
            "<html><body>" +
            "<table id=\"chapters\"><tbody>" +
            "<tr><td><a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother\">1. Good Morning Brother</a></td></tr>" +
            "<tr><td><a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301781/2-lifes-little-problems\">2. Life's Little Problems</a></td></tr>" +
            "</tbody></table>" +
            "</body></html>",
            "text/html"
        );
        util.setBaseTag(url, responseXML);
        return Promise.resolve({responseXML});
    };

    new RoyalRoadParser().getChapterUrls(dom).then(function(chapters) {
        assert.deepEqual(chapters, [
            {
                sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother",
                title: "1. Good Morning Brother",
                chapterNumber: 1,
                newArc: null
            },
            {
                sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301781/2-lifes-little-problems",
                title: "2. Life's Little Problems",
                chapterNumber: 2,
                newArc: null
            }
        ]);
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});

QUnit.test("getChapterUrls resolves fiction page from chapter page", function (assert) {
    let done = assert.async();
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother\"></head>" +
        "<body>" +
        "<a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning\">Mother of Learning</a>" +
        "</body></html>",
        "text/html"
    );
    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        assert.equal(url, "https://www.royalroad.com/fiction/21220/mother-of-learning");
        let responseXML = new DOMParser().parseFromString(
            "<html><body>" +
            "<table id=\"chapters\"><tbody>" +
            "<tr><td><a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother\">1. Good Morning Brother</a></td></tr>" +
            "<tr><td><a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301781/2-lifes-little-problems\">2. Life's Little Problems</a></td></tr>" +
            "</tbody></table>" +
            "</body></html>",
            "text/html"
        );
        return Promise.resolve({responseXML});
    };

    new RoyalRoadParser().getChapterUrls(dom).then(function(chapters) {
        assert.deepEqual(chapters, [
            {
                sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother",
                title: "1. Good Morning Brother",
                chapterNumber: 1,
                newArc: null
            },
            {
                sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301781/2-lifes-little-problems",
                title: "2. Life's Little Problems",
                chapterNumber: 2,
                newArc: null
            }
        ]);
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});

QUnit.test("getChapterUrls prefixes missing chapter numbers from chapter rows", function (assert) {
    let chapters = new RoyalRoadParser().getChapterUrlsFromDom(
        new DOMParser().parseFromString(
            "<html><body>" +
            "<table id=\"chapters\"><tbody>" +
            "<tr class=\"chapter-row\"><td><a href=\"https://www.royalroad.com/fiction/145957/the-enchanted-beastiary/chapter/1/archive-index\">Archive Index of Documented Fauna</a></td><td data-content=\"0\"></td></tr>" +
            "<tr class=\"chapter-row\"><td><a href=\"https://www.royalroad.com/fiction/145957/the-enchanted-beastiary/chapter/2/alphabetical-index\">Alphabetical Index of Documented Species</a></td><td data-content=\"1\"></td></tr>" +
            "</tbody></table>" +
            "</body></html>",
            "text/html"
        )
    );

    assert.deepEqual(chapters, [
        {
            sourceUrl: "https://www.royalroad.com/fiction/145957/the-enchanted-beastiary/chapter/1/archive-index",
            title: "1. Archive Index of Documented Fauna",
            chapterNumber: 1,
            newArc: null
        },
        {
            sourceUrl: "https://www.royalroad.com/fiction/145957/the-enchanted-beastiary/chapter/2/alphabetical-index",
            title: "2. Alphabetical Index of Documented Species",
            chapterNumber: 2,
            newArc: null
        }
    ]);
});

QUnit.test("extractTitle uses fiction title on chapter page", function (assert) {
    let dom = new DOMParser().parseFromString(
        "<html><body>" +
        "<div class=\"row fic-header margin-bottom-40\">" +
        "<div class=\"col-md-5 col-lg-6 col-md-offset-1 text-center md-text-left\">" +
        "<a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning\">" +
        "<h2 class=\"font-white inline-block\">Mother of Learning</h2>" +
        "</a>" +
        "<h1 class=\"font-white break-word\">1. Good Morning Brother</h1>" +
        "</div>" +
        "</div>" +
        "</body></html>",
        "text/html"
    );

    assert.equal(new RoyalRoadParser().extractTitle(dom), "Mother of Learning");
});

QUnit.test("loadEpubMetaInfo fetches fiction metadata from chapter page", function (assert) {
    let done = assert.async();
    let chapterDom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother\"></head>" +
        "<body>" +
        "<div class=\"row fic-header margin-bottom-40\">" +
        "<a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning\">" +
        "<h2 class=\"font-white inline-block\">Mother of Learning</h2>" +
        "</a>" +
        "<h3 class=\"font-white inline-block\"><a href=\"https://www.royalroad.com/profile/100374\" class=\"font-white\">nobody103</a></h3>" +
        "<h1 class=\"font-white break-word\">1. Good Morning Brother</h1>" +
        "</div>" +
        "</body></html>",
        "text/html"
    );
    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        assert.equal(url, "https://www.royalroad.com/fiction/21220/mother-of-learning");
        let responseXML = new DOMParser().parseFromString(
            "<html><head></head><body>" +
            "<div class=\"row fic-header\">" +
            "<img class=\"thumbnail\" src=\"https://img.example/mol.jpg\">" +
            "<div class=\"col-md-5 col-lg-6 text-center md-text-left fic-title\">" +
            "<div class=\"col\">" +
            "<h1 class=\"font-white\">Mother of Learning</h1>" +
            "<h4 class=\"font-white\"><span><a href=\"https://www.royalroad.com/profile/100374\" class=\"font-white\">nobody103</a></span></h4>" +
            "</div>" +
            "</div>" +
            "</div>" +
            "<div class=\"fiction-info\">" +
            "<span class=\"tags\"><span class=\"label\">Fantasy</span><span class=\"label\">Time Loop</span></span>" +
            "<div class=\"description\">A time loop story.</div>" +
            "</div>" +
            "</body></html>",
            "text/html"
        );
        util.setBaseTag(url, responseXML);
        return Promise.resolve({responseXML});
    };

    let parser = new RoyalRoadParser();
    parser.loadEpubMetaInfo(chapterDom).then(function() {
        let metaInfo = parser.getEpubMetaInfo(chapterDom, false);
        assert.equal(metaInfo.title, "Mother of Learning");
        assert.equal(metaInfo.author, "nobody103");
        assert.equal(metaInfo.subject, "Fantasy, Time Loop");
        assert.equal(metaInfo.description, "A time loop story.");
        assert.equal(parser.findCoverImageUrl(chapterDom), "https://img.example/mol.jpg");
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});

QUnit.test("shouldAutoExpandChapterList ignores fiction review pagination", function (assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://www.royalroad.com/fiction/21220/mother-of-learning?reviews=2\"></head>" +
        "<body>" +
        "<a href=\"https://www.royalroad.com/fiction/21220/mother-of-learning?reviews=3\">Next</a>" +
        "</body></html>",
        "text/html"
    );

    let chapters = [{
        sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother",
        title: "1. Good Morning Brother",
        chapterNumber: 1,
        newArc: null
    }];

    assert.equal(new RoyalRoadParser().shouldAutoExpandChapterList(dom.baseURI, dom, chapters), false);
});

QUnit.test("fiction page urls are not added as chapters", function (assert) {
    let parser = new RoyalRoadParser();
    let fictionUrl = "https://www.royalroad.com/fiction/21220/mother-of-learning?reviews=2";
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"" + fictionUrl + "\"></head><body></body></html>",
        "text/html"
    );
    let chapters = [{
        sourceUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother",
        title: "1. Good Morning Brother",
        chapterNumber: 1,
        newArc: null
    }];

    assert.deepEqual(parser.addFirstPageUrlToWebPages(fictionUrl, dom, chapters), chapters);
    assert.deepEqual(parser.ensureCurrentPageIncludedInChapterList(fictionUrl, dom, chapters), chapters);
});
