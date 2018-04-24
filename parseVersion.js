const versionStringRe = /v?(\d+)\.(\d+)(\.(\d+))?/;
function parseVersion(versionString) {
    const match = versionString.match(versionStringRe);
    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    const patch = parseInt(match[4]) || undefined;
    return { major: major, minor: minor, patch: patch};
}

module.exports = parseVersion;

//console.log(parseVersion("5.10.1"));
//console.log(parseVersion("v5.10.1"));
//console.log(parseVersion("5.10"));

