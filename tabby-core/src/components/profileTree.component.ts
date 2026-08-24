import { Component, HostBinding, HostListener, Input } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import deepClone from 'clone-deep'
import FuzzySearch from 'fuzzy-search'

import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { AppService } from '../services/app.service'
import { SelectorService } from '../services/selector.service'
import { PlatformService } from '../api/platform'
import { ProfileProvider } from '../api/index'
import { PartialProfileGroup, ProfileGroup, PartialProfile, Profile } from '../index'
import { BaseComponent } from './base.component'

interface CollapsableProfileGroup extends ProfileGroup {
    collapsed: boolean
    children: PartialProfileGroup<CollapsableProfileGroup>[]
}

/**
 * Maximum folder nesting depth: top-level folders (depth 0) plus one level
 * of subfolders (depth 1). Connections may live at the root, in a top-level
 * folder or in a subfolder.
 */
const MAX_GROUP_DEPTH = 2

/** Width of the sidebar when collapsed, in px */
const COLLAPSED_WIDTH = 44

/** Pseudo-groups synthesized by ProfilesService - not user editable */
const VIRTUAL_GROUP_IDS = ['built-in', 'ungrouped', 'search']

/** @hidden */
@Component({
    selector: 'profile-tree',
    styleUrls: ['./profileTree.component.scss'],
    templateUrl: './profileTree.component.pug',
})
export class ProfileTreeComponent extends BaseComponent {
    profileGroups: PartialProfileGroup<ProfileGroup>[] = []
    rootGroups: PartialProfileGroup<ProfileGroup>[] = []

    filteredProfiles: PartialProfile<Profile>[] = []
    @Input() filter = ''

    panelMinWidth = 200
    panelMaxWidth = 600
    panelInternalWidth: number = parseInt(window.localStorage.profileTreeWidth ?? '300')
    panelStartWidth = this.panelInternalWidth
    panelIsResizing = false
    panelStartX = 0

    sidebarCollapsed: boolean = window.localStorage.profileTreeCollapsed === 'true'

    constructor (
        private app: AppService,
        private platform: PlatformService,
        private config: ConfigService,
        private profilesService: ProfilesService,
        private selector: SelectorService,
        private translate: TranslateService,
        private ngbModal: NgbModal,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        await this.loadTreeItems()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.loadTreeItems())
        this.app.tabsChanged$.subscribe(() => this.tabStateChanged())
        this.app.activeTabChange$.subscribe(() => this.tabStateChanged())
    }

    private async loadTreeItems (): Promise<void> {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        let groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })

        for (const group of groups) {
            if (group.profiles?.length) {
                // remove template profiles
                group.profiles = group.profiles.filter(x => !x.isTemplate)

                // remove blocklisted profiles
                group.profiles = group.profiles.filter(x => x.id && !this.config.store.profileBlacklist.includes(x.id))
            }
        }

        if (!this.config.store.terminal.showBuiltinProfiles) { groups = groups.filter(g => g.id !== 'built-in') }

        groups.sort((a, b) => a.name.localeCompare(b.name))
        groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !b.editable ? 1 : 0))
        groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))
        this.profileGroups = groups.map(g => ProfileTreeComponent.intoPartialCollapsableProfileGroup(g, profileGroupCollapsed[g.id] ?? false))
        this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
    }

    ////// GROUP HIERARCHY RULES //////

    /**
    * True for real, user-managed groups (excludes 'Ungrouped', 'Built-in' and search results)
    */
    isUserGroup (group: PartialProfileGroup<ProfileGroup>): boolean {
        return !!group.editable && !VIRTUAL_GROUP_IDS.includes(group.id)
    }

    /**
    * Nesting depth of a group: 0 for a top-level folder, 1 for a subfolder
    */
    groupDepth (groupId?: string): number {
        let depth = 0
        let currentId = groupId
        let guard = 0
        while (currentId && guard++ < 30) {
            const group = this.profilesService.resolveProfileGroup(currentId)
            if (!group?.parentGroupId) {
                break
            }
            depth++
            currentId = group.parentGroupId
        }
        return depth
    }

    /**
    * A subfolder may only be created inside a top-level folder (two levels max)
    */
    canAddSubgroup (group: PartialProfileGroup<ProfileGroup>): boolean {
        return this.isUserGroup(group) && this.groupDepth(group.id) < MAX_GROUP_DEPTH - 1
    }

    ////// PROFILES CRUD //////

    /**
    * Create a new connection, optionally inside a given folder
    */
    async newProfile (group?: PartialProfileGroup<ProfileGroup>): Promise<void> {
        let profiles = await this.profilesService.getProfiles()
        profiles = profiles.filter(x => !x.id || !this.config.store.profileBlacklist.includes(x.id))

        const base = await this.selector.show<PartialProfile<Profile>>(
            this.translate.instant('Select a base profile to use as a template'),
            profiles.map(p => ({
                icon: p.icon ?? undefined,
                description: this.profilesService.getDescription(p) ?? undefined,
                name: p.group ? `${this.profilesService.resolveProfileGroupName(p.group)} / ${p.name}` : p.name,
                group: p.isTemplate ? this.translate.instant('Template') : this.translate.instant('Duplicate an existing profile'),
                result: p,
                weight: p.isTemplate ? 0 : 1,
            })),
        ).catch(() => undefined)

        if (!base) {
            return
        }

        const baseProfile: PartialProfile<Profile> = deepClone(base)
        delete baseProfile.id
        if (base.isTemplate) {
            baseProfile.name = ''
        } else if (!base.isBuiltin) {
            baseProfile.name = this.translate.instant('{name} copy', base)
        }
        baseProfile.isBuiltin = false
        baseProfile.isTemplate = false

        if (group && this.isUserGroup(group)) {
            baseProfile.group = group.id
        } else {
            delete baseProfile.group
        }

        const result = await this.showProfileEditModal(baseProfile)
        if (!result) {
            return
        }
        if (!result.name) {
            const cfgProxy = this.profilesService.getConfigProxyForProfile(result)
            result.name = this.profilesService.providerForProfile(result)?.getSuggestedName(cfgProxy) ?? this.translate.instant('{name} copy', base)
        }
        await this.profilesService.newProfile(result)
        await this.config.save()
    }

    async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        const result = await this.showProfileEditModal(profile)
        if (!result) {
            return
        }
        await this.profilesService.writeProfile(result)
        await this.config.save()
    }

    async duplicateProfile (profile: PartialProfile<Profile>): Promise<void> {
        const dup: PartialProfile<Profile> = deepClone(profile)
        delete dup.id
        dup.name = this.translate.instant('{name} copy', profile)
        dup.isBuiltin = false
        dup.isTemplate = false

        const result = await this.showProfileEditModal(dup)
        if (!result) {
            return
        }
        await this.profilesService.newProfile(result)
        await this.config.save()
    }

    async deleteProfile (profile: PartialProfile<Profile>): Promise<void> {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', profile),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            await this.profilesService.deleteProfile(profile)
            await this.config.save()
        }
    }

    private async showProfileEditModal (profile: PartialProfile<Profile>): Promise<PartialProfile<Profile>|null> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )

        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) { throw new Error('Cannot edit a profile without a provider') }

        modal.componentInstance.partialProfile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) { return null }

        result.type = provider.id
        return result
    }

    ////// GROUPS CRUD //////

    /**
    * Create a new folder, optionally nested inside `parent` (two levels max)
    */
    async newGroup (parent?: PartialProfileGroup<ProfileGroup>): Promise<void> {
        if (parent && !this.canAddSubgroup(parent)) {
            await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Folders can only be nested two levels deep'),
                buttons: [this.translate.instant('OK')],
                defaultId: 0,
                cancelId: 0,
            })
            return
        }

        const group: PartialProfileGroup<CollapsableProfileGroup> = {
            id: 'new',
            name: '',
            icon: 'far fa-folder',
        } as PartialProfileGroup<CollapsableProfileGroup>

        if (parent) {
            group.parentGroupId = parent.id
        }

        await this.editProfileGroup(group)
    }

    async editProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        const { EditProfileGroupModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileGroupModalComponent,
            { size: 'lg' },
        )

        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profilesService.getProviders()
        modal.componentInstance.maxDepth = MAX_GROUP_DEPTH

        const result: PartialProfileGroup<ProfileGroup & { group: PartialProfileGroup<CollapsableProfileGroup>, provider?: ProfileProvider<Profile> }> | null = await modal.result.catch(() => null)
        if (!result) { return }
        if (!result.group) { return }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        delete result.group.collapsed
        delete result.group.children
        await this.profilesService.writeProfileGroup(result.group)
        await this.config.save()
    }

    async deleteProfileGroup (group: PartialProfileGroup<ProfileGroup>): Promise<void> {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', group),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            let deleteProfiles = false
            if ((group.profiles?.length ?? 0) > 0 && (await this.platform.showMessageBox(
                {
                    type: 'warning',
                    message: this.translate.instant('Delete the group\'s profiles?'),
                    buttons: [
                        this.translate.instant('Move to "Ungrouped"'),
                        this.translate.instant('Delete'),
                    ],
                    defaultId: 0,
                    cancelId: 0,
                },
            )).response !== 0) {
                deleteProfiles = true
            }

            await this.profilesService.deleteProfileGroup(group, { deleteProfiles })
            await this.config.save()
        }
    }

    private async editProfileGroupDefaults (group: PartialProfileGroup<CollapsableProfileGroup>, provider: ProfileProvider<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.partialProfile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }
        return this.editProfileGroup(group)
    }

    ////// CONTEXT MENUS //////

    async profileContextMenu (profile: PartialProfile<Profile>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()

        const isEditable = !(profile.isBuiltin ?? profile.isTemplate)

        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('Run'),
                click: () => this.launchProfile(profile),
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit profile'),
                click: () => this.editProfile(profile),
                enabled: isEditable,
            },
            {
                type: 'normal',
                label: this.translate.instant('Duplicate'),
                click: () => this.duplicateProfile(profile),
            },
            { type: 'separator' },
            {
                type: 'normal',
                label: this.translate.instant('Delete'),
                click: () => this.deleteProfile(profile),
                enabled: isEditable,
            },
        ])
    }

    async groupContextMenu (group: PartialProfileGroup<CollapsableProfileGroup>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()

        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('New connection'),
                click: () => this.newProfile(group),
            },
            {
                type: 'normal',
                label: this.translate.instant('New folder'),
                click: () => this.newGroup(group),
                enabled: this.canAddSubgroup(group),
            },
            { type: 'separator' },
            {
                type: 'normal',
                label: group.collapsed ? this.translate.instant('Expand group') : this.translate.instant('Collapse group'),
                click: () => this.toggleGroupCollapse(group),
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit group'),
                click: () => this.editProfileGroup(group),
                enabled: this.isUserGroup(group),
            },
            { type: 'separator' },
            {
                type: 'normal',
                label: this.translate.instant('Delete'),
                click: () => this.deleteProfileGroup(group),
                enabled: this.isUserGroup(group),
            },
        ])
    }

    /**
    * Context menu for the empty area / toolbar of the tree
    */
    async rootContextMenu (event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('New connection'),
                click: () => this.newProfile(),
            },
            {
                type: 'normal',
                label: this.translate.instant('New folder'),
                click: () => this.newGroup(),
            },
        ])
    }

    private async tabStateChanged (): Promise<void> {
        // TODO: show active tab in the side panel with eye icon
    }

    async launchProfile<P extends Profile> (profile: PartialProfile<P>): Promise<any> {
        return this.profilesService.launchProfile(profile)
    }

    async onFilterChange (): Promise<void> {
        try {
            const q = this.filter.trim().toLowerCase()

            if (q.length === 0) {
                this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
                return
            }

            const profiles = await this.profilesService.getProfiles({
                includeBuiltin: this.config.store.terminal.showBuiltinProfiles,
                clone: true,
            })

            const matches = new FuzzySearch(
                profiles.filter(p => !p.isTemplate),
                ['name', 'description'],
                { sort: false },
            ).search(q)

            this.rootGroups = [
                {
                    id: 'search',
                    editable: false,
                    name: this.translate.instant('Filter results'),
                    icon: 'fas fa-magnifying-glass',
                    profiles: matches,
                },
            ]
        } catch (error) {
            console.error('Error occurred during search:', error)
        }
    }

    ////// SIDEBAR COLLAPSING //////

    toggleSidebar (): void {
        this.sidebarCollapsed = !this.sidebarCollapsed
        window.localStorage.profileTreeCollapsed = this.sidebarCollapsed ? 'true' : 'false'
    }

    @HostBinding('class.collapsed')
    get isSidebarCollapsed (): boolean {
        return this.sidebarCollapsed
    }

    /** Disables the width transition while the user drags the grabber */
    @HostBinding('class.resizing')
    get isResizing (): boolean {
        return this.panelIsResizing
    }

    ////// RESIZING //////
    startResize (event: MouseEvent): void {
        if (this.sidebarCollapsed) {
            return
        }
        this.panelIsResizing = true
        this.panelStartX = event.clientX
        this.panelStartWidth = this.panelInternalWidth
        event.preventDefault()
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove (event: MouseEvent): void {
        if (!this.panelIsResizing) { return }
        const delta = event.clientX - this.panelStartX
        const width = Math.min(Math.max(this.panelMinWidth, this.panelStartWidth + delta), this.panelMaxWidth)
        this.panelWidth = width
        window.localStorage.profileTreeWidth = width
    }

    @HostListener('document:mouseup')
    stopResize (): boolean {
        this.panelIsResizing = false
        return true
    }

    @HostBinding('style.width.px')
    get panelWidth (): number {
        return this.sidebarCollapsed ? COLLAPSED_WIDTH : this.panelInternalWidth
    }

    set panelWidth (value: number) {
        this.panelInternalWidth = value
    }

    ////// GROUP COLLAPSING //////
    toggleGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        group.collapsed = !group.collapsed
        this.saveProfileGroupCollapse(group)
    }

    private saveProfileGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        profileGroupCollapsed[group.id] = group.collapsed
        window.localStorage.profileGroupCollapsed = JSON.stringify(profileGroupCollapsed)
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }

}
