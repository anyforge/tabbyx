// Registers main-process error logging - must be first so it catches import-time errors
import { logMainError } from './errors'

import { app, ipcMain, Menu, dialog } from 'electron'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

// set userData Path on portable version
import './portable'

// 统一 macOS/Linux 配置目录到 ~/.config/tabbyx/（XDG 规范；Linux 默认已是）
if (process.platform === 'darwin') {
    const xdgDataDir = path.join(os.homedir(), '.config', 'tabbyx')
    const legacyDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'tabbyx')
    app.setPath('userData', xdgDataDir)

    // 一次性迁移旧 macOS 配置：~/Library/Application Support/tabbyx/config.yaml → ~/.config/tabbyx/config.yaml
    try {
        const newConfig = path.join(xdgDataDir, 'config.yaml')
        const legacyConfig = path.join(legacyDataDir, 'config.yaml')
        if (!fs.existsSync(newConfig) && fs.existsSync(legacyConfig)) {
            fs.mkdirSync(xdgDataDir, { recursive: true })
            fs.copyFileSync(legacyConfig, newConfig)
        }
    } catch (err) {
        console.error('Failed to migrate config directory:', err)
    }
}

// set defaults of environment variables
import 'dotenv/config'
process.env.TABBY_PLUGINS ??= ''
process.env.TABBY_CONFIG_DIRECTORY ??= app.getPath('userData')

import 'source-map-support/register'
import './sentry'
import './lru'
import { parseArgs } from './cli'
import { Application } from './app'
import electronDebug from 'electron-debug'
import { loadConfig } from './config'

const argv = parseArgs(process.argv, process.cwd())

// eslint-disable-next-line @typescript-eslint/init-declarations
let configStore: any

try {
    configStore = loadConfig()
} catch (err) {
    dialog.showErrorBox('Could not read config', err.message)
    app.exit(1)
}

process.mainModule = module

const application = new Application(configStore)

// Register tabbyx:// URL scheme
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('tabbyx', process.execPath, [process.argv[1]])
    }
} else {
    app.setAsDefaultProtocolClient('tabbyx')
}

ipcMain.on('app:new-window', () => {
    application.newWindow()
})

process.on('uncaughtException', err => {
    application.broadcast('uncaughtException', err)
})

if (argv.d) {
    electronDebug({
        isEnabled: true,
        showDevTools: true,
        devToolsMode: 'undocked',
    })
}

app.on('activate', async () => {
    if (!application.hasWindows()) {
        application.newWindow()
    } else {
        application.focus()
    }
})

// Handle URL scheme on macOS
app.on('open-url', async (event, url) => {
    event.preventDefault()
    console.log('Received open-url event:', url)
    if (!application.hasWindows()) {
        process.argv.push(url)
    } else {
        await app.whenReady()
        application.handleSecondInstance([url], process.cwd())
    }
})

app.on('second-instance', async (_event, newArgv, cwd) => {
    application.handleSecondInstance(newArgv, cwd)
})

if (!app.requestSingleInstanceLock()) {
    app.quit()
    app.exit(0)
}

app.on('ready', async () => {
    if (process.platform === 'darwin') {
        app.dock.setMenu(Menu.buildFromTemplate([
            {
                label: 'New window',
                click () {
                    this.app.newWindow()
                },
            },
        ]))
    }

    try {
        application.init()

        const window = await application.newWindow({ hidden: argv.hidden })
        await window.ready
        window.passCliArguments(process.argv, process.cwd(), false)
        window.focus()
    } catch (err) {
        logMainError('Failed to open window', err)
        dialog.showErrorBox('TabbyX failed to start', String(err?.stack ?? err))
        app.exit(1)
    }
})
