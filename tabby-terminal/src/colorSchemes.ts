import { Injectable } from '@angular/core'
import { TerminalColorSchemeProvider } from './api/colorSchemeProvider'
import { TerminalColorScheme } from 'tabby-core'

@Injectable({ providedIn: 'root' })
export class DefaultColorSchemes extends TerminalColorSchemeProvider {
    static oneDark: TerminalColorScheme = {
        name: 'One Dark',
        foreground: '#abb2bf',
        background: '#282c34',
        cursor: '#528bff',
        colors: [
            '#282c34',
            '#e06c75',
            '#98c379',
            '#e5c07b',
            '#61afef',
            '#c678dd',
            '#56b6c2',
            '#abb2bf',
            '#5c6370',
            '#e06c75',
            '#98c379',
            '#e5c07b',
            '#61afef',
            '#c678dd',
            '#56b6c2',
            '#ffffff',
        ],
    }

    static oneHalfLight: TerminalColorScheme = {
        name: 'One Half Light',
        foreground: '#383a42',
        background: '#fafafa',
        cursor: '#bfceff',
        colors: [
            '#383a42',
            '#e45649',
            '#50a14f',
            '#c18401',
            '#0184bc',
            '#a626a4',
            '#0997b3',
            '#fafafa',
            '#4f525e',
            '#e06c75',
            '#98c379',
            '#e5c07b',
            '#61afef',
            '#c678dd',
            '#56b6c2',
            '#ffffff',
        ],
    }

    static dracula: TerminalColorScheme = {
        name: 'Dracula',
        foreground: '#f8f8f2',
        background: '#1e1f29',
        cursor: '#bbbbbb',
        colors: [
            '#000000',
            '#ff5555',
            '#50fa7b',
            '#f1fa8c',
            '#bd93f9',
            '#ff79c6',
            '#8be9fd',
            '#bbbbbb',
            '#555555',
            '#ff5555',
            '#50fa7b',
            '#f1fa8c',
            '#bd93f9',
            '#ff79c6',
            '#8be9fd',
            '#ffffff',
        ],
    }

    static defaultColorScheme: TerminalColorScheme = DefaultColorSchemes.dracula
    static defaultLightColorScheme: TerminalColorScheme = DefaultColorSchemes.oneHalfLight

    async getSchemes (): Promise<TerminalColorScheme[]> {
        return [
            DefaultColorSchemes.oneDark,
            DefaultColorSchemes.oneHalfLight,
            DefaultColorSchemes.dracula,
        ]
    }
}
