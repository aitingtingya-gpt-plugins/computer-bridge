import {createRequire as bridgeCreateRequire} from "node:module"; const require=bridgeCreateRequire(import.meta.url);

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/runner-launch.ts
import { accessSync, constants as fsConstants, lstatSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// third_party/dsh-tools/packages/subprocess/subprocess/src/index.ts
import { Service } from "@deepseek-ai/cordis";

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
var OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
var LOOPBACK_IPV4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

// third_party/dsh-tools/packages/subprocess/subprocess/src/control.ts
var SUBPROCESS_CONTROL_FD = 7;

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

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/windows-inspector.ts
var requireKoffi = createLazyRequire("koffi", import.meta.url);

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/process-inspector.ts
var SYSCALLS = {
  x64: { read: 0, select: 23, pselect: 270, poll: 7, ppoll: 271, epollWait: 232, epollPwait: 281 },
  arm64: { read: 63, pselect: 72, ppoll: 73, epollPwait: 22 }
};
var SUPPORTED_SYSCALL_TABLES = Object.values(SYSCALLS);

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/output.ts
import { closeSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
var defaultSpillDir;
process.once("exit", () => {
  if (defaultSpillDir === void 0) return;
  try {
    rmdirSync(defaultSpillDir);
  } catch {
  }
});

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/runner-launch.ts
var SUBPROCESS_RUNNER_ENV = "DSH_SUBPROCESS_RUNNER";
var WINDOWS_RUNNER_SELECTION = "windows";
var SOURCE_TSCONFIG_PATH = fileURLToPath(new URL("../../../../tsconfig.base.json", import.meta.url));
function consumeRunnerSelection(env = process.env) {
  const selection = env[SUBPROCESS_RUNNER_ENV];
  Reflect.deleteProperty(env, SUBPROCESS_RUNNER_ENV);
  return selection;
}
function parseRunnerTargetArgv(argv) {
  if (argv[0] !== "--" || argv.length < 2) {
    throw new Error("subprocess runner requires target argv after a private -- delimiter");
  }
  return [...argv.slice(1)];
}
function windowsEnvironmentValue(env, name) {
  for (const key of Object.keys(env).sort()) {
    if (key.toUpperCase() === name) return env[key];
  }
  return void 0;
}
function executableCandidateExists(candidate) {
  try {
    return !statSync(candidate).isDirectory();
  } catch {
    try {
      const entry = lstatSync(candidate);
      return entry.isFile() || entry.isSymbolicLink();
    } catch {
      return false;
    }
  }
}
function windowsPathDirectories(path) {
  const directories = [];
  let start = 0;
  while (start < path.length) {
    if (path.charAt(start) === ";") {
      start += 1;
      continue;
    }
    const quote = path.charAt(start);
    const quoted = quote === '"' || quote === "'";
    const quoteEnd = quoted ? path.indexOf(quote, start + 1) : -1;
    const separator = path.indexOf(";", quoted ? quoteEnd < 0 ? path.length : quoteEnd : start);
    const end = separator < 0 ? path.length : separator;
    let directory = path.slice(start, end);
    if (directory.startsWith('"') || directory.startsWith("'")) directory = directory.slice(1);
    if (directory.endsWith('"') || directory.endsWith("'")) directory = directory.slice(0, -1);
    if (directory.length > 0) directories.push(directory);
    start = end + 1;
  }
  return directories;
}
function windowsFileNameStart(command) {
  let start = command.length;
  while (start > 0 && !/[\\/:]/u.test(command.charAt(start - 1))) start -= 1;
  return start;
}
function windowsSearchPathJoin(directory, name, cwd) {
  let prefix = cwd;
  let adjustedDirectory = directory;
  const slash = (value) => value === "\\" || value === "/";
  if (directory.length > 2 && slash(directory.charAt(0)) && slash(directory.charAt(1))) {
    prefix = "";
  } else if (directory.length >= 1 && slash(directory.charAt(0))) {
    prefix = cwd.slice(0, 2);
  } else if (directory.length >= 2 && directory.charAt(1) === ":" && (directory.length < 3 || !slash(directory.charAt(2)))) {
    if (cwd.length < 2 || cwd.slice(0, 2).toLowerCase() !== directory.slice(0, 2).toLowerCase()) {
      prefix = "";
    } else {
      adjustedDirectory = directory.slice(2);
    }
  } else if (directory.length > 2 && directory.charAt(1) === ":") {
    prefix = "";
  }
  const append = (base, part) => {
    if (base.length === 0 || part.length === 0) return base + part;
    return /[\\/:]$/u.test(base) ? base + part : `${base}\\${part}`;
  };
  return append(append(prefix, adjustedDirectory), name);
}
function windowsExecutableNames(command, name) {
  const dot = name.indexOf(".");
  const hasExtension = dot >= 0 && dot < name.length - 1;
  const separator = name.endsWith(".") ? "" : ".";
  return [
    ...hasExtension ? [command] : [],
    `${command}${separator}com`,
    `${command}${separator}exe`
  ];
}
function resolveWindowsExecutable(command, cwd, env, exists = executableCandidateExists, currentEnv = process.env) {
  const nameStart = windowsFileNameStart(command);
  const directory = command.slice(0, nameStart);
  const name = command.slice(nameStart);
  const hasPath = nameStart !== 0;
  const roots = [];
  if (hasPath) {
    roots.push(directory);
  } else {
    if (windowsEnvironmentValue(currentEnv, "NODEFAULTCURRENTDIRECTORYINEXEPATH") === void 0) {
      roots.push("");
    }
    const path = windowsEnvironmentValue(env, "PATH") ?? windowsEnvironmentValue(currentEnv, "PATH") ?? "";
    roots.push(...windowsPathDirectories(path));
  }
  for (const root of roots) {
    const base = windowsSearchPathJoin(root, name, cwd);
    for (const candidate of windowsExecutableNames(base, name)) {
      if (exists(candidate)) return candidate;
    }
  }
  return void 0;
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/spawn-runner.ts
import { closeSync as closeSync2 } from "node:fs";

// third_party/dsh-tools/packages/subprocess/win32-process/src/abi.ts
var STARTF_USESTDHANDLES = 256;
var STARTF_USESHOWWINDOW = 1;
var SW_HIDE = 0;
var HANDLE_FLAG_INHERIT = 1;
var WAIT_TIMEOUT = 258;
var CREATE_SUSPENDED = 4;
var CREATE_UNICODE_ENVIRONMENT = 1024;
var FORMAT_MESSAGE_FROM_SYSTEM = 4096;
var FORMAT_MESSAGE_IGNORE_INSERTS = 512;
var JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
var JobObjectBasicAccountingInformation = 1;
var JobObjectExtendedLimitInformation = 9;
var JOBOBJECT_BASIC_ACCOUNTING_SIZE = 48;
var JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET = 40;
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
var requireKoffi2 = createLazyRequire("koffi", import.meta.url);

// third_party/dsh-tools/packages/subprocess/win32-process/src/ffi.ts
function isNullPtr(value) {
  return value === null || value === void 0 || value === 0n;
}
var cachedTypes;
function win32Types() {
  if (cachedTypes !== void 0) return cachedTypes;
  const koffi = requireKoffi2();
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
function allocUint32() {
  return requireKoffi2().alloc("uint32", 1);
}
function decodeUint32(slot) {
  return requireKoffi2().decode(slot, "uint32");
}
function allocStartupInfo() {
  return requireKoffi2().alloc(win32Types().STARTUPINFOW, 1);
}
function encodeStartupInfo(startupInfo, fields) {
  requireKoffi2().encode(startupInfo, win32Types().STARTUPINFOW, fields);
}
function allocProcessInfo() {
  return requireKoffi2().alloc(win32Types().PROCESS_INFORMATION, 1);
}
function decodeProcessInfo(processInfo) {
  return requireKoffi2().decode(processInfo, win32Types().PROCESS_INFORMATION);
}
var cachedContext;
var cached;
function bindingContext() {
  if (cachedContext !== void 0) return cachedContext;
  const koffi = requireKoffi2();
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
  cachedContext = { kernel32, advapi32, bind };
  return cachedContext;
}
function bindings() {
  if (cached !== void 0) return cached;
  const koffi = requireKoffi2();
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
function throwLastError(api, name, detail) {
  const win32Code = api.getLastError();
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
function throwWin32(api, name, win32Code, detail) {
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}

// third_party/dsh-tools/packages/subprocess/win32-process/src/control-stdio.ts
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

// third_party/dsh-tools/packages/subprocess/win32-process/src/process.ts
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
function compareWindowsEnvironmentKeys([left], [right]) {
  const foldedLeft = left.toUpperCase();
  const foldedRight = right.toUpperCase();
  return foldedLeft < foldedRight ? -1 : foldedLeft > foldedRight ? 1 : 0;
}
function encodeWindowsEnvironment(env) {
  const entries = Object.entries(env).sort(compareWindowsEnvironmentKeys);
  const strings = entries.map(([key, value]) => `${key}=${value}`);
  return Buffer.from(`${strings.join("\0")}\0\0`, "utf16le");
}
function freeNative(pointer) {
  if (pointer !== void 0) requireKoffi2().free(pointer);
}
function closeBestEffort(api, handle) {
  if (!isNullPtr(handle)) api.closeHandle(handle);
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
function descriptorHandle(api, fileDescriptor, label) {
  const handle = api.uvGetOsfhandle(fileDescriptor);
  if (isNullPtr(handle) || handle === UV_INVALID_OS_FILE_HANDLE || handle === UV_INVALID_FILE_DESCRIPTOR) {
    throw new Error(`uv_get_osfhandle returned an invalid handle for target ${label} fd ${String(fileDescriptor)}`);
  }
  return handle;
}
function targetCarrierHandles(api, descriptors) {
  return {
    stdin: descriptorHandle(api, descriptors.stdin, "stdin"),
    stdout: descriptorHandle(api, descriptors.stdout, "stdout"),
    stderr: descriptorHandle(api, descriptors.stderr, "stderr"),
    ...descriptors.control === void 0 ? {} : {
      control: { fileDescriptor: descriptors.control, handle: descriptorHandle(api, descriptors.control, "control") }
    }
  };
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
      const koffi = requireKoffi2();
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
function spawnCurrentTokenJobProcess(api, options) {
  const commandLine = buildCommandLine(options.command, options.args);
  const environment = encodeWindowsEnvironment(options.env);
  return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), "CreateProcessW", (startupInfo, processInfo) => api.createProcessW(
    options.applicationName,
    commandLine,
    null,
    null,
    1,
    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
    environment,
    options.cwd,
    startupInfo,
    processInfo
  ));
}
function pollProcessExit(api, process2) {
  const waitResult = api.waitForSingleObject(process2, 0);
  if (waitResult === WAIT_TIMEOUT) return void 0;
  if (waitResult === 4294967295) throwLastError(api, "WaitForSingleObject");
  const exitCodeSlot = allocUint32();
  try {
    if (api.getExitCodeProcess(process2, exitCodeSlot) === 0) throwLastError(api, "GetExitCodeProcess");
    return decodeUint32(exitCodeSlot);
  } finally {
    requireKoffi2().free(exitCodeSlot);
  }
}
function isJobEmpty(api, job) {
  const information = Buffer.alloc(JOBOBJECT_BASIC_ACCOUNTING_SIZE);
  if (api.queryInformationJobObject(
    job,
    JobObjectBasicAccountingInformation,
    information,
    information.length,
    null
  ) === 0) {
    throwLastError(api, "QueryInformationJobObject", "active process count");
  }
  return information.readUInt32LE(JOBOBJECT_BASIC_ACCOUNTING_ACTIVE_PROCESSES_OFFSET) === 0;
}
function terminateJob(api, job, exitCode) {
  if (api.terminateJobObject(job, exitCode) === 0) throwLastError(api, "TerminateJobObject");
}
function closeHandleChecked(api, handle, detail) {
  if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", detail);
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/linux-execve.ts
import { getSystemErrorMessage, getSystemErrorName } from "node:util";
var requireKoffi3 = createLazyRequire("koffi", import.meta.url);
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
  const koffi = requireKoffi3();
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
  lstatSync as lstatSync2,
  mkdtempSync as mkdtempSync2,
  readFileSync,
  rmdirSync as rmdirSync2,
  unlinkSync as unlinkSync2,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, required, optional = []) {
  const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
function linuxLaunchFilesFromLocator(requestPath) {
  if (!isAbsolute(requestPath) || basename(requestPath) !== "launch-request.json") {
    throw new Error("subprocess runner received an invalid Linux launch-request locator");
  }
  const directory = dirname(requestPath);
  return { directory, requestPath, startupErrorPath: join(directory, "startup-error.json") };
}
function consumeLinuxLaunchRequest(requestPath) {
  const text = readFileSync(requestPath, "utf8");
  unlinkSync2(requestPath);
  const value = JSON.parse(text);
  if (!isRecord(value) || !hasExactKeys(value, ["cwd", "env"], ["control"]) || typeof value.cwd !== "string" || !isStringRecord(value.env) || value.control !== void 0 && value.control !== "pipe") {
    throw new Error("subprocess runner received an invalid Linux launch request");
  }
  return { cwd: value.cwd, env: value.env, ...value.control === "pipe" ? { control: "pipe" } : {} };
}
function writeLinuxStartupError(files, error) {
  writeFileSync(files.startupErrorPath, JSON.stringify(error), { flag: "wx", mode: 384 });
}
function parseWindowsStartRequest(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "cwd", "env"], ["control"]) || value.type !== "start" || typeof value.cwd !== "string" || !isStringRecord(value.env) || value.control !== void 0 && value.control !== "pipe") {
    throw new Error("subprocess runner received an invalid Windows start request");
  }
  return { type: "start", cwd: value.cwd, env: value.env, ...value.control === "pipe" ? { control: "pipe" } : {} };
}
function isWindowsTerminateRequest(value) {
  return isRecord(value) && hasExactKeys(value, ["type"]) && value.type === "terminate";
}
function serializeRunnerError(error) {
  const source = error instanceof Error ? error : new Error(String(error));
  const node = source;
  return {
    name: source.name,
    message: source.message,
    ...typeof node.code === "string" ? { code: node.code } : {},
    ...typeof node.syscall === "string" ? { syscall: node.syscall } : {},
    ...typeof node.path === "string" ? { path: node.path } : {}
  };
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/spawn-runner.ts
var defaultInternals = {
  /* v8 ignore next -- source/built/packaged subprocess smoke executes this only in a replaceable child process. */
  execve: (file, argv, env, control) => loadLinuxExecve()(file, argv, env, control),
  loadWin32ProcessBindings,
  spawnCurrentTokenJobProcess,
  closeFileDescriptor: closeSync2,
  resolveWindowsExecutable,
  pollProcessExit,
  isJobEmpty,
  terminateJob,
  closeHandleChecked
};
var NODE_SPAWN_DETAIL_CODES = /* @__PURE__ */ new Set(["EACCES", "ENOENT"]);
var WINDOWS_SPAWN_ERROR_CODES = /* @__PURE__ */ new Map([
  [2, "ENOENT"],
  [3, "ENOENT"],
  [267, "ENOENT"],
  [5, "EPERM"],
  [193, "EFTYPE"],
  [740, "EACCES"]
]);
function nodeSpawnError(syscall, code, path) {
  const message = `${syscall} ${code}`;
  return {
    name: "Error",
    message,
    code,
    syscall,
    ...path === void 0 ? {} : { path }
  };
}
function asSpawnError(error, program) {
  const serialized = serializeRunnerError(error);
  if (!(error instanceof Win32Error)) {
    return serialized.code === void 0 ? serialized : nodeSpawnError(`spawn ${program}`, serialized.code, program);
  }
  const code = WINDOWS_SPAWN_ERROR_CODES.get(error.win32Code) ?? "UNKNOWN";
  if (NODE_SPAWN_DETAIL_CODES.has(code)) {
    return nodeSpawnError(`spawn ${program}`, code, program);
  }
  return nodeSpawnError("spawn", code);
}
function windowsPathNotFoundError(program) {
  return nodeSpawnError(`spawn ${program}`, "ENOENT", program);
}
function windowsStartCancelledError() {
  return {
    name: "Error",
    message: "subprocess target start was cancelled"
  };
}
function linuxPathNotFoundError(program) {
  return Object.assign(new Error(`spawn ${program} ENOENT`), {
    code: "ENOENT",
    errno: -2,
    syscall: `spawn ${program}`,
    path: program,
    spawnargs: []
  });
}
function execLinuxFile(file, argv, env, internals, control) {
  try {
    return control === void 0 ? internals.execve(file, argv, env) : internals.execve(file, argv, env, control);
  } catch (error) {
    if (error.code !== "ENOEXEC") throw error;
    return control === void 0 ? internals.execve("/bin/sh", ["/bin/sh", file, ...argv.slice(1)], env) : internals.execve("/bin/sh", ["/bin/sh", file, ...argv.slice(1)], env, control);
  }
}
function execLinuxTarget(request, argv, internals) {
  const program = argv[0];
  if (program.includes("/")) return execLinuxFile(program, argv, request.env, internals, request.control);
  const path = request.env.PATH ?? "/usr/bin:/bin";
  let permissionFailure;
  for (const directory of path.split(":")) {
    const root = directory.startsWith("/") ? directory : `${request.cwd}${request.cwd.endsWith("/") ? "" : "/"}${directory}`;
    const candidate = `${root}${root.endsWith("/") ? "" : "/"}${program}`;
    try {
      return execLinuxFile(candidate, argv, request.env, internals, request.control);
    } catch (error) {
      const code = error.code;
      if (code === "EACCES") {
        permissionFailure ??= error;
        continue;
      }
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw error;
    }
  }
  throw permissionFailure ?? linuxPathNotFoundError(program);
}
function runLinux(locator, argv, host, internals) {
  const files = linuxLaunchFilesFromLocator(locator);
  let request;
  try {
    request = consumeLinuxLaunchRequest(files.requestPath);
  } catch (error) {
    writeLinuxStartupError(files, { type: "error", error: serializeRunnerError(error) });
    host.exitCode = 127;
    return;
  }
  try {
    host.chdir(request.cwd);
    execLinuxTarget({ ...request, cwd: host.cwd() }, argv, internals);
  } catch (error) {
    writeLinuxStartupError(files, {
      type: "error",
      error: asSpawnError(error, argv[0])
    });
    host.exitCode = 127;
  }
}
function sendMessage(host, result) {
  return new Promise((resolve, reject) => {
    if (!host.connected || host.send === void 0) {
      reject(new Error("subprocess runner IPC is not connected"));
      return;
    }
    try {
      host.send(result, (error) => {
        if (error === null) resolve();
        else reject(error);
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      reject(failure);
    }
  });
}
var WindowsJobRunner = class {
  constructor(argv, host, internals) {
    this.argv = argv;
    this.host = host;
    this.internals = internals;
  }
  argv;
  host;
  internals;
  api;
  processHandle;
  jobHandle;
  pollTimer;
  startSeen = false;
  terminateRequested = false;
  resultStarted = false;
  resultDelivered = false;
  finished = false;
  completion = Promise.withResolvers();
  run() {
    if (!this.host.connected || this.host.send === void 0) {
      this.finish(127);
      return this.completion.promise;
    }
    this.host.on("message", this.onMessage);
    this.host.once("disconnect", this.onDisconnect);
    return this.completion.promise;
  }
  onMessage = (value) => {
    if (this.finished) return;
    if (isWindowsTerminateRequest(value)) {
      this.requestTermination();
      return;
    }
    if (this.startSeen) {
      void this.runnerFailure(new Error("subprocess runner received more than one Windows start request"));
      return;
    }
    let request;
    try {
      request = parseWindowsStartRequest(value);
    } catch (error) {
      void this.runnerFailure(error);
      return;
    }
    this.startSeen = true;
    void this.start(request);
  };
  onDisconnect = () => {
    if (this.finished) return;
    this.releaseOwnedJob();
    this.finish(127, false);
  };
  async start(request) {
    if (this.terminateRequested) {
      await this.publishTerminalResult({ type: "error", error: windowsStartCancelledError() }, 0);
      return;
    }
    await new Promise((resolveImmediate) => {
      setImmediate(resolveImmediate);
    });
    if (this.finished) return;
    if (this.terminateRequested) {
      await this.publishTerminalResult({ type: "error", error: windowsStartCancelledError() }, 0);
      return;
    }
    try {
      const [command, ...args] = this.argv;
      const applicationName = this.internals.resolveWindowsExecutable(
        command,
        request.cwd,
        request.env,
        void 0,
        { ...this.host.env }
      );
      if (applicationName === void 0) {
        await this.publishTerminalResult({
          type: "error",
          error: windowsPathNotFoundError(command)
        }, 0);
        return;
      }
      this.api = this.internals.loadWin32ProcessBindings();
      const spawned = this.internals.spawnCurrentTokenJobProcess(this.api, {
        command,
        applicationName,
        args,
        cwd: request.cwd,
        env: request.env,
        stdio: { stdin: 4, stdout: 5, stderr: 6, ...request.control === "pipe" ? { control: SUBPROCESS_CONTROL_FD } : {} }
      });
      this.processHandle = spawned.process;
      this.jobHandle = spawned.job;
      for (const fileDescriptor of request.control === "pipe" ? [4, 5, 6, SUBPROCESS_CONTROL_FD] : [4, 5, 6]) {
        this.internals.closeFileDescriptor(fileDescriptor);
      }
      this.pollTimer = setInterval(() => {
        this.poll();
      }, 10);
    } catch (error) {
      if (this.jobHandle === void 0 && error instanceof Win32Error && error.api === "CreateProcessW") {
        await this.publishTerminalResult({
          type: "error",
          error: asSpawnError(error, this.argv[0])
        }, 0);
        return;
      }
      await this.runnerFailure(error);
    }
  }
  requestTermination() {
    if (this.terminateRequested) return;
    this.terminateRequested = true;
    try {
      this.terminateOwnedJob();
    } catch (error) {
      void this.runnerFailure(error);
    }
  }
  terminateOwnedJob() {
    const job = this.jobHandle;
    if (job === void 0) return;
    if (this.api === void 0) return;
    this.internals.terminateJob(this.api, job, 1);
  }
  poll() {
    if (this.finished) return;
    if (this.api === void 0) return;
    try {
      if (this.processHandle !== void 0) {
        const exitCode = this.internals.pollProcessExit(this.api, this.processHandle);
        if (exitCode !== void 0) {
          this.internals.closeHandleChecked(this.api, this.processHandle, "ordinary direct process");
          this.processHandle = void 0;
          void this.publishTerminalResult({ type: "target-exit", exitCode });
        }
      }
      if (this.jobHandle !== void 0 && this.internals.isJobEmpty(this.api, this.jobHandle)) {
        this.internals.closeHandleChecked(this.api, this.jobHandle, "ordinary process Job");
        this.jobHandle = void 0;
        if (this.resultDelivered) this.finish(0);
      }
    } catch (error) {
      void this.runnerFailure(error);
    }
  }
  async publishTerminalResult(result, exitCode) {
    if (this.finished || this.resultStarted) return;
    this.resultStarted = true;
    try {
      await sendMessage(this.host, result);
      this.resultDelivered = true;
    } catch {
      this.releaseOwnedJob();
      this.finish(127, false);
      return;
    }
    if (exitCode !== void 0) {
      this.finish(exitCode);
      return;
    }
    if (this.jobHandle === void 0) this.finish(0);
  }
  async runnerFailure(error) {
    if (this.finished) return;
    if (!this.resultStarted) {
      this.resultStarted = true;
      try {
        await sendMessage(this.host, { type: "error", error: serializeRunnerError(error) });
        this.resultDelivered = true;
      } catch {
      }
    }
    this.releaseOwnedJob();
    this.finish(127);
  }
  releaseOwnedJob() {
    if (this.pollTimer !== void 0) clearInterval(this.pollTimer);
    this.pollTimer = void 0;
    const api = this.api;
    if (api === void 0) return;
    if (this.jobHandle !== void 0) {
      try {
        this.internals.terminateJob(api, this.jobHandle, 1);
      } catch {
      }
      try {
        this.internals.closeHandleChecked(api, this.jobHandle, "ordinary process Job cleanup");
      } catch {
      }
      this.jobHandle = void 0;
    }
    if (this.processHandle !== void 0) {
      try {
        this.internals.closeHandleChecked(api, this.processHandle, "ordinary direct process cleanup");
      } catch {
      }
      this.processHandle = void 0;
    }
  }
  finish(exitCode, disconnect = true) {
    if (this.finished) return;
    this.finished = true;
    if (this.pollTimer !== void 0) clearInterval(this.pollTimer);
    this.pollTimer = void 0;
    this.host.off("message", this.onMessage);
    this.host.off("disconnect", this.onDisconnect);
    this.host.exitCode = exitCode;
    if (disconnect && this.host.connected) this.host.disconnect();
    this.completion.resolve();
  }
};
async function runSpawnRunner(selection, argv, host = process, internals = defaultInternals) {
  Reflect.deleteProperty(host.env, SUBPROCESS_RUNNER_ENV);
  const targetArgv = parseRunnerTargetArgv(argv);
  if (selection === WINDOWS_RUNNER_SELECTION) {
    await new WindowsJobRunner(targetArgv, host, internals).run();
    return;
  }
  runLinux(selection, targetArgv, host, internals);
}
async function reportSpawnRunnerFailure(selection, error, host = process) {
  if (selection === WINDOWS_RUNNER_SELECTION) {
    try {
      await sendMessage(host, { type: "error", error: serializeRunnerError(error) });
    } catch {
    }
    host.exitCode = 127;
    if (host.connected) host.disconnect();
    return;
  }
  if (selection !== void 0) {
    try {
      const files = linuxLaunchFilesFromLocator(selection);
      writeLinuxStartupError(files, { type: "error", error: serializeRunnerError(error) });
    } catch {
    }
  }
  host.exitCode = 127;
}

// third_party/dsh-tools/packages/subprocess/subprocess-local/src/bin.ts
async function runSelectedSubprocessRunner(selection) {
  try {
    await runSpawnRunner(selection, process.argv.slice(2));
  } catch (error) {
    await reportSpawnRunnerFailure(selection, error);
  }
}
if (import.meta.main) {
  const selection = consumeRunnerSelection();
  if (selection === void 0) {
    process.exitCode = 127;
  } else {
    void runSelectedSubprocessRunner(selection);
  }
}
export {
  runSelectedSubprocessRunner
};
