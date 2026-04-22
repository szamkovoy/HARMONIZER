const { withXcodeProject, IOSConfig } = require("expo/config-plugins");

function ensureQuotes(value) {
  if (!value.match(/^['"]/)) {
    return `"${value}"`;
  }
  return value;
}

/**
 * Forces Automatic signing + DEVELOPMENT_TEAM on all signable native targets.
 * Matches Expo CLI's mutateXcodeProjectWithAutoCodeSigningInfo so
 * `isCodeSigningConfigured` sees teams in buildSettings while style stays Automatic;
 * otherwise Expo skips -allowProvisioningUpdates and device builds fail with Manual signing.
 */
function withIosAutomaticSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const rawTeamId = cfg.ios?.appleTeamId;
    if (!rawTeamId) {
      return cfg;
    }
    const quotedTeamId = ensureQuotes(rawTeamId);

    const targets = IOSConfig.Target.findSignableTargets(project);
    for (const [nativeTargetId, nativeTarget] of targets) {
      IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
        project,
        nativeTarget.buildConfigurationList,
      )
        .filter(([, item]) => item.buildSettings.PRODUCT_NAME)
        .forEach(([, item]) => {
          item.buildSettings.CODE_SIGN_STYLE = "Automatic";
          item.buildSettings.DEVELOPMENT_TEAM = quotedTeamId;
          item.buildSettings.CODE_SIGN_IDENTITY = '"Apple Development"';
          delete item.buildSettings.PROVISIONING_PROFILE_SPECIFIER;
          delete item.buildSettings.PROVISIONING_PROFILE;
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
          section.attributes.TargetAttributes[nativeTargetId] = {
            ...prev,
            ProvisioningStyle: "Automatic",
            DevelopmentTeam: quotedTeamId,
          };
        });
    }

    return cfg;
  });
}

module.exports = withIosAutomaticSigning;
