const { withXcodeProject, withDangerousMod, withPodfile } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_FILES = ['StartVoiceSessionIntent.swift', 'AppShortcuts.swift'];

/**
 * Expo Config Plugin:
 * 1. Copies native Swift AppIntents into ios/<ProjectName>/
 * 2. Registers both Swift files into PBXSourcesBuildPhase of the main iOS app target
 * 3. Strips the duplicate livekit/podspecs source from Podfile to prevent LiveKitWebRTC collision with CocoaPods trunk
 */
const withActionButtonIntent = (config) => {
  // Step 1: Copy Swift files from apps/ios-client/app-intents into ios/<ProjectName>/
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformProjectRoot = modConfig.modRequest.platformProjectRoot;
      const projectName = modConfig.modRequest.projectName;

      const sourceDir = path.join(projectRoot, 'app-intents');
      const destinationDir = path.join(platformProjectRoot, projectName);

      if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
      }

      for (const file of SWIFT_FILES) {
        const srcPath = path.join(sourceDir, file);
        const destPath = path.join(destinationDir, file);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`[withActionButtonIntent] Copied ${file} -> ios/${projectName}/${file}`);
        } else {
          console.warn(`[withActionButtonIntent] Source file not found: ${srcPath}`);
        }
      }

      return modConfig;
    },
  ]);

  // Step 2: Register Swift files into Xcode project PBXSourcesBuildPhase
  config = withXcodeProject(config, (modConfig) => {
    const xcodeProject = modConfig.modResults;
    const projectName = modConfig.modRequest.projectName;

    const targetUuid = xcodeProject.getFirstTarget().uuid;
    const groupKey = xcodeProject.findPBXGroupKey({ name: projectName });

    for (const file of SWIFT_FILES) {
      const filePath = `${projectName}/${file}`;
      if (!xcodeProject.hasFile(filePath)) {
        xcodeProject.addSourceFile(filePath, { target: targetUuid }, groupKey);
        console.log(`[withActionButtonIntent] Registered ${file} in PBXSourcesBuildPhase for target ${targetUuid}`);
      }
    }

    return modConfig;
  });

  // Step 3: Strip duplicate livekit/podspecs from Podfile so LiveKitWebRTC resolves cleanly from trunk
  config = withPodfile(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    contents = contents.replace(
      /^\s*source\s+['"]https:\/\/github\.com\/livekit\/podspecs(\.git)?\/?['"].*$\n?/gm,
      ''
    );
    modConfig.modResults.contents = contents;
    return modConfig;
  });

  return config;
};

module.exports = withActionButtonIntent;
