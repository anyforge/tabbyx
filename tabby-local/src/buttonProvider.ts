/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Injectable } from '@angular/core'
import { CommandProvider, Command, TranslateService } from 'tabby-core'
import { TerminalService } from './services/terminal.service'

/** @hidden */
@Injectable()
export class ButtonProvider extends CommandProvider {
    constructor (
        private terminal: TerminalService,
        private translate: TranslateService,
    ) {
        super()
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'local:new-terminal',
                /**
                 * Intentionally not placed on the tab bar or the start page:
                 * connections are created and managed from the sidebar
                 * connection tree. Still reachable from the command palette
                 * and via the `new-tab` hotkey.
                 */
                locations: [],
                label: this.translate.instant('New terminal'),
                icon: require('./icons/plus.svg'),
                touchBarNSImage: 'NSTouchBarAddDetailTemplate',
                run: async () => {
                    this.terminal.openTab()
                },
            },
        ]
    }
}
