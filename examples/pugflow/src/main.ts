import { createWorkbench } from '@briday1/layout';
import { createPugflowAdapter } from '@briday1/layout-pugflow';
import '@briday1/layout/styles.css';
import source from './example.pug?raw';
import styles from './styles.css?raw';

const workbench = createWorkbench(
  document.querySelector<HTMLElement>('#app')!,
  createPugflowAdapter(source, styles),
  { storageKey: 'layout:pugflow-example' },
);

if (import.meta.hot) import.meta.hot.dispose(() => workbench.destroy());
