import { PORT, startServer } from './api';
import { executeTask } from './runner';
import { Scheduler } from './scheduler';

console.log('[agendum] daemon 启动中…');

const scheduler = new Scheduler(executeTask);
startServer(scheduler);
scheduler.start();

console.log(`[agendum] 就绪：http://127.0.0.1:${PORT}`);
