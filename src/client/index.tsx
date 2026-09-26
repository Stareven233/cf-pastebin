/**
 * 前端应用主入口，挂载 SolidJS DOM 根节点
 */

import { render } from 'solid-js/web';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');

if (root) {
  render(() => <App />, root);
} else {
  console.error('Root element not found in DOM.');
}
