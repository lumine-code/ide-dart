const server = require("./server");
const setting = (key) => lumine.config.get(`ide-dart.${key}`);
const settings = () => ({
  dart: {
    completeFunctionCalls: setting("completeFunctionCalls"),
    includeDependenciesInWorkspaceSymbols: setting("includeDependenciesInWorkspaceSymbols"),
    showTodos: setting("showTodos"),
    inlayHints: setting("inlayHints"),
  },
});

module.exports = {
  consumeIdeClient(service) {
    return service.registerAdapter({
      id: "ide-dart",
      displayName: "Dart Analysis Server",
      grammarScopes: ["source.dart"],
      languageId: "dart",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-dart"],
      restartKeyPaths: [
        "ide-dart.serverPath",
        "ide-dart.onlyAnalyzeProjectsWithOpenFiles",
        "ide-dart.suggestFromUnimportedLibraries",
      ],
      // Dart's navigation/test lenses require client commands this editor does not advertise.
      features: { codeLens: false },
      isFeatureAvailable(feature) {
        return feature !== "codeLens";
      },
      transformServerCapabilities(capabilities) {
        return { ...capabilities, codeLensProvider: false };
      },
      managedServerDisplayName: "Dart SDK",
      installServer: server.installServer,
      latestServerVersion: server.latestServerVersion,
      async resolveServer(context) {
        const launch = await server.resolveServer(context, {
          serverPath: setting("serverPath"),
        });
        if (!launch)
          service.reportMissingServer("ide-dart", {
            description:
              "Install the [Dart SDK](https://dart.dev/get-dart), select its dart executable in Dart Path, or use Manage Servers to download the complete SDK. For Flutter projects, select Flutter's bundled Dart SDK.",
          });
        return launch;
      },
      getInitializationOptions() {
        return {
          onlyAnalyzeProjectsWithOpenFiles: setting("onlyAnalyzeProjectsWithOpenFiles"),
          suggestFromUnimportedLibraries: setting("suggestFromUnimportedLibraries"),
        };
      },
      getSettings: settings,
    });
  },
  provideBackgroundTips() {
    return {
      packageName: "ide-dart",
      tips: [
        "Dart Analysis Server reads pubspec.yaml, analysis_options.yaml and your resolved package dependencies. Run dart pub get after changing project dependencies.",
      ],
    };
  },
};
