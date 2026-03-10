
"use strict";

module("Download");

QUnit.test("isFileNameIllegalOnWindows", function (assert) {
    assert.notOk(Download.isFileNameIllegalOnWindows("ValidName.epub"));
    assert.ok(Download.isFileNameIllegalOnWindows("InvalidName<>.epub"));
    assert.ok(Download.isFileNameIllegalOnWindows("InvalidName\".epub"));
});

QUnit.test("toUserFacingError_mapsFileExistsToFriendlyMessage", function (assert) {
    let error = Download.toUserFacingError(new Error("File already exists"));
    assert.equal(
        error.message,
        "A file with this name already exists. Choose another name or enable overwrite."
    );
});

QUnit.test("toUserFacingError_preservesOtherErrors", function (assert) {
    let original = new Error("Network timeout");
    assert.strictEqual(Download.toUserFacingError(original), original);
});
