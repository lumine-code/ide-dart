const path = require("node:path");
const fs = require("node:fs");

describe("Dart metadata request lifetime", () => {
  let server, controller;
  const version = "3.13.5";
  const response = (text) => ({ ok: true, text: async () => text });
  function deferred() {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-dart");
    server = require("../lib/server");
    controller = new AbortController();
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("ide-dart");
    await lumine.packages.deactivatePackage("ide");
  });

  it("does not fetch metadata for an already cancelled API", async () => {
    const fetch = spyOn(global, "fetch").and.resolveTo(response(JSON.stringify({ version })));
    controller.abort(new Error("cancelled lookup"));
    await expectAsync(
      server.latestServerVersion({ signal: controller.signal }),
    ).toBeRejectedWithError("cancelled lookup");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a cancelled lookup even when fetch completes later", async () => {
    const held = deferred();
    spyOn(global, "fetch").and.returnValue(held.promise);
    const pending = server.latestServerVersion({ signal: controller.signal });
    controller.abort(new Error("cancelled fetch"));
    held.resolve(response(JSON.stringify({ version })));
    await expectAsync(pending).toBeRejectedWithError("cancelled fetch");
  });

  it("rejects cancellation while the metadata body is pending", async () => {
    const held = deferred();
    let reading = false;
    spyOn(global, "fetch").and.resolveTo({
      ok: true,
      text() {
        reading = true;
        return held.promise;
      },
    });
    const pending = server.latestServerVersion({ signal: controller.signal });
    await conditionPromise(() => reading);
    controller.abort(new Error("cancelled body"));
    held.resolve(JSON.stringify({ version }));
    await expectAsync(pending).toBeRejectedWithError("cancelled body");
  });

  it("preserves the 30-second deadline across response-body parsing", async () => {
    const timeout = new AbortController(),
      held = deferred();
    const deadline = spyOn(AbortSignal, "timeout").and.returnValue(timeout.signal);
    let reading = false;
    spyOn(global, "fetch").and.resolveTo({
      ok: true,
      text() {
        reading = true;
        return held.promise;
      },
    });
    const pending = server.latestServerVersion({ signal: controller.signal });
    await conditionPromise(() => reading);
    timeout.abort(new Error("metadata deadline"));
    held.resolve(JSON.stringify({ version }));
    await expectAsync(pending).toBeRejectedWithError("metadata deadline");
    expect(deadline).toHaveBeenCalledOnceWith(30000);
  });

  it("keeps current HTTP and network failures visible", async () => {
    const fetch = spyOn(global, "fetch").and.resolveTo({ ok: false, status: 503 });
    await expectAsync(
      server.latestServerVersion({ signal: controller.signal }),
    ).toBeRejectedWithError(/HTTP 503/);
    fetch.and.rejectWith(new Error("network offline"));
    await expectAsync(
      server.latestServerVersion({ signal: controller.signal }),
    ).toBeRejectedWithError("network offline");
  });

  it("does not download or probe an SDK after checksum cancellation", async () => {
    const held = deferred();
    let reading = false;
    spyOn(global, "fetch").and.resolveTo({
      ok: true,
      text() {
        reading = true;
        return held.promise;
      },
    });
    const storagePath = path.join(lumine.getConfigDirPath(), "unused-sdk-stage");
    const exists = fs.existsSync.bind(fs);
    spyOn(fs, "existsSync").and.callFake(
      (target) => String(target).endsWith("analysis_server.dart.snapshot") || exists(target),
    );
    spyOn(server, "probeRuntime").and.resolveTo({ version });
    const api = {
      signal: controller.signal,
      setServerInstallationStatus() {},
      downloadFile: jasmine.createSpy("download").and.resolveTo(),
      makeFileExecutable: jasmine.createSpy("executable").and.resolveTo(),
    };
    const pending = server.installServer({ storagePath, version, api });
    await conditionPromise(() => reading);
    controller.abort(new Error("cancelled checksum"));
    held.resolve("a".repeat(64));
    await expectAsync(pending).toBeRejectedWithError("cancelled checksum");
    expect(api.downloadFile).not.toHaveBeenCalled();
    expect(api.makeFileExecutable).not.toHaveBeenCalled();
    expect(server.probeRuntime).not.toHaveBeenCalled();
  });

  for (const mode of ["caller cancellation", "adapter withdrawal"]) {
    it(`cancels the real managed-server lookup transport on ${mode}`, async () => {
      await lumine.packages.deactivatePackage("ide-dart");
      const ide = (await lumine.packages.activatePackage("ide")).mainModule;
      await lumine.packages.activatePackage("ide-dart");
      const managed = ide.ensureManagedServers();
      const held = deferred();
      let signal;
      spyOn(global, "fetch").and.callFake((_url, options) => {
        signal = options.signal;
        return held.promise;
      });
      const pending = managed.latestVersion(managed.adapterFor("ide-dart"), {
        force: true,
        signal: controller.signal,
      });
      await conditionPromise(() => signal);
      if (mode === "caller cancellation") controller.abort();
      else await lumine.packages.deactivatePackage("ide-dart");
      await expectAsync(pending).toBeRejected();
      expect(signal.aborted).toBe(true);
      held.resolve(response(JSON.stringify({ version })));
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(managed.latest.has("ide-dart")).toBe(false);
    });
  }
});
