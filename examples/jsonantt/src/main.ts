import { createWorkbench } from '@briday1/layout';
import { createJsonanttAdapter } from '@briday1/layout-jsonantt';
import '@briday1/layout/styles.css';
import source from './example.json?raw';

const workbench = createWorkbench(
  document.querySelector<HTMLElement>('#app')!,
  createJsonanttAdapter(source),
  { storageKey: 'layout:jsonantt-example' },
);

if (import.meta.hot) import.meta.hot.dispose(() => workbench.destroy());
