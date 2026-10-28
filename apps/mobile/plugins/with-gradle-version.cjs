const {withDangerousMod} = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// RN 0.83.2 uses Foojay 0.5, which references a vendor removed in Gradle 9.
// Gradle 8.14.3 supports AGP 8.12 and that toolchain resolver.
module.exports = config => withDangerousMod(config, ['android', async config => {
  const file = path.join(config.modRequest.platformProjectRoot, 'gradle/wrapper/gradle-wrapper.properties');
  let contents = await fs.readFile(file, 'utf8');
  contents = contents.replace(/^distributionUrl=.*$/m, 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-bin.zip');
  contents = contents.replace(/^distributionSha256Sum=.*\n?/m, '');
  contents += '\ndistributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531\n';
  await fs.writeFile(file, contents);
  return config;
}]);
