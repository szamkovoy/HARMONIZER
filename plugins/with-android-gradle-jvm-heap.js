/**
 * Bumps Gradle JVM heap so release R8 minify does not OOM on this RN app.
 * Default Expo template uses -Xmx2048m — too small once enableMinifyInReleaseBuilds
 * is on (Skia, Vision Camera, Firebase, etc.).
 *
 * Applied during prebuild → android/gradle.properties (EAS local/cloud included).
 */
const { withGradleProperties } = require("expo/config-plugins");

const JVM_ARGS_KEY = "org.gradle.jvmargs";
const JVM_ARGS_VALUE =
  "-Xmx6144m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8";

function withAndroidGradleJvmHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const idx = props.findIndex(
      (item) => item.type === "property" && item.key === JVM_ARGS_KEY,
    );
    if (idx >= 0) {
      props[idx].value = JVM_ARGS_VALUE;
    } else {
      props.push({ type: "property", key: JVM_ARGS_KEY, value: JVM_ARGS_VALUE });
    }
    return cfg;
  });
}

module.exports = withAndroidGradleJvmHeap;
