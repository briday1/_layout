import { createWorkbench } from '@briday1/layout';
import { createSankeyAdapter } from '@briday1/layout-pug-sankey';
import '@briday1/layout/styles.css';
import source from './example.pug?raw';

const workbench = createWorkbench(
  document.querySelector<HTMLElement>('#app')!,
  createSankeyAdapter(source),
  { storageKey: 'layout:sankey-example' },
);

if (import.meta.hot) import.meta.hot.dispose(() => workbench.destroy());
