"use strict";

module("UtestNovelliveParser");

QUnit.test("extractPartialChapterList prefers the main chapter list", function (assert) {
    let dom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://novellive.app/book/shadow-slave\"></head><body>" +
        "<div><h2 class=\"tit\">Latest Chapters</h2>" +
        "<ul class=\"ul-list5\">" +
        "<li><a href=\"https://novellive.app/book/shadow-slave/chapter130-latest\">Chapter 130 Latest</a></li>" +
        "<li><a href=\"https://novellive.app/book/shadow-slave/chapter131-latest\">Chapter 131 Latest</a></li>" +
        "</ul></div>" +
        "<div><h2 class=\"tit\">Chapter List</h2>" +
        "<ul class=\"ul-list5\">" +
        "<li><a href=\"https://novellive.app/book/shadow-slave/chapter1-nightmare-begins\">Chapter 1 Nightmare Begins</a></li>" +
        "<li><a href=\"https://novellive.app/book/shadow-slave/chapter2-awakening\">Chapter 2 Awakening</a></li>" +
        "<li><a href=\"https://novellive.app/book/shadow-slave/chapter3-ashes\">Chapter 3 Ashes</a></li>" +
        "</ul></div>" +
        "</body></html>",
        "text/html"
    );

    let parser = new NovelliveParser();
    let chapters = parser.extractPartialChapterList(dom);

    assert.deepEqual(
        chapters.map(chapter => chapter.title),
        ["Chapter 1 Nightmare Begins", "Chapter 2 Awakening", "Chapter 3 Ashes"]
    );
});

QUnit.test("getChapterUrls from chapter page fetches toc and paginated chapter lists", function (assert) {
    let done = assert.async();
    let chapterDom = new DOMParser().parseFromString(
        "<html><head><base href=\"https://novellive.app/book/shadow-slave/chapter1-nightmare-begins\"></head>" +
        "<body>" +
        "<h1 class=\"tit\">Shadow Slave</h1>" +
        "<span class=\"chapter\">Chapter 1 Nightmare Begins</span>" +
        "</body></html>",
        "text/html"
    );

    let originalWrapFetchImpl = HttpClient.wrapFetchImpl;
    HttpClient.wrapFetchImpl = function(url) {
        let htmlByUrl = {
            "https://novellive.app/book/shadow-slave": "" +
                "<html><body>" +
                "<div><h2 class=\"tit\">Latest Chapters</h2><ul class=\"ul-list5\">" +
                "<li><a href=\"https://novellive.app/book/shadow-slave/chapter130-latest\">Chapter 130 Latest</a></li>" +
                "</ul></div>" +
                "<div><h2 class=\"tit\">Chapter List</h2><ul class=\"ul-list5\">" +
                "<li><a href=\"https://novellive.app/book/shadow-slave/chapter1-nightmare-begins\">Chapter 1 Nightmare Begins</a></li>" +
                "<li><a href=\"https://novellive.app/book/shadow-slave/chapter2-awakening\">Chapter 2 Awakening</a></li>" +
                "</ul></div>" +
                "<div class=\"page\">" +
                "<a class=\"index-container-btn\" href=\"https://novellive.app/book/shadow-slave\">First</a>" +
                "<a class=\"index-container-btn\" href=\"https://novellive.app/book/shadow-slave/2\">Last</a>" +
                "</div>" +
                "</body></html>",
            "https://novellive.app/book/shadow-slave/2": "" +
                "<html><body>" +
                "<div><h2 class=\"tit\">Chapter List</h2><ul class=\"ul-list5\">" +
                "<li><a href=\"https://novellive.app/book/shadow-slave/chapter3-ashes\">Chapter 3 Ashes</a></li>" +
                "<li><a href=\"https://novellive.app/book/shadow-slave/chapter4-the-spell\">Chapter 4 The Spell</a></li>" +
                "</ul></div>" +
                "</body></html>"
        };
        let responseXML = new DOMParser().parseFromString(htmlByUrl[url], "text/html");
        util.setBaseTag(url, responseXML);
        return Promise.resolve({responseXML});
    };

    let parser = new NovelliveParser();
    parser.rateLimitDelay = async function() {};
    parser.getChapterUrls(chapterDom, { showTocProgress() {} }).then(function(chapters) {
        assert.deepEqual(
            chapters.map(chapter => chapter.title),
            [
                "Chapter 1 Nightmare Begins",
                "Chapter 2 Awakening",
                "Chapter 3 Ashes",
                "Chapter 4 The Spell"
            ]
        );

        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        done();
    }).catch(function(error) {
        HttpClient.wrapFetchImpl = originalWrapFetchImpl;
        assert.ok(false, error.message);
        done();
    });
});
