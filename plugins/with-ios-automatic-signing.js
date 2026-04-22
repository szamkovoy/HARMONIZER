const { withXcodeProject, IOSConfig } = require("expo/config-plugins");

/**
 * Forces Automatic code signing on the main iOS app target so xcodebuild can
 * create/update a development provisioning profile (works with Expo's
 * -allowProvisioningUpdates for `expo run:ios --device`).
 */
function withIosAutomaticSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const [targetUuid, nativeTarget] = IOSConfig.Target.findFirstNativeTarget(project);

    IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      nativeTarget.buildConfigurationList,
    ).forEach(([, item]) => {
      item.buildSettings.CODE_SIGN_STYLE = "Automatic";
      delete item.buildSettings.PROVISIONING_PROFILE_SPECIFIER;
      delete item.buildSettings.PROVISIONING_PROFILE;
    });

    const teamId = cfg.ios?.appleTeamId;
    const projectSection = IOSConfig.XcodeUtils.getProjectSection(project);
    Object.entries(projectSection)
      .filter(IOSConfig.XcodeUtils.isNotComment)
      .forEach(([, section]) => {
        if (!section.attributes) {
          section.attributes = {};
        }
        if (!section.attributes.TargetAttributes) {
          section.attributes.TargetAttributes = {};
        }
        const prev = section.attributes.TargetAttributes[targetUuid] || {};
        section.attributes.TargetAttributes[targetUuid] = {
          ...prev,
          ProvisioningStyle: "Automatic",
          ...(teamId ? { DevelopmentTeam: teamId } : {}),
        };
      });

    return cfg;
  });
}

module.exports = withIosAutomaticSigning;
