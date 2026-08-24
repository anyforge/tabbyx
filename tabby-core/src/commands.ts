/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Injectable } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'

import { HostAppService, Platform } from './api/hostApp'
import { ProfilesService } from './services/profiles.service'
import { CommandProvider, Command, CommandLocation } from './api/commands'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class CoreCommandProvider extends CommandProvider {
    constructor (
        private hostApp: HostAppService,
        private profilesService: ProfilesService,
        private translate: TranslateService,
    ) {
        super()
    }

    async activate () {
        const profile = await this.profilesService.showProfileSelector().catch(() => null)
        if (profile) {
            this.profilesService.launchProfile(profile)
        }
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'core:profile-selector',
                /**
                 * Intentionally not placed on the tab bar or the start page:
                 * connections are created and managed from the sidebar
                 * connection tree. Still reachable from the command palette
                 * and via the `profile-selector` hotkey.
                 */
                locations: [],
                label: this.translate.instant('Profiles & connections'),
                icon: this.hostApp.platform === Platform.Web
                    ? require('./icons/plus.svg')
                    : require('./icons/profiles.svg'),
                run: async () => this.activate(),
            },
            ...this.profilesService.getRecentProfiles().map((profile, index) => ({
                id: `core:recent-profile-${index}`,
                label: profile.name,
                locations: [CommandLocation.StartPage],
                icon: require('./icons/history.svg'),
                run: async () => {
                    const p = (await this.profilesService.getProfiles()).find(x => x.id === profile.id) ?? profile
                    this.profilesService.launchProfile(p)
                },
            })),
        ]
    }
}
