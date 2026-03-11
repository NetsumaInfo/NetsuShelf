"use strict";

module("ChireadsParser");

QUnit.test("getChapterUrls_segmentHeadersPreserveSectionMetadata", function(assert) {
    let done = assert.async();
    let dom = new DOMParser().parseFromString(ChireadsCategorySample, "text/html");

    new ChireadsParser().getChapterUrls(dom).then(function(actual) {
        assert.equal(actual.length, 3);
        assert.equal(actual[0].groupType, "section");
        assert.equal(actual[0].groupTitle, "Chapitres Récents");
        assert.equal(actual[0].groupSource, "native_section");
        assert.equal(actual[2].groupTitle, "Bonus");
        done();
    });
});

let ChireadsCategorySample =
`<!DOCTYPE html>
<html>
<head>
    <title>Chireads Category Sample</title>
    <base href="https://chireads.com/category/translatedtales/sample-story/" />
</head>
<body>
    <div class="chapitre">
        <div class="segment-header"><b> > Chapitres Récents [ 2 ]</b><span class="toggle-icon">−</span></div>
        <div class="volume-content" style="display:block">
            <div class="chapitre-table">
                <ul>
                    <li>
                        <a href="https://chireads.com/translatedtales/sample-story/chapitre-1/2026/03/01/" title="Chapitre 1 : Départ">Chapitre 1 : Départ</a>
                        <a href="https://chireads.com/translatedtales/sample-story/chapitre-2/2026/03/02/" title="Chapitre 2 : Suite">Chapitre 2 : Suite</a>
                    </li>
                </ul>
            </div>
        </div>
        <div class="segment-header"><b> > Bonus [ 1 ]</b><span class="toggle-icon">−</span></div>
        <div class="volume-content" style="display:block">
            <div class="chapitre-table">
                <ul>
                    <li>
                        <a href="https://chireads.com/translatedtales/sample-story/chapitre-3-bonus/2026/03/03/" title="Chapitre 3 : Bonus">Chapitre 3 : Bonus</a>
                    </li>
                </ul>
            </div>
        </div>
    </div>
</body>
</html>`;
