export type SshThemeName =
  | 'vscode-dark'
  | 'solarized-dark'
  | 'solarized-light'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'one-light';

export interface SshTheme {
  name: string;
  bg: string;
  fg: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const SSH_THEMES: Record<SshThemeName, SshTheme> = {
  'vscode-dark': {
    name: 'VS Code Dark',
    bg: '#1e1e1e', fg: '#d4d4d4', cursor: '#aeafad', selection: '#264f78',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#e5e5e5',
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    bg: '#002b36', fg: '#839496', cursor: '#839496', selection: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    name: 'Solarized Light',
    bg: '#fdf6e3', fg: '#657b83', cursor: '#586e75', selection: '#eee8d5',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  monokai: {
    name: 'Monokai',
    bg: '#272822', fg: '#f8f8f2', cursor: '#f8f8f0', selection: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
    brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  },
  dracula: {
    name: 'Dracula',
    bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  nord: {
    name: 'Nord',
    bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'one-light': {
    name: 'One Light',
    bg: '#fafafa', fg: '#383a42', cursor: '#526fff', selection: '#e5e5e6',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
    blue: '#0184bb', magenta: '#a626a4', cyan: '#0997b3', white: '#fafafa',
    brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
};

export const DEFAULT_THEME: SshThemeName = 'vscode-dark';
export const THEME_NAMES = Object.entries(SSH_THEMES).map(([id, t]) => ({
  id: id as SshThemeName,
  name: t.name,
}));
