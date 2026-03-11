"use strict";

class Download {
    constructor() {
    }

    static outputFormat() {
        return document.getElementById("downloadFormatSelect")?.value ?? "epub";
    }

    static extensionForFormat(format) {
        switch ((format ?? "epub").toLowerCase()) {
            case "html":
                return ".html";
            case "pdf":
                return ".pdf";
            case "txt":
                return ".txt";
            case "mobi":
                return ".mobi";
            default:
                return ".epub";
        }
    }

    static stripKnownExtension(fileName) {
        return (fileName ?? "").replace(/\.(epub|html|pdf|txt|mobi)$/i, "");
    }

    static sanitizeFileStem(stem, fallback = "download") {
        let value = (stem ?? "").trim();
        if (value === "") {
            value = fallback;
        }
        value = value
            .replace(/[\\/:*?"<>|]+/g, " - ")
            .replace(/\s+/g, " ")
            .replace(/^\.+|\.+$/g, "")
            .trim();
        return value === "" ? fallback : value;
    }

    static looksLikeOpaqueFileStem(stem) {
        let value = Download.stripKnownExtension(stem).trim();
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
            || /^[0-9a-f]{24,}$/i.test(value);
    }

    static fallbackFileStem(overrides = {}) {
        let candidates = [
            overrides.suggestedFileName,
            overrides.fileName,
            overrides.title,
            overrides.group ? `${document.getElementById("titleInput")?.value ?? ""} - ${overrides.group}` : null,
            document.getElementById("titleInput")?.value ?? null,
            "download"
        ];
        for (let candidate of candidates) {
            if (!util.isNullOrEmpty(candidate)) {
                let stem = Download.sanitizeFileStem(candidate, "download");
                if (!Download.looksLikeOpaqueFileStem(stem)) {
                    return stem;
                }
            }
        }
        return "download";
    }

    static addExtensionForFormat(fileName, format) {
        let extension = Download.extensionForFormat(format);
        let stem = Download.stripKnownExtension(fileName);
        return stem + extension;
    }

    static init() {
        Download.saveOn = util.isFirefox() ? Download.saveOnFirefox : Download.saveOnChrome;
        if (util.isFirefox()) {
            Download.saveOn = Download.saveOnFirefox;
            browser.downloads.onChanged.addListener(Download.onChanged);
        } else {
            Download.saveOn = Download.saveOnChrome;
            chrome.downloads.onChanged.addListener(Download.onChanged);
            let filenameEvent = chrome.downloads?.["onDeterminingFilename"];
            if (typeof filenameEvent?.addListener === "function") {
                filenameEvent.addListener(Download.onDeterminingFilename);
            }
        }
    }

    static isFileNameIllegalOnWindows(fileName) {
        for (let c of Download.illegalWindowsFileNameChars) {
            if (fileName.includes(c)) {
                return true;
            }
        }
        if (fileName.trim() == "") {
            return true;
        }
        return false;
    }

    static buildFileName(overrides = {}) {
        let fallbackStem = Download.fallbackFileStem(overrides);
        if (overrides.preferSuggestedFileName === true) {
            let preferredStem = Download.sanitizeFileStem(
                Download.stripKnownExtension(overrides.suggestedFileName ?? overrides.fileName),
                fallbackStem
            );
            if (!Download.looksLikeOpaqueFileStem(preferredStem)) {
                return Download.addExtensionForFormat(preferredStem, overrides.format ?? Download.outputFormat());
            }
        }

        let CustomFilename = Download.customFilenameTemplate();
        let startingUrl = overrides.startingUrl ?? document.getElementById("startingUrlInput").value;
        let hostname = "";
        try {
            hostname = new URL(startingUrl)?.hostname ?? "";
        } catch (error) {
            hostname = "";
        }
        let ToReplace = {
            "%URL_hostname%": hostname,
            "%Title%": overrides.title ?? document.getElementById("titleInput").value,
            "%Author%": overrides.author ?? document.getElementById("authorInput").value,
            "%Language%": overrides.language ?? document.getElementById("languageInput").value,
            "%Chapters_Count%": overrides.chaptersCount ?? document.getElementById("spanChapterCount").innerHTML,
            "%Chapters_Downloaded%": overrides.chaptersDownloaded ?? (document.getElementById("fetchProgress").value - 1),
            "%Filename%": overrides.fileName ?? document.getElementById("fileNameInput").value,
            "%Group%": overrides.group ?? "",
            "%Group_Title%": overrides.groupTitle ?? "",
            "%Group_Range%": overrides.groupRange ?? ""
        };
        for (const [key, value] of Object.entries(ToReplace)) {
            CustomFilename = CustomFilename.replaceAll(key, value ?? "");
        }
        let stem = Download.sanitizeFileStem(Download.stripKnownExtension(CustomFilename), fallbackStem);
        if (Download.looksLikeOpaqueFileStem(stem)) {
            stem = fallbackStem;
        }
        if (Download.isFileNameIllegalOnWindows(stem)) {
            ErrorLog.showErrorMessage(UIText.Error.errorIllegalFileName(stem, Download.illegalWindowsFileNameChars));
            stem = "IllegalFileName";
        }
        return Download.addExtensionForFormat(stem, overrides.format ?? Download.outputFormat());
    }

    static CustomFilename(overrides = {}) {
        return Download.buildFileName({
            ...overrides,
            format: "epub"
        });
    }

    static customFilenameTemplate() {
        return document.getElementById("CustomFilenameInput")?.value ?? "%Filename%";
    }

    static templateUsesGroupTokens() {
        return /%Group(?:_Title|_Range)?%/i.test(Download.customFilenameTemplate());
    }

    static outputMimeType(format) {
        switch ((format ?? Download.outputFormat()).toLowerCase()) {
            case "html":
                return "text/html";
            case "pdf":
                return "application/pdf";
            case "txt":
                return "text/plain";
            case "mobi":
                return "application/x-mobipocket-ebook";
            default:
                return "application/epub+zip";
        }
    }

    static outputTypeDescription(format) {
        switch ((format ?? Download.outputFormat()).toLowerCase()) {
            case "html":
                return "HTML document";
            case "pdf":
                return "PDF document";
            case "txt":
                return "Text document";
            case "mobi":
                return "MOBI ebook";
            default:
                return "EPUB ebook";
        }
    }

    static normalizeSaveFileName(fileName, format = Download.outputFormat()) {
        return Download.buildFileName({
            preferSuggestedFileName: true,
            suggestedFileName: fileName,
            fileName: fileName,
            title: document.getElementById("titleInput")?.value ?? "download",
            format: format
        });
    }

    static normalizeProvidedFileName(fileName, fallback = "download") {
        let value = (fileName ?? "").trim();
        if (value === "") {
            value = fallback;
        }
        let parts = value.split(".");
        if (parts.length <= 1) {
            return Download.sanitizeFileStem(value, fallback);
        }
        let extension = parts.pop().trim();
        let stem = Download.sanitizeFileStem(parts.join("."), fallback);
        extension = extension.replace(/[\\/:*?"<>|\s]+/g, "").trim();
        return extension === "" ? stem : `${stem}.${extension}`;
    }

    static errorMessage(error) {
        return error?.message ?? String(error ?? "Download failed");
    }

    static toUserFacingError(error) {
        let message = Download.errorMessage(error);
        if (message.includes("File already exists")) {
            return new Error("A file with this name already exists. Choose another name or enable overwrite.");
        }
        return error instanceof Error ? error : new Error(message);
    }

    static canUseSavePicker() {
        // In the extension UI, opening the picker before packing breaks the
        // expected workflow. Always let the browser download flow prompt at
        // the end once the export blob is ready.
        return false;
    }

    static async pickSaveLocation(fileName, format = Download.outputFormat()) {
        let pickerOptions = {
            suggestedName: fileName,
            types: [{
                description: Download.outputTypeDescription(format),
                accept: {
                    [Download.outputMimeType(format)]: [Download.extensionForFormat(format)]
                }
            }]
        };
        try {
            return await window.showSaveFilePicker(pickerOptions);
        } catch (error) {
            if (error?.name === "AbortError") {
                return null;
            }
            throw error;
        }
    }

    static async saveToPickedLocation(blob, fileHandle) {
        if (fileHandle == null) {
            return;
        }
        let writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
    }

    /** write blob to "Downloads" directory */
    static save(blob, fileName, overwriteExisting, backgroundDownload) {
        let format = Download.outputFormat();
        let normalizedFileName = Download.normalizeSaveFileName(fileName, format);
        return Download.savePrepared(blob, normalizedFileName, overwriteExisting, backgroundDownload);
    }

    static saveProvidedFile(blob, fileName, overwriteExisting = false, backgroundDownload = false) {
        let normalizedFileName = Download.normalizeProvidedFileName(fileName);
        return Download.savePrepared(blob, normalizedFileName, overwriteExisting, backgroundDownload);
    }

    static savePrepared(blob, normalizedFileName, overwriteExisting, backgroundDownload) {
        let options = {
            url: URL.createObjectURL(blob),
            saveAs: !backgroundDownload
        };
        if (util.isFirefox()) {
            options.filename = normalizedFileName;
        }
        if (backgroundDownload) {
            options.conflictAction = overwriteExisting ? "overwrite" : "uniquify";
        }
        if (!util.isFirefox()) {
            let pending = { filename: normalizedFileName };
            if (options.conflictAction != null) {
                pending.conflictAction = options.conflictAction;
            }
            Download.pendingSuggestedFileNames.set(options.url, pending);
        }
        let cleanup = () => {
            Download.pendingSuggestedFileNames.delete(options.url);
            URL.revokeObjectURL(options.url);
        };
        return Download.saveOn(options, cleanup);
    }

    static saveOnChrome(options, cleanup) {
        // on Chrome call to download() will resolve when "Save As" dialog OPENS
        // so need to delay return until after file is actually saved
        // Otherwise, we get multiple Save As Dialogs open.
        return new Promise((resolve,reject) => {
            chrome.downloads.download(options, 
                downloadId => Download.downloadCallback(downloadId, cleanup, resolve, reject)
            );
        });
    }

    static downloadCallback(downloadId, cleanup, resolve, reject) {
        if (downloadId === undefined) {
            cleanup();
            reject(Download.toUserFacingError(chrome.runtime.lastError));
        } else {
            Download.onDownloadStarted(downloadId,
                (delta) => {
                    if (delta?.state?.current === "interrupted") {
                        cleanup();
                        let reason = delta?.error?.current ?? "USER_CANCELED";
                        if (reason === "USER_CANCELED") {
                            reject(new DOMException("The user aborted a request.", "AbortError"));
                        } else {
                            reject(new Error(`Download interrupted (${reason}).`));
                        }
                        return;
                    }
                    const tenSeconds = 10 * 1000;
                    setTimeout(cleanup, tenSeconds);
                    resolve();
                }
            );
        }
    }

    static saveOnFirefox(options, cleanup) {
        return browser.runtime.getPlatformInfo().then(platformInfo => {
            if (Download.isAndroid(platformInfo)) {
                Download.saveOnFirefoxForAndroid(options, cleanup);
            } else {
                return browser.downloads.download(options).then(
                    // on Firefox, resolves when "Save As" dialog CLOSES, so no
                    // need to delay past this point.
                    downloadId => Download.onDownloadStarted(downloadId, cleanup)
                );
            }
        }).catch(cleanup);
    }

    static saveOnFirefoxForAndroid(options, cleanup) {
        options.saveAs = false;

        // `browser.downloads.download` isn't implemented in
        // "Firefox for Android" yet, so we starts downloads
        // the same way any normal web page would do it:
        const link = document.createElement("a");
        link.style.display = "hidden";

        link.href = options.url;
        link.download = options.filename;

        document.body.appendChild(link);
        try {
            link.click();
        } finally {
            document.body.removeChild(link);
        }
        cleanup();
    }

    static isAndroid(platformInfo) {
        return platformInfo.os.toLowerCase().includes("android");
    }

    static onDeterminingFilename(downloadItem, suggest) {
        let pending = Download.pendingSuggestedFileNames.get(downloadItem.url);
        if (pending != null) {
            let suggestion = { filename: pending.filename };
            if (pending.conflictAction != null) {
                suggestion.conflictAction = pending.conflictAction;
            }
            suggest(suggestion);
            return;
        }
        suggest();
    }

    static onChanged(delta) {
        if ((delta.state != null)
            && ((delta.state.current === "complete") || (delta.state.current === "interrupted"))) {
            let action = Download.toCleanup.get(delta.id);
            if (action != null) {
                Download.toCleanup.delete(delta.id);
                action(delta);
            }
        }
    }

    static onDownloadStarted(downloadId, action) {
        if (downloadId === undefined) {
            action();
        } else {
            Download.toCleanup.set(downloadId, action);
        }
    }
}

Download.toCleanup = new Map();
Download.pendingSuggestedFileNames = new Map();
Download.illegalWindowsFileNameChars = "~/?<>\\:*|\"";
Download.init();
