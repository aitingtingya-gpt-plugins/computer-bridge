// runner.ts
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync as existsSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join2 } from "node:path";
import { spawn } from "node:child_process";

// third_party/dsh/packages/sandbox/sandbox/src/roots.ts
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
function canonicalPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
function writableRoots(policy2) {
  if (policy2.mode !== "workspace-write") return [];
  return [...new Set([policy2.workspaceRoot, "/tmp", tmpdir()].map(canonicalPath))];
}

// policy.ts
function writableRoots2(policy2) {
  return [...new Set([policy2.workspaceRoot, ...policy2.additionalRoots || []].flatMap((workspaceRoot) => writableRoots({ ...policy2, workspaceRoot })))];
}

// third_party/dsh/packages/sandbox/sandbox-local/src/profiles.ts
function sbplString(path) {
  return `"${path.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}
function seatbeltProfileArgs(policy2) {
  const forms = ["(version 1)", "(allow default)", "(deny file-write*)", `(allow file-write* (literal ${sbplString("/dev/null")}))`];
  const roots = writableRoots2(policy2);
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`);
  }
  return ["-p", forms.join(" ")];
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/index.ts
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

// third_party/dsh/packages/subprocess/win32-process/src/abi.ts
var STARTF_USESTDHANDLES = 256;
var STARTF_USESHOWWINDOW = 1;
var SW_HIDE = 0;
var HANDLE_FLAG_INHERIT = 1;
var INFINITE = 4294967295;
var CREATE_SUSPENDED = 4;
var STD_INPUT_HANDLE = -10;
var STD_OUTPUT_HANDLE = -11;
var STD_ERROR_HANDLE = -12;
var FORMAT_MESSAGE_FROM_SYSTEM = 4096;
var FORMAT_MESSAGE_IGNORE_INSERTS = 512;
var ERROR_INSUFFICIENT_BUFFER = 122;
var ERROR_BROKEN_PIPE = 109;
var ERROR_NO_DATA = 232;
var JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
var JobObjectExtendedLimitInformation = 9;
var JOBOBJECT_EXTENDED_LIMIT_SIZE = 144;
var JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16;
var STARTUPINFOW_SIZE = 104;
var PROCESS_INFORMATION_SIZE = 24;

// third_party/dsh/packages/subprocess/win32-process/src/errors.ts
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

// third_party/dsh/packages/util/lazy-require/src/index.ts
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

// third_party/dsh/packages/subprocess/win32-process/src/koffi.ts
var requireKoffi = createLazyRequire("koffi", import.meta.url);

// third_party/dsh/packages/subprocess/win32-process/src/ffi.ts
function isNullPtr(value) {
  return value === null || value === void 0 || value === 0n;
}
var cachedTypes;
function win32Types() {
  if (cachedTypes !== void 0) return cachedTypes;
  const koffi = requireKoffi();
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
function allocPtrSlot() {
  const { PVOID } = win32Types();
  return requireKoffi().alloc(PVOID, 1);
}
function allocUint32() {
  return requireKoffi().alloc("uint32", 1);
}
function decodePtr(slot) {
  const value = requireKoffi().decode(slot, win32Types().PVOID);
  return isNullPtr(value) ? null : value;
}
function decodeUint32(slot) {
  return requireKoffi().decode(slot, "uint32");
}
function allocStartupInfo() {
  return requireKoffi().alloc(win32Types().STARTUPINFOW, 1);
}
function encodeStartupInfo(startupInfo, fields) {
  requireKoffi().encode(startupInfo, win32Types().STARTUPINFOW, fields);
}
function allocProcessInfo() {
  return requireKoffi().alloc(win32Types().PROCESS_INFORMATION, 1);
}
function decodeProcessInfo(processInfo) {
  return requireKoffi().decode(processInfo, win32Types().PROCESS_INFORMATION);
}
var cachedContext;
var cached;
function bindingContext() {
  if (cachedContext !== void 0) return cachedContext;
  const koffi = requireKoffi();
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
  cachedContext = { kernel32, advapi32, bind };
  return cachedContext;
}
function bindings() {
  if (cached !== void 0) return cached;
  const koffi = requireKoffi();
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
function extendWin32ProcessBindings(create) {
  return { ...bindings(), ...create(bindingContext()) };
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

// third_party/dsh/packages/subprocess/win32-process/src/control-stdio.ts
var HANDLE_BYTES = 8;
var INVALID_HANDLE = 0xffffffffffffffffn;
var FOPEN = 1;
var FPIPE = 8;
var FDEV = 64;
var FILE_TYPE_CHAR = 2;
var FILE_TYPE_PIPE = 3;
function inheritedControlStdio(api, stdio) {
  const count = stdio.control.fileDescriptor + 1;
  const handleOffset = 4 + count;
  const bytes = Buffer.alloc(handleOffset + count * HANDLE_BYTES);
  bytes.writeUInt32LE(count, 0);
  for (let index = 0; index < count; index++) {
    bytes.writeBigUInt64LE(INVALID_HANDLE, handleOffset + index * HANDLE_BYTES);
  }
  const entries = [[0, stdio.stdin], [1, stdio.stdout], [2, stdio.stderr], [stdio.control.fileDescriptor, stdio.control.handle]];
  for (const [fd, handle] of entries) {
    const kind = api.getFileType(handle);
    if (fd === stdio.control.fileDescriptor && kind !== FILE_TYPE_PIPE) {
      throw new Error("subprocess control descriptor is not a Windows pipe");
    }
    bytes[4 + fd] = FOPEN | (kind === FILE_TYPE_PIPE ? FPIPE : kind === FILE_TYPE_CHAR ? FDEV : 0);
    bytes.writeBigUInt64LE(handle, handleOffset + fd * HANDLE_BYTES);
  }
  return bytes;
}

// third_party/dsh/packages/subprocess/win32-process/src/process.ts
function quoteArg(argument) {
  if (argument === "") return '""';
  if (!/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  for (let index = 0; index < argument.length; index++) {
    let backslashes = 0;
    while (index < argument.length && argument.charAt(index) === "\\") {
      backslashes += 1;
      index += 1;
    }
    if (index === argument.length) {
      quoted += "\\".repeat(backslashes * 2);
    } else if (argument.charAt(index) === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      quoted += "\\".repeat(backslashes) + argument.charAt(index);
    }
  }
  return quoted + '"';
}
function buildCommandLine(program, args) {
  return [program, ...args].map(quoteArg).join(" ");
}
function freeNative(pointer) {
  if (pointer !== void 0) requireKoffi().free(pointer);
}
function closeBestEffort(api, handle) {
  if (!isNullPtr(handle)) api.closeHandle(handle);
}
function createPipe(api, owned) {
  const readSlot = allocPtrSlot();
  let writeSlot;
  try {
    writeSlot = allocPtrSlot();
    if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, "CreatePipe");
    const read = decodePtr(readSlot);
    const write = decodePtr(writeSlot);
    if (read === null || write === null) {
      closeBestEffort(api, read);
      closeBestEffort(api, write);
      throwLastError(api, "CreatePipe", "null pipe handle");
    }
    owned.add(read);
    owned.add(write);
    return { read, write };
  } finally {
    freeNative(writeSlot);
    requireKoffi().free(readSlot);
  }
}
function closeOwned(api, owned, handle) {
  if (!owned.delete(handle)) return;
  api.closeHandle(handle);
}
function closeAllOwned(api, owned) {
  for (const handle of owned) api.closeHandle(handle);
  owned.clear();
}
function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {
  return api.createProcessAsUserW(
    options.token,
    null,
    commandLine,
    null,
    null,
    1,
    creationFlags,
    null,
    options.cwd,
    startupInfo,
    processInfo
  );
}
function spawnPipedProcess(api, options) {
  const owned = /* @__PURE__ */ new Set();
  let startupInfo;
  let processInfo;
  try {
    const stdIn = createPipe(api, owned);
    const stdOut = createPipe(api, owned);
    const stdErr = createPipe(api, owned);
    for (const [handle, label] of [
      [stdIn.read, "stdin read end"],
      [stdOut.write, "stdout write end"],
      [stdErr.write, "stderr write end"]
    ]) {
      if (api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, "SetHandleInformation", label);
      }
    }
    startupInfo = allocStartupInfo();
    encodeStartupInfo(startupInfo, {
      cb: STARTUPINFOW_SIZE,
      dwFlags: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
      wShowWindow: SW_HIDE,
      hStdInput: stdIn.read,
      hStdOutput: stdOut.write,
      hStdError: stdErr.write
    });
    processInfo = allocProcessInfo();
    const created = createRestrictedProcess(
      api,
      options,
      buildCommandLine(options.command, options.args),
      0,
      startupInfo,
      processInfo
    );
    if (created === 0) {
      const win32Code = api.getLastError();
      throwWin32(api, "CreateProcessAsUserW", win32Code, `command: ${options.command}, cwd: ${options.cwd}`);
    }
    const info = decodeProcessInfo(processInfo);
    if (info.hProcess === null || info.hThread === null) {
      if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1);
      closeBestEffort(api, info.hThread);
      closeBestEffort(api, info.hProcess);
      throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
    }
    closeOwned(api, owned, stdIn.read);
    closeOwned(api, owned, stdIn.write);
    closeOwned(api, owned, stdOut.write);
    closeOwned(api, owned, stdErr.write);
    closeBestEffort(api, info.hThread);
    owned.delete(stdOut.read);
    owned.delete(stdErr.read);
    return {
      pid: info.dwProcessId,
      process: info.hProcess,
      stdoutRead: stdOut.read,
      stderrRead: stdErr.read
    };
  } catch (error) {
    closeAllOwned(api, owned);
    throw error;
  } finally {
    freeNative(processInfo);
    freeNative(startupInfo);
  }
}
async function drainPipe(api, handle) {
  const chunks = [];
  let countSlot;
  try {
    countSlot = allocUint32();
    for (; ; ) {
      const peeked = api.peekNamedPipe(handle, null, 0, null, countSlot, null);
      if (peeked === 0) {
        const win32Code = api.getLastError();
        if (win32Code === ERROR_BROKEN_PIPE || win32Code === ERROR_NO_DATA) break;
        throwLastError(api, "PeekNamedPipe", `drain failure after ${chunks.length} chunk(s)`);
      }
      const available = decodeUint32(countSlot);
      if (available > 0) {
        const chunk = Buffer.alloc(available);
        if (api.readFile(handle, chunk, chunk.length, countSlot, null) === 0) {
          throwLastError(api, "ReadFile", `drain failure after ${chunks.length} chunk(s)`);
        }
        chunks.push(chunk.subarray(0, decodeUint32(countSlot)));
      }
      await new Promise((resolve2) => setTimeout(resolve2, 1));
    }
    return Buffer.concat(chunks);
  } finally {
    freeNative(countSlot);
    api.closeHandle(handle);
  }
}
function waitForProcessExit(api, process2) {
  let exitCodeSlot;
  try {
    if (api.waitForSingleObject(process2, INFINITE) === 4294967295) {
      throwLastError(api, "WaitForSingleObject");
    }
    exitCodeSlot = allocUint32();
    if (api.getExitCodeProcess(process2, exitCodeSlot) === 0) throwLastError(api, "GetExitCodeProcess");
    return decodeUint32(exitCodeSlot);
  } finally {
    freeNative(exitCodeSlot);
    api.closeHandle(process2);
  }
}
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
var UV_INVALID_OS_FILE_HANDLE = 0xffffffffffffffffn;
var UV_INVALID_FILE_DESCRIPTOR = 0xfffffffffffffffen;
function inheritedStandardHandles(api, controlFileDescriptor) {
  const get = (selector, label) => {
    const handle = api.getStdHandle(selector);
    if (!isNullPtr(handle)) return handle;
    throwLastError(api, "GetStdHandle", `null ${label} handle`);
  };
  return {
    stdin: get(STD_INPUT_HANDLE, "stdin"),
    stdout: get(STD_OUTPUT_HANDLE, "stdout"),
    stderr: get(STD_ERROR_HANDLE, "stderr"),
    ...controlFileDescriptor === void 0 ? {} : {
      control: { fileDescriptor: controlFileDescriptor, handle: descriptorHandle(api, controlFileDescriptor, "control") }
    }
  };
}
function descriptorHandle(api, fileDescriptor, label) {
  const handle = api.uvGetOsfhandle(fileDescriptor);
  if (isNullPtr(handle) || handle === UV_INVALID_OS_FILE_HANDLE || handle === UV_INVALID_FILE_DESCRIPTOR) {
    throw new Error(`uv_get_osfhandle returned an invalid handle for target ${label} fd ${String(fileDescriptor)}`);
  }
  return handle;
}
function spawnJobProcess(api, options, resolveStdio, createName, create) {
  const job = createKillOnCloseJob(api);
  const enabled = [];
  let startupInfo;
  let processInfo;
  let controlDescriptorBlock;
  let created = 0;
  let createFailureCode = 0;
  try {
    const stdio = resolveStdio();
    const inherited = [
      [stdio.stdin, "stdin"],
      [stdio.stdout, "stdout"],
      [stdio.stderr, "stderr"]
    ];
    if (stdio.control !== void 0) inherited.push([stdio.control.handle, "control"]);
    for (const [handle, label] of inherited) {
      if (api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, "SetHandleInformation", `${label} (enable inherit)`);
      }
      enabled.push(handle);
    }
    const controlBytes = stdio.control === void 0 ? void 0 : inheritedControlStdio(api, { ...stdio, control: stdio.control });
    if (controlBytes !== void 0) {
      const koffi = requireKoffi();
      controlDescriptorBlock = { pointer: koffi.alloc("uint8", controlBytes.length), length: controlBytes.length };
      koffi.encode(controlDescriptorBlock.pointer, "uint8", controlBytes, controlBytes.length);
    }
    startupInfo = allocStartupInfo();
    encodeStartupInfo(startupInfo, {
      cb: STARTUPINFOW_SIZE,
      // Preserve console inheritance: CREATE_NO_WINDOW can fail restricted-token DLL initialization.
      dwFlags: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
      wShowWindow: SW_HIDE,
      hStdInput: stdio.stdin,
      hStdOutput: stdio.stdout,
      hStdError: stdio.stderr,
      ...controlDescriptorBlock === void 0 ? {} : {
        cbReserved2: controlDescriptorBlock.length,
        lpReserved2: controlDescriptorBlock.pointer
      }
    });
    processInfo = allocProcessInfo();
    created = create(startupInfo, processInfo);
    if (created === 0) createFailureCode = api.getLastError();
  } catch (error) {
    freeNative(processInfo);
    api.closeHandle(job);
    throw error;
  } finally {
    freeNative(startupInfo);
    freeNative(controlDescriptorBlock?.pointer);
    for (const handle of enabled) {
      api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
    }
  }
  if (created === 0) {
    freeNative(processInfo);
    api.closeHandle(job);
    throwWin32(
      api,
      createName,
      createFailureCode,
      `command: ${options.command}, cwd: ${options.cwd}`
    );
  }
  let info;
  try {
    info = decodeProcessInfo(processInfo);
  } finally {
    freeNative(processInfo);
  }
  if (info.hProcess === null || info.hThread === null) {
    if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1);
    api.closeHandle(job);
    closeBestEffort(api, info.hThread);
    closeBestEffort(api, info.hProcess);
    throw new Error(`${createName} succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
  }
  if (api.assignProcessToJobObject(job, info.hProcess) === 0) {
    const win32Code = api.getLastError();
    api.terminateProcess(info.hProcess, 1);
    closeBestEffort(api, info.hThread);
    closeBestEffort(api, info.hProcess);
    api.closeHandle(job);
    throwWin32(api, "AssignProcessToJobObject", win32Code, `pid ${info.dwProcessId}`);
  }
  if (api.resumeThread(info.hThread) === 4294967295) {
    const win32Code = api.getLastError();
    closeBestEffort(api, info.hThread);
    closeBestEffort(api, info.hProcess);
    api.closeHandle(job);
    throwWin32(api, "ResumeThread", win32Code, `pid ${info.dwProcessId}`);
  }
  closeBestEffort(api, info.hThread);
  return { pid: info.dwProcessId, process: info.hProcess, job };
}
function spawnInheritedJobProcess(api, options) {
  const commandLine = buildCommandLine(options.command, options.args);
  return spawnJobProcess(api, options, () => inheritedStandardHandles(api, options.controlFileDescriptor), "CreateProcessAsUserW", (startupInfo, processInfo) => createRestrictedProcess(
    api,
    options,
    commandLine,
    CREATE_SUSPENDED,
    startupInfo,
    processInfo
  ));
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/acl.ts
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/win32-abi.ts
var PROCESS_QUERY_INFORMATION = 1024;
var TOKEN_ASSIGN_PRIMARY = 1;
var TOKEN_DUPLICATE = 2;
var TOKEN_QUERY = 8;
var TOKEN_ADJUST_DEFAULT = 128;
var SE_GROUP_LOGON_ID = 3221225472;
var STANDARD_RIGHTS_WRITE = 131072;
var FILE_GENERIC_WRITE = 1179926;
var DELETE = 65536;
var FILE_DELETE_CHILD = 64;
var GRANT_MASK = (FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD) & ~STANDARD_RIGHTS_WRITE;
var FILE_ALL_ACCESS = 2032127;
var DISABLE_MAX_PRIVILEGE = 1;
var WRITE_RESTRICTED = 8;
var WinWorldSid = 1;
var TokenGroups = 2;
var TokenDefaultDacl = 6;
var DACL_SECURITY_INFORMATION = 4;
var LABEL_SECURITY_INFORMATION = 16;
var SYSTEM_MANDATORY_LABEL_ACE_TYPE = 17;
var SYSTEM_MANDATORY_LABEL_NO_WRITE_UP = 1;
var TokenIntegrityLevel = 25;
var SE_GROUP_INTEGRITY = 32;
var WinLowLabelSid = 66;
var TOKEN_MANDATORY_LABEL_SIZE = 16;
var ACL_HEADER_SIZE = 8;
var MANDATORY_ACE_OVERHEAD = 8;
var ACL_REVISION = 2;
var LPTR = 64;
var SE_FILE_OBJECT = 1;
var TRUSTEE_IS_UNKNOWN = 0;
var TRUSTEE_IS_SID = 0;
var NO_MULTIPLE_TRUSTEE = 0;
var GRANT_ACCESS = 1;
var DENY_ACCESS = 3;
var REVOKE_ACCESS = 4;
var SUB_CONTAINERS_AND_OBJECTS_INHERIT = 3;
var CONTAINER_INHERIT_ACE = 2;
var MAX_PATH = 260;
var ERROR_SUCCESS = 0;
var GENERIC_READ = 2147483648;
var GENERIC_WRITE = 1073741824;
var FILE_SHARE_READ = 1;
var FILE_SHARE_WRITE = 2;
var OPEN_ALWAYS = 4;
var LOCKFILE_EXCLUSIVE_LOCK = 2;
var ACCESS_ALLOWED_ACE_TYPE = 0;
var ACCESS_DENIED_ACE_TYPE = 1;
var SID_MAX_SUB_AUTHORITIES = 15;
var SECURITY_MAX_SID_SIZE = 68;
var SID_AND_ATTRIBUTES_SIZE = 16;
var TOKEN_GROUPS_OFFSET = 8;
var EXPLICIT_ACCESS_W_SIZE = 48;

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/ffi.ts
var requireKoffi2 = createLazyRequire("koffi", import.meta.url);
var cachedTypes2;
function ffiTypes() {
  if (cachedTypes2 !== void 0) return cachedTypes2;
  const koffi = requireKoffi2();
  const PVOID = koffi.pointer("void");
  return cachedTypes2 = { PVOID, PPVOID: koffi.pointer(PVOID) };
}
function isInvalidHandle(handle) {
  if (isNullPtr(handle)) return true;
  return handle === 0xFFFFFFFFFFFFFFFFn || handle === -1n;
}
function encodeUint32(slot, value) {
  requireKoffi2().encode(slot, "uint32", value);
}
function ptrAddress(ptr) {
  return requireKoffi2().address(ptr);
}
function allocBytes(length) {
  return requireKoffi2().alloc("uint8", length);
}
function allocOverlapped() {
  return allocBytes(32);
}
function decodePtrAt(buffer, offset) {
  const value = requireKoffi2().decode(buffer, offset, ffiTypes().PVOID);
  return isNullPtr(value) ? null : value;
}
function decodeUint8At(ptr, offset) {
  return requireKoffi2().decode(ptr, offset, "uint8");
}
function decodeUint16At(ptr, offset) {
  return requireKoffi2().decode(ptr, offset, "uint16");
}
function decodeUint32At(ptr, offset) {
  return requireKoffi2().decode(ptr, offset, "uint32");
}
function sameSidAt(left, leftOffset, right, rightOffset) {
  if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset)) return false;
  const leftCount = decodeUint8At(left, leftOffset + 1);
  const rightCount = decodeUint8At(right, rightOffset + 1);
  if (leftCount !== rightCount || leftCount > SID_MAX_SUB_AUTHORITIES) return false;
  for (let index = 0; index < 6; index += 1) {
    if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) {
      return false;
    }
  }
  for (let index = 0; index < leftCount; index += 1) {
    if (decodeUint32At(left, leftOffset + 8 + index * 4) !== decodeUint32At(right, rightOffset + 8 + index * 4)) return false;
  }
  return true;
}
var cached2;
function bindings2() {
  if (cached2 !== void 0) return cached2;
  const koffi = requireKoffi2();
  const { PVOID, PPVOID } = ffiTypes();
  cached2 = extendWin32ProcessBindings(({ kernel32, advapi32, bind }) => ({
    openProcess: bind(kernel32, "OpenProcess", PVOID, ["uint32", "int", "uint32"]),
    openProcessToken: bind(advapi32, "OpenProcessToken", "int", [PVOID, "uint32", PPVOID]),
    localAlloc: bind(kernel32, "LocalAlloc", PVOID, ["uint32", "size_t"]),
    localFree: bind(kernel32, "LocalFree", PVOID, [PVOID]),
    convertStringSidToSidW: bind(advapi32, "ConvertStringSidToSidW", "int", ["str16", PPVOID]),
    createWellKnownSid: bind(advapi32, "CreateWellKnownSid", "int", [
      "int",
      PVOID,
      PVOID,
      koffi.pointer("uint32")
    ]),
    isValidSid: bind(advapi32, "IsValidSid", "int", [PVOID]),
    getLengthSid: bind(advapi32, "GetLengthSid", "uint32", [PVOID]),
    copySid: bind(advapi32, "CopySid", "int", ["uint32", PVOID, PVOID]),
    getTokenInformation: bind(advapi32, "GetTokenInformation", "int", [
      PVOID,
      "int",
      PVOID,
      "uint32",
      koffi.pointer("uint32")
    ]),
    setTokenInformation: bind(advapi32, "SetTokenInformation", "int", [PVOID, "int", PVOID, "uint32"]),
    createRestrictedToken: bind(advapi32, "CreateRestrictedToken", "int", [
      PVOID,
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      PVOID,
      "uint32",
      PVOID,
      PPVOID
    ]),
    setEntriesInAclW: bind(advapi32, "SetEntriesInAclW", "uint32", ["uint32", PVOID, PVOID, PPVOID]),
    initializeAcl: bind(advapi32, "InitializeAcl", "int", [PVOID, "uint32", "uint32"]),
    addMandatoryAce: bind(advapi32, "AddMandatoryAce", "int", [PVOID, "uint32", "uint32", "uint32", PVOID]),
    setNamedSecurityInfoW: bind(advapi32, "SetNamedSecurityInfoW", "uint32", [
      "str16",
      "int",
      "uint32",
      PVOID,
      PVOID,
      PVOID,
      PVOID
    ]),
    getNamedSecurityInfoW: bind(advapi32, "GetNamedSecurityInfoW", "uint32", [
      "str16",
      "int",
      "uint32",
      PPVOID,
      PPVOID,
      PPVOID,
      PPVOID,
      PPVOID
    ]),
    getTempPathW: bind(kernel32, "GetTempPathW", "uint32", ["uint32", PVOID]),
    setEnvironmentVariableW: bind(kernel32, "SetEnvironmentVariableW", "int", ["str16", "str16"]),
    setConsoleCtrlHandler: bind(kernel32, "SetConsoleCtrlHandler", "int", [PVOID, "int"]),
    createFileW: bind(kernel32, "CreateFileW", PVOID, [
      "str16",
      "uint32",
      "uint32",
      PVOID,
      "uint32",
      "uint32",
      PVOID
    ]),
    lockFileEx: bind(kernel32, "LockFileEx", "int", [
      PVOID,
      "uint32",
      "uint32",
      "uint32",
      "uint32",
      PVOID
    ]),
    unlockFileEx: bind(kernel32, "UnlockFileEx", "int", [
      PVOID,
      "uint32",
      "uint32",
      "uint32",
      PVOID
    ])
  }));
  return cached2;
}
function win32() {
  return Promise.resolve(bindings2());
}
function win32Sync() {
  return bindings2();
}
function getTempPath(api) {
  const buffer = Buffer.alloc((MAX_PATH + 1) * 2);
  const length = api.getTempPathW(buffer.length / 2, buffer);
  if (length === 0) throwLastError(api, "GetTempPathW");
  if (length > buffer.length / 2) {
    throw new Win32Error(
      "GetTempPathW",
      ERROR_INSUFFICIENT_BUFFER,
      `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`
    );
  }
  return buffer.subarray(0, length * 2).toString("utf16le");
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/acl.ts
function buildExplicitAccess(sidPtr, mode, permissions, inheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT) {
  const entry = Buffer.alloc(EXPLICIT_ACCESS_W_SIZE);
  entry.writeUInt32LE(permissions, 0);
  entry.writeUInt32LE(mode, 4);
  entry.writeUInt32LE(inheritance, 8);
  entry.writeUInt32LE(NO_MULTIPLE_TRUSTEE, 24);
  entry.writeUInt32LE(TRUSTEE_IS_SID, 28);
  entry.writeUInt32LE(TRUSTEE_IS_UNKNOWN, 32);
  entry.writeBigUInt64LE(ptrAddress(sidPtr), 40);
  return entry;
}
function lockFilePath(api, path) {
  const digest = createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 16);
  return join(getTempPath(api), "dsh-acl-locks", `${digest}.lock`);
}
function withPathLock(api, path, action) {
  const lockPath = lockFilePath(api, path);
  mkdirSync(dirname(lockPath), { recursive: true });
  const handle = api.createFileW(
    lockPath,
    GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_ALWAYS,
    0,
    null
  );
  if (isInvalidHandle(handle)) throwLastError(api, "CreateFileW", lockPath);
  const overlapped = allocOverlapped();
  if (api.lockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, overlapped) === 0) {
    const win32Code = api.getLastError();
    api.closeHandle(handle);
    throwWin32(api, "LockFileEx", win32Code, lockPath);
  }
  let result;
  try {
    result = action();
  } catch (error) {
    api.unlockFileEx(handle, 0, 1, 0, overlapped);
    api.closeHandle(handle);
    throw error;
  }
  if (api.unlockFileEx(handle, 0, 1, 0, overlapped) === 0) {
    const win32Code = api.getLastError();
    api.closeHandle(handle);
    throwWin32(api, "UnlockFileEx", win32Code, lockPath);
  }
  if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", `lock file ${lockPath}`);
  return result;
}
function readCurrentSecurity(api, path) {
  const ownerSlot = allocPtrSlot();
  const groupSlot = allocPtrSlot();
  const daclSlot = allocPtrSlot();
  const saclSlot = allocPtrSlot();
  const descriptorSlot = allocPtrSlot();
  const readResult = api.getNamedSecurityInfoW(
    path,
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
    ownerSlot,
    groupSlot,
    daclSlot,
    saclSlot,
    descriptorSlot
  );
  if (readResult !== ERROR_SUCCESS) throwWin32(api, "GetNamedSecurityInfoW", readResult, path);
  return { oldAcl: decodePtr(daclSlot), labelAcl: decodePtr(saclSlot), descriptor: decodePtr(descriptorSlot) };
}
function buildLowLabelAcl(api, lowLabelSidPtr) {
  const sidLength = api.getLengthSid(lowLabelSidPtr);
  if (sidLength === 0) throwLastError(api, "GetLengthSid", "Low mandatory label SID");
  const aclLength = ACL_HEADER_SIZE + MANDATORY_ACE_OVERHEAD + sidLength;
  const acl = api.localAlloc(LPTR, aclLength);
  if (isNullPtr(acl)) throwLastError(api, "LocalAlloc", "Low mandatory label ACL");
  if (api.initializeAcl(acl, aclLength, ACL_REVISION) === 0) {
    const win32Code = api.getLastError();
    api.localFree(acl);
    throwWin32(api, "InitializeAcl", win32Code, "Low mandatory label ACL");
  }
  if (api.addMandatoryAce(
    acl,
    ACL_REVISION,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
    lowLabelSidPtr
  ) === 0) {
    const win32Code = api.getLastError();
    api.localFree(acl);
    throwWin32(api, "AddMandatoryAce", win32Code, "Low mandatory label ACL");
  }
  return acl;
}
function hasExactLabel(labelAcl, lowLabelSidPtr) {
  return hasExactEntry(
    labelAcl,
    SYSTEM_MANDATORY_LABEL_ACE_TYPE,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
    lowLabelSidPtr
  );
}
function mergeAndApply(api, path, entries, oldAcl, labelEdit, descriptor, label) {
  const newAclSlot = allocPtrSlot();
  const mergeResult = api.setEntriesInAclW(entries.length / EXPLICIT_ACCESS_W_SIZE, entries, oldAcl, newAclSlot);
  if (mergeResult !== ERROR_SUCCESS) {
    if (descriptor !== null) api.localFree(descriptor);
    if (labelEdit.kind === "apply") api.localFree(labelEdit.acl);
    throwWin32(api, "SetEntriesInAclW", mergeResult, `${label}(${path})`);
  }
  const newAcl = decodePtr(newAclSlot);
  if (newAcl === null) {
    if (descriptor !== null) api.localFree(descriptor);
    if (labelEdit.kind === "apply") api.localFree(labelEdit.acl);
    throwWin32(api, "SetEntriesInAclW", api.getLastError(), `${label}(${path}): null new ACL`);
  }
  const freedDescriptor = descriptor !== null ? api.localFree(descriptor) : null;
  const applyResult = api.setNamedSecurityInfoW(
    path,
    SE_FILE_OBJECT,
    labelEdit.kind === "keep" ? DACL_SECURITY_INFORMATION : DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
    null,
    null,
    newAcl,
    labelEdit.kind === "apply" ? labelEdit.acl : null
  );
  const freedNew = api.localFree(newAcl);
  const freedLabel = labelEdit.kind === "apply" ? api.localFree(labelEdit.acl) : null;
  if (applyResult !== ERROR_SUCCESS) throwWin32(api, "SetNamedSecurityInfoW", applyResult, `${label}(${path})`);
  if (freedDescriptor !== null && !isNullPtr(freedDescriptor)) throwLastError(api, "LocalFree", `${label}(${path}) descriptor`);
  if (!isNullPtr(freedNew)) throwLastError(api, "LocalFree", `${label}(${path}) new ACL`);
  if (freedLabel !== null && !isNullPtr(freedLabel)) throwLastError(api, "LocalFree", `${label}(${path}) label ACL`);
}
function hasExactEntry(acl, aceType, inheritance, mask, sidPtr) {
  const aclSize = decodeUint16At(acl, 2);
  const aceCount = decodeUint16At(acl, 4);
  if (aclSize < 8 || aclSize > 1048576) return false;
  let offset = 8;
  for (let index = 0; index < aceCount; index++) {
    const aceSize = decodeUint16At(acl, offset + 2);
    if (aceSize < 8 || offset + aceSize > aclSize) return false;
    const exact = decodeUint8At(acl, offset) === aceType && decodeUint8At(acl, offset + 1) === inheritance && decodeUint32At(acl, offset + 4) === mask;
    if (exact && sameSidAt(acl, offset + 8, sidPtr, 0)) return true;
    offset += aceSize;
  }
  return false;
}
function hasExactGrant(oldAcl, sidPtr) {
  return hasExactEntry(oldAcl, ACCESS_ALLOWED_ACE_TYPE, SUB_CONTAINERS_AND_OBJECTS_INHERIT, GRANT_MASK, sidPtr);
}
function hasExactDeny(oldAcl, worldSidPtr) {
  return hasExactEntry(oldAcl, ACCESS_DENIED_ACE_TYPE, CONTAINER_INHERIT_ACE, FILE_DELETE_CHILD, worldSidPtr);
}
function hasForeignGrant(oldAcl, sidPtr) {
  const aclSize = decodeUint16At(oldAcl, 2);
  const aceCount = decodeUint16At(oldAcl, 4);
  if (aclSize < 8 || aclSize > 1048576) return false;
  let offset = 8;
  for (let index = 0; index < aceCount; index++) {
    const aceSize = decodeUint16At(oldAcl, offset + 2);
    if (aceSize < 8 || offset + aceSize > aclSize) return false;
    const isGrant = decodeUint8At(oldAcl, offset) === ACCESS_ALLOWED_ACE_TYPE && decodeUint32At(oldAcl, offset + 4) === GRANT_MASK;
    if (isGrant && !sameSidAt(oldAcl, offset + 8, sidPtr, 0)) return true;
    offset += aceSize;
  }
  return false;
}
function grantWrite(api, path, sidPtr, lowLabelSidPtr, worldSidPtr) {
  withPathLock(api, path, () => {
    const { oldAcl, labelAcl, descriptor } = readCurrentSecurity(api, path);
    if (oldAcl !== null && labelAcl !== null && hasExactGrant(oldAcl, sidPtr) && hasExactDeny(oldAcl, worldSidPtr) && hasExactLabel(labelAcl, lowLabelSidPtr)) {
      if (descriptor !== null) {
        const freed = api.localFree(descriptor);
        if (!isNullPtr(freed)) throwLastError(api, "LocalFree", `grantWrite(${path}) descriptor`);
      }
      return;
    }
    let label;
    try {
      label = buildLowLabelAcl(api, lowLabelSidPtr);
    } catch (error) {
      if (descriptor !== null) api.localFree(descriptor);
      throw error;
    }
    mergeAndApply(
      api,
      path,
      Buffer.concat([
        buildExplicitAccess(worldSidPtr, DENY_ACCESS, FILE_DELETE_CHILD, CONTAINER_INHERIT_ACE),
        buildExplicitAccess(sidPtr, GRANT_ACCESS, GRANT_MASK)
      ]),
      oldAcl,
      { kind: "apply", acl: label },
      descriptor,
      "grantWrite"
    );
  });
}
function revokeWrite(api, path, sidPtr) {
  return withPathLock(api, path, () => {
    const { oldAcl, descriptor } = readCurrentSecurity(api, path);
    if (oldAcl === null) {
      if (descriptor !== null) {
        const freed = api.localFree(descriptor);
        if (!isNullPtr(freed)) throwLastError(api, "LocalFree", `revokeWrite(${path}) descriptor`);
      }
      return false;
    }
    mergeAndApply(
      api,
      path,
      buildExplicitAccess(sidPtr, REVOKE_ACCESS, 0),
      oldAcl,
      hasForeignGrant(oldAcl, sidPtr) ? { kind: "keep" } : { kind: "clear" },
      descriptor,
      "revokeWrite"
    );
    return true;
  });
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/path-boundary.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
function containsDirectory(root, candidate) {
  const relation = relative(realpathSync2.native(root), realpathSync2.native(candidate));
  return relation === "" || !isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`);
}
function assertPrivateTempDisjoint(writableDirs, tempDir) {
  for (const writableDir of writableDirs) {
    if (containsDirectory(writableDir, tempDir) || containsDirectory(tempDir, writableDir)) {
      throw new Error(`AclSandbox private temp directory must be disjoint from writable directories: writable=${writableDir}; temp=${tempDir}`);
    }
  }
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/spawn.ts
function spawnSandboxed(api, token, options) {
  return spawnPipedProcess(api, { ...options, token });
}
function spawnSandboxedInherited(api, token, options) {
  return spawnInheritedJobProcess(api, { ...options, token });
}
function waitForExit(api, process2) {
  return waitForProcessExit(api, process2);
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/token.ts
function openCurrentProcessToken(api) {
  const processHandle = api.openProcess(PROCESS_QUERY_INFORMATION, 0, process.pid);
  if (isNullPtr(processHandle)) throwLastError(api, "OpenProcess", `pid ${process.pid}`);
  const tokenSlot = allocPtrSlot();
  const opened = api.openProcessToken(
    processHandle,
    TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY,
    tokenSlot
  );
  if (opened === 0) {
    const win32Code = api.getLastError();
    api.closeHandle(processHandle);
    throwWin32(api, "OpenProcessToken", win32Code, `pid ${process.pid}`);
  }
  if (api.closeHandle(processHandle) === 0) throwLastError(api, "CloseHandle", "OpenProcess process handle");
  const token = decodePtr(tokenSlot);
  if (token === null) throwWin32(api, "OpenProcessToken", api.getLastError(), "null token handle");
  return token;
}
function findLogonSid(api, token) {
  const neededSlot = allocUint32();
  api.getTokenInformation(token, TokenGroups, null, 0, neededSlot);
  const needed = decodeUint32(neededSlot);
  if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenGroups size query");
  if (needed < TOKEN_GROUPS_OFFSET) throwWin32(api, "GetTokenInformation", api.getLastError(), `implausible TokenGroups size ${needed}`);
  const groups = Buffer.alloc(needed);
  if (api.getTokenInformation(token, TokenGroups, groups, groups.length, neededSlot) === 0) {
    throwLastError(api, "GetTokenInformation", "TokenGroups");
  }
  const groupCount = groups.readUInt32LE(0);
  for (let index = 0; index < groupCount; index++) {
    const sidPtr = decodePtrAt(groups, TOKEN_GROUPS_OFFSET + index * SID_AND_ATTRIBUTES_SIZE);
    const attributes = groups.readUInt32LE(TOKEN_GROUPS_OFFSET + index * SID_AND_ATTRIBUTES_SIZE + 8);
    const isLogonId = (attributes & SE_GROUP_LOGON_ID) >>> 0 === SE_GROUP_LOGON_ID >>> 0;
    if (sidPtr === null || !isLogonId) continue;
    const sidLength = api.getLengthSid(sidPtr);
    if (sidLength === 0) throwLastError(api, "GetLengthSid", `logon SID group ${index}`);
    const copy = allocBytes(sidLength);
    if (api.copySid(sidLength, copy, sidPtr) === 0) throwLastError(api, "CopySid", `logon SID group ${index}`);
    return copy;
  }
  throw new Error(`CreateRestrictedToken prerequisite failed: no logon SID found among ${groupCount} token groups`);
}
function makeWellKnownSid(api, type) {
  const sid = allocBytes(SECURITY_MAX_SID_SIZE);
  const sizeSlot = allocUint32();
  encodeUint32(sizeSlot, SECURITY_MAX_SID_SIZE);
  if (api.createWellKnownSid(type, null, sid, sizeSlot) === 0) {
    throwLastError(api, "CreateWellKnownSid", `type ${type}`);
  }
  if (api.isValidSid(sid) === 0) throwLastError(api, "IsValidSid", `CreateWellKnownSid type ${type}`);
  return sid;
}
function setTokenDefaultDaclGrant(api, token, sidPtr) {
  const neededSlot = allocUint32();
  api.getTokenInformation(token, TokenDefaultDacl, null, 0, neededSlot);
  const needed = decodeUint32(neededSlot);
  if (needed === 0) throwLastError(api, "GetTokenInformation", "TokenDefaultDacl size query");
  const buffer = Buffer.alloc(needed);
  if (api.getTokenInformation(token, TokenDefaultDacl, buffer, buffer.length, neededSlot) === 0) {
    throwLastError(api, "GetTokenInformation", "TokenDefaultDacl");
  }
  const currentDacl = decodePtrAt(buffer, 0);
  if (currentDacl === null) {
    throw new Error("setTokenDefaultDaclGrant: the token carries no default DACL to extend");
  }
  const newDaclSlot = allocPtrSlot();
  const result = api.setEntriesInAclW(
    1,
    buildExplicitAccess(sidPtr, GRANT_ACCESS, FILE_ALL_ACCESS),
    currentDacl,
    newDaclSlot
  );
  if (result !== ERROR_SUCCESS) throwWin32(api, "SetEntriesInAclW", result, "default DACL merge");
  const newDacl = decodePtr(newDaclSlot);
  if (newDacl === null) throwWin32(api, "SetEntriesInAclW", result, "null merged default DACL");
  const info = Buffer.alloc(8);
  info.writeBigUInt64LE(newDacl, 0);
  if (api.setTokenInformation(token, TokenDefaultDacl, info, info.length) === 0) {
    const win32Code = api.getLastError();
    api.localFree(newDacl);
    throwWin32(api, "SetTokenInformation", win32Code, "TokenDefaultDacl");
  }
  api.localFree(newDacl);
}
function restrictTokenIntegrity(api, token, lowLabelSidPtr) {
  const sidLength = api.getLengthSid(lowLabelSidPtr);
  if (sidLength === 0) throwLastError(api, "GetLengthSid", "Low integrity label SID");
  const info = Buffer.alloc(TOKEN_MANDATORY_LABEL_SIZE + sidLength);
  info.writeBigUInt64LE(ptrAddress(lowLabelSidPtr), 0);
  info.writeUInt32LE(SE_GROUP_INTEGRITY, 8);
  if (api.setTokenInformation(token, TokenIntegrityLevel, info, info.length) === 0) {
    throwLastError(api, "SetTokenInformation", "TokenIntegrityLevel (Low)");
  }
}
function buildRestrictingSids(sids) {
  const buffer = Buffer.alloc(SID_AND_ATTRIBUTES_SIZE * sids.length);
  sids.forEach((sid, index) => {
    buffer.writeBigUInt64LE(ptrAddress(sid), SID_AND_ATTRIBUTES_SIZE * index);
  });
  return buffer;
}
function createRestrictedToken(api, currentToken, logonSid, writeSids, known, mode) {
  const restrictingSids = buildRestrictingSids(mode === "read-only" ? [logonSid, known.world] : writeSids.length === 0 ? (() => {
    throw new Error("createRestrictedToken: workspace-write restricting list requires at least one write SID");
  })() : [logonSid, known.world, ...writeSids]);
  const tokenSlot = allocPtrSlot();
  const created = api.createRestrictedToken(
    currentToken,
    DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED,
    0,
    null,
    // no SIDs disabled
    0,
    null,
    // no privileges deleted
    restrictingSids.length / SID_AND_ATTRIBUTES_SIZE,
    restrictingSids,
    tokenSlot
  );
  if (created === 0) throwLastError(api, "CreateRestrictedToken", `restricting SIDs: ${restrictingSids.length / SID_AND_ATTRIBUTES_SIZE}`);
  const token = decodePtr(tokenSlot);
  if (token === null) throwWin32(api, "CreateRestrictedToken", api.getLastError(), "null token handle");
  return token;
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/grant.ts
var AclWriteGrant = class _AclWriteGrant {
  /** The write SID in SDDL string form. */
  writeSid;
  api;
  sidPtr;
  lowLabelSidPtr;
  worldSidPtr;
  revocablePaths = [];
  standingPaths = [];
  constructor(api, sidPtr, lowLabelSidPtr, worldSidPtr, writeSid) {
    this.api = api;
    this.sidPtr = sidPtr;
    this.lowLabelSidPtr = lowLabelSidPtr;
    this.worldSidPtr = worldSidPtr;
    this.writeSid = writeSid;
  }
  /**
   * Parse the SID string, create the Low integrity SID the grants label with
   * and the world SID their ambient-delete deny names, and open the binding
   * table (lazily, once per server). Fail-closed: any failure throws — nothing
   * is granted yet.
   * @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
   * @param api - optional already-resolved bindings (tests).
   * @returns the ready grant (no ACEs yet).
   */
  static create(writeSid, api) {
    const bindings3 = api ?? win32Sync();
    const sidSlot = allocPtrSlot();
    if (bindings3.convertStringSidToSidW(writeSid, sidSlot) === 0) {
      throwLastError(bindings3, "ConvertStringSidToSidW", writeSid);
    }
    const sidPtr = decodePtr(sidSlot);
    if (sidPtr === null) throwLastError(bindings3, "ConvertStringSidToSidW", `null SID for ${writeSid}`);
    try {
      const lowLabelSidPtr = makeWellKnownSid(bindings3, WinLowLabelSid);
      try {
        const worldSidPtr = makeWellKnownSid(bindings3, WinWorldSid);
        return new _AclWriteGrant(bindings3, sidPtr, lowLabelSidPtr, worldSidPtr, writeSid);
      } catch (error) {
        bindings3.localFree(lowLabelSidPtr);
        throw error;
      }
    } catch (error) {
      bindings3.localFree(sidPtr);
      throw error;
    }
  }
  /**
   * Grant the write ACE, the ambient-delete deny, and the Low mandatory label
   * on one directory (idempotent: an already-standing exact ACE, deny, and
   * label skip the eager full-tree re-propagation — see {@link grantWrite})
   * and record the path for {@link dispose} unless it is standing. The path is
   * recorded BEFORE the grant: a post-apply throw (a LocalFree failure after
   * SetNamedSecurityInfoW succeeded) must still revoke it, and revoking an
   * ungranted path is a no-op merge. Callers treat a throw as a failed
   * materialization and dispose the instance to revoke the paths granted so
   * far.
   * @param path - the directory whose DACL and label gain the grant.
   * @param standing - the edits outlive this grant (the workspace reuse
   *   cache; dispose() skips revoking it). Default false (revoked on
   *   dispose — the temp-directory lifecycle).
   */
  add(path, standing = false) {
    ;
    (standing ? this.standingPaths : this.revocablePaths).push(path);
    grantWrite(this.api, path, this.sidPtr, this.lowLabelSidPtr, this.worldSidPtr);
  }
  /** Every directory currently carrying the grant, in grant order. */
  get paths() {
    return [...this.standingPaths, ...this.revocablePaths];
  }
  /** Revoke every revocable grant (standing security descriptor edits stay) and free the SIDs; reports every cleanup failure. */
  dispose() {
    const failures = [];
    for (const path of this.revocablePaths) {
      try {
        revokeWrite(this.api, path, this.sidPtr);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [label, sidPtr] of [
      ["write SID", this.sidPtr],
      ["Low label SID", this.lowLabelSidPtr],
      ["world SID", this.worldSidPtr]
    ]) {
      try {
        const freed = this.api.localFree(sidPtr);
        if (!isNullPtr(freed)) throwLastError(this.api, "LocalFree", label);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`);
    }
  }
};

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/workspace-sid.ts
import { createHash as createHash2 } from "node:crypto";
function workspaceWriteSid(workspaceRoot) {
  const digest = createHash2("sha256").update(workspaceRoot, "utf8").digest();
  const first = digest.readUInt32LE(0) % (2 ** 30 - 1) + 1;
  const second = digest.readUInt32LE(4) % (2 ** 30 - 1) + 1;
  return `S-1-4-${first}-${second}`;
}
function tempWriteSid(tempDir) {
  const digest = createHash2("sha256").update("temp\0", "utf8").update(tempDir, "utf8").digest();
  const first = digest.readUInt32LE(0) % (2 ** 30 - 1) + 1;
  const second = digest.readUInt32LE(4) % (2 ** 30 - 1) + 1;
  return `S-1-4-${first}-${second}-1`;
}

// third_party/dsh/packages/sandbox/sandbox-windows-acl/src/index.ts
function freeSidBestEffort(api, sidPtr, label, failures) {
  if (sidPtr === void 0) return;
  try {
    const freed = api.localFree(sidPtr);
    if (!isNullPtr(freed)) throwLastError(api, "LocalFree", label);
  } catch (error) {
    failures.push(error);
  }
}
var AclSandbox = class {
  /** Absolute writable directories (constructor-validated). */
  writableDirs;
  /** The workspace SID string whose ACEs form the workspace allowlist. */
  writeSid;
  /** The private temp directory's write SID (workspace-write with temp only). */
  tempWriteSid;
  /** The file-effect mode — the restricted token's restricting-SID list selection. */
  mode;
  tempDirOption;
  manageDacls;
  tempDirResolved;
  api;
  token;
  writeSidPtr;
  tempWriteSidPtr;
  /** The well-known/logon SID allocations init() makes; freed by dispose() alongside the write SIDs. */
  sidAllocations = [];
  grantedPaths = [];
  constructor(options) {
    this.mode = options.mode;
    this.manageDacls = options.manageDacls ?? true;
    this.writableDirs = options.writableDirs.map((directory) => {
      const absolute = resolve(directory);
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        throw new Error(`AclSandbox writable dir does not exist or is not a directory: ${absolute}`);
      }
      return absolute;
    });
    this.tempDirOption = options.tempDir;
    this.writeSid = options.writeSid;
    this.tempWriteSid = options.tempWriteSid;
    if (this.mode === "workspace-write" && this.writeSid === void 0) {
      throw new Error("AclSandbox workspace-write requires a write SID \u2014 derive it from the workspace via workspaceWriteSid()");
    }
    if (this.mode === "workspace-write" && this.tempDirOption === void 0) {
      throw new Error("AclSandbox workspace-write requires an explicit private temp directory or null");
    }
    if (this.mode === "read-only" && this.tempDirOption !== void 0 && this.tempDirOption !== null) {
      throw new Error("AclSandbox read-only does not accept a temp directory");
    }
    if (this.mode === "read-only" && (this.writeSid !== void 0 || this.tempWriteSid !== void 0)) {
      throw new Error("AclSandbox read-only does not accept write SIDs");
    }
    if (this.mode === "workspace-write" && this.tempDirOption !== null && this.tempWriteSid === void 0) {
      throw new Error("AclSandbox workspace-write with temp requires a temp write SID \u2014 derive it via tempWriteSid()");
    }
    if (this.tempDirOption === null && this.tempWriteSid !== void 0) {
      throw new Error("AclSandbox temp write SID requires a temp directory");
    }
    if (this.writeSid !== void 0 && this.tempWriteSid === this.writeSid) {
      throw new Error("AclSandbox workspace and temp write SIDs must be distinct");
    }
  }
  /** Resolved temp directory (available after init; null when temp grants are disabled). */
  get tempDir() {
    return this.tempDirResolved;
  }
  /** Create the restricted token and apply the capability-SID grants. Idempotent-unsafe: once per instance. */
  async init() {
    if (this.api !== void 0) throw new Error("AclSandbox is already initialized");
    const api = await win32();
    const currentToken = openCurrentProcessToken(api);
    let currentTokenOpen = true;
    let restrictedToken;
    try {
      const parseSid = (sid) => {
        const sidSlot = allocPtrSlot();
        if (api.convertStringSidToSidW(sid, sidSlot) === 0) {
          throwLastError(api, "ConvertStringSidToSidW", sid);
        }
        const parsedSid = decodePtr(sidSlot);
        if (parsedSid === null) throw new Win32Error("ConvertStringSidToSidW", api.getLastError(), sid);
        return parsedSid;
      };
      this.writeSidPtr = this.writeSid === void 0 ? void 0 : parseSid(this.writeSid);
      this.tempWriteSidPtr = this.tempWriteSid === void 0 ? void 0 : parseSid(this.tempWriteSid);
      const tempDir = this.mode === "read-only" || this.tempDirOption === null ? null : this.tempDirOption;
      if (tempDir === void 0) throw new Error("AclSandbox workspace-write temp directory was not resolved");
      if (tempDir !== null) {
        if (!existsSync(tempDir) || !statSync(tempDir).isDirectory()) {
          throw new Error(`AclSandbox temp dir does not exist or is not a directory: ${tempDir}`);
        }
        assertPrivateTempDisjoint(this.writableDirs, tempDir);
      }
      this.tempDirResolved = tempDir;
      const lowLabelSid = makeWellKnownSid(api, WinLowLabelSid);
      const worldSid = makeWellKnownSid(api, WinWorldSid);
      this.sidAllocations.push(lowLabelSid, worldSid);
      if (this.manageDacls) {
        if (this.writeSidPtr !== void 0) {
          for (const path of this.writableDirs) {
            grantWrite(api, path, this.writeSidPtr, lowLabelSid, worldSid);
          }
          if (tempDir !== null && this.tempWriteSidPtr !== void 0) {
            this.grantedPaths.push({ path: tempDir, sidPtr: this.tempWriteSidPtr });
            grantWrite(api, tempDir, this.tempWriteSidPtr, lowLabelSid, worldSid);
          }
        }
      }
      const logonSid = findLogonSid(api, currentToken);
      this.sidAllocations.push(logonSid);
      const writeSids = [this.writeSidPtr, this.tempWriteSidPtr].filter((sid) => sid !== void 0);
      restrictedToken = createRestrictedToken(
        api,
        currentToken,
        logonSid,
        writeSids,
        { world: worldSid },
        this.mode
      );
      restrictTokenIntegrity(api, restrictedToken, lowLabelSid);
      this.token = restrictedToken;
      setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);
      if (api.closeHandle(currentToken) === 0) throwLastError(api, "CloseHandle", "current process token");
      currentTokenOpen = false;
      this.api = api;
    } catch (error) {
      const cleanupFailures = [];
      if (currentTokenOpen && api.closeHandle(currentToken) === 0) {
        cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "current process token after init failure"));
      }
      if (restrictedToken !== void 0 && api.closeHandle(restrictedToken) === 0) {
        cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "restricted token after init failure"));
      }
      for (const grant2 of this.grantedPaths) {
        try {
          revokeWrite(api, grant2.path, grant2.sidPtr);
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) {
        freeSidBestEffort(api, sidPtr, label, cleanupFailures);
      }
      for (const sidPtr of this.sidAllocations.splice(0)) {
        freeSidBestEffort(api, sidPtr, "init SID allocation", cleanupFailures);
      }
      this.token = void 0;
      this.writeSidPtr = void 0;
      this.tempWriteSidPtr = void 0;
      this.tempDirResolved = void 0;
      this.grantedPaths = [];
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          `AclSandbox init failed and ${cleanupFailures.length} cleanup operation(s) also failed`
        );
      }
      throw error;
    }
  }
  /**
   * Spawn a process under the restricted token. Fails closed: throws on every
   * Win32 failure; the child is never created unrestricted. With
   * `stdio: 'inherit'` the child shares the caller's stdio directly and is
   * placed in a kill-on-close job (dies with the caller). Call dispose() only
   * after all children have exited — revoking grants under a live child
   * removes its remaining write allowance.
   * @param options - the program, argv/cwd, and stdio shape.
   * @returns the running child.
   */
  spawn(options) {
    const api = this.api;
    const token = this.token;
    if (api === void 0 || token === void 0) throw new Error("AclSandbox is not initialized: call init() first");
    if (options.controlFileDescriptor !== void 0 && options.stdio !== "inherit") {
      throw new Error("control pipe requires inherited stdio");
    }
    const args = options.args ?? [];
    const cwd = options.cwd ?? process.cwd();
    if (options.stdio === "inherit") {
      const native2 = spawnSandboxedInherited(api, token, {
        command: options.command,
        args,
        cwd,
        ...options.controlFileDescriptor === void 0 ? {} : { controlFileDescriptor: options.controlFileDescriptor }
      });
      let exitCodePromise2;
      return {
        pid: native2.pid,
        wait: async () => {
          exitCodePromise2 ??= Promise.resolve(waitForExit(api, native2.process));
          const exitCode = await exitCodePromise2;
          if (api.closeHandle(native2.job) === 0) throwLastError(api, "CloseHandle", "kill-on-close job");
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode };
        }
      };
    }
    const native = spawnSandboxed(api, token, { command: options.command, args, cwd });
    const stdout = drainPipe(api, native.stdoutRead);
    const stderr = drainPipe(api, native.stderrRead);
    let exitCodePromise;
    return {
      pid: native.pid,
      wait: async () => {
        const stdoutBuffer = await stdout;
        const stderrBuffer = await stderr;
        exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
        return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode: await exitCodePromise };
      }
    };
  }
  /**
   * Revoke the revocable (temp) grants, free the SID, close the token; the
   * standing workspace ACEs stay (the reuse cache). Reports every cleanup
   * failure.
   */
  dispose() {
    const api = this.api;
    if (api === void 0) return;
    const failures = [];
    if (this.manageDacls) {
      for (const grant2 of this.grantedPaths) {
        try {
          revokeWrite(api, grant2.path, grant2.sidPtr);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) {
      freeSidBestEffort(api, sidPtr, label, failures);
    }
    const token = this.token;
    if (token !== void 0) {
      try {
        if (api.closeHandle(token) === 0) throwLastError(api, "CloseHandle", "restricted token");
      } catch (error) {
        failures.push(error);
      }
    }
    for (const sidPtr of this.sidAllocations.splice(0)) {
      freeSidBestEffort(api, sidPtr, "init SID allocation", failures);
    }
    this.api = void 0;
    this.token = void 0;
    this.writeSidPtr = void 0;
    this.tempWriteSidPtr = void 0;
    this.grantedPaths = [];
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclSandbox dispose completed with ${failures.length} cleanup failure(s)`);
    }
  }
};

// runner.ts
if (process.argv[2] === "html") {
  const { convertHtml } = await import("./html.mjs");
  writeFileSync(process.argv[4], convertHtml(readFileSync(process.argv[3], "utf8")));
  process.exit(0);
}
if (process.argv[2] === "cleanup") {
  const state = JSON.parse(readFileSync(process.argv[3], "utf8"));
  if (process.platform === "win32") {
    if (existsSync2(state.temp)) {
      const temporary = AclWriteGrant.create(tempWriteSid(state.temp));
      try {
        temporary.add(state.temp);
      } finally {
        temporary.dispose();
      }
    }
  }
  rmSync(state.temp, { recursive: true, force: true });
  rmSync(process.argv[3]);
  process.exit(0);
}
if (process.argv[2] === "revoke") {
  const state = JSON.parse(readFileSync(process.argv[3], "utf8"));
  if (process.platform === "win32") {
    const grant2 = AclWriteGrant.create(workspaceWriteSid(state.grant_key));
    try {
      for (const root of state.roots) if (existsSync2(root)) grant2.add(root);
    } finally {
      grant2.dispose();
    }
  }
  rmSync(state.grant_key, { recursive: true, force: true });
  process.exit(0);
}
var policy = JSON.parse(readFileSync(process.argv[2], "utf8"));
var argv = process.argv.slice(3);
var temp = mkdtempSync(join2(tmpdir2(), "computer-bridge-"));
var statePath = process.argv[2] + ".grants";
writeFileSync(statePath, JSON.stringify({ temp, roots: policy.roots }));
var code = 1;
var grant;
var sandbox;
try {
  if (process.platform === "darwin") {
    const child = spawn("/usr/bin/sandbox-exec", [
      ...seatbeltProfileArgs({
        mode: "workspace-write",
        workspaceRoot: policy.roots[0],
        additionalRoots: policy.roots.slice(1)
      }),
      "--",
      ...argv
    ], { stdio: "inherit", env: { ...process.env, TMPDIR: temp } });
    process.on("SIGTERM", () => {
    });
    code = await new Promise((resolve2, reject) => {
      child.once("error", reject);
      child.once("exit", (exit, signal) => resolve2(exit ?? (signal ? 128 : 1)));
    });
  } else if (process.platform === "win32") {
    const writeSid = workspaceWriteSid(policy.grant_key);
    const temporarySid = tempWriteSid(temp);
    grant = AclWriteGrant.create(writeSid);
    for (const root of policy.roots) grant.add(root, true);
    const tempGrant = AclWriteGrant.create(temporarySid);
    try {
      tempGrant.add(temp);
      sandbox = new AclSandbox({
        mode: "workspace-write",
        writableDirs: policy.roots,
        tempDir: temp,
        writeSid,
        tempWriteSid: temporarySid,
        manageDacls: false
      });
      await sandbox.init();
      const api = await win32();
      for (const name of ["TMP", "TEMP"]) {
        if (api.setEnvironmentVariableW(name, temp) === 0) {
          throw new Error(`SetEnvironmentVariableW ${name} failed (Win32 ${api.getLastError()})`);
        }
      }
      code = (await sandbox.spawn({ command: argv[0], args: argv.slice(1), stdio: "inherit" }).wait()).exitCode;
    } finally {
      sandbox?.dispose();
      tempGrant.dispose();
    }
  } else {
    throw new Error("Sandbox is available on macOS and Windows only");
  }
} catch (error) {
  console.error("computer-bridge-sandbox:", error.stack);
  code = 127;
} finally {
  grant?.dispose();
  rmSync(temp, { recursive: true, force: true });
  rmSync(statePath);
}
process.exitCode = code;
