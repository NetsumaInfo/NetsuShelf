
"use strict";

module("UChapterUrlsUI");

function setupChapterGroupBrowserFixture() {
    let fixture = document.getElementById("qunit-fixture");
    fixture.innerHTML = `
        <input id="collapseChapterGroupsCheckbox" type="checkbox" checked />
        <div id="groupPackControls"></div>
        <div id="chapterGroupBrowserSection">
            <strong id="chapterGroupBrowserTitle"></strong>
            <p id="chapterGroupSummary"></p>
            <div id="chapterGroupEmptyState"></div>
            <div id="chapterGroupBrowser"></div>
        </div>
    `;
    return fixture;
}

QUnit.test("chaptersToHTML", function (assert) {
    let parser = {
        chapters: [
            { isIncludeable: true,  sourceUrl: "http://a.com", title: "1" },
            { isIncludeable: false, sourceUrl: "http://b.com", title: "2" },
            { isIncludeable: true,  sourceUrl: "http://c.com", title: "3" }
        ]
    };

    let ui = new ChapterUrlsUI(parser);
    let out = ui.chaptersToHTML(parser.chapters);
    assert.equal(out, "<a href=\"http://a.com\">1</a>\r<a href=\"http://c.com\">3</a>\r");
});

QUnit.test("chaptersToHTML", function (assert) {
    let innerHtml = "<a href=\"http://a.com\">1</a>\r<a href=\"http://c.com\">3</a>\r";
    let ui = new ChapterUrlsUI(null);
    let chapters = ui.htmlToChapters(innerHtml);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].sourceUrl, "http://a.com/");
    assert.equal(chapters[1].title, "3");
});

QUnit.test("renderChapterGroupBrowser lazy-renders chapter items when collapsed by default", function(assert) {
    setupChapterGroupBrowserFixture();
    let ui = new ChapterUrlsUI(null);
    let groups = [{
        id: "group-1",
        displayTitle: "Volume 1",
        count: 2,
        rangeLabel: "1-2",
        chapters: [
            { title: "Chapter 1", sourceUrl: "https://example.com/1", isIncludeable: true },
            { title: "Chapter 2", sourceUrl: "https://example.com/2", isIncludeable: true }
        ]
    }];

    ui.renderChapterGroupBrowser(groups);

    let browser = ChapterUrlsUI.getChapterGroupBrowser();
    let card = browser.querySelector(".chapterGroupCard");
    assert.equal(browser.querySelectorAll(".chapterGroupChapterItem").length, 0);

    card.open = true;
    card.dispatchEvent(new Event("toggle"));

    assert.equal(browser.querySelectorAll(".chapterGroupChapterItem").length, 2);
});

QUnit.test("getVisibleChapterGroupIds falls back to visible cards when select is absent", function(assert) {
    setupChapterGroupBrowserFixture();
    let browser = ChapterUrlsUI.getChapterGroupBrowser();
    browser.innerHTML = `
        <details class="chapterGroupCard" data-group-id="group-1"></details>
        <details class="chapterGroupCard" data-group-id="group-2" hidden></details>
    `;

    assert.deepEqual(ChapterUrlsUI.getVisibleChapterGroupIds(), ["group-1"]);
});

