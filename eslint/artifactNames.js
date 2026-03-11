"use strict";

var fs = require("fs");

var sanitizeArtifactBaseName = function(name) {
    return (name || "Extension").replace(/[^a-z0-9]+/gi, "");
};

var readManifest = function(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
};

var getArtifactBaseName = function(manifest) {
    return sanitizeArtifactBaseName(manifest.name);
};

module.exports = {
    getArtifactBaseName,
    readManifest,
    sanitizeArtifactBaseName,
};
