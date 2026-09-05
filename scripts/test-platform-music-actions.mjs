import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";

const getWsUrl = () =>
	new Promise((resolve, reject) => {
		http
			.get("http://127.0.0.1:5858/json/list", (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					try {
						resolve(JSON.parse(data)[0].webSocketDebuggerUrl);
					} catch (err) {
						reject(err);
					}
				});
			})
			.on("error", reject);
	});

const send = (ws, method, params) =>
	new Promise((resolve, reject) => {
		const id = Math.floor(Math.random() * 1e9);
		const handler = (buffer) => {
			let message;
			try {
				message = JSON.parse(buffer.toString());
			} catch (err) {
				ws.off("message", handler);
				reject(err);
				return;
			}
			if (message.id !== id) return;
			ws.off("message", handler);
			if (message.error) reject(new Error(message.error.message));
			else resolve(message.result);
		};
		ws.on("message", handler);
		ws.send(JSON.stringify({ id, method, params }));
	});

const ws = new WebSocket(await getWsUrl());
await new Promise((resolve, reject) => {
	ws.once("open", resolve);
	ws.once("error", reject);
});

const rendererCode = `
(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  location.hash = '#/platformMusic'
  await wait(2500)
  const findGroup = name => Array.from(document.querySelectorAll('section')).find(section => section.querySelector('strong')?.innerText.includes(name))
  const qqGroup = findGroup('QQ')
  const qqButtons = Array.from(qqGroup?.querySelectorAll('button') || [])
  const qzone = qqButtons.find(button => button.innerText.includes('QZone'))
  const qzoneResult = { shown: Boolean(qzone) }

  const playlistButton = qqButtons.find(button => !button.innerText.includes('每日推荐') && !button.innerText.includes('QZone'))
  playlistButton?.click()
  for (let i = 0; i < 10 && document.querySelectorAll('.list-item').length === 0; i++) await wait(300)
  const row = document.querySelector('.list-item')
  row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
  await wait(300)
  const contextText = Array.from(document.querySelectorAll('[class*=menu], [class*=Menu], [role=menu]'))
    .map(item => item.innerText).filter(Boolean).join('\\n')
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))

  const visibleDialogs = () => Array.from(document.querySelectorAll('[class*=modal], [class*=Modal], [class*=dialog], [role=dialog]'))
    .filter(item => getComputedStyle(item).display !== 'none' && getComputedStyle(item).visibility !== 'hidden')
    .map(item => item.innerText.trim()).filter(Boolean)
  const popupBefore = visibleDialogs()
  const playButton = Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === '播放')
  playButton?.click()
  await wait(2500)
  const popupAfter = visibleDialogs()

  const nav = Array.from(document.querySelectorAll('nav a, nav button, aside a, aside button')).map(item => ({
    text: item.innerText.trim(),
    uses: Array.from(item.querySelectorAll('use')).map(use => use.getAttribute('href') || use.getAttribute('xlink:href')),
    svgCount: item.querySelectorAll('svg').length,
  })).filter(item => item.text || item.svgCount)

  return {
    qzone: qzoneResult,
    contextText,
    hasAddAction: /添加到|收藏到/.test(contextText),
    hasRemoveAction: /移除|删除/.test(contextText),
    popupBefore,
    popupAfter,
    nav,
  }
})()
`;

const expression = `
(() => {
  const require = process.mainModule.require.bind(process.mainModule)
  const { BrowserWindow } = require('electron')
  const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('localhost:9080'))
  if (!win) throw new Error('main renderer window not found')
  return win.webContents.executeJavaScript(${JSON.stringify(rendererCode)}, true)
})()
`;

const response = await send(ws, "Runtime.evaluate", {
	expression,
	awaitPromise: true,
	returnByValue: true,
});
ws.close();
if (response.exceptionDetails)
	throw new Error(
		response.exceptionDetails.exception?.description ||
			response.exceptionDetails.text,
	);

const result = response.result?.value;
console.log(JSON.stringify(result, null, 2));
assert.equal(
	result.qzone.shown,
	false,
	"empty QZone background-music system directory should be hidden",
);
assert.equal(
	result.hasAddAction,
	true,
	"platform song menu has no add-to-playlist action",
);
assert.equal(
	result.hasRemoveAction,
	true,
	"platform song menu has no remove-from-playlist action",
);
