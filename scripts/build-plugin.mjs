import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARCHIVE = resolve(ROOT, "dist", "Mistral-OCR.bobplugin");
const INCLUDED_FILES = ["info.json", "main.js"];
const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, the earliest representable ZIP date.

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(name, data) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // Stored, with no compressor-specific variance.
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, data]);
}

function centralHeader(name, data, localOffset) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4); // ZIP 2.0, created on Unix.
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, nameBytes]);
}

function endOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(fileCount, 8);
  record.writeUInt16LE(fileCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function createArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const local = localHeader(entry.name, entry.data);
    localParts.push(local);
    centralParts.push(centralHeader(entry.name, entry.data, localOffset));
    localOffset += local.length;
  }

  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    endOfCentralDirectory(entries.length, central.length, localOffset),
  ]);
}

function failArchive(message) {
  throw new Error(`Archive validation failed: ${message}`);
}

function validateArchive(archive, expectedEntries) {
  if (archive.length < 22 || archive.readUInt32LE(archive.length - 22) !== 0x06054b50) {
    failArchive("missing end-of-central-directory record");
  }

  const endOffset = archive.length - 22;
  const fileCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (archive.readUInt16LE(endOffset + 20) !== 0) failArchive("archive comments are not allowed");
  if (fileCount !== expectedEntries.length) failArchive(`expected ${expectedEntries.length} files, found ${fileCount}`);
  if (centralOffset + centralSize !== endOffset) failArchive("central directory has an invalid range");

  const actualEntries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < fileCount; index += 1) {
    if (cursor + 46 > endOffset || archive.readUInt32LE(cursor) !== 0x02014b50) {
      failArchive("invalid central directory entry");
    }

    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > endOffset) failArchive("truncated central directory entry");

    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (actualEntries.has(name)) failArchive(`duplicate entry ${name}`);
    if (method !== 0 || compressedSize !== uncompressedSize) failArchive(`${name} must be stored without compression`);

    if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) {
      failArchive(`invalid local header for ${name}`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localName = archive.subarray(localNameStart, localNameStart + localNameLength).toString("utf8");
    if (localName !== name) failArchive(`local and central names differ for ${name}`);
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) failArchive(`truncated data for ${name}`);
    const data = archive.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) failArchive(`CRC mismatch for ${name}`);
    actualEntries.set(name, data);
    cursor = entryEnd;
  }
  if (cursor !== endOffset) failArchive("unexpected bytes in central directory");

  const allowedNames = expectedEntries.map((entry) => entry.name);
  if (allowedNames.some((name, index) => name !== INCLUDED_FILES[index])) {
    failArchive("internal file allowlist is not stable");
  }
  for (const expected of expectedEntries) {
    const actual = actualEntries.get(expected.name);
    if (!actual) failArchive(`missing ${expected.name}`);
    if (!actual.equals(expected.data)) failArchive(`${expected.name} does not match the workspace source`);
  }
}

async function loadEntries() {
  const entries = [];
  for (const name of INCLUDED_FILES) {
    entries.push({ name, data: await readFile(resolve(ROOT, name)) });
  }

  const metadata = JSON.parse(entries.find((entry) => entry.name === "info.json").data.toString("utf8"));
  if (!metadata.identifier || !metadata.version || metadata.category !== "ocr") {
    throw new Error("info.json is missing required OCR plugin metadata");
  }
  new vm.Script(entries.find((entry) => entry.name === "main.js").data.toString("utf8"), {
    filename: "main.js",
  });
  return entries;
}

function parseArguments(argv) {
  if (argv.length === 0) return { mode: "build", archivePath: DEFAULT_ARCHIVE };
  if (argv[0] === "--check" && argv.length <= 2) {
    return { mode: "check", archivePath: resolve(ROOT, argv[1] || "dist/Mistral-OCR.bobplugin") };
  }
  throw new Error("Usage: node scripts/build-plugin.mjs [--check [archive-path]]");
}

const { mode, archivePath } = parseArguments(process.argv.slice(2));
const entries = await loadEntries();
const expectedArchive = createArchive(entries);

if (mode === "check") {
  const archive = await readFile(archivePath);
  validateArchive(archive, entries);
  if (!archive.equals(expectedArchive)) failArchive("archive bytes are not reproducible");
  console.log(`Verified ${archivePath}: ${INCLUDED_FILES.join(", ")}`);
} else {
  validateArchive(expectedArchive, entries);
  await mkdir(dirname(archivePath), { recursive: true });
  const temporaryPath = `${archivePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, expectedArchive, { mode: 0o644 });
    await rename(temporaryPath, archivePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  const sha256 = createHash("sha256").update(expectedArchive).digest("hex");
  console.log(`Built ${archivePath} (${INCLUDED_FILES.join(", ")}, sha256 ${sha256})`);
}
