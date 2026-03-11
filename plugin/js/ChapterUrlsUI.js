"use strict";

/** Class that handles UI for selecting (chapter) URLs to fetch */
class ChapterUrlsUI {
    constructor(parser) {
        this.parser = parser;
        this.chapterGroups = [];
        this.visibleChapterGroups = [];
        this.markedChapterGroupIds = new Set();
        ChapterUrlsUI.getPleaseWaitMessageRow().hidden = false;
        if (this.parser)
        {
            let nameElement = document.getElementById("spanParserName");
            if (nameElement) nameElement.textContent = this.parser.constructor.name;

            let delayMsElement = document.getElementById("spanDelayMs");
            if (delayMsElement) delayMsElement.textContent = `${this.parser.getRateLimit()} ms`;
        }

        let formElement = document.getElementById("sbFiltersForm");
        if (formElement) {
            document.getElementById("sbFiltersForm").onsubmit = (event) => {
                event.preventDefault();
            };
        }
    }

    connectButtonHandlers() {
        document.getElementById("selectAllUrlsButton").onclick = ChapterUrlsUI.setAllUrlsSelectState.bind(null, true);
        document.getElementById("unselectAllUrlsButton").onclick = ChapterUrlsUI.setAllUrlsSelectState.bind(null, false);
        let invertSelectionButton = document.getElementById("invertSelectionButton");
        if (invertSelectionButton != null) {
            invertSelectionButton.onclick = ChapterUrlsUI.invertVisibleSelectionState.bind(null);
        }
        let autoSelectChaptersButton = document.getElementById("autoSelectChaptersButton");
        if (autoSelectChaptersButton != null) {
            autoSelectChaptersButton.onclick = this.autoSelectLikelyChapters.bind(this);
        }
        document.getElementById("reverseChapterUrlsOrderButton").onclick = this.reverseUrls.bind(this);
        document.getElementById("editChaptersUrlsButton").onclick = this.setEditInputMode.bind(this);
        document.getElementById("copyUrlsToClipboardButton").onclick = this.copyUrlsToClipboard.bind(this);
        document.getElementById("sortChaptersAscButton").onclick = this.sortByChapterAscending.bind(this);
        document.getElementById("sortChaptersDescButton").onclick = this.sortByChapterDescending.bind(this);
        let chapterOnlyCheckbox = document.getElementById("chapterOnlyCheckbox");
        if (chapterOnlyCheckbox != null) {
            chapterOnlyCheckbox.onchange = this.onChapterOnlyToggle.bind(this);
        }
        document.getElementById("showChapterUrlsCheckbox").onclick = this.toggleShowUrlsForChapterRanges.bind(this);
        let smartSelectApplyButton = document.getElementById("smartSelectApplyButton");
        if (smartSelectApplyButton != null) {
            smartSelectApplyButton.onclick = this.onSmartSelectApply.bind(this);
        }
        let smartSelectInput = ChapterUrlsUI.getSmartSelectInput();
        if (smartSelectInput != null) {
            smartSelectInput.onkeydown = (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    this.onSmartSelectApply();
                }
            };
        }
        let groupSearchInput = ChapterUrlsUI.getChapterGroupSearchInput();
        if (groupSearchInput != null) {
            groupSearchInput.oninput = this.filterChapterGroups.bind(this);
        }
        let chapterGroupSelect = ChapterUrlsUI.getChapterGroupSelect();
        if (chapterGroupSelect != null) {
            chapterGroupSelect.onchange = this.onChapterGroupSelectionChanged.bind(this);
        }
        let selectAllChapterGroupsButton = document.getElementById("selectAllChapterGroupsButton");
        if (selectAllChapterGroupsButton != null) {
            selectAllChapterGroupsButton.onclick = this.selectAllVisibleChapterGroups.bind(this);
        }
        let clearSelectedChapterGroupsButton = document.getElementById("clearSelectedChapterGroupsButton");
        if (clearSelectedChapterGroupsButton != null) {
            clearSelectedChapterGroupsButton.onclick = this.clearVisibleMarkedChapterGroups.bind(this);
        }
        let chapterGroupingModeSelect = ChapterUrlsUI.getChapterGroupingModeSelect();
        if (chapterGroupingModeSelect != null) {
            chapterGroupingModeSelect.onchange = this.onChapterGroupingModeChanged.bind(this);
        }
        let collapseChapterGroupsCheckbox = ChapterUrlsUI.getCollapseChapterGroupsCheckbox();
        if (collapseChapterGroupsCheckbox != null) {
            collapseChapterGroupsCheckbox.onchange = this.onChapterGroupingModeChanged.bind(this);
        }
        let expandAllChapterGroupsButton = document.getElementById("expandAllChapterGroupsButton");
        if (expandAllChapterGroupsButton != null) {
            expandAllChapterGroupsButton.onclick = this.expandAllChapterGroups.bind(this);
        }
        let collapseAllChapterGroupsButton = document.getElementById("collapseAllChapterGroupsButton");
        if (collapseAllChapterGroupsButton != null) {
            collapseAllChapterGroupsButton.onclick = this.collapseAllChapterGroups.bind(this);
        }
        this.connectRangeChapterSelectHandlers();
        ChapterUrlsUI.modifyApplyChangesButtons(button => button.onclick = this.setTableMode.bind(this));
    }

    connectRangeChapterSelectHandlers() {
        ChapterUrlsUI.getRangeSelectBindings().forEach(({ select, input }) => {
            if (input != null) {
                input.dataset.selectId = select.id;
            }
            if (select.dataset.numericChapterJumpBound !== "true") {
                select.dataset.rangeInputId = input?.id ?? "";
                select.addEventListener("keydown", (event) => ChapterUrlsUI.onRangeSelectKeyDown(event, input));
                select.addEventListener("keypress", ChapterUrlsUI.onRangeSelectKeyPress);
                select.addEventListener("input", ChapterUrlsUI.onRangeSelectInput);
                select.addEventListener("blur", () => {
                    ChapterUrlsUI.resetRangeSelectTypeAhead(select);
                    ChapterUrlsUI.syncRangeNumberInputFromSelect(select, input, true);
                });
                select.dataset.numericChapterJumpBound = "true";
            }
            if ((input != null) && (input.dataset.numericChapterJumpBound !== "true")) {
                input.addEventListener("input", (event) => ChapterUrlsUI.onRangeNumberInput(event, select));
                input.addEventListener("change", (event) => ChapterUrlsUI.onRangeNumberInput(event, select, true));
                input.addEventListener("blur", () => ChapterUrlsUI.syncRangeNumberInputFromSelect(select, input, true));
                input.dataset.numericChapterJumpBound = "true";
            }
        });
    }

    populateChapterUrlsTable(chapters) {
        ChapterUrlsUI.getPleaseWaitMessageRow().hidden = true;
        ChapterUrlsUI.clearChapterUrlsTable();
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        let index = 0;
        let rangeStart = ChapterUrlsUI.getRangeStartChapterSelect();
        let rangeEnd = ChapterUrlsUI.getRangeEndChapterSelect();
        let memberForTextOption = ChapterUrlsUI.textToShowInRange();
        chapters.forEach((chapter) => {
            let row = document.createElement("tr");
            ChapterUrlsUI.appendCheckBoxToRow(row, chapter);
            ChapterUrlsUI.appendInputTextToRow(row, chapter);
            chapter.row = row;
            row.webPage = chapter;
            ChapterUrlsUI.appendColumnDataToRow(row, chapter.sourceUrl);
            linksTable.appendChild(row);
            ChapterUrlsUI.appendOptionToSelect(rangeStart, index, chapter, memberForTextOption);
            ChapterUrlsUI.appendOptionToSelect(rangeEnd, index, chapter, memberForTextOption);
            ++index;
        });
        ChapterUrlsUI.setRangeOptionsToFirstAndLastChapters();
        this.showHideChapterUrlsColumn();
        ChapterUrlsUI.resizeTitleColumnToFit(linksTable);
        this.applyChapterOnlyFilter(chapters);
        this.refreshChapterGroupControls(chapters);
    }

    showTocProgress(chapters) {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        chapters.forEach((chapter) => {
            let row = document.createElement("tr");
            linksTable.appendChild(row);
            row.appendChild(document.createElement("td"));
            let col = document.createElement("td");
            col.className = "disabled";
            col.appendChild(document.createTextNode(chapter.title));
            row.appendChild(col);
            row.appendChild(document.createElement("td"));
        });
    }

    static showDownloadState(row, state) {
        if (row != null) {
            let downloadStateDiv = row.querySelector(".downloadStateDiv");
            ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv, state);
        }
    }

    static updateDownloadStateImage(downloadStateDiv, state) {
        let img = downloadStateDiv.querySelector("img");
        if (img) {
            downloadStateDiv.hidden = (state === ChapterUrlsUI.DOWNLOAD_STATE_NONE);
            img.src = ChapterUrlsUI.ImageForState[state];

            // Update tooltip
            let tooltipText = ChapterUrlsUI.TooltipForSate[state];
            let tooltipTextSpan = downloadStateDiv.querySelector(".tooltipText");

            if (tooltipText && !tooltipTextSpan) {
                tooltipTextSpan = document.createElement("span");
                tooltipTextSpan.className = "tooltipText";
                tooltipTextSpan.textContent = tooltipText;
                downloadStateDiv.appendChild(tooltipTextSpan);
            } else if (tooltipText) {
                tooltipTextSpan.textContent = tooltipText;
            } else if (tooltipTextSpan) {
                // Remove tooltip text if there is no text to display
                downloadStateDiv.removeChild(tooltipTextSpan);
            }
        }
    }

    static resetDownloadStateImages() {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        let prevDownload = ChapterUrlsUI.ImageForState[ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS];
        let downloaded = ChapterUrlsUI.ImageForState[ChapterUrlsUI.DOWNLOAD_STATE_LOADED];

        for (let downloadStateDiv of linksTable.querySelectorAll(".downloadStateDiv")) {
            let state = ChapterUrlsUI.DOWNLOAD_STATE_NONE;
            let imgSrc = downloadStateDiv.querySelector("img")?.src;
            if (imgSrc) {
                const imagesIndex = imgSrc.indexOf("images/");
                if (imagesIndex !== -1) {
                    imgSrc = imgSrc.substring(imagesIndex);
                }
            }
            if (imgSrc === prevDownload || imgSrc === downloaded) {
                state = ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS;
            }
            ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv, state);
        }
    }

    static clearChapterUrlsTable() {
        util.removeElements(ChapterUrlsUI.getTableRowsWithChapters());
        util.removeElements([...ChapterUrlsUI.getRangeStartChapterSelect().options]);
        util.removeElements([...ChapterUrlsUI.getRangeEndChapterSelect().options]);
        ChapterUrlsUI.getRangeSelectBindings().forEach(({ input, select }) => {
            if (input != null) {
                input.value = "";
            }
            ChapterUrlsUI.resetRangeSelectTypeAhead(select);
        });
        let chapterGroupSelect = ChapterUrlsUI.getChapterGroupSelect();
        if (chapterGroupSelect != null) {
            util.removeElements([...chapterGroupSelect.options]);
            chapterGroupSelect.disabled = false;
        }
        let chapterGroupSearchInput = ChapterUrlsUI.getChapterGroupSearchInput();
        if (chapterGroupSearchInput != null) {
            chapterGroupSearchInput.value = "";
        }
        ["selectAllChapterGroupsButton", "clearSelectedChapterGroupsButton",
            "downloadMarkedChapterGroupsButton", "downloadAllChapterGroupsButton"]
            .forEach((elementId) => {
                let button = document.getElementById(elementId);
                if (button != null) {
                    button.disabled = false;
                }
            });
        let groupPackControls = document.getElementById("groupPackControls");
        if (groupPackControls != null) {
            groupPackControls.hidden = true;
        }
        let chapterGroupBrowser = ChapterUrlsUI.getChapterGroupBrowser();
        if (chapterGroupBrowser != null) {
            util.removeElements([...chapterGroupBrowser.children]);
        }
        let chapterGroupBrowserSection = ChapterUrlsUI.getChapterGroupBrowserSection();
        if (chapterGroupBrowserSection != null) {
            chapterGroupBrowserSection.hidden = true;
        }
        let chapterGroupEmptyState = ChapterUrlsUI.getChapterGroupEmptyState();
        if (chapterGroupEmptyState != null) {
            chapterGroupEmptyState.hidden = true;
            chapterGroupEmptyState.textContent = "";
        }
        let chapterGroupingHint = ChapterUrlsUI.getChapterGroupingHint();
        if (chapterGroupingHint != null) {
            chapterGroupingHint.hidden = true;
            chapterGroupingHint.textContent = "";
        }
        let chapterGroupBrowserTitle = ChapterUrlsUI.getChapterGroupBrowserTitle();
        if (chapterGroupBrowserTitle != null) {
            chapterGroupBrowserTitle.textContent = "Detected groups";
        }
        let chapterGroupSummary = ChapterUrlsUI.getChapterGroupSummary();
        if (chapterGroupSummary != null) {
            chapterGroupSummary.textContent = "Select one or more groups, then download the selection or everything.";
        }
    }

    static limitNumOfChapterS(maxChapters) {
        let max = util.isNullOrEmpty(maxChapters) ? 10000 : parseInt(maxChapters.replace(",", ""));
        let selectedRows = [...ChapterUrlsUI.getChapterUrlsTable().querySelectorAll("[type='checkbox'")]
            .filter(c => c.checked)
            .map(c => c.closest("tr"));
        if (max< selectedRows.length ) {
            let message = UIText.Chapter.maxChaptersSelected(selectedRows.length, max);
            if (confirm(message) === false) {
                for (let row of selectedRows.slice(max)) {
                    ChapterUrlsUI.setRowCheckboxState(row, false);
                }
            }
        }
    }

    /** @private */
    static setRangeOptionsToFirstAndLastChapters()
    {
        let rangeStart = ChapterUrlsUI.getRangeStartChapterSelect();
        let rangeEnd = ChapterUrlsUI.getRangeEndChapterSelect();

        rangeStart.onchange = null;
        rangeStart.oninput = null;
        rangeEnd.onchange = null;
        rangeEnd.oninput = null;
        
        rangeStart.selectedIndex = 0;
        rangeEnd.selectedIndex = rangeEnd.length - 1;
        ChapterUrlsUI.setChapterCount(rangeStart.selectedIndex, rangeEnd.selectedIndex);
        
        rangeStart.onchange = ChapterUrlsUI.onRangeChanged;
        rangeStart.oninput = ChapterUrlsUI.onRangeChanged;
        rangeEnd.onchange = ChapterUrlsUI.onRangeChanged;
        rangeEnd.oninput = ChapterUrlsUI.onRangeChanged;
        ChapterUrlsUI.syncRangeNumberInputs(true);
    }
 
    /** @private */
    static onRangeChanged() {
        let startIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeStartChapterSelect());
        let endIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeEndChapterSelect());
        let rc = new ChapterUrlsUI.RangeCalculator();

        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            let inRange = rc.rowInRange(row);
            ChapterUrlsUI.setRowCheckboxState(row, rc.rowInRange(row));
            let hiddenByChapterOnly = ChapterUrlsUI.isChapterOnlyEnabled()
                && !ChapterUrlsUI.isLikelyChapter(row.webPage);
            if (hiddenByChapterOnly) {
                if (row.webPage != null) {
                    row.webPage.isIncludeable = false;
                }
                ChapterUrlsUI.setRowCheckboxState(row, false);
            }
            row.hidden = !inRange || hiddenByChapterOnly;
        }
        ChapterUrlsUI.setChapterCount(startIndex, endIndex);
        ChapterUrlsUI.syncRangeNumberInputs();
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    static selectionToRowIndex(selectElement) {
        let selectedIndex = selectElement.selectedIndex;
        return selectedIndex + 1;
    }

    static onRangeSelectKeyDown(event, input) {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        let select = event.currentTarget;
        if (select == null) {
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            ChapterUrlsUI.resetRangeSelectTypeAhead(select);
            if (input != null) {
                input.value = "";
            }
            return;
        }

        if (event.key === "Backspace") {
            let currentQuery = select.dataset.chapterJumpQuery ?? "";
            if (currentQuery === "") {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            let nextQuery = currentQuery.slice(0, -1);
            ChapterUrlsUI.applyRangeSelectNumericQuery(select, input, nextQuery);
            return;
        }

        if (/^\d$/.test(event.key) === false) {
            if (event.key.length === 1) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        let query = ChapterUrlsUI.buildRangeSelectTypeAheadQuery(select, event.key);
        ChapterUrlsUI.applyRangeSelectNumericQuery(select, input, query);
    }

    static onRangeSelectKeyPress(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        if (event.key.length !== 1) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    static onRangeSelectInput() {
        ChapterUrlsUI.onRangeChanged();
    }

    static onRangeNumberInput(event, select, exactOnly = false) {
        let input = event.currentTarget;
        if ((input == null) || (select == null)) {
            return;
        }
        let query = input.value.replace(/\D+/g, "").trim();
        if (input.value !== query) {
            input.value = query;
        }
        if (query === "") {
            return;
        }
        ChapterUrlsUI.selectRangeOptionFromNumericQuery(select, query, exactOnly);
    }

    static buildRangeSelectTypeAheadQuery(select, digit) {
        let previousQuery = select.dataset.chapterJumpQuery ?? "";
        let previousTimestamp = parseInt(select.dataset.chapterJumpTimestamp ?? "0", 10);
        let now = Date.now();
        let query = ((now - previousTimestamp) > ChapterUrlsUI.RANGE_SELECT_BUFFER_RESET_MS)
            ? digit
            : previousQuery + digit;
        ChapterUrlsUI.storeRangeSelectTypeAhead(select, query);
        return query;
    }

    static storeRangeSelectTypeAhead(select, query) {
        select.dataset.chapterJumpQuery = query;
        select.dataset.chapterJumpTimestamp = String(Date.now());
    }

    static resetRangeSelectTypeAhead(eventOrSelect) {
        let select = eventOrSelect?.currentTarget ?? eventOrSelect;
        if (select == null) {
            return;
        }
        delete select.dataset.chapterJumpQuery;
        delete select.dataset.chapterJumpTimestamp;
    }

    static applyRangeSelectNumericQuery(select, input, query) {
        if (query === "") {
            ChapterUrlsUI.resetRangeSelectTypeAhead(select);
            if (input != null) {
                input.value = "";
            }
            return;
        }
        ChapterUrlsUI.storeRangeSelectTypeAhead(select, query);
        if (input != null) {
            input.focus();
            input.value = query;
            input.setSelectionRange(query.length, query.length);
        }
        ChapterUrlsUI.selectRangeOptionFromNumericQuery(select, query);
    }

    static selectRangeOptionFromNumericQuery(select, query, exactOnly = false) {
        let visibleOptions = [...select.options].filter(option => !option.hidden);
        if (visibleOptions.length === 0) {
            return;
        }

        let exactMatch = visibleOptions.find(option => ChapterUrlsUI.optionHasChapterNumberMatch(option, query, true));
        let matchedOption = exactMatch;
        if ((matchedOption == null) && !exactOnly) {
            matchedOption = visibleOptions.find(option => ChapterUrlsUI.optionHasChapterNumberMatch(option, query, false));
        }
        if (matchedOption == null) {
            return;
        }

        if (select.selectedIndex === matchedOption.index) {
            return;
        }

        select.selectedIndex = matchedOption.index;
        ChapterUrlsUI.onRangeChanged();
    }

    static optionHasChapterNumberMatch(option, query, exact) {
        let chapterNumber = option.dataset.chapterNumber ?? "";
        return exact
            ? (chapterNumber === query)
            : chapterNumber.startsWith(query);
    }

    static syncRangeNumberInputs(force = false) {
        ChapterUrlsUI.getRangeSelectBindings()
            .forEach(({ select, input }) => ChapterUrlsUI.syncRangeNumberInputFromSelect(select, input, force));
    }

    static syncRangeNumberInputFromSelect(select, input, force = false) {
        if ((select == null) || (input == null)) {
            return;
        }
        if (!force && (document.activeElement === input)) {
            return;
        }
        let selectedOption = select.options[select.selectedIndex] ?? null;
        input.value = selectedOption?.dataset.chapterNumber ?? "";
    }

    /** @private */
    static setChapterCount(startIndex, endIndex) {
        let count = Math.max(0, 1 + endIndex - startIndex);
        document.getElementById("spanChapterCount").textContent = count;
    }
    
    /** 
    * @private
    */
    static getChapterUrlsTable() {
        return document.getElementById("chapterUrlsTable");
    }

    /** @private */
    static getRangeStartChapterSelect() {
        return document.getElementById("selectRangeStartChapter");
    }

    static getRangeStartChapterNumberInput() {
        return document.getElementById("selectRangeStartChapterNumber");
    }

    /** @private */
    static getRangeEndChapterSelect() {
        return document.getElementById("selectRangeEndChapter");
    }

    static getRangeEndChapterNumberInput() {
        return document.getElementById("selectRangeEndChapterNumber");
    }

    static getRangeSelectBindings() {
        return [
            {
                select: ChapterUrlsUI.getRangeStartChapterSelect(),
                input: ChapterUrlsUI.getRangeStartChapterNumberInput()
            },
            {
                select: ChapterUrlsUI.getRangeEndChapterSelect(),
                input: ChapterUrlsUI.getRangeEndChapterNumberInput()
            }
        ].filter(binding => binding.select != null);
    }

    /** @private */
    static textToShowInRange() {
        return document.getElementById("showChapterUrlsCheckbox").checked
            ? "sourceUrl"
            : "title";
    }

    /** 
    * @private
    */
    static modifyApplyChangesButtons(mutator) {
        mutator(document.getElementById("applyChangesButton"));
        mutator(document.getElementById("applyChangesButton2"));
    }

    /** 
    * @private
    */
    static getEditChaptersUrlsInput() {
        return document.getElementById("editChaptersUrlsInput");
    }

    /** @private */
    static getPleaseWaitMessageRow() {
        return document.getElementById("findingChapterUrlsMessageRow");
    }

    /** @private */
    static setAllUrlsSelectState(select) {
        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            let isFilteredOut = ChapterUrlsUI.isChapterOnlyEnabled()
                && !ChapterUrlsUI.isLikelyChapter(row.webPage);
            if (isFilteredOut) {
                if (row.webPage != null) {
                    row.webPage.isIncludeable = false;
                }
                ChapterUrlsUI.setRowCheckboxState(row, false);
                row.hidden = true;
                continue;
            }
            ChapterUrlsUI.setRowCheckboxState(row, select);
            row.hidden = false;
        }
        ChapterUrlsUI.setRangeOptionsToFirstAndLastChapters();
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    static invertVisibleSelectionState() {
        let range = new ChapterUrlsUI.RangeCalculator();
        let chapterOnlyEnabled = ChapterUrlsUI.isChapterOnlyEnabled();
        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            if (!range.rowInRange(row)) {
                continue;
            }
            if (chapterOnlyEnabled && !ChapterUrlsUI.isLikelyChapter(row.webPage)) {
                continue;
            }
            let currentState = ChapterUrlsUI.getRowCheckboxState(row);
            ChapterUrlsUI.setRowCheckboxState(row, !currentState);
        }
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    /** @private */
    static setRowCheckboxState(row, checked) {
        if (checked && (row.webPage?.isSelectable === false)) {
            checked = false;
        }
        let input = ChapterUrlsUI.getRowCheckboxInput(row);
        if (input == null) {
            if (row.webPage != null) {
                row.webPage.isIncludeable = checked;
            }
            ChapterUrlsUI.updateRowSelectionVisualState(row, checked);
            return;
        }
        if (input.checked !== checked) {
            input.checked = checked;
        }
        if (row.webPage != null) {
            row.webPage.isIncludeable = checked;
        }
        ChapterUrlsUI.updateRowSelectionVisualState(row, checked);
    }

    static getRowCheckboxState(row) {
        let input = ChapterUrlsUI.getRowCheckboxInput(row);
        if (input != null) {
            return input.checked;
        }
        return row.webPage?.isIncludeable === true;
    }

    static getRowCheckboxInput(row) {
        return row.querySelector("input.chapterIncludeCheckbox");
    }

    static updateRowSelectionVisualState(row, selected) {
        let checkbox = ChapterUrlsUI.getRowCheckboxInput(row);
        if (checkbox != null) {
            checkbox.classList.toggle("isIncluded", selected);
            checkbox.classList.toggle("isExcluded", !selected);
            checkbox.title = selected ? "Included" : "Excluded";
            checkbox.style.accentColor = selected ? "#059669" : "#e11d48";
        }
        row.classList.toggle("chapterRowSelected", selected);
        row.classList.toggle("chapterRowExcluded", !selected);
    }

    static isSelectionInteractiveTarget(target) {
        return target.closest("button, a, input, select, textarea, label") != null;
    }

    static toggleRowSelection(row, chapter, event) {
        let checkbox = ChapterUrlsUI.getRowCheckboxInput(row);
        if (checkbox == null) {
            return;
        }
        checkbox.checked = !checkbox.checked;
        ChapterUrlsUI.onRowSelectionChanged(row, chapter, event);
    }

    static onRowSelectionChanged(row, chapter, event) {
        let checkbox = ChapterUrlsUI.getRowCheckboxInput(row);
        if (checkbox == null) {
            return;
        }
        if (chapter != null) {
            chapter.isIncludeable = checkbox.checked;
        }
        ChapterUrlsUI.updateRowSelectionVisualState(row, checkbox.checked);
        if (!event) return;

        ChapterUrlsUI.tellUserAboutShiftClick(event, row);

        if (event.shiftKey && (ChapterUrlsUI.lastSelectedRow !== null)) {
            ChapterUrlsUI.updateRange(ChapterUrlsUI.lastSelectedRow, row.rowIndex, checkbox.checked);
        } else {
            ChapterUrlsUI.lastSelectedRow = row.rowIndex;
        }
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    static getTableRowsWithChapters() {
        let linksTable = ChapterUrlsUI.getChapterUrlsTable();
        return [...linksTable.querySelectorAll("tr")]
            .filter(r => r.querySelector("th") === null);
    }

    /** 
    * @private
    */
    static appendCheckBoxToRow(row, chapter) {
        chapter.isIncludeable = chapter.isIncludeable ?? true;
        chapter.previousDownload = chapter.previousDownload ?? false;

        const col = document.createElement("td");
        col.className = "chapterIncludeCell";
        const controls = document.createElement("div");
        controls.className = "chapterIncludeControls";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "chapterIncludeCheckbox";
        checkbox.checked = chapter.isIncludeable;
        checkbox.disabled = chapter.isSelectable === false;
        checkbox.onclick = (event) => {
            ChapterUrlsUI.onRowSelectionChanged(row, chapter, event);
        };
        controls.appendChild(checkbox);
        ChapterUrlsUI.addDownloadStateToContainer(controls, chapter.previousDownload);
        ChapterUrlsUI.addQuickDownloadButton(controls, chapter);
        col.appendChild(controls);
        row.appendChild(col);
        row.tabIndex = 0;
        row.classList.add("chapterRowSelectable");
        row.onclick = (event) => {
            if (ChapterUrlsUI.isSelectionInteractiveTarget(event.target)) {
                return;
            }
            ChapterUrlsUI.toggleRowSelection(row, chapter, event);
        };
        row.onkeydown = (event) => {
            if (ChapterUrlsUI.isSelectionInteractiveTarget(event.target)) {
                return;
            }
            if ((event.key !== " ") && (event.key !== "Enter")) {
                return;
            }
            event.preventDefault();
            ChapterUrlsUI.toggleRowSelection(row, chapter, event);
        };
        ChapterUrlsUI.updateRowSelectionVisualState(row, checkbox.checked);
    }

    static addDownloadStateToContainer(container, previousDownload) {
        let downloadStateDiv = document.createElement("div");
        downloadStateDiv.className = "downloadStateDiv";
        let img = document.createElement("img");
        img.className = "downloadState";

        downloadStateDiv.appendChild(img);
        ChapterUrlsUI.updateDownloadStateImage(downloadStateDiv,
            previousDownload ? ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS : ChapterUrlsUI.DOWNLOAD_STATE_NONE
        );
        container.appendChild(downloadStateDiv);
    }

    static addQuickDownloadButton(container, chapter) {
        let button = document.createElement("button");
        button.type = "button";
        button.className = "chapterQuickDownloadButton";
        button.title = "Download this chapter now";
        button.setAttribute("aria-label", "Download chapter");
        button.disabled = chapter.isSelectable === false;
        let icon = util.createSvgIcon("0 0 24 24");
        util.appendSvgPath(icon, {
            d: "M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.41l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.41L11 12.59V4a1 1 0 0 1 1-1Z"
        });
        util.appendSvgPath(icon, {
            d: "M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"
        });
        button.replaceChildren(icon);
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof main?.downloadSingleChapterByUrl === "function") {
                main.downloadSingleChapterByUrl(chapter.sourceUrl);
            }
        };
        container.appendChild(button);
    }

    /** 
    * @private
    */
    static appendInputTextToRow(row, chapter) {
        let col = document.createElement("td");
        let input = document.createElement("input");
        input.type = "text";
        input.value = chapter.title;
        input.className = "fullWidth";
        input.addEventListener("blur", () => { chapter.title = input.value; },  true);
        col.appendChild(input);
        row.appendChild(col);
    }

    static appendOptionToSelect(select, value, chapter, memberForTextOption) {
        let option = new Option(chapter[memberForTextOption], value);
        option.dataset.chapterNumber = String(ChapterUrlsUI.getSelectableChapterNumber(chapter, value + 1));
        select.add(option);
    }

    static getSelectableChapterNumber(chapter, fallbackIndex) {
        return ChapterUrlsUI.extractChapterNumber(chapter) ?? fallbackIndex;
    }

    /** @private */
    static resizeTitleColumnToFit(linksTable) {
        let inputs = [...linksTable.querySelectorAll("input[type='text']")];
        let width = inputs.reduce((acc, element) => Math.max(acc, element.value.length), 0);
        if (0 < width) {
            inputs.forEach(i => i.size = width); 
        }
    }

    /** 
    * @private
    */
    static appendColumnDataToRow(row, textData) {
        let col = document.createElement("td");
        col.innerText = textData;
        col.style.whiteSpace = "nowrap";
        row.appendChild(col);
        return col;
    }

    /** 
    * @public
    */
    static setVisibleUI(toTable) {
        // toggle mode
        ChapterUrlsUI.getEditChaptersUrlsInput().hidden = toTable;
        ChapterUrlsUI.getChapterUrlsTable().hidden = !toTable;
        document.getElementById("inputSection").hidden = !toTable;
        document.getElementById("coverUrlSection").hidden = !toTable;
        document.getElementById("chapterSelectControlsDiv").hidden = !toTable;
        ChapterUrlsUI.modifyApplyChangesButtons(button => button.hidden = toTable);
        document.getElementById("editURLsHint").hidden = toTable;
    }

    /** 
    * @private
    */
    setTableMode() {
        try {
            let inputvalue = ChapterUrlsUI.getEditChaptersUrlsInput().value;
            let chapters;
            let lines = inputvalue.split("\n");
            lines = lines.filter(a => a.trim() != "").map(a => a.trim());
            if (URL.canParse(lines[0])) {
                chapters = this.URLsToChapters(lines);
            } else {
                chapters = this.htmlToChapters(inputvalue);
            }
            this.parser.setPagesToFetch(chapters);
            this.populateChapterUrlsTable(chapters);
            this.usingTable = true;
            ChapterUrlsUI.setVisibleUI(this.usingTable);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    /** @private */
    reverseUrls() {
        try {
            let chapters = [...this.parser.getPagesToFetch().values()];
            chapters.reverse();
            this.populateChapterUrlsTable(chapters);
            this.parser.setPagesToFetch(chapters);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    sortByChapterAscending() {
        this.sortByChapter(true);
    }

    sortByChapterDescending() {
        this.sortByChapter(false);
    }

    sortByChapter(ascending) {
        try {
            let chapters = [...this.parser.getPagesToFetch().values()];
            chapters.forEach((chapter, index) => chapter.originalOrderIndex = index);
            chapters.sort((left, right) => {
                let leftNumber = ChapterUrlsUI.extractChapterNumber(left);
                let rightNumber = ChapterUrlsUI.extractChapterNumber(right);

                if ((leftNumber == null) && (rightNumber == null)) {
                    return left.originalOrderIndex - right.originalOrderIndex;
                }
                if (leftNumber == null) {
                    return 1;
                }
                if (rightNumber == null) {
                    return -1;
                }
                if (leftNumber !== rightNumber) {
                    return ascending ? (leftNumber - rightNumber) : (rightNumber - leftNumber);
                }
                return left.originalOrderIndex - right.originalOrderIndex;
            });

            chapters.forEach(chapter => delete chapter.originalOrderIndex);
            this.populateChapterUrlsTable(chapters);
            this.parser.setPagesToFetch(chapters);
        } catch (err) {
            ErrorLog.showErrorMessage(err);
        }
    }

    autoSelectLikelyChapters() {
        let range = new ChapterUrlsUI.RangeCalculator();
        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            if (!range.rowInRange(row)) {
                continue;
            }
            let chapter = row.webPage;
            if (chapter == null) {
                continue;
            }
            ChapterUrlsUI.setRowCheckboxState(row, ChapterUrlsUI.isLikelyChapter(chapter));
        }
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    onSmartSelectApply() {
        try {
            let smartSelectInput = ChapterUrlsUI.getSmartSelectInput();
            if (smartSelectInput == null) {
                return;
            }
            let query = smartSelectInput.value.trim();
            if (util.isNullOrEmpty(query)) {
                return;
            }
            let modeElement = ChapterUrlsUI.getSmartSelectMode();
            let shouldInclude = (modeElement == null) || (modeElement.value !== "exclude");
            this.applySmartSelection(query, shouldInclude);
        } catch (error) {
            ErrorLog.showErrorMessage(error);
        }
    }

    applySmartSelection(query, shouldInclude) {
        let matcher = ChapterUrlsUI.createSmartMatcher(query);
        let range = new ChapterUrlsUI.RangeCalculator();
        let chapterOnlyEnabled = ChapterUrlsUI.isChapterOnlyEnabled();
        for (let row of ChapterUrlsUI.getTableRowsWithChapters()) {
            if (!range.rowInRange(row)) {
                continue;
            }
            let chapter = row.webPage;
            if (chapter == null) {
                continue;
            }
            if (chapterOnlyEnabled && !ChapterUrlsUI.isLikelyChapter(chapter)) {
                continue;
            }
            if (!matcher(chapter)) {
                continue;
            }
            ChapterUrlsUI.setRowCheckboxState(row, shouldInclude);
        }
        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    onChapterOnlyToggle() {
        this.applyChapterOnlyFilter();
    }

    applyChapterOnlyFilter(chaptersOverride) {
        let chapters = chaptersOverride || [...this.parser.getPagesToFetch().values()];
        let enabled = ChapterUrlsUI.isChapterOnlyEnabled();

        for (let chapter of chapters) {
            let row = chapter.row;
            if (row == null) {
                continue;
            }

            let isChapter = ChapterUrlsUI.isLikelyChapter(chapter);
            if (enabled && !isChapter) {
                ChapterUrlsUI.setRowCheckboxState(row, false);
            }
        }

        this.updateRangeSelectVisibility(chapters, enabled);
        ChapterUrlsUI.onRangeChanged();
    }

    updateRangeSelectVisibility(chapters, chapterOnlyEnabled) {
        let rangeStart = ChapterUrlsUI.getRangeStartChapterSelect();
        let rangeEnd = ChapterUrlsUI.getRangeEndChapterSelect();
        [rangeStart, rangeEnd].forEach((select) => {
            [...select.options].forEach((option, index) => {
                let chapter = chapters[index];
                option.hidden = chapterOnlyEnabled && (chapter != null) && !ChapterUrlsUI.isLikelyChapter(chapter);
            });
        });

        this.ensureSelectHasVisibleSelection(rangeStart, true);
        this.ensureSelectHasVisibleSelection(rangeEnd, false);
    }

    ensureSelectHasVisibleSelection(select, useFirstVisible) {
        let options = [...select.options];
        if (options.length === 0) {
            return;
        }

        let selectedOption = options[select.selectedIndex];
        if ((selectedOption != null) && !selectedOption.hidden) {
            return;
        }

        let visibleOptions = options.filter(option => !option.hidden);
        if (visibleOptions.length === 0) {
            return;
        }

        let newSelection = useFirstVisible ? visibleOptions[0] : visibleOptions[visibleOptions.length - 1];
        select.selectedIndex = options.indexOf(newSelection);
    }

    /** 
    * @private
    */
    htmlToChapters(innerHtml) {
        let html = "<html><head><title></title><body>" + innerHtml + "</body></html>";
        let doc = util.sanitize(html);
        return [...doc.body.querySelectorAll("a")].map(a => util.hyperLinkToChapter(a));
    }

    /** 
    * @private
    */
    URLsToChapters(URLs) {
        let returnchapters = URLs.map(e => ({
            sourceUrl: e,
            title: "[placeholder]"
        }));
        return returnchapters;
    }

    onChapterGroupingModeChanged() {
        let chapters = this.parser == null ? [] : [...this.parser.getPagesToFetch().values()];
        this.refreshChapterGroupControls(chapters);
    }

    onChapterGroupSelectionChanged() {
        this.setCurrentChapterGroup(ChapterUrlsUI.getSelectedChapterGroupId(), false);
    }

    expandAllChapterGroups() {
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        if (browser == null) {
            return;
        }
        for (let card of browser.querySelectorAll(".chapterGroupCard")) {
            if (!card.hidden) {
                card.open = true;
            }
        }
    }

    collapseAllChapterGroups() {
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        if (browser == null) {
            return;
        }
        for (let card of browser.querySelectorAll(".chapterGroupCard")) {
            card.open = false;
        }
    }

    resolveVisibleChapterGroups(chapterGroups) {
        let mode = ChapterUrlsUI.getChapterGroupingMode();
        let referenceSource = this.parser?.getReferenceChapterGroupSource?.();
        if (mode === "flat") {
            return {
                groups: [],
                hint: ""
            };
        }

        let groups = chapterGroups;
        let hint = "";
        if (mode === "volumes") {
            let volumeGroups = chapterGroups.filter(group => ChapterUrlsUI.isVolumeLikeGroup(group));
            if (0 < volumeGroups.length) {
                groups = volumeGroups;
            } else if (0 < chapterGroups.length) {
                if (referenceSource != null) {
                    hint = "The selected reference site did not expose clean volume markers. Showing its detected groups instead.";
                } else {
                    let hasNativeSections = chapterGroups.some(group => group.type === "section" || group.source === "native_section");
                    hint = hasNativeSections
                        ? "No native volumes detected on this page. Showing site sections instead."
                        : "No native volumes detected on this page. Showing detected groups instead.";
                }
            }
        }

        if ((groups.length === 1) && (groups[0].source === "manual_range")) {
            hint = hint || "This site did not expose native volumes or arcs here. Showing one fallback chapter range.";
        }

        return {
            groups: groups,
            hint: hint
        };
    }

    updateChapterGroupingHint(message) {
        let hintElement = ChapterUrlsUI.getChapterGroupingHint();
        if (hintElement == null) {
            return;
        }
        hintElement.textContent = message ?? "";
        hintElement.hidden = util.isNullOrEmpty(message);
    }

    updateChapterGroupBrowserHeading(filteredCount = null, query = "") {
        let titleElement = ChapterUrlsUI.getChapterGroupBrowserTitle();
        let summaryElement = ChapterUrlsUI.getChapterGroupSummary();
        if ((titleElement == null) || (summaryElement == null)) {
            return;
        }

        let mode = ChapterUrlsUI.getChapterGroupingMode();
        let allGroupsAreVolumes = (0 < this.visibleChapterGroups.length)
            && this.visibleChapterGroups.every(group => ChapterUrlsUI.isVolumeLikeGroup(group));
        titleElement.textContent = (mode === "volumes") && allGroupsAreVolumes
            ? "Volumes / books"
            : "Detected groups";

        let totalGroupCount = this.visibleChapterGroups.length;
        let shownGroupCount = filteredCount ?? totalGroupCount;
        if (totalGroupCount === 0) {
            summaryElement.textContent = "No detected groups are available for this chapter view.";
            return;
        }

        if (!util.isNullOrEmpty(query) && (shownGroupCount !== totalGroupCount)) {
            summaryElement.textContent = `${shownGroupCount} of ${totalGroupCount} groups shown.`;
            return;
        }

        let referenceSource = this.parser?.getReferenceChapterGroupSource?.();
        let markedCount = this.getMarkedChapterGroupIds().length;
        let selectionSuffix = (markedCount > 0) ? ` ${markedCount} selected.` : "";
        if (referenceSource != null) {
            summaryElement.textContent = `${totalGroupCount} groups loaded from ${referenceSource.label}.${selectionSuffix}`;
            return;
        }

        summaryElement.textContent = `${totalGroupCount} groups ready.${selectionSuffix}`;
    }

    updateChapterGroupEmptyState(hasVisibleGroup, query = "") {
        let emptyState = ChapterUrlsUI.getChapterGroupEmptyState();
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        if ((emptyState == null) || (browser == null)) {
            return;
        }

        let noGroupsAvailable = this.visibleChapterGroups.length === 0;
        let showEmptyState = noGroupsAvailable || !hasVisibleGroup;
        emptyState.hidden = !showEmptyState;
        browser.hidden = noGroupsAvailable || !hasVisibleGroup;
        if (!showEmptyState) {
            emptyState.textContent = "";
            return;
        }

        emptyState.textContent = noGroupsAvailable
            ? "No chapter groups are available for this chapter view."
            : (!util.isNullOrEmpty(query)
                ? "No groups match the current filter."
                : "No visible groups are available right now.");
    }

    renderChapterGroupBrowser(groups) {
        let browserSection = ChapterUrlsUI.getChapterGroupBrowserSection();
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        if ((browserSection == null) || (browser == null)) {
            return;
        }

        util.removeElements([...browser.children]);
        browserSection.hidden = groups.length === 0;
        browser.hidden = groups.length === 0;
        if (groups.length === 0) {
            return;
        }

        let collapseByDefault = ChapterUrlsUI.shouldCollapseGroupsByDefault();
        groups.forEach((group, index) => {
            let card = document.createElement("details");
            card.className = "chapterGroupCard";
            card.dataset.groupId = group.id;
            card.dataset.search = ChapterUrlsUI.groupSearchText(group);
            card.chapterGroup = group;
            card.open = !collapseByDefault || (index === 0);

            let summary = document.createElement("summary");
            summary.className = "chapterGroupCardSummary";
            summary.onclick = () => {
                window.setTimeout(() => this.setCurrentChapterGroup(group.id, false), 0);
            };

            let markButton = document.createElement("button");
            markButton.type = "button";
            markButton.className = "chapterGroupMarkButton";
            markButton.dataset.groupId = group.id;
            markButton.setAttribute("aria-label", `Toggle ${group.displayTitle}`);
            markButton.setAttribute("aria-pressed", "false");
            markButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleMarkedChapterGroup(group.id);
            };
            summary.appendChild(markButton);

            let title = document.createElement("span");
            title.className = "chapterGroupCardTitle";
            title.textContent = group.displayTitle;
            summary.appendChild(title);

            let meta = document.createElement("span");
            meta.className = "chapterGroupCardMeta";
            meta.textContent = `${group.count} chapters, ${group.rangeLabel}`;
            summary.appendChild(meta);

            let selectedCount = document.createElement("span");
            selectedCount.className = "chapterGroupCardSelectedCount";
            selectedCount.textContent = `0/${group.count} selected`;
            summary.appendChild(selectedCount);

            let body = document.createElement("div");
            body.className = "chapterGroupCardBody";

            let chapterList = document.createElement("div");
            chapterList.className = "chapterGroupCardList";
            group.chapters.forEach((chapter) => chapterList.appendChild(this.createChapterGroupBrowserItem(chapter)));
            body.appendChild(chapterList);

            card.appendChild(summary);
            card.appendChild(body);
            browser.appendChild(card);
        });
    }

    createChapterGroupBrowserItem(chapter) {
        let row = chapter.row;
        let label = document.createElement("label");
        label.className = "chapterGroupChapterItem";
        label.title = chapter.sourceUrl;

        let checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "chapterGroupChapterCheckbox";
        checkbox.chapter = chapter;
        checkbox.checked = row != null
            ? ChapterUrlsUI.getRowCheckboxState(row)
            : (chapter.isIncludeable !== false);
        checkbox.disabled = chapter.isSelectable === false;
        checkbox.onclick = (event) => event.stopPropagation();
        checkbox.onchange = (event) => {
            event.stopPropagation();
            if (row != null) {
                ChapterUrlsUI.setRowCheckboxState(row, checkbox.checked);
            } else {
                chapter.isIncludeable = checkbox.checked;
            }
            ChapterUrlsUI.syncChapterGroupBrowserSelection();
        };
        label.appendChild(checkbox);

        let details = document.createElement("span");
        details.className = "chapterGroupChapterText";

        let chapterNumber = ChapterUrlsUI.extractChapterNumber(chapter);
        if (chapterNumber != null) {
            let number = document.createElement("span");
            number.className = "chapterGroupChapterNumber";
            number.textContent = chapterNumber;
            details.appendChild(number);
        }

        let title = document.createElement("span");
        title.className = "chapterGroupChapterTitle";
        title.textContent = ChapterUrlsUI.formatChapterGroupItemTitle(chapter, chapterNumber);
        details.appendChild(title);

        label.appendChild(details);
        return label;
    }

    setCurrentChapterGroup(groupId, shouldOpen) {
        if (util.isNullOrEmpty(groupId)) {
            ChapterUrlsUI.syncChapterGroupBrowserSelection();
            return;
        }

        let select = ChapterUrlsUI.getChapterGroupSelect();
        if ((select != null) && (select.value !== groupId)) {
            select.value = groupId;
        }

        if (shouldOpen) {
            let browser = ChapterUrlsUI.getChapterGroupBrowser();
            let activeCard = browser?.querySelector(`.chapterGroupCard[data-group-id="${groupId}"]`);
            if (activeCard != null) {
                activeCard.open = true;
            }
        }

        ChapterUrlsUI.syncChapterGroupBrowserSelection();
    }

    refreshChapterGroupControls(chapters) {
        let container = document.getElementById("groupPackControls");
        let browserSection = ChapterUrlsUI.getChapterGroupBrowserSection();
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        let select = ChapterUrlsUI.getChapterGroupSelect();
        if ((container == null) || (select == null) || (browserSection == null) || (browser == null)) {
            return;
        }

        let parserGroups = this.parser?.getChapterGroups?.() ?? [];
        this.chapterGroups = (0 < parserGroups.length)
            ? parserGroups
            : util.buildChapterGroups(chapters);
        this.markedChapterGroupIds = new Set(
            [...this.markedChapterGroupIds].filter(groupId => this.chapterGroups.some(group => group.id === groupId))
        );
        let resolvedGroups = this.resolveVisibleChapterGroups(this.chapterGroups);
        let referenceSource = this.parser?.getReferenceChapterGroupSource?.();
        let referenceGroups = this.parser?.getReferenceChapterGroups?.() ?? [];
        let referenceHint = "";
        if (referenceSource != null) {
            if (0 < referenceGroups.length) {
                referenceHint = `Using groups from reference site: ${referenceSource.label}.`;
            } else if ((this.parser?.getNativeChapterGroups?.().length ?? 0) > 0) {
                referenceHint = `The selected reference site (${referenceSource.label}) could not be mapped to the current chapter list. Showing current site groups instead.`;
            }
        }
        this.visibleChapterGroups = resolvedGroups.groups;

        util.removeElements([...select.options]);
        this.visibleChapterGroups.forEach(group => {
            let option = new Option(ChapterUrlsUI.describeGroup(group), group.id);
            option.dataset.search = ChapterUrlsUI.groupSearchText(group);
            select.add(option);
        });

        let showGroupedUi = (ChapterUrlsUI.getChapterGroupingMode() !== "flat")
            && (0 < this.visibleChapterGroups.length);
        container.hidden = !showGroupedUi;
        browserSection.hidden = !showGroupedUi;
        let searchInput = ChapterUrlsUI.getChapterGroupSearchInput();
        if (!showGroupedUi && (searchInput != null)) {
            searchInput.value = "";
        }
        if (searchInput != null) {
            if (this.visibleChapterGroups.length <= 1) {
                searchInput.value = "";
            }
            searchInput.hidden = !showGroupedUi || (this.visibleChapterGroups.length <= 1);
        }
        select.hidden = !showGroupedUi || (this.visibleChapterGroups.length <= 1);
        let hintMessage = [referenceHint, showGroupedUi ? resolvedGroups.hint : ""]
            .filter(message => !util.isNullOrEmpty(message))
            .join(" ");
        this.updateChapterGroupingHint(hintMessage);
        this.updateChapterGroupBrowserHeading();

        if (!showGroupedUi) {
            this.markedChapterGroupIds.clear();
            util.removeElements([...browser.children]);
            this.updateChapterGroupEmptyState(false, "");
            return;
        }

        this.renderChapterGroupBrowser(this.visibleChapterGroups);
        this.filterChapterGroups();
        let selectedGroupId = ChapterUrlsUI.getSelectedChapterGroupId();
        let hasSelectedGroup = this.visibleChapterGroups.some(group => group.id === selectedGroupId);
        if (!hasSelectedGroup && (0 < this.visibleChapterGroups.length)) {
            this.setCurrentChapterGroup(this.visibleChapterGroups[0].id, true);
        } else {
            this.setCurrentChapterGroup(selectedGroupId, false);
        }
        this.syncMarkedChapterGroupsUi();
    }

    filterChapterGroups() {
        let select = ChapterUrlsUI.getChapterGroupSelect();
        if (select == null) {
            return;
        }
        let query = ChapterUrlsUI.getChapterGroupSearchInput()?.value?.trim()?.toLowerCase() ?? "";
        let options = [...select.options];
        options.forEach(option => {
            let haystack = option.dataset.search ?? option.text.toLowerCase();
            option.hidden = (query !== "") && !haystack.includes(query);
        });

        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        let cards = [...(browser?.querySelectorAll(".chapterGroupCard") ?? [])];
        cards.forEach(card => {
            let haystack = card.dataset.search ?? "";
            card.hidden = (query !== "") && !haystack.includes(query);
        });

        let selectedOption = options[select.selectedIndex];
        if ((selectedOption == null) || selectedOption.hidden) {
            let nextVisible = options.find(option => !option.hidden);
            if (nextVisible != null) {
                select.value = nextVisible.value;
            }
        }

        let hasVisibleOption = options.some(option => !option.hidden);
        let visibleOptionCount = options.filter(option => !option.hidden).length;
        ["selectAllChapterGroupsButton", "downloadAllChapterGroupsButton",
            "expandAllChapterGroupsButton", "collapseAllChapterGroupsButton"]
            .forEach((elementId) => {
                let button = document.getElementById(elementId);
                if (button != null) {
                    button.disabled = !hasVisibleOption;
                }
            });
        let markedGroupIds = new Set(this.getMarkedChapterGroupIds());
        let hasVisibleMarkedOption = options.some(option => !option.hidden && markedGroupIds.has(option.value));
        ["clearSelectedChapterGroupsButton", "downloadMarkedChapterGroupsButton"]
            .forEach((elementId) => {
                let button = document.getElementById(elementId);
                if (button != null) {
                    button.disabled = !hasVisibleMarkedOption;
                }
            });
        select.disabled = !hasVisibleOption;
        this.updateChapterGroupBrowserHeading(visibleOptionCount, query);
        this.updateChapterGroupEmptyState(hasVisibleOption, query);
        this.setCurrentChapterGroup(ChapterUrlsUI.getSelectedChapterGroupId(), false);
        this.syncMarkedChapterGroupsUi();
    }

    toggleMarkedChapterGroup(groupId, forceState = null) {
        if (util.isNullOrEmpty(groupId)) {
            return;
        }

        let shouldMark = forceState;
        if (shouldMark == null) {
            shouldMark = !this.markedChapterGroupIds.has(groupId);
        }
        if (shouldMark) {
            this.markedChapterGroupIds.add(groupId);
        } else {
            this.markedChapterGroupIds.delete(groupId);
        }
        this.syncMarkedChapterGroupsUi();
    }

    getMarkedChapterGroupIds() {
        return [...this.markedChapterGroupIds];
    }

    selectAllVisibleChapterGroups() {
        ChapterUrlsUI.getVisibleChapterGroupIds()
            .forEach((groupId) => this.markedChapterGroupIds.add(groupId));
        this.syncMarkedChapterGroupsUi();
    }

    clearVisibleMarkedChapterGroups() {
        ChapterUrlsUI.getVisibleChapterGroupIds()
            .forEach((groupId) => this.markedChapterGroupIds.delete(groupId));
        this.syncMarkedChapterGroupsUi();
    }

    syncMarkedChapterGroupsUi() {
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        let markedIds = new Set(this.getMarkedChapterGroupIds());
        if (browser != null) {
            for (let card of browser.querySelectorAll(".chapterGroupCard")) {
                let isMarked = markedIds.has(card.dataset.groupId);
                card.dataset.marked = isMarked ? "true" : "false";
                card.classList.toggle("chapterGroupCardMarked", isMarked);
                card.classList.toggle("chapterGroupCardUnmarked", !isMarked);
                let markButton = card.querySelector(".chapterGroupMarkButton");
                if (markButton != null) {
                    markButton.dataset.state = isMarked ? "selected" : "unselected";
                    markButton.setAttribute("aria-pressed", isMarked ? "true" : "false");
                    markButton.title = isMarked ? "Selected for batch download" : "Click to select this group";
                }
            }
        }

        let visibleGroupIds = new Set(ChapterUrlsUI.getVisibleChapterGroupIds());
        let visibleGroupCount = visibleGroupIds.size;
        let visibleMarkedCount = this.visibleChapterGroups
            .filter(group => visibleGroupIds.has(group.id) && markedIds.has(group.id))
            .length;
        let selectAllButton = document.getElementById("selectAllChapterGroupsButton");
        if (selectAllButton != null) {
            selectAllButton.disabled = (visibleGroupCount === 0) || (visibleMarkedCount === visibleGroupCount);
            selectAllButton.textContent = visibleGroupCount === 0
                ? "Select all"
                : `Select all (${visibleGroupCount})`;
        }
        let clearSelectedButton = document.getElementById("clearSelectedChapterGroupsButton");
        if (clearSelectedButton != null) {
            clearSelectedButton.disabled = visibleMarkedCount === 0;
            clearSelectedButton.textContent = visibleMarkedCount === 0
                ? "Deselect all"
                : `Deselect all (${visibleMarkedCount})`;
        }
        let downloadMarkedButton = document.getElementById("downloadMarkedChapterGroupsButton");
        if (downloadMarkedButton != null) {
            downloadMarkedButton.disabled = visibleMarkedCount === 0;
            downloadMarkedButton.textContent = visibleMarkedCount === 0
                ? "Download selected"
                : `Download selected (${visibleMarkedCount})`;
        }

        this.updateChapterGroupBrowserHeading();
    }

    static describeGroup(group) {
        return `${group.displayTitle} (${group.count} chapters, ${group.rangeLabel})`;
    }

    static groupSearchText(group) {
        return [
            group.displayTitle,
            group.label,
            group.title,
            group.count,
            group.rangeLabel,
            group.startChapter,
            group.endChapter
        ]
            .filter(value => value != null)
            .join(" ")
            .toLowerCase();
    }

    /** @private */
    copyUrlsToClipboard() {
        let text = this.chaptersToHTML([...this.parser.getPagesToFetch().values()]);
        navigator.clipboard.writeText(text);
    }

    /** @private */
    toggleShowUrlsForChapterRanges() {
        let chapters = [...this.parser.getPagesToFetch().values()];
        this.toggleShowUrlsForChapterRange(ChapterUrlsUI.getRangeStartChapterSelect(), chapters);
        this.toggleShowUrlsForChapterRange(ChapterUrlsUI.getRangeEndChapterSelect(), chapters);
        this.showHideChapterUrlsColumn();
    }
    
    showHideChapterUrlsColumn() {
        let hidden = !document.getElementById("showChapterUrlsCheckbox").checked;
        let table = ChapterUrlsUI.getChapterUrlsTable();
        for (let t of table.querySelectorAll("th:nth-of-type(3), td:nth-of-type(3)")) {
            t.hidden = hidden;
        }
    }

    toggleShowUrlsForChapterRange(select, chapters) {
        
        select.onchange = null;
        let memberForTextOption = ChapterUrlsUI.textToShowInRange();
        for (let o of [...select.querySelectorAll("Option")]) {
            o.text = chapters[o.index][memberForTextOption];
        }
        let selectedIndex = select.selectedIndex;
        select.selectedIndex = selectedIndex;
        select.onchange = ChapterUrlsUI.onRangeChanged;
    }

    /** 
    * @private
    */
    setEditInputMode() {
        this.usingTable = false;
        ChapterUrlsUI.setVisibleUI(this.usingTable);
        let input = ChapterUrlsUI.getEditChaptersUrlsInput();
        input.rows = Math.max(this.parser.getPagesToFetch().size, 20);
        input.value = this.chaptersToHTML([...this.parser.getPagesToFetch().values()]);
    }

    chaptersToHTML(chapters) {
        let doc = util.sanitize("<html><head><title></title><body></body></html>");
        for (let chapter of chapters.filter(c => c.isIncludeable)) {
            doc.body.appendChild(this.makeLink(doc, chapter));
            doc.body.appendChild(doc.createTextNode("\r"));
        }
        return doc.body.innerHTML;
    }

    makeLink(doc, chapter) {
        let link = doc.createElement("a");
        link.href = chapter.sourceUrl;
        link.appendChild(doc.createTextNode(chapter.title));
        return link;
    }

    /** @private */
    static updateRange(startRowIndex, endRowIndex, state) {
        let direction = startRowIndex < endRowIndex ? 1 : -1;
        let linkTable = ChapterUrlsUI.getChapterUrlsTable();
        for (let rowIndex = startRowIndex; rowIndex != endRowIndex; rowIndex += direction) {
            let row = linkTable.rows[rowIndex];
            ChapterUrlsUI.setRowCheckboxState(row, state);
        }
    }

    /** @private */
    static getTargetRow(target) {
        while ((target.tagName.toLowerCase() !== "tr") && (target.parentElement !== null)) {
            target = target.parentElement;
        }
        return target;
    }

    /** @private */
    static tellUserAboutShiftClick(event, row) {
        let userPreferences = main.getUserPreferences();
        if (userPreferences?.disableShiftClickAlert?.value) {
            return;
        }
        if (event.shiftKey || (ChapterUrlsUI.lastSelectedRow === null)) {
            return;
        }
        if (ChapterUrlsUI.ConsecutiveRowClicks == 5) {
            return;
        }
        let distance = Math.abs(row.rowIndex - ChapterUrlsUI.lastSelectedRow);
        if (distance !== 1) {
            ChapterUrlsUI.ConsecutiveRowClicks = 0;
            return;
        }
        ++ChapterUrlsUI.ConsecutiveRowClicks;
        if (ChapterUrlsUI.ConsecutiveRowClicks == 5) {
            alert(UIText.Chapter.shiftClickMessage);
        }
    }

    static isChapterOnlyEnabled() {
        let chapterOnlyCheckbox = document.getElementById("chapterOnlyCheckbox");
        return (chapterOnlyCheckbox != null) && chapterOnlyCheckbox.checked;
    }

    static getSmartSelectInput() {
        return document.getElementById("smartSelectInput");
    }

    static getSmartSelectMode() {
        return document.getElementById("smartSelectMode");
    }

    static getChapterGroupSearchInput() {
        return document.getElementById("chapterGroupSearchInput");
    }

    static getChapterGroupSelect() {
        return document.getElementById("chapterGroupSelect");
    }

    static getSelectedChapterGroupId() {
        return ChapterUrlsUI.getChapterGroupSelect()?.value ?? null;
    }

    static getVisibleChapterGroupIds() {
        let select = ChapterUrlsUI.getChapterGroupSelect();
        if ((select == null) || (ChapterUrlsUI.getChapterGroupBrowserSection()?.hidden === true)) {
            return [];
        }
        return [...select.options]
            .filter(option => !option.hidden)
            .map(option => option.value);
    }

    static getChapterGroupingModeSelect() {
        return document.getElementById("chapterGroupingModeSelect");
    }

    static getChapterGroupingMode() {
        return ChapterUrlsUI.getChapterGroupingModeSelect()?.value ?? "flat";
    }

    static getCollapseChapterGroupsCheckbox() {
        return document.getElementById("collapseChapterGroupsCheckbox");
    }

    static shouldCollapseGroupsByDefault() {
        return ChapterUrlsUI.getCollapseChapterGroupsCheckbox()?.checked !== false;
    }

    static getChapterGroupingHint() {
        return document.getElementById("chapterGroupingHint");
    }

    static getChapterGroupBrowserSection() {
        return document.getElementById("chapterGroupBrowserSection");
    }

    static getChapterGroupBrowser() {
        return document.getElementById("chapterGroupBrowser");
    }

    static getChapterGroupBrowserTitle() {
        return document.getElementById("chapterGroupBrowserTitle");
    }

    static getChapterGroupSummary() {
        return document.getElementById("chapterGroupSummary");
    }

    static getChapterGroupEmptyState() {
        return document.getElementById("chapterGroupEmptyState");
    }

    static isVolumeLikeGroup(group) {
        return ["volume", "book", "tome"].includes(group?.type);
    }

    static syncChapterGroupBrowserSelection() {
        let browser = ChapterUrlsUI.getChapterGroupBrowser();
        if (browser == null) {
            return;
        }

        for (let checkbox of browser.querySelectorAll(".chapterGroupChapterCheckbox")) {
            let chapter = checkbox.chapter;
            if (chapter == null) {
                continue;
            }
            checkbox.disabled = chapter.isSelectable === false;
            checkbox.checked = chapter.row != null
                ? ChapterUrlsUI.getRowCheckboxState(chapter.row)
                : (chapter.isIncludeable !== false);
        }

        let activeGroupId = ChapterUrlsUI.getSelectedChapterGroupId();
        for (let card of browser.querySelectorAll(".chapterGroupCard")) {
            let group = card.chapterGroup;
            if (group == null) {
                continue;
            }
            let selectedCount = group.chapters.filter(chapter => chapter.row != null
                ? ChapterUrlsUI.getRowCheckboxState(chapter.row)
                : (chapter.isIncludeable !== false)
            ).length;
            let counter = card.querySelector(".chapterGroupCardSelectedCount");
            if (counter != null) {
                counter.textContent = `${selectedCount}/${group.count} selected`;
            }
            card.classList.toggle("chapterGroupCardActive", card.dataset.groupId === activeGroupId);
        }
    }

    static createSmartMatcher(query) {
        let normalizedQuery = query
            .toLowerCase()
            .replace(/(\d{1,5})\s*-\s*(\d{1,5})/g, "$1-$2");
        let tokens = normalizedQuery
            .split(/[\s,;]+/)
            .map(token => token.trim())
            .filter(token => token.length > 0);

        let exactNumbers = new Set();
        let numberRanges = [];
        let includeTerms = [];
        let excludeTerms = [];

        for (let token of tokens) {
            let exclude = token.startsWith("-") && (1 < token.length);
            let rawToken = exclude ? token.substring(1) : token;
            if (rawToken.length === 0) {
                continue;
            }
            let rangeMatch = rawToken.match(/^(\d{1,5})-(\d{1,5})$/);
            if (rangeMatch != null) {
                let start = parseInt(rangeMatch[1], 10);
                let end = parseInt(rangeMatch[2], 10);
                let min = Math.min(start, end);
                let max = Math.max(start, end);
                if (exclude) {
                    excludeTerms.push(rawToken);
                } else {
                    numberRanges.push([min, max]);
                }
                continue;
            }
            let exactMatch = rawToken.match(/^\d{1,5}$/);
            if (exactMatch != null) {
                if (exclude) {
                    excludeTerms.push(rawToken);
                } else {
                    exactNumbers.add(parseInt(rawToken, 10));
                }
                continue;
            }
            if (exclude) {
                excludeTerms.push(rawToken);
            } else {
                includeTerms.push(rawToken);
            }
        }

        let hasNumberFilters = (0 < exactNumbers.size) || (0 < numberRanges.length);
        let hasIncludeFilters = 0 < includeTerms.length;

        return (chapter) => {
            let haystack = ((chapter.title || "") + " " + (chapter.sourceUrl || "")).toLowerCase();
            if (excludeTerms.some(term => haystack.includes(term))) {
                return false;
            }

            if (hasIncludeFilters && !includeTerms.every(term => haystack.includes(term))) {
                return false;
            }

            if (!hasNumberFilters) {
                return hasIncludeFilters || (0 < haystack.length);
            }

            let chapterNumber = ChapterUrlsUI.extractChapterNumber(chapter);
            if (chapterNumber == null) {
                return false;
            }
            if (exactNumbers.has(chapterNumber)) {
                return true;
            }
            return numberRanges.some(range => (range[0] <= chapterNumber) && (chapterNumber <= range[1]));
        };
    }

    static extractChapterNumber(chapter) {
        return util.extractChapterNumber(chapter);
    }

    static formatChapterGroupItemTitle(chapter, chapterNumber) {
        let title = chapter?.title ?? "";
        if ((chapterNumber == null) || util.isNullOrEmpty(title)) {
            return title;
        }

        let escapedNumber = String(chapterNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let leadingChapterPattern = new RegExp(
            `^(?:chapter|chapitre|chap|ch|episode|ep|part|pt|book|volume|vol)\\s*#?${escapedNumber}\\b\\s*[:\\-.–—]*\\s*`,
            "i"
        );
        let strippedTitle = title.replace(leadingChapterPattern, "").trim();
        if (!util.isNullOrEmpty(strippedTitle) && (strippedTitle !== title)) {
            return strippedTitle;
        }

        let leadingNumberPattern = new RegExp(`^#?${escapedNumber}\\b\\s*[:\\-.–—]*\\s*`, "i");
        strippedTitle = title.replace(leadingNumberPattern, "").trim();
        if (!util.isNullOrEmpty(strippedTitle) && (strippedTitle !== title)) {
            return strippedTitle;
        }

        return title;
    }

    static isLikelyChapter(chapter) {
        if (chapter == null) {
            return false;
        }
        let lowerTitle = (chapter.title || "").toLowerCase();
        let lowerUrl = (chapter.sourceUrl || "").toLowerCase();

        if (/\/(tag|category|author|news|comments?)\//i.test(lowerUrl)) {
            return false;
        }
        if (/tipeee|patreon|paypal|discord|facebook|twitter|instagram/i.test(lowerUrl + " " + lowerTitle)) {
            return false;
        }
        if (/(annexe|appendix|map|carte|entretien|interview)/i.test(lowerTitle)) {
            return false;
        }
        if (ChapterUrlsUI.extractChapterNumber(chapter) != null) {
            return true;
        }
        return /\b(prologue|epilogue|interlude)\b/i.test(lowerTitle);
    }

    static Filters = {
        filterTermsFrequency: {},
        chapterList: {},
        init() {
            let rc = new ChapterUrlsUI.RangeCalculator();
            var filterTermsFrequency = {};
            let constantTerms = false; // To become a collection of all terms used in every link.
            var chapterList = ChapterUrlsUI.getTableRowsWithChapters().filter(item => rc.rowInRange(item)).map(item => {
                let filterObj = 
                { 
                    row: item, 
                    values: Array.from(item.querySelectorAll("td")).map(item => item.innerText).join("/").split("/"),
                    valueString: ""
                };
                filterObj.values.push(item.querySelector("input[type='text']").value);
                filterObj.values = filterObj.values.filter(item => item.length > 3 && !item.startsWith("http"));
                filterObj.valueString = filterObj.values.join(" ");
                
                let recordFilterTerms = filterObj.valueString.toLowerCase().split(" ");
                recordFilterTerms.forEach(item => {
                    filterTermsFrequency[item] = (parseInt(filterTermsFrequency[item]) || 0) + 1;
                });

                if (!constantTerms)
                {
                    constantTerms = recordFilterTerms;
                }
                else
                {
                    constantTerms.filter(item => recordFilterTerms.indexOf(item) == -1).forEach(item =>{
                        constantTerms.splice(constantTerms.indexOf(item), 1);
                    });
                }

                return filterObj;
            });
            let minFilterTermCount = Math.min( 3, chapterList.length * 0.10 );
            filterTermsFrequency = Object.keys(filterTermsFrequency)
                .filter(key => constantTerms.indexOf(key) == -1 && filterTermsFrequency[key] > minFilterTermCount)
                .map(key => ({ key: key, value: filterTermsFrequency[key] } ));

            var calcValue = (filterTerm) => { return filterTerm.value * filterTerm.key.length; };

            this.filterTermsFrequency = filterTermsFrequency.sort((a, b) => {
                var hasHigherValue = calcValue(a) < calcValue(b);
                var hasEqualValue = calcValue(a) == calcValue(b);
                return hasHigherValue ? 1 : hasEqualValue ? 0 : -1;
            });
            this.chapterList = chapterList;
        },
        Filter() {
            let rc = new ChapterUrlsUI.RangeCalculator();
            let formResults = Object.fromEntries(new FormData(document.getElementById("sbFiltersForm")));
            let formKeys = Object.keys(formResults);
            formResults = formKeys.filter(key => key.indexOf("Hidden") == -1)
                .map(key => {
                    return {
                        key: key,
                        searchType: formResults[key],
                        value: formResults[`${key}Hidden`]
                    };
                });

            let includeChaps = null;
            let excludeChaps = null;
            if (formResults.filter(item => item.searchType == 1).length > 0)
            {
                includeChaps = new RegExp(formResults.filter(item => item.searchType == 1).map(item => item.value).join("|"), "i");
            }
            if (formResults.filter(item => item.searchType == -1).length > 0)
            {
                excludeChaps = new RegExp(formResults.filter(item => item.searchType == -1).map(item => item.value).join("|"), "i");
            }

            ChapterUrlsUI.Filters.chapterList.forEach(item =>{
                let showChapter = rc.rowInRange(item.row);
                if (ChapterUrlsUI.isChapterOnlyEnabled() && !ChapterUrlsUI.isLikelyChapter(item.row.webPage)) {
                    showChapter = false;
                }
                if (includeChaps)
                {
                    showChapter = showChapter && includeChaps.test(item.valueString);
                }
                if (excludeChaps)
                {
                    showChapter = showChapter && !excludeChaps.test(item.valueString);
                }
                ChapterUrlsUI.setRowCheckboxState(item.row, showChapter);
                item.row.hidden = !showChapter;
            });
            document.getElementById("spanChapterCount").textContent = ChapterUrlsUI.Filters.chapterList.filter(item => !item.row.hidden).length;
            ChapterUrlsUI.syncChapterGroupBrowserSelection();
        },
        generateFiltersTable() {
            let retVal = document.createElement("table");
            retVal.className = "chapterFilterTable";

            let onClickEvent = (event) => {
                if (event == undefined || event == null) {
                    return;
                }

                if (event.target.classList.contains("exclude"))
                {
                    event.target.checked = false;
                    event.target.classList.remove("exclude");
                    event.target.value = 1;
                }
                else if (!event.target.indeterminate && !event.target.checked)
                {
                    event.target.value = -1;
                    event.target.checked = true;
                    event.target.indeterminate = true;
                    event.target.classList.add("exclude");
                }

                ChapterUrlsUI.Filters.Filter();
            };

            let row = document.createElement("tr");
            row.className = "chapterFilterRow chapterFilterSearchRow";
            let col = document.createElement("td");
            let checkboxId = "chkFilterText";
            let el = document.createElement("input");
            el.type = "checkbox";
            el.name = checkboxId;
            el.id = checkboxId;
            el.value = 1;
            el.onclick = onClickEvent;
            el.onchange = (event) => {
                if (event == undefined || event == null) {
                    return;
                }
                event.target.parentElement.nextElementSibling.firstChild.disabled = !event.target.checked;
                ChapterUrlsUI.Filters.Filter();
            };
            col.appendChild(el);
            row.appendChild(col);
            col = document.createElement("td");
            el = document.createElement("input");
            el.type = "text";
            el.disabled = true;
            el.id = checkboxId + "Text";
            el.placeholder = "Type text to include or exclude";
            el.onchange = (event) => { event.target.nextElementSibling.value = event.target.value; ChapterUrlsUI.Filters.Filter(); };
            col.appendChild(el);
            el = document.createElement("input");
            el.type = "hidden";
            el.id = checkboxId + "Hidden";
            el.name = checkboxId + "Hidden";
            col.appendChild(el);
            row.appendChild(col);

            retVal.appendChild(row);

            ChapterUrlsUI.Filters.filterTermsFrequency.forEach((value, id) => {
                row = document.createElement("tr");
                row.className = "chapterFilterRow";
                col = document.createElement("td");
                col.setAttribute("width", "10px");
                
                checkboxId = "chkFilter" + id;
                let el = document.createElement("input");
                el.type = "checkbox";
                el.name = checkboxId;
                el.id = checkboxId;
                el.value = 1;
                el.onclick = onClickEvent;
                col.appendChild(el);
                
                el = document.createElement("input");
                el.type = "hidden";
                el.name = checkboxId+"Hidden";
                el.value = RegExp.escape(value.key);
                col.appendChild(el);
                row.appendChild(col);

                col = document.createElement("td");
                el = document.createElement("label");
                el.innerText = value.key;
                el.id = checkboxId + "Label";
                el.setAttribute("for", checkboxId);
                el.setAttribute("width", "100%");
                col.appendChild(el);
                row.appendChild(col);

                retVal.appendChild(row);
            });
            retVal.setAttribute("width", "100%");
            return retVal;
        }
    };
}
ChapterUrlsUI.RangeCalculator = class {
    constructor()
    {
        this.startIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeStartChapterSelect());
        this.endIndex = ChapterUrlsUI.selectionToRowIndex(ChapterUrlsUI.getRangeEndChapterSelect());
    }
    rowInRange(row) {
        let index = row.rowIndex;
        return (this.startIndex <= index) && (index <= this.endIndex);
    }
};



ChapterUrlsUI.DOWNLOAD_STATE_NONE = 0;
ChapterUrlsUI.DOWNLOAD_STATE_DOWNLOADING = 1;
ChapterUrlsUI.DOWNLOAD_STATE_LOADED = 2;
ChapterUrlsUI.DOWNLOAD_STATE_SLEEPING = 3;
ChapterUrlsUI.DOWNLOAD_STATE_PREVIOUS = 4;
ChapterUrlsUI.ImageForState = [
    "images/ChapterStateNone.svg",
    "images/ChapterStateDownloading.svg",
    "images/FileEarmarkCheckFill.svg",
    "images/ChapterStateSleeping.svg",
    "images/FileEarmarkCheck.svg"
];
ChapterUrlsUI.TooltipForSate = [
    null,
    UIText.Chapter.tooltipChapterDownloading,
    UIText.Chapter.tooltipChapterDownloaded,
    UIText.Chapter.tooltipChapterSleeping,
    UIText.Chapter.tooltipChapterPreviouslyDownloaded
];

ChapterUrlsUI.RANGE_SELECT_BUFFER_RESET_MS = 900;
ChapterUrlsUI.lastSelectedRow = null;
ChapterUrlsUI.ConsecutiveRowClicks = 0;
