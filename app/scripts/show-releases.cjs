const fs = require('node:fs');
const path = require('node:path');

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

async function main() {
  const response = await fetch('https://api.github.com/repos/siganberg/ncSender/releases');
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status}`);
  }
  const releases = await response.json();
  console.log('Current version from package.json:', current);
  console.log('Latest releases from GitHub:');
  for (const release of releases.slice(0, 5)) {
    console.log(`- ${release.tag_name} (prerelease: ${release.prerelease}, draft: ${release.draft})`);
  }
}

main().catch((error) => {
  console.error('Failed to query releases:', error);
});
