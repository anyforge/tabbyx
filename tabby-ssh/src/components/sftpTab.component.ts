import { Component, Injector, Input } from '@angular/core'
import { BaseTabComponent } from 'tabby-core'
import { SSHSession } from '../session/ssh'
import { SSHProfile } from '../api'

/**
 * SFTP file browser rendered as its own tab, so it can be placed in a
 * split pane next to the terminal instead of overlaying it.
 */
@Component({
    selector: 'sftp-tab',
    template: require('./sftpTab.component.pug'),
    styles: [require('./sftpTab.component.scss')],
})
export class SFTPTabComponent extends BaseTabComponent {
    @Input() session: SSHSession
    @Input() profile: SSHProfile
    @Input() path = '/'
    @Input() cwdDetectionAvailable = false

    // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- Angular DI forwards injector to BaseTabComponent
    constructor (injector: Injector) {
        super(injector)
    }

    ngOnInit (): void {
        this.setTitle(`SFTP · ${this.profile.name}`)
        this.icon = 'far fa-folder-open'

        // When the underlying SSH session dies (tab closed / disconnected),
        // close this pane as well.
        this.subscribeUntilDestroyed(this.session.willDestroy$, () => {
            this.destroy()
        })
    }

    close (): void {
        this.destroy()
    }
}
