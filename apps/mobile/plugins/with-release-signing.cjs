const {withAppBuildGradle} = require('expo/config-plugins');

module.exports = config => withAppBuildGradle(config, config => {
  const marker = '// Barzinho release signing';
  if (!config.modResults.contents.includes(marker)) config.modResults.contents += `
${marker}
def releaseStore = System.getenv('BARZINHO_ANDROID_KEYSTORE')
def releasePassword = System.getenv('BARZINHO_ANDROID_STORE_PASSWORD')
def releaseAlias = System.getenv('BARZINHO_ANDROID_KEY_ALIAS')
def releaseKeyPassword = System.getenv('BARZINHO_ANDROID_KEY_PASSWORD')
def releaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
if (releaseRequested && (!releaseStore || !releasePassword || !releaseAlias || !releaseKeyPassword)) {
    throw new GradleException('Configure the four BARZINHO_ANDROID signing variables before building a release.')
}
android {
    signingConfigs {
        release {
            if (releaseStore) {
                storeFile file(releaseStore)
                storePassword releasePassword
                keyAlias releaseAlias
                keyPassword releaseKeyPassword
            }
        }
    }
    buildTypes.release.signingConfig = signingConfigs.release
}
`;
  return config;
});
