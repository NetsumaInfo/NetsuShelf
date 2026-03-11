/*
    Main processing handler for popup.html

*/
var main = (function() {
    "use strict";

    // this will be called when message listener fires
    function onMessageListener(message, sender, sendResponse) {  // eslint-disable-line no-unused-vars
        if (message.messageType == "ParseResults") {
            chrome.runtime.onMessage.removeListener(onMessageListener);
            util.log("addListener");
            util.log(message);
            // convert the string returned from content script back into a DOM
            let dom = new DOMParser().parseFromString(message.document, "text/html");
            void populateControlsWithDom(message.url, dom).catch(handlePopupAsyncError);
        }
    }

    // details 
    let initialWebPage = null;
    let parser = null;
    let userPreferences = null;
    let library = new Library; 
    let referenceGroupingSources = [];
    let referenceGroupingSourceSequence = 0;
    let referenceGroupingAutoAnalyzeTimer = null;
    let referenceGroupingAnalysisSequence = 0;
    let progressActionState = { isBusy: false, actionMode: "pack", requestedStopReason: null };
    let storyDownloadSession = null;
    let reliableReferenceSites = [
        "webnovel.com",
        "wuxiaworld.com",
        "kakuyomu.jp",
        "syosetu.com",
        "baka-tsuki.org"
    ];
    let referenceSiteLabels = new Map([
        ["webnovel.com", "Webnovel"],
        ["wuxiaworld.com", "Wuxiaworld"],
        ["kakuyomu.jp", "Kakuyomu"],
        ["syosetu.com", "Syosetu"],
        ["baka-tsuki.org", "Baka-Tsuki"]
    ]);

    function cancelActionLabel() {
        return UIText.Common.cancel || "Cancel";
    }

    function cancellingActionLabel() {
        return "Cancelling...";
    }

    function progressStatusLabel(actionMode = "pack", phase = "fetching") {
        let formatLabel = getSelectedDownloadFormat().toUpperCase();
        if (phase === "finalizing") {
            return (actionMode === "library")
                ? "Finalizing library..."
                : `Finalizing ${formatLabel}...`;
        }
        if (phase === "packing") {
            return (actionMode === "library")
                ? "Preparing library..."
                : `Building ${formatLabel}...`;
        }
        return (actionMode === "library")
            ? "Adding to Library..."
            : `Downloading ${formatLabel}...`;
    }

    function setProgressButtonState(button, { hidden = false, disabled = false, text = null, title = null } = {}) {
        if (button == null) {
            return;
        }
        button.hidden = hidden;
        button.disabled = disabled;
        if (text != null) {
            button.textContent = text;
        }
        if (title != null) {
            button.title = title;
        }
    }

    function resetProgressDisplay() {
        ProgressBar.setMax(1);
        ProgressBar.setValue(0);
    }

    function getReferenceGroupingSourceSelect() {
        return document.getElementById("referenceGroupingSourceSelect");
    }

    function getReferenceGroupingStatus() {
        return document.getElementById("referenceGroupingStatus");
    }

    function getReferenceSitePresetCheckboxes() {
        return [...document.querySelectorAll("#referenceSitePresetFilters input[data-reference-host]")];
    }

    function syncReferenceSiteChipVisualState() {
        getReferenceSitePresetCheckboxes().forEach((checkbox) => {
            checkbox.closest(".referenceSiteChip")
                ?.classList.toggle("referenceSiteChipActive", checkbox.checked);
        });
    }

    function setReferenceGroupingStatus(message, state = "info") {
        let status = getReferenceGroupingStatus();
        if (status == null) {
            return;
        }
        status.textContent = message ?? "";
        status.hidden = util.isNullOrEmpty(message);
        status.dataset.state = state;
    }

    function readSelectedReferenceSiteHostsFromUi() {
        return new Set(
            getReferenceSitePresetCheckboxes()
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.dataset.referenceHost)
        );
    }

    function setSelectedReferenceSiteHosts(hosts) {
        let selectedHosts = hosts instanceof Set ? hosts : new Set(hosts ?? []);
        getReferenceSitePresetCheckboxes().forEach((checkbox) => {
            checkbox.checked = selectedHosts.has(checkbox.dataset.referenceHost);
        });
        syncReferenceSiteChipVisualState();
    }

    function referenceSiteLabel(host) {
        return referenceSiteLabels.get(host) ?? host;
    }

    function shouldAutoSwitchToGroupedView(groups) {
        if (!Array.isArray(groups) || (groups.length === 0)) {
            return false;
        }
        return groups.some(group => ChapterUrlsUI.isVolumeLikeGroup(group)) || (groups.length > 1);
    }

    function syncChapterGroupingModeWithAvailableGroups(groups) {
        let modeSelect = document.getElementById("chapterGroupingModeSelect");
        if ((modeSelect == null) || (modeSelect.value !== "flat") || !shouldAutoSwitchToGroupedView(groups)) {
            return;
        }

        modeSelect.value = groups.some(group => ChapterUrlsUI.isVolumeLikeGroup(group))
            ? "volumes"
            : "groups";
        modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function getCurrentStoryTitle() {
        return getValueFromUiField("titleInput")?.trim() ?? "";
    }

    function getCurrentStoryUrl() {
        return parser?.state?.chapterListUrl
            ?? getValueFromUiField("startingUrlInput")
            ?? initialWebPage?.baseURI
            ?? "";
    }

    function sanitizeReferenceSearchTerm(value) {
        return (value ?? "")
            .replace(/\s+/g, " ")
            .replace(/^[\s\-:|/]+|[\s\-:|/]+$/g, "")
            .trim();
    }

    function addReferenceSearchCandidate(candidates, seen, value) {
        let candidate = sanitizeReferenceSearchTerm(value);
        if (util.isNullOrEmpty(candidate)) {
            return;
        }
        let key = candidate.toLocaleLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push(candidate);
    }

    function expandReferenceSearchCandidate(candidates, seen, value) {
        let candidate = sanitizeReferenceSearchTerm(value);
        if (util.isNullOrEmpty(candidate)) {
            return;
        }
        addReferenceSearchCandidate(candidates, seen, candidate);

        candidate
            .replace(/[()[\]]/g, "|")
            .split(/\s+\|\s+|\s+[–—-]\s+|\s*:\s*/g)
            .forEach(part => addReferenceSearchCandidate(candidates, seen, part));

        let slugTokens = candidate
            .split(/\s+/)
            .map(token => token.trim())
            .filter(token => token.length > 1);
        for (let size = Math.min(slugTokens.length, 5); size >= 2; size--) {
            addReferenceSearchCandidate(candidates, seen, slugTokens.slice(-size).join(" "));
        }
    }

    function popupRuntimeErrorMessage(error) {
        return error?.message ?? String(error ?? "");
    }

    function isHandledPopupRuntimeError(error) {
        let message = popupRuntimeErrorMessage(error);
        return message.includes("No tab with id")
            || message.includes("File already exists")
            || message.includes("A file with this name already exists.");
    }

    function handlePopupAsyncError(error) {
        if (popupRuntimeErrorMessage(error).includes("No tab with id")) {
            handleTabModeLoadError(error);
            return;
        }
        ErrorLog.showErrorMessage(Download.toUserFacingError(error));
    }

    function onUnhandledRejection(event) {
        let reason = event?.reason;
        if (!isHandledPopupRuntimeError(reason)) {
            return;
        }
        event.preventDefault();
        handlePopupAsyncError(reason);
    }

    function collectReferenceSearchCandidatesFromUrl(url, candidates, seen) {
        if (util.isNullOrEmpty(url) || !util.isUrl(url)) {
            return;
        }
        let ignoredSegments = new Set([
            "book",
            "books",
            "comic",
            "novel",
            "novels",
            "works",
            "episodes",
            "chapter",
            "chapters",
            "category",
            "series",
            "translatedtales",
            "tag"
        ]);
        let parsed = new URL(url);
        parsed.pathname
            .split("/")
            .map(segment => decodeURIComponent(segment).trim())
            .filter(segment => !util.isNullOrEmpty(segment))
            .filter(segment => !ignoredSegments.has(segment.toLocaleLowerCase()))
            .forEach((segment) => {
                if (/^\d+$/.test(segment)) {
                    return;
                }
                expandReferenceSearchCandidate(
                    candidates,
                    seen,
                    segment.replace(/[_-]+/g, " ")
                );
            });
    }

    function buildReferenceSearchTitleCandidates() {
        let candidates = [];
        let seen = new Set();

        expandReferenceSearchCandidate(candidates, seen, getCurrentStoryTitle());
        expandReferenceSearchCandidate(candidates, seen, parser?.extractTitle?.(initialWebPage));
        expandReferenceSearchCandidate(candidates, seen, initialWebPage?.querySelector("meta[property='og:title']")?.content);
        expandReferenceSearchCandidate(candidates, seen, initialWebPage?.querySelector("meta[name='twitter:title']")?.content);
        expandReferenceSearchCandidate(candidates, seen, initialWebPage?.querySelector("title")?.textContent);
        collectReferenceSearchCandidatesFromUrl(getCurrentStoryUrl(), candidates, seen);

        return candidates.slice(0, 10);
    }

    function normalizeReferenceMatchText(value) {
        return sanitizeReferenceSearchTerm(value)
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase()
            .replace(/[&]+/g, " and ")
            .replace(/['’]/g, "")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .replace(/\b(the|a|an|novel|webnovel|web|light|roman|story|official)\b/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function tokenizeReferenceMatchText(value) {
        return normalizeReferenceMatchText(value)
            .split(" ")
            .filter(token => token.length > 1);
    }

    function scoreReferenceTitleMatch(searchTitle, candidateTitle) {
        let normalizedSearch = normalizeReferenceMatchText(searchTitle);
        let normalizedCandidate = normalizeReferenceMatchText(candidateTitle);
        if (util.isNullOrEmpty(normalizedSearch) || util.isNullOrEmpty(normalizedCandidate)) {
            return 0;
        }
        if (normalizedSearch === normalizedCandidate) {
            return 1;
        }
        if (normalizedCandidate.includes(normalizedSearch) || normalizedSearch.includes(normalizedCandidate)) {
            let maxLength = Math.max(normalizedSearch.length, normalizedCandidate.length, 1);
            let delta = Math.abs(normalizedSearch.length - normalizedCandidate.length) / maxLength;
            return Math.max(0.72, 0.94 - (delta * 0.22));
        }

        let searchTokens = [...new Set(tokenizeReferenceMatchText(normalizedSearch))];
        let candidateTokens = new Set(tokenizeReferenceMatchText(normalizedCandidate));
        if ((searchTokens.length === 0) || (candidateTokens.size === 0)) {
            return 0;
        }
        let overlap = searchTokens.filter(token => candidateTokens.has(token)).length;
        if (overlap === 0) {
            return 0;
        }
        let precision = overlap / searchTokens.length;
        let recall = overlap / candidateTokens.size;
        let phrase = searchTokens.slice(0, Math.min(3, searchTokens.length)).join(" ");
        let phraseBonus = util.isNullOrEmpty(phrase) || !normalizedCandidate.includes(phrase) ? 0 : 0.08;
        return Math.min(0.9, (precision * 0.65) + (recall * 0.2) + phraseBonus);
    }

    function dedupeReferenceMatches(matches) {
        let deduped = new Map();
        matches.forEach((match) => {
            if (util.isNullOrEmpty(match?.url) || util.isNullOrEmpty(match?.title)) {
                return;
            }
            if (!deduped.has(match.url)) {
                deduped.set(match.url, {
                    url: match.url,
                    title: match.title.trim(),
                    aliases: (match.aliases ?? []).filter(alias => !util.isNullOrEmpty(alias)),
                    penalty: match.penalty ?? 0
                });
            }
        });
        return [...deduped.values()];
    }

    function pickBestReferenceMatch(searchTerms, matches) {
        let ranked = dedupeReferenceMatches(matches)
            .map((match) => {
                let score = 0;
                searchTerms.forEach((term, index) => {
                    let aliasScores = [match.title, ...(match.aliases ?? [])]
                        .map(value => scoreReferenceTitleMatch(term, value))
                        .filter(value => 0 < value);
                    if (aliasScores.length === 0) {
                        return;
                    }
                    let candidateScore = Math.max(...aliasScores) - (index * 0.01) - (match.penalty ?? 0);
                    score = Math.max(score, candidateScore);
                });
                return Object.assign({}, match, {matchScore: score});
            })
            .sort((left, right) => right.matchScore - left.matchScore);
        let bestMatch = ranked[0] ?? null;
        return (bestMatch == null) || (bestMatch.matchScore < 0.5) ? null : bestMatch;
    }

    class ReferenceLookupErrorHandler extends FetchErrorHandler {
        onFetchError(url, error) {
            return Promise.reject(new Error(error?.message ?? String(error)));
        }

        onResponseError(url, wrapOptions, response, errorMessage) {
            return Promise.reject(new Error(errorMessage ?? `${response.status}`));
        }
    }

    async function fetchReferenceHtml(url) {
        await HttpClient.setPartitionCookies(url);
        let response;
        try {
            response = await fetch(url, HttpClient.makeOptions());
        } catch (error) {
            return new ReferenceLookupErrorHandler().onFetchError(url, error);
        }
        if (!response.ok) {
            return new ReferenceLookupErrorHandler().onResponseError(url, {}, response);
        }
        let html = new DOMParser().parseFromString(await response.text(), "text/html");
        util.setBaseTag(response.url, html);
        return html;
    }

    async function fetchReferenceJson(url) {
        await HttpClient.setPartitionCookies(url);
        let response;
        try {
            response = await fetch(url, HttpClient.makeOptions());
        } catch (error) {
            return new ReferenceLookupErrorHandler().onFetchError(url, error);
        }
        if (!response.ok) {
            return new ReferenceLookupErrorHandler().onResponseError(url, {}, response);
        }
        return response.json();
    }

    function isInteractiveChallengeDom(dom) {
        let title = dom?.querySelector("title")?.textContent?.toLocaleLowerCase() ?? "";
        let bodyText = dom?.body?.textContent?.toLocaleLowerCase() ?? "";
        return title.includes("just a moment")
            || bodyText.includes("enable javascript and cookies to continue");
    }

    function collectReferenceMatchesFromAnchors(dom, baseUrl, hrefPattern) {
        let matches = [];
        [...dom.querySelectorAll("a[href]")].forEach((link) => {
            let href = link.getAttribute("href");
            if (util.isNullOrEmpty(href)) {
                return;
            }
            let absoluteUrl = util.resolveRelativeUrl(baseUrl, href);
            if (!hrefPattern.test(new URL(absoluteUrl).pathname)) {
                return;
            }
            let title = link.getAttribute("title")?.trim()
                || link.textContent?.trim()
                || link.querySelector("img")?.getAttribute("alt")?.trim()
                || link.closest("article, li, div")?.textContent?.trim()
                || "";
            title = title
                .split("\n")
                .map(line => line.trim())
                .find(line => !util.isNullOrEmpty(line))
                ?? "";
            matches.push({url: absoluteUrl, title: title});
        });
        return dedupeReferenceMatches(matches);
    }

    async function searchWebnovelReferenceSource(searchTerms) {
        for (let searchTerm of searchTerms) {
            let searchUrl = `https://www.webnovel.com/search?keywords=${encodeURIComponent(searchTerm)}`;
            let dom = await fetchReferenceHtml(searchUrl);
            if (isInteractiveChallengeDom(dom)) {
                throw new Error("automatic search is blocked by an interactive browser challenge");
            }
            let bestMatch = pickBestReferenceMatch(
                searchTerms,
                collectReferenceMatchesFromAnchors(dom, searchUrl, /\/book\/(?:.*?_)?\d+\b/i)
            );
            if (bestMatch != null) {
                return bestMatch;
            }
        }
        return null;
    }

    async function searchWuxiaworldReferenceSource(searchTerms) {
        for (let searchTerm of searchTerms) {
            let searchUrl = `https://www.wuxiaworld.com/search?query=${encodeURIComponent(searchTerm)}`;
            let dom = await fetchReferenceHtml(searchUrl);
            let bestMatch = pickBestReferenceMatch(
                searchTerms,
                collectReferenceMatchesFromAnchors(dom, searchUrl, /\/novel\//i)
            );
            if (bestMatch != null) {
                return bestMatch;
            }
        }
        return null;
    }

    function collectKakuyomuReferenceMatches(dom) {
        let script = dom.querySelector("script#__NEXT_DATA__")?.textContent;
        if (util.isNullOrEmpty(script)) {
            return [];
        }
        let apolloState = JSON.parse(script)?.props?.pageProps?.__APOLLO_STATE__ ?? {};
        return dedupeReferenceMatches(
            Object.values(apolloState)
                .filter(entry => entry?.__typename === "Work")
                .map(entry => ({
                    url: `https://kakuyomu.jp/works/${entry.id}`,
                    title: entry.title,
                    aliases: [entry.alternateTitle, entry.catchphrase],
                }))
        );
    }

    async function searchKakuyomuReferenceSource(searchTerms) {
        for (let searchTerm of searchTerms) {
            let searchUrl = `https://kakuyomu.jp/search?q=${encodeURIComponent(searchTerm)}`;
            let dom = await fetchReferenceHtml(searchUrl);
            let bestMatch = pickBestReferenceMatch(searchTerms, collectKakuyomuReferenceMatches(dom));
            if (bestMatch != null) {
                return bestMatch;
            }
        }
        return null;
    }

    async function searchSyosetuReferenceSource(searchTerms) {
        for (let searchTerm of searchTerms) {
            let apiUrl = `https://api.syosetu.com/novelapi/api/?out=json&lim=20&word=${encodeURIComponent(searchTerm)}`;
            let data = await fetchReferenceJson(apiUrl);
            let matches = Array.isArray(data)
                ? data.slice(1).map(item => ({
                    url: `https://ncode.syosetu.com/${item.ncode?.toLocaleLowerCase()}/`,
                    title: item.title,
                }))
                : [];
            let bestMatch = pickBestReferenceMatch(searchTerms, matches);
            if (bestMatch != null) {
                return bestMatch;
            }
        }
        return null;
    }

    async function searchBakaTsukiReferenceSource(searchTerms) {
        for (let searchTerm of searchTerms) {
            let apiUrl = `https://www.baka-tsuki.org/project/api.php?action=query&list=search&format=json&srsearch=${encodeURIComponent(searchTerm)}`;
            let data = await fetchReferenceJson(apiUrl);
            let matches = (data?.query?.search ?? []).map(item => ({
                url: `https://www.baka-tsuki.org/project/index.php?title=${encodeURIComponent(item.title)}`,
                title: item.title,
                penalty: item.title.includes(":") ? 0.08 : 0
            }));
            let bestMatch = pickBestReferenceMatch(searchTerms, matches);
            if (bestMatch != null) {
                return bestMatch;
            }
        }
        return null;
    }

    async function searchReferenceGroupingSourceByHost(host, searchTerms) {
        switch (host) {
            case "webnovel.com":
                return searchWebnovelReferenceSource(searchTerms);
            case "wuxiaworld.com":
                return searchWuxiaworldReferenceSource(searchTerms);
            case "kakuyomu.jp":
                return searchKakuyomuReferenceSource(searchTerms);
            case "syosetu.com":
                return searchSyosetuReferenceSource(searchTerms);
            case "baka-tsuki.org":
                return searchBakaTsukiReferenceSource(searchTerms);
            default:
                throw new Error("automatic lookup is not available for this site");
        }
    }

    function describeReferenceGroupingSource(source) {
        return `${source.storyLabel} (${source.host}, ${source.mappedGroups.length} groups)`;
    }

    function formatReferenceSiteCount(count) {
        return `${count} reference site${count === 1 ? "" : "s"}`;
    }

    function getActiveReferenceGroupingSource() {
        let sourceId = parser?.getReferenceChapterGroupSource?.()?.id;
        if (util.isNullOrEmpty(sourceId)) {
            return null;
        }
        return referenceGroupingSources.find(candidate => candidate.id === sourceId) ?? null;
    }

    function buildReferenceGroupingProgressMessage(host, processedCount, totalCount) {
        let parts = [];
        if (referenceGroupingSources.length > 0) {
            parts.push(`Loaded ${formatReferenceSiteCount(referenceGroupingSources.length)}.`);
            let activeSource = getActiveReferenceGroupingSource();
            if (activeSource != null) {
                parts.push(`Active source: ${activeSource.storyLabel}.`);
            }
        }
        parts.push(`Searching ${processedCount}/${totalCount}: ${referenceSiteLabel(host)}...`);
        return parts.join(" ");
    }

    function buildReferenceGroupingCompletedMessage(failureCount = 0) {
        let parts = [`Loaded ${formatReferenceSiteCount(referenceGroupingSources.length)}.`];
        if (failureCount > 0) {
            parts.push(`${failureCount} skipped.`);
        }
        let activeSource = getActiveReferenceGroupingSource() ?? referenceGroupingSources[0] ?? null;
        if (activeSource != null) {
            parts.push(`Active source: ${activeSource.storyLabel}.`);
        }
        return parts.join(" ");
    }

    function updateReferenceGroupingSourceSelect(selectedValue = null) {
        let select = getReferenceGroupingSourceSelect();
        if (select == null) {
            return;
        }

        let currentValue = selectedValue ?? select.value ?? "current";
        util.removeElements([...select.options]);
        select.add(new Option("Current site groups", "current"));
        referenceGroupingSources.forEach((source) => {
            select.add(new Option(describeReferenceGroupingSource(source), source.id));
        });

        let hasCurrentValue = [...select.options].some(option => option.value === currentValue);
        select.value = hasCurrentValue ? currentValue : "current";
        select.disabled = (select.options.length <= 1);
    }

    function clearReferenceGroupingSources(options = {}) {
        referenceGroupingAnalysisSequence++;
        referenceGroupingSources = [];
        referenceGroupingSourceSequence = 0;
        parser?.clearReferenceChapterGroups?.();
        updateReferenceGroupingSourceSelect("current");
        if (!options.preserveStatus) {
            setReferenceGroupingStatus("");
        }
        if (!options.preserveSiteSelection) {
            setSelectedReferenceSiteHosts(reliableReferenceSites);
        }
    }

    function hasUsableReferenceGroups(groups) {
        if (!Array.isArray(groups) || (groups.length === 0)) {
            return false;
        }
        if (1 < groups.length) {
            return true;
        }
        return ["volume", "book", "tome"].includes(groups[0].type)
            && (groups[0].source !== "manual_range");
    }

    function hasNativeVolumeMarkers(groups) {
        return Array.isArray(groups)
            && groups.some(group => ["volume", "book", "tome"].includes(group.type));
    }

    function shouldAutoDetectReferenceGroups() {
        return (parser != null)
            && (readSelectedReferenceSiteHostsFromUi().size !== 0)
            && !hasNativeVolumeMarkers(parser.getNativeChapterGroups())
            && (buildReferenceSearchTitleCandidates().length !== 0);
    }

    function scheduleAutomaticReferenceGroupingAnalysis(options = {}) {
        if (referenceGroupingAutoAnalyzeTimer != null) {
            window.clearTimeout(referenceGroupingAutoAnalyzeTimer);
            referenceGroupingAutoAnalyzeTimer = null;
        }
        if (!options.force && !shouldAutoDetectReferenceGroups()) {
            return;
        }
        referenceGroupingAutoAnalyzeTimer = window.setTimeout(() => {
            referenceGroupingAutoAnalyzeTimer = null;
            analyzeReferenceGroupingSources({automatic: true});
        }, options.immediate ? 0 : 220);
    }

    async function analyzeReferenceGroupingSourceUrl(url, sourceMetadata = {}) {
        let dom = await fetchReferenceHtml(url);
        if (isInteractiveChallengeDom(dom)) {
            throw new Error("interactive browser verification is required");
        }
        util.setBaseTag(url, dom);

        let referenceParser = parserFactory.fetch(url, dom);
        let disabledMessage = referenceParser?.disabled?.();
        if (disabledMessage != null) {
            throw new Error(disabledMessage);
        }
        referenceParser.onUserPreferencesUpdate(userPreferences);
        referenceParser.state.chapterListUrl = url;

        let chapters = await referenceParser.getChapterUrls(dom);
        chapters = referenceParser.cleanWebPageUrls(chapters);
        chapters?.forEach(chapter => chapter.title = chapter.title?.trim());
        referenceParser.setPagesToFetch(chapters);

        let referenceGroups = referenceParser.getNativeChapterGroups();
        let mappedGroups = util.mapReferenceChapterGroupsToChapters(
            referenceGroups,
            [...parser.getPagesToFetch().values()]
        );
        if (!hasUsableReferenceGroups(mappedGroups)) {
            return null;
        }

        let host = util.extractHostName(url);
        let storyLabel = sourceMetadata.storyLabel
            ?? referenceParser.extractTitle?.(dom)?.trim()
            ?? host;
        let storyCoverUrl = null;
        try {
            storyCoverUrl = referenceParser.findCoverImageUrl?.(dom) ?? null;
        } catch (error) {
            storyCoverUrl = null;
        }
        return {
            id: `reference-group-source-${++referenceGroupingSourceSequence}`,
            url: url,
            host: host,
            storyLabel: storyLabel,
            storyCoverUrl: storyCoverUrl,
            referenceGroups: referenceGroups,
            mappedGroups: mappedGroups
        };
    }

    async function applyReferenceGroupingSource(sourceId, options = {}) {
        if (parser == null) {
            return;
        }
        if (util.isNullOrEmpty(sourceId) || (sourceId === "current")) {
            parser.clearReferenceChapterGroups();
            if (options.suppressStatus !== true) {
                setReferenceGroupingStatus("Using current site groups.", "info");
            }
            return;
        }

        let source = referenceGroupingSources.find(candidate => candidate.id === sourceId);
        if (source == null) {
            parser.clearReferenceChapterGroups();
            if (options.suppressStatus !== true) {
                setReferenceGroupingStatus("The selected reference site could not be found.", "error");
            }
            updateReferenceGroupingSourceSelect("current");
            return;
        }

        parser.setReferenceChapterGroups(source.referenceGroups, {
            id: source.id,
            label: describeReferenceGroupingSource(source),
            url: source.url,
            host: source.host,
            storyCoverUrl: source.storyCoverUrl ?? null
        });

        let mappedGroups = parser.getReferenceChapterGroups();
        if (mappedGroups.length === 0) {
            if (options.suppressStatus !== true) {
                setReferenceGroupingStatus(
                    `The selected reference site (${source.storyLabel}) did not match the current chapter list.`,
                    "error"
                );
            }
            return;
        }

        if (util.isNullOrEmpty(CoverImageUI.getCoverImageUrl()) && !util.isNullOrEmpty(source.storyCoverUrl)) {
            CoverImageUI.setCoverImageUrl(source.storyCoverUrl);
        }
        syncChapterGroupingModeWithAvailableGroups(mappedGroups);
        if (options.suppressStatus !== true) {
            setReferenceGroupingStatus(
                `Using groups from ${source.storyLabel} (${source.host}).`,
                "success"
            );
        }
    }

    async function analyzeReferenceGroupingSources(options = {}) {
        let analysisSequence = ++referenceGroupingAnalysisSequence;
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let selectedHosts = [...readSelectedReferenceSiteHostsFromUi()];
        if (selectedHosts.length === 0) {
            parser.clearReferenceChapterGroups();
            updateReferenceGroupingSourceSelect("current");
            setReferenceGroupingStatus("No reference site selected.", "info");
            return;
        }

        let searchTerms = buildReferenceSearchTitleCandidates();
        if (searchTerms.length === 0) {
            setReferenceGroupingStatus("No usable story title was found for automatic reference lookup.", "error");
            return;
        }

        if (options.automatic === true && !options.force && !shouldAutoDetectReferenceGroups()) {
            return;
        }

        referenceGroupingSources = [];
        referenceGroupingSourceSequence = 0;
        parser.clearReferenceChapterGroups();
        updateReferenceGroupingSourceSelect("current");
        setReferenceGroupingStatus(buildReferenceGroupingProgressMessage(selectedHosts[0], 1, selectedHosts.length), "info");

        let sources = [];
        let failures = [];
        let hasAppliedFirstSource = false;

        for (let [index, host] of selectedHosts.entries()) {
            setReferenceGroupingStatus(
                buildReferenceGroupingProgressMessage(host, index + 1, selectedHosts.length),
                sources.length === 0 ? "info" : "success"
            );
            try {
                let match = await searchReferenceGroupingSourceByHost(host, searchTerms);
                if (analysisSequence !== referenceGroupingAnalysisSequence) {
                    return;
                }
                if (match == null) {
                    failures.push(`${referenceSiteLabel(host)}: no matching story found`);
                    continue;
                }
                let source = await analyzeReferenceGroupingSourceUrl(match.url, {
                    storyLabel: match.title
                });
                if (analysisSequence !== referenceGroupingAnalysisSequence) {
                    return;
                }
                if (source == null) {
                    failures.push(`${referenceSiteLabel(host)}: no usable chapter groups found`);
                    continue;
                }
                sources.push(source);
                referenceGroupingSources = [...sources];
                let selectedValue = getReferenceGroupingSourceSelect()?.value ?? "current";
                if (!hasAppliedFirstSource) {
                    updateReferenceGroupingSourceSelect(source.id);
                    await applyReferenceGroupingSource(source.id, { suppressStatus: true });
                    hasAppliedFirstSource = true;
                } else {
                    updateReferenceGroupingSourceSelect(selectedValue);
                }
            } catch (error) {
                if (analysisSequence !== referenceGroupingAnalysisSequence) {
                    return;
                }
                failures.push(`${referenceSiteLabel(host)}: ${error.message}`);
            }
        }

        if (analysisSequence !== referenceGroupingAnalysisSequence) {
            return;
        }

        if (sources.length === 0) {
            parser.clearReferenceChapterGroups();
            setReferenceGroupingStatus(
                failures.length === 0
                    ? "No usable reference site groups were found."
                    : `No usable reference site groups were found. ${failures[0]}`,
                "error"
            );
            return;
        }

        if (!hasAppliedFirstSource) {
            updateReferenceGroupingSourceSelect(sources[0].id);
            await applyReferenceGroupingSource(sources[0].id, { suppressStatus: true });
        }
        setReferenceGroupingStatus(buildReferenceGroupingCompletedMessage(failures.length), "success");
    }

    // register listener that is invoked when script injected into HTML sends its results
    function addMessageListener() {
        try {
            // note, this will throw if not running as an extension.
            if (!chrome.runtime.onMessage.hasListener(onMessageListener)) {
                chrome.runtime.onMessage.addListener(onMessageListener);
            }
        } catch (chromeError) {
            util.log(chromeError);
        }
    }

    // extract urls from DOM and populate control
    async function processInitialHtml(url, dom) {
        if (setParser(url, dom)) {
            try {
                userPreferences.addObserver(parser);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
                return;
            }
            try {
                await parser.loadEpubMetaInfo(dom);
                let metaInfo = parser.getEpubMetaInfo(dom, userPreferences.useFullTitle.value);
                populateMetaInfo(metaInfo);
                setUiToDefaultState();
                parser.populateUI(dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
            try {
                await parser.onLoadFirstPage(url, dom);
            } catch (error) {
                ErrorLog.showErrorMessage(error);
            }
        }
    }

    function setUiToDefaultState() {
        document.getElementById("highestResolutionImagesRow").hidden = true;
        document.getElementById("unSuperScriptAlternateTranslations").hidden = true; 
        document.getElementById("imageSection").hidden = true;
        document.getElementById("outputSection").hidden = false;
        document.getElementById("translatorRow").hidden = true;
        document.getElementById("fileAuthorAsRow").hidden = true;
        document.getElementById("defaultParserSection").hidden = true;
    }

    function populateMetaInfo(metaInfo) {
        normalizeMetaInfoFileName(metaInfo);
        setUiFieldToValue("startingUrlInput", metaInfo.uuid);
        setUiFieldToValue("titleInput", metaInfo.title);
        setUiFieldToValue("authorInput", metaInfo.author);
        setUiFieldToValue("languageInput", metaInfo.language);
        setUiFieldToValue("fileNameInput", metaInfo.fileName);
        setUiFieldToValue("subjectInput", metaInfo.subject);
        setUiFieldToValue("descriptionInput", metaInfo.description);
        if (metaInfo.seriesName !== null) {
            document.getElementById("seriesRow").hidden = false;
            document.getElementById("volumeRow").hidden = false;
            setUiFieldToValue("seriesNameInput", metaInfo.seriesName);
            setUiFieldToValue("seriesIndexInput", metaInfo.seriesIndex);
        }

        setUiFieldToValue("translatorInput", metaInfo.translator);
        setUiFieldToValue("fileAuthorAsInput", metaInfo.fileAuthorAs);
        updateDownloadFormatUi();
    }

    function setUiFieldToValue(elementId, value) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            element.value = (value == null) ? "" : value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    function metaInfoFromControls() {
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = getValueFromUiField("startingUrlInput");
        metaInfo.title = getValueFromUiField("titleInput");
        metaInfo.author = getValueFromUiField("authorInput");
        metaInfo.language = getValueFromUiField("languageInput");
        metaInfo.fileName = getValueFromUiField("fileNameInput");
        metaInfo.subject = getValueFromUiField("subjectInput");
        metaInfo.description = getValueFromUiField("descriptionInput");

        if (document.getElementById("seriesRow").hidden === false) {
            metaInfo.seriesName = getValueFromUiField("seriesNameInput");
            metaInfo.seriesIndex = getValueFromUiField("seriesIndexInput");
        }

        metaInfo.translator = getValueFromUiField("translatorInput");
        metaInfo.fileAuthorAs = getValueFromUiField("fileAuthorAsInput");
        metaInfo.styleSheet = userPreferences.styleSheet.value;
        normalizeMetaInfoFileName(metaInfo);

        return metaInfo;
    }

    function normalizeMetaInfoFileName(metaInfo) {
        if (metaInfo == null) {
            return;
        }
        let fallback = Download.sanitizeFileStem(metaInfo.title, "download");
        if (util.isNullOrEmpty(metaInfo.fileName) || Download.looksLikeOpaqueFileStem(metaInfo.fileName)) {
            metaInfo.fileName = fallback;
            return;
        }
        metaInfo.fileName = Download.sanitizeFileStem(metaInfo.fileName, fallback);
    }

    function getSelectedDownloadFormat() {
        return Download.outputFormat();
    }

    function isEpubDownloadFormat() {
        return getSelectedDownloadFormat() === "epub";
    }

    function applyNormalProgressActionLabels() {
        let format = getSelectedDownloadFormat();
        let formatLabel = format.toUpperCase();
        let unsupportedMessage = (format === "mobi")
            ? "MOBI export requires an external converter and is not available in the extension runtime yet."
            : "";

        let packButton = getPackEpubButton();
        if (packButton != null) {
            packButton.textContent = `Download ${formatLabel}`;
            packButton.disabled = (unsupportedMessage !== "");
            packButton.title = unsupportedMessage;
        }

        let libraryButton = document.getElementById("LibAddToLibrary");
        if (libraryButton != null) {
            libraryButton.textContent = UIText.Common.addToLibrary || "Add to Library";
            libraryButton.disabled = !isEpubDownloadFormat();
            libraryButton.title = isEpubDownloadFormat()
                ? ""
                : "Library is available for EPUB only.";
        }

        let pauseButton = document.getElementById("LibPauseToLibrary");
        if (pauseButton != null) {
            pauseButton.textContent = cancelActionLabel();
            pauseButton.title = "Cancel current download.";
            pauseButton.hidden = true;
        }

        return unsupportedMessage;
    }

    function syncProgressActionButtons() {
        let packButton = getPackEpubButton();
        let addButton = document.getElementById("LibAddToLibrary");
        let pauseButton = document.getElementById("LibPauseToLibrary");
        let progressSection = document.querySelector(".progressSection");
        if ((packButton == null) || (addButton == null) || (pauseButton == null)) {
            return;
        }

        applyNormalProgressActionLabels();
        if (progressSection != null) {
            progressSection.dataset.downloadState = storyDownloadSession?.status
                ?? (progressActionState.isBusy ? "busy" : "idle");
            progressSection.dataset.downloadPhase = storyDownloadSession?.phase ?? "";
        }
        pauseButton.style.gridColumn = "";
        pauseButton.style.gridRow = "";
        setProgressButtonState(pauseButton, { hidden: true, disabled: true });
        setProgressButtonState(packButton, { hidden: false, disabled: packButton.disabled });
        setProgressButtonState(addButton, { hidden: false, disabled: addButton.disabled });

        if (storyDownloadSession?.status === "running") {
            let actionMode = storyDownloadSession.actionMode ?? "pack";
            let phase = storyDownloadSession.phase ?? "fetching";
            let requestedStopReason = storyDownloadSession.requestedStopReason;
            let isCancelPending = requestedStopReason === "cancel";
            let isFinalizing = phase === "finalizing";
            let cancelLabel = isFinalizing
                ? progressStatusLabel(actionMode, phase)
                : (isCancelPending ? cancellingActionLabel() : cancelActionLabel());
            let cancelTitle = isFinalizing
                ? "The file is being finalized. Wait for it to finish."
                : (isCancelPending
                    ? "The current download is being cancelled."
                    : "Cancel the current download and clear the current progress.");
            let statusLabel = progressStatusLabel(actionMode, phase);

            if (actionMode === "library") {
                setProgressButtonState(packButton, {
                    hidden: false,
                    disabled: true,
                    text: statusLabel,
                    title: "A library import is running."
                });
                setProgressButtonState(addButton, {
                    hidden: false,
                    disabled: isFinalizing || isCancelPending,
                    text: cancelLabel,
                    title: cancelTitle
                });
            } else {
                setProgressButtonState(packButton, {
                    hidden: false,
                    disabled: isFinalizing || isCancelPending,
                    text: cancelLabel,
                    title: cancelTitle
                });
                setProgressButtonState(addButton, {
                    hidden: false,
                    disabled: true,
                    text: statusLabel,
                    title: "A download is already running."
                });
            }
            return;
        }

        if (progressActionState.isBusy) {
            let actionMode = progressActionState.actionMode ?? "pack";
            let isCancelPending = progressActionState.requestedStopReason === "cancel";
            let statusLabel = progressStatusLabel(actionMode, "fetching");
            if (actionMode === "library") {
                setProgressButtonState(packButton, {
                    hidden: false,
                    disabled: true,
                    text: statusLabel,
                    title: "A library import is running."
                });
                setProgressButtonState(addButton, {
                    hidden: false,
                    disabled: isCancelPending,
                    text: isCancelPending ? cancellingActionLabel() : cancelActionLabel(),
                    title: isCancelPending
                        ? "The current batch download is being cancelled."
                        : "Stop the current download run."
                });
            } else {
                setProgressButtonState(packButton, {
                    hidden: false,
                    disabled: isCancelPending,
                    text: isCancelPending ? cancellingActionLabel() : cancelActionLabel(),
                    title: isCancelPending
                        ? "The current batch download is being cancelled."
                        : "Stop the current download run."
                });
                setProgressButtonState(addButton, {
                    hidden: false,
                    disabled: true,
                    text: statusLabel,
                    title: "A download is already running."
                });
            }
        }
    }

    function updateDownloadFormatUi() {
        let unsupportedMessage = applyNormalProgressActionLabels();
        let formatSelect = document.getElementById("downloadFormatSelect");
        if (formatSelect != null) {
            formatSelect.disabled = (storyDownloadSession?.status === "running") || progressActionState.isBusy;
        }

        let downloadMarkedGroupsButton = document.getElementById("downloadMarkedChapterGroupsButton");
        if (downloadMarkedGroupsButton != null) {
            downloadMarkedGroupsButton.textContent = "Download selected";
            downloadMarkedGroupsButton.title = unsupportedMessage;
        }

        let downloadAllGroupsButton = document.getElementById("downloadAllChapterGroupsButton");
        if (downloadAllGroupsButton != null) {
            downloadAllGroupsButton.textContent = "Download all";
            downloadAllGroupsButton.title = unsupportedMessage;
        }

        parser?.state?.chapterUrlsUI?.syncMarkedChapterGroupsUi?.();
        syncProgressActionButtons();
    }

    function getValueFromUiField(elementId) {
        let element = document.getElementById(elementId);
        if (util.isTextInputField(element) || util.isTextAreaField(element)) {
            return (element.value === "") ? null : element.value;
        } else {
            throw new Error(UIText.Error.unhandledFieldTypeError);
        }
    }

    function getSelectedPages() {
        if (parser == null) {
            return [];
        }
        return [...parser.getPagesToFetch().values()].filter(page => page.isIncludeable);
    }

    function getGlobalChapterIndexMap() {
        let orderMap = new Map();
        if (parser != null) {
            [...parser.getPagesToFetch().values()].forEach((page, index) => {
                orderMap.set(page.sourceUrl, index + 1);
            });
        }
        return orderMap;
    }

    function getPackSizeFromUi() {
        let input = document.getElementById("packSizeInput");
        if (input == null) {
            let select = document.getElementById("packSizeSelect");
            if (select == null) {
                return 0;
            }
            let selectValue = parseInt(select.value, 10);
            return Number.isFinite(selectValue) && (0 < selectValue) ? selectValue : 0;
        }

        let rawValue = (input.value || "").trim();
        if (util.isNullOrEmpty(rawValue)) {
            return 0;
        }

        let value = parseInt(rawValue, 10);
        return Number.isFinite(value) && (0 < value) ? value : 0;
    }

    function chunkPages(pages, chunkSize) {
        if ((chunkSize <= 0) || (pages.length <= chunkSize)) {
            return [pages];
        }
        let chunks = [];
        for (let index = 0; index < pages.length; index += chunkSize) {
            chunks.push(pages.slice(index, index + chunkSize));
        }
        return chunks;
    }

    function withDownloadFormatSuffix(fileNameWithoutSuffix, suffix) {
        let base = Download.stripKnownExtension(fileNameWithoutSuffix);
        return Download.addExtensionForFormat(base + suffix, getSelectedDownloadFormat());
    }

    function buildBatchFileName(baseFileName, batchIndex, totalBatches, firstChapterIndex, lastChapterIndex, alwaysAddSuffix) {
        if (!alwaysAddSuffix && (totalBatches === 1)) {
            return baseFileName;
        }
        if (totalBatches === 1) {
            return withDownloadFormatSuffix(baseFileName, "_chapter_" + firstChapterIndex);
        }
        let batchNumber = String(batchIndex + 1).padStart(3, "0");
        let suffix = "_pack_" + batchNumber + "_" + firstChapterIndex + "-" + lastChapterIndex;
        return withDownloadFormatSuffix(baseFileName, suffix);
    }

    function cloneMetaInfo(metaInfo) {
        return Object.assign(new EpubMetaInfo(), metaInfo);
    }

    function stripDownloadExtension(fileName) {
        return Download.stripKnownExtension(fileName);
    }

    function buildAutomaticGroupFileStem(baseMetaInfo, group) {
        let storyTitle = baseMetaInfo?.title ?? document.getElementById("titleInput")?.value ?? "download";
        let groupTitle = util.makeChapterGroupDisplayTitle(group);
        return Download.sanitizeFileStem(`${storyTitle} - ${groupTitle}`, Download.sanitizeFileStem(storyTitle, "download"));
    }

    function buildGroupMetaInfo(baseMetaInfo, group) {
        let metaInfo = cloneMetaInfo(baseMetaInfo);
        let groupTitle = util.makeChapterGroupDisplayTitle(group);
        metaInfo.title = `${baseMetaInfo.title} - ${groupTitle}`;
        metaInfo.fileName = buildAutomaticGroupFileStem(baseMetaInfo, group);
        if ((metaInfo.seriesName == null) &&
            ((group.type === "volume") || (group.type === "book")) &&
            (group.index != null)) {
            metaInfo.seriesName = baseMetaInfo.title;
            metaInfo.seriesIndex = group.index;
        }
        return metaInfo;
    }

    function getChapterGroupById(groupId) {
        if ((parser == null) || util.isNullOrEmpty(groupId)) {
            return null;
        }
        return parser.getChapterGroups().find(group => group.id === groupId) ?? null;
    }

    function getDownloadablePagesForGroup(group) {
        if (group == null) {
            return [];
        }
        return group.chapters.filter(page => page.isSelectable !== false);
    }

    function resolveGroupCoverImageUrl(group) {
        return group?.coverUrl
            ?? parser?.getReferenceChapterGroupSource?.()?.storyCoverUrl
            ?? CoverImageUI.getCoverImageUrl();
    }

    async function withTemporaryCoverImageUrl(coverImageUrl, callback) {
        let previousCoverImageUrl = CoverImageUI.getCoverImageUrl();
        let nextCoverImageUrl = util.isNullOrEmpty(coverImageUrl) ? null : coverImageUrl;
        let hasChanged = nextCoverImageUrl !== previousCoverImageUrl;
        if (hasChanged) {
            CoverImageUI.setCoverImageUrl(nextCoverImageUrl);
        }
        try {
            return await callback();
        } finally {
            if (hasChanged) {
                CoverImageUI.setCoverImageUrl(previousCoverImageUrl);
            }
        }
    }

    async function withTemporaryChapterSelection(pagesToInclude, callback) {
        let allPages = [...parser.getPagesToFetch().values()];
        let originalState = allPages.map(page => ({ page: page, isIncludeable: page.isIncludeable }));
        let includeSet = new Set(pagesToInclude.map(page => page.sourceUrl));
        allPages.forEach(page => page.isIncludeable = includeSet.has(page.sourceUrl));
        try {
            return await callback();
        } finally {
            originalState.forEach(state => state.page.isIncludeable = state.isIncludeable);
        }
    }

    function ensureSleepControllerReady() {
        if (util.sleepController.signal.aborted) {
            util.sleepController = new AbortController();
        }
    }

    function getAllChapterPages() {
        if (parser == null) {
            return [];
        }
        return [...parser.getPagesToFetch().values()];
    }

    function getPagesForSourceUrls(sourceUrls = []) {
        let urls = new Set(sourceUrls);
        return getAllChapterPages().filter(page => urls.has(page.sourceUrl));
    }

    function clearFetchedChapterData(pages) {
        if (!Array.isArray(pages) || (pages.length === 0)) {
            return;
        }

        pages.forEach((page) => {
            delete page.rawDom;
            delete page.error;
            if (page.row != null) {
                ChapterUrlsUI.showDownloadState(page.row, ChapterUrlsUI.DOWNLOAD_STATE_NONE);
            }
        });

        parser?.imageCollector?.reset?.();
        parser?.imageCollector?.setCoverImageUrl?.(CoverImageUI.getCoverImageUrl());
    }

    function collectUniquePages(...pageCollections) {
        let uniquePages = [];
        let seenPages = new WeakSet();
        let seenSourceUrls = new Set();

        for (let pages of pageCollections) {
            if (!Array.isArray(pages)) {
                continue;
            }
            for (let page of pages) {
                if ((page == null) || (typeof page !== "object")) {
                    continue;
                }
                if (seenPages.has(page)) {
                    continue;
                }
                let sourceUrl = page.sourceUrl ?? null;
                if ((sourceUrl != null) && seenSourceUrls.has(sourceUrl)) {
                    continue;
                }
                seenPages.add(page);
                if (sourceUrl != null) {
                    seenSourceUrls.add(sourceUrl);
                }
                uniquePages.push(page);
            }
        }

        return uniquePages;
    }

    function resetDownloadExecutionState(actionMode = "pack", pagesToClear = []) {
        clearFetchedChapterData(collectUniquePages(pagesToClear));
        storyDownloadSession = null;
        window.workInProgress = false;
        main.getPackEpubButton().disabled = false;
        ["downloadPacksButton", "downloadMarkedChapterGroupsButton", "downloadAllChapterGroupsButton"]
            .forEach((elementId) => {
                let button = document.getElementById(elementId);
                if (button != null) {
                    button.disabled = false;
                }
            });
        util.sleepController = new AbortController();
        setProgressActionBusy(false, actionMode);
        updateDownloadFormatUi();
    }

    function createStoryDownloadSession(options) {
        let session = {
            status: "idle",
            phase: "idle",
            parser: parser,
            actionMode: options.isLibraryAction ? "library" : "pack",
            isLibraryAction: options.isLibraryAction,
            metaInfo: options.metaInfo,
            fileName: options.fileName,
            overwriteExisting: options.overwriteExisting,
            backgroundDownload: options.backgroundDownload,
            fileHandle: options.fileHandle,
            suppressErrorLog: options.suppressErrorLog === true,
            sourceUrls: getSelectedPages().map(page => page.sourceUrl),
            requestedStopReason: null
        };
        return session;
    }

    function hasRunningStoryDownloadSession() {
        return storyDownloadSession?.status === "running";
    }

    function hasPausedStoryDownloadSession() {
        return storyDownloadSession?.status === "paused";
    }

    function hasCancelableBusyDownloadOperation() {
        return progressActionState.isBusy
            && !hasRunningStoryDownloadSession()
            && !hasPausedStoryDownloadSession();
    }

    function getStoryDownloadPages(session) {
        if ((session == null) || (session.parser !== parser)) {
            return [];
        }
        return getPagesForSourceUrls(session.sourceUrls);
    }

    function cancelPausedStoryDownloadSession() {
        if (!hasPausedStoryDownloadSession()) {
            return;
        }
        let pausedSession = storyDownloadSession;
        resetDownloadExecutionState(
            pausedSession?.actionMode ?? "pack",
            getStoryDownloadPages(pausedSession)
        );
    }

    function requestStoryDownloadStop(stopReason) {
        if (!hasRunningStoryDownloadSession()) {
            return;
        }
        if ((stopReason === "cancel") && (storyDownloadSession.phase === "finalizing")) {
            return;
        }
        storyDownloadSession.requestedStopReason = stopReason;
        let pauseButton = document.getElementById("LibPauseToLibrary");
        if (pauseButton != null) {
            pauseButton.disabled = true;
        }
        let addButton = document.getElementById("LibAddToLibrary");
        if (addButton != null) {
            addButton.disabled = true;
        }
        getPackEpubButton().disabled = true;
        syncProgressActionButtons();
        util.sleepController.abort();
    }

    function cancelCurrentStoryDownloadSession() {
        if (hasPausedStoryDownloadSession()) {
            cancelPausedStoryDownloadSession();
            return;
        }
        requestStoryDownloadStop("cancel");
    }

    function cancelCurrentBusyDownloadOperation() {
        if (!hasCancelableBusyDownloadOperation()) {
            return;
        }
        progressActionState.requestedStopReason = "cancel";
        syncProgressActionButtons();
        util.sleepController.abort();
    }

    function setProgressActionBusy(isBusy, actionMode = "pack") {
        progressActionState = {
            isBusy: isBusy,
            actionMode: actionMode,
            requestedStopReason: null
        };
        if (!isBusy && !hasRunningStoryDownloadSession()) {
            resetProgressDisplay();
        }
        syncProgressActionButtons();
    }

    function setBatchUiBusy(isBusy, actionMode = "pack") {
        window.workInProgress = isBusy;
        main.getPackEpubButton().disabled = isBusy;
        ["downloadPacksButton", "downloadMarkedChapterGroupsButton", "downloadAllChapterGroupsButton"]
            .forEach((elementId) => {
                let button = document.getElementById(elementId);
                if (button != null) {
                    button.disabled = isBusy;
                }
            });
        setProgressActionBusy(isBusy, actionMode);
    }

    function shouldStopCurrentDownload() {
        return util.sleepController.signal.aborted;
    }

    async function downloadBatches(chapterBatches, alwaysAddSuffix) {
        ensureSleepControllerReady();
        let pagesInBatches = collectUniquePages(...chapterBatches);
        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }

        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let metaInfo = metaInfoFromControls();
        let baseFileName = buildDownloadFileName({
            preferSuggestedFileName: true,
            suggestedFileName: metaInfo.fileName,
            fileName: metaInfo.fileName,
            title: metaInfo.title
        });
        let chapterOrder = getGlobalChapterIndexMap();

        ErrorLog.clearHistory();
        setBatchUiBusy(true, "pack");
        ChapterUrlsUI.resetDownloadStateImages();

        try {
            for (let batchIndex = 0; batchIndex < chapterBatches.length; ++batchIndex) {
                throwIfDownloadStopped();
                let batch = chapterBatches[batchIndex];
                let firstChapterIndex = chapterOrder.get(batch[0].sourceUrl);
                let lastChapterIndex = chapterOrder.get(batch[batch.length - 1].sourceUrl);
                let fileName = buildBatchFileName(
                    baseFileName,
                    batchIndex,
                    chapterBatches.length,
                    firstChapterIndex,
                    lastChapterIndex,
                    alwaysAddSuffix
                );
                let fileHandle = await pickSaveLocationIfSupported(fileName, backgroundDownload);
                if (fileHandle === null) {
                    return;
                }

                await withTemporaryChapterSelection(batch, async () => {
                    parser.onStartCollecting();
                    await parser.fetchContent();
                    throwIfDownloadStopped();
                    let content = await buildDownloadContent(metaInfo);
                    throwIfDownloadStopped();
                    await saveDownloadedContent(content, fileName, overwriteExisting, backgroundDownload, fileHandle);
                    throwIfDownloadStopped();
                });
                if (shouldStopCurrentDownload()) {
                    return;
                }
            }

            parser.updateReadingList();
            ErrorLog.showLogToUser();
            dumpErrorLogToFile();
        } catch (err) {
            if (!util.isAbortError(err)) {
                ErrorLog.showErrorMessage(err);
            }
        } finally {
            resetDownloadExecutionState("pack", pagesInBatches);
        }
    }

    async function downloadChapterGroup() {
        if (window.workInProgress === true) {
            return;
        }
        ensureSleepControllerReady();
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let group = getChapterGroupById(ChapterUrlsUI.getSelectedChapterGroupId());
        if (group == null) {
            ErrorLog.showErrorMessage("No chapter group selected.");
            return;
        }

        let pages = getDownloadablePagesForGroup(group);
        if (pages.length === 0) {
            ErrorLog.showErrorMessage("No downloadable chapters found for this group.");
            return;
        }

        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }

        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let metaInfo = buildGroupMetaInfo(metaInfoFromControls(), group);
        let fileName = buildDownloadFileName({
            preferSuggestedFileName: true,
            suggestedFileName: metaInfo.fileName,
            fileName: stripDownloadExtension(metaInfo.fileName),
            title: metaInfo.title,
            chaptersCount: group.count,
            group: group.displayTitle,
            groupTitle: group.title ?? group.displayTitle,
            groupRange: group.rangeLabel
        });
        let fileHandle = await pickSaveLocationIfSupported(fileName, backgroundDownload);
        if (fileHandle === null) {
            return;
        }

        ErrorLog.clearHistory();
        setBatchUiBusy(true, "pack");
        ChapterUrlsUI.resetDownloadStateImages();

        try {
            await withTemporaryCoverImageUrl(resolveGroupCoverImageUrl(group), async () => {
                await withTemporaryChapterSelection(pages, async () => {
                    parser.onStartCollecting();
                    await parser.fetchContent();
                    throwIfDownloadStopped();
                    let content = await buildDownloadContent(metaInfo);
                    throwIfDownloadStopped();
                    await saveDownloadedContent(content, fileName, overwriteExisting, backgroundDownload, fileHandle);
                    throwIfDownloadStopped();
                });
            });
            throwIfDownloadStopped();

            parser.updateReadingList();
            ErrorLog.showLogToUser();
            dumpErrorLogToFile();
        } catch (err) {
            if (!util.isAbortError(err)) {
                ErrorLog.showErrorMessage(err);
            }
        } finally {
            resetDownloadExecutionState("pack", pages);
        }
    }

    async function downloadAllChapterGroups() {
        if (window.workInProgress === true) {
            return;
        }
        ensureSleepControllerReady();
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let visibleGroupIds = typeof ChapterUrlsUI?.getVisibleChapterGroupIds === "function"
            ? ChapterUrlsUI.getVisibleChapterGroupIds()
            : [];
        let visibleGroupIdSet = new Set(visibleGroupIds);
        let groups = parser.getChapterGroups()
            .filter(group => (visibleGroupIdSet.size === 0) || visibleGroupIdSet.has(group.id))
            .map(group => ({ group: group, pages: getDownloadablePagesForGroup(group) }))
            .filter(entry => 0 < entry.pages.length);
        let pagesInGroups = collectUniquePages(...groups.map(entry => entry.pages));

        if (groups.length === 0) {
            ErrorLog.showErrorMessage("No downloadable chapter groups found.");
            return;
        }

        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }

        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let baseMetaInfo = metaInfoFromControls();

        ErrorLog.clearHistory();
        setBatchUiBusy(true, "pack");
        ChapterUrlsUI.resetDownloadStateImages();

        try {
            for (let entry of groups) {
                throwIfDownloadStopped();
                let group = entry.group;
                let metaInfo = buildGroupMetaInfo(baseMetaInfo, group);
                let fileName = buildDownloadFileName({
                    preferSuggestedFileName: true,
                    suggestedFileName: metaInfo.fileName,
                    fileName: stripDownloadExtension(metaInfo.fileName),
                    title: metaInfo.title,
                    chaptersCount: group.count,
                    group: group.displayTitle,
                    groupTitle: group.title ?? group.displayTitle,
                    groupRange: group.rangeLabel
                });

                await withTemporaryCoverImageUrl(resolveGroupCoverImageUrl(group), async () => {
                    await withTemporaryChapterSelection(entry.pages, async () => {
                        parser.onStartCollecting();
                        await parser.fetchContent();
                        throwIfDownloadStopped();
                        let content = await buildDownloadContent(metaInfo);
                        throwIfDownloadStopped();
                        await Download.save(content, fileName, overwriteExisting, backgroundDownload);
                        throwIfDownloadStopped();
                    });
                });
                if (shouldStopCurrentDownload()) {
                    return;
                }
            }

            parser.updateReadingList();
            ErrorLog.showLogToUser();
            dumpErrorLogToFile();
        } catch (err) {
            if (!util.isAbortError(err)) {
                ErrorLog.showErrorMessage(err);
            }
        } finally {
            resetDownloadExecutionState("pack", pagesInGroups);
        }
    }

    async function downloadMarkedChapterGroups() {
        if (window.workInProgress === true) {
            return;
        }
        ensureSleepControllerReady();
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let markedGroupIds = parser.state.chapterUrlsUI?.getMarkedChapterGroupIds?.() ?? [];
        let markedGroupIdSet = new Set(markedGroupIds);
        let groups = parser.getChapterGroups()
            .filter(group => markedGroupIdSet.has(group.id))
            .map(group => ({ group: group, pages: getDownloadablePagesForGroup(group) }))
            .filter(entry => 0 < entry.pages.length);
        let pagesInGroups = collectUniquePages(...groups.map(entry => entry.pages));

        if (groups.length === 0) {
            ErrorLog.showErrorMessage("No selected chapter groups found.");
            return;
        }

        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }

        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let baseMetaInfo = metaInfoFromControls();

        ErrorLog.clearHistory();
        setBatchUiBusy(true, "pack");
        ChapterUrlsUI.resetDownloadStateImages();

        try {
            for (let entry of groups) {
                throwIfDownloadStopped();
                let group = entry.group;
                let metaInfo = buildGroupMetaInfo(baseMetaInfo, group);
                let fileName = buildDownloadFileName({
                    preferSuggestedFileName: true,
                    suggestedFileName: metaInfo.fileName,
                    fileName: stripDownloadExtension(metaInfo.fileName),
                    title: metaInfo.title,
                    chaptersCount: group.count,
                    group: group.displayTitle,
                    groupTitle: group.title ?? group.displayTitle,
                    groupRange: group.rangeLabel
                });

                await withTemporaryCoverImageUrl(resolveGroupCoverImageUrl(group), async () => {
                    await withTemporaryChapterSelection(entry.pages, async () => {
                        parser.onStartCollecting();
                        await parser.fetchContent();
                        throwIfDownloadStopped();
                        let content = await buildDownloadContent(metaInfo);
                        throwIfDownloadStopped();
                        await Download.save(content, fileName, overwriteExisting, backgroundDownload);
                        throwIfDownloadStopped();
                    });
                });
                if (shouldStopCurrentDownload()) {
                    return;
                }
            }

            parser.updateReadingList();
            ErrorLog.showLogToUser();
            dumpErrorLogToFile();
        } catch (err) {
            if (!util.isAbortError(err)) {
                ErrorLog.showErrorMessage(err);
            }
        } finally {
            resetDownloadExecutionState("pack", pagesInGroups);
        }
    }

    async function downloadPacks() {
        if (window.workInProgress === true) {
            return;
        }
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let selectedPages = getSelectedPages();
        if (selectedPages.length === 0) {
            ErrorLog.showErrorMessage("No chapters selected.");
            return;
        }

        let chunkSize = getPackSizeFromUi();
        let batches = chunkPages(selectedPages, chunkSize);
        await downloadBatches(batches, batches.length !== 1);
    }

    async function downloadSingleChapterByUrl(sourceUrl) {
        if (window.workInProgress === true) {
            return;
        }
        ensureSleepControllerReady();
        if (parser == null) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return;
        }

        let chapter = [...parser.getPagesToFetch().values()].find(page => page.sourceUrl === sourceUrl);
        if (chapter == null) {
            ErrorLog.showErrorMessage("Chapter not found.");
            return;
        }
        await downloadBatches([[chapter]], true);
    }

    async function runStoryDownloadSession(session) {
        if ((session == null) || (session.parser !== parser)) {
            storyDownloadSession = null;
            updateDownloadFormatUi();
            ErrorLog.showErrorMessage("The previous download session is no longer available. Start it again.");
            return;
        }

        ensureSleepControllerReady();

        let pages = getStoryDownloadPages(session);
        if (pages.length === 0) {
            storyDownloadSession = null;
            updateDownloadFormatUi();
            ErrorLog.showErrorMessage("No chapters selected for this download.");
            return;
        }

        clearFetchedChapterData(pages);
        ChapterUrlsUI.resetDownloadStateImages();
        ErrorLog.clearHistory();

        let stopReason = null;
        storyDownloadSession = session;
        storyDownloadSession.status = "running";
        storyDownloadSession.phase = "fetching";
        storyDownloadSession.requestedStopReason = null;
        window.workInProgress = true;
        main.getPackEpubButton().disabled = true;
        setProgressActionBusy(true, session.actionMode);

        try {
            await withTemporaryChapterSelection(pages, async () => {
                parser.onStartCollecting();
                await parser.fetchContent();
                if (shouldStopCurrentDownload()) {
                    stopReason = session.requestedStopReason ?? "cancel";
                    return;
                }

                session.phase = "packing";
                syncProgressActionButtons();
                let content = await buildDownloadContent(session.metaInfo);
                if (shouldStopCurrentDownload()) {
                    stopReason = session.requestedStopReason ?? "cancel";
                    return;
                }

                session.phase = "finalizing";
                syncProgressActionButtons();
                if (session.isLibraryAction) {
                    await library.LibAddToLibrary(
                        content,
                        session.fileName,
                        document.getElementById("startingUrlInput").value,
                        session.overwriteExisting,
                        session.backgroundDownload
                    );
                } else {
                    await saveDownloadedContent(
                        content,
                        session.fileName,
                        session.overwriteExisting,
                        session.backgroundDownload,
                        session.fileHandle
                    );
                }
            });

            if ((stopReason != null) || shouldStopCurrentDownload()) {
                stopReason = stopReason ?? session.requestedStopReason ?? "cancel";
                return;
            }

            parser.updateReadingList();
            if (!session.suppressErrorLog) {
                ErrorLog.showLogToUser();
                dumpErrorLogToFile();
            }
        } catch (err) {
            if (util.isAbortError(err)) {
                stopReason = session.requestedStopReason ?? "cancel";
                return;
            }
            ErrorLog.showErrorMessage(err);
        } finally {
            session.requestedStopReason = null;
            resetDownloadExecutionState(session.actionMode, pages);
        }
    }

    async function fetchContentAndPackEpub() {
        let libclick = this;
        let isLibraryAction = (libclick.dataset.libclick === "yes");
        ensureSleepControllerReady();
        if (isLibraryAction && !isEpubDownloadFormat()) {
            ErrorLog.showErrorMessage("Library is available for EPUB only.");
            return;
        }
        if (document.getElementById("noAdditionalMetadataCheckbox").checked == true) {
            setUiFieldToValue("subjectInput", "");
            setUiFieldToValue("descriptionInput", "");
        }
        let metaInfo = metaInfoFromControls();

        if (isLibraryAction) {
            if (document.getElementById("chaptersPageInChapterListCheckbox").checked) {
                ErrorLog.showErrorMessage(UIText.Error.errorAddToLibraryLibraryAddPageWithChapters);
                return;
            }
        }

        let overwriteExisting = userPreferences.overwriteExistingEpub.value;
        let backgroundDownload = userPreferences.noDownloadPopup.value;
        let fileName = buildDownloadFileName({
            preferSuggestedFileName: true,
            suggestedFileName: metaInfo.fileName,
            fileName: metaInfo.fileName,
            title: metaInfo.title
        });
        let fileHandle = undefined;
        if ("yes" != libclick.dataset.libclick) {
            fileHandle = await pickSaveLocationIfSupported(fileName, backgroundDownload);
            if (fileHandle === null) {
                return;
            }
        }

        ChapterUrlsUI.limitNumOfChapterS(userPreferences.maxChaptersPerEpub.value);
        await runStoryDownloadSession(createStoryDownloadSession({
            isLibraryAction: isLibraryAction,
            metaInfo: metaInfo,
            fileName: fileName,
            overwriteExisting: overwriteExisting,
            backgroundDownload: backgroundDownload,
            fileHandle: fileHandle,
            suppressErrorLog: (libclick.dataset.libsuppressErrorLog == true)
        }));
    }

    function onPauseStoryDownloadClick() {
        if (hasRunningStoryDownloadSession()) {
            cancelCurrentStoryDownloadSession();
            return;
        }
        cancelCurrentBusyDownloadOperation();
    }

    async function onPackEpubButtonClick() {
        if (hasRunningStoryDownloadSession()) {
            if (storyDownloadSession.actionMode === "pack") {
                cancelCurrentStoryDownloadSession();
            }
            return;
        }
        if (hasCancelableBusyDownloadOperation()) {
            if (progressActionState.actionMode === "pack") {
                cancelCurrentBusyDownloadOperation();
            }
            return;
        }
        if (hasPausedStoryDownloadSession()) {
            cancelPausedStoryDownloadSession();
        }
        await fetchContentAndPackEpub.call(getPackEpubButton());
    }

    async function onLibraryActionButtonClick() {
        if (hasRunningStoryDownloadSession()) {
            if (storyDownloadSession.actionMode === "library") {
                cancelCurrentStoryDownloadSession();
            }
            return;
        }
        if (hasCancelableBusyDownloadOperation()) {
            if (progressActionState.actionMode === "library") {
                cancelCurrentBusyDownloadOperation();
            }
            return;
        }
        if (hasPausedStoryDownloadSession()) {
            cancelPausedStoryDownloadSession();
        }
        await fetchContentAndPackEpub.call(document.getElementById("LibAddToLibrary"));
    }

    function epubVersionFromPreferences() {
        return userPreferences.createEpub3.value ? 
            EpubPacker.EPUB_VERSION_3 : EpubPacker.EPUB_VERSION_2;
    }

    function packEpub(metaInfo, itemSupplier = parser.epubItemSupplier()) {
        let epubVersion = epubVersionFromPreferences();
        let epub = new EpubPacker(metaInfo, epubVersion);
        return epub.assemble(itemSupplier, {
            maybeYield: yieldDownloadWork,
            throwIfCancelled: throwIfDownloadStopped
        });
    }

    function coverImageDataUrl(itemSupplier) {
        let coverImageInfo = itemSupplier?.coverImageInfo ?? null;
        if ((coverImageInfo == null) || (coverImageInfo.arraybuffer == null) || util.isNullOrEmpty(coverImageInfo.mediaType)) {
            return resolveGroupCoverImageUrl(null);
        }
        return `data:${coverImageInfo.mediaType};base64,${coverImageInfo.getBase64(0)}`;
    }

    const pdfWinAnsiSpecialBytes = new Map([
        [0x20AC, 0x80],
        [0x201A, 0x82],
        [0x0192, 0x83],
        [0x201E, 0x84],
        [0x2026, 0x85],
        [0x2020, 0x86],
        [0x2021, 0x87],
        [0x02C6, 0x88],
        [0x2030, 0x89],
        [0x0160, 0x8A],
        [0x2039, 0x8B],
        [0x0152, 0x8C],
        [0x017D, 0x8E],
        [0x2018, 0x91],
        [0x2019, 0x92],
        [0x201C, 0x93],
        [0x201D, 0x94],
        [0x2022, 0x95],
        [0x2013, 0x96],
        [0x2014, 0x97],
        [0x02DC, 0x98],
        [0x2122, 0x99],
        [0x0161, 0x9A],
        [0x203A, 0x9B],
        [0x0153, 0x9C],
        [0x017E, 0x9E],
        [0x0178, 0x9F]
    ]);

    function yieldDownloadWork() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function throwIfDownloadStopped() {
        if (shouldStopCurrentDownload()) {
            throw new DOMException("The user aborted a request.", "AbortError");
        }
    }

    async function maybeYieldDuringDownloadWork(index, interval = 3) {
        if ((index % interval) !== 0) {
            return;
        }
        await yieldDownloadWork();
        throwIfDownloadStopped();
    }

    function normalizePdfText(text) {
        return (text ?? "")
            .replace(/\u00A0/g, " ")
            .replace(/\u202F/g, " ")
            .replace(/\u00AD/g, "")
            .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
            .replace(/[\u201C\u201D\u201E\u2033]/g, "\"")
            .replace(/[\u2013\u2014\u2212]/g, "-")
            .replace(/\u2026/g, "...")
            .replace(/\t/g, "    ");
    }

    function encodePdfTextAsHex(text) {
        let bytes = [];
        for (let character of normalizePdfText(text)) {
            let codePoint = character.codePointAt(0);
            if ((codePoint >= 0x20) && (codePoint <= 0x7E)) {
                bytes.push(codePoint);
            } else if ((codePoint >= 0xA0) && (codePoint <= 0xFF)) {
                bytes.push(codePoint);
            } else if (pdfWinAnsiSpecialBytes.has(codePoint)) {
                bytes.push(pdfWinAnsiSpecialBytes.get(codePoint));
            } else {
                bytes.push(0x3F);
            }
        }
        return bytes
            .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
            .join("");
    }

    function wrapPdfParagraph(text, maxLength = 92) {
        let normalized = (text ?? "")
            .replace(/\r/g, "")
            .trim();
        if (normalized === "") {
            return [""];
        }

        let lines = [];
        normalized.split("\n").forEach((rawLine) => {
            let line = rawLine.trim();
            if (line === "") {
                lines.push("");
                return;
            }
            let words = line.split(/\s+/);
            let currentLine = "";
            words.forEach((word) => {
                let candidate = currentLine === "" ? word : `${currentLine} ${word}`;
                if ((candidate.length <= maxLength) || (currentLine === "")) {
                    currentLine = candidate;
                    return;
                }
                lines.push(currentLine);
                currentLine = word;
            });
            if (currentLine !== "") {
                lines.push(currentLine);
            }
        });
        return lines.length === 0 ? [""] : lines;
    }

    async function buildPdfLines(metaInfo, itemSupplier) {
        let lines = [];
        [metaInfo.title, metaInfo.author ? `Author: ${metaInfo.author}` : "", metaInfo.language ? `Language: ${metaInfo.language}` : ""]
            .filter(value => !util.isNullOrEmpty(value))
            .forEach((value) => {
                lines.push(...wrapPdfParagraph(value, 84));
            });
        lines.push("");

        let spineItems = itemSupplier.spineItems();
        for (let index = 0; index < spineItems.length; ++index) {
            await maybeYieldDuringDownloadWork(index, 2);
            let item = spineItems[index];
            let chapterHeading = item.chapterTitle ?? `Chapter ${index + 1}`;
            lines.push(...wrapPdfParagraph(chapterHeading, 84));
            lines.push("");
            nodesToText(item.nodes)
                .split("\n\n")
                .forEach((paragraph) => {
                    lines.push(...wrapPdfParagraph(paragraph, 92));
                    lines.push("");
                });
            lines.push("");
        }

        while ((0 < lines.length) && (lines.at(-1) === "")) {
            lines.pop();
        }
        return lines;
    }

    async function createSimplePdfBlob(lines) {
        let pageWidth = 612;
        let pageHeight = 792;
        let marginLeft = 48;
        let marginTop = 748;
        let lineHeight = 16;
        let linesPerPage = 43;

        let pages = [];
        for (let index = 0; index < lines.length; index += linesPerPage) {
            pages.push(lines.slice(index, index + linesPerPage));
        }
        if (pages.length === 0) {
            pages.push([""]);
        }

        let fontObjectId = 3;
        let objects = new Map();
        let nextObjectId = 4;
        let pageObjectIds = [];

        objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
        objects.set(fontObjectId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

        for (let pageIndex = 0; pageIndex < pages.length; ++pageIndex) {
            await maybeYieldDuringDownloadWork(pageIndex, 4);
            let pageLines = pages[pageIndex];
            let contentObjectId = nextObjectId++;
            let pageObjectId = nextObjectId++;
            pageObjectIds.push(pageObjectId);

            let operators = [
                "BT",
                "/F1 11 Tf",
                `${marginLeft} ${marginTop} Td`,
                `${lineHeight} TL`
            ];
            pageLines.forEach((line, lineIndex) => {
                operators.push(`<${encodePdfTextAsHex(line)}> Tj`);
                if (lineIndex !== pageLines.length - 1) {
                    operators.push("T*");
                }
            });
            operators.push("ET");

            let stream = operators.join("\n");
            let streamLength = stream.length;
            objects.set(contentObjectId, `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
            objects.set(
                pageObjectId,
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
                + `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> `
                + `/Contents ${contentObjectId} 0 R >>`
            );
        }

        objects.set(2, `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] >>`);

        let pdfChunks = [];
        let offsets = [0];
        let currentLength = 0;
        let pushPdfChunk = (chunk) => {
            pdfChunks.push(chunk);
            currentLength += chunk.length;
        };

        pushPdfChunk("%PDF-1.4\n");
        for (let objectId = 1; objectId < nextObjectId; objectId++) {
            offsets[objectId] = currentLength;
            pushPdfChunk(`${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`);
        }
        let xrefOffset = currentLength;
        pushPdfChunk(`xref\n0 ${nextObjectId}\n`);
        pushPdfChunk("0000000000 65535 f \n");
        for (let objectId = 1; objectId < nextObjectId; objectId++) {
            pushPdfChunk(`${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`);
        }
        pushPdfChunk(
            `trailer\n<< /Size ${nextObjectId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
        );

        throwIfDownloadStopped();
        let bytes = new TextEncoder().encode(pdfChunks.join(""));
        return new Blob([bytes], { type: "application/pdf" });
    }

    async function buildPdfExport(metaInfo, itemSupplier) {
        return createSimplePdfBlob(await buildPdfLines(metaInfo, itemSupplier));
    }

    function buildHtmlExport(metaInfo, itemSupplier) {
        let doc = util.createEmptyHtmlDoc();
        doc.title = metaInfo.title ?? "";

        let head = doc.querySelector("head");
        let charset = doc.createElement("meta");
        charset.setAttribute("charset", "utf-8");
        head.prepend(charset);

        let style = doc.createElement("style");
        style.textContent = [
            metaInfo.styleSheet ?? "",
            "body{max-width:920px;margin:0 auto;padding:32px 24px;font-family:Georgia,serif;line-height:1.65;}",
            ".webToEpub-export-cover{margin:0 0 32px;text-align:center;}",
            ".webToEpub-export-cover img{max-width:320px;width:100%;height:auto;border-radius:12px;box-shadow:0 12px 40px rgba(15,23,42,.12);}",
            ".webToEpub-export-meta{margin:0 0 36px;}",
            ".webToEpub-export-meta h1{margin:0 0 8px;font-size:2rem;line-height:1.2;}",
            ".webToEpub-export-meta p{margin:0;color:#475569;}",
            ".webToEpub-export-chapter{margin-top:40px;padding-top:24px;border-top:1px solid #cbd5e1;}"
        ].join("\n");
        head.appendChild(style);

        let body = doc.body;
        let coverUrl = coverImageDataUrl(itemSupplier);
        if (!util.isNullOrEmpty(coverUrl)) {
            let cover = doc.createElement("figure");
            cover.className = "webToEpub-export-cover";
            let coverImage = doc.createElement("img");
            coverImage.src = coverUrl;
            coverImage.alt = metaInfo.title ?? "";
            cover.appendChild(coverImage);
            body.appendChild(cover);
        }

        let meta = doc.createElement("header");
        meta.className = "webToEpub-export-meta";
        let title = doc.createElement("h1");
        title.textContent = metaInfo.title ?? "";
        meta.appendChild(title);
        let byline = doc.createElement("p");
        byline.textContent = [metaInfo.author, metaInfo.language]
            .filter(value => !util.isNullOrEmpty(value))
            .join(" • ");
        meta.appendChild(byline);
        body.appendChild(meta);

        itemSupplier.spineItems().forEach((item) => {
            let section = doc.createElement("section");
            section.className = "webToEpub-export-chapter";
            for (let node of item.nodes ?? []) {
                let clean = util.sanitizeNode(node);
                if (clean != null) {
                    section.appendChild(clean);
                }
            }
            body.appendChild(section);
        });

        return new Blob([util.xmlToString(doc)], { type: "text/html;charset=utf-8" });
    }

    function nodesToText(nodes) {
        return (nodes ?? [])
            .map((node) => {
                let clean = util.sanitizeNode(node);
                return clean?.textContent?.replace(/\r/g, "")?.trim() ?? "";
            })
            .filter(text => !util.isNullOrEmpty(text))
            .join("\n\n");
    }

    async function buildTextExport(metaInfo, itemSupplier) {
        let blocks = [];
        if (!util.isNullOrEmpty(metaInfo.title)) {
            blocks.push(metaInfo.title);
        }
        if (!util.isNullOrEmpty(metaInfo.author)) {
            blocks.push(`Author: ${metaInfo.author}`);
        }
        if (!util.isNullOrEmpty(metaInfo.language)) {
            blocks.push(`Language: ${metaInfo.language}`);
        }

        let spineItems = itemSupplier.spineItems();
        for (let index = 0; index < spineItems.length; ++index) {
            await maybeYieldDuringDownloadWork(index, 3);
            let item = spineItems[index];
            let chapterTitle = item.chapterTitle ?? "";
            let chapterText = nodesToText(item.nodes);
            let chapterBlock = [chapterTitle, chapterText]
                .filter(value => !util.isNullOrEmpty(value))
                .join("\n\n");
            if (!util.isNullOrEmpty(chapterBlock)) {
                blocks.push(chapterBlock);
            }
        }

        return new Blob([blocks.join("\n\n\n")], { type: "text/plain;charset=utf-8" });
    }

    async function buildDownloadContent(metaInfo) {
        let format = getSelectedDownloadFormat();
        let itemSupplier = parser.epubItemSupplier();
        switch (format) {
            case "html":
                return buildHtmlExport(metaInfo, itemSupplier);
            case "pdf":
                return buildPdfExport(metaInfo, itemSupplier);
            case "txt":
                return buildTextExport(metaInfo, itemSupplier);
            case "mobi":
                throw new Error("MOBI export requires an external converter and is not available in the extension runtime yet.");
            default:
                return packEpub(metaInfo, itemSupplier);
        }
    }

    function buildDownloadFileName(overrides = {}) {
        return Download.buildFileName({
            ...overrides,
            format: getSelectedDownloadFormat()
        });
    }

    async function pickSaveLocationIfSupported(fileName, backgroundDownload) {
        if (!Download.canUseSavePicker(backgroundDownload)) {
            return undefined;
        }
        try {
            return await Download.pickSaveLocation(fileName, getSelectedDownloadFormat());
        } catch (error) {
            if (["SecurityError", "NotAllowedError"].includes(error?.name)) {
                return undefined;
            }
            throw error;
        }
    }

    async function saveDownloadedContent(content, fileName, overwriteExisting, backgroundDownload, fileHandle = undefined) {
        if (shouldStopCurrentDownload()) {
            return;
        }
        if (fileHandle !== undefined) {
            if (fileHandle == null) {
                return;
            }
            await Download.saveToPickedLocation(content, fileHandle);
            return;
        }
        await Download.save(content, fileName, overwriteExisting, backgroundDownload);
    }

    function dumpErrorLogToFile() {
        let errors = ErrorLog.dumpHistory();
        if (userPreferences.writeErrorHistoryToFile.value &&
            !util.isNullOrEmpty(errors)) {
            let fileName = metaInfoFromControls().fileName + ".ErrorLog.txt";
            let blob = new Blob([errors], {type : "text"});
            return Download.save(blob, fileName)
                .catch (err => ErrorLog.showErrorMessage(err));
        }
    }

    async function getActiveTabDOM(tabId) {
        addMessageListener();
        await injectContentScript(tabId);
    }

    function handleTabModeLoadError(error) {
        resetUI();
        ErrorLog.showErrorMessage(
            error?.message?.includes("No tab with id")
                ? "The source tab is no longer available. Reload from the page you want to capture."
                : error
        );
    }

    async function injectContentScript(tabId) {
        if (util.isFirefox()) {
            Firefox.injectContentScript(tabId);
        } else {
            await chromeInjectContentScript(tabId);
        }
    }

    async function chromeInjectContentScript(tabId) {
        try {
            await chrome.tabs.get(tabId);
            await chrome.scripting.executeScript({
                target: {tabId: tabId},
                files: ["js/ContentScript.js"]
            });
        } catch (error) {
            handleTabModeLoadError(error);
        }
    }

    function populateControls() {
        loadUserPreferences();
        parserFactory.populateManualParserSelectionTag(getManuallySelectParserTag());
        let selectedHosts = readSelectedReferenceSiteHostsFromUi();
        if (selectedHosts.size === 0) {
            setSelectedReferenceSiteHosts(reliableReferenceSites);
        } else {
            syncReferenceSiteChipVisualState();
        }
        updateReferenceGroupingSourceSelect("current");
        void configureForTabMode().catch(handleTabModeLoadError);
    }

    function loadUserPreferences() {
        userPreferences = UserPreferences.readFromLocalStorage();
        userPreferences.addObserver(library);
        userPreferences.writeToUi();
        userPreferences.hookupUi();
        BakaTsukiSeriesPageParser.registerBakaParsers(userPreferences.autoSelectBTSeriesPage.value);
    }

    function isRunningInTabMode() {
        // if query string supplied, we're running in Tab mode.
        let search = window.location.search;
        return !util.isNullOrEmpty(search);
    }

    async function populateControlsWithDom(url, dom) {
        initialWebPage = dom;
        setUiFieldToValue("startingUrlInput", url);
        clearReferenceGroupingSources({
            preserveStatus: false,
            preserveSiteSelection: true
        });

        // set the base tag, in case server did not supply it 
        util.setBaseTag(url, initialWebPage);
        await processInitialHtml(url, initialWebPage);
        if (document.getElementById("autosearchmetadataCheckbox").checked == true) {
            await autosearchadditionalmetadata();
        }
        syncChapterGroupingModeWithAvailableGroups(parser?.getChapterGroups?.() ?? []);
        scheduleAutomaticReferenceGroupingAnalysis({ immediate: true });
    }

    function setParser(url, dom) {
        let manualSelect = getManuallySelectParserTag().value;
        if (util.isNullOrEmpty(manualSelect)) {
            parser = parserFactory.fetch(url, dom);
        } else {
            parser = parserFactory.manuallySelectParser(manualSelect);
        }
        if (parser === undefined) {
            ErrorLog.showErrorMessage(UIText.Error.noParserFound);
            return false;
        }
        getLoadAndAnalyseButton().hidden = true;
        let disabledMessage = parser.disabled();
        if (disabledMessage !== null) {
            ErrorLog.showErrorMessage(disabledMessage);
            return false;
        }
        return true;
    }

    // called when the "Diagnostics" check box is ticked or unticked
    function onDiagnosticsClick() {
        let enable = document.getElementById("diagnosticsCheckBoxInput").checked;
        document.getElementById("reloadButton").hidden = !enable;
    }

    function onAdvancedOptionsClick() {
        let section =  getAdvancedOptionsSection();
        section.hidden = !section.hidden;
        section = getAdditionalMetadataSection();
        section.hidden = !userPreferences.ShowMoreMetadataOptions.value;
        section =  getLibrarySection();
        section.hidden = true;
    }

    function onShowMoreMetadataOptionsClick() {
        let section = getAdditionalMetadataSection();
        section.hidden = !section.hidden;
    }

    function onLibraryClick() {
        let section =  getLibrarySection();
        section.hidden = !section.hidden;
        if (!section.hidden) {
            Library.LibRenderSavedEpubs();
        }
        section =  getAdvancedOptionsSection();
        section.hidden = true;
    }

    function onStylesheetToDefaultClick() {
        document.getElementById("stylesheetInput").value = EpubMetaInfo.getDefaultStyleSheet();
        userPreferences.readFromUi();
    }

    async function openTabWindow() {
        // open new tab window, passing ID of open tab with content to convert to epub as query parameter.
        let tabId = await getActiveTab();
        let url = chrome.runtime.getURL("popup.html") + "?id=";
        url += tabId;
        try {
            await chrome.tabs.create({ url: url, openerTabId: tabId });
        }
        catch (error) {
            if (popupRuntimeErrorMessage(error).includes("No tab with id")) {
                await chrome.tabs.create({ url: url });
            } else {
                throw error;
            }
        }
        window.close();
    }

    function getActiveTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
                if ((tabs != null) && (0 < tabs.length)) {
                    resolve(tabs[0].id);
                } else {
                    reject();
                }
            });
        });
    }

    async function onLoadAndAnalyseButtonClick() {
        // load page via XmlHTTPRequest
        let url = getValueFromUiField("startingUrlInput");
        getLoadAndAnalyseButton().disabled = true;
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await populateControlsWithDom(url, xhr.responseXML);
            getLoadAndAnalyseButton().disabled = false;
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    async function configureForTabMode() {
        let tabId = extractTabIdFromQueryParameter();
        if (tabId == null) {
            resetUI();
            return;
        }
        await getActiveTabDOM(tabId);
    }

    function extractTabIdFromQueryParameter() {
        let windowId = window.location.search.split("=")[1];
        if (!util.isNullOrEmpty(windowId)) {
            let parsed = parseInt(windowId, 10);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }

    function getPackEpubButton() {
        return document.getElementById("packEpubButton");
    }

    function getLoadAndAnalyseButton() {
        return document.getElementById("loadAndAnalyseButton");
    }

    function resetUI() {
        initialWebPage = null;
        parser = null;
        storyDownloadSession = null;
        progressActionState = { isBusy: false, actionMode: "pack", requestedStopReason: null };
        clearReferenceGroupingSources();
        let metaInfo = new EpubMetaInfo();
        metaInfo.uuid = "";
        populateMetaInfo(metaInfo);
        getLoadAndAnalyseButton().hidden = false;
        main.getPackEpubButton().disabled = false;
        document.getElementById("LibAddToLibrary").disabled = false;
        setProgressActionBusy(false);
        ChapterUrlsUI.clearChapterUrlsTable();
        CoverImageUI.clearUI();
        resetProgressDisplay();
        // Clear the selected value so it doesn't look like a parser is selected
        document.getElementById("manuallySelectParserTag").selectedIndex = -1;
    }

    function localizeHtmlPage() {
        // can't use a single select, because there are buttons in td elements
        for (let selector of ["button, option", "td, th", ".i18n"]) {
            for (let element of [...document.querySelectorAll(selector)]) {
                if (element.textContent.startsWith("__MSG_")) {
                    UIText.localizeElement(element);
                }
            }
        }
    }

    function clearCoverUrl() {
        CoverImageUI.setCoverImageUrl(null);
    }

    function getManuallySelectParserTag() {
        return document.getElementById("manuallySelectParserTag");
    }

    function getAdditionalMetadataSection() {
        return document.getElementById("AdditionalMetadatatable");
    }

    function getAdvancedOptionsSection() {
        return document.getElementById("advancedOptionsSection");
    }

    function getLibrarySection() {
        return document.getElementById("hiddenBibSection");
    }

    function onSeriesPageHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#using-baka-tsuki-series-page-parser" });
    }

    function onCustomFilenameHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/Advanced-Options#custom-filename" });
    }

    function onDefaultParserHelp() {
        chrome.tabs.create({ url: "https://github.com/dteviot/WebToEpub/wiki/FAQ#how-to-convert-a-new-site-using-the-default-parser" });
    }

    function onReadOptionsFromFile(event) {
        userPreferences.readFromFile(event, populateControls);
    }

    function onReadingListCheckboxClicked() {
        let url = parser.state.chapterListUrl;
        let checked = UserPreferences.getReadingListCheckbox().checked;
        userPreferences.readingList.onReadingListCheckboxClicked(checked, url);
    }

    function updateThemeQuickToggleButton() {
        let button = document.getElementById("themeQuickToggleButton");
        let themeSelect = document.getElementById("themeColorTag");
        if ((button == null) || (themeSelect == null)) {
            return;
        }

        let isDarkActive = document.body.classList.contains("ns-theme-dark-active");
        button.dataset.mode = isDarkActive ? "light" : "dark";
        button.innerHTML = isDarkActive
            ? "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"4\"></circle><path d=\"M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77\"></path></svg>"
            : "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z\"></path></svg>";
        let label = isDarkActive ? "Switch to light mode" : "Switch to dark mode";
        button.title = label;
        button.setAttribute("aria-label", label);
    }

    function onThemeQuickToggleButtonClick() {
        let themeSelect = document.getElementById("themeColorTag");
        if (themeSelect == null) {
            return;
        }
        let isDarkActive = document.body.classList.contains("ns-theme-dark-active");
        themeSelect.value = isDarkActive ? "LightMode" : "DarkMode";
        themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        window.requestAnimationFrame(updateThemeQuickToggleButton);
    }

    function sbFiltersShow()
    {
        sbShow();
        ChapterUrlsUI.Filters.init();
        document.getElementById("sbFilters").hidden = false;
        
        let filtersForm = document.getElementById("sbFiltersForm");
        util.removeElements(filtersForm.children);
        filtersForm.appendChild(ChapterUrlsUI.Filters.generateFiltersTable());
        ChapterUrlsUI.Filters.Filter(); //Run reset filters to clear confusion.
    }

    function sbShow() {
        let sidebar = document.getElementById("sbOptions");
        sidebar.classList.add("sidebarOpen");
        sidebar.setAttribute("aria-hidden", "false");
    }

    function sbHide() {
        let sidebar = document.getElementById("sbOptions");
        sidebar.classList.remove("sidebarOpen");
        sidebar.setAttribute("aria-hidden", "true");
        document.getElementById("sbFilters").hidden = true;
    }

    function showReadingList() {
        let sections = new Map(
            [...document.querySelectorAll("section")]
                .map(s =>[s, s.hidden])
        );
        [...sections.keys()].forEach(s => s.hidden = true);

        document.getElementById("readingListSection").hidden = false;
        document.getElementById("closeReadingList").onclick = () => {
            [...sections].forEach(s => s[0].hidden = s[1]);
        };

        let table = document.getElementById("readingListTable");
        userPreferences.readingList.showReadingList(table);
        table.onclick = (event) => userPreferences.readingList.onClickRemove(event);
    }

    /**
     * If work in progress, give user chance to cancel closing the window
     */
    function onUnloadEvent(event) {
        if (window.workInProgress === true) {
            event.preventDefault();
            event.returnValue = "";
        } else {
            delete event["returnValue"];
        }
    }

    function addEventHandlers() {
        getPackEpubButton().onclick = onPackEpubButtonClick;
        let downloadPacksButton = document.getElementById("downloadPacksButton");
        if (downloadPacksButton != null) {
            downloadPacksButton.onclick = downloadPacks;
        }
        let downloadMarkedGroupsButton = document.getElementById("downloadMarkedChapterGroupsButton");
        if (downloadMarkedGroupsButton != null) {
            downloadMarkedGroupsButton.onclick = downloadMarkedChapterGroups;
        }
        let downloadAllGroupsButton = document.getElementById("downloadAllChapterGroupsButton");
        if (downloadAllGroupsButton != null) {
            downloadAllGroupsButton.onclick = downloadAllChapterGroups;
        }
        document.getElementById("downloadFormatSelect").addEventListener("change", updateDownloadFormatUi);
        getReferenceSitePresetCheckboxes().forEach((checkbox) => {
            checkbox.onchange = () => {
                syncReferenceSiteChipVisualState();
                clearReferenceGroupingSources({
                    preserveStatus: true,
                    preserveSiteSelection: true
                });
                scheduleAutomaticReferenceGroupingAnalysis({ force: true });
            };
        });
        getReferenceGroupingSourceSelect().onchange = (event) => applyReferenceGroupingSource(event.target.value);
        document.getElementById("titleInput").addEventListener("change", () => {
            clearReferenceGroupingSources({
                preserveStatus: true,
                preserveSiteSelection: true
            });
            scheduleAutomaticReferenceGroupingAnalysis({ force: true });
        });
        document.getElementById("diagnosticsCheckBoxInput").onclick = onDiagnosticsClick;
        document.getElementById("reloadButton").onclick = populateControls;
        getManuallySelectParserTag().onchange = populateControls;
        document.getElementById("advancedOptionsButton").onclick = onAdvancedOptionsClick;
        document.getElementById("hiddenBibButton").onclick = onLibraryClick;
        document.getElementById("ShowMoreMetadataOptionsCheckbox").addEventListener("change", () => onShowMoreMetadataOptionsClick());
        document.getElementById("LibShowAdvancedOptionsCheckbox").addEventListener("change", () => Library.LibRenderSavedEpubs());
        document.getElementById("LibAddToLibrary").addEventListener("click", onLibraryActionButtonClick);
        document.getElementById("LibPauseToLibrary").addEventListener("click", onPauseStoryDownloadClick);
        document.getElementById("stylesheetToDefaultButton").onclick = onStylesheetToDefaultClick;
        document.getElementById("resetButton").onclick = resetUI;
        document.getElementById("clearCoverImageUrlButton").onclick = clearCoverUrl;
        document.getElementById("seriesPageHelpButton").onclick = onSeriesPageHelp;
        document.getElementById("CustomFilenameHelpButton").onclick = onCustomFilenameHelp;
        document.getElementById("defaultParserHelpButton").onclick = onDefaultParserHelp;
        getLoadAndAnalyseButton().onclick = onLoadAndAnalyseButtonClick;
        document.getElementById("loadMetadataButton").onclick = onLoadMetadataButtonClick;

        document.getElementById("writeOptionsButton").onclick = () => userPreferences.writeToFile();
        document.getElementById("readOptionsInput").onchange = onReadOptionsFromFile;
        UserPreferences.getReadingListCheckbox().onclick = onReadingListCheckboxClicked;
        document.getElementById("viewFiltersButton").onclick = () => sbFiltersShow();
        document.getElementById("sbClose").onclick = () => sbHide();
        document.getElementById("sbOptions").onclick = (event) => {
            if (event.target.id === "sbOptions") {
                sbHide();
            }
        };
        let themeQuickToggleButton = document.getElementById("themeQuickToggleButton");
        if (themeQuickToggleButton != null) {
            themeQuickToggleButton.onclick = onThemeQuickToggleButtonClick;
        }
        let themeSelect = document.getElementById("themeColorTag");
        if (themeSelect != null) {
            themeSelect.addEventListener("change", () => window.requestAnimationFrame(updateThemeQuickToggleButton));
        }
        updateThemeQuickToggleButton();
        document.getElementById("viewReadingListButton").onclick = () => showReadingList();
        window.addEventListener("beforeunload", onUnloadEvent);
    }
	
	
    // Additional metadata
    async function autosearchadditionalmetadata() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let titlename = getValueFromUiField("titleInput");
        let url ="https://www.novelupdates.com/series-finder/?sf=1&sh="+titlename;
        if (getValueFromUiField("subjectInput")==null) {
            await autosearchnovelupdates(url, titlename);
        }   
        getPackEpubButton().disabled = false; 
        document.getElementById("LibAddToLibrary").disabled = false;    
    }
	
    async function autosearchnovelupdates(url, titlename) {
        try {
            let xhr = await HttpClient.wrapFetch(url);
            await findnovelupdatesurl(url, xhr.responseXML, titlename);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    async function findnovelupdatesurl(url, dom, titlename) {
        try {    
            let searchurl = [...dom.querySelectorAll("a")].filter(a => a.textContent==titlename)[0];
            setUiFieldToValue("metadataUrlInput", searchurl.href);
            url = getValueFromUiField("metadataUrlInput");
            if (url.includes("novelupdates.com") == true) {
                await onLoadMetadataButtonClick();
            }
        } catch {
            //
        }
    }
	
    async function onLoadMetadataButtonClick() {
        getPackEpubButton().disabled = true;
        document.getElementById("LibAddToLibrary").disabled = true;
        let url = getValueFromUiField("metadataUrlInput");
        try {
            let xhr = await HttpClient.wrapFetch(url);
            populateMetadataAddWithDom(url, xhr.responseXML);
        } catch (error) {
            getLoadAndAnalyseButton().disabled = false;
            ErrorLog.showErrorMessage(error);
        }
    }

    function populateMetadataAddWithDom(url, dom) {
        try {
            let allTags = document.getElementById("lesstagsCheckbox").checked == false;
            let metaAddInfo = EpubMetaInfo.getEpubMetaAddInfo(dom, url, allTags);
            setUiFieldToValue("subjectInput", metaAddInfo.subject);
            setUiFieldToValue("descriptionInput", metaAddInfo.description);
            if (getValueFromUiField("authorInput")=="<unknown>") {
                setUiFieldToValue("authorInput", metaAddInfo.author);
            }
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        } catch (error) {
            ErrorLog.showErrorMessage(error);
            getPackEpubButton().disabled = false;
            document.getElementById("LibAddToLibrary").disabled = false;
        }
    }

    // actions to do when window opened
    window.onload = async () => {
        window.addEventListener("unhandledrejection", onUnhandledRejection);
        userPreferences = UserPreferences.readFromLocalStorage();
        if (isRunningInTabMode()) { 
            ErrorLog.SuppressErrorLog =  false;
            localizeHtmlPage();
            getAdvancedOptionsSection().hidden = !userPreferences.advancedOptionsVisibleByDefault.value;
            getAdditionalMetadataSection().hidden = !userPreferences.ShowMoreMetadataOptions.value;
            addEventHandlers();
            populateControls();
            if (util.isFirefox()) {
                Firefox.startWebRequestListeners();
            }
        } else {
            await openTabWindow();
        }
    };

    return {
        getPackEpubButton: getPackEpubButton,
        onLoadAndAnalyseButtonClick : onLoadAndAnalyseButtonClick,
        fetchContentAndPackEpub: fetchContentAndPackEpub,
        downloadSingleChapterByUrl: downloadSingleChapterByUrl,
        downloadChapterGroup: downloadChapterGroup,
        downloadMarkedChapterGroups: downloadMarkedChapterGroups,
        downloadAllChapterGroups: downloadAllChapterGroups,
        resetUI: resetUI,
        getUserPreferences: () => userPreferences,
    };
})();

