import { render } from 'preact';
import { App } from './App';
import { applyTheme, loadTheme } from './theme';
import './styles.css';

// Applied before the first render so the saved theme never flashes the default.
applyTheme(loadTheme());

render(<App />, document.getElementById('app')!);
