
"use strict";

module("QidianParser");

QUnit.test("linkToChapter_notLocked", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let link = dom.querySelector("a");
    let checkbox = dom.getElementById("removeChapterNumberCheckbox");
    document.body.appendChild(checkbox);
    let actual = QidianParser.linkToChapter(link);
    assert.equal(actual.title, "1: Young Zhao Feng");
    assert.equal(actual.isIncludeable, true);
    checkbox.remove();
});

QUnit.test("linkToChapter_Locked", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let links = [...dom.querySelectorAll("a")];
    let checkbox = dom.getElementById("removeChapterNumberCheckbox");
    document.body.appendChild(checkbox);
    let actual = QidianParser.linkToChapter(links[1]);
    assert.equal(actual.title, "185: Worsen");
    assert.equal(actual.isIncludeable, false);
    checkbox.remove();
});

QUnit.test("extractTitle", function (assert) {
    let dom = new DOMParser().parseFromString(QidianChatperLinkSample, "text/html");
    let actual = new QidianParser().extractTitle(dom);
    assert.equal(actual, "King of Gods");
});

QUnit.test("getChapterUrls_volumeItemsPreserveVolumeMetadata", function (assert) {
    let done = assert.async();
    let dom = new DOMParser().parseFromString(QidianCatalogSample, "text/html");
    let checkbox = dom.getElementById("removeChapterNumberCheckbox");
    document.body.appendChild(checkbox);

    new QidianParser().getChapterUrls(dom).then(function(actual) {
        assert.equal(actual.length, 3);
        assert.equal(actual[0].groupLabel, "Volume 1");
        assert.equal(actual[0].groupTitle, "Ashes of the Past");
        assert.equal(actual[0].newArc, "Volume 1 - Ashes of the Past");
        assert.equal(actual[1].groupKey, "volume:1");
        assert.equal(actual[2].groupKey, "volume:2");
        assert.equal(actual[2].newArc, "Volume 2");
        checkbox.remove();
        done();
    });
});

let QidianChatperLinkSample =
`<!DOCTYPE html>
<html lang="en-US" class="dark-skin">
<head>
    <title>King of Gods - Eastern Fantasy - Webnovel - Your Fictional Stories Hub</title>
    <base href="https://www.webnovel.com/book/9017100806001205/King-of-Gods" />
    <meta property="og:title" content="King of Gods">
</head>
<body>
<div class="page"><h1 class="pt4 pb4 oh mb4 auto_height">King of Gods <small>KOG</small></h2><div>
<input id="removeChapterNumberCheckbox" type="checkbox">
<ol>
<li class="g_col_6" data-report-eid="E10" data-bid="King of Gods" data-report-bid="9017100806001205" data-cid="30995441462068685" data-report-cid="30995441462068685">
    <a href="//www.webnovel.com/book/9017100806001205/30995441462068685/King-of-Gods/Young-Zhao-Feng-" class="c_000 db pr clearfix pt8 pb8 pr8 pl8">
        <i class="fl fs16 lh24 c_l _num mr4 tal">1</i>
        <div class="oh">
            <strong class="db mb8 fs16 lh24 c_l ell">Young Zhao Feng </strong>
            <small class="db fs12 lh16 c_s">Aug 29,2018</small>
        </div>
    </a>
</li>
<li class="g_col_6" data-report-eid="E10" data-bid="King of Gods" data-report-bid="9017100806001205" data-cid="30995442267375141" data-report-cid="30995442267375141">
    <a href="//www.webnovel.com/book/9017100806001205/30995442267375141/King-of-Gods/Worsen-" class="c_000 db pr clearfix pt8 pb8 pr8 pl8">
        <i class="fl fs16 lh24 c_l _num mr4 tal">185</i>
        <svg class="fr _icon ml16 mt4 c_s fs16"><use xlink:href="#i-lock"></use></svg>
        <div class="oh">
            <strong class="db mb8 fs16 lh24 c_l ell">Worsen </strong>
            <small class="db fs12 lh16 c_s">Aug 29,2018</small>
        </div>
    </a>
</li>
<ol>
</body>
</html>
`;

let QidianCatalogSample =
`<!DOCTYPE html>
<html lang="en-US" class="dark-skin">
<head>
    <title>King of Gods - Catalog</title>
    <base href="https://www.webnovel.com/book/9017100806001205/catalog" />
</head>
<body>
<input id="removeChapterNumberCheckbox" type="checkbox">
<div class="volume-item">
    <h4>Volume 1: Ashes of the Past</h4>
    <ol>
        <li>
            <a href="https://www.webnovel.com/book/9017100806001205/1/King-of-Gods/Young-Zhao-Feng-">
                <i>1</i>
                <strong>Young Zhao Feng</strong>
            </a>
        </li>
        <li>
            <a href="https://www.webnovel.com/book/9017100806001205/2/King-of-Gods/New-Horizon-">
                <i>2</i>
                <strong>New Horizon</strong>
            </a>
        </li>
    </ol>
</div>
<div class="volume-item">
    <h4>Volume 2</h4>
    <ol>
        <li>
            <a href="https://www.webnovel.com/book/9017100806001205/3/King-of-Gods/Return-">
                <i>3</i>
                <strong>Return</strong>
            </a>
        </li>
    </ol>
</div>
</body>
</html>
`;
