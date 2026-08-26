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

    /** User-created profiles without a folder, rendered at the tree root */
    rootProfiles: PartialProfile<Profile>[] = []

    filteredProfiles: PartialProfile<Profile>[] = []
    @Input() filter = ''

    panelMinWidth = 200
    panelMaxWidth = 600
    panelInternalWidth = 300
    panelStartWidth = this.panelInternalWidth
    panelIsResizing = false
    panelStartX = 0

    sidebarCollapsed = false

    /** 拖拽中的源项（连接或文件夹） */
    private dragPayload: { type: 'profile' | 'group', profile?: PartialProfile<Profile>, group?: PartialProfileGroup<CollapsableProfileGroup> } | null = null

    /** 拖拽源项 id，用于给拖拽中的 item 加半透明样式 */
    dragSourceId: string | null = null

    /** 当前高亮的放置目标（'root' 或 group id） */
    dragOverTargetId: string | null = null

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
        this.migrateSidebarState()
        this.sidebarCollapsed = this.config.store.appearance.profileTreeCollapsed ?? false
        this.panelInternalWidth = this.config.store.appearance.profileTreeWidth ?? 300
        this.panelStartWidth = this.panelInternalWidth

        await this.loadTreeItems()
        this.subscribeUntilDestroyed(this.config.changed$, () => {
            this.loadTreeItems()
            const width = this.config.store.appearance.profileTreeWidth
            if (typeof width === 'number' && width !== this.panelInternalWidth && !this.panelIsResizing) {
                this.panelInternalWidth = width
            }
        })
        this.app.tabsChanged$.subscribe(() => this.tabStateChanged())
        this.app.activeTabChange$.subscribe(() => this.tabStateChanged())
    }

    /**
     * 一次性迁移：把旧版本存 localStorage 的侧栏状态搬到 config.yaml，
     * 使其可随配置同步（configSync）。迁移完成后删除对应 localStorage 键。
     */
    private migrateSidebarState (): void {
        let changed = false
        if (window.localStorage.profileTreeCollapsed !== undefined) {
            this.config.store.appearance.profileTreeCollapsed = window.localStorage.profileTreeCollapsed === 'true'
            window.localStorage.removeItem('profileTreeCollapsed')
            changed = true
        }
        if (window.localStorage.profileTreeWidth !== undefined) {
            const width = parseInt(window.localStorage.profileTreeWidth)
            if (!isNaN(width)) {
                this.config.store.appearance.profileTreeWidth = width
            }
            window.localStorage.removeItem('profileTreeWidth')
            changed = true
        }
        if (window.localStorage.profileGroupCollapsed !== undefined) {
            try {
                this.config.store.appearance.profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
            } catch { /* ignore corrupt value */ }
            window.localStorage.removeItem('profileGroupCollapsed')
            changed = true
        }
        if (changed) {
            this.config.save().catch(() => null)
        }
    }

    private async loadTreeItems (): Promise<void> {
        const profileGroupCollapsed = this.config.store.appearance.profileGroupCollapsed ?? {}

        // 左侧只显示用户手动创建的连接（非 builtin）。
        // 不传 includeNonUserGroup → 不再生成 built-in / ungrouped 两个虚拟组；
        // 内置模板与从 ~/.ssh/config 导入的连接只出现在「新建连接」的模板选择器里。
        const groups = await this.profilesService.getProfileGroups({ includeProfiles: true })

        for (const group of groups) {
            if (group.profiles?.length) {
                // remove template / builtin / blocklisted profiles
                group.profiles = group.profiles.filter(x => !x.isTemplate)
                group.profiles = group.profiles.filter(x => !x.isBuiltin)
                group.profiles = group.profiles.filter(x => x.id && !this.config.store.profileBlacklist.includes(x.id))
            }
        }

        // 无分组的用户连接直接挂在树根
        const userProfiles = await this.profilesService.getProfiles({ includeBuiltin: false })
        this.rootProfiles = userProfiles.filter(x =>
            !x.isTemplate && !x.isBuiltin && x.id &&
            !this.config.store.profileBlacklist.includes(x.id) &&
            !x.group,
        )

        groups.sort((a, b) => a.name.localeCompare(b.name))
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

    ////// DRAG & DROP //////

    onProfileDragStart (event: DragEvent, profile: PartialProfile<Profile>): void {
        if (profile.isBuiltin === true || profile.isTemplate === true) {
            event.preventDefault()
            return
        }
        this.dragPayload = { type: 'profile', profile }
        this.dragSourceId = profile.id ?? null
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', profile.id ?? '')
        }
    }

    onGroupDragStart (event: DragEvent, group: PartialProfileGroup<CollapsableProfileGroup>): void {
        if (!this.isUserGroup(group)) {
            event.preventDefault()
            return
        }
        this.dragPayload = { type: 'group', group }
        this.dragSourceId = group.id
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', group.id)
        }
    }

    onDragEnd (): void {
        this.dragPayload = null
        this.dragSourceId = null
        this.clearDragOver()
    }

    /** 连接 item 作为拖拽源，悬停时把放置转发到它所在的文件夹（或根目录） */
    onProfileDragOver (event: DragEvent, group?: PartialProfileGroup<CollapsableProfileGroup>): void {
        if (group) {
            this.onGroupDragOver(event, group)
        } else {
            this.onRootDragOver(event)
        }
    }

    onGroupDragOver (event: DragEvent, group: PartialProfileGroup<CollapsableProfileGroup>): void {
        if (!this.dragPayload) {
            return
        }
        const canDrop = this.dragPayload.type === 'profile'
            ? this.isUserGroup(group)
            : this.canDropGroup(this.dragPayload.group!, group)
        if (!canDrop) {
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'none'
            }
            this.dragOverTargetId = null
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move'
        }
        this.dragOverTargetId = group.id
    }

    onRootDragOver (event: DragEvent): void {
        if (!this.dragPayload) {
            return
        }
        // 拖到根目录：连接和文件夹都合法（文件夹到根目录 = 取消父文件夹）
        event.preventDefault()
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move'
        }
        this.dragOverTargetId = 'root'
    }

    onRootDragLeave (event: DragEvent): void {
        const container = event.currentTarget as HTMLElement
        const related = event.relatedTarget as HTMLElement | null
        if (!related || !container.contains(related)) {
            this.clearDragOver()
        }
    }

    async onProfileDrop (event: DragEvent, group?: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        if (group) {
            await this.onGroupDrop(event, group)
        } else {
            await this.onRootDrop(event)
        }
    }

    async onGroupDrop (event: DragEvent, group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        const payload = this.dragPayload
        this.clearDragOver()
        if (!payload) {
            return
        }

        if (payload.type === 'profile') {
            if (payload.profile && this.isUserGroup(group)) {
                await this.moveProfileTo(payload.profile, group)
            }
        } else {
            if (payload.group && this.canDropGroup(payload.group, group)) {
                await this.moveGroupTo(payload.group, group)
            }
        }
        this.dragPayload = null
        this.dragSourceId = null
    }

    async onRootDrop (event: DragEvent): Promise<void> {
        event.preventDefault()
        const payload = this.dragPayload
        this.clearDragOver()
        if (!payload) {
            return
        }

        if (payload.type === 'profile') {
            if (payload.profile) {
                await this.moveProfileTo(payload.profile, null)
            }
        } else {
            if (payload.group) {
                await this.moveGroupTo(payload.group, null)
            }
        }
        this.dragPayload = null
        this.dragSourceId = null
    }

    /**
     * 文件夹能否放到 targetGroup 下：目标必须是用户组、不能是自己或自己的后代，
     * 且放过去后整棵子树深度不超过 MAX_GROUP_DEPTH。
     */
    canDropGroup (group: PartialProfileGroup<CollapsableProfileGroup>, targetGroup: PartialProfileGroup<CollapsableProfileGroup>): boolean {
        if (!this.isUserGroup(targetGroup)) {
            return false
        }
        if (targetGroup.id === group.id) {
            return false
        }
        if (this.isGroupDescendant(group.id, targetGroup.id)) {
            return false
        }
        const movingHeight = this.subtreeHeight(group)
        const maxParentDepth = MAX_GROUP_DEPTH - 2 - movingHeight
        return this.groupDepth(targetGroup.id) <= maxParentDepth
    }

    /** 从自身到最深后代的层数（叶子 = 0，含一层子文件夹 = 1） */
    subtreeHeight (group: PartialProfileGroup<CollapsableProfileGroup>): number {
        const children = group.children ?? []
        if (!children.length) {
            return 0
        }
        return 1 + Math.max(...children.map(child => this.subtreeHeight(child)))
    }

    /** nodeId 是否是 ancestorId 的后代（沿 parentGroupId 上溯） */
    isGroupDescendant (ancestorId: string, nodeId: string): boolean {
        let current = nodeId
        let guard = 0
        while (current && guard++ < 30) {
            const g = this.profilesService.resolveProfileGroup(current)
            if (!g?.parentGroupId) {
                return false
            }
            if (g.parentGroupId === ancestorId) {
                return true
            }
            current = g.parentGroupId
        }
        return false
    }

    async moveProfileTo (profile: PartialProfile<Profile>, group: PartialProfileGroup<CollapsableProfileGroup> | null): Promise<void> {
        const cProfile = this.config.store.profiles.find(p => p.id === profile.id)
        if (!cProfile) {
            return
        }
        if (group) {
            cProfile.group = group.id
        } else {
            delete cProfile.group
        }
        await this.config.save()
    }

    async moveGroupTo (group: PartialProfileGroup<CollapsableProfileGroup>, targetGroup: PartialProfileGroup<CollapsableProfileGroup> | null): Promise<void> {
        const cGroup = this.config.store.groups.find(g => g.id === group.id)
        if (!cGroup) {
            return
        }
        if (targetGroup) {
            cGroup.parentGroupId = targetGroup.id
        } else {
            delete cGroup.parentGroupId
        }
        await this.config.save()
    }

    clearDragOver (): void {
        this.dragOverTargetId = null
    }

    private async tabStateChanged (): Promise<void> {
        // TODO: show active tab in the side panel with eye icon
    }

    async launchProfile<P extends Profile> (profile: PartialProfile<P>): Promise<any> {
        return this.profilesService.launchProfile(profile)
    }

    /**
     * 打开（或聚焦）设置 tab —— 设置入口已从 tab bar 移到侧栏左下角。
     * 通过运行时 require 复用 tabby-settings 的 SettingsTabComponent，避免编译期循环依赖。
     */
    openSettings (): void {
        const { SettingsTabComponent } = window['nodeRequire']('tabby-settings')
        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsTabComponent)
        if (settingsTab) {
            this.app.selectTab(settingsTab)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent })
        }
    }

    async onFilterChange (): Promise<void> {
        try {
            const q = this.filter.trim().toLowerCase()

            if (q.length === 0) {
                await this.loadTreeItems()
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

            this.rootProfiles = []
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
        this.config.store.appearance.profileTreeCollapsed = this.sidebarCollapsed
        this.config.save().catch(() => null)
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
    }

    @HostListener('document:mouseup')
    stopResize (): boolean {
        this.panelIsResizing = false
        this.config.store.appearance.profileTreeWidth = this.panelInternalWidth
        this.config.save().catch(() => null)
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
        const collapsed = { ...this.config.store.appearance.profileGroupCollapsed ?? {} }
        collapsed[group.id] = group.collapsed
        this.config.store.appearance.profileGroupCollapsed = collapsed
        this.config.save().catch(() => null)
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }

}
