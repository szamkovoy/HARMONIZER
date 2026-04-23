const { withXcodeProject, IOSConfig } = require("expo/config-plugins");

/**
 * iOS device builds need `xcodebuild -allowProvisioningUpdates` the first time a
 * development profile is created. Expo only adds that flag when it thinks signing
 * is NOT yet configured (`ensureDeviceIsCodeSignedForDeploymentAsync` → null).
 *
 * If `DEVELOPMENT_TEAM` is already present in the pbxproj (e.g. from `ios.appleTeamId`
 * during prebuild), Expo skips that path and omits the flag — then Xcode fails with
 * "Automatic signing is disabled... pass -allowProvisioningUpdates".
 *
 * This plugin runs last: force Automatic style, clear manual profile keys, and
 * **remove DEVELOPMENT_TEAM / DevelopmentTeam** from the native app target(s) so the
 * next `expo run:ios --device` runs Expo's `setAutoCodeSigningInfoForPbxproj` (with
 * flags) once; after that Expo leaves a valid Automatic + team setup in the project.
 */
function withIosAutomaticSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const targets = IOSConfig.Target.findSignableTargets(project);

    for (const [nativeTargetId, nativeTarget] of targets) {
      IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
        project,
        nativeTarget.buildConfigurationList,
      )
        .filter(([, item]) => item.buildSettings.PRODUCT_NAME)
        .forEach(([, item]) => {
          item.buildSettings.CODE_SIGN_STYLE = "Automatic";
          delete item.buildSettings.PROVISIONING_PROFILE_SPECIFIER;
          delete item.buildSettings.PROVISIONING_PROFILE;
          delete item.buildSettings.DEVELOPMENT_TEAM;
          delete item.buildSettings.CODE_SIGN_IDENTITY;
        });

      Object.entries(IOSConfig.XcodeUtils.getProjectSection(project))
        .filter(IOSConfig.XcodeUtils.isNotComment)
        .forEach(([, section]) => {
          if (!section.attributes) {
            section.attributes = {};
          }
          if (!section.attributes.TargetAttributes) {
            section.attributes.TargetAttributes = {};
          }
          const prev = section.attributes.TargetAttributes[nativeTargetId] || {};
          const next = { ...prev, ProvisioningStyle: "Automatic" };
          delete next.DevelopmentTeam;
          section.attributes.TargetAttributes[nativeTargetId] = next;
        });
    }

    return cfg;
  });
}

module.exports = withIosAutomaticSigning;
