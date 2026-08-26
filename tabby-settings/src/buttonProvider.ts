import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService, HostAppService, HotkeysService } from 'tabby-core'

import { SettingsTabComponent } from './components/settingsTab.component'

/** @hidden */
@Injectable()
export class ButtonProvider extends ToolbarButtonProvider {
    constructor (
        hostApp: HostAppService,
        hotkeys: HotkeysService,
        private app: AppService,
    ) {
        super()
        hostApp.settingsUIRequest$.subscribe(() => this.open())

        hotkeys.hotkey$.subscribe(async (hotkey) => {
            if (hotkey === 'settings') {
                this.open()
            }
        })
    }

    provide (): ToolbarButton[] {
        // 设置入口已移到左侧连接树左下角（profile-tree 的 tree-footer），
        // 不再占用 tab bar 右侧工具栏位置。热键 `settings` 与 settingsUIRequest$ 仍然生效。
        return []
    }

    open (): void {
        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsTabComponent)
        if (settingsTab) {
            this.app.selectTab(settingsTab)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent })
        }
    }
}
