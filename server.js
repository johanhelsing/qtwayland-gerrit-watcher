"use strict";
const GerritEventEmitter = require('gerrit-event-emitter').GerritEventEmitter;
const { spawn } = require('child_process');
const { reduce } = require('lodash');
const fs = require('fs');
const express = require('express');
const serveIndex = require('serve-index');
const { scheduleJob } = require('node-schedule');

const gerritHost = 'codereview.qt-project.org';
const gerritSshPort = 29418;
const readLastLines = require('read-last-lines');
const parseVersion = require('./parseVersion');

const tests = [];

function unixTimeStamp() {
    return Math.floor(new Date() / 1000);
}

const testsFilePath = 'logs/results.json';
function restoreTests() {
    if (!fs.existsSync(testsFilePath)) return;
    fs.copyFileSync(testsFilePath, `${testsFilePath}.bak-${unixTimeStamp()}`);
    JSON.parse(fs.readFileSync(testsFilePath)).map(test => {
        if (test.status === 'running') test.status = 'aborted';
        tests.push(test);
    });
}

function saveTests() {
    fs.writeFile(testsFilePath, JSON.stringify(tests), err => {
        if (err) throw err;
    });
}

function startDockerTest(test, callback) {
    test.title = test.title || test.containerName;
    const { qtWaylandRev, qt5Rev, containerName, title } = test;
    const environment = {
        QT_DOCKERTEST_QTWAYLAND_REV: qtWaylandRev,
        QT_DOCKERTEST_QT5_REV: qt5Rev
    };
    const envArgs = reduce(environment, (args, value, key) => args.concat(['-e', `${key}=${value}`]), []);
    const command = `docker run ${envArgs} --name ${containerName} qtbuilder-stretch`;
    const args = [].concat(['run', '--name', containerName], envArgs, ['qtbuilder-stretch']);
    console.log('docker ' + args.join(' '));
    const testProcess = spawn('docker', args);
    test.status = 'running';

    const logFile = fs.createWriteStream(`logs/${containerName}.txt`);
    testProcess.stdout.pipe(logFile);
    testProcess.stderr.pipe(logFile);

    testProcess.on('close', code => {
        if (code != 0) {
            console.log(title, "Failed: with code", code);
            test.status = 'failed';
        } else {
            console.log(title, 'Passed');
            test.status = 'passed';
        }
        saveTests();
    });

    tests.push(test);
    saveTests();
    return testProcess; //TODO: Maybe return a promise instead?
}

function postGerritComment(commit, comment, codeReview) {
    const args = ['-p', gerritSshPort, gerritHost, 'gerrit', 'review', '-m', `"${comment}"`, commit];
    if (codeReview) {
        args.push('--code-review', codeReview);
    }
    console.log('ssh', args.join(' '));
    const p = spawn('ssh', args);
    p.stdout.on('data', data => console.log(data));
    p.stderr.on('data', data => console.log(data));
    p.on('close', code => {
        if (code != 0) {
            console.log(`Couldn't post gerrit comment, return code ${code}`);
        } else {
            console.log(`Posted gerrit comment on ${commit}`);
        }
    });
}

function listenForGerritChanges() {
    const emitter = new GerritEventEmitter(gerritHost);
    emitter.on('patchsetCreated', data => {
        const { change, patchSet } = data;
        const { project, subject, branch, url } = change;

        if (project !== 'qt/qtwayland') {
            return;
        }

        const version = parseVersion(branch);
        // The tests are currently broken for branches prior to 5.11
        if (version && version.major === 5 && version.minor < 11) {
            return;
        }

        const qtWaylandRev = patchSet.ref;
        const qt5Rev = branch;
        const containerName = `gerrit-watcher-${change.number}-${patchSet.number}`;

        const test = {
            qtWaylandRev,
            qt5Rev,
            containerName,
            title: `Change ${change.number} patch set #${patchSet.number} (${branch}) - ${subject}`,
            url
        };

        console.log('Starting test', test);
        const testProcess = startDockerTest(test);

        testProcess.on('close', code => {
            const failed = code != 0;
            const commit = `${change.number},${patchSet.number}`;
            var message = 'Experimental QtWayland Bot: Running headless tests for change ' +
                `${change.number}, patch set #${patchSet.number} ${failed ? 'failed' : 'succeeded'}`;
            message += "\n\nHow to run the tests locally: https://github.com/johanhelsing/docker-qt-tests";
            if (failed) {
                const codeReview = '-1';
                const tailLines = 30;
                readLastLines.read(`logs/${containerName}.txt`, tailLines).then(lines => {
                    const indentedLogTail = lines.replace(/^/mg, '    ');
                    message = `${message}\n\nLast ${tailLines} lines of log:\n\n${indentedLogTail}`;
                    console.log(message);
                    postGerritComment(commit, message, codeReview);
                }).catch(reason => console.log('Couldn\'t get last lines of log file', reason));
            } else {
                postGerritComment(commit, message);
            }
        });
    });

    // The ssh connection will sometimes disconnect us. In that case, just reconnect.
    emitter.on('gerritStreamEnd', () => emitter.start());

    console.log("Starting gerrit-watcher");
    emitter.start();
}

function testsPage(tests) {
    const title = 'Qt Wayland Test Results';
    return `
    <html>
        <head>
            <title>${title}</title>
            <style>
                .failed { color: darkred; }
                .passed { color: darkgreen; }
                .running { color: darkorange; }
                .aborted { color: gray; }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <p>For every patch set submitted to QtWayland, all QtWayland unit tests are run plus a relevant subset of the QtBase tests. The tests run on a headless Weston instance inside a docker container.</p>
            <p>Daily health checks are also run for some branches.</p>
            <p><a href="https://github.com/johanhelsing/docker-qt-tests">How to run/debug these tests locally</a></p>
            <p><a href="logs/">Browse log folder</a></p>
            <ul>
                ${tests.slice(0).reverse().map(test => `
                    <li class="${test.status}">
                        ${test.title} -
                        Qt: ${test.qt5Rev} -
                        QtWayland: ${test.qtWaylandRev} -
                        ${test.status} - 
                        ${test.url ? `<a href="${test.url}">${test.url}</a> - ` : ''}
                        <a href="logs/${test.containerName}.txt">log</a>
                    </li>
                `).join('\n')}
            </ul>
        </body>
    </html>
    `;
}

function serveLogs() {
    var server = express();
    server.use('/logs/', express.static(`${__dirname}/logs/`));
    server.use('/logs/', serveIndex(`${__dirname}/logs/`));
    server.get('/', (req, res) => res.send(testsPage(tests)));
    server.listen(8056);
}

function healthCheck(rev) {
    const containerName = `gerrit-watcher-health-check-${rev}-${unixTimeStamp()}`
    const title = `Health check ${rev} ${new Date().toISOString()}`;
    startDockerTest({qtWaylandRev: rev, qt5Rev: rev, containerName, title });
}

if (!fs.existsSync('logs')){
    fs.mkdirSync('logs');
}

restoreTests();
listenForGerritChanges();
scheduleJob({hour: 12, minute: 0}, () => {
    console.log('Running daily health check for dev');
    healthCheck('dev');
});
scheduleJob({hour: 11, minute: 0}, () => {
    console.log('Running daily health check for 5.11');
    healthCheck('5.11');
});

// Run initial tests
//healthCheck('5.11');
//healthCheck('dev');

serveLogs();
