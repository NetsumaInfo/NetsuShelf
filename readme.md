# NetsuShelf

NetsuShelf is a browser extension for [Chrome](https://chromewebstore.google.com/detail/bhnlehpkdcmjmekehjdpcdclggmogidc?utm_source=item-share-cb) and [Firefox](https://addons.mozilla.org/fr/firefox/addon/netsushelf/) that converts supported web novels and story pages into offline reading files.

It is a maintained fork of WebToEpub, with NetsuShelf-specific packaging, branding, UI updates, and store submission work.

## Features

- Export supported stories to `EPUB`, `HTML`, `PDF`, or `TXT`
- Detect title, author, cover, and chapter list from supported pages
- Choose a chapter range before export
- Type chapter numbers directly in the chapter range inputs
- Edit metadata such as title, author, language, filename, and cover image
- Keep optional local library entries in browser storage for later updates
- Work across many supported sites through built-in site parsers and the default parser

## Installation

### Chrome

1. Download the latest `NetsuShelf.chrome.*.zip` asset from [GitHub Releases](https://github.com/NetsumaInfo/NetsuShelf/releases).
2. Extract the archive.
3. Open `chrome://extensions/`.
4. Enable `Developer mode`.
5. Click `Load unpacked` and select the extracted `plugin/` directory.

### Firefox

1. Download the latest `NetsuShelf.firefox.*.zip` asset from [GitHub Releases](https://github.com/NetsumaInfo/NetsuShelf/releases).
2. Rename the file to `.xpi` if you want to install it directly as an add-on package.
3. Open `about:debugging#/runtime/this-firefox` for temporary loading, or install the packaged add-on through Firefox if you are distributing a signed build.

### From source

```bash
npm install
npm run lint
```

Packaged outputs are written by the build tooling into `eslint/`.

## Usage

NetsuShelf works best when opened on a supported series page, table of contents page, or any story page that exposes the chapter list.

1. Open a supported story page.
2. Click the NetsuShelf extension icon.
3. Wait for NetsuShelf to analyze the page and load metadata and chapters.
4. Check the detected title, author, cover, and chapter list.
5. Choose the first and last chapter you want.
6. If useful, type chapter numbers directly into the `No.` inputs.
7. Choose the output format and click the export button.

On some sites, starting from the first chapter also works when the parser can discover the remaining chapters from there.

## Supported sites

NetsuShelf includes a large parser set inherited from WebToEpub and extended in this fork.

Examples of commonly used supported sites include:

- Royal Road
- Archive of Our Own
- FanFiction.net
- WuxiaWorld
- Baka-Tsuki
- Webnovel

The repository contains many additional site-specific parsers under `plugin/js/parsers/`.

## Development

### Requirements

- Node.js
- npm

### Common commands

```bash
npm install
npm run lint
npm test
```

### Project structure

- `plugin/`: extension source
- `plugin/js/parsers/`: site parsers
- `eslint/`: packaging and release scripts
- `unitTest/`: browser-based tests
- `doc/`: store assets and project documentation

## Releases

Current release assets follow this naming scheme:

- `NetsuShelf.chrome.<version>.zip`
- `NetsuShelf.firefox.<version>.zip`

Releases are published at:

- https://github.com/NetsumaInfo/NetsuShelf/releases

## Privacy

Privacy policy:

- [PRIVACY.md](PRIVACY.md)

## Credits

NetsuShelf is based on the upstream project WebToEpub:

- https://github.com/dteviot/WebToEpub

## License

Licensed under GPLv3. See [LICENSE.md](LICENSE.md).
