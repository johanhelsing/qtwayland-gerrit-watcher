const GerritEventEmitter = require('gerrit-event-emitter').GerritEventEmitter;
const emitter = new GerritEventEmitter('codereview.qt-project.org');
const { exec } = require("child_process");

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
    const command = `docker run -e QT_DOCKERTEST_QTWAYLAND_REV=${qtWaylandRev} -e QT_DOCKERTEST_QT5_REV=${qt5Rev} --name gerrit-watcher-${change.number}-${patchSet.number} qtbuilder-stretch`;
    console.log(prefix, command);
    exec(command, (err, stdout, stderr) => {
        if (err) {
            console.log(prefix, 'FAILED');
            console.log(stderr);
        } else {
            console.log(prefix, 'PASSED');
        }
    });
});

emitter.on('gerritStreamEnd', () => emitter.start());

console.log("Starting gerrit-watcher");
emitter.start();
