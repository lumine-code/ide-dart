const fs = require("node:fs"),
  path = require("node:path");
const { createProject, removeProject } = require("./helpers/project");
describe("ide-dart adapter registration and configuration", () => {
  let main, adapter, edge, dispose;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("ide-dart")).mainModule;
    dispose = jasmine.createSpy("unregister");
    edge = main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return { dispose };
      },
      reportMissingServer() {},
    });
  });
  afterEach(async () => {
    edge.dispose();
    for (const key of [
      "serverPath",
      "completeFunctionCalls",
      "inlayHints",
      "onlyAnalyzeProjectsWithOpenFiles",
      "suggestFromUnimportedLibraries",
    ])
      lumine.config.unset(`ide-dart.${key}`);
    await lumine.packages.deactivatePackage("ide-dart");
  });
  it("returns the registration disposable and advertises the Dart grammar", () => {
    expect(adapter.id).toBe("ide-dart");
    expect(adapter.grammarScopes).toEqual(["source.dart"]);
    expect(adapter.languageId).toBe("dart");
    expect(adapter.sessionScope).toBe("project-root");
    edge.dispose();
    expect(dispose).toHaveBeenCalled();
  });
  it("matches upstream defaults and suppresses client-only code lenses", () => {
    expect(adapter.getInitializationOptions()).toEqual({
      onlyAnalyzeProjectsWithOpenFiles: false,
      suggestFromUnimportedLibraries: true,
    });
    const dart = adapter.getSettings().dart;
    expect(dart.completeFunctionCalls).toBe(false);
    expect(dart.inlayHints).toBe(true);
    expect(dart.showTodos).toBe(false);
    expect(
      adapter.transformServerCapabilities({ codeLensProvider: {}, hoverProvider: true }),
    ).toEqual({ codeLensProvider: false, hoverProvider: true });
    expect(require("../package.json").configSchema.features.properties.codeLens).toBeUndefined();
  });
  it("returns section-scoped server settings and reads current values", () => {
    lumine.config.set("ide-dart.completeFunctionCalls", true);
    lumine.config.set("ide-dart.inlayHints", false);
    expect(adapter.getWorkspaceConfiguration("dart").completeFunctionCalls).toBe(true);
    expect(adapter.getWorkspaceConfiguration("dart").inlayHints).toBe(false);
    expect(adapter.getWorkspaceConfiguration()).toEqual(adapter.getSettings());
    expect(adapter.getWorkspaceConfiguration("unknown")).toBeUndefined();
  });
  it("reports missing runtimes through the hub and describes the whole managed SDK", async () => {
    const server = require("../lib/server"),
      report = jasmine.createSpy("missing");
    spyOn(server, "resolveServer").and.resolveTo(null);
    const registration = main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return { dispose() {} };
      },
      reportMissingServer: report,
    });
    expect(await adapter.resolveServer({ rootPath: process.cwd() })).toBeNull();
    expect(report).toHaveBeenCalled();
    expect(adapter.managedServerDisplayName).toBe("Dart SDK");
    registration.dispose();
  });
  it("provides a manifest-named tip about project dependencies", () => {
    expect(main.provideBackgroundTips().packageName).toBe("ide-dart");
    expect(main.provideBackgroundTips().tips[0]).toContain("pubspec.yaml");
  });
});
describe("ide-dart SDK discovery and installation", () => {
  let fixture, server;
  beforeEach(async () => {
    jasmine.useRealClock();
    fixture = createProject();
    await lumine.packages.activatePackage("ide-dart");
    server = require("../lib/server");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("ide-dart");
    removeProject(fixture.rootPath);
  });
  it("maps supported OS and architecture pairs to exact official assets", () => {
    expect(server.assetFor("win32", "x64")).toBe("dartsdk-windows-x64-release.zip");
    expect(server.assetFor("darwin", "arm64")).toBe("dartsdk-macos-arm64-release.zip");
    expect(server.assetFor("linux", "arm64")).toBe("dartsdk-linux-arm64-release.zip");
    expect(server.assetFor("plan9", "x64")).toBeNull();
    expect(server.assetFor("linux", "ia32")).toBeNull();
  });
  it("discovers environment and project Flutter SDK locations without invoking wrappers", () => {
    const names = server.runtimeCandidates(
      fixture.rootPath,
      { DART_SDK: "dart-sdk", FLUTTER_ROOT: "flutter" },
      "win32",
    );
    expect(names).toContain(path.join("dart-sdk", "bin", "dart.exe"));
    expect(names).toContain(path.join("flutter", "bin", "cache", "dart-sdk", "bin", "dart.exe"));
    expect(names).toContain(
      path.join(
        fixture.rootPath,
        ".fvm",
        "flutter_sdk",
        "bin",
        "cache",
        "dart-sdk",
        "bin",
        "dart.exe",
      ),
    );
  });
  it("rejects explicit non-files and scripts before launch", async () => {
    await expectAsync(server.probeRuntime(fixture.rootPath)).toBeRejectedWithError(/executable/);
    await expectAsync(server.probeRuntime(path.join(fixture.rootPath, "missing"))).toBeRejected();
    if (process.platform === "win32") {
      const wrapper = path.join(fixture.rootPath, "dart.bat");
      fs.writeFileSync(wrapper, "exit /b 0\n");
      await expectAsync(server.probeRuntime(wrapper)).toBeRejectedWithError(/batch wrapper/);
    }
  });
  it("skips PATH directories and returns null when the SDK is unavailable", async () => {
    fs.mkdirSync(path.join(fixture.rootPath, process.platform === "win32" ? "dart.exe" : "dart"));
    expect(server.findOnPath({ PATH: fixture.rootPath })).toBeNull();
    spyOn(server, "findOnPath").and.returnValue(null);
    spyOn(server, "runtimeCandidates").and.returnValue([]);
    expect(await server.resolveServer({ rootPath: fixture.rootPath })).toBeNull();
  });
  it("prefers an explicit executable over a managed SDK", async () => {
    spyOn(server, "probeRuntime").and.callFake(async (command) => ({ command, version: "3.13.5" }));
    const launch = await server.resolveServer({
      serverPath: "selected",
      managedServer: { binaryPath: "managed" },
      rootPath: fixture.rootPath,
    });
    expect(launch.command).toBe("selected");
    expect(launch.args).toContain("language-server");
    expect(launch.cwd).toBe(fixture.rootPath);
  });
});
