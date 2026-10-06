const fs = require("node:fs"),
  path = require("node:path");
const { findOnPath } = require("./helpers/server-resolution");
const { LiveLspClient } = require("./helpers/live-lsp-client");
const { createProject, prepareProject, removeProject } = require("./helpers/project");
const {
  exerciseIntelligence,
  exerciseUnicodeRename,
  exerciseDiagnosticEdits,
} = require("./helpers/exercise-server");
const runtime = process.env.DART_PATH || findOnPath("dart");
if (process.env.REQUIRE_DART_LSP && !runtime)
  throw new Error("CI requires the real Dart SDK analysis server.");
const liveSuite = runtime ? describe : xdescribe;
liveSuite("ide-dart real SDK language server", () => {
  let fixture, client, edge;
  beforeEach(async () => {
    jasmine.useRealClock();
    fixture = createProject();
    lumine.config.set("ide-dart.serverPath", runtime);
    await prepareProject(fixture, runtime);
    const main = (await lumine.packages.activatePackage("ide-dart")).mainModule;
    edge = main.consumeIdeClient({
      registerAdapter(adapter) {
        client = new LiveLspClient(adapter, fixture.rootPath);
        return { dispose() {} };
      },
      reportMissingServer() {
        throw new Error("Real Dart SDK missing");
      },
    });
    const result = await client.start();
    if (process.env.DART_VERSION) expect(result.serverInfo.version).toBe(process.env.DART_VERSION);
  }, 120000);
  afterEach(async () => {
    await client?.stop();
    edge?.dispose();
    lumine.config.unset("ide-dart.serverPath");
    await lumine.packages.deactivatePackage("ide-dart");
    removeProject(fixture.rootPath);
  }, 30000);
  it("serves language features, both hierarchies and resolved local pub dependencies", async () => {
    expect(await exerciseIntelligence(client, fixture)).toContain("local pub dependency symbols");
  }, 90000);
  it("updates type and project lint diagnostics and applies a real quick fix", async () => {
    expect(await exerciseDiagnosticEdits(client, fixture)).toContain("direct quick-fix edits");
  }, 90000);
  it("uses UTF-16 positions for rename and references in open and closed Unicode documents", async () => {
    expect(await exerciseUnicodeRename(client, fixture)).toContain("symbols after applying rename");
  }, 90000);
  if (process.env.REQUIRE_DART_MANAGED_INSTALL)
    it("installs a verified complete SDK through the hub and launches its analyzer", async () => {
      await client.stop();
      await lumine.packages.activatePackage("ide-client");
      const service = lumine.packages.getActivePackage("ide-client").mainModule.provideIdeClient();
      try {
        await service.uninstallServer("ide-dart");
        const installed = await service.installServer("ide-dart", {
          version: process.env.DART_VERSION || "3.13.5",
        });
        expect(installed.version).toBe(process.env.DART_VERSION || "3.13.5");
        const managed = service.managedServer("ide-dart"),
          sdkRoot = path.dirname(path.dirname(managed.binaryPath));
        expect(fs.existsSync(path.join(sdkRoot, "lib", "core", "core.dart"))).toBe(true);
        expect(
          fs.existsSync(path.join(sdkRoot, "bin", "snapshots", "analysis_server.dart.snapshot")),
        ).toBe(true);
        lumine.config.set("ide-dart.serverPath", "");
        await client.start(managed);
        expect((await exerciseIntelligence(client, fixture)).length).toBeGreaterThan(10);
      } finally {
        await client.stop();
        await service.uninstallServer("ide-dart");
        await lumine.packages.deactivatePackage("ide-client");
      }
    }, 600000);
});
