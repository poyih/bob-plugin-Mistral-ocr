var items = [
    ['auto', 'auto'],
    ['zh-Hans', 'zh-Hans'],
    ['zh-Hant', 'zh-Hant'],
    ['yue', 'yue'],
    ['wyw', 'wyw'],
    ['en', 'en'],
    ['ja', 'ja'],
    ['ko', 'ko'],
    ['fr', 'fr'],
    ['de', 'de'],
    ['es', 'es'],
    ['it', 'it'],
    ['pt', 'pt'],
    ['pt-br', 'pt-br'],
    ['pt-pt', 'pt-pt'],
    ['ru', 'ru'],
    ['ar', 'ar'],
    ['nl', 'nl'],
    ['pl', 'pl'],
    ['th', 'th'],
    ['vi', 'vi'],
    ['tr', 'tr'],
    ['id', 'id'],
    ['hi', 'hi'],
    ['he', 'he'],
    ['el', 'el'],
    ['uk', 'uk'],
    ['cs', 'cs'],
    ['sv', 'sv'],
    ['da', 'da'],
    ['fi', 'fi'],
    ['no', 'no'],
    ['ro', 'ro'],
    ['hu', 'hu'],
];

// Mistral OCR 控制台（用于 API Key 排障链接）
var MISTRAL_CONSOLE_URL = "https://console.mistral.ai/api-keys";

var langMap = new Map(items);
var langMapReverse = new Map(items.map(([standardLang, lang]) => [lang, standardLang]));

function supportLanguages() {
    return items.map(([standardLang, lang]) => standardLang);
}

// 延长 Bob 调用插件的等待时间，避免大图 / 多页文档在默认 60s 内未返回被中断
function pluginTimeoutInterval() {
    return 90;
}

// 从 base64 开头解码少量字节。避免完整解码大图，只用于检查魔术字节。
function decodeBase64Prefix(base64, maxBytes) {
    if (typeof base64 !== "string") return [];

    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var bytes = [];
    var buffer = 0;
    var bits = 0;

    for (var i = 0; i < base64.length && bytes.length < maxBytes; i++) {
        var character = base64.charAt(i);
        if (/\s/.test(character)) continue;
        if (character === "=") break;

        var value = alphabet.indexOf(character);
        if (value < 0) return [];

        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
            buffer = buffer & ((1 << bits) - 1);
        }
    }

    return bytes;
}

function bytesEqual(bytes, offset, expected) {
    if (bytes.length < offset + expected.length) return false;
    for (var i = 0; i < expected.length; i++) {
        if (bytes[offset + i] !== expected[i]) return false;
    }
    return true;
}

function bytesToAscii(bytes, offset, length) {
    if (bytes.length < offset + length) return "";
    var value = "";
    for (var i = offset; i < offset + length; i++) {
        value += String.fromCharCode(bytes[i]);
    }
    return value;
}

function readUint32BigEndian(bytes, offset) {
    if (bytes.length < offset + 4) return null;
    return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

// 检测 Mistral OCR 支持的常见图片格式。未知格式返回 null，禁止伪装成 PNG 上传。
function detectMimeType(base64) {
    var bytes = decodeBase64Prefix(base64, 64);

    if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

    var gifHeader = bytesToAscii(bytes, 0, 6);
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";

    if (bytesToAscii(bytes, 0, 4) === "RIFF" && bytesToAscii(bytes, 8, 4) === "WEBP") {
        return "image/webp";
    }

    if (bytesEqual(bytes, 0, [0x42, 0x4d])) return "image/bmp";
    if (bytesEqual(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || bytesEqual(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
        return "image/tiff";
    }

    // AVIF / HEIC / HEIF 使用 ISO BMFF 容器。扫描全部品牌后按更具体的格式优先返回。
    if (bytesToAscii(bytes, 4, 4) === "ftyp") {
        var boxSize = readUint32BigEndian(bytes, 0);
        var majorBrandOffset = 8;
        var minorVersionOffset = 12;
        var brandScanEnd;

        if (boxSize === 1) {
            // large-size ftyp：8 字节扩展长度位于 box type 后，品牌字段整体后移。
            var largeSizeHigh = readUint32BigEndian(bytes, 8);
            var largeSizeLow = readUint32BigEndian(bytes, 12);
            if (largeSizeHigh === null || largeSizeLow === null || (largeSizeHigh === 0 && largeSizeLow < 24)) return null;
            majorBrandOffset = 16;
            minorVersionOffset = 20;
            brandScanEnd = largeSizeHigh === 0 ? Math.min(largeSizeLow, bytes.length) : bytes.length;
        } else {
            if (boxSize === null || (boxSize !== 0 && boxSize < 16)) return null;
            brandScanEnd = boxSize === 0 ? bytes.length : Math.min(boxSize, bytes.length);
        }

        var hasAvifBrand = false;
        var hasAvifSequenceBrand = false;
        var hasHeicBrand = false;
        var hasHeifBrand = false;
        var hasHeicSequenceBrand = false;
        var hasHeifSequenceBrand = false;
        for (var brandOffset = majorBrandOffset; brandOffset + 4 <= brandScanEnd; brandOffset += 4) {
            if (brandOffset === minorVersionOffset) continue; // minor_version，不是品牌字段
            var brand = bytesToAscii(bytes, brandOffset, 4);
            if (brand === "avif") hasAvifBrand = true;
            if (brand === "avis" || brand === "avio") hasAvifSequenceBrand = true;
            if (brand === "heic" || brand === "heix" || brand === "heim" || brand === "heis") hasHeicBrand = true;
            if (brand === "mif1") hasHeifBrand = true;
            if (brand === "hevc" || brand === "hevx" || brand === "hevm" || brand === "hevs") {
                hasHeicSequenceBrand = true;
            }
            if (brand === "msf1") hasHeifSequenceBrand = true;
        }
        // Mistral 的单图 OCR 未明确支持图像序列；序列文件也可能同时声明 still-image 品牌，故优先拒绝。
        if (hasAvifSequenceBrand || hasHeicSequenceBrand || hasHeifSequenceBrand) return null;
        if (hasAvifBrand) return "image/avif";
        if (hasHeicBrand) return "image/heic";
        if (hasHeifBrand) return "image/heif";
    }

    return null;
}

function isEscaped(text, index) {
    var slashCount = 0;
    for (var i = index - 1; i >= 0 && text.charAt(i) === "\\"; i--) slashCount++;
    return slashCount % 2 === 1;
}

function createTextProtector(source) {
    var namespaceStart = "\ue000";
    var namespaceEnd = "\ue001";
    var tokenEnd = "\ue002";
    var namespaceDigitStart = 0xe100;
    var namespaceDigitCount = 7;
    var namespaceLength = namespaceDigitCount + 2;
    var occupiedNamespaces = Object.create(null);

    // 固定 9 个 PUA code unit 的 namespace 不会被后续 Markdown 规则改写。
    // 7 个 base-256 digit 提供 2^56 种候选，多于 JavaScript 字符串可拥有的起始位置。
    // 单遍收集原文已占用的候选，再选第一个空缺，避免把长原文 run 复制进每个 token。
    for (var sourceIndex = 0; sourceIndex + namespaceLength <= source.length; sourceIndex++) {
        if (source.charAt(sourceIndex) !== namespaceStart ||
            source.charAt(sourceIndex + namespaceLength - 1) !== namespaceEnd) {
            continue;
        }

        var isCandidate = true;
        for (var sourceDigit = 0; sourceDigit < namespaceDigitCount; sourceDigit++) {
            var sourceCode = source.charCodeAt(sourceIndex + sourceDigit + 1);
            if (sourceCode < namespaceDigitStart || sourceCode >= namespaceDigitStart + 256) {
                isCandidate = false;
                break;
            }
        }
        if (!isCandidate) continue;

        occupiedNamespaces[source.slice(sourceIndex, sourceIndex + namespaceLength)] = true;
        sourceIndex += namespaceLength - 1;
    }

    function namespaceForIndex(index) {
        var characters = [namespaceStart];
        var remaining = index;
        var digits = [];
        for (var digitIndex = 0; digitIndex < namespaceDigitCount; digitIndex++) {
            digits.push(String.fromCharCode(namespaceDigitStart + remaining % 256));
            remaining = Math.floor(remaining / 256);
        }
        for (var reverseIndex = digits.length - 1; reverseIndex >= 0; reverseIndex--) {
            characters.push(digits[reverseIndex]);
        }
        characters.push(namespaceEnd);
        return characters.join("");
    }

    var namespaceIndex = 0;
    var prefix = namespaceForIndex(namespaceIndex);
    while (occupiedNamespaces[prefix]) {
        namespaceIndex++;
        prefix = namespaceForIndex(namespaceIndex);
    }

    var values = [];
    return {
        protect: function (value) {
            var token = prefix + values.length + tokenEnd;
            values.push({ token: token, value: value });
            return token;
        },
        restore: function (text) {
            function replaceTokens(input, replacements) {
                var parts = [];
                var cursor = 0;

                while (cursor < input.length) {
                    var tokenStart = input.indexOf(prefix, cursor);
                    if (tokenStart === -1) break;

                    var tokenEndIndex = input.indexOf(tokenEnd, tokenStart + prefix.length);
                    if (tokenEndIndex === -1) break;

                    var indexText = input.slice(tokenStart + prefix.length, tokenEndIndex);
                    var valueIndex = /^\d+$/.test(indexText) ? Number(indexText) : -1;
                    var wholeToken = input.slice(tokenStart, tokenEndIndex + tokenEnd.length);
                    if (valueIndex < 0 || valueIndex >= replacements.length || values[valueIndex].token !== wholeToken) {
                        parts.push(input.slice(cursor, tokenStart + prefix.length));
                        cursor = tokenStart + prefix.length;
                        continue;
                    }

                    parts.push(input.slice(cursor, tokenStart));
                    parts.push(replacements[valueIndex]);
                    cursor = tokenEndIndex + tokenEnd.length;
                }

                parts.push(input.slice(cursor));
                return parts.join("");
            }

            // 后创建的保护片段可能包含更早的 token；先各自解析一次，再线性恢复正文。
            var resolvedValues = [];
            for (var i = 0; i < values.length; i++) {
                resolvedValues[i] = replaceTokens(values[i].value, resolvedValues);
            }
            return replaceTokens(text, resolvedValues);
        },
    };
}

function isClosingFence(line, markerCharacter, minimumLength) {
    var match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    return !!match && match[1].charAt(0) === markerCharacter && match[1].length >= minimumLength;
}

function protectFencedCode(text, protect) {
    var lines = text.split("\n");
    var output = [];
    var codeLines = [];
    var inFence = false;
    var markerCharacter = "";
    var markerLength = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        if (!inFence) {
            var opening = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            // CommonMark 禁止反引号 fence 的 info string 再含反引号；这种单行内容应交给 code span 解析。
            var invalidBacktickInfo = opening && opening[1].charAt(0) === "`" && opening[2].indexOf("`") !== -1;
            if (!opening || invalidBacktickInfo) {
                output.push(line);
                continue;
            }

            inFence = true;
            markerCharacter = opening[1].charAt(0);
            markerLength = opening[1].length;
            codeLines = [];
            continue;
        }

        if (isClosingFence(line, markerCharacter, markerLength)) {
            output.push(protect(codeLines.join("\n")));
            inFence = false;
            markerCharacter = "";
            markerLength = 0;
            codeLines = [];
        } else {
            codeLines.push(line);
        }
    }

    // Mistral 偶尔会截断末尾围栏；仍按代码保护剩余内容，避免二次清理破坏 OCR 结果。
    if (inFence) output.push(protect(codeLines.join("\n")));
    return output.join("\n");
}

function protectInlineCode(text, protect) {
    var runs = [];
    var precedingSlashes = 0;

    // 先单遍记录所有反引号 run；被反斜杠转义的首个反引号按字面量保留。
    for (var cursor = 0; cursor < text.length;) {
        var character = text.charAt(cursor);
        if (character !== "`") {
            precedingSlashes = character === "\\" ? precedingSlashes + 1 : 0;
            cursor++;
            continue;
        }

        var runLength = 1;
        while (text.charAt(cursor + runLength) === "`") runLength++;
        if (precedingSlashes % 2 === 1) {
            if (runLength > 1) runs.push({ start: cursor + 1, length: runLength - 1 });
        } else {
            runs.push({ start: cursor, length: runLength });
        }
        cursor += runLength;
        precedingSlashes = 0;
    }

    // 同长度 run 的下一项就是其最早合法闭合符，预配对后无需为每个 opener 重扫后文。
    var nextRunWithSameLength = [];
    var previousRunByLength = {};
    for (var runIndex = 0; runIndex < runs.length; runIndex++) {
        var lengthKey = "r" + runs[runIndex].length;
        var previousRunIndex = previousRunByLength[lengthKey];
        if (typeof previousRunIndex === "number") nextRunWithSameLength[previousRunIndex] = runIndex;
        previousRunByLength[lengthKey] = runIndex;
    }

    var output = [];
    var outputCursor = 0;
    var currentRunIndex = 0;
    while (currentRunIndex < runs.length) {
        var closingRunIndex = nextRunWithSameLength[currentRunIndex];
        if (typeof closingRunIndex !== "number") {
            currentRunIndex++;
            continue;
        }

        var openingRun = runs[currentRunIndex];
        var closingRun = runs[closingRunIndex];
        output.push(text.slice(outputCursor, openingRun.start));
        output.push(protect(text.slice(openingRun.start + openingRun.length, closingRun.start)));
        outputCursor = closingRun.start + closingRun.length;
        currentRunIndex = closingRunIndex + 1;
    }

    output.push(text.slice(outputCursor));
    return output.join("");
}

function protectMathDelimiter(text, opening, closing, protect) {
    var output = [];
    var outputCursor = 0;
    var searchFrom = 0;

    while (searchFrom < text.length) {
        var openingIndex = text.indexOf(opening, searchFrom);
        if (openingIndex === -1) break;

        var closingIndex = text.indexOf(closing, openingIndex + opening.length);
        if (closingIndex === -1) break;

        output.push(text.slice(outputCursor, openingIndex));
        output.push(protect(text.slice(openingIndex, closingIndex + closing.length)));
        outputCursor = closingIndex + closing.length;
        searchFrom = outputCursor;
    }

    output.push(text.slice(outputCursor));
    return output.join("");
}

function protectInlineDollarMath(text, protect) {
    var output = [];
    var outputCursor = 0;
    var openingIndex = -1;
    var precedingSlashes = 0;

    for (var index = 0; index < text.length; index++) {
        var character = text.charAt(index);
        var escaped = precedingSlashes % 2 === 1;

        if (character === "\n") {
            openingIndex = -1;
        } else if (character === "$" && !escaped) {
            if (openingIndex < 0) {
                openingIndex = index;
            } else if (index === openingIndex + 1) {
                // `$$` 不是非空行内公式；第二个 `$` 可作为下一候选 opener。
                openingIndex = index;
            } else {
                output.push(text.slice(outputCursor, openingIndex));
                output.push(protect(text.slice(openingIndex, index + 1)));
                outputCursor = index + 1;
                openingIndex = -1;
            }
        }

        // 转义 `$` 只作为公式内容跳过，不能让仍有效的 opener 丢失。
        if (character === "\\") {
            precedingSlashes++;
        } else {
            precedingSlashes = 0;
        }
    }

    output.push(text.slice(outputCursor));
    return output.join("");
}

function protectMath(text, protect) {
    text = protectMathDelimiter(text, "\\[", "\\]", protect);
    text = protectMathDelimiter(text, "\\(", "\\)", protect);
    text = protectMathDelimiter(text, "$$", "$$", protect);
    return protectInlineDollarMath(text, protect);
}

function isAsciiHtmlLetter(character) {
    var code = character.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiHtmlNameCharacter(character) {
    var code = character.charCodeAt(0);
    return isAsciiHtmlLetter(character) || (code >= 48 && code <= 57) || character === "-";
}

// 从指定的 `<` 开始解析一个单行 HTML 标签。失败时返回已扫描到的位置，避免再次回扫同一片段。
function parseHtmlTagAt(text, start) {
    var cursor = start + 1;
    var isClosing = false;

    if (text.charAt(cursor) === "/") {
        isClosing = true;
        cursor++;
    }

    if (!isAsciiHtmlLetter(text.charAt(cursor))) {
        return { tag: null, nextIndex: Math.min(start + 1, text.length) };
    }

    var nameStart = cursor;
    cursor++;
    while (cursor < text.length && isAsciiHtmlNameCharacter(text.charAt(cursor))) cursor++;
    var nameEnd = cursor;

    var boundary = text.charAt(cursor);
    if (boundary && boundary !== ">" && boundary !== "/" && boundary !== " " && boundary !== "\t") {
        if (boundary === "<" || boundary === "\n" || boundary === "\r") {
            return { tag: null, nextIndex: cursor };
        }
        return { tag: null, nextIndex: Math.min(cursor + 1, text.length) };
    }

    var quote = "";
    for (; cursor < text.length; cursor++) {
        var character = text.charAt(cursor);

        // OCR 中的标签应在单行闭合；遇到下一候选或换行即判定当前标签损坏。
        if (character === "\n" || character === "\r") {
            return { tag: null, nextIndex: cursor };
        }

        if (quote) {
            if (character === quote) quote = "";
            continue;
        }

        if (character === "<") return { tag: null, nextIndex: cursor };

        if (character === "\"" || character === "'") {
            quote = character;
            continue;
        }

        if (character === ">") {
            var beforeClose = cursor - 1;
            while (beforeClose > nameStart && (text.charAt(beforeClose) === " " || text.charAt(beforeClose) === "\t")) {
                beforeClose--;
            }
            return {
                tag: {
                    start: start,
                    end: cursor + 1,
                    name: text.slice(nameStart, nameEnd).toLowerCase(),
                    isClosing: isClosing,
                    isSelfClosing: text.charAt(beforeClose) === "/",
                },
                nextIndex: cursor + 1,
            };
        }
    }

    return { tag: null, nextIndex: text.length };
}

function scanHtmlTags(text, visitor) {
    var cursor = 0;
    while (cursor < text.length) {
        var tagStart = text.indexOf("<", cursor);
        if (tagStart === -1) return;

        var parsed = parseHtmlTagAt(text, tagStart);
        if (parsed.tag) {
            visitor(parsed.tag);
            cursor = parsed.tag.end;
        } else {
            cursor = parsed.nextIndex > tagStart ? parsed.nextIndex : tagStart + 1;
        }
    }
}

function isHtmlWhitespaceOnly(text, start, end) {
    for (var i = start; i < end; i++) {
        var character = text.charAt(i);
        if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") return false;
    }
    return true;
}

function isVerbatimHtmlTag(name) {
    return name === "pre" || name === "code" || name === "math";
}

function protectHtmlVerbatim(text, protect) {
    var tags = [];
    scanHtmlTags(text, function (tag) {
        tags.push(tag);
    });

    var openingStack = [];
    var latestOpeningByName = { pre: -1, code: -1, math: -1 };
    var closingByOpening = [];
    for (var tagIndex = 0; tagIndex < tags.length; tagIndex++) {
        var tag = tags[tagIndex];
        if (!isVerbatimHtmlTag(tag.name)) continue;

        if (!tag.isClosing && !tag.isSelfClosing) {
            openingStack.push({
                tagIndex: tagIndex,
                name: tag.name,
                previousSameType: latestOpeningByName[tag.name],
            });
            latestOpeningByName[tag.name] = openingStack.length - 1;
            continue;
        }
        if (!tag.isClosing) continue;

        var matchingStackIndex = latestOpeningByName[tag.name];
        if (matchingStackIndex < 0) continue;

        var matchingOpeningIndex = openingStack[matchingStackIndex].tagIndex;
        closingByOpening[matchingOpeningIndex] = tagIndex;

        // 每个 opener 最多出栈一次；错配 closing 只做 O(1) 查询，整体保持线性。
        while (openingStack.length > matchingStackIndex) {
            var discardedOpening = openingStack.pop();
            latestOpeningByName[discardedOpening.name] = discardedOpening.previousSameType;
        }
    }

    var output = [];
    var outputCursor = 0;
    var currentTagIndex = 0;
    while (currentTagIndex < tags.length) {
        var closingIndex = closingByOpening[currentTagIndex];
        if (typeof closingIndex !== "number") {
            currentTagIndex++;
            continue;
        }

        var openingTag = tags[currentTagIndex];
        var closingTag = tags[closingIndex];
        var contentStart = openingTag.end;
        var contentEnd = closingTag.start;

        // 与既有行为一致：<pre><code>…</code></pre> 的两层外壳都不进入纯文本结果。
        if (openingTag.name === "pre" && currentTagIndex + 1 < closingIndex) {
            var codeOpeningIndex = currentTagIndex + 1;
            var codeOpeningTag = tags[codeOpeningIndex];
            var codeClosingIndex = closingByOpening[codeOpeningIndex];
            if (codeOpeningTag.name === "code" && !codeOpeningTag.isClosing &&
                typeof codeClosingIndex === "number" && codeClosingIndex < closingIndex &&
                isHtmlWhitespaceOnly(text, openingTag.end, codeOpeningTag.start) &&
                isHtmlWhitespaceOnly(text, tags[codeClosingIndex].end, closingTag.start)) {
                contentStart = codeOpeningTag.end;
                contentEnd = tags[codeClosingIndex].start;
            }
        }

        output.push(text.slice(outputCursor, openingTag.start));
        output.push(protect(text.slice(contentStart, contentEnd)));
        outputCursor = closingTag.end;
        currentTagIndex = closingIndex + 1;
    }

    output.push(text.slice(outputCursor));
    return output.join("");
}

var HTML_CELL_TAGS = { td: true, th: true };
var HTML_BLOCK_TAGS = {
    p: true,
    div: true,
    section: true,
    article: true,
    header: true,
    footer: true,
    main: true,
    aside: true,
    nav: true,
    h1: true,
    h2: true,
    h3: true,
    h4: true,
    h5: true,
    h6: true,
    ul: true,
    ol: true,
    li: true,
    blockquote: true,
    table: true,
    thead: true,
    tbody: true,
    tfoot: true,
    caption: true,
};
var HTML_INLINE_TAGS = {
    span: true,
    strong: true,
    em: true,
    b: true,
    i: true,
    u: true,
    s: true,
    del: true,
    ins: true,
    mark: true,
    small: true,
    sub: true,
    sup: true,
    a: true,
};
var HTML_VOID_TAGS = { img: true, hr: true, input: true, meta: true, link: true };

function getKnownHtmlReplacement(tag) {
    if (!tag.isClosing && tag.name === "br") return "\n";
    if (HTML_CELL_TAGS[tag.name] === true) return "\t";
    if (tag.name === "tr") return "\n";
    if (HTML_BLOCK_TAGS[tag.name] === true) return "\n";
    if (HTML_INLINE_TAGS[tag.name] === true) return "";
    if (!tag.isClosing && HTML_VOID_TAGS[tag.name] === true) return "";
    return null;
}

function replaceKnownHtmlTags(text) {
    var output = [];
    var outputCursor = 0;
    scanHtmlTags(text, function (tag) {
        var replacement = getKnownHtmlReplacement(tag);
        if (replacement === null) return;
        output.push(text.slice(outputCursor, tag.start));
        output.push(replacement);
        outputCursor = tag.end;
    });
    output.push(text.slice(outputCursor));
    return output.join("");
}

function getLinkDestination(target) {
    target = target.replace(/^[ \t]+|[ \t]+$/g, "");
    if (target.charAt(0) === "<") {
        var angleEnd = target.indexOf(">");
        if (angleEnd !== -1) return target.slice(1, angleEnd);
    }

    var destination = "";
    for (var i = 0; i < target.length && !/\s/.test(target.charAt(i)); i++) {
        destination += target.charAt(i);
    }
    return destination;
}

function getAssetBasename(target) {
    var destination = getLinkDestination(target).replace(/\\([()])/g, "$1");
    destination = destination.split("#")[0].split("?")[0];
    var slashIndex = Math.max(destination.lastIndexOf("/"), destination.lastIndexOf("\\"));
    return destination.slice(slashIndex + 1).toLowerCase();
}

function isMistralImagePlaceholder(label, target) {
    var basename = getAssetBasename(target);
    var normalizedLabel = label.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase();
    var generatedImage = /^(?:img|image)-\d+\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i;
    return generatedImage.test(basename) && (!normalizedLabel || normalizedLabel === basename);
}

function isMistralTablePlaceholder(label, target) {
    var basename = getAssetBasename(target);
    var normalizedLabel = label.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase();
    var generatedTable = /^(?:tbl|table)-\d+\.html?$/i;
    return generatedTable.test(basename) && (!normalizedLabel || normalizedLabel === basename);
}

function replaceMarkdownLinks(text) {
    // 先在线性时间内建立括号配对索引，避免大量未闭合 `[` 让逐候选扫描退化为 O(n²)。
    var squareMatches = [];
    var squareOpenings = [];
    var roundMatches = [];
    var squareStack = [];
    var escapedPositions = [];
    var precedingSlashes = 0;
    var linkTarget = null;

    for (var index = 0; index < text.length; index++) {
        var character = text.charAt(index);
        var escaped = precedingSlashes % 2 === 1;
        escapedPositions[index] = escaped;

        if (!escaped) {
            if (character === "[") {
                squareStack.push(index);
            } else if (character === "]" && squareStack.length > 0) {
                var squareOpening = squareStack.pop();
                squareMatches[squareOpening] = index;
                squareOpenings[index] = squareOpening;
            }

            if (linkTarget) {
                if (linkTarget.quote) {
                    if (character === linkTarget.quote) linkTarget.quote = "";
                } else if (linkTarget.angleDestination) {
                    if (character === ">") {
                        linkTarget.angleDestination = false;
                        linkTarget.sawDestination = true;
                    }
                } else if (character === " " || character === "\t" || character === "\n") {
                    if (linkTarget.depth === 1 && linkTarget.sawDestination) {
                        linkTarget.afterDestinationWhitespace = true;
                    }
                } else if (linkTarget.depth === 1 && !linkTarget.sawDestination && character === "<") {
                    linkTarget.angleDestination = true;
                } else if (linkTarget.depth === 1 &&
                    (character === "\"" || character === "'") &&
                    (!linkTarget.sawDestination || linkTarget.afterDestinationWhitespace)) {
                    linkTarget.quote = character;
                } else if (character === "(") {
                    linkTarget.depth++;
                    linkTarget.sawDestination = true;
                    linkTarget.afterDestinationWhitespace = false;
                } else if (character === ")") {
                    linkTarget.depth--;
                    if (linkTarget.depth === 0) {
                        roundMatches[linkTarget.start] = index;
                        linkTarget = null;
                    }
                } else {
                    linkTarget.sawDestination = true;
                    linkTarget.afterDestinationWhitespace = false;
                }
            } else if (character === "(" &&
                typeof squareOpenings[index - 1] === "number") {
                // 只对真正跟在配对 `]` 后的 Markdown target 启用引号/尖括号语义，
                // 普通正文中的括号仍按字面处理。target 内的每个字符最多访问一次。
                linkTarget = {
                    start: index,
                    depth: 1,
                    quote: "",
                    angleDestination: false,
                    sawDestination: false,
                    afterDestinationWhitespace: false,
                };
            }
        }

        precedingSlashes = character === "\\" ? precedingSlashes + 1 : 0;
    }

    var output = "";
    var lastIndex = 0;
    var cursor = 0;

    while (cursor < text.length) {
        if (text.charAt(cursor) === "!" && escapedPositions[cursor] && text.charAt(cursor + 1) === "[") {
            // \![alt](url) 是字面量而不是图片；跳过整个结构，避免下一轮把 `[` 当普通链接。
            var literalLabelEnd = squareMatches[cursor + 1];
            var literalTargetStart = literalLabelEnd + 1;
            var literalTargetEnd = typeof literalLabelEnd === "number" && text.charAt(literalTargetStart) === "("
                ? roundMatches[literalTargetStart]
                : undefined;
            cursor = typeof literalTargetEnd === "number" ? literalTargetEnd + 1 : cursor + 2;
            continue;
        }

        var isImage = text.charAt(cursor) === "!" && !escapedPositions[cursor] && text.charAt(cursor + 1) === "[";
        var bracketIndex = isImage ? cursor + 1 : cursor;
        if (text.charAt(bracketIndex) !== "[" || escapedPositions[bracketIndex]) {
            cursor++;
            continue;
        }

        var labelEnd = squareMatches[bracketIndex];
        var targetStart = labelEnd + 1;
        if (typeof labelEnd !== "number" || text.charAt(targetStart) !== "(") {
            cursor++;
            continue;
        }

        var targetEnd = roundMatches[targetStart];
        if (typeof targetEnd !== "number") {
            cursor++;
            continue;
        }

        var label = text.slice(bracketIndex + 1, labelEnd);
        var target = text.slice(targetStart + 1, targetEnd);
        var replacement;
        if (isImage) {
            replacement = isMistralImagePlaceholder(label, target) ? "" : label;
        } else {
            // `[![alt](image.png)](url)` 的可见文本是内层图片的 alt；外层链接本身
            // 不应让图片 Markdown 残留。仅识别“恰好一层图片”的 label，避免递归解析。
            var imageMarker = bracketIndex + 1;
            var imageBracket = imageMarker + 1;
            var imageLabelEnd = text.charAt(imageMarker) === "!" && !escapedPositions[imageMarker] &&
                text.charAt(imageBracket) === "[" ? squareMatches[imageBracket] : undefined;
            var imageTargetStart = typeof imageLabelEnd === "number" ? imageLabelEnd + 1 : -1;
            var imageTargetEnd = imageTargetStart >= 0 && text.charAt(imageTargetStart) === "("
                ? roundMatches[imageTargetStart]
                : undefined;

            if (typeof imageTargetEnd === "number" && imageTargetEnd === labelEnd - 1) {
                var imageLabel = text.slice(imageBracket + 1, imageLabelEnd);
                var imageTarget = text.slice(imageTargetStart + 1, imageTargetEnd);
                replacement = isMistralImagePlaceholder(imageLabel, imageTarget) ? "" : imageLabel;
            } else {
                replacement = isMistralTablePlaceholder(label, target) ? "" : label;
            }
        }

        output += text.slice(lastIndex, cursor) + replacement;
        cursor = targetEnd + 1;
        lastIndex = cursor;
    }

    return output + text.slice(lastIndex);
}

function isMarkdownTableWhitespace(character) {
    var code = character.charCodeAt(0);
    return code === 9 || code === 11 || code === 12 || code === 32 || code === 160;
}

function isMarkdownTableSeparator(line) {
    var cursor = 0;
    while (cursor < line.length && isMarkdownTableWhitespace(line.charAt(cursor))) cursor++;
    if (line.charAt(cursor) === "|") cursor++;

    while (cursor < line.length) {
        while (cursor < line.length && isMarkdownTableWhitespace(line.charAt(cursor))) cursor++;
        if (line.charAt(cursor) === ":") cursor++;

        var dashStart = cursor;
        while (line.charAt(cursor) === "-") cursor++;
        if (cursor - dashStart < 3) return false;
        if (line.charAt(cursor) === ":") cursor++;
        while (cursor < line.length && isMarkdownTableWhitespace(line.charAt(cursor))) cursor++;

        if (cursor === line.length) return true;
        if (line.charAt(cursor) !== "|") return false;
        cursor++;

        var afterPipe = cursor;
        while (cursor < line.length && isMarkdownTableWhitespace(line.charAt(cursor))) cursor++;
        if (cursor === line.length) return true;
        if (cursor === afterPipe && line.charAt(cursor) === "|") return false;
    }

    return false;
}

function simplifyMarkdownTables(text) {
    var lines = text.split("\n");
    var tableRows = [];
    var removedRows = [];

    function hasUnescapedPipe(line) {
        for (var pipeIndex = 0; pipeIndex < line.length; pipeIndex++) {
            if (line.charAt(pipeIndex) === "|" && !isEscaped(line, pipeIndex)) return true;
        }
        return false;
    }

    function simplifyTableRow(line) {
        line = line.replace(/^[ \t]+|[ \t]+$/g, "");
        if (line.charAt(0) === "|") line = line.slice(1);
        if (line.charAt(line.length - 1) === "|" && !isEscaped(line, line.length - 1)) line = line.slice(0, -1);

        var simplified = "";
        for (var characterIndex = 0; characterIndex < line.length; characterIndex++) {
            if (line.charAt(characterIndex) === "|" && !isEscaped(line, characterIndex)) {
                simplified = simplified.replace(/[ \t]+$/, "") + "\t";
                while (line.charAt(characterIndex + 1) === " " || line.charAt(characterIndex + 1) === "\t") {
                    characterIndex++;
                }
            } else {
                simplified += line.charAt(characterIndex);
            }
        }
        return simplified;
    }

    var insideTableBlock = false;
    for (var i = 0; i < lines.length; i++) {
        if (isMarkdownTableSeparator(lines[i])) {
            // 分隔行只有紧跟含未转义管道的表头时才有表格语义；孤立的 `---|---`
            // 及其后普通管道文本都必须原样保留。
            if (i > 0 && hasUnescapedPipe(lines[i - 1])) {
                removedRows[i] = true;
                tableRows[i - 1] = true;
                insideTableBlock = true;
            } else {
                insideTableBlock = false;
            }
            continue;
        }

        if (!insideTableBlock) continue;
        if (lines[i].replace(/[ \t]/g, "") && hasUnescapedPipe(lines[i])) {
            tableRows[i] = true;
        } else {
            insideTableBlock = false;
        }
    }

    var output = [];
    for (var row = 0; row < lines.length; row++) {
        if (removedRows[row]) continue;
        if (tableRows[row]) {
            var trimmed = lines[row].replace(/^[ \t]+|[ \t]+$/g, "");
            lines[row] = simplifyTableRow(trimmed);
        }
        output.push(lines[row]);
    }

    return output.join("\n");
}

// 去除 Markdown 格式，转为纯文本。代码和公式先占位保护，避免清理规则破坏其内容。
function stripMarkdown(text) {
    if (typeof text !== "string") return "";

    text = text.replace(/\r\n?/g, "\n");
    var protector = createTextProtector(text);
    var protect = protector.protect;

    text = protectFencedCode(text, protect);
    text = protectHtmlVerbatim(text, protect);
    text = protectInlineCode(text, protect);
    text = protectMath(text, protect);
    text = replaceMarkdownLinks(text);
    text = replaceKnownHtmlTags(text);

    text = text
        // 标题与强调。边界通过捕获组判断，不使用旧版 JavaScriptCore 不支持的 lookbehind。
        .replace(/^#{1,6}[ \t]+/gm, "")
        .replace(/(^|[ \t\n(\[{:>])\*\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*\*(?=$|[ \t\n.,!?;:)\]}>])/gm, "$1$2")
        .replace(/(^|[ \t\n(\[{:>])\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*(?=$|[ \t\n.,!?;:)\]}>])/gm, "$1$2")
        .replace(/(^|[ \t\n(\[{:>])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?=$|[ \t\n.,!?;:)\]}>])/gm, "$1$2")
        // 下划线也常见于代码标识符（如 __init__、x_i）；宁可保留格式符，也不删除 OCR 原文字符。
        .replace(/~~([^~\n]+)~~/g, "$1")
        // 水平线、列表和引用。
        .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
        .replace(/^[ \t]*[-*+][ \t]+/gm, "")
        .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
        .replace(/^[ \t]*>[ \t]?/gm, "");

    text = simplifyMarkdownTables(text)
        // 表格处理完成后再恢复转义，避免把单元格里的 \| 误判成列分隔符。
        .replace(/\\([\\`*_[\]{}()#+.!>|~-])/g, "$1")
        .replace(/[ \t]+/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return protector.restore(text);
}

function completeOnce(completion) {
    var completed = false;
    return function (value) {
        if (completed) return;
        completed = true;
        completion(value);
    };
}

function redactSensitiveText(value, sensitiveValues) {
    var text = typeof value === "string" ? value : String(value);
    for (var i = 0; Array.isArray(sensitiveValues) && i < sensitiveValues.length; i++) {
        var sensitiveValue = sensitiveValues[i];
        if (typeof sensitiveValue === "string" && sensitiveValue) {
            text = text.split(sensitiveValue).join("[REDACTED]");
        }
    }
    return text;
}

function safeStringify(value, sensitiveValues) {
    var serialized;
    try {
        serialized = JSON.stringify(value);
    } catch (error) {
        return "无法序列化附加信息";
    }

    return redactSensitiveText(serialized, sensitiveValues);
}

function getErrorMessage(error, sensitiveValues) {
    var message = error && typeof error.message === "string" && error.message ? error.message : "未知错误";
    return redactSensitiveText(message, sensitiveValues);
}

function validateApiKey(value) {
    var apiKey = value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
    if (!apiKey) return { valid: false, empty: true, message: "API Key 不能为空" };

    // API Key 会直接进入 Authorization 请求头；拒绝内部空白和控制字符，避免请求头注入或歧义解析。
    if (/[\s\u0000-\u001f\u007f-\u009f]/.test(apiKey)) {
        return { valid: false, empty: false, message: "API Key 格式无效，不能包含空白或控制字符" };
    }

    return { valid: true, value: apiKey };
}

function isLoopbackHost(host) {
    host = host.toLowerCase();
    if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

    var ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!ipv4 || Number(ipv4[1]) !== 127) return false;
    for (var i = 1; i <= 4; i++) {
        if (Number(ipv4[i]) > 255) return false;
    }
    return true;
}

// 自定义远程端点会接收 API Key 和完整截图，因此只允许 HTTPS；本机回环地址可使用 HTTP 调试。
function validateApiBaseUrl(value) {
    var apiUrl = value ? String(value).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "") : "https://api.mistral.ai";
    if (!apiUrl || /[\u0000-\u0020\\]/.test(apiUrl)) {
        return { valid: false, message: "API 地址格式无效" };
    }

    var parsed = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(apiUrl);
    if (!parsed || parsed[2].indexOf("@") !== -1) {
        return { valid: false, message: "API 地址仅允许 HTTPS（本机回环地址可使用 HTTP），且不能包含查询参数、片段或用户信息" };
    }

    var scheme = parsed[1].toLowerCase();
    var authority = parsed[2];
    var host = "";
    var port = "";

    if (authority.charAt(0) === "[") {
        var bracketEnd = authority.indexOf("]");
        if (bracketEnd === -1 || !/^[0-9a-f:.]+$/i.test(authority.slice(1, bracketEnd))) {
            return { valid: false, message: "API 地址中的 IPv6 主机无效" };
        }
        host = authority.slice(1, bracketEnd);
        var bracketSuffix = authority.slice(bracketEnd + 1);
        if (bracketSuffix) {
            if (!/^:\d+$/.test(bracketSuffix)) return { valid: false, message: "API 地址端口无效" };
            port = bracketSuffix.slice(1);
        }
    } else {
        if (authority.indexOf(":") !== authority.lastIndexOf(":")) {
            return { valid: false, message: "IPv6 API 地址必须使用方括号" };
        }
        var colonIndex = authority.lastIndexOf(":");
        if (colonIndex !== -1) {
            host = authority.slice(0, colonIndex);
            port = authority.slice(colonIndex + 1);
            if (!/^\d+$/.test(port)) return { valid: false, message: "API 地址端口无效" };
        } else {
            host = authority;
        }
        if (!/^[a-z0-9.-]+$/i.test(host)) return { valid: false, message: "API 地址主机无效" };
    }

    if (!host || (port && (Number(port) < 1 || Number(port) > 65535))) {
        return { valid: false, message: "API 地址主机或端口无效" };
    }
    if (scheme === "http" && !isLoopbackHost(host)) {
        return { valid: false, message: "远程 API 地址仅允许 HTTPS；仅 localhost 或回环地址可使用 HTTP" };
    }

    return { valid: true, url: apiUrl.replace(/\/+$/, "") };
}

function pluginValidate(completion) {
    var done = completeOnce(completion);

    try {
        var validatedKey = validateApiKey($option.apiKey);
        if (!validatedKey.valid) {
            done({
                result: false,
                error: {
                    type: "secretKey",
                    message: validatedKey.empty ? "请先填写 Mistral AI API Key" : validatedKey.message,
                    troubleshootingLink: MISTRAL_CONSOLE_URL,
                },
            });
            return;
        }
        var apiKey = validatedKey.value;

        var validatedUrl = validateApiBaseUrl($option.apiUrl);
        if (!validatedUrl.valid) {
            done({ result: false, error: { type: "param", message: validatedUrl.message } });
            return;
        }

        $http.request({
            method: "GET",
            url: validatedUrl.url + "/v1/models",
            header: {
                Authorization: "Bearer " + apiKey,
            },
            timeout: 10,
            handler: function (resp) {
                try {
                    if (!resp || resp.error) {
                        done({
                            result: false,
                            error: {
                                type: "network",
                                message: "网络请求失败: " + getErrorMessage(resp && resp.error, [apiKey]),
                            },
                        });
                        return;
                    }

                    if (!resp.response || typeof resp.response.statusCode !== "number") {
                        done({ result: false, error: { type: "api", message: "验证响应格式无法解析" } });
                        return;
                    }

                    var statusCode = resp.response.statusCode;
                    if (statusCode === 401 || statusCode === 403) {
                        done({
                            result: false,
                            error: {
                                type: "secretKey",
                                message: "API Key 无效或已过期",
                                troubleshootingLink: MISTRAL_CONSOLE_URL,
                            },
                        });
                        return;
                    }

                    if (statusCode !== 200) {
                        done({
                            result: false,
                            error: {
                                type: "network",
                                message: "验证失败，状态码: " + statusCode,
                            },
                        });
                        return;
                    }

                    // 防止代理登录页等任意 HTTP 200 被误判为有效 Mistral API。
                    if (!resp.data || !Array.isArray(resp.data.data)) {
                        done({ result: false, error: { type: "api", message: "验证响应格式无法解析" } });
                        return;
                    }

                    done({ result: true });
                } catch (error) {
                    done({
                        result: false,
                        error: { type: "api", message: "处理验证响应失败: " + getErrorMessage(error, [apiKey]) },
                    });
                }
            },
        });
    } catch (error) {
        done({
            result: false,
            error: { type: "network", message: "无法发起验证请求: " + getErrorMessage(error, [apiKey]) },
        });
    }
}

function ocr(query, completion) {
    var done = completeOnce(completion);

    try {
        var validatedKey = validateApiKey($option.apiKey);
        if (!validatedKey.valid) {
            done({
                error: {
                    type: "secretKey",
                    message: validatedKey.empty ? "请先在插件设置中填写 Mistral AI API Key" : validatedKey.message,
                    troubleshootingLink: MISTRAL_CONSOLE_URL,
                },
            });
            return;
        }
        var apiKey = validatedKey.value;

        var validatedUrl = validateApiBaseUrl($option.apiUrl);
        if (!validatedUrl.valid) {
            done({ error: { type: "param", message: validatedUrl.message } });
            return;
        }

        var keepMarkdown = $option.keepMarkdown === "true";
        var model = $option.model || "mistral-ocr-latest";
        // 已退役的模型 ID 回退到最新版，避免用户历史选择导致请求必然失败
        var RETIRED_MODELS = ["mistral-ocr-2503", "mistral-ocr-2505"];
        if (RETIRED_MODELS.indexOf(model) !== -1) model = "mistral-ocr-latest";

        if (!query || !query.image || typeof query.image.toBase64 !== "function") {
            done({ error: { type: "param", message: "无法读取待识别图片" } });
            return;
        }

        var base64Image;
        try {
            base64Image = query.image.toBase64();
        } catch (error) {
            done({ error: { type: "param", message: "无法读取待识别图片: " + getErrorMessage(error, [apiKey]) } });
            return;
        }

        if (typeof base64Image !== "string" || !/\S/.test(base64Image)) {
            done({ error: { type: "param", message: "不支持的图片格式：待识别图片数据为空" } });
            return;
        }

        var mimeType = detectMimeType(base64Image);
        if (!mimeType) {
            done({
                error: {
                    type: "param",
                    message: "不支持的图片格式；请使用 JPEG、PNG、GIF、WebP、BMP、TIFF、AVIF、HEIC 或 HEIF",
                },
            });
            return;
        }

        $http.request({
            method: "POST",
            url: validatedUrl.url + "/v1/ocr",
            header: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + apiKey,
            },
            body: {
                model: model,
                document: {
                    type: "image_url",
                    image_url: "data:" + mimeType + ";base64," + base64Image,
                },
            },
            timeout: 85,
            handler: function (resp) {
                try {
                    if (!resp || resp.error) {
                        done({
                            error: {
                                type: "network",
                                message: "网络请求失败: " + getErrorMessage(resp && resp.error, [apiKey]),
                                addition: safeStringify(resp && resp.error, [apiKey]),
                            },
                        });
                        return;
                    }

                    if (!resp.response || typeof resp.response.statusCode !== "number") {
                        done({ error: { type: "api", message: "响应格式无法解析" } });
                        return;
                    }

                    var statusCode = resp.response.statusCode;
                    if (statusCode !== 200) {
                        var errMsg = "请求失败，状态码: " + statusCode;
                        var errType = "network";
                        if (resp.data && typeof resp.data.message === "string" && resp.data.message) {
                            errMsg = redactSensitiveText(resp.data.message, [apiKey]);
                        }
                        var troubleshootingLink;
                        if (statusCode === 401 || statusCode === 403) {
                            errType = "secretKey";
                            errMsg = "API Key 无效或已过期，请检查设置";
                            troubleshootingLink = MISTRAL_CONSOLE_URL;
                        } else if (statusCode === 429) {
                            errMsg = "请求过于频繁，请稍后再试";
                        } else if (statusCode >= 500) {
                            errMsg = "Mistral 服务器错误，请稍后再试";
                        }
                        done({
                            error: {
                                type: errType,
                                message: errMsg,
                                troubleshootingLink: troubleshootingLink,
                                addition: safeStringify(resp.data, [apiKey]),
                            },
                        });
                        return;
                    }

                    var data = resp.data;
                    if (!data || !Array.isArray(data.pages)) {
                        done({
                            error: {
                                type: "api",
                                message: "响应格式无法解析",
                                addition: safeStringify(data, [apiKey]),
                            },
                        });
                        return;
                    }

                    var texts = [];
                    for (var pageIndex = 0; pageIndex < data.pages.length; pageIndex++) {
                        var page = data.pages[pageIndex];
                        if (!page || typeof page.markdown !== "string") {
                            done({
                                error: {
                                    type: "api",
                                    message: "响应格式无法解析：第 " + (pageIndex + 1) + " 页缺少文本",
                                    addition: safeStringify(page, [apiKey]),
                                },
                            });
                            return;
                        }
                        if (!page.markdown.trim()) continue;

                        var content = keepMarkdown ? page.markdown : stripMarkdown(page.markdown);
                        // Bob 的 OCR 结果以空行触发段落换行；纯文本模式保持已发布行为，将每组换行规范为双换行。
                        if (!keepMarkdown) content = content.replace(/\n+/g, "\n\n");
                        if (!content.trim()) continue;
                        texts.push({ text: content });
                    }

                    if (texts.length === 0) {
                        done({ error: { type: "notFound", message: "未识别到任何文本" } });
                        return;
                    }

                    done({
                        result: {
                            from: query.detectFrom,
                            texts: texts,
                            raw: data,
                        },
                    });
                } catch (error) {
                    done({
                        error: { type: "api", message: "处理 OCR 响应失败: " + getErrorMessage(error, [apiKey]) },
                    });
                }
            },
        });
    } catch (error) {
        done({ error: { type: "network", message: "无法发起 OCR 请求: " + getErrorMessage(error, [apiKey]) } });
    }
}
