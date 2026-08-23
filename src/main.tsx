import { render } from 'preact';
import { App } from './App';
import { NpcEditorShell } from './components/NpcEditorShell';
import { applyTheme, loadTheme } from './theme';
import './styles.css';

// Applied before the first render so the saved theme never flashes the default.
applyTheme(loadTheme());

render(<NpcEditorShell><App /></NpcEditorShell>, document.getElementById('app')!);
