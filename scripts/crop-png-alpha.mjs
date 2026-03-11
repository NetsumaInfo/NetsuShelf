#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

function printUsage() {
    console.log(
        "Usage: node scripts/crop-png-alpha.mjs <input.png> " +
        "[--output <file>] [--in-place] [--threshold <0-255>] " +
        "[--padding <ratio>] [--size <pixels>]",
    );
}

function parseArgs(argv) {
    if (argv.length === 0) {
        printUsage();
        process.exit(1);
    }

    const options = {
        inputPath: null,
        outputPath: null,
        inPlace: false,
        threshold: 24,
        padding: 0.04,
        size: null,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--output") {
            options.outputPath = argv[i + 1];
            i += 1;
        } else if (arg === "--in-place") {
            options.inPlace = true;
        } else if (arg === "--threshold") {
            options.threshold = Number(argv[i + 1]);
            i += 1;
        } else if (arg === "--padding") {
            options.padding = Number(argv[i + 1]);
            i += 1;
        } else if (arg === "--size") {
            options.size = Number(argv[i + 1]);
            i += 1;
        } else if (arg.startsWith("--")) {
            throw new Error(`Unknown option: ${arg}`);
        } else if (options.inputPath === null) {
            options.inputPath = arg;
        } else {
            throw new Error(`Unexpected argument: ${arg}`);
        }
    }

    if (options.inputPath === null) {
        throw new Error("Missing input PNG path.");
    }
    if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 255) {
        throw new Error("Threshold must be between 0 and 255.");
    }
    if (!Number.isFinite(options.padding) || options.padding < 0 || options.padding > 0.45) {
        throw new Error("Padding ratio must be between 0 and 0.45.");
    }
    if (options.outputPath !== null && options.inPlace) {
        throw new Error("Use either --output or --in-place, not both.");
    }

    return options;
}

function readPng(filePath) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(new PNG())
            .on("parsed", function onParsed() {
                resolve(this);
            })
            .on("error", reject);
    });
}

function writePng(filePath, png) {
    return new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(filePath);
        png.pack().pipe(stream);
        stream.on("finish", resolve);
        stream.on("error", reject);
    });
}

function findAlphaBounds(png, threshold) {
    let minX = png.width;
    let minY = png.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            const alpha = png.data[(png.width * y + x) * 4 + 3];
            if (alpha < threshold) {
                continue;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (maxX < 0) {
        throw new Error("No visible pixels found at the chosen alpha threshold.");
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

function buildSquareCrop(bounds, imageWidth, imageHeight, paddingRatio) {
    const longestSide = Math.max(bounds.width, bounds.height);
    const padding = Math.round(longestSide * paddingRatio);
    let side = longestSide + (padding * 2);
    side = Math.min(side, Math.max(imageWidth, imageHeight));

    let centerX = (bounds.minX + bounds.maxX) / 2;
    let centerY = (bounds.minY + bounds.maxY) / 2;
    let left = Math.round(centerX - (side / 2));
    let top = Math.round(centerY - (side / 2));

    left = Math.max(0, Math.min(left, imageWidth - side));
    top = Math.max(0, Math.min(top, imageHeight - side));

    return {
        left,
        top,
        size: side,
    };
}

function sampleBilinear(png, sourceX, sourceY) {
    const x0 = Math.max(0, Math.min(Math.floor(sourceX), png.width - 1));
    const y0 = Math.max(0, Math.min(Math.floor(sourceY), png.height - 1));
    const x1 = Math.max(0, Math.min(x0 + 1, png.width - 1));
    const y1 = Math.max(0, Math.min(y0 + 1, png.height - 1));
    const tx = sourceX - x0;
    const ty = sourceY - y0;

    const p00 = (y0 * png.width + x0) * 4;
    const p10 = (y0 * png.width + x1) * 4;
    const p01 = (y1 * png.width + x0) * 4;
    const p11 = (y1 * png.width + x1) * 4;

    const out = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
        const top = (png.data[p00 + channel] * (1 - tx)) + (png.data[p10 + channel] * tx);
        const bottom = (png.data[p01 + channel] * (1 - tx)) + (png.data[p11 + channel] * tx);
        out[channel] = Math.round((top * (1 - ty)) + (bottom * ty));
    }
    return out;
}

function cropAndResizeSquare(png, crop, targetSize) {
    const output = new PNG({ width: targetSize, height: targetSize });
    const scale = crop.size / targetSize;

    for (let y = 0; y < targetSize; y += 1) {
        for (let x = 0; x < targetSize; x += 1) {
            const sourceX = crop.left + ((x + 0.5) * scale) - 0.5;
            const sourceY = crop.top + ((y + 0.5) * scale) - 0.5;
            const rgba = sampleBilinear(png, sourceX, sourceY);
            const offset = (y * targetSize + x) * 4;
            output.data[offset + 0] = rgba[0];
            output.data[offset + 1] = rgba[1];
            output.data[offset + 2] = rgba[2];
            output.data[offset + 3] = rgba[3];
        }
    }

    return output;
}

function buildDefaultOutputPath(inputPath) {
    const parsed = path.parse(inputPath);
    return path.join(parsed.dir, `${parsed.name}-cropped${parsed.ext}`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const png = await readPng(options.inputPath);
    const bounds = findAlphaBounds(png, options.threshold);
    const crop = buildSquareCrop(bounds, png.width, png.height, options.padding);
    const targetSize = options.size ?? png.width;
    const output = cropAndResizeSquare(png, crop, targetSize);

    const outputPath = options.inPlace
        ? options.inputPath
        : (options.outputPath ?? buildDefaultOutputPath(options.inputPath));

    await writePng(outputPath, output);

    console.log(JSON.stringify({
        input: options.inputPath,
        output: outputPath,
        threshold: options.threshold,
        padding: options.padding,
        originalSize: [png.width, png.height],
        alphaBounds: bounds,
        cropSquare: crop,
        finalSize: [output.width, output.height],
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
