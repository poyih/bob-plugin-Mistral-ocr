import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CANONICAL_CREDENTIAL_NAMES = new Set([
  "awssecretaccesskey",
  "awssessiontoken",
]);
const TOKEN_NAME_PREFIXES = new Set([
  "access",
  "api",
  "auth",
  "authentication",
  "authorization",
  "bearer",
  "client",
  "github",
  "gitlab",
  "id",
  "invite",
  "mistral",
  "oauth",
  "openai",
  "personalaccess",
  "refresh",
  "reset",
  "session",
  "slack",
  "stripe",
  "verification",
  "webhook",
]);

function isCredentialAssignment(match) {
  const name = match[1].replace(/[_-]/g, "").toLowerCase();
  if (CANONICAL_CREDENTIAL_NAMES.has(name)) return true;
  if (["apikey", "password", "privatekey", "secret", "secretkey", "token"].includes(name)) return true;
  if (["apikey", "password", "privatekey", "secret", "secretaccesskey", "secretkey"].some((suffix) => name.endsWith(suffix))) {
    return true;
  }
  if (!name.endsWith("token")) return false;
  return TOKEN_NAME_PREFIXES.has(name.slice(0, -"token".length));
}

const RULES = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { id: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: "bearer-token", pattern: /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}/gi },
  {
    id: "credential-assignment",
    // Covers JSON quoted keys, dotenv/JavaScript "=" assignments, YAML ":" assignments,
    // snake/constant names and common camelCase names, plus quoted/unquoted values.
    pattern: /(?:^|[^A-Za-z0-9_])["']?([A-Za-z][A-Za-z0-9_-]*)["']?\]?[ \t]*[:=][ \t]*["']?(?!(?:process|import\.meta)\.env\b)([A-Za-z0-9._~+/=-]{20,})/gim,
    accept: isCredentialAssignment,
  },
];

function ruleMatches(rule, text) {
  rule.pattern.lastIndex = 0;
  let matched = false;
  for (let match = rule.pattern.exec(text); match; match = rule.pattern.exec(text)) {
    if (!rule.accept || rule.accept(match)) {
      matched = true;
      break;
    }
    if (match[0].length === 0) rule.pattern.lastIndex += 1;
  }
  rule.pattern.lastIndex = 0;
  return matched;
}

function syntheticCredential(length = 36) {
  // Generate test material at runtime so no token-shaped fixture is stored in this repository.
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet.charAt((index * 11 + 7) % alphabet.length);
  }
  return value;
}

function selfTestRules() {
  const credentialRule = RULES.find((rule) => rule.id === "credential-assignment");
  if (!credentialRule) throw new Error("Secret scanner self-test failed: assignment rule is missing");

  const credential = syntheticCredential();
  const awsSecretAccessKey = syntheticCredential(40);
  const awsSessionToken = syntheticCredential(72);
  const syntheticValues = [credential, awsSecretAccessKey, awsSessionToken];
  const positiveCases = [
    { name: "JSON quoted apiKey", text: JSON.stringify({ apiKey: credential }) },
    { name: "JSON quoted token", text: JSON.stringify({ token: credential }) },
    { name: "dotenv MISTRAL_API_KEY", text: `MISTRAL_API_KEY=${credential}` },
    { name: "dotenv MISTRAL_TOKEN", text: `export MISTRAL_TOKEN=${credential}` },
    { name: "YAML unquoted token", text: `token: ${credential}` },
    { name: "YAML provider API key", text: `mistral_api_key: ${credential}` },
    { name: "JavaScript property assignment", text: `config.apiKey="${credential}"` },
    { name: "process.env credential assignment", text: `process.env.MISTRAL_API_KEY="${credential}"` },
    { name: "JSON camelCase provider API key", text: JSON.stringify({ mistralApiKey: credential }) },
    { name: "JSON camelCase access token", text: JSON.stringify({ accessToken: credential }) },
    { name: "JavaScript camelCase client secret", text: `config.clientSecret="${credential}"` },
    { name: "JavaScript camelCase auth token", text: `session.authToken = "${credential}"` },
    { name: "JavaScript camelCase private key", text: `keyring.privateKey="${credential}"` },
    { name: "canonical AWS secret access key", text: `AWS_SECRET_ACCESS_KEY=${awsSecretAccessKey}` },
    { name: "canonical AWS session token", text: `AWS_SESSION_TOKEN=${awsSessionToken}` },
    { name: "camelCase AWS secret access key", text: JSON.stringify({ awsSecretAccessKey }) },
  ];

  for (const testCase of positiveCases) {
    const detected = findingsForText("dynamic-self-test", testCase.text)
      .filter((finding) => finding.rule === credentialRule.id);
    if (detected.length === 0) {
      throw new Error(`Secret scanner self-test failed: ${testCase.name} was not detected`);
    }
    const diagnostic = detected.map(formatFinding).join("\n");
    if (syntheticValues.some((value) => diagnostic.includes(value))) {
      throw new Error("Secret scanner self-test failed: diagnostic output exposed credential material");
    }
  }

  const safeCases = [
    "MISTRAL_API_KEY=${MISTRAL_API_KEY}",
    '"apiKey": "test-api-key"',
    "token: process.env.MISTRAL_TOKEN",
    "accessToken: import.meta.env.ACCESS_TOKEN",
    "awsSessionToken: process.env.AWS_SESSION_TOKEN",
    "awsSecretAccessKey: import.meta.env.AWS_SECRET_ACCESS_KEY",
    `continuationToken: ${credential}`,
    `paginationToken: ${credential}`,
    `publicKey: ${credential}`,
  ];
  for (const text of safeCases) {
    if (ruleMatches(credentialRule, text)) {
      throw new Error("Secret scanner self-test failed: a non-credential reference was flagged");
    }
  }

  const binarySample = Buffer.concat([
    Buffer.from([0x78, 0x00]),
    Buffer.from("Bearer ", "ascii"),
    Buffer.from(credential, "ascii"),
  ]).toString("latin1");
  const binaryFindings = findingsForText("binary-self-test", binarySample)
    .filter((finding) => finding.rule === "bearer-token");
  if (binaryFindings.length === 0) {
    throw new Error("Secret scanner self-test failed: a credential after a NUL byte was not detected");
  }
  if (binaryFindings.map(formatFinding).join("\n").includes(credential)) {
    throw new Error("Secret scanner self-test failed: binary diagnostic output exposed credential material");
  }

  const binaryAssignment = Buffer.concat([
    Buffer.from([0x78, 0x00]),
    Buffer.from("MISTRAL_API_KEY=", "ascii"),
    Buffer.from(credential, "ascii"),
  ]).toString("latin1");
  const binaryAssignmentFindings = findingsForText("binary-assignment-self-test", binaryAssignment)
    .filter((finding) => finding.rule === credentialRule.id);
  if (binaryAssignmentFindings.length === 0) {
    throw new Error("Secret scanner self-test failed: an assignment after a NUL byte was not detected");
  }
  if (binaryAssignmentFindings.map(formatFinding).join("\n").includes(credential)) {
    throw new Error("Secret scanner self-test failed: binary assignment output exposed credential material");
  }

  return positiveCases.length + safeCases.length + 2;
}

function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Unable to enumerate repository files with git");
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function newlineOffsets(text) {
  const offsets = [];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    offsets.push(index);
  }
  return offsets;
}

function lineNumberAt(offsets, index) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < index) low = middle + 1;
    else high = middle;
  }
  return low + 1;
}

function findingsForText(file, text) {
  const findings = [];
  const offsets = newlineOffsets(text);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(text); match; match = rule.pattern.exec(text)) {
      if (rule.accept && !rule.accept(match)) {
        if (match[0].length === 0) rule.pattern.lastIndex += 1;
        continue;
      }
      // Never retain the matched text. Findings contain only the location and rule identifier.
      findings.push({ file, line: lineNumberAt(offsets, match.index), rule: rule.id });
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
    rule.pattern.lastIndex = 0;
  }
  return findings;
}

function formatFinding(finding) {
  return `${finding.file}:${finding.line} [${finding.rule}]`;
}

const selfTestCount = selfTestRules();
const findings = [];
const files = repositoryFiles();
for (const relativePath of files) {
  const data = await readFile(resolve(ROOT, relativePath));
  // Latin-1 preserves every byte one-to-one, so ASCII credentials remain detectable even
  // in binary files or after NUL bytes. Never skip a whole file merely because it is binary.
  const text = data.toString("latin1");
  findings.push(...findingsForText(relativePath, text));
}

if (findings.length > 0) {
  console.error(`Secret scan failed with ${findings.length} potential credential finding(s).`);
  for (const finding of findings) {
    // Deliberately print only location and rule ID; never echo matched credential material.
    console.error(formatFinding(finding));
  }
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed (${files.length} repository files checked; ${selfTestCount} rule self-tests passed).`);
}
