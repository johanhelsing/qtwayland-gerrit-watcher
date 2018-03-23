"use strict";
const GerritEventEmitter = require('gerrit-event-emitter').GerritEventEmitter;
const emitter = new GerritEventEmitter('codereview.qt-project.org');
const { spawn } = require('child_process');
const { reduce } = require('lodash');
const fs = require('fs');

function startDockerTest(options, callback) {
    const { qtWaylandRev, qt5Rev, containerName } = options;
    const environment = {
        QT_DOCKERTEST_QTWAYLAND_REV: qtWaylandRev,
        QT_DOCKERTEST_QT5_REV: qt5Rev
    };
    const envArgs = reduce(environment, (args, value, key) => args.concat(['-e', `${key}=${value}`]), []);
    const command = `docker run ${envArgs} --name ${containerName} qtbuilder-stretch`;
    const args = [].concat(['run', '--name', containerName], envArgs, ['qtbuilder-stretch']);
    console.log('docker ' + args.join(' '));
    return spawn('docker', args);
}

emitter.on('patchsetCreated', data => {
    const { change, patchSet } = data;
    const { project, subject, branch, url } = change;

    //if (!project.startsWith('qt/')) {
    if (project !== 'qt/qtwayland') {
        return;
    }

    const prefix = `${url} #${patchSet.number} (${branch}) - ${subject} -`;
    //const prefix = `[${project}] ${url} #${patchSet.number} (${branch}) - ${subject} -`;

    console.log(prefix, 'STARTING TEST');

    const qtWaylandRev = patchSet.ref;
    const qt5Rev = branch;
    const containerName = `gerrit-watcher-${change.number}-${patchSet.number}`;
    startDockerTest({qtWaylandRev, qt5Rev, containerName}, (error, stdout, stderr) => {
        if (error) {
            console.log(prefix, "FAILED: error", error);
            console.log(stderr);
        } else {
            console.log(prefix, 'PASSED');
        }
    });
});

emitter.on('gerritStreamEnd', () => emitter.start());

console.log("Starting gerrit-watcher");
emitter.start();

const initContainerName = 'gerrit-watcher-init-test-'+Math.floor(new Date() / 1000);
const initTest = startDockerTest({qtWaylandRev: '5.11', qt5Rev: '5.11', containerName: initContainerName});
const logFile = fs.createWriteStream(`logs/${initContainerName}`);
initTest.stdout.pipe(logFile);
initTest.stderr.pipe(logFile);

initTest.on('close', code => {
    if (code != 0) {
        console.log(initContainerName, "FAILED: with code", code);
    } else {
        console.log(initContainerName, 'PASSED');
    }
    logFile.close();
});
