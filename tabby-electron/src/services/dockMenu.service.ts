import { NgZone, Injectable } from '@angular/core'
import { ConfigService, HostAppService, Platform, ProfilesService, TranslateService } from 'tabby-core'
import { ElectronService } from './electron.service'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class DockMenuService {
    appVersion: string

    private constructor (
        private configService: ConfigService,
        private electron: ElectronService,
        private hostApp: HostAppService,
        private zone: NgZone,
        private profilesService: ProfilesService,
        private translate: TranslateService,
    ) {
        this.configService.changed$.subscribe(() => this.update())
    }

    async update (): Promise<void> {
        let profiles = await this.profilesService.getProfiles()
        profiles = profiles.filter(x => x.id && !this.configService.store.profileBlacklist.includes(x.id))
        const recentProfiles = this.profilesService.getRecentProfiles().filter(x => x.id && !this.configService.store.profileBlacklist.includes(x.id))

        if (this.hostApp.platform === Platform.Windows) {
            this.electron.app.setJumpList([
                {
                    type: 'custom',
                    name: this.translate.instant('Recent'),
                    items: recentProfiles.map((profile, index) => ({
                        type: 'task',
                        program: process.execPath,
                        args: `recent ${index}`,
                        title: profile.name,
                        iconPath: process.execPath,
                        iconIndex: 0,
                    })),
                },
                {
                    type: 'custom',
                    name: this.translate.instant('Profiles'),
                    items: profiles.map(profile => ({
                        type: 'task', program: process.execPath,
                        args: `profile "${profile.name}"`,
                        title: profile.name,
                        iconPath: process.execPath,
                        iconIndex: 0,
                    })),
                },
            ])
        }
        if (this.hostApp.platform === Platform.macOS) {
            // macOS Dock 右键菜单：只保留「新建窗口」，不列出连接类型/连接列表
            //（新建与管理连接统一收敛到应用内左侧连接树）。
            this.electron.app.dock?.setMenu(this.electron.Menu.buildFromTemplate(
                [
                    {
                        label: this.translate.instant('New Window'),
                        click: () => this.zone.run(() => this.hostApp.newWindow()),
                    },
                ],
            ))
        }
    }
}
