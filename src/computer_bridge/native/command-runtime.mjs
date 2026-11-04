import {createRequire as bridgeCreateRequire} from "node:module"; const require=bridgeCreateRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __knownSymbol = (name4, symbol) => (symbol = Symbol[name4]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name4);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __export = (target, all) => {
  for (var name4 in all)
    __defProp(target, name4, { get: all[name4], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// bridge-cordis:cordis
var cordis_exports = {};
__export(cordis_exports, {
  FiberState: () => FiberState
});
__reExport(cordis_exports, cordis_star);
import * as cordis_star from "@deepseek-ai/cordis";

// node_modules/@deepseek-ai/cordis/src/fiber.ts
import { defineProperty, isNullable } from "@deepseek-ai/cosmokit";
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
var ValidationError = class extends TypeError {
  name = "ValidationError";
  /**
   * Build the aggregated message from schema issues.
   *
   * @param issues — the standard-schema issues, one message line each.
   */
  constructor(issues) {
    super(`invalid config:
` + issues.map((issue) => {
      if (issue.path) {
        return `  - ${issue.message} (at ${issue.path.join(".")})`;
      } else {
        return `  - ${issue.message}`;
      }
    }).join("\n"));
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, {
  value: true
});
var FiberState = /* @__PURE__ */ ((FiberState2) => {
  FiberState2[FiberState2["PENDING"] = 0] = "PENDING";
  FiberState2[FiberState2["LOADING"] = 1] = "LOADING";
  FiberState2[FiberState2["ACTIVE"] = 2] = "ACTIVE";
  FiberState2[FiberState2["FAILED"] = 3] = "FAILED";
  FiberState2[FiberState2["DISPOSED"] = 4] = "DISPOSED";
  FiberState2[FiberState2["UNLOADING"] = 5] = "UNLOADING";
  return FiberState2;
})(FiberState || {});
var CordisError = class _CordisError extends Error {
  /**
   * @param code — the stable error code; also the default message.
   * @param message — optional human-readable override.
   */
  constructor(code, message) {
    super(message ?? _CordisError.Code[code]);
    this.code = code;
  }
  code;
};
((CordisError2) => {
  CordisError2.Code = {
    INACTIVE_EFFECT: "cannot create effect on inactive context"
  };
})(CordisError || (CordisError = {}));

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/index.ts
import { constants as constants2 } from "node:fs";
import { access, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { delimiter, extname as extname2, isAbsolute as isAbsolute3, resolve } from "node:path";

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
    const named = field !== "noProxy" && names.some((name4) => inherited[name4] !== void 0);
    for (const name4 of names) overlay[name4] = named ? inherited[name4] : resolved;
  }
  const parsedByNode = [...POLICY_ENV_NAMES.httpProxy, ...POLICY_ENV_NAMES.httpsProxy];
  if (parsedByNode.some((name4) => overlay[name4] !== void 0 && !isSupportedProxyUrl(overlay[name4]))) {
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
  for (const [name4, value] of Object.entries(proxyEnvironmentForChild())) {
    if (value === void 0) Reflect.deleteProperty(env, name4);
    else env[name4] = value;
  }
  return env;
}
var SubprocessRuntime = class extends cordis_exports.Service {
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
var TimeoutReason = class extends Error {
  /**
   * @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
   * @param timeoutMs The deadline that elapsed, in milliseconds.
   */
  constructor(code, timeoutMs) {
    super(`${code} after ${timeoutMs}ms`);
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
  code;
  timeoutMs;
  name = "TimeoutReason";
};
var MAX_TIMER_DELAY_MS = 2147483647;
function assertTimerDelay(timeoutMs, name4) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${name4} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
}
function clampTimeout(requested, def, max, name4 = "timeoutMs") {
  if (requested !== void 0 && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name4} must be a positive finite number`);
  }
  return Math.min(requested ?? def, max);
}
function deadline(upstream, timeoutMs, code) {
  if (timeoutMs <= 0) {
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {
    } };
  }
  assertTimerDelay(timeoutMs, "deadline timeoutMs");
  const timer = new AbortController();
  const id = setTimeout(() => {
    timer.abort(new TimeoutReason(code, timeoutMs));
  }, timeoutMs);
  return {
    // AbortSignal.any adopts the reason of whichever source aborts FIRST, so a
    // race resolves to a single cause: timeoutOf() reads TimeoutReason only
    // when the timeout won, and upstream-wins leaves an ordinary abort reason.
    signal: upstream !== void 0 ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() {
      clearTimeout(id);
    }
  };
}
function timeoutOf(x, code) {
  const reason = x.reason;
  if (!(reason instanceof TimeoutReason)) return void 0;
  return code === void 0 || reason.code === code ? reason : void 0;
}

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
  const bind = (name4, result, args) => kernel32.func("__stdcall", name4, result, args);
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
function snapshotWindowsProcesses(bindings2) {
  const koffi = requireKoffi();
  const { PROCESSENTRY32W } = win32Structs();
  const snapshot = bindings2.createToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (isInvalidHandle(snapshot)) return [];
  const entries = [];
  try {
    const entry = allocNative(PROCESSENTRY32W, 1);
    koffi.encode(entry, "uint32", PROCESSENTRY32W.size);
    let ok = bindings2.process32FirstW(snapshot, entry);
    while (ok !== 0) {
      const record = koffi.decode(entry, PROCESSENTRY32W);
      entries.push({ pid: record.th32ProcessID, parentPid: record.th32ParentProcessID });
      ok = bindings2.process32NextW(snapshot, entry);
    }
  } finally {
    bindings2.closeHandle(snapshot);
  }
  return entries;
}
function windowsProcessState(bindings2, pid) {
  const koffi = requireKoffi();
  const { FILETIME } = win32Structs();
  const handle = bindings2.openProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid);
  if (isInvalidHandle(handle)) return void 0;
  try {
    const creation = allocNative(FILETIME, 1);
    const exit = allocNative(FILETIME, 1);
    const kernel = allocNative(FILETIME, 1);
    const user = allocNative(FILETIME, 1);
    if (bindings2.getProcessTimes(handle, creation, exit, kernel, user) === 0) return void 0;
    const record = koffi.decode(creation, FILETIME);
    const wait = bindings2.waitForSingleObject(handle, 0);
    if (wait !== WAIT_OBJECT_0 && wait !== WAIT_TIMEOUT) return void 0;
    return {
      started: `${record.dwHighDateTime}:${record.dwLowDateTime}`,
      active: wait === WAIT_TIMEOUT
    };
  } finally {
    bindings2.closeHandle(handle);
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
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open <= 0 || close <= open) return void 0;
  const pid = Number(text.slice(0, open).trim());
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
    const stat2 = readLinuxStat(internals, Number(entry));
    if (stat2?.pgrp !== processGroupId) continue;
    matched = true;
    if (!/^[ZXx]$/.test(stat2.state)) return true;
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
    const stat2 = readLinuxStat(this.internals, identity.pid);
    return stat2?.started === identity.started && !quiescent(stat2.state);
  }
  snapshot() {
    const pids = numericEntries(this.internals, "/proc");
    if (pids === void 0) throw new Error("Cannot inspect processes: /proc directory is unreadable");
    let complete = true;
    const rows = pids.flatMap((pid) => {
      const stat2 = readLinuxStat(this.internals, pid);
      if (stat2 === void 0) complete = false;
      return stat2 === void 0 ? [] : [{
        pid,
        parentPid: stat2.parentPid,
        started: stat2.started,
        session: stat2.session,
        state: stat2.state
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
import { join } from "node:path";
import { tmpdir } from "node:os";
var spillCounter = 0;
var defaultSpillDir;
function privateSpillDir() {
  defaultSpillDir ??= mkdtempSync(join(tmpdir(), "dsh-subprocess-"));
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
        const file = join(
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
  return new Promise((resolve3, reject) => {
    let completed = false;
    child.once("error", (error) => {
      if (completed) return;
      completed = true;
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      if (completed) return;
      completed = true;
      resolve3({ exitCode, signal });
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
    return new Promise((resolve3) => {
      const settle = () => {
        stream.off("end", settle);
        stream.off("close", settle);
        stream.off("error", settle);
        resolve3();
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
  let settled2 = false;
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
      if (!settled2 || !scheduleOwnerCleanup()) rangeExitObservation = void 0;
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
  const done = new Promise((resolve3, reject) => {
    let pipeDrainTimer;
    const settle = (outcome) => {
      if (settled2) return;
      settled2 = true;
      stopCollectors();
      cleanup();
      resolve3(outcome);
    };
    const fail = (error) => {
      settled2 = true;
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
import { join as join3 } from "node:path";
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
import { basename, dirname, isAbsolute, join as join2 } from "node:path";
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
function createLinuxLaunchFiles(request2) {
  const directory = mkdtempSync2(join2(tmpdir2(), "dsh-subprocess-launch-"));
  const files = {
    directory,
    requestPath: join2(directory, "launch-request.json"),
    startupErrorPath: join2(directory, "startup-error.json")
  };
  try {
    chmodSync(directory, 448);
    writeFileSync(files.requestPath, JSON.stringify(request2), { flag: "wx", mode: 384 });
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
import { extname, isAbsolute as isAbsolute2 } from "node:path";
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
    if (isAbsolute2(invocation[0])) accessSync(invocation[0], fsConstants.X_OK);
    const entry = invocation.at(-1);
    if (entry !== void 0 && entry !== invocation[0] && isAbsolute2(entry)) {
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
  for (const name4 of Object.keys(env)) {
    const normalized = name4.toUpperCase();
    if (RUNNER_CONTROL_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      Reflect.deleteProperty(env, name4);
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
  return unixSocketListener(join3(runtimeDirectory, "systemd", "private"), internals.unixSocketTable ?? "/proc/net/unix");
}
function systemdRunIdentity(internals = {}) {
  const command = internals.systemdRun ?? "systemd-run";
  const candidates = command.includes("/") ? [command] : (childEnv().PATH ?? "").split(":").filter((directory) => directory !== "").map((directory) => join3(directory, command));
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
      const name4 = line.slice(0, separator);
      if (values.has(name4)) {
        throw new Error(`systemctl returned duplicate ${name4} for ${this.unit}`);
      }
      values.set(name4, line.slice(separator + 1));
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
    let settled2 = false;
    child.once("error", (error) => {
      if (settled2) return;
      settled2 = true;
      rejectOutcome(error);
    });
    child.once("exit", (exitCode, signal) => {
      if (settled2) return;
      settled2 = true;
      try {
        resolveOutcome(startup.resolveOutcome({ exitCode, signal }));
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        rejectOutcome(failure);
      }
    });
  });
}
function signalLinuxDirectProcess(pid, send2) {
  try {
    if (send2()) return true;
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
  const bind = (lib, name4, result, args) => lib.func("__stdcall", name4, result, args);
  cachedContext = { kernel32, advapi32, bind };
  return cachedContext;
}
function bindings() {
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
  return bindings();
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
function throwLastError(api, name4, detail) {
  const win32Code = api.getLastError();
  throw new Win32Error(name4, win32Code, detail ?? errorText(api, win32Code));
}
function throwWin32(api, name4, win32Code, detail) {
  throw new Win32Error(name4, win32Code, detail ?? errorText(api, win32Code));
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
  return new Promise((resolve3) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve3();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
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
  for (const [name4, value] of Object.entries(constants.signals)) {
    if (value === number) return name4;
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
import { basename as basename2, join as join4 } from "node:path";
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
      return readFileSync4(join4(this.directory, "state"), "utf8");
    } catch (_unavailableShellObservation) {
      return "";
    }
  }
};
function prepareShellActivity(spec, env, platform) {
  if (spec.shellActivity !== true || platform === "win32" || spec.argv.length !== 2 || spec.argv[1] !== "-i") return void 0;
  const shell = basename2(spec.argv[0]);
  if (shell !== "bash" && shell !== "zsh") return void 0;
  const directory = mkdtempSync3(join4(tmpdir3(), "dsh-shell-"));
  const state = quote(join4(directory, "state"));
  const guards = quote(join4(directory, "guards"));
  try {
    if (shell === "bash") {
      const rc = join4(directory, "bashrc");
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
    writeFileSync2(join4(directory, ".zshenv"), [
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
    const absolute = isAbsolute3(command);
    if (!absolute && (command.includes("/") || process.platform === "win32" && command.includes("\\"))) {
      throw new Error(
        `subprocess-local: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`
      );
    }
    const candidates = absolute ? [command] : this.executableCandidates(command, environment);
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      try {
        const info = await stat(candidate);
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
    return path.split(delimiter).flatMap((directory) => extensions.map((extension) => resolve(process.cwd(), directory, command + extension)));
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
      const probe = decision.probe === void 0 ? "" : `, probed after ${decision.probe}`;
      this.ctx.logger.debug(`linux native containment: ${decision.kind} (${decision.reason}${probe})`);
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
function environmentValue(env, name4) {
  const exact = env[name4];
  if (exact !== void 0 || process.platform !== "win32") return exact;
  const normalized = name4.toUpperCase();
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1];
}

// third_party/dsh-tools/packages/core/tools/src/index.ts
import z from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/core/scope/src/store.ts
var NamedEntries = class {
  constructor(duplicateError) {
    this.duplicateError = duplicateError;
  }
  duplicateError;
  data = /* @__PURE__ */ new Map();
  /**
   * Insert one unique name.
   * @param name - name unique within this table.
   * @param value - borrowed value to retain.
   * @returns an idempotent undo that removes only this insertion.
   */
  insert(name4, value) {
    const data = this.data;
    if (data.has(name4)) throw this.duplicateError(name4);
    data.set(name4, value);
    let active2 = true;
    return () => {
      if (!active2) return;
      active2 = false;
      data.delete(name4);
      if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
    };
  }
  /**
   * Read one named value.
   * @param name - name to resolve.
   * @returns the retained value, or `undefined` when absent.
   */
  get(name4) {
    return this.data.get(name4);
  }
  /**
   * Test one name for membership.
   * @param name - name to test.
   * @returns whether the table contains that name.
   */
  has(name4) {
    return this.data.has(name4);
  }
  /**
   * Iterate live names in insertion order.
   * @returns the native live key iterator.
   */
  keys() {
    return this.data.keys();
  }
  /**
   * Iterate live entries in insertion order.
   * @returns the native live entry iterator.
   */
  entries() {
    return this.data.entries();
  }
  /**
   * Iterate live values in insertion order.
   * @returns the native live value iterator.
   */
  values() {
    return this.data.values();
  }
  /**
   * Test whether this table has no entries.
   * @returns whether the table is empty.
   */
  isEmpty() {
    return this.data.size === 0;
  }
};
var AnonymousEntries = class {
  data = /* @__PURE__ */ new Map();
  /**
   * Append one independently owned value.
   * @param value - borrowed value to retain.
   * @returns an idempotent undo for this exact append.
   */
  append(value) {
    const data = this.data;
    const key = /* @__PURE__ */ Symbol();
    data.set(key, value);
    let active2 = true;
    return () => {
      if (!active2) return;
      active2 = false;
      data.delete(key);
      if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
    };
  }
  /**
   * Iterate live values in insertion order.
   * @returns the native live value iterator.
   */
  values() {
    return this.data.values();
  }
  /**
   * Test whether this table has no entries.
   * @returns whether the table is empty.
   */
  isEmpty() {
    return this.data.size === 0;
  }
};
var ScopedLayers = class {
  constructor(createLayer, onChange) {
    this.createLayer = createLayer;
    this.onChange = onChange;
    this.global = createLayer(void 0);
  }
  createLayer;
  onChange;
  /** The eagerly constructed context-global layer. */
  global;
  scoped = /* @__PURE__ */ new Map();
  /**
   * Read an existing exact-scope overlay. Deliberately chain-blind: callers
   * addressing one scope's OWN contributions (its restrictions, its guards)
   * must not silently pick up an ancestor's — use {@link chainLayers} where
   * inheritance is the point.
   * @param scope - exact scope key; `undefined` denotes no overlay.
   * @returns the existing scoped layer, or `undefined` without creating one.
   */
  peek(scope) {
    if (scope === void 0) return void 0;
    return this.scoped.get(scope);
  }
  /**
   * Existing overlays along the scope's parent chain ({@link scopeChainOf}),
   * farthest ancestor first and the exact scope last, so a caller layering
   * them in order gives the nearest scope the final word.
   * @param scope - viewing scope, or `undefined` for no overlays.
   * @returns the existing layers, nearest last; absent overlays are skipped.
   */
  chainLayers(scope) {
    const layers = [];
    for (const key of scopeChainOf(scope).reverse()) {
      const layer = this.scoped.get(key);
      if (layer !== void 0) layers.push(layer);
    }
    return layers;
  }
  /**
   * Materialize global named entries followed by scope-chain shadows,
   * farthest ancestor first, so the nearest scope's entry wins a name.
   * @param scope - viewing scope, or `undefined` for the global view.
   * @param pick - select the named table from a layer.
   * @returns an insertion-ordered effective map.
   */
  merge(scope, pick) {
    const merged = new Map(pick(this.global).entries());
    for (const layer of this.chainLayers(scope)) {
      for (const [name4, value] of pick(layer).entries()) merged.set(name4, value);
    }
    return merged;
  }
  /**
   * Attach one synchronous layer mutation to its registration context.
   * @param ctx - context that determines both scope visibility and effect ownership.
   * @param action - atomic mutation returning its synchronous undo.
   * @param options - Cordis effect label and optional change notification.
   * @returns the exact disposer returned by `ctx.effect()`.
   */
  effect(ctx2, action, options) {
    const scope = scopeOf(ctx2);
    const notify = options.notify ?? true;
    const dispose = ctx2.effect(function* () {
      let layer;
      let created = false;
      if (scope === void 0) {
        layer = this.global;
      } else {
        const existing = this.scoped.get(scope);
        if (existing === void 0) {
          layer = this.createLayer(scope);
          this.scoped.set(scope, layer);
          created = true;
        } else {
          layer = existing;
        }
      }
      let undo;
      try {
        undo = action(layer);
      } catch (error) {
        if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
        throw error;
      }
      yield () => {
        undo();
        if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
        if (notify) this.onChange();
      };
      if (notify) this.onChange();
    }.bind(this), options.label);
    return dispose;
  }
};

// third_party/dsh-tools/packages/core/scope/src/index.ts
var kScope = /* @__PURE__ */ Symbol("dsh.scope");
var carrierKeys = /* @__PURE__ */ new WeakMap();
var scopeParents = /* @__PURE__ */ new WeakMap();
function scopeChainOf(key) {
  const chain = [];
  for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
  return chain;
}
function scopeOf(ctx2) {
  return ctx2[kScope];
}
function scopeTarget(base, key) {
  const baseFilter = base[cordis_exports.Context.filter];
  const carrier = {
    [cordis_exports.Context.filter](ctx2) {
      if (baseFilter !== void 0 && !baseFilter.call(base, ctx2)) return false;
      const tag = scopeOf(ctx2);
      if (tag === void 0) return true;
      for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) {
        if (cursor === tag) return true;
      }
      return false;
    }
  };
  carrierKeys.set(carrier, key);
  return carrier;
}

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

// third_party/dsh-tools/packages/core/tools/src/executor.ts
var ToolBatchExecutionError = class extends Error {
  constructor(cause, partial) {
    super("Tool batch execution failed", { cause });
    this.partial = partial;
    this.name = "ToolBatchExecutionError";
  }
  partial;
};
var ToolExecutorUnavailableError = class extends HarnessError {
  constructor() {
    super("The selected tool executor is unavailable. Load an executor in this composition before running the agent.", "TOOL_EXECUTOR_UNAVAILABLE");
    this.name = "ToolExecutorUnavailableError";
  }
};

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
function hasIntrinsicConstructor(prototype, name4) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  const constructor = descriptor?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name4 && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name4 === "Array" ? Array : Object);
  } catch {
    return false;
  }
}
function isIntrinsicObjectPrototype(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
function hasPlainArrayPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
  const objectPrototype = Object.getPrototypeOf(prototype);
  return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
function hasPlainObjectPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
}
function enumerableStringKeys(value) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
  return keys;
}
function walkJsonValue(value, detach) {
  const ancestors = /* @__PURE__ */ new Set();
  let root;
  let parent;
  const assign = (item) => {
    if (parent === void 0) {
      if (detach) root = item;
    } else if (parent.kind === "array") {
      if (parent.target !== void 0) parent.target[parent.key] = item;
    } else if (parent.target !== void 0) {
      Object.defineProperty(parent.target, parent.key, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  };
  const frames = [];
  let current = value;
  for (; ; ) {
    if (current === null) {
      assign(null);
    } else if (typeof current === "boolean" || typeof current === "string") {
      assign(current);
    } else if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
      assign(current);
    } else {
      if (typeof current !== "object") return void 0;
      if (ancestors.has(current)) return void 0;
      if (Array.isArray(current)) {
        if (!hasPlainArrayPrototype(current)) return void 0;
        const length = current.length;
        if (Reflect.ownKeys(current).length !== length + 1) return void 0;
        const target = detach ? [] : void 0;
        if (target !== void 0) assign(target);
        let indices;
        if (!Number.isInteger(length)) {
          indices = [];
          for (let index = length - 1; index >= 0; index--) indices.push(index);
        }
        frames.push({ kind: "array", source: current, length: indices?.length ?? length, index: 0, key: 0, indices, target });
      } else {
        if (!hasPlainObjectPrototype(current)) return void 0;
        const keys = enumerableStringKeys(current);
        if (keys === void 0) return void 0;
        const target = detach ? {} : void 0;
        if (target !== void 0) assign(target);
        frames.push({ kind: "object", source: current, keys, index: 0, key: "", target });
      }
      ancestors.add(current);
    }
    for (; ; ) {
      const frame = frames.at(-1);
      if (frame === void 0) return detach ? root : true;
      const length = frame.kind === "array" ? frame.length : frame.keys.length;
      if (frame.index >= length) {
        ancestors.delete(frame.source);
        frames.pop();
        continue;
      }
      const index = frame.index++;
      parent = frame;
      if (frame.kind === "array") {
        const key = frame.indices === void 0 ? index : frame.indices[frame.indices.length - index - 1];
        if (key === void 0) return void 0;
        if (!Object.prototype.hasOwnProperty.call(frame.source, key)) return void 0;
        frame.key = key;
        current = frame.source[key];
      } else {
        const key = frame.keys[index];
        if (key === void 0) return void 0;
        frame.key = key;
        current = frame.source[key];
      }
      break;
    }
  }
}
function snapshotJsonValue(value) {
  return walkJsonValue(value, true);
}
function isJsonValue(value) {
  return walkJsonValue(value, false) === true;
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{ kind: "visit", node: value }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({ kind: "visit", node: task.source[task.key] });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({ kind: "property", source: node, key });
    }
  }
  return value;
}

// third_party/dsh-tools/packages/core/tools/src/json-schema.ts
var JsonSchemaError = class extends HarnessError {
  /** Individual schema violations in walk order. */
  violations;
  constructor(violations) {
    super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
    this.name = "JsonSchemaError";
    this.violations = violations;
  }
};
var CONSTRAINT_KEYWORDS = /* @__PURE__ */ new Set([
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const"
]);
var ANNOTATION_KEYWORDS = /* @__PURE__ */ new Set(["description", "title", "default", "examples"]);
var SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"];
function hasIntrinsicConstructor2(prototype, name4) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  const constructor = descriptor?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name4 && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name4}() { [native code] }`;
  } catch {
    return false;
  }
}
function isIntrinsicObjectPrototype2(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor2(value, "Object");
}
function isPlainJsonRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype2(prototype);
  } catch {
    return false;
  }
}
function hasPlainArrayPrototype2(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor2(prototype, "Array")) return false;
  const objectPrototype = Object.getPrototypeOf(prototype);
  return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype2(objectPrototype);
}
function hasOnlyEnumerableStringKeys(value) {
  try {
    return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
  } catch {
    return false;
  }
}
function isJsonSchemaRecord(value) {
  return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
function isPlainJsonArray(value) {
  if (!Array.isArray(value)) return false;
  try {
    if (!hasPlainArrayPrototype2(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function isJsonNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
function scalarMatches(type, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return isJsonNumber(value);
    case "integer":
      return isJsonNumber(value) && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    /* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
    default:
      return assertNever(type, "JsonSchemaType");
  }
}
var ONE_OF_SIBLING_KEYWORDS = ["properties", "required", "additionalProperties", "items", "enum", "const"];
function checkObjectSchemaTail(node, path, properties, violations) {
  const hasRequired = Object.hasOwn(node, "required");
  const required = hasRequired ? node.required : void 0;
  if (hasRequired) {
    if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) {
      violations.push(`${path}.required must be an array of strings`);
    } else {
      const declared = isJsonSchemaRecord(properties) ? properties : {};
      for (const key of required) {
        if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
      }
    }
  }
  if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
    violations.push(`${path}.additionalProperties must be a boolean`);
  }
}
function checkSchemaNode(root, rootPath, violations, seen) {
  const tasks = [{ kind: "enter", node: root, path: rootPath }];
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === "leave") {
      seen.delete(task.node);
      continue;
    }
    if (task.kind === "one-of-tail") {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
      }
      continue;
    }
    if (task.kind === "object-tail") {
      checkObjectSchemaTail(task.node, task.path, task.properties, violations);
      continue;
    }
    const { node, path } = task;
    if (!isJsonSchemaRecord(node)) {
      violations.push(`${path} must be a schema object`);
      continue;
    }
    if (seen.has(node)) {
      violations.push(`${path} is circular`);
      continue;
    }
    seen.add(node);
    tasks.push({ kind: "leave", node });
    for (const key of Object.keys(node)) {
      if (CONSTRAINT_KEYWORDS.has(key)) continue;
      if (ANNOTATION_KEYWORDS.has(key)) {
        try {
          if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
        } catch {
          violations.push(`${path}.${key} annotation must be lossless JSON data`);
        }
        continue;
      }
      violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
    }
    if (Object.hasOwn(node, "description") && typeof node.description !== "string") {
      violations.push(`${path}.description must be a string`);
    }
    if (Object.hasOwn(node, "title") && typeof node.title !== "string") {
      violations.push(`${path}.title must be a string`);
    }
    const hasType = Object.hasOwn(node, "type");
    const hasOneOf = Object.hasOwn(node, "oneOf");
    if (hasType && hasOneOf) {
      violations.push(`${path} cannot declare both type and oneOf`);
      continue;
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
      }
      continue;
    }
    if (hasOneOf) {
      const oneOf = node.oneOf;
      tasks.push({ kind: "one-of-tail", node, path });
      if (!isPlainJsonArray(oneOf) || oneOf.length < 2) {
        violations.push(`${path}.oneOf must be an array of at least two schemas`);
      } else {
        for (let index = oneOf.length - 1; index >= 0; index--) {
          tasks.push({ kind: "enter", node: oneOf[index], path: `${path}.oneOf[${index}]` });
        }
      }
      continue;
    }
    const type = node.type;
    if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
      violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
      continue;
    }
    const schemaType = type;
    const allowedFor = {
      properties: ["object"],
      required: ["object"],
      additionalProperties: ["object"],
      items: ["array"],
      enum: ["string", "number", "integer", "boolean", "null"],
      const: ["string", "number", "integer", "boolean", "null"]
    };
    for (const [key, types] of Object.entries(allowedFor)) {
      if (Object.hasOwn(node, key) && !types.includes(schemaType)) {
        violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
      }
    }
    switch (schemaType) {
      case "object": {
        const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
        tasks.push({ kind: "object-tail", node, path, properties });
        if (Object.hasOwn(node, "properties")) {
          if (!isJsonSchemaRecord(properties)) {
            violations.push(`${path}.properties must be an object of schemas`);
          } else {
            const entries = Object.entries(properties);
            for (let index = entries.length - 1; index >= 0; index--) {
              const entry = entries[index];
              if (entry === void 0) continue;
              tasks.push({ kind: "enter", node: entry[1], path: `${path}.properties.${entry[0]}` });
            }
          }
        }
        break;
      }
      case "array": {
        if (Object.hasOwn(node, "items")) tasks.push({ kind: "enter", node: node.items, path: `${path}.items` });
        break;
      }
      case "string":
      case "number":
      case "integer":
      case "boolean":
      case "null": {
        const hasEnum = Object.hasOwn(node, "enum");
        const allowed = hasEnum ? node.enum : void 0;
        const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
        if (hasEnum && !enumValid) {
          violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
        }
        const hasConst = Object.hasOwn(node, "const");
        const declaredConst = hasConst ? node.const : void 0;
        const constValid = scalarMatches(schemaType, declaredConst);
        if (hasConst) {
          if (!constValid) {
            violations.push(`${path}.const must be a ${schemaType} value`);
          } else if (enumValid && !allowed.includes(declaredConst)) {
            violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
          }
        }
        break;
      }
      /* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
      default:
        assertNever(schemaType, "JsonSchemaType");
    }
  }
}
function assertSupportedJsonSchema(schema) {
  const violations = [];
  checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
  if (violations.length > 0) throw new JsonSchemaError(violations);
}
function safelyIsJsonValue(value) {
  try {
    return isJsonValue(value);
  } catch {
    return false;
  }
}
function diagnosticPath(path) {
  return path === "" ? "arguments" : path;
}
function propertyPath(path, key) {
  return path === "" ? key : `${path}.${key}`;
}
function losslessValueViolation(path) {
  return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
function appendViolations(target, source) {
  for (const violation of source) target.push(violation);
}
function valueFrame(node, value, path) {
  return {
    node,
    value,
    path,
    catches: false,
    phase: "start",
    children: [],
    childIndex: 0,
    violations: [],
    tailViolations: [],
    matches: 0
  };
}
function checkScalarValue(node, value, path) {
  const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
  if (allowed !== void 0 && !allowed.includes(value)) {
    return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
  }
  if (Object.hasOwn(node, "const") && value !== node.const) {
    return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
  }
  return [];
}
function checkValue(schema, value, path) {
  const frames = [valueFrame(schema, value, path)];
  let rootResult;
  const receive = (result) => {
    const parent = frames.at(-1);
    if (parent === void 0) {
      rootResult = result;
      return;
    }
    if (parent.kind === "oneOf") {
      if (result.length === 0) parent.matches++;
    } else {
      appendViolations(parent.violations, result);
    }
  };
  const finish = (result) => {
    frames.pop();
    receive(result);
  };
  while (frames.length > 0) {
    const frame = frames.at(-1);
    if (frame === void 0) break;
    try {
      if (frame.phase === "children") {
        if (frame.childIndex < frame.children.length) {
          const child = frame.children[frame.childIndex];
          if (child === void 0) throw new Error("missing schema-value child frame");
          frame.childIndex++;
          frames.push(valueFrame(child.node, child.value, child.path));
          continue;
        }
        if (frame.kind === "oneOf") {
          finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
          continue;
        }
        appendViolations(frame.violations, frame.tailViolations);
        if (frame.violations.length > 0) {
          finish(frame.violations);
        } else if (frame.kind === "object") {
          finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
        } else {
          finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
        }
        continue;
      }
      const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
      frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
      const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
      if (oneOf !== void 0) {
        frame.kind = "oneOf";
        frame.children = Array.from(oneOf, (branch) => ({ node: branch, value: frame.value, path: frame.path }));
        frame.childIndex = 0;
        frame.matches = 0;
        frame.phase = "children";
        continue;
      }
      if (nodeType === void 0) {
        finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
        continue;
      }
      switch (nodeType) {
        case "object": {
          if (!isPlainJsonRecord(frame.value)) {
            finish([`"${diagnosticPath(frame.path)}" must be an object`]);
            break;
          }
          const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
          const violations = [];
          const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
          for (const key of required) {
            if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) {
              violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
            }
          }
          const children = [];
          for (const [key, child] of Object.entries(properties)) {
            if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
            children.push({ node: child, value: frame.value[key], path: propertyPath(frame.path, key) });
          }
          const tailViolations = [];
          if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
            for (const key of Object.keys(frame.value)) {
              if (!Object.hasOwn(properties, key)) {
                tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
              }
            }
          }
          frame.kind = "object";
          frame.children = children;
          frame.childIndex = 0;
          frame.violations = violations;
          frame.tailViolations = tailViolations;
          frame.phase = "children";
          break;
        }
        case "array": {
          if (!Array.isArray(frame.value)) {
            finish([`"${diagnosticPath(frame.path)}" must be an array`]);
            break;
          }
          const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
          const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{ node: items, value: entry, path: `${frame.path}[${index}]` }]);
          frame.kind = "array";
          frame.children = children;
          frame.childIndex = 0;
          frame.violations = [];
          frame.phase = "children";
          break;
        }
        case "string":
          finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
          break;
        case "number":
          finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
          break;
        case "integer":
          finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
          break;
        case "boolean":
          finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
          break;
        case "null":
          finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
          break;
        default:
          finish(assertNever(nodeType, "JsonSchemaType"));
      }
    } catch (error) {
      let failed = frames.pop();
      while (failed !== void 0 && !failed.catches) failed = frames.pop();
      if (failed === void 0) throw error;
      receive(losslessValueViolation(failed.path));
    }
  }
  return rootResult ?? losslessValueViolation(path);
}
function validateJsonSchemaValue(schema, value, path = "value") {
  return checkValue(schema, value, path);
}

// third_party/dsh-tools/packages/core/tools/src/schema.ts
var ANNOTATION_KEYS = ["description", "title", "default", "examples"];
function authorError(message) {
  throw new JsonSchemaError([message]);
}
function copyAnnotations(source, target) {
  if (Object.hasOwn(source, "description")) target.description = source.description;
  if (Object.hasOwn(source, "title")) target.title = source.title;
  if (Object.hasOwn(source, "default")) target.default = source.default;
  if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
function assertAuthorKeys(source, path, allowed) {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
  }
}
function assignCompiledNode(destination, node) {
  switch (destination.kind) {
    case "root":
      destination.holder.value = node;
      break;
    case "property":
      Object.defineProperty(destination.target, destination.key, {
        value: node,
        enumerable: true,
        configurable: true,
        writable: true
      });
      break;
    case "item":
      destination.target.items = node;
      break;
    case "one-of":
      destination.target[destination.index] = node;
      break;
  }
}
function assignCompiledPropertyMap(destination, compiled) {
  if (destination.kind === "root") {
    destination.holder.value = compiled;
  } else {
    destination.target.properties = compiled.properties;
  }
}
function runSchemaCompiler(initial) {
  const seen = /* @__PURE__ */ new Set();
  const tasks = [initial];
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === "leave") {
      seen.delete(task.input);
      continue;
    }
    if (task.kind === "property-map-tail") {
      if (task.required.length > 0) {
        task.compiled.required = task.required;
        if (task.destination.kind === "object") task.destination.target.required = task.required;
      }
      continue;
    }
    if (task.kind === "property") {
      if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
      if (Object.hasOwn(task.property, "required") && task.property.required !== true) {
        authorError(`${task.path}.required must be true when present`);
      }
      if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
      tasks.push({
        kind: "value",
        input: task.property,
        path: task.path,
        allowRequired: true,
        destination: { kind: "property", target: task.properties, key: task.key }
      });
      continue;
    }
    if (task.kind === "property-map") {
      if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
      if (seen.has(task.input)) authorError(`${task.path} is circular`);
      seen.add(task.input);
      const compiled = { properties: {} };
      const required = [];
      assignCompiledPropertyMap(task.destination, compiled);
      tasks.push({ kind: "leave", input: task.input });
      tasks.push({ kind: "property-map-tail", compiled, required, destination: task.destination });
      const entries = Object.entries(task.input);
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry === void 0) continue;
        tasks.push({
          kind: "property",
          property: entry[1],
          path: `${task.path}.${entry[0]}`,
          key: entry[0],
          properties: compiled.properties,
          required
        });
      }
      continue;
    }
    const { input: input2, path } = task;
    if (!isJsonSchemaRecord(input2)) authorError(`${path} must be a value schema object`);
    if (seen.has(input2)) authorError(`${path} is circular`);
    seen.add(input2);
    const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
    const node = {};
    assignCompiledNode(task.destination, node);
    tasks.push({ kind: "leave", input: input2 });
    if (Object.hasOwn(input2, "oneOf")) {
      assertAuthorKeys(input2, path, [...authorKeys, "oneOf", "type"]);
      if (Object.hasOwn(input2, "type")) authorError(`${path} cannot declare both type and oneOf`);
      if (!isPlainJsonArray(input2.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
      const branches = [];
      node.oneOf = branches;
      copyAnnotations(input2, node);
      for (let index = input2.oneOf.length - 1; index >= 0; index--) {
        tasks.push({
          kind: "value",
          input: input2.oneOf[index],
          path: `${path}.oneOf[${index}]`,
          allowRequired: false,
          destination: { kind: "one-of", target: branches, index }
        });
      }
      continue;
    }
    const inputType = Object.hasOwn(input2, "type") ? input2.type : void 0;
    switch (inputType) {
      case "json":
        assertAuthorKeys(input2, path, [...authorKeys, "type"]);
        copyAnnotations(input2, node);
        break;
      case "object":
        assertAuthorKeys(input2, path, [...authorKeys, "type", "properties", "additionalProperties"]);
        if (!Object.hasOwn(input2, "additionalProperties") || typeof input2.additionalProperties !== "boolean") {
          authorError(`${path}.additionalProperties must be explicitly true or false`);
        }
        node.type = "object";
        copyAnnotations(input2, node);
        node.additionalProperties = input2.additionalProperties;
        if (Object.hasOwn(input2, "properties")) {
          tasks.push({
            kind: "property-map",
            input: input2.properties,
            path: `${path}.properties`,
            destination: { kind: "object", target: node }
          });
        }
        break;
      case "array":
        assertAuthorKeys(input2, path, [...authorKeys, "type", "items"]);
        node.type = "array";
        copyAnnotations(input2, node);
        if (Object.hasOwn(input2, "items")) {
          tasks.push({
            kind: "value",
            input: input2.items,
            path: `${path}.items`,
            allowRequired: false,
            destination: { kind: "item", target: node }
          });
        }
        break;
      case "string":
      case "number":
      case "integer":
      case "boolean":
      case "null":
        assertAuthorKeys(input2, path, [...authorKeys, "type", "enum", "const"]);
        node.type = inputType;
        copyAnnotations(input2, node);
        if (Object.hasOwn(input2, "enum")) {
          if (!isPlainJsonArray(input2.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
          node.enum = Array.from(input2.enum, (entry) => entry);
        }
        if (Object.hasOwn(input2, "const")) node.const = input2.const;
        break;
      default:
        authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
    }
  }
}
function compilePropertyMap(input2, path) {
  const holder = {};
  runSchemaCompiler({ kind: "property-map", input: input2, path, destination: { kind: "root", holder } });
  return holder.value ?? authorError(`${path} did not compile`);
}
function compileValueSchema(input2, path) {
  const holder = {};
  runSchemaCompiler({ kind: "value", input: input2, path, allowRequired: false, destination: { kind: "root", holder } });
  return holder.value ?? authorError(`${path} did not compile`);
}
function valueSchemaSpecToJsonSchema(spec) {
  const schema = compileValueSchema(spec, "schema");
  assertSupportedJsonSchema(schema);
  return schema;
}
function parameterSchemaSpecToJsonSchema(spec) {
  const compiled = compilePropertyMap(spec, "parameters");
  const schema = {
    type: "object",
    properties: compiled.properties,
    ...compiled.required === void 0 ? {} : { required: compiled.required }
  };
  assertSupportedJsonSchema(schema);
  return schema;
}
var ToolArgsError = class extends HarnessError {
  /** Individual violations in schema-walk order. */
  violations;
  constructor(violations) {
    super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
    this.name = "ToolArgsError";
    this.violations = violations;
  }
};
function defineTool(options) {
  const userExecute = options.execute;
  const userFinalizeContent = options.finalizeContent;
  const userProjectContent = options.projectContent;
  const userRender = options.output.render;
  const userPresentationMeta = options.output.presentationMeta;
  const userPresentCall = options.presentCall;
  const userPresentResult = options.presentResult;
  const userIsConcurrencySafe = options.isConcurrencySafe;
  if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
  }
  const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
  const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
  const validate = (args) => validateJsonSchemaValue(parameters, args, "");
  const tool = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render(args, value) {
        return userRender(args, value);
      },
      ...userPresentationMeta !== void 0 ? {
        presentationMeta(args, value) {
          return userPresentationMeta(args, value);
        }
      } : {}
    },
    ...options.deferLoading === true ? { deferLoading: options.deferLoading } : {},
    ...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
    async execute(args, exec) {
      const violations = validate(args);
      if (violations.length > 0) throw new ToolArgsError(violations);
      return userExecute(args, exec);
    }
  };
  if (userProjectContent) {
    tool.projectContent = (exec, result) => userProjectContent(exec, result);
  }
  if (userFinalizeContent) {
    tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
  }
  if (userPresentCall) {
    tool.presentCall = (args) => {
      if (validate(args).length > 0) return void 0;
      return userPresentCall(args);
    };
  }
  if (userPresentResult) {
    tool.presentResult = (args, result) => {
      if (validate(args).length > 0) return void 0;
      return userPresentResult(args, result);
    };
  }
  if (userIsConcurrencySafe) {
    tool.isConcurrencySafe = (args) => {
      if (validate(args).length > 0) return false;
      return userIsConcurrencySafe(args);
    };
  }
  return tool;
}
function projectToolSchema(definition, detachParameters) {
  const { name: name4, description, parameters, deferLoading } = definition;
  const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
  if (detached === void 0) throw new Error(`tool "${name4}" parameters must be lossless JSON before schema projection`);
  return { name: name4, description, parameters: detached, ...deferLoading === true ? { deferLoading } : {} };
}

// third_party/dsh-tools/packages/core/tools/src/contracts.ts
var RUN_CODE_NAME = "run_code";
var ToolActivationError = class extends HarnessError {
  /**
   * Preserve a condition failure without treating it as normal unavailability.
   * @param name - tool whose condition rejected.
   * @param cause - underlying condition failure.
   */
  constructor(name4, cause) {
    super(`cannot resolve availability of tool "${name4}"`, "TOOL_ACTIVATION_FAILED", { cause });
    this.name = "ToolActivationError";
  }
};
var TOOL_ABORTED = "ABORTED";
var TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
var ToolNotFoundError = class extends HarnessError {
  /**
   * @param toolName - the name the caller asked for.
   * @param reachableFrom - how the model reaches this tool instead, when the
   *   name IS visible and only the presentation denies calling it directly.
   *   Omitted for a name that is registered nowhere.
   */
  constructor(toolName, reachableFrom) {
    super(
      reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`,
      "UNKNOWN_TOOL"
    );
    this.name = "ToolNotFoundError";
  }
};
var ToolOutputError = class extends HarnessError {
  /** Schema/value violations in validation order. */
  violations;
  constructor(toolName, violations) {
    super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
    this.name = "ToolOutputError";
    this.violations = violations;
  }
};

// third_party/dsh-tools/packages/core/tools/src/index.ts
var ToolLayer = class {
  tools;
  restrictions = new AnonymousEntries();
  constructor(scope) {
    this.tools = new NamedEntries((name4) => new Error(scope === void 0 ? `tool "${name4}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name4}" is already registered in this scope`));
  }
  /** Whether every contribution table in this aggregate layer is empty. */
  isEmpty() {
    return this.tools.isEmpty() && this.restrictions.isEmpty();
  }
  /** Whether every compiled restriction in this layer admits a global tool name. */
  admits(name4) {
    for (const filter of this.restrictions.values()) {
      if (filter.allow !== void 0 && !filter.allow.has(name4) || filter.deny !== void 0 && filter.deny.has(name4)) return false;
    }
    return true;
  }
};
var GuardLayer = class {
  guards = new AnonymousEntries();
  isEmpty() {
    return this.guards.isEmpty();
  }
};
var ToolsService = class extends cordis_exports.Service {
  static inject = ["systemPrompt"];
  static Config = z.object({
    mode: z.never().description("Removed. Mount a native or PTC tool executor instead."),
    maxParallelSubCalls: z.never().description("Moved to the PTC tool executor configuration.")
  });
  layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
    this.ctx.emit("tools/change");
  });
  scoped = /* @__PURE__ */ new WeakMap();
  root;
  guards = new ScopedLayers(() => new GuardLayer(), () => {
  });
  constructor(ctx2) {
    super(ctx2, "tools");
    ctx2.systemPrompt.tools(({ scope, toolSet }) => {
      const executor = this.selectExecutor(scope);
      const description = executor.describe(this.definitions(scope, toolSet));
      return { ...description, knownNames: description.knownNames ?? [...this.view(scope).knownNames] };
    });
  }
  /**
   * Register globally or in the calling agent scope. Scoped tools shadow
   * globals; duplicates within one layer and the reserved `run_code` name fail.
   * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
   * @param options - optional step-time activation condition.
   * @returns the exact disposer that unregisters the tool.
   */
  register(definition, options = {}) {
    const name4 = definition.name;
    const output = definition.output;
    if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") {
      throw new TypeError(`tool "${name4}" must declare output { schema, render, presentationMeta? }`);
    }
    assertSupportedJsonSchema(output.schema);
    const timeoutMs = definition.timeoutMs;
    if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new TypeError(`tool "${name4}" timeoutMs must be a positive finite number`);
    }
    if (name4 === RUN_CODE_NAME) {
      throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the PTC mode presentation transport and cannot be registered or shadowed`);
    }
    return this.layers.effect(
      this.ctx,
      (layer) => layer.tools.insert(name4, { definition, when: options.when }),
      { label: "tools.register()" }
    );
  }
  /**
   * Restrict global tools for the calling agent scope. Empty filters, unknown
   * names, scope-local names, and reserved transport names fail. Restrictions
   * intersect; scoped registrations remain visible.
   * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
   * @returns the exact disposer that lifts this restriction.
   */
  restrict(filter) {
    const scope = scopeOf(this.ctx);
    if (scope === void 0) {
      throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent \u2014 deny the tool for the intended agent instead");
    }
    const allow = filter.allow;
    const deny = filter.deny;
    if (allow === void 0 && deny === void 0) {
      throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
    }
    const compiled = {
      ...allow !== void 0 ? { allow: new Set(allow) } : {},
      ...deny !== void 0 ? { deny: new Set(deny) } : {}
    };
    if ([...allow ?? [], ...deny ?? []].includes(RUN_CODE_NAME)) {
      throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
    }
    const known = this.view(scope).restrictableNames;
    const unknown = [...allow ?? [], ...deny ?? []].filter((name4) => !known.has(name4));
    if (unknown.length > 0) {
      throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
    }
    return this.layers.effect(
      this.ctx,
      (layer) => layer.restrictions.append(compiled),
      { label: "tools.restrict()" }
    );
  }
  /**
   * Resolve visible tools and pre-restriction names. Restrictions across the
   * scope chain intersect over inherited global and ancestor tools; the viewing
   * scope's own registrations remain exempt. Nearer registrations shadow
   * farther ones. Pre-restriction names support restriction and prompt-order validation.
   * @param scope - the viewing scope (the agent), or undefined for the global view.
   * @returns the complete derived view for that scope.
   */
  view(scope) {
    const layers = this.layers.chainLayers(scope);
    const own = this.layers.peek(scope);
    const inherited = new Map(this.layers.global.tools.entries());
    for (const layer of layers) {
      if (layer === own) continue;
      for (const [name4, registration] of layer.tools.entries()) inherited.set(name4, registration);
    }
    const visible = /* @__PURE__ */ new Map();
    const registrations = /* @__PURE__ */ new Map();
    const knownNames = /* @__PURE__ */ new Set();
    const restrictableNames = /* @__PURE__ */ new Set();
    for (const [name4, registration] of inherited) {
      knownNames.add(name4);
      restrictableNames.add(name4);
      if (layers.every((layer) => layer.admits(name4))) {
        visible.set(name4, registration.definition);
        registrations.set(name4, registration);
      }
    }
    if (own !== void 0) {
      for (const [name4, registration] of own.tools.entries()) {
        knownNames.add(name4);
        visible.set(name4, registration.definition);
        registrations.set(name4, registration);
      }
    }
    return { visible, registrations, knownNames, restrictableNames };
  }
  /**
   * Look up a tool as one scope sees it (scoped
   * shadows global; a restricted-away global reads as absent). Presenters pass
   * the calling agent so the rendered card matches the definition that
   * actually executed.
   * @param name - the tool name as registered.
   * @param scope - the viewing scope (the agent); omitted = the global view.
   * @param toolSet - step admission; omit only to inspect registered definitions.
   * @returns the definition the scope resolves, or undefined when none is visible.
   */
  get(name4, scope, toolSet) {
    return toolSet === void 0 ? this.view(scope).visible.get(name4) : toolSet.view(scope).get(name4);
  }
  /**
   * Resolve the definition a call may execute. With a step's admitted set, the
   * set decides; without one, conditional registrations are unavailable.
   * @param name - the tool name as registered.
   * @param scope - the calling agent; omitted = the global view.
   * @param toolSet - step admission, or omitted for a call outside a model step.
   * @returns the executable definition, or undefined when the call must fail as `UNKNOWN_TOOL`.
   */
  executable(name4, scope, toolSet) {
    if (toolSet !== void 0) return toolSet.view(scope).get(name4);
    const view = this.view(scope);
    return view.registrations.get(name4)?.when === void 0 ? view.visible.get(name4) : void 0;
  }
  /**
   * Resolve conditions once for this step without changing shared registrations.
   * Cancellation or a rejected condition publishes no partial selection. Removed
   * registrations cannot be restored by a late condition result.
   * @param context - preparing agent, captured model selection, and cancellation.
   * @returns the complete selection; the caller disposes it after its tool batch settles.
   */
  async resolve(context) {
    const { agent, signal } = context;
    signal.throwIfAborted();
    const view = this.view(agent);
    const admitted = /* @__PURE__ */ new Map();
    for (const [name4, definition] of view.visible) {
      const registration = view.registrations.get(name4);
      let enabled;
      try {
        enabled = registration?.when === void 0 || await registration.when(context);
      } catch (cause) {
        signal.throwIfAborted();
        throw new ToolActivationError(name4, cause);
      }
      signal.throwIfAborted();
      if (enabled) admitted.set(name4, definition);
    }
    let closed = false;
    return Object.freeze({
      dispose: () => {
        closed = true;
      },
      view: (scope) => {
        const visible = /* @__PURE__ */ new Map();
        if (closed || scope !== agent) return visible;
        const current = this.view(agent);
        for (const [name4, definition] of admitted) {
          if (current.visible.get(name4) === definition && current.registrations.get(name4) === view.registrations.get(name4)) {
            visible.set(name4, definition);
          }
        }
        return visible;
      }
    });
  }
  /**
   * Read the visible capability definitions for descriptions and program bindings.
   * @param scope - viewing Agent or preset; omitted selects the global view.
   * @param toolSet - step admission; omit only to inspect registered definitions.
   * @returns definitions after scoped shadowing and restrictions, limited to the step's admission when given.
   */
  definitions(scope, toolSet) {
    return toolSet === void 0 ? [...this.view(scope).visible.values()] : [...toolSet.view(scope).values()];
  }
  /**
   * Project visible definitions onto the allowlisted model-facing schema fields,
   * excluding execution and presentation callbacks.
   * @param scope - the viewing scope (the agent); omitted = the global view.
   * @param toolSet - step admission, or omitted for registered-definition inspection.
   * @returns one deep-cloned schema per visible tool.
   */
  schemas(scope, toolSet) {
    return this.definitions(scope, toolSet).map((definition) => projectToolSchema(definition, true));
  }
  /**
   * Provide the executor for the calling scope; an unscoped contribution is the deployment default.
   * Rendering any executor-owned section requires the viewing scope's selection to remain available.
   * @param executor - initialized provider owned by the contributing plugin.
   * @returns the effect disposer. Unloading leaves the selection unavailable until it is replaced.
   */
  setExecutor(executor) {
    const scope = scopeOf(this.ctx);
    const existing = scope === void 0 ? this.root : this.scoped.get(scope);
    if (existing?.executor !== void 0) throw new Error("Only one tool executor may be registered in each scope");
    const record = { executor };
    return this.ctx.effect(function* () {
      for (const section of executor.sections ?? []) {
        yield this.ctx.systemPrompt.section({
          name: section.name,
          order: section.order,
          ...section.interpolate === void 0 ? {} : { interpolate: section.interpolate },
          text: ({ scope: scope2, toolSet }) => {
            if (this.selectExecutor(scope2) !== executor) return "";
            return typeof section.text === "function" ? section.text(this.definitions(scope2, toolSet)) : section.text;
          }
        });
      }
      if (scope === void 0) this.root = record;
      else this.scoped.set(scope, record);
      yield () => {
        record.executor = void 0;
      };
    }.bind(this), "tools.setExecutor()");
  }
  /**
   * Resolve the nearest scoped provider, or the deployment default.
   * @param scope - Agent or preset scope; omitted selects only the root contribution.
   * @returns the selected executor; throws when it is missing or unloaded.
   */
  selectExecutor(scope) {
    let record;
    for (const key of scopeChainOf(scope)) {
      record = this.scoped.get(key);
      if (record !== void 0) break;
    }
    record ??= this.root;
    const executor = record?.executor;
    if (executor === void 0) throw new ToolExecutorUnavailableError();
    return executor;
  }
  /**
   * Delegate a raw call batch to its Agent's provider or the deployment default.
   * Select at dispatch; accepted batches settle through that provider even if it unloads.
   * @param input - original calls, optional owning Agent, and optional logging step.
   * @returns the selected executor's settled batch; unavailable selections reject.
   */
  async execute(input2) {
    return this.selectExecutor(input2.agent).execute(input2);
  }
  /**
   * Register a monotonic denial in the calling scope.
   * @param guard - evaluated after extensible pre-execute policy by the shared pipeline.
   * @returns the effect disposer that removes this guard.
   */
  guard(guard) {
    return this.guards.effect(this.ctx, (layer) => layer.guards.append(guard), { label: "tools.guard()" });
  }
  /**
   * Check global and inherited guards after pre-execute policy and approval resolve.
   * @param exec - invocation whose guards are checked before dispatch.
   * @returns the first denial reason, or undefined when no guard denies.
   */
  checkGuards(exec) {
    for (const layer of [this.guards.global, ...this.guards.chainLayers(exec.agent)]) {
      for (const guard of layer.guards.values()) {
        const reason = guard(exec);
        if (reason !== void 0) return reason;
      }
    }
    return void 0;
  }
};

// third_party/dsh-tools/packages/core/tool-executor-native/src/index.ts
var src_exports = {};
__export(src_exports, {
  NativeToolExecutor: () => NativeToolExecutor,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});

// third_party/dsh-tools/packages/util/crypto/src/index.ts
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte;
    return pinned.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// third_party/dsh-tools/packages/util/brand/src/index.ts
function brandString(value) {
  return value;
}

// third_party/dsh-tools/packages/llm/llm/src/message.ts
function createMessage(input2) {
  return deepFreeze(structuredClone({
    ...input2,
    id: brandString(randomUUID())
  }));
}
function createToolResultMessage(input2) {
  return createMessage({
    role: "tool",
    source: { kind: "tool", callId: input2.callId },
    toolCallId: input2.callId,
    content: input2.content,
    isError: input2.isError
  });
}

// third_party/dsh-tools/packages/core/tools/src/batch.ts
async function executeToolBatch(input2, pipeline, maxParallel) {
  const { calls: toolCalls, signal, agent, toolSet, maxParallelToolCalls } = input2;
  if (maxParallelToolCalls !== void 0 && (!Number.isInteger(maxParallelToolCalls) || maxParallelToolCalls < 1)) {
    throw new RangeError("maxParallelToolCalls must be a positive integer");
  }
  const settlement = new BatchSettlement(input2);
  try {
    const planned = toolCalls.map((block) => ({
      block,
      exec: {
        callId: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        ...agent === void 0 ? {} : { agent },
        ...toolSet === void 0 ? {} : { toolSet },
        signal
      }
    }));
    let next = 0;
    let concluded = false;
    while (next < planned.length) {
      const first = planned[next];
      const mode = pipeline.executionMode(first.exec).kind;
      const group = mode === "parallel" ? planned.slice(next) : [first];
      const outcome = await runGroup(
        pipeline,
        settlement,
        maxParallelToolCalls ?? maxParallel(),
        group,
        mode,
        signal
      );
      next += outcome.consumed;
      concluded ||= outcome.concluded;
      if (outcome.aborted) {
        for (const call of planned.slice(next)) settlement.skip(call.block);
        return settlement.result(concluded);
      }
    }
    return settlement.result(concluded);
  } catch (error) {
    throw new ToolBatchExecutionError(error, settlement.result());
  }
}
function parseArguments(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return raw;
  }
}
async function runGroup(pipeline, settlement, maxParallelToolCalls, group, mode, signal) {
  const slots = group.map(() => void 0);
  const callSeqs = group.map(() => void 0);
  let nextToStart = 0;
  let committed = 0;
  let started = 0;
  let aborted = signal.aborted;
  let concluded = false;
  let schedulerFailure;
  const throwSchedulerFailure = () => {
    if (schedulerFailure !== void 0) throw schedulerFailure.error;
  };
  const commitReady = async () => {
    while (committed < group.length) {
      const slot = slots[committed];
      if (slot === void 0) break;
      const call = group[committed];
      const result = await pipeline.complete(slot.exec, slot);
      settlement.commit(call.block, result, callSeqs[committed]);
      concluded ||= result.concludesTurn === true;
      committed++;
    }
  };
  const inFlight = /* @__PURE__ */ new Map();
  const startCall = async (index) => {
    const call = group[index];
    callSeqs[index] = settlement.start(call.block);
    started++;
    const prepared = await pipeline.prepare(call.exec);
    throwSchedulerFailure();
    switch (prepared.kind) {
      case "dispatch": {
        const promise = pipeline.dispatch(prepared.exec).then(
          (outcome) => {
            slots[index] = { ...outcome, exec: prepared.exec };
            return index;
          },
          (error) => {
            schedulerFailure ??= { error };
            return index;
          }
        );
        inFlight.set(index, promise);
        break;
      }
      case "post-result":
      case "final-result":
        slots[index] = prepared;
        break;
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(prepared, "tool-call scheduler prepare result");
    }
  };
  const fillPool = async () => {
    while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
      const nextCall = group[nextToStart];
      if (nextToStart > 0 && mode === "parallel" && pipeline.executionMode(nextCall.exec).kind !== "parallel") break;
      await startCall(nextToStart);
      nextToStart++;
      throwSchedulerFailure();
      await commitReady();
      throwSchedulerFailure();
      if (signal.aborted) aborted = true;
    }
  };
  try {
    await fillPool();
    while (inFlight.size > 0) {
      const settledIndex = await Promise.race(inFlight.values());
      inFlight.delete(settledIndex);
      throwSchedulerFailure();
      await commitReady();
      throwSchedulerFailure();
      if (signal.aborted) aborted = true;
      await fillPool();
    }
  } catch (error) {
    schedulerFailure ??= { error };
    await Promise.allSettled(inFlight.values());
    throw schedulerFailure.error;
  }
  if (aborted) {
    for (const call of group.slice(started)) settlement.skip(call.block);
    return { consumed: group.length, aborted: true, concluded };
  }
  if (committed !== started) throw new Error("tool-call scheduler: uncommitted settled calls");
  return { consumed: started, aborted: false, concluded };
}
var BatchSettlement = class {
  constructor(input2) {
    this.input = input2;
  }
  input;
  results = [];
  contexts = [];
  start(block) {
    if (this.input.log === void 0) return void 0;
    const { agent, log: { turn, step } } = this.input;
    return agent.session.append("tool/call", {
      turn,
      step,
      callId: block.id,
      name: block.name,
      arguments: block.arguments
    }).seq;
  }
  commit(block, result, callSeq) {
    if (this.input.log !== void 0) {
      const { agent, log: { turn, step } } = this.input;
      agent.session.append("tool/result", {
        turn,
        step,
        message: createToolResultMessage({ callId: block.id, content: result.content, isError: result.isError }),
        ...result.error?.info ? { error: result.error.info } : {},
        ...result.meta !== void 0 ? { meta: result.meta } : {}
      }, {
        surfaceOp: "append",
        // oxlint-disable-next-line typescript/no-non-null-assertion -- start records a call seq whenever this batch logs results
        sourceEventSeqs: [callSeq]
      });
    }
    this.results.push({ callId: block.id, result });
    this.contexts.push(...result.additionalContexts ?? []);
  }
  skip(block) {
    this.commit(block, {
      content: [{ type: "text", text: "Error: tool call aborted before dispatch" }],
      isError: true,
      error: {
        message: "tool call aborted before dispatch",
        info: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH }
      }
    }, this.start(block));
  }
  result(concluded = this.results.some(({ result }) => result.concludesTurn === true)) {
    return { results: this.results, additionalContexts: this.contexts, concluded };
  }
};

// third_party/dsh-tools/packages/core/tools/src/pipeline.ts
var ToolExecutionPipeline = class {
  constructor(ctx2, source = {}) {
    this.ctx = ctx2;
    this.source = source;
    this.tools = ctx2.tools;
  }
  ctx;
  source;
  tools;
  get(name4, scope, toolSet) {
    return this.source.get === void 0 ? this.tools.executable(name4, scope, toolSet) : this.source.get(name4, scope, toolSet);
  }
  resolveExecution(name4, scope, nested, toolSet) {
    const tool = this.get(name4, scope, toolSet);
    return tool !== void 0 && this.source.reject?.(name4, nested) === void 0 ? tool : void 0;
  }
  /** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
  deferredContexts = /* @__PURE__ */ new WeakMap();
  /** Executions whose tool body declared the current turn complete. */
  concludingExecutions = /* @__PURE__ */ new WeakSet();
  /** Original caller cancellation, kept outside the wrapper-mutable execution object. */
  cancellationStates = /* @__PURE__ */ new WeakMap();
  /** Definition-owned final content transform snapshotted before policy begins. */
  contentFinalizers = /* @__PURE__ */ new WeakMap();
  /** Execution-prepared content installed before post-execute policy. */
  contentProjectors = /* @__PURE__ */ new WeakMap();
  /**
   * Classify a pending call through the caller's visible tool definition. Only
   * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
   * throwing classifiers are exclusive.
   * @param exec - call name, parsed arguments, and optional agent scope.
   * @returns the fail-closed scheduling mode.
   */
  executionMode(exec) {
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0, exec.toolSet);
    if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
    try {
      const concurrencySafe = tool.isConcurrencySafe(exec.arguments);
      return concurrencySafe === true ? { kind: "parallel" } : { kind: "exclusive" };
    } catch {
      return { kind: "exclusive" };
    }
  }
  createExecution(exec) {
    const deferredContexts = [];
    const token = createExecutionToken();
    const callId = exec.callId;
    const rootCallId = exec.rootCallId ?? callId;
    const name4 = exec.name;
    const agent = exec.agent;
    const parent = exec.parent;
    const signal = exec.signal;
    const visible = this.get(name4, agent, exec.toolSet);
    const rejection = visible === void 0 ? void 0 : this.source.reject?.(name4, parent !== void 0);
    const rejected = rejection !== void 0;
    const concludingExecutions = this.concludingExecutions;
    const base = {
      token,
      callId,
      rootCallId,
      name: name4,
      signal,
      ...agent !== void 0 ? { agent } : {},
      ...exec.toolSet !== void 0 ? { toolSet: exec.toolSet } : {},
      ...parent !== void 0 ? { parent } : {},
      ...exec.schema !== void 0 ? { schema: exec.schema } : {},
      deferContext(context) {
        deferredContexts.push(context);
      },
      concludeTurn() {
        concludingExecutions.add(this);
      }
    };
    const capturedFinalizer = visible?.finalizeContent?.bind(visible);
    const capturedProjector = visible?.projectContent?.bind(visible);
    const finalizerFor = () => rejected && !signal.aborted ? void 0 : capturedFinalizer;
    try {
      const detached = snapshotJsonValue(exec.arguments);
      if (detached === void 0) {
        throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
      }
      const execution = { ...base, arguments: deepFreeze(detached) };
      this.deferredContexts.set(execution, deferredContexts);
      this.contentFinalizers.set(execution, finalizerFor());
      if (!rejected) this.contentProjectors.set(execution, capturedProjector);
      this.cancellationStates.set(execution, {
        callerSignal: signal,
        bodyInvoked: false
      });
      if (rejected) {
        if (signal.aborted) {
          return { kind: "final-result", exec: execution, result: toolAbortedBeforeDispatchResult() };
        }
        return {
          kind: "final-result",
          exec: execution,
          result: toolErrorResult(rejection)
        };
      }
      return { kind: "ready", exec: execution };
    } catch (error) {
      const execution = { ...base, arguments: void 0 };
      this.contentFinalizers.set(execution, finalizerFor());
      return { kind: "final-result", exec: execution, result: toolErrorResult(error) };
    }
  }
  /**
   * Snapshot input, assign its correlation token, and run ordered pre-execute
   * policy and guards. Cancellation skips a body that has not started.
   * @param input - the caller-supplied execution input.
   * @returns the prepared execution plus the next scheduler stage.
   */
  async prepare(input2) {
    const created = this.createExecution(input2);
    if (created.kind !== "ready") return created;
    const exec = created.exec;
    if (this.callerCancelled(exec)) {
      return { kind: "final-result", exec, result: toolAbortedBeforeDispatchResult() };
    }
    try {
      const carrier = scopeTarget(this.tools, exec.agent);
      const gate = await this.ctx.waterfall(
        carrier,
        "tools/pre-execute",
        exec,
        () => Promise.resolve({ kind: "allow" })
      );
      const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : { decision: gate, approvalCancelled: false };
      const { decision } = askResolution;
      if (this.callerCancelled(exec) && askResolution.approvalCancelled) {
        return { kind: "post-result", exec, result: toolAbortedBeforeDispatchResult() };
      }
      if (decision.kind === "cancel") {
        return { kind: "post-result", exec, result: toolAbortedBeforeDispatchResult() };
      }
      const denialReason = decision.kind === "allow" ? this.tools.checkGuards(exec) : decision.reason;
      const denialInfo = decision.kind === "deny" ? decision.info : void 0;
      if (denialReason !== void 0) {
        return {
          kind: "post-result",
          exec,
          result: this.materializeFinalResult({
            content: [{ type: "text", text: `Error: ${denialReason}` }],
            isError: true,
            error: { message: denialReason, ...denialInfo === void 0 ? {} : { info: denialInfo } }
          })
        };
      }
      if (this.callerCancelled(exec)) {
        return { kind: "post-result", exec, result: toolAbortedBeforeDispatchResult() };
      }
      return { kind: "dispatch", exec };
    } catch (error) {
      return { kind: "final-result", exec, result: toolErrorResult(error) };
    }
  }
  /** Whether the original caller signal is currently aborted. */
  callerCancelled(exec) {
    const state = this.cancellationStates.get(exec);
    if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
    return state.callerSignal.aborted;
  }
  /** Canonical cancellation outcome selected by whether the tool body started. */
  cancellationResult(exec, prior) {
    const state = this.cancellationStates.get(exec);
    if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
    return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
  }
  /**
   * Dispatch the registered body with the original caller signal fused back
   * into any around-wrapper replacement. Cancellation never abandons the body:
   * a started promise reaches quiescence before its outcome becomes `ABORTED`.
   */
  async dispatchToolBody(exec) {
    const state = this.cancellationStates.get(exec);
    if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
    const wrapperSignal = exec.signal;
    const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
    const signal = fused.signal;
    if (isAborted(signal)) {
      fused.dispose();
      return toolAbortedBeforeDispatchResult();
    }
    exec.signal = signal;
    try {
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0, exec.toolSet);
      if (!tool) throw new ToolNotFoundError(exec.name);
      state.bodyInvoked = true;
      const returned = await tool.execute(exec.arguments, exec);
      const result = this.createSuccessResult(exec, tool, returned);
      return isAborted(signal) ? toolAbortedResult(result) : result;
    } catch (error) {
      return toolErrorResult(error);
    } finally {
      fused.dispose();
      exec.signal = wrapperSignal;
    }
  }
  /**
   * Run around-dispatch and the tool body. Tool and unknown-tool failures still
   * receive post-execute; pipeline failures are already final. Started bodies
   * drain on cancellation before a successful outcome becomes `ABORTED`.
   * @param exec - the execution returned by this pipeline's prepare stage.
   * @returns whether the result still needs post-execute.
   */
  async dispatch(exec) {
    try {
      const mutableExec = exec;
      const carrier = scopeTarget(this.tools, exec.agent);
      const result = await this.ctx.waterfall(
        carrier,
        "tools/execute",
        mutableExec,
        () => this.dispatchToolBody(mutableExec)
      );
      const normalized = this.normalizeDispatchResult(exec, result);
      const deferredContexts = this.deferredContexts.get(exec);
      if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
      const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
        ...normalized,
        additionalContexts: [
          ...deferredContexts,
          ...normalized.additionalContexts ?? []
        ]
      });
      return {
        kind: "post-result",
        result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
      };
    } catch (error) {
      return { kind: "final-result", result: toolErrorResult(error) };
    }
  }
  /**
   * Run post-execute when required, apply definition-owned content finalization,
   * and publish the lossless, frozen result. Policy and finalization failures
   * become error results. Cancellation replaces a successful outcome before
   * final materialization; tool-owned errors remain intact.
   * @param exec - the execution returned by this pipeline's prepare stage.
   * @param outcome - the preparation or dispatch result awaiting completion.
   * @returns the same materialized result delivered to final observers.
   */
  async complete(exec, outcome) {
    switch (outcome.kind) {
      case "final-result":
        return this.finish(exec, outcome.result);
      case "post-result":
        break;
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(outcome, "scheduled tool outcome");
    }
    const { result } = outcome;
    try {
      const project = this.contentProjectors.get(exec);
      this.contentProjectors.delete(exec);
      const content = project?.(exec, result);
      const projected = content === void 0 ? result : this.markCanonical(exec, this.materializeFinalResult({ ...result, content }));
      const postResult = await this.postExecute(exec, projected);
      return this.finish(
        exec,
        this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult
      );
    } catch (error) {
      return this.finish(exec, toolErrorResult(error));
    }
  }
  /**
   * Materialize the candidate, apply definition-owned content finalization,
   * then materialize and notify the authoritative result.
   * @param exec - the prepared execution.
   * @param result - final result.
   * @returns the materialized final result.
   * @internal
   */
  finish(exec, result) {
    let materializedResult;
    try {
      materializedResult = this.materializeFinalResult(result);
    } catch (error) {
      materializedResult = this.materializeFinalResult(toolErrorResult(error));
    }
    let finalResult;
    try {
      finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
    } catch (error) {
      finalResult = this.materializeFinalResult(toolErrorResult(error));
    }
    this.notifyResult(exec, finalResult);
    return finalResult;
  }
  /** Apply the snapshotted tool-owned content transform without exposing other result fields. */
  applyFinalContent(exec, result) {
    const finalizeContent = this.contentFinalizers.get(exec);
    if (finalizeContent === void 0) return result;
    const content = finalizeContent(exec, result);
    return content === void 0 ? result : { ...result, content };
  }
  /** Notify observers without exposing a mutation or error channel into the outcome. */
  notifyResult(exec, result) {
    Object.freeze(exec);
    const { name: toolName, callId } = exec;
    const reportFailure = (error) => {
      this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${toolErrorMessage(error)}`);
    };
    const callbacks = this.ctx.events.dispatch("emit", [
      scopeTarget(this.tools, exec.agent),
      "tools/result",
      exec,
      result
    ]);
    for (const callback of callbacks) {
      try {
        const returned = callback(exec, result);
        void Promise.resolve(returned).catch(reportFailure);
      } catch (error) {
        reportFailure(error);
      }
    }
  }
  /**
   * Resolve an `ask` decision to allow/deny through the approval seam. The
   * seam is consumed opportunistically with `ctx.get('approval')` — a
   * deployment that composes no ApprovalService keeps the historical degrade
   * to deny, and an unmount mid-session degrades the same way on the next ask.
   * An agent-less execution also degrades: without an agent there is no
   * session to audit to and no UI to route to. Otherwise the outcome maps
   * one-to-one — `allowed-once` proceeds; the three non-grants deny with
   * distinct reasons so the model can tell a human "no" from an absent
   * approval channel.
   */
  async serviceAsk(exec, ask) {
    const approval = this.ctx.get("approval");
    if (approval === void 0) {
      return {
        decision: { kind: "deny", reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)` },
        approvalCancelled: false
      };
    }
    if (exec.agent === void 0) {
      return {
        decision: { kind: "deny", reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through` },
        approvalCancelled: false
      };
    }
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      ...ask.reason !== void 0 ? { reason: ask.reason } : {},
      ...ask.displayReason !== void 0 ? { displayReason: ask.displayReason } : {},
      signal: exec.signal
    });
    switch (outcome) {
      case "allowed-once":
        return { decision: { kind: "allow" }, approvalCancelled: false };
      case "rejected":
        return {
          decision: { kind: "deny", reason: `the user rejected tool "${exec.name}"` },
          approvalCancelled: false
        };
      case "cancelled":
        return {
          decision: { kind: "deny", reason: `approval for tool "${exec.name}" was cancelled` },
          approvalCancelled: true
        };
      case "unavailable":
        return {
          decision: { kind: "deny", reason: `tool "${exec.name}" requires approval, but no approval channel is available` },
          approvalCancelled: false
        };
      default:
        return assertNever(outcome, "ApprovalOutcome");
    }
  }
  /**
   * Run the `tools/post-execute` waterfall over a dispatched `result` and apply
   * its {@link PostToolDecision}: `accept` keeps the call successful (replacing
   * `content` when given), `block` turns it into an `isError` whose content is
   * the corrective `feedback`. Either decision may attach `additionalContexts`,
   * which are ferried on the returned result for the loop's active-batch FIFO.
   * Context deferred by the tool body survives an accepted result but is
   * discarded when the outer call is blocked; a block exposes only context the
   * blocking decision explicitly supplied.
   * Runs inside `execute`'s outer try/catch (a throwing listener → isError).
   */
  async postExecute(exec, result) {
    const decision = await this.ctx.waterfall(
      scopeTarget(this.tools, exec.agent),
      "tools/post-execute",
      exec,
      result,
      () => Promise.resolve({ kind: "accept" })
    );
    const decisionContexts = decision.additionalContexts ?? [];
    if (decision.kind === "block") {
      const message = failureMessageFromContent(decision.feedback);
      return this.markCanonical(exec, {
        content: decision.feedback,
        isError: true,
        error: { message },
        ...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
      });
    }
    if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) {
      throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
    }
    const additionalContexts = [
      ...result.additionalContexts ?? [],
      ...decisionContexts
    ];
    if (Object.hasOwn(decision, "value")) {
      if (result.isError) {
        throw new TypeError("tools/post-execute cannot replace the value of a failed result");
      }
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0, exec.toolSet);
      if (tool === void 0) throw new ToolNotFoundError(exec.name);
      const replaced = this.createSuccessResult(exec, tool, decision.value);
      return this.markCanonical(exec, {
        ...replaced,
        ...additionalContexts.length > 0 ? { additionalContexts } : {}
      });
    }
    return this.markCanonical(exec, {
      ...result,
      ...decision.content !== void 0 ? { content: decision.content } : {},
      ...additionalContexts.length > 0 ? { additionalContexts } : {}
    });
  }
  /** Registry-normalized results and the exact dispatch that validated each value. */
  canonicalResults = /* @__PURE__ */ new WeakMap();
  /** Mark one registry-normalized result as canonical only for its owning dispatch. */
  markCanonical(exec, result) {
    this.canonicalResults.set(result, exec.token);
    return result;
  }
  /** Snapshot, validate, render, and optionally project one successful body value. */
  createSuccessResult(exec, tool, candidate) {
    const detached = snapshotToolValue(tool.name, candidate);
    const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
    if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
    const value = deepFreeze(detached);
    let rendered;
    try {
      rendered = tool.output.render(exec.arguments, value);
    } catch (error) {
      throw projectionError(tool.name, "render", error);
    }
    const content = snapshotProjection(tool.name, "render", rendered);
    let meta;
    if (tool.output.presentationMeta !== void 0) {
      let projected;
      try {
        projected = tool.output.presentationMeta(exec.arguments, value);
      } catch (error) {
        throw projectionError(tool.name, "presentationMeta", error);
      }
      meta = snapshotProjection(tool.name, "presentationMeta", projected);
    }
    const concludesTurn = this.concludingExecutions.has(exec);
    return this.markCanonical(exec, this.materializeFinalResult({
      isError: false,
      value,
      content,
      ...meta !== void 0 ? { meta } : {},
      ...concludesTurn ? { concludesTurn: true } : {}
    }));
  }
  /** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
  normalizeDispatchResult(exec, result) {
    if (this.canonicalResults.get(result) === exec.token) return result;
    if (result.isError) {
      return this.markCanonical(exec, {
        isError: true,
        error: result.error,
        content: result.content,
        ...result.meta !== void 0 ? { meta: result.meta } : {},
        ...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
      });
    }
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0, exec.toolSet);
    if (tool === void 0) throw new ToolNotFoundError(exec.name);
    const normalized = this.createSuccessResult(exec, tool, result.value);
    return this.markCanonical(exec, {
      ...normalized,
      ...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
    });
  }
  /** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
  materializeFinalResult(result) {
    const presentation = {
      content: result.content,
      ...result.meta !== void 0 ? { meta: result.meta } : {},
      ...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
    };
    if (result.isError) {
      return materializePresentation({ isError: true, error: result.error, ...presentation });
    }
    const detached = materializePresentation({
      isError: false,
      ...presentation,
      ...result.concludesTurn === true ? { concludesTurn: true } : {}
    });
    return deepFreeze({ ...detached, value: result.value });
  }
};
function projectionError(toolName, projector, error) {
  return new ToolOutputError(toolName, [`output.${projector} failed: ${toolErrorMessage(error)}`]);
}
function snapshotProjection(toolName, projector, candidate) {
  try {
    const detached = snapshotJsonValue(candidate);
    if (detached === void 0) {
      throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
    }
    return detached;
  } catch (error) {
    if (error instanceof ToolOutputError) throw error;
    throw projectionError(toolName, projector, error);
  }
}
function snapshotToolValue(toolName, candidate) {
  try {
    const detached = snapshotJsonValue(candidate);
    if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
    return detached;
  } catch (error) {
    if (error instanceof ToolOutputError) throw error;
    throw new ToolOutputError(toolName, [`value snapshot failed: ${toolErrorMessage(error)}`]);
  }
}
function toolErrorMessage(error) {
  try {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
    return String(error);
  } catch {
    return "<unprintable thrown value>";
  }
}
function failureMessageFromContent(content) {
  const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
  return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
function materializePresentation(candidate) {
  const detached = snapshotJsonValue(candidate);
  if (detached === void 0) {
    throw new TypeError("tool result must be losslessly JSON-serializable");
  }
  return deepFreeze(detached);
}
function errorInfo(error) {
  try {
    return error instanceof HarnessError ? { name: error.name, code: error.code } : void 0;
  } catch {
    return void 0;
  }
}
function createExecutionToken() {
  return /* @__PURE__ */ Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
  const info = errorInfo(error);
  const message = toolErrorMessage(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
    error: { message, ...info ? { info } : {} }
  };
}
function isAborted(signal) {
  return signal.aborted;
}
function fuseToolSignals(caller, wrapper) {
  if (caller === wrapper) return { signal: caller, dispose() {
  } };
  const controller = new AbortController();
  let listening = false;
  const dispose = () => {
    if (!listening) return;
    listening = false;
    caller.removeEventListener("abort", abortFromCaller);
    wrapper.removeEventListener("abort", abortFromWrapper);
  };
  const abortFrom = (source) => {
    const reason = source.reason;
    controller.abort(reason);
    dispose();
  };
  const abortFromCaller = () => {
    abortFrom(caller);
  };
  const abortFromWrapper = () => {
    abortFrom(wrapper);
  };
  if (wrapper.aborted) abortFromWrapper();
  else if (caller.aborted) abortFromCaller();
  else {
    listening = true;
    caller.addEventListener("abort", abortFromCaller, { once: true });
    wrapper.addEventListener("abort", abortFromWrapper, { once: true });
  }
  return { signal: controller.signal, dispose };
}
function toolAbortedResult(prior) {
  const additionalContexts = prior?.additionalContexts ?? [];
  return {
    content: [{ type: "text", text: "Error: tool call aborted" }],
    isError: true,
    error: {
      message: "tool call aborted",
      info: { name: "AbortError", code: TOOL_ABORTED }
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {}
  };
}
function toolAbortedBeforeDispatchResult(prior) {
  const additionalContexts = prior?.additionalContexts ?? [];
  return {
    content: [{ type: "text", text: "Error: tool call aborted before dispatch" }],
    isError: true,
    error: {
      message: "tool call aborted before dispatch",
      info: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH }
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {}
  };
}

// third_party/dsh-tools/packages/core/tool-executor-native/src/index.ts
var NativeToolExecutor = class {
  constructor(ctx2, maxParallel = () => 10) {
    this.maxParallel = maxParallel;
    this.pipeline = new ToolExecutionPipeline(ctx2);
  }
  maxParallel;
  pipeline;
  describe(tools) {
    return { schemas: tools.map((definition) => projectToolSchema(definition, false)) };
  }
  execute(input2) {
    return executeToolBatch(input2, this.pipeline, this.maxParallel);
  }
};
var name = "native-tool-executor";
var inject = ["tools"];
function apply(ctx2) {
  ctx2.tools.setExecutor(new NativeToolExecutor(ctx2));
}

// third_party/dsh-tools/packages/shell/tool-pwsh/src/index.ts
var src_exports2 = {};
__export(src_exports2, {
  Config: () => Config,
  apply: () => apply2,
  inject: () => inject2,
  name: () => name2
});
import { isAbsolute as isAbsolute4, resolve as resolvePath } from "node:path";
import z2 from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/sandbox/sandbox/src/locales.ts
var en = {
  escalation: (mode, justification) => `Allow this operation with ${mode} permissions: ${justification}`
};
var zh = {
  escalation: (mode, justification) => `\u5141\u8BB8\u672C\u6B21\u64CD\u4F5C\u4F7F\u7528 ${mode} \u6743\u9650\uFF1A${justification}`
};
var ja = {
  escalation: (mode, justification) => `${mode} \u6A29\u9650\u3067\u3053\u306E\u64CD\u4F5C\u3092\u8A31\u53EF\u3057\u307E\u3059\uFF1A${justification}`
};
var es = {
  escalation: (mode, justification) => `Permitir esta operaci\xF3n con permisos ${mode}: ${justification}`
};
var fr = {
  escalation: (mode, justification) => `Autoriser cette op\xE9ration avec les permissions ${mode} : ${justification}`
};
var de = {
  escalation: (mode, justification) => `Diesen Vorgang mit ${mode}-Berechtigungen zulassen: ${justification}`
};
var ru = {
  escalation: (mode, justification) => `\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u044D\u0442\u0443 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E \u0441 \u043F\u0440\u0430\u0432\u0430\u043C\u0438 ${mode}: ${justification}`
};
var pt = {
  escalation: (mode, justification) => `Permitir esta opera\xE7\xE3o com permiss\xF5es ${mode}: ${justification}`
};
function escalationDisplayReason(mode, justification) {
  return {
    en: en.escalation(mode, justification),
    zh: zh.escalation(mode, justification),
    ja: ja.escalation(mode, justification),
    es: es.escalation(mode, justification),
    fr: fr.escalation(mode, justification),
    de: de.escalation(mode, justification),
    ru: ru.escalation(mode, justification),
    pt: pt.escalation(mode, justification)
  };
}

// third_party/dsh-tools/packages/sandbox/sandbox/src/escalation.ts
var WIDER_MODES = {
  "read-only": ["workspace-write", "danger-full-access"],
  "workspace-write": ["danger-full-access"]
};
var ESCALATION_TARGETS = ["workspace-write", "danger-full-access"];
function validateEscalationArgs(sandboxPermissions, justification) {
  if (sandboxPermissions !== void 0 && justification === void 0) {
    throw new Error("invalid escalation: sandbox_permissions requires a justification");
  }
  if (justification !== void 0 && sandboxPermissions === void 0) {
    throw new Error("invalid escalation: justification is only valid together with sandbox_permissions");
  }
  if (justification !== void 0 && justification.trim().length === 0) {
    throw new Error("invalid justification: expected a non-empty sentence");
  }
}
function sandboxDenialMarker(mode) {
  return `[sandbox: file access denied under ${mode} mode]`;
}
function escalationHintMarker(subject) {
  return `[sandbox: escalation available \u2014 retry this exact ${subject} once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`;
}
function sandboxPermissionsDescription(subject) {
  return `The narrowest wider sandbox mode for a one-shot retry of the exact ${subject} the sandbox just denied; the retry asks the user for approval.`;
}
async function approveEscalation(request2, approval) {
  const { requestedMode: mode, effectiveMode, justification, subject } = request2;
  if (mode === effectiveMode) return effectiveMode;
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) {
    throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`);
  }
  if (approval.approver === void 0) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`);
  }
  if (approval.agent === void 0) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`);
  }
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: `escalate sandbox to ${mode}: ${justification}`,
    displayReason: escalationDisplayReason(mode, justification),
    ...approval.signal ? { signal: approval.signal } : {}
  });
  switch (outcome) {
    // The schema enum already pinned `mode` to the closed target vocabulary;
    // the check above proved it is strictly wider.
    case "allowed-once":
      return mode;
    case "rejected":
      throw new Error(`the user rejected escalating this ${subject} to "${mode}"; it stays denied, so stop and explain instead of working around it`);
    case "cancelled":
      throw new Error(`approval for escalating to "${mode}" was cancelled`);
    case "unavailable":
      throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`);
    default:
      return assertNever(outcome, "EscalationOutcome");
  }
}

// third_party/dsh-tools/packages/sandbox/sandbox/src/diagnostics.ts
import { accessSync as accessSync2, constants as constants3, statSync as statSync4 } from "node:fs";
var EXECUTABLE_SPAWN_CODES = /* @__PURE__ */ new Set(["EACCES", "ENOENT"]);
function isUsableWorkdir(path) {
  try {
    if (!statSync4(path).isDirectory()) return false;
    accessSync2(path, constants3.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isRunnerSpawnFailure(error, runnerProgram, workdir) {
  if (runnerProgram === void 0 || !isUsableWorkdir(workdir)) return false;
  if (typeof error !== "object" || error === null) return false;
  const { code, path, syscall } = error;
  if (typeof code !== "string" || !EXECUTABLE_SPAWN_CODES.has(code)) return false;
  if (typeof syscall !== "string") return false;
  const exactSyscall = `spawn ${runnerProgram}`;
  if (path === void 0) return syscall === exactSyscall;
  if (typeof path !== "string" || path.length === 0 || path !== runnerProgram) return false;
  return syscall === "spawn" || syscall === exactSyscall;
}
function classifyRunnerFailure(exitCode, stderr, rules) {
  if (exitCode === null || exitCode === 0) return void 0;
  const lines = stderr.split(/\r?\n/);
  for (const rule of rules) {
    if (rule.allowedExitCodes !== void 0 && !rule.allowedExitCodes.includes(exitCode)) continue;
    const informationalLines = new Set((rule.informationalLines ?? []).map((line) => line.toLowerCase()));
    const fatalSignatures = rule.fatalSignatures.filter((signature) => signature.trim().length > 0).map((signature) => signature.toLowerCase());
    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (informationalLines.has(lowered)) continue;
      if (fatalSignatures.some((signature) => lowered.includes(signature))) return { detail: line };
    }
  }
  return void 0;
}
function matchesSignature(exitCode, stderr, signatures) {
  if (exitCode === null || exitCode === 0) return false;
  const lowered = stderr.toLowerCase();
  return signatures.some((signature) => lowered.includes(signature.toLowerCase()));
}

// third_party/dsh-tools/packages/sandbox/sandbox/src/index.ts
var SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";
var SandboxUnavailableError = class extends HarnessError {
  constructor(mode, detail) {
    super(
      `sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) \u2014 otherwise switch the consumer to danger-full-access.` + (detail === void 0 ? "" : ` Runner failure: ${detail}`),
      SANDBOX_UNAVAILABLE
    );
    this.name = "SandboxUnavailableError";
  }
};

// third_party/dsh-tools/packages/shell/shell/src/render.ts
function parseExitStatus(text) {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text);
  if (signal?.[1] !== void 0) return { body: text.slice(0, signal.index), signal: signal[1] };
  const exit = /\n\[exit code: (\d+)\]$/.exec(text);
  if (exit?.[1] !== void 0) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) };
  return { body: text, exitCode: 0 };
}

// third_party/dsh-tools/packages/shell/shell/src/index.ts
var ShellExecutor = class extends cordis_exports.Service {
  constructor(ctx2) {
    super(ctx2, "shell");
  }
  /**
   * The sandbox mode this executor applies by default, or `undefined` when it
   * does not sandbox commands.
   * @returns the configured default sandbox mode, when supported.
   */
  get sandboxMode() {
    return void 0;
  }
};

// third_party/dsh-tools/packages/shell/tool-pwsh/src/background.ts
function sandboxNotes(sandbox, escalationModes) {
  if (sandbox?.runnerFailed) {
    return [`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`];
  }
  if (sandbox?.denied) {
    const notes = [sandboxDenialMarker(sandbox.mode)];
    if (escalationModes.length > 0) notes.push(escalationHintMarker("command"));
    return notes;
  }
  return [];
}
function processOutcome(proc, escalationModes = []) {
  const base = proc.status === "killed" ? { status: "killed", detail: proc.signal !== null ? `signal: ${proc.signal}` : "killed before exit" } : { status: "completed", detail: `exit code: ${proc.exitCode ?? 0}` };
  const notes = sandboxNotes(proc.sandbox, escalationModes);
  return notes.length === 0 ? base : { ...base, detail: `${base.detail}; ${notes.join(" ")}` };
}
function processSources(proc) {
  const source = (channel) => ({
    channel,
    read: (fromByte) => {
      const live = proc();
      return live === void 0 ? { text: "", nextOffset: fromByte, lossy: false } : live.observed[channel].readFrom(fromByte);
    }
  });
  return [source("stdout"), source("stderr")];
}
function ringDelta(chunks) {
  const out = chunks.filter((chunk) => chunk.channel !== "stderr").map((chunk) => chunk.text).join("");
  const err = chunks.filter((chunk) => chunk.channel === "stderr").map((chunk) => chunk.text).join("");
  const separator = out.length > 0 && !out.endsWith("\n") ? "\n" : "";
  return out + (err.length > 0 ? `${separator}[stderr]
${err}` : "");
}
function processJob(start, outcome) {
  const controller = new AbortController();
  let process2;
  const done = (async () => {
    try {
      process2 = await start(controller.signal);
      try {
        if (controller.signal.aborted) process2.kill();
      } finally {
        await process2.done;
      }
      return outcome(process2);
    } catch (error) {
      return {
        status: controller.signal.aborted && process2 === void 0 ? "killed" : "failed",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  })();
  return {
    cancel: (reason) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
      process2?.kill();
    },
    done
  };
}

// third_party/dsh-tools/packages/shell/tool-pwsh/src/render.ts
function streamText(output) {
  if (!output.truncated) return output.text;
  return `${output.text}
[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]`;
}
function renderPwshResult(result, escalationModes = []) {
  const out = streamText(result.stdout);
  const err = streamText(result.stderr);
  let body = out;
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[stderr]
${err}`;
  }
  if (body.length === 0) body = "(no output)";
  const markers = [];
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode));
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker("command"));
    }
  }
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
  if (result.stopped !== void 0) markers.push(`[stopped: ${result.stopped}]`);
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`);
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`);
  }
  if (markers.length === 0) return body;
  if (!body.endsWith("\n")) body += "\n";
  return body + markers.join("\n");
}
function renderPwshPromoted(promoted) {
  const body = promoted.output.length > 0 ? promoted.output.endsWith("\n") ? promoted.output : `${promoted.output}
` : "";
  return `${body}[still running after ${promoted.timeoutMs}ms; moved to background job ${promoted.jobId}]`;
}
function renderPwshJobRead(delta, lossy, spillPaths, sandbox, escalationModes = []) {
  const notices = [];
  if (lossy) {
    notices.push(`[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(", ") : "(unavailable)"}]`);
  }
  if (sandbox?.runnerFailed) {
    notices.push(`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`);
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode));
    if (escalationModes.length > 0) {
      notices.push(escalationHintMarker("command"));
    }
  }
  if (notices.length === 0) return delta;
  return `${delta}${delta.length > 0 && !delta.endsWith("\n") ? "\n" : ""}${notices.join("\n")}`;
}

// third_party/dsh-tools/packages/shell/tool-pwsh/src/index.ts
var name2 = "tool-pwsh";
var inject2 = ["tools", "shell", "systemPrompt", "shellEnv", "workingDirectory"];
var Config = z2.object({
  enableRunInBackground: z2.boolean().default(true),
  promoteOnTimeout: z2.boolean().default(true)
});
function validatePwshArgs(args) {
  if (args.command.trim().length === 0) {
    throw new Error("invalid command: expected a non-empty string");
  }
  if (args.description.trim().length === 0) {
    throw new Error("invalid description: expected a non-empty string");
  }
  if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`);
  }
  validateEscalationArgs(args.sandbox_permissions, args.justification);
}
function pwshDescription(windowsSandbox) {
  const base = "Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. Each call runs in a fresh pwsh process; pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\\...`); read environment variables with `$env:NAME`. Managed `$env:DSH_*` variables expose current harness environment facts. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. On Windows a force-killed command settles as `[exit code: 1]` without a signal marker \u2014 treat it as an interruption, not a command failure. Provide `description` before `command` in the arguments. Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked. Do not assign to automatic variables such as `$HOME`; variable names are case-insensitive, so `$home` is the same read-only variable. Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.";
  if (!windowsSandbox) return base;
  return base + " Under the Windows sandbox, read-only pwsh runs in PowerShell ConstrainedLanguage mode, while workspace-write stays in FullLanguage unless host policy says otherwise. In read-only, prefer cmdlets and core types (`[string]`, `[datetime]`, `[regex]`, `[guid]`); .NET static calls (`[System.IO.*]::`, `[math]::`), `Add-Type`, COM objects, and reflection fail with \"only core types\" errors. `-f` formatting, property access, and core cmdlets work. In both confined modes, programs cannot open named pipes, so a command that captures another program's output through piped stdio (Node.js `child_process.spawn`/`exec` with the default `stdio: 'pipe'`) fails with EPERM, while `stdio: 'inherit'` and `stdio: 'ignore'` spawns work and PowerShell's own pipelines are unaffected. That EPERM is the documented boundary: do not retry the command another way \u2014 escalate the exact command once or restructure it to avoid capturing output.";
}
function resolveWorkdir(modelWorkdir, sessionCwd) {
  if (modelWorkdir === void 0) return sessionCwd;
  if (sessionCwd !== void 0 && !isAbsolute4(modelWorkdir)) {
    return resolvePath(sessionCwd, modelWorkdir);
  }
  return modelWorkdir;
}
function canonicalPwshResult(result, cwd) {
  const output = (stream) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== void 0 ? { spillPath: stream.spillPath } : {}
  });
  return {
    cwd,
    kind: "foreground",
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    /* jscpd:ignore-start -- the canonical projection and background-handle shape mirror dsh-tool-bash's by design (Agent Note). */
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== void 0 ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== void 0 ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== void 0 ? { runnerFailed: result.sandbox.runnerFailed } : {}
      }
    } : {}
  };
}
function toolAborted() {
  const error = new HarnessError("tool call aborted", TOOL_ABORTED);
  error.name = "AbortError";
  return error;
}
var BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: "string", required: true, const: "background" },
  jobId: { type: "string", required: true },
  cwd: { type: "string", required: true }
};
function apply2(ctx2, config = {}) {
  const backgroundEnabled = config.enableRunInBackground ?? true;
  const promoteOnTimeout = (config.promoteOnTimeout ?? true) && backgroundEnabled;
  const defaultMode = ctx2.shell.sandboxMode;
  const escalationModes = defaultMode === void 0 ? [] : ESCALATION_TARGETS;
  const sandboxPolicy = defaultMode === void 0 ? void 0 : ctx2.get("sandboxPolicy");
  if (defaultMode !== void 0 && sandboxPolicy === void 0) {
    throw new Error("tool-pwsh: the mounted bash executor confines but ctx.sandboxPolicy is missing");
  }
  const resolveSandboxPolicy = (exec) => sandboxPolicy?.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
  const approvePwshEscalation = (mode, justification, exec, standingPolicy) => {
    if (escalationModes.length === 0) {
      throw new Error("sandbox_permissions is not available in this composition (no sandboxing executor to escalate)");
    }
    const effectiveMode = standingPolicy.mode;
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: "command" },
      {
        approver: ctx2.get("approval"),
        agent: exec.agent,
        callId: exec.callId,
        toolName: "pwsh",
        signal: exec.signal
      }
    );
  };
  ctx2.systemPrompt.section({
    name: "tool:pwsh",
    order: ctx2.systemPrompt.getSectionOrder("TOOL_PWSH"),
    text: "Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure."
  });
  const pwshTool = (jobs) => {
    const background = jobs !== void 0;
    const promote = background && promoteOnTimeout;
    const startJob = (registry, args, exec, spec) => {
      let proc;
      let stopped;
      const id = registry.start({
        kind: "pwsh",
        label: args.command,
        toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
        ...exec.agent ? { owner: exec.agent.id } : {},
        output: processSources(() => proc),
        run: () => {
          const hooks = processJob(
            async (signal) => {
              proc = await ctx2.shell.execute({ ...spec, signal });
              return proc;
            },
            (started) => processOutcome(started, escalationModes)
          );
          return {
            done: hooks.done,
            // A kill from outside this call (the human's, a parallel job_kill)
            // reaches the process here; its reason is what the model reads.
            cancel: (reason) => {
              stopped = reason;
              hooks.cancel(reason);
            }
          };
        }
      });
      return { id, process: () => proc, stopped: () => stopped };
    };
    const waitOnJob = async (registry, attached, exec, spec) => {
      const owner = exec.agent?.id;
      const timeoutMs = spec.timeoutMs;
      const stop2 = async (reason) => {
        registry.kill(attached.id, owner, reason);
        const settled2 = await registry.wait(attached.id, timeoutMs, owner);
        if (settled2.status !== "running" && settled2.status !== "stopping") registry.remove(attached.id, owner);
        return settled2;
      };
      let view;
      try {
        view = await registry.wait(attached.id, timeoutMs, owner, exec.signal);
      } catch {
        await stop2("tool call aborted");
        throw toolAborted();
      }
      if ((view.status === "running" || view.status === "stopping") && attached.process() === void 0) {
        await stop2("timed out during preparation");
        return {
          kind: "foreground",
          cwd: spec.workdir,
          exitCode: null,
          signal: null,
          timedOut: true,
          aborted: false,
          timeoutMs,
          stdout: { text: "", truncated: false },
          stderr: { text: "", truncated: false },
          ...spec.sandboxPolicy !== void 0 ? { sandbox: { mode: spec.sandboxPolicy.mode, denied: false } } : {}
        };
      }
      if (view.status === "running" || view.status === "stopping") {
        const read = registry.read(attached.id, owner);
        return {
          kind: "promoted",
          cwd: spec.workdir,
          jobId: attached.id,
          timeoutMs,
          output: renderPwshJobRead(
            ringDelta(read.chunks),
            read.lossy,
            read.job.output.spillPaths ?? [],
            attached.process()?.sandbox,
            escalationModes
          )
        };
      }
      registry.remove(attached.id, owner);
      const process2 = attached.process();
      if (process2 === void 0) throw new Error(view.detail);
      const result = await process2.result();
      const stopped = attached.stopped();
      return { ...canonicalPwshResult(result, spec.workdir), ...stopped !== void 0 ? { stopped } : {} };
    };
    return defineTool({
      name: "pwsh",
      description: pwshDescription(escalationModes.length > 0),
      /* jscpd:ignore-start -- deliberate mirror of dsh-tool-bash's parameter surface (pwsh-tool-and-executor Agent Note). */
      parameters: {
        description: {
          type: "string",
          required: true,
          description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" \u2192 "List files in current directory"; "git status" \u2192 "Show working tree status"; "Get-Process" \u2192 "List running processes".'
        },
        command: { type: "string", required: true, description: "The PowerShell command to execute." },
        timeoutMs: {
          type: "number",
          description: promote ? "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed." : "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
        },
        workdir: { type: "string", description: "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it." },
        ...background ? {
          run_in_background: { type: "boolean", description: "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies." }
        } : {},
        ...escalationModes.length > 0 ? {
          sandbox_permissions: {
            type: "string",
            enum: [...escalationModes],
            description: sandboxPermissionsDescription("command")
          },
          justification: {
            type: "string",
            description: "Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access. Use the language of the user\u2019s current request."
          }
        } : {}
      },
      /* jscpd:ignore-end */
      output: {
        // The foreground result wire shape mirrors dsh-tool-bash's by contract —
        // consumers of one must accept the other (see the pwsh-tool-and-executor
        // Agent Note).
        /* jscpd:ignore-start -- deliberate result-schema symmetry with dsh-tool-bash. */
        schema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: BACKGROUND_OUTPUT_PROPERTIES
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "promoted" },
                cwd: { type: "string", required: true },
                jobId: { type: "string", required: true },
                timeoutMs: { type: "number", required: true },
                output: { type: "string", required: true }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "foreground" },
                cwd: { type: "string", required: true },
                exitCode: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
                signal: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
                timedOut: { type: "boolean", required: true },
                aborted: { type: "boolean", required: true },
                stopped: { type: "string" },
                timeoutMs: { type: "number", required: true },
                stdout: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                stderr: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                sandbox: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    mode: { type: "string", required: true },
                    denied: { type: "boolean", required: true },
                    enforcement: { type: "string" },
                    runnerFailed: { type: "boolean" }
                  }
                }
              }
            }
          ]
        },
        /* jscpd:ignore-end */
        render: (_args, value) => [{
          type: "text",
          text: value.kind === "background" ? `started background job ${value.jobId}` : value.kind === "promoted" ? renderPwshPromoted(value) : renderPwshResult(value, escalationModes)
        }],
        presentationMeta: (_args, value) => ({ cwd: value.cwd })
      },
      /* jscpd:ignore-start -- the execute path mirrors dsh-tool-bash's by design (see the pwsh-tool-and-executor Agent Note). */
      async execute(args, exec) {
        validatePwshArgs(args);
        const standingPolicy = resolveSandboxPolicy(exec);
        const approvedMode = args.sandbox_permissions !== void 0 && args.justification !== void 0 ? await approvePwshEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy) : void 0;
        const policy = approvedMode === void 0 ? standingPolicy : { ...standingPolicy, mode: approvedMode };
        const cwd = exec.agent === void 0 ? void 0 : await ctx2.workingDirectory.ensure(exec.agent, exec.signal);
        const workdir = resolveWorkdir(args.workdir, cwd);
        const request2 = {
          command: args.command,
          ...workdir !== void 0 ? { workdir } : {},
          ...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {},
          dshEnv: ctx2.shellEnv.collect(exec),
          ...policy !== void 0 ? { sandboxPolicy: policy } : {}
        };
        if (args.run_in_background === true) {
          if (!backgroundEnabled) {
            throw new Error("run_in_background is disabled for this deployment (enableRunInBackground: false)");
          }
          if (jobs === void 0) {
            throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
          }
          if (exec.signal.aborted) throw toolAborted();
          const spec2 = ctx2.shell.resolve({ ...request2, onExpiry: "none" });
          return { kind: "background", jobId: startJob(jobs, args, exec, spec2).id, cwd: spec2.workdir };
        }
        if (jobs !== void 0 && promote) {
          const spec2 = ctx2.shell.resolve({ ...request2, onExpiry: "none" });
          let attached;
          try {
            attached = startJob(jobs, args, exec, spec2);
          } catch (error) {
            ctx2.logger.warn(`pwsh: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`);
          }
          if (attached !== void 0) return waitOnJob(jobs, attached, exec, spec2);
        }
        const spec = ctx2.shell.resolve({ ...request2, signal: exec.signal });
        const foreground = await ctx2.shell.execute(spec);
        const result = await foreground.result();
        if (result.aborted) throw toolAborted();
        return canonicalPwshResult(result, spec.workdir);
      },
      /* jscpd:ignore-end */
      /* jscpd:ignore-start -- the background call card mirrors presentBashCall's by design (Agent Note). */
      presentCall: (args) => {
        if (args.run_in_background === true) {
          return {
            card: "generic",
            title: args.command,
            kind: "execute",
            rawInput: args.command,
            content: [{ type: "text", text: args.description }]
          };
        }
        return {
          card: "terminal",
          title: args.command,
          description: args.description,
          ...args.workdir !== void 0 ? { cwd: args.workdir } : {}
        };
      },
      /* jscpd:ignore-end */
      /* jscpd:ignore-start -- the completed-result presentation mirrors presentBashResult's by design (Agent Note). */
      presentResult: (args, result) => {
        const block = result.content.length === 1 ? result.content[0] : void 0;
        if (block === void 0 || block.type !== "text") return void 0;
        const raw = block.text;
        const isBackground = typeof args === "object" && args !== null && args.run_in_background === true;
        const isPromoted = result.value?.kind === "promoted";
        if (isBackground || isPromoted || result.isError) {
          return { card: "generic", content: [{ type: "text", text: `\`\`\`console
${raw.replace(/\n+$/, "")}
\`\`\`` }] };
        }
        const { body, ...exit } = parseExitStatus(raw);
        return { card: "terminal", output: body, ...exit };
      }
      /* jscpd:ignore-end */
    });
  };
  if (!backgroundEnabled) {
    ctx2.tools.register(pwshTool(void 0));
    return;
  }
  let foregroundOnly = ctx2.get("jobs") === void 0 ? ctx2.tools.register(pwshTool(void 0)) : void 0;
  ctx2.inject(["jobs"], (jobCtx) => {
    foregroundOnly?.();
    foregroundOnly = void 0;
    const unregister = ctx2.tools.register(pwshTool(jobCtx.jobs));
    jobCtx.effect(() => () => {
      unregister();
      if (ctx2.fiber.state === 2 /* ACTIVE */) foregroundOnly = ctx2.tools.register(pwshTool(void 0));
    });
  });
}

// third_party/dsh-tools/packages/shell/tool-bash/src/index.ts
var src_exports3 = {};
__export(src_exports3, {
  Config: () => Config2,
  apply: () => apply3,
  inject: () => inject3,
  name: () => name3
});
import z3 from "@deepseek-ai/schemastery";
import { isAbsolute as isAbsolute5, sep } from "node:path";

// third_party/dsh-tools/packages/shell/tool-bash/src/background.ts
function sandboxNotes2(sandbox, escalationModes) {
  if (sandbox?.runnerFailed) {
    return [`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`];
  }
  if (sandbox?.denied) {
    const notes = [sandboxDenialMarker(sandbox.mode)];
    if (escalationModes.length > 0) notes.push(escalationHintMarker("command"));
    return notes;
  }
  return [];
}
function processOutcome2(proc, escalationModes = []) {
  const base = proc.status === "killed" ? { status: "killed", detail: proc.signal !== null ? `signal: ${proc.signal}` : "killed before exit" } : { status: "completed", detail: `exit code: ${proc.exitCode ?? 0}` };
  const notes = sandboxNotes2(proc.sandbox, escalationModes);
  return notes.length === 0 ? base : { ...base, detail: `${base.detail}; ${notes.join(" ")}` };
}
function processSources2(proc) {
  const source = (channel) => ({
    channel,
    read: (fromByte) => {
      const live = proc();
      return live === void 0 ? { text: "", nextOffset: fromByte, lossy: false } : live.observed[channel].readFrom(fromByte);
    }
  });
  return [source("stdout"), source("stderr")];
}
function ringDelta2(chunks) {
  const out = chunks.filter((chunk) => chunk.channel !== "stderr").map((chunk) => chunk.text).join("");
  const err = chunks.filter((chunk) => chunk.channel === "stderr").map((chunk) => chunk.text).join("");
  const separator = out.length > 0 && !out.endsWith("\n") ? "\n" : "";
  return out + (err.length > 0 ? `${separator}[stderr]
${err}` : "");
}
function processJob2(start, outcome) {
  const controller = new AbortController();
  let process2;
  const done = (async () => {
    try {
      process2 = await start(controller.signal);
      try {
        if (controller.signal.aborted) process2.kill();
      } finally {
        await process2.done;
      }
      return outcome(process2);
    } catch (error) {
      return {
        status: controller.signal.aborted && process2 === void 0 ? "killed" : "failed",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  })();
  return {
    cancel: (reason) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
      process2?.kill();
    },
    done
  };
}

// third_party/dsh-tools/packages/shell/tool-bash/src/render.ts
function streamText2(output) {
  if (!output.truncated) return output.text;
  return `${output.text}
[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]`;
}
function renderResult(result, escalationModes = []) {
  const out = streamText2(result.stdout);
  const err = streamText2(result.stderr);
  let body = out;
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[stderr]
${err}`;
  }
  if (body.length === 0) body = "(no output)";
  const markers = [];
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode));
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker("command"));
    }
  }
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
  if (result.stopped !== void 0) markers.push(`[stopped: ${result.stopped}]`);
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`);
  } else if (result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`);
  }
  if (markers.length === 0) return body;
  if (!body.endsWith("\n")) body += "\n";
  return body + markers.join("\n");
}
function renderPromoted(promoted) {
  const body = promoted.output.length > 0 ? promoted.output.endsWith("\n") ? promoted.output : `${promoted.output}
` : "";
  return `${body}[still running after ${promoted.timeoutMs}ms; moved to background job ${promoted.jobId}]`;
}
function renderJobRead(delta, lossy, spillPaths, sandbox, escalationModes = []) {
  const notices = [];
  if (lossy) {
    notices.push(`[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(", ") : "(unavailable)"}]`);
  }
  if (sandbox?.runnerFailed) {
    notices.push(`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`);
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode));
    if (escalationModes.length > 0) {
      notices.push(escalationHintMarker("command"));
    }
  }
  if (notices.length === 0) return delta;
  return `${delta}${delta.length > 0 && !delta.endsWith("\n") ? "\n" : ""}${notices.join("\n")}`;
}

// third_party/dsh-tools/packages/shell/tool-bash/src/index.ts
var name3 = "tool-bash";
var inject3 = ["tools", "shell", "systemPrompt", "shellEnv", "workingDirectory"];
var Config2 = z3.object({
  enableRunInBackground: z3.boolean().default(true),
  promoteOnTimeout: z3.boolean().default(true)
});
function validateBashArgs(args, effectiveMode) {
  if (args.command.trim().length === 0) {
    throw new Error("invalid command: expected a non-empty string");
  }
  if (args.description.trim().length === 0) {
    throw new Error("invalid description: expected a non-empty string");
  }
  if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`);
  }
  if (args.sandbox_permissions !== void 0 && args.sandbox_permissions === effectiveMode) return;
  const justification = args.sandbox_permissions === void 0 && args.justification?.trim() === "" ? void 0 : args.justification;
  validateEscalationArgs(args.sandbox_permissions, justification);
}
function bashDescription() {
  return `Execute a bash command (\`bash -c\`) and return its stdout/stderr. Each call runs in a fresh shell; pass \`workdir\` instead of using \`cd\`. Managed \`$${DSH_ENV_PREFIX}*\` variables expose current harness environment facts. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. Provide \`description\` before \`command\` in the arguments. Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked. An unset variable expands to an empty string, so guard variables in such paths with \`\${VAR:?}\`. Commands may run under a file sandbox; a blocked file operation is reported as \`[sandbox: file access denied under <mode> mode]\`, a policy denial: do not retry another way.`;
}
function presentBashCall(args) {
  if (args.run_in_background === true) {
    return {
      card: "generic",
      title: args.command,
      kind: "execute",
      rawInput: args.command,
      content: [{ type: "text", text: args.description }]
    };
  }
  return {
    card: "terminal",
    title: args.command,
    description: args.description,
    ...args.workdir !== void 0 ? { cwd: args.workdir } : {}
  };
}
function presentBashResult(args, result) {
  const block = result.content.length === 1 ? result.content[0] : void 0;
  if (block === void 0 || block.type !== "text") return void 0;
  const raw = block.text;
  const isBackground = typeof args === "object" && args !== null && args.run_in_background === true;
  const isPromoted = result.value?.kind === "promoted";
  if (isBackground || isPromoted || result.isError) {
    return { card: "generic", content: [{ type: "text", text: `\`\`\`console
${raw.replace(/\n+$/, "")}
\`\`\`` }] };
  }
  const { body, ...exit } = parseExitStatus(raw);
  return { card: "terminal", output: body, ...exit };
}
function resolveWorkdir2(modelWorkdir, sessionCwd) {
  if (modelWorkdir === void 0) return sessionCwd;
  if (sessionCwd !== void 0 && !isAbsolute5(modelWorkdir)) {
    return `${sessionCwd}${sep}${modelWorkdir}`;
  }
  return modelWorkdir;
}
function canonicalBashResult(result, cwd) {
  const output = (stream) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== void 0 ? { spillPath: stream.spillPath } : {}
  });
  return {
    cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== void 0 ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== void 0 ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== void 0 ? { runnerFailed: result.sandbox.runnerFailed } : {}
      }
    } : {}
  };
}
function toolAborted2() {
  const error = new HarnessError("tool call aborted", TOOL_ABORTED);
  error.name = "AbortError";
  return error;
}
var BACKGROUND_OUTPUT_PROPERTIES2 = {
  kind: { type: "string", required: true, const: "background" },
  jobId: { type: "string", required: true },
  cwd: { type: "string", required: true }
};
function apply3(ctx2, config = {}) {
  const backgroundEnabled = config.enableRunInBackground ?? true;
  const promoteOnTimeout = (config.promoteOnTimeout ?? true) && backgroundEnabled;
  const defaultMode = ctx2.shell.sandboxMode;
  const escalationModes = defaultMode === void 0 ? [] : ESCALATION_TARGETS;
  const sandboxPolicy = defaultMode === void 0 ? void 0 : ctx2.get("sandboxPolicy");
  if (defaultMode !== void 0 && sandboxPolicy === void 0) {
    throw new Error("tool-bash: the mounted bash executor confines but ctx.sandboxPolicy is missing");
  }
  const resolveSandboxPolicy = (exec) => sandboxPolicy?.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
  const approveBashEscalation = (mode, justification, exec, standingPolicy) => {
    if (escalationModes.length === 0) {
      throw new Error("sandbox_permissions is not available in this composition (no sandboxing executor to escalate)");
    }
    const effectiveMode = standingPolicy.mode;
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: "command" },
      {
        approver: ctx2.get("approval"),
        agent: exec.agent,
        callId: exec.callId,
        toolName: "bash",
        signal: exec.signal
      }
    );
  };
  ctx2.systemPrompt.section({
    name: "tool:bash",
    order: ctx2.systemPrompt.getSectionOrder("TOOL_BASH"),
    text: "Check the [exit code: N] marker on every bash result; investigate failures before moving on."
  });
  const bashTool = (jobs) => {
    const background = jobs !== void 0;
    const promote = background && promoteOnTimeout;
    const startJob = (registry, args, exec, spec) => {
      let proc;
      let stopped;
      const id = registry.start({
        kind: "bash",
        label: args.command,
        toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
        ...exec.agent ? { owner: exec.agent.id } : {},
        output: processSources2(() => proc),
        run: () => {
          const hooks = processJob2(
            async (signal) => {
              proc = await ctx2.shell.execute({ ...spec, signal });
              return proc;
            },
            (started) => processOutcome2(started, escalationModes)
          );
          return {
            done: hooks.done,
            // A kill from outside this call (the human's, a parallel job_kill)
            // reaches the process here; its reason is what the model reads.
            cancel: (reason) => {
              stopped = reason;
              hooks.cancel(reason);
            }
          };
        }
      });
      return { id, process: () => proc, stopped: () => stopped };
    };
    const waitOnJob = async (registry, attached, exec, spec) => {
      const owner = exec.agent?.id;
      const timeoutMs = spec.timeoutMs;
      const stop2 = async (reason) => {
        registry.kill(attached.id, owner, reason);
        const settled2 = await registry.wait(attached.id, timeoutMs, owner);
        if (settled2.status !== "running" && settled2.status !== "stopping") registry.remove(attached.id, owner);
        return settled2;
      };
      let view;
      try {
        view = await registry.wait(attached.id, timeoutMs, owner, exec.signal);
      } catch {
        await stop2("tool call aborted");
        throw toolAborted2();
      }
      if ((view.status === "running" || view.status === "stopping") && attached.process() === void 0) {
        await stop2("timed out during preparation");
        return {
          kind: "foreground",
          cwd: spec.workdir,
          exitCode: null,
          signal: null,
          timedOut: true,
          aborted: false,
          timeoutMs,
          stdout: { text: "", truncated: false },
          stderr: { text: "", truncated: false },
          ...spec.sandboxPolicy !== void 0 ? { sandbox: { mode: spec.sandboxPolicy.mode, denied: false } } : {}
        };
      }
      if (view.status === "running" || view.status === "stopping") {
        const read = registry.read(attached.id, owner);
        return {
          kind: "promoted",
          cwd: spec.workdir,
          jobId: attached.id,
          timeoutMs,
          output: renderJobRead(
            ringDelta2(read.chunks),
            read.lossy,
            read.job.output.spillPaths ?? [],
            attached.process()?.sandbox,
            escalationModes
          )
        };
      }
      registry.remove(attached.id, owner);
      const process2 = attached.process();
      if (process2 === void 0) throw new Error(view.detail);
      const result = await process2.result();
      const stopped = attached.stopped();
      return { kind: "foreground", ...canonicalBashResult(result, spec.workdir), ...stopped !== void 0 ? { stopped } : {} };
    };
    return defineTool({
      name: "bash",
      description: bashDescription(),
      parameters: {
        description: {
          type: "string",
          required: true,
          description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" \u2192 "List files in current directory"; "git status" \u2192 "Show working tree status"; "npm install" \u2192 "Install package dependencies".'
        },
        command: { type: "string", required: true, description: "The bash command to execute." },
        timeoutMs: {
          type: "number",
          description: promote ? "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed." : "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
        },
        workdir: { type: "string", description: "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it." },
        ...background ? {
          run_in_background: { type: "boolean", description: "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies." }
        } : {},
        ...escalationModes.length > 0 ? {
          sandbox_permissions: {
            type: "string",
            enum: [...escalationModes],
            description: sandboxPermissionsDescription("command")
          },
          justification: {
            type: "string",
            description: "Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access. Use the language of the user\u2019s current request."
          }
        } : {}
      },
      output: {
        schema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: BACKGROUND_OUTPUT_PROPERTIES2
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "promoted" },
                cwd: { type: "string", required: true },
                jobId: { type: "string", required: true },
                timeoutMs: { type: "number", required: true },
                output: { type: "string", required: true }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "foreground" },
                cwd: { type: "string", required: true },
                exitCode: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
                signal: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
                timedOut: { type: "boolean", required: true },
                aborted: { type: "boolean", required: true },
                stopped: { type: "string" },
                timeoutMs: { type: "number", required: true },
                stdout: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                stderr: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                sandbox: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    mode: { type: "string", required: true },
                    denied: { type: "boolean", required: true },
                    enforcement: { type: "string" },
                    runnerFailed: { type: "boolean" }
                  }
                }
              }
            }
          ]
        },
        render: (_args, value) => [{
          type: "text",
          text: value.kind === "background" ? `started background job ${value.jobId}` : value.kind === "promoted" ? renderPromoted(value) : renderResult(value, escalationModes)
        }],
        presentationMeta: (_args, value) => ({ cwd: value.cwd })
      },
      async execute(args, exec) {
        const standingPolicy = resolveSandboxPolicy(exec);
        validateBashArgs(args, standingPolicy?.mode);
        const approvedMode = args.sandbox_permissions !== void 0 && args.justification !== void 0 ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy) : void 0;
        const policy = approvedMode === void 0 ? standingPolicy : { ...standingPolicy, mode: approvedMode };
        const cwd = exec.agent === void 0 ? void 0 : await ctx2.workingDirectory.ensure(exec.agent, exec.signal);
        const workdir = resolveWorkdir2(args.workdir, cwd);
        const dshEnv = ctx2.shellEnv.collect(exec);
        const request2 = {
          command: args.command,
          ...workdir !== void 0 ? { workdir } : {},
          ...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {},
          dshEnv,
          ...policy !== void 0 ? { sandboxPolicy: policy } : {}
        };
        if (args.run_in_background === true) {
          if (!backgroundEnabled) {
            throw new Error("run_in_background is disabled for this deployment (enableRunInBackground: false)");
          }
          if (jobs === void 0) {
            throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
          }
          if (exec.signal.aborted) throw toolAborted2();
          const spec2 = ctx2.shell.resolve({ ...request2, onExpiry: "none" });
          return { kind: "background", jobId: startJob(jobs, args, exec, spec2).id, cwd: spec2.workdir };
        }
        if (jobs !== void 0 && promote) {
          const spec2 = ctx2.shell.resolve({ ...request2, onExpiry: "none" });
          let attached;
          try {
            attached = startJob(jobs, args, exec, spec2);
          } catch (error) {
            ctx2.logger.warn(`bash: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`);
          }
          if (attached !== void 0) return waitOnJob(jobs, attached, exec, spec2);
        }
        const spec = ctx2.shell.resolve({ ...request2, signal: exec.signal });
        const foreground = await ctx2.shell.execute(spec);
        const result = await foreground.result();
        if (result.aborted) throw toolAborted2();
        return { kind: "foreground", ...canonicalBashResult(result, spec.workdir) };
      },
      presentCall: presentBashCall,
      presentResult: presentBashResult
    });
  };
  if (!backgroundEnabled) {
    ctx2.tools.register(bashTool(void 0));
    return;
  }
  let foregroundOnly = ctx2.get("jobs") === void 0 ? ctx2.tools.register(bashTool(void 0)) : void 0;
  ctx2.inject(["jobs"], (jobCtx) => {
    foregroundOnly?.();
    foregroundOnly = void 0;
    const unregister = ctx2.tools.register(bashTool(jobCtx.jobs));
    jobCtx.effect(() => () => {
      unregister();
      if (ctx2.fiber.state === 2 /* ACTIVE */) foregroundOnly = ctx2.tools.register(bashTool(void 0));
    });
  });
}

// third_party/dsh-tools/packages/shell/pwsh-local/src/index.ts
import z4 from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/shell/pwsh-local/src/resolve.ts
import { lstatSync as lstatSync3 } from "node:fs";
import { join as join5 } from "node:path";
function candidatePwshPaths(env = process.env) {
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const candidates = [
    join5(programFiles, "PowerShell", "7", "pwsh.exe")
  ];
  for (const entry of (env.PATH ?? "").split(";")) {
    const trimmed = entry.trim().replace(/^"|"$/g, "");
    if (trimmed.length === 0) continue;
    candidates.push(join5(trimmed, "pwsh.exe"));
  }
  candidates.push(join5(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  return candidates;
}
function candidateExists(candidate) {
  try {
    const stat2 = lstatSync3(candidate);
    return stat2.isFile() || stat2.isSymbolicLink();
  } catch {
    return false;
  }
}
function resolvePwshPath(configured, env = process.env, platform = process.platform) {
  if (configured !== void 0 && configured.length > 0) return configured;
  if (platform === "win32") {
    for (const candidate of candidatePwshPaths(env)) {
      if (candidateExists(candidate)) return candidate;
    }
  }
  return "pwsh";
}

// third_party/dsh-tools/packages/shell/pwsh-local/src/index.ts
var ENV_OVERRIDES = {
  NO_COLOR: "1",
  PAGER: "cat",
  GIT_PAGER: "cat"
};
var ENCODING_PREAMBLE = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";
var DEFAULT_GRACE_MS = 3e3;
var DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;
function finalOutput(reader) {
  const read = reader.readFrom(0);
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== void 0 ? { spillPath: read.spillPath } : {}
  };
}
function assertPositiveFinite(name4, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`pwsh-local: ${name4} must be a positive finite number`);
  }
}
function assertServiceablePwshConfig(config) {
  assertPositiveFinite("timeoutMs", config.timeoutMs.get());
  assertPositiveFinite("maxTimeoutMs", config.maxTimeoutMs.get());
  assertPositiveFinite("maxOutputBytes", config.maxOutputBytes.get());
  assertPositiveFinite("maxSpillBytes", config.maxSpillBytes.get());
  assertPositiveFinite("graceMs", config.graceMs.get());
  if (config.graceMs.get() > MAX_TIMER_DELAY_MS) {
    throw new Error(`pwsh-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
  }
}
var PwshLocalExecutor = class _PwshLocalExecutor extends ShellExecutor {
  constructor(ctx2, config) {
    super(ctx2);
    this.config = config;
    this.declaredPwshPath = config.pwshPath.get();
    this.resolvedPwshPath = resolvePwshPath(this.declaredPwshPath);
  }
  config;
  static inject = ["subprocess"];
  static Config = z4.object({
    cwd: z4.string().volatile(),
    timeoutMs: z4.number().default(12e4).volatile(),
    maxTimeoutMs: z4.number().default(6e5).volatile(),
    maxOutputBytes: z4.number().default(64e3).volatile(),
    maxSpillBytes: z4.number().default(DEFAULT_MAX_SPILL_BYTES).volatile(),
    graceMs: z4.number().default(DEFAULT_GRACE_MS).volatile(),
    pwshPath: z4.string().volatile()
  });
  /** The declared executable the current {@link pwshPath} was resolved from. */
  declaredPwshPath;
  /** The pwsh executable resolved from the current config. */
  resolvedPwshPath;
  /** The pwsh executable every command runs through; a changed declared path is probed again on the next read. */
  get pwshPath() {
    const declared = this.config.pwshPath.get();
    if (declared !== this.declaredPwshPath) {
      this.resolvedPwshPath = resolvePwshPath(declared);
      this.declaredPwshPath = declared;
    }
    return this.resolvedPwshPath;
  }
  /**
   * Resolve a request into a fully-specified spec: fill `workdir` from
   * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
   * `config.timeoutMs`, capped at `config.maxTimeoutMs`.
   */
  resolve(request2) {
    assertServiceablePwshConfig(this.config);
    const timeoutMs = clampTimeout(
      request2.timeoutMs,
      this.config.timeoutMs.get(),
      this.config.maxTimeoutMs.get(),
      "pwsh-local: request.timeoutMs"
    );
    const stdoutMaxBytes = request2.stdoutMaxBytes ?? this.config.maxOutputBytes.get();
    assertPositiveFinite("request.stdoutMaxBytes", stdoutMaxBytes);
    return {
      command: request2.command,
      workdir: request2.workdir ?? this.config.cwd.get() ?? process.cwd(),
      timeoutMs,
      onExpiry: request2.onExpiry ?? "kill",
      stdoutMaxBytes,
      ...request2.signal ? { signal: request2.signal } : {},
      ...request2.stdin !== void 0 ? { stdin: request2.stdin } : {},
      ...request2.env !== void 0 ? { env: request2.env } : {},
      ...request2.dshEnv !== void 0 ? { dshEnv: request2.dshEnv } : {},
      sandboxPolicy: request2.sandboxPolicy
    };
  }
  /**
   * The pwsh invocation argv for one resolved spec — the argv-level seam a
   * confining subclass wraps through `ctx.sandbox.confine` (the pwsh twin of
   * `dsh-bash-local`'s `executeArgv` hook; see
   * `@deepseek-ai/dsh-pwsh-sandbox`).
   */
  argv(spec) {
    return [this.pwshPath, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${ENCODING_PREAMBLE}${spec.command}`];
  }
  /** Map one resolved spec plus its argv onto a fully-specified subprocess spawn. */
  spawnSpec(spec, stdoutMaxBytes, signal, argv) {
    const collect = (maxBytes) => ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes.get() } });
    return {
      argv: [...argv],
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== void 0 ? { data: spec.stdin } : "ignore",
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes.get())
      },
      graceMs: this.config.graceMs.get(),
      signal,
      env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }
    };
  }
  /** The collect-mode readers the executor itself requested (present by construction). */
  static collected(handle) {
    const { stdout, stderr } = handle.collected;
    if (stdout === void 0 || stderr === void 0) {
      throw new Error("pwsh-local: subprocess implementation dropped a requested collect stream");
    }
    return { stdout, stderr };
  }
  async execute(spec) {
    return this.executeArgv(spec, this.argv(spec));
  }
  /**
   * Execute an explicit argv with the lifecycle, environment, output,
   * deadline, and cancellation semantics of this executor. Subclasses use this
   * after replacing the public command's shell argv at an execution boundary.
   * @param spec - resolved execution settings and caller-owned command metadata.
   * @param argvOrPrepare - exact argv, or preparation using the execution cancellation signal.
   * @param onStarted - installs provider facts synchronously before the handle can settle.
   * @returns the live execution handle; spawn rejection settles the handle as
   *   killed while `result()` carries the same failure as its rejection.
   */
  async executeArgv(spec, argvOrPrepare, onStarted) {
    let spawnSignal;
    let classify;
    let disarm = () => {
    };
    if (spec.onExpiry === "kill") {
      const d = deadline(spec.signal, spec.timeoutMs, "BASH_TIMEOUT");
      spawnSignal = d.signal;
      classify = () => {
        const timedOut = timeoutOf(d.signal, "BASH_TIMEOUT") !== void 0;
        return { timedOut, aborted: d.signal.aborted && !timedOut };
      };
      disarm = () => {
        d[Symbol.dispose]();
      };
    } else {
      spawnSignal = spec.signal;
      classify = () => ({ timedOut: false, aborted: spec.signal?.aborted === true });
    }
    let argv = [];
    let preparationTimedOut = false;
    if (typeof argvOrPrepare === "function") {
      const signal = spawnSignal ?? new AbortController().signal;
      const cancelled = Promise.withResolvers();
      const abort = () => {
        cancelled.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        argv = await Promise.race([
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return argvOrPrepare(signal);
          }),
          cancelled.promise
        ]);
        signal.throwIfAborted();
      } catch (error) {
        if (!classify().timedOut) {
          disarm();
          throw error;
        }
        preparationTimedOut = true;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    } else {
      argv = argvOrPrepare;
    }
    let running;
    let syncSpawnError;
    try {
      if (!preparationTimedOut) {
        running = this.ctx.subprocess.spawn(this.spawnSpec(spec, spec.stdoutMaxBytes, spawnSignal, argv));
      }
    } catch (error) {
      syncSpawnError = { error };
    }
    const emptyReader = {
      readFrom: () => ({ text: "", lossy: false, nextOffset: 0 })
    };
    const collected = running !== void 0 ? _PwshLocalExecutor.collected(running) : { stdout: emptyReader, stderr: emptyReader };
    const spawnThrow = () => syncSpawnError.error;
    const spawned = preparationTimedOut ? Promise.resolve({ exitCode: null, signal: null }) : running !== void 0 ? running.done : Promise.reject(spawnThrow());
    let providerFailure;
    let providerFailureReported = false;
    const consumeProviderFailure = () => {
      if (providerFailure === void 0 || providerFailureReported) return "";
      providerFailureReported = true;
      return providerFailure.note;
    };
    const observedStderr = {
      readFrom: (fromByte) => {
        if (providerFailure === void 0) return collected.stderr.readFrom(fromByte);
        const note = Buffer.from(providerFailure.note, "utf8");
        return { text: note.subarray(Math.min(fromByte, note.length)).toString("utf8"), nextOffset: note.length, lossy: false };
      }
    };
    let stdoutOffset = 0;
    let stderrOffset = 0;
    let resultPromise;
    const proc = {
      status: "running",
      exitCode: null,
      signal: null,
      observed: { stdout: collected.stdout, stderr: observedStderr },
      done: spawned.then((outcome) => {
        if (proc.status === "running") {
          proc.status = spawnSignal?.aborted === true || outcome.signal !== null ? "killed" : "completed";
        }
        proc.exitCode = outcome.exitCode;
        proc.signal = outcome.signal;
        this.onProcessDone(proc, collected.stderr.readFrom(0).text, false);
        disarm();
      }, (error) => {
        if (running !== void 0 && (proc.status === "killed" || spawnSignal?.aborted === true)) {
          proc.status = "killed";
          this.onProcessDone(proc, collected.stderr.readFrom(0).text, false);
          disarm();
          return;
        }
        proc.status = "killed";
        let detail = "unprintable provider failure";
        try {
          detail = String(error);
        } catch {
        }
        providerFailure = { error, note: `subprocess failed before reporting an outcome: ${detail}` };
        this.onProcessDone(proc, providerFailure.note, true, error);
        disarm();
      }),
      readOutput: () => {
        const out = collected.stdout.readFrom(stdoutOffset);
        const err = collected.stderr.readFrom(stderrOffset);
        stdoutOffset = out.nextOffset;
        stderrOffset = err.nextOffset;
        const providerFailure2 = consumeProviderFailure();
        const failureSeparator = err.text.length > 0 && !err.text.endsWith("\n") ? "\n" : "";
        const errText = err.text + (providerFailure2.length > 0 ? `${failureSeparator}${providerFailure2}` : "");
        const separator = out.text.length > 0 && !out.text.endsWith("\n") ? "\n" : "";
        const delta = out.text + (errText.length > 0 ? `${separator}[stderr]
${errText}` : "");
        return {
          delta,
          lossy: out.lossy || err.lossy,
          ...out.spillPath !== void 0 ? { stdoutSpillPath: out.spillPath } : {},
          ...err.spillPath !== void 0 ? { stderrSpillPath: err.spillPath } : {}
        };
      },
      kill: () => {
        if (proc.status !== "running") return false;
        proc.status = "killed";
        running?.terminate();
        return true;
      },
      result: () => {
        resultPromise ??= proc.done.then(() => {
          if (providerFailure !== void 0) throw providerFailure.error;
          return {
            exitCode: proc.exitCode,
            signal: proc.signal,
            ...classify(),
            timeoutMs: spec.timeoutMs,
            stdout: finalOutput(collected.stdout),
            stderr: finalOutput(collected.stderr)
          };
        });
        return resultPromise;
      }
    };
    if (!preparationTimedOut) onStarted?.(proc);
    return proc;
  }
  /**
   * Settlement hook for subclasses that attach execution facts to a process.
   * The base implementation is intentionally empty. Mirrored from
   * `dsh-bash-local` (whose sandboxing subclass consumes the same hook); the
   * pwsh-confining consumer is `@deepseek-ai/dsh-pwsh-sandbox`.
   * @param _proc - the settled process handle.
   * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
   * @param _providerRejected - whether the subprocess promise rejected without a direct outcome.
   * @param _providerError - the provider rejection reason, which may itself be undefined.
   */
  onProcessDone(_proc, _stderr, _providerRejected, _providerError) {
  }
};

// third_party/dsh-tools/packages/shell/pwsh-sandbox/src/helpers.ts
import { accessSync as accessSync3, constants as constants4, statSync as statSync5 } from "node:fs";
var EXECUTABLE_SPAWN_CODES2 = /* @__PURE__ */ new Set(["EACCES", "ENOENT"]);
function isUsableWorkdir2(path) {
  try {
    if (!statSync5(path).isDirectory()) return false;
    accessSync3(path, constants4.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isRunnerSpawnFailure2(error, runnerProgram, workdir) {
  if (runnerProgram === void 0 || !isUsableWorkdir2(workdir)) return false;
  if (typeof error !== "object" || error === null) return false;
  const { code, path, syscall } = error;
  if (typeof code !== "string" || !EXECUTABLE_SPAWN_CODES2.has(code)) return false;
  if (typeof syscall !== "string") return false;
  const exactSyscall = `spawn ${runnerProgram}`;
  if (path === void 0) return syscall === exactSyscall;
  if (typeof path !== "string" || path.length === 0 || path !== runnerProgram) return false;
  return syscall === "spawn" || syscall === exactSyscall;
}
function classifyDenial(result, signatures) {
  return matchesSignature2(result.exitCode, result.stderr.text, signatures);
}
function classifyRunnerFailure2(exitCode, stderr, rules) {
  if (exitCode === null || exitCode === 0) return void 0;
  const lines = stderr.split(/\r?\n/);
  for (const rule of rules) {
    if (rule.allowedExitCodes !== void 0 && !rule.allowedExitCodes.includes(exitCode)) continue;
    const informationalLines = new Set((rule.informationalLines ?? []).map((line) => line.toLowerCase()));
    const fatalSignatures = rule.fatalSignatures.filter((signature) => signature.trim().length > 0).map((signature) => signature.toLowerCase());
    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (informationalLines.has(lowered)) continue;
      if (fatalSignatures.some((signature) => lowered.includes(signature))) return { detail: line };
    }
  }
  return void 0;
}
function matchesSignature2(exitCode, stderr, signatures) {
  if (exitCode === null || exitCode === 0) return false;
  const lowered = stderr.toLowerCase();
  return signatures.some((signature) => lowered.includes(signature.toLowerCase()));
}

// third_party/dsh-tools/packages/shell/pwsh-sandbox/src/index.ts
var SandboxPwshExecutor = class _SandboxPwshExecutor extends PwshLocalExecutor {
  static inject = ["subprocess", "sandbox", "sandboxPolicy"];
  // No own Config: the sandbox default (mode + workspaceRoot) moved to
  // ctx.sandboxPolicy, so this executor inherits PwshLocalExecutor's Config
  // verbatim (the config catalog walks the inherited static).
  mode;
  /**
   * Per-process confinement facts retained until settlement. Providers may
   * vary enforcement and diagnostic dialect between overlapping calls, so a
   * shared latest-wrap value would classify a process against the wrong facts.
   * Unconfined processes have no entry.
   */
  processFacts = /* @__PURE__ */ new Map();
  constructor(ctx2, config) {
    super(ctx2, config);
    this.mode = ctx2.sandboxPolicy.defaultMode;
  }
  /** The configured default mode — the capability fact the tool layer reads. */
  get sandboxMode() {
    return this.mode;
  }
  /**
   * Stamp a complete per-call policy onto the spec. Tool calls supply the
   * calling session's resolved mode and root; lower-level callers fall back to
   * the deployment policy.
   */
  resolve(request2) {
    return { ...super.resolve(request2), sandboxPolicy: request2.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() };
  }
  async execute(spec) {
    const policy = spec.sandboxPolicy;
    const { mode } = policy;
    if (mode === "danger-full-access") {
      return _SandboxPwshExecutor.decorateResult(
        await super.execute(spec),
        (result) => ({ ...result, sandbox: { mode, denied: false } })
      );
    }
    let confined;
    const ex = await this.executeArgv(spec, async (signal) => {
      const prepared = await this.confine(spec, { ...policy, mode }, signal);
      signal.throwIfAborted();
      confined = prepared;
      return prepared.argv;
    }, (process2) => {
      const facts = confined;
      this.processFacts.set(process2, {
        mode,
        enforcement: facts.enforcement,
        denialSignatures: facts.denialSignatures,
        runnerFailureRules: facts.runnerFailureRules,
        runnerProgram: facts.argv[0],
        workdir: spec.workdir
      });
    });
    return _SandboxPwshExecutor.decorateResult(ex, (result) => {
      if (confined === void 0) return { ...result, sandbox: { mode, denied: false } };
      const { enforcement, denialSignatures, runnerFailureRules } = confined;
      const runnerFailure = classifyRunnerFailure2(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== void 0) {
        throw new SandboxUnavailableError(mode, runnerFailure.detail);
      }
      return { ...result, sandbox: { mode, denied: classifyDenial(result, denialSignatures), enforcement } };
    }, (error) => {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
      if (confined !== void 0 && isRunnerSpawnFailure2(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error));
      }
      throw error;
    });
  }
  /**
   * Decorate the handle's foreground projection in place, memoized once. The
   * handle keeps its identity (never wrapped in a second object) because the
   * per-process facts and `onProcessDone` key on the exact instance.
   */
  static decorateResult(ex, map, mapError) {
    const base = ex.result.bind(ex);
    let decorated;
    ex.result = () => {
      decorated ??= base().then(map, mapError);
      return decorated;
    };
    return ex;
  }
  /**
   * Stamp per-process sandbox facts before `done` settles. Full-access
   * processes have no facts; signal deaths are not denials.
   */
  onProcessDone(proc, stderr, providerRejected, providerError) {
    const facts = this.processFacts.get(proc);
    if (facts !== void 0) {
      this.processFacts.delete(proc);
      const runnerFailed = providerRejected ? isRunnerSpawnFailure2(providerError, facts.runnerProgram, facts.workdir) : classifyRunnerFailure2(proc.exitCode, stderr, facts.runnerFailureRules) !== void 0;
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature2(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...runnerFailed ? { runnerFailed } : {}
      };
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError);
  }
  /**
   * Wrap one pwsh invocation via the `ctx.sandbox` provider. Provider errors
   * propagate unchanged; the returned argv is handed directly to the local
   * executor's subprocess path.
   * @param spec - resolved execution spec whose pwsh argv is confined.
   * @param policy - resolved confined execution policy.
   * @param signal - cancellation of confinement preparation.
   * @returns the provider's exact argv and settlement-classification facts.
   */
  confine(spec, policy, signal) {
    return this.ctx.sandbox.confine(this.argv(spec), policy, signal);
  }
};

// third_party/dsh-tools/packages/shell/bash-local/src/index.ts
import z5 from "@deepseek-ai/schemastery";
var ENV_OVERRIDES2 = {
  NO_COLOR: "1",
  TERM: "dumb",
  PAGER: "cat",
  GIT_PAGER: "cat"
};
var DEFAULT_GRACE_MS2 = 3e3;
var DEFAULT_MAX_SPILL_BYTES2 = 64 * 1024 * 1024;
function finalOutput2(reader) {
  const read = reader.readFrom(0);
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== void 0 ? { spillPath: read.spillPath } : {}
  };
}
function assertPositiveFinite2(name4, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`bash-local: ${name4} must be a positive finite number`);
  }
}
function assertServiceableBashConfig(config) {
  assertPositiveFinite2("timeoutMs", config.timeoutMs.get());
  assertPositiveFinite2("maxTimeoutMs", config.maxTimeoutMs.get());
  assertPositiveFinite2("maxOutputBytes", config.maxOutputBytes.get());
  assertPositiveFinite2("maxSpillBytes", config.maxSpillBytes.get());
  assertPositiveFinite2("graceMs", config.graceMs.get());
  if (config.graceMs.get() > MAX_TIMER_DELAY_MS) {
    throw new Error(`bash-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
  }
}
var LocalBashExecutor = class _LocalBashExecutor extends ShellExecutor {
  constructor(ctx2, config) {
    super(ctx2);
    this.config = config;
  }
  config;
  static inject = ["subprocess"];
  static Config = z5.object({
    cwd: z5.string().volatile(),
    timeoutMs: z5.number().default(12e4).volatile(),
    maxTimeoutMs: z5.number().default(6e5).volatile(),
    maxOutputBytes: z5.number().default(64e3).volatile(),
    maxSpillBytes: z5.number().default(DEFAULT_MAX_SPILL_BYTES2).volatile(),
    graceMs: z5.number().default(DEFAULT_GRACE_MS2).volatile()
  });
  /**
   * Resolve a request into a fully-specified spec: fill `workdir` from
   * `config.cwd` (else `process.cwd()`), and `timeoutMs` from
   * `config.timeoutMs`, capped at `config.maxTimeoutMs`. The tool layer calls
   * this before {@link execute}, so it receives explicit values and never
   * re-defaults.
   */
  resolve(request2) {
    assertServiceableBashConfig(this.config);
    const timeoutMs = clampTimeout(
      request2.timeoutMs,
      this.config.timeoutMs.get(),
      this.config.maxTimeoutMs.get(),
      "bash-local: request.timeoutMs"
    );
    const stdoutMaxBytes = request2.stdoutMaxBytes ?? this.config.maxOutputBytes.get();
    assertPositiveFinite2("request.stdoutMaxBytes", stdoutMaxBytes);
    return {
      command: request2.command,
      workdir: request2.workdir ?? this.config.cwd.get() ?? process.cwd(),
      timeoutMs,
      onExpiry: request2.onExpiry ?? "kill",
      stdoutMaxBytes,
      ...request2.signal ? { signal: request2.signal } : {},
      // Carry stdin/ordinary env/trusted dshEnv through verbatim — optional,
      // no config default. The subprocess service owns the scrub and merge order.
      ...request2.stdin !== void 0 ? { stdin: request2.stdin } : {},
      ...request2.env !== void 0 ? { env: request2.env } : {},
      ...request2.dshEnv !== void 0 ? { dshEnv: request2.dshEnv } : {},
      // Carry a sandbox policy through verbatim: this executor never
      // confines, so the field is inert here (the seam contract) — a
      // sandboxing subclass overrides resolve() to stamp its default instead.
      sandboxPolicy: request2.sandboxPolicy
    };
  }
  /** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
  // XXX(stateful-shell): evaluate persistent cwd or PTY sessions when workflows require shell state.
  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const collect = (maxBytes) => ({ maxBytes, spill: { maxBytes: this.config.maxSpillBytes.get() } });
    return {
      argv,
      cwd: spec.workdir,
      stdio: {
        stdin: spec.stdin !== void 0 ? { data: spec.stdin } : "ignore",
        stdout: collect(stdoutMaxBytes),
        stderr: collect(this.config.maxOutputBytes.get())
      },
      graceMs: this.config.graceMs.get(),
      signal,
      // One explicit env map for the seam, layered so the trusted dshEnv
      // snapshot beats both the caller's env and the terminal overrides; the
      // subprocess service merges the whole map after its ambient scrub.
      env: { ...ENV_OVERRIDES2, ...spec.env, ...spec.dshEnv }
    };
  }
  /** The collect-mode readers the executor itself requested (present by construction). */
  static collected(handle) {
    const { stdout, stderr } = handle.collected;
    if (stdout === void 0 || stderr === void 0) {
      throw new Error("bash-local: subprocess implementation dropped a requested collect stream");
    }
    return { stdout, stderr };
  }
  async execute(spec) {
    return this.executeArgv(spec, ["bash", "-c", spec.command]);
  }
  /**
   * Execute an explicit argv with the lifecycle, environment, output,
   * deadline, and cancellation semantics of this executor. Subclasses use this
   * after replacing the public command's shell argv at an execution boundary.
   * @param spec - resolved execution settings and caller-owned command metadata.
   * @param argvOrPrepare - exact argv, or preparation using the execution cancellation signal.
   * @param onStarted - installs provider facts synchronously before the handle can settle.
   * @returns the live execution handle; spawn rejection settles the handle as
   *   killed while `result()` carries the same failure as its rejection.
   */
  async executeArgv(spec, argvOrPrepare, onStarted) {
    let spawnSignal;
    let classify;
    let disarm = () => {
    };
    if (spec.onExpiry === "kill") {
      const d = deadline(spec.signal, spec.timeoutMs, "BASH_TIMEOUT");
      spawnSignal = d.signal;
      classify = () => {
        const timedOut = timeoutOf(d.signal, "BASH_TIMEOUT") !== void 0;
        return { timedOut, aborted: d.signal.aborted && !timedOut };
      };
      disarm = () => {
        d[Symbol.dispose]();
      };
    } else {
      spawnSignal = spec.signal;
      classify = () => ({ timedOut: false, aborted: spec.signal?.aborted === true });
    }
    let argv = [];
    let preparationTimedOut = false;
    if (typeof argvOrPrepare === "function") {
      const signal = spawnSignal ?? new AbortController().signal;
      const cancelled = Promise.withResolvers();
      const abort = () => {
        cancelled.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        argv = await Promise.race([
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return argvOrPrepare(signal);
          }),
          cancelled.promise
        ]);
        signal.throwIfAborted();
      } catch (error) {
        if (!classify().timedOut) {
          disarm();
          throw error;
        }
        preparationTimedOut = true;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    } else {
      argv = argvOrPrepare;
    }
    let running;
    let syncSpawnError;
    try {
      if (!preparationTimedOut) {
        running = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, spawnSignal));
      }
    } catch (error) {
      syncSpawnError = { error };
    }
    const emptyReader = {
      readFrom: () => ({ text: "", lossy: false, nextOffset: 0 })
    };
    const collected = running !== void 0 ? _LocalBashExecutor.collected(running) : { stdout: emptyReader, stderr: emptyReader };
    const spawnThrow = () => syncSpawnError.error;
    const spawned = preparationTimedOut ? Promise.resolve({ exitCode: null, signal: null }) : running !== void 0 ? running.done : Promise.reject(spawnThrow());
    let providerFailure;
    let providerFailureReported = false;
    const consumeProviderFailure = () => {
      if (providerFailure === void 0 || providerFailureReported) return "";
      providerFailureReported = true;
      return providerFailure.note;
    };
    const observedStderr = {
      readFrom: (fromByte) => {
        if (providerFailure === void 0) return collected.stderr.readFrom(fromByte);
        const note = Buffer.from(providerFailure.note, "utf8");
        return { text: note.subarray(Math.min(fromByte, note.length)).toString("utf8"), nextOffset: note.length, lossy: false };
      }
    };
    let stdoutOffset = 0;
    let stderrOffset = 0;
    let resultPromise;
    const proc = {
      status: "running",
      exitCode: null,
      signal: null,
      observed: { stdout: collected.stdout, stderr: observedStderr },
      done: spawned.then((outcome) => {
        if (proc.status === "running") {
          proc.status = spawnSignal?.aborted === true || outcome.signal !== null ? "killed" : "completed";
        }
        proc.exitCode = outcome.exitCode;
        proc.signal = outcome.signal;
        this.onProcessDone(proc, collected.stderr.readFrom(0).text, false);
        disarm();
      }, (error) => {
        if (running !== void 0 && (proc.status === "killed" || spawnSignal?.aborted === true)) {
          proc.status = "killed";
          this.onProcessDone(proc, collected.stderr.readFrom(0).text, false);
          disarm();
          return;
        }
        proc.status = "killed";
        let detail = "unprintable provider failure";
        try {
          detail = String(error);
        } catch {
        }
        providerFailure = { error, note: `subprocess failed before reporting an outcome: ${detail}` };
        this.onProcessDone(proc, providerFailure.note, true, error);
        disarm();
      }),
      readOutput: () => {
        const out = collected.stdout.readFrom(stdoutOffset);
        const err = collected.stderr.readFrom(stderrOffset);
        stdoutOffset = out.nextOffset;
        stderrOffset = err.nextOffset;
        const providerFailure2 = consumeProviderFailure();
        const failureSeparator = err.text.length > 0 && !err.text.endsWith("\n") ? "\n" : "";
        const errText = err.text + (providerFailure2.length > 0 ? `${failureSeparator}${providerFailure2}` : "");
        const separator = out.text.length > 0 && !out.text.endsWith("\n") ? "\n" : "";
        const delta = out.text + (errText.length > 0 ? `${separator}[stderr]
${errText}` : "");
        return {
          delta,
          lossy: out.lossy || err.lossy,
          ...out.spillPath !== void 0 ? { stdoutSpillPath: out.spillPath } : {},
          ...err.spillPath !== void 0 ? { stderrSpillPath: err.spillPath } : {}
        };
      },
      kill: () => {
        if (proc.status !== "running") return false;
        proc.status = "killed";
        running?.terminate();
        return true;
      },
      result: () => {
        resultPromise ??= proc.done.then(() => {
          if (providerFailure !== void 0) throw providerFailure.error;
          return {
            exitCode: proc.exitCode,
            signal: proc.signal,
            ...classify(),
            timeoutMs: spec.timeoutMs,
            stdout: finalOutput2(collected.stdout),
            stderr: finalOutput2(collected.stderr)
          };
        });
        return resultPromise;
      }
    };
    if (!preparationTimedOut) onStarted?.(proc);
    return proc;
  }
  /**
   * Settlement hook for subclasses that attach execution facts to a process.
   * Called after exit facts or provider-failure output are stamped and before
   * {@link ShellProcess.done} resolves. The base implementation is intentionally
   * empty.
   * @param _proc - the settled process handle.
   * @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
   * @param _providerRejected - whether the subprocess promise rejected without a direct outcome.
   * @param _providerError - the provider rejection reason, which may itself be undefined.
   */
  onProcessDone(_proc, _stderr, _providerRejected, _providerError) {
  }
};

// third_party/dsh-tools/packages/shell/bash-sandbox/src/helpers.ts
function classifyDenial2(result, signatures) {
  return matchesSignature(result.exitCode, result.stderr.text, signatures);
}

// third_party/dsh-tools/packages/shell/bash-sandbox/src/index.ts
var SandboxBashExecutor = class _SandboxBashExecutor extends LocalBashExecutor {
  static inject = ["subprocess", "sandbox", "sandboxPolicy"];
  // No own Config: the sandbox default (mode + workspaceRoot) is owned by
  // ctx.sandboxPolicy, so this executor inherits LocalBashExecutor's Config
  // verbatim (the config catalog walks the inherited static).
  mode;
  /**
   * Per-process confinement facts retained until settlement. Providers may
   * vary enforcement and diagnostic dialect between overlapping calls, so a
   * shared latest-wrap value would classify a process against the wrong facts.
   * Unconfined processes have no entry.
   */
  processFacts = /* @__PURE__ */ new Map();
  constructor(ctx2, config) {
    super(ctx2, config);
    this.mode = ctx2.sandboxPolicy.defaultMode;
  }
  /** The configured default mode — the capability fact the tool layer reads. */
  get sandboxMode() {
    return this.mode;
  }
  /**
   * Stamp a complete per-call policy onto the spec. Tool calls supply the
   * calling session's resolved mode and root; lower-level callers fall back to
   * the deployment policy.
   */
  resolve(request2) {
    return { ...super.resolve(request2), sandboxPolicy: request2.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() };
  }
  async execute(spec) {
    const policy = spec.sandboxPolicy;
    const { mode } = policy;
    if (mode === "danger-full-access") {
      return _SandboxBashExecutor.decorateResult(
        await super.execute(spec),
        (result) => ({ ...result, sandbox: { mode, denied: false } })
      );
    }
    let confined;
    const ex = await this.executeArgv(spec, async (signal) => {
      const prepared = await this.confine(spec.command, { ...policy, mode }, signal);
      signal.throwIfAborted();
      confined = prepared;
      return prepared.argv;
    }, (process2) => {
      const facts = confined;
      this.processFacts.set(process2, {
        mode,
        enforcement: facts.enforcement,
        denialSignatures: facts.denialSignatures,
        runnerFailureRules: facts.runnerFailureRules,
        runnerProgram: facts.argv[0],
        workdir: spec.workdir
      });
    });
    return _SandboxBashExecutor.decorateResult(ex, (result) => {
      if (confined === void 0) return { ...result, sandbox: { mode, denied: false } };
      const { enforcement, denialSignatures, runnerFailureRules } = confined;
      const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== void 0) {
        throw new SandboxUnavailableError(mode, runnerFailure.detail);
      }
      return { ...result, sandbox: { mode, denied: classifyDenial2(result, denialSignatures), enforcement } };
    }, (error) => {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
      if (confined !== void 0 && isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
        throw new SandboxUnavailableError(mode, String(error));
      }
      throw error;
    });
  }
  /**
   * Decorate the handle's foreground projection in place, memoized once. The
   * handle keeps its identity (never wrapped in a second object) because the
   * per-process facts and `onProcessDone` key on the exact instance.
   */
  static decorateResult(ex, map, mapError) {
    const base = ex.result.bind(ex);
    let decorated;
    ex.result = () => {
      decorated ??= base().then(map, mapError);
      return decorated;
    };
    return ex;
  }
  /**
   * Stamp per-process sandbox facts before `done` settles. Full-access processes
   * have no facts; signal deaths are not denials.
   */
  onProcessDone(proc, stderr, providerRejected, providerError) {
    const facts = this.processFacts.get(proc);
    if (facts !== void 0) {
      this.processFacts.delete(proc);
      const runnerFailed = providerRejected ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir) : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== void 0;
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...runnerFailed ? { runnerFailed } : {}
      };
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError);
  }
  /**
   * Wrap one shell command via the `ctx.sandbox` provider. Provider errors
   * propagate unchanged; the returned argv is handed directly to the local
   * executor's subprocess path.
   * @param command - shell source for the confined inner `bash -c`.
   * @param policy - resolved confined execution policy.
   * @param signal - cancellation of confinement preparation.
   * @returns the provider's exact argv and settlement-classification facts.
   */
  confine(command, policy, signal) {
    return this.ctx.sandbox.confine(["bash", "-c", command], policy, signal);
  }
};

// third_party/dsh-tools/packages/shell/shell-env/src/index.ts
import z6 from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/util/home-paths/src/index.ts
import { homedir } from "node:os";
import { basename as basename3, dirname as dirname2, join as join6, resolve as resolve2 } from "node:path";
var DSH_HOME_DIR_NAME = ".dsh";
var DEFAULT_DSH_HOME_DISPLAY = `~/${DSH_HOME_DIR_NAME}`;
var DSH_HOME_ENV = "DSH_HOME";
var AGENTS_HOME_DIR_NAME = ".agents";
var DEFAULT_AGENTS_HOME_DISPLAY = `~/${AGENTS_HOME_DIR_NAME}`;
function defaultDshHome() {
  return join6(homedir(), DSH_HOME_DIR_NAME);
}
function expandHomePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join6(homedir(), path.slice(2));
  return path;
}
function resolveRoot(configured, env, envName, fallback) {
  const fromEnv = env[envName];
  const selected = configured ?? (fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : fallback());
  return resolve2(expandHomePath(selected));
}
function resolveDshHome(configured, env = process.env) {
  return resolveRoot(configured, env, DSH_HOME_ENV, defaultDshHome);
}

// third_party/dsh-tools/packages/shell/shell-env/src/index.ts
var Config3 = z6.object({
  dshHome: z6.string()
});
var DSH_SHELL_KEY = `${DSH_ENV_PREFIX}SHELL`;
var DSH_SESSION_ID_KEY = `${DSH_ENV_PREFIX}SESSION_ID`;
var DSH_PROFILE_KEY = `${DSH_ENV_PREFIX}PROFILE`;
var DSH_PROFILE_DIR_KEY = `${DSH_ENV_PREFIX}PROFILE_DIR`;
var RESERVED_BASH_ENV_KEYS = /* @__PURE__ */ new Set([
  DSH_HOME_ENV,
  DSH_SHELL_KEY,
  DSH_SESSION_ID_KEY,
  DSH_PROFILE_KEY,
  DSH_PROFILE_DIR_KEY
]);
var BASH_ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/;
var ShellEnvRegistry = class extends cordis_exports.Service {
  contributors = /* @__PURE__ */ new Map();
  keyOwners = /* @__PURE__ */ new Map();
  dshHome;
  /**
   * Create and install the `ctx.shellEnv` service.
   * @param ctx - Cordis context that owns the service and registrations.
   * @param config - home-directory configuration for the built-in variables.
   */
  constructor(ctx2, config = {}) {
    super(ctx2, "shellEnv");
    this.dshHome = resolveDshHome(config.dshHome);
  }
  /**
   * Register one environment contributor. Names and keys are unique; built-in
   * keys are reserved. Registration is disposed with the calling plugin fiber.
   * @param contributor - declared key ownership and per-execution resolver.
   * @returns the disposer that unregisters the contribution.
   */
  register(contributor) {
    const dispose = this.ctx.effect(function* () {
      if (contributor.name.trim().length === 0) {
        throw new Error("bash env contributor name must be non-empty");
      }
      if (this.contributors.has(contributor.name)) {
        throw new Error(`bash env contributor "${contributor.name}" is already registered`);
      }
      const variables = Object.entries(contributor.variables);
      for (const [key, variable] of variables) {
        if (!key.startsWith(DSH_ENV_PREFIX) || !BASH_ENV_KEY_SUFFIX.test(key.slice(DSH_ENV_PREFIX.length))) {
          throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`);
        }
        if (RESERVED_BASH_ENV_KEYS.has(key)) {
          throw new Error(`bash env contributor "${contributor.name}" cannot own reserved key "${key}"`);
        }
        if (variable.description.trim().length === 0) {
          throw new Error(`bash env contributor "${contributor.name}" must describe "${key}"`);
        }
        const owner = this.keyOwners.get(key);
        if (owner !== void 0) {
          throw new Error(`bash env key "${key}" is already owned by contributor "${owner}"; contributor "${contributor.name}" cannot also own it`);
        }
      }
      this.contributors.set(contributor.name, contributor);
      for (const [key] of variables) this.keyOwners.set(key, contributor.name);
      yield () => {
        this.contributors.delete(contributor.name);
        for (const [key] of variables) this.keyOwners.delete(key);
      };
    }.bind(this), "bashEnv.register()");
    return () => void dispose();
  }
  /**
   * Build the trusted `DSH_*` snapshot for one shell tool execution.
   * @param execution - the current tool execution.
   * @returns an immutable environment overlay containing built-ins and current contributions.
   */
  collect(execution) {
    const values = {
      [DSH_HOME_ENV]: this.dshHome,
      [DSH_SHELL_KEY]: "1"
    };
    if (execution.agent !== void 0) {
      values[DSH_SESSION_ID_KEY] = execution.agent.session.header.id;
    }
    const profile = this.ctx.get("profileContext");
    if (profile !== void 0) {
      values[DSH_PROFILE_KEY] = profile.name;
      values[DSH_PROFILE_DIR_KEY] = profile.dir;
    }
    for (const contributor of [...this.contributors.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = contributor.resolve(execution);
      for (const [rawKey, value] of Object.entries(resolved)) {
        const key = rawKey;
        if (!Object.hasOwn(contributor.variables, key)) {
          throw new Error(`bash env contributor "${contributor.name}" returned undeclared key "${key}"`);
        }
        if (typeof value !== "string") {
          throw new Error(`bash env contributor "${contributor.name}" returned a non-string value for "${key}"`);
        }
        values[key] = value;
      }
    }
    return Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))));
  }
  // TODO(bash-env-list-builtins): Include registry-owned built-ins before diagnostics,
  // prompt, or UI code treats list() as an exhaustive environment catalog.
  /**
   * Enumerate plugin-contributed variables without executing their resolvers.
   * @returns declarations sorted by environment variable name.
   */
  list() {
    return [...this.contributors.values()].flatMap((contributor) => Object.entries(contributor.variables).map(([key, variable]) => ({
      contributor: contributor.name,
      description: variable.description,
      key
    }))).sort((left, right) => left.key.localeCompare(right.key));
  }
};

// third_party/dsh-tools/packages/jobs/jobs-local/src/index.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import z7 from "@deepseek-ai/schemastery";

// third_party/dsh-tools/packages/jobs/jobs/src/archive-admission.ts
function installJobArchiveAdmission(ctx2, registry) {
  ctx2.on("workspace/session-activity", async ({ sessionId }, next) => {
    const jobs = runningJobs(registry, sessionId);
    const rest = await next();
    if (jobs.length === 0) return rest;
    const own = { kind: "job", items: jobs.map((job) => ({ id: job.id, label: job.label })) };
    return [own, ...rest];
  });
  ctx2.on("workspace/session-stop", ({ sessionId }) => {
    for (const job of runningJobs(registry, sessionId)) {
      try {
        registry.kill(job.id, sessionId, "session archived");
      } catch (error) {
        ctx2.logger.warn(`jobs: killing "${job.id}" for an archived Session failed: ${String(error)}`);
      }
    }
  });
}
function runningJobs(registry, owner) {
  return registry.list(owner).filter((job) => job.owner === owner && (job.status === "running" || job.status === "stopping"));
}

// third_party/dsh-tools/packages/jobs/jobs/src/brand.ts
function JobId(id) {
  return id;
}

// third_party/dsh-tools/packages/jobs/jobs/src/index.ts
var JobRegistry = class _JobRegistry extends cordis_exports.Service {
  constructor(ctx2) {
    if (new.target === _JobRegistry) {
      throw new Error("@deepseek-ai/dsh-jobs is the abstract job registry seam; load an implementation such as @deepseek-ai/dsh-jobs-local instead");
    }
    super(ctx2, "jobs");
    installJobArchiveAdmission(ctx2, this);
  }
};

// third_party/dsh-tools/packages/jobs/jobs-local/src/events.ts
var JobLayer = class {
  /** Tokens of the job controllers attached from this scope. */
  controllers = new AnonymousEntries();
  /** The `{ owners: 'scope' }` subscriptions registered from this scope. */
  scoped = new AnonymousEntries();
  isEmpty() {
    return this.controllers.isEmpty() && this.scoped.isEmpty();
  }
};
var JobEventHub = class {
  /**
   * @param layers - the scope-layer table shared with the controller handshake.
   * @param warn - sink for a listener's contained failure.
   */
  constructor(layers, warn) {
    this.layers = layers;
    this.warn = warn;
  }
  layers;
  warn;
  unscoped = /* @__PURE__ */ new Set();
  /**
   * Register one listener as an effect of `ctx`.
   * @param ctx - the subscribing context; owns the effect and, for `'scope'`, names the scope.
   * @param filter - which owners' events to deliver.
   * @param listener - receives each matching event.
   * @returns disposer that unregisters the listener.
   */
  subscribe(ctx2, filter, listener) {
    const subscription = { filter, listener };
    if ("owners" in filter && filter.owners === "scope") {
      return this.layers.effect(ctx2, (layer) => layer.scoped.append(subscription), { label: "jobs.events.subscribe()" });
    }
    const dispose = ctx2.effect(() => {
      this.unscoped.add(subscription);
      return () => {
        this.unscoped.delete(subscription);
      };
    }, "jobs.events.subscribe()");
    return dispose;
  }
  /**
   * Deliver one event to every matching subscription, containing each
   * listener so an observer cannot break the commit already made.
   * @param event - the event to deliver.
   * @param owner - the job's exact owner, or undefined for unowned work.
   */
  emit(event, owner) {
    const ownerId = owner?.id;
    for (const subscription of this.unscoped) {
      const { filter } = subscription;
      if ("owner" in filter && ownerId !== void 0 && ownerId !== filter.owner) continue;
      this.deliver(subscription, event);
    }
    for (const subscription of this.layers.global.scoped.values()) this.deliver(subscription, event);
    const scope = owner === void 0 ? void 0 : scopeOf(owner.ctx);
    for (const layer of this.layers.chainLayers(scope)) {
      for (const subscription of layer.scoped.values()) this.deliver(subscription, event);
    }
  }
  deliver(subscription, event) {
    try {
      subscription.listener(event);
    } catch (error) {
      this.warn(`jobs: event listener threw on ${event.type}: ${String(error)}`);
    }
  }
};

// third_party/dsh-tools/packages/jobs/jobs-local/src/pump.ts
function startPump(sources, sink, pollMs, until) {
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error(`invalid pump pollMs: expected a positive finite number of milliseconds, got ${JSON.stringify(pollMs)}`);
  }
  const states = sources.map((source) => ({ source, cursor: 0 }));
  const drain = () => {
    for (const [index, state] of states.entries()) {
      const { source } = state;
      const read = source.read(state.cursor);
      state.cursor = read.nextOffset;
      sink.spill(index, read.spillPath);
      if (read.text.length === 0) continue;
      if (source.channel === void 0 && !read.lossy) {
        sink.append(read.text);
      } else {
        sink.append(read.text, {
          ...source.channel !== void 0 ? { channel: source.channel } : {},
          ...read.lossy ? { gapBefore: true } : {}
        });
      }
    }
  };
  const done = (async () => {
    let settled2 = false;
    let timer;
    let wake;
    const finish = () => {
      settled2 = true;
      clearTimeout(timer);
      wake?.();
    };
    void until.then(finish, finish);
    while (!settled2) {
      drain();
      await new Promise((resolve3) => {
        wake = resolve3;
        timer = setTimeout(resolve3, pollMs);
      });
      wake = void 0;
      timer = void 0;
    }
    drain();
  })();
  return { done };
}

// third_party/dsh-tools/packages/jobs/jobs-local/src/ring.ts
function utf8Tail(text, maxBytes) {
  const raw = Buffer.from(text, "utf8");
  let start = raw.length - maxBytes;
  while (start < raw.length && (raw[start] & 192) === 128) start += 1;
  const tail = raw.subarray(start);
  return { text: tail.toString("utf8"), bytes: tail.length };
}
var OutputRing = class {
  /** Retained chunks in offset order. */
  chunks = [];
  /** Sum of the retained chunks' byte lengths. */
  retainedBytes = 0;
  /** Total UTF-8 bytes ever appended — the offset the next chunk starts at. */
  total = 0;
  /** Offset of the oldest retained byte (equals {@link total} when nothing is retained). */
  earliest = 0;
  /**
   * Append one chunk and trim the head to `cap`.
   * @param text - the chunk text, exactly as produced.
   * @param options - stream label and gap marker.
   * @param cap - retention cap in UTF-8 bytes after this append.
   * @returns false when the chunk was empty and nothing changed.
   */
  append(text, options, cap) {
    if (text.length === 0) return false;
    const bytes = Buffer.byteLength(text, "utf8");
    this.chunks.push({
      at: this.total,
      text,
      bytes,
      ...options?.channel !== void 0 ? { channel: options.channel } : {},
      ...options?.gapBefore !== void 0 ? { gapBefore: options.gapBefore } : {}
    });
    this.total += bytes;
    this.retainedBytes += bytes;
    this.trim(cap);
    return true;
  }
  /**
   * Drop retained head chunks until the ring fits `cap`; a single oversized
   * chunk keeps only its UTF-8-safe tail with a `gapBefore` marker.
   * @param cap - retention cap in UTF-8 bytes.
   */
  trim(cap) {
    while (this.retainedBytes > cap && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped === void 0) break;
      this.retainedBytes -= dropped.bytes;
    }
    const single = this.chunks.length === 1 ? this.chunks[0] : void 0;
    if (single !== void 0 && single.bytes > cap) {
      const tail = utf8Tail(single.text, cap);
      single.at += single.bytes - tail.bytes;
      single.text = tail.text;
      single.bytes = tail.bytes;
      single.gapBefore = true;
      this.retainedBytes = tail.bytes;
    }
    this.earliest = this.chunks[0]?.at ?? this.total;
  }
  /**
   * Retained chunks overlapping `[from, total)` as fresh wire chunks.
   * @param from - absolute byte offset to read from.
   * @returns the chunks, the resume offset, and whether bytes before them were evicted.
   */
  readFrom(from) {
    const chunks = [];
    for (const chunk of this.chunks) {
      if (chunk.at + chunk.bytes <= from) continue;
      chunks.push({
        at: chunk.at,
        text: chunk.text,
        ...chunk.channel !== void 0 ? { channel: chunk.channel } : {},
        ...chunk.gapBefore !== void 0 ? { gapBefore: chunk.gapBefore } : {}
      });
    }
    return { chunks, next: this.total, lossy: from < this.earliest };
  }
};

// third_party/dsh-tools/packages/jobs/jobs-local/src/index.ts
var TASK_WAIT_TIMEOUT = "TASK_WAIT_TIMEOUT";
var DEFAULT_MAX_CONCURRENT_JOBS_PER_OWNER = 10;
var DEFAULT_RETAIN_BYTES = 256 * 1024;
var DEFAULT_SETTLED_RETAIN_BYTES = 16 * 1024;
var DEFAULT_PUMP_POLL_MS = 150;
function isTerminal(status) {
  return status === "completed" || status === "killed" || status === "failed";
}
var LocalJobRegistry = class extends JobRegistry {
  static Config = z7.object({
    maxConcurrentJobsPerOwner: z7.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_CONCURRENT_JOBS_PER_OWNER),
    retainBytes: z7.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_RETAIN_BYTES),
    settledRetainBytes: z7.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_SETTLED_RETAIN_BYTES),
    pumpPollMs: z7.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_PUMP_POLL_MS)
  });
  /** Schemastery-defaulted active-job limit. */
  maxConcurrentJobsPerOwner;
  /** Schemastery-defaulted live ring retention cap. */
  retainBytes;
  /** Schemastery-defaulted settled ring retention cap. */
  settledRetainBytes;
  /** Schemastery-defaulted pull-source poll interval. */
  pumpPollMs;
  store = /* @__PURE__ */ new Map();
  /**
   * Controllers and scoped subscriptions layered by the scope that registered
   * them, in the tools-registry shape: a contribution files into its
   * registering context's scope, and a read unions the global layer with the
   * owner's scope chain.
   *
   * The registry is one process-wide instance serving every composition, so a
   * flat table would answer a per-owner question process-wide: one preset's
   * job controls would hold `start()` open for an agent whose own composition
   * loads none, and one settlement would reach every preset's notice listener.
   * Layers make both reads owner-relative. Nothing derives a cache from a
   * layer, so change notification is a no-op.
   */
  layers = new ScopedLayers(() => new JobLayer(), () => {
  });
  hub;
  /** Owner agents with attached scope cleanup, mapped to the exact disposer. */
  ownerCleanups = /* @__PURE__ */ new Map();
  /** Service context used by detached settlement continuations and teardown. */
  selfCtx;
  constructor(ctx2, config) {
    super(ctx2);
    const resolved = config;
    this.maxConcurrentJobsPerOwner = resolved.maxConcurrentJobsPerOwner;
    this.retainBytes = resolved.retainBytes;
    this.settledRetainBytes = resolved.settledRetainBytes;
    this.pumpPollMs = resolved.pumpPollMs;
    this.selfCtx = ctx2;
    this.hub = new JobEventHub(this.layers, (message) => {
      ctx2.logger.warn(message);
    });
    ctx2.effect(() => () => this.disposeAll(), "jobs teardown");
  }
  /**
   * The event stream bound to the accessing context: a subscription is an
   * effect of that context, and `{ owners: 'scope' }` names its scope.
   */
  get events() {
    const registrar = this.ctx;
    return {
      subscribe: (filter, listener) => this.hub.subscribe(registrar, filter, listener)
    };
  }
  start(spec) {
    const owner = this.resolveOwner(spec.owner);
    if (!this.servesOwner(owner)) {
      throw new Error("background jobs unavailable: no job controller serves this agent (load @deepseek-ai/dsh-tool-jobs in its composition)");
    }
    if (spec.kind.length === 0) throw new Error("invalid job kind: expected a non-empty string");
    if (spec.label.length === 0) throw new Error("invalid job label: expected a non-empty string");
    if (spec.outputLimitBytes !== void 0 && (!Number.isSafeInteger(spec.outputLimitBytes) || spec.outputLimitBytes <= 0)) {
      throw new Error(`invalid outputLimitBytes: expected a positive safe integer, got ${JSON.stringify(spec.outputLimitBytes)}`);
    }
    if (owner !== void 0) this.ensureOwnerCleanup(owner);
    const active2 = this.activeJobCount(owner);
    if (active2 >= this.maxConcurrentJobsPerOwner) {
      throw new Error(
        `background job limit reached for this owner (limit: ${this.maxConcurrentJobsPerOwner}); use job_kill to stop an unneeded job, wait for it to finish, then retry`
      );
    }
    let id;
    do {
      id = JobId(`${spec.kind}-${randomUUID2().replaceAll("-", "").slice(0, 16)}`);
    } while (this.store.has(id));
    const toolCall = spec.toolCall === void 0 ? void 0 : { ...spec.toolCall };
    const ring = new OutputRing();
    const state = { progress: void 0, job: void 0 };
    const handle = {
      id,
      append: (text, options) => {
        this.appendRing(state, ring, text, options, "producer");
      },
      updateProgress: (line) => {
        this.updateProgress(state, line);
      }
    };
    const hooks = spec.run(handle);
    let markSettled;
    const settled2 = new Promise((resolve3) => {
      markSettled = resolve3;
    });
    const job = {
      id,
      toolCall,
      kind: spec.kind,
      label: spec.label,
      outputLimitBytes: spec.outputLimitBytes,
      owner,
      cancel: hooks.cancel.bind(hooks),
      status: "running",
      ring,
      modelCursor: 0,
      resultDelivered: false,
      state,
      detail: void 0,
      result: void 0,
      startedAt: Date.now(),
      finishedAt: void 0,
      killReason: void 0,
      settleCause: void 0,
      settled: settled2,
      markSettled,
      waitResolvers: /* @__PURE__ */ new Set(),
      pump: void 0,
      spillPaths: []
    };
    state.job = job;
    this.store.set(id, job);
    this.recordSessionEvent(job);
    this.emit({ type: "registered", job: this.view(job) }, owner);
    const producerDone = hooks.done.then(
      (outcome) => ({ outcome, producerReported: true }),
      (error) => {
        this.selfCtx.logger.warn(`jobs: job ${job.id} producer done promise rejected (producer contract violation): ${String(error)}`);
        return { outcome: { status: "failed", detail: String(error) }, producerReported: false };
      }
    );
    if (spec.output !== void 0 && spec.output.length > 0) {
      job.pump = startPump(
        spec.output.map((source) => this.guardSource(job, source)),
        {
          append: (text, options) => {
            this.appendRing(state, ring, text, options, "pump");
          },
          spill: (index, path) => {
            job.spillPaths[index] = path;
          }
        },
        this.pumpPollMs,
        Promise.race([producerDone, settled2])
      );
    }
    void producerDone.then(async ({ outcome, producerReported }) => {
      if (job.pump !== void 0) await job.pump.done;
      this.settle(job, outcome, job.settleCause ?? "producer", producerReported);
    });
    return id;
  }
  list(caller) {
    return [...this.store.values()].filter((job) => job.owner === void 0 || job.owner.id === caller).map((job) => this.view(job));
  }
  get(id, caller) {
    return this.view(this.expect(id, caller));
  }
  read(id, caller) {
    return this.readJob(this.expect(id, caller));
  }
  readAt(id, from, caller) {
    const job = this.expect(id, caller);
    if (!Number.isSafeInteger(from) || from < 0) {
      throw new Error(`invalid output read offset: expected a non-negative safe integer, got ${JSON.stringify(from)}`);
    }
    return job.ring.readFrom(from);
  }
  kill(id, caller, reason) {
    return this.killJob(this.expect(id, caller), reason);
  }
  async wait(id, timeoutMs, caller, signal) {
    return this.waitJob(this.expect(id, caller), timeoutMs, signal);
  }
  remove(id, caller) {
    const job = this.expect(id, caller);
    if (!isTerminal(job.status)) throw new Error(`job ${id} is still ${job.status}; kill it and wait for settlement before removing it`);
    this.drop([job]);
  }
  attachController(name4) {
    const token = Symbol(name4);
    return this.layers.effect(
      this.ctx,
      (layer) => layer.controllers.append(token),
      { label: "jobs.attachController()" }
    );
  }
  /**
   * Resolve a spec's owner session to its live Agent. An owned registration
   * needs the agent registry, and the session must currently have a live
   * instance: that instance's disposal is what cancels and drops the job.
   */
  resolveOwner(session) {
    if (session === void 0) return void 0;
    const agents = this.selfCtx.get("agents");
    if (agents === void 0) {
      throw new Error("background job ownership requires the agent registry (load @deepseek-ai/dsh-agent)");
    }
    const owner = agents.get(session);
    if (owner === void 0) {
      throw new Error(`session "${session}" has no live agent (background job owner must be live)`);
    }
    return owner;
  }
  /**
   * Whether an attached job controller can collect and stop work owned by
   * `owner`. The global layer holds every controller attached from an unscoped
   * context — a host composition's own controls — and therefore serves every
   * owner; a scoped controller serves exactly the agents composed under it.
   * @param owner - the job's owner, or undefined for unowned work.
   * @returns whether some reachable controller serves the owner.
   */
  servesOwner(owner) {
    if (!this.layers.global.controllers.isEmpty()) return true;
    return this.layers.chainLayers(owner === void 0 ? void 0 : scopeOf(owner.ctx)).some((layer) => !layer.controllers.isEmpty());
  }
  /** Count authoritative active records for one exact owner or the shared unowned bucket. */
  activeJobCount(owner) {
    let count = 0;
    for (const job of this.store.values()) {
      if (job.owner === owner && (job.status === "running" || job.status === "stopping")) count += 1;
    }
    return count;
  }
  /** Look up a job and enforce caller access. */
  expect(id, caller) {
    const job = this.store.get(id);
    if (job === void 0) throw new Error(`unknown job ${id}`);
    this.assertAccess(job, caller);
    return job;
  }
  /**
   * The isolation fence: a job with an owner is reachable only by callers
   * whose session id matches (`!== undefined` semantics — an unowned job is
   * open, and a caller-less view can never match an owned one).
   */
  assertAccess(job, caller) {
    if (job.owner !== void 0 && job.owner.id !== caller) {
      throw new Error(`job ${job.id} belongs to another session`);
    }
  }
  /** Project a fresh read-only view from the mutable record. */
  view(job) {
    const owner = job.owner?.id;
    const spillPaths = [...new Set(job.spillPaths.filter((path) => path !== void 0))];
    return {
      id: job.id,
      kind: job.kind,
      label: job.label,
      ...owner !== void 0 ? { owner } : {},
      ...job.outputLimitBytes !== void 0 ? { outputLimitBytes: job.outputLimitBytes } : {},
      status: job.status,
      ...job.state.progress !== void 0 ? { progress: job.state.progress } : {},
      ...job.detail !== void 0 ? { detail: job.detail } : {},
      startedAt: job.startedAt,
      ...job.finishedAt !== void 0 ? { finishedAt: job.finishedAt } : {},
      output: {
        total: job.ring.total,
        earliest: job.ring.earliest,
        ...spillPaths.length > 0 ? { spillPaths } : {}
      }
    };
  }
  emit(event, owner) {
    this.hub.emit(event, owner);
  }
  /** Publish committed facts before live subscribers or completion waiters react. */
  recordSessionEvent(job, settlement) {
    const owner = job.owner;
    if (owner === void 0) return;
    const session = owner.session;
    const data = {
      jobId: job.id,
      owner: owner.id,
      kind: job.kind,
      label: job.label,
      startedAt: job.startedAt,
      ...job.toolCall !== void 0 ? { toolCall: job.toolCall } : {}
    };
    try {
      if (settlement === void 0) session.append("job/registered", data);
      else session.append("job/settled", { ...data, ...settlement });
    } catch (error) {
      this.selfCtx.logger.warn(`jobs: failed to record lifecycle for ${job.id}: ${String(error)}`);
    }
  }
  /**
   * Consume the ring from the model cursor; the result rides the first read
   * after settlement. A terminal read is the point the settled stream drops
   * to the settled cap: settlement kept every unconsumed byte for it.
   */
  readJob(job) {
    const read = job.ring.readFrom(job.modelCursor);
    job.modelCursor = job.ring.total;
    const result = isTerminal(job.status) && !job.resultDelivered ? job.result : void 0;
    if (result !== void 0) job.resultDelivered = true;
    if (isTerminal(job.status)) job.ring.trim(this.settledRetainBytes);
    return {
      chunks: read.chunks,
      lossy: read.lossy,
      ...result !== void 0 ? { result } : {},
      job: this.view(job)
    };
  }
  killJob(job, reason) {
    if (isTerminal(job.status)) return "already-finished";
    job.cancel(reason);
    job.status = "stopping";
    if (reason !== void 0) job.killReason = reason;
    job.settleCause = "kill";
    this.emit({ type: "stopping", job: this.view(job) }, job.owner);
    return "requested";
  }
  async waitJob(job, timeoutMs, signal) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`invalid wait timeout: expected a positive number of milliseconds, got ${JSON.stringify(timeoutMs)}`);
    }
    if (!isTerminal(job.status)) {
      var _stack = [];
      try {
        if (signal?.aborted) throw new Error("wait aborted");
        const d = __using(_stack, deadline(signal, timeoutMs, TASK_WAIT_TIMEOUT));
        await new Promise((resolve3, reject) => {
          const onSettled = () => {
            job.waitResolvers.delete(onSettled);
            d.signal.removeEventListener("abort", onAbort);
            resolve3();
          };
          const onAbort = () => {
            job.waitResolvers.delete(onSettled);
            if (timeoutOf(d.signal, TASK_WAIT_TIMEOUT) !== void 0) {
              resolve3();
            } else {
              reject(new Error("wait aborted"));
            }
          };
          job.waitResolvers.add(onSettled);
          d.signal.addEventListener("abort", onAbort, { once: true });
        });
      } catch (_) {
        var _error = _, _hasError = true;
      } finally {
        __callDispose(_stack, _error, _hasError);
      }
    }
    return this.view(job);
  }
  /**
   * Append one chunk to the ring. A producer chunk against a settled job is
   * logged and dropped; the registry's own pump drains silently after
   * settlement (a forced settlement may precede the producer's). A chunk
   * staged inside the starter call is retained and signals no observer — the
   * registration commit publishes it.
   */
  appendRing(state, ring, text, options, writer) {
    const job = state.job;
    if (job !== void 0 && isTerminal(job.status)) {
      if (writer === "producer") this.selfCtx.logger.warn(`jobs: append to settled job ${job.id} dropped`);
      return;
    }
    if (!ring.append(text, options, this.retainBytes)) return;
    if (job !== void 0) this.emitOutput(job);
  }
  /**
   * Contain a failing pull source: the first throw is logged, and the source
   * reads as exhausted from then on, so the job runs to its own settlement
   * with whatever the ring holds instead of freezing on a pump failure.
   */
  guardSource(job, source) {
    let failed = false;
    return {
      ...source.channel !== void 0 ? { channel: source.channel } : {},
      read: (fromByte) => {
        if (failed) return { text: "", nextOffset: fromByte, lossy: false };
        try {
          return source.read(fromByte);
        } catch (error) {
          failed = true;
          this.selfCtx.logger.warn(`jobs: output source for ${job.id} failed; its stream stops here: ${String(error)}`);
          return { text: "", nextOffset: fromByte, lossy: false };
        }
      }
    };
  }
  /** Announce that one job's ring advanced (append or settlement). */
  emitOutput(job) {
    const owner = job.owner?.id;
    this.emit({ type: "output", id: job.id, ...owner !== void 0 ? { owner } : {}, total: job.ring.total }, job.owner);
  }
  /**
   * Replace the live progress line through a producer face; a write against a
   * settled job is logged and dropped. A write staged inside the starter call
   * seeds the registered projection and signals no observer.
   */
  updateProgress(state, line) {
    const job = state.job;
    if (job !== void 0 && isTerminal(job.status)) {
      this.selfCtx.logger.warn(`jobs: progress update on settled job ${job.id} dropped`);
      return;
    }
    state.progress = line;
    if (job !== void 0) this.emit({ type: "progress", job: this.view(job) }, job.owner);
  }
  /**
   * Record the first terminal outcome, release waiters, then announce the
   * settlement. First-wins preserves a teardown force-failure against late
   * producer settlement. The settled event follows every released waiter and
   * reports whether it released one: a timed-out or aborted wait has already
   * left the set, so only a wait still owed the projection counts.
   */
  settle(job, outcome, cause, producerReported) {
    if (isTerminal(job.status)) return;
    job.status = outcome.status;
    if (outcome.status === "killed" && job.killReason !== void 0) {
      job.detail = outcome.detail !== void 0 ? `${outcome.detail}; ${job.killReason}` : job.killReason;
    } else if (outcome.detail !== void 0) {
      job.detail = outcome.detail;
    }
    job.state.progress = void 0;
    job.result = outcome.result;
    job.finishedAt = Date.now();
    this.recordSessionEvent(job, {
      finishedAt: job.finishedAt,
      status: outcome.status,
      cause,
      producerReported,
      ...job.detail !== void 0 ? { detail: job.detail } : {}
    });
    job.ring.trim(Math.max(this.settledRetainBytes, job.ring.total - job.modelCursor));
    const waitResolvers = [...job.waitResolvers];
    job.waitResolvers.clear();
    for (const resolveWait of waitResolvers) resolveWait();
    job.markSettled();
    this.emit({ type: "settled", job: this.view(job), cause, awaited: waitResolvers.length > 0 }, job.owner);
    this.emitOutput(job);
  }
  /**
   * Attach one awaited cleanup through the exact owner's scope. This survives
   * producer reloads and joins agent quiescence; the retained disposer lets
   * service teardown detach the cross-fiber effect.
   */
  ensureOwnerCleanup(owner) {
    if (this.ownerCleanups.has(owner)) return;
    const detach = owner.ctx.effect(() => async () => {
      this.ownerCleanups.delete(owner);
      await this.disposeOwned(owner);
    }, "jobs.ownerCleanup()");
    this.ownerCleanups.set(owner, detach);
  }
  /** Cancel, await terminal records, and drop every job owned by one exact agent lifecycle. */
  async disposeOwned(owner) {
    const owned = [...this.store.values()].filter((job) => job.owner === owner);
    this.cancelForTeardown(owned, "owner disposed");
    await Promise.all(owned.map((job) => job.settled));
    this.drop(owned);
  }
  /** Drop settled records and announce each removal, the one visible-set change no per-job record carries. */
  drop(jobs) {
    for (const job of jobs) {
      this.store.delete(job.id);
      this.emit({ type: "removed", job: this.view(job) }, job.owner);
    }
  }
  /**
   * Cancel live jobs, await settlement, drop every record, and detach owner
   * effects. Throwing cancels are force-failed to avoid teardown deadlock.
   */
  async disposeAll() {
    const all = [...this.store.values()];
    this.cancelForTeardown(all, "jobs service disposed");
    await Promise.all(all.map((job) => job.settled));
    this.drop(all);
    const ownerCleanups = [...this.ownerCleanups.values()];
    this.ownerCleanups.clear();
    await Promise.all(ownerCleanups.map((cleanup) => Promise.resolve(cleanup())));
  }
  /**
   * Cancel jobs during teardown with per-job containment. A throwing cancel
   * force-fails the record and reports a possible orphan; a cancel that returns
   * without settling remains indistinguishable from a slow stop and may stall.
   */
  cancelForTeardown(jobs, reason) {
    for (const job of jobs) {
      if (isTerminal(job.status)) continue;
      job.settleCause = "teardown";
      try {
        job.cancel(reason);
        job.status = "stopping";
        this.emit({ type: "stopping", job: this.view(job) }, job.owner);
      } catch (error) {
        const detail = `cancel threw during teardown; work may be orphaned: ${String(error)}`;
        this.selfCtx.logger.warn(`jobs: cancel of ${job.id} threw during teardown; job record forced failed and work may be orphaned: ${String(error)}`);
        this.settle(job, { status: "failed", detail }, "teardown", false);
      }
    }
  }
};

// command-host.ts
import { appendFileSync } from "node:fs";
import { dirname as dirname3, join as join7 } from "node:path";
var CommandHost = class {
  constructor(ctx2, request2, send2) {
    this.ctx = ctx2;
    this.request = request2;
    this.send = send2;
  }
  ctx;
  request;
  send;
  abort = new AbortController();
  execution = Promise.withResolvers();
  pendingApproval;
  jobId;
  owner;
  decide(decision) {
    if (!this.pendingApproval) throw new Error("No native approval is pending");
    const complete = this.pendingApproval;
    this.pendingApproval = void 0;
    complete(decision);
  }
  stop() {
    this.abort.abort();
    this.pendingApproval?.("cancelled");
    this.pendingApproval = void 0;
    if (this.jobId) this.ctx.jobs.kill(this.jobId, this.owner.id, "Bridge command stopped");
  }
  async start() {
    const host2 = this;
    const request2 = this.request;
    const mode = request2.sandbox_prefix.length ? "workspace-write" : "danger-full-access";
    const policy = { mode, workspaceRoot: request2.cwd, sessionId: request2.session };
    const sections = /* @__PURE__ */ new Map();
    const providers = /* @__PURE__ */ new Set();
    const session = {
      header: { id: request2.session ?? request2.operation, cwd: request2.cwd },
      append(type, data) {
        appendFileSync(join7(dirname3(request2.stdout_path), "jobs.jsonl"), JSON.stringify({ type, data }) + "\n");
      }
    };
    this.owner = { id: request2.session ?? request2.operation, session, ctx: this.ctx };
    await this.ctx.plugin((ctx2) => {
      ctx2.provide("systemPrompt", {
        tools(provider) {
          providers.add(provider);
          return () => providers.delete(provider);
        },
        section(section) {
          sections.set(section.name, section);
          return () => sections.delete(section.name);
        },
        getSectionOrder() {
          return 0;
        }
      });
      ctx2.provide("agents", { get(id) {
        return id === host2.owner.id ? host2.owner : void 0;
      } });
      ctx2.provide("workingDirectory", { async ensure() {
        return request2.cwd;
      } });
      ctx2.provide("sandboxPolicy", { defaultMode: mode, resolve() {
        return policy;
      } });
      ctx2.provide("sandbox", {
        async confine(argv, requested, signal) {
          signal?.throwIfAborted();
          if (requested.mode !== "workspace-write" || !request2.sandbox_prefix.length) {
            throw new Error("Unsupported Bridge confinement policy");
          }
          return {
            argv: [...request2.sandbox_prefix, ...argv],
            enforcement: process.platform === "win32" ? "partial" : "full",
            denialSignatures: ["access is denied", "access to the path", "permission denied", "operation not permitted"],
            runnerFailureRules: [{ allowedExitCodes: [127], fatalSignatures: ["computer-bridge-sandbox: "] }]
          };
        }
      });
      ctx2.provide("approval", {
        async request(approval) {
          return await new Promise((resolve3) => {
            const cancel = () => {
              host2.pendingApproval = void 0;
              resolve3("cancelled");
            };
            host2.pendingApproval = (decision) => {
              approval.signal?.removeEventListener("abort", cancel);
              resolve3(decision);
            };
            approval.signal?.addEventListener("abort", cancel, { once: true });
            if (approval.signal?.aborted) {
              cancel();
              return;
            }
            host2.send({ event: "approval_requested", reason: approval.reason });
          });
        }
      });
    });
    await this.ctx.plugin(ToolsService);
    await this.ctx.plugin(src_exports);
    await this.ctx.plugin(ShellEnvRegistry);
    await this.ctx.plugin(LocalJobRegistry);
    this.ctx.jobs.attachController("bridge");
    const Executor = process.platform === "win32" ? SandboxPwshExecutor : SandboxBashExecutor;
    class ObservedExecutor extends Executor {
      async execute(spec) {
        try {
          const execution2 = await super.execute(process.platform === "win32" ? {
            ...spec,
            command: "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); " + spec.command
          } : spec);
          host2.execution.resolve(execution2);
          return execution2;
        } catch (error) {
          host2.execution.reject(error);
          throw error;
        }
      }
    }
    void this.execution.promise.catch(() => {
    });
    await this.ctx.plugin(ObservedExecutor, { cwd: request2.cwd, maxOutputBytes: 4096 });
    await this.ctx.plugin(process.platform === "win32" ? src_exports2 : src_exports3);
    const outcome = await this.ctx.tools.execute({
      calls: [{
        type: "tool_call",
        id: request2.operation ?? "bridge-command",
        name: process.platform === "win32" ? "pwsh" : "bash",
        arguments: JSON.stringify({
          command: request2.command,
          workdir: request2.cwd,
          description: request2.description ?? "Execute the requested command in this workspace",
          run_in_background: true,
          ...request2.sandbox_permissions ? { sandbox_permissions: request2.sandbox_permissions } : {},
          ...request2.justification ? { justification: request2.justification } : {}
        })
      }],
      agent: this.owner,
      signal: this.abort.signal
    });
    const result = outcome.results[0]?.result;
    if (!result || result.isError) throw new Error(result?.error.message ?? "DSH command registration failed");
    this.jobId = result.value.jobId;
    if (!this.jobId) throw new Error("DSH command did not return a background job");
    const execution = await this.execution.promise;
    this.send({ event: "job_registered", job_id: this.jobId });
    return execution;
  }
};

// command-runtime.ts
import { closeSync as closeSync4, openSync as openSync4, readFileSync as readFileSync5, writeSync as writeSync2 } from "node:fs";
import { createInterface } from "node:readline";
import { constants as constants5 } from "node:os";
import { Console } from "node:console";
var request = JSON.parse(readFileSync5(process.argv[2], "utf8"));
if (request.protocol !== 1) throw new Error("Unsupported command transport protocol");
var send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
var errorValue = (error) => ({
  code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "command_runtime",
  message: error instanceof Error ? error.message : String(error)
});
var BridgeCommandRuntime = class extends LocalSubprocessRuntime {
  handle;
  outputFailure;
  streams = [];
  recording = true;
  spawn(spec) {
    const out = openSync4(request.stdout_path, "w", 384);
    const err = openSync4(request.stderr_path, "w", 384);
    const collect = (mode, name4, fd) => {
      if (typeof mode === "string") throw new Error("DSH shell must request collected output");
      const result = new OutputCollector(mode.maxBytes, name4);
      this.streams.push({ name: name4, fd, collector: result, size: 0 });
      return result;
    };
    const stdout = collect(spec.stdio.stdout, "stdout", out);
    const stderr = collect(spec.stdio.stderr, "stderr", err);
    const handle = super.spawn({
      ...spec,
      stdio: { ...spec.stdio, stdin: "pipe", stdout: "pipe", stderr: "pipe" }
    });
    this.handle = handle;
    const record = (stream) => (chunk) => {
      try {
        if (this.recording && stream.fd !== void 0) {
          let offset = 0;
          while (offset < chunk.length) offset += writeSync2(stream.fd, chunk, offset, chunk.length - offset);
          stream.size += chunk.length;
        }
        stream.collector.push(chunk);
      } catch (error) {
        stream.error = errorValue(error);
        this.outputFailure ??= error;
        handle.terminate();
      }
    };
    for (const stream of this.streams) {
      const pipe = stream.name === "stdout" ? handle.stdout : handle.stderr;
      pipe.on("data", record(stream));
      pipe.once("end", () => this.closeStream(stream));
      pipe.once("close", () => this.closeStream(stream));
      pipe.once("error", (error) => {
        stream.error = errorValue(error);
        this.closeStream(stream);
      });
    }
    handle.stdin.on("error", () => {
    });
    return { ...handle, collected: { stdout, stderr } };
  }
  seal() {
    this.recording = false;
    for (const stream of this.streams) this.closeStream(stream);
  }
  closeStream(stream) {
    stream.collector.seal();
    if (stream.fd !== void 0) {
      const fd = stream.fd;
      stream.fd = void 0;
      try {
        closeSync4(fd);
      } catch (error) {
        stream.error = errorValue(error);
        this.outputFailure ??= error;
      }
    }
  }
  outputStatus() {
    return Object.fromEntries(this.streams.map((stream) => [stream.name, {
      size: stream.size,
      closed: stream.fd === void 0,
      ...stream.error ? { error: stream.error } : {}
    }]));
  }
  previews() {
    return this.streams.map((stream) => {
      const { bytes, totalBytes } = stream.collector.snapshot();
      let start = 0;
      const truncated = totalBytes > bytes.length;
      if (truncated) {
        while (start < Math.min(3, bytes.length) && (bytes[start] & 192) === 128) start++;
      }
      return { text: bytes.subarray(start).toString("utf8"), truncated, size: totalBytes };
    });
  }
};
var ctx = new cordis_exports.Context();
var runtime;
var host;
var stopping = false;
var settled = false;
var stop = () => {
  stopping = true;
  host?.stop();
  runtime?.handle?.stdin?.destroy(new Error("command stopped"));
  runtime?.handle?.terminate();
};
var input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.once("close", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
var controls = Promise.resolve();
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    send({ error: errorValue(error) });
    return;
  }
  if (message.method === "approval") {
    try {
      if (!["allowed-once", "rejected", "cancelled"].includes(message.decision ?? "")) throw new Error("Invalid approval decision");
      host.decide(message.decision);
      send({ id: message.id, result: { accepted: true } });
    } catch (error) {
      send({ id: message.id, error: errorValue(error) });
    }
    return;
  }
  if (message.method === "stop" || message.method === "shutdown") {
    stop();
    send({ id: message.id, result: { stopping: true } });
    return;
  }
  if (message.method === "release") {
    runtime?.seal();
    send({ id: message.id, result: { released: true } });
    return;
  }
  if (message.method === "output_status") {
    send({ id: message.id, result: runtime?.outputStatus() ?? {} });
    return;
  }
  controls = controls.then(async () => {
    try {
      if (message.method === "input") {
        const stream = runtime?.handle?.stdin;
        if (!stream || stream.destroyed || stream.writableEnded || settled) throw new Error("stdin is unavailable");
        const bytes = Buffer.from(message.text ?? "", "utf8");
        await new Promise((resolve3, reject) => stream.write(bytes, (error) => error ? reject(error) : resolve3()));
        if (message.eof) await new Promise((resolve3, reject) => stream.end((error) => error ? reject(error) : resolve3()));
        send({ id: message.id, result: { written: bytes.length, eof: message.eof === true } });
      } else throw new Error("Unknown command control method");
    } catch (error) {
      send({ id: message.id, error: errorValue(error) });
    }
  });
});
try {
  await ctx.plugin(BridgeCommandRuntime);
  runtime = ctx.subprocess;
  host = new CommandHost(ctx, request, send);
  const execution = await host.start();
  const shell = process.platform === "win32" ? ctx.shell.pwshPath : "bash";
  if (stopping) execution.kill();
  send({ event: "started", shell });
  const result = await execution.result();
  const [stdoutPreview, stderrPreview] = runtime.previews();
  if (runtime.outputFailure !== void 0) throw runtime.outputFailure;
  settled = true;
  runtime.handle?.stdin?.destroy(new Error("command root exited"));
  await controls;
  send({ event: "completed", result: {
    exit_code: result.exitCode ?? (result.signal ? 128 + (constants5.signals[result.signal] ?? 0) : 1),
    shell,
    signal: result.signal,
    stdout_path: request.stdout_path,
    stderr_path: request.stderr_path,
    stdout_preview: { ...result.stdout, text: stdoutPreview.text, truncated: stdoutPreview.truncated },
    stderr_preview: { ...result.stderr, text: stderrPreview.text, truncated: stderrPreview.truncated },
    stdout_preview_size: stdoutPreview.size,
    stderr_preview_size: stderrPreview.size,
    output_status: runtime.outputStatus()
  } });
  await runtime.handle?.waitForExit();
  await ctx.fiber.dispose();
  runtime.seal();
} catch (error) {
  await ctx.fiber.dispose().catch(() => {
  });
  runtime?.seal();
  settled = true;
  send({ event: "failed", error: errorValue(error) });
  process.exitCode = 1;
} finally {
  input.close();
  process.stdin.destroy();
}
