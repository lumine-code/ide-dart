const { findOnPath } = require("../lib/server"),
  { createProject, prepareProject, removeProject, position } = require("./helpers/project");
const runtime = process.env.DART_PATH || findOnPath(),
  liveSuite = runtime ? describe : xdescribe;
const until = async (check, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
};
liveSuite("ide-dart actual editor integration", () => {
  let fixture, editor, paths, service;
  beforeEach(async () => {
    jasmine.useRealClock();
    fixture = createProject();
    paths = lumine.project.getPaths();
    await prepareProject(fixture, runtime);
    lumine.config.set("ide-dart.serverPath", runtime);
    for (const name of ["language-dart", "ide-client", "ide-dart"])
      await lumine.packages.activatePackage(name);
    service = lumine.packages.getActivePackage("ide-client").mainModule.provideIdeClient();
    lumine.project.setPaths([fixture.rootPath]);
    editor = await lumine.workspace.open(fixture.filePath);
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.dart"));
  }, 120000);
  afterEach(async () => {
    editor?.destroy();
    for (const name of ["ide-dart", "ide-client", "language-dart"])
      await lumine.packages.deactivatePackage(name);
    for (const key of ["serverPath", "features.format"]) lumine.config.unset(`ide-dart.${key}`);
    lumine.project.setPaths(paths);
    await lumine.fileWatchClient.settlePendingTeardown();
    removeProject(fixture.rootPath);
  }, 30000);
  const sessionFor = async () => {
    const session = await until(
      async () =>
        (await service.activeSessionsForEditor(editor)).find(
          ({ adapter }) => adapter.id === "ide-dart",
        ),
      "Dart session",
    );
    await until(async () => {
      const hover = await session.request("textDocument/hover", {
        textDocument: { uri: fixture.uri },
        position: position(fixture.text, "add(1,2)", 1),
      });
      return JSON.stringify(hover).includes("Add two values");
    }, "Dart project analysis before editor requests");
    return session;
  };
  it("auto-registers, honors dynamic capabilities and routes completion and formatting switches", async () => {
    const session = await sessionFor(),
      main = lumine.packages.getActivePackage("ide-client").mainModule;
    expect(service.adaptersForEditor(editor).filter(({ id }) => id === "ide-dart").length).toBe(1);
    expect(session.supports("textDocument/codeLens", editor)).toBe(false);
    await until(
      () => session.supports("textDocument/completion", editor),
      "Dart dynamic completion capability",
    );
    const p = position(fixture.text, "add(1,2)", 2),
      suggestions = await main.provideAutocomplete().getSuggestions({
        editor,
        bufferPosition: new (require("lumine").Point)(p.line, p.character),
        prefix: "ad",
        activatedManually: true,
      });
    expect(
      suggestions.some((item) =>
        (item.displayText || item.text || item.snippet || "").startsWith("add"),
      ),
    ).toBe(true);
    const formatter = main.provideCodeFormatFile();
    expect((await formatter.formatEntireFile(editor)).length).toBeGreaterThan(0);
    lumine.config.set("ide-dart.features.format", false);
    expect(
      await service.activeSessionForFeature(editor, "textDocument/formatting", "format"),
    ).toBeNull();
    expect(await formatter.formatEntireFile(editor)).toBeNull();
  }, 90000);
  it("stops unloaded generations and reacquires the current module and server", async () => {
    const previous = await sessionFor(),
      old = lumine.packages.getActivePackage("ide-dart"),
      oldMain = old.mainModule,
      packagePath = old.path;
    await lumine.packages.deactivatePackage("ide-dart");
    await until(() => previous.state === "stopped", "Dart teardown");
    await lumine.packages.unloadPackage("ide-dart");
    await lumine.packages.loadPackage(packagePath);
    expect((await lumine.packages.activatePackage("ide-dart")).mainModule).not.toBe(oldMain);
    const renewed = await sessionFor();
    expect(renewed).not.toBe(previous);
    const hover = await until(
      () =>
        renewed.request("textDocument/hover", {
          textDocument: { uri: fixture.uri },
          position: position(fixture.text, "add(1,2)", 1),
        }),
      "reloaded Dart hover",
    );
    expect(JSON.stringify(hover)).toContain("Add two values");
  }, 90000);
  it("applies actual Unicode rename edits to the open buffer and a closed file", async () => {
    const session = await sessionFor();
    await until(
      () => session.supports("textDocument/rename", editor),
      "Dart dynamic rename capability",
    );
    const rename = await session.request("textDocument/rename", {
      textDocument: { uri: fixture.uri },
      position: position(fixture.text, "add(4, 5)", 1),
      newName: "sumValues",
    });
    expect(await service.applyWorkspaceEdit(rename, "Rename Dart function", session)).toBe(true);
    expect(editor.getText()).toContain("var unicode = '😀'; var result = sumValues(4, 5)");
    const linked = await lumine.workspace.open(fixture.linkedPath);
    expect(linked.getText()).toContain("return sumValues(9, 1)");
    linked.destroy();
  }, 90000);
});
