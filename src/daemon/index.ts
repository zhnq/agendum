import { PORT, startServer } from './api';
import { executeTask } from './runner';
import { Scheduler } from './scheduler';

console.log('[smardydy] daemon 启动中…');

const scheduler = new Scheduler(executeTask);
startServer(scheduler);
scheduler.start();

console.log(`[smardydy] 就绪：http://127.0.0.1:${PORT}`);
