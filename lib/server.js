const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const runFile = promisify(execFile);
const ARCHIVE = "https://storage.googleapis.com/dart-archive/channels/stable/release";

exports.findOnPath = (env = process.env, platform = process.platform) => {
  for (const folder of (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(folder, platform === "win32" ? "dart.exe" : "dart");
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      /* Continue through PATH. */
    }
  }
  return null;
};
exports.runtimeCandidates = (rootPath, env = process.env, platform = process.platform) => {
  const binary = platform === "win32" ? "dart.exe" : "dart";
  return [
    env.DART_SDK && path.join(env.DART_SDK, "bin", binary),
    env.FLUTTER_ROOT && path.join(env.FLUTTER_ROOT, "bin", "cache", "dart-sdk", "bin", binary),
    rootPath &&
      path.join(rootPath, ".fvm", "flutter_sdk", "bin", "cache", "dart-sdk", "bin", binary),
  ].filter(Boolean);
};
exports.probeRuntime = async (command, rootPath) => {
  if (!(await fs.promises.stat(command)).isFile())
    throw new Error("Dart Path must name a Dart executable.");
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command))
    throw new Error("Dart Path must name dart.exe inside the SDK, rather than a batch wrapper.");
  await fs.promises.access(command, fs.constants.X_OK);
  const { stdout, stderr } = await runFile(command, ["--version"], {
    cwd: rootPath,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 256 * 1024,
  });
  const version = /Dart SDK version:\s*(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(stdout + stderr)?.[1];
  if (!version) throw new Error("The selected executable did not report a Dart SDK version.");
  return { command, version };
};
exports.resolveServer = async ({ serverPath = "", rootPath, managedServer } = {}) => {
  let command = serverPath || managedServer?.binaryPath;
  if (!command) {
    command =
      exports.runtimeCandidates(rootPath).find((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      }) || exports.findOnPath();
  }
  if (!command) return null;
  const runtime = await exports.probeRuntime(command, rootPath);
  return {
    ...runtime,
    args: ["language-server", "--protocol=lsp", "--client-id=lumine", "--client-version=1.0.0"],
    cwd: rootPath,
    transport: "stdio",
  };
};
exports.assetFor = (platform = process.platform, arch = process.arch) => {
  const os = { win32: "windows", darwin: "macos", linux: "linux" }[platform];
  if (!os || !["x64", "arm64"].includes(arch)) return null;
  return `dartsdk-${os}-${arch}-release.zip`;
};
const requestText = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Dart SDK archive returned HTTP ${response.status} for ${url}.`);
  return response.text();
};
exports.latestServerVersion = async () => {
  const { version } = JSON.parse(await requestText(`${ARCHIVE}/latest/VERSION`));
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("The Dart SDK archive returned an invalid stable version.");
  return version;
};
exports.installServer = async ({ storagePath, api, version }) => {
  const asset = exports.assetFor();
  if (!asset)
    throw new Error(`The Dart SDK has no managed build for ${process.platform}/${process.arch}.`);
  version ||= await exports.latestServerVersion();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Choose a stable Dart SDK version.");
  api.setServerInstallationStatus("checking");
  const url = `${ARCHIVE}/${version}/sdk/${asset}`;
  const checksum = (await requestText(`${url}.sha256sum`)).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(checksum))
    throw new Error("The Dart SDK archive returned an invalid SHA256 checksum.");
  api.setServerInstallationStatus("downloading");
  await api.downloadFile(url, storagePath, { type: "zip", digest: `sha256:${checksum}` });
  api.setServerInstallationStatus("installing");
  const binary = path.join("dart-sdk", "bin", process.platform === "win32" ? "dart.exe" : "dart");
  const command = path.join(storagePath, binary);
  await api.makeFileExecutable(command);
  const installed = await exports.probeRuntime(command);
  if (installed.version !== version)
    throw new Error(
      `The downloaded Dart SDK reports ${installed.version}, rather than ${version}.`,
    );
  if (
    !fs.existsSync(
      path.join(storagePath, "dart-sdk", "bin", "snapshots", "analysis_server.dart.snapshot"),
    )
  )
    throw new Error("The Dart SDK archive is missing its analysis server.");
  return { version, binary };
};
