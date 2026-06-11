// 用 CDP 驱动 headless Edge 走一遍对话式建任务 UI 并逐步截图（配合 8791 测试 daemon + mock LLM）。
// 前置：msedge --headless=new --remote-debugging-port=9223 已启动。
const CDP = 'http://127.0.0.1:9223';

const list: any[] = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));

function send(method: string, params: any = {}): Promise<any> {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function evalJs(expression: string) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function shot(name: string) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(`build/nl-${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log(`shot: build/nl-${name}.png`);
}
async function typeEnter(text: string) {
  await send('Input.insertText', { text });
  for (const type of ['rawKeyDown', 'char', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      windowsVirtualKeyCode: 13,
    });
  }
}

await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8791/#/' });
await sleep(2000);
await shot('1-handle');

await evalJs(`document.querySelector('.nl-handle').click()`);
await sleep(800);
await evalJs(`document.querySelector('.nl-chat-input textarea').focus()`);
await typeEnter('每天检查 D 盘剩余空间');
await sleep(1800);
await shot('2-single');

await evalJs(`document.querySelectorAll('.nl-options button')[0].click()`);
await sleep(1800);
await shot('3-multi');

await evalJs(`document.querySelectorAll('.nl-options input[type=checkbox]')[0].click()`);
await sleep(300);
await evalJs(
  `[...document.querySelectorAll('.nl-options button')].find(b => b.textContent.replace(/\\s/g, '').includes('确定')).click()`,
);
await sleep(1800);
await shot('4-draft');

await evalJs(
  `[...document.querySelectorAll('.nl-draft-card button')].find(b => b.textContent.includes('回填')).click()`,
);
await sleep(1200);
await shot('5-form-filled');

console.log('UI walk DONE');
ws.close();
