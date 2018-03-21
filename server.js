const GerritEventEmitter = require('gerrit-event-emitter').GerritEventEmitter;
const emitter = new GerritEventEmitter('codereview.qt-project.org', 29418);
const { exec } = require("child_process");

emitter.on('patchsetCreated', function(data) {
    const { change, patchSet } = data;
    const { owner, project, subject } = change;

    if (project !== 'qt/qtwayland') {
        return;
    }

    console.log(`Detected new patch set in ${project} by ${owner}: ${subject}`);
    const qtWaylandRev = "5.11"; //patchSet.revision;
    const qt5Rev = "5.11";
    const command = `docker run -e QT_DOCKERTEST_QTWAYLAND_REV=${qtWaylandRev} -e QT_DOCKERTEST_QT5_REV=${qt5Rev} qtbuilder-stretch`;
    console.log(`Starting test "${command}"`);
    exec(command, (err, stdout, stderr) => {
        console.log('Testing finished');
        console.log(err ? 'Failure :(' : 'Great success :D');
    });
});

emitter.start();
