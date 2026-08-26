/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-extraneous-class */

import './polyfills.buffer'
import { Duplex } from 'stream-browserify'

const TabbyX = window['TabbyX']

export class SocketProxy extends Duplex {
    socket: any

    constructor (...args: any[]) {
        super({
            allowHalfOpen: false,
        })
        this.socket = window['__connector__'].createSocket(...args)
        this.socket.connect$.subscribe(() => this['emit']('connect'))
        this.socket.data$.subscribe(data => this['emit']('data', Buffer.from(data)))
        this.socket.error$.subscribe(error => this['emit']('error', error))
    }

    connect (...args: any[]) {
        this.socket.connect(...args)
    }

    setNoDelay () { }

    setTimeout () { }

    _read (_size: number): void { }

    _write (chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
        this.socket.write(chunk)
        callback()
    }

    _destroy (error: Error|null, callback: (error: Error|null) => void): void {
        this.socket.close(error)
        callback(error)
    }
}

TabbyX.registerMock('fs', {
    rmdirSync: () => null,
    realpathSync: () => null,
    readdir: () => null,
    stat: () => null,
    appendFile: () => null,
    constants: {},
})
TabbyX.registerMock('fs/promises', {})
TabbyX.registerMock('tls', {})
TabbyX.registerMock('module', {
    globalPaths: [],
    prototype: { require: window['require'] },
})

TabbyX.registerMock('http', {
    Agent: class {},
    request: {},
})
TabbyX.registerMock('https', {
    Agent: class {},
    request: {},
})
TabbyX.registerMock('querystring', {})
TabbyX.registerMock('tty', { isatty: () => false })
TabbyX.registerMock('child_process', {})
TabbyX.registerMock('readable-stream', {})
TabbyX.registerMock('os', {
    arch: () => 'web',
    platform: () => 'web',
    homedir: () => '/home',
    tmpdir: () => '/tmp',
    constants: {
        errno: {},
    },
})
TabbyX.registerModule('buffer', {
    Buffer: window['Buffer'],
})
TabbyX.registerModule('crypto', {
    ...require('crypto-browserify'),
    getHashes () {
        return ['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'md5', 'rmd160']
    },
    timingSafeEqual (a, b) {
        return a.equals(b)
    },
})
TabbyX.registerMock('dns', {})
TabbyX.registerMock('@luminati-io/socksv5', {})
TabbyX.registerMock('util', require('util/'))
TabbyX.registerMock('keytar', {
    getPassword: () => null,
})
TabbyX.registerMock('@serialport/bindings', {})
TabbyX.registerMock('@serialport/bindings-cpp', {})
TabbyX.registerMock('tmp', {})

TabbyX.registerModule('net', {
    Socket: SocketProxy,
})
TabbyX.registerModule('events', require('events'))
TabbyX.registerModule('path', require('path-browserify'))
TabbyX.registerModule('url', {
    ...require('url'),
    pathToFileURL: x => `file://${x}`,
})
TabbyX.registerModule('zlib', {
    ...require('browserify-zlib'),
    constants: require('browserify-zlib'),
})
TabbyX.registerModule('assert', Object.assign(
    require('assert'),
    {
        assertNotStrictEqual: () => true,
        notStrictEqual: () => true,
    },
))
TabbyX.registerModule('constants', require('constants-browserify'))
TabbyX.registerModule('stream', require('stream-browserify'))
TabbyX.registerModule('readline', {
    ...require('readline-browserify'),
    cursorTo: () => null,
    clearLine: stream => stream.write('\r'),
})

TabbyX.registerModule('@angular/core', require('@angular/core'))
TabbyX.registerModule('@angular/cdk', require('@angular/cdk'))
TabbyX.registerModule('@angular/cdk/clipboard', require('@angular/cdk/clipboard'))
TabbyX.registerModule('@angular/cdk/drag-drop', require('@angular/cdk/drag-drop'))
TabbyX.registerModule('@angular/compiler', require('@angular/compiler'))
TabbyX.registerModule('@angular/common', require('@angular/common'))
TabbyX.registerModule('@angular/forms', require('@angular/forms'))
TabbyX.registerModule('@angular/platform-browser', require('@angular/platform-browser'))
TabbyX.registerModule('@angular/platform-browser/animations', require('@angular/platform-browser/animations'))
TabbyX.registerModule('@angular/platform-browser-dynamic', require('@angular/platform-browser-dynamic'))
TabbyX.registerModule('@angular/animations', require('@angular/animations'))
TabbyX.registerModule('@angular/localize', require('@angular/localize'))
TabbyX.registerModule('@angular/localize/init', require('@angular/localize/init'))
TabbyX.registerModule('@ng-bootstrap/ng-bootstrap', require('@ng-bootstrap/ng-bootstrap'))
TabbyX.registerModule('ngx-toastr', require('ngx-toastr'))
TabbyX.registerModule('deepmerge', require('deepmerge'))
TabbyX.registerModule('rxjs', require('rxjs'))
TabbyX.registerModule('rxjs/operators', require('rxjs'))
TabbyX.registerModule('string_decoder', require('string_decoder'))
TabbyX.registerModule('js-yaml', require('js-yaml'))
TabbyX.registerModule('zone.js/dist/zone.js', require('zone.js'))
TabbyX.registerModule('zone.js', require('zone.js'))
TabbyX.registerModule('any-promise', require('any-promise'))

Object.assign(window, {
    __dirname: '__dirname',
    setImmediate: setTimeout as any,
})

process.addListener = () => null
