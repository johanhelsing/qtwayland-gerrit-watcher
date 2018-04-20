# QtWayland Gerrit Watcher

Watches codereview.qt-project.org for gerrit changes and starts a container if
it's a QtWayland change

## Requirements

You need docker as well as the Docker image for doing headless wayland tests
installed available from you machine. See separate repo.

You also need to have a not-ancient version of npm and node installed.

Make sure you have ssh access to codereview.qt-project.org using the default
ssh account.

## Usage

    $ npm install
    $ npm start
