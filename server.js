"use strict";
const GerritEventEmitter = require('gerrit-event-emitter').GerritEventEmitter;
const { spawn } = require('child_process');
const { reduce } = require('lodash');
const fs = require('fs');
const express = require('express');
const serveIndex = require('serve-index');

const gerritHost = 'codereview.qt-project.org';
const gerritSshPort = 29418;

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
    return testProcess;
}

function postGerritComment(commit, comment, codeReview) {
    const args = ['-p', gerritSshPort, gerritHost, 'gerrit', 'review', '-m', `"${comment}"`, commit];
    if (codeReview) {
        args.push('--code-review', codeReview);
    }
    console.log('ssh', args.join('\n'));
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

        const qtWaylandRev = patchSet.ref;
        const qt5Rev = branch;
        const containerName = `gerrit-watcher-${change.number}-${patchSet.number}`;

        const test = {
            qtWaylandRev,
            qt5Rev,
            containerName,
            title: `Change ${change.number} patch set #${patchSet.number} (${branch}) - ${subject} -`,
            url
        };

        console.log('Starting test', test);
        const testProcess = startDockerTest(test);

        testProcess.on('close', code => {
            const commit = `${change.number},${patchSet.number}`;
            const message = 'Experimental QtWayland Bot: ' +
                `Running headless tests ${commit} ${code ? 'failed' : 'succeeded'}`;
            const codeReview = code && '-1';
            postGerritComment(commit, message, codeReview);
        });
    });

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
            <p><a href="logs/">Browse logs</a></p>
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

function initTest() {
    const initContainerName = 'gerrit-watcher-init-test-'  + unixTimeStamp();
    const initTest = startDockerTest({qtWaylandRev: '5.11', qt5Rev: '5.11', containerName: initContainerName});
}

if (!fs.existsSync('logs')){
    fs.mkdirSync('logs');
}

restoreTests();
listenForGerritChanges();
initTest();
serveLogs();
