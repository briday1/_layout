import { createWorkbench } from '@briday1/layout';
import { createSankeyAdapter } from '@briday1/layout-pug-sankey';
import { createPugflowAdapter } from '@briday1/layout-pugflow';
import { createJsonanttAdapter } from '@briday1/layout-jsonantt';
import '@briday1/layout/styles.css';
import sankeySource from '../../pug-sankey/src/example.pug?raw';
import pugflowSource from '../../pugflow/src/example.pug?raw';
import pugflowStyles from '../../pugflow/src/styles.css?raw';
import jsonanttSource from '../../jsonantt/src/example.json?raw';

const app = document.querySelector<HTMLElement>('#app')!;
const params = new URLSearchParams(location.search);
const target = params.get('app');

let workbench: ReturnType<typeof createWorkbench> | null = null;

if (target === 'pug-sankey') {
  workbench = createWorkbench(app, createSankeyAdapter(sankeySource), { storageKey: 'layout:portal:pug-sankey' });
} else if (target === 'pugflow') {
  workbench = createWorkbench(app, createPugflowAdapter(pugflowSource, pugflowStyles), { storageKey: 'layout:portal:pugflow' });
} else if (target === 'jsonantt') {
  workbench = createWorkbench(app, createJsonanttAdapter(jsonanttSource), { storageKey: 'layout:portal:jsonantt' });
} else {
  document.title = '_layout workbench';
  const portal = document.createElement('div');
  portal.className = 'portal';
  portal.innerHTML = `
    <h1>_layout</h1>
    <p>A capability-first source workbench. Each application below runs on the shared
    engine with its own parser, renderer, and fidelity-critical features preserved.</p>
    <ul>
      <li><a href="?app=pug-sankey"><strong>Pug Sankey</strong><span>Weighted flow ribbons · 12 flow shapes · annotations</span></a></li>
      <li><a href="?app=pugflow"><strong>Pugflow</strong><span>Block flow diagrams · shapes, arrows, reusable styles</span></a></li>
      <li><a href="?app=jsonantt"><strong>jsonantt</strong><span>JSON Gantt timelines · chart + table canvases · dependencies</span></a></li>
    </ul>`;
  app.append(portal);
}

if (import.meta.hot) import.meta.hot.dispose(() => workbench?.destroy());
