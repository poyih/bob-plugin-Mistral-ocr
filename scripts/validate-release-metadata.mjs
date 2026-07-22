#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_FILES = ["info.json", "main.js"];
const VALID_OPTIONS = new Set(["--check-assets", "--check-tags", "--help"]);
const args = new Set(process.argv.slice(2));
const unknownOptions = [...args].filter((arg) => !VALID_OPTIONS.has(arg));

if (args.has("--help")) {
    console.log(`Usage: node scripts/validate-release-metadata.mjs [options]

Options:
  --check-assets  Download every referenced release asset and verify its SHA-256
                  and packaged info.json metadata.
  --check-tags    Also compare packaged info.json/main.js with their Git tags.
                  This implies --check-assets and requires a clone with all tags.
  --help          Show this help.`);
    process.exit(0);
}

if (unknownOptions.length > 0) {
    console.error(`Unknown option(s): ${unknownOptions.join(", ")}`);
    process.exit(2);
}

const checkTags = args.has("--check-tags");
const checkAssets = args.has("--check-assets") || checkTags;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function fail(location, message) {
    errors.push(`${location}: ${message}`);
}

function warn(location, message) {
    warnings.push(`${location}: ${message}`);
}

async function loadJson(relativePath) {
    const absolutePath = join(repositoryRoot, relativePath);

    try {
        return JSON.parse(await readFile(absolutePath, "utf8"));
    } catch (error) {
        fail(relativePath, `cannot parse JSON (${error.message})`);
        return null;
    }
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, location) {
    if (typeof value !== "string" || value.trim().length === 0) {
        fail(location, "must be a non-empty string");
        return false;
    }

    return true;
}

function parseVersion(version, location) {
    if (typeof version !== "string") {
        fail(location, "must be a semantic version string");
        return null;
    }

    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        fail(location, `unsupported version format ${JSON.stringify(version)}`);
        return null;
    }

    return match.slice(1).map(Number);
}

function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }

    return 0;
}

function sameStringSet(left, right) {
    if (left.size !== right.size) return false;
    return [...left].every((value) => right.has(value));
}

function sameStringMultiset(left, right) {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function formatStringSet(values) {
    return `[${[...values].sort().join(", ")}]`;
}

function run(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, {
        cwd: repositoryRoot,
        encoding: null,
        maxBuffer: 10 * 1024 * 1024,
        ...options
    });

    return result;
}

function commandError(result) {
    if (result.error) return result.error.message;
    const stderr = result.stderr ? result.stderr.toString("utf8").trim() : "";
    return stderr || `command exited with status ${result.status}`;
}

function validateReleaseRecord(release, location, repositoryUrl, options = {}) {
    if (!isObject(release)) {
        fail(location, "must be an object");
        return;
    }

    const versionIsValid = parseVersion(release.version, `${location}.version`) !== null;
    requireNonEmptyString(release.sha256, `${location}.sha256`);
    requireNonEmptyString(release.url, `${location}.url`);
    parseVersion(release.minBobVersion, `${location}.minBobVersion`);

    if (typeof release.sha256 === "string" && !/^[a-f0-9]{64}$/.test(release.sha256)) {
        fail(`${location}.sha256`, "must be a lowercase 64-character SHA-256 digest");
    }

    if (versionIsValid && typeof release.url === "string") {
        const expectedUrl = `${repositoryUrl}/releases/download/v${release.version}/Mistral-OCR.bobplugin`;
        if (release.url !== expectedUrl) {
            fail(`${location}.url`, `must equal ${expectedUrl}`);
        }
    }

    if (options.appcastEntry) {
        requireNonEmptyString(release.desc, `${location}.desc`);

        if (!Number.isSafeInteger(release.timestamp) || release.timestamp < 1_000_000_000_000 || release.timestamp >= 10_000_000_000_000) {
            fail(`${location}.timestamp`, "must be a 13-digit Unix timestamp in milliseconds");
        }
    }

    if (options.identifier !== undefined && release.identifier !== options.identifier) {
        fail(`${location}.identifier`, `must equal ${JSON.stringify(options.identifier)}`);
    }
}

const [info, appcast, provenance] = await Promise.all([
    loadJson("info.json"),
    loadJson("appcast.json"),
    loadJson("release-provenance.json")
]);

if (!info || !appcast || !provenance) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exit(1);
}

requireNonEmptyString(info.identifier, "info.json.identifier");
const sourceVersion = parseVersion(info.version, "info.json.version");
parseVersion(info.minBobVersion, "info.json.minBobVersion");
requireNonEmptyString(info.homepage, "info.json.homepage");
requireNonEmptyString(info.appcast, "info.json.appcast");

const repositoryUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
if (typeof info.homepage === "string" && !repositoryUrlPattern.test(info.homepage)) {
    fail("info.json.homepage", "must be a canonical HTTPS GitHub repository URL without a trailing slash");
}

const expectedAppcastUrl = typeof info.homepage === "string"
    ? info.homepage.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/main/appcast.json"
    : "";
if (info.appcast !== expectedAppcastUrl) {
    fail("info.json.appcast", `must equal ${expectedAppcastUrl}`);
}

if (!isObject(appcast)) {
    fail("appcast.json", "must contain an object");
}
if (appcast.identifier !== info.identifier) {
    fail("appcast.json.identifier", "must match info.json.identifier");
}

const appcastVersions = Array.isArray(appcast.versions) ? appcast.versions : [];
if (!Array.isArray(appcast.versions) || appcastVersions.length === 0) {
    fail("appcast.json.versions", "must be a non-empty array");
}

const appcastByVersion = new Map();
let previousVersion = null;
let previousTimestamp = Number.POSITIVE_INFINITY;

for (const [index, release] of appcastVersions.entries()) {
    const location = `appcast.json.versions[${index}]`;
    validateReleaseRecord(release, location, info.homepage, { appcastEntry: true });

    if (!isObject(release) || typeof release.version !== "string") continue;

    if (appcastByVersion.has(release.version)) {
        fail(`${location}.version`, `duplicates version ${release.version}`);
    } else {
        appcastByVersion.set(release.version, release);
    }

    const parsedVersion = parseVersion(release.version, `${location}.version`);
    if (parsedVersion && previousVersion && compareVersions(previousVersion, parsedVersion) <= 0) {
        fail(`${location}.version`, "versions must be strictly descending");
    }
    if (parsedVersion) previousVersion = parsedVersion;

    if (Number.isSafeInteger(release.timestamp) && release.timestamp > previousTimestamp) {
        fail(`${location}.timestamp`, "timestamps must be non-increasing with version order");
    }
    if (Number.isSafeInteger(release.timestamp)) previousTimestamp = release.timestamp;
}

const newestRelease = appcastVersions[0];
if (isObject(newestRelease)) {
    const publishedVersion = parseVersion(newestRelease.version, "appcast.json.versions[0].version");
    const sourceVsPublished = sourceVersion && publishedVersion
        ? compareVersions(sourceVersion, publishedVersion)
        : 0;

    if (sourceVsPublished < 0) {
        fail("info.json.version", `cannot be older than the latest published version ${newestRelease.version}`);
    } else if (sourceVsPublished > 0) {
        warn("info.json.version", `${info.version} is an unreleased development version; appcast latest remains ${newestRelease.version}`);
    } else if (newestRelease.minBobVersion !== info.minBobVersion) {
        fail("appcast.json.versions[0].minBobVersion", "must match info.json.minBobVersion");
    }
}

if (!isObject(provenance) || provenance.schemaVersion !== 1) {
    fail("release-provenance.json.schemaVersion", "must equal 1");
}
requireNonEmptyString(provenance.canonicalArtifactPolicy, "release-provenance.json.canonicalArtifactPolicy");

const legacyIdentifier = isObject(provenance.legacyIdentifier) ? provenance.legacyIdentifier : {};
requireNonEmptyString(legacyIdentifier.identifier, "release-provenance.json.legacyIdentifier.identifier");
requireNonEmptyString(legacyIdentifier.migration, "release-provenance.json.legacyIdentifier.migration");
requireNonEmptyString(legacyIdentifier.reason, "release-provenance.json.legacyIdentifier.reason");
if (legacyIdentifier.identifier === info.identifier) {
    fail("release-provenance.json.legacyIdentifier.identifier", "must differ from the current identifier");
}

const affectedLegacyVersions = Array.isArray(legacyIdentifier.affectedVersions)
    ? legacyIdentifier.affectedVersions
    : [];
if (!Array.isArray(legacyIdentifier.affectedVersions) || affectedLegacyVersions.length === 0) {
    fail("release-provenance.json.legacyIdentifier.affectedVersions", "must be a non-empty array");
}

const retiredReleases = Array.isArray(provenance.retiredReleasedVersions)
    ? provenance.retiredReleasedVersions
    : [];
if (!Array.isArray(provenance.retiredReleasedVersions)) {
    fail("release-provenance.json.retiredReleasedVersions", "must be an array");
}

const retiredByVersion = new Map();
for (const [index, release] of retiredReleases.entries()) {
    const location = `release-provenance.json.retiredReleasedVersions[${index}]`;
    validateReleaseRecord(release, location, info.homepage, { identifier: legacyIdentifier.identifier });
    requireNonEmptyString(release?.reason, `${location}.reason`);

    if (!isObject(release) || typeof release.version !== "string") continue;
    if (retiredByVersion.has(release.version)) {
        fail(`${location}.version`, `duplicates retired version ${release.version}`);
    } else {
        retiredByVersion.set(release.version, release);
    }
    if (appcastByVersion.has(release.version)) {
        fail(`${location}.version`, "legacy-identifier releases must not appear in the current appcast");
    }
}

const affectedLegacySet = new Set(affectedLegacyVersions);
const retiredVersionSet = new Set(retiredByVersion.keys());
if (!sameStringSet(affectedLegacySet, retiredVersionSet)) {
    fail(
        "release-provenance.json.legacyIdentifier.affectedVersions",
        `must exactly match retired released versions ${formatStringSet(retiredVersionSet)}`
    );
}

const unpublishedVersions = Array.isArray(provenance.unpublishedVersions)
    ? provenance.unpublishedVersions
    : [];
if (!Array.isArray(provenance.unpublishedVersions)) {
    fail("release-provenance.json.unpublishedVersions", "must be an array");
}

const unpublishedSet = new Set();
for (const [index, entry] of unpublishedVersions.entries()) {
    const location = `release-provenance.json.unpublishedVersions[${index}]`;
    if (!isObject(entry)) {
        fail(location, "must be an object");
        continue;
    }

    parseVersion(entry.version, `${location}.version`);
    requireNonEmptyString(entry.reason, `${location}.reason`);
    if (unpublishedSet.has(entry.version)) fail(`${location}.version`, `duplicates ${entry.version}`);
    unpublishedSet.add(entry.version);
    if (appcastByVersion.has(entry.version)) {
        fail(`${location}.version`, "an unpublished version must not appear in appcast.json");
    }
    if (retiredByVersion.has(entry.version)) {
        fail(`${location}.version`, "an unpublished version cannot also be a retired release");
    }
}

const tagExceptions = Array.isArray(provenance.tagContentExceptions)
    ? provenance.tagContentExceptions
    : [];
if (!Array.isArray(provenance.tagContentExceptions)) {
    fail("release-provenance.json.tagContentExceptions", "must be an array");
}

const tagExceptionByVersion = new Map();
for (const [index, exception] of tagExceptions.entries()) {
    const location = `release-provenance.json.tagContentExceptions[${index}]`;
    if (!isObject(exception)) {
        fail(location, "must be an object");
        continue;
    }

    parseVersion(exception.version, `${location}.version`);
    requireNonEmptyString(exception.reason, `${location}.reason`);
    const differingFiles = Array.isArray(exception.differingFiles) ? exception.differingFiles : [];
    if (!Array.isArray(exception.differingFiles) || differingFiles.length === 0) {
        fail(`${location}.differingFiles`, "must be a non-empty array");
    }
    for (const file of differingFiles) {
        if (!PACKAGE_FILES.includes(file)) {
            fail(`${location}.differingFiles`, `${JSON.stringify(file)} is not a package source file`);
        }
    }
    if (new Set(differingFiles).size !== differingFiles.length) {
        fail(`${location}.differingFiles`, "must not contain duplicates");
    }
    if (!appcastByVersion.has(exception.version) && !retiredByVersion.has(exception.version)) {
        fail(`${location}.version`, "must reference an appcast or retired release");
    }
    if (tagExceptionByVersion.has(exception.version)) {
        fail(`${location}.version`, `duplicates exception for ${exception.version}`);
    } else {
        tagExceptionByVersion.set(exception.version, exception);
    }
}

const allReleases = [
    ...appcastVersions.map((release) => ({ ...release, identifier: info.identifier, channel: "current" })),
    ...retiredReleases.map((release) => ({ ...release, channel: "retired" }))
];
const artifactByVersion = new Map();

async function fetchWithTimeout(url, timeoutMs = 30_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            headers: { "User-Agent": "bob-plugin-mistral-ocr-metadata-validator" },
            redirect: "follow",
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

if (checkAssets && errors.length === 0) {
    const unzipProbe = run("unzip", ["-v"]);
    if (unzipProbe.status !== 0) {
        fail("--check-assets", `unzip is required (${commandError(unzipProbe)})`);
    } else {
        const downloadDirectory = await mkdtemp(join(tmpdir(), "mistral-ocr-release-check-"));

        try {
            for (const release of allReleases) {
                const location = `release v${release.version}`;
                process.stdout.write(`Checking ${location} asset... `);

                try {
                    const response = await fetchWithTimeout(release.url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    }

                    const archive = Buffer.from(await response.arrayBuffer());
                    const digest = createHash("sha256").update(archive).digest("hex");
                    if (digest !== release.sha256) {
                        fail(location, `SHA-256 mismatch: expected ${release.sha256}, got ${digest}`);
                    }

                    const archivePath = join(downloadDirectory, `${release.version}.bobplugin`);
                    await writeFile(archivePath, archive);
                    const files = new Map();

                    // List the complete central directory before extraction. `unzip -p <name>`
                    // concatenates duplicate entries, so extracting only expected names would
                    // otherwise miss extra files and duplicate info.json/main.js entries.
                    const listing = run("unzip", ["-Z1", archivePath]);
                    let archiveLayoutIsExact = false;
                    if (listing.status !== 0) {
                        fail(location, `cannot list archive entries (${commandError(listing)})`);
                    } else {
                        let listingText = listing.stdout.toString("utf8");
                        if (listingText.endsWith("\n")) listingText = listingText.slice(0, -1);
                        const archiveEntries = listingText ? listingText.split("\n") : [];
                        archiveLayoutIsExact = sameStringMultiset(archiveEntries, PACKAGE_FILES);
                        if (!archiveLayoutIsExact) {
                            fail(
                                location,
                                `archive must contain exactly ${formatStringSet(new Set(PACKAGE_FILES))}; found ${archiveEntries.length} entry or entries (extra, missing, and duplicate entries are forbidden)`
                            );
                        }
                    }

                    if (archiveLayoutIsExact) {
                        for (const file of PACKAGE_FILES) {
                            const extracted = run("unzip", ["-p", archivePath, file]);
                            if (extracted.status !== 0) {
                                fail(location, `cannot extract ${file} (${commandError(extracted)})`);
                                continue;
                            }
                            files.set(file, extracted.stdout);
                        }
                    }

                    const packagedInfoBuffer = files.get("info.json");
                    if (packagedInfoBuffer) {
                        try {
                            const packagedInfo = JSON.parse(packagedInfoBuffer.toString("utf8"));
                            if (packagedInfo.identifier !== release.identifier) {
                                fail(location, `packaged identifier ${JSON.stringify(packagedInfo.identifier)} does not match ${JSON.stringify(release.identifier)}`);
                            }
                            if (packagedInfo.version !== release.version) {
                                fail(location, `packaged version ${JSON.stringify(packagedInfo.version)} does not match ${release.version}`);
                            }
                            if (packagedInfo.minBobVersion !== release.minBobVersion) {
                                fail(location, `packaged minBobVersion ${JSON.stringify(packagedInfo.minBobVersion)} does not match ${release.minBobVersion}`);
                            }
                        } catch (error) {
                            fail(location, `packaged info.json is invalid (${error.message})`);
                        }
                    }

                    artifactByVersion.set(release.version, { archive, files });
                    console.log("ok");
                } catch (error) {
                    fail(location, `cannot verify asset (${error.message})`);
                    console.log("failed");
                }
            }
        } finally {
            await rm(downloadDirectory, { recursive: true, force: true });
        }
    }
}

if (checkTags && errors.length === 0) {
    for (const release of allReleases) {
        const location = `tag v${release.version}`;
        const tagReference = `refs/tags/v${release.version}^{commit}`;
        const tagProbe = run("git", ["rev-parse", "--verify", "--quiet", tagReference]);
        if (tagProbe.status !== 0) {
            fail(location, "tag is unavailable; fetch all tags before using --check-tags");
            continue;
        }

        const artifact = artifactByVersion.get(release.version);
        if (!artifact) {
            fail(location, "release artifact was not available for comparison");
            continue;
        }

        const actualDifferences = new Set();
        for (const file of PACKAGE_FILES) {
            const taggedFile = run("git", ["show", `refs/tags/v${release.version}:${file}`]);
            if (taggedFile.status !== 0) {
                fail(location, `cannot read ${file} from tag (${commandError(taggedFile)})`);
                continue;
            }

            const packagedFile = artifact.files.get(file);
            if (packagedFile && !packagedFile.equals(taggedFile.stdout)) {
                actualDifferences.add(file);
            }
        }

        const exception = tagExceptionByVersion.get(release.version);
        const expectedDifferences = new Set(exception?.differingFiles ?? []);
        if (!sameStringSet(actualDifferences, expectedDifferences)) {
            fail(
                location,
                `package/tag differences ${formatStringSet(actualDifferences)} do not match the declared exception ${formatStringSet(expectedDifferences)}`
            );
        } else if (actualDifferences.size > 0) {
            warn(location, `known immutable historical difference ${formatStringSet(actualDifferences)}: ${exception.reason}`);
        }
    }
}

for (const warning of warnings) console.log(`WARN  ${warning}`);

if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    console.error(`Release metadata validation failed with ${errors.length} error(s).`);
    process.exit(1);
}

const modes = ["metadata"];
if (checkAssets) modes.push("assets");
if (checkTags) modes.push("tags");
console.log(`Release metadata validation passed (${modes.join(" + ")}; ${appcastVersions.length} current, ${retiredReleases.length} retired release(s)).`);
