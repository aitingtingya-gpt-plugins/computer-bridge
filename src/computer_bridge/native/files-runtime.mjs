import {createRequire as bridgeCreateRequire} from "node:module"; const require=bridgeCreateRequire(import.meta.url);

// files-runtime.ts
import { Context as Context3 } from "@deepseek-ai/cordis";

// third_party/dsh-tools/packages/fs/fs-patch/src/parse.ts
var WHITE_SPACE = new RegExp("\\p{White_Space}", "u");

// third_party/dsh-tools/packages/fs/fs-patch/src/apply.ts
var WHITE_SPACE2 = new RegExp("\\p{White_Space}", "u");
function trimWhitespace(value, leading) {
  let start = 0;
  let end = value.length;
  if (leading) {
    while (start < end && WHITE_SPACE2.test(value.charAt(start))) start++;
  }
  while (end > start && WHITE_SPACE2.test(value.charAt(end - 1))) end--;
  return value.slice(start, end);
}
function normalizePunctuation(value) {
  return trimWhitespace(value, true).replace(/[\u2010-\u2015\u2212]/gu, "-").replace(/[\u2018-\u201B]/gu, "'").replace(/[\u201C-\u201F]/gu, '"').replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, " ");
}
var MATCH_PASSES = [
  (value) => value,
  (value) => trimWhitespace(value, false),
  (value) => trimWhitespace(value, true),
  normalizePunctuation
];
function seekSequence(lines, pattern, start, eof) {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return void 0;
  const last = lines.length - pattern.length;
  const first = eof ? last : start;
  for (const normalize of MATCH_PASSES) {
    const expected = pattern.map(normalize);
    for (let index = first; index <= last; index++) {
      if (expected.every((line, offset) => normalize(lines[index + offset]) === line)) return index;
    }
  }
  return void 0;
}
function applyHunks(before, hunks) {
  const original = before.split("\n");
  if (original.at(-1) === "") original.pop();
  const replacements = [];
  let lineIndex = 0;
  for (const hunk of hunks) {
    if (hunk.context !== void 0) {
      const pattern2 = [hunk.context];
      const found2 = seekSequence(original, pattern2, lineIndex, false);
      if (found2 === void 0) {
        return { ok: false, failure: { hunkLineNumber: hunk.lineNumber, stage: "context", searchStart: lineIndex, pattern: pattern2 } };
      }
      lineIndex = found2 + 1;
    }
    if (hunk.oldLines.length === 0) {
      const start = original.at(-1) === "" ? original.length - 1 : original.length;
      replacements.push({ start, oldLength: 0, newLines: hunk.newLines });
      continue;
    }
    let pattern = hunk.oldLines;
    let newLines = hunk.newLines;
    let found = seekSequence(original, pattern, lineIndex, hunk.isEndOfFile);
    if (found === void 0 && pattern.at(-1) === "") {
      pattern = pattern.slice(0, -1);
      if (newLines.at(-1) === "") newLines = newLines.slice(0, -1);
      found = seekSequence(original, pattern, lineIndex, hunk.isEndOfFile);
    }
    if (found === void 0) {
      return {
        ok: false,
        failure: { hunkLineNumber: hunk.lineNumber, stage: "oldLines", searchStart: lineIndex, pattern: [...hunk.oldLines] }
      };
    }
    replacements.push({ start: found, oldLength: pattern.length, newLines });
    lineIndex = found + pattern.length;
  }
  replacements.sort((left, right) => left.start - right.start);
  let lines = original;
  for (const replacement of replacements.reverse()) {
    lines = [
      ...lines.slice(0, replacement.start),
      ...replacement.newLines,
      ...lines.slice(replacement.start + replacement.oldLength)
    ];
  }
  if (lines.at(-1) !== "") lines.push("");
  return { ok: true, after: lines.join("\n") };
}

// third_party/dsh-tools/packages/fs/fs-local/src/index.ts
import { constants as bufferConstants } from "node:buffer";
import { once } from "node:events";
import { watch } from "chokidar";
import { dirname as dirname2, isAbsolute as isAbsolute2, relative, resolve as resolve2, sep as sep2 } from "node:path";
import { pathToFileURL } from "node:url";
import z from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/fs/fs/src/index.ts
import { Service } from "@deepseek-ai/cordis";

// third_party/dsh-tools/packages/llm/llm/src/error.ts
var HarnessError = class extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  "i"
);
var TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  "i"
);
var EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  "i"
);

// third_party/dsh-tools/packages/fs/fs/src/types.ts
function FsTargetKey(key) {
  return key;
}
function FsVersion(v) {
  return v;
}
var FsError = class extends HarnessError {
  code;
  constructor(message, code, options) {
    super(message, code, options);
    this.code = code;
  }
};

// third_party/dsh-tools/packages/fs/fs/src/index.ts
var FileSystem = class extends Service {
  constructor(ctx2) {
    super(ctx2, "fs");
  }
  /**
   * Observe one file or a directory's direct entries in this provider's execution world.
   * @param target - resolved file or directory, including an absent path to observe for creation.
   * @param changed - invalidation callback; errors can be reported during or after initialization.
   * @param signal - cancels watcher initialization; the caller closes an initialized watcher.
   * @returns a promise resolving once observation is active, with an asynchronous close function.
   * @throws when the provider does not support watching or cannot initialize the watcher.
   */
  watch(target, changed, signal) {
    void target;
    void changed;
    signal.throwIfAborted();
    return Promise.reject(new FsError("Filesystem watching is not supported by this provider.", "FS_IO_ERROR"));
  }
  /**
   * The sandbox mode this backend enforces on mutations BY DEFAULT, or
   * `undefined` when it does not confine at all — the capability fact the tool
   * layer reads to advertise the escalation fields honestly (mirrors
   * `ShellExecutor.sandboxMode`). The base class and the bare local backend
   * report `undefined`; a sandboxing backend (`@deepseek-ai/dsh-fs-sandbox`)
   * overrides it with the deployment default. A session override may make the
   * effective mode narrower or wider, so strict escalation widening is checked
   * per call rather than encoded in this default-relative fact.
   * @returns the configured default mode of a sandboxing backend; `undefined`
   *   for a backend that never confines.
   */
  get sandboxMode() {
    return void 0;
  }
  /**
   * Map an absolute path from the harness host into this filesystem's
   * execution world when both paths identify the same file. The base provider
   * exposes no mapping; host-backed or explicitly shared backends override it.
   * @param hostPath - absolute path in the harness host filesystem.
   * @returns the process path for the same file, or undefined when this
   *   execution world cannot read that host file.
   */
  processPathFromHostPath(hostPath) {
    void hostPath;
    return void 0;
  }
};

// third_party/dsh-tools/packages/fs/fs-local/src/fsio.ts
import { randomUUID } from "node:crypto";
import { createReadStream, realpath as realpathCallback } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { TextDecoder as TextDecoder2, promisify } from "node:util";
import { homedir } from "node:os";

// third_party/dsh-tools/packages/fs/fs-local/src/win32.ts
import { toNamespacedPath } from "node:path";
var DACL_SECURITY_INFORMATION = 4;
var PROTECTED_DACL_SECURITY_INFORMATION = 2147483648;
var ERROR_FILE_NOT_FOUND = 2;
var ERROR_PATH_NOT_FOUND = 3;
var ERROR_ACCESS_DENIED = 5;
var bindings;
async function win32() {
  if (bindings !== void 0) return bindings;
  const koffi = (await import("koffi")).default;
  const advapi32 = koffi.load("advapi32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  bindings = {
    getFileSecurityW: advapi32.func("int __stdcall GetFileSecurityW(const char16_t *path, uint32_t requested, void *descriptor, uint32_t length, _Out_ uint32_t *needed)"),
    setFileSecurityW: advapi32.func("int __stdcall SetFileSecurityW(const char16_t *path, uint32_t information, const void *descriptor)"),
    replaceFileW: kernel32.func("int __stdcall ReplaceFileW(const char16_t *replaced, const char16_t *replacement, const char16_t *backup, uint32_t flags, void *exclude, void *reserved)"),
    getLastError: kernel32.func("uint32_t __stdcall GetLastError()")
  };
  return bindings;
}
function errnoCode(win32Code) {
  switch (win32Code) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return "ENOENT";
    case ERROR_ACCESS_DENIED:
      return "EACCES";
    default:
      return "EIO";
  }
}
function win32Error(syscall, win32Code, path) {
  const code = errnoCode(win32Code);
  const error = new Error(`${syscall} ${code} (Win32 ${win32Code}): ${path}`);
  error.code = code;
  error.errno = win32Code;
  error.syscall = syscall;
  error.path = path;
  error.win32Code = win32Code;
  return error;
}
async function readFileDaclWin32(path) {
  const api = await win32();
  const nativePath = toNamespacedPath(path);
  const needed = [0];
  api.getFileSecurityW(nativePath, DACL_SECURITY_INFORMATION, null, 0, needed);
  if (needed[0] === 0) throw win32Error("GetFileSecurityW", api.getLastError(), path);
  const descriptor = Buffer.alloc(needed[0]);
  if (api.getFileSecurityW(nativePath, DACL_SECURITY_INFORMATION, descriptor, descriptor.length, needed) === 0) {
    throw win32Error("GetFileSecurityW", api.getLastError(), path);
  }
  return descriptor.subarray(0, needed[0]);
}
async function copyFileDaclWin32(source, destination) {
  const descriptor = await readFileDaclWin32(source);
  const api = await win32();
  const information = (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION) >>> 0;
  if (api.setFileSecurityW(toNamespacedPath(destination), information, descriptor) === 0) {
    throw win32Error("SetFileSecurityW", api.getLastError(), destination);
  }
}
async function replaceFileWin32(replaced, replacement) {
  const api = await win32();
  if (api.replaceFileW(
    toNamespacedPath(replaced),
    toNamespacedPath(replacement),
    null,
    0,
    null,
    null
  ) === 0) {
    throw win32Error("ReplaceFileW", api.getLastError(), replaced);
  }
}

// third_party/dsh-tools/packages/fs/fs-local/src/fsio.ts
var BINARY_SAMPLE_BYTES = 8192;
var realpath = promisify(realpathCallback.native);
var DIFF_BASIS_READ_CHUNK_BYTES = 64 * 1024;
function isENOENT(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isEEXIST(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
function isENOTDIR(error) {
  return error instanceof Error && "code" in error && error.code === "ENOTDIR";
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isPermissionError(error) {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM");
}
function throwIfAborted(signal, verb) {
  if (signal?.aborted) throw new FsError(`${verb} aborted`, "FS_ABORTED");
}
async function readFileAbortable(absolutePath, verb, signal) {
  try {
    return await readFile(absolutePath, signal ? { signal } : {});
  } catch (error) {
    if (!isAbortError(error)) throw error;
    throw new FsError(`${verb} aborted`, "FS_ABORTED");
  }
}
function versionOf(info) {
  return FsVersion(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
}
function expandHomePrefix(path) {
  if (path === "~" || path.startsWith("~/") || process.platform === "win32" && path.startsWith("~\\")) return `${homedir()}${path.slice(1)}`;
  return path;
}
function localDisplayPath(cwd, path) {
  const absoluteCwd = isAbsolute(cwd) ? cwd : `${process.cwd()}${sep}${cwd}`;
  const raw = isAbsolute(path) ? path : `${absoluteCwd}${sep}${path}`;
  const physicalSpelling = /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(raw) ? raw : resolve(cwd, path);
  return process.platform === "win32" ? resolve(cwd, path) : physicalSpelling;
}
async function resolveLocalTarget(cwd, path) {
  if (path.trim().length === 0) throw new FsError("file_path must be a non-empty string", "FS_NOT_FOUND");
  const displayPath = localDisplayPath(cwd, path);
  try {
    return { displayPath, targetKey: FsTargetKey(await realpath(displayPath)) };
  } catch (error) {
    if (isENOTDIR(error)) throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, "FS_NOT_FOUND");
    if (!isENOENT(error)) throw error;
  }
  const missing = [basename(displayPath)];
  let ancestor = dirname(displayPath);
  while (true) {
    try {
      const realAncestor = await realpath(ancestor);
      if (missing.includes("..")) throw new FsError(`cannot resolve "${displayPath}": parent traversal crosses a missing directory`, "FS_NOT_FOUND");
      if (process.platform === "win32") {
        const parentInfo = await stat(realAncestor);
        if (!parentInfo.isDirectory()) {
          throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, "FS_NOT_FOUND");
        }
      }
      return { displayPath, targetKey: FsTargetKey(join(realAncestor, ...missing)) };
    } catch (error) {
      if (error instanceof FsError) throw error;
      if (!isENOENT(error)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) return { displayPath, targetKey: FsTargetKey(displayPath) };
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}
function pathType(info) {
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  return "other";
}
function pathLinkType(info) {
  if (info.isSymbolicLink()) return "symlink";
  return pathType(info);
}
async function probeStats(absolutePath, readStats) {
  try {
    return await readStats(absolutePath);
  } catch (error) {
    if (!isENOENT(error) && !isENOTDIR(error)) throw error;
    return null;
  }
}
async function probe(absolutePath) {
  const info = await probeStats(absolutePath, (path) => stat(path, { bigint: true }));
  if (!info) return null;
  return {
    version: versionOf(info),
    mode: Number(info.mode & 0o777n),
    type: pathType(info),
    size: Number(info.size)
  };
}
async function probeNoFollow(absolutePath) {
  const info = await probeStats(absolutePath, (path) => lstat(path, { bigint: true }));
  if (!info) return null;
  return {
    version: versionOf(info),
    mode: Number(info.mode & 0o777n),
    type: pathLinkType(info),
    size: Number(info.size)
  };
}
function listingIoError(displayPath, error) {
  if (error instanceof FsError) return error;
  if (isENOENT(error) || isENOTDIR(error)) return new FsError(`cannot list "${displayPath}": not found`, "FS_NOT_FOUND", { cause: error });
  if (isPermissionError(error)) return new FsError(`cannot list "${displayPath}": permission denied`, "FS_PERMISSION_DENIED", { cause: error });
  return new FsError(`cannot list "${displayPath}": ${errorMessage(error)}`, "FS_IO_ERROR", { cause: error });
}
async function resolveListedChildTarget(parent, name) {
  const identity = await resolveLocalTarget(parent.targetKey, name);
  return { displayPath: localDisplayPath(parent.displayPath, name), targetKey: identity.targetKey };
}
async function listDirectory(target, signal) {
  throwIfAborted(signal, "list");
  let info;
  try {
    info = await probe(target.targetKey);
  } catch (error) {
    throw listingIoError(target.displayPath, error);
  }
  if (!info) throw new FsError(`cannot list "${target.displayPath}": not found`, "FS_NOT_FOUND");
  if (info.type !== "directory") throw new FsError(`cannot list "${target.displayPath}": not a directory`, "FS_NOT_DIRECTORY");
  let entries;
  try {
    entries = await readdir(target.targetKey, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    throw listingIoError(target.displayPath, error);
  }
  throwIfAborted(signal, "list");
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal, "list");
    try {
      const childTarget = await resolveListedChildTarget(target, entry.name);
      const childInfo = await probe(childTarget.targetKey);
      result.push({
        name: entry.name,
        type: childInfo?.type ?? "other",
        target: childTarget,
        ...childInfo ? { version: childInfo.version } : {},
        ...childInfo?.type === "file" ? { size: childInfo.size } : {}
      });
    } catch (error) {
      throw listingIoError(localDisplayPath(target.displayPath, entry.name), error);
    }
    throwIfAborted(signal, "list");
  }
  return result;
}
function notTextError(verb, displayPath) {
  return new FsError(`cannot ${verb} "${displayPath}": invalid UTF-8 text`, "FS_NOT_TEXT");
}
function decodeUtf8(buffer, verb, displayPath) {
  try {
    return new TextDecoder2("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}
function decodeUtf8Stream(decoder2, chunk, verb, displayPath) {
  try {
    return chunk ? decoder2.decode(chunk, { stream: true }) : decoder2.decode();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}
async function statRegularFile(target, verb, signal) {
  throwIfAborted(signal, verb);
  let info;
  try {
    info = await stat(target.targetKey);
  } catch (error) {
    if (!isENOENT(error)) throw error;
    throw new FsError(`cannot ${verb} "${target.displayPath}": not found`, "FS_NOT_FOUND");
  }
  if (!info.isFile()) throw new FsError(`cannot ${verb} "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
  return info;
}
async function readWholeText(target, signal) {
  await statRegularFile(target, "read", signal);
  const raw = await readFileAbortable(target.targetKey, "read", signal);
  throwIfAborted(signal, "read");
  if (raw.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
    throw new FsError(`cannot read "${target.displayPath}": binary file`, "FS_NOT_TEXT");
  }
  return decodeUtf8(raw, "read", target.displayPath);
}
async function readWholeBytes(target, signal, maxBytes, internals = {}) {
  const info = await statRegularFile(target, "read", signal);
  if (info.size > maxBytes) {
    throw new FsError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, "FS_TOO_LARGE");
  }
  await internals.inspectReadBytesAfterStat?.(target);
  const stream = createReadStream(target.targetKey, {
    end: maxBytes,
    ...signal ? { signal } : {}
  });
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        throw new FsError(`cannot read "${target.displayPath}": content exceeds the ${maxBytes}-byte limit`, "FS_TOO_LARGE");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (isAbortError(error)) throw new FsError("read aborted", "FS_ABORTED");
    throw error;
  }
  return Buffer.concat(chunks, bytes);
}
async function readByteWindow(target, range, signal) {
  await statRegularFile(target, "read", signal);
  if (range.length === 0) return new Uint8Array(0);
  const stream = createReadStream(target.targetKey, {
    start: range.offset,
    end: range.offset + range.length - 1,
    ...signal ? { signal } : {}
  });
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      bytes += chunk.length;
    }
  } catch (error) {
    if (isAbortError(error)) throw new FsError("read aborted", "FS_ABORTED");
    throw error;
  }
  return Buffer.concat(chunks, bytes);
}
async function* streamWholeText(target, signal) {
  await statRegularFile(target, "read", signal);
  const stream = createReadStream(target.targetKey, signal ? { signal } : {});
  const decoder2 = new TextDecoder2("utf-8", { fatal: true });
  let sampledBytes = 0;
  function scanBinarySample(chunk) {
    if (sampledBytes >= BINARY_SAMPLE_BYTES) return;
    const sample = chunk.subarray(0, Math.min(chunk.length, BINARY_SAMPLE_BYTES - sampledBytes));
    if (sample.includes(0)) {
      throw new FsError(`cannot read "${target.displayPath}": binary file`, "FS_NOT_TEXT");
    }
    sampledBytes += sample.length;
  }
  try {
    for await (const chunk of stream) {
      scanBinarySample(chunk);
      yield decodeUtf8Stream(decoder2, chunk, "read", target.displayPath);
    }
    yield decodeUtf8Stream(decoder2, void 0, "read", target.displayPath);
  } catch (error) {
    if (isAbortError(error)) throw new FsError("read aborted", "FS_ABORTED");
    throw error;
  }
}
async function removeStagingDirOrThrow(stagingDir, originalError, removeStagingDir) {
  try {
    await removeStagingDir(stagingDir);
  } catch (cleanupError) {
    throw new FsError(`write failed (${errorMessage(originalError)}) and temp cleanup failed (${errorMessage(cleanupError)})`, "FS_NOT_FOUND", { cause: originalError });
  }
  throw originalError;
}
async function throwGuardedCreateFailure(error, absolutePath, displayPath, inspectPublicationTarget) {
  let existing;
  try {
    existing = await inspectPublicationTarget(absolutePath);
  } catch (metadataError) {
    if (!isENOENT(metadataError) && !isENOTDIR(metadataError)) {
      throw new FsError(`cannot write "${displayPath}": ${errorMessage(metadataError)}`, "FS_IO_ERROR", { cause: metadataError });
    }
  }
  if (existing !== void 0) {
    if (!existing.isFile()) {
      throw new FsError(`cannot write "${displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE", { cause: error });
    }
    throw new FsError(
      `cannot overwrite existing "${displayPath}" without reading it first`,
      "FS_NOT_OBSERVED",
      { cause: error }
    );
  }
  if (isEEXIST(error)) {
    throw new FsError(
      `cannot overwrite existing "${displayPath}" without reading it first`,
      "FS_NOT_OBSERVED",
      { cause: error }
    );
  }
  throw new FsError(`cannot write "${displayPath}": ${errorMessage(error)}`, "FS_IO_ERROR", { cause: error });
}
function writeIoError(path, error) {
  if (error instanceof FsError) return error;
  if (isPermissionError(error)) return new FsError(`cannot write "${path}": permission denied`, "FS_PERMISSION_DENIED", { cause: error });
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new FsError(`cannot write "${path}": ${error.message}`, "FS_IO_ERROR", { cause: error });
  }
  return error;
}
async function writeFileAtomic(absolutePath, content, mode, signal, internals = {}, options = {}) {
  const displayPath = options.displayPath ?? absolutePath;
  const existingDestination = options.existingDestination ?? mode !== void 0;
  throwIfAborted(signal, "write");
  const directory = dirname(absolutePath);
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    throw writeIoError(displayPath, error);
  }
  throwIfAborted(signal, "write");
  const stagingDirName = internals.tempDirName?.(absolutePath) ?? `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmpdir`;
  const stagingDir = join(directory, stagingDirName);
  const tempName = internals.tempName?.(absolutePath) ?? `${basename(absolutePath)}.tmp`;
  const tempPath = join(stagingDir, tempName);
  const platform = internals.platform ?? process.platform;
  const copyFileDacl = internals.copyFileDacl ?? copyFileDaclWin32;
  const replaceFile = internals.replaceFile ?? replaceFileWin32;
  const linkFile = internals.linkFile ?? link;
  const inspectPublicationTarget = internals.inspectPublicationTarget ?? ((path) => lstat(path, { bigint: true }));
  const removeStagingDir = internals.removeStagingDir ?? ((path) => rm(path, { recursive: true, force: true }));
  let handle;
  let stagingCreated = false;
  try {
    await mkdir(stagingDir, { mode: 448 });
    stagingCreated = true;
    await chmod(stagingDir, 448);
    handle = await open(tempPath, "wx", 384);
    await handle.chmod(384);
    if (platform === "win32" && existingDestination) {
      await copyFileDacl(absolutePath, tempPath);
    }
    await handle.writeFile(content, { encoding: "utf8", ...signal ? { signal } : {} });
    await handle.sync();
    await internals.inspectTemp?.({ stagingDir, tempPath });
    if (mode !== void 0) await handle.chmod(mode);
    await handle.close();
    handle = void 0;
    throwIfAborted(signal, "write");
    if (options.createIfAbsent) {
      try {
        await linkFile(tempPath, absolutePath);
      } catch (error) {
        await throwGuardedCreateFailure(error, absolutePath, displayPath, inspectPublicationTarget);
      }
    } else if (platform === "win32" && existingDestination) {
      try {
        await replaceFile(absolutePath, tempPath);
      } catch (error) {
        if (!isENOENT(error)) throw error;
        await rename(tempPath, absolutePath);
      }
    } else {
      await rename(tempPath, absolutePath);
    }
    try {
      await removeStagingDir(stagingDir);
    } catch (_committedStagingCleanupFailure) {
    }
  } catch (error) {
    let failure = isAbortError(error) ? new FsError("write aborted", "FS_ABORTED") : writeIoError(displayPath, error);
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        failure = new FsError(`write failed (${errorMessage(failure)}) and temp close failed (${errorMessage(closeError)})`, "FS_NOT_FOUND", { cause: failure });
      }
    }
    if (!stagingCreated) throw failure;
    return removeStagingDirOrThrow(stagingDir, failure, removeStagingDir);
  }
}
async function removeFile(absolutePath, displayPath, internals = {}) {
  try {
    await (internals.removeFile ?? rm)(absolutePath);
  } catch (error) {
    throw new FsError(
      `cannot delete "${displayPath}": ${errorMessage(error)}`,
      isPermissionError(error) ? "FS_PERMISSION_DENIED" : "FS_IO_ERROR",
      { cause: error }
    );
  }
}
function normalizeLineEndings(content) {
  return content.replaceAll("\r\n", "\n");
}
function detectLineEndings(raw) {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split("\r\n").length - 1;
  const lfCount = sample.split("\n").length - 1 - crlfCount;
  return crlfCount > lfCount ? "CRLF" : "LF";
}
function restoreLineEndings(content, lineEndings) {
  return lineEndings === "LF" ? content : normalizeLineEndings(content).split("\n").join("\r\n");
}
function countOccurrences(content, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}
async function readForEdit(absolutePath, displayPath, signal) {
  throwIfAborted(signal, "edit");
  const buffer = await readFileAbortable(absolutePath, "edit", signal);
  throwIfAborted(signal, "edit");
  if (buffer.includes(0)) throw new FsError(`cannot edit "${displayPath}": binary file`, "FS_NOT_TEXT");
  const raw = decodeUtf8(buffer, "edit", displayPath);
  return { content: normalizeLineEndings(raw), lineEndings: detectLineEndings(raw) };
}
async function readTextForDiff(absolutePath, maxBytes, signal) {
  throwIfAborted(signal, "read");
  try {
    const handle = await open(absolutePath, "r");
    let buffer;
    let total = 0;
    let openedSize = 0;
    try {
      throwIfAborted(signal, "read");
      const info = await handle.stat();
      throwIfAborted(signal, "read");
      if (!info.isFile()) return null;
      if (info.size >= maxBytes) return null;
      openedSize = info.size;
      buffer = Buffer.allocUnsafe(openedSize + 1);
      while (total < buffer.length) {
        throwIfAborted(signal, "read");
        const length = Math.min(buffer.length - total, DIFF_BASIS_READ_CHUNK_BYTES);
        const { bytesRead } = await handle.read(buffer, total, length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
    } finally {
      await handle.close();
    }
    throwIfAborted(signal, "read");
    if (total !== openedSize) return null;
    const basis = buffer.subarray(0, total);
    if (basis.includes(0)) return null;
    try {
      return normalizeLineEndings(new TextDecoder2("utf-8", { fatal: true }).decode(basis));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return null;
    }
  } catch (error) {
    if (error instanceof FsError) throw error;
    if (error instanceof Error && "code" in error) return null;
    throw error;
  }
}
function applyLiteralEdit(content, oldString, newString, replaceAll, displayPath) {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0) {
    throw new FsError("old_string must be a non-empty string", "FS_EDIT_NOT_FOUND");
  }
  const newNorm = normalizeLineEndings(newString);
  const replacements = countOccurrences(content, oldNorm);
  if (replacements === 0) {
    throw new FsError(`old_string was not found in "${displayPath}"`, "FS_EDIT_NOT_FOUND");
  }
  if (!replaceAll && replacements > 1) {
    throw new FsError(`old_string matched ${replacements} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`, "FS_AMBIGUOUS_EDIT");
  }
  return { content: content.split(oldNorm).join(newNorm), replacements };
}

// third_party/dsh-tools/packages/fs/fs-local/src/index.ts
var DEFAULT_DIFF_BASIS_MAX_BYTES = 10 * 1024 * 1024;
var MAX_DIFF_BASIS_BYTES = Math.min(
  bufferConstants.MAX_LENGTH,
  bufferConstants.MAX_STRING_LENGTH
);
var LocalFileSystem = class extends FileSystem {
  async watch(target, changed, signal) {
    signal.throwIfAborted();
    const path = resolve2(this.processPath(target));
    const directory = (await this.stat(target, signal))?.type === "directory";
    signal.throwIfAborted();
    const root = directory ? path : dirname2(path);
    const watcher = watch(root, {
      ignoreInitial: true,
      depth: 0,
      ignored: (entry) => !directory && resolve2(entry) !== root && resolve2(entry) !== path
    });
    watcher.on("all", (_event, entry) => {
      if (directory || resolve2(entry) === path) changed();
    });
    watcher.on("error", (error) => {
      changed(error instanceof Error ? error : new Error(String(error)));
    });
    try {
      await once(watcher, "ready", { signal });
      return () => watcher.close();
    } catch (error) {
      await watcher.close();
      throw error;
    }
  }
  static Config = z.object({
    cwd: z.string().default(process.cwd()),
    diffBasisMaxBytes: z.number().default(DEFAULT_DIFF_BASIS_MAX_BYTES)
  });
  /** Validated config (schemastery applied the defaults before construction). */
  config;
  /** Test hook forwarded to fsio for atomic-publication boundaries. */
  internals = {};
  /** Per-targetKey tail promise: serializes mutating ops so the read→guard→write
   * window can't interleave, making concurrent writes/edits deterministically
   * ordered (one wins, the rest see the new version and reject as stale). */
  locks = /* @__PURE__ */ new Map();
  constructor(ctx2, config) {
    super(ctx2);
    const resolved = config;
    if (!Number.isSafeInteger(resolved.diffBasisMaxBytes) || resolved.diffBasisMaxBytes <= 0 || resolved.diffBasisMaxBytes > MAX_DIFF_BASIS_BYTES) {
      throw new Error(`fs-local: diffBasisMaxBytes must be a positive safe integer no greater than ${MAX_DIFF_BASIS_BYTES}`);
    }
    this.config = resolved;
  }
  /** Run one mutation under the same lock ordering as multi-target operations. */
  withLock(targetKey, op) {
    return this.withLocks([targetKey], op);
  }
  /** Acquire distinct keys in lexical order and release inner locks before outer locks. */
  withLocks(keys, op) {
    const ordered = [...new Set(keys)].sort();
    const acquire = async (index) => {
      const key = ordered[index];
      if (key === void 0) return op();
      const prior = this.locks.get(key) ?? Promise.resolve();
      const run = prior.then(() => acquire(index + 1));
      const tail = run.then(() => void 0, () => void 0);
      this.locks.set(key, tail);
      try {
        return await run;
      } finally {
        if (this.locks.get(key) === tail) this.locks.delete(key);
      }
    };
    return acquire(0);
  }
  async resolve(path, opts) {
    if (opts?.signal?.aborted) throw new FsError("resolve aborted", "FS_ABORTED");
    const local = await resolveLocalTarget(opts?.cwd ?? this.config.cwd, expandHomePrefix(path));
    if (opts?.signal?.aborted) throw new FsError("resolve aborted", "FS_ABORTED");
    return { targetKey: local.targetKey, displayPath: local.displayPath };
  }
  processPath(target) {
    return String(target.targetKey);
  }
  processPathFromHostPath(hostPath) {
    return isAbsolute2(hostPath) ? resolve2(hostPath) : void 0;
  }
  fileUrl(target) {
    return pathToFileURL(this.processPath(target)).href;
  }
  contains(parent, child) {
    const path = relative(this.processPath(parent), this.processPath(child));
    return path === "" || path !== ".." && !path.startsWith(`..${sep2}`) && !isAbsolute2(path);
  }
  async stat(target, signal) {
    if (signal?.aborted) throw new FsError("stat aborted", "FS_ABORTED");
    const info = await probe(target.targetKey);
    if (signal?.aborted) throw new FsError("stat aborted", "FS_ABORTED");
    if (!info) return void 0;
    return { version: info.version, type: info.type, size: info.size };
  }
  async lstat(path, opts, signal) {
    if (signal?.aborted) throw new FsError("lstat aborted", "FS_ABORTED");
    if (path.trim().length === 0) throw new FsError("file_path must be a non-empty string", "FS_NOT_FOUND");
    const cwd = opts?.cwd ?? this.config.cwd;
    const info = await probeNoFollow(localDisplayPath(cwd, expandHomePrefix(path)));
    if (signal?.aborted) throw new FsError("lstat aborted", "FS_ABORTED");
    if (!info) return void 0;
    return { version: info.version, type: info.type, size: info.size };
  }
  async readText(target, signal) {
    return readWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, signal);
  }
  streamText(target, signal) {
    return Promise.resolve(streamWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, signal));
  }
  async readBytes(target, signal, maxBytes) {
    return readWholeBytes({ displayPath: target.displayPath, targetKey: target.targetKey }, signal, maxBytes, this.internals);
  }
  async readByteRange(target, range, signal) {
    return readByteWindow({ displayPath: target.displayPath, targetKey: target.targetKey }, range, signal);
  }
  async listDir(target, signal) {
    const entries = await listDirectory({ displayPath: target.displayPath, targetKey: target.targetKey }, signal);
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.type,
      target: { targetKey: entry.target.targetKey, displayPath: entry.target.displayPath },
      ...entry.version !== void 0 ? { version: entry.version } : {},
      ...entry.size !== void 0 ? { size: entry.size } : {}
    }));
  }
  async writeText(target, content, expected, signal) {
    return this.withLock(target.targetKey, async () => {
      const existing = await this.writeTarget(target, expected);
      const diffable = existing !== null && Buffer.byteLength(content, "utf8") < this.config.diffBasisMaxBytes;
      const before = diffable ? await readTextForDiff(target.targetKey, this.config.diffBasisMaxBytes, signal) : null;
      await writeFileAtomic(
        target.targetKey,
        content,
        existing?.mode,
        signal,
        this.internals,
        { displayPath: target.displayPath, createIfAbsent: expected?.kind === "createIfAbsent" }
      );
      const after = await probe(target.targetKey);
      return {
        operation: existing ? "update" : "create",
        version: this.versionAfterWrite(after, target),
        before,
        // LF-normalized to share the diff basis with `before` (also LF): a CRLF
        // overwrite must not read as every line changed. Line-ending restoration
        // is a storage detail the applied-hunk diff ignores.
        after: normalizeLineEndings(content)
      };
    });
  }
  async editText(target, edit, expected, signal) {
    return this.withLock(target.targetKey, async () => {
      const existing = await probe(target.targetKey);
      if (!existing) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      if (existing.type !== "file") throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      if (expected && existing.version !== expected.version) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      }
      const original = await readForEdit(target.targetKey, target.displayPath, signal);
      const edited = applyLiteralEdit(original.content, edit.oldString, edit.newString, edit.replaceAll, target.displayPath);
      const content = restoreLineEndings(edited.content, original.lineEndings);
      await writeFileAtomic(target.targetKey, content, existing.mode, signal, this.internals, { displayPath: target.displayPath });
      const after = await probe(target.targetKey);
      return {
        version: this.versionAfterWrite(after, target),
        // The LF-normalized before/after text (the applied-hunk diff basis);
        // line-ending restoration is a storage detail the diff ignores.
        before: original.content,
        after: edited.content
      };
    });
  }
  async patchText(target, hunks, expected, signal) {
    return this.withLock(target.targetKey, async () => {
      const existing = await this.requireFile(target, expected, "patch");
      const original = await readForEdit(target.targetKey, target.displayPath, signal);
      const after = this.patchContent(target, original.content, hunks);
      await writeFileAtomic(
        target.targetKey,
        restoreLineEndings(after, original.lineEndings),
        existing.mode,
        signal,
        this.internals,
        { displayPath: target.displayPath }
      );
      return { version: this.versionAfterWrite(await probe(target.targetKey), target), before: original.content, after };
    });
  }
  async deleteFile(target, expected, signal) {
    return this.withLock(target.targetKey, async () => {
      await this.requireFile(target, expected, "delete");
      const before = await readTextForDiff(target.targetKey, this.config.diffBasisMaxBytes, signal);
      await this.internals.inspectBeforeMutation?.(target);
      if (signal?.aborted) throw new FsError("delete aborted", "FS_ABORTED");
      await removeFile(target.targetKey, target.displayPath, this.internals);
      return { before };
    });
  }
  async moveFile(source, destination, options, signal) {
    if (source.targetKey === destination.targetKey) {
      throw new FsError(`cannot move "${source.displayPath}" to itself`, "FS_SAME_TARGET");
    }
    return this.withLocks([source.targetKey, destination.targetKey], async () => {
      const sourceInfo = await this.requireFile(source, options.expectedSource, "move");
      const existing = await this.writeTarget(destination, options.expectedDestination);
      const original = await readForEdit(source.targetKey, source.displayPath, signal);
      const after = options.hunks === void 0 ? original.content : this.patchContent(source, original.content, options.hunks);
      const content = restoreLineEndings(after, original.lineEndings);
      const before = existing && Buffer.byteLength(content, "utf8") < this.config.diffBasisMaxBytes ? await readTextForDiff(destination.targetKey, this.config.diffBasisMaxBytes, signal) : null;
      await this.internals.inspectBeforeMutation?.(source);
      if (signal?.aborted) throw new FsError("move aborted", "FS_ABORTED");
      await writeFileAtomic(destination.targetKey, content, sourceInfo.mode, void 0, this.internals, {
        displayPath: destination.displayPath,
        createIfAbsent: options.expectedDestination?.kind === "createIfAbsent",
        existingDestination: existing !== null
      });
      const outcome = {
        operation: existing ? "update" : "create",
        version: this.versionAfterWrite(await probe(destination.targetKey), destination),
        before,
        after
      };
      const sourceBefore = Buffer.byteLength(original.content, "utf8") < this.config.diffBasisMaxBytes ? original.content : null;
      try {
        await removeFile(source.targetKey, source.displayPath, this.internals);
      } catch (error) {
        if (!(error instanceof FsError)) throw error;
        return { sourceBefore, destination: outcome, sourceDeleted: false, sourceFailure: { code: error.code, message: error.message } };
      }
      return { sourceBefore, destination: outcome, sourceDeleted: true };
    });
  }
  async writeTarget(target, expected) {
    const existing = await probe(target.targetKey);
    if (existing && existing.type !== "file") {
      throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
    }
    if (expected?.kind === "replaceIfVersion") {
      if (!existing) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
      if (existing.version !== expected.version) {
        throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      }
    } else if (expected?.kind === "createIfAbsent" && existing) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
    }
    return existing;
  }
  async requireFile(target, expected, verb) {
    const existing = await probe(target.targetKey);
    if (!existing) throw new FsError(`cannot ${verb} "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
    if (existing.type !== "file") throw new FsError(`cannot ${verb} "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
    if (expected && existing.version !== expected.version) {
      throw new FsError(`cannot ${verb} "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
    }
    return existing;
  }
  patchContent(target, before, hunks) {
    const result = applyHunks(before, hunks);
    if (!result.ok) {
      throw new FsError(`cannot patch "${target.displayPath}": hunk at patch line ${result.failure.hunkLineNumber} (${result.failure.stage}) does not match`, "FS_PATCH_MISMATCH");
    }
    return result.after;
  }
  /* v8 ignore next 5 -- the post-write probe finding the file absent requires a
   * concurrent unlink between rename and stat; fall back to a sentinel version. */
  versionAfterWrite(after, target) {
    if (after) return after.version;
    return FsVersion(`missing:${target.targetKey}`);
  }
};

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/index.ts
import { constants as constants2 } from "node:fs";
import { access, stat as stat2 } from "node:fs/promises";
import { userInfo } from "node:os";
import { delimiter, extname as extname2, isAbsolute as isAbsolute5, resolve as resolve3 } from "node:path";

// third_party/dsh-tools/packages/util/lazy-require/src/index.ts
import { createRequire } from "node:module";
function createLazyRequire(specifier, parentURL) {
  const require2 = createRequire(parentURL);
  let loaded = false;
  let value;
  return () => {
    if (!loaded) {
      value = require2(specifier);
      loaded = true;
    }
    return value;
  };
}

// third_party/dsh-tools/packages/subprocess/subprocess/src/index.ts
import { Service as Service2 } from "@deepseek-ai/cordis";

// third_party/dsh-tools/packages/util/http-proxy/src/policy.ts
var POLICY_ENV_NAMES = {
  httpProxy: ["http_proxy", "HTTP_PROXY"],
  httpsProxy: ["https_proxy", "HTTPS_PROXY"],
  noProxy: ["no_proxy", "NO_PROXY"]
};
var PROXY_ENV_NAMES = [
  ...Object.values(POLICY_ENV_NAMES).flat(),
  "all_proxy",
  "ALL_PROXY"
];
var SUPPORTED_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
function isSupportedProxyUrl(value) {
  const parsed = URL.parse(value);
  return parsed !== null && SUPPORTED_PROTOCOLS.has(parsed.protocol);
}
var OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
var LOOPBACK_IPV4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

// third_party/dsh-tools/packages/util/http-proxy/src/install.ts
var active;
var inheritedProxyEnv;
function proxyEnvironmentForChild() {
  const policy = active;
  const inherited = inheritedProxyEnv;
  if (policy === void 0 || policy.source === "none" || inherited === void 0) return {};
  const overlay = { NODE_USE_ENV_PROXY: "1" };
  for (const [field, names] of Object.entries(POLICY_ENV_NAMES)) {
    const resolved = policy[field];
    const named = field !== "noProxy" && names.some((name) => inherited[name] !== void 0);
    for (const name of names) overlay[name] = named ? inherited[name] : resolved;
  }
  const parsedByNode = [...POLICY_ENV_NAMES.httpProxy, ...POLICY_ENV_NAMES.httpsProxy];
  if (parsedByNode.some((name) => overlay[name] !== void 0 && !isSupportedProxyUrl(overlay[name]))) {
    delete overlay.NODE_USE_ENV_PROXY;
  }
  return overlay;
}

// third_party/dsh-tools/packages/subprocess/subprocess/src/types.ts
var DSH_ENV_PREFIX = "DSH_";

// third_party/dsh-tools/packages/subprocess/subprocess/src/index.ts
var SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
function scrubbedParentEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0 && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) env[key] = value;
  }
  for (const [name, value] of Object.entries(proxyEnvironmentForChild())) {
    if (value === void 0) Reflect.deleteProperty(env, name);
    else env[name] = value;
  }
  return env;
}
var SubprocessRuntime = class extends Service2 {
  constructor(ctx2) {
    super(ctx2, "subprocess");
  }
};
var SubprocessExecutableNotFoundError = class extends Error {
  /**
   * @param message - provider-specific lookup diagnostic.
   * @param options - original provider failure, when available.
   */
  constructor(message, options) {
    super(message, options);
    this.name = "SubprocessExecutableNotFoundError";
  }
};

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/spawn.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { setTimeout as sleepMs } from "node:timers/promises";

// third_party/dsh-tools/packages/util/timeout/src/index.ts
var MAX_TIMER_DELAY_MS = 2147483647;

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/managed-owner.ts
async function waitWithAbort(pending, signal) {
  if (signal?.aborted) {
    void pending.catch(() => {
    });
    return false;
  }
  if (signal === void 0) {
    await pending;
    return true;
  }
  const aborted = Promise.withResolvers();
  const onAbort = () => {
    aborted.resolve(false);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([pending.then(() => true), aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// third_party/dsh-tools/packages/subprocess/subprocess/src/control.ts
var SUBPROCESS_CONTROL_FD = 7;
var SUBPROCESS_CONTROL_ENV = "DSH_SUBPROCESS_CONTROL";

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/control-spawn.ts
function controlPipe(child, control) {
  const streams = child.stdio;
  return control === "pipe" ? streams[SUBPROCESS_CONTROL_FD] : void 0;
}
function controlEnvironment(env, control) {
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === SUBPROCESS_CONTROL_ENV && value !== void 0) {
      throw new Error(`${SUBPROCESS_CONTROL_ENV} is reserved for subprocess control-channel setup`);
    }
  }
  if (control === "pipe") Object.assign(env, { [SUBPROCESS_CONTROL_ENV]: "pipe" });
  return env;
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/process-inspector.ts
import { closeSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/windows-inspector.ts
import { spawnSync } from "node:child_process";
var requireKoffi = createLazyRequire("koffi", import.meta.url);
function windowsProcessTree(entries, rootPid, started) {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const root = byPid.get(rootPid);
  if (root === void 0) return [];
  const byParent = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? [];
    children.push(entry);
    byParent.set(entry.parentPid, children);
  }
  const visited = /* @__PURE__ */ new Set();
  const result = [];
  const visit = (entry) => {
    if (visited.has(entry.pid)) return;
    visited.add(entry.pid);
    for (const child of byParent.get(entry.pid) ?? []) visit(child);
    const identity = started(entry.pid);
    if (identity !== void 0) result.push({ pid: entry.pid, started: identity });
  };
  visit(root);
  return result;
}
var WindowsProcessInspector = class {
  constructor(internals = defaultWindowsProcessInternals()) {
    this.internals = internals;
  }
  internals;
  foregroundPgid(shellPid) {
    return shellPid;
  }
  isStdinWaiting(_pgid, _shellPid) {
    return false;
  }
  isAlive(identity) {
    const state = this.internals.processState(identity.pid);
    return state?.active === true && state.started === identity.started;
  }
  snapshot() {
    let entries;
    return {
      tree: (rootPid) => windowsProcessTree(
        entries ??= this.internals.snapshot(),
        rootPid,
        (pid) => this.internals.processState(pid)?.started
      ),
      // Windows has no POSIX sessions; the shell pid stands in as a pseudo group.
      session: () => [],
      alive: (identity) => this.isAlive(identity)
    };
  }
  signalGroup(pgid, signal) {
    this.internals.taskkill(pgid, signal === "SIGKILL");
  }
  signalProcess(identity, signal) {
    if (this.isAlive(identity)) this.internals.taskkill(identity.pid, signal === "SIGKILL");
  }
};
function createWindowsProcessInspector(internals = defaultWindowsProcessInternals()) {
  return new WindowsProcessInspector(internals);
}
function taskkillTree(pid, force) {
  if (pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", ...force ? ["/F"] : []], {
    stdio: "ignore",
    windowsHide: true
  });
}
function isInvalidHandle(value) {
  if (value === null || value === void 0) return true;
  const asBigInt = value;
  return asBigInt === 0n || asBigInt === 0xFFFFFFFFFFFFFFFFn || asBigInt === -1n;
}
function win32Structs() {
  if (cachedStructs !== void 0) return cachedStructs;
  const koffi = requireKoffi();
  const PVOID = koffi.pointer("void");
  const PROCESSENTRY32W = koffi.struct("PROCESSENTRY32W", {
    dwSize: "uint32",
    cntUsage: "uint32",
    th32ProcessID: "uint32",
    th32DefaultHeapID: PVOID,
    th32ModuleID: "uint32",
    cCntThreads: "uint32",
    th32ParentProcessID: "uint32",
    pcPriClassBase: "int32",
    dwFlags: "uint32",
    szExeFile: koffi.array("char16", 260)
  });
  const FILETIME = koffi.struct("FILETIME", {
    dwLowDateTime: "uint32",
    dwHighDateTime: "uint32"
  });
  if (PROCESSENTRY32W.size !== 568) {
    throw new Error(`PROCESSENTRY32W layout mismatch: koffi computed ${PROCESSENTRY32W.size}, Windows headers say 568`);
  }
  cachedStructs = { PVOID, PROCESSENTRY32W, FILETIME };
  return cachedStructs;
}
var cachedStructs;
var TH32CS_SNAPPROCESS = 2;
var PROCESS_QUERY_LIMITED_INFORMATION = 4096;
var SYNCHRONIZE = 1048576;
var WAIT_OBJECT_0 = 0;
var WAIT_TIMEOUT = 258;
var cachedBindings;
function win32Bindings() {
  if (cachedBindings !== void 0) return cachedBindings;
  const koffi = requireKoffi();
  const { PVOID, PROCESSENTRY32W, FILETIME } = win32Structs();
  const kernel32 = koffi.load("kernel32.dll");
  const bind = (name, result, args) => kernel32.func("__stdcall", name, result, args);
  cachedBindings = {
    createToolhelp32Snapshot: bind("CreateToolhelp32Snapshot", PVOID, ["uint32", "uint32"]),
    process32FirstW: bind("Process32FirstW", "int", [PVOID, koffi.pointer(PROCESSENTRY32W)]),
    process32NextW: bind("Process32NextW", "int", [PVOID, koffi.pointer(PROCESSENTRY32W)]),
    openProcess: bind("OpenProcess", PVOID, ["uint32", "int", "uint32"]),
    getProcessTimes: bind("GetProcessTimes", "int", [
      PVOID,
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME)
    ]),
    waitForSingleObject: bind("WaitForSingleObject", "uint32", [PVOID, "uint32"]),
    closeHandle: bind("CloseHandle", "int", [PVOID])
  };
  return cachedBindings;
}
function allocNative(type, count) {
  const koffi = requireKoffi();
  const value = koffi.alloc(type, count);
  return value;
}
function snapshotWindowsProcesses(bindings3) {
  const koffi = requireKoffi();
  const { PROCESSENTRY32W } = win32Structs();
  const snapshot = bindings3.createToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (isInvalidHandle(snapshot)) return [];
  const entries = [];
  try {
    const entry = allocNative(PROCESSENTRY32W, 1);
    koffi.encode(entry, "uint32", PROCESSENTRY32W.size);
    let ok = bindings3.process32FirstW(snapshot, entry);
    while (ok !== 0) {
      const record = koffi.decode(entry, PROCESSENTRY32W);
      entries.push({ pid: record.th32ProcessID, parentPid: record.th32ParentProcessID });
      ok = bindings3.process32NextW(snapshot, entry);
    }
  } finally {
    bindings3.closeHandle(snapshot);
  }
  return entries;
}
function windowsProcessState(bindings3, pid) {
  const koffi = requireKoffi();
  const { FILETIME } = win32Structs();
  const handle = bindings3.openProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid);
  if (isInvalidHandle(handle)) return void 0;
  try {
    const creation = allocNative(FILETIME, 1);
    const exit = allocNative(FILETIME, 1);
    const kernel = allocNative(FILETIME, 1);
    const user = allocNative(FILETIME, 1);
    if (bindings3.getProcessTimes(handle, creation, exit, kernel, user) === 0) return void 0;
    const record = koffi.decode(creation, FILETIME);
    const wait = bindings3.waitForSingleObject(handle, 0);
    if (wait !== WAIT_OBJECT_0 && wait !== WAIT_TIMEOUT) return void 0;
    return {
      started: `${record.dwHighDateTime}:${record.dwLowDateTime}`,
      active: wait === WAIT_TIMEOUT
    };
  } finally {
    bindings3.closeHandle(handle);
  }
}
function defaultWindowsProcessInternals() {
  return {
    snapshot: () => snapshotWindowsProcesses(win32Bindings()),
    processState: (pid) => windowsProcessState(win32Bindings(), pid),
    taskkill: taskkillTree
  };
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/process-inspector.ts
var DEFAULT_INTERNALS = {
  readFile: (path) => readFileSync(path, "utf8"),
  readDir: (path) => readdirSync(path),
  readLink: (path) => readlinkSync(path, "utf8"),
  stat: (path) => statSync(path),
  open: (path) => openSync(path, "r"),
  read: (fd, buffer, length, position) => readSync(fd, buffer, 0, length, position),
  close: closeSync,
  exec: (file, args) => execFileSync(file, args, { encoding: "utf8" }),
  kill: (pid, signal) => process.kill(pid, signal)
};
function parseProcStat(text) {
  const open2 = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open2 <= 0 || close <= open2) return void 0;
  const pid = Number(text.slice(0, open2).trim());
  const rest = text.slice(close + 2).trim().split(/\s+/);
  const state = rest[0] || "";
  const parentPid = Number(rest[1]);
  const pgrp = Number(rest[2]);
  const session = Number(rest[3]);
  const ttyDevice = Number(rest[4]);
  const tpgid = Number(rest[5]);
  const started = rest[19];
  if (![pid, parentPid, pgrp, session, ttyDevice, tpgid].every(Number.isSafeInteger) || state.length !== 1 || started === void 0) return void 0;
  return { pid, parentPid, pgrp, session, state, ttyDevice, tpgid, started };
}
function readLinuxStat(internals, pid) {
  try {
    return parseProcStat(internals.readFile(`/proc/${pid}/stat`));
  } catch (_unreadableProcEntry) {
    return void 0;
  }
}
function linuxDeviceNumber(value) {
  return value >>> 0;
}
function readLinuxTerminalDevice(internals, pid, ttyDevice, tid) {
  const terminalDevice = linuxDeviceNumber(ttyDevice);
  if (terminalDevice === 0) return void 0;
  const path = tid === void 0 ? `/proc/${pid}/fd/0` : `/proc/${pid}/task/${tid}/fd/0`;
  try {
    const target = internals.readLink(path);
    if (target === "/dev/tty") return terminalDevice;
    const status = internals.stat(path);
    return status.isCharacterDevice() && linuxDeviceNumber(status.rdev) === terminalDevice ? terminalDevice : void 0;
  } catch (_unreadableStdinDevice) {
    return void 0;
  }
}
function linuxProcessGroupHasLiveMembers(processGroupId, internals = DEFAULT_INTERNALS) {
  let entries;
  try {
    entries = internals.readDir("/proc");
  } catch (_unreadableProcDirectory) {
    return void 0;
  }
  let matched = false;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const stat3 = readLinuxStat(internals, Number(entry));
    if (stat3?.pgrp !== processGroupId) continue;
    matched = true;
    if (!/^[ZXx]$/.test(stat3.state)) return true;
  }
  return matched ? false : void 0;
}
function numericEntries(internals, path) {
  try {
    return internals.readDir(path).filter((entry) => /^\d+$/.test(entry)).map(Number);
  } catch (_unreadableProcDirectory) {
    return void 0;
  }
}
function readSyscall(internals, pid, tid) {
  try {
    const text = internals.readFile(`/proc/${pid}/task/${tid}/syscall`).trim();
    if (text === "running" || text.startsWith("-1 ")) return void 0;
    const fields = text.split(/\s+/);
    const number = Number(fields[0]);
    const args = fields.slice(1, 7).map((field) => Number.parseInt(field, 16));
    if (!Number.isSafeInteger(number) || args.some((value) => !Number.isSafeInteger(value))) return void 0;
    return { number, args };
  } catch (_unreadableSyscall) {
    return void 0;
  }
}
function readMemory(internals, pid, address, length) {
  let fd;
  try {
    fd = internals.open(`/proc/${pid}/mem`);
    const buffer = Buffer.alloc(length);
    const count = internals.read(fd, buffer, length, address);
    return buffer.subarray(0, count);
  } catch (_unreadableProcessMemory) {
    return void 0;
  } finally {
    if (fd !== void 0) internals.close(fd);
  }
}
function fdSetHasStdin(internals, pid, address) {
  return address !== 0 && (readMemory(internals, pid, address, 8)?.[0] ?? 0) % 2 === 1;
}
function pollHasStdin(internals, pid, address, count) {
  if (address === 0 || count <= 0) return false;
  const memory = readMemory(internals, pid, address, Math.min(count, 1024) * 8);
  if (memory === void 0) return false;
  for (let offset = 0; offset + 8 <= memory.length; offset += 8) {
    if (memory.readInt32LE(offset) === 0 && (memory.readInt16LE(offset + 4) & 1) !== 0) return true;
  }
  return false;
}
function epollHasStdin(internals, pid, tid, epfd) {
  try {
    return internals.readFile(`/proc/${pid}/task/${tid}/fdinfo/${epfd}`).split("\n").some((line) => /^tfd:\s+0\b/.test(line.trim()));
  } catch (_unreadableFdInfo) {
    return false;
  }
}
var SYSCALLS = {
  x64: { read: 0, select: 23, pselect: 270, poll: 7, ppoll: 271, epollWait: 232, epollPwait: 281 },
  arm64: { read: 63, pselect: 72, ppoll: 73, epollPwait: 22 }
};
var SUPPORTED_SYSCALL_TABLES = Object.values(SYSCALLS);
function linuxSyscallTables(arch) {
  const primary = SYSCALLS[arch];
  if (primary === void 0) return void 0;
  return [primary, ...SUPPORTED_SYSCALL_TABLES.filter((table) => table !== primary)];
}
function syscallWaitsOnStdin(internals, pid, tid, syscall, tables) {
  const [a0 = 0, a1 = 0, a2 = 0] = syscall.args;
  for (const table of tables) {
    if (syscall.number === table.read) return a0 === 0;
    if (syscall.number === table.select || syscall.number === table.pselect) {
      return a0 >= 1 && fdSetHasStdin(internals, pid, a1);
    }
    if (syscall.number === table.poll || syscall.number === table.ppoll) {
      return a1 >= 1 && pollHasStdin(internals, pid, a0, a1);
    }
    if (syscall.number === table.epollWait || syscall.number === table.epollPwait) {
      return a2 >= 1 && epollHasStdin(internals, pid, tid, a0);
    }
  }
  return false;
}
var PosixProcessInspector = class {
  constructor(internals) {
    this.internals = internals;
  }
  internals;
  signalGroup(pgid, signal) {
    this.internals.kill(-pgid, signal);
  }
  signalProcess(identity, signal) {
    if (this.isAlive(identity)) this.internals.kill(identity.pid, signal);
  }
};
function quiescent(state) {
  return state !== void 0 && /^[ZXx]$/.test(state);
}
var PosixProcessSnapshot = class {
  constructor(rows, complete) {
    this.rows = rows;
    this.complete = complete;
    this.byPid = new Map(rows.map((row) => [row.pid, row]));
  }
  rows;
  complete;
  byPid;
  tree(rootPid) {
    return processTree(this.rows, rootPid);
  }
  session(sessionId) {
    return this.rows.flatMap((row) => row.session === sessionId ? [{ pid: row.pid, started: row.started }] : []);
  }
  alive(identity) {
    const row = this.byPid.get(identity.pid);
    return row?.started === identity.started && !quiescent(row.state);
  }
};
function processTree(entries, rootPid) {
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const root = byPid.get(rootPid);
  if (root === void 0) return [];
  const byParent = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? [];
    children.push(entry);
    byParent.set(entry.parentPid, children);
  }
  const visited = /* @__PURE__ */ new Set();
  const result = [];
  const visit = (entry) => {
    if (visited.has(entry.pid)) return;
    visited.add(entry.pid);
    for (const child of byParent.get(entry.pid) ?? []) visit(child);
    result.push({ pid: entry.pid, started: entry.started });
  };
  visit(root);
  return result;
}
var LinuxProcessInspector = class extends PosixProcessInspector {
  constructor(arch, internals) {
    super(internals);
    this.arch = arch;
  }
  arch;
  foregroundPgid(shellPid) {
    const tpgid = readLinuxStat(this.internals, shellPid)?.tpgid;
    return tpgid !== void 0 && tpgid > 0 ? tpgid : void 0;
  }
  isStdinWaiting(pgid, shellPid) {
    const tables = linuxSyscallTables(this.arch);
    if (tables === void 0) return false;
    const shell = readLinuxStat(this.internals, shellPid);
    if (shell === void 0) return false;
    const terminalDevice = readLinuxTerminalDevice(this.internals, shellPid, shell.ttyDevice);
    if (terminalDevice === void 0) return false;
    for (const pid of numericEntries(this.internals, "/proc") ?? []) {
      const process2 = readLinuxStat(this.internals, pid);
      if (process2?.pgrp !== pgid) continue;
      for (const tid of numericEntries(this.internals, `/proc/${pid}/task`) ?? []) {
        const syscall = readSyscall(this.internals, pid, tid);
        if (syscall !== void 0 && syscallWaitsOnStdin(this.internals, pid, tid, syscall, tables) && readLinuxTerminalDevice(this.internals, pid, process2.ttyDevice, tid) === terminalDevice) return true;
      }
    }
    return false;
  }
  isAlive(identity) {
    const stat3 = readLinuxStat(this.internals, identity.pid);
    return stat3?.started === identity.started && !quiescent(stat3.state);
  }
  snapshot() {
    const pids = numericEntries(this.internals, "/proc");
    if (pids === void 0) throw new Error("Cannot inspect processes: /proc directory is unreadable");
    let complete = true;
    const rows = pids.flatMap((pid) => {
      const stat3 = readLinuxStat(this.internals, pid);
      if (stat3 === void 0) complete = false;
      return stat3 === void 0 ? [] : [{
        pid,
        parentPid: stat3.parentPid,
        started: stat3.started,
        session: stat3.session,
        state: stat3.state
      }];
    });
    return new PosixProcessSnapshot(rows, complete);
  }
};
function macProcessTable(internals) {
  let complete = true;
  const rows = internals.exec("/bin/ps", ["-axo", "pid=,ppid=,lstart="]).split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match?.[1] === void 0 || match[2] === void 0 || match[3] === void 0) {
      if (line.trim().length > 0) complete = false;
      return [];
    }
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      started: match[3],
      session: void 0,
      state: void 0
    }];
  });
  return { rows, complete };
}
var MacProcessInspector = class extends PosixProcessInspector {
  foregroundPgid(shellPid) {
    try {
      const value = Number(this.internals.exec("/bin/ps", ["-o", "tpgid=", "-p", String(shellPid)]).trim());
      return Number.isSafeInteger(value) && value > 0 ? value : void 0;
    } catch (_missingProcess) {
      return void 0;
    }
  }
  isStdinWaiting(_pgid, _shellPid) {
    return false;
  }
  isAlive(identity) {
    return macProcessTable(this.internals).rows.some((entry) => entry.pid === identity.pid && entry.started === identity.started);
  }
  snapshot() {
    const table = macProcessTable(this.internals);
    return new PosixProcessSnapshot(table.rows, table.complete);
  }
};
function createProcessInspector(platform = process.platform, arch = process.arch, internals = DEFAULT_INTERNALS) {
  if (platform === "linux") return new LinuxProcessInspector(arch, internals);
  if (platform === "darwin") return new MacProcessInspector(internals);
  if (platform === "win32") return createWindowsProcessInspector();
  throw new Error(`subprocess-local: terminal inspection is unsupported on platform ${platform}`);
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/output.ts
import { randomBytes } from "node:crypto";
import { closeSync as closeSync2, mkdtempSync, openSync as openSync2, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir } from "node:os";
var spillCounter = 0;
var defaultSpillDir;
function privateSpillDir() {
  defaultSpillDir ??= mkdtempSync(join2(tmpdir(), "dsh-subprocess-"));
  return defaultSpillDir;
}
process.once("exit", () => {
  if (defaultSpillDir === void 0) return;
  try {
    rmdirSync(defaultSpillDir);
  } catch {
  }
});
function reportSpillFailureToStderr(error, label) {
  process.stderr.write(`dsh-subprocess-local: ${label} spill failed; only the in-memory tail is retained: ${String(error)}
`);
}
function logSpillFailure(logger, owner) {
  return (error, label) => {
    const removedDirectory = error.code === "ENOENT";
    logger.error(
      `${owner} could not write the complete ${label} stream to its spill file; the result keeps only the in-memory tail and reports no full-output path.` + (removedDirectory ? " The spill directory no longer exists; a temporary-file cleaner removing it while empty is the usual cause." : ""),
      error
    );
  };
}
function prepareManagedProcessBinding(internals = {}) {
  return {
    spillDir: internals.spillDir ?? privateSpillDir(),
    onSpillFailure: internals.onSpillFailure ?? reportSpillFailureToStderr
  };
}
var OutputCollector = class {
  /**
   * @param maxBytes - in-memory tail cap in bytes.
   * @param label - stream label used in spill file names and failure reports.
   * @param spill - spill storage; omit for tail-only collection.
   */
  constructor(maxBytes, label, spill) {
    this.maxBytes = maxBytes;
    this.label = label;
    this.spill = spill;
    this.spillDisabled = spill === void 0;
  }
  maxBytes;
  label;
  spill;
  chunks = [];
  bytes = 0;
  dropped = false;
  spillFd;
  spillFile;
  spillDisabled;
  /** Total bytes ever pushed (not just retained). */
  total = 0;
  /**
   * Ingest one stream chunk, counting it toward the whole-stream total. On
   * first overflow of the in-memory cap a spill file is opened (when spilling
   * is enabled) and every chunk (already-collected ones included) is appended
   * there from then on; the in-memory tail then drops whole chunks from its
   * head (or the head of a single over-cap chunk) until it fits the cap again.
   * @param chunk - the raw bytes from one stream 'data' event.
   */
  push(chunk) {
    this.total += chunk.length;
    const overflows = this.bytes + chunk.length > this.maxBytes;
    const spill = this.spill;
    if (spill !== void 0 && !this.spillDisabled && (overflows || this.spillFd !== void 0)) this.spillAll(spill, chunk);
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0];
      const excess = this.bytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.bytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
      this.dropped = true;
    }
  }
  /**
   * Open the spill file lazily and append `chunk` (and any prior chunks once).
   * Runs inside the stream's `'data'` listener, so every filesystem failure is
   * contained here: the spill is discarded, reported once, and collection
   * continues with the in-memory tail alone.
   */
  spillAll(spill, chunk) {
    if (this.total > spill.maxBytes) {
      this.discardSpill();
      return;
    }
    try {
      if (this.spillFd === void 0) {
        const file = join2(
          spill.dir,
          `dsh-subprocess-${process.pid}-${++spillCounter}-${randomBytes(6).toString("hex")}-${this.label}.log`
        );
        const fd = openSync2(file, "wx", 384);
        this.spillFile = file;
        this.spillFd = fd;
        for (const prior of this.chunks) writeSync(fd, prior);
      }
      writeSync(this.spillFd, chunk);
    } catch (error) {
      this.discardSpill();
      try {
        spill.onFailure(error, this.label);
      } catch (reporterFailure) {
        process.stderr.write(`dsh-subprocess-local: spill failure reporter threw: ${String(reporterFailure)}
`);
      }
    }
  }
  /** Stop spilling and remove the file once it can no longer hold the complete stream. */
  discardSpill() {
    const fd = this.spillFd;
    const file = this.spillFile;
    this.spillFd = void 0;
    this.spillFile = void 0;
    this.spillDisabled = true;
    if (fd !== void 0) {
      try {
        closeSync2(fd);
      } catch {
        this.spillFd = fd;
      }
    }
    if (file !== void 0) {
      try {
        unlinkSync(file);
      } catch {
      }
    }
  }
  /**
   * Incremental read in whole-stream byte coordinates: returns everything
   * pushed since `fromByte`. When `fromByte` has already slid out of the
   * in-memory tail window, the read is `lossy` — it returns the whole
   * retained tail and the gap is only recoverable from the spill file.
   * @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
   * @returns the delta text, the offset for the next read, the `lossy` flag, and the spill path when one was created.
   */
  readFrom(fromByte) {
    const windowStart = this.total - this.bytes;
    const buffer = Buffer.concat(this.chunks);
    const lossy = fromByte < windowStart;
    const slice = lossy ? buffer : buffer.subarray(fromByte - windowStart);
    return {
      text: slice.toString("utf8"),
      nextOffset: this.total,
      lossy,
      ...this.spillFile !== void 0 ? { spillPath: this.spillFile } : {}
    };
  }
  /**
   * Copy the retained raw tail with its position in the complete observed stream.
   * @returns independent tail bytes and the total byte count before truncation.
   */
  snapshot() {
    return { bytes: Buffer.concat(this.chunks), totalBytes: this.total };
  }
  /**
   * Close the spill file once the stream has ended. A failed close (delayed
   * writeback fault) stops advertising the spill path — the file may be
   * missing its tail — while every in-memory read keeps working. Idempotent;
   * the spawn path seals both collectors at settlement so reads after exit
   * never point at a still-open file.
   */
  seal() {
    if (this.spillFd === void 0) return;
    try {
      closeSync2(this.spillFd);
    } catch {
      this.spillFile = void 0;
    }
    this.spillFd = void 0;
  }
  /**
   * Seal the spill file and return the final output.
   * @returns the final collected output: tail text, truncation flag, and the spill path when intact.
   */
  finalize() {
    this.seal();
    return {
      text: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.dropped,
      ...this.spillFile !== void 0 ? { spillPath: this.spillFile } : {}
    };
  }
};

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/spawn.ts
function childEnv(extra) {
  const env = scrubbedParentEnv();
  if (process.platform !== "win32") return { ...env, ...extra };
  let entries = Object.entries(env);
  for (const [key, value] of Object.entries(extra ?? {})) {
    const normalized = key.toUpperCase();
    entries = entries.filter(([inherited]) => inherited.toUpperCase() !== normalized);
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}
function sleepTick() {
  return sleepMs(15);
}
function taskkillProcessTree(pid) {
  if (pid === void 0 || pid <= 0) return;
  spawnSync2("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });
}
function signalTree(platform, pid, sig, child, taskkill) {
  if (pid === void 0) return;
  if (platform === "win32") {
    taskkill(pid);
    return;
  }
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
    }
  }
}
function validateSubprocessSpec(spec) {
  if (!Number.isFinite(spec.graceMs) || spec.graceMs <= 0 || spec.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  if (spec.signal?.aborted) {
    let reason = "aborted";
    try {
      reason = String(spec.signal.reason ?? reason);
    } catch {
    }
    throw new Error(`aborted before spawn: ${reason}`);
  }
  const [program] = spec.argv;
  if (program === void 0 || program.length === 0) {
    throw new Error("invalid argv: expected a non-empty program name at argv[0]");
  }
}
function directChildResult(child) {
  return new Promise((resolve5, reject) => {
    let completed = false;
    child.once("error", (error) => {
      if (completed) return;
      completed = true;
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      if (completed) return;
      completed = true;
      resolve5({ exitCode, signal });
    });
  });
}
function fallbackOwner(platform, pid, child, taskkill, linuxGroupHasLiveMembers, direct) {
  let stopped = false;
  let directSettled = false;
  let observation;
  void direct.then(
    () => {
      directSettled = true;
    },
    () => {
      directSettled = true;
    }
  );
  const alive = () => {
    if (stopped || pid === void 0) return false;
    if (platform === "win32") return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-pid, 0);
      if (directSettled && platform === "linux" && linuxGroupHasLiveMembers(pid) === false) return false;
      return true;
    } catch (error) {
      const code = error.code;
      if (code === "ESRCH") return false;
      if (code === "EPERM") return true;
      return child.exitCode === null && child.signalCode === null;
    }
  };
  return {
    signal: (signal) => {
      if (!alive()) {
        stopped = true;
        return;
      }
      signalTree(platform, pid, signal, child, taskkill);
    },
    waitForExit: async () => {
      if (stopped) return;
      observation ??= (async () => {
        while (alive()) await sleepTick();
        stopped = true;
      })();
      await observation;
    },
    terminateForHostExit: () => {
      if (stopped) return;
      signalTree(platform, pid, "SIGKILL", child, taskkill);
    }
  };
}
function bindManagedProcess(spec, launch, internals = {}) {
  const { spillDir, onSpillFailure } = prepareManagedProcessBinding(internals);
  const { stdin, stdout, stderr } = launch;
  const isCollect = (mode) => mode !== "pipe" && mode !== "inherit";
  const outMode = spec.stdio.stdout;
  const errMode = spec.stdio.stderr;
  const stdinMode = spec.stdio.stdin;
  const collectStream = (mode, stream, label) => {
    if (!isCollect(mode) || stream === null) return void 0;
    const collector = new OutputCollector(
      mode.maxBytes,
      label,
      mode.spill === void 0 ? void 0 : { maxBytes: mode.spill.maxBytes, dir: spillDir, onFailure: onSpillFailure }
    );
    stream.on("data", (chunk) => {
      collector.push(chunk);
    });
    return collector;
  };
  const stdoutCollector = collectStream(outMode, stdout, "stdout");
  const stderrCollector = collectStream(errMode, stderr, "stderr");
  const observeOutputStream = (mode, stream) => {
    if (mode === "inherit" || stream === null || stream.readableEnded || stream.destroyed) return void 0;
    return new Promise((resolve5) => {
      const settle = () => {
        stream.off("end", settle);
        stream.off("close", settle);
        stream.off("error", settle);
        resolve5();
      };
      stream.once("end", settle);
      stream.once("close", settle);
      stream.once("error", settle);
    });
  };
  const stdoutClosed = observeOutputStream(outMode, stdout);
  const stderrClosed = observeOutputStream(errMode, stderr);
  const outputStreamsClosed = Promise.all([stdoutClosed, stderrClosed]);
  const stopCollectors = () => {
    if (stdoutCollector !== void 0) stdout?.destroy();
    if (stderrCollector !== void 0) stderr?.destroy();
    stdoutCollector?.seal();
    stderrCollector?.seal();
  };
  let graceTimer;
  let terminationStarted = false;
  let rangeExitObserved = false;
  let rangeExitObservation;
  let settled = false;
  const scheduleOwnerCleanup = () => {
    if (launch.owner.cleanup === void 0) return false;
    queueMicrotask(() => {
      void done.finally(() => {
        launch.owner.cleanup?.();
      }).catch(() => {
      });
    });
    return true;
  };
  const observeRangeExit = () => {
    rangeExitObservation ??= (async () => {
      await launch.owner.waitForExit();
      rangeExitObserved = true;
      if (graceTimer !== void 0) clearTimeout(graceTimer);
      graceTimer = void 0;
      spec.signal?.removeEventListener("abort", onAbort);
      scheduleOwnerCleanup();
    })().catch((error) => {
      if (!settled || !scheduleOwnerCleanup()) rangeExitObservation = void 0;
      throw error;
    });
    return rangeExitObservation;
  };
  const kill = (sig, cancellationReason) => {
    if (rangeExitObserved) return;
    launch.owner.signal(sig, cancellationReason);
  };
  const terminateWithReason = (cancellationReason) => {
    if (rangeExitObserved || terminationStarted) return;
    terminationStarted = true;
    void observeRangeExit().catch(() => {
    });
    kill("SIGTERM", cancellationReason);
    graceTimer = setTimeout(() => {
      graceTimer = void 0;
      kill("SIGKILL");
    }, spec.graceMs);
  };
  const terminate = () => {
    terminateWithReason(new Error("subprocess terminated before target start"));
  };
  const terminateForHostExit = () => {
    launch.owner.terminateForHostExit();
  };
  const onAbort = () => {
    terminateWithReason(spec.signal?.reason);
  };
  spec.signal?.addEventListener("abort", onAbort, { once: true });
  if (typeof stdinMode === "object" && stdin !== null) {
    stdin.on("error", () => {
    });
    stdin.end(stdinMode.data);
  }
  const done = new Promise((resolve5, reject) => {
    let pipeDrainTimer;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      stopCollectors();
      cleanup();
      resolve5(outcome);
    };
    const fail = (error) => {
      settled = true;
      terminate();
      stopCollectors();
      cleanup();
      reject(error);
    };
    launch.direct.then((outcome) => {
      if (stdoutClosed === void 0 && stderrClosed === void 0) {
        settle(outcome);
        return;
      }
      pipeDrainTimer = setTimeout(() => {
        settle(outcome);
      }, spec.graceMs);
      void outputStreamsClosed.then(() => {
        settle(outcome);
      });
    }, fail);
    function cleanup() {
      if (pipeDrainTimer !== void 0) clearTimeout(pipeDrainTimer);
    }
  });
  const waitForExit = async (signal) => {
    if (rangeExitObserved) return true;
    return waitWithAbort(observeRangeExit(), signal);
  };
  return {
    /* v8 ignore start -- pipe-mode streams exist on every conforming launch;
       the null-coalesces guard an internal adapter defect only. */
    stdin: stdinMode === "pipe" ? stdin ?? void 0 : void 0,
    stdout: outMode === "pipe" ? stdout ?? void 0 : void 0,
    stderr: errMode === "pipe" ? stderr ?? void 0 : void 0,
    control: launch.control,
    /* v8 ignore stop */
    collected: {
      ...stdoutCollector !== void 0 ? { stdout: stdoutCollector } : {},
      ...stderrCollector !== void 0 ? { stderr: stderrCollector } : {}
    },
    done,
    terminate,
    terminateForHostExit,
    waitForExit
  };
}
function spawnSubprocess(spec, internals = {}) {
  const binding = prepareManagedProcessBinding(internals);
  const platform = internals.platform ?? process.platform;
  const [program, ...args] = spec.argv;
  const stdio = [
    spec.stdio.stdin === "ignore" ? "ignore" : "pipe",
    spec.stdio.stdout === "inherit" ? "inherit" : "pipe",
    spec.stdio.stderr === "inherit" ? "inherit" : "pipe"
  ];
  if (spec.stdio.control === "pipe") {
    while (stdio.length < SUBPROCESS_CONTROL_FD) stdio.push("ignore");
    stdio.push("overlapped");
  }
  const child = (internals.spawn ?? spawn)(program, args, {
    cwd: spec.cwd,
    env: controlEnvironment(childEnv(spec.env), spec.stdio.control),
    stdio,
    detached: platform !== "win32",
    windowsHide: platform === "win32"
  });
  const direct = directChildResult(child);
  const pid = child.pid;
  const owner = fallbackOwner(
    platform,
    pid,
    child,
    internals.taskkill ?? taskkillProcessTree,
    internals.linuxProcessGroupHasLiveMembers ?? linuxProcessGroupHasLiveMembers,
    direct
  );
  return bindManagedProcess(spec, {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    control: controlPipe(child, spec.stdio.control),
    direct,
    owner
  }, binding);
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/linux-scope.ts
import { execFile, spawn as spawn2, spawnSync as spawnSync3 } from "node:child_process";
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync3, statSync as statSync3 } from "node:fs";
import { join as join4 } from "node:path";
import { setTimeout as sleepMs2 } from "node:timers/promises";

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/linux-execve.ts
import { getSystemErrorMessage, getSystemErrorName } from "node:util";
var requireKoffi2 = createLazyRequire("koffi", import.meta.url);
var STANDARD_FILE_DESCRIPTORS = [0, 1, 2];
var F_GETFD = 1;
var F_SETFD = 2;
var FD_CLOEXEC = 1;
var cachedExecve;
function systemError(errno, syscall, path) {
  const uvError = -errno;
  const code = getSystemErrorName(uvError);
  const detail = getSystemErrorMessage(uvError);
  const subject = path === void 0 ? syscall : `${syscall} '${path}'`;
  const error = Object.assign(new Error(`${code}: ${detail}, ${subject}`), {
    code,
    errno: uvError,
    syscall
  });
  return path === void 0 ? error : Object.assign(error, { path });
}
function loadLinuxExecve() {
  if (cachedExecve !== void 0) return cachedExecve;
  const koffi = requireKoffi2();
  const libc = koffi.load(null);
  const nativeExecve = libc.func(
    "int execve(const char *pathname, const char **argv, const char **envp)"
  );
  const nativeFcntl = libc.func(
    "int fcntl(int fd, int cmd, int arg)"
  );
  cachedExecve = (file, argv, env, control) => {
    const descriptors = control === "pipe" ? [...STANDARD_FILE_DESCRIPTORS, SUBPROCESS_CONTROL_FD] : STANDARD_FILE_DESCRIPTORS;
    for (const fd of descriptors) {
      const flags = nativeFcntl(fd, F_GETFD, 0);
      if (flags === -1) throw systemError(koffi.errno(), "fcntl");
      if ((flags & FD_CLOEXEC) === 0) continue;
      if (nativeFcntl(fd, F_SETFD, flags & ~FD_CLOEXEC) === -1) {
        throw systemError(koffi.errno(), "fcntl");
      }
    }
    nativeExecve(
      file,
      [...argv, null],
      [...Object.entries(env).map(([key, value]) => `${key}=${value}`), null]
    );
    throw systemError(koffi.errno(), "execve", file);
  };
  return cachedExecve;
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/runner-protocol.ts
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync as mkdtempSync2,
  readFileSync as readFileSync2,
  rmdirSync as rmdirSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { basename as basename2, dirname as dirname3, isAbsolute as isAbsolute3, join as join3 } from "node:path";
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, required, optional = []) {
  const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function isSerializedRunnerError(value) {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ["name", "message"],
    ["code", "syscall", "path"]
  )) return false;
  return typeof value.name === "string" && typeof value.message === "string" && (value.code === void 0 || typeof value.code === "string") && (value.syscall === void 0 || typeof value.syscall === "string") && (value.path === void 0 || typeof value.path === "string");
}
function parseErrorResult(value) {
  if (!hasExactKeys(value, ["type", "error"]) || !isSerializedRunnerError(value.error)) {
    throw new Error("subprocess runner emitted an invalid error result");
  }
  if (value.type !== "error") {
    throw new Error("subprocess runner emitted an unknown error result");
  }
  return { type: "error", error: value.error };
}
function createLinuxLaunchFiles(request) {
  const directory = mkdtempSync2(join3(tmpdir2(), "dsh-subprocess-launch-"));
  const files = {
    directory,
    requestPath: join3(directory, "launch-request.json"),
    startupErrorPath: join3(directory, "startup-error.json")
  };
  try {
    chmodSync(directory, 448);
    writeFileSync(files.requestPath, JSON.stringify(request), { flag: "wx", mode: 384 });
    return files;
  } catch (error) {
    cleanupLinuxLaunchFiles(files);
    throw error;
  }
}
function readLinuxStartupError(path) {
  if (!existsSync(path)) return void 0;
  const value = JSON.parse(readFileSync2(path, "utf8"));
  if (!isRecord(value)) throw new Error("subprocess runner emitted an invalid startup error");
  return parseErrorResult(value);
}
function parseWindowsRunnerResult(value) {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("subprocess runner emitted an invalid Windows result");
  }
  if (value.type === "error") return parseErrorResult(value);
  if (value.type === "target-exit") {
    const validExitCode = typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode) && value.exitCode >= 0;
    if (!hasExactKeys(value, ["type", "exitCode"]) || !validExitCode) {
      throw new Error("subprocess runner emitted an invalid target-exit result");
    }
    return {
      type: "target-exit",
      exitCode: value.exitCode
    };
  }
  throw new Error(`subprocess runner emitted an unknown Windows result: ${value.type}`);
}
function deserializeRunnerError(serialized) {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  return Object.assign(error, {
    ...serialized.code === void 0 ? {} : { code: serialized.code },
    ...serialized.syscall === void 0 ? {} : { syscall: serialized.syscall },
    ...serialized.path === void 0 ? {} : { path: serialized.path }
  });
}
function cleanupLinuxLaunchFiles(files) {
  try {
    if (lstatSync(files.directory).isSymbolicLink()) {
      unlinkSync2(files.directory);
      return;
    }
    for (const path of [
      files.requestPath,
      files.startupErrorPath
    ]) {
      try {
        unlinkSync2(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    rmdirSync2(files.directory);
  } catch {
  }
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/runner-launch.ts
import { accessSync, constants as fsConstants, lstatSync as lstatSync2, statSync as statSync2 } from "node:fs";
import { extname, isAbsolute as isAbsolute4 } from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
var SUBPROCESS_RUNNER_ENV = "DSH_SUBPROCESS_RUNNER";
var WINDOWS_RUNNER_SELECTION = "windows";
var SOURCE_TSCONFIG_PATH = fileURLToPath(new URL("../../../../tsconfig.base.json", import.meta.url));
var RUNNER_CONTROL_ENV_PREFIXES = ["NODE_", "TSX_"];
function spawnRunnerInvocation() {
  if ("pkg" in process) return [process.execPath];
  if (extname(fileURLToPath(import.meta.url)) !== ".ts") {
    return [process.execPath, fileURLToPath(new URL("./subprocess-runner.mjs", import.meta.url).href)];
  }
  return [
    process.execPath,
    "--import",
    import.meta.resolve("tsx/esm"),
    fileURLToPath(new URL("./bin.ts", import.meta.url))
  ];
}
function runnerInvocationAvailable(invocation = spawnRunnerInvocation()) {
  try {
    if (isAbsolute4(invocation[0])) accessSync(invocation[0], fsConstants.X_OK);
    const entry = invocation.at(-1);
    if (entry !== void 0 && entry !== invocation[0] && isAbsolute4(entry)) {
      accessSync(entry, fsConstants.R_OK);
    }
    return true;
  } catch {
    return false;
  }
}
function runnerEnvironment(selection, invocation) {
  const entry = invocation?.at(-1);
  const env = childEnv();
  for (const name of Object.keys(env)) {
    const normalized = name.toUpperCase();
    if (RUNNER_CONTROL_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      Reflect.deleteProperty(env, name);
    }
  }
  return {
    ...env,
    [SUBPROCESS_RUNNER_ENV]: selection,
    SYSTEMD_LOG_TARGET: "null",
    ...entry?.endsWith(".ts") === true ? { TSX_TSCONFIG_PATH: SOURCE_TSCONFIG_PATH } : {}
  };
}
function runnerStdio(spec, ipc, stdinCarrier = "pipe") {
  const targetStdio = [
    spec.stdio.stdin === "ignore" ? "ignore" : "pipe",
    spec.stdio.stdout === "inherit" ? "inherit" : "pipe",
    spec.stdio.stderr === "inherit" ? "inherit" : "pipe"
  ];
  if (!ipc) {
    if (spec.stdio.control === "pipe") {
      while (targetStdio.length < SUBPROCESS_CONTROL_FD) targetStdio.push("ignore");
      targetStdio.push("overlapped");
    }
    return targetStdio;
  }
  const runner = [
    "ignore",
    "ignore",
    "ignore",
    "ipc",
    stdinCarrier,
    spec.stdio.stdout === "inherit" ? 1 : "pipe",
    spec.stdio.stderr === "inherit" ? 2 : "pipe"
  ];
  if (spec.stdio.control === "pipe") runner.push("overlapped");
  return runner;
}
function throwNullByteError(property, value, argument) {
  const subject = argument ? `The argument '${property}'` : `The property '${property}'`;
  const error = new TypeError(`${subject} must be a string without null bytes. Received ${inspect(value)}`);
  Object.assign(error, { code: "ERR_INVALID_ARG_VALUE" });
  throw error;
}
function validateNoNullByte(property, value, argument = false) {
  if (value.includes("\0")) throwNullByteError(property, value, argument);
}
function targetEnvironment(spec) {
  spec.argv.forEach((value, index) => {
    validateNoNullByte(index === 0 ? "file" : `args[${String(index - 1)}]`, value, true);
  });
  validateNoNullByte("options.cwd", spec.cwd);
  const env = Object.fromEntries(
    Object.entries(childEnv(spec.env)).filter((entry) => entry[1] !== void 0)
  );
  for (const [key, value] of Object.entries(env)) {
    validateNoNullByte(`options.env['${key}']`, key);
    validateNoNullByte(`options.env['${key}']`, value);
  }
  return controlEnvironment(env, spec.stdio?.control);
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/linux-scope.ts
var SYSTEMCTL_TIMEOUT_MS = 5e3;
var SCOPE_INITIAL_POLL_INTERVAL_MS = 50;
var MISSING_UNIT = /\bunit\b[^\r\n]*(?:could not be found|not found|not loaded)/iu;
var LITERAL_ARGV_OPTION = "--expand-environment=no";
var LITERAL_ARGV_OPTION_REJECTED = /unrecognized option\b.*expand-environment/u;
var KILL_ALL_MEMBERS = "--kill-who=all";
var UNIX_SOCKET_ACCEPTING = 65536;
function managerEnvironment() {
  const environment = childEnv({ LC_ALL: "C" });
  delete environment.SYSTEMD_LOG_TARGET;
  return environment;
}
function quietSystemdEnvironment() {
  return childEnv({ LC_ALL: "C", SYSTEMD_LOG_TARGET: "null" });
}
function querySystemctl(command, args) {
  return new Promise((resolveResult) => {
    execFile(command, [...args], {
      encoding: "utf8",
      env: managerEnvironment(),
      timeout: SYSTEMCTL_TIMEOUT_MS
    }, (error, stdout, stderr) => {
      const code = error === null ? 0 : error.code;
      resolveResult({
        status: typeof code === "number" ? code : null,
        stdout,
        stderr,
        ...error === null ? {} : { error }
      });
    });
  });
}
function unitStem(prefix) {
  return `${prefix}-${String(process.pid)}-${randomBytes2(6).toString("hex")}`;
}
function sleepWithAbort(delayMs, signal) {
  return sleepMs2(delayMs, void 0, { signal });
}
function probeLinuxBootstrap(internals = {}) {
  try {
    ;
    (internals.loadLinuxExecve ?? loadLinuxExecve)();
    const invocation = internals.runnerInvocation ?? (internals.resolveRunnerInvocation ?? spawnRunnerInvocation)();
    return (internals.runnerAvailable ?? runnerInvocationAvailable)(invocation);
  } catch {
    return false;
  }
}
function probeLinuxScope(internals = {}) {
  const attempt = (literalArgv) => {
    const unitBase = unitStem("dsh-subprocess-probe");
    const result = (internals.spawnSync ?? spawnSync3)(internals.systemdRun ?? "systemd-run", [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      ...literalArgv,
      `--unit=${unitBase}`,
      "--",
      internals.systemctl ?? "systemctl",
      "--user",
      "show",
      `${unitBase}.scope`,
      "--property=ActiveState",
      "--value"
    ], {
      encoding: "utf8",
      env: quietSystemdEnvironment(),
      stdio: ["ignore", "ignore", "pipe"],
      timeout: SYSTEMCTL_TIMEOUT_MS
    });
    return { created: result.error === void 0 && result.status === 0, stderr: result.stderr };
  };
  const current = attempt([LITERAL_ARGV_OPTION]);
  if (current.created) return [LITERAL_ARGV_OPTION];
  if (!LITERAL_ARGV_OPTION_REJECTED.test(current.stderr)) return void 0;
  return attempt([]).created ? [] : void 0;
}
function probeLinuxNative(internals = {}) {
  return probeLinuxBootstrap(internals) ? probeLinuxScope(internals) : void 0;
}
function probeLinuxManager(internals = {}) {
  const result = (internals.spawnSync ?? spawnSync3)(internals.systemctl ?? "systemctl", [
    "--user",
    "show",
    "--property=Version",
    "--value"
  ], { env: managerEnvironment(), stdio: "ignore", timeout: SYSTEMCTL_TIMEOUT_MS });
  return result.error === void 0 && result.status === 0;
}
function unixSocketListener(path, table) {
  let text;
  try {
    text = readFileSync3(table, "utf8");
  } catch (_unreadableSocketTable) {
    return void 0;
  }
  const suffix = ` ${path}`;
  for (const line of text.split("\n")) {
    if (!line.endsWith(suffix)) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.slice(7).join(" ") === path && (Number.parseInt(String(fields[3]), 16) & UNIX_SOCKET_ACCEPTING) !== 0) {
      return String(fields[6]);
    }
  }
  return void 0;
}
function linuxManagerListener(internals = {}) {
  const runtimeDirectory = childEnv().XDG_RUNTIME_DIR;
  if (runtimeDirectory === void 0 || runtimeDirectory === "") return void 0;
  return unixSocketListener(join4(runtimeDirectory, "systemd", "private"), internals.unixSocketTable ?? "/proc/net/unix");
}
function systemdRunIdentity(internals = {}) {
  const command = internals.systemdRun ?? "systemd-run";
  const candidates = command.includes("/") ? [command] : (childEnv().PATH ?? "").split(":").filter((directory) => directory !== "").map((directory) => join4(directory, command));
  for (const candidate of candidates) {
    let stats;
    try {
      stats = statSync3(candidate, { throwIfNoEntry: false });
    } catch (_unreadableCandidate) {
      continue;
    }
    if (stats?.isFile() === true) return `${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`;
  }
  return void 0;
}
function confirmLinuxManager(internals = {}) {
  return linuxManagerListener(internals) !== void 0 || probeLinuxManager(internals);
}
var LinuxScopeNotStartedError = class extends Error {
  name = "LinuxScopeNotStartedError";
};
var LinuxScopeStartup = class {
  constructor(files, kind) {
    this.files = files;
    this.kind = kind;
  }
  files;
  kind;
  terminationSignals = /* @__PURE__ */ new Set();
  resolveOutcome(outcome) {
    const startup = readLinuxStartupError(this.files.startupErrorPath);
    if (startup !== void 0) throw deserializeRunnerError(startup.error);
    if (existsSync2(this.files.requestPath) && !(outcome.signal !== null && this.terminationSignals.has(outcome.signal))) {
      throw new LinuxScopeNotStartedError(
        `${this.kind} scope exited before its bootstrap consumed the launch request; the provider probes native containment again before its next command`
      );
    }
    return outcome;
  }
};
var SystemdScopeOwner = class {
  constructor(unit, startup, direct, systemctl, runSync, query, sleep) {
    this.unit = unit;
    this.startup = startup;
    this.direct = direct;
    this.systemctl = systemctl;
    this.runSync = runSync;
    this.query = query;
    this.sleep = sleep;
  }
  unit;
  startup;
  direct;
  systemctl;
  runSync;
  query;
  sleep;
  establishment = "pending";
  stopped = false;
  terminationRequested = false;
  observation;
  killFailure;
  directKillSettlement;
  wakeGeneration = 0;
  wakeWaiter;
  inspectTaskCount() {
    const result = this.runSync(this.systemctl, [
      "--user",
      "show",
      "--property=LoadState",
      "--property=ActiveState",
      "--property=TasksCurrent",
      this.unit
    ], { encoding: "utf8", env: managerEnvironment(), timeout: SYSTEMCTL_TIMEOUT_MS });
    if (result.error !== void 0 || result.status !== 0 || typeof result.stdout !== "string") return void 0;
    const state = this.parseUnitState(result.stdout);
    return state.loadState === "loaded" && state.activeState === "active" ? state.tasksCurrent : void 0;
  }
  signal(signal) {
    if (this.stopped) return;
    this.terminationRequested = true;
    if (this.direct.running()) this.startup.terminationSignals.add(signal);
    this.observeRequestConsumption();
    const directFallbackRequired = this.establishment === "pending";
    let directSignalled = false;
    if (directFallbackRequired && this.direct.running()) directSignalled = this.direct.signal(signal);
    const result = this.runSync(this.systemctl, [
      "--user",
      "kill",
      KILL_ALL_MEMBERS,
      `--signal=${signal}`,
      this.unit
    ], { encoding: "utf8", env: managerEnvironment(), timeout: SYSTEMCTL_TIMEOUT_MS });
    this.wakeObservation();
    if (result.error === void 0 && result.status === 0) {
      if (signal === "SIGKILL") {
        this.killFailure = void 0;
        this.directKillSettlement = void 0;
      }
      return;
    }
    if (!directFallbackRequired && this.direct.running()) directSignalled = this.direct.signal(signal);
    if (signal === "SIGKILL") {
      const output = `${result.stdout}
${result.stderr}`;
      if (!MISSING_UNIT.test(output)) {
        this.killFailure = result.error ?? new Error(
          `systemctl could not signal ${this.unit}: ${output.trim() || `exit ${String(result.status)}`}`
        );
        this.directKillSettlement = directSignalled ? this.direct.settled.then(() => {
        }, () => {
        }) : void 0;
      }
    }
  }
  terminateForHostExit() {
    if (this.stopped) return;
    try {
      if (this.direct.running()) this.direct.signal("SIGKILL");
    } catch {
    }
    try {
      this.runSync(this.systemctl, [
        "--user",
        "kill",
        KILL_ALL_MEMBERS,
        "--signal=SIGKILL",
        this.unit
      ], { env: managerEnvironment(), stdio: "ignore", timeout: SYSTEMCTL_TIMEOUT_MS });
    } catch {
    }
  }
  observeRequestConsumption() {
    if (this.establishment === "pending" && !existsSync2(this.startup.files.requestPath)) {
      this.establishment = "established";
    }
  }
  absentUnit() {
    this.observeRequestConsumption();
    if (this.establishment === "established") return false;
    if (!this.direct.running() && existsSync2(this.startup.files.requestPath)) {
      return false;
    }
    if (this.killFailure !== void 0) throw this.killFailure;
    return true;
  }
  /**
   * Prove an active unit with no processes is the empty managed range rather
   * than a launch still placing its payload. systemd ends a scope only on the
   * populated-to-empty transition, so a payload killed before it entered the
   * cgroup leaves the unit active forever. A departed client cannot add another
   * payload; a consumed request proves the payload already entered the scope,
   * even while its direct-process exit notification is pending.
   */
  emptyRange(tasksCurrent) {
    return this.terminationRequested && tasksCurrent === 0 && (!this.direct.running() || !existsSync2(this.startup.files.requestPath));
  }
  /** Release a leftover empty scope so the transient unit is collected and cannot accumulate. */
  releaseEmptyRange() {
    try {
      this.runSync(this.systemctl, ["--user", "stop", this.unit], {
        env: managerEnvironment(),
        stdio: "ignore",
        timeout: SYSTEMCTL_TIMEOUT_MS
      });
    } catch {
    }
  }
  parseUnitState(stdout) {
    const values = /* @__PURE__ */ new Map();
    for (const line of stdout.split(/\r?\n/u)) {
      if (line === "") continue;
      const separator = line.indexOf("=");
      if (separator <= 0) {
        throw new Error(`systemctl returned malformed state for ${this.unit}: ${JSON.stringify(stdout.trim())}`);
      }
      const name = line.slice(0, separator);
      if (values.has(name)) {
        throw new Error(`systemctl returned duplicate ${name} for ${this.unit}`);
      }
      values.set(name, line.slice(separator + 1));
    }
    const loadState = values.get("LoadState");
    const activeState = values.get("ActiveState");
    const reportedTasks = values.get("TasksCurrent");
    const tasksCurrent = reportedTasks === "[not set]" ? void 0 : reportedTasks;
    if (values.size !== (reportedTasks === void 0 ? 2 : 3) || loadState === void 0 || activeState === void 0) {
      throw new Error(`systemctl returned incomplete state for ${this.unit}: ${JSON.stringify(stdout.trim())}`);
    }
    if (tasksCurrent !== void 0 && !/^\d+$/u.test(tasksCurrent)) {
      throw new Error(`systemctl returned a non-numeric TasksCurrent for ${this.unit}: ${JSON.stringify(tasksCurrent)}`);
    }
    return {
      loadState,
      activeState,
      tasksCurrent: tasksCurrent === void 0 ? void 0 : Number(tasksCurrent)
    };
  }
  async rangeActive() {
    this.observeRequestConsumption();
    const generation = this.wakeGeneration;
    const directRunning = this.direct.running();
    const result = await this.query(this.systemctl, [
      "--user",
      "show",
      this.unit,
      "--property=LoadState",
      "--property=ActiveState",
      "--property=TasksCurrent"
    ]);
    if (generation !== this.wakeGeneration) return true;
    const output = `${result.stdout}
${result.stderr}`;
    if (result.status === 0) {
      const { loadState, activeState, tasksCurrent } = this.parseUnitState(result.stdout);
      if (loadState === "not-found" && activeState === "inactive") return this.absentUnit();
      if (loadState !== "loaded") {
        throw new Error(
          `systemctl returned unknown state for ${this.unit}: ${JSON.stringify({ loadState, activeState })}`
        );
      }
      this.establishment = "established";
      if (activeState === "inactive" || activeState === "failed") return false;
      if (!["active", "activating", "reloading", "deactivating"].includes(activeState)) {
        throw new Error(`systemctl returned unknown ActiveState for ${this.unit}: ${JSON.stringify(activeState)}`);
      }
      if (this.emptyRange(tasksCurrent)) {
        this.releaseEmptyRange();
        return false;
      }
      if (this.killFailure !== void 0) {
        if (directRunning && this.directKillSettlement !== void 0) {
          const settlement = this.directKillSettlement;
          this.directKillSettlement = void 0;
          await settlement;
          return this.rangeActive();
        }
        throw this.killFailure;
      }
      return true;
    }
    if (!MISSING_UNIT.test(output)) {
      if (result.error !== void 0) throw result.error;
      throw new Error(`systemctl could not read ${this.unit}: ${output.trim() || `exit ${String(result.status)}`}`);
    }
    return this.absentUnit();
  }
  wakeObservation() {
    this.wakeGeneration += 1;
    this.wakeWaiter?.resolve();
    this.wakeWaiter = void 0;
  }
  async waitForPoll(delayMs, generation) {
    if (generation !== this.wakeGeneration) return;
    const wake = Promise.withResolvers();
    const waiter = { generation, resolve: wake.resolve };
    const sleepController = new AbortController();
    this.wakeWaiter = waiter;
    try {
      await Promise.race([this.sleep(delayMs, sleepController.signal), wake.promise]);
    } finally {
      sleepController.abort();
      if (this.wakeWaiter === waiter) this.wakeWaiter = void 0;
    }
  }
  async waitForExit() {
    if (this.stopped) return;
    this.observation ??= (async () => {
      let pollIntervalMs = SCOPE_INITIAL_POLL_INTERVAL_MS;
      let generation = this.wakeGeneration;
      while (await this.rangeActive()) {
        await this.waitForPoll(pollIntervalMs, generation);
        generation = this.wakeGeneration;
        if (this.establishment === "established") {
          pollIntervalMs = Math.min(pollIntervalMs * 2, SYSTEMCTL_TIMEOUT_MS);
        }
      }
      this.stopped = true;
    })().catch((error) => {
      this.observation = void 0;
      throw error;
    });
    await this.observation;
  }
  cleanup() {
    cleanupLinuxLaunchFiles(this.startup.files);
  }
};
function scopeArgs(unitBase, literalArgv, invocation, argv) {
  return [
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    ...literalArgv,
    `--unit=${unitBase}`,
    "--",
    ...invocation,
    "--",
    ...argv
  ];
}
function directOutcome(child, startup) {
  return new Promise((resolveOutcome, rejectOutcome) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectOutcome(error);
    });
    child.once("exit", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      try {
        resolveOutcome(startup.resolveOutcome({ exitCode, signal }));
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        rejectOutcome(failure);
      }
    });
  });
}
function signalLinuxDirectProcess(pid, send) {
  try {
    if (send()) return true;
  } catch {
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
function signalChildGroup(child, signal) {
  let groupSignalled = false;
  try {
    groupSignalled = process.kill(-child.pid, signal);
  } catch {
  }
  if (groupSignalled && signal === "SIGTERM") return true;
  return signalLinuxDirectProcess(child.pid, () => process.kill(child.pid, signal));
}
function prepareLinuxTerminalScope(spec, targetEnv, literalArgv, internals = {}) {
  const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
  const files = createLinuxLaunchFiles({ cwd: spec.cwd, env: targetEnv });
  const startup = new LinuxScopeStartup(files, "terminal");
  const unitBase = unitStem("dsh-terminal");
  return {
    command: internals.systemdRun ?? "systemd-run",
    args: scopeArgs(unitBase, literalArgv, invocation, spec.argv),
    cwd: process.cwd(),
    env: runnerEnvironment(files.requestPath, invocation),
    bindOwner: (direct) => new SystemdScopeOwner(
      `${unitBase}.scope`,
      startup,
      direct,
      internals.systemctl ?? "systemctl",
      internals.spawnSync ?? spawnSync3,
      internals.systemctlQuery ?? querySystemctl,
      internals.sleep ?? sleepWithAbort
    ),
    resolveOutcome: (outcome) => startup.resolveOutcome(outcome),
    cleanup: () => {
      cleanupLinuxLaunchFiles(files);
    }
  };
}
function launchLinuxScope(spec, targetEnv, literalArgv, internals = {}) {
  const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
  const files = createLinuxLaunchFiles({
    cwd: spec.cwd,
    env: targetEnv,
    ...spec.stdio.control === void 0 ? {} : { control: spec.stdio.control }
  });
  const startup = new LinuxScopeStartup(files, "subprocess");
  const unitBase = unitStem("dsh-subprocess");
  let child;
  try {
    child = (internals.spawn ?? spawn2)(internals.systemdRun ?? "systemd-run", scopeArgs(
      unitBase,
      literalArgv,
      invocation,
      spec.argv
    ), {
      cwd: process.cwd(),
      env: runnerEnvironment(files.requestPath, invocation),
      stdio: runnerStdio(spec, false),
      detached: true
    });
  } catch (error) {
    cleanupLinuxLaunchFiles(files);
    throw error;
  }
  const direct = directOutcome(child, startup);
  const owner = new SystemdScopeOwner(
    `${unitBase}.scope`,
    startup,
    {
      running: () => child.pid !== void 0 && child.exitCode === null && child.signalCode === null,
      signal: (signal) => signalChildGroup(child, signal),
      settled: direct
    },
    internals.systemctl ?? "systemctl",
    internals.spawnSync ?? spawnSync3,
    internals.systemctlQuery ?? querySystemctl,
    internals.sleep ?? sleepWithAbort
  );
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    control: controlPipe(child, spec.stdio.control),
    direct,
    owner
  };
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/linux-scope-selector.ts
var LinuxScopeSelector = class {
  /** @param observe - host checks consulted by each selection. */
  constructor(observe) {
    this.observe = observe;
  }
  observe;
  state = { kind: "unprobed", trigger: "first" };
  generation = 0;
  /**
   * Choose containment for one eligible launch.
   * @returns the decision and the branch that produced it.
   */
  select() {
    const state = this.state;
    if (state.kind === "unprobed") return this.probe(state.trigger);
    if (state.kind === "available") {
      if (this.observe.launcherIdentity() !== state.launcher) return this.probe("launcher-changed");
      return this.observe.confirmManager() ? { kind: "scope", reason: "manager-confirmed", literalArgv: state.literalArgv, generation: this.generation, probe: void 0 } : { kind: "fallback", reason: "manager-unconfirmed", probe: void 0 };
    }
    const listener = this.observe.managerListener();
    if (listener === void 0) return { kind: "fallback", reason: "no-listener", probe: void 0 };
    if (listener === state.listener) return { kind: "fallback", reason: "same-listener", probe: void 0 };
    return this.probe("new-listener");
  }
  /**
   * Record that a scope launched under generation exited before its bootstrap started the target,
   * so the next selection probes again. Launches from a superseded probe are ignored.
   * @param generation - generation of the scope decision that launched it.
   */
  scopeNotStarted(generation) {
    if (generation === this.generation) this.state = { kind: "unprobed", trigger: "scope-not-started" };
  }
  probe(trigger) {
    this.generation += 1;
    const listener = this.observe.managerListener();
    const launcher = this.observe.launcherIdentity();
    const literalArgv = this.observe.probe();
    if (literalArgv === void 0) {
      this.state = { kind: "unavailable", listener };
      return { kind: "fallback", reason: "probe-unavailable", probe: trigger };
    }
    this.state = { kind: "available", literalArgv, launcher };
    return { kind: "scope", reason: "probe-available", literalArgv, generation: this.generation, probe: trigger };
  }
};

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/windows-job.ts
import { spawn as spawn3 } from "node:child_process";
import { closeSync as closeSync3, openSync as openSync3 } from "node:fs";
import { devNull } from "node:os";

// third_party/dsh-tools/packages/subprocess/win32-process/src/abi.ts
var FORMAT_MESSAGE_FROM_SYSTEM = 4096;
var FORMAT_MESSAGE_IGNORE_INSERTS = 512;
var JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
var JobObjectExtendedLimitInformation = 9;
var JOBOBJECT_EXTENDED_LIMIT_SIZE = 144;
var JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16;
var STARTUPINFOW_SIZE = 104;
var PROCESS_INFORMATION_SIZE = 24;

// third_party/dsh-tools/packages/subprocess/win32-process/src/errors.ts
var Win32Error = class extends Error {
  /** Win32 function whose checked result failed. */
  api;
  /** Exact GetLastError value or direct Win32 API error code. */
  win32Code;
  constructor(api, win32Code, detail) {
    super(`${api} failed (Win32 ${win32Code})${detail === void 0 ? "" : `: ${detail}`}`);
    this.name = "Win32Error";
    this.api = api;
    this.win32Code = win32Code;
  }
};

// third_party/dsh-tools/packages/subprocess/win32-process/src/koffi.ts
var requireKoffi3 = createLazyRequire("koffi", import.meta.url);

// third_party/dsh-tools/packages/subprocess/win32-process/src/ffi.ts
function isNullPtr(value) {
  return value === null || value === void 0 || value === 0n;
}
var cachedTypes;
function win32Types() {
  if (cachedTypes !== void 0) return cachedTypes;
  const koffi = requireKoffi3();
  const PVOID = koffi.pointer("void");
  const PPVOID = koffi.pointer(PVOID);
  const STARTUPINFOW = koffi.struct("DSH_STARTUPINFOW", {
    cb: "uint32",
    lpReserved: "str16",
    lpDesktop: "str16",
    lpTitle: "str16",
    dwX: "uint32",
    dwY: "uint32",
    dwXSize: "uint32",
    dwYSize: "uint32",
    dwXCountChars: "uint32",
    dwYCountChars: "uint32",
    dwFillAttribute: "uint32",
    dwFlags: "uint32",
    wShowWindow: "uint16",
    cbReserved2: "uint16",
    lpReserved2: koffi.pointer("uint8"),
    hStdInput: PVOID,
    hStdOutput: PVOID,
    hStdError: PVOID
  });
  const PROCESS_INFORMATION = koffi.struct("DSH_PROCESS_INFORMATION", {
    hProcess: PVOID,
    hThread: PVOID,
    dwProcessId: "uint32",
    dwThreadId: "uint32"
  });
  if (STARTUPINFOW.size !== STARTUPINFOW_SIZE) {
    throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, expected ${STARTUPINFOW_SIZE}`);
  }
  if (PROCESS_INFORMATION.size !== PROCESS_INFORMATION_SIZE) {
    throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, expected ${PROCESS_INFORMATION_SIZE}`);
  }
  return cachedTypes = { PVOID, PPVOID, STARTUPINFOW, PROCESS_INFORMATION };
}
var cachedContext;
var cached;
function bindingContext() {
  if (cachedContext !== void 0) return cachedContext;
  const koffi = requireKoffi3();
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
  cachedContext = { kernel32, advapi32, bind };
  return cachedContext;
}
function bindings2() {
  if (cached !== void 0) return cached;
  const koffi = requireKoffi3();
  const { PVOID, PPVOID, STARTUPINFOW, PROCESS_INFORMATION } = win32Types();
  const { kernel32, advapi32, bind } = bindingContext();
  const node = koffi.load(null);
  cached = {
    closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
    getLastError: bind(kernel32, "GetLastError", "uint32", []),
    getFileType: bind(kernel32, "GetFileType", "uint32", [PVOID]),
    formatMessageW: bind(kernel32, "FormatMessageW", "uint32", [
      "uint32",
      PVOID,
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      PVOID
    ]),
    createPipe: bind(kernel32, "CreatePipe", "int", [PPVOID, PPVOID, PVOID, "uint32"]),
    setHandleInformation: bind(kernel32, "SetHandleInformation", "int", [PVOID, "uint32", "uint32"]),
    createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
      PVOID,
      "str16",
      "str16",
      PVOID,
      PVOID,
      "int",
      "uint32",
      PVOID,
      "str16",
      koffi.pointer(STARTUPINFOW),
      koffi.pointer(PROCESS_INFORMATION)
    ]),
    createProcessW: bind(kernel32, "CreateProcessW", "int", [
      "str16",
      "str16",
      PVOID,
      PVOID,
      "int",
      "uint32",
      PVOID,
      "str16",
      koffi.pointer(STARTUPINFOW),
      koffi.pointer(PROCESS_INFORMATION)
    ]),
    readFile: bind(kernel32, "ReadFile", "int", [PVOID, PVOID, "uint32", koffi.pointer("uint32"), PVOID]),
    peekNamedPipe: bind(kernel32, "PeekNamedPipe", "int", [
      PVOID,
      PVOID,
      "uint32",
      koffi.pointer("uint32"),
      koffi.pointer("uint32"),
      koffi.pointer("uint32")
    ]),
    waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
    getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, koffi.pointer("uint32")]),
    createJobObjectW: bind(kernel32, "CreateJobObjectW", PVOID, [PVOID, "str16"]),
    setInformationJobObject: bind(kernel32, "SetInformationJobObject", "int", [PVOID, "int", PVOID, "uint32"]),
    queryInformationJobObject: bind(kernel32, "QueryInformationJobObject", "int", [
      PVOID,
      "int",
      PVOID,
      "uint32",
      PVOID
    ]),
    assignProcessToJobObject: bind(kernel32, "AssignProcessToJobObject", "int", [PVOID, PVOID]),
    resumeThread: bind(kernel32, "ResumeThread", "uint32", [PVOID]),
    terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
    terminateJobObject: bind(kernel32, "TerminateJobObject", "int", [PVOID, "uint32"]),
    getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"]),
    uvGetOsfhandle: node.func("uv_get_osfhandle", PVOID, ["int"])
  };
  return cached;
}
function loadWin32ProcessBindings() {
  return bindings2();
}
function errorText(api, win32Code) {
  const buffer = Buffer.alloc(1024);
  const length = api.formatMessageW(
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    null,
    win32Code,
    0,
    buffer,
    buffer.length / 2,
    null
  );
  return length === 0 ? "" : buffer.subarray(0, length * 2).toString("utf16le").trim();
}
function throwLastError(api, name, detail) {
  const win32Code = api.getLastError();
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
function throwWin32(api, name, win32Code, detail) {
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}

// third_party/dsh-tools/packages/subprocess/win32-process/src/process.ts
function createKillOnCloseJob(api) {
  const job = api.createJobObjectW(null, null);
  if (isNullPtr(job)) throwLastError(api, "CreateJobObjectW");
  const information = Buffer.alloc(JOBOBJECT_EXTENDED_LIMIT_SIZE);
  information.writeUInt32LE(
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET
  );
  if (api.setInformationJobObject(
    job,
    JobObjectExtendedLimitInformation,
    information,
    information.length
  ) === 0) {
    const win32Code = api.getLastError();
    api.closeHandle(job);
    throwWin32(api, "SetInformationJobObject", win32Code);
  }
  return job;
}
function probeCurrentTokenJobSupport(api) {
  const job = createKillOnCloseJob(api);
  closeHandleChecked(api, job, "current-token Job capability probe");
}
function closeHandleChecked(api, handle, detail) {
  if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", detail);
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/windows-job.ts
function isWindowsStartCancellationError(error) {
  return error.name === "Error" && error.message === "subprocess target start was cancelled" && error.code === void 0 && error.syscall === void 0 && error.path === void 0;
}
function probeWindowsJob(internals = {}) {
  try {
    const invocation = internals.runnerInvocation ?? (internals.resolveRunnerInvocation ?? spawnRunnerInvocation)();
    if (!(internals.runnerAvailable ?? runnerInvocationAvailable)(invocation)) return false;
    const api = (internals.loadWin32ProcessBindings ?? loadWin32ProcessBindings)();
    (internals.probeCurrentTokenJobSupport ?? probeCurrentTokenJobSupport)(api);
    return true;
  } catch {
    return false;
  }
}
var WindowsJobOwner = class {
  constructor(runner, exited, directResultType, failInfrastructure) {
    this.runner = runner;
    this.exited = exited;
    this.directResultType = directResultType;
    this.failInfrastructure = failInfrastructure;
    void this.exited.catch(() => {
    });
  }
  runner;
  exited;
  directResultType;
  failInfrastructure;
  cancellationReason;
  cancellationReasonSet = false;
  terminationSent = false;
  signal(_signal, cancellationReason) {
    if (!this.cancellationReasonSet) {
      this.cancellationReason = cancellationReason;
      this.cancellationReasonSet = true;
    }
    if (this.terminationSent || !this.runner.connected) return;
    this.terminationSent = true;
    try {
      this.runner.send?.({ type: "terminate" }, (error) => {
        if (error === null || this.directResultType() !== void 0) return;
        this.failInfrastructure(error);
        this.terminateForHostExit();
      });
    } catch (error) {
      this.failInfrastructure(error);
      this.terminateForHostExit();
    }
  }
  mapStartFailure(failure, serialized) {
    return this.cancellationReasonSet && isWindowsStartCancellationError(serialized) ? this.cancellationReason : failure;
  }
  async waitForExit() {
    await this.exited;
  }
  terminateForHostExit() {
    try {
      this.runner.kill("SIGKILL");
    } catch {
    }
  }
};
function launchWindowsJob(spec, targetEnv, internals = {}) {
  const invocation = internals.runnerInvocation ?? spawnRunnerInvocation();
  const [command, ...prefix] = invocation;
  const ignoredStdinFd = spec.stdio.stdin === "ignore" ? openSync3(devNull, "r") : void 0;
  let child;
  try {
    child = (internals.spawn ?? spawn3)(command, [
      ...prefix,
      "--",
      ...spec.argv
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      env: runnerEnvironment(WINDOWS_RUNNER_SELECTION, invocation),
      stdio: runnerStdio(spec, true, ignoredStdinFd ?? "pipe")
    });
  } finally {
    if (ignoredStdinFd !== void 0) closeSync3(ignoredStdinFd);
  }
  const targetStdin = child.stdio[4];
  const direct = Promise.withResolvers();
  const rangeExit = Promise.withResolvers();
  let directResultType;
  let runnerSpawned = false;
  let runnerExit;
  let ipcDisconnected = false;
  const failInfrastructure = (error) => {
    direct.reject(error);
    rangeExit.reject(error);
  };
  const settleRange = () => {
    if (!runnerSpawned || runnerExit === void 0) return;
    const { exitCode, signal } = runnerExit;
    if (exitCode === 0 && signal === null) {
      if (directResultType !== void 0) {
        rangeExit.resolve();
        return;
      }
      if (!ipcDisconnected) return;
    }
    const status = signal !== null ? `signal ${signal}` : exitCode === null ? "without an exit status" : `exit code ${String(exitCode)}`;
    failInfrastructure(new Error(
      `subprocess-local: Windows Job runner exited with ${status} before proving its managed range empty`
    ));
  };
  const owner = new WindowsJobOwner(
    child,
    rangeExit.promise,
    () => directResultType,
    failInfrastructure
  );
  child.on("message", (value) => {
    if (directResultType !== void 0) {
      const error = new Error("subprocess-local: Windows runner emitted more than one direct result");
      failInfrastructure(error);
      owner.terminateForHostExit();
      return;
    }
    let result;
    try {
      result = parseWindowsRunnerResult(value);
    } catch (error) {
      failInfrastructure(error);
      owner.terminateForHostExit();
      return;
    }
    directResultType = result.type;
    if (result.type === "target-exit") {
      direct.resolve({ exitCode: result.exitCode, signal: null });
    } else {
      direct.reject(owner.mapStartFailure(deserializeRunnerError(result.error), result.error));
    }
    settleRange();
  });
  child.once("spawn", () => {
    runnerSpawned = true;
    try {
      if (child.send === void 0) throw new Error("subprocess-local: Windows runner has no IPC channel");
      child.send({ type: "start", cwd: spec.cwd, env: targetEnv, ...spec.stdio.control === void 0 ? {} : { control: spec.stdio.control } }, (error) => {
        if (error === null) return;
        failInfrastructure(error);
        owner.terminateForHostExit();
      });
    } catch (error) {
      failInfrastructure(error);
      owner.terminateForHostExit();
    }
  });
  child.once("error", (error) => {
    if (!runnerSpawned) {
      direct.reject(error);
      rangeExit.resolve();
      return;
    }
    failInfrastructure(error);
  });
  child.once("exit", (exitCode, signal) => {
    runnerExit = { exitCode, signal };
    settleRange();
  });
  child.once("disconnect", () => {
    ipcDisconnected = true;
    settleRange();
  });
  return {
    stdin: spec.stdio.stdin === "ignore" ? null : targetStdin,
    stdout: child.stdio[5],
    stderr: child.stdio[6],
    control: controlPipe(child, spec.stdio.control),
    direct: direct.promise,
    owner
  };
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/terminal.ts
import { Buffer as Buffer2 } from "node:buffer";
import { constants } from "node:os";
import { PassThrough } from "node:stream";
function delay(ms, signal) {
  return new Promise((resolve5) => {
    const finish2 = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish2);
      resolve5();
    };
    const timer = setTimeout(finish2, ms);
    signal?.addEventListener("abort", finish2, { once: true });
  });
}
async function raceWithDelay(operation, ms, timeout) {
  const controller = new AbortController();
  try {
    return await Promise.race([
      operation,
      delay(ms, controller.signal).then(() => timeout)
    ]);
  } finally {
    controller.abort();
  }
}
function signalName(number) {
  if (number === void 0 || number === 0) return null;
  for (const [name, value] of Object.entries(constants.signals)) {
    if (value === number) return name;
  }
  return null;
}
var LocalTerminalHandle = class {
  /**
   * @param terminal - allocated node-pty process.
   * @param inspector - platform process/session operations.
   * @param graceMs - TERM-to-KILL and exit-wait grace.
   * @param platform - host platform; defaults to the running platform, injectable for deterministic tests.
   */
  constructor(terminal, inspector, graceMs, platform = process.platform, managedOwner, resolveManagedOutcome, shellActivity, onQuiescence, observeShellExit = false) {
    this.terminal = terminal;
    this.inspector = inspector;
    this.graceMs = graceMs;
    this.platform = platform;
    this.managedOwner = managedOwner;
    this.resolveManagedOutcome = resolveManagedOutcome;
    this.shellActivity = shellActivity;
    this.onQuiescence = onQuiescence;
    this.observeShellExit = observeShellExit;
    this.pid = terminal.pid;
    try {
      this.rootIdentity = inspector.snapshot().tree(this.pid).find((member) => member.pid === this.pid);
    } catch (_rootIdentityUnavailable) {
      this.rootIdentity = void 0;
    }
    this.done = this.outcome.promise;
    const resume = () => {
      if (!this.outputPaused) return;
      this.outputPaused = false;
      if (!this.exited) terminal.resume();
    };
    this.output.on("drain", resume);
    this.output.once("close", () => {
      this.output.off("drain", resume);
    });
    this.dataDisposable = terminal.onData((data) => {
      if (!this.output.write(Buffer2.from(data, "utf8")) && this.cleanup === void 0 && !this.outputPaused) {
        this.outputPaused = true;
        terminal.pause();
      }
    });
    this.exitDisposable = terminal.onExit(({ exitCode, signal: exitSignal }) => {
      if (this.exited) return;
      this.exited = true;
      if (this.managedOwner !== void 0 && this.observeShellExit) {
        void this.managedOwner.waitForExit().then(() => {
          this.managedRangeEmpty = true;
        }).catch(() => {
        });
      }
      this.output.end();
      const outcome = {
        exitCode: exitSignal === void 0 || exitSignal === 0 ? exitCode : null,
        signal: signalName(exitSignal)
      };
      try {
        this.outcome.resolve(this.resolveManagedOutcome?.(outcome) ?? outcome);
      } catch (error) {
        this.outcome.reject(error);
      }
    });
  }
  terminal;
  inspector;
  graceMs;
  platform;
  managedOwner;
  resolveManagedOutcome;
  shellActivity;
  onQuiescence;
  observeShellExit;
  pid;
  output = new PassThrough();
  done;
  outcome = Promise.withResolvers();
  dataDisposable;
  exitDisposable;
  cleanup;
  managedOwnerCleaned = false;
  exited = false;
  outputPaused = false;
  trackedDescendants = [];
  activityRevision = 0;
  activityKey = "";
  quiescent = false;
  managedRangeEmpty = false;
  /** The spawned shell's start identity; scans stop adopting members once the root pid no longer carries it. */
  rootIdentity;
  /** Whether node-pty has not yet published the top-level exit event. */
  get running() {
    return !this.exited;
  }
  // node-pty writes synchronously; the seam returns a promise for remote transports.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async write(data) {
    if (this.exited) throw new Error("terminal process has exited");
    this.shellActivity?.invalidate();
    this.terminal.write(data);
  }
  // oxlint-disable-next-line typescript/require-await -- Provider operations share promise rejection semantics.
  async resize(cols, rows) {
    if (this.exited) throw new Error("terminal process has exited");
    this.terminal.resize(cols, rows);
  }
  // Local inspection is synchronous; the seam returns a promise for remote transports.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async inspectForeground() {
    this.descendants(this.inspector.snapshot());
    const processGroupId = this.inspector.foregroundPgid(this.pid);
    if (processGroupId === void 0) return void 0;
    return {
      processGroupId,
      inputWaiting: this.inspector.isStdinWaiting(processGroupId, this.pid)
    };
  }
  // oxlint-disable-next-line typescript/require-await -- Local inspection is synchronous; SSH shares this promise interface.
  async inspectActivity() {
    let state = this.quiescent ? "idle" : "unknown";
    let revision = 0;
    if (!this.quiescent) {
      try {
        const shell = this.shellActivity?.inspect(this.pid) ?? { state: "unknown", revision: 0 };
        revision = shell.revision;
        const observed = this.inspector.snapshot();
        const descendants = this.descendants(observed);
        const root = observed.tree(this.pid).find((member) => member.pid === this.pid);
        if (this.exited && this.managedRangeEmpty) state = "idle";
        else if (descendants.length > 0) state = "busy";
        else if (this.exited && this.managedOwner === void 0 && this.platform === "linux" && observed.complete === true && root === void 0) {
          state = observed.session(this.pid).some((member) => observed.alive(member)) ? "busy" : "idle";
        } else if (observed.complete === true && root?.started === this.rootIdentity?.started && root !== void 0) {
          const foreground = this.inspector.foregroundPgid(this.pid);
          state = foreground === void 0 ? "unknown" : foreground === this.pid ? shell.state : "busy";
          if (state === "idle" && this.managedOwner !== void 0) {
            const tasks = this.managedOwner.inspectTaskCount?.();
            state = tasks === void 0 || tasks < 1 ? "unknown" : tasks === 1 ? "idle" : "busy";
          }
        }
      } catch (_incompleteActivityObservation) {
        state = "unknown";
      }
    }
    const key = `${revision}:${state}`;
    if (key !== this.activityKey) {
      this.activityKey = key;
      this.activityRevision++;
    }
    return { state, revision: this.activityRevision };
  }
  async signalForeground(signal) {
    this.shellActivity?.invalidate();
    const foreground = await this.inspectForeground();
    if (foreground === void 0) {
      throw new Error(`cannot resolve foreground process group for terminal ${this.pid}`);
    }
    if (signal === "SIGKILL" && foreground.processGroupId === this.pid) {
      throw new Error("refusing to SIGKILL the terminal shell; terminate the terminal session instead");
    }
    if (this.platform === "win32") {
      if (signal === "SIGINT") {
        this.terminal.write("");
        return foreground.processGroupId;
      }
      if (signal === "SIGTSTP" || signal === "SIGHUP") {
        throw new Error(`signal ${signal} is unsupported on Windows; only SIGINT, SIGTERM, and SIGKILL are available`);
      }
    }
    this.inspector.signalGroup(foreground.processGroupId, signal);
    return foreground.processGroupId;
  }
  terminate() {
    if (this.cleanup !== void 0) return this.cleanup;
    if (this.outputPaused) {
      this.outputPaused = false;
      this.terminal.resume();
    }
    const cleanup = this.closeOnce().then(() => {
      this.quiescent = true;
      this.shellActivity?.dispose();
      this.onQuiescence?.();
    });
    this.cleanup = cleanup;
    void cleanup.catch(() => {
      this.cleanup = void 0;
    });
    return cleanup;
  }
  /**
   * Force-terminate the observable session synchronously during Node's exit
   * event. This does not claim quiescence and does not replace terminate().
   */
  terminateForHostExit() {
    this.forceStopDescendants();
    this.forceStopShell();
    this.forceStopDescendants();
    this.managedOwner?.terminateForHostExit();
  }
  forceStopShell() {
    if (this.exited) return;
    if (this.rootIdentity !== void 0) {
      try {
        this.inspector.signalProcess(this.rootIdentity, "SIGKILL");
      } catch (_rootExitedDuringHostExit) {
      }
      return;
    }
    try {
      this.terminal.kill("SIGKILL");
    } catch (_unidentifiedShellExitedDuringHostExit) {
    }
  }
  survivors(members, observed) {
    return members.filter((member) => observed.alive(member));
  }
  descendants(observed) {
    const tree = observed.tree(this.pid);
    const root = tree.find((member) => member.pid === this.pid);
    const rootVerified = this.rootIdentity !== void 0 && root !== void 0 && root.started === this.rootIdentity.started;
    this.trackedDescendants = this.survivors(this.unionMembers(
      this.trackedDescendants,
      ...rootVerified ? [tree, observed.session(this.pid)] : []
    ).filter((member) => member.pid !== this.pid), observed);
    return this.trackedDescendants;
  }
  async waitForMembers(members) {
    if (members.length === 0) return [];
    const until = Date.now() + this.graceMs;
    let survivors = this.survivors(members, this.inspector.snapshot());
    while (survivors.length > 0 && Date.now() < until) {
      await delay(Math.min(25, Math.max(1, until - Date.now())));
      survivors = this.survivors(members, this.inspector.snapshot());
    }
    return survivors;
  }
  signalMembers(members, signal) {
    for (const member of members) {
      try {
        this.inspector.signalProcess(member, signal);
      } catch (_alreadyExitedDuringSignal) {
      }
    }
  }
  forceStopDescendants() {
    let members = this.trackedDescendants;
    try {
      members = this.descendants(this.inspector.snapshot());
    } catch (_processTableUnavailableDuringHostExit) {
    }
    this.signalMembers(members, "SIGKILL");
  }
  unionMembers(...groups) {
    const members = [];
    const seen = /* @__PURE__ */ new Set();
    for (const group of groups) {
      for (const member of group) {
        const key = `${member.pid}:${member.started}`;
        if (seen.has(key)) continue;
        seen.add(key);
        members.push(member);
      }
    }
    return members;
  }
  async stopDescendants() {
    const captured = this.descendants(this.inspector.snapshot());
    this.signalMembers(captured, "SIGTERM");
    const capturedSurvivors = await this.waitForMembers(captured);
    const members = this.unionMembers(capturedSurvivors, this.descendants(this.inspector.snapshot()));
    this.signalMembers(members, "SIGKILL");
    const survivors = await this.waitForMembers(members);
    const observed = this.inspector.snapshot();
    return this.survivors(this.unionMembers(survivors, this.descendants(observed)), observed);
  }
  async stopShell() {
    if (this.platform === "win32") {
      await this.stopShellWindows();
      return;
    }
    if (!this.exited) {
      try {
        this.terminal.kill("SIGTERM");
      } catch (_topLevelAlreadyExitedDuringTerm) {
      }
      await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
    }
    if (!this.exited) {
      try {
        this.terminal.kill("SIGKILL");
      } catch (_topLevelAlreadyExitedDuringKill) {
      }
      await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
    }
    if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
  }
  async stopShellWindows() {
    const shellGone = () => this.exited || this.rootIdentity !== void 0 && !this.inspector.isAlive(this.rootIdentity);
    if (!shellGone() && this.rootIdentity !== void 0) {
      this.inspector.signalProcess(this.rootIdentity, "SIGTERM");
      await this.waitForWindowsShellExit();
    }
    if (!shellGone() && this.rootIdentity === void 0) {
      try {
        this.terminal.kill();
      } catch (_topLevelAlreadyExitedDuringKill) {
      }
      await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
    }
    if (!shellGone() && this.rootIdentity !== void 0) {
      this.inspector.signalProcess(this.rootIdentity, "SIGKILL");
      await this.waitForWindowsShellExit();
    }
    if (!shellGone()) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
  }
  async waitForWindowsShellExit() {
    const until = Date.now() + this.graceMs;
    while (!this.exited && Date.now() < until) {
      if (this.rootIdentity !== void 0 && !this.inspector.isAlive(this.rootIdentity)) return;
      await delay(Math.min(25, Math.max(1, until - Date.now())));
    }
  }
  async closeOnce() {
    if (this.managedOwner !== void 0) {
      try {
        await this.closeManagedRange(this.managedOwner);
        this.dataDisposable.dispose();
        this.exitDisposable.dispose();
      } finally {
        void this.done.finally(() => {
          this.cleanupManagedOwner(this.managedOwner);
        }).catch(() => {
        });
      }
      return;
    }
    let survivors = await this.stopDescendants();
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map((member) => member.pid).join(", ")}`);
    }
    await this.stopShell();
    survivors = await this.stopDescendants();
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map((member) => member.pid).join(", ")}`);
    }
    this.settleExitIfGone();
    this.dataDisposable.dispose();
    this.exitDisposable.dispose();
  }
  cleanupManagedOwner(owner) {
    if (this.managedOwnerCleaned) return;
    this.managedOwnerCleaned = true;
    owner.cleanup?.();
  }
  async closeManagedRange(owner) {
    owner.signal("SIGTERM");
    const observation = owner.waitForExit();
    const first = await raceWithDelay(observation.then(
      () => ({ kind: "stopped" }),
      (error) => ({ kind: "failed", error })
    ), this.graceMs, { kind: "timeout" });
    if (first.kind !== "stopped") {
      owner.signal("SIGKILL");
      if (first.kind === "failed") {
        try {
          await owner.waitForExit();
        } catch (finalError) {
          throw new AggregateError([first.error, finalError], "terminal managed-range cleanup failed");
        }
        throw first.error;
      }
      await observation;
    }
    if (!this.exited) {
      await raceWithDelay(this.done.then(() => void 0), this.graceMs, void 0);
    }
    if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`);
  }
  settleExitIfGone() {
    if (this.platform !== "win32") return;
    if (this.exited) return;
    if (this.rootIdentity !== void 0 && this.inspector.isAlive(this.rootIdentity)) return;
    this.exited = true;
    this.output.end();
    this.outcome.resolve({ exitCode: null, signal: null });
  }
};

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/shell-activity.ts
import { mkdtempSync as mkdtempSync3, readFileSync as readFileSync4, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { basename as basename3, join as join5 } from "node:path";
function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
var ShellActivity = class {
  /**
   * @param directory - private startup and status file directory.
   * @param argv - shell launch preserving supported user startup files.
   * @param env - environment with any temporary startup redirect.
   */
  constructor(directory, argv, env) {
    this.directory = directory;
    this.argv = argv;
    this.env = env;
  }
  directory;
  argv;
  env;
  revision = 0;
  observed = "";
  invalidated;
  state = "unknown";
  /** Invalidate prompt evidence before delivering input or a foreground signal. */
  invalidate() {
    this.invalidated = this.read();
    this.revision++;
    this.state = "unknown";
  }
  /**
   * Read the latest top-level shell transition, fenced against input since that transition.
   * @param pid - original shell process id.
   * @returns lifecycle evidence; process ownership must be checked separately.
   */
  inspect(pid) {
    const record = this.read();
    if (record !== this.observed) {
      this.observed = record;
      this.revision++;
    }
    const match = /^(\d+):(\d+):(idle|busy)\n?$/u.exec(record);
    this.state = record === this.invalidated || match?.[1] !== String(pid) ? "unknown" : match[3];
    return { state: this.state, revision: this.revision };
  }
  /** Remove private startup and status files after process quiescence. */
  dispose() {
    rmSync(this.directory, { recursive: true, force: true });
  }
  read() {
    try {
      return readFileSync4(join5(this.directory, "state"), "utf8");
    } catch (_unavailableShellObservation) {
      return "";
    }
  }
};
function prepareShellActivity(spec, env, platform) {
  if (spec.shellActivity !== true || platform === "win32" || spec.argv.length !== 2 || spec.argv[1] !== "-i") return void 0;
  const shell = basename3(spec.argv[0]);
  if (shell !== "bash" && shell !== "zsh") return void 0;
  const directory = mkdtempSync3(join5(tmpdir3(), "dsh-shell-"));
  const state = quote(join5(directory, "state"));
  const guards = quote(join5(directory, "guards"));
  try {
    if (shell === "bash") {
      const rc = join5(directory, "bashrc");
      writeFileSync2(rc, [
        "[[ ! -r ~/.bashrc ]] || builtin source ~/.bashrc",
        "if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) && [[ ! $(declare -p PROMPT_COMMAND PS0 2>/dev/null) =~ declare\\ -[^[:space:]]*r ]]; then",
        "  __dsh_shell_pid=$BASHPID; __dsh_shell_sequence=0",
        "  __dsh_shell_idle() {",
        "    local result=$?",
        '    if [[ $BASHPID == "$__dsh_shell_pid" ]]; then',
        "      (( ++__dsh_shell_sequence ))",
        "      local activity=idle",
        `      builtin trap -p >| ${guards}`,
        `      [[ ! -s ${guards} ]] || activity=unknown`,
        `      builtin printf '%s:%s:%s\\n' "$BASHPID" "$__dsh_shell_sequence" "$activity" >| ${state}`,
        "    fi",
        '    return "$result"',
        "  }",
        '  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a "* ]]; then',
        "    PROMPT_COMMAND+=(__dsh_shell_idle)",
        "  else",
        `    PROMPT_COMMAND="\${PROMPT_COMMAND}"$'\\n'"__dsh_shell_idle"`,
        "  fi",
        `  PS0+=${quote(`$(builtin printf '%s:%s:busy' "$__dsh_shell_pid" "$__dsh_shell_sequence" >| ${state})`)}`,
        "fi",
        ""
      ].join("\n"), { mode: 384, flag: "wx" });
      return new ShellActivity(directory, [spec.argv[0], "--rcfile", rc, "-i"], env);
    }
    writeFileSync2(join5(directory, ".zshenv"), [
      env.ZDOTDIR === void 0 ? "unset ZDOTDIR" : `ZDOTDIR=${quote(env.ZDOTDIR)}`,
      '[[ ! -r ${ZDOTDIR:-$HOME}/.zshenv ]] || builtin source "${ZDOTDIR:-$HOME}/.zshenv"',
      "typeset -g __dsh_shell_pid=$$ __dsh_shell_sequence=0",
      "__dsh_shell_activity() {",
      "  (( ZSH_SUBSHELL == 0 && $$ == __dsh_shell_pid )) || return",
      "  (( ++__dsh_shell_sequence ))",
      `  builtin printf '%s:%s:%s\\n' "$$" "$__dsh_shell_sequence" "$1" >| ${state}`,
      "  return 0",
      "}",
      "__dsh_shell_idle() {",
      `  { builtin trap; zle -F; } >| ${guards}`,
      "  if [[ $CONTEXT != start || -n $BUFFER ]]; then __dsh_shell_activity busy",
      `  elif [[ -s ${guards} || -n \${(k)functions[(I)TRAP*]} ]]; then __dsh_shell_activity unknown`,
      "  else __dsh_shell_activity idle; fi",
      "}",
      "__dsh_shell_busy() { __dsh_shell_activity busy }",
      "__dsh_shell_init() {",
      "  autoload -Uz add-zle-hook-widget add-zsh-hook",
      "  add-zle-hook-widget line-init __dsh_shell_idle",
      "  add-zle-hook-widget line-finish __dsh_shell_busy",
      "  add-zsh-hook preexec __dsh_shell_busy",
      "  precmd_functions=(${precmd_functions:#__dsh_shell_init})",
      "}",
      "typeset -ga precmd_functions",
      "precmd_functions+=(__dsh_shell_init)",
      ""
    ].join("\n"), { mode: 384, flag: "wx" });
    return new ShellActivity(directory, spec.argv, { ...env, ZDOTDIR: directory });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/index.ts
var requireNodePty = createLazyRequire("node-pty", import.meta.url);
var LocalSubprocessRuntime = class extends SubprocessRuntime {
  /** Live handles retained for normal disposal and synchronous host-exit finalization. */
  live = /* @__PURE__ */ new Set();
  /** Live terminals retained through normal quiescence or host-exit finalization. */
  terminals = /* @__PURE__ */ new Set();
  /** Caller endpoints retained until close, independently of managed process lifetime. */
  controlChannels = /* @__PURE__ */ new Set();
  /** Test hook: process, spill, and platform operations forwarded to spawnSubprocess. */
  internals = {};
  /** Provider-lifetime latch suppressing repeated weaker-containment warnings. */
  fallbackWarningIssued = false;
  /**
   * Linux native containment decisions. Each probe is a spawnSync that blocks the event loop and forks the
   * host, so the selector reruns it only after an event invalidates the previous verdict.
   */
  linuxScope = new LinuxScopeSelector({
    probe: () => probeLinuxNative(),
    managerListener: () => linuxManagerListener(),
    confirmManager: () => confirmLinuxManager(),
    launcherIdentity: () => systemdRunIdentity()
  });
  /** Scope decision of the launch in progress; selectContainmentMode sets it immediately before the launch reads it. */
  linuxScopeDecision;
  /** Test hook for platform process inspection; production resolves lazily on terminal spawn. */
  terminalInspector;
  constructor(ctx2) {
    super(ctx2);
    ctx2.effect(() => {
      const onHostExit = () => {
        this.terminateForHostExit();
      };
      process.prependListener("exit", onHostExit);
      return async () => {
        await this.disposeManagedProcesses();
        process.off("exit", onHostExit);
      };
    }, "local subprocess teardown");
  }
  /** Spill failures reach the plugin logger; the log line is the only trace of why a result has no spill path. */
  reportSpillFailure = logSpillFailure(this.ctx.logger, "subprocess-local");
  terminateForHostExit() {
    for (const handle of this.live) {
      try {
        handle.terminateForHostExit();
      } catch (_ordinaryRangeTerminationFailed) {
      }
    }
    for (const terminal of this.terminals) {
      try {
        terminal.terminateForHostExit();
      } catch (_terminalTerminationFailed) {
      }
    }
  }
  async disposeManagedProcesses() {
    const pending = [];
    for (const handle of this.live) {
      handle.terminate();
      pending.push(Promise.all([
        handle.done.catch(() => {
        }),
        handle.waitForExit()
      ]).then(() => {
        this.live.delete(handle);
      }));
    }
    for (const terminal of this.terminals) {
      pending.push(terminal.terminate().then(() => {
        this.terminals.delete(terminal);
      }));
    }
    const outcomes = await Promise.allSettled(pending);
    await Promise.all([...this.controlChannels].map((control) => new Promise((resolveClose) => {
      control.once("close", () => {
        resolveClose();
      });
      control.destroy();
    })));
    this.controlChannels.clear();
    const failures = [];
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") failures.push(outcome.reason);
    }
    if (failures.length > 0) this.terminateForHostExit();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "local subprocess teardown failed");
  }
  async resolveExecutable(command, env, signal) {
    if (command.length === 0) throw new Error("subprocess-local: executable must be non-empty");
    signal?.throwIfAborted();
    const environment = childEnv(env);
    const absolute = isAbsolute5(command);
    if (!absolute && (command.includes("/") || process.platform === "win32" && command.includes("\\"))) {
      throw new Error(
        `subprocess-local: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`
      );
    }
    const candidates = absolute ? [command] : this.executableCandidates(command, environment);
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try {
        const info = await stat2(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants2.X_OK);
        signal?.throwIfAborted();
        return candidate;
      } catch {
      }
    }
    signal?.throwIfAborted();
    throw new SubprocessExecutableNotFoundError(absolute ? `subprocess-local: command ${JSON.stringify(command)} is not an executable file` : `subprocess-local: command ${JSON.stringify(command)} was not found on PATH`);
  }
  executableCandidates(command, env) {
    const path = environmentValue(env, "PATH") ?? "";
    const extensions = process.platform === "win32" && extname2(command) === "" ? (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
    return path.split(delimiter).flatMap((directory) => extensions.map((extension) => resolve3(process.cwd(), directory, command + extension)));
  }
  spawn(spec) {
    validateSubprocessSpec(spec);
    const env = targetEnvironment(spec);
    const containmentMode = this.selectContainmentMode("ordinary");
    let handle;
    const internals = { ...this.internals, onSpillFailure: this.reportSpillFailure };
    if (containmentMode === "fallback") {
      handle = spawnSubprocess(spec, internals);
    } else {
      const binding = prepareManagedProcessBinding(internals);
      const linuxScope = containmentMode === "linux-scope" ? this.linuxScopeDecision : void 0;
      const launch = linuxScope === void 0 ? launchWindowsJob(spec, env) : launchLinuxScope(spec, env, linuxScope.literalArgv);
      handle = bindManagedProcess(spec, launch, binding);
      if (linuxScope !== void 0) this.watchLinuxScopeStart(handle.done, linuxScope.generation);
    }
    this.live.add(handle);
    const control = handle.control;
    if (control !== void 0) {
      this.controlChannels.add(control);
      control.once("close", () => {
        this.controlChannels.delete(control);
      });
    }
    const release = () => handle.waitForExit().then(() => {
      this.live.delete(handle);
    });
    void handle.done.then(release, release).catch(() => {
    });
    return handle;
  }
  /** Probe again before the next launch when a scope launched under generation never started its target. */
  watchLinuxScopeStart(done, generation) {
    void done.catch((error) => {
      if (error instanceof LinuxScopeNotStartedError) this.linuxScope.scopeNotStarted(generation);
    });
  }
  selectContainmentMode(kind) {
    const platform = this.internals.platform ?? process.platform;
    let fallbackReason;
    if (platform === "linux") {
      const decision = this.linuxScope.select();
      const probe2 = decision.probe === void 0 ? "" : `, probed after ${decision.probe}`;
      this.ctx.logger.debug(`linux native containment: ${decision.kind} (${decision.reason}${probe2})`);
      if (decision.kind === "scope") {
        this.linuxScopeDecision = decision;
        return "linux-scope";
      }
      fallbackReason = "the current user-systemd scope or private bootstrap is unavailable";
    }
    if (kind === "ordinary" && platform === "win32") {
      const available = probeWindowsJob();
      if (available) return "windows-job";
    }
    this.warnFallback(platform, kind, fallbackReason);
    return "fallback";
  }
  warnFallback(platform, kind, selectedReason) {
    if (this.fallbackWarningIssued) return;
    this.fallbackWarningIssued = true;
    const reason = selectedReason ?? (platform === "darwin" ? "macOS has no supported persistent process-range owner" : platform === "win32" ? kind === "terminal" ? "Windows ConPTY remains outside Job containment" : "the Win32 Job runner is unavailable" : `platform ${platform} has no native managed range`);
    this.ctx.logger.warn(
      `subprocess-local is using weaker process-tree containment because ${reason}; descendants that escape the process group or direct-parent tree are not guaranteed to terminate or delay waitForExit()`
    );
  }
  /** @inheritdoc */
  // oxlint-disable-next-line typescript/require-await -- Keep the provider promise rejection semantics for cancelled inspection.
  async terminalEnvironment(signal) {
    signal?.throwIfAborted();
    const platform = process.platform === "win32" ? "windows" : "posix";
    const defaultShell = platform === "windows" ? process.env.ComSpec || void 0 : process.env.SHELL || userInfo().shell || void 0;
    return { platform, ...defaultShell === void 0 ? {} : { defaultShell } };
  }
  // Local PTY allocation is synchronous, but the provider contract permits remote asynchronous allocation.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async spawnTerminal(spec) {
    const file = spec.argv[0];
    if (file === void 0 || file.length === 0) {
      throw new Error("subprocess-local: terminal argv must contain a program");
    }
    spec.signal?.throwIfAborted();
    const inspector = this.terminalInspector ?? createProcessInspector();
    const containmentMode = this.selectContainmentMode("terminal");
    const env = targetEnvironment(spec);
    const platform = this.internals.platform ?? process.platform;
    const activity = prepareShellActivity(spec, env, platform);
    const launch = activity === void 0 ? spec : { ...spec, argv: activity.argv, env: activity.env };
    const options = {
      name: spec.terminalType,
      rows: spec.rows,
      cols: spec.cols,
      cwd: spec.cwd,
      env: { ...activity?.env ?? env, TERM: spec.terminalType },
      // Windows' own console host (the standby pool runs Server 2022 and
      // Windows 10 22H2) renders the persistent-pwsh prompt tail in a form the
      // readiness path cannot match; the console host node-pty ships emits it
      // verbatim, see [Agent Note](../../../../.agents/notes/implemented/bug-fix/2026-09-28-pty-bundled-console-host.md).
      ...platform === "win32" ? { useConptyDll: true } : {}
    };
    const linuxScope = containmentMode === "linux-scope" ? this.linuxScopeDecision : void 0;
    let scope;
    let terminal;
    try {
      scope = linuxScope === void 0 ? void 0 : prepareLinuxTerminalScope(launch, { ...activity?.env ?? env, PWD: spec.cwd, TERM: spec.terminalType }, linuxScope.literalArgv);
      if (scope !== void 0) {
        options.cwd = scope.cwd;
        options.env = scope.env;
      }
      terminal = requireNodePty().spawn(
        scope?.command ?? file,
        scope?.args ?? [...launch.argv.slice(1)],
        options
      );
    } catch (error) {
      scope?.cleanup();
      activity?.dispose();
      throw error;
    }
    let handle;
    const directSettlement = Promise.withResolvers();
    const owner = scope?.bindOwner({
      running: () => handle?.running ?? true,
      settled: directSettlement.promise,
      // node-pty swallows signal errors; the scope owner requires their delivery result.
      signal: (signal) => signalLinuxDirectProcess(terminal.pid, () => process.kill(terminal.pid, signal))
    });
    handle = new LocalTerminalHandle(
      terminal,
      inspector,
      spec.graceMs,
      platform,
      owner,
      scope?.resolveOutcome,
      activity,
      () => {
        this.terminals.delete(handle);
      },
      spec.shellActivity === true
    );
    this.terminals.add(handle);
    if (linuxScope !== void 0) this.watchLinuxScopeStart(handle.done, linuxScope.generation);
    const release = async () => {
      directSettlement.resolve();
      if (spec.shellActivity === true) return;
      await handle.terminate();
      this.terminals.delete(handle);
    };
    void handle.done.then(release, release).catch(() => {
    });
    return handle;
  }
};
function environmentValue(env, name) {
  const exact = env[name];
  if (exact !== void 0 || process.platform !== "win32") return exact;
  const normalized = name.toUpperCase();
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1];
}

// files-runtime.ts
import { createInterface } from "node:readline";
import { resolve as resolve4 } from "node:path";
import { Console } from "node:console";

// third_party/dsh-tools/packages/util/code-language/src/index.ts
var LANGUAGE_EXTENSIONS = {
  typescript: ["ts", "tsx", "mts", "cts"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  shellscript: ["sh", "bash", "zsh"],
  fish: ["fish"],
  json: ["json", "jsonc", "jsonl", "ndjson", "ipynb"],
  csv: ["csv"],
  python: ["py", "pyw", "pyi"],
  ruby: ["rb", "rake", "gemspec"],
  go: ["go"],
  rust: ["rs"],
  java: ["java"],
  c: ["c", "h"],
  cpp: ["cc", "cpp", "cxx", "hh", "hpp", "hxx"],
  csharp: ["cs"],
  kotlin: ["kt", "kts"],
  swift: ["swift"],
  php: ["php"],
  yaml: ["yaml", "yml"],
  toml: ["toml"],
  ini: ["ini", "conf", "cfg", "properties"],
  dotenv: ["env"],
  log: ["log"],
  diff: ["diff", "patch"],
  http: ["http"],
  markdown: ["md", "markdown"],
  mdx: ["mdx"],
  rst: ["rst"],
  latex: ["tex", "sty", "cls"],
  bibtex: ["bib"],
  asciidoc: ["adoc"],
  html: ["html", "htm", "xhtml"],
  css: ["css"],
  scss: ["scss"],
  less: ["less"],
  sql: ["sql"],
  xml: ["xml", "xsd", "xsl", "xslt", "plist", "svg"],
  lua: ["lua"],
  bat: ["bat", "cmd"],
  powershell: ["ps1", "psm1", "psd1"],
  r: ["r"],
  julia: ["jl"],
  dart: ["dart"],
  scala: ["scala"],
  clojure: ["clj", "cljs", "edn"],
  erlang: ["erl", "hrl"],
  elixir: ["ex", "exs"],
  haskell: ["hs"],
  fsharp: ["fs", "fsi", "fsx"],
  vb: ["vb"],
  perl: ["pl", "pm"],
  verilog: ["v"],
  "system-verilog": ["sv", "svh"],
  graphql: ["graphql", "gql"],
  proto: ["proto"],
  hcl: ["tf", "tfvars", "hcl"],
  nix: ["nix"],
  vue: ["vue"],
  svelte: ["svelte"],
  make: ["makefile", "mk"],
  cmake: ["cmake"],
  groovy: ["gradle", "groovy"]
};
var LANGUAGES = new Map(Object.entries(LANGUAGE_EXTENSIONS).flatMap(([language, extensions]) => extensions.map((extension) => [extension, language])));
var CODE_HIGHLIGHT_EXTENSIONS = [...LANGUAGES.keys()];

// third_party/dsh-tools/packages/fs/tool-fs/src/read-render.ts
var READ_MAX_LINE_LENGTH = 2e3;
var READ_MAX_BYTES = 50 * 1024;
function newAccumulator() {
  return { lines: [], totalLines: 0, outputBytes: 0, truncatedByBytes: false };
}
function truncateLine(line, maxLineLength) {
  return line.length > maxLineLength ? `${line.substring(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)` : line;
}
function lineByteSize(line, currentLineCount) {
  return Buffer.byteLength(line, "utf8") + (currentLineCount > 0 ? 1 : 0);
}
function consumeLine(acc, rawLine, request) {
  acc.totalLines += 1;
  if (acc.truncatedByBytes || acc.totalLines < request.offset || acc.lines.length >= request.limit) return;
  const text = truncateLine(rawLine, request.maxLineLength);
  const bytes = lineByteSize(text, acc.lines.length);
  if (acc.outputBytes + bytes > request.maxBytes) {
    acc.truncatedByBytes = true;
    return;
  }
  acc.outputBytes += bytes;
  acc.lines.push({ number: acc.totalLines, text });
}
function stripCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function finish(acc, request, displayPath) {
  if (!acc.truncatedByBytes && request.offset > acc.totalLines && !(acc.totalLines === 0 && request.offset === 1)) {
    throw new FsError(`offset ${request.offset} is out of range for "${displayPath}" (${acc.totalLines} lines)`, "FS_NOT_FOUND");
  }
  return { lines: acc.lines, totalLines: acc.totalLines, truncatedByBytes: acc.truncatedByBytes };
}
async function buildWindow(chunks, request, displayPath) {
  const acc = newAccumulator();
  const lineBufferCap = request.maxLineLength + 1;
  let lineBuffer = "";
  function appendToLineBuffer(segment) {
    if (lineBuffer.length >= lineBufferCap) return;
    lineBuffer += segment;
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap);
  }
  function flushLine() {
    consumeLine(acc, stripCarriageReturn(lineBuffer), request);
    lineBuffer = "";
  }
  for await (const chunk of chunks) {
    let startPos = 0;
    let newlinePos;
    while ((newlinePos = chunk.indexOf("\n", startPos)) !== -1) {
      appendToLineBuffer(chunk.slice(startPos, newlinePos));
      flushLine();
      startPos = newlinePos + 1;
    }
    appendToLineBuffer(chunk.slice(startPos));
  }
  if (lineBuffer.length > 0) flushLine();
  return finish(acc, request, displayPath);
}

// third_party/dsh-tools/packages/util/values/src/partial-json.ts
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class _PartialArguments {
  /** The view of a call with no arguments available. */
  static EMPTY = _PartialArguments.fromObject({});
  /**
   * View finished argument text without scanning it until a reader asks.
   * @param text - the complete argument JSON text.
   * @returns a sealed view.
   */
  static fromText(text) {
    const view = new _PartialArguments();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
   * View an already parsed argument payload, such as a PTC dispatch object.
   * @param value - the parsed argument value.
   * @returns a sealed view; a non-object payload has no fields.
   */
  static fromObject(value) {
    const view = new _PartialArguments();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
   * The source: text so far or a parsed object, plus whether it can still grow.
   * These are the only enumerable fields, so two views over the same source
   * compare equal structurally however far each has been read.
   */
  chunks = [];
  object;
  sealed = false;
  // Scan progress, located fields, and remembered reads are caches over the source.
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
   * Retain streamed argument text without scanning or comparing observed answers.
   * @param fragment - the text following every fragment appended before.
   */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
   * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
   * @param text - the final argument text, which replaces missing or conflicting deltas.
   * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
   */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return _PartialArguments.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return _PartialArguments.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
   * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
   * @returns whether any observed answer changed since its first read or the preceding refresh.
   */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read of this.#reads.values()) {
      if (read.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read) || changed;
    }
    if (completions) {
      for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read) {
    const now = read.answer();
    if (Object.is(now, read.last)) return false;
    read.last = now;
    return true;
  }
  /**
   * Check whether no further fields can arrive.
   * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
   */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
   * List discovered fields in first-appearance order.
   * @returns top-level keys seen so far, in first-appearance order.
   */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
   * Check whether a top-level field has appeared.
   * @param key - argument name.
   * @returns whether the field has appeared (a string opened or another value began).
   */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
   * Check whether a field's closing delimiter has arrived, without validating its contents.
   * @param key - argument name.
   * @returns whether its delimiter arrived and no content reader has reported an error for this value.
   */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
   * Read string length without materializing its text.
   * @param key - argument name.
   * @param options - change granularity for a streaming string.
   * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
   */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(
      `length:${step}:${offset}`,
      key,
      () => this.lengthNow(key),
      (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step)
    );
  }
  /**
   * Check a string against a decoded UTF-16 length limit without materializing it.
   * @param key - argument name.
   * @param maxLength - decoded UTF-16 limit, floored to at least zero.
   * @returns whether the string is longer than the limit; false when absent or not a string.
   */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(
      `exceeds:${limit}`,
      key,
      () => (this.lengthNow(key, limit + 1) ?? 0) > limit
    );
  }
  /**
   * Read a decoded string, including a streaming prefix.
   * @param key - argument name.
   * @returns the string field's decoded text so far; undefined when absent or not a string.
   */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
   * Read at most the first decoded UTF-16 units of a string.
   * @param key - argument name.
   * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
   * @returns the bounded string prefix; undefined when absent or not a string.
   */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(
      `prefix:${limit}`,
      key,
      () => this.textPrefixNow(key, limit)
    );
  }
  /**
   * Read a completed non-string argument.
   * @param key - argument name.
   * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
   */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read, comparison) {
    this.scan();
    const result = read();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) {
        this.#reads.set(id, {
          completion: kind === "complete",
          answer: comparison === void 0 ? read : () => comparison(read()),
          last: comparison === void 0 ? result : comparison(result)
        });
      }
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read = entry.length ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, limit, false);
    return read.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = { at: entry.end, length: text.length, text };
    }
    const read = entry.text ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, Number.POSITIVE_INFINITY, true);
    return read.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read = prefixes.get(maxLength);
    if (read === void 0) {
      read = { at: entry.start, length: 0, text: "" };
      prefixes.set(maxLength, read);
    }
    this.readString(entry, read, maxLength, true);
    return read.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field = this.object[key];
      return typeof field === "string" ? void 0 : field;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) {
      try {
        entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
      } catch (_error) {
        entry.invalid = true;
        this.#invalidValue = true;
      }
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read, limit, materialize) {
    const end = Math.min(
      entry.end < 0 ? this.#consumed : entry.end,
      entry.invalidAt ?? Number.POSITIVE_INFINITY,
      this.#invalidAt ?? Number.POSITIVE_INFINITY
    );
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize) read.text += this.slice(read.at, read.at + length);
      read.at += length;
      read.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read.at);
    while (read.at < end && read.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
      if (length > 0) {
        if (materialize) read.text += remaining.slice(0, length);
        read.at += length;
        read.length += length;
        if (read.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) {
        decoded = SIMPLE_ESCAPES[type];
      }
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read.text += decoded;
      read.length++;
      read.at += width;
      while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote2 = fragment.indexOf('"', at);
      const end = quote2 < 0 ? fragment.length : quote2;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote2 < 0 && escaped;
      if (quote2 < 0 || !escaped) return end;
      at = quote2 + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) {
      try {
        this.#key = JSON.parse(`"${raw}"`);
      } catch (_error) {
        this.fail();
        return;
      }
    } else {
      this.#key = raw;
    }
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({ kind: "value", start: at, end: -1, parsed: void 0, invalid: false });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};

// third_party/dsh-tools/packages/util/values/src/index.ts
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}

// third_party/dsh-tools/packages/fs/tool-fs-search/src/search-core.ts
import { existsSync as existsSync3 } from "node:fs";
import { isAbsolute as isAbsolute6, join as join6, parse, relative as relative2, sep as sep3 } from "node:path";

// third_party/dsh-tools/packages/util/output-retention/src/index.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();

// third_party/dsh-tools/packages/fs/tool-fs-search/src/search-core.ts
var RAW_OUTPUT_MAX_BYTES = 2e7;
var SEARCH_TIMEOUT_MS = 3e4;
var SEARCH_STDERR_MAX_BYTES = 64 * 1024;
var SEARCH_GRACE_MS = 3e3;
var SearchError = class extends HarnessError {
  code;
  constructor(message, code, options) {
    super(message, code, options);
    this.code = code;
  }
};
function stderrExcerpt(stderrText, truncated) {
  const text = stderrText.trim();
  if (text.length === 0) return "";
  return truncated ? `${text} [stderr truncated]` : text;
}
function classifyRunFailure(toolName, exitCode, stderrText, stderrTruncated) {
  const stderr = stderrExcerpt(stderrText, stderrTruncated);
  if (/regex parse error|error parsing glob/i.test(stderr)) {
    return new SearchError(`${toolName} pattern rejected by ripgrep: ${stderr}`, "SEARCH_INVALID_PATTERN");
  }
  return new SearchError(`${toolName} search failed (exit ${exitCode})${stderr.length > 0 ? `: ${stderr}` : ""}`, "SEARCH_FAILED");
}
function completeStdout(toolName, stdout, rawOutputMaxBytes) {
  const narrow = "narrow pattern, path, or include and retry";
  if (!stdout.lossy) {
    const inlineBytes = Buffer.byteLength(stdout.text, "utf8");
    if (inlineBytes > rawOutputMaxBytes) {
      throw new SearchError(
        `${toolName} produced ${inlineBytes} bytes of raw output, over the ${rawOutputMaxBytes}-byte cap; ${narrow}`,
        "SEARCH_RAW_OUTPUT_OVERFLOW"
      );
    }
    return stdout.text;
  }
  throw new SearchError(
    `${toolName} produced more raw output than the subprocess seam retained within the ${rawOutputMaxBytes}-byte cap; ${narrow}`,
    "SEARCH_RAW_OUTPUT_OVERFLOW"
  );
}
var rgPathPromise;
function resolveRgPath() {
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executable = parse(process.execPath);
    const executableSidecar = process.platform === "win32" ? join6(executable.dir, `${executable.name}-rg.exe`) : `${process.execPath}-rg`;
    if ("pkg" in process && existsSync3(executableSidecar)) return executableSidecar;
    const dependency = (await import("@vscode/ripgrep")).rgPath;
    return process.versions.electron === void 0 ? dependency : dependency.replace(/\.asar(?=[\\/])/u, ".asar.unpacked");
  });
  return rgPathPromise;
}
async function runRipgrep(ctx2, exec, toolName, argv, rawOutputMaxBytes, graceMs, stderrMaxBytes) {
  if (exec.signal.aborted) {
    throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, "SEARCH_ABORTED");
  }
  const workdir = exec.agent === void 0 ? process.cwd() : await ctx2.workingDirectory.ensure(exec.agent, exec.signal);
  let handle;
  try {
    handle = ctx2.subprocess.spawn({
      argv: [await resolveRgPath(), "--no-config", ...argv],
      cwd: workdir,
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: rawOutputMaxBytes },
        stderr: { maxBytes: stderrMaxBytes }
      },
      graceMs,
      signal: exec.signal
    });
  } catch (error) {
    if (exec.signal.aborted) {
      throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, "SEARCH_ABORTED");
    }
    throw new SearchError(`${toolName} could not start its search command (ripgrep launch failed)`, "SEARCH_FAILED", { cause: error });
  }
  let outcome;
  try {
    outcome = await handle.done;
  } catch (error) {
    throw new SearchError(`${toolName} subprocess failed before reporting an outcome (ripgrep provider failure)`, "SEARCH_FAILED", { cause: error });
  }
  const stdout = handle.collected.stdout?.readFrom(0);
  const stderr = handle.collected.stderr?.readFrom(0);
  if (stdout === void 0 || stderr === void 0) {
    throw new SearchError(`${toolName} search command produced no collected output streams`, "SEARCH_FAILED");
  }
  if (exec.signal.aborted) {
    throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, "SEARCH_ABORTED");
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new SearchError(`${toolName} search command was killed by signal ${outcome.signal ?? "(unknown)"}`, "SEARCH_FAILED");
  }
  if (outcome.exitCode !== 0 && outcome.exitCode !== 1) {
    throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy);
  }
  const text = completeStdout(toolName, stdout, rawOutputMaxBytes);
  return { stdout: text, noMatches: outcome.exitCode === 1, workdir };
}

// third_party/dsh-tools/packages/fs/tool-fs-search/src/glob.ts
var GLOB_VCS_EXCLUDES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];
function parseGlobArgs(args) {
  if (args.pattern.trim().length === 0) throw new Error("pattern must be a non-empty string");
  if (args.path !== void 0 && args.path.trim().length === 0) throw new Error("path must be a non-empty string when given");
  return { pattern: args.pattern, ...args.path !== void 0 ? { path: args.path } : {} };
}
function buildGlobCommand(input) {
  const directories = input.pattern.split("/").slice(0, -1);
  const pruning = [];
  if (input.path === void 0 && directories.length > 0 && directories.every((part) => /^[\w .-]+$/.test(part) && part !== "." && part !== ".." && !GLOB_VCS_EXCLUDES.includes(part))) {
    const directoryGlob = `--glob={${[...new Set(directories)].join(",")}}/`;
    if (directoryGlob.length + "--glob=!**".length + 2 <= 8 * 1024) {
      pruning.push("--glob=!**", directoryGlob);
    }
  }
  const parts = [
    "--files",
    ...pruning,
    `--glob=${input.pattern}`,
    "--sort=modified",
    "--no-ignore",
    "--hidden",
    // Two negated globs per VCS name: the bare form prunes the directory
    // during traversal; the /** form still excludes the contents when the
    // search root is AT or INSIDE the directory (where the bare form,
    // matched against root-prefixed paths, never fires).
    ...GLOB_VCS_EXCLUDES.flatMap((name) => [
      `--glob=!**/${name}`,
      `--glob=!**/${name}/**`
    ])
  ];
  if (input.path !== void 0) parts.push("--", input.path);
  return parts;
}

// third_party/dsh-tools/packages/fs/tool-fs-search/src/grep.ts
function validateInclude(include) {
  if (include.trim().length === 0) throw new Error("include must be a non-empty glob when given");
  if (include.startsWith("!")) throw new Error('include must be a positive glob filter; negated patterns ("!\u2026") are not supported');
  let braceDepth = 0;
  for (const char of include) {
    if (char === "{") braceDepth++;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "," && braceDepth === 0) {
      throw new Error("include must be one glob, not a comma-separated list (use {a,b} alternation instead)");
    }
  }
}
function parseGrepArgs(args) {
  if (args.pattern.length === 0) throw new Error("pattern must be a non-empty string");
  if (args.path !== void 0 && args.path.trim().length === 0) throw new Error("path must be a non-empty string when given");
  const include = args.include === "" ? void 0 : args.include;
  if (include !== void 0) validateInclude(include);
  return {
    pattern: args.pattern,
    ...args.path !== void 0 ? { path: args.path } : {},
    ...include !== void 0 ? { include } : {}
  };
}
function buildGrepCommand(input) {
  const parts = ["--json", `--regexp=${input.pattern}`];
  if (input.include !== void 0) parts.push(`--glob=${input.include}`);
  if (input.path !== void 0) parts.push("--", input.path);
  return parts;
}
function malformedRecord(detail, cause) {
  return new SearchError(`grep received malformed ripgrep --json output (${detail})`, "SEARCH_FAILED", cause !== void 0 ? { cause } : void 0);
}
function parseRecord(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw malformedRecord("a line is not JSON", error);
  }
  if (typeof parsed !== "object" || parsed === null) throw malformedRecord("a record is not an object");
  const record = parsed;
  if (record.type !== "match") return void 0;
  if (typeof record.data !== "object" || record.data === null) throw malformedRecord("a match record has no data");
  const data = record.data;
  const pathText = typeof data.path === "object" && data.path !== null ? data.path.text : void 0;
  if (typeof pathText !== "string") throw malformedRecord("a match record has no path text");
  if (typeof data.line_number !== "number") throw malformedRecord("a match record has no line number");
  if (typeof data.lines !== "object" || data.lines === null) throw malformedRecord("a match record has no line content");
  const lines = data.lines;
  if (typeof lines.text === "string") {
    return { path: pathText, lineNumber: data.line_number, line: lines.text.replace(/\r?\n$/, "") };
  }
  if (typeof lines.bytes === "string") {
    return { path: pathText, lineNumber: data.line_number, line: "(line is not valid UTF-8)" };
  }
  throw malformedRecord("a match record has neither line text nor bytes");
}
function parseGrepMatches(stdout) {
  const matches = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const match = parseRecord(line);
    if (match !== void 0) matches.push(match);
  }
  return matches;
}

// files-runtime.ts
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
var ctx = new Context3();
await ctx.plugin(LocalFileSystem, { cwd: process.cwd() });
await ctx.plugin(LocalSubprocessRuntime);
var fs = ctx.fs;
function formatLineRead(path, offset, window) {
  const end = window.lines.at(-1)?.number ?? Math.max(0, offset - 1);
  const footer = window.truncatedByBytes ? `(Output capped. Showing lines ${offset}-${end}. Use line_offset=${end + 1} to continue.)` : end < window.totalLines ? `(Showing lines ${offset}-${end} of ${window.totalLines}. Use line_offset=${end + 1} to continue.)` : `(End of file - total ${window.totalLines} lines)`;
  const body = window.lines.length ? `${window.lines.map((line) => `${line.number}: ${line.text}`).join("\n")}

${footer}` : footer;
  return `<path>${path}</path>
<type>file</type>
<content>
${body}
</content>`;
}
async function execute({ operation, path, args }) {
  if (operation === "patch") {
    const child = ctx.subprocess.spawn({
      argv: args.argv,
      cwd: path,
      graceMs: 3e3,
      stdio: { stdin: { data: args.patch }, stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } }
    });
    const outcome = await child.done;
    await child.waitForExit();
    return {
      exit_code: outcome.exitCode,
      stdout: child.collected.stdout?.readFrom(0).text ?? "",
      stderr: child.collected.stderr?.readFrom(0).text ?? ""
    };
  }
  const target = await fs.resolve(path);
  if (operation === "write") return fs.writeText(target, args.text);
  if (operation === "edit") return fs.editText(target, {
    oldString: args.old,
    newString: args.new,
    replaceAll: args.all === true
  });
  if (operation === "list") return { entries: (await fs.listDir(target)).map((entry) => ({
    path: fs.processPath(entry.target),
    directory: entry.type === "directory"
  })) };
  if (operation === "glob" || operation === "search") {
    const input = operation === "glob" ? parseGlobArgs({ pattern: args.pattern, path: fs.processPath(target) }) : parseGrepArgs({ pattern: args.query, path: fs.processPath(target) });
    const argv = operation === "glob" ? buildGlobCommand(input) : buildGrepCommand(input);
    if (operation === "search" && !args.regex) argv.unshift("--fixed-strings");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("search timeout")), SEARCH_TIMEOUT_MS);
    try {
      const result2 = await runRipgrep(
        ctx,
        { signal: controller.signal },
        operation === "glob" ? "glob" : "grep",
        argv,
        RAW_OUTPUT_MAX_BYTES,
        SEARCH_GRACE_MS,
        SEARCH_STDERR_MAX_BYTES
      );
      if (operation === "glob") return { entries: result2.stdout.split("\n").filter(Boolean).map((path2) => ({
        path: resolve4(path2),
        directory: false
      })) };
      return { matches: parseGrepMatches(result2.stdout).map((match) => ({ path: resolve4(match.path), line: match.lineNumber, text: match.line })) };
    } finally {
      clearTimeout(timer);
    }
  }
  const before = await fs.stat(target);
  if (!before || before.type !== "file") throw Object.assign(new Error("\u8BF7\u9009\u62E9\u5B9E\u9645\u6587\u4EF6"), { code: "FS_NOT_REGULAR_FILE" });
  if (args.version !== void 0 && args.version !== before.version)
    throw Object.assign(new Error("\u6587\u4EF6\u5728\u5206\u6BB5\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u4ECE\u5934\u91CD\u65B0\u8BFB\u53D6"), { code: "file_changed" });
  let result;
  if (operation === "read") {
    const offset = args.offset ?? 0;
    const length = args.length ?? Math.max(0, before.size - offset);
    const bytes = await fs.readByteRange(target, { offset, length });
    const sample = offset === 0 ? bytes.subarray(0, 8192) : await fs.readByteRange(target, { offset: 0, length: 8192 });
    result = {
      base64: Buffer.from(bytes).toString("base64"),
      sample: Buffer.from(sample).toString("base64"),
      version: before.version,
      size: before.size,
      next_offset: offset + bytes.byteLength,
      eof: offset + bytes.byteLength >= before.size
    };
  } else if (operation === "read_lines") {
    const offset = args.line_offset ?? 1, limit = args.line_limit ?? 2e3;
    if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2e3)
      throw Object.assign(new Error("line_offset \u5FC5\u987B\u4E3A\u6B63\u6574\u6570\uFF1Bline_limit \u5FC5\u987B\u4E3A 1..2000"), { code: "read_range" });
    const window = await buildWindow(await fs.streamText(target), {
      offset,
      limit,
      maxLineLength: READ_MAX_LINE_LENGTH,
      maxBytes: READ_MAX_BYTES
    }, fs.processPath(target));
    const next = offset + window.lines.length;
    result = {
      text: formatLineRead(fs.processPath(target), offset, window),
      lines: window.lines,
      total_lines: window.totalLines,
      next_line: next,
      eof: next > window.totalLines,
      truncated: window.truncatedByBytes,
      version: before.version,
      size: before.size
    };
  } else throw new Error(`Unknown file operation: ${operation}`);
  const after = await fs.stat(target);
  if (!after || before.version !== after.version)
    throw Object.assign(new Error("\u6587\u4EF6\u5728\u8BFB\u53D6\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6"), { code: "file_changed" });
  return result;
}
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      process.stdout.write(JSON.stringify({ result: await execute(JSON.parse(line)) }) + "\n");
    } catch (error) {
      const failure = error;
      process.stdout.write(JSON.stringify({ error: {
        code: failure.code ?? failure.name,
        message: failure.message
      } }) + "\n");
    }
  }
} finally {
  await ctx.fiber.dispose();
}
